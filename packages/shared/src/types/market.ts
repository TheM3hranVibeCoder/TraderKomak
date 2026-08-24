/**
 * TraderKomak internal market-data types.
 *
 * These are provider-agnostic on purpose: the OANDA adapter converts raw
 * broker payloads into these types, and nothing downstream (aggregator,
 * WebSocket hub, frontend chart) ever sees an OANDA-specific structure.
 */

/**
 * A single OHLC candle.
 *
 * `time` is the UNIX timestamp, in whole SECONDS (UTC), of the candle's
 * opening bucket boundary. All candle times across TraderKomak use this
 * convention so the chart and aggregation engine never disagree.
 */
export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

/**
 * A normalized price event.
 *
 * - `timestamp` is epoch MILLISECONDS of the event as reported by the
 *   upstream provider. The aggregation engine treats this — not any local
 *   clock — as the source of truth for candle boundaries.
 * - `mid` is derived as (bid + ask) / 2 when both sides are available.
 *   If only one side is available it is used directly; if neither is
 *   usable the tick must be dropped safely by consumers.
 */
export interface MarketTick {
  instrument: string;
  timestamp: number;
  bid: number | null;
  ask: number | null;
  mid: number | null;
}

/**
 * Resolves the price used to build candles from a tick.
 *
 * Decision (documented in README): candles are built from MID prices.
 * mid = (bid + ask) / 2 when both are present; otherwise fall back to
 * whichever side exists; otherwise `null` (tick ignored).
 */
export function resolveCandlePrice(tick: MarketTick): number | null {
  if (tick.mid !== null && Number.isFinite(tick.mid)) return tick.mid;
  if (tick.bid !== null && Number.isFinite(tick.bid)) return tick.bid;
  if (tick.ask !== null && Number.isFinite(tick.ask)) return tick.ask;
  return null;
}
