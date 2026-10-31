/**
 * Direct-from-browser Binance market data — REST history + live kline WS.
 *
 * Binance symbols skip the market server entirely: the browser fetches
 * public kline history and streams kline updates itself, then runs the
 * SAME shared aggregation engine the server uses (packages/shared), so
 * client-built candles are identical to server-built ones.
 *
 * Sources — the first one that works is remembered and tried first next
 * time; a failure falls through the chain again:
 *
 *   direct  REST https://data-api.binance.vision/api/v3/klines
 *           WS   wss://data-stream.binance.vision/ws/<sym>@kline_<interval>
 *           Native Binance — primary everywhere Binance is reachable.
 *   proxy   The same Binance API via a VITE_BINANCE_PROXY_URL relay, when
 *           deployed. Usually absent: Binance blocks datacenter IPs too.
 *   htx     REST https://api.huobi.pro/market/history/kline — reachable from
 *           restricted regions (Iran etc.) and mirrors any Origin, so the
 *           browser can read it. Latest-window only (no cursor), max 2000
 *           rows. Intraday periods are UTC-aligned; day-and-coarser buckets
 *           are UTC+8-aligned, so it is tried AFTER Gate for 1d/1w/1M.
 *   gate    REST https://api.gateio.ws/api/v4/spot/candlesticks (UTC-aligned,
 *           full `to`-cursor pagination) and the live WS fallback
 *           wss://api.gateio.ws/ws/v4/ — Binance geo-blocks restricted
 *           regions with HTTP 451 on BOTH its REST and WS hosts (as of
 *           2026-10), so the live stream needs a second venue too.
 *
 * Everything stays browser-direct: the visitor's own internet talks to
 * Binance/HTX/Gate, never the market server (Render's metered bandwidth
 * must not absorb Binance traffic — enforced in services/api.ts).
 *
 * Region limitations of the fallbacks (only hit when direct+proxy fail):
 *   - 5s/15s history: no reachable public source is finer than Gate's 10s
 *     → these charts start empty and fill live from the trades stream.
 *   - HTX 1w/1M (last resort): HTX's calendar buckets are UTC+8-aligned,
 *     so week/month boundaries sit a few hours off Binance's Monday-UTC /
 *     calendar-month convention.
 *
 * Interval plan (mirrors apps/market-server/src/binance/restClient.ts):
 *   1m/5m/15m/30m/1h/4h/1d/1w/1M → native on direct/proxy/htx; 1w/1M are
 *     derived from Gate's 1d rows with the shared bucket rules
 *     (binanceBucketStart) because Gate has no calendar week/month.
 *   5s/10s/15s/30s               → built from native 1s klines on
 *     direct/proxy, and live from Gate's trades stream — all through the
 *     shared aggregation engine.
 */
import {
  TIMEFRAME_SECONDS,
  binanceBucketStart,
  CandleAggregator,
  aggregateCandles,
  type Candle,
  type Timeframe,
} from "@traderkomak/shared";
import type { WsHandlers } from "./wsClient";

const REST_BASE_DIRECT = "https://data-api.binance.vision";
const WS_BASE_DIRECT = "wss://data-stream.binance.vision";
const REST_BASE_HTX = "https://api.huobi.pro";
const REST_BASE_GATE = "https://api.gateio.ws";
const WS_BASE_GATE = "wss://api.gateio.ws/ws/v4/";

const KLINE_LIMIT = 1000; // Binance/Gate max rows per request
const HTX_MAX_SIZE = 2000; // Huobi history/kline size cap
const MAX_BATCHES = 50;
const REQUEST_TIMEOUT_MS = 15_000;
const BACKOFF_BASE_MS = 350;
const BACKOFF_CAP_MS = 30_000;
const GATE_PING_INTERVAL_MS = 25_000;

/** Sticky REST source — once a source proves it works for this visitor it is
 *  tried first (except for day-and-coarser charts, where the canonical order
 *  protects bucket alignment); a failure falls through the chain again. */
type RestSource = "direct" | "proxy" | "htx" | "gate";
let restMode: RestSource | "auto" = "auto";
/** Same idea for the WebSocket stream. */
let wsMode: "auto" | "direct" | "proxy" | "gate" = "auto";

