/**
 * cTrader market data for the browser — JSON over WebSocket (port 5036).
 *
 * PRIMARY PATH: the visitor's browser connects DIRECTLY to cTrader's
 * WebSocket gateway (wss://demo.ctraderapi.com:5036), so every candle and
 * tick travels over the visitor's OWN internet — zero market-server
 * bandwidth, exactly like the Binance and OANDA paths. Messages are plain
 * JSON envelopes (no protobuf in the bundle):
 *   → {"clientMsgId":"7","payloadType":2100,"payload":{...}}
 *   ← {"payloadType":2101,"payload":{...},"clientMsgId":"7"}
 *
 * AUTH: the Open API needs a per-connection ApplicationAuth (clientId +
 * clientSecret) and AccountAuth (accountId + accessToken). The access
 * token expires ~every 30 days and is REFRESHED SERVER-SIDE (the market
 * server rotates it with the refresh token and serves the current one at
 * /api/ctrader-session — a ~200-byte response, never candle data). The
 * clientId/clientSecret/accountId live in VITE_* vars (demo credentials,
 * same trust model as the OANDA practice-token pool) with the server
 * endpoint as the fresh-token source.
 *
 * HISTORY: timeframes ≥1m map 1:1 to native trendbars (M1/M5/M15/M30/H1/
 * H4/D1/W1/MN1); the sub-minute timeframes (5s/10s/15s/30s) build 5-second
 * candles from BID tick data (ProtoOAGetTickDataReq) which the shared
 * aggregateCandles engine derives up — identical to the OANDA S5 path.
 * Live candles are built with the shared CandleAggregator +
 * binanceBucketStart (cTrader trendbars are UTC-epoch aligned).
 *
 * Fallback: fetchCandles (api.ts) relays through the market server when
 * this direct path fails; the watchlist keeps receiving US30 prices via
 * the server watch WS in that case.
 */
import {
  TIMEFRAME_SECONDS,
  CandleAggregator,
  aggregateCandles,
  binanceBucketStart,
  nativeCandlesNeeded,
  type Candle,
  type MarketTick,
  type Timeframe,
} from "@traderkomak/shared";
import type { WsHandlers } from "./wsClient";
import { recordVolumes } from "./volumeFeed";
import { httpBase } from "./httpUrl";

// ── protocol constants (payloadType ids from Spotware's ProtoOAPayloadType) ─

const PT = {
  ERROR_RES: 50,
  HEARTBEAT_EVENT: 51,
  APP_AUTH_REQ: 2100,
  APP_AUTH_RES: 2101,
  ACCOUNT_AUTH_REQ: 2102,
  ACCOUNT_AUTH_RES: 2103,
  SYMBOLS_LIST_REQ: 2114,
  SYMBOLS_LIST_RES: 2115,
  SYMBOL_BY_ID_REQ: 2116,
  SYMBOL_BY_ID_RES: 2117,
  SUBSCRIBE_SPOTS_REQ: 2127,
  SUBSCRIBE_SPOTS_RES: 2128,
  UNSUBSCRIBE_SPOTS_REQ: 2129,
  SPOT_EVENT: 2131,
  GET_TRENDBARS_REQ: 2137,
  GET_TRENDBARS_RES: 2138,
  OA_ERROR_RES: 2142,
  GET_TICKDATA_REQ: 2145,
  GET_TICKDATA_RES: 2146,
  TOKEN_INVALIDATED_EVENT: 2147,
  CLIENT_DISCONNECT_EVENT: 2148,
} as const;

/** Timeframe → native trendbar period (ProtoOATrendbarPeriod enum). */
const TF_TO_PERIOD: Partial<Record<Timeframe, number>> = {
  "1m": 1, // M1
  "5m": 5, // M5
  "15m": 7, // M15
  "30m": 8, // M30
  "1h": 9, // H1
  "4h": 10, // H4
  "1d": 12, // D1
  "1w": 13, // W1
  "1M": 14, // MN1
};
const SUB_MINUTE: ReadonlySet<string> = new Set(["5s", "10s", "15s", "30s"]);

/** Aliases for the Dow Jones index CFD, in preference order (mirrors the
 *  market-server registry — symbol names vary per broker). */
const US30_ALIASES = ["US30", "USA30", "DJI30", "DOW30", "DJI", "US30Index", "US30.CASH"];

