/**
 * GET /api/candles — historical candles for the chart's initial load.
 *
 * History resolution per timeframe:
 *   5s   → native OANDA S5
 *   10s  → derived from S5 via the shared aggregation engine (×2 buckets)
 *   30s  → derived from S5 (×6 buckets)
 *   1m   → native OANDA M1
 *   1s   → in-memory live buffer only (no upstream-native source exists;
 *          see README "Known limitations").
 *
 * All responses use TraderKomak's normalized Candle format. Error bodies
 * are safe, stable JSON — no upstream payloads, no secrets.
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import {
  NATIVE_HISTORY_GRANULARITY,
  TIMEFRAME_SECONDS,
  isInstrument,
  isTimeframe,
  normalizeInstrument,
  nativeCandlesNeeded,
  type Timeframe,
} from "@traderkomak/shared";
import { aggregateCandles, chainContinuity, fillGaps } from "../market/aggregator.js";
import type { CandleFeed, HistorySource } from "../market/candleFeed.js";
import type { OandaRestError, RestErrorCode } from "../oanda/restClient.js";

const DEFAULT_COUNT = 1000;
const MAX_COUNT = 20000;

interface CandlesRouteDeps {
  rest: HistorySource | null;
  feed: CandleFeed;
}

export function registerCandlesRoute(
  app: FastifyInstance,
  deps: CandlesRouteDeps
): void {
  const { rest, feed } = deps;

  app.get("/api/candles", async (request, reply) => {
    const query = request.query as Record<string, unknown>;

    if (!isInstrument(query.instrument)) {
      return reply.code(400).send({
        error: { code: "INVALID_INSTRUMENT", message: "Unknown or unsupported instrument" },
      });
    }
    const instrument = normalizeInstrument(String(query.instrument));

    if (!isTimeframe(query.timeframe)) {
      return reply.code(400).send({
        error: { code: "INVALID_TIMEFRAME", message: "Unknown or unsupported timeframe" },
      });
    }
    const timeframe: Timeframe = query.timeframe;

    // Rate limit per IP — but degrade to STALE cached history instead of a
    // hard 429 when we have it: phones behind carrier CGNAT share one IP,
    // and a blank chart is never an acceptable answer.
    const ip = request.ip ?? "unknown";
    if (rateLimited(ip)) {
      const stale = lastGood.get(`${instrument}|${timeframe}|${bucketCount(DEFAULT_COUNT)}`)
        ?? [...lastGood.entries()].find(([k]) => k.startsWith(`${instrument}|${timeframe}|`))?.[1];
      if (stale) return reply.send({ instrument, timeframe, candles: stale.candles, stale: true });
      return reply.code(429).send({
        error: { code: "RATE_LIMITED", message: "Too many requests — slow down" },
      });
    }

    let count = DEFAULT_COUNT;
    if (query.count !== undefined) {
      const parsed = Number.parseInt(String(query.count), 10);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return reply.code(400).send({
          error: { code: "INVALID_COUNT", message: "count must be a positive integer" },
        });
      }
      count = Math.min(parsed, MAX_COUNT);
    }

    let to: number | undefined;
    if (query.to !== undefined) {
      const rawTo = String(query.to);
      // Accept unix seconds or ISO string
      const asNum = Number(rawTo);
      if (Number.isFinite(asNum) && asNum > 1000000000) {
        to = Math.floor(asNum);
      } else {
        const iso = Date.parse(rawTo);
        if (Number.isFinite(iso)) to = Math.floor(iso / 1000);
        else {
          return reply.code(400).send({
            error: { code: "INVALID_TO", message: "to must be unix seconds or ISO timestamp" },
          });
        }
      }
    }

    try {
      const key = historyCacheKey(instrument, timeframe, count, to);
      const hit = historyCacheGet(key);
      if (hit) return reply.send({ instrument, timeframe, candles: hit });
      const candles = await resolveHistory(rest, feed, instrument, timeframe, count, to);
      historyCachePut(key, candles);
      lastGood.set(`${instrument}|${timeframe}|${bucketCount(count)}`, { at: Date.now(), candles });
      return reply.send({ instrument, timeframe, candles });
    } catch (err) {
      // Upstream failure (OANDA 429/5xx, network): serve the last good
      // history for this symbol/timeframe marked stale — the live WS keeps
      // the chart head fresh, so stale history beats a blank chart.
      const stale = [...lastGood.entries()].find(([k]) => k.startsWith(`${instrument}|${timeframe}|`))?.[1];
      if (stale) return reply.send({ instrument, timeframe, candles: stale.candles, stale: true });
      return sendHistoryError(reply, err);
    }
  });
}

/* ── Short-TTL history cache ────────────────────────────────────────────
 * Switching timeframes/symbols re-requests the same windows over and over;
 * without a cache every switch pays the full upstream (OANDA) round trip.
 * The live stream keeps the chart head fresh, so a short TTL is safe. */
const HISTORY_TTL_MS = 90_000;
const HISTORY_CACHE_MAX = 300;
const historyCache = new Map<string, { at: number; candles: unknown[] }>();

