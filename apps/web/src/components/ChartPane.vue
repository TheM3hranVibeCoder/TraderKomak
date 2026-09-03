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
    rectMenu.value = null;
    closePalette();
    // Switching away from the rectangle tool aborts any in-progress drawing
    if (tool !== "rectangle") cancelDraw();
  }
);

let visibleCb: ((range: { from: number; to: number } | null) => void) | null = null;
let dataCb: (() => void) | null = null;
let lazyThrottled = false;
let interactionEl: HTMLElement | null = null;
let interactCb: (() => void) | null = null;
/** Per-frame overlay re-projection (see recalcFrame). */
let recalcRaf = 0;
let recalcDeadline = 0;
let pointerHeld = false;
let pointerDownEl: HTMLElement | null = null;
let pointerDownCb: (() => void) | null = null;
let pointerUpCb: (() => void) | null = null;
let chartMouseDownEl: HTMLElement | null = null;
let chartMouseDownCb: ((e: MouseEvent) => void) | null = null;
let paneCtxEl: HTMLElement | null = null;
let paneCtxCb: ((e: MouseEvent) => void) | null = null;
let escCb: ((e: KeyboardEvent) => void) | null = null;
let windowLostCb: (() => void) | null = null;
// addEventListener requires EventListener, not a specific MouseEvent handler
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
  filled: boolean;
  selected: boolean;
}

const rectPixels = ref<RectPixel[]>([]);
/** rectPixels minus the live preview — the interaction layer hit-tests only
 *  real (stored) rectangles. */
const hitRects = computed(() => rectPixels.value.filter((r) => r.id !== "__preview"));
const drawingState = ref<{ time1: number; price1: number; time2: number; price2: number } | null>(null);
const drawingPreview = ref<RectPixel | null>(null);
const selectedRect = ref<DrawingRect | null>(null);
const editPanelPos = ref<{ x: number; y: number } | null>(null);
const editPanelEl = ref<HTMLElement | null>(null);
const editMenuEl = ref<HTMLElement | null>(null);
/** TradingView-style right-click menu: { id, x, y } relative to the chart pane. */
const rectMenu = ref<{ id: string; x: number; y: number } | null>(null);
/** Which color palette popup is open (edit panel / context menu / none). */
const paletteOpen = ref<null | "panel" | "menu">(null);
/* Rendered floating-panel size fallback (the real box is measured once
   mounted; keep these close to the measured 365×40 so the very first paint
   of a freshly opened panel lands within a few px of its final spot). */
const PANEL_W = 366;
const PANEL_H = 40;

/** Keeps a floating panel fully inside the chart pane, both axes. */
function clampToPane(x: number, y: number, el: HTMLElement | null): { x: number; y: number } {
  const pane = containerRef.value;
  if (!pane) return { x, y };
  const w = el?.offsetWidth || PANEL_W;
  const h = el?.offsetHeight || PANEL_H;
  return {
    x: Math.min(Math.max(4, x), Math.max(4, pane.clientWidth - w - 6)),
    y: Math.min(Math.max(4, y), Math.max(4, pane.clientHeight - h - 6)),
  };
}

function togglePalette(which: "panel" | "menu"): void {
  paletteOpen.value = paletteOpen.value === which ? null : which;
}
function closePalette(): void {
  paletteOpen.value = null;
}
/** Style of the rectangle currently opened in the context menu. */
const menuRectColor = computed(() => {
  const m = rectMenu.value;
  if (!m) return "#2962ff";
  return drawingsStore.getFor(market.instrument).find((r) => r.id === m.id)?.color ?? "#2962ff";
});
const menuRectOpacity = computed(() => {
  const m = rectMenu.value;
  if (!m) return 0.3;
  return drawingsStore.getFor(market.instrument).find((r) => r.id === m.id)?.opacity ?? 0.3;
});
const menuRectFilled = computed(() => {
  const m = rectMenu.value;
  if (!m) return true;
  return drawingsStore.getFor(market.instrument).find((r) => r.id === m.id)?.filled !== false;
});
const renderTick = ref(0);

function recalcRects(): void {
  if (!adapter) {
    rectPixels.value = [];
    return;
  }
  const rects = drawingsStore.getFor(market.instrument);
  const out: RectPixel[] = [];

  const project = (x1: number, y1: number, x2: number, y2: number) => ({
    left: Math.min(x1, x2),
    top: Math.min(y1, y2),
    width: Math.max(1, Math.abs(x2 - x1)),
    height: Math.max(1, Math.abs(y2 - y1)),
  });

  for (const rect of rects) {
    const x1 = adapter.timeToX(rect.time1);
    const y1 = adapter.getPriceY(rect.price1);
    const x2 = adapter.timeToX(rect.time2);
    const y2 = adapter.getPriceY(rect.price2);
    if (x1 === null || y1 === null || x2 === null || y2 === null) continue;
    out.push({
      id: rect.id,
      ...project(x1, y1, x2, y2),
      color: rect.color,
      opacity: rect.opacity,
      filled: rect.filled !== false,
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
        ...project(x1, y1, x2, y2),
        color: "#2962ff",
        opacity: 0.15,
        filled: true,
        selected: false,
      });
    }
  }

  rectPixels.value = out;

  // Keep the open edit panel anchored to its rectangle through pan/zoom and
  // chart resizes (watchlist toggle, window resize) — the rectangle's pixels
  // changed under it, so the panel would otherwise sit at stale coordinates.
  if (selectedRect.value && editPanelPos.value) positionEditPanel(selectedRect.value.id);
}

