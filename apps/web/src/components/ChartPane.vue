<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, nextTick, computed } from "vue";
import { createChartAdapter, type ChartAdapter } from "@/chart/chartAdapter";
import { useThemeStore } from "@/stores/theme";
import { useMarketStore } from "@/stores/market";
import { useDrawingsStore, type DrawingRect } from "@/stores/drawings";
import type { Candle } from "@traderkomak/shared";
import { currencyFlagUrl, commodityIcon } from "@/utils/flags";
import { TIMEFRAME_SECONDS, instrumentPrecision, providerOf } from "@traderkomak/shared";

const props = defineProps<{
  candles: Candle[];
  isLoading: boolean;
  error: string | null;
  instrument?: string;
}>();

const market = useMarketStore();
const drawingsStore = useDrawingsStore();

const themeStore = useThemeStore();
const containerRef = ref<HTMLElement | null>(null);
let adapter: ChartAdapter | null = null;
let ro: ResizeObserver | null = null;

function flagFor(currency: string): { type: "flag" | "icon"; value: string } {
  const flag = currencyFlagUrl(currency);
  if (flag) return { type: "flag", value: flag };
  const icon = commodityIcon(currency);
  if (icon) return { type: "icon", value: icon };
  return { type: "icon", value: "◈" };
}

function displayWithSpaces(inst: string | undefined): string {
  if (!inst) return "";
  return inst.replace("_", " / ");
}

watch(
  () => props.candles,
  (next, prev) => {
    if (!adapter) return;
    // Re-anchor the badge after any data change (scale may shift)
    nextTick(updateBadgePosition);
    if (!prev || prev.length === 0 || next.length === 0) {
      adapter.setData(next);
      return;
    }
    // Detect lazy-load prepend (older candles added to front)
    const isPrepend = next.length > prev.length && next[0]!.time < prev[0]!.time;
    if (isPrepend) {
      const prevRange = adapter.getLogicalRange();
      adapter.setData(next);
      if (prevRange) {
        const added = next.length - prev.length;
        adapter.setLogicalRange({ from: prevRange.from + added, to: prevRange.to + added });
      }
      return;
    }
    if (next.length < prev.length - 5) {
      adapter.setData(next);
      return;
    }
    const prevLast = prev[prev.length - 1];
    const nextLast = next[next.length - 1];
    if (!nextLast || !prevLast) {
      adapter.setData(next);
      return;
    }
    // Single new candle appended at end (live) — update without refit
    if (next.length === prev.length + 1 && next[next.length - 2]!.time === prevLast.time && nextLast.time > prevLast.time) {
      adapter.updateCandle(nextLast);
      return;
    }
    if (next.length !== prev.length) {
      adapter.setData(next);
      return;
    }
    if (prevLast.time === nextLast.time) {
      // Reconciliation can correct the JUST-CLOSED bar (position len-2).
      // series.update() only touches the last bar, so an older-bar change
      // must go through setData (which preserves the viewport).
      const pp = prev[prev.length - 2];
      const np = next[next.length - 2];
      const olderChanged =
        pp &&
        np &&
        (np.time !== pp.time ||
          np.open !== pp.open ||
          np.high !== pp.high ||
          np.low !== pp.low ||
          np.close !== pp.close);
      if (olderChanged) {
        adapter.setData(next);
      } else {
        adapter.updateCandle(nextLast);
      }
    } else {
      adapter.setData(next);
    }
  },
  { deep: false }
);

watch(
  () => themeStore.theme,
  (t) => {
    adapter?.setTheme(t === "dark");
  }
);

watch(
  () => props.instrument,
  (inst) => {
    if (inst) adapter?.setInstrument(inst);
  }
);

watch(
  () => drawingsStore.activeTool,
  (tool) => {
    if (tool !== "rectangle" && drawingState.value) {
      drawingState.value = null;
      if (onMouseMoveRef) {
        window.removeEventListener("mousemove", onMouseMoveRef);
        onMouseMoveRef = null;
      }
      recalcRects();
    }
  }
);