const SESSION_CACHE_KEY = "tk-ctrader-session";
const SESSION_CACHE_TTL = 3600_000;
const REQUEST_TIMEOUT_MS = 25_000;
const MAX_BATCHES = 10;
const TRENDBARS_PER_REQ = 2000;
const MAX_TICK_CHUNKS = 20;
const HISTORICAL_PACING_MS = 250;
const HEARTBEAT_INTERVAL_MS = 10_000;
const SILENCE_WATCHDOG_MS = 60_000;
const BACKOFF_BASE_MS = 350;
const BACKOFF_CAP_MS = 30_000;

/** int64 fields may decode to strings in JSON mode — accept both. */
function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** 1/100000-scaled protocol price → display price, rounded to digits. */
function scalePrice(raw: number, digits: number): number {
  const price = raw / 100000;
  if (!Number.isFinite(price)) return price;
  const f = 10 ** digits;
  return Math.round(price * f) / f;
}

// ── session config ──────────────────────────────────────────────────────────

interface CtraderSession {
  clientId: string;
  clientSecret: string;
  accountId: string;
  accessToken: string;
  host: string;
  port: number;
}

/**
 * Browser-direct is a DEPLOYMENT opt-in: the demo app credentials live in
 * VITE_* vars (same trust model as the OANDA practice-token pool). The
 * fresh ACCESS TOKEN + numeric account id come from the server's
 * /api/ctrader-session (it auto-refreshes the ~30-day OAuth token and can
 * even discover the account id) — a static VITE token/account fallback
 * covers deployments that skip the server config.
 */
export function ctraderDirectConfigured(): boolean {
  return (
    !!(import.meta.env.VITE_CTRADER_CLIENT_ID as string | undefined)?.trim() &&
    !!(import.meta.env.VITE_CTRADER_CLIENT_SECRET as string | undefined)?.trim()
  );
}

let sessionPromise: Promise<CtraderSession> | null = null;

interface EnvSession {
  clientId?: string;
  clientSecret?: string;
  accountId?: string;
  accessToken?: string;
  host: string;
  port: number;
}

function envSession(): EnvSession {
  return {
    clientId: ((import.meta.env.VITE_CTRADER_CLIENT_ID as string | undefined) ?? "").trim(),
    clientSecret: ((import.meta.env.VITE_CTRADER_CLIENT_SECRET as string | undefined) ?? "").trim(),
    accountId: ((import.meta.env.VITE_CTRADER_ACCOUNT_ID as string | undefined) ?? "").trim(),
    accessToken: ((import.meta.env.VITE_CTRADER_ACCESS_TOKEN as string | undefined) ?? "").trim(),
    host: ((import.meta.env.VITE_CTRADER_WS_HOST as string | undefined) ?? "").trim() || "demo.ctraderapi.com",
    port: Number.parseInt(((import.meta.env.VITE_CTRADER_WS_PORT as string | undefined) ?? "").trim() || "5036", 10),
  };
}

function cachedSession(): CtraderSession | null {
  try {
    const raw = localStorage.getItem(SESSION_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at?: number; session?: CtraderSession };
    if (!parsed?.session?.clientId || Date.now() - (parsed.at ?? 0) > SESSION_CACHE_TTL) return null;
    return parsed.session;
  } catch {
    return null;
  }
}

function cacheSession(session: CtraderSession): void {
  try {
    localStorage.setItem(SESSION_CACHE_KEY, JSON.stringify({ at: Date.now(), session }));
  } catch {}
}

/** Server-served session config → localStorage cache → VITE fallback. */
function loadSession(force = false): Promise<CtraderSession> {
  if (!sessionPromise || force) {
    sessionPromise = (async () => {
      if (!force) {
        const cached = cachedSession();
        if (cached) return cached;
      }
      const env = envSession();
      try {
        const res = await fetch(`${httpBase()}/api/ctrader-session`, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) {
          const data = (await res.json()) as Partial<CtraderSession>;
          if (data.clientId && data.clientSecret && data.accountId && data.accessToken) {
            const session: CtraderSession = {
              clientId: data.clientId,
              clientSecret: data.clientSecret,
              accountId: data.accountId,
              accessToken: data.accessToken,
              host: data.host ?? env.host,
              port: data.port ?? env.port,
            };
            cacheSession(session);
            return session;
          }
        }
      } catch {
        // server unreachable — fall through to the env fallback
      }
      if (env.clientId && env.clientSecret && env.accountId && env.accessToken) return env as CtraderSession;
      throw new Error("cTrader session unavailable — server did not provide a token");
    })();
    sessionPromise.catch(() => {
      sessionPromise = null; // allow a retry on the next request
    });
  }
  return sessionPromise;
}

// ── shared JSON-over-WebSocket session ──────────────────────────────────────