/** Preset count buckets: arbitrary client-supplied counts used to fragment
 *  the cache key space (near-guaranteed misses → upstream hammering). */
const COUNT_BUCKETS = [50, 100, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000, 8000, 12000, 20000];
function bucketCount(count: number): number {
  for (const b of COUNT_BUCKETS) if (count <= b) return b;
  return COUNT_BUCKETS[COUNT_BUCKETS.length - 1]!;
}

/** Last GOOD result per cache key — served (marked stale) when the rate
 *  limit trips or upstream fails, so a client NEVER gets a blank chart
 *  where cached history exists. Phones behind carrier CGNAT share IPs,
 *  so per-IP limits must degrade gracefully, never hard-fail. */
const lastGood = new Map<string, { at: number; candles: unknown[] }>();

/** Simple fixed-window per-IP rate limiter (no external deps). */
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 240;
const rateMap = new Map<string, { n: number; resetAt: number }>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const e = rateMap.get(ip);
  if (!e || now > e.resetAt) {
    if (rateMap.size > 5000) {
      for (const [k, v] of rateMap) if (now > v.resetAt) rateMap.delete(k);
    }
    rateMap.set(ip, { n: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  e.n += 1;
  return e.n > RATE_MAX;
}

function historyCacheKey(instrument: string, timeframe: string, count: number, to?: number): string {
  // bucket `to` to 5 minutes so near-identical lazy loads share an entry
  const toBucket = to !== undefined ? Math.floor(to / 300) : "now";
  return `${instrument}|${timeframe}|${bucketCount(count)}|${toBucket}`;
}
function historyCacheGet(key: string): unknown[] | null {
  const e = historyCache.get(key);
  if (!e) return null;
  if (Date.now() - e.at > HISTORY_TTL_MS) {
    historyCache.delete(key);
    return null;
  }
  return e.candles;
}
function historyCachePut(key: string, candles: unknown[]): void {
  if (historyCache.size >= HISTORY_CACHE_MAX) {
    const oldest = historyCache.keys().next().value;
    if (oldest !== undefined) historyCache.delete(oldest);
  }
  historyCache.set(key, { at: Date.now(), candles });
}

async function resolveHistory(
  rest: HistorySource | null,
  feed: CandleFeed,
  instrument: string,
  timeframe: Timeframe,
  count: number,
  to?: number
) {
  void feed;
  if (!rest) throw new Error("REST client unavailable");

  const toIso = to !== undefined ? new Date(to * 1000).toISOString() : undefined;
  let candles = await rest.getNativeCandles(
    instrument,
    timeframe,
    nativeCandlesNeeded(timeframe, count),
    toIso
  );

  // 10s/30s derive their larger buckets from native S5 data using the
  // exact same bucket rules as the live engine.
  const seconds = TIMEFRAME_SECONDS[timeframe];
  if (
    NATIVE_HISTORY_GRANULARITY[timeframe] === "S5" &&
    seconds > TIMEFRAME_SECONDS["5s"]
  ) {
    candles = aggregateCandles(candles, seconds);
  }

  // OANDA's REST omits buckets with zero ticks; their platform chart
  // carries the price forward instead. Do the same for small gaps so
  // history matches the chart users compare against.
  candles = fillGaps(candles, seconds);

  // Display-continuity: open[n] := close[n-1] so consecutive candles touch
  // (high/low/close remain the real market values).
  candles = chainContinuity(candles);

  return candles.slice(-count);
}

function sendHistoryError(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof Error && "code" in err) {
    const restErr = err as OandaRestError;
    const mapped = mapRestError(restErr.code);
    if (mapped.retryAfter !== undefined) {
      reply.header("Retry-After", String(mapped.retryAfter));
    }
    return reply.code(mapped.status).send({
      error: { code: mapped.code, message: mapped.message },
    });
  }
  // Unknown failure — log server-side (request id attached by fastify),
  // expose nothing internal.
  return reply.code(500).send({
    error: { code: "INTERNAL", message: "Failed to load historical candles" },
  });
}

interface MappedError {
  status: number;
  code: string;
  message: string;
  retryAfter?: number;
}

function mapRestError(code: RestErrorCode): MappedError {
  switch (code) {
    case "UNAUTHORIZED":
    case "FORBIDDEN":
      return {
        status: 502,
        code: "UPSTREAM_AUTH",
        message: "Market data source rejected credentials. Check server-side OANDA configuration.",
      };
    case "RATE_LIMITED":
      return {
        status: 429,
        code: "RATE_LIMITED",
        message: "Market data rate limit reached. Retry shortly.",
      };
    case "INVALID_INSTRUMENT":
      return {
        status: 400,
        code: "UPSTREAM_REJECTED_INSTRUMENT",
        message: "Data source rejected this instrument.",
      };
    case "INVALID_TIMEFRAME":
      return {
        status: 400,
        code: "INVALID_TIMEFRAME",
        message: "Timeframe has no historical source.",
      };
    case "NETWORK_ERROR":
    case "UPSTREAM_ERROR":
      return {
        status: 502,
        code: "UPSTREAM_UNAVAILABLE",
        message: "Historical market data is temporarily unavailable.",
      };
  }
}
