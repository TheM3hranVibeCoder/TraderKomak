<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, nextTick, computed } from "vue";
import { createChartAdapter, type ChartAdapter } from "@/chart/chartAdapter";
import { useThemeStore } from "@/stores/theme";
import { useMarketStore } from "@/stores/market";
import { useDrawingsStore, type DrawingRect, type DrawingTrend, type DrawingPoly, type DrawingPosition, type DrawingHLine, type DrawingHRay, type DrawingVLine, type SingleKind, type SingleDrawing, type DashStyle } from "@/stores/drawings";
import type { Candle } from "@traderkomak/shared";
import { currencyFlagUrl, commodityIcon } from "@/utils/flags";
import { TIMEFRAME_SECONDS, instrumentPrecision, instrumentPipSize, providerOf } from "@traderkomak/shared";

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
let chartDblClickEl: HTMLElement | null = null;
let chartDblClickCb: ((e: MouseEvent) => void) | null = null;
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
let lastPolyClickAt: { x: number; y: number } | null = null;
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

/** With CTRL held, snap the cursor to the high/low of the nearest candle
 *  (whichever is closer in pixels). */
function snapToCandle(time: number, price: number, snap: boolean): { time: number; price: number } {
  if (!snap || !adapter || !props.candles.length) return { time, price };
  const arr = props.candles;
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
  const dH = Math.abs(yP - yH);
  const dL = Math.abs(yP - yL);
  if (Math.min(dH, dL) <= 8) return { time: c.time, price: dH <= dL ? c.high : c.low };
  return { time, price };
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
  axisRetry = 0;
  axisRightW.value = Math.max(0, Math.round(c.clientWidth - r.width));
  axisBottomH.value = Math.max(0, Math.round(c.clientHeight - r.height));
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
  const s1 = snapToCandle(time, price, e.ctrlKey);
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
      const s2 = snapToCandle(t, p, ev.ctrlKey);
      drawingState.value.time2 = s2.time;
      drawingState.value.price2 = s2.price;
    }
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
    window.removeEventListener("mousemove", onMouseMoveRef);
    onMouseMoveRef = null;
  }
  if (had) recalcRects();
}

/** Live preview listener for the in-progress polyline: tracks the cursor. */
function startPolyPreview(): void {
  stopPolyPreview();
  const move = (ev: MouseEvent) => {
    if (!polyState.value || !adapter || !containerRef.value) return;
    const r = containerRef.value.getBoundingClientRect();
    const t = adapter.xToTime(ev.clientX - r.left);
    const p = adapter.yToPrice(ev.clientY - r.top);
    if (t !== null && p !== null) polyState.value.cursor = { time: t, price: p };
    recalcRects();
  };
  window.addEventListener("mousemove", move);
  onPolyMoveRef = move;
}

function stopPolyPreview(): void {
  if (onPolyMoveRef) {
    window.removeEventListener("mousemove", onPolyMoveRef);
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
  const pt = { time: t, price: p };

  if (!polyState.value) {
    polyState.value = { points: [pt], cursor: pt };
    lastPolyClickAt = { x: e.clientX, y: e.clientY };
    startPolyPreview();
    recalcRects();
    return;
  }
  // Same-spot click (the second press of a double-click) → ignore here;
  // the dblclick handler finalizes the polyline.
  if (lastPolyClickAt && Math.hypot(e.clientX - lastPolyClickAt.x, e.clientY - lastPolyClickAt.y) < 6) {
    return;
  }
  lastPolyClickAt = { x: e.clientX, y: e.clientY };
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
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  };
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
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
    drawingsStore.updateLine(market.instrument, id, which === 1 ? { time1: t, price1: p } : { time2: t, price2: p });
    const updated = drawingsStore.getLinesFor(market.instrument).find((x) => x.id === id);
    if (updated) selectedLine.value = updated;
    recalcRects();
    positionLinePanel(id);
  };

  const onUp = () => {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  };
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
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

