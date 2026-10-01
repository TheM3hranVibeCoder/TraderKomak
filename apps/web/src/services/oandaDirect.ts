/**
 * OANDA market data for the browser — relayed by the project's Cloudflare
 * Worker (cloudflare-worker/oanda/oanda-proxy.js). The browser NEVER talks
 * to OANDA directly and never sees the token: worker secrets hold it.
 *
 *   REST:  GET <proxy>/candles?instrument&granularity&count&to
 *   Live:  GET <proxy>/stream?instruments=<list>   (chunked JSON-lines)
 *
 * History mirrors apps/market-server/src/oanda/restClient.ts (max 5000 per
 * batch, `to`-cursor backwards pagination); the stream adapter mirrors
 * apps/market-server/src/oanda/adapter.ts; live candles are built with the
 * shared CandleAggregator + oandaAlignedBucketStart, so client-built
 * candles are identical to the server-built ones.
 */
import {
  NATIVE_HISTORY_GRANULARITY,
  TIMEFRAME_SECONDS,
  CandleAggregator,
  aggregateCandles,
  nativeCandlesNeeded,
  oandaAlignedBucketStart,
  type Candle,
  type MarketTick,
  type Timeframe,
} from "@traderkomak/shared";
import type { WsHandlers } from "./wsClient";

const OANDA_MAX_COUNT = 5000;
const MAX_BATCHES = 10;
const REQUEST_TIMEOUT_MS = 25_000;
const BACKOFF_BASE_MS = 350;
const BACKOFF_CAP_MS = 30_000;
/** OANDA emits HEARTBEAT lines every ~5s; silence beyond this means the
 *  connection is dead without a TCP close — recycle it. */
const SILENCE_WATCHDOG_MS = 90_000;

export function oandaProxyConfigured(): boolean {
  const raw = (import.meta.env.VITE_OANDA_PROXY_URL as string | undefined)?.trim();
  return !!raw;
}

function proxyBase(): string {
  const raw = (import.meta.env.VITE_OANDA_PROXY_URL as string | undefined)?.trim();
  if (!raw) throw new Error("OANDA proxy URL is not configured (VITE_OANDA_PROXY_URL)");
  return raw.replace(/\/+$/, "");
}

// ── adapter (ported from apps/market-server/src/oanda/adapter.ts) ──────────

interface OandaCandleMid {
  o?: unknown;
  h?: unknown;
  l?: unknown;
  c?: unknown;
}

interface RawOandaCandle {
  complete?: unknown;
  time?: unknown;
  mid?: OandaCandleMid;
}

interface RawOandaCandlesResponse {
  candles?: unknown;
}

interface RawOandaErrorBody {
  error?: { message?: string };
}

