<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, nextTick, computed } from "vue";
import { createChartAdapter, type ChartAdapter } from "@/chart/chartAdapter";
import { useThemeStore } from "@/stores/theme";
import { useMarketStore } from "@/stores/market";
import { useDrawingsStore, type DrawingRect, type DrawingTrend, type DrawingPoly, type DrawingPosition, type DrawingHLine, type DrawingHRay, type DrawingVLine, type SingleKind, type SingleDrawing, type DashStyle } from "@/stores/drawings";
import { useReplayStore } from "@/stores/replay";
import { useDemoStore, demoValuePerPrice, type DemoSide, type DemoStatus, type DemoKind } from "@/stores/demo";
import DemoPanel from "./DemoPanel.vue";
import type { Candle } from "@traderkomak/shared";
import { currencyFlagUrl, commodityIcon, symbolParts } from "@/utils/flags";
import { TIMEFRAME_SECONDS, instrumentPrecision, instrumentPipSize, providerOf, binanceBucketStart, oandaDailyBucketStart, oandaH4BucketStart, oandaWeeklyBucketStart, oandaMonthlyBucketStart } from "@traderkomak/shared";

const props = defineProps<{
  candles: Candle[];
  isLoading: boolean;
  error: string | null;
  instrument?: string;
}>();

const market = useMarketStore();
const drawingsStore = useDrawingsStore();
const replay = useReplayStore();
const demo = useDemoStore();

/** Price display precision of the active instrument (template + tags). */
const prec = computed(() => instrumentPrecision(market.instrument));

/* ── Demo trading: chart lines for pending/open positions ───────────── */
interface DemoLinePx {
  id: string;
  level: "entry" | "sl" | "tp";
  y: number;
  /** the line's price — shown on the price-scale tag */
  price: number;
  color: string;
  dashed: boolean;
  direction: DemoSide;
  status: DemoStatus;
  lot: number;
  /** $ values for the line labels */
  money: number;
  rr: number | null;
}
const demoLines = ref<DemoLinePx[]>([]);
let demoLineDrag: { id: string; level: "entry" | "sl" | "tp" } | null = null;
const demoTab = ref<"positions" | "history" | "stats">("positions");
const demoPeriod = ref<"day" | "week" | "month" | "all">("week");
/** Height of the demo bottom panel (measured) — the replay panel floats
 *  just above it while both are active. */
const demoBottomH = ref(96);
/** Visible chart height (excludes time axis) — hides demo tags for levels
 *  that scrolled out of the chart instead of drawing them over the panel. */
const demoChartH = ref(0);
const demoMini = ref(false);

function demoLevelY(price: number): number | null {
  return adapter ? adapter.getPriceY(price) : null;
}

function rebuildDemoLines(): void {
  const out: DemoLinePx[] = [];
  if (!demo.active) { demoLines.value = out; return; }
  const prec = instrumentPrecision(market.instrument);
  const vppOf = (p: { symbol: string; entry: number }) => demoValuePerPrice(p.symbol, p.entry);
  for (const p of demo.openPositions) {
    if (p.symbol !== market.instrument) continue;
    const vpp = vppOf(p);
    const risk = p.sl !== null ? Math.abs(p.entry - p.sl) * p.lot * vpp : 0;
    const reward = p.tp !== null ? Math.abs(p.tp - p.entry) * p.lot * vpp : 0;
    const rr = risk > 0 ? +(reward / risk).toFixed(2) : null;
    // blue entry line at the filled price (market and filled limits alike)
    {
      const y = demoLevelY(p.entry);
      if (y !== null) out.push({ id: p.id, level: "entry", y, price: p.entry, color: "#2962ff", dashed: false, direction: p.direction, status: "open", lot: p.lot, money: 0, rr: null });
    }
    if (p.sl !== null) {
      const y = demoLevelY(p.sl);
      if (y !== null) out.push({ id: p.id, level: "sl", y, price: p.sl, color: "#ef5350", dashed: false, direction: p.direction, status: "open", lot: p.lot, money: +risk.toFixed(2), rr: null });
    }
    if (p.tp !== null) {
      const y = demoLevelY(p.tp);
      if (y !== null) out.push({ id: p.id, level: "tp", y, price: p.tp, color: "#26a69a", dashed: false, direction: p.direction, status: "open", lot: p.lot, money: +reward.toFixed(2), rr });
    }
  }
  // Pending limit orders: all three lines (entry dashed), like the draft
  for (const p of demo.positions) {
    if (p.symbol !== market.instrument || p.status !== "pending") continue;
    const vpp = vppOf(p);
    const risk = p.sl !== null ? Math.abs(p.entry - p.sl) * p.lot * vpp : 0;
    const reward = p.tp !== null ? Math.abs(p.tp - p.entry) * p.lot * vpp : 0;
    const rr = risk > 0 && p.tp !== null ? +((Math.abs(p.tp - p.entry) * p.lot * vpp) / risk).toFixed(2) : null;
    const yEntry = demoLevelY(p.entry);
    if (yEntry !== null) out.push({ id: p.id, level: "entry", y: yEntry, price: p.entry, color: "#2962ff", dashed: true, direction: p.direction, status: "pending", lot: p.lot, money: 0, rr: null });
    if (p.sl !== null) {
      const y = demoLevelY(p.sl);
      if (y !== null) out.push({ id: p.id, level: "sl", y, price: p.sl, color: "#ef5350", dashed: false, direction: p.direction, status: "pending", lot: p.lot, money: +risk.toFixed(2), rr: null });
    }
    if (p.tp !== null) {
      const y = demoLevelY(p.tp);
      if (y !== null) out.push({ id: p.id, level: "tp", y, price: p.tp, color: "#26a69a", dashed: false, direction: p.direction, status: "pending", lot: p.lot, money: +reward.toFixed(2), rr });
    }
  }
  // Draft order lines (armed but not yet Set) — market: SL/TP only (entry
  // is the pinned current price and gets its line after Set fills);
  // limit: all three lines, entry dashed and draggable.
  if (draft.value) {
    const d = draft.value;
    const distSl = Math.abs(d.entry - d.sl);
    const distTp = Math.abs(d.tp - d.entry);
    const vpp = demoValuePerPrice(market.instrument, d.entry);
    const risk =
      demo.sizeMode === "lot"
        ? distSl * demo.lot * vpp
        : demo.sizeMode === "percent"
          ? (demo.balance * demo.riskPct) / 100
          : demo.riskUsd;
    const lotEff =
      demo.sizeMode === "lot"
        ? demo.lot
        : distSl > 0 ? Math.min(100, Math.max(0.01, +(risk / (distSl * vpp)).toFixed(2))) : demo.lot;
    const reward = distTp * lotEff * vpp;
    const rr = distSl > 0 ? +(distTp / distSl).toFixed(2) : null;
    const ySl = demoLevelY(d.sl);
    const yTp = demoLevelY(d.tp);
    if (d.kind === "limit") {
      const yEntry = demoLevelY(d.entry);
      if (yEntry !== null) out.push({ id: "__draft", level: "entry", y: yEntry, price: d.entry, color: "#2962ff", dashed: true, direction: d.side, status: "pending", lot: lotEff, money: 0, rr: null });
    }
    if (ySl !== null) out.push({ id: "__draft", level: "sl", y: ySl, price: d.sl, color: "#ef5350", dashed: false, direction: d.side, status: "pending", lot: lotEff, money: +risk.toFixed(2), rr: null });
    if (yTp !== null) out.push({ id: "__draft", level: "tp", y: yTp, price: d.tp, color: "#26a69a", dashed: false, direction: d.side, status: "pending", lot: lotEff, money: +reward.toFixed(2), rr });
  }
  demoLines.value = out;
}

