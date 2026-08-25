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
  /** fill opacity 0–1 */
  opacity: number;
}

const STORAGE_KEY = "tk-drawings";
const PRESET_COLORS = [
  "#2962ff",
  "#26a69a",
  "#ef5350",
  "#f59e0b",
  "#ab47bc",
  "#ffffff",
];

function load(): Record<string, DrawingRect[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
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

  function add(symbol: string, timeframe: string, rect: Omit<DrawingRect, "id" | "color" | "opacity">): DrawingRect {
    const full: DrawingRect = {
      ...rect,
      id: `dr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      color: PRESET_COLORS[Math.floor(Math.random() * 4)] ?? "#2962ff",
      opacity: 0.15,
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

  function clearAll(symbol: string, timeframe: string) {
    drawings.value[key(symbol, timeframe)] = [];
    selectedId.value = null;
    persist();
  }

  watch(activeTool, (t) => {
    if (t === "cursor") selectedId.value = null;
  });

  return {
    drawings,
    activeTool,
    selectedId,
    PRESET_COLORS,
    getFor,
    add,
    remove,
    updateColor,
    clearAll,
  };
});
