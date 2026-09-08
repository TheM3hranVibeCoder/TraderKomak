/**
 * Supported chart timeframes — sorted small → big (5s → 1M) for dropdown ordering.
 *
 * OANDA's finest granularity is S5, so the smallest timeframe is `5s`.
 * Historical data availability per timeframe is documented in the market
 * server's history-resolution logic (see apps/market-server/src/routes/candles.ts).
 */
export const TIMEFRAMES = ["5s", "10s", "15s", "30s", "1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w", "1M"] as const;

export type Timeframe = (typeof TIMEFRAMES)[number];

export const DEFAULT_TIMEFRAME: Timeframe = "5s";

/** Candle bucket length, in seconds, for each timeframe. */
export const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
  "5s": 5,
  "10s": 10,
  "15s": 15,
  "30s": 30,
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "30m": 1800,
  "1h": 3600,
  "4h": 14400,
  "1d": 86400,
  "1w": 604800,
  "1M": 2592000,
};

/**
 * Which upstream-native granularity can provide HISTORY for a timeframe.
 *
 * - `S5` / `M1` / `M5` / `M15` / `M30` / `H1`: native OANDA REST granularities.
 *
 * Note `10s`/`30s` are exact multiples of `S5`, so their history is
 * derived by aggregating S5 candles with the same engine used live.
 * `5m`+ are native, no derivation needed.
 */
export const NATIVE_HISTORY_GRANULARITY: Record<
  Timeframe,
  "S5" | "M1" | "M5" | "M15" | "M30" | "H1" | "H4" | "D" | "W" | "M" | null
> = {
  "5s": "S5",
  "10s": "S5",
  "15s": "S5",
  "30s": "S5",
  "1m": "M1",
  "5m": "M5",
  "15m": "M15",
  "30m": "M30",
  "1h": "H1",
  "4h": "H4",
  "1d": "D",
  "1w": "W",
  "1M": "M",
};

