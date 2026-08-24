<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from "vue";
import { createChartAdapter, type ChartAdapter } from "@/chart/chartAdapter";
import { useThemeStore } from "@/stores/theme";
import { useMarketStore } from "@/stores/market";
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
      adapter.updateCandle(nextLast);
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

let visibleCb: ((range: { from: number; to: number } | null) => void) | null = null;
let lazyThrottled = false;
let interactionEl: HTMLElement | null = null;
let interactCb: (() => void) | null = null;
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

watch(
  () => market.timeframe,
  () => {
    updateCountdown();
  }
);

onMounted(async () => {
  await nextTick();
  if (!containerRef.value) return;
  adapter = createChartAdapter(containerRef.value);
  adapter.setTheme(themeStore.theme === "dark");
  if (props.instrument) adapter.setInstrument(props.instrument);
  adapter.setData(props.candles);

  visibleCb = (range) => {
    // Track the price marker on every pan/zoom so the badge stays glued to it
    updateBadgePosition();
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
  const onInteract = () => updateBadgePosition();
  el.addEventListener("pointermove", onInteract, { passive: true });
  el.addEventListener("pointerdown", onInteract, { passive: true });
  el.addEventListener("wheel", onInteract, { passive: true });
  el.addEventListener("touchmove", onInteract, { passive: true });
  interactionEl = el;
  interactCb = onInteract;

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
</style>
