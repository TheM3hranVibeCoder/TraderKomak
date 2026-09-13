/**
 * Dukascopy bank datafeed client — free public historical data, no key.
 *
 *   https://datafeed.dukascopy.com/datafeed/{SYM}/{YYYY}/{M-1}/{D}/BID_candles_min_1.bi5
 *   https://datafeed.dukascopy.com/datafeed/{SYM}/{YYYY}/{M-1}/{D}/{H}h_ticks.bi5
 *
 * All times UTC. Candle files hold 1-minute records for one UTC day;
 * tick files hold one UTC hour of raw ticks. A 404 simply means "no data
 * in that period" (weekends / before the instrument existed).
 */
import { decompressBi5, parseMinuteCandles, parseTicks } from "./bi5.js";
import type { Candle } from "@traderkomak/shared";

const BASE = "https://datafeed.dukascopy.com/datafeed";
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** Prices come as integer points — divide by this factor per symbol. */
const PRICE_FACTOR: Record<string, number> = {
  EURUSD: 1e5,
  GBPUSD: 1e5,
  USDJPY: 1e3,
  XAUUSD: 1e3,
  XAGUSD: 1e3,
  BTCUSD: 1,
};

/** D_XAU_USD → "XAUUSD". Mirrors shared dukasSymbolOf (server-side copy). */
export function dukasSymbol(instrument: string): string {
  return instrument.toUpperCase().replace(/^D_/, "").replace(/_/g, "");
}

function factorOf(symbol: string): number {
  return PRICE_FACTOR[symbol] ?? 1e5;
}

const fileCache = new Map<string, { at: number; buf: Buffer }>();
const FILE_TTL_MS = 60_000;
/** The current day/hour file keeps growing — never cache it for long. */
const LIVE_TTL_MS = 4_000;

async function fetchBi5(url: string, live: boolean): Promise<Buffer | null> {
  const hit = fileCache.get(url);
  const ttl = live ? LIVE_TTL_MS : FILE_TTL_MS;
  if (hit && Date.now() - hit.at < ttl) return hit.buf;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (res.status === 404) {
      fileCache.set(url, { at: Date.now(), buf: Buffer.alloc(0) });
      return Buffer.alloc(0);
    }
    if (!res.ok) return hit ? hit.buf : null;
    const buf = Buffer.from(await res.arrayBuffer());
    fileCache.set(url, { at: Date.now(), buf });
    return buf;
  } catch {
    return hit ? hit.buf : null;
  }
}

async function fetchDayMinutes(symbol: string, dayStartMs: number): Promise<{ time: number; open: number; close: number; low: number; high: number }[]> {
  const d = new Date(dayStartMs);
  const url = `${BASE}/${symbol}/${d.getUTCFullYear()}/${d.getUTCMonth()}/${d.getUTCDate()}/BID_candles_min_1.bi5`;
  const buf = await fetchBi5(url, Date.now() - dayStartMs < DAY_MS);
  if (!buf) return [];
  const raw = decompressBi5(buf);
  const factor = factorOf(symbol);
  const baseSec = Math.floor(dayStartMs / 1000);
  return parseMinuteCandles(raw).map((c) => ({
    time: baseSec + c.offsetSec,
    open: c.open / factor,
    close: c.close / factor,
    low: c.low / factor,
    high: c.high / factor,
  }));
}

async function fetchHourTicks(symbol: string, hourStartMs: number): Promise<{ t: number; bid: number }[]> {
  const d = new Date(hourStartMs);
  const url = `${BASE}/${symbol}/${d.getUTCFullYear()}/${d.getUTCMonth()}/${d.getUTCDate()}/${d.getUTCHours()}h_ticks.bi5`;
  const buf = await fetchBi5(url, Date.now() - hourStartMs < 2 * HOUR_MS);
  if (!buf) return [];
  const raw = decompressBi5(buf);
  const factor = factorOf(symbol);
  return parseTicks(raw).map((t) => ({
    t: Math.floor((hourStartMs + t.offsetMs) / 1000),
    bid: t.bid / factor,
  }));
}