/** Shared corner-anchored panel placement (used by trendline + polyline). */
function computeCornerPanelPos(ex: number, ey: number, pane: HTMLElement, el: HTMLElement | null): { x: number; y: number } {
  const w = el?.offsetWidth || PANEL_W;
  const h = el?.offsetHeight || PANEL_H;
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
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  };
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
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
    const poly = drawingsStore.getPolysFor(market.instrument).find((x) => x.id === id);
    if (!poly || !poly.points[index]) return;
    const next = poly.points.map((pt, i) => (i === index ? { time: t, price: p } : { ...pt }));
    drawingsStore.updatePolyPoints(market.instrument, id, next);
    const updated = drawingsStore.getPolysFor(market.instrument).find((x) => x.id === id);
    if (updated) selectedPoly.value = updated;
    recalcRects();
    positionPolyPanel(id);
  };
  const onUp = () => {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  };
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
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
  posState.value = { time1: t, entry: p };
  posCursor.value = { time: t, price: p };
  recalcRects();
  stopPosCursor();
  const move = (ev: MouseEvent) => {
    if (!posState.value || !adapter || !containerRef.value) return;
    const rr = containerRef.value.getBoundingClientRect();
    const ct = adapter.xToTime(ev.clientX - rr.left);
    const cp = adapter.yToPrice(ev.clientY - rr.top);
    if (ct !== null && cp !== null) posCursor.value = { time: ct, price: cp };
    recalcRects();
  };
  window.addEventListener("mousemove", move);
  onPosMoveRef = move;
}

