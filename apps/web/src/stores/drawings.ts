import { defineStore } from "pinia";
import { computed, ref } from "vue";

export interface DrawingRect {
  id: string;
  /** UNIX seconds — bucket time of the anchor candle */
  time1: number;
  price1: number;
  time2: number;
  price2: number;
  color: string;
  /** fill opacity 0–1 (only applied while `filled` is true) */
  opacity: number;
  /** false → border-only rectangle (no background fill) */
  filled: boolean;
}

export type DashStyle = "solid" | "dashed" | "dotted";

export interface DrawingTrend {
  id: string;
  /** UNIX seconds — endpoint anchors in wall-clock time + price */
  time1: number;
  price1: number;
  time2: number;
  price2: number;
  color: string;
  /** line thickness in px */
  width: number;
  dash: DashStyle;
}

export interface DrawingPolyPoint {
  time: number;
  price: number;
}

export interface DrawingPoly {
  id: string;
  /** vertices in drawn order (≥ 2) */
  points: DrawingPolyPoint[];
  color: string;
  width: number;
  dash: DashStyle;
  /** draw an arrowhead on the last corner */
  arrow: boolean;
}

export interface DrawingPosition {
  id: string;
  /** "long" = profit above entry, "short" = profit below entry */
  direction: "long" | "short";
  /** left / right time edges (UNIX seconds, time1 < time2) */
  time1: number;
  time2: number;
  entry: number;
  sl: number;
  tp: number;
  /** show 1R..NR horizontal reward lines between entry and TP */
  showLevels: boolean;
}

/* ── One-click lines: horizontal line / horizontal ray / vertical line ── */
export type SingleKind = "hline" | "hray" | "vline";

export interface DrawingHLine {
  id: string;
  price: number;
  color: string;
  width: number;
  dash: DashStyle;
}
export interface DrawingHRay {
  id: string;
  /** ray starts at this time and extends to the right edge */
  time: number;
  price: number;
  color: string;
  width: number;
  dash: DashStyle;
}
export interface DrawingVLine {
  id: string;
  time: number;
  color: string;
  width: number;
  dash: DashStyle;
}
export type SingleDrawing = DrawingHLine | DrawingHRay | DrawingVLine;

/** Full per-symbol drawing state captured as one undo/redo step. */
export interface DrawingSnapshot {
  drawings: DrawingRect[];
  lines: DrawingTrend[];
  polys: DrawingPoly[];
  positions: DrawingPosition[];
  singles: Record<SingleKind, SingleDrawing[]>;
}

const STORAGE_KEY = "tk-drawings";
const STORAGE_KEY_LAST_RECT_STYLE = "tk-drawings-last-rect-style";
const STORAGE_KEY_LAST_LINE_STYLE = "tk-drawings-last-line-style";
const STORAGE_KEY_LAST_POLY_STYLE = "tk-drawings-last-poly-style";
const STORAGE_KEY_LAST_SINGLE_STYLE = "tk-drawings-last-single-style";
const STORAGE_KEY_LINES = "tk-drawings-lines";
const STORAGE_KEY_POLYS = "tk-drawings-polys";
const STORAGE_KEY_POSITIONS = "tk-drawings-positions";
const STORAGE_KEY_SINGLES = "tk-drawings-singles";
export const DEFAULT_LINE_WIDTH = 2;
/** Swatches shown directly in the edit panels (black always visible). */
export const PANEL_COLORS = [
  "#2962ff", // blue
  "#26a69a", // teal
  "#ef5350", // red
  "#f59e0b", // amber
  "#ffffff", // white
  "#22c55e", // green
  "#000000", // black
];

function loadLines(): Record<string, DrawingTrend[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_LINES);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, DrawingTrend[]>;
      const out: Record<string, DrawingTrend[]> = {};
      for (const [key, list] of Object.entries(parsed)) {
        if (!Array.isArray(list)) continue;
        const target = (out[key] ??= []);
        const seen = new Set(target.map((l) => l.id));
        for (const l of list) {
          if (!l || typeof l.time1 !== "number" || typeof l.price1 !== "number") continue;
          if (seen.has(l.id)) continue;
          seen.add(l.id);
          if (typeof l.width !== "number") l.width = DEFAULT_LINE_WIDTH;
          if (l.dash !== "dashed" && l.dash !== "dotted") l.dash = "solid";
          target.push(l);
        }
      }
      return out;
    }
  } catch {}
  return {};
}
export const DEFAULT_OPACITY = 0.3;
const PRESET_COLORS = [
  "#2962ff", // blue
  "#26a69a", // teal
  "#ef5350", // red
  "#f59e0b", // amber
  "#ab47bc", // purple
  "#ffffff", // white
  "#22c55e", // green
  "#f97316", // orange
  "#eab308", // yellow
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#64748b", // slate gray
  "#000000", // black
];

