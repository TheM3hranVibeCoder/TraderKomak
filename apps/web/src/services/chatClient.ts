/**
 * Community chat WebSocket client (connects to the /chat endpoint on the
 * market server). Mirrors MarketWsClient's reconnect/backoff behavior but
 * with the chat protocol. Messages are plain JSON frames.
 */
import type { ChatMessage, ChatServerMessage } from "@traderkomak/shared";

export type ChatStatus = "connected" | "connecting" | "reconnecting" | "offline";

/** Ping cadence and the silence window after which the socket is dead. */
const PING_MS = 15_000;
const STALE_MS = 45_000;

export interface ChatClientHandlers {
  onHistory: (messages: ChatMessage[]) => void;
  onChat: (message: ChatMessage) => void;
  onDeleted: (id: string) => void;
  onSystem: (text: string, ts: number) => void;
  onOnline: (count: number, nicks: string[], known: { nick: string; lastSeen: number; online: boolean }[]) => void;
  onStatus: (status: ChatStatus) => void;
  onError: (message: string) => void;
  onMod: (mutes: { nick: string; until?: number }[], bans: { nick: string; ips?: string[] }[]) => void;
  onMuted: (until: number) => void;
  onUnmuted: () => void;
  onRateLimit: (waitMs: number) => void;
  /** Admin: details for a nick. */
  onUserInfo?: (info: { nick: string; lastIp: string | null; online: boolean; country: string | null }) => void;
  /** User: a direct message from the admin. */
  onAdminDm?: (dm: { id: string; text: string }) => void;
  /** Admin: DM receipt update (offline = could not deliver). */
  onDmStatus?: (s: { id: string; nick: string; read: boolean; offline: boolean }) => void;
  /** User: show the join-Telegram popup. */
  onTgPopup?: (id: string) => void;
  /** Admin: who joined / closed the Telegram popup. */
  onTgResult?: (r: { nick: string; action: "join" | "close" }) => void;
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
  /** Messages typed while the socket is down/reconnecting — flushed on join. */
  private outbox: Record<string, unknown>[] = [];
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private lastServerMsgAt = 0;

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
    this.stopPing();
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

  /** One message carrying an image and/or caption text, optionally
   *  replying to another message (server resolves the quote excerpt). */
  sendChat(text: string | undefined, img: string | undefined, replyId?: string): void {
    this.send({ type: "chat", text, img, reply: replyId ? { id: replyId } : undefined });
  }

  deleteMessage(id: string): void {
    this.send({ type: "delete", id });
  }

  moderate(action: "mute" | "ban" | "unmute" | "unban", nick: string, minutes?: number): void {
    this.send({ type: "moderate", action, nick, minutes });
  }

  requestUserInfo(nick: string): void {
    this.send({ type: "userinfo", nick });
  }
  sendAdminDm(nick: string, text: string, id: string): void {
    this.send({ type: "admin_dm", nick, text, id });
  }
  sendDmRead(id: string): void {
    this.send({ type: "admin_dm_read", id });
  }
  sendTgBroadcast(id: string): void {
    this.send({ type: "tg_broadcast", id });
  }
  sendTgResult(id: string, action: "join" | "close"): void {
    this.send({ type: "tg_result", id, action });
  }

  private send(payload: Record<string, unknown>): void {
    const ws = this.ws;
    // A stale socket reports OPEN but the connection underneath is dead —
    // sending into it loses the message silently. Treat it like a down
    // socket: hold the message and flush it once the reconnect joins.
    const stale = Date.now() - this.lastServerMsgAt > STALE_MS;
    if (!ws || ws.readyState !== WebSocket.OPEN || !this.joined || stale) {
      this.outbox.push(payload);
      if (this.outbox.length > 20) this.outbox.shift();
      if (stale) this.ensureFresh(); // start healing right away
      return;
    }
    try {
      ws.send(JSON.stringify(payload));
    } catch {}
  }