/**
 * Re-projects overlays on every animation frame while the pointer is held
 * (pan drag, price-axis scale drag) or for a short settle window after data
 * changes — the canvas re-renders on rAF, so event-driven re-projection
 * alone trails the render by a frame and drawings visibly lag the chart
 * during price-scale refits and timeframe switches.
 */
function recalcFrame(): void {
  recalcRaf = 0;
  updateBadgePosition();
  recalcRects();
  if (pointerHeld || performance.now() < recalcDeadline) {
    recalcRaf = requestAnimationFrame(recalcFrame);
  }
}

function extendRecalcFrames(ms: number): void {
  recalcDeadline = Math.max(recalcDeadline, performance.now() + ms);
  if (!recalcRaf) recalcRaf = requestAnimationFrame(recalcFrame);
}

/** Begin a rectangle: corner 1 at the pointer, preview follows the mouse. */
function beginDraw(e: MouseEvent): void {
  if (!adapter || !containerRef.value) return;
  const crect = containerRef.value.getBoundingClientRect();
  const x = e.clientX - crect.left;
  const y = e.clientY - crect.top;

  const time = adapter.xToTime(x);
  const price = adapter.yToPrice(y);
  if (time === null || price === null) return;

  drawingState.value = { time1: time, price1: price, time2: time, price2: price };
  const startX = e.clientX;
  const startY = e.clientY;
  recalcRects();

  // Preview follows the mouse until the rectangle is finalized
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

  function stopMove(): void {
    window.removeEventListener("mousemove", move);
    if (onMouseMoveRef === move) onMouseMoveRef = null;
  }

  const up = (ev: MouseEvent) => {
    window.removeEventListener("mouseup", up);
    // Press-drag-release finalizes immediately. Click-move-click keeps the
    // preview alive; the next left-press (capture handler) finalizes.
    if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 4) {
      stopMove();
      finalizeDraw();
    }
  };

  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", up);
  onMouseMoveRef = move;
}

/** Store the preview as a real drawing and switch back to the cursor tool. */
function finalizeDraw(): void {
  const d = drawingState.value;
  drawingState.value = null;
  if (onMouseMoveRef) {
    window.removeEventListener("mousemove", onMouseMoveRef);
    onMouseMoveRef = null;
  }
  if (d && (Math.abs(d.time2 - d.time1) >= 1 || Math.abs(d.price2 - d.price1) > 0)) {
    drawingsStore.add(market.instrument, {
      time1: Math.min(d.time1, d.time2),
      price1: Math.min(d.price1, d.price2),
      time2: Math.max(d.time1, d.time2),
      price2: Math.max(d.price1, d.price2),
    });
  }
  drawingsStore.activeTool = "cursor";
  recalcRects();
}

/** Abort an in-progress drawing (right-click, Escape, tool switch). */
function cancelDraw(): void {
  const had = drawingState.value !== null;
  drawingState.value = null;
  if (onMouseMoveRef) {
    window.removeEventListener("mousemove", onMouseMoveRef);
    onMouseMoveRef = null;
  }
  if (had) recalcRects();
}

let onMouseMoveRef: ((ev: MouseEvent) => void) | null = null;

function onRectClick(id: string, e: MouseEvent): void {
  e.stopPropagation();
  rectMenu.value = null;
  closePalette();
  // Auto-switch to cursor when selecting
  if (drawingsStore.activeTool !== "cursor") {
    drawingsStore.activeTool = "cursor";
  }
  drawingsStore.selectedId = id;
  selectedRect.value = drawingsStore.getFor(market.instrument).find((r) => r.id === id) ?? null;
  recalcRects();
  positionEditPanel(id);
}

/** Places the floating edit panel just ABOVE the rectangle's top-right corner
 *  (TradingView-style) so the resize handles stay visible and even a tiny
 *  rect isn't covered; flips below when there's no room above. */
function positionEditPanel(id: string): void {
  const pixel = rectPixels.value.find((r) => r.id === id);
  const pane = containerRef.value;
  if (!pixel || !pane) return;
  editPanelPos.value = computePanelPos(pixel, pane);
  // First open: the panel element isn't mounted yet, so the position above
  // used the fallback size. Re-measure as soon as it mounts (nextTick runs
  // before the browser paints, so the panel never appears misplaced and
  // doesn't jump a moment later).
  if (!editPanelEl.value) {
    void nextTick(() => {
      const sel = selectedRect.value;
      if (!editPanelEl.value || !sel || !containerRef.value) return;
      const px = rectPixels.value.find((r) => r.id === sel.id);
      if (px) editPanelPos.value = computePanelPos(px, containerRef.value);
    });
  }
}