function proxyBase(): string | null {
  const raw = (import.meta.env.VITE_BINANCE_PROXY_URL as string | undefined)?.trim();
  return raw ? raw.replace(/\/+$/, "") : null;
}

/** "https://host" → "wss://host" (the relay serves WS on the same origin). */
function proxyWsBase(): string | null {
  const p = proxyBase();
  return p ? p.replace(/^http/i, "ws") : null;
}

/** Thrown when an upstream origin is geo-blocked → trigger source fallback. */
class BlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockedError";
  }
}

/** Native interval + how many source candles build ONE target candle. */
export function binanceIntervalPlan(tf: Timeframe): { interval: string; factor: number } {
  const sec = TIMEFRAME_SECONDS[tf];
  if (sec < 60) return { interval: "1s", factor: sec }; // only 1s is native sub-minute
  const map: Record<number, string> = {
    60: "1m", 300: "5m", 900: "15m", 1800: "30m",
    3600: "1h", 14400: "4h", 86400: "1d", 604800: "1w", 2592000: "1M",
  };
  return { interval: map[sec] ?? "1m", factor: 1 };
}

/** HTX (Huobi) period strings per native Binance interval. */
const HTX_PERIODS: Record<string, string> = {
  "1m": "1min", "5m": "5min", "15m": "15min", "30m": "30min",
  "1h": "60min", "4h": "4hour", "1d": "1day", "1w": "1week", "1M": "1mon",
};

/** Gate intervals per Binance interval; 1w/1M derive from 1d rows. */
const GATE_INTERVALS: Record<string, string> = {
  "10s": "10s", "1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m",
  "1h": "1h", "4h": "4h", "1d": "1d", "1w": "1d", "1M": "1d",
};

/** BTCUSDT → BTC_USDT (all supported Binance symbols end in USDT). */
function gatePair(symbol: string): string {
  return symbol.toUpperCase().replace(/USDT$/, "_USDT");
}

/** Gate REST/WS interval serving this timeframe — null when Gate can't
 *  (sub-minute finer than 10s: 1s/5s/15s). Keyed on the TIMEFRAME, not the
 *  Binance interval: binanceIntervalPlan maps every sub-minute to "1s". */
function gateIntervalFor(tf: Timeframe): string | null {
  const sec = TIMEFRAME_SECONDS[tf];
  if (sec < 60) return sec === 10 || sec === 30 ? "10s" : null;
  return GATE_INTERVALS[binanceIntervalPlan(tf).interval] ?? null;
}

type RawKline = [number, string, string, string, string, ...unknown[]];

/** [openTime, o,h,l,c, …] strings → Candle (seconds). Malformed → null. */
function parseKline(k: RawKline): Candle | null {
  try {
    const time = Number(k[0]);
    const open = parseFloat(String(k[1]));
    const high = parseFloat(String(k[2]));
    const low = parseFloat(String(k[3]));
    const close = parseFloat(String(k[4]));
    if (!Number.isFinite(time)) return null;
    if (![open, high, low, close].every(Number.isFinite)) return null;
    return { time: Math.floor(time / 1000), open, high, low, close };
  } catch {
    return null;
  }
}

async function fetchJsonResilient(url: string): Promise<unknown> {
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.status === 451 || res.status === 403) {
        throw new BlockedError(`Upstream blocked this visitor (HTTP ${res.status})`);
      }
      if (!res.ok) {
        const err = new Error(`Upstream error (HTTP ${res.status})`);
        const retryable = res.status === 429 || res.status === 418 || res.status >= 500;
        if (!retryable || attempt === 2) throw err;
        lastErr = err;
      } else {
        return await res.json();
      }
    } catch (err) {
      if (err instanceof BlockedError) throw err;
      lastErr = err;
      if (attempt === 2) break;
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
  if (lastErr instanceof Error) throw lastErr;
  throw new TypeError("Upstream request failed");
}

