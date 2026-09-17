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
  TIMEFRAME_SECONDS,
  providerOf,
} from "@traderkomak/shared";
import { fetchCandles } from "@/services/api";
import { useReplayStore } from "@/stores/replay";
import { MarketWsClient, type WsStatus } from "@/services/wsClient";

// Progressive history: paint a screenful fast (~1 fetch to OANDA), then
// lazy-load older candles in batches as the user scrolls back. Loading the
// full 20k-bar history up front was the slow part of every TF/symbol switch.
const HISTORY_COUNT = 1500;
const LAZY_BATCH = 1000;
/** Hard cap for the in-memory series (initial window + lazy-loaded history). */
const MAX_SERIES = 20000;

/** Local cache of lazy-loaded history, per symbol+timeframe, so scrolling
 *  back through old candles doesn't re-download them on every visit. */
const cacheKey = (inst: string, tf: string) => `tk-candles:${inst}:${tf}`;
const CANDLE_CACHE_MAX = 4000;

/** OHLC sanity: finite numbers, high ≥ max(o,c), low ≤ min(o,c). */
export function isSaneCandle(c: unknown): c is Candle {
  if (!c || typeof c !== "object") return false;
  const k = c as Record<string, unknown>;
  const time = k.time;
  const open = k.open;
  const high = k.high;
  const low = k.low;
  const close = k.close;
  if (typeof time !== "number" || typeof open !== "number" || typeof high !== "number" || typeof low !== "number" || typeof close !== "number") return false;
  if (!Number.isFinite(time) || !Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) return false;
  return high >= Math.max(open, close) && low <= Math.min(open, close) && high >= low;
}

function loadCache(inst: string, tf: string): Candle[] {
  try {
    const raw = localStorage.getItem(cacheKey(inst, tf));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Candle[];
    if (!Array.isArray(parsed)) return [];
    // Dedupe by time (keep the last occurrence) and drop malformed rows —
    // duplicated or corrupt entries glue bars together on restore.
    const map = new Map<number, Candle>();
    for (const c of parsed) {
      if (isSaneCandle(c)) map.set(c.time, c);
    }
    return [...map.values()].sort((a, b) => a.time - b.time);
  } catch {
    return [];
  }
}

function saveCache(inst: string, tf: string, all: Candle[]): void {
  try {
    const map = new Map<number, Candle>();
    for (const c of all) {
      if (isSaneCandle(c)) map.set(c.time, c);
    }
    const sorted = [...map.values()].sort((a, b) => a.time - b.time);
    localStorage.setItem(cacheKey(inst, tf), JSON.stringify(sorted.slice(-CANDLE_CACHE_MAX)));
  } catch {}
}

