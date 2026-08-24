/**
 * OANDA REST client (historical candles) — server-side only.
 *
 * Error mapping keeps OANDA internals out of the rest of the app and makes
 * sure no Authorization details can ever leak into logs or responses.
 * Handles pagination for deep history (OANDA max 5000 per request).
 */
import { NATIVE_HISTORY_GRANULARITY, type Timeframe } from "@traderkomak/shared";
import { toCandles, type RawOandaCandlesResponse } from "./adapter.js";
import type { Candle } from "@traderkomak/shared";

export type RestErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "RATE_LIMITED"
  | "INVALID_INSTRUMENT"
  | "INVALID_TIMEFRAME"
  | "UPSTREAM_ERROR"
  | "NETWORK_ERROR";

export class OandaRestError extends Error {
  constructor(
    public readonly code: RestErrorCode,
    message: string,
    public readonly status?: number,
    public readonly retryAfterSeconds?: number
  ) {
    super(message);
    this.name = "OandaRestError";
  }
}

export interface OandaRestConfig {
  apiUrl: string;
  accountId: string;
  /** Bearer token. Used only inside this module's Authorization header. */
  apiToken: string;
}

const REQUEST_TIMEOUT_MS = 25_000;
const OANDA_MAX_COUNT = 5000;
/** Transient failures retried automatically (cold TLS handshake can exceed first attempt). */
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 600;

export class OandaRestClient {
  constructor(private readonly config: OandaRestConfig) {}

  /**
   * Fetches native-granularity mid-price candles for a timeframe.
   * Returns candles already converted to TraderKomak's internal format.
   * Handles pagination automatically when count > 5000 (OANDA limit).
   * Timeframe→bucket-size derivation (10s/30s from S5) is performed by
   * the caller using the shared aggregation engine.
   */
  async getNativeCandles(
    instrument: string,
    timeframe: Timeframe,
    count: number,
    toIso?: string
  ): Promise<Candle[]> {
    const granularity = NATIVE_HISTORY_GRANULARITY[timeframe];
    if (!granularity) {
      throw new OandaRestError(
        "INVALID_TIMEFRAME",
        `Timeframe ${timeframe} has no upstream-native history source`
      );
    }

    if (count <= OANDA_MAX_COUNT) {
      return this.fetchBatch(instrument, granularity, count, toIso);
    }

    // Pagination for deep history: fetch backwards from `toIso` or now
    const all: Candle[] = [];
    let remaining = count;
    let to: string | undefined = toIso;
    for (let batch = 0; batch < 10 && remaining > 0; batch++) {
      const batchCount = Math.min(remaining, OANDA_MAX_COUNT);
      const candles = await this.fetchBatch(instrument, granularity, batchCount, to);
      if (candles.length === 0) break;
      all.unshift(...candles);
      remaining -= candles.length;
      if (candles.length < batchCount) break;
      const earliest = candles[0]!;
      to = new Date(earliest.time * 1000).toISOString();
      if (remaining > 0) await new Promise((r) => setTimeout(r, 120));
    }
    // Deduplicate and sort (toCandles already dedupes per batch, but across batches we need to)
    const dedup = new Map<number, Candle>();
    for (const c of all) dedup.set(c.time, c);
    return [...dedup.values()].sort((a, b) => a.time - b.time).slice(-count);
  }

  private async fetchBatch(
    instrument: string,
    granularity: string,
    count: number,
    to?: string
  ): Promise<Candle[]> {
    let url =
      `${this.config.apiUrl}/v3/instruments/${encodeURIComponent(instrument)}/candles` +
      `?granularity=${granularity}&price=M&count=${count}`;
    if (to) url += `&to=${encodeURIComponent(to)}`;

    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const res = await fetch(url, {
          headers: {
            Authorization: `Bearer ${this.config.apiToken}`,
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        if (!res.ok) {
          // Retry only transient upstream errors; auth/4xx fail immediately.
          if (res.status === 429 || res.status >= 500) {
            lastErr = await this.throwMappedError(res);
          } else {
            await this.throwMappedError(res);
          }
        }

        let body: RawOandaCandlesResponse;
        try {
          body = (await res.json()) as RawOandaCandlesResponse;
        } catch {
          throw new OandaRestError("UPSTREAM_ERROR", "Malformed upstream response");
        }
        return toCandles(body);
      } catch (err) {
        lastErr = err;
        const retryable =
          err instanceof OandaRestError &&
          (err.code === "NETWORK_ERROR" ||
            err.code === "UPSTREAM_ERROR" ||
            err.code === "RATE_LIMITED");
        if (!retryable || attempt === MAX_ATTEMPTS) break;
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
      }
    }
    if (lastErr instanceof OandaRestError) throw lastErr;
    throw new OandaRestError("NETWORK_ERROR", "Upstream request failed");
  }

  private throwMappedError(res: Response): Promise<never> {
    let retryAfter: number | undefined;
    const ra = res.headers.get("retry-after");
    if (ra !== null && Number.isFinite(Number(ra))) retryAfter = Number(ra);

    switch (res.status) {
      case 401:
      case 403:
        throw new OandaRestError("UNAUTHORIZED", "Upstream rejected credentials", res.status);
      case 429:
        throw new OandaRestError(
          "RATE_LIMITED",
          "Upstream rate limit reached",
          429,
          retryAfter ?? undefined
        );
      case 400:
        throw new OandaRestError("INVALID_INSTRUMENT", "Instrument rejected by upstream", 400);
      default:
        throw new OandaRestError(
          "UPSTREAM_ERROR",
          `Upstream error (HTTP ${res.status})`,
          res.status
        );
    }
  }
}