interface PendingRequest {
  resolve: (payload: Record<string, unknown>) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

type TickListener = (tick: MarketTick) => void;
type StatusListener = (status: "connected" | "reconnecting" | "offline" | "connecting") => void;

interface TrendbarJson {
  volume?: number | string;
  period?: number | string;
  low?: number | string;
  deltaOpen?: number | string;
  deltaClose?: number | string;
  deltaHigh?: number | string;
  utcTimestampInMinutes?: number | string;
}

interface SymbolInfo {
  symbolId: number;
  digits: number;
  name: string;
}

/**
 * One shared browser↔cTrader WebSocket per page: the chart stream and the
 * watchlist both subscribe through it, historical candle requests ride the
 * same connection (paced to the documented 5 req/s cap), and reconnects
 * re-authenticate + re-subscribe transparently.
 */
class CtraderDirectClient {
  private ws: WebSocket | null = null;
  private session: CtraderSession | null = null;
  private connecting: Promise<void> | null = null;
  /** In-flight dial+auth handshake (single-flight). */
  private handshake: Promise<void> | null = null;
  private ready = false;
  private closedByUser = false;
  private paused = false;
  private attempt = 0;
  private msgSeq = 0;
  private pending = new Map<string, PendingRequest>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private lastMessageAt = 0;
  /** Refreshed once per ready session (symbol ids differ per broker). */
  private symbol: SymbolInfo | null = null;
  private symbolsLoading: Promise<SymbolInfo> | null = null;
  /** Chart instrument (set by CtraderDirectStream) + watchlist set. */
  private chartInstrument: string | null = null;
  private watchInstruments = new Set<string>();
  private subscribed = new Set<number>();
  private lastBid = new Map<number, number>();
  private lastAsk = new Map<number, number>();
  private tickListeners = new Set<TickListener>();
  private statusListeners = new Set<StatusListener>();
  /** Serializes historical requests (trendbars/tickdata) to ≤4/s. */
  private historyChain: Promise<void> = Promise.resolve();

  addTickListener(fn: TickListener): () => void {
    this.tickListeners.add(fn);
    return () => this.tickListeners.delete(fn);
  }

  onStatus(fn: StatusListener): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  /** Chart-side subscription (one instrument at a time, hub-style). */
  setChartInstrument(instrument: string | null): void {
    this.chartInstrument = instrument;
    this.syncSubscriptions().catch(() => {});
  }

  /** Watchlist-side subscriptions (small set, coalesced display prices). */
  setWatchInstruments(instruments: readonly string[]): void {
    this.watchInstruments = new Set(instruments);
    this.syncSubscriptions().catch(() => {});
  }

  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    if (paused) {
      this.stopTimers();
      this.closeSocket();
    } else {
      void this.ensureReady(true).catch(() => {});
    }
  }

  /** Resolves once the session is authed and the symbol is resolved. */
  ensureReady(forceSession = false): Promise<void> {
    if (this.ready && this.symbol && !forceSession) return Promise.resolve();
    if (!this.connecting || forceSession) {
      this.connecting = this.open(forceSession).finally(() => {
        this.connecting = null;
      });
    }
    return this.connecting;
  }

  private async open(forceSession: boolean): Promise<void> {
    this.closedByUser = false;
    if (!ctraderDirectConfigured()) {
      throw new Error("cTrader browser-direct is not configured");
    }
    let session: CtraderSession;
    try {
      session = await loadSession(forceSession);
    } catch (err) {
      this.emitStatus("offline");
      throw err;
    }
    // A forced reload with a DIFFERENT token restarts the connection.
    const tokenChanged = this.session && this.session.accessToken !== session.accessToken;
    this.session = session;
    if (!this.ws || tokenChanged || this.paused) {
      this.closeSocket();
      await this.dial(session).catch(async (err) => {
        // The cached token may be stale — retry ONCE with a fresh one.
        if (!forceSession && /token/i.test(err instanceof Error ? err.message : "")) {
          session = await loadSession(true);
          this.session = session;
          await this.dial(session);
        } else {
          throw err;
        }
      });
    }
  }

