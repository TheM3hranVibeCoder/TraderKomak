/**
 * Supported chart timeframes — sorted small → big (1s → 1h) for dropdown ordering.
 *
 * OANDA has no native 1-second granularity, so `1s` candles are generated
 * by the aggregation engine from the live pricing stream. Historical data
 * availability per timeframe is documented in the market server's
 * history-resolution logic (see apps/market-server/src/routes/candles.ts).
 */
export const TIMEFRAMES = ["1s", "5s", "10s", "15s", "30s", "1m", "5m", "15m", "30m", "1h", "1d"] as const;

export type Timeframe = (typeof TIMEFRAMES)[number];

export const DEFAULT_TIMEFRAME: Timeframe = "5s";

/** Candle bucket length, in seconds, for each timeframe. */
export const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
  "1s": 1,
  "5s": 5,
  "10s": 10,
  "15s": 15,
  "30s": 30,
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "30m": 1800,
  "1h": 3600,
  "1d": 86400,
};

/**
 * Which upstream-native granularity can provide HISTORY for a timeframe.
 *
 * - `S5` / `M1` / `M5` / `M15` / `M30` / `H1`: native OANDA REST granularities.
 * - `null`: no native source exists (only `1s`); history must come from
 *   the live aggregation buffers held by the market server.
 *
 * Note `10s`/`30s` are exact multiples of `S5`, so their history is
 * derived by aggregating S5 candles with the same engine used live.
 * `5m`+ are native, no derivation needed.
 */
export const NATIVE_HISTORY_GRANULARITY: Record<Timeframe, "S5" | "M1" | "M5" | "M15" | "M30" | "H1" | "D" | null> = {
  "1s": null,
  "5s": "S5",
  "10s": "S5",
  "15s": "S5",
  "30s": "S5",
  "1m": "M1",
  "5m": "M5",
  "15m": "M15",
  "30m": "M30",
  "1h": "H1",
  "1d": "D",
};

/** How many native-granularity candles are needed to build N tf-candles. */
export function nativeCandlesNeeded(timeframe: Timeframe, count: number): number {
  const g = NATIVE_HISTORY_GRANULARITY[timeframe];
  if (g === null) return 0;
  // Native timeframes (M1/M5/…) map 1:1
  if (g !== "S5") return count;
  const multiplier = TIMEFRAME_SECONDS[timeframe] / TIMEFRAME_SECONDS["5s"];
  return Math.ceil(count * multiplier);
}

/** Ordered list small→big — used for dropdown. Already sorted via TIMEFRAMES. */
export const TIMEFRAMES_ORDERED = [...TIMEFRAMES];

/** Start time of the candle bucket containing `timestampMs`. */
export function bucketStart(timestampMs: number, timeframeSeconds: number): number {
  const ms = timeframeSeconds * 1000;
  return Math.floor(timestampMs / ms) * ms;
}