/** Aggregate 1-minute rows into bucket candles (bucket start in ms). */
function bucketMinutes(
  rows: { time: number; open: number; close: number; low: number; high: number }[],
  bucketMs: number
): Candle[] {
  const out: Candle[] = [];
  let cur: Candle | null = null;
  let curBucket = -1;
  for (const r of rows) {
    const b = Math.floor(r.time / bucketMs) * bucketMs;
    if (!cur || b !== curBucket) {
      if (cur) out.push(cur);
      cur = { time: Math.floor(b / 1000), open: r.open, high: r.high, low: r.low, close: r.close };
      curBucket = b;
    } else {
      cur.high = Math.max(cur.high, r.high);
      cur.low = Math.min(cur.low, r.low);
      cur.close = r.close;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** Aggregate raw ticks into bucket candles. */
function bucketTicks(
  ticks: { t: number; bid: number }[],
  bucketMs: number
): Candle[] {
  const out: Candle[] = [];
  let cur: Candle | null = null;
  let curBucket = -1;
  for (const t of ticks) {
    const b = Math.floor(t.t / (bucketMs / 1000)) * (bucketMs / 1000);
    if (!cur || b !== curBucket) {
      if (cur) out.push(cur);
      cur = { time: Math.floor(b / 1000), open: t.bid, high: t.bid, low: t.bid, close: t.bid };
      curBucket = b;
    } else {
      cur.high = Math.max(cur.high, t.bid);
      cur.low = Math.min(cur.low, t.bid);
      cur.close = t.bid;
    }
  }
  if (cur) out.push(cur);
  return out;
}

const TF_MS: Record<string, number> = {
  "5s": 5_000,
  "10s": 10_000,
  "15s": 15_000,
  "30s": 30_000,
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "30m": 1_800_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
  "1w": 604_800_000,
  "1M": 2_592_000_000,
};

export interface DukaHistoryResult {
  candles: Candle[];
  /** false when the walk hit a period with no data (start of history). */
  hasMore: boolean;
}

/**
 * History for any shared timeframe. Sub-minute builds from tick files,
 * 1m+ from minute-candle files, walking backwards until `count` candles
 * are collected (or data runs out).
 */
export async function getHistory(
  instrument: string,
  timeframe: string,
  count: number,
  toSec?: number
): Promise<DukaHistoryResult> {
  const symbol = dukasSymbol(instrument);
  const bucketMs = TF_MS[timeframe] ?? 60_000;
  const subMinute = bucketMs < 60_000;
  const stepMs = subMinute ? HOUR_MS : DAY_MS;

  const endMs = (toSec ? toSec * 1000 : Date.now());
  // Align the walk so the newest COMPLETE buckets land in range.
  let cursorMs = Math.floor(endMs / stepMs) * stepMs;
  const collected: Candle[] = [];
  let emptyStreak = 0;
  let hasMore = true;

  while (collected.length < count) {
    const batch = subMinute
      ? bucketTicks(await fetchHourTicks(symbol, cursorMs), bucketMs)
      : bucketMinutes(await fetchDayMinutes(symbol, cursorMs), bucketMs);
    const usable = batch.filter((c) => c.time * 1000 + bucketMs <= endMs);
    if (usable.length === 0) {
      emptyStreak++;
      // Weekends/holidays are long empty stretches (≈49 empty hours) — only
      // stop walking when the empty run clearly precedes the instrument.
      if (emptyStreak > (subMinute ? 90 : 15)) { hasMore = false; break; }
    } else {
      emptyStreak = 0;
      collected.unshift(...usable);
    }
    if (cursorMs < symbolStartMs(symbol)) { hasMore = false; break; }
    cursorMs -= stepMs;
  }

  // Newest first during the walk → trim from the head (oldest) and sort asc.
  const candles = collected.slice(-count);
  return { candles, hasMore: candles.length >= count && hasMore };
}

/** Dukascopy began publishing these symbols around these years. */
function symbolStartMs(symbol: string): number {
  if (symbol === "BTCUSD") return Date.UTC(2016, 0, 1);
  return Date.UTC(2003, 0, 1);
}

/** Latest ticks for the live poller (current hour, newest last). */
export async function getRecentTicks(instrument: string): Promise<{ t: number; bid: number }[]> {
  const symbol = dukasSymbol(instrument);
  const nowHour = Math.floor(Date.now() / HOUR_MS) * HOUR_MS;
  const [cur, prev] = await Promise.all([
    fetchHourTicks(symbol, nowHour),
    fetchHourTicks(symbol, nowHour - HOUR_MS),
  ]);
  return [...prev.slice(-20), ...cur];
}
