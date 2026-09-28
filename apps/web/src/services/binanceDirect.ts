/**
 * Direct-from-browser Binance market data — REST history + live kline WS.
 *
 * Binance symbols skip the market server entirely: the browser fetches
 * public kline history and streams kline updates itself, then runs the
 * SAME shared aggregation engine the server uses (packages/shared), so
 * client-built candles are identical to server-built ones.
 *
 *   REST: https://data-api.binance.vision/api/v3/klines  (public mirror, no key)
 *   WS:   wss://data-stream.binance.vision/ws/<sym>@kline_<interval>
 *
 * Interval plan (mirrors apps/market-server/src/binance/restClient.ts):
 *   1m/5m/15m/30m/1h/4h/1d/1w/1M → native Binance interval (1:1)
 *   5s/10s/15s/30s               → built from native 1s klines with the
 *                                  shared engine (Binance has no other
 *                                  sub-minute intervals)
 *
 * Iran constraint: direct browser requests to Binance get HTTP 451 or a
 * connection reset. Both the REST fetcher and the WS stream detect that
 * and fail over to the Cloudflare Worker relay (cloudflare-worker/
 * binance-proxy.js via VITE_BINANCE_PROXY_URL), then stick with whichever
 * base last worked so the blocked origin is never hammered again.
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
const KLINE_LIMIT = 1000; // Binance max rows per request
const MAX_BATCHES = 50;
const REQUEST_TIMEOUT_MS = 15_000;
const BACKOFF_BASE_MS = 350;
const BACKOFF_CAP_MS = 30_000;

/** Sticky REST endpoint choice — once one side proves blocked/unreachable,
 *  keep using the other instead of re-trying the broken origin. */
let restMode: "auto" | "direct" | "proxy" = "auto";
/** Same idea for the WebSocket stream. */
let wsMode: "auto" | "direct" | "proxy" = "auto";

/** Set once a direct REST fetch proves blocked/reset (451/403/connection
 *  reset). Binance geo-blocks by IP and a Cloudflare-hosted relay can't help
 *  (Binance blocks datacenter IPs too — verified), so when this flag is up
 *  the market server becomes the fallback for Binance pairs. Cleared again
 *  whenever a direct fetch succeeds, so recovery is automatic. */
let directBlocked = false;

export function binanceDirectBlocked(): boolean {
  return directBlocked && !proxyBase();
}

function proxyBase(): string | null {
  const raw = (import.meta.env.VITE_BINANCE_PROXY_URL as string | undefined)?.trim();
  return raw ? raw.replace(/\/+$/, "") : null;
}

/** "https://host" → "wss://host" (the relay serves WS on the same origin). */
function proxyWsBase(): string | null {
  const p = proxyBase();
  return p ? p.replace(/^http/i, "ws") : null;
}