let visibleCb: ((range: { from: number; to: number } | null) => void) | null = null;
let lazyThrottled = false;
let interactionEl: HTMLElement | null = null;
let interactCb: (() => void) | null = null;
let contextmenuEl: Document | HTMLElement | null = null;
let contextmenuCb: ((e: MouseEvent) => void) | null = null;
let rightMouseEl: Document | HTMLElement | null = null;
let rightMouseCb: ((e: MouseEvent) => void) | null = null;
// Document.addEventListener requires EventListener, not a specific MouseEvent handler
type AnyListener = EventListener;
const countdown = ref("");
const marketClosed = ref(false);

/* Axis tag: the timer, styled identical to LWC's native price label and
   stacked flush directly beneath it. */
const tagVisible = ref(false);
const timerTop = ref(0);
const smallTagH = ref(19); // base (1×) label height
let countdownTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Forex market hours (approximate, UTC): closed Fri ≥ 21:00 UTC through
 * Sun < 22:00 UTC. OANDA practice follows roughly this schedule; exact
 * open/close shifts ±1h with DST — good enough to hide the countdown.
 */
function isForexClosed(d = new Date()): boolean {
  const day = d.getUTCDay(); // 0=Sun … 6=Sat
  const h = d.getUTCHours();
  if (day === 6) return true;
  if (day === 5 && h >= 21) return true;
  if (day === 0 && h < 22) return true;
  return false;
}

/**
 * Positions the timer label flush under LWC's native live-price label:
 * same size, same blue background — they read as one stacked unit.
 */
function updateBadgePosition(): void {
  const last = props.candles[props.candles.length - 1];
  if (!last || !adapter || !containerRef.value) {
    tagVisible.value = false;
    return;
  }
  const y = adapter.getPriceY(last.close);
  if (y === null) {
    tagVisible.value = false; // price scrolled out of view
    return;
  }

  smallTagH.value = adapter.getPriceLabelHeight(); // matches native label

  const timeAxis = 26;
  const paneH = containerRef.value.clientHeight - timeAxis;
  // Native label is centered on price Y → its bottom edge is at y + h/2
  timerTop.value = Math.min(Math.max(y + smallTagH.value / 2, 4), paneH - smallTagH.value);
  tagVisible.value = true;
}

function updateCountdown() {
  marketClosed.value = isForexClosed();
  updateBadgePosition();

  if (marketClosed.value) {
    countdown.value = "CLOSED";
    return;
  }
  const tf = market.timeframe;
  const sec = TIMEFRAME_SECONDS[tf as keyof typeof TIMEFRAME_SECONDS] ?? 5;
  const now = Date.now();
  const bucket = Math.floor(now / (sec * 1000)) * sec * 1000;
  const next = bucket + sec * 1000;
  const rem = Math.max(0, next - now);

  const pad2 = (n: number) => String(n).padStart(2, "0");

  if (sec >= 86400) {
    // Daily candles → HH:MM:SS
    const total = Math.floor(rem / 1000);
    const hh = Math.floor(total / 3600);
    const mm = Math.floor((total % 3600) / 60);
    const ss = total % 60;
    countdown.value = `${pad2(hh)}:${pad2(mm)}:${pad2(ss)}`;
  } else if (sec >= 60) {
    // Minute/hour candles → MM:SS
    const s = Math.floor(rem / 1000);
    countdown.value = `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`;
  } else {
    // Second-based candles → seconds with "s" suffix (e.g. "4s")
    countdown.value = `${Math.max(0, Math.ceil(rem / 1000))}s`;
  }
}

/* ── Rectangle drawing ─────────────────────────────────────────────── */

interface RectPixel {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
  color: string;
  opacity: number;
  selected: boolean;
}

const rectPixels = ref<RectPixel[]>([]);
const drawingState = ref<{ time1: number; price1: number; time2: number; price2: number } | null>(null);
const drawingPreview = ref<RectPixel | null>(null);
const selectedRect = ref<DrawingRect | null>(null);
const editPanelPos = ref<{ x: number; y: number } | null>(null);
const renderTick = ref(0);