/** Visual style remembered from the most recently edited rectangle. */
export interface RectStyle {
  color: string;
  opacity: number;
  /** false → border-only rectangle (no background fill) */
  filled: boolean;
}

function loadLastRectStyle(): RectStyle {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_LAST_RECT_STYLE);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<RectStyle>;
      return {
        color: typeof parsed.color === "string" ? parsed.color : PRESET_COLORS[0]!,
        opacity:
          typeof parsed.opacity === "number" ? Math.min(1, Math.max(0, parsed.opacity)) : DEFAULT_OPACITY,
        filled: typeof parsed.filled === "boolean" ? parsed.filled : true,
      };
    }
  } catch {}
  return { color: PRESET_COLORS[0]!, opacity: DEFAULT_OPACITY, filled: true };
}

/** Stroke style remembered from the most recently edited trendline. */
export interface LineStyle {
  color: string;
  width: number;
  dash: DashStyle;
}

/** Stroke style remembered from the most recently edited polyline. */
export interface PolyStyle extends LineStyle {
  /** arrowhead on the last corner */
  arrow: boolean;
}

function loadLastLineStyle(): LineStyle {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_LAST_LINE_STYLE);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LineStyle>;
      return {
        color: typeof parsed.color === "string" ? parsed.color : PRESET_COLORS[0]!,
        width:
          typeof parsed.width === "number" ? Math.min(6, Math.max(1, parsed.width)) : DEFAULT_LINE_WIDTH,
        dash: parsed.dash === "dashed" || parsed.dash === "dotted" ? parsed.dash : "solid",
      };
    }
  } catch {}
  return { color: PRESET_COLORS[0]!, width: DEFAULT_LINE_WIDTH, dash: "solid" };
}

function loadLastPolyStyle(): PolyStyle {
  const base = loadLastLineStyle();
  try {
    const raw = localStorage.getItem(STORAGE_KEY_LAST_POLY_STYLE);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PolyStyle>;
      return {
        ...base,
        color: typeof parsed.color === "string" ? parsed.color : base.color,
        width: typeof parsed.width === "number" ? Math.min(6, Math.max(1, parsed.width)) : base.width,
        dash: parsed.dash === "dashed" || parsed.dash === "dotted" ? parsed.dash : base.dash,
        arrow: typeof parsed.arrow === "boolean" ? parsed.arrow : false,
      };
    }
  } catch {}
  return { ...base, arrow: false };
}

/** Per-tool stroke style remembered from the most recently edited one-click
 *  line — each of hline / hray / vline keeps its own. */
export type LastSingleStyle = Record<SingleKind, LineStyle>;

function loadLastSingleStyle(): LastSingleStyle {
  const fallback = (): LineStyle => ({ color: PRESET_COLORS[0]!, width: DEFAULT_LINE_WIDTH, dash: "solid" });
  const out: LastSingleStyle = { hline: fallback(), hray: fallback(), vline: fallback() };
  try {
    const raw = localStorage.getItem(STORAGE_KEY_LAST_SINGLE_STYLE);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Record<SingleKind, Partial<LineStyle>>>;
      for (const kind of ["hline", "hray", "vline"] as SingleKind[]) {
        const p = parsed[kind];
        if (!p) continue;
        if (typeof p.color === "string") out[kind]!.color = p.color;
        if (typeof p.width === "number") out[kind]!.width = Math.min(6, Math.max(1, p.width));
        if (p.dash === "dashed" || p.dash === "dotted") out[kind]!.dash = p.dash;
      }
    }
  } catch {}
  return out;
}

/**
 * Drawings are keyed by SYMBOL only (not symbol|timeframe): a rectangle is
 * stored in wall-clock time + price, so it maps onto every timeframe of the
 * instrument it was drawn on.
 */
function migrate(parsed: Record<string, DrawingRect[]>): Record<string, DrawingRect[]> {
  const out: Record<string, DrawingRect[]> = {};
  for (const [key, list] of Object.entries(parsed)) {
    if (!Array.isArray(list)) continue;
    const symbol = key.split("|")[0]!;
    const target = (out[symbol] ??= []);
    const seen = new Set(target.map((r) => r.id));
    for (const r of list) {
      if (!r || typeof r.time1 !== "number" || typeof r.price1 !== "number") continue;
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      target.push(r);
    }
  }
  return out;
}

function load(): Record<string, DrawingRect[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, DrawingRect[]>;
      const migrated = migrate(parsed);
      // Normalize rects saved before `filled` / proper opacity existed
      for (const list of Object.values(migrated)) {
        for (const r of list) {
          if (typeof r.opacity !== "number") r.opacity = DEFAULT_OPACITY;
          if (typeof r.filled !== "boolean") r.filled = true;
        }
      }
      return migrated;
    }
  } catch {}
  return {};
}