/** Thrown when the direct origin is geo-blocked → trigger proxy fallback. */
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

  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.status === 451 || res.status === 403) {
        throw new BlockedError(`Binance blocked (HTTP ${res.status})`);
      }
      if (!res.ok) {
        const err = new Error(`Binance error (HTTP ${res.status})`);
        const retryable = res.status === 429 || res.status === 418 || res.status >= 500;
        if (!retryable || attempt === 2) throw err;
        lastErr = err;
      } else {
        const body: unknown = await res.json();
        if (!Array.isArray(body)) throw new Error("Malformed Binance response");
        const out: Candle[] = [];
        for (const row of body as unknown[]) {
          if (!Array.isArray(row)) continue;
          const c = parseKline(row as RawKline);
          if (c) out.push(c);
        }
        return out;
      }
    } catch (err) {
      if (err instanceof BlockedError) throw err;
      lastErr = err;
      if (attempt === 2) break;
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
  if (lastErr instanceof Error) throw lastErr;
  throw new TypeError("Binance request failed");
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

/**
 * Binance kline history for a timeframe, aggregated client-side with the
 * shared engine (sub-minute timeframes derive from native 1s klines).
 * Falls back to the Worker relay when the direct origin is blocked.
 */
export async function fetchBinanceCandles(
  instrument: string,
  timeframe: Timeframe,
  count: number,
  toSec?: number
): Promise<Candle[]> {
  const { interval, factor } = binanceIntervalPlan(timeframe);
  const needed = Math.min(count * factor, MAX_BATCHES * KLINE_LIMIT);
  const proxy = proxyBase();

  const walk = (base: string) =>
    walkKlines(base, instrument, interval, needed, toSec !== undefined ? toSec * 1000 : undefined);
  const finalize = (rows: Candle[]): Candle[] => {
    const dedup = new Map<number, Candle>();
    for (const c of rows) dedup.set(c.time, c);
    let out = [...dedup.values()].sort((a, b) => a.time - b.time);
    if (factor > 1) out = aggregateCandles(out, TIMEFRAME_SECONDS[timeframe]);
    return out.slice(-count);
  };

  let directErr: unknown = null;
  if (restMode !== "proxy") {
    try {
      const rows = await walk(REST_BASE_DIRECT);
      restMode = "direct"; // direct origin works — stay on it
      directBlocked = false; // previous blockage was transient — recover
      return finalize(rows);
    } catch (err) {
      directErr = err;
      directBlocked = true;
      // Geo-block (451/403) or network reset (TypeError) → proxy fallback.
      // Real upstream errors (5xx/4xx from Binance itself) surface as-is.
      const blockedish = err instanceof BlockedError || err instanceof TypeError;
      if (!blockedish || !proxy) throw err;
    }
  }
  if (!proxy) throw directErr ?? new Error("Binance request failed");
  const rows = await walk(proxy);
  restMode = "proxy";
  return finalize(rows);
}

/**
 * Live Binance klines, straight from Binance (or the Worker relay).
 *
 * Same surface as MarketWsClient (connect/disconnect/subscribe/unsubscribe/
 * setPaused + the WsHandlers callbacks) so the market store can swap it in
 * without any other changes:
 *   - native timeframes: each kline update is forwarded as the candle
 *   - sub-minute timeframes (5s…30s): the 1s kline stream feeds the shared
 *     CandleAggregator, exactly like the server aggregates 1s data
 *   - timeframe changes resubscribe (fresh socket + fresh aggregator)
 *   - `seed()` primes the sub-minute aggregator with the last history
 *     candle so the live candle continues the real partial OHLC
 *   - no snapshots: history always comes from fetchBinanceCandles
 */
export class BinanceDirectStream {
  private handlers: WsHandlers;
  private ws: WebSocket | null = null;
  private current: { instrument: string; timeframe: Timeframe } | null = null;
  private aggregator: CandleAggregator | null = null;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
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
    this.clearTimer();
    this.teardownSocket();
    this.handlers.onStatus("offline");
  }

  subscribe(instrument: string, timeframe: Timeframe): void {
    this.closedByUser = false;
    this.paused = false; // a fresh subscribe always streams
    this.current = { instrument: instrument.toUpperCase(), timeframe };
    this.attempt = 0;
    // Fresh timeframe → fresh socket (different interval) + fresh aggregator.
    this.teardownSocket();
    this.aggregator =
      TIMEFRAME_SECONDS[timeframe] < 60
        ? new CandleAggregator(timeframe, binanceBucketStart)
        : null;
    this.handlers.onStatus("connecting");
    this.dial();
  }

  unsubscribe(): void {
    this.current = null;
    this.aggregator = null;
    this.clearTimer();
    this.teardownSocket();
    this.handlers.onStatus("offline");
  }

  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    if (paused) {
      this.clearTimer();
      this.teardownSocket();
    } else if (this.current && !this.closedByUser) {
      this.handlers.onStatus("connecting");
      this.dial();
    }
  }

  /** Prime the sub-minute aggregator with the freshest history candle. */
  seed(candle: Candle): void {
    this.aggregator?.seed(candle);
  }

  // ── internals ────────────────────────────────────────────────────────────

  private clearTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
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

    let base = WS_BASE_DIRECT;
    if (wsMode === "proxy") {
      const p = proxyWsBase();
      if (!p) {
        this.handlers.onStatus("offline");
        return;
      }
      base = p;
    }
    const usedDirect = base === WS_BASE_DIRECT;

    const { interval } = binanceIntervalPlan(cur.timeframe);
    const stream = `${cur.instrument.toLowerCase()}@kline_${interval}`;

    let ws: WebSocket;
    try {
      ws = new WebSocket(`${base}/ws/${stream}`);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    this.openedOnce = false;

    ws.addEventListener("open", () => {
      this.openedOnce = true;
      this.attempt = 0;
      if (usedDirect) wsMode = "direct"; // stick with whichever base worked
      this.handlers.onStatus("connected");
    });

    ws.addEventListener("message", (ev) => this.handleMessage(ev.data));

    ws.addEventListener("close", () => {
      if (this.ws === ws) this.ws = null;
      if (this.closedByUser || !this.current || this.paused) {
        this.handlers.onStatus("offline");
        return;
      }
      // A first dial that never opened (451/reset surface as close-without-
      // open in browsers) → switch to the Worker relay for good.
      if (!this.openedOnce && wsMode === "auto" && proxyWsBase()) wsMode = "proxy";
      this.handlers.onStatus("reconnecting");
      this.scheduleReconnect();
    });

    ws.addEventListener("error", () => {
      // close event will follow; nothing else to do.
    });
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

    let msg: { e?: unknown; s?: unknown; k?: Record<string, unknown> };
    try {
      msg = JSON.parse(text) as typeof msg;
    } catch {
      return; // malformed — ignore without crashing
    }
    const cur = this.current;
    if (!cur || !msg || msg.e !== "kline" || !msg.k || typeof msg.s !== "string") return;
    if (msg.s.toUpperCase() !== cur.instrument) return;

    const k = msg.k;
    const openTimeMs = Number(k.t);
    if (!Number.isFinite(openTimeMs)) return;
    const tfSec = TIMEFRAME_SECONDS[cur.timeframe];

    if (tfSec < 60) {
      // 1s kline updates act as the tick feed for the shared aggregator.
      // Timestamp = END of the 1s bucket so each close lands inside its own
      // second and target buckets aggregate exactly like the REST history.
      const close = parseFloat(String(k.c));
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
    const open = parseFloat(String(k.o));
    const high = parseFloat(String(k.h));
    const low = parseFloat(String(k.l));
    const close = parseFloat(String(k.c));
    if (![open, high, low, close].every(Number.isFinite)) return;
    this.handlers.onCandle(
      cur.instrument,
      cur.timeframe,
      { time: Math.floor(openTimeMs / 1000), open, high, low, close },
      k.x === true
    );
  }
}


