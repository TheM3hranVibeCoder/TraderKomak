/**
 * cTrader adapter: converts raw cTrader Open API payloads into
 * TraderKomak's internal market-data types. Nothing downstream is allowed
 * to depend on cTrader response shapes.
 *
 * Price scaling (per help.ctrader.com/open-api/symbol-data): every price
 * in the protocol is an integer in 1/100000 of the quote unit — 4425025000
 * means 44250.25. Trendbar OHLC arrives RELATIVE: open = low + deltaOpen,
 * close = low + deltaClose, high = low + deltaHigh, all in the same units.
 */
import type { Candle, MarketTick } from "@traderkomak/shared";

/** 1/100000-scaled protocol price → display price, rounded to symbol digits. */
export function scalePrice(raw: number, digits: number): number {
  const price = raw / 100000;
  if (!Number.isFinite(price)) return price;
  const f = 10 ** digits;
  return Math.round(price * f) / f;
}

/** Raw ProtoOATrendbar (already decoded to numbers) → internal Candle. */
export interface RawTrendbar {
  volume: number;
  period?: number;
  low: number;
  deltaOpen: number;
  deltaClose: number;
  deltaHigh: number;
  utcTimestampInMinutes: number;
}

export function trendbarToCandle(tb: RawTrendbar, digits: number): Candle | null {
  const { low, deltaOpen, deltaClose, deltaHigh } = tb;
  if (
    !Number.isFinite(low) ||
    !Number.isFinite(deltaOpen) ||
    !Number.isFinite(deltaClose) ||
    !Number.isFinite(deltaHigh) ||
    !Number.isFinite(tb.utcTimestampInMinutes) ||
    tb.utcTimestampInMinutes <= 0
  ) {
    return null;
  }
  const open = scalePrice(low + deltaOpen, digits);
  const high = scalePrice(low + deltaHigh, digits);
  const lowP = scalePrice(low, digits);
  const close = scalePrice(low + deltaClose, digits);
  return {
    time: tb.utcTimestampInMinutes * 60,
    open,
    high: Math.max(high, open, close, lowP),
    low: Math.min(lowP, open, close, high),
    close,
  };
}

/**
 * ProtoOASpotEvent → MarketTick. cTrader often updates only ONE side per
 * event, so the stream client carries the last known bid/ask; this function
 * stays pure: missing sides become null and `mid` is computed only when
 * both sides exist.
 */
export function spotEventToTick(
  symbolId: number,
  instrument: string,
  bid: number | null,
  ask: number | null,
  timestamp: number
): MarketTick {
  const mid = bid !== null && ask !== null ? (bid + ask) / 2 : null;
  return { instrument, timestamp, bid, ask, mid };
}

/** One decoded ProtoOATickData row: timestamp in ms, price in 1/100000. */
export interface RawTick {
  timestamp: number;
  tick: number;
}

/**
 * Builds 5-second candles from bid ticks. cTrader has no native second
 * bars, so the sub-minute timeframes (5s/10s/15s/30s) derive their history
 * from tick data: the returned S5 candles are what NATIVE_HISTORY_GRANULARITY
 * promises for those timeframes, and the shared aggregateCandles engine
 * (callers) builds 10s/15s/30s from them exactly like the OANDA path.
 *
 * Tick timestamps (per ProtoOAGetTickDataRes docs): the FIRST tick carries
 * an absolute Unix time in ms; every subsequent row carries the time
 * DIFFERENCE (ms) between the previous tick and itself (the list is
 * newest-first, so deltas count backwards). `absolute` expands them.
 */
export function expandTickTimestamps(rows: RawTick[]): Array<{ timeMs: number; price: number }> {
  const out: Array<{ timeMs: number; price: number }> = [];
  let prev = 0;
  for (const row of rows) {
    if (!Number.isFinite(row.tick)) continue;
    const t = out.length === 0 ? row.timestamp : prev - row.timestamp;
    if (!Number.isFinite(t) || t <= 0) continue;
    prev = t;
    out.push({ timeMs: t, price: row.tick });
  }
  return out;
}

/**
 * S5 candles from raw ticks (already timestamp-expanded), rounded to
 * symbol digits. Returns ascending candles with no duplicates.
 */
export function ticksToS5Candles(
  ticks: Array<{ timeMs: number; price: number }>,
  digits: number
): Candle[] {
  const buckets = new Map<number, Candle>();
  for (const { timeMs, price } of ticks) {
    if (!Number.isFinite(timeMs) || timeMs <= 0 || !Number.isFinite(price)) continue;
    const p = scalePrice(price, digits);
    const time = Math.floor(timeMs / 5000) * 5;
    const existing = buckets.get(time);
    if (!existing) {
      buckets.set(time, { time, open: p, high: p, low: p, close: p });
    } else {
      if (p > existing.high) existing.high = p;
      if (p < existing.low) existing.low = p;
      existing.close = p;
    }
  }
  return [...buckets.values()].sort((a, b) => a.time - b.time);
}