function computePanelPos(pixel: RectPixel, pane: HTMLElement): { x: number; y: number } {
  const w = editPanelEl.value?.offsetWidth || PANEL_W;
  const h = editPanelEl.value?.offsetHeight || PANEL_H;
  const gap = 8;
  // Right edges aligned with the rectangle, 8px above its top edge
  let x = pixel.left + pixel.width - w;
  let y = pixel.top - h - gap;
  if (y < 4) y = pixel.top + pixel.height + gap; // flip below the rect
  // Safety clamp: fully inside the pane on both axes.
  x = Math.min(Math.max(4, x), Math.max(4, pane.clientWidth - w - 6));
  y = Math.min(Math.max(4, y), Math.max(4, pane.clientHeight - h - 6));
  return { x, y };
}

/** Drag the whole rectangle to move it (TradingView-style body drag). */
function onRectDragStart(e: MouseEvent, id: string): void {
  if (e.button !== 0 || drawingsStore.activeTool !== "cursor") return;
  if (!adapter || !containerRef.value) return;
  const rect = drawingsStore.getFor(market.instrument).find((r) => r.id === id);
  if (!rect) return;
  e.preventDefault();
  e.stopPropagation();
  rectMenu.value = null;
  closePalette();

  // EDGE GUARD: the resize handles are tiny (8px). A press aimed at a
  // left/right handle that misses by a few pixels would otherwise land on the
  // body and DRAG the whole rectangle to the cursor. If the rect is already
  // selected and the press is within the edge zone, resize instead of move.
  const rGuard = containerRef.value.getBoundingClientRect();
  const px = e.clientX - rGuard.left;
  const py = e.clientY - rGuard.top;
  const pixel = rectPixels.value.find((r) => r.id === id);
  if (pixel?.selected) {
    const near = 9; // handle hit radius (8px handle + 1px slack)
    const withinY = py >= pixel.top - near && py <= pixel.top + pixel.height + near;
    if (withinY && Math.abs(px - pixel.left) <= near) {
      onResizeStart(e, "w");
      return;
    }
    if (withinY && Math.abs(px - (pixel.left + pixel.width)) <= near) {
      onResizeStart(e, "e");
      return;
    }
  }

  // Select on press so the handles + edit panel appear immediately
  drawingsStore.selectedId = id;
  selectedRect.value = rect;
  recalcRects();
  positionEditPanel(id);

  const r0 = containerRef.value.getBoundingClientRect();
  const startT = adapter.xToTime(e.clientX - r0.left);
  const startP = adapter.yToPrice(e.clientY - r0.top);
  if (startT === null || startP === null) return;
  const orig = { time1: rect.time1, price1: rect.price1, time2: rect.time2, price2: rect.price2 };

  const onMove = (ev: MouseEvent) => {
    if (!adapter || !containerRef.value) return;
    const r = containerRef.value.getBoundingClientRect();
    const t = adapter.xToTime(ev.clientX - r.left);
    const p = adapter.yToPrice(ev.clientY - r.top);
    if (t === null || p === null) return;
    const dt = t - startT;
    const dp = p - startP;
    drawingsStore.updateRect(market.instrument, id, {
      time1: orig.time1 + dt,
      time2: orig.time2 + dt,
      price1: orig.price1 + dp,
      price2: orig.price2 + dp,
    });
    const updated = drawingsStore.getFor(market.instrument).find((x) => x.id === id);
    if (updated) selectedRect.value = updated;
    recalcRects();
    positionEditPanel(id);
  };

  const onUp = () => {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  };
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}

function onChartClick(): void {
  if (rectMenu.value) rectMenu.value = null;
  closePalette();
  if (drawingsStore.activeTool === "cursor" && drawingsStore.selectedId) {
    drawingsStore.selectedId = null;
    selectedRect.value = null;
    editPanelPos.value = null;
    recalcRects();
  }
}

function deleteSelected(): void {
  if (!selectedRect.value) return;
  drawingsStore.remove(market.instrument, selectedRect.value.id);
  selectedRect.value = null;
  editPanelPos.value = null;
  rectMenu.value = null;
  closePalette();
  recalcRects();
}

/** Context-menu color change: works on the right-clicked rectangle. */
function setColorInMenu(color: string): void {
  const menu = rectMenu.value;
  if (!menu) return;
  drawingsStore.updateStyle(market.instrument, menu.id, { color });
  if (selectedRect.value?.id === menu.id) syncSelected();
  else recalcRects();
}

