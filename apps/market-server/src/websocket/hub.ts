/**
 * WebSocket hub.
 *
 * - one endpoint (`/ws`), documented JSON protocol (shared package)
 * - validates every inbound frame; malformed input yields a safe error
 *   message — never an exception path that kills the process
 * - one active chart subscription per connection: a new `subscribe` atomically
 *   replaces the previous one (matches how the frontend switches charts)
 * - watchlist: separate `watch` subscription for live prices (many instruments)
 * - fans out aggregated candle events only to matching subscribers
 * - fans out price ticks to watch subscribers
 * - broadcasts upstream market-data status changes to everyone
 */
import type { FastifyInstance } from "fastify";
import { WebSocket, type RawData } from "ws";
import {
  parseClientMessage,
  providerOf,
  type ServerMessage,
  type ConnectionStatus,
  type Timeframe,
} from "@traderkomak/shared";
import type { CandleFeed, CandleEvent } from "../market/candleFeed.js";
import type { OandaStreamClient, UpstreamStatus } from "../oanda/streamClient.js";
import type { BinanceStreamClient } from "../binance/streamClient.js";
import type { Log } from "../logger.js";
import type { MarketTick } from "@traderkomak/shared";

const SNAPSHOT_CANDLES = 300;
const PING_INTERVAL_MS = 30_000;

function keyOf(instrument: string, timeframe: string): string {
  return `${instrument}|${timeframe}`;
}

/** Anything that can retarget its live subscriptions. */
interface ProviderStream {
  setInstruments(symbols: readonly string[]): void;
}

export class MarketHub {
  private readonly connections = new Map<WebSocket, Set<string>>();
  private readonly watchSubs = new Map<WebSocket, Set<string>>();
  /** Connections awaiting a pong since their last ping. */
  private readonly awaitingPong = new Set<WebSocket>();
  private pingTimer: NodeJS.Timeout | null = null;
  private status: UpstreamStatus = "offline";

  constructor(
    private readonly feed: CandleFeed,
    private readonly oanda: ProviderStream,
    private readonly log: Log,
    private readonly binance?: ProviderStream
  ) {}

  setUpstreamStatus(status: UpstreamStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.log.info({ status }, "upstream market-data status changed");
    this.broadcast({ type: "status", status: status satisfies ConnectionStatus });
  }

  register(app: FastifyInstance): void {
    app.get("/ws", { websocket: true }, (socket: WebSocket) => {
      this.handleConnection(socket);
    });
  }

  startPingLoop(): void {
    if (this.pingTimer) return;
    this.pingTimer = setInterval(() => {
      for (const socket of this.connections.keys()) {
        if (this.awaitingPong.has(socket)) {
          this.awaitingPong.delete(socket);
          try {
            socket.terminate();
          } catch {}
          continue;
        }
        this.awaitingPong.add(socket);
        try {
          socket.ping();
        } catch {}
      }
    }, PING_INTERVAL_MS);
    this.pingTimer.unref?.();
  }

