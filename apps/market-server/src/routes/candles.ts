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
const MAX_COUNT = 5000;

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
      const candles = await resolveHistory(rest, feed, instrument, timeframe, count, to);
      return reply.send({ instrument, timeframe, candles });
    } catch (err) {
      return sendHistoryError(reply, err);
    }
  });
}

async function resolveHistory(
  rest: HistorySource | null,
  feed: CandleFeed,
  instrument: string,
  timeframe: Timeframe,
  count: number,
  to?: number
) {
  if (timeframe === "1s") {
    // No upstream-native source exists; answer from the live buffer.
    // If `to` is provided (lazy load), filter buffer to time < to
    const snap = feed.bufferSnapshot(instrument, "1s", to ? 5000 : count);
    if (to !== undefined) {
      const filtered = snap.filter((c) => c.time < to);
      return filtered.slice(-count);
    }
    return snap.slice(-count);
  }
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
