/**
 * OANDA market data for the browser.
 *
 * PRIMARY PATH: the visitor talks to OANDA's practice API DIRECTLY with a
 * practice-account token (see oandaAccounts.ts). OANDA allows browser CORS
 * (the preflight permits the Authorization header), so every visitor loads
 * candles and ticks over their OWN connection — no relay, no CDN bandwidth,
 * and it keeps working where ISP filtering resets Cloudflare-hosted relay
 * domains. Multiple practice accounts are load-balanced and rotated on
 * rejection/rate-limit.
 *
 * FALLBACK: the project's Cloudflare Worker (cloudflare-worker/oanda/
 * oanda-proxy.js) when VITE_OANDA_PROXY_URL is set — used for ISPs that
 * block OANDA itself, and remembered for the rest of the session once a
 * direct attempt fails.
 *
 *   REST:  OANDA /v3/instruments/<i>/candles (direct) or <proxy>/candles
 *   Live:  OANDA /v3/accounts/<acct>/pricing/stream (direct) or <proxy>/stream
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
import { currentOandaAccount, rotateOandaAccount, type OandaAccount } from "./oandaAccounts";

const OANDA_MAX_COUNT = 5000;
const MAX_BATCHES = 10;
const REQUEST_TIMEOUT_MS = 25_000;
const BACKOFF_BASE_MS = 350;
const BACKOFF_CAP_MS = 30_000;
/** OANDA emits HEARTBEAT lines every ~5s; silence beyond this means the
 *  connection is dead without a TCP close — recycle it. */
const SILENCE_WATCHDOG_MS = 90_000;

/** Direct practice API endpoints — browser CORS is allowed (see
 *  oandaAccounts.ts), so the visitor's OWN connection carries the data. That
 *  is also what keeps the chart working where ISP filtering resets the
 *  Cloudflare-hosted relay domains. */
const OANDA_DIRECT_API = "https://api-fxpractice.oanda.com/v3";
const OANDA_DIRECT_STREAM = "https://stream-fxpractice.oanda.com/v3";

/** Set when a direct stream attempt failed in this session: reconnects then
 *  go straight to the worker instead of burning another doomed attempt. */
let streamViaWorker = false;

export function oandaProxyConfigured(): boolean {
  // A data path exists when the direct practice pool OR the worker is set up.
  return !!currentOandaAccount() || !!workerBase();
}

/** Worker relay base (now the FALLBACK path; may be unset). */
function workerBase(): string | null {
  const raw = (import.meta.env.VITE_OANDA_PROXY_URL as string | undefined)?.trim();
  return raw ? raw.replace(/\/+$/, "") : null;
}

/** A candle source: the visitor's direct practice account, or the worker. */
type CandleTarget = { kind: "direct"; account: OandaAccount } | { kind: "worker"; base: string };

/** A live-stream source (direct practice account, or the worker relay). */
type StreamTarget = { url: string; headers: Record<string, string> };