async function fetchKlinesOnce(
  base: string,
  symbol: string,
  interval: string,
  limit: number,
  endTimeMs?: number
): Promise<Candle[]> {
  let url =
    `${base}/api/v3/klines` +
    `?symbol=${encodeURIComponent(symbol.toUpperCase())}` +
    `&interval=${interval}&limit=${limit}`;
  if (endTimeMs !== undefined) url += `&endTime=${endTimeMs}`;

  const body = await fetchJsonResilient(url);
  if (!Array.isArray(body)) throw new Error("Malformed Binance response");
  const out: Candle[] = [];
  for (const row of body as unknown[]) {
    if (!Array.isArray(row)) continue;
    const c = parseKline(row as RawKline);
    if (c) out.push(c);
  }
  return out;
}

/** Sequential backwards walk with the `endTime` cursor (newest → oldest). */
async function walkKlines(
  base: string,
  symbol: string,
  interval: string,
  needed: number,
  endTimeMs?: number
): Promise<Candle[]> {
  const all: Candle[] = [];
  let end = endTimeMs;
  for (let batch = 0; batch < MAX_BATCHES && all.length < needed; batch++) {
    const rows = await fetchKlinesOnce(
      base,
      symbol,
      interval,
      Math.min(needed - all.length, KLINE_LIMIT),
      end
    );
    if (rows.length === 0) break;
    all.unshift(...rows);
    end = rows[0]!.time * 1000 - 1; // step back before the earliest open
  }
  return all;
}

interface HtxKline {
  id?: unknown;
  open?: unknown;
  high?: unknown;
  low?: unknown;
  close?: unknown;
}

function parseHtxKline(row: unknown): Candle | null {
  if (typeof row !== "object" || row === null) return null;
  const r = row as HtxKline;
  const time = Number(r.id);
  const open = Number(r.open);
  const high = Number(r.high);
  const low = Number(r.low);
  const close = Number(r.close);
  if (!Number.isFinite(time) || ![open, high, low, close].every(Number.isFinite)) return null;
  return { time, open, high, low, close };
}

/**
 * HTX latest-window klines (upstream returns newest-first → reversed).
 * Returns null when this source can't serve the interval (1s/10s) — the
 * caller then skips it. Cursor queries (`toSec`) must not be routed here:
 * HTX has no `to` parameter and would silently return the WRONG window.
 */
async function fetchHtxCandles(
  symbol: string,
  interval: string,
  needed: number
): Promise<Candle[] | null> {
  const period = HTX_PERIODS[interval];
  if (!period) return null;
  const url =
    `${REST_BASE_HTX}/market/history/kline` +
    `?symbol=${encodeURIComponent(symbol.toLowerCase())}` +
    `&period=${period}&size=${Math.min(needed, HTX_MAX_SIZE)}`;
  const body = (await fetchJsonResilient(url)) as { status?: unknown; data?: unknown } | null;
  if (!body || body.status !== "ok" || !Array.isArray(body.data)) {
    throw new Error("Malformed HTX response");
  }
  const out: Candle[] = [];
  for (const row of body.data) {
    const c = parseHtxKline(row);
    if (c) out.push(c);
  }
  out.reverse();
  return out;
}

/** Gate v4 row: [time, quoteVolume, close, high, low, open, baseVolume, …] */
function parseGateCandle(row: unknown): Candle | null {
  if (!Array.isArray(row) || row.length < 6) return null;
  const time = Number(row[0]);
  const close = parseFloat(String(row[2]));
  const high = parseFloat(String(row[3]));
  const low = parseFloat(String(row[4]));
  const open = parseFloat(String(row[5]));
  if (!Number.isFinite(time) || ![open, high, low, close].every(Number.isFinite)) return null;
  return { time, open, high, low, close };
}

/** Gate klines with backwards `to`-cursor pagination (like Binance endTime).
 *  `interval` is a Gate interval (the caller resolves it per timeframe). */
