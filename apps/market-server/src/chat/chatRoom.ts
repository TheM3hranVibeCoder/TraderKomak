/**
 * Community chat room.
 *
 * A public WebSocket room on /chat where visitors talk to each other,
 * share chart screenshots and post trade ideas. Runs on the same server
 * as the candle stream — one deploy, own domain, no third party.
 *
 * Safety rails (server-side, non-negotiable):
 *   - nickname required to join (2–20 chars, trimmed)
 *   - rate limit: max 5 messages per 10s per connection
 *   - text ≤ 400 chars; images accepted ONLY as compressed data URLs
 *     (png/jpeg/webp, ≤ 280KB) — arbitrary URLs are never forwarded
 *   - history capped at the newest 200 messages, persisted to disk so it
 *     survives server restarts
 *   - admin (CHAT_ADMIN_KEY env) can delete messages
 */
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ChatMessage } from "@traderkomak/shared";
import type { Log } from "../logger.js";

const HISTORY_CAP = 200;
const HISTORY_FILE = "chat-history.json";
const TEXT_MAX = 400;
const IMG_MAX_CHARS = 280_000; // ~210KB image
const RATE_WINDOW_MS = 10_000;
const RATE_MAX = 5;
const NICK_MIN = 2;
const NICK_MAX = 20;

interface Conn {
  socket: WebSocket;
  nick: string | null;
  admin: boolean;
  rateStamps: number[];
}

export class ChatRoom {
  private readonly conns = new Map<WebSocket, Conn>();
  private history: ChatMessage[] = [];
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;

  constructor(
    private readonly dataDir: string,
    private readonly adminKey: string,
    private readonly log: Log
  ) {
    this.history = this.loadHistory();
  }

  register(app: FastifyInstance): void {
    app.get("/chat", { websocket: true }, (socket, req) => {
      const conn: Conn = { socket, nick: null, admin: false, rateStamps: [] };
      this.conns.set(socket, conn);
      this.sendOnline(socket);
      this.log.info({ ip: req.ip, conns: this.conns.size }, "chat connected");

      socket.on("message", (raw: Buffer) => {
        try {
          this.handle(conn, JSON.parse(String(raw)));
        } catch {
          /* malformed frame — drop */
        }
      });

      socket.on("close", () => {
        const nick = conn.nick;
        this.conns.delete(socket);
        this.broadcastOnline();
        if (nick) this.log.info({ nick, conns: this.conns.size }, "chat left");
      });
    });
  }

  closeAll(): void {
    for (const [socket] of this.conns) {
      try {
        socket.close(1001, "server shutdown");
      } catch {}
    }
    this.conns.clear();
    this.flush();
  }

  private handle(conn: Conn, msg: Record<string, unknown>): void {
    switch (msg.type) {
      case "ping":
        this.safeSend(conn, { type: "pong" });
        return;
      case "join":
        this.join(conn, String(msg.nick ?? ""), typeof msg.adminKey === "string" ? msg.adminKey : undefined);
        return;
      case "chat":
        this.onChat(conn, String(msg.text ?? ""), typeof msg.img === "string" ? msg.img : undefined);
        return;
      case "delete":
        this.onDelete(conn, String(msg.id ?? ""));
        return;
    }
  }

  private join(conn: Conn, rawNick: string, adminKey?: string): void {
    const nick = rawNick.trim().replace(/\s+/g, " ").slice(0, NICK_MAX);
    if (nick.length < NICK_MIN) {
      this.safeSend(conn, { type: "error", message: "Nickname must be at least 2 characters" });
      return;
    }
    conn.nick = nick;
    conn.admin = this.adminKey !== "" && adminKey === this.adminKey;
    this.send(conn, { type: "history", messages: this.history });
    this.sendOnline(conn.socket);
    this.broadcast({ type: "system", text: `${nick} joined the room`, ts: Math.floor(Date.now() / 1000) });
  }

  private onChat(conn: Conn, text: string, img?: string): void {
    if (!conn.nick) return; // must join first
    // Rate limit
    const now = Date.now();
    conn.rateStamps = conn.rateStamps.filter((t) => now - t < RATE_WINDOW_MS);
    if (conn.rateStamps.length >= RATE_MAX) {
      this.safeSend(conn, { type: "error", message: "Slow down — too many messages" });
      return;
    }
    conn.rateStamps.push(now);

    const cleanText = text.replace(/\s+/g, " ").trim().slice(0, TEXT_MAX);
    const cleanImg = this.sanitizeImage(img);
    if (!cleanText && !cleanImg) return;

    const message: ChatMessage = {
      id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      from: conn.nick,
      text: cleanText || undefined,
      img: cleanImg,
      ts: Math.floor(now / 1000),
    };
    this.history.push(message);
    if (this.history.length > HISTORY_CAP) this.history.splice(0, this.history.length - HISTORY_CAP);
    this.schedulePersist();
    this.broadcast({ type: "chat", ...message });
  }

  private onDelete(conn: Conn, id: string): void {
    if (!conn.admin) return; // admins only
    const idx = this.history.findIndex((m) => m.id === id);
    if (idx === -1) return;
    this.history.splice(idx, 1);
    this.schedulePersist();
    this.broadcast({ type: "deleted", id });
  }

  /** Only compressed raster images as data URLs are accepted — never remote URLs. */
  private sanitizeImage(img?: string): string | undefined {
    if (!img) return undefined;
    if (img.length > IMG_MAX_CHARS) return undefined;
    return /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/.test(img) ? img : undefined;
  }

  private send(conn: Conn, payload: Record<string, unknown>): void {
    this.safeSend(conn, payload);
  }

  private safeSend(conn: Conn, payload: Record<string, unknown>): void {
    try {
      if (conn.socket.readyState === conn.socket.OPEN) conn.socket.send(JSON.stringify(payload));
    } catch {}
  }

  private broadcastOnline(): void {
    const payload = { type: "online", count: this.conns.size };
    for (const [socket] of this.conns) {
      try {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
      } catch {}
    }
  }

  private sendOnline(socket: WebSocket): void {
    try {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type: "online", count: this.conns.size }));
    } catch {}
  }

  private broadcast(payload: Record<string, unknown>): void {
    for (const [socket] of this.conns) {
      try {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
      } catch {}
    }
  }

  private loadHistory(): ChatMessage[] {
    try {
      const raw = readFileSync(join(this.dataDir, HISTORY_FILE), "utf8");
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (m) => m && typeof m.id === "string" && typeof m.from === "string" && typeof m.ts === "number"
      );
    } catch {
      return [];
    }
  }

  /** Debounced disk write — a busy room must not hammer the disk. */
  private schedulePersist(): void {
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      if (!this.dirty) return;
      this.dirty = false;
      this.flush();
    }, 2000);
    this.saveTimer.unref?.();
  }

  private flush(): void {
    try {
      mkdirSync(this.dataDir, { recursive: true });
      writeFileSync(join(this.dataDir, HISTORY_FILE), JSON.stringify(this.history));
    } catch (err) {
      this.log.warn({ err: err instanceof Error ? err.message : "unknown" }, "chat history save failed");
    }
  }
}
