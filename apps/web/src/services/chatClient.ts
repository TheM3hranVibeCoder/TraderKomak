/**
 * Community chat WebSocket client (connects to the /chat endpoint on the
 * market server). Mirrors MarketWsClient's reconnect/backoff behavior but
 * with the chat protocol. Messages are plain JSON frames.
 */
import type { ChatMessage, ChatServerMessage } from "@traderkomak/shared";

export type ChatStatus = "connected" | "connecting" | "reconnecting" | "offline";

export interface ChatClientHandlers {
  onHistory: (messages: ChatMessage[]) => void;
  onChat: (message: ChatMessage) => void;
  onDeleted: (id: string) => void;
  onSystem: (text: string, ts: number) => void;
  onOnline: (count: number) => void;
  onStatus: (status: ChatStatus) => void;
  onError: (message: string) => void;
}

function chatUrl(): string {
  const raw = import.meta.env.VITE_MARKET_WS_URL as string | undefined;
  let base: string;
  if (raw && raw.trim()) {
    base = raw.trim().replace(/\/ws\/?$/, ""); // strip the candle-stream path
  } else {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const port = location.port;
    base = port === "5173" ? `${proto}//${location.hostname}:5173` : `${proto}//${location.host}`;
  }
  return `${base}/chat`;
}

export class ChatClient {
  private ws: WebSocket | null = null;
  private handlers: ChatClientHandlers;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closedByUser = false;
  private joinNick: string | null = null;
  private adminKey: string | undefined;
  private joined = false;

  constructor(handlers: ChatClientHandlers) {
    this.handlers = handlers;
  }

  connect(nick: string, adminKey?: string): void {
    this.joinNick = nick;
    this.adminKey = adminKey;
    this.closedByUser = false;
    this.handlers.onStatus("connecting");
    this.dial();
  }

  disconnect(): void {
    this.closedByUser = true;
    this.clearTimer();
    if (this.ws) {
      try {
        this.ws.close(1000, "client left");
      } catch {}
      this.ws = null;
    }
    this.handlers.onStatus("offline");
  }

  sendText(text: string): void {
    this.send({ type: "chat", text });
  }

  sendImage(dataUrl: string): void {
    this.send({ type: "chat", img: dataUrl });
  }

  deleteMessage(id: string): void {
    this.send({ type: "delete", id });
  }

  private send(payload: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify(payload));
    } catch {}
  }

  private dial(): void {
    if (this.closedByUser) return;
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) return;

    let ws: WebSocket;
    try {
      ws = new WebSocket(chatUrl());
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    this.handlers.onStatus("connecting");

    ws.addEventListener("open", () => {
      this.attempt = 0;
      if (this.joinNick) {
        this.send({ type: "join", nick: this.joinNick, adminKey: this.adminKey });
        this.joined = true;
      }
    });

    ws.addEventListener("message", (ev) => this.handle(ev.data));
    ws.addEventListener("close", () => {
      this.ws = null;
      this.joined = false;
      if (this.closedByUser) return;
      this.handlers.onStatus("reconnecting");
      this.scheduleReconnect();
    });
    ws.addEventListener("error", () => {
      /* close follows */
    });
  }

  private scheduleReconnect(): void {
    if (this.closedByUser || this.reconnectTimer) return;
    this.attempt++;
    const base = 1500;
    const cap = 20000;
    const exp = Math.min(cap, base * 2 ** (this.attempt - 1));
    const delay = Math.max(base, Math.floor(exp + (Math.random() * 2 - 1) * 0.2 * exp));
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

  private handle(raw: unknown): void {
    let text: string;
    if (typeof raw === "string") text = raw;
    else if (raw instanceof Blob) {
      void raw.text().then((t) => this.handle(t));
      return;
    } else return;

    let msg: ChatServerMessage;
    try {
      msg = JSON.parse(text) as ChatServerMessage;
    } catch {
      return;
    }
    if (!msg || typeof msg.type !== "string") return;

    switch (msg.type) {
      case "history":
        this.joined = true;
        this.handlers.onHistory(msg.messages);
        break;
      case "chat":
        this.handlers.onChat({ id: msg.id, from: msg.from, text: msg.text, img: msg.img, ts: msg.ts });
        break;
      case "deleted":
        this.handlers.onDeleted(msg.id);
        break;
      case "system":
        this.handlers.onSystem(msg.text, msg.ts);
        break;
      case "online":
        this.handlers.onOnline(msg.count);
        break;
      case "error":
        this.handlers.onError(msg.message ?? "Chat error");
        break;
    }
  }
}