  private dial(session: CtraderSession): Promise<void> {
    // Single-flight: an in-flight handshake is shared, never doubled.
    if (this.handshake) return this.handshake;
    this.handshake = new Promise((resolve, reject) => {
      this.emitStatus(this.attempt === 0 ? "connecting" : "reconnecting");
      let settled = false;
      let ws: WebSocket;
      try {
        ws = new WebSocket(`wss://${session.host}:${session.port}`);
      } catch (err) {
        reject(err instanceof Error ? err : new Error("WebSocket constructor failed"));
        this.scheduleReconnect();
        return;
      }
      this.ws = ws;
      this.lastMessageAt = Date.now();
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        reject(err);
      };
      ws.addEventListener("open", () => {
        // Handshake continues via the correlated request replies.
        this.startTimers();
        void this.authenticate(session).then(
          () => {
            if (settled) return;
            settled = true;
            resolve();
          },
          (err: unknown) => fail(err instanceof Error ? err : new Error("cTrader auth failed"))
        );
      });
      ws.addEventListener("message", (ev) => {
        this.lastMessageAt = Date.now();
        try {
          this.handleMessage(typeof ev.data === "string" ? ev.data : String(ev.data));
        } catch {
          // malformed frame — ignore without crashing
        }
      });
      ws.addEventListener("close", () => {
        this.ws = null;
        this.ready = false;
        this.symbol = null;
        this.subscribed.clear();
        this.stopTimers();
        this.rejectAllPending("cTrader connection closed");
        for (const fn of this.statusListeners) fn("reconnecting");
        if (!this.closedByUser && !this.paused && !settled) {
          fail(new Error("cTrader connection closed before ready"));
        }
        this.scheduleReconnect();
      });
      ws.addEventListener("error", () => {
        fail(new Error("cTrader WebSocket error"));
      });
    });
    void this.handshake.finally(() => {
      this.handshake = null;
    });
    return this.handshake;
  }

  private async authenticate(session: CtraderSession): Promise<void> {
    await this.request(PT.APP_AUTH_REQ, {
      clientId: session.clientId,
      clientSecret: session.clientSecret,
    });
    await this.request(PT.ACCOUNT_AUTH_REQ, {
      ctidTraderAccountId: num(session.accountId),
      accessToken: session.accessToken,
    });
    this.ready = true;
    this.attempt = 0;
    await this.resolveSymbol();
    await this.syncSubscriptions();
    this.emitStatus("connected");
  }

  /** Symbol list + full record (digits) for the canonical instrument. */
  private async resolveSymbol(): Promise<SymbolInfo> {
    if (this.symbol) return this.symbol;
    if (!this.symbolsLoading) {
      this.symbolsLoading = (async () => {
        const session = this.session!;
        const accountId = num(session.accountId);
        const list = await this.request(PT.SYMBOLS_LIST_REQ, { ctidTraderAccountId: accountId });
        const symbols = Array.isArray(list.symbol) ? (list.symbol as Array<Record<string, unknown>>) : [];
        const enabled = symbols
          .map((s) => ({
            symbolId: num(s.symbolId),
            name: typeof s.symbolName === "string" ? s.symbolName : "",
            enabled: s.enabled !== false,
          }))
          .filter((s) => s.enabled && s.name.length > 0);

        let chosen: { symbolId: number; name: string } | null = null;
        for (const alias of US30_ALIASES) {
          chosen =
            alias === "US30"
              ? (enabled.find((s) => s.name.toUpperCase() === alias) ?? null)
              : (enabled.find((s) => s.name.toUpperCase().startsWith(alias)) ?? null);
          if (chosen) break;
        }
        if (!chosen) throw new Error("cTrader: no US30-like symbol on this broker");

        const byId = await this.request(PT.SYMBOL_BY_ID_REQ, {
          ctidTraderAccountId: accountId,
          symbolId: [chosen.symbolId],
        });
        const full = Array.isArray(byId.symbol) ? (byId.symbol as Array<Record<string, unknown>>) : [];
        const digitsRaw = num(full[0]?.digits);
        const info: SymbolInfo = {
          symbolId: chosen.symbolId,
          digits: digitsRaw > 0 ? digitsRaw : 2,
          name: chosen.name,
        };
        this.symbol = info;
        return info;
      })();
      this.symbolsLoading.catch(() => {
        this.symbolsLoading = null;
      });
    }
    return this.symbolsLoading;
  }

  /** Awaitable symbol info — throws before the session is ready. */
  async symbolInfo(): Promise<SymbolInfo> {
    await this.ensureReady();
    if (!this.symbol) throw new Error("cTrader symbol not resolved");
    return this.symbol;
  }

  /** Numeric ctidTraderAccountId of the loaded session (history requests). */
  sessionAccountId(): string {
    return this.session?.accountId ?? "";
  }

  private async syncSubscriptions(): Promise<void> {
    const info = this.symbol;
    if (!this.ready || !info) return;
    const wanted = new Set<number>();
    const watchWants = [...this.watchInstruments].some(
      (i) => i.toUpperCase() === "US30"
    );
    if (this.chartInstrument && this.chartInstrument.toUpperCase() === "US30") wanted.add(info.symbolId);
    if (watchWants) wanted.add(info.symbolId);

    const toAdd = [...wanted].filter((id) => !this.subscribed.has(id));
    const toRemove = [...this.subscribed].filter((id) => !wanted.has(id));
    const accountId = num(this.session!.accountId);

    if (toAdd.length > 0) {
      await this.request(PT.SUBSCRIBE_SPOTS_REQ, {
        ctidTraderAccountId: accountId,
        symbolId: toAdd,
        subscribeToSpotTimestamp: true,
      });
      for (const id of toAdd) this.subscribed.add(id);
    }
    if (toRemove.length > 0) {
      try {
        await this.request(PT.UNSUBSCRIBE_SPOTS_REQ, {
          ctidTraderAccountId: accountId,
          symbolId: toRemove,
        });
      } catch {
        // unsubscribe failures only leak a little traffic — non-fatal
      }
      for (const id of toRemove) this.subscribed.delete(id);
    }
  }

  private handleMessage(text: string): void {
    let msg: { payloadType?: number; payload?: Record<string, unknown>; clientMsgId?: string };
    try {
      msg = JSON.parse(text) as typeof msg;
    } catch {
      return;
    }
    const payloadType = typeof msg.payloadType === "number" ? msg.payloadType : 0;
    const payload = msg.payload ?? {};

    if (msg.clientMsgId) {
      const p = this.pending.get(msg.clientMsgId);
      if (p) {
        clearTimeout(p.timer);
        this.pending.delete(msg.clientMsgId);
        if (payloadType === PT.OA_ERROR_RES || payloadType === PT.ERROR_RES) {
          p.reject(new Error(errorText(payload)));
        } else {
          p.resolve(payload);
        }
        return;
      }
    }

    switch (payloadType) {
      case PT.HEARTBEAT_EVENT:
        return;
      case PT.SPOT_EVENT:
        this.onSpotEvent(payload);
        return;
      case PT.OA_ERROR_RES:
      case PT.ERROR_RES: {
        const text2 = errorText(payload);
        if (/token/i.test(text2)) {
          // Stale token — refresh from the server and redial once.
          this.ready = false;
          void loadSession(true)
            .then(() => this.ensureReady(true))
            .catch(() => {});
        }
        return;
      }
      case PT.CLIENT_DISCONNECT_EVENT:
      case PT.TOKEN_INVALIDATED_EVENT:
        this.ready = false;
        try {
          this.ws?.close();
        } catch {}
        return;
      default:
        return;
    }
  }

  private onSpotEvent(payload: Record<string, unknown>): void {
    const symbol = this.symbol;
    if (!symbol || num(payload.symbolId) !== symbol.symbolId) return;
    if (payload.bid !== undefined) this.lastBid.set(symbol.symbolId, scalePrice(num(payload.bid), symbol.digits));
    if (payload.ask !== undefined) this.lastAsk.set(symbol.symbolId, scalePrice(num(payload.ask), symbol.digits));
    const bid = this.lastBid.get(symbol.symbolId) ?? null;
    const ask = this.lastAsk.get(symbol.symbolId) ?? null;
    if (bid === null && ask === null) return;
    const mid = bid !== null && ask !== null ? (bid + ask) / 2 : null;
    const tick: MarketTick = {
      instrument: "US30",
      timestamp: payload.timestamp !== undefined ? num(payload.timestamp) : Date.now(),
      bid,
      ask,
      mid,
    };
    for (const fn of this.tickListeners) fn(tick);
  }

  // ── requests ──────────────────────────────────────────────────────────────

  request(payloadType: number, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("cTrader session is not connected"));
    }
    const id = String(++this.msgSeq);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`cTrader request ${payloadType} timed out`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      try {
        ws.send(JSON.stringify({ clientMsgId: id, payloadType, payload }));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error("cTrader send failed"));
      }
    });
  }

  /** Historical request, serialized to respect the documented 5 req/s cap. */
  requestHistorical(payloadType: number, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const run = async (): Promise<Record<string, unknown>> => {
      await this.historyChain.catch(() => {});
      await new Promise((r) => setTimeout(r, HISTORICAL_PACING_MS));
      return this.request(payloadType, payload);
    };
    const next = run();
    this.historyChain = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  // ── timers / lifecycle ────────────────────────────────────────────────────

  private startTimers(): void {
    this.stopTimers();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ payloadType: PT.HEARTBEAT_EVENT, payload: {} }));
        } catch {}
      }
    }, HEARTBEAT_INTERVAL_MS);
    this.watchdogTimer = setInterval(() => {
      if (this.ws && Date.now() - this.lastMessageAt > SILENCE_WATCHDOG_MS) {
        try {
          this.ws.close();
        } catch {}
      }
    }, 15_000);
  }

  private stopTimers(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private closeSocket(): void {
    const ws = this.ws;
    this.ws = null;
    this.ready = false;
    if (ws) {
      try {
        ws.close();
      } catch {}
    }
    this.rejectAllPending("cTrader session closed");
  }

  private rejectAllPending(message: string): void {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error(message));
      this.pending.delete(id);
    }
  }

  private scheduleReconnect(): void {
    if (this.closedByUser || this.paused || this.reconnectTimer) return;
    const wanted = this.chartInstrument !== null || this.watchInstruments.size > 0;
    if (!wanted) {
      this.emitStatus("offline");
      return;
    }
    this.attempt++;
    const exp = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (this.attempt - 1));
    const jitter = (Math.random() * 2 - 1) * 0.2 * exp;
    const delay = Math.max(BACKOFF_BASE_MS, Math.min(BACKOFF_CAP_MS, Math.floor(exp + jitter)));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.ensureReady().catch(() => {});
    }, delay);
  }

  private emitStatus(status: "connected" | "reconnecting" | "offline" | "connecting"): void {
    for (const fn of this.statusListeners) fn(status);
  }
}