function onDemoLineDragStart(e: MouseEvent, id: string, level: "entry" | "sl" | "tp"): void {
  if (e.button !== 0 || !adapter || !containerRef.value) return;
  // The entry of an OPEN position is filled — it must not move. Only
  // pending (limit) orders and the draft keep a draggable entry.
  if (id !== "__draft" && level === "entry") {
    const pos = demo.positions.find((x) => x.id === id);
    if (pos && pos.status === "open") return;
  }
  e.preventDefault();
  e.stopPropagation();
  demoLineDrag = { id, level };
  const move = (ev: MouseEvent) => {
    if (!demoLineDrag || !adapter || !containerRef.value) return;
    const r = containerRef.value.getBoundingClientRect();
    // Clamp the cursor to the chart area: yToPrice extrapolates wildly
    // outside it, so a fast drag into the demo panel / axes would set
    // SL/TP to absurd prices (e.g. -999999).
    const cy = Math.min(Math.max(ev.clientY, r.top + 2), r.bottom - 2);
    const p = adapter.yToPrice(cy - r.top);
    if (p === null || !Number.isFinite(p) || p <= 0) return;
    // Draft lines adjust the in-progress order (entry shifts the whole
    // structure; SL/TP clamp to the loss/profit sides); real positions
    // update through the store.
    if (id === "__draft" && draft.value) {
      const d = draft.value;
      const long = d.side === "long";
      if (level === "entry") {
        // entry moves on its own — clamped between SL and TP, never
        // dragging the other lines with it
        d.entry = long
          ? Math.min(Math.max(p, d.sl), d.tp)
          : Math.min(Math.max(p, d.tp), d.sl);
      } else if (level === "sl") {
        d.sl = long ? Math.min(p, d.entry) : Math.max(p, d.entry);
      } else {
        d.tp = long ? Math.max(p, d.entry) : Math.min(p, d.entry);
      }
    } else {
      demo.updateLevel(id, level, p);
    }
    recalcRects();
  };
  const up = () => {
    demoLineDrag = null;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

/** Draft order: lines draw on the chart (entry/SL/TP), adjustable by
 *  dragging, until Set places it or Cancel discards it. */
const draft = ref<null | {
  side: DemoSide;
  kind: DemoKind;
  entry: number;
  sl: number;
  tp: number;
}>(null);

function armDemo(side: DemoSide, kind: DemoKind): void {
  // Market closed (live): the order buttons do nothing — replay is allowed
  if (!replay.active && demo.isClosed()) return;
  const c = market.candles;
  if (!c.length) return;
  // Market: entry is the current price — in replay mode that is the last
  // VISIBLE (boundary) candle's close, not the live price
  const last =
    replay.active && replay.cutoff !== null
      ? c.filter((x) => x.time <= replay.cutoff!).slice(-1)[0]!.close
      : c[c.length - 1]!.close;
  const long = side === "long";
  const dir = long ? 1 : -1;
  // default SL/TP distances scale with the timeframe via the average
  // candle range (ATR-14): tight on 1m, wide on D/W
  const visible =
    replay.active && replay.cutoff !== null ? c.filter((x) => x.time <= replay.cutoff!) : c;
  const win = visible.slice(-14);
  const atr =
    win.length > 1
      ? win.reduce((s, x) => s + (x.high - x.low), 0) / win.length
      : 0;
  const slDist = atr > 0 ? atr * 1.5 : last * 0.005;
  // limit: entry 1 ATR away (draggable)
  const entry = kind === "limit" ? last - dir * slDist : last;
  draft.value = {
    side,
    kind,
    entry,
    sl: entry - dir * slDist,
    tp: entry + dir * slDist * 2,
  };
  demo.error = null;
  recalcRects();
}

function setDemoDraft(): void {
  const d = draft.value;
  if (!d) return;
  // Live market closed → block (replay trades against the cut data are fine)
  if (!replay.active && isForexClosed()) {
    demo.error = "Market closed — use Replay to place trades";
    return;
  }
  demo.placeOrder(market.instrument, d.side, d.kind, d.entry, d.sl, d.tp);
  draft.value = null;
}

function cancelDemoDraft(): void {
  draft.value = null;
}

const demoSummary = computed(() => demo.summaryFor(demoPeriod.value));
const pendingOrders = computed(() => demo.positions.filter((p) => p.status === "pending"));
const marketClosedNote = computed(() => !replay.active && isForexClosed());
function pnlClass(v: number | undefined): string {
  return (v ?? 0) >= 0 ? "pos" : "neg";
}
function fmtMoney(v: number): string {
  return (v >= 0 ? "$" : "-$") + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const themeStore = useThemeStore();
const containerRef = ref<HTMLElement | null>(null);
let adapter: ChartAdapter | null = null;
let ro: ResizeObserver | null = null;

/** Candles the chart actually shows: in replay mode everything after the
 *  replay boundary is hidden. The full series stays untouched in the store,
 *  so lazy-loading keeps working and exit restores the chart instantly. */
const displayCandles = computed(() =>
  replay.active && replay.cutoff !== null
    ? props.candles.filter((c) => c.time <= replay.cutoff!)
    : props.candles
);

/* ── Replay playback engine ─────────────────────────────────────────── */
const pickTime = ref<number | null>(null);
const replayVlX = ref<number | null>(null);
const replayTag = ref<{ y: number; text: string } | null>(null);
let replayTimer: ReturnType<typeof setInterval> | null = null;
let holdTimer: ReturnType<typeof setInterval> | null = null;
let holdTimeout: ReturnType<typeof setTimeout> | null = null;
let pickingMove: ((ev: MouseEvent) => void) | null = null;

/** Advance the replay boundary to the next / previous candle. */
function replayStep(dir: 1 | -1): void {
  const arr = props.candles;
  if (!arr.length || replay.cutoff === null) return;
  if (dir === 1) {
    const next = arr.find((c) => c.time > replay.cutoff!);
    if (!next) {
      replay.playing = false; // reached the newest candle
      return;
    }
    // Never step across a data discontinuity: after a TF/symbol switch in
    // replay the loaded history ENDS at the boundary — the next candle in
    // the full array is a live-stream candle from after the fetch window,
    // and revealing it would draw one huge candle across the gap.
    if (replay.dataEnd !== null && next.time > replay.dataEnd) {
      replay.playing = false;
      return;
    }
    replay.stepTo(next.time);
  } else {
    let prev = null as null | (typeof arr)[number];
    for (const c of arr) {
      if (c.time < replay.cutoff!) prev = c;
      else break;
    }
    if (prev) replay.stepTo(prev.time);
  }
}

function togglePlay(): void {
  if (replay.picking) {
    if (pickTime.value !== null) replay.startAt(pickTime.value);
    replay.playing = true;
    return;
  }
  replay.playing = !replay.playing;
}

/** Hold-to-repeat stepping (forward / backward buttons): one step on press,
 *  then the repeat starts after a short hold at the SELECTED speed
 *  (1x = 1 candle/sec … 10x = 10 candles/sec). */
function holdStep(dir: 1 | -1): void {
  stopHold();
  replayStep(dir);
  holdTimeout = setTimeout(() => {
    holdTimer = setInterval(() => replayStep(dir), 1000 / replay.speed);
  }, 350);
}
function stopHold(): void {
  if (holdTimeout) {
    clearTimeout(holdTimeout);
    holdTimeout = null;
  }
  if (holdTimer) {
    clearInterval(holdTimer);
    holdTimer = null;
  }
}

/** While picking, the replay line follows the mouse across the chart. */
/** Mouse x → time via the VISIBLE LOGICAL RANGE (deterministic — immune to
 *  the bar-grid calibration glitches that could produce times far outside
 *  the data during layout transitions). */
function replayTimeAt(clientX: number): number | null {
  if (!adapter || !containerRef.value || !displayCandles.value.length) return null;
  const r = containerRef.value.getBoundingClientRect();
  const lr = adapter.getLogicalRange();
  if (!lr || lr.to <= lr.from) return null;
  const chartW = containerRef.value.clientWidth - axisRightW.value;
  const frac = Math.min(Math.max((clientX - r.left) / chartW, 0), 1);
  const idx = Math.round(lr.from + frac * (lr.to - lr.from));
  const clamped = Math.min(Math.max(idx, 0), displayCandles.value.length - 1);
  return displayCandles.value[clamped]!.time;
}

function onPickingMove(ev: MouseEvent): void {
  const t = replayTimeAt(ev.clientX);
  if (t === null) return;
  pickTime.value = t;
  recalcRects();
}

function stopPickingListeners(): void {
  if (pickingMove) {
    // CAPTURE phase on the pane root (common ancestor of the LWC container
    // AND the drawing/demo hit layers): LWC's canvas stops propagation on
    // mouse moves and the hit layers are siblings of the chart container,
    // so a listener on the container itself would freeze while the cursor
    // is over any drawing — capture on the ancestor always fires.
    const root = (document.querySelector(".chart-pane") ?? containerRef.value) as HTMLElement;
    root.removeEventListener("mousemove", pickingMove, { capture: true });
  }
  pickingMove = null;
}

watch(
  () => replay.picking,
  (picking) => {
    stopPickingListeners();
    if (picking && containerRef.value && displayCandles.value.length) {
      // Start the line at ~60% of the visible chart
      const w = containerRef.value.clientWidth - axisRightW.value;
      const lr = adapter?.getLogicalRange();
      let idx: number;
      if (lr && lr.to > lr.from) {
        idx = Math.round(lr.from + 0.6 * (lr.to - lr.from));
      } else {
        idx = displayCandles.value.length - 1;
      }
      idx = Math.min(Math.max(idx, 0), displayCandles.value.length - 1);
      pickTime.value = displayCandles.value[idx]!.time;
      pickingMove = onPickingMove;
      const pickRoot = (document.querySelector(".chart-pane") ?? containerRef.value) as HTMLElement;
      pickRoot.addEventListener("mousemove", pickingMove, { capture: true });
      recalcRects();
    }
  }
);

watch(
  () => [replay.playing, replay.speed, replay.active, replay.picking] as const,
  () => {
    if (replayTimer) {
      clearInterval(replayTimer);
      replayTimer = null;
    }
    if (replay.active && replay.playing && !replay.picking) {
      replayTimer = setInterval(() => replayStep(1), 1000 / replay.speed);
    }
  }
);

/** Keep the replay candle at the right edge with free space: on cut, while
 *  playing, and on exit. Double nextTick defers past the displayCandles
 *  watcher's setData so the viewport survives it. */
function focusReplayEdge(): void {
  nextTick(() => nextTick(() => adapter?.focusLast()));
}
watch(
  () => replay.cutoff,
  (cutoff, prev) => {
    // While replaying forward, the chart stays still as candles fill the
    // free space; it only follows once the newest candle reaches the right
    // edge — panning by the current view WIDTH (no dependence on the
    // adapter's capped data length).
    if (!replay.active || cutoff === null || prev === null) return;
    // Demo positions track the price AT the replay boundary. Forward steps
    // process the whole revealed candle — its WICK can fill pending limits
    // and hit TP/SL, not just the close.
    const lastShown = displayCandles.value[displayCandles.value.length - 1];
    if (lastShown && cutoff > prev) demo.processReplayCandle(lastShown, market.instrument);
    else if (lastShown) demo.processReplayPrice(lastShown.close, market.instrument);
    // Stepping backward past a trade's entry deletes the whole trade
    if (cutoff < prev) demo.deleteBeyond(cutoff, market.instrument);
    if (cutoff <= prev) return;
    const idx = displayCandles.value.length - 1;
    const r = adapter?.getLogicalRange();
    const ad = adapter;
    if (!r || !ad) return;
    if (idx > r.to - 3) {
      const width = r.to - r.from;
      ad.setLogicalRange({ from: idx - width + 15, to: idx + 15 });
    }
  }
);
watch(
  () => replay.active,
  (active) => {
    // Freeze the price scale and hide the series' live-price label while
    // replaying — the replay price tag takes its place on the scale. This
    // is what keeps backward/play from moving the chart.
    adapter?.setPriceAutoScale(!active);
    adapter?.setLastValueVisible(!active);
    if (!active) focusReplayEdge(); // smooth return to the live edge on exit
  }
);
watch(
  () => market.timeframe,
  () => {
    // A timeframe switch re-enables autoScale (fresh-mount branch of
    // setData) — re-freeze it while replay is still active, and pin the
    // replay edge back to the right with free space.
    if (replay.active) {
      adapter?.setPriceAutoScale(false);
      if (replay.cutoff !== null) focusReplayEdge();
    }
  }
);

function flagFor(currency: string): { type: "flag" | "icon"; value: string } {
  const flag = currencyFlagUrl(currency);
  if (flag) return { type: "flag", value: flag };
  const icon = commodityIcon(currency);
  if (icon) return { type: "icon", value: icon };
  return { type: "icon", value: "◈" };
}

watch(
  displayCandles,
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
    // Removing candle(s) from the END (replay backward step): restore the
    // exact pre-shrink visible range so the chart stays perfectly still
    // (LWC would otherwise re-anchor the right edge and shift the view).
    const preShrinkRange = adapter.getLogicalRange();
    const prevLast = prev[prev.length - 1];
    const nextLast = next[next.length - 1];
    if (!nextLast || !prevLast) {
      adapter.setData(next);
      restoreRange(preShrinkRange, prev.length - next.length);
      return;
    }
    // Single new candle appended at end (live) — update without refit
    if (next.length === prev.length + 1 && next[next.length - 2]!.time === prevLast.time && nextLast.time > prevLast.time) {
      adapter.updateCandle(nextLast);
      return;
    }
    if (next.length !== prev.length) {
      adapter.setData(next);
      if (next.length < prev.length && preShrinkRange) {
        restoreRange(preShrinkRange, prev.length - next.length);
      }
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
    linePaletteOpen.value = false;
    polyPaletteOpen.value = false;
    // Switching away from a drawing tool aborts any in-progress drawing
    cancelDraw();
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
/** While inside this window, recalcFrame keeps polling until all stored
 *  drawings have projected (chart layout after load may lag a few frames). */
let loadSettleDeadline = 0;
let pointerHeld = false;
let pointerDownEl: HTMLElement | null = null;
let pointerDownCb: (() => void) | null = null;
let pointerUpCb: (() => void) | null = null;
let chartMouseDownEl: HTMLElement | null = null;
let chartMouseDownCb: ((e: MouseEvent) => void) | null = null;
let tapDownEl: HTMLElement | null = null;
let tapDownCb: ((e: MouseEvent) => void) | null = null;
let tapUpCb: ((e: MouseEvent) => void) | null = null;
let chartDblClickEl: HTMLElement | null = null;
let chartDblClickCb: ((e: MouseEvent) => void) | null = null;
let paneCtxEl: HTMLElement | null = null;
let paneCtxCb: ((e: MouseEvent) => void) | null = null;
let escCb: ((e: KeyboardEvent) => void) | null = null;
let magnetKeyCb: ((e: KeyboardEvent) => void) | null = null;
let magnetBlurCb: (() => void) | null = null;
let magnetAnyMoveCb: ((e: PointerEvent) => void) | null = null;
let xhairMoveEl: HTMLElement | null = null;
let xhairMoveCb: ((e: MouseEvent) => void) | null = null;
let xhairLeaveCb: (() => void) | null = null;
let crosshairModeStop: (() => void) | null = null;
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
 * Market-hours gate (DST-aware, per instrument) — shared with the demo
 * store so the countdown, order buttons and notes all agree. Forex runs
 * Sunday 5pm NY → Friday 5pm NY; metals additionally break 5–6pm NY daily.
 */
function isForexClosed(): boolean {
  return demo.isClosed(market.instrument);
}

/**
 * Positions the timer label flush under LWC's native live-price label:
 * same size, same blue background — they read as one stacked unit.
 */

/** Restore the visible range after candles were removed from the end.
 *  LWC re-anchors the window by right-offset (shifting it ~1 bar per
 *  removed candle) and normalizes set ranges, so measure the actual drift
 *  and correct it. */
function restoreRange(pre: { from: number; to: number } | null, removed: number): void {
  const ad = adapter;
  if (!pre || !ad) return;
  const apply = (from: number, to: number) => ad.setLogicalRange({ from, to });
  const drifted = ad.getLogicalRange();
  if (!drifted) return;
  const dFrom = pre.from - drifted.from;
  const dTo = pre.to - drifted.to;
  if (Math.abs(dFrom) < 0.1 && Math.abs(dTo) < 0.1) return;
  apply(drifted.from + dFrom, drifted.to + dTo);
  // LWC may re-normalize once — verify and correct again if needed
  const check = ad.getLogicalRange();
  if (check && (Math.abs(pre.from - check.from) > 0.1 || Math.abs(pre.to - check.to) > 0.1)) {
    apply(check.from + (pre.from - check.from), check.to + (pre.to - check.to));
  }
}

function updateBadgePosition(): void {
  // During replay the real-time price is in the hidden future — hide the tag
  if (replay.active) {
    tagVisible.value = false;
    return;
  }
  const last = displayCandles.value[displayCandles.value.length - 1];
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
  // Track the demo bottom panel height (the replay panel floats above it)
  const db = document.querySelector(".demo-bottom");
  if (db) demoBottomH.value = db.getBoundingClientRect().height;

  // Real-time countdown makes no sense while replaying the past
  if (replay.active) {
    countdown.value = "";
    return;
  }

  if (marketClosed.value) {
    countdown.value = "CLOSED";
    return;
  }
  const tf = market.timeframe;
  const sec = TIMEFRAME_SECONDS[tf as keyof typeof TIMEFRAME_SECONDS] ?? 5;
  const now = Date.now();
  const DAY = 86400000;
  // Next boundary on the candle grid the PROVIDER actually uses. OANDA
  // aligns the large timeframes to 5pm-New-York sessions; Binance is
  // UTC-aligned (Monday weeks, calendar months). Using the wrong convention
  // counts down to a moment where no candle ever opens (e.g. a Binance 4h
  // showing 1:37 instead of 0:37 — exactly one hour of NY-offset drift).
  const isBinance = providerOf(market.instrument) === "binance";
  let next: number;
  if (isBinance) {
    if (sec === 2592000) {
      // Next calendar month, 00:00 UTC
      const d = new Date(now);
      next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    } else if (sec === 604800) {
      // Current week's Monday 00:00 UTC + 7d = the next Monday
      next = binanceBucketStart(now, sec) + sec * 1000;
    } else {
      // 4h / 1d / minute / second TFs: plain UTC multiples
      next = Math.floor(now / (sec * 1000)) * sec * 1000 + sec * 1000;
    }
  }
  else if (sec === 14400) next = oandaH4BucketStart(now + 4 * 3600000);
  else if (sec === 86400) {
    // session start of a later moment — step further while it lands back
    // in the CURRENT session (e.g. right after a candle opens)
    next = oandaDailyBucketStart(now + 12 * 3600000);
    if (next <= now) next = oandaDailyBucketStart(now + 36 * 3600000);
  }
  else if (sec === 604800) next = oandaWeeklyBucketStart(oandaWeeklyBucketStart(now) + 7 * DAY + 1000);
  else if (sec === 2592000) next = oandaMonthlyBucketStart(oandaMonthlyBucketStart(now) + 32 * DAY);
  else next = Math.floor(now / (sec * 1000)) * sec * 1000 + sec * 1000;
  const rem = Math.max(0, next - now);

  const pad2 = (n: number) => String(n).padStart(2, "0");

  if (sec >= 604800) {
    // Weekly / monthly candles → Dd HH:MM:SS
    const total = Math.floor(rem / 1000);
    const dd = Math.floor(total / 86400);
    const hh = Math.floor((total % 86400) / 3600);
    const mm = Math.floor((total % 3600) / 60);
    const ss = total % 60;
    countdown.value = `${dd}d ${pad2(hh)}:${pad2(mm)}:${pad2(ss)}`;
  } else if (sec >= 14400) {
    // 4h / daily candles → HH:MM:SS
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

/* ── Trendline drawing (mirrors rectangle logic) ────────────────────── */

interface TrendPixel {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width: number;
  dash: DashStyle;
  selected: boolean;
}
/** SVG stroke-dasharray per dash style ("solid" renders un-dashed). */
const DASH_ARRAY: Record<DashStyle, string> = { solid: "", dashed: "9 6", dotted: "2 6" };
const DASH_STYLES: DashStyle[] = ["solid", "dashed", "dotted"];

const trendPixels = ref<TrendPixel[]>([]);
/** trendPixels minus the live preview — the interaction layer hit-tests only
 *  real (stored) trendlines. */
const hitTrends = computed(() => trendPixels.value.filter((t) => t.id !== "__preview"));
const selectedLine = ref<DrawingTrend | null>(null);
const linePanelPos = ref<{ x: number; y: number } | null>(null);
const linePanelEl = ref<HTMLElement | null>(null);
const linePaletteOpen = ref(false);
const drawingToolActive = computed(() => drawingsStore.activeTool !== "cursor");

/* ── Magnet mode ──────────────────────────────────────────────────────
   Latched by the toolbar magnet button; holding Ctrl temporarily forces
   snapping (TradingView-style modifier hold). The store owns the effective
   state so the toolbar highlight and the snapping crosshair stay in sync. */
const magnetActive = computed(() => drawingsStore.magnetActive);
/** Snapping crosshair: when a drawing tool + magnet are active the native
 *  crosshair hides and this one draws stuck to the snapped candle level. */
const snapXhair = ref<{ x: number; y: number; priceText: string; timeText: string } | null>(null);

// When the magnet turns ON mid-drawing (e.g. Ctrl pressed while the cursor
// is stationary), re-snap every in-progress anchor immediately — otherwise
// the crosshair sticks but the half-drawn shape stays at its raw position
// until the next mouse move. When it turns OFF, the pre-snap positions are
// restored and the raw cursor position is replayed through the active move
// handlers, so the shape returns to the cursor exactly.
let lastPtrClient: { clientX: number; clientY: number } | null = null;
let preSnap: {
  drawingObj: object | null;
  drawing: { time1: number; price1: number; time2: number; price2: number } | null;
  polyObj: object | null;
  polyCursor: { time: number; price: number } | null;
  posObj: object | null;
  pos: { time1: number; entry: number } | null;
} | null = null;
watch(magnetActive, (on) => {
  if (on) {
    preSnap = null;
    if (!adapter) return;
    if (drawingState.value) {
      const d = drawingState.value;
      preSnap = { drawingObj: d, drawing: { ...d }, polyObj: null, polyCursor: null, posObj: null, pos: null };
      // Mutate in place — the OFF branch restores via object identity
      const s1 = snapToCandle(d.time1, d.price1, true);
      const s2 = snapToCandle(d.time2, d.price2, true);
      d.time1 = s1.time;
      d.price1 = s1.price;
      d.time2 = s2.time;
      d.price2 = s2.price;
    } else if (polyState.value) {
      preSnap = { drawingObj: null, drawing: null, polyObj: polyState.value, polyCursor: polyState.value.cursor ? { ...polyState.value.cursor } : null, posObj: null, pos: null };
      // Placed vertices stay as clicked; the moving cursor snaps.
      const cur = polyState.value.cursor;
      if (cur) {
        const s = snapToCandle(cur.time, cur.price, true);
        polyState.value.cursor = { time: s.time, price: s.price };
      }
    } else if (posState.value) {
      preSnap = { drawingObj: null, drawing: null, polyObj: null, polyCursor: null, posObj: posState.value, pos: { ...posState.value } };
      const s = snapToCandle(posState.value.time1, posState.value.entry, true);
      posState.value.time1 = s.time;
      posState.value.entry = s.price;
      if (posCursor.value) {
        const cs = snapToCandle(posCursor.value.time, posCursor.value.price, true);
        posCursor.value = { time: cs.time, price: cs.price };
      }
    }
    // Resize handles snap per-move — replay the last cursor position so a
    // stationary resize re-applies the snap the instant Ctrl is pressed.
    replayPointerAt(lastPtrClient);
    recalcRects();
    return;
  }
  // ── Magnet OFF ──
  snapXhair.value = null;
  if (preSnap) {
    // Restore only if it's still the same in-progress drawing session
    if (preSnap.drawingObj && drawingState.value === preSnap.drawingObj && preSnap.drawing) {
      drawingState.value = { ...preSnap.drawing };
    }
    if (preSnap.polyObj && polyState.value === preSnap.polyObj && preSnap.polyCursor) {
      polyState.value.cursor = { ...preSnap.polyCursor };
    }
    if (preSnap.posObj && posState.value === preSnap.posObj && preSnap.pos) {
      posState.value = { ...preSnap.pos };
    }
    preSnap = null;
  }
  // Replay the raw cursor position so cursor-driven corners/levels return
  // to exactly where the pointer is.
  replayPointerAt(lastPtrClient);
  recalcRects();
});

/** Replays the last pointer position through every active move handler
 *  (drawing preview, resize handles) so a magnet toggle applies instantly
 *  even when the cursor is stationary. */
function replayPointerAt(p: { clientX: number; clientY: number } | null): void {
  if (!p) return;
  window.dispatchEvent(new PointerEvent("pointermove", {
    bubbles: true, cancelable: true,
    clientX: p.clientX, clientY: p.clientY,
    pointerId: 1, pointerType: "mouse", isPrimary: true, button: -1, buttons: 1,
  }));
}
// While a shape tool is active the chart must not pan under the finger —
// touch drawing starts from pointerdown, and LWC's own touch handlers would
// otherwise treat the same gesture as a pan and swallow the drawing.
watch(drawingToolActive, (on) => adapter?.setDrawingMode(on));

/* ── Polyline drawing (multi-click; double-click finishes) ──────────── */

interface PolyPixel {
  id: string;
  /** projected vertices; `src` is the index in the stored points array */
  pts: { x: number; y: number; src: number }[];
  color: string;
  width: number;
  dash: DashStyle;
  /** SVG points for the arrowhead triangle on the last corner (or null) */
  arrowTri: string | null;
  selected: boolean;
}

const polyPixels = ref<PolyPixel[]>([]);
const hitPolys = computed(() => polyPixels.value.filter((p) => p.id !== "__preview"));
const selectedPoly = ref<DrawingPoly | null>(null);
const polyPanelPos = ref<{ x: number; y: number } | null>(null);
const polyPanelEl = ref<HTMLElement | null>(null);
const polyPaletteOpen = ref(false);
/** In-progress polyline: confirmed vertices + the live cursor position. */
const polyState = ref<{ points: { time: number; price: number }[]; cursor: { time: number; price: number } | null } | null>(null);
let lastPolyClickAt: { x: number; y: number; at: number } | null = null;
let onPolyMoveRef: ((ev: MouseEvent) => void) | null = null;

/* ── Long / Short position (TradingView-style) ──────────────────────── */

interface PosLevel {
  y: number;
  /** 1R line index (1-based) — undefined for entry/tp/sl */
  r?: number;
}
interface PositionPixel {
  id: string;
  direction: "long" | "short";
  left: number;
  width: number;
  entryY: number;
  slY: number;
  tpY: number;
  /** profit box (entry ↔ TP) */
  profitTop: number;
  profitH: number;
  /** loss box (entry ↔ SL) */
  lossTop: number;
  lossH: number;
  rr: number;
  slPct: number;
  tpPct: number;
  /** |SL−entry| and |TP−entry| expressed in pips */
  slPips: number;
  tpPips: number;
  precision: number;
  /** 1R..NR reward lines when enabled */
  levels: PosLevel[];
  selected: boolean;
  /** live two-click preview (lighter styling) */
  preview: boolean;
}

const posPixels = ref<PositionPixel[]>([]);
const selectedPos = ref<DrawingPosition | null>(null);
const posPanelPos = ref<{ x: number; y: number } | null>(null);
const posPanelEl = ref<HTMLElement | null>(null);
/** Hidden until the panel's real size is measured — no wrong-spot flash. */
const posPanelReady = ref(false);
/** In-progress position: first click set (entry + left edge), the cursor
 *  supplies the SL price and right edge until the second click. */
const posState = ref<{ time1: number; entry: number } | null>(null);
const posCursor = ref<{ time: number; price: number } | null>(null);
let onPosMoveRef: ((ev: MouseEvent) => void) | null = null;

const fmtPrice = (v: number, precision: number) => v.toFixed(precision);

/* ── One-click lines: hline / hray / vline ──────────────────────────── */

interface SinglePixel {
  id: string;
  kind: SingleKind;
  /** hline/hray: pixel y of the price; vline: pixel x of the time */
  y: number;
  x: number;
  /** resize-corner position (hline/vline: middle of the line, hray: anchor) */
  hx: number;
  hy: number;
  /** source values for the axis tags */
  time: number;
  price: number;
  color: string;
  dash: DashStyle;
  width: number;
  selected: boolean;
}
const singlePixels = ref<SinglePixel[]>([]);
const singlePanelPos = ref<{ x: number; y: number } | null>(null);
const singlePanelEl = ref<HTMLElement | null>(null);
/** While the panel element isn't measured yet, keep it invisible so it never
 *  flashes at a wrong position; it then sticks to the line. */
const singlePanelReady = ref(false);

function getSingle(kind: SingleKind, id: string): SingleDrawing | null {
  return drawingsStore.getSingles(kind, market.instrument).find((i) => i.id === id) ?? null;
}

/**
 * Magnet mode: snap the cursor to the high/low of the nearest candle
 * (whichever is closer in pixels). When the magnet is active it ALWAYS
 * attracts — TradingView-style — so the anchor lands exactly on the level
 * no matter how far the cursor sits from it vertically. The candle is
 * chosen by time (the bar under the cursor).
 */
function snapToCandle(time: number, price: number, snap: boolean): { time: number; price: number } {
  if (!snap || !adapter || !displayCandles.value.length) return { time, price };
  const arr = displayCandles.value;
  let lo = 0;
  let hi = arr.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (arr[mid]!.time < time) lo = mid;
    else hi = mid;
  }
  const c = Math.abs(arr[lo]!.time - time) <= Math.abs(arr[hi]!.time - time) ? arr[lo]! : arr[hi]!;
  const yP = adapter.getPriceY(price);
  const yH = adapter.getPriceY(c.high);
  const yL = adapter.getPriceY(c.low);
  if (yP === null || yH === null || yL === null) return { time, price };
  return { time: c.time, price: Math.abs(yP - yH) <= Math.abs(yP - yL) ? c.high : c.low };
}

/** Format a time for the vertical-line tag on the time scale. Lightweight
 *  Charts treats its times as UTC, so the tag is formatted in UTC too —
 *  otherwise it would disagree with the chart's own axis labels. */
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtAxisTime(t: number): string {
  const d = new Date(t * 1000);
  const p2 = (n: number) => String(n).padStart(2, "0");
  const date = `${p2(d.getUTCDate())} ${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  const sec = TIMEFRAME_SECONDS[market.timeframe as keyof typeof TIMEFRAME_SECONDS] ?? 60;
  if (sec >= 86400) return date;
  return `${date} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
}

/** Width of the price scale / height of the time scale (measured from the
 *  LWC canvases). Drawing overlays are clipped to the chart area so nothing
 *  can be drawn on the axes. */
const axisRightW = ref(0);
const axisBottomH = ref(0);
let axisRetry = 0;
function updateAxisSizes(): void {
  const c = containerRef.value;
  if (!c) return;
  let main: Element | null = null;
  let area = 0;
  for (const cv of c.querySelectorAll("canvas")) {
    const r = cv.getBoundingClientRect();
    if (r.width * r.height > area) {
      area = r.width * r.height;
      main = cv;
    }
  }
  if (!main) return;
  const r = main.getBoundingClientRect();
  // LWC may not have laid out its panes yet (canvas still tiny) — a bad
  // measurement would shrink every overlay to a sliver, so retry instead.
  if (r.width < c.clientWidth * 0.5) {
    if (axisRetry < 60) {
      axisRetry += 1;
      requestAnimationFrame(updateAxisSizes);
    }
    return;
  }
  const rightW = Math.max(0, Math.round(c.clientWidth - r.width));
  const bottomH = Math.max(0, Math.round(c.clientHeight - r.height));
  const changed = rightW !== axisRightW.value || bottomH !== axisBottomH.value;
  axisRightW.value = rightW;
  axisBottomH.value = bottomH;
  if (changed) {
    // The LWC canvas resizes ASYNC after a container layout change (e.g.
    // the watchlist slide) — the first measurement can still see the old
    // canvas size, yielding a wildly wrong axis width (382px instead of
    // 62px) that would permanently clip the overlays. Keep re-measuring
    // every frame until the value settles, then re-project the overlays.
    recalcRects();
    if (axisRetry < 60) {
      axisRetry += 1;
      requestAnimationFrame(() => {
        updateAxisSizes();
        updateBadgePosition();
        recalcRects();
      });
    }
  } else {
    axisRetry = 0;
  }
}
/** True when the event is inside the drawable chart area (not on an axis). */
function isInChartArea(e: MouseEvent): boolean {
  const c = containerRef.value;
  if (!c) return false;
  const r = c.getBoundingClientRect();
  const lx = e.clientX - r.left;
  const ly = e.clientY - r.top;
  return lx <= c.clientWidth - axisRightW.value && ly <= c.clientHeight - axisBottomH.value;
}

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
  if (drawingState.value && adapter && drawingsStore.activeTool === "rectangle") {
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

  // Trendlines: endpoints project directly (no min/max — a line keeps its
  // drawn direction; vertical lines with equal times are valid).
  const trendsOut: TrendPixel[] = [];
  for (const ln of drawingsStore.getLinesFor(market.instrument)) {
    const x1 = adapter.timeToX(ln.time1);
    const y1 = adapter.getPriceY(ln.price1);
    const x2 = adapter.timeToX(ln.time2);
    const y2 = adapter.getPriceY(ln.price2);
    if (x1 === null || y1 === null || x2 === null || y2 === null) continue;
    trendsOut.push({
      id: ln.id,
      x1,
      y1,
      x2,
      y2,
      color: ln.color,
      width: ln.width,
      dash: ln.dash,
      selected: drawingsStore.selectedLineId === ln.id,
    });
  }
  if (drawingState.value && adapter && drawingsStore.activeTool === "trendline") {
    const x1 = adapter.timeToX(drawingState.value.time1);
    const y1 = adapter.getPriceY(drawingState.value.price1);
    const x2 = adapter.timeToX(drawingState.value.time2);
    const y2 = adapter.getPriceY(drawingState.value.price2);
    if (x1 !== null && y1 !== null && x2 !== null && y2 !== null) {
      trendsOut.push({
        id: "__preview",
        x1,
        y1,
        x2,
        y2,
        color: "#2962ff",
        width: 2,
        dash: "solid",
        selected: false,
      });
    }
  }
  trendPixels.value = trendsOut;

  // Polylines: each vertex projects independently; skip a poly if any vertex
  // is unprojectable (chart not laid out yet / symbol mismatch).
  const polysOut: PolyPixel[] = [];
  const ad = adapter;
  const projectPt = (pt: { time: number; price: number }) => {
    const x = ad.timeToX(pt.time);
    const y = ad.getPriceY(pt.price);
    return x === null || y === null ? null : { x, y };
  };
  /** Douglas-Peucker simplification of the projected vertices (endpoints always
 *  kept). A polyline drawn on a fine timeframe can collapse into a ~1-candle
 *  column on a coarser one, where its dense zigzag renders as a fat blob over
 *  that candle; dropping vertices within `eps` px of the local chord renders
 *  a clean thin line instead. Storage keeps every vertex. */
function simplifyPts(
  pts: { x: number; y: number; src: number }[],
  eps: number
): { x: number; y: number; src: number }[] {
  if (pts.length < 3) return pts;
  const keep = new Array<boolean>(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack: Array<[number, number]> = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    const A = pts[s]!;
    const B = pts[e]!;
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const len = Math.hypot(dx, dy) || 1e-9;
    let maxD = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = Math.abs(dy * (pts[i]!.x - A.x) - dx * (pts[i]!.y - A.y)) / len;
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > eps && idx > 0) {
      keep[idx] = true;
      stack.push([s, idx], [idx, e]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

  /** Within each ~one-candle-wide cluster of collapsed vertices keep only the
 *  boundary and extreme points (first / last / highest / lowest), so a
 *  fine-timeframe polyline squeezed onto a coarse candle renders as a small
 *  clean zigzag instead of a fat blob over that candle. */
function reducePerCluster(
  pts: { x: number; y: number; src: number }[],
  clusterPx = 5
): { x: number; y: number; src: number }[] {
  if (pts.length < 3) return pts;
  const out: { x: number; y: number; src: number }[] = [];
  let i = 0;
  while (i < pts.length) {
    let j = i;
    while (j + 1 < pts.length && Math.abs(pts[j + 1]!.x - pts[i]!.x) <= clusterPx) j++;
    const group = pts.slice(i, j + 1);
    if (group.length <= 4) {
      out.push(...group);
    } else {
      let maxY = group[0]!;
      let minY = group[0]!;
      for (const p of group) {
        if (p.y > maxY.y) maxY = p;
        if (p.y < minY.y) minY = p;
      }
      const keep = new Set([group[0]!.src, group[group.length - 1]!.src, maxY.src, minY.src]);
      out.push(...group.filter((p) => keep.has(p.src)));
    }
    i = j + 1;
  }
  return out;
}

const buildPolyPixel = (
    id: string,
    pts: { x: number; y: number; src: number }[],
    color: string,
    width: number,
    dash: DashStyle,
    arrow: boolean,
    selected: boolean
  ): PolyPixel => {
    let arrowTri: string | null = null;
    if (arrow && pts.length >= 2) {
      const tip = pts[pts.length - 1]!;
      const prev = pts[pts.length - 2]!;
      const ang = Math.atan2(tip.y - prev.y, tip.x - prev.x);
      const size = 12;
      const p1 = { x: tip.x + size * Math.cos(ang + Math.PI - 0.45), y: tip.y + size * Math.sin(ang + Math.PI - 0.45) };
      const p2 = { x: tip.x + size * Math.cos(ang + Math.PI + 0.45), y: tip.y + size * Math.sin(ang + Math.PI + 0.45) };
      arrowTri = `${tip.x},${tip.y} ${p1.x},${p1.y} ${p2.x},${p2.y}`;
    }
    return { id, pts, color, width, dash, arrowTri, selected };
  };
  for (const pl of drawingsStore.getPolysFor(market.instrument)) {
    const pts: { x: number; y: number; src: number }[] = [];
    let ok = true;
    for (let i = 0; i < pl.points.length; i++) {
      const p = projectPt(pl.points[i]!);
      if (!p) { ok = false; break; }
      pts.push({ ...p, src: i });
    }
    if (!ok || pts.length < 2) continue;
    // Vertices drawn on a fine timeframe can collapse into a ~1-candle-wide
    // column on a coarser one — the dense zigzag (with round joins) then
    // renders as a fat blob over that candle. Collapse vertices that project
    // within a couple of pixels of each other so the coarse view shows a
    // clean thin line instead. Storage keeps every vertex.
    const simplified = reducePerCluster(simplifyPts(pts, 3));
    if (simplified.length < 2) continue;
    polysOut.push(buildPolyPixel(pl.id, simplified, pl.color, pl.width, pl.dash, pl.arrow, drawingsStore.selectedPolyId === pl.id));
  }
  // Live polyline preview: confirmed vertices + the cursor position
  if (polyState.value && adapter && drawingsStore.activeTool === "polyline") {
    const pts: { x: number; y: number; src: number }[] = [];
    let ok = true;
    for (let i = 0; i < polyState.value.points.length; i++) {
      const p = projectPt(polyState.value.points[i]!);
      if (!p) { ok = false; break; }
      pts.push({ ...p, src: i });
    }
    const cur = polyState.value.cursor ? projectPt(polyState.value.cursor) : null;
    if (ok && cur) pts.push({ ...cur, src: pts.length });
    if (ok && cur && pts.length >= 2) {
      polysOut.push(buildPolyPixel("__preview", pts, "#2962ff", 2, "solid", false, false));
    }
  }
  polyPixels.value = polysOut;

  // Long/Short positions
  const posOut: PositionPixel[] = [];
  const precision = instrumentPrecision(market.instrument);
  const pipSize = instrumentPipSize(market.instrument);
  const buildPosPixel = (
    ps: {
      id: string;
      direction: "long" | "short";
      time1: number;
      time2: number;
      entry: number;
      sl: number;
      tp: number;
      showLevels: boolean;
      selected: boolean;
      preview: boolean;
    }
  ): PositionPixel | null => {
    const x1 = ad.timeToX(ps.time1);
    const x2 = ad.timeToX(ps.time2);
    const entryY = ad.getPriceY(ps.entry);
    const slY = ad.getPriceY(ps.sl);
    const tpY = ad.getPriceY(ps.tp);
    if (x1 === null || x2 === null || entryY === null || slY === null || tpY === null) return null;
    const long = ps.direction !== "short";
    const risk = Math.abs(ps.entry - ps.sl);
    const rr = risk > 0 ? Math.abs(ps.tp - ps.entry) / risk : 0;
    // 1R..NR reward lines between entry and TP (N = floor(R:R))
    const levels: PosLevel[] = [];
    if (ps.showLevels) {
      const dir = long ? 1 : -1;
      for (let k = 1; k <= Math.floor(rr); k++) {
        const y = ad.getPriceY(ps.entry + dir * k * risk);
        if (y !== null) levels.push({ y, r: k });
      }
    }
    return {
      id: ps.id,
      direction: ps.direction,
      left: Math.min(x1, x2),
      width: Math.max(1, Math.abs(x2 - x1)),
      entryY,
      slY,
      tpY,
      profitTop: long ? tpY : entryY,
      profitH: Math.max(1, Math.abs(entryY - tpY)),
      lossTop: long ? entryY : slY,
      lossH: Math.max(1, Math.abs(slY - entryY)),
      rr,
      slPct: ((long ? ps.sl - ps.entry : ps.entry - ps.sl) / ps.entry) * 100,
      tpPct: ((long ? ps.tp - ps.entry : ps.entry - ps.tp) / ps.entry) * 100,
      slPips: risk / pipSize,
      tpPips: Math.abs(ps.tp - ps.entry) / pipSize,
      precision,
      levels,
      selected: ps.selected,
      preview: ps.preview,
    };
  };
  for (const ps of drawingsStore.getPositionsFor(market.instrument)) {
    const px = buildPosPixel({ ...ps, selected: drawingsStore.selectedPositionId === ps.id, preview: false });
    if (px) posOut.push(px);
  }
  // Live two-click preview: entry is set, the cursor is the SL — the profit
  // side gets a light green box at 2R, the SL side a light red one.
  if (posState.value && posCursor.value && drawingsStore.activeTool === "position") {
    const long = posCursor.value.price < posState.value.entry;
    const risk = Math.abs(posState.value.entry - posCursor.value.price);
    const px = buildPosPixel({
      id: "__pospreview",
      direction: long ? "long" : "short",
      time1: posState.value.time1,
      time2: posCursor.value.time,
      entry: posState.value.entry,
      sl: posCursor.value.price,
      tp: posState.value.entry + (long ? 1 : -1) * 2 * risk,
      showLevels: false,
      selected: false,
      preview: true,
    });
    if (px) posOut.push(px);
  }
  posPixels.value = posOut;

  // One-click lines (hline / hray / vline)
  const sel1 = drawingsStore.selectedSingle;
  const singleOut: SinglePixel[] = [];
  const chartW1 = ad ? containerRef.value!.clientWidth - axisRightW.value : 0;
  const chartH1 = ad ? containerRef.value!.clientHeight - axisBottomH.value : 0;
  for (const kind of ["hline", "hray", "vline"] as SingleKind[]) {
    for (const it of drawingsStore.getSingles(kind, market.instrument)) {
      const selected = sel1?.kind === kind && sel1.id === it.id;
      if (kind === "vline") {
        const x = ad.timeToX((it as DrawingVLine).time);
        if (x === null) continue;
        singleOut.push({ id: it.id, kind, x, y: 0, hx: x, hy: chartH1 / 2, time: (it as DrawingVLine).time, price: 0, color: it.color, dash: it.dash, width: it.width, selected });
      } else {
        const y = ad.getPriceY((it as DrawingHLine).price);
        if (y === null) continue;
        const t = kind === "hray" ? (it as DrawingHRay).time : 0;
        const x = kind === "hray" ? (ad.timeToX(t) ?? 0) : chartW1 / 2;
        singleOut.push({ id: it.id, kind, x, y, hx: x, hy: y, time: t, price: (it as DrawingHLine).price, color: it.color, dash: it.dash, width: it.width, selected });
      }
    }
  }
  singlePixels.value = singleOut;

  rebuildDemoLines();
  // Visible chart height for the demo tag visibility check
  if (containerRef.value) {
    demoChartH.value = containerRef.value.clientHeight - axisBottomH.value;
  }

  // Replay vertical line position
  const replayT = replay.picking ? pickTime.value : replay.cutoff;
  replayVlX.value = replay.active && replayT !== null ? (ad.timeToX(replayT) ?? null) : null;

  // Replay price tag: the close of the last visible candle, rendered on the
  // price scale directly UNDER the live price label (the series ends there,
  // so LWC's own label sits at the same price).
  if (replay.active && !replay.picking && displayCandles.value.length) {
    const lastC = displayCandles.value[displayCandles.value.length - 1]!;
    const y = ad.getPriceY(lastC.close);
    const lh = adapter.getPriceLabelHeight();
    replayTag.value = y !== null ? { y: y + lh / 2 + 1, text: lastC.close.toFixed(instrumentPrecision(market.instrument)) } : null;
  } else {
    replayTag.value = null;
  }

  // Keep the open edit panel anchored to its rectangle through pan/zoom and
  // chart resizes (watchlist toggle, window resize) — the rectangle's pixels
  // changed under it, so the panel would otherwise sit at stale coordinates.
  if (selectedRect.value && editPanelPos.value) positionEditPanel(selectedRect.value.id);
  if (selectedLine.value && linePanelPos.value) positionLinePanel(selectedLine.value.id);
  if (selectedPoly.value && polyPanelPos.value) positionPolyPanel(selectedPoly.value.id);
  if (selectedPos.value && posPanelPos.value) positionPosPanel(selectedPos.value.id);
  const selS = drawingsStore.selectedSingle;
  if (selS && singlePanelPos.value) positionSinglePanel(selS.kind, selS.id);
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
  // After a fresh load the chart layout (time/price scales) may not be
  // settled when the first re-projection runs — some drawings then fail to
  // project (null coordinates) and would only render on the NEXT unrelated
  // event (with no live ticks, that can take seconds). Keep re-projecting
  // every frame until every stored drawing has landed, bounded by a settle
  // window so a genuinely unprojectable drawing can't loop forever.
  if (hasUnprojectedDrawings() && performance.now() < loadSettleDeadline) {
    recalcDeadline = Math.max(recalcDeadline, performance.now() + 60);
  }
  if (pointerHeld || performance.now() < recalcDeadline) {
    recalcRaf = requestAnimationFrame(recalcFrame);
  }
}

/** True when fewer drawings are rendered than stored — i.e. at least one
 *  failed to project on the last pass. */
function hasUnprojectedDrawings(): boolean {
  const stored =
    drawingsStore.getFor(market.instrument).length +
    drawingsStore.getLinesFor(market.instrument).length +
    drawingsStore.getPolysFor(market.instrument).length +
    drawingsStore.getPositionsFor(market.instrument).length +
    drawingsStore.getSingles("hline", market.instrument).length +
    drawingsStore.getSingles("hray", market.instrument).length +
    drawingsStore.getSingles("vline", market.instrument).length;
  if (stored === 0) return false;
  const rendered =
    rectPixels.value.filter((r) => r.id !== "__preview").length +
    trendPixels.value.filter((t) => t.id !== "__preview").length +
    polyPixels.value.filter((p) => p.id !== "__preview").length +
    posPixels.value.filter((p) => p.id !== "__pospreview").length +
    singlePixels.value.length;
  return rendered < stored;
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

  // CTRL: snap the anchor to the high/low of the nearest candle
  const s1 = snapToCandle(time, price, magnetActive.value);
  drawingState.value = { time1: s1.time, price1: s1.price, time2: s1.time, price2: s1.price };
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
    if (t !== null && p !== null) {
      // CTRL: snap the free end to the nearest candle high/low
      const s2 = snapToCandle(t, p, magnetActive.value);
      drawingState.value.time2 = s2.time;
      drawingState.value.price2 = s2.price;
    }
    recalcRects();
  };

  function stopMove(): void {
    window.removeEventListener("pointermove", move);
    if (onMouseMoveRef === move) onMouseMoveRef = null;
  }

  const up = (ev: MouseEvent) => {
    window.removeEventListener("pointerup", up);
    // Press-drag-release finalizes immediately. Click-move-click keeps the
    // preview alive; the next left-press (capture handler) finalizes.
    if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 4) {
      stopMove();
      finalizeDraw();
    }
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  onMouseMoveRef = move;
}

/** Store the preview as a real drawing and switch back to the cursor tool. */
function finalizeDraw(): void {
  const d = drawingState.value;
  drawingState.value = null;
  if (onMouseMoveRef) {
    window.removeEventListener("pointermove", onMouseMoveRef);
    onMouseMoveRef = null;
  }
  if (d && (Math.abs(d.time2 - d.time1) >= 1 || Math.abs(d.price2 - d.price1) > 0)) {
    if (drawingsStore.activeTool === "trendline") {
      // Endpoints stay as drawn (no min/max) — direction is preserved
      drawingsStore.addLine(market.instrument, {
        time1: d.time1,
        price1: d.price1,
        time2: d.time2,
        price2: d.price2,
      });
    } else {
      drawingsStore.add(market.instrument, {
        time1: Math.min(d.time1, d.time2),
        price1: Math.min(d.price1, d.price2),
        time2: Math.max(d.time1, d.time2),
        price2: Math.max(d.price1, d.price2),
      });
    }
  }
  drawingsStore.activeTool = "cursor";
  recalcRects();
}

/** Abort an in-progress drawing (right-click, Escape, tool switch). */
function cancelDraw(): void {
  const had = drawingState.value !== null || polyState.value !== null || posState.value !== null;
  drawingState.value = null;
  polyState.value = null;
  posState.value = null;
  posCursor.value = null;
  stopPosCursor();
  stopPolyPreview();
  if (onMouseMoveRef) {
    window.removeEventListener("pointermove", onMouseMoveRef);
    onMouseMoveRef = null;
  }
  if (had) recalcRects();
}

/** Live preview listener for the in-progress polyline: tracks the cursor
 *  (magnet-snapped, so the rubber band sticks to candle high/low too). */
function startPolyPreview(): void {
  stopPolyPreview();
  const move = (ev: MouseEvent) => {
    if (!polyState.value || !adapter || !containerRef.value) return;
    const r = containerRef.value.getBoundingClientRect();
    const t = adapter.xToTime(ev.clientX - r.left);
    const p = adapter.yToPrice(ev.clientY - r.top);
    if (t !== null && p !== null) {
      const s = snapToCandle(t, p, magnetActive.value);
      polyState.value.cursor = { time: s.time, price: s.price };
    }
    recalcRects();
  };
  window.addEventListener("pointermove", move);
  onPolyMoveRef = move;
}

function stopPolyPreview(): void {
  if (onPolyMoveRef) {
    window.removeEventListener("pointermove", onPolyMoveRef);
    onPolyMoveRef = null;
  }
}

/** One left-click of the polyline tool: start, or add a vertex. Finishing
 *  happens on the native double-click (see the dblclick listener in
 *  onMounted). Clicks that land on the same spot add no duplicate vertex. */
function handlePolyClick(e: MouseEvent): void {
  if (!adapter || !containerRef.value) return;
  const r = containerRef.value.getBoundingClientRect();
  const t = adapter.xToTime(e.clientX - r.left);
  const p = adapter.yToPrice(e.clientY - r.top);
  if (t === null || p === null) return;
  const s = snapToCandle(t, p, magnetActive.value);
  const pt = { time: s.time, price: s.price };

  if (!polyState.value) {
    polyState.value = { points: [pt], cursor: pt };
    lastPolyClickAt = { x: e.clientX, y: e.clientY, at: performance.now() };
    startPolyPreview();
    recalcRects();
    return;
  }
  // Same-spot click (the second press of a double-click) → finalize. The
  // native dblclick event is unreliable on touch (double-TAP often doesn't
  // produce one), so a same-spot press within 400ms finishes the polyline on
  // desktop AND touch; the native dblclick handler then becomes a no-op.
  if (lastPolyClickAt && Math.hypot(e.clientX - lastPolyClickAt.x, e.clientY - lastPolyClickAt.y) < 6) {
    if (performance.now() - lastPolyClickAt.at < 400) {
      finalizePoly();
    }
    return;
  }
  lastPolyClickAt = { x: e.clientX, y: e.clientY, at: performance.now() };
  polyState.value.points.push(pt);
  polyState.value.cursor = pt;
  recalcRects();
}

/** Store the finished polyline and switch back to the cursor tool. */
function finalizePoly(): void {
  const st = polyState.value;
  polyState.value = null;
  stopPolyPreview();
  if (st && st.points.length >= 2) {
    drawingsStore.addPoly(market.instrument, { points: st.points });
  }
  drawingsStore.activeTool = "cursor";
  recalcRects();
}

let onMouseMoveRef: ((ev: MouseEvent) => void) | null = null;

function onRectClick(id: string, e: MouseEvent): void {
  e.stopPropagation();
  rectMenu.value = null;
  closePalette();
  clearSingleSelection();
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
  clearSingleSelection();

  // EDGE GUARD: the resize handles are tiny (8px). A press aimed at a  // left/right handle that misses by a few pixels would otherwise land on the
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
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
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
  if (drawingsStore.activeTool === "cursor" && (drawingsStore.selectedLineId || selectedLine.value)) {
    drawingsStore.selectedLineId = null;
    selectedLine.value = null;
    linePanelPos.value = null;
    linePaletteOpen.value = false;
    recalcRects();
  }
  if (drawingsStore.activeTool === "cursor" && (drawingsStore.selectedPolyId || selectedPoly.value)) {
    drawingsStore.selectedPolyId = null;
    selectedPoly.value = null;
    polyPanelPos.value = null;
    polyPaletteOpen.value = false;
    recalcRects();
  }
  if (drawingsStore.activeTool === "cursor" && (drawingsStore.selectedPositionId || selectedPos.value)) {
    drawingsStore.selectedPositionId = null;
    selectedPos.value = null;
    posPanelPos.value = null;
    recalcRects();
  }
  if (drawingsStore.activeTool === "cursor" && drawingsStore.selectedSingle) {
    drawingsStore.selectedSingle = null;
    singlePanelPos.value = null;
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

    // Magnet: snap the dragged anchor to the candle high/low (only the
    // dragged axis is applied, so a vertical-edge drag stays vertical).
    const s = snapToCandle(t, p, magnetActive.value);

    // Only the dragged edge moves; the opposite edge stays anchored.
    const newRect: Partial<DrawingRect> = {};
    if (edgeTime) newRect[edgeTime] = s.time;
    if (edgePrice) newRect[edgePrice] = s.price;

    drawingsStore.updateRect(market.instrument, rect.id, newRect);
    // Update selectedRect reference
    const updated = drawingsStore.getFor(market.instrument).find((r) => r.id === rect.id);
    if (updated) selectedRect.value = updated;
    recalcRects();
    positionEditPanel(rect.id);
  };

  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  };

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

/* ── Trendline interaction ──────────────────────────────────────────── */

/** Select a trendline and open its edit panel. */
function onTrendClick(id: string, e: MouseEvent): void {
  e.stopPropagation();
  rectMenu.value = null;
  closePalette();
  linePaletteOpen.value = false;
  clearSingleSelection();
  if (drawingsStore.activeTool !== "cursor") {
    drawingsStore.activeTool = "cursor";
  }
  drawingsStore.selectedId = null;
  selectedRect.value = null;
  editPanelPos.value = null;
  drawingsStore.selectedLineId = id;
  selectedLine.value = drawingsStore.getLinesFor(market.instrument).find((l) => l.id === id) ?? null;
  recalcRects();
  positionLinePanel(id);
}

/** Anchors the floating edit panel to the trendline's RIGHT endpoint
 *  ("right corner"): 8px beside/above it, flipping when out of room,
 *  fully clamped inside the pane. */
function positionLinePanel(id: string): void {
  const px = trendPixels.value.find((t) => t.id === id);
  const pane = containerRef.value;
  if (!px || !pane) return;
  linePanelPos.value = computeLinePanelPos(px, pane);
  if (!linePanelEl.value) {
    void nextTick(() => {
      const sel = selectedLine.value;
      if (!linePanelEl.value || !sel || !containerRef.value) return;
      const p = trendPixels.value.find((t) => t.id === sel.id);
      if (p) linePanelPos.value = computeLinePanelPos(p, containerRef.value);
    });
  }
}

function computeLinePanelPos(pixel: TrendPixel, pane: HTMLElement): { x: number; y: number } {
  const w = linePanelEl.value?.offsetWidth || PANEL_W;
  const h = linePanelEl.value?.offsetHeight || PANEL_H;
  const gap = 8;
  const atStart = pixel.x1 >= pixel.x2; // right endpoint of the line
  const ex = atStart ? pixel.x1 : pixel.x2;
  const ey = atStart ? pixel.y1 : pixel.y2;
  // Prefer right of the endpoint, above it; flip left / below when clipped
  let x = ex + gap;
  let y = ey - h - gap;
  if (x + w > pane.clientWidth - 6) x = ex - w - gap;
  if (y < 4) y = ey + gap;
  x = Math.min(Math.max(4, x), Math.max(4, pane.clientWidth - w - 6));
  y = Math.min(Math.max(4, y), Math.max(4, pane.clientHeight - h - 6));
  return { x, y };
}

/** Drag the whole trendline (body press) — both endpoints move together. */
function onTrendDragStart(e: MouseEvent, id: string): void {
  if (e.button !== 0 || drawingsStore.activeTool !== "cursor") return;
  if (!adapter || !containerRef.value) return;
  const line = drawingsStore.getLinesFor(market.instrument).find((l) => l.id === id);
  if (!line) return;
  e.preventDefault();
  e.stopPropagation();
  rectMenu.value = null;
  closePalette();
  clearSingleSelection();

  drawingsStore.selectedId = null;
  selectedRect.value = null;
  editPanelPos.value = null;
  drawingsStore.selectedLineId = id;
  selectedLine.value = line;
  recalcRects();
  positionLinePanel(id);

  const r0 = containerRef.value.getBoundingClientRect();
  const startT = adapter.xToTime(e.clientX - r0.left);
  const startP = adapter.yToPrice(e.clientY - r0.top);
  if (startT === null || startP === null) return;
  const orig = { time1: line.time1, price1: line.price1, time2: line.time2, price2: line.price2 };

  const onMove = (ev: MouseEvent) => {
    if (!adapter || !containerRef.value) return;
    const r = containerRef.value.getBoundingClientRect();
    const t = adapter.xToTime(ev.clientX - r.left);
    const p = adapter.yToPrice(ev.clientY - r.top);
    if (t === null || p === null) return;
    const dt = t - startT;
    const dp = p - startP;
    drawingsStore.updateLine(market.instrument, id, {
      time1: orig.time1 + dt,
      price1: orig.price1 + dp,
      time2: orig.time2 + dt,
      price2: orig.price2 + dp,
    });
    const updated = drawingsStore.getLinesFor(market.instrument).find((x) => x.id === id);
    if (updated) selectedLine.value = updated;
    recalcRects();
    positionLinePanel(id);
  };

  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

/** Drag an endpoint handle ("corner") to resize/redraw the line; the other
 *  endpoint stays anchored. */
function onTrendHandleStart(e: MouseEvent, id: string, which: 1 | 2): void {
  if (e.button !== 0 || !adapter || !containerRef.value) return;
  e.preventDefault();
  e.stopPropagation();
  rectMenu.value = null;
  closePalette();

  const onMove = (ev: MouseEvent) => {
    if (!adapter || !containerRef.value) return;
    const r = containerRef.value.getBoundingClientRect();
    const t = adapter.xToTime(ev.clientX - r.left);
    const p = adapter.yToPrice(ev.clientY - r.top);
    if (t === null || p === null) return;
    const s = snapToCandle(t, p, magnetActive.value);
    drawingsStore.updateLine(market.instrument, id, which === 1 ? { time1: s.time, price1: s.price } : { time2: s.time, price2: s.price });
    const updated = drawingsStore.getLinesFor(market.instrument).find((x) => x.id === id);
    if (updated) selectedLine.value = updated;
    recalcRects();
    positionLinePanel(id);
  };

  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

function deleteSelectedLine(): void {
  if (!selectedLine.value) return;
  drawingsStore.removeLine(market.instrument, selectedLine.value.id);
  selectedLine.value = null;
  linePanelPos.value = null;
  linePaletteOpen.value = false;
  recalcRects();
}

function setLineColorSelected(color: string): void {
  if (!selectedLine.value) return;
  drawingsStore.updateLineStyle(market.instrument, selectedLine.value.id, { color });
  syncSelectedLine();
}

function setLineDashSelected(dash: DashStyle): void {
  if (!selectedLine.value) return;
  drawingsStore.updateLineStyle(market.instrument, selectedLine.value.id, { dash });
  syncSelectedLine();
}

/** Re-read the selected trendline from the store and refresh the overlay. */
function syncSelectedLine(): void {
  if (!selectedLine.value) return;
  const updated = drawingsStore.getLinesFor(market.instrument).find((l) => l.id === selectedLine.value!.id);
  if (updated) selectedLine.value = updated;
  recalcRects();
}

/* ── Polyline interaction ───────────────────────────────────────────── */

/** Select a polyline and open its edit panel (anchored at the LAST corner). */
function onPolyClick(id: string, e: MouseEvent): void {
  e.stopPropagation();
  rectMenu.value = null;
  closePalette();
  polyPaletteOpen.value = false;
  linePaletteOpen.value = false;
  clearSingleSelection();
  if (drawingsStore.activeTool !== "cursor") {
    drawingsStore.activeTool = "cursor";
  }
  drawingsStore.selectedId = null;
  selectedRect.value = null;
  editPanelPos.value = null;
  drawingsStore.selectedLineId = null;
  selectedLine.value = null;
  linePanelPos.value = null;
  drawingsStore.selectedPolyId = id;
  selectedPoly.value = drawingsStore.getPolysFor(market.instrument).find((p) => p.id === id) ?? null;
  recalcRects();
  positionPolyPanel(id);
}

/** Anchors the floating edit panel to the polyline's LAST corner, clamped
 *  inside the pane, flipping when out of room. */
function positionPolyPanel(id: string): void {
  const px = polyPixels.value.find((p) => p.id === id);
  const pane = containerRef.value;
  if (!px || !pane) return;
  const corner = px.pts[px.pts.length - 1]!;
  polyPanelPos.value = computeCornerPanelPos(corner.x, corner.y, pane, polyPanelEl.value);
  if (!polyPanelEl.value) {
    void nextTick(() => {
      const sel = selectedPoly.value;
      if (!polyPanelEl.value || !sel || !containerRef.value) return;
      const p = polyPixels.value.find((q) => q.id === sel.id);
      if (p) {
        const c = p.pts[p.pts.length - 1]!;
        polyPanelPos.value = computeCornerPanelPos(c.x, c.y, containerRef.value, polyPanelEl.value);
      }
    });
  }
}

/** Shared corner-anchored panel placement (used by trendline + polyline).
 *  `forceW`/`forceH` may be passed so a first paint with a hidden panel
 *  (display:less measuring) never flips to the wrong side. */
function computeCornerPanelPos(
  ex: number,
  ey: number,
  pane: HTMLElement,
  el: HTMLElement | null,
  forceW?: number,
  forceH?: number
): { x: number; y: number } {
  const w = forceW != null ? forceW : el?.offsetWidth || PANEL_W;
  const h = forceH != null ? forceH : el?.offsetHeight || PANEL_H;
  const gap = 8;
  let x = ex + gap;
  let y = ey - h - gap;
  if (x + w > pane.clientWidth - 6) x = ex - w - gap;
  if (y < 4) y = ey + gap;
  x = Math.min(Math.max(4, x), Math.max(4, pane.clientWidth - w - 6));
  y = Math.min(Math.max(4, y), Math.max(4, pane.clientHeight - h - 6));
  return { x, y };
}

/** Drag the whole polyline — every vertex moves together. */
function onPolyDragStart(e: MouseEvent, id: string): void {
  if (e.button !== 0 || drawingsStore.activeTool !== "cursor") return;
  if (!adapter || !containerRef.value) return;
  const poly = drawingsStore.getPolysFor(market.instrument).find((p) => p.id === id);
  if (!poly) return;
  e.preventDefault();
  e.stopPropagation();
  rectMenu.value = null;
  closePalette();
  clearSingleSelection();
  drawingsStore.selectedId = null;
  selectedRect.value = null;
  editPanelPos.value = null;
  drawingsStore.selectedLineId = null;
  selectedLine.value = null;
  linePanelPos.value = null;
  drawingsStore.selectedPolyId = id;
  selectedPoly.value = poly;
  recalcRects();
  positionPolyPanel(id);

  const r0 = containerRef.value.getBoundingClientRect();
  const startT = adapter.xToTime(e.clientX - r0.left);
  const startP = adapter.yToPrice(e.clientY - r0.top);
  if (startT === null || startP === null) return;
  const orig = poly.points.map((pt) => ({ ...pt }));

  const onMove = (ev: MouseEvent) => {
    if (!adapter || !containerRef.value) return;
    const r = containerRef.value.getBoundingClientRect();
    const t = adapter.xToTime(ev.clientX - r.left);
    const p = adapter.yToPrice(ev.clientY - r.top);
    if (t === null || p === null) return;
    const dt = t - startT;
    const dp = p - startP;
    drawingsStore.updatePolyPoints(
      market.instrument,
      id,
      orig.map((pt) => ({ time: pt.time + dt, price: pt.price + dp }))
    );
    const updated = drawingsStore.getPolysFor(market.instrument).find((x) => x.id === id);
    if (updated) selectedPoly.value = updated;
    recalcRects();
    positionPolyPanel(id);
  };
  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

/** Drag one vertex ("corner") of the polyline; the other vertices stay. */
function onPolyVertexStart(e: MouseEvent, id: string, index: number): void {
  if (e.button !== 0 || !adapter || !containerRef.value) return;
  e.preventDefault();
  e.stopPropagation();
  rectMenu.value = null;
  closePalette();

  const onMove = (ev: MouseEvent) => {
    if (!adapter || !containerRef.value) return;
    const r = containerRef.value.getBoundingClientRect();
    const t = adapter.xToTime(ev.clientX - r.left);
    const p = adapter.yToPrice(ev.clientY - r.top);
    if (t === null || p === null) return;
    const s = snapToCandle(t, p, magnetActive.value);
    const poly = drawingsStore.getPolysFor(market.instrument).find((x) => x.id === id);
    if (!poly || !poly.points[index]) return;
    const next = poly.points.map((pt, i) => (i === index ? { time: s.time, price: s.price } : { ...pt }));
    drawingsStore.updatePolyPoints(market.instrument, id, next);
    const updated = drawingsStore.getPolysFor(market.instrument).find((x) => x.id === id);
    if (updated) selectedPoly.value = updated;
    recalcRects();
    positionPolyPanel(id);
  };
  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

function deleteSelectedPoly(): void {
  if (!selectedPoly.value) return;
  drawingsStore.removePoly(market.instrument, selectedPoly.value.id);
  selectedPoly.value = null;
  polyPanelPos.value = null;
  polyPaletteOpen.value = false;
  recalcRects();
}

function setPolyColorSelected(color: string): void {
  if (!selectedPoly.value) return;
  drawingsStore.updatePolyStyle(market.instrument, selectedPoly.value.id, { color });
  syncSelectedPoly();
}

function setPolyDashSelected(dash: DashStyle): void {
  if (!selectedPoly.value) return;
  drawingsStore.updatePolyStyle(market.instrument, selectedPoly.value.id, { dash });
  syncSelectedPoly();
}

/** Toggle the arrowhead on the polyline's last corner. */
function toggleArrowSelected(): void {
  if (!selectedPoly.value) return;
  drawingsStore.updatePolyStyle(market.instrument, selectedPoly.value.id, {
    arrow: selectedPoly.value.arrow === false,
  });
  syncSelectedPoly();
}

/** Re-read the selected polyline from the store and refresh the overlay. */
function syncSelectedPoly(): void {
  if (!selectedPoly.value) return;
  const updated = drawingsStore.getPolysFor(market.instrument).find((p) => p.id === selectedPoly.value!.id);
  if (updated) selectedPoly.value = updated;
  recalcRects();
}

/* ── Long / Short position interaction ──────────────────────────────── */

/** First click of the position tool: sets the entry price and the left
 *  edge; the preview then follows the mouse until the second click. */
function beginPos(e: MouseEvent): void {
  if (!adapter || !containerRef.value) return;
  const r = containerRef.value.getBoundingClientRect();
  const t = adapter.xToTime(e.clientX - r.left);
  const p = adapter.yToPrice(e.clientY - r.top);
  if (t === null || p === null) return;
  const s = snapToCandle(t, p, magnetActive.value);
  posState.value = { time1: s.time, entry: s.price };
  posCursor.value = { time: s.time, price: s.price };
  recalcRects();
  stopPosCursor();
  const move = (ev: MouseEvent) => {
    if (!posState.value || !adapter || !containerRef.value) return;
    const rr = containerRef.value.getBoundingClientRect();
    const ct = adapter.xToTime(ev.clientX - rr.left);
    const cp = adapter.yToPrice(ev.clientY - rr.top);
    if (ct !== null && cp !== null) {
      const cs = snapToCandle(ct, cp, magnetActive.value);
      posCursor.value = { time: cs.time, price: cs.price };
    }
    recalcRects();
  };
  window.addEventListener("pointermove", move);
  onPosMoveRef = move;
}

function stopPosCursor(): void {
  if (onPosMoveRef) {
    window.removeEventListener("pointermove", onPosMoveRef);
    onPosMoveRef = null;
  }
}

/** Second click of the position tool: sets the SL — below the entry it's a
 *  LONG, above it a SHORT. The right edge is the second click's time and the
 *  TP defaults to 2R from the entry (R = |entry − SL|). */
function finalizePos(e: MouseEvent): void {
  if (!adapter || !containerRef.value) return;
  const st = posState.value;
  posState.value = null;
  posCursor.value = null;
  stopPosCursor();
  if (st) {
    const r = containerRef.value.getBoundingClientRect();
    const t = adapter.xToTime(e.clientX - r.left);
    const p = adapter.yToPrice(e.clientY - r.top);
    if (t !== null && p !== null) {
      // Snap the SL anchor to the candle high/low under the magnet
      const s = snapToCandle(t, p, magnetActive.value);
      if (Math.abs(s.price - st.entry) > 0) {
        const long = s.price < st.entry;
        const risk = Math.abs(st.entry - s.price);
        drawingsStore.addPosition(market.instrument, {
          direction: long ? "long" : "short",
          time1: st.time1,
          time2: s.time,
          entry: st.entry,
          sl: s.price,
          tp: st.entry + (long ? 1 : -1) * 2 * risk,
        });
      }
    }
  }
  drawingsStore.activeTool = "cursor";
  recalcRects();
}

/** Deselect everything else and select this position, opening its panel. */
function onPosClick(id: string, e: MouseEvent): void {
  e.stopPropagation();
  rectMenu.value = null;
  closePalette();
  clearSingleSelection();
  if (drawingsStore.activeTool !== "cursor") drawingsStore.activeTool = "cursor";
  drawingsStore.selectedId = null;
  selectedRect.value = null;
  editPanelPos.value = null;
  drawingsStore.selectedLineId = null;
  selectedLine.value = null;
  linePanelPos.value = null;
  drawingsStore.selectedPolyId = null;
  selectedPoly.value = null;
  polyPanelPos.value = null;
  drawingsStore.selectedPositionId = id;
  selectedPos.value = drawingsStore.getPositionsFor(market.instrument).find((p) => p.id === id) ?? null;
  recalcRects();
  positionPosPanel(id);
}

/** Panel anchored to the position's top-right corner (profit-box side).
 *  When the position is small the %/pips stats sit above the TP line, so
 *  the panel is lifted higher to never cover them. The panel's real size is
 *  cached (measured even while visibility-hidden) so the first placement —
 *  including the left/right flip decision — is already correct. */
let posPanelW = 0;
let posPanelH = 0;
function positionPosPanel(id: string): void {
  const px = posPixels.value.find((p) => p.id === id);
  const pane = containerRef.value;
  if (!px || !pane) return;
  const topY = Math.min(px.tpY, px.entryY);
  const anchorY = px.width >= 140 ? topY : topY - 35;
  const place = () => {
    const p2 = posPixels.value.find((q) => q.id === id);
    if (!p2 || !containerRef.value) return;
    const t2 = Math.min(p2.tpY, p2.entryY);
    posPanelPos.value = computeCornerPanelPos(
      p2.left + p2.width,
      p2.width >= 140 ? t2 : t2 - 35,
      containerRef.value,
      posPanelEl.value,
      posPanelW || undefined,
      posPanelH || undefined
    );
  };
  posPanelPos.value = computeCornerPanelPos(
    px.left + px.width,
    anchorY,
    pane,
    posPanelEl.value,
    posPanelW || undefined,
    posPanelH || undefined
  );
  if (!posPanelEl.value) {
    posPanelReady.value = false;
    void nextTick(() => {
      if (!posPanelEl.value) return;
      posPanelW = posPanelEl.value.offsetWidth;
      posPanelH = posPanelEl.value.offsetHeight;
      place();
      posPanelReady.value = true;
    });
  } else {
    posPanelW = posPanelEl.value.offsetWidth;
    posPanelH = posPanelEl.value.offsetHeight;
    posPanelReady.value = true;
  }
}

/** Never let a level cross its neighbour: SL stays on the loss side of the
 *  entry, TP on the profit side, entry between the two. */
function clampPosPrice(
  cur: DrawingPosition,
  which: "tp" | "entry" | "sl",
  price: number
): number {
  const long = cur.direction !== "short";
  if (which === "sl") return long ? Math.min(price, cur.entry) : Math.max(price, cur.entry);
  if (which === "tp") return long ? Math.max(price, cur.entry) : Math.min(price, cur.entry);
  const lo = Math.min(cur.sl, cur.tp);
  const hi = Math.max(cur.sl, cur.tp);
  return Math.min(Math.max(price, lo), hi);
}

/** Drag one price level (tp / entry / sl) vertically; the others stay. */
function onPosLevelStart(e: MouseEvent, id: string, which: "tp" | "entry" | "sl"): void {
  if (e.button !== 0 || !adapter || !containerRef.value) return;
  e.preventDefault();
  e.stopPropagation();
  rectMenu.value = null;
  closePalette();

  const onMove = (ev: MouseEvent) => {
    if (!adapter || !containerRef.value) return;
    const r = containerRef.value.getBoundingClientRect();
    const t = adapter.xToTime(ev.clientX - r.left);
    const p = adapter.yToPrice(ev.clientY - r.top);
    if (t === null || p === null) return;
    // Magnet: snap the level to the candle high/low under the cursor
    const sp = snapToCandle(t, p, magnetActive.value).price;
    const cur = drawingsStore.getPositionsFor(market.instrument).find((x) => x.id === id);
    const price = cur ? clampPosPrice(cur, which, sp) : sp;
    drawingsStore.updatePosition(market.instrument, id, { [which]: price });
    const updated = drawingsStore.getPositionsFor(market.instrument).find((x) => x.id === id);
    if (updated) selectedPos.value = updated;
    recalcRects();
    positionPosPanel(id);
  };
  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

/** Drag a vertical time edge (left / right) horizontally. */
function onPosEdgeStart(e: MouseEvent, id: string, which: "time1" | "time2"): void {
  if (e.button !== 0 || !adapter || !containerRef.value) return;
  e.preventDefault();
  e.stopPropagation();
  rectMenu.value = null;
  closePalette();

  const onMove = (ev: MouseEvent) => {
    if (!adapter || !containerRef.value) return;
    const r = containerRef.value.getBoundingClientRect();
    const t = adapter.xToTime(ev.clientX - r.left);
    if (t === null) return;
    // Magnet: snap the edge to the candle under the cursor (needs a price
    // for the snap lookup; only the snapped time is applied)
    const p = adapter.yToPrice(ev.clientY - r.top);
    const st = p !== null ? snapToCandle(t, p, magnetActive.value) : null;
    drawingsStore.updatePosition(market.instrument, id, { [which]: st ? st.time : t });
    const updated = drawingsStore.getPositionsFor(market.instrument).find((x) => x.id === id);
    if (updated) selectedPos.value = updated;
    recalcRects();
    positionPosPanel(id);
  };
  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

/** Drag a corner handle of the position: vertical movement resizes that
 *  level's price, horizontal movement resizes the width on that side
 *  (left corners move the left edge, right corners the right edge). */
function onPosCornerStart(
  e: MouseEvent,
  id: string,
  which: "tp" | "entry" | "sl",
  side: "time1" | "time2"
): void {
  if (e.button !== 0 || !adapter || !containerRef.value) return;
  e.preventDefault();
  e.stopPropagation();
  rectMenu.value = null;
  closePalette();

  const onMove = (ev: MouseEvent) => {
    if (!adapter || !containerRef.value) return;
    const r = containerRef.value.getBoundingClientRect();
    const t = adapter.xToTime(ev.clientX - r.left);
    const p = adapter.yToPrice(ev.clientY - r.top);
    if (t === null || p === null) return;
    const s = snapToCandle(t, p, magnetActive.value);
    const cur = drawingsStore.getPositionsFor(market.instrument).find((x) => x.id === id);
    const price = cur ? clampPosPrice(cur, which, s.price) : s.price;
    drawingsStore.updatePosition(market.instrument, id, { [which]: price, [side]: s.time });
    const updated = drawingsStore.getPositionsFor(market.instrument).find((x) => x.id === id);
    if (updated) selectedPos.value = updated;
    recalcRects();
    positionPosPanel(id);
  };
  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

/** Drag the position body: everything (times + all three prices) moves. */
function onPosDragStart(e: MouseEvent, id: string): void {
  if (e.button !== 0 || drawingsStore.activeTool !== "cursor") return;
  if (!adapter || !containerRef.value) return;
  const pos = drawingsStore.getPositionsFor(market.instrument).find((p) => p.id === id);
  if (!pos) return;
  e.preventDefault();
  e.stopPropagation();
  rectMenu.value = null;
  closePalette();
  void onPosClick(id, e);

  const r0 = containerRef.value.getBoundingClientRect();
  const startT = adapter.xToTime(e.clientX - r0.left);
  const startP = adapter.yToPrice(e.clientY - r0.top);
  if (startT === null || startP === null) return;
  const orig = { time1: pos.time1, time2: pos.time2, entry: pos.entry, sl: pos.sl, tp: pos.tp };

  const onMove = (ev: MouseEvent) => {
    if (!adapter || !containerRef.value) return;
    const r = containerRef.value.getBoundingClientRect();
    const t = adapter.xToTime(ev.clientX - r.left);
    const p = adapter.yToPrice(ev.clientY - r.top);
    if (t === null || p === null) return;
    drawingsStore.updatePosition(market.instrument, id, {
      time1: orig.time1 + (t - startT),
      time2: orig.time2 + (t - startT),
      entry: orig.entry + (p - startP),
      sl: orig.sl + (p - startP),
      tp: orig.tp + (p - startP),
    });
    const updated = drawingsStore.getPositionsFor(market.instrument).find((x) => x.id === id);
    if (updated) selectedPos.value = updated;
    recalcRects();
    positionPosPanel(id);
  };
  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

function deleteSelectedPos(): void {
  if (!selectedPos.value) return;
  drawingsStore.removePosition(market.instrument, selectedPos.value.id);
  selectedPos.value = null;
  posPanelPos.value = null;
  recalcRects();
}

function togglePosLevels(): void {
  if (!selectedPos.value) return;
  drawingsStore.updatePositionFlags(market.instrument, selectedPos.value.id, {
    showLevels: selectedPos.value.showLevels === false,
  });
  const updated = drawingsStore.getPositionsFor(market.instrument).find((p) => p.id === selectedPos.value!.id);
  if (updated) selectedPos.value = updated;
  recalcRects();
}

/* ── One-click line interaction (hline / hray / vline) ──────────────── */

/** Create the line at the clicked point (1 click) and select it. With CTRL
 *  held the price (or time, for vertical lines) snaps to the nearest candle. */
function createSingle(e: MouseEvent, kind: SingleKind): void {
  if (!adapter || !containerRef.value) return;
  const r = containerRef.value.getBoundingClientRect();
  const t = adapter.xToTime(e.clientX - r.left);
  const p = adapter.yToPrice(e.clientY - r.top);
  if (t === null || p === null) return;
  let item: Record<string, unknown>;
  if (kind === "vline") {
    item = { time: snapToCandle(t, p, magnetActive.value).time };
  } else {
    const s = snapToCandle(t, p, magnetActive.value);
    item = kind === "hray" ? { time: s.time, price: s.price } : { price: s.price };
  }
  const full = drawingsStore.addSingle(kind, market.instrument, item);
  drawingsStore.activeTool = "cursor";
  drawingsStore.selectedPositionId = null;
  selectedPos.value = null;
  posPanelPos.value = null;
  drawingsStore.selectedSingle = { kind, id: full.id };
  recalcRects();
  positionSinglePanel(kind, full.id);
}

function onSingleClick(kind: SingleKind, id: string, e: MouseEvent): void {
  e.stopPropagation();
  rectMenu.value = null;
  closePalette();
  if (drawingsStore.activeTool !== "cursor") drawingsStore.activeTool = "cursor";
  drawingsStore.selectedId = null;
  selectedRect.value = null;
  editPanelPos.value = null;
  drawingsStore.selectedLineId = null;
  selectedLine.value = null;
  linePanelPos.value = null;
  drawingsStore.selectedPolyId = null;
  selectedPoly.value = null;
  polyPanelPos.value = null;
  drawingsStore.selectedPositionId = null;
  selectedPos.value = null;
  posPanelPos.value = null;
  drawingsStore.selectedSingle = { kind, id };
  recalcRects();
  positionSinglePanel(kind, id);
}

/** Panel anchored to the LINE's geometry (like rectangles/trendlines), not
 *  to the click point: hline → above the line's center, hray → above its
 *  anchor point, vline → beside the line at mid-height. Always deterministic,
 *  follows the line while dragging, never relocates. */
let singlePanelW = 0;
let singlePanelH = 0;
function positionSinglePanel(kind: SingleKind, id: string): void {
  const px = singlePixels.value.find((s) => s.id === id && s.kind === kind);
  const pane = containerRef.value;
  if (!px || !pane) return;
  const chartW = pane.clientWidth - axisRightW.value;
  const chartH = pane.clientHeight - axisBottomH.value;
  const anchor =
    kind === "hline" ? { x: chartW / 2, y: px.y }
    : kind === "hray" ? { x: px.x, y: px.y }
    : { x: px.x, y: chartH / 2 };

  const place = () => {
    const p2 = singlePixels.value.find((s) => s.id === id && s.kind === kind);
    if (!p2 || !containerRef.value) return;
    const chartW2 = containerRef.value.clientWidth - axisRightW.value;
    const chartH2 = containerRef.value.clientHeight - axisBottomH.value;
    const a =
      kind === "hline" ? { x: chartW2 / 2, y: p2.y }
      : kind === "hray" ? { x: p2.x, y: p2.y }
      : { x: p2.x, y: chartH2 / 2 };
    // Same placement math as the trendline panel: the panel's LEFT edge is
    // anchored at the corner + gap, so x never depends on the panel width
    // (only the rare right-edge flip does) — no first-paint shift.
    const w = singlePanelW || PANEL_W;
    const h = singlePanelH || PANEL_H;
    const gap = 8;
    let x = a.x + gap;
    let y = a.y - h - gap;
    if (x + w > containerRef.value.clientWidth - 6) x = a.x - w - gap;
    if (y < 4) y = a.y + gap;
    x = Math.min(Math.max(4, x), Math.max(4, containerRef.value.clientWidth - w - 6));
    y = Math.min(Math.max(4, y), Math.max(4, containerRef.value.clientHeight - h - 6));
    singlePanelPos.value = { x, y };
  };

  place();
  if (!singlePanelEl.value) {
    // First paint: hidden until the real size is measured and placement
    // recomputed — the panel never appears at a wrong spot.
    singlePanelReady.value = false;
    void nextTick(() => {
      if (!singlePanelEl.value) return;
      singlePanelW = singlePanelEl.value.offsetWidth;
      singlePanelH = singlePanelEl.value.offsetHeight;
      place();
      singlePanelReady.value = true;
    });
  } else {
    singlePanelW = singlePanelEl.value.offsetWidth;
    singlePanelH = singlePanelEl.value.offsetHeight;
    singlePanelReady.value = true;
  }
}

/** Drag a one-click line: hline vertical, vline horizontal, hray both.
 *  A 3px dead zone keeps accidental micro-movements (e.g. during a
 *  double-click) from dragging the line. */
function onSingleDragStart(e: MouseEvent, kind: SingleKind, id: string): void {
  if (e.button !== 0 || !adapter || !containerRef.value) return;
  e.preventDefault();
  e.stopPropagation();
  rectMenu.value = null;
  closePalette();
  drawingsStore.selectedId = null;
  selectedRect.value = null;
  editPanelPos.value = null;
  drawingsStore.selectedLineId = null;
  selectedLine.value = null;
  linePanelPos.value = null;
  drawingsStore.selectedPolyId = null;
  selectedPoly.value = null;
  polyPanelPos.value = null;
  drawingsStore.selectedPositionId = null;
  selectedPos.value = null;
  posPanelPos.value = null;
  drawingsStore.selectedSingle = { kind, id };
  recalcRects();
  positionSinglePanel(kind, id);

  const startX = e.clientX;
  const startY = e.clientY;
  let moved = false;

  const onMove = (ev: MouseEvent) => {
    if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 3) return;
    moved = true;
    if (!adapter || !containerRef.value) return;
    const r = containerRef.value.getBoundingClientRect();
    const t = adapter.xToTime(ev.clientX - r.left);
    const p = adapter.yToPrice(ev.clientY - r.top);
    if (t === null || p === null) return;
    if (kind === "hline") {
      drawingsStore.updateSingle(kind, market.instrument, id, { price: snapToCandle(t, p, magnetActive.value).price });
    } else if (kind === "vline") {
      drawingsStore.updateSingle(kind, market.instrument, id, { time: snapToCandle(t, p, magnetActive.value).time });
    } else {
      const s = snapToCandle(t, p, magnetActive.value);
      drawingsStore.updateSingle(kind, market.instrument, id, { time: s.time, price: s.price });
    }
    recalcRects();
    positionSinglePanel(kind, id);
  };
  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

function deleteSelectedSingle(): void {
  const sel = drawingsStore.selectedSingle;
  if (!sel) return;
  drawingsStore.removeSingle(sel.kind, market.instrument, sel.id);
  singlePanelPos.value = null;
  recalcRects();
}

/** Deselect the one-click line (used when another drawing gets selected so
 *  only one edit panel is ever open). */
function clearSingleSelection(): void {
  if (!drawingsStore.selectedSingle && !singlePanelPos.value) return;
  drawingsStore.selectedSingle = null;
  singlePanelPos.value = null;
  recalcRects();
}

function setSingleColor(color: string): void {
  const sel = drawingsStore.selectedSingle;
  if (!sel) return;
  drawingsStore.updateSingle(sel.kind, market.instrument, sel.id, { color });
  recalcRects();
}

function setSingleDash(dash: DashStyle): void {
  const sel = drawingsStore.selectedSingle;
  if (!sel) return;
  drawingsStore.updateSingle(sel.kind, market.instrument, sel.id, { dash });
  recalcRects();
}



onMounted(async () => {
  await nextTick();
  if (!containerRef.value) return;
  adapter = createChartAdapter(containerRef.value);
  adapter.setTheme(themeStore.theme === "dark");
  if (props.instrument) adapter.setInstrument(props.instrument);
  adapter.setData(displayCandles.value);
  // Measure the price/time scales once LWC has laid out its panes
  requestAnimationFrame(updateAxisSizes);
  // Make sure drawings stored from a previous session render as soon as the
  // chart can project them — not seconds later on the next stray event.
  loadSettleDeadline = performance.now() + 5000;
  extendRecalcFrames(300);

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
    updateAxisSizes();
    loadSettleDeadline = performance.now() + 5000;
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

  // Rectangle / trendline drawing: intercept left-presses BEFORE Lightweight
  // Charts sees them (capture phase) so the chart does not pan while a drawing
  // tool is active. In cursor mode this handler does nothing and the chart
  // behaves normally.
  const onChartMouseDown = (e: MouseEvent) => {
    // Demo limit placement: a click sets the draft entry price
    if (demo.active && draft.value) {
      if (e.button !== 0 || !isInChartArea(e) || !adapter || !containerRef.value) return;
      e.preventDefault();
      e.stopPropagation();
      const r = containerRef.value.getBoundingClientRect();
      const p = adapter.yToPrice(e.clientY - r.top);
      if (p !== null) {
        // Shift the whole structure (SL/TP keep their distances to entry)
        const delta = p - draft.value.entry;
        draft.value.entry = p;
        draft.value.sl += delta;
        draft.value.tp += delta;
      }
      recalcRects();
      return;
    }
    // Replay picking: a click on the chart starts replay at that candle —
    // everything to the right of the line becomes hidden.
    if (replay.active && replay.picking) {
      if (e.button !== 0 || !isInChartArea(e) || !adapter || !containerRef.value) return;
      e.preventDefault();
      e.stopPropagation();
      const t = replayTimeAt(e.clientX);
      if (t !== null) {
        replay.startAt(t);
        // Cut here: jump so the last candle sits at the right with free space
        focusReplayEdge();
      }
      return;
    }
    // The price/time scales are not drawing surfaces — ignore presses there
    if (!isInChartArea(e)) return;
    const tool = drawingsStore.activeTool;
    if (tool === "hline" || tool === "hray" || tool === "vline") {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      createSingle(e, tool);
      return;
    }
    if (tool === "position") {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      if (posState.value) {
        finalizePos(e); // second click: SL + direction
      } else {
        beginPos(e); // first click: entry
      }
      return;
    }
    if ((tool !== "rectangle" && tool !== "trendline" && tool !== "polyline") || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (tool === "polyline") {
      handlePolyClick(e);
    } else if (drawingState.value) {
      // Second press of click -> move -> click. Touch sends no pointermove
      // between two taps, so the free corner must be moved to THIS press
      // before finalizing — otherwise the shape has zero size and is
      // discarded (mouse is unaffected: move already put it at the cursor).
      if (adapter && containerRef.value) {
        const r = containerRef.value.getBoundingClientRect();
        const t = adapter.xToTime(e.clientX - r.left);
        const p = adapter.yToPrice(e.clientY - r.top);
        if (t !== null && p !== null) {
          const s2 = snapToCandle(t, p, magnetActive.value);
          drawingState.value.time2 = s2.time;
          drawingState.value.price2 = s2.price;
        }
      }
      finalizeDraw(); // second click of click -> move -> click
    } else {
      beginDraw(e);
    }
  };
  el.addEventListener("pointerdown", onChartMouseDown as AnyListener, true);
  chartMouseDownEl = el;
  chartMouseDownCb = onChartMouseDown;

  // Touch deselect: LWC prevent-defaults touches on its canvas, so the
  // browser never synthesizes a `click` there and the container's
  // @click (desktop deselect) never fires. Detect a stationary touch tap
  // with pointer events instead. Taps on drawing/demo hit targets are
  // excluded — their own @click handlers select/deselect.
  let tapPress: { x: number; y: number; onHit: boolean } | null = null;
  const onTapDown = (e: MouseEvent) => {
    if ((e as PointerEvent).pointerType === "mouse") return;
    const target = e.target as HTMLElement | null;
    tapPress = {
      x: e.clientX,
      y: e.clientY,
      onHit: !!target?.closest?.(".drawing-hit-layer, .demo-hit-layer"),
    };
  };
  const onTapUp = (e: MouseEvent) => {
    const press = tapPress;
    tapPress = null;
    if (!press || (e as PointerEvent).pointerType === "mouse" || press.onHit) return;
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > 8) return; // pan/scroll
    if (!isInChartArea(e)) return;
    onChartClick();
  };
  el.addEventListener("pointerdown", onTapDown as AnyListener, true);
  window.addEventListener("pointerup", onTapUp as AnyListener);
  tapDownEl = el;
  tapDownCb = onTapDown;
  tapUpCb = onTapUp;

  // Double-click finishes an in-progress polyline (TradingView-style);
  // the second press of the double-click adds no vertex (see handlePolyClick).
  const onChartDblClick = (e: MouseEvent) => {
    if (drawingsStore.activeTool !== "polyline" || !polyState.value) return;
    e.preventDefault();
    e.stopPropagation();
    finalizePoly();
  };
  el.addEventListener("dblclick", onChartDblClick as AnyListener);
  chartDblClickEl = el;
  chartDblClickCb = onChartDblClick;

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
    if (drawingsStore.selectedId || selectedRect.value) {
      drawingsStore.selectedId = null;
      selectedRect.value = null;
      editPanelPos.value = null;
      recalcRects();
    }
    if (drawingsStore.selectedLineId || selectedLine.value) {
      drawingsStore.selectedLineId = null;
      selectedLine.value = null;
      linePanelPos.value = null;
      linePaletteOpen.value = false;
      recalcRects();
    }
    if (drawingsStore.selectedPolyId || selectedPoly.value) {
      drawingsStore.selectedPolyId = null;
      selectedPoly.value = null;
      polyPanelPos.value = null;
      polyPaletteOpen.value = false;
      recalcRects();
    }
    if (drawingsStore.selectedPositionId || selectedPos.value) {
      drawingsStore.selectedPositionId = null;
      selectedPos.value = null;
      posPanelPos.value = null;
      recalcRects();
    }
    if (drawingsStore.selectedSingle) {
      drawingsStore.selectedSingle = null;
      singlePanelPos.value = null;
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
      linePaletteOpen.value = false;
      polyPaletteOpen.value = false;
    } else if (e.key === "Delete" || e.key === "Backspace") {
      // Never hijack typing inside form fields
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (selectedRect.value) {
        e.preventDefault();
        deleteSelected();
      } else if (selectedLine.value) {
        e.preventDefault();
        deleteSelectedLine();
      } else if (selectedPoly.value) {
        e.preventDefault();
        deleteSelectedPoly();
      } else if (selectedPos.value) {
        e.preventDefault();
        deleteSelectedPos();
      } else if (drawingsStore.selectedSingle) {
        e.preventDefault();
        deleteSelectedSingle();
      }
    }
  };
  window.addEventListener("keydown", onKey as AnyListener);
  escCb = onKey;

  // Magnet modifier: holding Ctrl forces snap-to-candle while held (the
  // toolbar magnet button latches it — the store's magnetActive drives both
  // the button highlight and the snapping crosshair). Blur clears the held
  // state so Ctrl released outside the window can't stick on.
  const onMagnetKey = (e: KeyboardEvent) => {
    if (e.key === "Control") {
      drawingsStore.setCtrlHeld(e.type === "keydown");
      if (e.type === "keyup") snapXhair.value = null;
    }
  };
  const onMagnetBlur = () => {
    drawingsStore.setCtrlHeld(false);
    snapXhair.value = null;
  };
  window.addEventListener("keydown", onMagnetKey);
  window.addEventListener("keyup", onMagnetKey);
  window.addEventListener("blur", onMagnetBlur);
  magnetKeyCb = onMagnetKey;
  magnetBlurCb = onMagnetBlur;

  // Track the cursor globally (not just over the chart) so the magnet
  // toggle replay always uses the CURRENT pointer position, even when it
  // last passed over the edit panel or a toolbar.
  const onAnyMove = (e: PointerEvent) => {
    lastPtrClient = { clientX: e.clientX, clientY: e.clientY };
  };
  window.addEventListener("pointermove", onAnyMove, { passive: true });
  magnetAnyMoveCb = onAnyMove;

  // Snapping crosshair tracking: while a drawing tool + magnet are active,
  // the native crosshair is hidden and this one sticks to candle high/low.
  // The last pointer position is kept so the snapped crosshair appears the
  // INSTANT Ctrl is held / the magnet latches — before any mouse movement.
  const computeSnapXhair = (clientX: number, clientY: number): void => {
    if (!drawingToolActive.value || !magnetActive.value || !adapter || !containerRef.value) {
      snapXhair.value = null;
      return;
    }
    const r = containerRef.value.getBoundingClientRect();
    const fake = { clientX, clientY, button: 0, buttons: 0 } as MouseEvent;
    if (!isInChartArea(fake)) {
      snapXhair.value = null;
      return;
    }
    const t = adapter.xToTime(clientX - r.left);
    const p = adapter.yToPrice(clientY - r.top);
    const s = t !== null && p !== null ? snapToCandle(t, p, true) : null;
    const x = s ? adapter.timeToX(s.time) : null;
    const y = s ? adapter.getPriceY(s.price) : null;
    snapXhair.value = x !== null && y !== null && s
      ? { x, y, priceText: fmtPrice(s.price, instrumentPrecision(market.instrument)), timeText: fmtAxisTime(s.time) }
      : null;
  };
  const onXhairMove = (e: MouseEvent) => {
    lastPtrClient = { clientX: e.clientX, clientY: e.clientY };
    computeSnapXhair(e.clientX, e.clientY);
  };
  const onXhairLeave = () => {
    lastPtrClient = null;
    snapXhair.value = null;
  };
  el.addEventListener("pointermove", onXhairMove);
  el.addEventListener("pointerleave", onXhairLeave);
  xhairMoveEl = el;
  xhairMoveCb = onXhairMove;
  xhairLeaveCb = onXhairLeave;

  // Swap the native crosshair for the snapping one only while needed
  const syncCrosshairMode = () => {
    const custom = drawingToolActive.value && magnetActive.value;
    adapter?.setCrosshairVisible(!custom);
    if (custom && lastPtrClient) computeSnapXhair(lastPtrClient.clientX, lastPtrClient.clientY);
    else if (!custom) snapXhair.value = null;
  };
  syncCrosshairMode();
  crosshairModeStop = watch([drawingToolActive, magnetActive], syncCrosshairMode);

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
    // Re-measure the axis sizes on every layout change
    updateAxisSizes();
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
  stopHold();
  stopPickingListeners();
  demoLineDrag = null;
  if (replayTimer) {
    clearInterval(replayTimer);
    replayTimer = null;
  }
  if (interactionEl && interactCb) {
    interactionEl.removeEventListener("pointermove", interactCb);
    interactionEl.removeEventListener("pointerdown", interactCb);
    interactionEl.removeEventListener("wheel", interactCb);
    interactionEl.removeEventListener("touchmove", interactCb);
  }
  if (chartMouseDownEl && chartMouseDownCb) {
    chartMouseDownEl.removeEventListener("pointerdown", chartMouseDownCb as AnyListener, true);
  }
  if (tapDownEl && tapDownCb) {
    tapDownEl.removeEventListener("pointerdown", tapDownCb as AnyListener, true);
  }
  if (tapUpCb) {
    window.removeEventListener("pointerup", tapUpCb as AnyListener);
  }
  if (chartDblClickEl && chartDblClickCb) {
    chartDblClickEl.removeEventListener("dblclick", chartDblClickCb as AnyListener);
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
  if (magnetKeyCb) {
    window.removeEventListener("keydown", magnetKeyCb);
    window.removeEventListener("keyup", magnetKeyCb);
  }
  if (magnetBlurCb) {
    window.removeEventListener("blur", magnetBlurCb);
  }
  if (magnetAnyMoveCb) {
    window.removeEventListener("pointermove", magnetAnyMoveCb);
  }
  if (xhairMoveEl && xhairMoveCb) {
    xhairMoveEl.removeEventListener("pointermove", xhairMoveCb);
    xhairMoveEl.removeEventListener("pointerleave", xhairLeaveCb!);
  }
  crosshairModeStop?.();
  adapter?.setCrosshairVisible(true);
  if (windowLostCb) {
    window.removeEventListener("blur", windowLostCb);
    window.removeEventListener("pointercancel", windowLostCb as AnyListener);
  }
  if (onMouseMoveRef) {
    window.removeEventListener("pointermove", onMouseMoveRef);
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
        <template v-for="(part, idx) in symbolParts(instrument)" :key="part">
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
    <div
      class="drawing-layer drawing-clip"
      :class="{ 'drawing-mode': drawingToolActive }"
      :style="{ right: axisRightW + 'px', bottom: axisBottomH + 'px' }"
    >
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
      <!-- Trendlines render as SVG so they can be any angle. They come AFTER
           the rectangles in DOM order so a line drawn over a rect body paints
           on top of it (TradingView-style). -->
      <svg class="trend-svg">
        <line
          v-for="t in trendPixels"
          :key="t.id"
          :x1="t.x1" :y1="t.y1" :x2="t.x2" :y2="t.y2"
          :stroke="t.color"
          :stroke-width="t.width + (t.selected ? 1 : 0)"
          :stroke-dasharray="DASH_ARRAY[t.dash] || undefined"
          stroke-linecap="round"
          :opacity="t.id === '__preview' ? 0.8 : 1"
        />
      </svg>
      <!-- Polylines render on top of trendlines; multi-segment + optional
           arrowhead on the last corner. -->
      <svg class="trend-svg poly-svg">
        <g v-for="p in polyPixels" :key="p.id">
          <polyline
            :points="p.pts.map((q) => q.x + ',' + q.y).join(' ')"
            fill="none"
            :stroke="p.color"
            :stroke-width="p.width + (p.selected ? 1 : 0)"
            :stroke-dasharray="DASH_ARRAY[p.dash] || undefined"
            stroke-linecap="round"
            stroke-linejoin="round"
            :opacity="p.id === '__preview' ? 0.8 : 1"
          />
          <polygon
            v-if="p.arrowTri"
            :points="p.arrowTri"
            :fill="p.color"
            :opacity="p.id === '__preview' ? 0.8 : 1"
          />
        </g>
      </svg>
      <!-- Long/Short positions: green profit box (entry↔TP) + red loss box
           (entry↔SL) at 20% opacity, level lines, and 1R..NR reward lines. -->
      <svg class="trend-svg pos-svg">
        <g v-for="p in posPixels" :key="p.id">
          <rect
            :x="p.left" :y="p.profitTop" :width="p.width" :height="p.profitH"
            fill="#26a69a"
            :fill-opacity="p.preview ? 0.12 : 0.2"
          />
          <rect
            :x="p.left" :y="p.lossTop" :width="p.width" :height="p.lossH"
            fill="#ef5350"
            :fill-opacity="p.preview ? 0.12 : 0.2"
          />
          <line
            v-for="l in p.levels"
            :key="l.r"
            :x1="p.left" :y1="l.y" :x2="p.left + p.width" :y2="l.y"
            stroke="#26a69a"
            stroke-width="1"
            stroke-dasharray="4 4"
            :opacity="0.9"
          />
        </g>
      </svg>
      <!-- One-click lines: horizontal line / horizontal ray / vertical line -->
      <div
        v-for="s in singlePixels"
        :key="s.id"
        class="single-line"
        :class="[s.kind, s.dash, { selected: s.selected }]"
        :style="
          s.kind === 'vline'
            ? { left: s.x + 'px', borderColor: s.color }
            : { top: s.y + 'px', left: s.kind === 'hray' ? s.x + 'px' : '0px', borderColor: s.color }
        "
      ></div>
    </div>

    <!-- Interaction layer: invisible duplicates of the same geometry sitting
         ABOVE the candles, carrying hit-testing, the selection handles and
         the context-menu target — so a behind-the-candles rectangle stays
         selectable and resizable. -->
    <div
      class="drawing-hit-layer drawing-clip"
      :class="{ 'drawing-mode': drawingToolActive || replay.picking }"
      :style="{ right: axisRightW + 'px', bottom: axisBottomH + 'px' }"
    >
      <div
        v-for="rect in hitRects"
        :key="rect.id"
        class="drawing-hit-rect"
        :class="{ selected: rect.selected, 'border-only': rect.filled === false }"
        :data-rect-id="rect.id === '__preview' ? null : rect.id"
        :style="{
          left: rect.left + 'px',
          top: rect.top + 'px',
          width: rect.width + 'px',
          height: rect.height + 'px',
        }"
        @pointerdown.stop="onRectDragStart($event, rect.id)"
        @click.stop="onRectClick(rect.id, $event)"
      >
        <!-- Border-only rectangles: the body is click-transparent (clicks
             pass to the chart), only the 4 edge strips select/drag. -->
        <template v-if="rect.filled === false">
          <div class="rect-edge-hit top" @pointerdown.stop="onRectDragStart($event, rect.id)" @click.stop="onRectClick(rect.id, $event)"></div>
          <div class="rect-edge-hit bottom" @pointerdown.stop="onRectDragStart($event, rect.id)" @click.stop="onRectClick(rect.id, $event)"></div>
          <div class="rect-edge-hit left" @pointerdown.stop="onRectDragStart($event, rect.id)" @click.stop="onRectClick(rect.id, $event)"></div>
          <div class="rect-edge-hit right" @pointerdown.stop="onRectDragStart($event, rect.id)" @click.stop="onRectClick(rect.id, $event)"></div>
        </template>
        <template v-if="rect.selected">
          <div class="resize-handle nw" @pointerdown.stop.prevent="onResizeStart($event, 'nw')"></div>
          <div class="resize-handle ne" @pointerdown.stop.prevent="onResizeStart($event, 'ne')"></div>
          <div class="resize-handle sw" @pointerdown.stop.prevent="onResizeStart($event, 'sw')"></div>
          <div class="resize-handle se" @pointerdown.stop.prevent="onResizeStart($event, 'se')"></div>
          <div class="resize-handle n" @pointerdown.stop.prevent="onResizeStart($event, 'n')"></div>
          <div class="resize-handle s" @pointerdown.stop.prevent="onResizeStart($event, 's')"></div>
          <div class="resize-handle w" @pointerdown.stop.prevent="onResizeStart($event, 'w')"></div>
          <div class="resize-handle e" @pointerdown.stop.prevent="onResizeStart($event, 'e')"></div>
        </template>
      </div>

      <!-- Trendline hit-testing sits AFTER the rectangle hit-rects in DOM
           order: when a line crosses a rectangle body, the line's fat
           transparent stroke wins the pointer so it stays selectable. -->
      <svg class="trend-hit-svg">
        <g v-for="t in hitTrends" :key="t.id">
          <line
            :x1="t.x1" :y1="t.y1" :x2="t.x2" :y2="t.y2"
            class="trend-hit"
            :class="{ selected: t.selected }"
            stroke="transparent"
            stroke-width="14"
            stroke-linecap="round"
            @pointerdown.stop="onTrendDragStart($event, t.id)"
            @click.stop="onTrendClick(t.id, $event)"
          />
          <template v-if="t.selected">
            <circle
              :cx="t.x1" :cy="t.y1" r="5"
              class="trend-handle"
              @pointerdown.stop.prevent="onTrendHandleStart($event, t.id, 1)"
            />
            <circle
              :cx="t.x2" :cy="t.y2" r="5"
              class="trend-handle"
              @pointerdown.stop.prevent="onTrendHandleStart($event, t.id, 2)"
            />
          </template>
        </g>
      </svg>

      <!-- Polyline hit-testing: fat transparent stroke over the whole path
           plus a handle on every vertex when selected. -->
      <svg class="trend-hit-svg poly-hit-svg">
        <g v-for="p in hitPolys" :key="p.id">
          <polyline
            :points="p.pts.map((q) => q.x + ',' + q.y).join(' ')"
            class="trend-hit"
            fill="none"
            stroke="transparent"
            stroke-width="14"
            stroke-linecap="round"
            stroke-linejoin="round"
            @pointerdown.stop="onPolyDragStart($event, p.id)"
            @click.stop="onPolyClick(p.id, $event)"
          />
          <template v-if="p.selected">
            <circle
              v-for="q in p.pts"
              :key="q.src"
              :cx="q.x" :cy="q.y" r="5"
              class="trend-handle"
              @pointerdown.stop.prevent="onPolyVertexStart($event, p.id, q.src)"
            />
          </template>
        </g>
      </svg>

      <!-- Long/Short position hit areas: full body (move), the three price
           level lines (resize entry/TP/SL), the two time edges, and corner
           handles on every level end. -->
      <div
        v-for="p in posPixels"
        v-show="p.id !== '__pospreview'"
        :key="p.id"
        class="pos-hit"
        :class="{ selected: p.selected }"
        :style="{
          left: p.left + 'px',
          top: Math.min(p.tpY, p.slY) + 'px',
          width: p.width + 'px',
          height: Math.abs(p.slY - p.tpY) + 'px',
        }"
        @pointerdown.stop="onPosDragStart($event, p.id)"
        @click.stop="onPosClick(p.id, $event)"
      >
        <template v-if="p.selected">
          <div
            class="pos-level-hit"
            :style="{ top: p.tpY - Math.min(p.tpY, p.slY) - 4 + 'px' }"
            @pointerdown.stop.prevent="onPosLevelStart($event, p.id, 'tp')"
          ></div>
          <div
            class="pos-level-hit"
            :style="{ top: p.entryY - Math.min(p.tpY, p.slY) - 4 + 'px' }"
            @pointerdown.stop.prevent="onPosLevelStart($event, p.id, 'entry')"
          ></div>
          <div
            class="pos-level-hit"
            :style="{ top: p.slY - Math.min(p.tpY, p.slY) - 4 + 'px' }"
            @pointerdown.stop.prevent="onPosLevelStart($event, p.id, 'sl')"
          ></div>
          <div
            class="pos-edge-hit"
            :style="{ left: '-3px' }"
            @pointerdown.stop.prevent="onPosEdgeStart($event, p.id, 'time1')"
          ></div>
          <div
            class="pos-edge-hit"
            :style="{ right: '-3px' }"
            @pointerdown.stop.prevent="onPosEdgeStart($event, p.id, 'time2')"
          ></div>
          <!-- corner handles at both ends of each level line: vertical drag
               resizes the level's price, horizontal drag resizes the width -->
          <div
            v-for="(lvl, li) in [
              { y: p.tpY - Math.min(p.tpY, p.slY), kind: 'tp' },
              { y: p.entryY - Math.min(p.tpY, p.slY), kind: 'entry' },
              { y: p.slY - Math.min(p.tpY, p.slY), kind: 'sl' },
            ]"
            :key="li"
          >
            <div
              class="resize-handle pos-handle"
              :style="{ top: lvl.y - 4 + 'px', left: '-4px' }"
              @pointerdown.stop.prevent="onPosCornerStart($event, p.id, lvl.kind as any, 'time1')"
            ></div>
            <div
              class="resize-handle pos-handle"
              :style="{ top: lvl.y - 4 + 'px', right: '-4px' }"
              @pointerdown.stop.prevent="onPosCornerStart($event, p.id, lvl.kind as any, 'time2')"
            ></div>
          </div>
        </template>
      </div>

      <!-- One-click line hit areas: fat invisible strips over each line -->
      <div
        v-for="s in singlePixels"
        :key="'hit-' + s.id"
        class="single-hit"
        :class="s.kind"
        :style="
          s.kind === 'vline'
            ? { left: s.x - 4 + 'px' }
            : { top: s.y - 4 + 'px', left: s.kind === 'hray' ? s.x - 4 + 'px' : '0px' }
        "
        @pointerdown.stop="onSingleDragStart($event, s.kind, s.id)"
        @click.stop="onSingleClick(s.kind, s.id, $event)"
      ></div>

      <!-- One-click line resize corners: middle of hline / middle of vline /
           left anchor of hray (drags like the trendline end dots) -->
      <template v-for="s in singlePixels" :key="'hd-' + s.id">
        <div
          v-if="s.selected"
          class="resize-handle single-handle"
          :class="s.kind"
          :style="{ top: s.hy - 4 + 'px', left: s.hx - 4 + 'px' }"
          @pointerdown.stop.prevent="onSingleDragStart($event, s.kind, s.id)"
        ></div>
      </template>
    </div>

    <!-- Position labels: R:R centered on the entry line (always visible);
         TP/SL % + pips centered on their lines while selected. When the box
         is narrower than a label the % stats move just INSIDE the box —
         below the TP line and above the SL line — instead of beside it. -->
    <div
      class="pos-label-layer drawing-clip"
      :style="{ right: axisRightW + 'px', bottom: axisBottomH + 'px' }"
    >
      <template v-for="p in posPixels" :key="p.id">
        <template v-if="p.id !== '__pospreview'">
          <span
            class="pos-label entry"
            :style="{ top: p.entryY - 9 + 'px', left: p.left + p.width / 2 + 'px', transform: 'translateX(-50%)' }"
          >{{ p.rr.toFixed(1) }}</span>
          <template v-if="p.selected">
            <span
              class="pos-label tp"
              :style="{
                top: (p.width >= 140 ? p.tpY - 9 : (p.direction === 'long' ? p.tpY - 27 : p.tpY + 9)) + 'px',
                left: p.left + p.width / 2 + 'px',
                transform: 'translateX(-50%)',
              }"
            >TP {{ p.tpPct >= 0 ? '+' : '' }}{{ p.tpPct.toFixed(2) }}% · {{ p.tpPips.toFixed(1) }} pips</span>
            <span
              class="pos-label sl"
              :style="{
                top: (p.width >= 140 ? p.slY - 9 : (p.direction === 'long' ? p.slY + 9 : p.slY - 27)) + 'px',
                left: p.left + p.width / 2 + 'px',
                transform: 'translateX(-50%)',
              }"
            >SL {{ p.slPct >= 0 ? '+' : '' }}{{ p.slPct.toFixed(2) }}% · {{ p.slPips.toFixed(1) }} pips</span>
          </template>
          <span
            v-for="l in p.levels"
            :key="l.r"
            class="pos-label rline"
            :style="{ top: l.y - 9 + 'px', left: p.left + p.width + 6 + 'px' }"
          >{{ l.r }}</span>
        </template>
      </template>
    </div>

    <!-- Axis tags for one-click lines (unclipped so they sit ON the scales):
         vertical line → time/date tag on the time scale (always); horizontal
         line / ray → current price tag on the price scale while selected. -->
    <div class="single-tag-layer">
      <template v-for="s in singlePixels" :key="'tag-' + s.id">
        <div
          v-if="s.kind === 'vline'"
          class="single-time-tag"
          :class="{ selected: s.selected }"
          :style="{ left: s.x + 'px', bottom: Math.max(2, axisBottomH / 2 - 9) + 'px' }"
        >{{ fmtAxisTime(s.time) }}</div>
        <div
          v-else-if="s.selected"
          class="single-price-tag"
          :style="{ top: s.y - 9 + 'px', background: s.color }"
        >{{ fmtPrice(s.price, instrumentPrecision(market.instrument)) }}</div>
      </template>
    </div>

    <!-- Magnet snapping crosshair: replaces the native crosshair while a
         drawing tool + magnet are active — sticks to candle high/low and
         shows the snapped price/time on the axes. -->
    <template v-if="snapXhair && drawingToolActive && magnetActive">
      <div
        class="xhair-line v"
        :style="{ left: snapXhair.x + 'px', bottom: axisBottomH + 'px' }"
      ></div>
      <div
        class="xhair-line h"
        :style="{ top: snapXhair.y + 'px', right: axisRightW + 'px' }"
      ></div>
      <div
        class="single-price-tag"
        :style="{ top: snapXhair.y - 9 + 'px', background: '#2962ff' }"
      >{{ snapXhair.priceText }}</div>
      <div
        class="single-time-tag"
        :style="{ left: snapXhair.x + 'px', bottom: Math.max(2, axisBottomH / 2 - 9) + 'px' }"
      >{{ snapXhair.timeText }}</div>
    </template>

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
          v-for="c in drawingsStore.PANEL_COLORS"
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

    <!-- Edit panel for selected trendline (anchored to its right endpoint) -->
    <div
      v-if="selectedLine && linePanelPos"
      ref="linePanelEl"
      class="rect-edit-panel"
      :style="{ left: linePanelPos.x + 'px', top: linePanelPos.y + 'px' }"
      @click.stop
    >
      <div class="edit-colors">
        <button
          v-for="c in drawingsStore.PANEL_COLORS"
          :key="c"
          class="color-swatch"
          :class="{ active: selectedLine.color === c }"
          :style="{ backgroundColor: c }"
          @click="setLineColorSelected(c)"
        />
        <div class="palette-anchor">
          <button
            class="color-more"
            :class="{ active: linePaletteOpen }"
            title="More colors"
            @click.stop="linePaletteOpen = !linePaletteOpen"
          >＋</button>
          <div v-if="linePaletteOpen" class="palette-pop" @click.stop>
            <button
              v-for="c in drawingsStore.PRESET_COLORS"
              :key="c"
              class="color-swatch"
              :class="{ active: selectedLine.color === c }"
              :style="{ backgroundColor: c }"
              @click="setLineColorSelected(c); linePaletteOpen = false"
            />
          </div>
        </div>
      </div>
      <span class="panel-divider" />
      <div class="dash-row" title="Line style">
        <button
          v-for="d in DASH_STYLES"
          :key="d"
          class="dash-btn"
          :class="{ active: selectedLine.dash === d }"
          :title="d.charAt(0).toUpperCase() + d.slice(1)"
          @click="setLineDashSelected(d)"
        >
          <span class="dash-sample" :class="d"></span>
        </button>
      </div>
      <span class="panel-divider" />
      <button class="edit-btn danger" @click="deleteSelectedLine" title="Delete trendline">
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

    <!-- Edit panel for selected polyline (anchored at its last corner) -->
    <div
      v-if="selectedPoly && polyPanelPos"
      ref="polyPanelEl"
      class="rect-edit-panel"
      :style="{ left: polyPanelPos.x + 'px', top: polyPanelPos.y + 'px' }"
      @click.stop
    >
      <div class="edit-colors">
        <button
          v-for="c in drawingsStore.PANEL_COLORS"
          :key="c"
          class="color-swatch"
          :class="{ active: selectedPoly.color === c }"
          :style="{ backgroundColor: c }"
          @click="setPolyColorSelected(c)"
        />
        <div class="palette-anchor">
          <button
            class="color-more"
            :class="{ active: polyPaletteOpen }"
            title="More colors"
            @click.stop="polyPaletteOpen = !polyPaletteOpen"
          >＋</button>
          <div v-if="polyPaletteOpen" class="palette-pop" @click.stop>
            <button
              v-for="c in drawingsStore.PRESET_COLORS"
              :key="c"
              class="color-swatch"
              :class="{ active: selectedPoly.color === c }"
              :style="{ backgroundColor: c }"
              @click="setPolyColorSelected(c); polyPaletteOpen = false"
            />
          </div>
        </div>
      </div>
      <span class="panel-divider" />
      <div class="dash-row" title="Line style">
        <button
          v-for="d in DASH_STYLES"
          :key="d"
          class="dash-btn"
          :class="{ active: selectedPoly.dash === d }"
          :title="d.charAt(0).toUpperCase() + d.slice(1)"
          @click="setPolyDashSelected(d)"
        >
          <span class="dash-sample" :class="d"></span>
        </button>
      </div>
      <span class="panel-divider" />
      <button
        class="edit-btn"
        :class="{ off: selectedPoly.arrow === false }"
        :title="selectedPoly.arrow === false ? 'Add arrow on last corner' : 'Remove arrow'"
        @click="toggleArrowSelected"
      >
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
          <path d="M2.5 12.5 L10.5 6.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
          <path d="M8.2 4.9 L13.6 4.4 L12.6 9.6 Z" fill="currentColor" stroke="none" />
        </svg>
      </button>
      <button class="edit-btn danger" @click="deleteSelectedPoly" title="Delete polyline">
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

    <!-- Edit panel for the selected Long/Short position -->
    <div
      v-if="selectedPos && posPanelPos"
      ref="posPanelEl"
      class="rect-edit-panel"
      :style="{ left: posPanelPos.x + 'px', top: posPanelPos.y + 'px', visibility: posPanelReady ? 'visible' : 'hidden' }"
      @click.stop
    >
      <button
        class="edit-btn"
        :class="{ off: selectedPos.showLevels === false }"
        :title="selectedPos.showLevels === false ? 'Show 1R..NR reward lines' : 'Hide reward lines'"
        @click="togglePosLevels"
      >
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
          <path d="M3 4.5h10" />
          <path d="M3 8h10" stroke-dasharray="2.5 2" />
          <path d="M3 11.5h10" stroke-dasharray="2.5 2" />
        </svg>
      </button>
      <button class="edit-btn danger" @click="deleteSelectedPos" title="Delete position">
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

    <!-- Replay mode: vertical line while picking the start point -->
    <div
      v-if="replay.active && replay.picking"
      class="replay-layer drawing-clip"
      :style="{ right: axisRightW + 'px', bottom: axisBottomH + 'px' }"
    >
      <div
        v-if="replayVlX !== null"
        class="replay-vl picking"
        :style="{ left: replayVlX + 'px' }"
      >
        <span class="replay-vl-knob">▶</span>
      </div>
    </div>

    <!-- Replay price tag: under the live price label on the price scale -->
    <div v-if="replayTag" class="replay-price-tag" :style="{ top: replayTag.y + 'px' }">{{ replayTag.text }}</div>

    <!-- Demo trading: entry/SL/TP lines for the active symbol's positions
         and pending orders, with drag strips and price tags on the scale -->
    <template v-if="demo.active">
      <div class="demo-lines drawing-clip" :style="{ right: axisRightW + 'px', bottom: (axisBottomH + demoBottomH) + 'px' }">
        <div
          v-for="l in demoLines"
          :key="l.id + l.level"
          class="demo-line"
          :class="[l.level, { dashed: l.dashed }]"
          :style="{ top: l.y + 'px', background: l.color }"
        ></div>
        <!-- Left-edge line labels for open positions AND pending orders:
             lot + $ loss on the SL line, $ reward + R:R on the TP line -->
        <template v-for="p in demo.positions.filter((x) => x.symbol === market.instrument && x.status !== 'closed')" :key="'lbl-' + p.id">
          <div
            v-for="l in demoLines.filter((x) => x.id === p.id)"
            :key="'lbl-' + l.level"
            class="demo-line-label"
            :class="l.level"
            :style="{ top: l.y - 10 + 'px' }"
          >
            <template v-if="l.level === 'entry'">ENTRY {{ p.lot }} lot &#183; @{{ p.entry.toFixed(prec) }}</template>
            <template v-else-if="l.level === 'sl'">SL {{ p.lot }} lot &#183; -${{ l.money }}</template>
            <template v-else-if="l.level === 'tp'">TP ${{ l.money }} &#183; R:R {{ l.rr }}</template>
          </div>
        </template>
      </div>
      <div class="demo-hit-layer" :class="{ 'drawing-mode': replay.picking }" :style="{ right: axisRightW + 'px', bottom: (axisBottomH + demoBottomH) + 'px' }">
        <div
          v-for="l in demoLines"
          :key="'dhit-' + l.id + l.level"
          class="demo-line-hit"
          :style="{ top: l.y - 4 + 'px' }"
          @pointerdown.stop.prevent="onDemoLineDragStart($event, l.id, l.level)"
        ></div>
      </div>
      <div class="demo-tag-layer" :style="{ bottom: (axisBottomH + demoBottomH) + 'px' }">
        <template v-for="l in demoLines" :key="'tag-' + l.id + l.level">
          <div
            v-if="(l.level !== 'entry' || l.status === 'pending') && l.y >= 9 && l.y <= demoChartH - 10"
            class="demo-axis-tag"
            :class="l.level"
            :style="{ top: l.y - 9 + 'px' }"
          >{{ l.price.toFixed(prec) }}</div>
        </template>
      </div>
    </template>

    <!-- Demo money management (compact, top-right, collapsible) -->
    <div v-if="demo.active" class="demo-mgr" :class="{ mini: demoMini }">
      <div class="demo-mgr-head">
        <span v-if="!demoMini" class="demo-mgr-title">DEMO</span>
        <button class="demo-mini-btn" :title="demoMini ? 'Expand' : 'Minimize'" @click.stop="demoMini = !demoMini">{{ demoMini ? "+" : "−" }}</button>
      </div>
      <template v-if="!demoMini">
        <div class="demo-size-modes">
          <button class="demo-mode" :class="{ active: demo.sizeMode === 'lot' }" title="Size by lot (risk $ per SL)" @click.stop="demo.sizeMode = 'lot'">Lot</button>
          <button class="demo-mode" :class="{ active: demo.sizeMode === 'percent' }" title="Risk = % of balance" @click.stop="demo.sizeMode = 'percent'">%</button>
          <button class="demo-mode" :class="{ active: demo.sizeMode === 'usd' }" title="Risk = entered $ amount" @click.stop="demo.sizeMode = 'usd'">$</button>
        </div>
        <label v-if="demo.sizeMode === 'lot'" class="demo-mgr-inp"><span>Lot</span><input type="number" min="0.01" step="0.01" v-model.number="demo.lot" /></label>
        <label v-if="demo.sizeMode === 'usd'" class="demo-mgr-inp"><span>Risk $</span><input type="number" min="1" step="1" v-model.number="demo.riskUsd" /></label>
        <label v-if="demo.sizeMode === 'percent'" class="demo-mgr-inp"><span>Risk %</span><input type="number" min="0.1" step="0.1" v-model.number="demo.riskPct" /></label>
        <div class="demo-mgr-btns">
          <button class="dm-btn buy" title="Buy Limit — lines draw on the chart, then Set" @click.stop="armDemo('long', 'limit')">Buy Lim</button>
          <button class="dm-btn sell" title="Sell Limit — lines draw on the chart, then Set" @click.stop="armDemo('short', 'limit')">Sell Lim</button>
          <button class="dm-btn buy" title="Market Buy — lines draw, then Set fills at market" @click.stop="armDemo('long', 'market')">Buy</button>
          <button class="dm-btn sell" title="Market Sell — lines draw, then Set fills at market" @click.stop="armDemo('short', 'market')">Sell</button>
        </div>
        <div v-if="draft" class="demo-draft-btns">
          <button class="dm-btn set" title="Place the order" @click.stop="setDemoDraft">Set</button>
          <button class="dm-btn cancel" title="Cancel" @click.stop="cancelDemoDraft">✕</button>
        </div>
        <div v-if="demo.error" class="demo-err">{{ demo.error }}</div>
      </template>
    </div>

    <!-- Replay control panel: when the demo panel is open it sits above
         it, right of the Open P/L stat -->
    <div
      v-if="replay.active"
      class="replay-panel"
      :class="{ 'demo-shift': demo.active }"
      :style="demo.active ? { bottom: demoBottomH + 6 + 'px', right: '12px', left: 'auto', transform: 'none' } : undefined"
    >
      <template v-if="replay.picking">
        <span class="replay-hint">Replay — click a candle to start</span>
        <button class="rp-btn accent" title="Start replay at the line" @click="togglePlay">▶</button>
        <button class="rp-btn danger" title="Exit replay" @click="replay.exit()">✕</button>
      </template>
      <template v-else>
        <button
          class="rp-btn"
          title="Step back (hold to repeat)"
          @pointerdown.prevent="holdStep(-1)"
          @mouseup="stopHold"
          @mouseleave="stopHold"
        >⏮</button>
        <button class="rp-btn accent" :title="replay.playing ? 'Pause' : 'Play'" @click="togglePlay">
          {{ replay.playing ? "⏸" : "▶" }}
        </button>
        <button
          class="rp-btn"
          title="Step forward (hold to repeat)"
          @pointerdown.prevent="holdStep(1)"
          @mouseup="stopHold"
          @mouseleave="stopHold"
        >⏭</button>
        <span class="rp-sep" />
        <button
          v-for="s in [1, 2, 5, 10]"
          :key="s"
          class="rp-btn speed"
          :class="{ active: replay.speed === s }"
          :title="`Speed ${s}x`"
          @click="replay.speed = s as any"
        >{{ s }}x</button>
        <span class="rp-sep" />
        <button class="rp-btn danger" title="Exit replay" @click="replay.exit()">✕</button>
      </template>
    </div>

    <!-- Edit panel for the selected one-click line -->
    <div
      v-if="drawingsStore.selectedSingle && singlePanelPos"
      ref="singlePanelEl"
      class="rect-edit-panel"
      :style="{ left: singlePanelPos.x + 'px', top: singlePanelPos.y + 'px', visibility: singlePanelReady ? 'visible' : 'hidden' }"
      @click.stop
    >
      <div class="edit-colors">
        <button
          v-for="c in drawingsStore.PANEL_COLORS"
          :key="c"
          class="color-swatch"
          :class="{ active: getSingle(drawingsStore.selectedSingle.kind, drawingsStore.selectedSingle.id)?.color === c }"
          :style="{ backgroundColor: c }"
          @click="setSingleColor(c)"
        />
      </div>
      <span class="panel-divider" />
      <div class="dash-row" title="Line style">
        <button
          v-for="d in DASH_STYLES"
          :key="d"
          class="dash-btn"
          :class="{ active: getSingle(drawingsStore.selectedSingle.kind, drawingsStore.selectedSingle.id)?.dash === d }"
          :title="d.charAt(0).toUpperCase() + d.slice(1)"
          @click="setSingleDash(d)"
        >
          <span class="dash-sample" :class="d"></span>
        </button>
      </div>
      <span class="panel-divider" />
      <button class="edit-btn danger" @click="deleteSelectedSingle" title="Delete line">
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
          v-for="c in drawingsStore.PANEL_COLORS"
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
      :class="{ 'rect-mode': drawingToolActive }"
      @click="onChartClick"
    />

    <!-- Demo positions / history / stats panel (under the chart) -->
    <div v-if="demo.active" class="demo-bottom">
      <div class="demo-bottom-head">
        <span class="demo-badge">DEMO</span>
        <span class="demo-stat">Balance <b>{{ fmtMoney(demo.balance) }}</b></span>
        <span class="demo-stat">Equity <b>{{ fmtMoney(demo.equity) }}</b></span>
        <span class="demo-stat">Open P/L <b :class="pnlClass(demo.unrealized)">{{ fmtMoney(demo.unrealized) }}</b></span>
        <span class="demo-flex" />
        <button class="demo-reset" title="Reset demo account to $100,000" @click="demo.resetAccount()">Reset</button>
      </div>
      <div class="demo-tabs">
        <button class="demo-tab" :class="{ active: demoTab === 'positions' }" @click="demoTab = 'positions'">Positions ({{ demo.openPositions.length + pendingOrders.length }})</button>
        <button class="demo-tab" :class="{ active: demoTab === 'history' }" @click="demoTab = 'history'">History ({{ demo.closedPositions.length }})</button>
        <button class="demo-tab" :class="{ active: demoTab === 'stats' }" @click="demoTab = 'stats'">Stats</button>
        <span class="demo-flex" />
        <template v-if="demoTab === 'stats'">
          <button v-for="p in ['day', 'week', 'month', 'all']" :key="p" class="demo-period" :class="{ active: demoPeriod === p }" @click="demoPeriod = p as any">{{ p === 'day' ? 'Day' : p === 'week' ? 'Week' : p === 'month' ? 'Month' : 'All' }}</button>
        </template>
      </div>
      <div v-if="demoTab === 'positions'" class="demo-table">
        <div v-if="!demo.openPositions.length && !pendingOrders.length" class="demo-empty">No open positions — place a trade from the toolbar above the chart.</div>
        <table v-if="demo.openPositions.length">
          <thead><tr><th>Symbol</th><th>Side</th><th>Lot</th><th>Entry</th><th>SL</th><th>TP</th><th>P/L $</th><th>P/L %</th><th></th></tr></thead>
          <tbody>
            <tr v-for="p in demo.openPositions" :key="p.id">
              <td>{{ p.symbol.replace('_', '/') }}</td>
              <td :class="p.direction === 'long' ? 'pos' : 'neg'">{{ p.direction === 'long' ? 'LONG' : 'SHORT' }}</td>
              <td>{{ p.lot }}</td>
              <td>{{ p.entry }}</td>
              <td>{{ p.sl ?? '-' }}</td>
              <td>{{ p.tp ?? '-' }}</td>
              <td :class="pnlClass(demo.pnlFor(p, p.lastPrice ?? p.entry))">{{ fmtMoney(demo.pnlFor(p, p.lastPrice ?? p.entry)) }}</td>
              <td :class="pnlClass(((p.lastPrice ?? p.entry) - p.entry) * (p.direction === 'long' ? 1 : -1))">{{ (((p.lastPrice ?? p.entry) - p.entry) * (p.direction === 'long' ? 1 : -1) * 100 / p.entry).toFixed(2) }}%</td>
              <td><button class="demo-close" title="Close position" @click="demo.closeAtMarket(p.id)">✕</button></td>
            </tr>
          </tbody>
        </table>
        <table v-if="pendingOrders.length">
          <thead><tr><th colspan="6" style="text-align:left">Pending orders</th><th></th><th></th><th></th></tr></thead>
          <tbody>
            <tr v-for="p in pendingOrders" :key="p.id">
              <td>{{ p.symbol.replace('_', '/') }}</td>
              <td :class="p.direction === 'long' ? 'pos' : 'neg'">{{ p.direction === 'long' ? 'BUY LIM' : 'SELL LIM' }}</td>
              <td>{{ p.lot }}</td>
              <td>{{ p.entry }}</td>
              <td>{{ p.sl ?? '-' }}</td>
              <td>{{ p.tp ?? '-' }}</td>
              <td></td>
              <td></td>
              <td><button class="demo-close" title="Delete pending order" @click="demo.removePending(p.id)">✕</button></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else-if="demoTab === 'history'" class="demo-table">
        <div v-if="!demo.closedPositions.length" class="demo-empty">No closed trades yet.</div>
        <table v-else>
          <thead><tr><th>Symbol</th><th>Side</th><th>Lot</th><th>Entry</th><th>Exit</th><th>Reason</th><th>P/L $</th><th>P/L %</th><th>Closed</th></tr></thead>
          <tbody>
            <tr v-for="p in [...demo.closedPositions].reverse()" :key="p.id">
              <td>{{ p.symbol.replace('_', '/') }}</td>
              <td :class="p.direction === 'long' ? 'pos' : 'neg'">{{ p.direction === 'long' ? 'LONG' : 'SHORT' }}</td>
              <td>{{ p.lot }}</td>
              <td>{{ p.entry }}</td>
              <td>{{ p.closePrice }}</td>
              <td>{{ (p.closeReason ?? '').toUpperCase() }}</td>
              <td :class="pnlClass(p.pnl)">{{ fmtMoney(p.pnl ?? 0) }}</td>
              <td :class="pnlClass(p.pnlPct)">{{ (p.pnlPct ?? 0) >= 0 ? '+' : '' }}{{ (p.pnlPct ?? 0).toFixed(2) }}%</td>
              <td>{{ p.closeTime ? new Date(p.closeTime * 1000).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else class="demo-table">
        <div class="demo-stats">
          <div class="demo-stat-card"><span>Trades</span><b>{{ demoSummary.trades }}</b></div>
          <div class="demo-stat-card"><span>Wins</span><b>{{ demoSummary.wins }}</b></div>
          <div class="demo-stat-card"><span>Winrate</span><b>{{ demoSummary.winrate }}%</b></div>
          <div class="demo-stat-card"><span>Profit factor</span><b>{{ demoSummary.profitFactor ?? '-' }}</b></div>
          <div class="demo-stat-card"><span :class="pnlClass(demoSummary.profit)">P/L %</span><b :class="pnlClass(demoSummary.profit)">{{ demoSummary.profitPct >= 0 ? '+' : '' }}{{ demoSummary.profitPct.toFixed(2) }}%</b></div>
          <div class="demo-stat-card"><span>Gross profit</span><b class="pos">{{ fmtMoney(demoSummary.grossProfit) }}</b></div>
          <div class="demo-stat-card"><span>Gross loss</span><b class="neg">{{ fmtMoney(demoSummary.grossLoss) }}</b></div>
          <div class="demo-stat-card"><span>Symbols</span><b>{{ demo.tradedSymbols.length }}</b></div>
        </div>
      </div>
    </div>
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
  /* cross cursor over the chart at all times (TradingView-style) */
  cursor: crosshair;
  /* Chart gestures (pan, pinch, price-axis drag, drawing drags) are handled
     by Lightweight Charts and the drawing pointer handlers. With the default
     `auto`, the phone/tablet browser claims the touch for scroll arbitration
     and fires pointercancel mid-gesture — drawings never land and axis drags
     die instantly. `none` keeps every gesture inside the chart handlers. */
  touch-action: none;
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
/* Clip overlay children (boxes, hit areas, handles) to the chart area so
   nothing renders over or can be drawn on the price/time scales. */
.drawing-clip {
  overflow: hidden;
}
.drawing-hit-layer {
  position: absolute;
  inset: 0;
  z-index: 3;
  pointer-events: none;
}
/* Touch: a finger-drag on a drawing must move the drawing, not scroll the
   page — without this the browser fires pointercancel mid-gesture */
.drawing-hit-rect,
.rect-edge-hit,
.resize-handle,
.trend-hit,
.trend-handle,
.pos-hit,
.pos-level-hit,
.pos-edge-hit,
.single-hit,
.demo-line-hit {
  touch-action: none;
}
/* While a drawing tool is active, existing drawings must not swallow
   the press, and the live preview is never interactive. */
.drawing-hit-layer.drawing-mode .drawing-hit-rect,
.drawing-hit-layer.drawing-mode .rect-edge-hit,
.drawing-hit-layer.drawing-mode .trend-hit,
.drawing-hit-layer.drawing-mode .trend-handle,
.drawing-hit-layer.drawing-mode .pos-hit,
.drawing-hit-layer.drawing-mode .pos-level-hit,
.drawing-hit-layer.drawing-mode .pos-edge-hit,
.drawing-hit-layer.drawing-mode .pos-handle,
.drawing-hit-layer.drawing-mode .single-hit,
.drawing-hit-layer.drawing-mode .single-handle {
  pointer-events: none;
}
/* Replay pick mode: the click must cut the chart, never select a drawing
   or grab a demo line — all hit targets go click-transparent. */
.demo-hit-layer.drawing-mode .demo-line-hit {
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
/* Border-only rectangles: the body passes clicks through to the chart —
   only the 4 edge strips (the visible border area) select/drag. */
.drawing-hit-rect.border-only {
  pointer-events: none;
}
.rect-edge-hit {
  position: absolute;
  pointer-events: auto;
  cursor: move;
}
.rect-edge-hit.top {
  top: -4px;
  left: 0;
  right: 0;
  height: 8px;
}
.rect-edge-hit.bottom {
  bottom: -4px;
  left: 0;
  right: 0;
  height: 8px;
}
.rect-edge-hit.left {
  left: -4px;
  top: 0;
  bottom: 0;
  width: 8px;
}
.rect-edge-hit.right {
  right: -4px;
  top: 0;
  bottom: 0;
  width: 8px;
}
.drawing-hit-rect.selected {
  cursor: move;
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

/* ── Trendline SVG layers ─────────────────────────────────────────────── */
.trend-svg,
.trend-hit-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  pointer-events: none;
}
/* Fat transparent stroke grabs the pointer; handles sit on top of it */
.trend-hit {
  pointer-events: stroke;
  cursor: move;
}
.trend-hit:hover {
  cursor: pointer;
}
.trend-handle {
  pointer-events: all;
  fill: #fff;
  stroke: #2962ff;
  stroke-width: 1.5;
  cursor: pointer;
}
/* Invisible halo doubling the grab area of each handle */
.trend-handle::before {
  content: "";
  position: absolute;
  inset: -6px;
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
/* Phones/tablets: the panel row is ~366px wide — on a small pane the delete
   button would land off-chart (clipped by the pane). Let it wrap and cap it
   to the viewport instead, with slightly larger touch targets. */
@media (max-width: 640px) {
  .rect-edit-panel {
    max-width: calc(100vw - 24px);
    flex-wrap: wrap;
    row-gap: 6px;
    padding: 5px 6px;
  }
  .edit-btn {
    width: 30px;
    height: 30px;
  }
  .color-swatch {
    width: 20px;
    height: 20px;
  }
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
/* Dash style switcher row (trendline edit panel) */
.dash-row {
  display: inline-flex;
  gap: 4px;
}
.dash-btn {
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
  transition: all 140ms;
}
.dash-btn:hover {
  color: var(--accent);
  border-color: var(--accent);
}
.dash-btn.active {
  color: var(--accent);
  border-color: var(--accent);
  background: rgba(41, 98, 255, 0.1);
}
.dash-sample {
  display: block;
  width: 16px;
  border-top: 2px solid currentColor;
}
.dash-sample.dotted {
  border-top-style: dotted;
  border-top-width: 3px;
}
.dash-sample.dashed {
  border-top-style: dashed;
}

/* ── Long / Short position layers ────────────────────────────────────── */
.pos-svg {
  /* inherits .trend-svg geometry (absolute inset 0, pointer-events none) */
}
.pos-hit {
  position: absolute;
  pointer-events: auto;
  cursor: move;
  /* invisible: geometry only */
}
.pos-level-hit {
  position: absolute;
  left: 0;
  right: 0;
  height: 8px;
  cursor: ns-resize;
}
.pos-edge-hit {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 6px;
  cursor: ew-resize;
}
.pos-handle {
  cursor: grab;
}
.pos-label-layer {
  position: absolute;
  inset: 0;
  /* BELOW the hit layer (3) so the corner handles never hide behind a
     label, but still above the candle canvas (1) and the drawing boxes. */
  z-index: 2;
  pointer-events: none;
}
.pos-label {
  position: absolute;
  font-size: 10px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  padding: 1px 5px;
  border-radius: 4px;
  white-space: nowrap;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  color: var(--text);
}
.pos-label.entry {
  color: var(--accent);
  border-color: rgba(41, 98, 255, 0.5);
}
.pos-label.tp {
  color: #26a69a;
  border-color: rgba(38, 166, 154, 0.5);
}
.pos-label.sl {
  color: #ef5350;
  border-color: rgba(239, 83, 80, 0.5);
}
.pos-label.rline {
  color: #26a69a;
  border-color: rgba(38, 166, 154, 0.35);
  min-width: 14px;
  text-align: center;
  padding: 1px 3px;
}
.pos-direction-badge {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.04em;
  padding: 3px 8px;
  border-radius: 6px;
  color: #fff;
  flex-shrink: 0;
}
.pos-direction-badge.long {
  background: #26a69a;
}
.pos-direction-badge.short {
  background: #ef5350;
}

/* ── One-click lines (hline / hray / vline) ──────────────────────────── */
.single-line {
  position: absolute;
  pointer-events: none;
}
.single-line.hline {
  left: 0;
  right: 0;
  border-top: 2px solid;
}
.single-line.hray {
  right: 0;
  border-top: 2px solid;
}
.single-line.vline {
  top: 0;
  bottom: 0;
  border-left: 2px solid;
}
.single-line.dashed {
  border-top-style: dashed;
  border-left-style: dashed;
}
.single-line.dotted {
  border-top-style: dotted;
  border-left-style: dotted;
}
.single-line.selected.hline,
.single-line.selected.hray {
  border-top-width: 3px;
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.25);
}
.single-line.selected.vline {
  border-left-width: 3px;
}
.single-hit {
  position: absolute;
  pointer-events: auto;
}
.single-hit.hline {
  left: 0;
  right: 0;
  height: 9px;
  cursor: ns-resize;
}
.single-hit.hray {
  right: 0;
  height: 9px;
  cursor: move;
}
.single-hit.vline {
  top: 0;
  bottom: 0;
  width: 9px;
  cursor: ew-resize;
}
/* Resize corners: middle of hline/vline, left anchor of hray */
.single-handle.hline {
  cursor: ns-resize;
}
.single-handle.vline {
  cursor: ew-resize;
}
.single-handle.hray {
  cursor: move;
}
/* Tags rendered ON the price/time scales (unclipped layer) */
.single-tag-layer {
  position: absolute;
  inset: 0;
  z-index: 5;
  pointer-events: none;
}
.single-price-tag,
.single-time-tag {
  position: absolute;
  font-size: 11px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: #fff;
  padding: 2px 6px;
  border-radius: 3px;
  white-space: nowrap;
  background: #2962ff;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
}
/* Price tag pinned to the price scale (flush right, like LWC's own labels) */
.single-price-tag {
  right: 0;
  border-radius: 3px 0 0 3px;
}
/* ── Magnet snapping crosshair ───────────────────────────────────────── */
.xhair-line {
  position: absolute;
  z-index: 6;
  pointer-events: none;
}
.xhair-line.v {
  top: 0;
  width: 0;
  border-left: 1px dashed rgba(117, 134, 150, 0.75);
}
.xhair-line.h {
  left: 0;
  height: 0;
  border-top: 1px dashed rgba(117, 134, 150, 0.75);
}
.single-time-tag {
  transform: translateX(-50%);
  background: var(--bg-panel);
  border: 1px solid var(--border);
  color: var(--text);
}
.single-time-tag.selected {
  border-color: var(--accent);
  color: var(--accent);
}

/* ── Replay mode ─────────────────────────────────────────────────────── */
.replay-layer {
  position: absolute;
  inset: 0;
  z-index: 4;
  pointer-events: none;
}
.replay-vl {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1.5px;
  background: var(--accent);
  box-shadow: 0 0 8px rgba(41, 98, 255, 0.5);
}
.replay-vl.picking {
  background: #f59e0b;
  box-shadow: 0 0 8px rgba(245, 158, 11, 0.5);
}
.replay-vl.playing {
  background: #26a69a;
  box-shadow: 0 0 8px rgba(38, 166, 154, 0.5);
}
.replay-vl-knob {
  position: absolute;
  top: 6px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--bg-panel);
  border: 1px solid var(--accent);
  color: var(--accent);
  border-radius: 4px;
  font-size: 8px;
  line-height: 1;
  padding: 2px 3px;
}
.replay-panel {
  position: absolute;
  bottom: 40px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 25;
  display: flex;
  align-items: center;
  gap: 5px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 6px 10px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3);
  pointer-events: auto;
}
.replay-hint {
  font-size: 11px;
  font-weight: 700;
  color: var(--text-muted);
  margin-right: 4px;
  white-space: nowrap;
}
.rp-btn {
  min-width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  padding: 0 6px;
  border: 1px solid var(--border);
  background: var(--btn-bg);
  color: var(--text);
  border-radius: 7px;
  cursor: pointer;
  font-size: 11px;
  font-weight: 700;
  flex-shrink: 0;
  transition: all 140ms;
  user-select: none;
}
.rp-btn:hover {
  color: var(--accent);
  border-color: var(--accent);
}
.rp-btn.accent {
  background: var(--accent-gradient);
  border-color: transparent;
  color: #fff;
}
.rp-btn.danger:hover {
  color: #ef5350;
  border-color: rgba(239, 83, 80, 0.55);
}
.rp-btn.speed.active {
  color: var(--accent);
  border-color: var(--accent);
  background: rgba(41, 98, 255, 0.12);
}
.replay-price-tag {
  position: absolute;
  right: 0;
  background: #26a69a;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  padding: 2px 6px;
  border-radius: 3px 0 0 3px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
}

/* ── Demo trading (paper trading) ── */
.demo-lines,
.demo-hit-layer,
.demo-tag-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.demo-lines,
.demo-tag-layer {
  z-index: 5;
}
.demo-hit-layer {
  z-index: 7;
}
.demo-line {
  position: absolute;
  left: 0;
  right: 0;
  height: 1.5px;
  pointer-events: none;
}
.demo-line.dashed {
  background: repeating-linear-gradient(90deg, currentColor 0 6px, transparent 6px 11px);
}
.demo-line-hit {
  position: absolute;
  left: 0;
  right: 0;
  height: 9px;
  pointer-events: auto;
  cursor: ns-resize;
}
.demo-tag-layer {
  position: absolute;
  inset: 0;
  z-index: 8;
  pointer-events: none;
}
.demo-axis-tag {
  position: absolute;
  right: 0;
  font-size: 11px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: #fff;
  padding: 2px 6px;
  border-radius: 3px 0 0 3px;
  white-space: nowrap;
}
.demo-axis-tag.entry {
  background: #2962ff;
}
.demo-axis-tag.sl {
  background: #ef5350;
}
.demo-axis-tag.tp {
  background: #26a69a;
}
/* Left-edge line labels: lot + $ loss on SL, $ reward + R:R on TP —
   solid level colors with white text so they stay readable on any
   background / theme */
.demo-line-label {
  position: absolute;
  /* pinned to the left edge of the chart pane */
  left: 2px;
  font-size: 10px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  padding: 1px 6px;
  border-radius: 4px;
  color: #fff;
  background: #2962ff;
  white-space: nowrap;
  pointer-events: none;
  text-shadow: none;
}
.demo-line-label.entry {
  background: #2962ff;
}
.demo-line-label.sl {
  background: #ef5350;
}
.demo-line-label.tp {
  background: #26a69a;
}
.demo-size-modes {
  display: inline-flex;
  gap: 2px;
  background: var(--btn-bg);
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 2px;
}
.demo-mode {
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 800;
  padding: 3px 8px;
  border-radius: 5px;
  cursor: pointer;
}
.demo-mode.active {
  background: var(--accent-gradient);
  color: #fff;
}
.demo-err {
  font-size: 10px;
  color: #ef5350;
  font-weight: 700;
  white-space: nowrap;
}
.demo-mgr {
  position: absolute;
  top: 12px;
  right: 12px; /* near the watchlist side of the chart */
  z-index: 26;
  display: flex;
  flex-direction: column;
  gap: 5px;
  width: 132px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 6px 8px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3);
}
.demo-mgr.mini {
  width: auto;
  padding: 3px;
  background: transparent;
  border: none;
  box-shadow: none;
}
.demo-mgr-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.demo-mgr-title {
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.08em;
  color: #26a69a;
}
.demo-mini-btn {
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  border: 1px solid var(--border);
  background: var(--btn-bg);
  color: var(--text-muted);
  border-radius: 5px;
  cursor: pointer;
  font-size: 11px;
  line-height: 1;
  padding: 0;
}
.demo-mini-btn:hover {
  color: var(--text);
  border-color: var(--border-strong, var(--border));
}
.demo-mgr-inp {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  font-size: 10px;
  color: var(--text-muted);
  font-weight: 600;
}
.demo-mgr-inp input {
  width: 64px;
  padding: 3px 6px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-panel);
  color: var(--text);
  font-size: 11px;
  font-weight: 700;
  outline: none;
  text-align: right;
}
.demo-mgr-inp input:focus {
  border-color: var(--accent);
}
.demo-mgr-btns,
.demo-draft-btns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
}
.demo-draft-btns {
  grid-template-columns: 2fr 1fr;
}
.dm-btn {
  height: 24px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--btn-bg);
  color: var(--text);
  font-size: 10px;
  font-weight: 700;
  cursor: pointer;
  transition: all 140ms;
  white-space: nowrap;
}
.dm-btn.buy:hover {
  color: #26a69a;
  border-color: #26a69a;
}
.dm-btn.sell:hover {
  color: #ef5350;
  border-color: #ef5350;
}
.dm-btn.set {
  background: var(--accent-gradient);
  border-color: transparent;
  color: #fff;
}
.dm-btn.cancel {
  color: var(--text-muted);
}
.dm-btn.cancel:hover {
  color: #ef5350;
  border-color: rgba(239, 83, 80, 0.5);
}
.demo-tb-title {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
  color: #26a69a;
  margin-right: 2px;
}
.demo-inp {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-muted);
}
.demo-inp input {
  width: 62px;
  padding: 4px 6px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-panel);
  color: var(--text);
  font-size: 11px;
  font-weight: 700;
  outline: none;
}
.demo-inp input:focus {
  border-color: var(--accent);
}
.demo-tb-btn {
  height: 26px;
  padding: 0 8px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--btn-bg);
  color: var(--text);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  transition: all 140ms;
}
.demo-tb-btn.buy:hover {
  color: #26a69a;
  border-color: #26a69a;
}
.demo-tb-btn.sell:hover {
  color: #ef5350;
  border-color: #ef5350;
}
.demo-tb-btn.buy.armed,
.demo-tb-btn.sell.armed {
  background: var(--accent-gradient);
  border-color: transparent;
  color: #fff;
  box-shadow: 0 2px 10px rgba(41, 98, 255, 0.35);
}
.demo-err {
  font-size: 10px;
  color: #ef5350;
  font-weight: 700;
  white-space: nowrap;
}
.demo-bottom {
  /* in-flow section UNDER the chart (flex column sibling) — never covers
     the candles */
  border-top: 1px solid var(--border);
  background: var(--bg-panel);
  max-height: 240px;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}
.demo-bottom-head {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 8px 12px 4px;
  flex-wrap: wrap;
}
.demo-badge {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
  color: #fff;
  background: #26a69a;
  border-radius: 5px;
  padding: 3px 8px;
}
.demo-stat {
  font-size: 11px;
  color: var(--text-muted);
  font-weight: 600;
}
.demo-stat b {
  color: var(--text);
  font-weight: 800;
  margin-left: 4px;
  font-variant-numeric: tabular-nums;
}
.demo-flex {
  flex: 1;
}
.demo-reset {
  border: 1px solid var(--border);
  background: var(--btn-bg);
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 700;
  border-radius: 6px;
  padding: 3px 8px;
  cursor: pointer;
}
.demo-reset:hover {
  color: #ef5350;
  border-color: rgba(239, 83, 80, 0.5);
}
.demo-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 12px 6px;
}
.demo-tab {
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
  padding: 3px 8px;
  border-radius: 6px;
  cursor: pointer;
}
.demo-tab.active {
  background: var(--btn-bg);
  color: var(--text);
}
.demo-period {
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 700;
  border-radius: 6px;
  padding: 2px 7px;
  cursor: pointer;
}
.demo-period.active {
  color: var(--accent);
  border-color: var(--accent);
}
.demo-table {
  overflow: auto;
  padding: 0 12px 10px;
}
.demo-empty {
  font-size: 11px;
  color: var(--text-muted);
  padding: 8px 4px;
}
.demo-table table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
}
.demo-table th {
  text-align: left;
  color: var(--text-muted);
  font-weight: 700;
  padding: 3px 8px;
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  background: var(--bg-panel);
}
.demo-table td {
  padding: 4px 8px;
  border-bottom: 1px solid var(--border);
  font-variant-numeric: tabular-nums;
  color: var(--text);
}
.demo-table .pos {
  color: #26a69a;
}
.demo-table .neg {
  color: #ef5350;
}
.demo-close {
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 11px;
  padding: 2px 4px;
  border-radius: 4px;
}
.demo-close:hover {
  color: #ef5350;
  background: rgba(239, 83, 80, 0.1);
}
.demo-stats {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  padding: 4px 0 2px;
}
.demo-stat-card {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 6px 12px;
  min-width: 90px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.demo-stat-card span {
  font-size: 9px;
  color: var(--text-muted);
  font-weight: 700;
  letter-spacing: 0.04em;
}
.demo-stat-card b {
  font-size: 13px;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.demo-stat-card .pos {
  color: #26a69a;
}
.demo-stat-card .neg {
  color: #ef5350;
}
.rp-sep {
  width: 1px;
  height: 18px;
  background: var(--border);
  flex-shrink: 0;
}
</style>
