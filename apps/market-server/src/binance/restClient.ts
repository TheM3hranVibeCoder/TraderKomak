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
const MAX_BATCHES = 10;
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
    3600: "1h", 86400: "1d",
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
    const needed = Math.min(count * factor, MAX_BATCHES * BINANCE_MAX_LIMIT);

    const all: Candle[] = [];
    let endTimeMs: number | undefined =
      toIso !== undefined ? Date.parse(toIso) : undefined;

    for (let batch = 0; batch < MAX_BATCHES && all.length < needed; batch++) {
      const rows = await this.fetchBatch(instrument, interval, Math.min(needed - all.length, BINANCE_MAX_LIMIT), endTimeMs);
      if (rows.length === 0) break;

      all.unshift(...rows);
      const earliestOpen = rows[0]!.time * 1000;
      endTimeMs = earliestOpen - 1; // strictly before this kline's open
      if (rows.length < BINANCE_MAX_LIMIT) break; // exhausted history
      await new Promise((r) => setTimeout(r, 120)); // be polite
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
