/**
 * cTrader history source (server-side only).
 *
 * - Timeframes 1m … 1M map 1:1 to native cTrader trendbars
 *   (M1/M5/M15/M30/H1/H4/D1/W1/MN1 — see NATIVE_HISTORY_GRANULARITY).
 * - Sub-minute timeframes (5s/10s/15s/30s) have NO cTrader-native bars:
 *   getNativeCandles returns 5-second candles built from BID tick data
 *   (ProtoOAGetTickDataReq), which callers aggregate with the shared
 *   engine exactly like OANDA's S5-derived timeframes. When the broker
 *   keeps no (more) tick data the result is simply shorter — the live
 *   buffer continues from there.
 *
 * Error codes match the OANDA RestErrorCode union so the /api/candles
 * route maps them without any provider awareness.
 */
import { providerOf, type Candle, type Timeframe } from "@traderkomak/shared";
import { PT, PERIOD, QUOTE_TYPE, M, toNum } from "./proto.js";
import { accountIdNumber, CtraderClient } from "./client.js";
import { CtraderSymbols } from "./symbols.js";
import { trendbarToCandle, expandTickTimestamps, ticksToS5Candles } from "./adapter.js";
import type { RawTrendbar } from "./adapter.js";
import type { Long } from "protobufjs";
import type { Log } from "../logger.js";

export type CtraderRestErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "RATE_LIMITED"
  | "INVALID_INSTRUMENT"
  | "INVALID_TIMEFRAME"
  | "UPSTREAM_ERROR"
  | "NETWORK_ERROR";

export class CtraderRestError extends Error {
  constructor(
    public readonly code: CtraderRestErrorCode,
    message: string
  ) {
    super(message);
    this.name = "CtraderRestError";
  }
}

/** Timeframe → native trendbar period (must mirror NATIVE_HISTORY_GRANULARITY). */
const TF_TO_PERIOD: Partial<Record<Timeframe, number>> = {
  "1m": PERIOD.M1,
  "5m": PERIOD.M5,
  "15m": PERIOD.M15,
  "30m": PERIOD.M30,
  "1h": PERIOD.H1,
  "2h": PERIOD.H1, // no native H2 — callers aggregate these H1 rows into 2h
  "4h": PERIOD.H4,
  "1d": PERIOD.D1,
  "1w": PERIOD.W1,
  "1M": PERIOD.MN1,
};

const SUB_MINUTE: ReadonlySet<string> = new Set(["5s", "10s", "15s", "30s"]);

const MAX_BATCHES = 10;
const TRENDBARS_PER_REQ = 2000;
const MAX_TICK_CHUNKS = 20;
/** Tick history is charged per range — never request more than 7 days. */
const MAX_TICK_RANGE_MS = 604_800_000;

interface DecodedTrendbarRes {
  trendbar?: Array<{
    volume?: Long | number;
    period?: number;
    low?: Long | number;
    deltaOpen?: Long | number;
    deltaClose?: Long | number;
    deltaHigh?: Long | number;
    utcTimestampInMinutes?: number;
  }>;
  hasMore?: boolean;
}

interface DecodedTickRes {
  tickData?: Array<{ timestamp?: Long | number; tick?: Long | number }>;
  hasMore?: boolean;
}

export class CtraderRestClient {
  readonly symbols: CtraderSymbols;

  constructor(
    private readonly client: CtraderClient,
    log: Log,
    symbolNameOverride?: string
  ) {
    this.symbols = new CtraderSymbols(client, log, symbolNameOverride);
  }

  async getNativeCandles(
    instrument: string,
    timeframe: Timeframe,
    count: number,
    toIso?: string
  ): Promise<Candle[]> {
    if (providerOf(instrument) !== "ctrader") {
      throw new CtraderRestError("INVALID_INSTRUMENT", `Not a cTrader instrument: ${instrument}`);
    }

    try {
      if (TF_TO_PERIOD[timeframe] !== undefined) {
        return await this.fetchTrendbars(instrument, timeframe, count, toIso);
      }
      if (SUB_MINUTE.has(timeframe)) {
        return await this.fetchS5FromTicks(instrument, count, toIso);
      }
      throw new CtraderRestError("INVALID_TIMEFRAME", `Timeframe ${timeframe} has no cTrader history source`);
    } catch (err) {
      if (err instanceof CtraderRestError) throw err;
      throw mapUpstreamError(err);
    }
  }