function errorText(payload: Record<string, unknown>): string {
  const code = typeof payload.errorCode === "string" ? payload.errorCode : "UNKNOWN";
  const description = typeof payload.description === "string" ? payload.description : "";
  return description ? `${code}: ${description}` : code;
}

/** Shared per-page singleton (chart + watchlist ride one connection). */
const client = new CtraderDirectClient();
export const ctraderDirect = client;

// ── history ──────────────────────────────────────────────────────────────────

function trendbarToCandle(tb: TrendbarJson, digits: number): Candle | null {
  const low = num(tb.low);
  const deltaOpen = num(tb.deltaOpen);
  const deltaClose = num(tb.deltaClose);
  const deltaHigh = num(tb.deltaHigh);
  const minutes = num(tb.utcTimestampInMinutes);
  if (!low || !minutes || minutes <= 0) return null;
  const open = scalePrice(low + deltaOpen, digits);
  const high = scalePrice(low + deltaHigh, digits);
  const lowP = scalePrice(low, digits);
  const close = scalePrice(low + deltaClose, digits);
  return {
    time: minutes * 60,
    open,
    high: Math.max(high, open, close, lowP),
    low: Math.min(lowP, open, close, high),
    close,
  };
}

/**
 * Native trendbar history for timeframes ≥1m, paginated backwards with a
 * `to` cursor (mirrors the server's CtraderRestClient). Volumes (tick
 * counts) feed the Volume Profile sidecar.
 */
