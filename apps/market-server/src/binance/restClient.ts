/**
 * Binance REST client (klines history) — server-side only, public endpoints,
 * no API key required.
 *
 * Interval plan per TraderKomak timeframe:
 *   1s/1m/5m/15m/30m/1h/1d → native Binance interval (1:1)
 *   5s/10s/15s/30s         → derived from 1s klines via the shared
 *                            aggregateCandles engine (Binance has no native
 *                            sub-minute intervals besides 1s)
 *
 * Pagination: max 1000 klines/request; walks backwards with `endTime`.
 */
import { TIMEFRAME_SECONDS, type Timeframe } from "@traderkomak/shared";
import { aggregateCandles } from "../market/aggregator.js";
import type { Candle } from "@traderkomak/shared";

export type RestErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "RATE_LIMITED"
  | "INVALID_INSTRUMENT"
  | "INVALID_TIMEFRAME"
  | "UPSTREAM_ERROR"
  | "NETWORK_ERROR";

export class BinanceRestError extends Error {
  constructor(
    public readonly code: RestErrorCode,
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = "BinanceRestError";
  }
}

const REQUEST_TIMEOUT_MS = 15_000;
const BINANCE_MAX_LIMIT = 1000;
const MAX_BATCHES = 20;
const RETRY_DELAY_MS = 500;
const MAX_ATTEMPTS = 3;

/** Native interval + how many source candles make ONE target candle. */
function planFor(tf: Timeframe): { interval: string; factor: number } {
  const sec = TIMEFRAME_SECONDS[tf];
  if (sec < 60) {
    // Sub-minute: only 1s is native on Binance
    return { interval: "1s", factor: sec };
  }
  const map: Record<number, string> = {
    60: "1m", 300: "5m", 900: "15m", 1800: "30m",
    3600: "1h", 14400: "4h", 86400: "1d", 604800: "1w", 2592000: "1M",
  };
  return { interval: map[sec] ?? "1m", factor: 1 };
}

type RawKline = [
  number, string, string, string, string, // openTime o h l c
  string, number, number, string, number, string, string // volume/closeTime/…
];

export interface BinanceRestConfig {
  apiUrl: string;
}

export class BinanceRestClient {
  constructor(private readonly config: BinanceRestConfig) {}

  async getNativeCandles(
    instrument: string,
    timeframe: Timeframe,
    count: number,
    toIso?: string
  ): Promise<Candle[]> {
    const { interval, factor } = planFor(timeframe);
    const tfSec = TIMEFRAME_SECONDS[timeframe];
    // Binance interval duration in ms ("1s" for sub-minute TFs, else the
    // native interval; "1M" is variable-length and excluded from parallel).
    const intervalMs = (tfSec < 60 ? 1 : tfSec) * 1000;
    const needed = Math.min(count * factor, MAX_BATCHES * BINANCE_MAX_LIMIT);
    const batchCount = Math.min(Math.ceil(needed / BINANCE_MAX_LIMIT), MAX_BATCHES);
    const startEndMs = toIso !== undefined ? Date.parse(toIso) : Date.now();

    let all: Candle[] = [];

    if (batchCount <= 1 || interval === "1M") {
      // Single batch (or the monthly walk — uneven month lengths make
      // estimated windows unreliable): sequential as before.
      let endTimeMs: number | undefined =
        toIso !== undefined ? Date.parse(toIso) : undefined;
      for (let batch = 0; batch < MAX_BATCHES && all.length < needed; batch++) {
        const rows = await this.fetchBatch(instrument, interval, Math.min(needed - all.length, BINANCE_MAX_LIMIT), endTimeMs);
        if (rows.length === 0) break;
        all.unshift(...rows);
        const earliestOpen = rows[0]!.time * 1000;
        endTimeMs = earliestOpen - 1;
        if (rows.length < BINANCE_MAX_LIMIT) break; // exhausted history
        await new Promise((r) => setTimeout(r, 120)); // be polite
      }
    } else {
      // Multi-batch: Binance crypto trades 24/7, so kline windows are
      // predictable — fetch ALL batches in parallel (~batchCount× faster
      // than walking), each window slightly overlapping the previous one,
      // then dedupe. Rare holes (exchange downtime) get a sequential
      // top-up pass.
      const overlapMs = 5 * intervalMs;
      const windows: number[] = [];
      for (let i = 0; i < batchCount; i++) {
        windows.push(startEndMs - i * (BINANCE_MAX_LIMIT * intervalMs) + (i > 0 ? overlapMs : 0));
      }
      const batches = await Promise.all(
        windows.map((end, i) => (async () => {
          if (i > 0) await new Promise((r) => setTimeout(r, i * 60)); // tiny stagger
          return this.fetchBatch(instrument, interval, BINANCE_MAX_LIMIT, end);
        })())
      );
      const dedupP = new Map<number, Candle>();
      for (const rows of batches) for (const c of rows) dedupP.set(c.time, c);
      let merged = [...dedupP.values()].sort((a, b) => a.time - b.time);

      // Top-up: fill holes between consecutive klines (max 2 passes)
      for (let round = 0; round < 2; round++) {
        const holes: Array<{ end: number; missing: number }> = [];
        for (let i = 1; i < merged.length; i++) {
          const gapSec = merged[i]!.time - merged[i - 1]!.time;
          const missing = Math.floor(gapSec / (intervalMs / 1000)) - 1;
          if (missing > 0 && missing <= 500) holes.push({ end: merged[i]!.time - 1, missing });
        }
        if (holes.length === 0) break;
        const before = merged.length;
        const fills = await Promise.all(
          holes.map((h) => this.fetchBatch(instrument, interval, Math.min(BINANCE_MAX_LIMIT, h.missing + 5), h.end * 1000))
        );
        const dedup2 = new Map<number, Candle>();
        for (const c of merged) dedup2.set(c.time, c);
        for (const rows of fills) for (const c of rows) dedup2.set(c.time, c);
        merged = [...dedup2.values()].sort((a, b) => a.time - b.time);
        if (merged.length === before) break;
      }
      all = merged;
    }

    // Dedupe + sort ascending
    const dedup = new Map<number, Candle>();
    for (const c of all) dedup.set(c.time, c);
    let out = [...dedup.values()].sort((a, b) => a.time - b.time);

    if (factor > 1) out = aggregateCandles(out, TIMEFRAME_SECONDS[timeframe]);

    return out.slice(-count);
  }

