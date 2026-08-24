/**
 * TraderKomak market store (Pinia).
 *
 * Holds the current symbol/timeframe, historical candles, live candle state,
 * connection status and error. The chart adapter reads from this store.
 * Orchestrates the data flow:
 *   fetch history → set chart data → subscribe WS → handle live updates
 */
import { defineStore } from "pinia";
import { ref, computed, watch } from "vue";
import type { Candle, Timeframe } from "@traderkomak/shared";
import {
  DEFAULT_INSTRUMENT,
  DEFAULT_TIMEFRAME,
  isInstrument,
  isTimeframe,
  normalizeInstrument,
} from "@traderkomak/shared";
import { fetchCandles } from "@/services/api";
import { MarketWsClient, type WsStatus } from "@/services/wsClient";

const HISTORY_COUNT = 2000;
const LAZY_BATCH = 500;

function loadPersistedInstrument(): string {
  try {
    const v = localStorage.getItem("tk-instrument");
    if (v && isInstrument(v)) return normalizeInstrument(v);
  } catch {}
  return DEFAULT_INSTRUMENT;
}
function loadPersistedTimeframe(): typeof DEFAULT_TIMEFRAME {
  try {
    const v = localStorage.getItem("tk-timeframe");
    if (v && isTimeframe(v)) return v as typeof DEFAULT_TIMEFRAME;
  } catch {}
  return DEFAULT_TIMEFRAME;
}

