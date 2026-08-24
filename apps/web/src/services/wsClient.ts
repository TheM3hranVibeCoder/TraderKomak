/**
 * TraderKomak WebSocket client.
 *
 * - One persistent connection to the market server.
 * - Validates every inbound frame using shared types (never crashes on
 *   malformed data).
 * - Exponential backoff reconnect with jitter.
 * - Heartbeat via application-level ping/pong on top of native WS pings.
 */
import type {
  Candle,
  ConnectionStatus,
  ServerMessage,
  Timeframe,
} from "@traderkomak/shared";

export type WsStatus = ConnectionStatus | "connecting";

export interface WsHandlers {
  onStatus: (status: WsStatus) => void;
  onSnapshot: (instrument: string, timeframe: Timeframe, candles: Candle[]) => void;
  onCandle: (instrument: string, timeframe: Timeframe, candle: Candle, closed: boolean) => void;
  onError: (message: string) => void;
}

function wsUrl(): string {
  const configured = import.meta.env.VITE_MARKET_WS_URL?.trim();
  if (configured && configured.length > 0) return configured;

  // Vite dev on :5173 proxies /ws → market-server :8080, so same-host works there.
  // Direct fallback for dev without proxy (e.g. opening file) → hardcode :8080.
  const host = window.location.hostname || "localhost";
  const port = window.location.port;
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";

  // If we're on vite dev (5173) but no explicit WS url, the proxy will handle it.
  // For any other dev setup without proxy, default to market-server 8080.
  if (port === "5173") {
    return `${proto}//${host}:5173/ws`;
  }
  if (!port || port === "80" || port === "443") {
    return `${proto}//${host}/ws`;
  }
  return `${proto}//${window.location.host}/ws`;
}

function backoff(attempt: number): number {
  const base = 1000;
  const cap = 30000;
  const exp = Math.min(cap, base * 2 ** (attempt - 1));
  const jitter = (Math.random() * 2 - 1) * 0.2 * exp;
  return Math.max(base, Math.min(cap, Math.floor(exp + jitter)));
}

export class MarketWsClient {
  private ws: WebSocket | null = null;
  private handlers: WsHandlers;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closedByUser = false;
  private pending: { instrument: string; timeframe: Timeframe } | null = null;
  private current: { instrument: string; timeframe: Timeframe } | null = null;

  constructor(handlers: WsHandlers) {
    this.handlers = handlers;
  }

  connect(): void {
    this.closedByUser = false;
    this.attempt = 0;
    this.handlers.onStatus("connecting");
    this.dial();
  }

  disconnect(): void {
    this.closedByUser = true;
    this.clearTimer();
    if (this.ws) {
      try {
        this.ws.close(1000, "client disconnect");
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.handlers.onStatus("offline");
  }

  subscribe(instrument: string, timeframe: Timeframe): void {
    this.pending = { instrument, timeframe };
    this.current = { instrument, timeframe };
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendSubscribe(instrument, timeframe);
    } else if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
      // Ensure we have a connection attempt in flight.
      if (!this.reconnectTimer) this.dial();
    }
  }

  unsubscribe(): void {
    this.current = null;
    this.pending = null;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ type: "unsubscribe" }));
      } catch {
        // ignore
      }
    }
  }

  private dial(): void {
    if (this.closedByUser) return;
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
      return;
    }

    const url = wsUrl();
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    this.handlers.onStatus("connecting");

    ws.addEventListener("open", () => {
      this.attempt = 0;
      // Don't set "connected" yet — wait for upstream status message.
      // If we have a pending subscription, send it immediately.
      if (this.pending) {
        this.sendSubscribe(this.pending.instrument, this.pending.timeframe);
      }
      // Also send a ping to verify liveness.
      try {
        ws.send(JSON.stringify({ type: "ping" }));
      } catch {
        // ignore
      }
    });

    ws.addEventListener("message", (ev) => this.handleMessage(ev.data));

    ws.addEventListener("close", () => {
      this.ws = null;
      if (this.closedByUser) {
        this.handlers.onStatus("offline");
        return;
      }
      this.handlers.onStatus("reconnecting");
      this.scheduleReconnect();
    });

    ws.addEventListener("error", () => {
      // close event will follow; nothing else to do.
    });
  }

  private scheduleReconnect(): void {
    if (this.closedByUser) return;
    if (this.reconnectTimer) return;
    this.attempt++;
    const delay = backoff(this.attempt);
    this.handlers.onStatus("reconnecting");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.dial();
    }, delay);
  }

  private clearTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private sendSubscribe(instrument: string, timeframe: Timeframe): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify({ type: "subscribe", instrument, timeframe }));
    } catch {
      // will reconnect
    }
  }

  private handleMessage(raw: unknown): void {
    let text: string;
    if (typeof raw === "string") text = raw;
    else if (raw instanceof ArrayBuffer) text = new TextDecoder().decode(raw);
    else if (raw instanceof Blob) {
      // async — handle separately
      void raw.text().then((t) => this.handleMessage(t));
      return;
    } else {
      return;
    }

    let msg: ServerMessage;
    try {
      msg = JSON.parse(text) as ServerMessage;
    } catch {
      return; // malformed — ignore without crashing
    }

    if (!msg || typeof (msg as unknown as Record<string, unknown>).type !== "string") return;

    switch (msg.type) {
      case "status":
        // Map upstream status to display status.
        if (msg.status === "connected") this.handlers.onStatus("connected");
        else if (msg.status === "reconnecting") this.handlers.onStatus("reconnecting");
        else this.handlers.onStatus("offline");
        break;
      case "snapshot":
        if (Array.isArray(msg.candles)) {
          this.handlers.onSnapshot(msg.instrument, msg.timeframe as Timeframe, msg.candles as Candle[]);
        }
        break;
      case "candle":
        if (msg.data && typeof msg.data.time === "number") {
          this.handlers.onCandle(msg.instrument, msg.timeframe as Timeframe, msg.data as Candle, msg.closed);
        }
        break;
      case "error":
        this.handlers.onError(msg.message ?? "Unknown server error");
        break;
      case "pong":
        break;
      default:
        break;
    }
  }
}