function parsePrice(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const n = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

/** RFC3339 timestamp → epoch seconds; null when malformed. */
function oandaTimeToSeconds(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

/**
 * OANDA /candles response → ascending, de-duplicated internal candles.
 * The trailing INCOMPLETE candle is kept on purpose (seeds the live
 * aggregator with the bucket currently forming).
 */
function toCandles(response: RawOandaCandlesResponse): Candle[] {
  const rows = Array.isArray(response.candles) ? response.candles : [];
  const out = new Map<number, Candle>();
  for (const row of rows as RawOandaCandle[]) {
    const time = oandaTimeToSeconds(row?.time);
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
 * OANDA pricing-stream line → MarketTick; null for heartbeats, malformed
 * events and non-tradeable statuses (stale/indicative prices must not
 * build candles). Same rules as the server adapter.
 */
function priceEventToTick(msg: unknown): MarketTick | null {
  if (typeof msg !== "object" || msg === null) return null;
  const m = msg as Record<string, unknown>;
  if (m.type !== "PRICE") return null;
  if (typeof m.instrument !== "string" || m.instrument.length === 0) return null;

  const ms = typeof m.time === "string" ? Date.parse(m.time) : NaN;
  if (!Number.isFinite(ms)) return null;

  const bid = firstSidePrice(m.bids);
  const ask = firstSidePrice(m.asks);
  const mid: number | null = bid !== null && ask !== null ? (bid + ask) / 2 : null;

  if (typeof m.status === "string" && m.status !== "tradeable") return null;
  if (bid === null && ask === null && mid === null) return null;

  return { instrument: m.instrument, timestamp: Math.floor(ms), bid, ask, mid };
}

function firstSidePrice(sides: unknown): number | null {
  if (!Array.isArray(sides) || sides.length === 0) return null;
  const first = sides[0] as Record<string, unknown> | undefined;
  if (!first) return null;
  return parsePrice(first.price);
}

// ── history ────────────────────────────────────────────────────────────────

async function fetchBatch(
  base: string,
  instrument: string,
  granularity: string,
  count: number,
  toIso?: string
): Promise<Candle[]> {
  let url =
    `${base}/candles` +
    `?instrument=${encodeURIComponent(instrument)}` +
    `&granularity=${granularity}&count=${count}`;
  if (toIso) url += `&to=${encodeURIComponent(toIso)}`;

  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    let message = `OANDA proxy error (HTTP ${res.status})`;
    try {
      const body = (await res.json()) as RawOandaErrorBody;
      if (body.error?.message) message = body.error.message;
    } catch {
      // keep the generic message
    }
    throw new Error(message);
  }
  let body: RawOandaCandlesResponse;
  try {
    body = (await res.json()) as RawOandaCandlesResponse;
  } catch {
    throw new Error("Malformed OANDA proxy response");
  }
  return toCandles(body);
}

/**
 * OANDA native-granularity mid-price history for a timeframe, paginated
 * with the stateless `to` cursor exactly like the server REST client.
 * Sub-minute timeframes (10s/15s/30s) derive from native S5 candles with
 * the shared aggregateCandles engine.
 */
export async function fetchOandaCandles(
  instrument: string,
  timeframe: Timeframe,
  count: number,
  toSec?: number
): Promise<Candle[]> {
  const base = proxyBase();
  const granularity = NATIVE_HISTORY_GRANULARITY[timeframe];
  if (!granularity) {
    throw new Error(`Timeframe ${timeframe} has no upstream-native history source`);
  }
  const needed = nativeCandlesNeeded(timeframe, count);

  const all: Candle[] = [];
  let remaining = needed;
  let to = toSec !== undefined ? new Date(toSec * 1000).toISOString() : undefined;
  for (let batch = 0; batch < MAX_BATCHES && remaining > 0; batch++) {
    const batchCount = Math.min(remaining, OANDA_MAX_COUNT);
    let candles: Candle[];
    try {
      candles = await fetchBatch(base, instrument, granularity, batchCount, to);
    } catch (err) {
      if (all.length > 0) break; // partial history beats a total failure
      throw err;
    }
    if (candles.length === 0) break;
    all.unshift(...candles);
    remaining -= candles.length;
    if (candles.length < batchCount) break;
    to = new Date(candles[0]!.time * 1000).toISOString();
    if (remaining > 0) await new Promise((r) => setTimeout(r, 120));
  }

  const dedup = new Map<number, Candle>();
  for (const c of all) dedup.set(c.time, c);
  const native = [...dedup.values()].sort((a, b) => a.time - b.time).slice(-needed);

  const tfSec = TIMEFRAME_SECONDS[timeframe];
  // 10s/15s/30s are exact multiples of S5 and UTC-aligned → plain modulo.
  if (granularity === "S5" && tfSec > 5) return aggregateCandles(native, tfSec);
  return native;
}

/**
 * Live OANDA prices through the worker, aggregated client-side.
 *
 * Same surface as MarketWsClient (connect/disconnect/subscribe/unsubscribe/
 * setPaused + the WsHandlers callbacks) so the market store can swap it in
 * without any other changes:
 *   - a fetch-based chunked JSON-lines reader (no WebSocket on this path —
 *     OANDA's pricing stream is HTTP chunked)
 *   - every PRICE line becomes a MarketTick → shared CandleAggregator with
 *     oandaAlignedBucketStart (5pm-New-York session alignment for 4h/D/W/M)
 *   - HEARTBEAT lines double as liveness proof; a silence watchdog recycles
 *     dead connections the TCP stack never noticed
 *   - `seed()` primes the aggregator with the last history candle so the
 *     live candle continues the real partial OHLC
 *   - no snapshots: history always comes from fetchOandaCandles
 */
export class OandaDirectStream {
  private handlers: WsHandlers;
  private current: { instrument: string; timeframe: Timeframe } | null = null;
  private aggregator: CandleAggregator | null = null;
  private abort: AbortController | null = null;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private closedByUser = false;
  private paused = false;
  private lastMessageAt = 0;

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
    this.teardown();
    this.handlers.onStatus("offline");
  }

  subscribe(instrument: string, timeframe: Timeframe): void {
    this.closedByUser = false;
    this.paused = false; // a fresh subscribe always streams
    this.current = { instrument, timeframe };
    this.attempt = 0;
    this.teardown();
    this.aggregator = new CandleAggregator(timeframe, oandaAlignedBucketStart);
    this.handlers.onStatus("connecting");
    this.dial();
  }

  unsubscribe(): void {
    this.current = null;
    this.aggregator = null;
    this.clearTimers();
    this.teardown();
    this.handlers.onStatus("offline");
  }

  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    if (paused) {
      this.clearTimers();
      this.teardown();
      this.handlers.onStatus("offline");
    } else if (this.current && !this.closedByUser) {
      this.attempt = 0;
      this.handlers.onStatus("connecting");
      this.dial();
    }
  }

  /** Prime the aggregator with the freshest history candle. */
  seed(candle: Candle): void {
    this.aggregator?.seed(candle);
  }

  // ── internals ────────────────────────────────────────────────────────────

  private clearTimers(): void {
    this.stopWatchdog();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private teardown(): void {
    this.stopWatchdog();
    if (this.abort) {
      try {
        this.abort.abort();
      } catch {
        // ignore
      }
      this.abort = null;
    }
  }

  private stopWatchdog(): void {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  private dial(): void {
    const cur = this.current;
    if (!cur || this.abort) return;
    let base: string;
    try {
      base = proxyBase();
    } catch {
      this.handlers.onStatus("offline");
      return;
    }
    const controller = new AbortController();
    this.abort = controller;
    this.lastMessageAt = Date.now();
    void this.readLoop(cur, base, controller);
  }

  private async readLoop(
    cur: { instrument: string; timeframe: Timeframe },
    base: string,
    controller: AbortController
  ): Promise<void> {
    try {
      const res = await fetch(`${base}/stream?instruments=${encodeURIComponent(cur.instrument)}`, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        let message = `OANDA proxy error (HTTP ${res.status})`;
        try {
          const b = (await res.json()) as RawOandaErrorBody;
          if (b.error?.message) message = b.error.message;
        } catch {
          // keep the generic message
        }
        throw new Error(message);
      }

      this.handlers.onStatus("connected");
      this.attempt = 0;
      this.startWatchdog(controller);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        this.lastMessageAt = Date.now();
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (line) this.handleLine(cur, line);
        }
      }
    } catch {
      // aborted (pause/unsubscribe/disconnect/switch) → stay down
      if (controller.signal.aborted) return;
    } finally {
      this.stopWatchdog();
      if (this.abort === controller) this.abort = null;
    }

    // Stream ended without an explicit teardown → reconnect with backoff.
    if (this.closedByUser || !this.current || this.paused) {
      this.handlers.onStatus("offline");
      return;
    }
    this.handlers.onStatus("reconnecting");
    this.scheduleReconnect();
  }

  private handleLine(cur: { instrument: string; timeframe: Timeframe }, line: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(line) as unknown;
    } catch {
      return; // malformed — ignore without crashing
    }
    const tick = priceEventToTick(msg); // null on heartbeats/non-tradeable
    if (!tick) return;
    if (tick.instrument.toUpperCase() !== cur.instrument.toUpperCase()) return;
    const result = this.aggregator?.apply(tick);
    if (result) {
      this.handlers.onCandle(cur.instrument, cur.timeframe, result.candle, result.closed !== null);
    }
  }

  private startWatchdog(controller: AbortController): void {
    this.stopWatchdog();
    this.watchdogTimer = setInterval(() => {
      if (Date.now() - this.lastMessageAt > SILENCE_WATCHDOG_MS) {
        try {
          controller.abort();
        } catch {
          // ignore
        }
      }
    }, 15_000);
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
      if (this.current && !this.closedByUser && !this.paused) {
        this.handlers.onStatus("connecting");
        this.dial();
      }
    }, delay);
  }
}