function recalcRects(): void {
  if (!adapter) {
    rectPixels.value = [];
    return;
  }
  const rects = drawingsStore.getFor(market.instrument, market.timeframe);
  const out: RectPixel[] = [];

  for (const rect of rects) {
    const x1 = adapter.timeToX(rect.time1);
    const y1 = adapter.getPriceY(rect.price1);
    const x2 = adapter.timeToX(rect.time2);
    const y2 = adapter.getPriceY(rect.price2);
    if (x1 === null || y1 === null || x2 === null || y2 === null) continue;
    out.push({
      id: rect.id,
      left: Math.min(x1, x2),
      top: Math.min(y1, y2),
      width: Math.abs(x2 - x1),
      height: Math.abs(y2 - y1),
      color: rect.color,
      opacity: rect.opacity,
      selected: drawingsStore.selectedId === rect.id,
    });
  }

  // Drawing preview
  if (drawingState.value && adapter) {
    const x1 = adapter.timeToX(drawingState.value.time1);
    const y1 = adapter.getPriceY(drawingState.value.price1);
    const x2 = adapter.timeToX(drawingState.value.time2);
    const y2 = adapter.getPriceY(drawingState.value.price2);
    if (x1 !== null && y1 !== null && x2 !== null && y2 !== null) {
      out.push({
        id: "__preview",
        left: Math.min(x1, x2),
        top: Math.min(y1, y2),
        width: Math.abs(x2 - x1),
        height: Math.abs(y2 - y1),
        color: "#2962ff",
        opacity: 0.15,
        selected: false,
      });
    }
  }

  rectPixels.value = out;
}

function onMouseDown(e: MouseEvent): void {
  if (drawingsStore.activeTool !== "rectangle" || !adapter || !containerRef.value) return;
  if (e.button !== 0) return;

  const rect = containerRef.value.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  // Hit test existing rectangles: if clicking inside one, select it instead of drawing
  for (const r of rectPixels.value) {
    if (r.id === "__preview") continue;
    if (x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height) {
      onRectClick(r.id, e);
      return;
    }
  }

  e.preventDefault();
  e.stopPropagation();

  // Second click → finalize the rectangle and switch to cursor (single draw per selection)
  if (drawingState.value) {
    const d = drawingState.value;
    if (Math.abs(d.time2 - d.time1) >= 1 || Math.abs(d.price2 - d.price1) > 0) {
      drawingsStore.add(market.instrument, market.timeframe, {
        time1: Math.min(d.time1, d.time2),
        price1: Math.min(d.price1, d.price2),
        time2: Math.max(d.time1, d.time2),
        price2: Math.max(d.price1, d.price2),
      });
    }
    drawingState.value = null;
    if (onMouseMoveRef) {
      window.removeEventListener("mousemove", onMouseMoveRef);
      onMouseMoveRef = null;
    }
    drawingsStore.activeTool = "cursor";
    recalcRects();
    return;
  }

  // First click → set corner 1, start preview
  const rect = containerRef.value.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  let time = adapter.xToTime(x);
  if (time === null) {
    const lr = adapter.getLogicalRange();
    if (lr) {
      time = Math.floor(Date.now() / 1000) + Math.round(x / 10) * 5;
    } else {
      return;
    }
  }
  let price = adapter.yToPrice(y);
  if (price === null) {
    const last = props.candles[props.candles.length - 1];
    if (!last) return;
    price = last.close;
  }

  drawingState.value = { time1: time, price1: price, time2: time, price2: price };

  // Preview follows the mouse until second click
  const move = (ev: MouseEvent) => {
    if (!drawingState.value || !adapter || !containerRef.value) return;
    const r = containerRef.value.getBoundingClientRect();
    const mx = ev.clientX - r.left;
    const my = ev.clientY - r.top;
    const t = adapter.xToTime(mx);
    const p = adapter.yToPrice(my);
    if (t !== null) drawingState.value.time2 = t;
    if (p !== null) drawingState.value.price2 = p;
    recalcRects();
  };

  window.addEventListener("mousemove", move);
  onMouseMoveRef = move;
}

let onMouseMoveRef: ((ev: MouseEvent) => void) | null = null;

function onRectClick(id: string, e: MouseEvent): void {
  e.stopPropagation();
  // Auto-switch to cursor when selecting
  if (drawingsStore.activeTool !== "cursor") {
    drawingsStore.activeTool = "cursor";
  }
  drawingsStore.selectedId = id;
  selectedRect.value = drawingsStore.getFor(market.instrument, market.timeframe).find((r) => r.id === id) ?? null;
  const pixel = rectPixels.value.find((r) => r.id === id);
  if (pixel && containerRef.value) {
    editPanelPos.value = {
      x: pixel.left + pixel.width + 8,
      y: pixel.top,
    };
  }
  recalcRects();
}

