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
 *   - admin (CHAT_ADMIN_KEY env) can delete messages, and mute (timed) or
 *     ban (permanent, by nick + IP) chatters — mod state persists.
 */
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ChatMessage, ChatModEntry } from "@traderkomak/shared";
import type { Log } from "../logger.js";

const HISTORY_CAP = 200;
const HISTORY_FILE = "chat-history.json";
const MOD_FILE = "chat-mod.json";
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
  ip: string;
  rateStamps: number[];
}

interface ModState {
  mutes: ChatModEntry[]; // timed
  bans: ChatModEntry[]; // permanent (until lifted)
}

export class ChatRoom {
  private readonly conns = new Map<WebSocket, Conn>();
  private history: ChatMessage[] = [];
  /** Every nick the room has seen — powers the member/offline lists. */
  private readonly known = new Map<string, { lastSeen: number; ip?: string }>();
  private mod: ModState = { mutes: [], bans: [] };
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private modSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;
  private modDirty = false;

  constructor(
    private readonly dataDir: string,
    private readonly adminKey: string,
    private readonly log: Log
  ) {
    this.history = this.loadHistory();
    this.mod = this.loadMod();
    // Seed the member list from the persisted history
    for (const m of this.history) {
      if (m.from) this.known.set(m.from.toLowerCase(), { lastSeen: m.ts });
    }
  }