  private flushOutbox(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.joined) return;
    const pending = this.outbox.splice(0, this.outbox.length);
    for (const payload of pending) {
      try {
        this.ws.send(JSON.stringify(payload));
      } catch {
        this.outbox.unshift(payload); // put it back on failure
      }
    }
  }

  /** Detect half-open sockets: dead NAT/proxy connections keep readyState=OPEN
   *  forever, so sends "succeed" into the void. Ping and force-close on silence. */
  private startPing(): void {
    this.stopPing();
    this.lastServerMsgAt = Date.now();
    this.pingTimer = setInterval(() => {
      this.sendRaw({ type: "ping" });
      // 3 missed ping intervals without any server traffic = dead socket
      if (Date.now() - this.lastServerMsgAt > STALE_MS) {
        try {
          this.ws?.close(4000, "stale");
        } catch {}
      }
    }, PING_MS);
  }

  /**
   * Heals a half-open socket immediately instead of waiting for the ping
   * watchdog: called when the tab becomes visible/focused again — browsers
   * throttle background timers, so the connection may have silently died
   * while the user was away.
   */
  /** Force a fresh dial + join even when the socket looks healthy. Used by
   *  the ban probe: a rejected join leaves the socket OPEN and "fresh", so
   *  ensureFresh() would never re-send the join after an unban. */
  rejoin(): void {
    this.closedByUser = false;
    this.attempt = 0;
    this.joined = false;
    if (this.ws) {
      try { this.ws.close(4000, "rejoin"); } catch {}
      this.ws = null;
    }
    this.dial();
  }

  ensureFresh(): void {
    if (
      this.ws &&
      this.ws.readyState === WebSocket.OPEN &&
      Date.now() - this.lastServerMsgAt > STALE_MS
    ) {
      try {
        this.ws.close(4000, "stale");
      } catch {}
    }
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  /** Send bypassing the outbox — used for protocol frames (ping). */
  private sendRaw(payload: Record<string, unknown>): void {
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
      this.lastServerMsgAt = Date.now();
      this.startPing();
      // Empty nick = observer join (read-only, feeds the unread badge)
      if (this.joinNick !== null) {
        this.joined = true;
        this.sendRaw({ type: "join", nick: this.joinNick, adminKey: this.adminKey });
        this.flushOutbox();
      }
    });

    ws.addEventListener("message", () => {
      this.lastServerMsgAt = Date.now();
    });
    ws.addEventListener("message", (ev) => this.handle(ev.data));
    ws.addEventListener("close", (ev) => {
      this.stopPing();
      this.ws = null;
      this.joined = false;
      // 4003 = banned (pre-connect IP ban) — stop the auto-reconnect loop;
      // the ban probe's rejoin() revives the socket after an unban.
      if (ev.code === 4003) {
        this.handlers.onError("You are banned from this room");
        this.handlers.onStatus("offline");
        this.closedByUser = true;
        this.ws = null;
        this.joined = false;
        return;
      }
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
        // A delivered history means the join was accepted — we're connected.
        this.handlers.onStatus("connected");
        this.flushOutbox();
        break;
      case "mod":
        this.handlers.onMod(msg.mutes ?? [], msg.bans ?? []);
        break;
      case "muted":
        this.handlers.onMuted(msg.until);
        break;
      case "unmuted":
        this.handlers.onUnmuted();
        break;
      case "ratelimit":
        this.handlers.onRateLimit(msg.waitMs);
        break;
      case "chat":
        // owner flag must survive — live viewers need the OWNER badge too
        this.handlers.onChat({ id: msg.id, from: msg.from, text: msg.text, img: msg.img, ts: msg.ts, owner: msg.owner });
        break;
      case "deleted":
        this.handlers.onDeleted(msg.id);
        break;
      case "system":
        this.handlers.onSystem(msg.text, msg.ts);
        break;
      case "online":
        this.handlers.onOnline(msg.count, (msg.nicks as string[]) ?? [], (msg.known as { nick: string; lastSeen: number; online: boolean }[]) ?? []);
        break;
      case "error":
        this.handlers.onError(msg.message ?? "Chat error");
        break;
      case "userinfo":
        this.handlers.onUserInfo?.(msg as unknown as { nick: string; lastIp: string | null; online: boolean; country: string | null });
        break;
      case "admin_dm":
        this.handlers.onAdminDm?.({ id: msg.id, text: msg.text });
        break;
      case "dm_status":
        this.handlers.onDmStatus?.(msg as unknown as { id: string; nick: string; read: boolean; offline: boolean });
        break;
      case "tg_popup":
        this.handlers.onTgPopup?.(msg.id);
        break;
      case "tg_result":
        this.handlers.onTgResult?.({ nick: msg.nick, action: msg.action });
        break;
    }
  }
}