function loadPersistedInstrument(): string {
  // Refresh restores the symbol the visitor was last viewing; a brand-new
  // visitor (nothing saved yet) gets the default (XAU/USD).
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

/** Filter a candle list down to chart-safe rows (last-line defense before
 *  anything reaches Lightweight Charts — a null/NaN row crashes its render
 *  loop and blanks the whole chart). Also ENFORCES the engine's data
 *  contract: strictly ascending times, no duplicates — unordered rows make
 *  the library's internal binary searches fail ("Value is null"). */
export function sanitizeCandles(list: Candle[]): Candle[] {
  // Map keyed by time: duplicates collapse with the LAST entry winning
  // (later rows are newer corrections), then sorted ascending.
  const byTime = new Map<number, Candle>();
  for (const c of list) {
    if (!isSaneCandle(c)) continue;
    byTime.set(c.time, c);
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
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

  // Map time → index for O(1) update-or-append. Maintained INCREMENTALLY
  // by the writers below (replace/prepend/append/truncate) instead of a
  // computed that rebuilt a 20k-entry Map on every live tick.
  const timeIndexMap = new Map<number, number>();
  const timeIndex = computed(() => timeIndexMap);

  function rebuildTimeIndex(): void {
    timeIndexMap.clear();
    candles.value.forEach((c, i) => timeIndexMap.set(c.time, i));
  }

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

  let lastWsStatus: WsStatus = "offline";
  function ensureWs(): MarketWsClient {
    if (ws) return ws;
    ws = new MarketWsClient({
      onStatus: (s) => {
        status.value = s;
        if (s === "connected" || s === "reconnecting") error.value = null;
        // Connection restored after a drop (internet blip, mobile sleep):
        // the stream resumes from NOW, so the candles missed while offline
        // must be re-fetched from the provider and merged — otherwise the
        // chart shows a gap/jump at the junction. The snapshot alone can't
        // always fill it (the server session may have missed them too).
        if (s === "connected" && lastWsStatus === "reconnecting") {
          void resyncVisible();
        }
        lastWsStatus = s;
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

  /** A flat candle (o=h=l=c) is a synthesized carry-forward (zero-tick bucket
   *  or lull filler), not real streamed market data. */
  function isFlat(c: Candle): boolean {
    return c.high === c.low && c.open === c.close && c.high === c.close;
  }

  function mergeCandles(base: Candle[], incoming: Candle[]): Candle[] {
    const map = new Map<number, Candle>();
    for (const c of base) if (isSaneCandle(c)) map.set(c.time, { ...c });
    for (const c of incoming) {
      if (!isSaneCandle(c)) continue;
      const existing = map.get(c.time);
      // Never let a synthesized flat candle degrade a locally streamed candle
      // that carries real price movement (WS reconnect snapshots from a
      // freshly recreated server session are often full of these).
      if (existing && isFlat(c) && !isFlat(existing)) continue;
      map.set(c.time, { ...c });
    }
    return [...map.values()].sort((a, b) => a.time - b.time);
  }

  /** Weekend FX close (UTC): Fri 21:00 → Sun 22:00. OANDA keeps emitting
   *  near-flat filler candles right after the close — drawn as tiny "dots"
   *  on the chart. New flat buckets during the weekend close are skipped
   *  (updates to the EXISTING last bucket still pass, keeping the close). */
  function isWeekendFxClose(): boolean {
    const d = new Date();
    const day = d.getUTCDay();
    const h = d.getUTCHours();
    if (day === 6) return true;
    if (day === 5 && h >= 21) return true;
    if (day === 0 && h < 22) return true;
    return false;
  }

  function applyCandle(candle: Candle, closed: boolean): void {
    // A malformed frame (packet loss / upstream hiccup) must never reach
    // the chart — it would draw a giant or inverted bar.
    if (!isSaneCandle(candle)) return;
    // FX closed + filler candle (flat or float-noise range) → don't paint
    // another dot on the chart. Crypto streams real ticks 24/7.
    if (isWeekendFxClose() && providerOf(instrument.value) !== "binance") {
      const range = candle.high - candle.low;
      const noise = Math.max(1e-8, Math.abs(candle.close) * 1e-7);
      const isNewBucket = !timeIndex.value.has(candle.time);
      if (isNewBucket && range <= noise) return;
    }
    // `closed` flag indicates a candle that just finalized.
    // We still handle via time-index logic: insert or replace, never duplicate.
    const idx = timeIndex.value.get(candle.time);
    if (idx !== undefined) {
      // Same guard as mergeCandles: a flat synthetic must not overwrite a
      // candle that was built from real streamed ticks.
      const existing = candles.value[idx]!;
      if (isFlat(candle) && !isFlat(existing)) {
        void closed;
        return;
      }
      // Update active candle in place.
      candles.value[idx] = { ...candle };
      // Force reactivity when updating same index.
      candles.value = [...candles.value];
    } else {
      // New bucket — append (may arrive slightly out of order only when
      // history + live race; keep sorted).
      if (candles.value.length > 0 && candle.time < candles.value[candles.value.length - 1]!.time) {
        candles.value = [...candles.value, { ...candle }].sort((a, b) => a.time - b.time);
        rebuildTimeIndex();
      } else {
        timeIndexMap.set(candle.time, candles.value.length);
        candles.value = [...candles.value, { ...candle }];
      }
      // Cap the in-memory series (initial window + lazy-loaded history)
      if (candles.value.length > MAX_SERIES) {
        candles.value = candles.value.slice(-MAX_SERIES);
        rebuildTimeIndex();
      }
    }
    void closed; // reserved for future use (e.g. close animation)
  }

  async function loadHistory(forceLive = false): Promise<void> {
    const mySeq = ++loadSeq;
    const wantInstrument = instrument.value;
    const wantTimeframe = timeframe.value;
    isLoading.value = true;
    error.value = null;
    hasMore.value = true;

    // Replay mode: load a window AROUND the replay boundary — ~85% before
    // the cut and ~15% after it, so lower timeframes show the chart around
    // the cut AND forward stepping has candles to reveal. The server caps
    // the fetch at "now". forceLive bypasses this for the replay EXIT —
    // the live window must be fetched while the replay view is still
    // frozen, so exiting never reveals the gapped intermediate array.
    const replay = useReplayStore();
    let replayTo: number | undefined;
    if (!forceLive && replay.active && replay.cutoff !== null) {
      const barSec = TIMEFRAME_SECONDS[wantTimeframe as keyof typeof TIMEFRAME_SECONDS] ?? 60;
      replayTo = Math.min(replay.cutoff + HISTORY_COUNT * barSec * 0.15, Math.floor(Date.now() / 1000));
    }

    // Up to 3 attempts — the very first request after server start can hit a
    // cold upstream connection; retrying transparently avoids a false error.
    let data: Candle[] | null = null;
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        data = await fetchCandles(wantInstrument, wantTimeframe, HISTORY_COUNT, replayTo);
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
        // Replay mode: remember where the replay-loaded history ends so
        // forward stepping never reveals candles beyond it (the live stream
        // continues after the fetch window and would draw one huge candle).
        if (replayTo !== undefined && data.length > 0) {
          useReplayStore().setDataEnd(data[data.length - 1]!.time);
        }
        // Merge locally cached lazy-loaded history (older than the fetch
        // window) so revisiting a symbol/timeframe shows the full cached
        // history immediately instead of re-fetching it via lazy loading.
        // Lightweight Charts renders a time gap as two ADJACENT bars (no
        // whitespace), so cached candles from a previous visit glued to the
        // fresh fetch drew one giant candle across the gap. Keep only the
        // cached suffix that is time-CONNECTED to the fresh window —
        // anything separated by a longer-than-tolerance gap is dropped
        // (lazy loading re-fetches that range from the provider instead).
        const tfSec = TIMEFRAME_SECONDS[wantTimeframe as keyof typeof TIMEFRAME_SECONDS] ?? 60;
        const maxGapSec = Math.max(120 * tfSec, 1800); // lulls + short breaks pass; overnights cut
        const cachedRaw =
          data.length > 0
            ? loadCache(wantInstrument, wantTimeframe).filter((c) => c.time < data[0]!.time)
            : [];
        let keepFrom = cachedRaw.length;
        while (keepFrom > 0) {
          const nextTime = keepFrom < cachedRaw.length ? cachedRaw[keepFrom]!.time : data[0]!.time;
          if (nextTime - cachedRaw[keepFrom - 1]!.time <= maxGapSec) keepFrom--;
          else break;
        }
        const cached = cachedRaw.slice(keepFrom);
        candles.value = cached.length > 0 ? mergeCandles(data, cached) : data;
        rebuildTimeIndex();
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
    const mySeq = loadSeq;
    const wantInstrument = instrument.value;
    const wantTimeframe = timeframe.value;
    isLoadingMore.value = true;
    try {
      const more = await fetchCandles(wantInstrument, wantTimeframe, LAZY_BATCH, earliest.time);
      // The user may have switched symbol/timeframe while the fetch was in
      // flight (slow connections make this common). Applying the stale
      // batch would glue OLD-timeframe candles into the NEW chart and
      // poison the localStorage cache — the exact bug that vanished only
      // after clearing site data. Same guard as loadHistory.
      if (mySeq !== loadSeq || instrument.value !== wantInstrument || timeframe.value !== wantTimeframe) {
        return false;
      }
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
      rebuildTimeIndex();
      // Persist the lazy-loaded history so future visits skip re-fetching it
      saveCache(wantInstrument, wantTimeframe, [...loadCache(wantInstrument, wantTimeframe), ...older]);
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
    rebuildTimeIndex();
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
    rebuildTimeIndex();
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
    // Background tabs: while hidden, streamed candles can arrive wrong
    // (dojis/flat fillers from upstream hiccups) and corrections can be
    // missed. When the tab becomes visible again, re-sync the recent window
    // from the authoritative REST endpoint — real candles overwrite the bad
    // ones in place.
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onVisibility);
  }

  let resyncing = false;
  async function resyncVisible(): Promise<void> {
    if (resyncing || awaitingHistory.value) return;
    const mySeq = loadSeq;
    const wantInstrument = instrument.value;
    const wantTimeframe = timeframe.value;
    resyncing = true;
    try {
      let data = await fetchCandles(wantInstrument, wantTimeframe, HISTORY_COUNT);
      if (!data.length || mySeq !== loadSeq) return;
      if (instrument.value !== wantInstrument || timeframe.value !== wantTimeframe) return;
      // A REST snapshot can LAG the live WS stream for the still-open
      // bucket. Overwriting our fresher open candle with it made the last
      // candle flash/shrink for a second on every tab return (until the
      // next WS tick rebuilt it). Keep OUR open candle; merge the rest.
      let keepLive: Candle | null = null;
      const lastExisting = candles.value[candles.value.length - 1];
      const lastIncoming = data[data.length - 1];
      if (lastExisting && lastIncoming && lastIncoming.time === lastExisting.time) {
        keepLive = lastExisting;
        data = data.slice(0, -1);
      }
      const tfSec = TIMEFRAME_SECONDS[wantTimeframe as keyof typeof TIMEFRAME_SECONDS] ?? 60;
      const maxGapSec = Math.max(120 * tfSec, 1800);
      // Keep the older local candles only while they stay time-connected to
      // the fetched window (same rule as the loadHistory cache merge) —
      // otherwise a long absence would glue two regions together.
      const baseRaw = candles.value.filter((c) => c.time < data[0]!.time);
      let keepFrom = baseRaw.length;
      while (keepFrom > 0) {
        const nextTime = keepFrom < baseRaw.length ? baseRaw[keepFrom]!.time : data[0]!.time;
        if (nextTime - baseRaw[keepFrom - 1]!.time <= maxGapSec) keepFrom--;
        else break;
      }
      const base = baseRaw.slice(keepFrom);
      let merged = mergeCandles(base.length > 0 ? base : [], data);
      if (keepLive) merged = mergeCandles(merged, [keepLive]);
      candles.value = merged;
      rebuildTimeIndex();
    } catch {
      // offline / transient — the stream keeps running; try again next focus
    } finally {
      resyncing = false;
    }
  }

  function onVisibility(): void {
    if (document.visibilityState !== "visible") return;
    const replay = useReplayStore();
    if (replay.active) return; // replay manages its own window
    void resyncVisible();
  }

  function destroy(): void {
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("online", onVisibility);
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
    loadHistory,
    loadMore,
  };
});