  /** Native trendbar history, paginated backwards with a `to` cursor. */
  private async fetchTrendbars(
    instrument: string,
    timeframe: Timeframe,
    count: number,
    toIso?: string
  ): Promise<Candle[]> {
    const info = await this.symbols.get(instrument);
    const period = TF_TO_PERIOD[timeframe]!;
    const acctId = accountIdNumber(this.client.sessionInfo().accountId);

    let remaining = count;
    let toMs = toIso ? toIsoMs(toIso) : Date.now();
    const collected: Candle[] = [];
    let lastEarliest = Number.POSITIVE_INFINITY;

    for (let batch = 0; batch < MAX_BATCHES && remaining > 0; batch++) {
      const req = M.ProtoOAGetTrendbarsReq.encode(
        M.ProtoOAGetTrendbarsReq.fromObject({
          payloadType: PT.GET_TRENDBARS_REQ,
          ctidTraderAccountId: acctId,
          period,
          symbolId: info.symbolId,
          toTimestamp: Math.max(0, Math.floor(toMs)),
          count: Math.min(remaining, TRENDBARS_PER_REQ),
        })
      ).finish();
      const res = await this.client.requestHistorical(PT.GET_TRENDBARS_REQ, req as Uint8Array);
      const dec = M.ProtoOAGetTrendbarsRes.toObject(M.ProtoOAGetTrendbarsRes.decode(res.body), {
        defaults: false,
      }) as DecodedTrendbarRes;

      const candles = (dec.trendbar ?? [])
        .map((tb) =>
          trendbarToCandle(tb as unknown as RawTrendbar, info.digits)
        )
        .filter((c): c is Candle => c !== null)
        .sort((a, b) => a.time - b.time);
      if (candles.length === 0) break;

      collected.unshift(...candles);
      remaining -= candles.length;

      const earliest = candles[0]!.time;
      if (earliest >= lastEarliest) break; // no progress — stop pagination
      lastEarliest = earliest;
      toMs = earliest * 1000 - 1;
      if (!dec.hasMore && candles.length < TRENDBARS_PER_REQ) break;
    }

    const dedup = new Map<number, Candle>();
    for (const c of collected) dedup.set(c.time, c);
    return [...dedup.values()].sort((a, b) => a.time - b.time).slice(-count);
  }

  /**
   * 5-second candles from BID tick data. `count` is the number of S5
   * candles requested (callers already applied nativeCandlesNeeded).
   */
  private async fetchS5FromTicks(
    instrument: string,
    count: number,
    toIso?: string
  ): Promise<Candle[]> {
    const info = await this.symbols.get(instrument);
    const acctId = accountIdNumber(this.client.sessionInfo().accountId);

    const endMs = toIso ? toIsoMs(toIso) : Date.now();
    // One 5s bucket per candle + a cushion for bucket edges, clamped to the
    // documented 7-day maximum range per tick-data request.
    const fromMs = Math.max(0, endMs - Math.min(count * 5000 + 60_000, MAX_TICK_RANGE_MS));

    const ticks: Array<{ timeMs: number; price: number }> = [];
    let cursorTo = endMs;
    let lastOldest = Number.POSITIVE_INFINITY;

    for (let chunk = 0; chunk < MAX_TICK_CHUNKS; chunk++) {
      const req = M.ProtoOAGetTickDataReq.encode(
        M.ProtoOAGetTickDataReq.fromObject({
          payloadType: PT.GET_TICKDATA_REQ,
          ctidTraderAccountId: acctId,
          symbolId: info.symbolId,
          type: QUOTE_TYPE.BID,
          fromTimestamp: fromMs,
          toTimestamp: Math.floor(cursorTo),
        })
      ).finish();
      const res = await this.client.requestHistorical(PT.GET_TICKDATA_REQ, req as Uint8Array);
      const dec = M.ProtoOAGetTickDataRes.toObject(M.ProtoOAGetTickDataRes.decode(res.body), {
        defaults: false,
      }) as DecodedTickRes;

      const rows = (dec.tickData ?? []).map((r) => ({
        timestamp: toNum(r.timestamp),
        tick: toNum(r.tick),
      }));
      const expanded = expandTickTimestamps(rows);
      if (expanded.length === 0) break;
      ticks.push(...expanded);

      // Pagination walks backwards: the oldest tick of this chunk caps the
      // next request's range (docs: max 1 week per request, hasMore chunking).
      const oldest = Math.min(...expanded.map((t) => t.timeMs));
      if (oldest <= fromMs || !dec.hasMore) break;
      if (oldest >= lastOldest) break; // no progress
      lastOldest = oldest;
      cursorTo = oldest - 1;
    }

    // Ticks arrive newest-first; aggregation must see ascending order so a
    // bucket's close is its LATEST tick.
    ticks.sort((a, b) => a.timeMs - b.timeMs);
    return ticksToS5Candles(ticks, info.digits).slice(-count);
  }
}

function toIsoMs(toIso: string): number {
  const ms = Date.parse(toIso);
  return Number.isFinite(ms) ? ms : Date.now();
}

function mapUpstreamError(err: unknown): CtraderRestError {
  const code = (err as { code?: string } | null)?.code;
  const message = err instanceof Error ? err.message : "cTrader history failed";
  switch (code) {
    case "CH_ACCESS_TOKEN_INVALID":
    case "CTRADER_ACCOUNT_UNAUTHORIZED":
    case "TRADING_ACCESS_TOKEN_EXPIRED":
      return new CtraderRestError("UNAUTHORIZED", message);
    case "BLOCKED_PAYLOAD_TYPE":
    case "TOO_MANY_REQUESTS":
      return new CtraderRestError("RATE_LIMITED", message);
    case "CTRADER_ACCOUNT_NOT_FOUND":
    case "SYMBOL_NOT_FOUND":
      return new CtraderRestError("INVALID_INSTRUMENT", message);
    case "MarketClosed":
      return new CtraderRestError("UPSTREAM_ERROR", message);
    default:
      if (/not connected|timed out|ECONN|EPIPE|socket/i.test(message)) {
        return new CtraderRestError("NETWORK_ERROR", message);
      }
      return new CtraderRestError("UPSTREAM_ERROR", message);
  }
}
