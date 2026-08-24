import type { MarketTick } from "@traderkomak/shared";

function wsUrl(): string {
  const configured = (import.meta.env.VITE_MARKET_WS_URL as string | undefined)?.trim();
  if (configured && configured.length > 0) return configured;
  const host = window.location.hostname || "localhost";
  const port = window.location.port;
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  if (port === "5173") return `${proto}//${host}:5173/ws`;
  if (!port || port === "80" || port === "443") return `${proto}//${host}/ws`;
  return `${proto}//${window.location.host}/ws`;
}

export class WatchWsClient {
  private ws: WebSocket | null = null;
  private instruments: string[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closedByUser = false;
  private attempt = 0;

  constructor(private onPrice: (tick: MarketTick) => void) {}

  setInstruments(instruments: string[]) {
    this.instruments = [...instruments];
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendWatch();
    }
  }

  connect() {
    this.closedByUser = false;
    this.attempt = 0;
    this.dial();
  }

  disconnect() {
    this.closedByUser = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }
  }

  private dial() {
    if (this.closedByUser) return;
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl());
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.addEventListener("open", () => {
      this.attempt = 0;
      this.sendWatch();
    });
    ws.addEventListener("message", (ev) => {
      try {
        const msg = JSON.parse(typeof ev.data === "string" ? ev.data : ev.data.toString()) as Record<string, unknown>;
        if (msg.type === "price" && typeof msg.instrument === "string") {
          const tick: MarketTick = {
            instrument: msg.instrument,
            timestamp: typeof msg.timestamp === "number" ? msg.timestamp : Date.now(),
            bid: typeof msg.bid === "number" ? msg.bid : null,
            ask: typeof msg.ask === "number" ? msg.ask : null,
            mid: typeof msg.mid === "number" ? msg.mid : null,
          };
          this.onPrice(tick);
        }
      } catch {}
    });
    ws.addEventListener("close", () => {
      this.ws = null;
      if (this.closedByUser) return;
      this.scheduleReconnect();
    });
    ws.addEventListener("error", () => {});
  }

  private sendWatch() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify({ type: "watch", instruments: this.instruments }));
    } catch {}
  }

  private scheduleReconnect() {
    if (this.closedByUser) return;
    if (this.reconnectTimer) return;
    this.attempt++;
    const base = 1000;
    const cap = 15000;
    const exp = Math.min(cap, base * 2 ** (this.attempt - 1));
    const jitter = (Math.random() * 2 - 1) * 0.2 * exp;
    const delay = Math.max(base, Math.min(cap, Math.floor(exp + jitter)));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.dial();
    }, delay);
  }
}