  stopPingLoop(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  closeAll(): void {
    for (const socket of this.connections.keys()) {
      try {
        socket.close(1001, "server shutting down");
      } catch {
        try {
          socket.terminate();
        } catch {}
      }
    }
  }

  get clientCount(): number {
    return this.connections.size;
  }

  onCandleEvent(event: CandleEvent): void {
    const key = keyOf(event.instrument, event.timeframe);
    const payload: ServerMessage = {
      type: "candle",
      instrument: event.instrument,
      timeframe: event.timeframe,
      data: event.candle,
      closed: event.closed,
    };
    const text = JSON.stringify(payload);
    for (const [socket, subs] of this.connections) {
      if (!subs.has(key)) continue;
      this.sendRaw(socket, text);
    }
  }

  onPriceTick(tick: MarketTick): void {
    const payload: ServerMessage = {
      type: "price",
      instrument: tick.instrument,
      bid: tick.bid,
      ask: tick.ask,
      mid: tick.mid,
      timestamp: tick.timestamp,
    };
    const text = JSON.stringify(payload);
    for (const [socket, watchSet] of this.watchSubs) {
      if (!watchSet.has(tick.instrument)) continue;
      this.sendRaw(socket, text);
    }
  }

  private handleConnection(socket: WebSocket): void {
    const subs = new Set<string>();
    const watch = new Set<string>();
    this.connections.set(socket, subs);
    this.watchSubs.set(socket, watch);
    this.log.info({ clients: this.clientCount }, "websocket client connected");

    this.send(socket, { type: "status", status: this.status });

    socket.on("message", (raw: RawData) => this.handleMessage(socket, subs, watch, raw));
    socket.on("pong", () => this.awaitingPong.delete(socket));
    socket.on("error", () => {});
    socket.on("close", () => {
      this.awaitingPong.delete(socket);
      this.releaseAll(subs);
      this.connections.delete(socket);
      this.watchSubs.delete(socket);
      this.updateStreamInstruments();
      this.log.info({ clients: this.clientCount }, "websocket client disconnected");
    });
  }

  private handleMessage(socket: WebSocket, subs: Set<string>, watch: Set<string>, raw: RawData): void {
    let text: string;
    try {
      text = typeof raw === "string" ? raw : raw.toString();
    } catch {
      this.send(socket, { type: "error", message: "Unreadable message" });
      return;
    }

    const parsed = parseClientMessage(text);
    if (!parsed.ok) {
      this.send(socket, { type: "error", message: parsed.error });
      return;
    }

    const msg = parsed.message;
    switch (msg.type) {
      case "ping":
        this.send(socket, { type: "pong" });
        return;
      case "unsubscribe":
        this.releaseAll(subs);
        return;
      case "watch": {
        watch.clear();
        for (const inst of msg.instruments) watch.add(inst);
        this.updateStreamInstruments();
        // Send current price snapshot for watched instruments if available (optional)
        return;
      }
      case "subscribe": {
        this.releaseAll(subs);
        this.feed.addSubscriber(msg.instrument, msg.timeframe);
        subs.add(keyOf(msg.instrument, msg.timeframe));
        this.updateStreamInstruments();
        const candles = this.feed.bufferSnapshot(msg.instrument, msg.timeframe, SNAPSHOT_CANDLES);
        this.send(socket, {
          type: "snapshot",
          instrument: msg.instrument,
          timeframe: msg.timeframe,
          candles,
        });
        return;
      }
    }
  }

  private releaseAll(subs: Set<string>): void {
    for (const key of subs) {
      const sep = key.indexOf("|");
      const instrument = key.slice(0, sep);
      const timeframe = key.slice(sep + 1) as Timeframe;
      this.feed.removeSubscriber(instrument, timeframe);
    }
    subs.clear();
    this.updateStreamInstruments();
  }

  private updateStreamInstruments(): void {
    const feedInstruments = this.feed.instrumentUnion();
    const watchInstruments = [...this.watchSubs.values()].flatMap((s) => [...s]);
    const all = [...new Set([...feedInstruments, ...watchInstruments])];

    // Route each instrument to its own provider's stream
    this.oanda.setInstruments(all.filter((i) => providerOf(i) === "oanda"));
    this.binance?.setInstruments(all.filter((i) => providerOf(i) === "binance"));
  }

  private broadcast(message: ServerMessage): void {
    const text = JSON.stringify(message);
    for (const socket of this.connections.keys()) {
      this.sendRaw(socket, text);
    }
  }

  private send(socket: WebSocket, message: ServerMessage): void {
    this.sendRaw(socket, JSON.stringify(message));
  }

  private sendRaw(socket: WebSocket, text: string): void {
    if (socket.readyState !== WebSocket.OPEN) return;
    try {
      socket.send(text);
    } catch {}
  }
}