function onChartClick(): void {
  if (drawingsStore.activeTool === "cursor" && drawingsStore.selectedId) {
    drawingsStore.selectedId = null;
    selectedRect.value = null;
    editPanelPos.value = null;
    recalcRects();
  }
}

function deleteSelected(): void {
  if (!selectedRect.value) return;
  drawingsStore.remove(market.instrument, market.timeframe, selectedRect.value.id);
  selectedRect.value = null;
  editPanelPos.value = null;
  recalcRects();
}

function setColorSelected(color: string): void {
  if (!selectedRect.value) return;
  drawingsStore.updateColor(market.instrument, market.timeframe, selectedRect.value.id, color);
  recalcRects();
}

function onResizeStart(e: MouseEvent, handle: string): void {
  if (!selectedRect.value || !adapter || !containerRef.value) return;
  e.preventDefault();
  e.stopPropagation();
  const rect = { ...selectedRect.value };
  const startX = e.clientX;
  const startY = e.clientY;
  const containerRect = containerRef.value.getBoundingClientRect();

  const onMove = (ev: MouseEvent) => {
    if (!adapter || !containerRef.value) return;
    const r = containerRef.value.getBoundingClientRect();
    const mx = ev.clientX - r.left;
    const my = ev.clientY - r.top;
    const t = adapter.xToTime(mx);
    const p = adapter.yToPrice(my);
    if (t === null || p === null) return;

    const newRect: Partial<DrawingRect> = {};
    if (handle.includes("w")) newRect.time1 = t;
    if (handle.includes("e")) newRect.time2 = t;
    if (handle.includes("s")) newRect.price1 = p;
    if (handle.includes("n")) newRect.price2 = p;
    // For edge centers, only update one axis
    if (handle === "n") newRect.price2 = p;
    if (handle === "s") newRect.price1 = p;
    if (handle === "w") newRect.time1 = t;
    if (handle === "e") newRect.time2 = t;

    drawingsStore.updateRect(market.instrument, market.timeframe, rect.id, newRect);
    // Update selectedRect reference
    const updated = drawingsStore.getFor(market.instrument, market.timeframe).find((r) => r.id === rect.id);
    if (updated) selectedRect.value = updated;
    recalcRects();
    // Update edit panel position
    const pixel = rectPixels.value.find((r) => r.id === rect.id);
    if (pixel && containerRef.value) {
      editPanelPos.value = { x: pixel.left + pixel.width + 8, y: pixel.top };
    }
  };

  const onUp = () => {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  };

  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}

// Re-render rectangles when visible range changes (pan/zoom)
// This is hooked into the existing visibleCb
const _origVisibleCb = visibleCb;

