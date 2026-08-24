/**
 * Binance live stream — one aggTrade WebSocket per symbol, managed as a set.
 *
 *   wss://stream.binance.com:9443/ws/<symbol>@aggTrade
 *   → { e:"aggTrade", s:"BTCUSDT", p:"43000.10", T:1699… }
 *   → MarketTick { instrument, timestamp:T, bid:null, ask:null, mid:p }
 *
 * Same surface as OandaStreamClient (tick/status events + setInstruments)
 * so app.ts wiring stays symmetric. Auto-reconnect with capped jittered
 * backoff per connection, silence watchdog, no duplicate sockets.
 */
import { EventEmitter } from "node:events";
import WebSocket from "ws";
import type { MarketTick } from "@traderkomak/shared";
import type { Log } from "../logger.js";

export type UpstreamStatus = "connected" | "reconnecting" | "offline";

const SILENCE_WATCHDOG_MS = 90_000;
const BASE_BACKOFF_MS = 1_000;
const CAP_BACKOFF_MS = 30_000;

interface StreamEvents {
  tick: (tick: MarketTick) => void;
  status: (status: UpstreamStatus) => void;
}

interface Conn {
  ws: WebSocket | null;
  attempt: number;
  reconnectTimer: NodeJS.Timeout | null;
  watchdogTimer: NodeJS.Timeout | null;
  removed: boolean; // user unsubscribed while socket was down
}

export class BinanceStreamClient extends EventEmitter {
  private readonly conns = new Map<string, Conn>();
  private readonly connectedCount = { n: 0 };
  private readonly reconnectingCount = { n: 0 };
  private lastStatus: UpstreamStatus = "offline";

  constructor(
    private readonly cfg: { streamUrl: string },
    private readonly log: Log
  ) {
    super();
  }

  override on<K extends keyof StreamEvents>(event: K, listener: StreamEvents[K]): this {
    return super.on(event, listener);
  }

  /** Adds/removes per-symbol sockets to match the desired set exactly. */
  setInstruments(symbols: readonly string[]): void {
    const desired = new Set(symbols.map((s) => s.toUpperCase()));

    for (const [sym, conn] of this.conns) {
      if (!desired.has(sym)) {
        conn.removed = true;
        this.teardown(sym, conn);
        this.conns.delete(sym);
      }
    }
    for (const sym of desired) {
      if (!this.conns.has(sym)) {
        this.conns.set(sym, { ws: null, attempt: 0, reconnectTimer: null, watchdogTimer: null, removed: false });
        this.connect(sym);
      }
    }
    this.emitStatus();
  }

  async stopAll(): Promise<void> {
    for (const [sym, conn] of this.conns) {
      conn.removed = true;
      this.teardown(sym, conn);
    }
    this.conns.clear();
    this.emitStatus();
  }

  // ── internals ───────────────────────────────────────────────────────────

  private connect(sym: string): void {
    const conn = this.conns.get(sym);
    if (!conn || conn.ws || conn.removed) return;

    const url = `${this.cfg.streamUrl}/ws/${sym.toLowerCase()}@aggTrade`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.scheduleReconnect(sym, conn);
      return;
    }
    conn.ws = ws;

    ws.on("open", () => {
      conn.attempt = 0;
      this.log.info({ symbol: sym }, "binance stream connected");
      this.connectedCount.n++;
      this.emitStatus();
      this.resetWatchdog(sym, conn);
    });

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as Record<string, unknown>;
        if (msg.e !== "aggTrade") return; // ignore bookTicker etc. if combined
        const price = parseFloat(String(msg.p));
        const ts = Number(msg.T);
        if (!Number.isFinite(price) || !Number.isFinite(ts)) return;
        this.emit("tick", {
          instrument: String(msg.s ?? sym).toUpperCase(),
          timestamp: ts,
          bid: null,
          ask: null,
          mid: price,
        } satisfies MarketTick);
      } catch {
        /* malformed line — drop */
      }
    });

    ws.on("pong", () => this.resetWatchdog(sym, conn));

    ws.on("error", () => {
      /* 'close' always follows */
    });

    ws.on("close", () => {
      this.clearWatchdog(conn);
      if (conn.ws === ws) conn.ws = null;
      if (conn.removed || !this.conns.has(sym)) return;
      this.log.warn({ symbol: sym }, "binance stream interrupted");
      this.scheduleReconnect(sym, conn);
    });
  }

  private scheduleReconnect(sym: string, conn: Conn): void {
    if (conn.reconnectTimer || conn.removed) return;
    conn.attempt++;
    const exp = Math.min(CAP_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (conn.attempt - 1));
    const delay = Math.max(BASE_BACKOFF_MS, Math.floor(exp + (Math.random() * 2 - 1) * 0.2 * exp));
    this.log.info({ symbol: sym, attempt: conn.attempt, delayMs: delay }, "binance reconnect scheduled");
    conn.reconnectTimer = setTimeout(() => {
      conn.reconnectTimer = null;
      this.connect(sym);
    }, delay);
    conn.reconnectTimer.unref?.();
    this.emitStatus();
  }

  private resetWatchdog(sym: string, conn: Conn): void {
    this.clearWatchdog(conn);
    conn.watchdogTimer = setTimeout(() => {
      this.log.warn({ symbol: sym }, "binance silence timeout — recycling");
      conn.ws?.terminate();
    }, SILENCE_WATCHDOG_MS);
    conn.watchdogTimer.unref?.();
  }

  private clearWatchdog(conn: Conn): void {
    if (conn.watchdogTimer) {
      clearTimeout(conn.watchdogTimer);
      conn.watchdogTimer = null;
    }
  }

  private teardown(_sym: string, conn: Conn): void {
    if (conn.reconnectTimer) clearTimeout(conn.reconnectTimer);
    this.clearWatchdog(conn);
    try {
      conn.ws?.close(1000, "unsubscribed");
    } catch {
      try {
        conn.ws?.terminate();
      } catch {}
    }
    conn.ws = null;
  }

  /** Aggregated provider status derived from per-socket states. */
  private emitStatus(): void {
    let connected = 0;
    let reconnecting = 0;
    for (const [, c] of this.conns) {
      if (c.ws && c.ws.readyState === WebSocket.OPEN) connected++;
      else if (!c.removed) reconnecting++;
    }
    let next: UpstreamStatus = "offline";
    if (connected > 0) next = "connected";
    else if (reconnecting > 0) next = "reconnecting";

    // Only meaningful when at least one Binance symbol is requested
    if (this.conns.size === 0) next = "offline";
    void this.connectedCount;
    void this.reconnectingCount;

    if (next !== this.lastStatus) {
      this.lastStatus = next;
      this.emit("status", next);
    }
  }
}
