import { defineStore } from "pinia";
import { ref, watch } from "vue";

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

const STORAGE_KEY = "tk-drawings";
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

function load(): Record<string, DrawingRect[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, DrawingRect[]>;
      // Migrate rects saved before `filled` / proper opacity existed
      for (const list of Object.values(parsed)) {
        for (const r of list) {
          if (typeof r.opacity !== "number") r.opacity = DEFAULT_OPACITY;
          if (typeof r.filled !== "boolean") r.filled = true;
        }
      }
      return parsed;
    }
  } catch {}
  return {};
}

export const useDrawingsStore = defineStore("drawings", () => {
  const drawings = ref<Record<string, DrawingRect[]>>(load());
  const activeTool = ref<"cursor" | "rectangle">("cursor");
  const selectedId = ref<string | null>(null);

  function key(symbol: string, timeframe: string) {
    return `${symbol}|${timeframe}`;
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(drawings.value));
    } catch {}
  }

  function getFor(symbol: string, timeframe: string): DrawingRect[] {
    return drawings.value[key(symbol, timeframe)] ?? [];
  }

  function add(symbol: string, timeframe: string, rect: Omit<DrawingRect, "id" | "color" | "opacity" | "filled">): DrawingRect {
    const full: DrawingRect = {
      ...rect,
      id: `dr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      color: PRESET_COLORS[Math.floor(Math.random() * 4)] ?? "#2962ff",
      opacity: DEFAULT_OPACITY,
      filled: true,
    };
    const k = key(symbol, timeframe);
    if (!drawings.value[k]) drawings.value[k] = [];
    drawings.value[k]!.push(full);
    persist();
    return full;
  }

  function remove(symbol: string, timeframe: string, id: string) {
    const k = key(symbol, timeframe);
    if (drawings.value[k]) {
      drawings.value[k] = drawings.value[k]!.filter((d) => d.id !== id);
      persist();
    }
    if (selectedId.value === id) selectedId.value = null;
  }

  function updateColor(symbol: string, timeframe: string, id: string, color: string) {
    const k = key(symbol, timeframe);
    const list = drawings.value[k];
    if (!list) return;
    const item = list.find((d) => d.id === id);
    if (item) {
      item.color = color;
      persist();
    }
  }

  function updateRect(
    symbol: string,
    timeframe: string,
    id: string,
    rect: Partial<Pick<DrawingRect, "time1" | "price1" | "time2" | "price2">>
  ) {
    const k = key(symbol, timeframe);
    const list = drawings.value[k];
    if (!list) return;
    const item = list.find((d) => d.id === id);
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
    timeframe: string,
    id: string,
    patch: Partial<Pick<DrawingRect, "color" | "opacity" | "filled">>
  ) {
    const k = key(symbol, timeframe);
    const item = drawings.value[k]?.find((d) => d.id === id);
    if (!item) return;
    if (patch.color !== undefined) item.color = patch.color;
    if (patch.opacity !== undefined) item.opacity = Math.min(1, Math.max(0, patch.opacity));
    if (patch.filled !== undefined) item.filled = patch.filled;
    persist();
  }

  function clearAll(symbol: string, timeframe: string) {
    drawings.value[key(symbol, timeframe)] = [];
    selectedId.value = null;
    persist();
  }

  return {
    drawings,
    activeTool,
    selectedId,
    PRESET_COLORS,
    getFor,
    add,
    remove,
    updateColor,
    updateRect,
    updateStyle,
    clearAll,
  };
});