function candlesUrl(
  target: CandleTarget,
  instrument: string,
  granularity: string,
  count: number,
  toIso?: string
): string {
  let url: string;
  if (target.kind === "direct") {
    url =
      `${OANDA_DIRECT_API}/instruments/${encodeURIComponent(instrument)}/candles` +
      `?granularity=${granularity}&price=M&count=${count}`;
  } else {
    url =
      `${target.base}/candles` +
      `?instrument=${encodeURIComponent(instrument)}&granularity=${granularity}&count=${count}`;
  }
  if (toIso) url += `&to=${encodeURIComponent(toIso)}`;
  return url;
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
  target: CandleTarget,
  instrument: string,
  granularity: string,
  count: number,
  toIso?: string
): Promise<Candle[]> {
  const res = await fetch(candlesUrl(target, instrument, granularity, count, toIso), {
    headers:
      target.kind === "direct"
        ? {
            // Practice account: the token travels with the request (CORS
            // preflight verified to allow it) so the visitor's own internet
            // reaches OANDA directly — no relay in between.
            Authorization: `Bearer ${target.account.token}`,
            "Accept-Datetime-Format": "RFC3339",
            Accept: "application/json",
          }
        : { Accept: "application/json" },
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
  const granularity = NATIVE_HISTORY_GRANULARITY[timeframe];
  if (!granularity) {
    throw new Error(`Timeframe ${timeframe} has no upstream-native history source`);
  }
  const needed = nativeCandlesNeeded(timeframe, count);

  // Source ladder: the visitor's sticky practice account FIRST (their own
  // internet, no intermediary), rotated on rejection/rate-limit/network
  // failure, with the worker relay as a last resort.
  let account = currentOandaAccount();
  const worker = workerBase();
  let useDirect = !!account;
  let lastErr: unknown = null;

  const all: Candle[] = [];
  let remaining = needed;
  let to = toSec !== undefined ? new Date(toSec * 1000).toISOString() : undefined;
  for (let batch = 0; batch < MAX_BATCHES && remaining > 0; batch++) {
    const batchCount = Math.min(remaining, OANDA_MAX_COUNT);
    let candles: Candle[] | null = null;
    for (;;) {
      const target: CandleTarget | null =
        useDirect && account
          ? { kind: "direct", account }
          : worker
            ? { kind: "worker", base: worker }
            : null;
      if (!target) {
        if (all.length > 0) break; // partial history beats a total failure
        throw lastErr instanceof Error ? lastErr : new Error("OANDA data source unavailable");
      }
      try {
        candles = await fetchBatch(target, instrument, granularity, batchCount, to);
        break;
      } catch (err) {
        lastErr = err;
        if (target.kind === "direct") {
          // 401/403/429 or a network failure: retire this practice account
          // for the session and continue with the next one.
          account = rotateOandaAccount(target.account);
          if (!account) useDirect = false;
        } else {
          if (all.length > 0) break;
          throw err;
        }
      }
    }
    if (!candles || candles.length === 0) break;
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
  /** Freshest history candle, kept so a fresh aggregator created by
   *  subscribe() continues the real partial OHLC instead of rebuilding the
   *  current bucket from zero — on 4h/D/W/M that silently dropped the
   *  bucket's wicks for the rest of the session. */
  private seedCandle: Candle | null = null;
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
    // Re-apply a seed set before subscribe() — subscribe() replaces the
    // aggregator, so without this the store's seed() would be discarded.
    if (this.seedCandle) this.aggregator.seed(this.seedCandle);
    this.handlers.onStatus("connecting");
    this.dial();
  }

  unsubscribe(): void {
    this.current = null;
    this.aggregator = null;
    this.seedCandle = null;
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

  /** Prime the aggregator with the freshest history candle. Stored too, so
   *  a subscribe() that recreates the aggregator keeps the seed. */
  seed(candle: Candle): void {
    this.seedCandle = candle;
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
    const controller = new AbortController();
    this.abort = controller;
    this.lastMessageAt = Date.now();
    void this.readLoop(cur, controller);
  }

  /** Live-stream sources in preference order: the visitor's direct practice
   *  account first (their own internet, no relay), then the worker. Once a
   *  direct attempt has failed this session, reconnects go straight to the
   *  worker instead of burning another doomed dial. */
  private streamTargets(cur: { instrument: string; timeframe: Timeframe }): StreamTarget[] {
    const list: StreamTarget[] = [];
    const account = currentOandaAccount();
    if (account && !streamViaWorker) {
      list.push({
        url:
          `${OANDA_DIRECT_STREAM}/accounts/${encodeURIComponent(account.id)}/pricing/stream` +
          `?instruments=${encodeURIComponent(cur.instrument)}`,
        headers: {
          Authorization: `Bearer ${account.token}`,
          "Accept-Datetime-Format": "RFC3339",
          Accept: "application/json",
        },
      });
    }
    const base = workerBase();
    if (base) {
      list.push({
        url: `${base}/stream?instruments=${encodeURIComponent(cur.instrument)}`,
        headers: { Accept: "application/json" },
      });
    }
    return list;
  }

  private async readLoop(
    cur: { instrument: string; timeframe: Timeframe },
    controller: AbortController
  ): Promise<void> {
    const targets = this.streamTargets(cur);
    try {
      if (targets.length === 0) throw new Error("No OANDA stream source configured");
      for (const target of targets) {
        try {
          // Returns normally only when the stream ENDED by itself; a failure
          // to open throws, so the next source gets its turn.
          await this.consumeStream(cur, target, controller);
          break;
        } catch {
          if (controller.signal.aborted) return; // pause/unsubscribe/switch
          if (target.headers.Authorization) streamViaWorker = true;
        }
      }
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

  /** Opens one stream source and pumps its lines until it ends. Throws ONLY
   *  when the connection could not be opened. */
  private async consumeStream(
    cur: { instrument: string; timeframe: Timeframe },
    target: StreamTarget,
    controller: AbortController
  ): Promise<void> {
    const res = await fetch(target.url, { headers: target.headers, signal: controller.signal });
    if (!res.ok || !res.body) {
      let message = `OANDA stream error (HTTP ${res.status})`;
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