async function fetchTrendbars(
  info: SymbolInfo,
  accountId: number,
  timeframe: Timeframe,
  count: number,
  toSec?: number
): Promise<Candle[]> {
  const period = TF_TO_PERIOD[timeframe]!;
  let remaining = count;
  let toMs = toSec !== undefined ? toSec * 1000 : Date.now();
  const collected: Candle[] = [];
  const vols = new Map<number, number>();
  let lastEarliest = Number.POSITIVE_INFINITY;

  for (let batch = 0; batch < MAX_BATCHES && remaining > 0; batch++) {
    const res = await client.requestHistorical(PT.GET_TRENDBARS_REQ, {
      ctidTraderAccountId: accountId,
      period,
      symbolId: info.symbolId,
      toTimestamp: Math.max(0, Math.floor(toMs)),
      count: Math.min(remaining, TRENDBARS_PER_REQ),
    });
    const bars = Array.isArray(res.trendbar) ? (res.trendbar as TrendbarJson[]) : [];
    const candles: Candle[] = [];
    for (const tb of bars) {
      const c = trendbarToCandle(tb, info.digits);
      if (!c) continue;
      candles.push(c);
      const v = num(tb.volume);
      if (Number.isFinite(v) && v > 0) vols.set(c.time, v);
    }
    candles.sort((a, b) => a.time - b.time);
    if (candles.length === 0) break;
    collected.unshift(...candles);
    remaining -= candles.length;
    const earliest = candles[0]!.time;
    if (earliest >= lastEarliest) break;
    lastEarliest = earliest;
    toMs = earliest * 1000 - 1;
    const hasMore = res.hasMore === true || res.hasMore === "true";
    if (!hasMore && candles.length < TRENDBARS_PER_REQ) break;
  }

  const dedup = new Map<number, Candle>();
  for (const c of collected) dedup.set(c.time, c);
  const native = [...dedup.values()].sort((a, b) => a.time - b.time).slice(-count);
  const nativeVols = new Map<number, number>();
  for (const c of native) {
    const v = vols.get(c.time);
    if (v !== undefined) nativeVols.set(c.time, v);
  }
  recordVolumes("US30", timeframe, nativeVols);
  return native;
}