function setOpacityInMenu(opacity: number): void {
  const menu = rectMenu.value;
  if (!menu) return;
  drawingsStore.updateStyle(market.instrument, menu.id, { opacity });
  if (selectedRect.value?.id === menu.id) syncSelected();
  else recalcRects();
}

/** Context-menu fill toggle (border-only ⇄ filled). */
function toggleFillInMenu(): void {
  const menu = rectMenu.value;
  if (!menu) return;
  const rect = drawingsStore.getFor(market.instrument).find((r) => r.id === menu.id);
  if (!rect) return;
  drawingsStore.updateStyle(market.instrument, menu.id, { filled: rect.filled === false });
  if (selectedRect.value?.id === menu.id) syncSelected();
  else recalcRects();
}

/** Context-menu delete. */
function deleteFromMenu(): void {
  const menu = rectMenu.value;
  if (!menu) return;
  drawingsStore.remove(market.instrument, menu.id);
  if (selectedRect.value?.id === menu.id) {
    selectedRect.value = null;
    editPanelPos.value = null;
  }
  rectMenu.value = null;
  closePalette();
  recalcRects();
}

function setColorSelected(color: string): void {
  if (!selectedRect.value) return;
  drawingsStore.updateStyle(market.instrument, selectedRect.value.id, { color });
  syncSelected();
}

function setOpacitySelected(opacity: number): void {
  if (!selectedRect.value) return;
  drawingsStore.updateStyle(market.instrument, selectedRect.value.id, { opacity });
  syncSelected();
}

/** Toggle background fill; border-only rects render at 100% opacity. */
function toggleFillSelected(): void {
  if (!selectedRect.value) return;
  drawingsStore.updateStyle(market.instrument, selectedRect.value.id, {
    filled: selectedRect.value.filled === false,
  });
  syncSelected();
}

/** Re-read the selected rect from the store and refresh the overlay. */
function syncSelected(): void {
  if (!selectedRect.value) return;
  const updated = drawingsStore.getFor(market.instrument).find((r) => r.id === selectedRect.value!.id);
  if (updated) selectedRect.value = updated;
  recalcRects();
}

function onResizeStart(e: MouseEvent, handle: string): void {
  if (!selectedRect.value || !adapter || !containerRef.value) return;
  e.preventDefault();
  e.stopPropagation();
  const rect = { ...selectedRect.value };
  rectMenu.value = null;

  // Map the dragged SCREEN edge to the stored corner currently sitting on it.
  // Corners can be un-ordered (after a flip mid-resize), so a fixed mapping
  // like "e" → time2 would grab the wrong side and make the rect jump.
  //   right edge = max(time1,time2), left = min; top = max(price1,price2)
  //   (higher price = higher on screen), bottom = min.
  const edgeTime =
    handle.includes("e") ? (rect.time1 > rect.time2 ? "time1" : "time2")
    : handle.includes("w") ? (rect.time1 > rect.time2 ? "time2" : "time1")
    : null;
  const edgePrice =
    handle.includes("n") ? (rect.price1 > rect.price2 ? "price1" : "price2")
    : handle.includes("s") ? (rect.price1 > rect.price2 ? "price2" : "price1")
    : null;

  const onMove = (ev: MouseEvent) => {
    if (!adapter || !containerRef.value) return;
    const r = containerRef.value.getBoundingClientRect();
    const mx = ev.clientX - r.left;
    const my = ev.clientY - r.top;
    const t = adapter.xToTime(mx);
    const p = adapter.yToPrice(my);
    if (t === null || p === null) return;

    // Only the dragged edge moves; the opposite edge stays anchored.
    const newRect: Partial<DrawingRect> = {};
    if (edgeTime) newRect[edgeTime] = t;
    if (edgePrice) newRect[edgePrice] = p;

    drawingsStore.updateRect(market.instrument, rect.id, newRect);
    // Update selectedRect reference
    const updated = drawingsStore.getFor(market.instrument).find((r) => r.id === rect.id);
    if (updated) selectedRect.value = updated;
    recalcRects();
    positionEditPanel(rect.id);
  };

  const onUp = () => {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  };

  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}