async function fetchGateCandles(
  symbol: string,
  interval: string,
  needed: number,
  toSec?: number
): Promise<Candle[] | null> {
  const pair = gatePair(symbol);
  const all: Candle[] = [];
  let to = toSec;
  for (let batch = 0; batch < MAX_BATCHES && all.length < needed; batch++) {
    let url =
      `${REST_BASE_GATE}/api/v4/spot/candlesticks` +
      `?currency_pair=${encodeURIComponent(pair)}&interval=${interval}` +
      `&limit=${Math.min(needed - all.length, KLINE_LIMIT)}`;
    if (to !== undefined) url += `&to=${Math.floor(to)}`;
    const body = await fetchJsonResilient(url);
    if (!Array.isArray(body)) throw new Error("Malformed Gate response");
    const rows: Candle[] = [];
    for (const row of body) {
      const c = parseGateCandle(row);
      if (c) rows.push(c);
    }
    if (rows.length === 0) {
      // A non-empty payload whose rows all failed to parse is an error frame.
      if (body.length > 0) throw new Error("Malformed Gate candlesticks");
      break;
    }
    all.unshift(...rows);
    to = rows[0]!.time - 1; // step back before the earliest open
  }
  return all;
}

/** Aggregates finished candles into Binance's calendar buckets (Monday
 *  weeks / calendar months) — aggregateCandles' epoch-floor would align
 *  weeks to Thursday and months to arbitrary 30-day blocks. */
function aggregateBinanceBuckets(rows: Candle[], tfSec: number): Candle[] {
  const out = new Map<number, Candle>();
  for (const c of rows) {
    const time = binanceBucketStart(c.time * 1000, tfSec) / 1000;
    const existing = out.get(time);
    if (!existing) {
      out.set(time, { ...c, time });
    } else {
      existing.high = Math.max(existing.high, c.high);
      existing.low = Math.min(existing.low, c.low);
      existing.close = c.close;
    }
  }
  return [...out.values()].sort((a, b) => a.time - b.time);
}

/** Dedup + sort, aggregate a coarser source grid into the target timeframe
 *  (1s→5s…30s, 10s→30s, 1d→1w/1M), then trim to `count`. */
function finalizeCandles(
  rows: Candle[],
  sourceSec: number,
  timeframe: Timeframe,
  count: number
): Candle[] {
  const dedup = new Map<number, Candle>();
  for (const c of rows) dedup.set(c.time, c);
  let out = [...dedup.values()].sort((a, b) => a.time - b.time);
  const tfSec = TIMEFRAME_SECONDS[timeframe];
  if (sourceSec < tfSec) {
    out =
      tfSec === 604800 || tfSec === 2592000
        ? aggregateBinanceBuckets(out, tfSec)
        : aggregateCandles(out, tfSec);
  }
  return out.slice(-count);
}

/**
 * Binance kline history for a timeframe, aggregated client-side with the
 * shared engine (sub-minute timeframes derive from native 1s klines).
 * Walks the source chain — direct Binance → Worker relay → HTX → Gate —
 * until one serves the request; the winner is remembered.
 */