/** Display labels — 1d/1w/1M are shown as D/W/M (TradingView-style). */
export const TIMEFRAME_LABELS: Record<Timeframe, string> = {
  "5s": "5s",
  "10s": "10s",
  "15s": "15s",
  "30s": "30s",
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "30m": "30m",
  "1h": "1h",
  "4h": "4h",
  "1d": "D",
  "1w": "W",
  "1M": "M",
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

/** US DST window in UTC for a given year: 2nd Sunday of March 07:00 UTC to
 *  1st Sunday of November 06:00 UTC. */
function usDstRangeUTC(year: number): { start: number; end: number } {
  const nthSunday = (month: number, n: number, hourUTC: number) => {
    const first = Date.UTC(year, month, 1, hourUTC);
    const offset = (7 - new Date(first).getUTCDay()) % 7;
    return first + offset + (n - 1) * 7 * 86400000;
  };
  return { start: nthSunday(2, 2, 7), end: nthSunday(10, 1, 6) };
}

/**
 * Start of the DAILY bucket per OANDA's convention: candles open at 5pm
 * New York (21:00 UTC in DST, 22:00 UTC otherwise) — NOT at UTC midnight.
 * The live daily aggregation must match the native D history boundaries or
 * the 1d chart shows stray overlapping candles.
 */
/** The OANDA daily-candle open time (5pm New York) for the UTC day that
 *  contains `dayNoonMs` (noon of that UTC day — the DST state at noon
 *  matches the state at the 17:00-NY boundary later that day). */
function dailyOpenFor(dayNoonMs: number): number {
  const { start, end } = usDstRangeUTC(new Date(dayNoonMs).getUTCFullYear());
  return dayNoonMs >= start && dayNoonMs < end ? 21 * 3600000 : 22 * 3600000;
}

export function oandaDailyBucketStart(timestampMs: number): number {
  const DAY = 86400000;
  const dayMidnight = Math.floor(timestampMs / DAY) * DAY;
  let cand = dayMidnight + dailyOpenFor(dayMidnight + 12 * 3600000);
  if (cand > timestampMs) {
    const prevDay = dayMidnight - DAY;
    cand = prevDay + dailyOpenFor(prevDay + 12 * 3600000);
  }
  return cand;
}

/** Start of the WEEKLY bucket. Native OANDA W candles open at 5pm New York
 *  on FRIDAY (verified against the W history — candles anchor to Fridays,
 *  e.g. 2026-08-14/21/28 21:00 UTC, NOT to Sundays). */
export function oandaWeeklyBucketStart(timestampMs: number): number {
  const DAY = 86400000;
  const dayMidnight = Math.floor(timestampMs / DAY) * DAY;
  const dow = new Date(dayMidnight).getUTCDay();
  const daysSinceFriday = (dow - 5 + 7) % 7;
  const friday = dayMidnight - daysSinceFriday * DAY;
  let cand = friday + dailyOpenFor(friday + 12 * 3600000);
  if (cand > timestampMs) {
    const prevFriday = friday - 7 * DAY;
    cand = prevFriday + dailyOpenFor(prevFriday + 12 * 3600000);
  }
  return cand;
}

/** Start of the MONTHLY bucket. Native OANDA M candles open at 5pm New York
 *  on the LAST day of the previous month (the session that contains the new
 *  month — e.g. September's candle opens 2026-08-31 21:00 UTC). */
export function oandaMonthlyBucketStart(timestampMs: number): number {
  const DAY = 86400000;
  const d = new Date(timestampMs);
  for (let m = d.getUTCMonth() + 1; m >= d.getUTCMonth() - 1; m--) {
    const monthStart = Date.UTC(d.getUTCFullYear() + Math.floor(m / 12), ((m % 12) + 12) % 12, 1);
    const lastDayPrev = monthStart - DAY;
    const cand = lastDayPrev + dailyOpenFor(lastDayPrev + 12 * 3600000);
    if (cand <= timestampMs) return cand;
  }
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

/** Start of the 4-HOUR bucket. Native OANDA H4 candles are offset from the
 *  5pm-New-York session start (21/01/05/09/13/17 UTC in DST), NOT aligned
 *  to UTC midnight — so the grid anchors to the daily open and steps 4h. */
export function oandaH4BucketStart(timestampMs: number): number {
  const H4 = 4 * 3600000;
  const DAY = 86400000;
  let session = oandaDailyBucketStart(timestampMs);
  if (session > timestampMs) session = oandaDailyBucketStart(timestampMs - DAY);
  return session + Math.floor((timestampMs - session) / H4) * H4;
}

/** Bucket start honoring OANDA session conventions for the large
 *  timeframes (4h/D/W/M align to 5pm-NY boundaries, not UTC midnight). */
export function oandaAlignedBucketStart(timestampMs: number, timeframeSeconds: number): number {
  if (timeframeSeconds === 14400) return oandaH4BucketStart(timestampMs);
  if (timeframeSeconds === 86400) return oandaDailyBucketStart(timestampMs);
  if (timeframeSeconds === 604800) return oandaWeeklyBucketStart(timestampMs);
  if (timeframeSeconds === 2592000) return oandaMonthlyBucketStart(timestampMs);
  return bucketStart(timestampMs, timeframeSeconds);
}

/**
 * Bucket start honoring Binance (UTC) conventions — used for Binance spot
 * symbols so the LIVE aggregation matches their native kline history:
 *   4h / 1d → plain UTC multiples (00:00, 04:00, 08:00 … UTC)
 *   1w      → Monday 00:00 UTC (a plain modulo of the epoch anchors to
 *             Thursday — Binance weeks start Monday)
 *   1M      → 1st of the month, 00:00 UTC (a fixed 30d modulo drifts)
 */
export function binanceBucketStart(timestampMs: number, timeframeSeconds: number): number {
  if (timeframeSeconds === 604800) {
    const d = new Date(timestampMs);
    const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const daysSinceMonday = (d.getUTCDay() + 6) % 7;
    return midnight - daysSinceMonday * 86400000;
  }
  if (timeframeSeconds === 2592000) {
    const d = new Date(timestampMs);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  }
  return bucketStart(timestampMs, timeframeSeconds);
}