/**
 * 5-second candles from BID tick data for the sub-minute timeframes.
 * Tick timestamps: the FIRST row carries absolute epoch ms, every later
 * row the difference to the previous one (newest-first list).
 * Returns the candles plus per-bucket tick counts (the cTrader convention
 * for volume) so the caller can mirror aggregation into the sidecar.
 */
async function fetchS5FromTicks(
  info: SymbolInfo,
  accountId: number,
  count: number,
  toSec?: number
): Promise<{ candles: Candle[]; vols: Map<number, number> }> {
  const endMs = toSec !== undefined ? toSec * 1000 : Date.now();
  const fromMs = Math.max(0, endMs - count * 5000 - 60_000);
  const rawTicks: Array<{ timeMs: number; priceRaw: number }> = [];
  let cursorTo = endMs;
  let lastOldest = Number.POSITIVE_INFINITY;

  for (let chunk = 0; chunk < MAX_TICK_CHUNKS; chunk++) {
    const res = await client.requestHistorical(PT.GET_TICKDATA_REQ, {
      ctidTraderAccountId: accountId,
      symbolId: info.symbolId,
      type: 1, // BID
      fromTimestamp: fromMs,
      toTimestamp: Math.floor(cursorTo),
    });
    const rows = Array.isArray(res.tickData) ? (res.tickData as Array<Record<string, unknown>>) : [];
    const chunkTicks: Array<{ timeMs: number; priceRaw: number }> = [];
    let prev = 0;
    for (const row of rows) {
      const tickRaw = num(row.tick);
      if (!tickRaw) continue;
      const t = chunkTicks.length === 0 ? num(row.timestamp) : prev - num(row.timestamp);
      if (!t || t <= 0) continue;
      prev = t;
      chunkTicks.push({ timeMs: t, priceRaw: tickRaw });
    }
    if (chunkTicks.length === 0) break;
    rawTicks.push(...chunkTicks);
    // Pagination walks backwards from THIS chunk's oldest tick (docs: max
    // 1 week per request, hasMore chunking).
    const oldest = Math.min(...chunkTicks.map((t) => t.timeMs));
    if (oldest <= fromMs) break;
    const hasMore = res.hasMore === true || res.hasMore === "true";
    if (!hasMore) break;
    if (oldest >= lastOldest) break;
    lastOldest = oldest;
    cursorTo = oldest - 1;
  }

  // Ascending order so each bucket's close is its LATEST tick; the S5
  // volumes feed the Volume Profile sidecar as tick counts.
  rawTicks.sort((a, b) => a.timeMs - b.timeMs);
  const buckets = new Map<number, { candle: Candle; ticks: number }>();
  for (const { timeMs, priceRaw } of rawTicks) {
    const p = scalePrice(priceRaw, info.digits);
    if (!Number.isFinite(p) || p <= 0) continue;
    const time = Math.floor(timeMs / 5000) * 5;
    const entry = buckets.get(time);
    if (!entry) {
      buckets.set(time, { candle: { time, open: p, high: p, low: p, close: p }, ticks: 1 });
    } else {
      if (p > entry.candle.high) entry.candle.high = p;
      if (p < entry.candle.low) entry.candle.low = p;
      entry.candle.close = p;
      entry.ticks++;
    }
  }
  const candles = [...buckets.values()].sort((a, b) => a.candle.time - b.candle.time).slice(-count);
  const vols = new Map<number, number>();
  for (const e of candles) vols.set(e.candle.time, e.ticks);
  return { candles: candles.map((e) => e.candle), vols };
}