export async function fetchBinanceCandles(
  instrument: string,
  timeframe: Timeframe,
  count: number,
  toSec?: number
): Promise<Candle[]> {
  const tfSec = TIMEFRAME_SECONDS[timeframe];
  const { interval, factor } = binanceIntervalPlan(timeframe);
  const cap = MAX_BATCHES * KLINE_LIMIT;
  const toMs = toSec !== undefined ? toSec * 1000 : undefined;
  const proxy = proxyBase();

  // Day-and-coarser charts always use the canonical order (Gate's UTC-aligned
  // days before HTX's UTC+8 ones); intraday charts honor the sticky winner.
  const order: RestSource[] = [];
  const add = (s: RestSource): void => {
    if (!order.includes(s)) order.push(s);
  };
  if (tfSec < 86400 && restMode !== "auto") add(restMode);
  add("direct");
  if (proxy) add("proxy");
  if (tfSec >= 86400) {
    add("gate");
    add("htx");
  } else {
    add("htx");
    add("gate");
  }

  let lastErr: unknown = null;
  for (const source of order) {
    try {
      let rows: Candle[] | null;
      let sourceSec: number;
      switch (source) {
        case "direct":
        case "proxy": {
          const base = source === "direct" ? REST_BASE_DIRECT : proxy!;
          rows = await walkKlines(base, instrument, interval, Math.min(count * factor, cap), toMs);
          sourceSec = interval === "1s" ? 1 : tfSec;
          break;
        }
        case "htx": {
          // HTX serves the latest window only — cursor queries need a source
          // with `to` support (Gate), otherwise the window would be wrong.
          if (toMs !== undefined) continue;
          rows = await fetchHtxCandles(instrument, interval, count);
          sourceSec = tfSec;
          break;
        }
        case "gate": {
          const gate = gateIntervalFor(timeframe);
          if (!gate) continue; // timeframe finer than Gate's 10s (5s/15s/1s)
          const gateNeeded =
            gate === "10s"
              ? count * (tfSec / 10) // 10s source rows → 30s target
              : tfSec === 604800
                ? count * 7 // 1d source rows → weekly target
                : tfSec === 2592000
                  ? count * 31 // 1d source rows → monthly target
                  : count;
          rows = await fetchGateCandles(instrument, gate, Math.min(gateNeeded, cap), toSec);
          sourceSec = gate === "10s" ? 10 : tfSec === 604800 || tfSec === 2592000 ? 86400 : tfSec;
          break;
        }
      }
      if (rows === null) continue; // source can't serve this request
      restMode = source; // remember the winner for the next fetch
      return finalizeCandles(rows, sourceSec, timeframe, count);
    } catch (err) {
      lastErr = err;
    }
  }

  // Every reachable source failed. Sub-minute charts have no restricted-region
  // REST source at all (nothing public is finer than Gate's 10s) — degrade to
  // a live-only chart instead of a hard error.
  if (tfSec < 60) {
    console.warn(
      `Binance history unavailable for ${instrument} ${timeframe} from this region — ` +
        `the chart will fill live from the stream`
    );
    return [];
  }
  if (lastErr instanceof Error) throw lastErr;
  throw new Error("Binance request failed");
}

/**
 * Live Binance klines, straight from Binance (or Gate as the region
 * fallback / the Worker relay when configured).
 *
 * Same surface as MarketWsClient (connect/disconnect/subscribe/unsubscribe/
 * setPaused + the WsHandlers callbacks) so the market store can swap it in
 * without any other changes:
 *   - direct/proxy: Binance kline streams; native timeframes forward the
 *     kline as the candle, sub-minute ones feed the shared CandleAggregator
 *     from the 1s kline stream
 *   - gate: spot.candlesticks for native timeframes (1w/1M subscribe to 1d
 *     and merge into the Binance calendar bucket), spot.trades for
 *     sub-minute timeframes (raw trades feed the same aggregator)
 *   - timeframe changes resubscribe (fresh socket + fresh aggregator)
 *   - `seed()` primes the sub-minute aggregator — and the 1w/1M merge
 *     bucket — with the last history candle so live candles continue the
 *     real partial OHLC
 *   - no snapshots: history always comes from fetchBinanceCandles
 */
export class BinanceDirectStream {
  private handlers: WsHandlers;
  private ws: WebSocket | null = null;
  private current: { instrument: string; timeframe: Timeframe } | null = null;
  private aggregator: CandleAggregator | null = null;
  /** Freshest history candle, kept so subscribe()'s fresh aggregator keeps
   *  the real partial OHLC of the live bucket instead of rebuilding it. */
  private seedCandle: Candle | null = null;
  /** Live 1w/1M candle being merged from Gate 1d updates (bucket-aligned). */
  private merged: Candle | null = null;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private closedByUser = false;
  private paused = false;
  /** Did the current socket ever reach OPEN? (detects blocked first dials) */
  private openedOnce = false;

  constructor(handlers: WsHandlers) {
    this.handlers = handlers;
  }

  connect(): void {
    this.closedByUser = false;
    this.attempt = 0;
    if (this.current) {
      this.handlers.onStatus("connecting");
      this.dial();
    }
  }

  disconnect(): void {
    this.closedByUser = true;
    this.clearTimers();
    this.teardownSocket();
    this.handlers.onStatus("offline");
  }

