import { defineStore } from "pinia";
import { ref } from "vue";

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

const STORAGE_KEY = "tk-drawings";
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
  const activeTool = ref<"cursor" | "position" | "rectangle" | "trendline" | "polyline" | "hline" | "hray" | "vline">("cursor");
  const selectedId = ref<string | null>(null);
  const selectedLineId = ref<string | null>(null);
  const selectedPolyId = ref<string | null>(null);
  const selectedPositionId = ref<string | null>(null);
  const selectedSingle = ref<{ kind: SingleKind; id: string } | null>(null);

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
    const full: DrawingRect = {
      ...rect,
      id: `dr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      color: PRESET_COLORS[Math.floor(Math.random() * 4)] ?? "#2962ff",
      opacity: DEFAULT_OPACITY,
      filled: true,
    };
    if (!drawings.value[symbol]) drawings.value[symbol] = [];
    drawings.value[symbol]!.push(full);
    persist();
    return full;
  }

  function remove(symbol: string, id: string) {
    const list = drawings.value[symbol];
    if (list) {
      drawings.value[symbol] = list.filter((d) => d.id !== id);
      persist();
    }
    if (selectedId.value === id) selectedId.value = null;
  }

  function updateColor(symbol: string, id: string, color: string) {
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

  /** Update visual style: opacity (0–1) and/or filled (border-only) flag. */
  function updateStyle(
    symbol: string,
    id: string,
    patch: Partial<Pick<DrawingRect, "color" | "opacity" | "filled">>
  ) {
    const item = drawings.value[symbol]?.find((d) => d.id === id);
    if (!item) return;
    if (patch.color !== undefined) item.color = patch.color;
    if (patch.opacity !== undefined) item.opacity = Math.min(1, Math.max(0, patch.opacity));
    if (patch.filled !== undefined) item.filled = patch.filled;
    persist();
  }

  function clearAll(symbol: string) {
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
    const full = {
      ...item,
      id: `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      color: PRESET_COLORS[Math.floor(Math.random() * 4)] ?? "#2962ff",
      width: DEFAULT_LINE_WIDTH,
      dash: "solid",
    } as unknown as SingleDrawing;
    if (!singles.value[kind][symbol]) singles.value[kind][symbol] = [];
    singles.value[kind][symbol]!.push(full);
    persistSingles();
    return full;
  }

  function removeSingle(kind: SingleKind, symbol: string, id: string) {
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
    const item = singles.value[kind][symbol]?.find((i) => i.id === id);
    if (!item) return;
    for (const [k, v] of Object.entries(patch)) {
      if (k === "id") continue;
      (item as unknown as Record<string, unknown>)[k] = v;
    }
    persistSingles();
  }

  /* ── Long / Short positions ─────────────────────────────────────────── */

  function addPosition(symbol: string, pos: Omit<DrawingPosition, "id" | "showLevels">): DrawingPosition {
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
    const full: DrawingTrend = {
      ...trend,
      id: `tl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      color: PRESET_COLORS[Math.floor(Math.random() * 4)] ?? "#2962ff",
      width: DEFAULT_LINE_WIDTH,
      dash: "solid",
    };
    if (!lines.value[symbol]) lines.value[symbol] = [];
    lines.value[symbol]!.push(full);
    persistLines();
    return full;
  }

  function removeLine(symbol: string, id: string) {
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
    const item = lines.value[symbol]?.find((l) => l.id === id);
    if (!item) return;
    if (patch.color !== undefined) item.color = patch.color;
    if (patch.dash !== undefined) item.dash = patch.dash;
    if (patch.width !== undefined) item.width = Math.min(6, Math.max(1, patch.width));
    persistLines();
  }

  /* ── Polylines ──────────────────────────────────────────────────────── */

  function addPoly(
    symbol: string,
    poly: Omit<DrawingPoly, "id" | "color" | "width" | "dash" | "arrow">
  ): DrawingPoly {
    const full: DrawingPoly = {
      ...poly,
      id: `pl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      color: PRESET_COLORS[Math.floor(Math.random() * 4)] ?? "#2962ff",
      width: DEFAULT_LINE_WIDTH,
      dash: "solid",
      arrow: false,
    };
    if (!polys.value[symbol]) polys.value[symbol] = [];
    polys.value[symbol]!.push(full);
    persistPolys();
    return full;
  }

  function removePoly(symbol: string, id: string) {
    const list = polys.value[symbol];
    if (list) {
      polys.value[symbol] = list.filter((p) => p.id !== id);
      persistPolys();
    }
    if (selectedPolyId.value === id) selectedPolyId.value = null;
  }

  function updatePolyPoints(symbol: string, id: string, points: DrawingPolyPoint[]) {
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
    const item = polys.value[symbol]?.find((p) => p.id === id);
    if (!item) return;
    if (patch.color !== undefined) item.color = patch.color;
    if (patch.dash !== undefined) item.dash = patch.dash;
    if (patch.width !== undefined) item.width = Math.min(6, Math.max(1, patch.width));
    if (patch.arrow !== undefined) item.arrow = patch.arrow;
    persistPolys();
  }

  return {
    drawings,
    lines,
    polys,
    positions,
    singles,
    activeTool,
    selectedId,
    selectedLineId,
    selectedPolyId,
    selectedPositionId,
    selectedSingle,
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
