import { defineStore } from "pinia";
import { ref, watch } from "vue";
import { SEARCHABLE_INSTRUMENTS, displayInstrument, normalizeInstrument } from "@traderkomak/shared";

const STORAGE_KEY = "tk-watchlist";
const DEFAULT_WATCH = ["XAU_USD", "XAG_USD", "BTC_USD", "ETH_USD", "EUR_USD", "GBP_USD"];

function loadWatch(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter((x) => typeof x === "string");
    }
  } catch {}
  return [...DEFAULT_WATCH];
}

export interface WatchItem {
  instrument: string;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  change: number | null;
  changePercent: number | null;
  prevClose: number | null;
}

export const useWatchlistStore = defineStore("watchlist", () => {
  const instruments = ref<string[]>(loadWatch());
  const prices = ref<Map<string, WatchItem>>(new Map());
  const isOpen = ref<boolean>(localStorage.getItem("tk-watchlist-open") !== "false");

  // Initialize prices map
  for (const inst of instruments.value) {
    prices.value.set(inst, {
      instrument: inst,
      bid: null,
      ask: null,
      mid: null,
      change: null,
      changePercent: null,
      prevClose: null,
    });
  }

  watch(
    instruments,
    (v) => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
      // Ensure prices map has entries
      for (const inst of v) {
        if (!prices.value.has(inst)) {
          prices.value.set(inst, {
            instrument: inst,
            bid: null,
            ask: null,
            mid: null,
            change: null,
            changePercent: null,
            prevClose: null,
          });
        }
      }
      // Remove old
      for (const k of [...prices.value.keys()]) {
        if (!v.includes(k)) prices.value.delete(k);
      }
      prices.value = new Map(prices.value);
    },
    { deep: true }
  );

  watch(isOpen, (v) => {
    localStorage.setItem("tk-watchlist-open", String(v));
  });

  function add(instrument: string) {
    const norm = normalizeInstrument(instrument);
    if (!SEARCHABLE_INSTRUMENTS.includes(norm as never)) return false;
    if (instruments.value.includes(norm)) return false;
    if (instruments.value.length >= 20) return false;
    instruments.value = [...instruments.value, norm];
    return true;
  }

  function remove(instrument: string) {
    const norm = normalizeInstrument(instrument);
    instruments.value = instruments.value.filter((x) => x !== norm);
  }

  function toggle() {
    isOpen.value = !isOpen.value;
  }

  function updatePrice(instrument: string, bid: number | null, ask: number | null, mid: number | null, timestamp: number) {
    const norm = normalizeInstrument(instrument);
    let item = prices.value.get(norm);
    if (!item) {
      // Not in watchlist but we still track if needed
      return;
    }
    // Calculate change vs prevClose if available, else vs first mid
    let change: number | null = null;
    let changePercent: number | null = null;
    if (item.prevClose !== null && mid !== null) {
      change = mid - item.prevClose;
      changePercent = item.prevClose !== 0 ? (change / item.prevClose) * 100 : null;
    } else if (item.mid !== null && mid !== null) {
      // First change
      change = mid - item.mid;
      changePercent = item.mid !== 0 ? (change / item.mid) * 100 : null;
    }
    // Update prevClose lazily: if we have no prevClose and we have a mid, set it after first update
    // For now, keep prevClose as first mid seen
    if (item.prevClose === null && item.mid !== null && mid !== null) {
      // keep existing mid as prevClose reference
    } else if (item.prevClose === null && mid !== null) {
      // Will set prevClose on next tick
    }

    const next: WatchItem = {
      instrument: norm,
      bid,
      ask,
      mid,
      change,
      changePercent,
      prevClose: item.prevClose ?? item.mid,
    };
    // If prevClose is still null and we have mid, set it
    if (next.prevClose === null && mid !== null) next.prevClose = mid;

    prices.value.set(norm, next);
    prices.value = new Map(prices.value);
  }

  function setPrevClose(instrument: string, close: number) {
    const norm = normalizeInstrument(instrument);
    const item = prices.value.get(norm);
    if (item) {
      item.prevClose = close;
      prices.value.set(norm, { ...item });
      prices.value = new Map(prices.value);
    }
  }

  /**
   * Seeds a symbol with its last known price + previous daily close so
   * price and % change display immediately — even while the market is
   * closed and no ticks are flowing. Live ticks later overwrite `mid`.
   */
  function seedStaticQuote(instrument: string, lastPrice: number, prevDailyClose: number) {
    const norm = normalizeInstrument(instrument);
    const item = prices.value.get(norm);
    if (!item) return;
    // Don't clobber a live tick with a stale static value
    if (item.mid !== null) {
      // Only fill prevClose if missing
      if (item.prevClose === null && Number.isFinite(prevDailyClose)) {
        prices.value.set(norm, { ...item, prevClose: prevDailyClose });
        prices.value = new Map(prices.value);
      }
      return;
    }
    const change = lastPrice - prevDailyClose;
    const changePercent = prevDailyClose !== 0 ? (change / prevDailyClose) * 100 : null;
    prices.value.set(norm, {
      instrument: norm,
      bid: item.bid,
      ask: item.ask,
      mid: lastPrice,
      change,
      changePercent,
      prevClose: prevDailyClose,
    });
    prices.value = new Map(prices.value);
  }

  return { instruments, prices, isOpen, add, remove, toggle, updatePrice, setPrevClose, seedStaticQuote };
});