onMounted(async () => {
  await nextTick();
  if (!containerRef.value) return;
  adapter = createChartAdapter(containerRef.value);
  adapter.setTheme(themeStore.theme === "dark");
  if (props.instrument) adapter.setInstrument(props.instrument);
  adapter.setData(props.candles);

  visibleCb = (range) => {
    // Track the price marker + redraw rectangles on every pan/zoom
    updateBadgePosition();
    recalcRects();
    if (!range) return;
    if (lazyThrottled) return;
    if (range.from > 15) return;
    if (market.isLoading || market.isLoadingMore || !market.hasMore) return;
    lazyThrottled = true;
    void market.loadMore().finally(() => {
      setTimeout(() => (lazyThrottled = false), 400);
    });
  };
  adapter.subscribeVisibleRange(visibleCb);

  // Vertical drags & pinch-zoom change the PRICE scale without firing the
  // time-range callback — track pointer/wheel directly for instant reposition.
  const el = containerRef.value;
  const onInteract = () => {
    updateBadgePosition();
    recalcRects();
  };
  el.addEventListener("pointermove", onInteract, { passive: true });
  el.addEventListener("pointerdown", onInteract, { passive: true });
  el.addEventListener("wheel", onInteract, { passive: true });
  el.addEventListener("touchmove", onInteract, { passive: true });
  interactionEl = el;
  interactCb = onInteract;

  // Right-click: switch to cursor tool + deselect any selected rectangle + cancel in-progress drawing
  const onRightClick = (e: MouseEvent) => {
    e.preventDefault();
    if (drawingsStore.activeTool !== "cursor") {
      drawingsStore.activeTool = "cursor";
    }
    if (drawingsStore.selectedId) {
      drawingsStore.selectedId = null;
      selectedRect.value = null;
      editPanelPos.value = null;
      recalcRects();
    }
    if (drawingState.value) {
      drawingState.value = null;
      if (onMouseMoveRef) {
        window.removeEventListener("mousemove", onMouseMoveRef);
        onMouseMoveRef = null;
      }
      recalcRects();
    }
  };
  document.addEventListener("contextmenu", onRightClick as AnyListener);
  contextmenuEl = document;
  contextmenuCb = onRightClick;

  // Also right-click (mousedown button=2) for reliability
  const onRightMouseDown = (e: MouseEvent) => {
    if (e.button !== 2) return;
    e.preventDefault();
    if (drawingsStore.activeTool !== "cursor") {
      drawingsStore.activeTool = "cursor";
    }
    if (drawingsStore.selectedId) {
      drawingsStore.selectedId = null;
      selectedRect.value = null;
      editPanelPos.value = null;
      recalcRects();
    }
    if (drawingState.value) {
      drawingState.value = null;
      if (onMouseMoveRef) {
        window.removeEventListener("mousemove", onMouseMoveRef);
        onMouseMoveRef = null;
      }
      recalcRects();
    }
  };
  document.addEventListener("mousedown", onRightMouseDown as AnyListener);
  rightMouseEl = document;
  rightMouseCb = onRightMouseDown;

  // Countdown text + position tick (position also updates on pan/zoom above)
  updateCountdown();
  countdownTimer = setInterval(updateCountdown, 200);

  ro = new ResizeObserver(() => {
    if (!containerRef.value || !adapter) return;
    const { clientWidth, clientHeight } = containerRef.value;
    adapter.resize(clientWidth, clientHeight);
  });
  ro.observe(containerRef.value);
});

onBeforeUnmount(() => {
  if (visibleCb && adapter) adapter.unsubscribeVisibleRange(visibleCb);
  if (countdownTimer) clearInterval(countdownTimer);
  if (interactionEl && interactCb) {
    interactionEl.removeEventListener("pointermove", interactCb);
    interactionEl.removeEventListener("pointerdown", interactCb);
    interactionEl.removeEventListener("wheel", interactCb);
    interactionEl.removeEventListener("touchmove", interactCb);
  }
  if (contextmenuEl && contextmenuCb) {
    contextmenuEl.removeEventListener("contextmenu", contextmenuCb as AnyListener);
  }
  if (rightMouseEl && rightMouseCb) {
    rightMouseEl.removeEventListener("mousedown", rightMouseCb as AnyListener);
  }
  if (onMouseMoveRef) {
    window.removeEventListener("mousemove", onMouseMoveRef);
  }
  ro?.disconnect();
  adapter?.destroy();
  adapter = null;
});
</script>