export const useMarketStore = defineStore("market", () => {
  const instrument = ref<string>(loadPersistedInstrument());
  const timeframe = ref<Timeframe>(loadPersistedTimeframe());
  const candles = ref<Candle[]>([]);
  const status = ref<WsStatus>("connecting");
  const error = ref<string | null>(null);
  const isLoading = ref(false);
  const isLoadingMore = ref(false);
  const hasMore = ref(true);

  // Map time → index for O(1) update-or-append.
  const timeIndex = computed(() => {
    const map = new Map<number, number>();
    candles.value.forEach((c, i) => map.set(c.time, i));
    return map;
  });

  let ws: MarketWsClient | null = null;
  let loadSeq = 0;
  /** While true, WS snapshots are ignored so a slow history fetch can never
   *  be overwritten by the (short) server buffer of the previous view. */
  const awaitingHistory = ref(true);

  // Persist symbol/timeframe
  watch(
    () => instrument.value,
    (v) => {
      try {
        localStorage.setItem("tk-instrument", v);
      } catch {}
    }
  );
  watch(
    () => timeframe.value,
    (v) => {
      try {
        localStorage.setItem("tk-timeframe", v);
      } catch {}
    }
  );

  function ensureWs(): MarketWsClient {
    if (ws) return ws;
    ws = new MarketWsClient({
      onStatus: (s) => {
        status.value = s;
        if (s === "connected" || s === "reconnecting") error.value = null;
      },
      onSnapshot: (inst, tf, snapshotCandles) => {
        if (inst !== instrument.value || tf !== timeframe.value) return;
        // Until the fresh history for THIS pair has landed, ignore snapshots —
        // they may carry stale buffered candles that look like old prices.
        if (awaitingHistory.value) return;
        if (snapshotCandles.length === 0) return;

        const merged = mergeCandles(candles.value, snapshotCandles);
        candles.value = merged;
      },
      onCandle: (inst, tf, candle, closed) => {
        if (inst !== instrument.value || tf !== timeframe.value) return;
        // Live ticks before history lands would create a lonely candle at the
        // wrong price context; drop them too.
        if (awaitingHistory.value) return;
        applyCandle(candle, closed);
      },
      onError: (msg) => {
        error.value = msg;
      },
    });
    ws.connect();
    return ws;
  }

  function mergeCandles(base: Candle[], incoming: Candle[]): Candle[] {
    const map = new Map<number, Candle>();
    for (const c of base) map.set(c.time, { ...c });
    for (const c of incoming) map.set(c.time, { ...c });
    return [...map.values()].sort((a, b) => a.time - b.time);
  }

  function applyCandle(candle: Candle, closed: boolean): void {
    // `closed` flag indicates a candle that just finalized.
    // We still handle via time-index logic: insert or replace, never duplicate.
    const idx = timeIndex.value.get(candle.time);
    if (idx !== undefined) {
      // Update active candle in place.
      candles.value[idx] = { ...candle };
      // Force reactivity when updating same index.
      candles.value = [...candles.value];
    } else {
      // New bucket — append (may arrive slightly out of order only when
      // history + live race; keep sorted).
      if (candles.value.length > 0 && candle.time < candles.value[candles.value.length - 1]!.time) {
        candles.value = [...candles.value, { ...candle }].sort((a, b) => a.time - b.time);
      } else {
        candles.value = [...candles.value, { ...candle }];
      }
      // Cap at reasonable size to avoid unbounded growth (keep last 5000).
      if (candles.value.length > 5000) {
        candles.value = candles.value.slice(-5000);
      }
    }
    void closed; // reserved for future use (e.g. close animation)
  }

  async function loadHistory(): Promise<void> {
    const mySeq = ++loadSeq;
    const wantInstrument = instrument.value;
    const wantTimeframe = timeframe.value;
    isLoading.value = true;
    error.value = null;
    hasMore.value = true;

    // Up to 3 attempts — the very first request after server start can hit a
    // cold upstream connection; retrying transparently avoids a false error.
    let data: Candle[] | null = null;
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        data = await fetchCandles(wantInstrument, wantTimeframe, HISTORY_COUNT);
        lastError = null;
        break;
      } catch (e) {
        lastError = e;
        if (attempt < 3) {
          await new Promise((r) => setTimeout(r, 700 * attempt));
          // Stop retrying if the user switched away while we waited
          if (mySeq !== loadSeq) return;
        }
      }
    }

    try {
      if (mySeq !== loadSeq) return;
      if (wantInstrument !== instrument.value || wantTimeframe !== timeframe.value) return;
      if (data) {
        candles.value = data;
        hasMore.value = data.length >= HISTORY_COUNT;
        awaitingHistory.value = false; // history landed → accept live frames
        if (data.length === 0) {
          console.warn(`No candles for ${wantInstrument} ${wantTimeframe} — market may be closed or instrument has no data`);
        }
      } else {
        error.value = lastError instanceof Error ? lastError.message : "Failed to load candles";
      }
    } finally {
      if (mySeq === loadSeq) isLoading.value = false;
    }
  }

  async function loadMore(): Promise<boolean> {
    if (isLoadingMore.value || !hasMore.value || candles.value.length === 0) return false;
    const earliest = candles.value[0];
    if (!earliest) return false;
    const wantInstrument = instrument.value;
    const wantTimeframe = timeframe.value;
    isLoadingMore.value = true;
    try {
      const more = await fetchCandles(wantInstrument, wantTimeframe, LAZY_BATCH, earliest.time);
      if (more.length === 0) {
        hasMore.value = false;
        return false;
      }
      // Filter to only older candles and avoid duplicates
      const existing = new Set(candles.value.map((c) => c.time));
      const older = more.filter((c) => c.time < earliest.time && !existing.has(c.time));
      if (older.length === 0) {
        hasMore.value = false;
        return false;
      }
      candles.value = [...older.sort((a, b) => a.time - b.time), ...candles.value];
      if (more.length < LAZY_BATCH) hasMore.value = false;
      return true;
    } catch {
      return false;
    } finally {
      isLoadingMore.value = false;
    }
  }

  async function setInstrument(next: string): Promise<void> {
    if (next === instrument.value) return;
    loadSeq++; // invalidate any in-flight history for the old symbol
    awaitingHistory.value = true; // block stale WS frames for old/new mix
    ensureWs().unsubscribe(); // stop old stream immediately
    instrument.value = next;
    candles.value = [];
    error.value = null;
    await loadHistory();
    ensureWs().subscribe(instrument.value, timeframe.value);
  }

  async function setTimeframe(next: Timeframe): Promise<void> {
    if (next === timeframe.value) return;
    loadSeq++;
    awaitingHistory.value = true;
    ensureWs().unsubscribe();
    timeframe.value = next;
    candles.value = [];
    error.value = null;
    await loadHistory();
    ensureWs().subscribe(instrument.value, timeframe.value);
  }

  function init(): void {
    const client = ensureWs();
    // Kick off history load + subscription; subscription also happens inside ws open.
    void loadHistory().then(() => {
      client.subscribe(instrument.value, timeframe.value);
    });
  }

  function destroy(): void {
    if (ws) {
      ws.disconnect();
      ws = null;
    }
  }

  return {
    instrument,
    timeframe,
    candles,
    status,
    error,
    isLoading,
    isLoadingMore,
    hasMore,
    init,
    destroy,
    setInstrument,
    setTimeframe,
    loadMore,
  };
});