onMounted(async () => {
  await nextTick();
  if (!containerRef.value) return;
  adapter = createChartAdapter(containerRef.value);
  adapter.setTheme(themeStore.theme === "dark");
  if (props.instrument) adapter.setInstrument(props.instrument);
  adapter.setData(props.candles);

  // Debug/testing hook: lets E2E tests read the chart viewport precisely.
  (window as unknown as Record<string, unknown>).__tkChartAdapter = adapter;

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

  // Re-project price-anchored overlays whenever the series data changes:
  // autoScale refits the price scale after load / live ticks / corrections,
  // which shifts every pixel position — without this, rectangles sit at a
  // stale height for a moment after refresh before the next interaction.
  dataCb = () => {
    updateBadgePosition();
    recalcRects();
    extendRecalcFrames(120);
  };
  adapter.subscribeDataChanged(dataCb);

  // Vertical drags & pinch-zoom change the PRICE scale without firing the
  // time-range callback — track pointer/wheel directly for instant reposition.
  const el = containerRef.value;
  const onInteract = () => {
    updateBadgePosition();
    recalcRects();
    extendRecalcFrames(250);
  };
  el.addEventListener("pointermove", onInteract, { passive: true });
  el.addEventListener("pointerdown", onInteract, { passive: true });
  el.addEventListener("wheel", onInteract, { passive: true });
  el.addEventListener("touchmove", onInteract, { passive: true });
  interactionEl = el;
  interactCb = onInteract;

  // While any button is held over the chart (pan drag, price-axis scale
  // drag), re-project overlays EVERY frame so they stay glued to the canvas
  // render instead of trailing it by a frame on coarse timeframes.
  const onPointerDown = () => {
    pointerHeld = true;
    extendRecalcFrames(300);
  };
  const onPointerUp = () => {
    pointerHeld = false;
    extendRecalcFrames(200);
  };
  el.addEventListener("pointerdown", onPointerDown, { passive: true });
  window.addEventListener("pointerup", onPointerUp, { passive: true });
  pointerDownEl = el;
  pointerDownCb = onPointerDown;
  pointerUpCb = onPointerUp;

  // Rectangle drawing: intercept left-presses BEFORE Lightweight Charts sees
  // them (capture phase) so the chart does not pan while the tool is active.
  // In cursor mode this handler does nothing and the chart behaves normally.
  const onChartMouseDown = (e: MouseEvent) => {
    if (drawingsStore.activeTool !== "rectangle" || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (drawingState.value) {
      finalizeDraw(); // second click of click -> move -> click
    } else {
      beginDraw(e);
    }
  };
  el.addEventListener("mousedown", onChartMouseDown as AnyListener, true);
  chartMouseDownEl = el;
  chartMouseDownCb = onChartMouseDown;

  // Right-click ON THE CHART PANE: cancel in-progress drawing, deselect,
  // back to cursor. Scoped to the pane so the browser context menu still
  // works everywhere else in the app.
  const paneEl = (el.closest(".chart-pane") as HTMLElement | null) ?? el;
  const onPaneContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Right-click ON a rectangle → TradingView-style context menu for it
    const target = e.target as HTMLElement | null;
    const rectEl = target?.closest?.(".drawing-hit-rect") as HTMLElement | null;
    const rectId = rectEl?.getAttribute("data-rect-id") ?? null;
    if (rectId) {
      if (drawingsStore.activeTool !== "cursor") drawingsStore.activeTool = "cursor";
      drawingsStore.selectedId = rectId;
      selectedRect.value = drawingsStore.getFor(market.instrument).find((r) => r.id === rectId) ?? null;
      recalcRects();
      positionEditPanel(rectId);
      const paneRect = paneEl.getBoundingClientRect();
      // Keep the menu inside the pane (measured once mounted, fallback below)
      const pos = clampToPane(e.clientX - paneRect.left, e.clientY - paneRect.top, editMenuEl.value);
      rectMenu.value = { id: rectId, x: pos.x, y: pos.y };
      closePalette();
      return;
    }
    rectMenu.value = null;
    closePalette();
    if (drawingsStore.activeTool !== "cursor") drawingsStore.activeTool = "cursor";
    cancelDraw();
    if (drawingsStore.selectedId) {
      drawingsStore.selectedId = null;
      selectedRect.value = null;
      editPanelPos.value = null;
      recalcRects();
    }
  };
  paneEl.addEventListener("contextmenu", onPaneContextMenu as AnyListener);
  paneCtxEl = paneEl;
  paneCtxCb = onPaneContextMenu;

  // Escape aborts an in-progress drawing; Delete removes the selected rectangle
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      cancelDraw();
      rectMenu.value = null;
      closePalette();
    } else if (e.key === "Delete" || e.key === "Backspace") {
      // Never hijack typing inside form fields
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (selectedRect.value) {
        e.preventDefault();
        deleteSelected();
      }
    }
  };
  window.addEventListener("keydown", onKey as AnyListener);
  escCb = onKey;

  // A mouseup released OUTSIDE the browser window never reaches us — without
  // this, the half-drawn preview stays alive and the next chart click
  // finalizes it as a duplicate rectangle.
  const onWindowLost = () => cancelDraw();
  window.addEventListener("blur", onWindowLost);
  window.addEventListener("pointercancel", onWindowLost as AnyListener);
  windowLostCb = onWindowLost;

  // Countdown text + position tick (position also updates on pan/zoom above)
  updateCountdown();
  countdownTimer = setInterval(updateCountdown, 200);

  ro = new ResizeObserver(() => {
    if (!containerRef.value || !adapter) return;
    const { clientWidth, clientHeight } = containerRef.value;
    adapter.resize(clientWidth, clientHeight);
    // Re-project rectangles & the badge onto the NEW coordinate mapping right
    // away — otherwise they keep the old pixel geometry (and appear to slide
    // around) until the next pan/zoom event lands. The rAF guarantees the
    // library has finished its own re-layout before we read coordinates.
    requestAnimationFrame(() => {
      if (!adapter) return;
      updateBadgePosition();
      recalcRects();
      extendRecalcFrames(300);
    });
  });
  ro.observe(containerRef.value);
});