function loadPolys(): Record<string, DrawingPoly[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_POLYS);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, DrawingPoly[]>;
      const out: Record<string, DrawingPoly[]> = {};
      for (const [key, list] of Object.entries(parsed)) {
        if (!Array.isArray(list)) continue;
        const target = (out[key] ??= []);
        const seen = new Set(target.map((p) => p.id));
        for (const p of list) {
          if (!p || !Array.isArray(p.points) || p.points.length < 2) continue;
          if (p.points.some((pt) => typeof pt?.time !== "number" || typeof pt?.price !== "number")) continue;
          if (seen.has(p.id)) continue;
          seen.add(p.id);
          if (typeof p.width !== "number") p.width = DEFAULT_LINE_WIDTH;
          if (p.dash !== "dashed" && p.dash !== "dotted") p.dash = "solid";
          if (typeof p.arrow !== "boolean") p.arrow = false;
          target.push(p);
        }
      }
      return out;
    }
  } catch {}
  return {};
}

function loadPositions(): Record<string, DrawingPosition[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_POSITIONS);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, DrawingPosition[]>;
      const out: Record<string, DrawingPosition[]> = {};
      for (const [key, list] of Object.entries(parsed)) {
        if (!Array.isArray(list)) continue;
        const target = (out[key] ??= []);
        const seen = new Set(target.map((p) => p.id));
        for (const p of list) {
          if (!p || typeof p.entry !== "number" || typeof p.sl !== "number" || typeof p.tp !== "number") continue;
          if (typeof p.time1 !== "number" || typeof p.time2 !== "number") continue;
          if (seen.has(p.id)) continue;
          seen.add(p.id);
          if (p.direction !== "short") p.direction = "long";
          if (typeof p.showLevels !== "boolean") p.showLevels = false;
          target.push(p);
        }
      }
      return out;
    }
  } catch {}
  return {};
}

function loadSingles(): Record<SingleKind, Record<string, SingleDrawing[]>> {
  const empty: Record<SingleKind, Record<string, SingleDrawing[]>> = { hline: {}, hray: {}, vline: {} };
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SINGLES);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<Record<SingleKind, Record<string, SingleDrawing[]>>>;
    for (const kind of ["hline", "hray", "vline"] as SingleKind[]) {
      const list = parsed[kind];
      if (!list) continue;
      const target = (empty[kind] ??= {});
      for (const [symbol, items] of Object.entries(list)) {
        if (!Array.isArray(items)) continue;
        const arr = (target[symbol] ??= []);
        const seen = new Set(arr.map((i) => i.id));
        for (const item of items) {
          if (!item || typeof item.id !== "string") continue;
          if (seen.has(item.id)) continue;
          seen.add(item.id);
          if (typeof item.color !== "string") item.color = "#2962ff";
          if (typeof item.width !== "number") item.width = DEFAULT_LINE_WIDTH;
          if (item.dash !== "dashed" && item.dash !== "dotted") item.dash = "solid";
          if ((kind === "hline" || kind === "hray") && typeof (item as DrawingHLine).price !== "number") continue;
          if ((kind === "hray" || kind === "vline") && typeof (item as DrawingHRay).time !== "number") continue;
          arr.push(item);
        }
      }
    }
    return empty;
  } catch {}
  return empty;
}