  subscribe(instrument: string, timeframe: Timeframe): void {
    this.closedByUser = false;
    this.paused = false; // a fresh subscribe always streams
    this.current = { instrument: instrument.toUpperCase(), timeframe };
    this.attempt = 0;
    // Fresh timeframe → fresh socket (different interval/venue) + fresh state.
    this.teardownSocket();
    this.aggregator =
      TIMEFRAME_SECONDS[timeframe] < 60
        ? new CandleAggregator(timeframe, binanceBucketStart)
        : null;
    this.merged = null;
    // Re-apply a seed set before subscribe() — subscribe() replaces the
    // aggregator, so without this the store's seed() would be discarded.
    if (this.seedCandle) this.applySeed(this.seedCandle);
    this.handlers.onStatus("connecting");
    this.dial();
  }

  unsubscribe(): void {
    this.current = null;
    this.aggregator = null;
    this.seedCandle = null;
    this.merged = null;
    this.clearTimers();
    this.teardownSocket();
    this.handlers.onStatus("offline");
  }

  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    if (paused) {
      this.clearTimers();
      this.teardownSocket();
    } else if (this.current && !this.closedByUser) {
      this.handlers.onStatus("connecting");
      this.dial();
    }
  }

  /** Prime the sub-minute aggregator (and the 1w/1M merge bucket) with the
   *  freshest history candle. Stored too, so a subscribe() that recreates
   *  the state keeps it. */
  seed(candle: Candle): void {
    this.seedCandle = candle;
    this.applySeed(candle);
  }

  // ── internals ────────────────────────────────────────────────────────────

  private applySeed(candle: Candle): void {
    this.aggregator?.seed(candle);
    const cur = this.current;
    if (!cur) return;
    const tfSec = TIMEFRAME_SECONDS[cur.timeframe];
    if (tfSec === 604800 || tfSec === 2592000) {
      this.merged = { ...candle, time: binanceBucketStart(candle.time * 1000, tfSec) / 1000 };
    }
  }

  private clearTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopPing();
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private teardownSocket(): void {
    if (!this.ws) return;
    const ws = this.ws;
    this.ws = null;
    try {
      ws.close(1000, "client disconnect");
    } catch {
      // ignore
    }
  }

  private dial(): void {
    const cur = this.current;
    if (!cur || this.ws) return;

    let kind: "direct" | "proxy" | "gate";
    if (wsMode === "proxy") kind = proxyWsBase() ? "proxy" : "gate";
    else if (wsMode === "gate") kind = "gate";
    else kind = "direct";

    const tfSec = TIMEFRAME_SECONDS[cur.timeframe];
    const { interval } = binanceIntervalPlan(cur.timeframe);
    const binanceStream = `${cur.instrument.toLowerCase()}@kline_${interval}`;

    let url: string;
    if (kind === "gate") url = WS_BASE_GATE;
    else if (kind === "proxy") url = `${proxyWsBase()}/ws/${binanceStream}`;
    else url = `${WS_BASE_DIRECT}/ws/${binanceStream}`;
    const usedDirect = kind === "direct";

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    this.openedOnce = false;

    // A failed handshake (451/reset) surfaces as error and/or close without
    // open — some runtimes fire error WITHOUT a following close, so both
    // events route through one guarded handler.
    let handshakeFailed = false;
    const onHandshakeFail = (): void => {
      if (handshakeFailed) return;
      handshakeFailed = true;
      if (this.ws === ws) this.ws = null;
      this.stopPing();
      if (this.closedByUser || !this.current || this.paused) return;
      this.switchFromBlockedSource();
      this.handlers.onStatus("reconnecting");
      this.scheduleReconnect();
    };

    ws.addEventListener("open", () => {
      if (this.ws !== ws) return;
      this.openedOnce = true;
      this.attempt = 0;
      wsMode = kind; // stick with whichever source worked
      if (kind === "gate") {
        this.sendGateSubscriptions(ws, cur, tfSec);
        this.startPing(ws);
      }
      this.handlers.onStatus("connected");
    });

    ws.addEventListener("message", (ev) => this.handleMessage(ev.data));

    ws.addEventListener("close", () => {
      if (this.openedOnce) {
        if (this.ws === ws) this.ws = null;
        this.stopPing();
        if (this.closedByUser || !this.current || this.paused) {
          this.handlers.onStatus("offline");
          return;
        }
        this.handlers.onStatus("reconnecting");
        this.scheduleReconnect();
      } else {
        onHandshakeFail();
      }
    });

    ws.addEventListener("error", () => {
      // close event follows in browsers; some runtimes never send it.
      if (!this.openedOnce) onHandshakeFail();
    });
  }

  /** A first dial that never opened (451/reset surface as error/close-
   *  without-open) → alternate to another source for the next attempt. */
  private switchFromBlockedSource(): void {
    if (wsMode === "auto" || wsMode === "direct") wsMode = proxyWsBase() ? "proxy" : "gate";
    else if (wsMode === "proxy") wsMode = "gate";
    else wsMode = "direct";
  }

  /** Gate v4 subscriptions for the current instrument/timeframe. NOTE the
   *  payload order is [interval, symbol] — Gate rejects [symbol, interval]. */
  private sendGateSubscriptions(
    ws: WebSocket,
    cur: { instrument: string; timeframe: Timeframe },
    tfSec: number
  ): void {
    const pair = gatePair(cur.instrument);
    const subs: string[][] =
      tfSec < 60
        ? [[pair]] // trades channel: [symbol]
        : tfSec === 604800 || tfSec === 2592000
          ? [["1d", pair]] // calendar buckets merged client-side from 1d
          : [[gateIntervalFor(cur.timeframe) ?? "1m", pair]];
    for (const payload of subs) {
      ws.send(
        JSON.stringify({
          time: Math.floor(Date.now() / 1000),
          channel: tfSec < 60 ? "spot.trades" : "spot.candlesticks",
          event: "subscribe",
          payload,
        })
      );
    }
  }

  private startPing(ws: WebSocket): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.ws !== ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ time: Math.floor(Date.now() / 1000), channel: "spot.ping" }));
    }, GATE_PING_INTERVAL_MS);
  }

  private scheduleReconnect(): void {
    if (this.closedByUser || !this.current || this.paused) return;
    if (this.reconnectTimer) return;
    this.attempt++;
    const exp = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (this.attempt - 1));
    const jitter = (Math.random() * 2 - 1) * 0.2 * exp;
    const delay = Math.max(BACKOFF_BASE_MS, Math.min(BACKOFF_CAP_MS, Math.floor(exp + jitter)));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.dial();
    }, delay);
  }

  private handleMessage(raw: unknown): void {
    let text: string;
    if (typeof raw === "string") text = raw;
    else if (raw instanceof ArrayBuffer) text = new TextDecoder().decode(raw);
    else if (raw instanceof Blob) {
      void raw.text().then((t) => this.handleMessage(t));
      return;
    } else {
      return;
    }

    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return; // malformed — ignore without crashing
    }

    // Gate v4 frames carry a `channel`; Binance kline frames carry `e:"kline"`.
    if (typeof msg.channel === "string" && msg.channel.startsWith("spot.")) {
      this.handleGateFrame(msg);
      return;
    }
    this.handleBinanceFrame(msg);
  }

  private handleGateFrame(msg: Record<string, unknown>): void {
    const cur = this.current;
    if (!cur) return;
    const channel = msg.channel as string;

    if (channel === "spot.ping") {
      // Gate pings us too — answering keeps the socket alive.
      const ws = this.ws;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ time: Math.floor(Date.now() / 1000), channel: "spot.ping" }));
      }
      return;
    }

    if (msg.event !== "update") {
      // A rejected subscribe (unknown symbol on Gate, etc.) → drop the
      // socket; the close handler schedules a backoff reconnect.
      if (
        msg.event === "subscribe" &&
        typeof msg.result === "object" &&
        msg.result !== null &&
        (msg.result as { status?: unknown }).status === "fail"
      ) {
        this.teardownSocket();
      }
      return;
    }

    const tfSec = TIMEFRAME_SECONDS[cur.timeframe];

    if (channel === "spot.trades") {
      if (tfSec >= 60 || !this.aggregator) return;
      const r = msg.result as { create_time_ms?: unknown; price?: unknown } | null;
      if (!r || typeof r !== "object") return;
      const price = parseFloat(String(r.price));
      const ts = Math.floor(Number(r.create_time_ms));
      if (!Number.isFinite(price) || !Number.isFinite(ts)) return;
      const result = this.aggregator.apply({
        instrument: cur.instrument,
        timestamp: ts,
        bid: null,
        ask: null,
        mid: price,
      });
      if (result) {
        this.handlers.onCandle(cur.instrument, cur.timeframe, result.candle, result.closed !== null);
      }
      return;
    }

    if (channel === "spot.candlesticks" && tfSec >= 60) {
      const rows = Array.isArray(msg.result) ? msg.result : [msg.result];
      // 1w/1M subscribe to 1d and merge into the calendar bucket; native
      // timeframes receive their own interval directly.
      const sourceSec = tfSec === 604800 || tfSec === 2592000 ? 86400 : tfSec;
      for (const row of rows) {
        const c = parseGateWsCandle(row);
        if (!c) continue;
        if (sourceSec === tfSec) {
          this.handlers.onCandle(cur.instrument, cur.timeframe, c, false);
        } else {
          this.mergeIntoBucket(c, tfSec);
        }
      }
    }
  }

  /** Merges a finer candle (Gate 1d) into the current Binance calendar
   *  bucket (1w/1M), emitting on rollover — mirrors the aggregator path. */
  private mergeIntoBucket(candle: Candle, tfSec: number): void {
    const cur = this.current;
    if (!cur) return;
    const time = binanceBucketStart(candle.time * 1000, tfSec) / 1000;
    const m = this.merged;
    if (!m || time > m.time) {
      if (m) this.handlers.onCandle(cur.instrument, cur.timeframe, m, true);
      this.merged = {
        time,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      };
      this.handlers.onCandle(cur.instrument, cur.timeframe, this.merged, false);
    } else if (time === m.time) {
      m.high = Math.max(m.high, candle.high);
      m.low = Math.min(m.low, candle.low);
      m.close = candle.close;
      this.handlers.onCandle(cur.instrument, cur.timeframe, m, false);
    }
    // time < m.time → stale frame — ignore, history is never rewritten
  }

  private handleBinanceFrame(msg: Record<string, unknown>): void {
    const cur = this.current;
    if (!cur || msg.e !== "kline" || typeof msg.s !== "string") return;
    const k = msg.k;
    if (!k || typeof k !== "object") return;
    const kl = k as Record<string, unknown>;
    if (msg.s.toUpperCase() !== cur.instrument) return;

    const openTimeMs = Number(kl.t);
    if (!Number.isFinite(openTimeMs)) return;
    const tfSec = TIMEFRAME_SECONDS[cur.timeframe];

    if (tfSec < 60) {
      // 1s kline updates act as the tick feed for the shared aggregator.
      // Timestamp = END of the 1s bucket so each close lands inside its own
      // second and target buckets aggregate exactly like the REST history.
      const close = parseFloat(String(kl.c));
      if (!Number.isFinite(close)) return;
      const result = this.aggregator?.apply({
        instrument: cur.instrument,
        timestamp: openTimeMs + 999,
        bid: null,
        ask: null,
        mid: close,
      });
      if (result) {
        this.handlers.onCandle(cur.instrument, cur.timeframe, result.candle, result.closed !== null);
      }
      return;
    }

    // Native interval → the kline IS the candle (times already aligned).
    const open = parseFloat(String(kl.o));
    const high = parseFloat(String(kl.h));
    const low = parseFloat(String(kl.l));
    const close = parseFloat(String(kl.c));
    if (![open, high, low, close].every(Number.isFinite)) return;
    this.handlers.onCandle(
      cur.instrument,
      cur.timeframe,
      { time: Math.floor(openTimeMs / 1000), open, high, low, close },
      kl.x === true
    );
  }
}

interface GateWsCandle {
  t?: unknown;
  o?: unknown;
  h?: unknown;
  l?: unknown;
  c?: unknown;
}

function parseGateWsCandle(row: unknown): Candle | null {
  if (typeof row !== "object" || row === null) return null;
  const r = row as GateWsCandle;
  const time = Number(r.t);
  const open = parseFloat(String(r.o));
  const high = parseFloat(String(r.h));
  const low = parseFloat(String(r.l));
  const close = parseFloat(String(r.c));
  if (!Number.isFinite(time) || ![open, high, low, close].every(Number.isFinite)) return null;
  return { time, open, high, low, close };
}