export async function fetchCtraderCandles(
  instrument: string,
  timeframe: string,
  count: number,
  toSec?: number
): Promise<Candle[]> {
  if (instrument.toUpperCase() !== "US30") {
    throw new Error(`Not a cTrader instrument: ${instrument}`);
  }
  const info = await client.symbolInfo();
  const accountId = num(client.sessionAccountId());
  const needed = nativeCandlesNeeded(timeframe as Timeframe, count);
  if (TF_TO_PERIOD[timeframe as Timeframe] !== undefined) {
    return fetchTrendbars(info, accountId, timeframe as Timeframe, needed, toSec);
  }
  if (SUB_MINUTE.has(timeframe)) {
    // 5s/10s/15s/30s derive from tick-built S5 candles with the shared
    // aggregation engine — exactly like the OANDA S5-derived timeframes.
    const { candles, vols } = await fetchS5FromTicks(info, accountId, needed, toSec);
    const tfSec = TIMEFRAME_SECONDS[timeframe as Timeframe];
    if (tfSec > 5) {
      // Mirror the candle aggregation in the Volume Profile sidecar (S5
      // tick counts sum into the target buckets).
      const summed = new Map<number, number>();
      for (const [t, v] of vols) {
        const bucket = Math.floor(t / tfSec) * tfSec;
        summed.set(bucket, (summed.get(bucket) ?? 0) + v);
      }
      recordVolumes("US30", timeframe as Timeframe, summed);
      return aggregateCandles(candles, tfSec);
    }
    recordVolumes("US30", timeframe as Timeframe, vols);
    return candles;
  }
  throw new Error(`Timeframe ${timeframe} has no cTrader history source`);
}

// ── live chart stream (MarketStream surface) ────────────────────────────────

/**
 * Same surface as MarketWsClient / OandaDirectStream so the market store
 * swaps it in without any other changes. History always comes from
 * fetchCtraderCandles (no snapshots); live candles aggregate client-side
 * from spot ticks with the shared engine.
 */
export class CtraderDirectStream {
  private handlers: WsHandlers;
  private current: { instrument: string; timeframe: Timeframe } | null = null;
  private aggregator: CandleAggregator | null = null;
  private seedCandle: Candle | null = null;
  private offTick: (() => void) | null = null;
  private offStatus: (() => void) | null = null;
  private closedByUser = false;
  private statusHandler = (s: "connected" | "reconnecting" | "offline" | "connecting"): void => {
    this.handlers.onStatus(s);
  };

  constructor(handlers: WsHandlers) {
    this.handlers = handlers;
  }

  connect(): void {
    this.closedByUser = false;
    this.offStatus ??= client.onStatus(this.statusHandler);
    void client
      .ensureReady()
      .then(() => {
        if (this.current) client.setChartInstrument(this.current.instrument);
      })
      .catch((err: unknown) => {
        this.handlers.onStatus("offline");
        this.handlers.onError(err instanceof Error ? err.message : "cTrader unavailable");
      });
  }

  disconnect(): void {
    this.closedByUser = true;
    this.teardown();
    client.setChartInstrument(null);
    this.handlers.onStatus("offline");
  }

  subscribe(instrument: string, timeframe: Timeframe): void {
    this.closedByUser = false;
    this.teardown();
    this.current = { instrument, timeframe };
    this.aggregator = new CandleAggregator(timeframe, binanceBucketStart);
    if (this.seedCandle) this.aggregator.seed(this.seedCandle);
    this.offStatus ??= client.onStatus(this.statusHandler);
    this.offTick = client.addTickListener((tick) => {
      if (!this.current || tick.instrument !== this.current.instrument) return;
      const result = this.aggregator?.apply(tick);
      if (result) {
        this.handlers.onCandle(instrument, timeframe, result.candle, result.closed !== null);
      }
    });
    void client
      .ensureReady()
      .then(() => {
        client.setChartInstrument(instrument);
      })
      .catch((err: unknown) => {
        this.handlers.onStatus("offline");
        this.handlers.onError(err instanceof Error ? err.message : "cTrader unavailable");
      });
  }

  unsubscribe(): void {
    this.current = null;
    this.aggregator = null;
    this.seedCandle = null;
    this.teardown();
    client.setChartInstrument(null);
    this.handlers.onStatus("offline");
  }

  setPaused(paused: boolean): void {
    client.setPaused(paused);
    if (!paused && this.current && !this.closedByUser) {
      this.handlers.onStatus("connecting");
      void client.ensureReady().catch(() => {});
    }
  }

  /** Prime the aggregator with the freshest history candle. */
  seed(candle: Candle): void {
    this.seedCandle = candle;
    this.aggregator?.seed(candle);
  }

  private teardown(): void {
    if (this.offTick) {
      this.offTick();
      this.offTick = null;
    }
  }
}