<template>
  <div class="chart-pane">
    <!-- Top-left symbol label like TradingView — transparent, only letters with flags -->
    <div v-if="instrument" class="chart-symbol-label">
      <span class="label-text">
        <template v-for="(part, idx) in [instrument.split('_')[0]!, instrument.split('_')[1]!]" :key="part">
          <img v-if="flagFor(part).type === 'flag'" :src="flagFor(part).value" :alt="part" class="flag-img" />
          <span v-else class="flag-emoji">{{ flagFor(part).value }}</span>
          {{ part }}
          <span v-if="idx === 0"> / </span>
        </template>
        - {{ instrument && providerOf(instrument) === "binance" ? "BINANCE" : "OANDA" }}
      </span>
    </div>

    <div v-if="isLoading" class="overlay center loading-only">
      <span class="overlay-spinner large"></span>
    </div>
    <div v-else-if="error" class="overlay error">⚠ {{ error }}</div>
    <div v-else-if="candles.length === 0" class="overlay muted center">
      <span class="overlay-title">No candles yet — waiting for market data</span>
      <span class="hint">Check that the market server is running and OANDA credentials are configured. On weekends the market is closed.</span>
    </div>
    <div v-if="market.isLoadingMore" class="overlay loading-more">Loading more…</div>
    <!-- TradingView-style countdown: glued to the live-price marker on the
         right axis. Tracks pan/zoom instantly; hides when price is off-screen
         or the market is closed. -->
    <!-- Timer label: identical to the native live-price label, stuck
         directly beneath it on the price scale. -->
    <div
      v-if="tagVisible && candles.length > 0"
      class="axis-tag"
      :style="{ top: timerTop + 'px', height: smallTagH + 'px' }"
      :title="marketClosed ? 'Forex market is closed' : `Next ${market.timeframe} candle in`"
    >
      {{ countdown }}
    </div>
    <!-- Drawing cursor capture layer (only when rectangle tool active) -->
    <div
      v-if="drawingsStore.activeTool === 'rectangle' && candles.length > 0"
      class="drawing-capture"
      @mousedown="onMouseDown"
    />
    <!-- Drawing rendering layer (always visible, pointer-events none) -->
    <div class="drawing-layer">
      <div
        v-for="rect in rectPixels"
        :key="rect.id"
        class="drawing-rect"
        :class="{ selected: rect.selected }"
        :style="{
          left: rect.left + 'px',
          top: rect.top + 'px',
          width: rect.width + 'px',
          height: rect.height + 'px',
          backgroundColor: rect.color,
          opacity: rect.opacity,
          borderColor: rect.color,
        }"
        @click.stop="onRectClick(rect.id, $event)"
      >
        <template v-if="rect.selected">
          <div class="resize-handle nw" @mousedown.stop.prevent="onResizeStart($event, 'nw')"></div>
          <div class="resize-handle ne" @mousedown.stop.prevent="onResizeStart($event, 'ne')"></div>
          <div class="resize-handle sw" @mousedown.stop.prevent="onResizeStart($event, 'sw')"></div>
          <div class="resize-handle se" @mousedown.stop.prevent="onResizeStart($event, 'se')"></div>
          <div class="resize-handle n" @mousedown.stop.prevent="onResizeStart($event, 'n')"></div>
          <div class="resize-handle s" @mousedown.stop.prevent="onResizeStart($event, 's')"></div>
          <div class="resize-handle w" @mousedown.stop.prevent="onResizeStart($event, 'w')"></div>
          <div class="resize-handle e" @mousedown.stop.prevent="onResizeStart($event, 'e')"></div>
        </template>
      </div>
    </div>

    <!-- Edit panel for selected rectangle -->
    <div
      v-if="selectedRect && editPanelPos"
      class="rect-edit-panel"
      :style="{ left: editPanelPos.x + 'px', top: editPanelPos.y + 'px' }"
      @click.stop
    >
      <div class="edit-colors">
        <button
          v-for="c in drawingsStore.PRESET_COLORS"
          :key="c"
          class="color-swatch"
          :class="{ active: selectedRect.color === c }"
          :style="{ backgroundColor: c }"
          @click="setColorSelected(c)"
        />
      </div>
      <button class="edit-delete" @click="deleteSelected" title="Delete rectangle">🗑</button>
    </div>

    <div ref="containerRef" class="chart-container" />
  </div>
</template>