  register(app: FastifyInstance): void {
    app.get("/chat", { websocket: true }, (socket, req) => {
      const conn: Conn = { socket, nick: null, admin: false, ip: req.ip ?? "", rateStamps: [] };
      // IP bans are enforced before anything else — banned means banned.
      if (this.isBannedIp(conn.ip)) {
        this.safeSend(conn, { type: "error", message: "You are banned from this room" });
        this.log.warn({ ip: conn.ip }, "chat: banned IP rejected");
        setTimeout(() => {
          try {
            socket.close(4003, "banned");
          } catch {}
        }, 50);
        return;
      }
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
    this.flushMod();
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
      case "moderate":
        this.onModerate(conn, String(msg.action ?? ""), String(msg.nick ?? ""), Number(msg.minutes ?? 0));
        return;
    }
  }

  private join(conn: Conn, rawNick: string, adminKey?: string): void {
    const nick = rawNick.trim().replace(/\s+/g, " ").slice(0, NICK_MAX);
    if (nick.length < NICK_MIN) {
      this.safeSend(conn, { type: "error", message: "Nickname must be at least 2 characters" });
      return;
    }
    // Nick bans are enforced at join time
    if (this.isBannedNick(nick)) {
      this.safeSend(conn, { type: "error", message: "You are banned from this room" });
      return;
    }
    conn.nick = nick;
    this.known.set(nick.toLowerCase(), { lastSeen: Math.floor(Date.now() / 1000), ip: conn.ip });
    conn.admin = this.adminKey !== "" && adminKey === this.adminKey;
    this.send(conn, { type: "history", messages: this.history });
    this.sendOnline(conn.socket);
    if (conn.admin) this.sendModState(conn);
    // No join/leave notices — page refreshes would spam the room.
  }

  private onChat(conn: Conn, text: string, img?: string): void {
    if (!conn.nick) return; // must join first
    if (this.isMutedNick(conn.nick)) {
      const m = this.mod.mutes.find((x) => x.nick.toLowerCase() === conn.nick!.toLowerCase());
      const mins = m?.until ? Math.max(1, Math.ceil((m.until - Date.now()) / 60000)) : 1;
      this.safeSend(conn, { type: "error", message: `You are muted (${mins} min left)` });
      return;
    }
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
      owner: conn.admin || undefined,
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

  // ── Moderation ────────────────────────────────────────────────────────

  private onModerate(conn: Conn, action: string, nick: string, minutes: number): void {
    if (!conn.admin) return; // admins only
    const cleanNick = nick.trim().slice(0, NICK_MAX).toLowerCase();
    if (!cleanNick) return;
    const now = Date.now();

    if (action === "mute") {
      const until = now + Math.max(1, Math.min(1440, minutes || 10)) * 60_000;
      this.mod.mutes = this.mod.mutes.filter((m) => m.nick.toLowerCase() !== cleanNick);
      this.mod.mutes.push({ nick: cleanNick, until });
      // Kick the muted user's connection so the mute applies immediately
      this.disconnectNick(cleanNick);
    } else if (action === "ban") {
      this.mod.bans = this.mod.bans.filter((b) => b.nick.toLowerCase() !== cleanNick);
      // record every known IP for this nick — a nick ban alone is bypassable
      const ips = new Set<string>();
      for (const [, c] of this.conns) {
        if (c.nick && c.nick.toLowerCase() === cleanNick) ips.add(c.ip);
      }
      this.mod.bans.push({ nick: cleanNick, ips: [...ips] });
      this.disconnectNick(cleanNick);
    } else if (action === "unmute") {
      this.mod.mutes = this.mod.mutes.filter((m) => m.nick.toLowerCase() !== cleanNick);
    } else if (action === "unban") {
      this.mod.bans = this.mod.bans.filter((b) => b.nick.toLowerCase() !== cleanNick);
    } else {
      return;
    }
    this.schedulePersistMod();
    this.broadcastModState();
    this.log.info({ by: conn.nick, action, nick: cleanNick }, "chat moderation");
  }

  private disconnectNick(nick: string): void {
    for (const [, c] of this.conns) {
      if (c.nick && c.nick.toLowerCase() === nick.toLowerCase()) {
        this.safeSend(c, { type: "error", message: "You have been moderated" });
        try {
          c.socket.close(4002, "moderated");
        } catch {}
        this.conns.delete(c.socket);
      }
    }
    this.broadcastOnline();
  }

  private isMutedNick(nick: string): boolean {
    const n = nick.toLowerCase();
    return this.mod.mutes.some((m) => m.nick.toLowerCase() === n && (m.until ?? 0) > Date.now());
  }

  private isBannedNick(nick: string): boolean {
    const n = nick.toLowerCase();
    return this.mod.bans.some((b) => b.nick.toLowerCase() === n);
  }

  private isBannedIp(ip: string): boolean {
    if (!ip) return false;
    return this.mod.bans.some((b) => (b.ips ?? []).includes(ip));
  }

  private broadcastModState(): void {
    for (const [, c] of this.conns) {
      if (c.admin) this.sendModState(c);
    }
  }

  private sendModState(conn: Conn): void {
    const mutes = this.mod.mutes.filter((m) => (m.until ?? 0) > Date.now());
    this.safeSend(conn, { type: "mod", mutes, bans: this.mod.bans });
  }

  // ── Plumbing ──────────────────────────────────────────────────────────

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

  /** Online nick list (sorted) + the full member roster for admins. */
  private onlinePayload(forAdmin: boolean): Record<string, unknown> {
    const nicks = [...new Set([...this.conns.values()].map((c) => c.nick).filter((n): n is string => !!n))].sort((a, b) => a.localeCompare(b));
    const payload: Record<string, unknown> = { type: "online", count: nicks.length, nicks };
    if (forAdmin) {
      const onlineSet = new Set(nicks.map((n) => n.toLowerCase()));
      const known = [...this.known.entries()]
        .map(([nick, v]) => ({ nick, lastSeen: v.lastSeen, online: onlineSet.has(nick) }))
        .sort((a, b) => b.lastSeen - a.lastSeen)
        .slice(0, 100);
      payload.known = known;
    }
    return payload;
  }

  private broadcastOnline(): void {
    const nicks = [...new Set([...this.conns.values()].map((c) => c.nick).filter((n): n is string => !!n))].sort((a, b) => a.localeCompare(b));
    const base = JSON.stringify({ type: "online", count: nicks.length, nicks });
    const adminPayload = JSON.stringify(this.onlinePayload(true));
    for (const [, c] of this.conns) {
      try {
        if (c.socket.readyState === c.socket.OPEN) c.socket.send(c.admin ? adminPayload : base);
      } catch {}
    }
  }

  private sendOnline(socket: WebSocket): void {
    const c = this.conns.get(socket);
    try {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(this.onlinePayload(!!c?.admin)));
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

  private loadMod(): ModState {
    try {
      const raw = readFileSync(join(this.dataDir, MOD_FILE), "utf8");
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.mutes) || !Array.isArray(parsed.bans)) return { mutes: [], bans: [] };
      return { mutes: parsed.mutes, bans: parsed.bans };
    } catch {
      return { mutes: [], bans: [] };
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

  private schedulePersistMod(): void {
    this.modDirty = true;
    if (this.modSaveTimer) return;
    this.modSaveTimer = setTimeout(() => {
      this.modSaveTimer = null;
      if (!this.modDirty) return;
      this.modDirty = false;
      this.flushMod();
    }, 1000);
    this.modSaveTimer.unref?.();
  }

  private flushMod(): void {
    try {
      mkdirSync(this.dataDir, { recursive: true });
      writeFileSync(join(this.dataDir, MOD_FILE), JSON.stringify(this.mod));
    } catch (err) {
      this.log.warn({ err: err instanceof Error ? err.message : "unknown" }, "chat mod save failed");
    }
  }
}