export const useDrawingsStore = defineStore("drawings", () => {
  const drawings = ref<Record<string, DrawingRect[]>>(load());
  const lines = ref<Record<string, DrawingTrend[]>>(loadLines());
  const polys = ref<Record<string, DrawingPoly[]>>(loadPolys());
  const positions = ref<Record<string, DrawingPosition[]>>(loadPositions());
  const singles = ref<Record<SingleKind, Record<string, SingleDrawing[]>>>(loadSingles());
  /** Style of the most recently edited rectangle — new rectangles reuse it. */
  const lastRectStyle = ref<RectStyle>(loadLastRectStyle());
  /** Style of the most recently edited trendline — new trendlines reuse it. */
  const lastLineStyle = ref<LineStyle>(loadLastLineStyle());
  /** Style of the most recently edited polyline — new polylines reuse it. */
  const lastPolyStyle = ref<PolyStyle>(loadLastPolyStyle());
  /** Per-tool style of the most recently edited one-click line. */
  const lastSingleStyle = ref<LastSingleStyle>(loadLastSingleStyle());
  const activeTool = ref<"cursor" | "position" | "rectangle" | "trendline" | "polyline" | "hline" | "hray" | "vline" | "measure">("cursor");
  /** Magnet mode: snap drawing points to the nearest candle's high/low.
   *  Latched by the toolbar button; Ctrl temporarily forces it either way. */
  const magnet = ref(localStorage.getItem("tk-magnet") === "1");
  function toggleMagnet(): void {
    magnet.value = !magnet.value;
    try { localStorage.setItem("tk-magnet", magnet.value ? "1" : "0"); } catch {}
  }
  /** True while Ctrl is physically held (ChartPane key listeners feed this). */
  const ctrlHeld = ref(false);
  function setCtrlHeld(v: boolean): void {
    ctrlHeld.value = v;
  }
  /** Effective magnet state — drives snapping AND the toolbar highlight. */
  const magnetActive = computed(() => magnet.value || ctrlHeld.value);
  const selectedId = ref<string | null>(null);
  const trendlineDrawing = ref(false);
  const selectedLineId = ref<string | null>(null);
  const selectedPolyId = ref<string | null>(null);
  const selectedPositionId = ref<string | null>(null);
  const selectedSingle = ref<{ kind: SingleKind; id: string } | null>(null);
  /** Symbol shown on the (single) chart — the toolbar's clear button uses it
   *  to know what it would remove. Kept in sync by ChartPane. */
  const activeSymbol = ref("");
  /** Bumped by the toolbar's "Remove all drawings" confirm; ChartPane owns
   *  the actual clear because it also has to drop its local edit panels. */
  const clearRequest = ref(0);

  /* ── Undo / Redo history (TradingView-style) ────────────────────────── */
  const MAX_HISTORY = 50;
  /** A burst of mutations with gaps shorter than this belongs to ONE gesture
   *  (a drag, a resize, a slider sweep …) and therefore ONE undo step. */
  const GESTURE_IDLE_MS = 500;
  /** Undo stack per symbol: oldest → newest. */
  const undoStacks = ref<Record<string, DrawingSnapshot[]>>({});
  /** Redo stack per symbol: oldest → newest. */
  const redoStacks = ref<Record<string, DrawingSnapshot[]>>({});
  /** Gesture currently being recorded. Its pre-gesture snapshot has already
   *  been pushed, so further mutations must NOT push again — otherwise a long
   *  drag records intermediate positions and one undo jumps to the middle of
   *  the gesture instead of returning to where it started. */
  let openGesture: { symbol: string; pushed: DrawingSnapshot; timer: number } | null = null;

  /** Deep-clone the current drawing state for one symbol. */
  function snapshot(symbol: string): DrawingSnapshot {
    return {
      drawings: JSON.parse(JSON.stringify(drawings.value[symbol] ?? [])),
      lines: JSON.parse(JSON.stringify(lines.value[symbol] ?? [])),
      polys: JSON.parse(JSON.stringify(polys.value[symbol] ?? [])),
      positions: JSON.parse(JSON.stringify(positions.value[symbol] ?? [])),
      singles: {
        hline: JSON.parse(JSON.stringify(singles.value.hline[symbol] ?? [])),
        hray: JSON.parse(JSON.stringify(singles.value.hray[symbol] ?? [])),
        vline: JSON.parse(JSON.stringify(singles.value.vline[symbol] ?? [])),
      },
    };
  }

  /** Restore a snapshot into the store for one symbol. */
  function restoreSnapshot(symbol: string, snap: DrawingSnapshot): void {
    drawings.value[symbol] = snap.drawings;
    lines.value[symbol] = snap.lines;
    polys.value[symbol] = snap.polys;
    positions.value[symbol] = snap.positions;
    for (const kind of ["hline", "hray", "vline"] as SingleKind[]) {
      singles.value[kind][symbol] = snap.singles[kind];
    }
    persist();
    persistLines();
    persistPolys();
    persistPositions();
    persistSingles();
  }

  /** Capture current state as an undo point. The FIRST mutation of a gesture
   *  snapshots the pre-gesture state; the rest of that gesture only extends
   *  the idle window, so the whole drag/resize/color change is a single
   *  undo step that returns exactly to where it started. */
  function pushUndo(symbol: string): void {
    if (!symbol) return;
    if (openGesture) {
      if (openGesture.symbol === symbol) {
        // Same gesture still in progress — keep the snapshot taken at its start.
        armGestureTimer();
        return;
      }
      // A gesture on another symbol finished the moment this one began.
      commitGesture();
    }

    const stacks = undoStacks.value;
    if (!stacks[symbol]) stacks[symbol] = [];
    const snap = snapshot(symbol);
    stacks[symbol].push(snap);
    if (stacks[symbol].length > MAX_HISTORY) stacks[symbol].shift();

    // A new action invalidates the redo stack.
    redoStacks.value[symbol] = [];

    openGesture = { symbol, pushed: snap, timer: 0 };
    armGestureTimer();
  }

  function armGestureTimer(): void {
    if (!openGesture) return;
    if (openGesture.timer) clearTimeout(openGesture.timer);
    openGesture.timer = window.setTimeout(commitGesture, GESTURE_IDLE_MS);
  }

  /** Close the open gesture once the pointer/interaction has settled. */
  function commitGesture(): void {
    const g = openGesture;
    if (!g) return;
    if (g.timer) clearTimeout(g.timer);
    openGesture = null;
    // Nothing actually changed (e.g. the same color re-picked): drop the step
    // so it doesn't cost the user a meaningless undo.
    if (JSON.stringify(snapshot(g.symbol)) === JSON.stringify(g.pushed)) {
      const stack = undoStacks.value[g.symbol];
      if (stack && stack[stack.length - 1] === g.pushed) stack.pop();
    }
  }

  // Releasing the pointer ends a gesture immediately — deferred by a tick so
  // the chart's own pointerup handlers can write their final position first.
  if (typeof window !== "undefined") {
    const endOnRelease = () => window.setTimeout(commitGesture, 0);
    window.addEventListener("pointerup", endOnRelease, true);
    window.addEventListener("pointercancel", endOnRelease, true);
  }

  /** Undo one step for a symbol. Returns true if something was undone. */
  function undo(symbol: string): boolean {
    if (!symbol) return false;
    commitGesture();
    const stack = undoStacks.value[symbol];
    if (!stack || stack.length === 0) return false;

    const r = redoStacks.value;
    if (!r[symbol]) r[symbol] = [];
    r[symbol].push(snapshot(symbol));
    if (r[symbol].length > MAX_HISTORY) r[symbol].shift();

    const prev = stack.pop()!;
    restoreSnapshot(symbol, prev);
    return true;
  }

  /** Redo one step for a symbol. Returns true if something was redone. */
  function redo(symbol: string): boolean {
    if (!symbol) return false;
    commitGesture();
    const stack = redoStacks.value[symbol];
    if (!stack || stack.length === 0) return false;

    const u = undoStacks.value;
    if (!u[symbol]) u[symbol] = [];
    u[symbol].push(snapshot(symbol));
    if (u[symbol].length > MAX_HISTORY) u[symbol].shift();

    const next = stack.pop()!;
    restoreSnapshot(symbol, next);
    return true;
  }

  /** Whether an undo step is available for a symbol. */
  function canUndo(symbol: string): boolean {
    if (!symbol) return false;
    const stack = undoStacks.value[symbol];
    return !!stack && stack.length > 0;
  }

  /** Whether a redo step is available for a symbol. */
  function canRedo(symbol: string): boolean {
    if (!symbol) return false;
    const stack = redoStacks.value[symbol];
    return !!stack && stack.length > 0;
  }

  /** Clear both stacks for a symbol (called on clear-all / symbol switch). */
  function clearHistory(symbol: string): void {
    if (!symbol) return;
    if (openGesture?.symbol === symbol) {
      if (openGesture.timer) clearTimeout(openGesture.timer);
      openGesture = null;
    }
    undoStacks.value[symbol] = [];
    redoStacks.value[symbol] = [];
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(drawings.value));
    } catch {}
  }

  function persistLines() {
    try {
      localStorage.setItem(STORAGE_KEY_LINES, JSON.stringify(lines.value));
    } catch {}
  }

  function persistPolys() {
    try {
      localStorage.setItem(STORAGE_KEY_POLYS, JSON.stringify(polys.value));
    } catch {}
  }

  function persistPositions() {
    try {
      localStorage.setItem(STORAGE_KEY_POSITIONS, JSON.stringify(positions.value));
    } catch {}
  }

  function persistSingles() {
    try {
      localStorage.setItem(STORAGE_KEY_SINGLES, JSON.stringify(singles.value));
    } catch {}
  }

  function persistLastRectStyle() {
    try {
      localStorage.setItem(STORAGE_KEY_LAST_RECT_STYLE, JSON.stringify(lastRectStyle.value));
    } catch {}
  }

  function persistLastLineStyle() {
    try {
      localStorage.setItem(STORAGE_KEY_LAST_LINE_STYLE, JSON.stringify(lastLineStyle.value));
    } catch {}
  }

  function persistLastPolyStyle() {
    try {
      localStorage.setItem(STORAGE_KEY_LAST_POLY_STYLE, JSON.stringify(lastPolyStyle.value));
    } catch {}
  }

  function persistLastSingleStyle() {
    try {
      localStorage.setItem(STORAGE_KEY_LAST_SINGLE_STYLE, JSON.stringify(lastSingleStyle.value));
    } catch {}
  }

  function getFor(symbol: string): DrawingRect[] {
    return drawings.value[symbol] ?? [];
  }

  function getLinesFor(symbol: string): DrawingTrend[] {
    return lines.value[symbol] ?? [];
  }

  function getPolysFor(symbol: string): DrawingPoly[] {
    return polys.value[symbol] ?? [];
  }

  function getPositionsFor(symbol: string): DrawingPosition[] {
    return positions.value[symbol] ?? [];
  }

  function add(symbol: string, rect: Omit<DrawingRect, "id" | "color" | "opacity" | "filled">): DrawingRect {
    pushUndo(symbol);
    const full: DrawingRect = {
      ...rect,
      id: `dr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      // Reuse the style of the last edited rectangle (falls back to the
      // default blue until the user styles one).
      color: lastRectStyle.value.color,
      opacity: lastRectStyle.value.opacity,
      filled: lastRectStyle.value.filled,
    };
    if (!drawings.value[symbol]) drawings.value[symbol] = [];
    drawings.value[symbol]!.push(full);
    persist();
    return full;
  }

  function remove(symbol: string, id: string) {
    pushUndo(symbol);
    const list = drawings.value[symbol];
    if (list) {
      drawings.value[symbol] = list.filter((d) => d.id !== id);
      persist();
    }
    if (selectedId.value === id) selectedId.value = null;
  }

  function updateColor(symbol: string, id: string, color: string) {
    pushUndo(symbol);
    const item = drawings.value[symbol]?.find((d) => d.id === id);
    if (item) {
      item.color = color;
      persist();
    }
  }

  function updateRect(
    symbol: string,
    id: string,
    rect: Partial<Pick<DrawingRect, "time1" | "price1" | "time2" | "price2">>
  ) {
    pushUndo(symbol);
    const item = drawings.value[symbol]?.find((d) => d.id === id);
    if (item) {
      if (rect.time1 !== undefined) item.time1 = rect.time1;
      if (rect.price1 !== undefined) item.price1 = rect.price1;
      if (rect.time2 !== undefined) item.time2 = rect.time2;
      if (rect.price2 !== undefined) item.price2 = rect.price2;
      // NOTE: corners are intentionally NOT normalized/swapped here. During a
      // resize the dragged edge may legitimately cross the opposite edge
      // (flipping the rectangle); swapping there collapses the rect onto the
      // cursor. Rendering derives left/top/width/height from min/max, so an
      // un-ordered storage is safe.
      persist();
    }
  }

  /** Update visual style: opacity (0–1) and/or filled (border-only) flag.
   *  Every change is also remembered as the style new rectangles start with. */
  function updateStyle(
    symbol: string,
    id: string,
    patch: Partial<Pick<DrawingRect, "color" | "opacity" | "filled">>
  ) {
    pushUndo(symbol);
    const item = drawings.value[symbol]?.find((d) => d.id === id);
    if (!item) return;
    if (patch.color !== undefined) {
      item.color = patch.color;
      lastRectStyle.value.color = patch.color;
    }
    if (patch.opacity !== undefined) {
      item.opacity = Math.min(1, Math.max(0, patch.opacity));
      lastRectStyle.value.opacity = item.opacity;
    }
    if (patch.filled !== undefined) {
      item.filled = patch.filled;
      lastRectStyle.value.filled = patch.filled;
    }
    persistLastRectStyle();
    persist();
  }

  function countFor(symbol: string): number {
    if (!symbol) return 0;
    return (
      (drawings.value[symbol]?.length ?? 0) +
      (lines.value[symbol]?.length ?? 0) +
      (polys.value[symbol]?.length ?? 0) +
      (positions.value[symbol]?.length ?? 0) +
      (singles.value.hline[symbol]?.length ?? 0) +
      (singles.value.hray[symbol]?.length ?? 0) +
      (singles.value.vline[symbol]?.length ?? 0)
    );
  }

  function setActiveSymbol(symbol: string) {
    activeSymbol.value = symbol;
  }

  function requestClearAll() {
    clearRequest.value += 1;
  }

  function clearAll(symbol: string) {
    pushUndo(symbol);
    drawings.value[symbol] = [];
    lines.value[symbol] = [];
    polys.value[symbol] = [];
    positions.value[symbol] = [];
    for (const kind of ["hline", "hray", "vline"] as SingleKind[]) {
      singles.value[kind][symbol] = [];
    }
    selectedId.value = null;
    selectedLineId.value = null;
    selectedPolyId.value = null;
    selectedPositionId.value = null;
    selectedSingle.value = null;
    persist();
    persistLines();
    persistPolys();
    persistPositions();
    persistSingles();
  }

  /* ── One-click lines (hline / hray / vline) ─────────────────────────── */

  function getSingles(kind: SingleKind, symbol: string): SingleDrawing[] {
    return singles.value[kind][symbol] ?? [];
  }

  function addSingle(kind: SingleKind, symbol: string, item: Record<string, unknown>): SingleDrawing {
    pushUndo(symbol);
    // Reuse the style of the last edited line of the same tool (defaults
    // until the user styles one).
    const st = lastSingleStyle.value[kind];
    const full = {
      ...item,
      id: `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      color: st.color,
      width: st.width,
      dash: st.dash,
    } as unknown as SingleDrawing;
    if (!singles.value[kind][symbol]) singles.value[kind][symbol] = [];
    singles.value[kind][symbol]!.push(full);
    persistSingles();
    return full;
  }

  function removeSingle(kind: SingleKind, symbol: string, id: string) {
    pushUndo(symbol);
    const list = singles.value[kind][symbol];
    if (list) {
      singles.value[kind][symbol] = list.filter((i) => i.id !== id);
      persistSingles();
    }
    if (selectedSingle.value?.kind === kind && selectedSingle.value.id === id) {
      selectedSingle.value = null;
    }
  }

  function updateSingle(kind: SingleKind, symbol: string, id: string, patch: Record<string, unknown>) {
    pushUndo(symbol);
    const item = singles.value[kind][symbol]?.find((i) => i.id === id);
    if (!item) return;
    for (const [k, v] of Object.entries(patch)) {
      if (k === "id") continue;
      (item as unknown as Record<string, unknown>)[k] = v;
    }
    // Style changes are remembered per tool (geometry patches — price/time —
    // are ignored here); the next line of this tool starts with them.
    const st = lastSingleStyle.value[kind];
    if (typeof patch.color === "string") st.color = patch.color;
    if (patch.dash === "solid" || patch.dash === "dashed" || patch.dash === "dotted") st.dash = patch.dash;
    if (typeof patch.width === "number") st.width = Math.min(6, Math.max(1, patch.width));
    persistLastSingleStyle();
    persistSingles();
  }

  /* ── Long / Short positions ─────────────────────────────────────────── */

  function addPosition(symbol: string, pos: Omit<DrawingPosition, "id" | "showLevels">): DrawingPosition {
    pushUndo(symbol);
    const full: DrawingPosition = {
      ...pos,
      id: `pos-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      showLevels: false,
    };
    if (!positions.value[symbol]) positions.value[symbol] = [];
    positions.value[symbol]!.push(full);
    persistPositions();
    return full;
  }

  function removePosition(symbol: string, id: string) {
    pushUndo(symbol);
    const list = positions.value[symbol];
    if (list) {
      positions.value[symbol] = list.filter((p) => p.id !== id);
      persistPositions();
    }
    if (selectedPositionId.value === id) selectedPositionId.value = null;
  }

  function updatePosition(
    symbol: string,
    id: string,
    patch: Partial<Pick<DrawingPosition, "time1" | "time2" | "entry" | "sl" | "tp">>
  ) {
    pushUndo(symbol);
    const item = positions.value[symbol]?.find((p) => p.id === id);
    if (item) {
      if (patch.time1 !== undefined) item.time1 = patch.time1;
      if (patch.time2 !== undefined) item.time2 = patch.time2;
      if (patch.entry !== undefined) item.entry = patch.entry;
      if (patch.sl !== undefined) item.sl = patch.sl;
      if (patch.tp !== undefined) item.tp = patch.tp;
      persistPositions();
    }
  }

  function updatePositionFlags(
    symbol: string,
    id: string,
    patch: Partial<Pick<DrawingPosition, "showLevels">>
  ) {
    pushUndo(symbol);
    const item = positions.value[symbol]?.find((p) => p.id === id);
    if (!item) return;
    if (patch.showLevels !== undefined) item.showLevels = patch.showLevels;
    persistPositions();
  }

  /* ── Trendlines ─────────────────────────────────────────────────────── */

  function addLine(
    symbol: string,
    trend: Omit<DrawingTrend, "id" | "color" | "width" | "dash">
  ): DrawingTrend {
    pushUndo(symbol);
    const full: DrawingTrend = {
      ...trend,
      id: `tl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      // Reuse the style of the last edited trendline (defaults until the
      // user styles one).
      color: lastLineStyle.value.color,
      width: lastLineStyle.value.width,
      dash: lastLineStyle.value.dash,
    };
    if (!lines.value[symbol]) lines.value[symbol] = [];
    lines.value[symbol]!.push(full);
    persistLines();
    return full;
  }

  function removeLine(symbol: string, id: string) {
    pushUndo(symbol);
    const list = lines.value[symbol];
    if (list) {
      lines.value[symbol] = list.filter((l) => l.id !== id);
      persistLines();
    }
    if (selectedLineId.value === id) selectedLineId.value = null;
  }

  function updateLine(
    symbol: string,
    id: string,
    patch: Partial<Pick<DrawingTrend, "time1" | "price1" | "time2" | "price2">>
  ) {
    pushUndo(symbol);
    const item = lines.value[symbol]?.find((l) => l.id === id);
    if (item) {
      if (patch.time1 !== undefined) item.time1 = patch.time1;
      if (patch.price1 !== undefined) item.price1 = patch.price1;
      if (patch.time2 !== undefined) item.time2 = patch.time2;
      if (patch.price2 !== undefined) item.price2 = patch.price2;
      persistLines();
    }
  }

  function updateLineStyle(
    symbol: string,
    id: string,
    patch: Partial<Pick<DrawingTrend, "color" | "dash" | "width">>
  ) {
    pushUndo(symbol);
    const item = lines.value[symbol]?.find((l) => l.id === id);
    if (!item) return;
    if (patch.color !== undefined) {
      item.color = patch.color;
      lastLineStyle.value.color = patch.color;
    }
    if (patch.dash !== undefined) {
      item.dash = patch.dash;
      lastLineStyle.value.dash = patch.dash;
    }
    if (patch.width !== undefined) {
      item.width = Math.min(6, Math.max(1, patch.width));
      lastLineStyle.value.width = item.width;
    }
    persistLastLineStyle();
    persistLines();
  }

  /* ── Polylines ──────────────────────────────────────────────────────── */

  function addPoly(
    symbol: string,
    poly: Omit<DrawingPoly, "id" | "color" | "width" | "dash" | "arrow">
  ): DrawingPoly {
    pushUndo(symbol);
    const full: DrawingPoly = {
      ...poly,
      id: `pl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      // Reuse the style of the last edited polyline (defaults until the
      // user styles one).
      color: lastPolyStyle.value.color,
      width: lastPolyStyle.value.width,
      dash: lastPolyStyle.value.dash,
      arrow: lastPolyStyle.value.arrow,
    };
    if (!polys.value[symbol]) polys.value[symbol] = [];
    polys.value[symbol]!.push(full);
    persistPolys();
    return full;
  }

  function removePoly(symbol: string, id: string) {
    pushUndo(symbol);
    const list = polys.value[symbol];
    if (list) {
      polys.value[symbol] = list.filter((p) => p.id !== id);
      persistPolys();
    }
    if (selectedPolyId.value === id) selectedPolyId.value = null;
  }

  function updatePolyPoints(symbol: string, id: string, points: DrawingPolyPoint[]) {
    pushUndo(symbol);
    const item = polys.value[symbol]?.find((p) => p.id === id);
    if (item && points.length >= 2) {
      item.points = points.map((pt) => ({ time: pt.time, price: pt.price }));
      persistPolys();
    }
  }

  function updatePolyStyle(
    symbol: string,
    id: string,
    patch: Partial<Pick<DrawingPoly, "color" | "dash" | "width" | "arrow">>
  ) {
    pushUndo(symbol);
    const item = polys.value[symbol]?.find((p) => p.id === id);
    if (!item) return;
    if (patch.color !== undefined) {
      item.color = patch.color;
      lastPolyStyle.value.color = patch.color;
    }
    if (patch.dash !== undefined) {
      item.dash = patch.dash;
      lastPolyStyle.value.dash = patch.dash;
    }
    if (patch.width !== undefined) {
      item.width = Math.min(6, Math.max(1, patch.width));
      lastPolyStyle.value.width = item.width;
    }
    if (patch.arrow !== undefined) {
      item.arrow = patch.arrow;
      lastPolyStyle.value.arrow = patch.arrow;
    }
    persistLastPolyStyle();
    persistPolys();
  }

  return {
    drawings,
    lines,
    polys,
    positions,
    singles,
    lastRectStyle,
    lastLineStyle,
    lastPolyStyle,
    lastSingleStyle,
    activeTool,
    magnet,
    toggleMagnet,
    ctrlHeld,
    setCtrlHeld,
    magnetActive,
    selectedId,
    trendlineDrawing,
    selectedLineId,
    selectedPolyId,
    selectedPositionId,
    selectedSingle,
    activeSymbol,
    clearRequest,
    countFor,
    canUndo,
    canRedo,
    undo,
    redo,
    pushUndo,
    clearHistory,
    setActiveSymbol,
    requestClearAll,
    PRESET_COLORS,
    PANEL_COLORS,
    getFor,
    getLinesFor,
    getPolysFor,
    getPositionsFor,
    getSingles,
    add,
    addLine,
    addPoly,
    addPosition,
    addSingle,
    remove,
    removeLine,
    removePoly,
    removePosition,
    removeSingle,
    updateColor,
    updateRect,
    updateLine,
    updatePolyPoints,
    updatePosition,
    updateSingle,
    updateStyle,
    updateLineStyle,
    updatePolyStyle,
    updatePositionFlags,
    clearAll,
  };
});
