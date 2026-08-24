/**
 * OANDA adapter: converts raw OANDA REST/stream payloads into
 * TraderKomak's internal market-data types. Nothing downstream is allowed
 * to depend on OANDA response shapes.
 */
import type { Candle, MarketTick } from "@traderkomak/shared";

interface OandaCandleMid {
  o?: unknown;
  h?: unknown;
  l?: unknown;
  c?: unknown;
}

export interface RawOandaCandle {
  complete?: unknown;
  time?: unknown;
  mid?: OandaCandleMid;
  volume?: unknown;
}

export interface RawOandaCandlesResponse {
  instrument?: unknown;
  granularity?: unknown;
  candles?: unknown;
}

function parsePrice(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const n = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

/** RFC3339 timestamp → epoch seconds; null when malformed. */
export function oandaTimeToSeconds(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / 1000);
}

/**
 * Converts an OANDA /candles response into ascending, de-duplicated
 * internal candles. Malformed rows are skipped, never fatal.
 *
 * The trailing INCOMPLETE candle is kept on purpose: it is the bucket
 * currently forming, and consumers rely on it to seed the live aggregator
 * and show a real active candle immediately after switching timeframes
 * (instead of one built from zero by incoming ticks).
 */
export function toCandles(response: RawOandaCandlesResponse): Candle[] {
  const rows = Array.isArray(response.candles) ? response.candles : [];
  const out = new Map<number, Candle>();

  for (const row of rows as RawOandaCandle[]) {
    const time = oandaTimeToSeconds(row.time);
    if (time === null) continue;
    const open = parsePrice(row.mid?.o);
    const high = parsePrice(row.mid?.h);
    const low = parsePrice(row.mid?.l);
    const close = parsePrice(row.mid?.c);
    if (open === null || high === null || low === null || close === null) continue;

    out.set(time, { time, open, high, low, close });
  }

  return [...out.values()].sort((a, b) => a.time - b.time);
}

/**
 * Normalizes one OANDA pricing-stream message into a MarketTick.
 *
 * Returns `null` for anything unusable (heartbeats are surfaced separately
 * by the stream client). Malformed events never throw.
 *
 * Price decision (documented in README):
 *   mid  = (bid + ask) / 2 when both sides exist,
 *   otherwise the single available side,
 *   otherwise the tick is dropped.
 */
export function priceEventToTick(msg: unknown): MarketTick | null {
  if (typeof msg !== "object" || msg === null) return null;
  const m = msg as Record<string, unknown>;
  if (m.type !== "PRICE") return null;
  if (typeof m.instrument !== "string" || m.instrument.length === 0) return null;

  const ms = typeof m.time === "string" ? Date.parse(m.time) : NaN;
  if (!Number.isFinite(ms)) return null;

  const bid = firstSidePrice(m.bids);
  const ask = firstSidePrice(m.asks);

  let mid: number | null = null;
  if (bid !== null && ask !== null) mid = (bid + ask) / 2;

  // Drop non-tradeable statuses — stale/indicative prices must not build candles.
  if (typeof m.status === "string" && m.status !== "tradeable") {
    return {
      instrument: m.instrument,
      timestamp: Math.floor(ms),
      bid,
      ask,
      mid,
    };
  }
  if (bid === null && ask === null && mid === null) return null;

  return {
    instrument: m.instrument,
    timestamp: Math.floor(ms),
    bid,
    ask,
    mid,
  };
}

function firstSidePrice(sides: unknown): number | null {
  if (!Array.isArray(sides) || sides.length === 0) return null;
  const first = sides[0] as Record<string, unknown> | undefined;
  if (!first) return null;
  return parsePrice(first.price);
}