<style scoped>
.chart-pane {
  position: relative;
  flex: 1;
  min-height: 0;
  background: var(--chart-bg);
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  margin: 8px;
  overflow: hidden;
  box-shadow: var(--card-shadow);
  border: 1px solid var(--border);
}
.chart-container {
  flex: 1;
  min-height: 0;
  width: 100%;
}
.chart-symbol-label {
  position: absolute;
  top: 10px;
  left: 14px;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: transparent;
  border: none;
  padding: 0;
  pointer-events: none;
}
.label-text {
  font-weight: 800;
  font-size: 13px;
  color: var(--text);
  letter-spacing: -0.02em;
  text-shadow: 0 1px 8px rgba(0, 0, 0, 0.08);
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.flag-img {
  width: 16px;
  height: 12px;
  object-fit: cover;
  border-radius: 2px;
  vertical-align: middle;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.06);
}
.flag-emoji {
  font-size: 12px;
  line-height: 1;
}
.overlay {
  position: absolute;
  top: 14px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 3;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  color: var(--text);
  font-size: 12px;
  font-weight: 600;
  padding: 8px 14px;
  border-radius: 20px;
  max-width: 90%;
  text-align: center;
  pointer-events: none;
  box-shadow: var(--card-shadow);
  backdrop-filter: blur(12px);
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.overlay.center {
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  flex-direction: column;
  padding: 0;
  border-radius: 16px;
}
.overlay.loading-only {
  background: transparent;
  border: none;
  box-shadow: none;
  backdrop-filter: none;
}
.loading-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}
.loading-title {
  font-weight: 800;
  font-size: 13px;
  color: var(--text);
}
.loading-sub {
  font-size: 11px;
  color: var(--text-muted);
  font-weight: 500;
}
.overlay.error {
  border-color: rgba(239, 83, 80, 0.35);
  color: #ef5350;
  background: rgba(239, 83, 80, 0.08);
}
.overlay.muted {
  flex-direction: column;
  gap: 4px;
  color: var(--text-muted);
  padding: 12px 16px;
  border-radius: 12px;
}
.overlay.loading-more {
  top: auto;
  bottom: 12px;
  background: var(--bg-panel);
  font-size: 11px;
  padding: 6px 10px;
  border-radius: 12px;
}
.overlay-title {
  color: var(--text);
  font-weight: 700;
}
.overlay-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  flex-shrink: 0;
}
.overlay-spinner.large {
  width: 40px;
  height: 40px;
  border-width: 4px;
  border-color: transparent;
  border-top-color: var(--accent);
  border-right-color: var(--accent);
  filter: drop-shadow(0 0 6px rgba(41, 98, 255, 0.35));
}
.hint {
  display: block;
  margin-top: 2px;
  font-size: 11px;
  opacity: 0.85;
  font-weight: 500;
  max-width: 420px;
}
.axis-tag {
  position: absolute;
  right: 0;
  z-index: 3;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--accent); /* same blue as the live-price label */
  color: #fff;
  border-radius: 3px 0 0 3px;
  pointer-events: none;
  box-sizing: border-box;
  font-size: 11px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  white-space: nowrap;
  padding: 0 6px;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* ── Drawing overlay ─────────────────────────────────────────────────── */
.drawing-capture {
  position: absolute;
  inset: 0;
  z-index: 5;
  cursor: crosshair;
}
.drawing-layer {
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
}
.drawing-rect {
  position: absolute;
  border: 1.5px solid;
  border-radius: 2px;
  pointer-events: auto;
  cursor: pointer;
  transition: box-shadow 150ms;
}
.drawing-rect:hover {
  box-shadow: 0 0 0 1px rgba(41, 98, 255, 0.4);
}
.drawing-rect.selected {
  border-width: 2px;
  box-shadow: 0 0 0 2px rgba(41, 98, 255, 0.5);
}
.resize-handle {
  position: absolute;
  width: 8px;
  height: 8px;
  background: #fff;
  border: 1px solid #2962ff;
  border-radius: 2px;
  pointer-events: auto;
}
.resize-handle.nw {
  left: -4px;
  top: -4px;
  cursor: nw-resize;
}
.resize-handle.ne {
  right: -4px;
  top: -4px;
  cursor: ne-resize;
}
.resize-handle.sw {
  left: -4px;
  bottom: -4px;
  cursor: sw-resize;
}
.resize-handle.se {
  right: -4px;
  bottom: -4px;
  cursor: se-resize;
}
.resize-handle.n {
  left: 50%;
  top: -4px;
  transform: translateX(-50%);
  cursor: n-resize;
}
.resize-handle.s {
  left: 50%;
  bottom: -4px;
  transform: translateX(-50%);
  cursor: s-resize;
}
.resize-handle.w {
  left: -4px;
  top: 50%;
  transform: translateY(-50%);
  cursor: w-resize;
}
.resize-handle.e {
  right: -4px;
  top: 50%;
  transform: translateY(-50%);
  cursor: e-resize;
}

/* ── Rectangle edit panel ────────────────────────────────────────────── */
.rect-edit-panel {
  position: absolute;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 6px 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
  pointer-events: auto;
}
.edit-colors {
  display: flex;
  gap: 4px;
}
.color-swatch {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  border: 2px solid transparent;
  cursor: pointer;
  transition: all 120ms;
}
.color-swatch:hover {
  transform: scale(1.15);
}
.color-swatch.active {
  border-color: var(--text);
  transform: scale(1.1);
}
.edit-delete {
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 12px;
  border-radius: 4px;
  transition: all 120ms;
}
.edit-delete:hover {
  background: rgba(239, 83, 80, 0.12);
  color: #ef5350;
}
</style>