  private async fetchBatch(
    symbol: string,
    interval: string,
    limit: number,
    endTimeMs?: number
  ): Promise<Candle[]> {
    let url =
      `${this.config.apiUrl}/api/v3/klines` +
      `?symbol=${encodeURIComponent(symbol.toUpperCase())}` +
      `&interval=${interval}&limit=${limit}`;
    if (endTimeMs !== undefined) url += `&endTime=${endTimeMs}`;

    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const res = await fetch(url, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        if (!res.ok) {
          if (res.status === 429 || res.status === 418 || res.status >= 500) {
            lastErr = new BinanceRestError("RATE_LIMITED", "Binance rate limited / unavailable", res.status);
            await res.body?.cancel().catch(() => {});
          } else if (res.status === 400) {
            throw new BinanceRestError("INVALID_INSTRUMENT", "Symbol rejected by Binance", 400);
          } else {
            throw new BinanceRestError("UPSTREAM_ERROR", `Binance error (HTTP ${res.status})`, res.status);
          }
        } else {
          let body: unknown;
          try {
            body = await res.json();
          } catch {
            throw new BinanceRestError("UPSTREAM_ERROR", "Malformed Binance response");
          }
          if (!Array.isArray(body)) {
            throw new BinanceRestError("UPSTREAM_ERROR", "Malformed Binance response");
          }
          return (body as RawKline[])
            .map((k) => this.parseKline(k))
            .filter((c): c is Candle => c !== null);
        }
      } catch (err) {
        lastErr = err;
        const retryable =
          err instanceof BinanceRestError &&
          (err.code === "NETWORK_ERROR" || err.code === "UPSTREAM_ERROR" || err.code === "RATE_LIMITED");
        if (!retryable || attempt === MAX_ATTEMPTS) break;
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
      }
    }
    if (lastErr instanceof BinanceRestError) throw lastErr;
    throw new BinanceRestError("NETWORK_ERROR", "Binance request failed");
  }

  /** [openTime, o,h,l,c, …] strings → Candle (seconds). Malformed → null. */
  private parseKline(k: RawKline): Candle | null {
    try {
      const time = Number(k[0]);
      if (!Number.isFinite(time)) return null;
      const open = parseFloat(String(k[1]));
      const high = parseFloat(String(k[2]));
      const low = parseFloat(String(k[3]));
      const close = parseFloat(String(k[4]));
      if (![open, high, low, close].every(Number.isFinite)) return null;
      return { time: Math.floor(time / 1000), open, high, low, close };
    } catch {
      return null;
    }
  }
}