function stopPosCursor(): void {
  if (onPosMoveRef) {
    window.removeEventListener("mousemove", onPosMoveRef);
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
    if (t !== null && p !== null && Math.abs(p - st.entry) > 0) {
      const long = p < st.entry;
      const risk = Math.abs(st.entry - p);
      drawingsStore.addPosition(market.instrument, {
        direction: long ? "long" : "short",
        time1: st.time1,
        time2: t,
        entry: st.entry,
        sl: p,
        tp: st.entry + (long ? 1 : -1) * 2 * risk,
      });
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
 *  the panel is lifted higher to never cover them. */
function positionPosPanel(id: string): void {
  const px = posPixels.value.find((p) => p.id === id);
  const pane = containerRef.value;
  if (!px || !pane) return;
  const topY = Math.min(px.tpY, px.entryY);
  const anchorY = px.width >= 140 ? topY : topY - 35;
  posPanelPos.value = computeCornerPanelPos(px.left + px.width, anchorY, pane, posPanelEl.value);
  if (!posPanelEl.value) {
    posPanelReady.value = false;
    void nextTick(() => {
      const sel = selectedPos.value;
      if (!posPanelEl.value || !sel || !containerRef.value) return;
      const p = posPixels.value.find((q) => q.id === sel.id);
      if (p) {
        const t2 = Math.min(p.tpY, p.entryY);
        posPanelPos.value = computeCornerPanelPos(p.left + p.width, p.width >= 140 ? t2 : t2 - 35, containerRef.value, posPanelEl.value);
      }
      posPanelReady.value = true;
    });
  } else {
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
    const p = adapter.yToPrice(ev.clientY - r.top);
    if (p === null) return;
    const cur = drawingsStore.getPositionsFor(market.instrument).find((x) => x.id === id);
    const price = cur ? clampPosPrice(cur, which, p) : p;
    drawingsStore.updatePosition(market.instrument, id, { [which]: price });
    const updated = drawingsStore.getPositionsFor(market.instrument).find((x) => x.id === id);
    if (updated) selectedPos.value = updated;
    recalcRects();
    positionPosPanel(id);
  };
  const onUp = () => {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  };
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
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
    drawingsStore.updatePosition(market.instrument, id, { [which]: t });
    const updated = drawingsStore.getPositionsFor(market.instrument).find((x) => x.id === id);
    if (updated) selectedPos.value = updated;
    recalcRects();
    positionPosPanel(id);
  };
  const onUp = () => {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  };
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
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
    const cur = drawingsStore.getPositionsFor(market.instrument).find((x) => x.id === id);
    const price = cur ? clampPosPrice(cur, which, p) : p;
    drawingsStore.updatePosition(market.instrument, id, { [which]: price, [side]: t });
    const updated = drawingsStore.getPositionsFor(market.instrument).find((x) => x.id === id);
    if (updated) selectedPos.value = updated;
    recalcRects();
    positionPosPanel(id);
  };
  const onUp = () => {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  };
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
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
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  };
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
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
    item = { time: snapToCandle(t, p, e.ctrlKey).time };
  } else {
    const s = snapToCandle(t, p, e.ctrlKey);
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
      drawingsStore.updateSingle(kind, market.instrument, id, { price: snapToCandle(t, p, ev.ctrlKey).price });
    } else if (kind === "vline") {
      drawingsStore.updateSingle(kind, market.instrument, id, { time: snapToCandle(t, p, ev.ctrlKey).time });
    } else {
      const s = snapToCandle(t, p, ev.ctrlKey);
      drawingsStore.updateSingle(kind, market.instrument, id, { time: s.time, price: s.price });
    }
    recalcRects();
    positionSinglePanel(kind, id);
  };
  const onUp = () => {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  };
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
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
  adapter.setData(props.candles);
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
      finalizeDraw(); // second click of click -> move -> click
    } else {
      beginDraw(e);
    }
  };
  el.addEventListener("mousedown", onChartMouseDown as AnyListener, true);
  chartMouseDownEl = el;
  chartMouseDownCb = onChartMouseDown;

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
  if (interactionEl && interactCb) {
    interactionEl.removeEventListener("pointermove", interactCb);
    interactionEl.removeEventListener("pointerdown", interactCb);
    interactionEl.removeEventListener("wheel", interactCb);
    interactionEl.removeEventListener("touchmove", interactCb);
  }
  if (chartMouseDownEl && chartMouseDownCb) {
    chartMouseDownEl.removeEventListener("mousedown", chartMouseDownCb as AnyListener, true);
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
      :class="{ 'drawing-mode': drawingToolActive }"
      :style="{ right: axisRightW + 'px', bottom: axisBottomH + 'px' }"
    >
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
            @mousedown.stop="onTrendDragStart($event, t.id)"
            @click.stop="onTrendClick(t.id, $event)"
          />
          <template v-if="t.selected">
            <circle
              :cx="t.x1" :cy="t.y1" r="5"
              class="trend-handle"
              @mousedown.stop.prevent="onTrendHandleStart($event, t.id, 1)"
            />
            <circle
              :cx="t.x2" :cy="t.y2" r="5"
              class="trend-handle"
              @mousedown.stop.prevent="onTrendHandleStart($event, t.id, 2)"
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
            @mousedown.stop="onPolyDragStart($event, p.id)"
            @click.stop="onPolyClick(p.id, $event)"
          />
          <template v-if="p.selected">
            <circle
              v-for="q in p.pts"
              :key="q.src"
              :cx="q.x" :cy="q.y" r="5"
              class="trend-handle"
              @mousedown.stop.prevent="onPolyVertexStart($event, p.id, q.src)"
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
        @mousedown.stop="onPosDragStart($event, p.id)"
        @click.stop="onPosClick(p.id, $event)"
      >
        <template v-if="p.selected">
          <div
            class="pos-level-hit"
            :style="{ top: p.tpY - Math.min(p.tpY, p.slY) - 4 + 'px' }"
            @mousedown.stop.prevent="onPosLevelStart($event, p.id, 'tp')"
          ></div>
          <div
            class="pos-level-hit"
            :style="{ top: p.entryY - Math.min(p.tpY, p.slY) - 4 + 'px' }"
            @mousedown.stop.prevent="onPosLevelStart($event, p.id, 'entry')"
          ></div>
          <div
            class="pos-level-hit"
            :style="{ top: p.slY - Math.min(p.tpY, p.slY) - 4 + 'px' }"
            @mousedown.stop.prevent="onPosLevelStart($event, p.id, 'sl')"
          ></div>
          <div
            class="pos-edge-hit"
            :style="{ left: '-3px' }"
            @mousedown.stop.prevent="onPosEdgeStart($event, p.id, 'time1')"
          ></div>
          <div
            class="pos-edge-hit"
            :style="{ right: '-3px' }"
            @mousedown.stop.prevent="onPosEdgeStart($event, p.id, 'time2')"
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
              @mousedown.stop.prevent="onPosCornerStart($event, p.id, lvl.kind as any, 'time1')"
            ></div>
            <div
              class="resize-handle pos-handle"
              :style="{ top: lvl.y - 4 + 'px', right: '-4px' }"
              @mousedown.stop.prevent="onPosCornerStart($event, p.id, lvl.kind as any, 'time2')"
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
        @mousedown.stop="onSingleDragStart($event, s.kind, s.id)"
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
          @mousedown.stop.prevent="onSingleDragStart($event, s.kind, s.id)"
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
      v-show="posPanelReady"
      ref="posPanelEl"
      class="rect-edit-panel"
      :style="{ left: posPanelPos.x + 'px', top: posPanelPos.y + 'px' }"
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

    <!-- Edit panel for the selected one-click line -->
    <div
      v-if="drawingsStore.selectedSingle && singlePanelPos"
      v-show="singlePanelReady"
      ref="singlePanelEl"
      class="rect-edit-panel"
      :style="{ left: singlePanelPos.x + 'px', top: singlePanelPos.y + 'px' }"
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
/* While a drawing tool is active, existing drawings must not swallow
   the press, and the live preview is never interactive. */
.drawing-hit-layer.drawing-mode .drawing-hit-rect,
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
</style>