onBeforeUnmount(() => {
  if (visibleCb && adapter) adapter.unsubscribeVisibleRange(visibleCb);
  if (dataCb && adapter) adapter.unsubscribeDataChanged(dataCb);
  if (countdownTimer) clearInterval(countdownTimer);
  if (interactionEl && interactCb) {
    interactionEl.removeEventListener("pointermove", interactCb);
    interactionEl.removeEventListener("pointerdown", interactCb);
    interactionEl.removeEventListener("wheel", interactCb);
    interactionEl.removeEventListener("touchmove", interactCb);
  }
  if (chartMouseDownEl && chartMouseDownCb) {
    chartMouseDownEl.removeEventListener("mousedown", chartMouseDownCb as AnyListener, true);
  }
  if (recalcRaf) cancelAnimationFrame(recalcRaf);
  if (pointerDownEl && pointerDownCb) {
    pointerDownEl.removeEventListener("pointerdown", pointerDownCb);
  }
  if (pointerUpCb) {
    window.removeEventListener("pointerup", pointerUpCb);
  }
  if (paneCtxEl && paneCtxCb) {
    paneCtxEl.removeEventListener("contextmenu", paneCtxCb as AnyListener);
  }
  if (escCb) {
    window.removeEventListener("keydown", escCb as AnyListener);
  }
  if (windowLostCb) {
    window.removeEventListener("blur", windowLostCb);
    window.removeEventListener("pointercancel", windowLostCb as AnyListener);
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
    <!-- Visible drawing layer: z-ordered BEHIND the candle painting, so a
         small rectangle drawn on a low timeframe never covers candle bodies
         on coarser timeframes (TradingView-style). Non-interactive. -->
    <div class="drawing-layer" :class="{ 'drawing-mode': drawingsStore.activeTool === 'rectangle' }">
      <div
        v-for="rect in rectPixels"
        :key="rect.id"
        class="drawing-rect"
        :class="{ preview: rect.id === '__preview', 'border-only': rect.filled === false }"
        :style="{
          left: rect.left + 'px',
          top: rect.top + 'px',
          width: rect.width + 'px',
          height: rect.height + 'px',
          backgroundColor: rect.filled ? rect.color : 'transparent',
          opacity: rect.filled ? rect.opacity : 1,
          borderColor: rect.color,
        }"
      ></div>
    </div>

    <!-- Interaction layer: invisible duplicates of the same geometry sitting
         ABOVE the candles, carrying hit-testing, the selection handles and
         the context-menu target — so a behind-the-candles rectangle stays
         selectable and resizable. -->
    <div class="drawing-hit-layer" :class="{ 'drawing-mode': drawingsStore.activeTool === 'rectangle' }">
      <div
        v-for="rect in hitRects"
        :key="rect.id"
        class="drawing-hit-rect"
        :class="{ selected: rect.selected }"
        :data-rect-id="rect.id === '__preview' ? null : rect.id"
        :style="{
          left: rect.left + 'px',
          top: rect.top + 'px',
          width: rect.width + 'px',
          height: rect.height + 'px',
        }"
        @mousedown.stop="onRectDragStart($event, rect.id)"
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
      ref="editPanelEl"
      class="rect-edit-panel"
      :style="{ left: editPanelPos.x + 'px', top: editPanelPos.y + 'px' }"
      @click.stop
    >
      <div class="edit-colors">
        <button
          v-for="c in drawingsStore.PRESET_COLORS.slice(0, 6)"
          :key="c"
          class="color-swatch"
          :class="{ active: selectedRect.color === c }"
          :style="{ backgroundColor: c }"
          @click="setColorSelected(c)"
        />
        <div class="palette-anchor">
          <button
            class="color-more"
            :class="{ active: paletteOpen === 'panel' }"
            title="More colors"
            @click.stop="togglePalette('panel')"
          >＋</button>
          <div v-if="paletteOpen === 'panel'" class="palette-pop" @click.stop>
            <button
              v-for="c in drawingsStore.PRESET_COLORS"
              :key="c"
              class="color-swatch"
              :class="{ active: selectedRect.color === c }"
              :style="{ backgroundColor: c }"
              @click="setColorSelected(c); paletteOpen = null"
            />
          </div>
        </div>
      </div>
      <span class="panel-divider" />
      <label class="opacity-row" title="Fill opacity">
        <span class="opacity-icon">◻</span>
        <input
          type="range"
          class="opacity-slider"
          min="0"
          max="100"
          :value="Math.round((selectedRect.opacity ?? 0.3) * 100)"
          @input="setOpacitySelected(Number(($event.target as HTMLInputElement).value) / 100)"
        />
        <span class="opacity-value">{{ Math.round((selectedRect.opacity ?? 0.3) * 100) }}%</span>
      </label>
      <span class="panel-divider" />
      <span class="panel-divider" />
      <button
        class="edit-btn"
        :class="{ off: selectedRect.filled === false }"
        :title="selectedRect.filled === false ? 'Show background fill' : 'Border only (no fill)'"
        @click="toggleFillSelected"
      >
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
          <rect
            x="2.25"
            y="3.25"
            width="11.5"
            height="9.5"
            rx="2"
            :fill="selectedRect.filled === false ? 'none' : 'currentColor'"
            :fill-opacity="selectedRect.filled === false ? 0 : 0.32"
            stroke="currentColor"
            stroke-width="1.5"
          />
        </svg>
      </button>
      <button class="edit-btn danger" @click="deleteSelected" title="Delete rectangle">
        <svg
          viewBox="0 0 16 16"
          width="15"
          height="15"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          stroke-width="1.4"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M2.75 4.5h10.5" />
          <path d="M5.75 4.5V3.4c0-.5.4-.9.9-.9h2.7c.5 0 .9.4.9.9v1.1" />
          <path d="M4.4 4.5l.5 7.9c.05.64.57 1.1 1.2 1.1h3.8c.63 0 1.15-.46 1.2-1.1l.5-7.9" />
          <path d="M6.7 7.2v3.9M9.3 7.2v3.9" />
        </svg>
      </button>
    </div>

    <!-- TradingView-style right-click menu on a rectangle -->
    <div
      v-if="rectMenu"
      ref="editMenuEl"
      class="rect-edit-panel rect-context-menu"
      :style="{ left: rectMenu.x + 'px', top: rectMenu.y + 'px' }"
      @click.stop
      @contextmenu.prevent.stop
    >
      <div class="edit-colors">
        <button
          v-for="c in drawingsStore.PRESET_COLORS.slice(0, 6)"
          :key="c"
          class="color-swatch"
          :class="{ active: selectedRect?.id === rectMenu.id && selectedRect.color === c }"
          :style="{ backgroundColor: c }"
          @click="setColorInMenu(c)"
        />
        <div class="palette-anchor">
          <button
            class="color-more"
            :class="{ active: paletteOpen === 'menu' }"
            title="More colors"
            @click.stop="togglePalette('menu')"
          >＋</button>
          <div v-if="paletteOpen === 'menu'" class="palette-pop" @click.stop>
            <button
              v-for="c in drawingsStore.PRESET_COLORS"
              :key="c"
              class="color-swatch"
              :class="{ active: menuRectColor === c }"
              :style="{ backgroundColor: c }"
              @click="setColorInMenu(c); paletteOpen = null"
            />
          </div>
        </div>
      </div>
      <span class="panel-divider" />
      <label class="opacity-row" title="Fill opacity">
        <span class="opacity-icon">◻</span>
        <input
          type="range"
          class="opacity-slider"
          min="0"
          max="100"
          :value="Math.round(menuRectOpacity * 100)"
          @input="setOpacityInMenu(Number(($event.target as HTMLInputElement).value) / 100)"
        />
        <span class="opacity-value">{{ Math.round(menuRectOpacity * 100) }}%</span>
      </label>
      <span class="panel-divider" />
      <span class="panel-divider" />
      <button
        class="edit-btn"
        :class="{ off: !menuRectFilled }"
        :title="menuRectFilled ? 'Border only (no fill)' : 'Show background fill'"
        @click="toggleFillInMenu"
      >
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
          <rect
            x="2.25"
            y="3.25"
            width="11.5"
            height="9.5"
            rx="2"
            :fill="menuRectFilled ? 'currentColor' : 'none'"
            :fill-opacity="menuRectFilled ? 0.32 : 0"
            stroke="currentColor"
            stroke-width="1.5"
          />
        </svg>
      </button>
      <button class="edit-btn danger" @click="deleteFromMenu" title="Delete rectangle">
        <svg
          viewBox="0 0 16 16"
          width="15"
          height="15"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          stroke-width="1.4"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M2.75 4.5h10.5" />
          <path d="M5.75 4.5V3.4c0-.5.4-.9.9-.9h2.7c.5 0 .9.4.9.9v1.1" />
          <path d="M4.4 4.5l.5 7.9c.05.64.57 1.1 1.2 1.1h3.8c.63 0 1.15-.46 1.2-1.1l.5-7.9" />
          <path d="M6.7 7.2v3.9M9.3 7.2v3.9" />
        </svg>
      </button>
    </div>

    <div
      ref="containerRef"
      class="chart-container"
      :class="{ 'rect-mode': drawingsStore.activeTool === 'rectangle' }"
      @click="onChartClick"
    />
  </div>
</template>

<style scoped>
.chart-pane {
  position: relative;
  flex: 1;
  min-height: 0;
  /* Gradient painted in CSS (not by the charting canvas) so the drawing
     layer can sit between this background and the candle canvas */
  background: var(--chart-bg-gradient);
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
  z-index: 6; /* above rectangles so drawings never cover the symbol label */
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
  z-index: 5; /* above the drawing layer (3) */
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
  z-index: 5; /* above the drawing layer (3) so rects never cover the countdown */
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
/* Two stacked layers over the chart:
 *   .drawing-layer     — visible rectangles, z-ordered BEHIND the candle
 *                        painting (LWC's series canvas sits at z-index 1,
 *                        crosshair at 2), so a small rectangle drawn on a
 *                        low timeframe hides behind candle bodies on
 *                        coarser ones instead of covering them.
 *   .drawing-hit-layer — invisible duplicates ABOVE the candles carrying
 *                        all hit-testing (select / drag / resize handles).
 * The whole visible layer is pointer-transparent; only the hit rects
 * capture the pointer. */
.drawing-layer {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
}
.drawing-hit-layer {
  position: absolute;
  inset: 0;
  z-index: 3;
  pointer-events: none;
}
/* While the rectangle tool is active, existing rectangles must not swallow
   the press, and the live preview is never interactive. */
.drawing-hit-layer.drawing-mode .drawing-hit-rect {
  pointer-events: none;
}
.chart-container.rect-mode,
.chart-container.rect-mode * {
  cursor: crosshair;
}
.drawing-rect {
  position: absolute;
  border: 1.5px solid;
  border-radius: 2px;
  pointer-events: none;
  transition: box-shadow 150ms;
}
.drawing-hit-rect {
  position: absolute;
  pointer-events: auto;
  cursor: pointer;
}
.drawing-hit-rect.selected {
  cursor: move;
  outline: 1px dashed rgba(41, 98, 255, 0.7);
  outline-offset: 2px;
}
.drawing-rect:hover {
  box-shadow: 0 0 0 1px rgba(41, 98, 255, 0.4);
}
.drawing-rect.selected {
  border-width: 2px;
  box-shadow: 0 0 0 2px rgba(41, 98, 255, 0.5);
}
/* Border-only mode: ~1.5× border thickness. 2.25px would be snapped to 2px
   by the browser, so 2.5px is used to keep the step visible (3px selected). */
.drawing-rect.border-only {
  border-width: 2.5px;
}
.drawing-rect.border-only.selected {
  border-width: 3px;
  box-shadow: 0 0 0 1px rgba(41, 98, 255, 0.5);
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
/* Invisible halo that doubles the grab area of each handle so aiming is easy */
.resize-handle::before {
  content: "";
  position: absolute;
  inset: -5px;
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
/* Icon buttons (fill toggle / delete) and group separators */
.panel-divider {
  width: 1px;
  height: 18px;
  background: var(--border);
  flex-shrink: 0;
}
.edit-btn {
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 1px solid var(--border);
  background: var(--btn-bg);
  color: var(--text);
  border-radius: 7px;
  cursor: pointer;
  flex-shrink: 0;
  transition:
    color 140ms,
    background 140ms,
    border-color 140ms,
    transform 140ms;
}
.edit-btn:hover {
  color: var(--accent);
  border-color: var(--accent);
  background: rgba(41, 98, 255, 0.1);
  transform: translateY(-1px);
}
.edit-btn:active {
  transform: translateY(0);
}
/* Border-only state: dashed outline echoes the rect's border-only look */
.edit-btn.off {
  color: var(--text-muted);
  border-style: dashed;
}
.edit-btn.off:hover {
  color: var(--accent);
  border-style: solid;
}
.edit-btn.danger:hover {
  color: #ef5350;
  border-color: rgba(239, 83, 80, 0.55);
  background: rgba(239, 83, 80, 0.1);
}
.rect-context-menu {
  z-index: 30; /* above the edit panel (20) and rectangles (2) */
}
/* "More colors" chip + toggleable palette popup */
.palette-anchor {
  position: relative;
  display: inline-flex;
}
.color-more {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  cursor: pointer;
  border: 1px dashed var(--border);
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1;
  display: grid;
  place-items: center;
  padding: 0;
  transition: all 120ms;
}
.color-more:hover,
.color-more.active {
  border-color: var(--accent);
  color: var(--accent);
}
.palette-pop {
  position: absolute;
  top: 24px;
  left: 0;
  z-index: 40;
  display: grid;
  grid-template-columns: repeat(4, 18px);
  gap: 5px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.25);
}
/* Opacity slider row */
.opacity-row {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: default;
}
.opacity-icon {
  font-size: 10px;
  color: var(--text-muted);
}
.opacity-slider {
  width: 64px;
  height: 3px;
  accent-color: var(--accent);
  cursor: pointer;
}
.opacity-value {
  font-size: 10px;
  color: var(--text-muted);
  min-width: 26px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
</style>
