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
import type { RawData, WebSocket } from "ws";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import type { ChatMessage, ChatModEntry } from "@traderkomak/shared";
import type { Log } from "../logger.js";

const HISTORY_CAP = 200;
const HISTORY_FILE = "chat-history.json";
const MOD_FILE = "chat-mod.json";
const KNOWN_FILE = "chat-known.json";
const TEXT_MAX = 400;
const IMG_MAX_CHARS = 280_000; // ~210KB image
const RATE_INTERVAL_MS = 15_000; // one message per 15s per user
const NICK_MIN = 2;
const NICK_MAX = 20;

interface Conn {
  socket: WebSocket;
  nick: string | null;
  admin: boolean;
  ip: string;
  lastChatAt: number;
  /** Last reaction-toggle timestamp (flood guard). */
  lastReactAt: number;
  /** Telegram popup ids delivered to THIS connection — receipts accepted
   *  only from sockets that saw the popup (anti-spoof). */
  tgPopups: Set<string>;
  /** Set false right before each heartbeat ping; a pong (or any frame)
   *  sets it true. Dead phone browsers never pong → reaped below. */
  alive: boolean;
}

function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Country lookup for admin user-info (free ip-api, cached per IP/day). */
const geoCache = new Map<string, { country: string | null; at: number }>();
async function geoLookup(ip: string): Promise<string | null> {
  const hit = geoCache.get(ip);
  if (hit && Date.now() - hit.at < 86_400_000) return hit.country;
  let country: string | null = null;
  try {
    // HTTPS geolocation — the old ip-api free tier was plain HTTP, which
    // leaked chatter IPs to a third party in cleartext.
    const res = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`);
    if (res.ok) {
      const j = (await res.json()) as { success?: boolean; country?: string };
      if (j.success) country = j.country ?? null;
    }
  } catch {}
  geoCache.set(ip, { country, at: Date.now() });
  return country;
}

interface ModState {
  mutes: ChatModEntry[]; // timed
  bans: ChatModEntry[]; // permanent (until lifted)
}

export class ChatRoom {
  private readonly conns = new Map<WebSocket, Conn>();
  /** Direct messages awaiting a Read receipt: id → admin socket + target. */
  private readonly pendingDms = new Map<string, { socket: WebSocket; nick: string }>();
  /** Presence heartbeat timer (reaps dead sockets). */
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private history: ChatMessage[] = [];
  /** Message id → image data URL, served via GET /api/chat-img/:id with
   *  immutable cache headers. Keeps multi-MB base64 out of every join's
   *  history frame (12s+ connects on slow links). */
  private readonly imgStore = new Map<string, string>();
  /** Every nick the room has seen — powers the member/offline lists. */
  private readonly known = new Map<string, { lastSeen: number; ip?: string }>();
  private mod: ModState = { mutes: [], bans: [] };
  /** When Upstash Redis env vars are set, history + mod state persist
   *  there — surviving Render free-tier restarts and sleep cycles that
   *  wipe the ephemeral disk. Without them, a local file is used. */
  private readonly redisUrl = process.env.UPSTASH_REDIS_REST_URL ?? "";
  private readonly redisToken = process.env.UPSTASH_REDIS_REST_TOKEN ?? "";
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private modSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;
  private modDirty = false;

  constructor(
    private readonly dataDir: string,
    private readonly adminKey: string,
    private readonly log: Log,
    /** Reserved nickname — only admin-key joins may claim it. */
    private readonly ownerNick: string = ""
  ) {
    this.history = this.loadHistory();
    this.mod = this.loadMod();
    this.rebuildImgStore();
    // Members persist INDEPENDENTLY of chat history: history is capped at
    // 200 messages, so without this file, users whose messages aged out
    // silently vanished from the roster/admin panel.
    for (const [nick, v] of this.loadKnown()) this.known.set(nick, v);
    // Heartbeat: closing a phone browser can leave a half-open TCP socket
    // that never fires "close" — without this the roster shows ghosts
    // "online" for hours. Every 30s ping everyone; browsers pong at the
    // protocol level automatically. Two missed rounds → terminate.
    this.heartbeat = setInterval(() => {
      for (const [, c] of this.conns) {
        if (!c.alive) {
          try { c.socket.terminate(); } catch {}
          continue;
        }
        c.alive = false;
        try { c.socket.ping(); } catch {}
      }
    }, 30_000);
    this.heartbeat.unref?.();
    // Seed the member list from the persisted history
    for (const m of this.history) {
      if (m.from) this.known.set(m.from.toLowerCase(), { lastSeen: m.ts });
    }
    // Cloud persistence (Upstash REST): pulls the latest history once it
    // arrives. Only applies when the local file had nothing — fresh
    // messages typed in the meantime always win.
    if (this.useRedis) {
      void this.pullFromRedis().then((remote) => {
        if (remote && this.history.length === 0) {
          this.history = remote.chat;
          this.rebuildImgStore();
          this.mod = remote.mod;
          // Member roster persists too (nick → last seen + known IP)
          for (const k of remote.known) {
            this.known.set(k.nick.toLowerCase(), { lastSeen: k.lastSeen, ip: k.ips?.[0] });
          }
          for (const m of this.history) {
            if (m.from) this.known.set(m.from.toLowerCase(), { lastSeen: m.ts });
          }
          this.log.info({ messages: this.history.length, members: this.known.size }, "chat restored from redis");
        }
      });
    }
  }

  private get useRedis(): boolean {
    return this.redisUrl !== "" && this.redisToken !== "";
  }

  private async redisSet(key: string, value: string): Promise<void> {
    try {
      await fetch(`${this.redisUrl}/set/${key}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.redisToken}` },
        body: value,
      });
    } catch (err) {
      this.log.warn({ err: err instanceof Error ? err.message : "unknown" }, "redis set failed");
    }
  }

  private async redisGet(key: string): Promise<string | null> {
    try {
      const res = await fetch(`${this.redisUrl}/get/${key}`, {
        headers: { Authorization: `Bearer ${this.redisToken}` },
      });
      const json = (await res.json()) as { result?: string | null };
      return typeof json.result === "string" ? json.result : null;
    } catch {
      return null;
    }
  }

  private async pullFromRedis(): Promise<{ chat: ChatMessage[]; mod: ModState; known: { nick: string; lastSeen: number; ips?: string[] }[] } | null> {
    const chatRaw = await this.redisGet("chat:history");
    const modRaw = await this.redisGet("chat:mod");
    const knownRaw = await this.redisGet("chat:known");
    if (!chatRaw) return null;
    try {
      const chat = JSON.parse(chatRaw) as ChatMessage[];
      if (!Array.isArray(chat)) return null;
      let mod: ModState = { mutes: [], bans: [] };
      if (modRaw) {
        try {
          const parsed = JSON.parse(modRaw) as ModState;
          if (Array.isArray(parsed.mutes) && Array.isArray(parsed.bans)) mod = parsed;
        } catch {}
      }
      let known: { nick: string; lastSeen: number; ips?: string[] }[] = [];
      if (knownRaw) {
        try {
          const parsed = JSON.parse(knownRaw);
          if (Array.isArray(parsed)) known = parsed;
        } catch {}
      }
      return { chat, mod, known };
    } catch {
      return null;
    }
  }

  register(app: FastifyInstance): void {
    // Chat photos: the history/broadcast frames carry only the message id —
    // the actual bytes are fetched here once and then served from the
    // browser's immutable cache (ids never repeat), so joins stay light.
    app.get<{ Params: { id: string } }>("/api/chat-img/:id", (request, reply) => {
      const img = this.getChatImg(String(request.params.id ?? "").slice(0, 64));
      if (!img) return reply.code(404).send({ error: { code: "NOT_FOUND" } });
      reply
        .header("Content-Type", img.type)
        .header("Cache-Control", "public, max-age=31536000, immutable")
        .send(img.buffer);
    });
    app.get("/chat", { websocket: true }, (socket, req) => {
      const conn: Conn = { socket, nick: null, admin: false, ip: req.ip ?? "", lastChatAt: 0, lastReactAt: 0, tgPopups: new Set(), alive: true };
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
      // Any sign of life proves the socket is real
      socket.on("pong", () => { conn.alive = true; });
      socket.on("message", (data: RawData) => {
        conn.alive = true;
        void data;
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
      case "chat": {
        const r = msg.reply as Record<string, unknown> | undefined;
        const replyId = r && typeof r.id === "string" ? r.id.slice(0, 64) : undefined;
        this.onChat(conn, String(msg.text ?? ""), typeof msg.img === "string" ? msg.img : undefined, replyId);
        return;
      }
      case "react":
        this.onReact(conn, String(msg.id ?? ""), msg.reaction);
        return;
      case "delete":
        this.onDelete(conn, String(msg.id ?? ""));
        return;
      case "moderate":
        this.onModerate(conn, String(msg.action ?? ""), String(msg.nick ?? ""), Number(msg.minutes ?? 0));
        return;
      case "userinfo":
        this.onUserInfo(conn, String(msg.nick ?? ""));
        return;
      case "admin_dm":
        this.onAdminDm(
          conn,
          String(msg.nick ?? ""),
          String(msg.text ?? ""),
          String(msg.id ?? ""),
          typeof msg.img === "string" ? msg.img : undefined
        );
        return;
      case "admin_dm_read":
        this.onDmRead(conn, String(msg.id ?? ""));
        return;
      case "tg_broadcast":
        this.onTgBroadcast(conn, String(msg.id ?? ""));
        return;
      case "tg_result":
        this.onTgResult(conn, String(msg.id ?? ""), String(msg.action ?? ""));
        return;
    }
  }

  private join(conn: Conn, rawNick: string, adminKey?: string): void {
    const nick = rawNick.trim().replace(/\s+/g, " ").slice(0, NICK_MAX);
    if (nick.length < NICK_MIN) {
      // Empty nick = read-only observer: receives history and live messages
      // (so the unread badge counts for visitors who haven't picked a nick
      // yet) but is not a member, stays out of the roster and cannot chat.
      if (rawNick.trim() === "") {
        this.send(conn, { type: "history", messages: this.history.map((m) => this.toWire(m)) });
        this.sendOnline(conn.socket);
        return;
      }
      this.safeSend(conn, { type: "error", message: "Nickname must be at least 2 characters" });
      return;
    }
    // Nick bans are enforced at join time
    if (this.isBannedNick(nick)) {
      this.safeSend(conn, { type: "error", message: "You are banned from this room" });
      return;
    }
    // The owner's nickname is reserved: a regular visitor cannot claim it
    // (any case spelling) — only a join carrying the admin key can.
    // Constant-time comparison (SHA-256 digests) — the key gates all
    // moderation, so even a theoretical timing side channel is worth the
    // three lines.
    const isAdminKey =
      this.adminKey !== "" &&
      typeof adminKey === "string" &&
      safeEqual(adminKey, this.adminKey);
    if (!isAdminKey && this.ownerNick && nick.toLowerCase() === this.ownerNick.toLowerCase()) {
      this.safeSend(conn, { type: "error", message: "This nickname is reserved" });
      this.log.warn({ ip: conn.ip, nick }, "chat: reserved nickname rejected");
      return;
    }
    conn.nick = nick;
    this.known.set(nick.toLowerCase(), { lastSeen: Math.floor(Date.now() / 1000), ip: conn.ip });
    this.schedulePersist();
    conn.admin = isAdminKey;
    this.send(conn, { type: "history", messages: this.history });
    // Broadcast the fresh roster — otherwise a refreshed client never
    // re-appears online for everyone else (join only told THEM).
    this.broadcastOnline();
    // Tell muted users they can read but not chat (with the exact lift time)
    if (this.isMutedNick(nick)) {
      const m = this.mod.mutes.find((x) => x.nick.toLowerCase() === nick.toLowerCase());
      if (m?.until) this.safeSend(conn, { type: "muted", until: m.until });
    }
    this.sendOnline(conn.socket);
    if (conn.admin) this.sendModState(conn);
    // No join/leave notices — page refreshes would spam the room.
  }

  /** Keep the data URL for GET /api/chat-img/:id — the wire form carries
   *  only the id, so history frames stay tiny on slow links. */
  private storeImg(m: ChatMessage): void {
    if (m.img && m.id) this.imgStore.set(m.id, m.img);
  }

  private rebuildImgStore(): void {
    this.imgStore.clear();
    for (const m of this.history) this.storeImg(m);
  }

  /** Wire form of a stored message: the inline data URL is replaced by the
   *  message id (the image itself is served, and browser-cached, via
   *  /api/chat-img/:id). */
  private toWire(m: ChatMessage): ChatMessage {
    if (!m.img) return m;
    const { img: _img, ...rest } = m;
    return { ...rest, imgId: m.id };
  }

  /** Backs GET /api/chat-img/:id — null when the id is unknown. */
  getChatImg(id: string): { buffer: Buffer; type: string } | null {
    const dataUrl = this.imgStore.get(id);
    if (!dataUrl) return null;
    const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s.exec(dataUrl);
    if (!match) return null;
    try {
      return { type: match[1]!, buffer: Buffer.from(match[2]!, "base64") };
    } catch {
      return null;
    }
  }

  /** Telegram-style reactions: one per user per message, same kind again
   *  clears it. Stored ON the history message, so persistence (file +
   *  redis), history frames and deletion cleanup all come for free. */
  private onReact(conn: Conn, rawId: string, rawReaction: unknown): void {
    if (!conn.nick) return; // observers can't react
    if (this.isMutedNick(conn.nick)) return; // muted = read-only
    // Flood guard: reaction toggles are cheap but must not be spammable
    const now = Date.now();
    if (conn.lastReactAt && now - conn.lastReactAt < 150) return;
    conn.lastReactAt = now;

    const kind =
      rawReaction === "like" || rawReaction === "dislike" || rawReaction === "heart" ? rawReaction : null;
    const m = this.history.find((x) => x.id === rawId.slice(0, 64));
    if (!m) return;

    if (kind === null) {
      if (!m.reactions || !(conn.nick in m.reactions)) return; // nothing to clear
      delete m.reactions[conn.nick];
      if (Object.keys(m.reactions).length === 0) delete m.reactions;
    } else {
      if (m.reactions?.[conn.nick] === kind) return; // idempotent re-set
      if (!m.reactions) m.reactions = {};
      m.reactions[conn.nick] = kind;
    }
    this.schedulePersist();
    this.broadcast({ type: "reactions", id: m.id, nick: conn.nick, reaction: kind });
  }

  private onChat(conn: Conn, text: string, img?: string, replyId?: string): void {
    if (!conn.nick) return; // must join first
    if (this.isMutedNick(conn.nick)) {
      const m = this.mod.mutes.find((x) => x.nick.toLowerCase() === conn.nick!.toLowerCase());
      if (m?.until) this.safeSend(conn, { type: "muted", until: m.until });
      return;
    }
    // Cooldown: one message per 15s — the client shows the wait timer.
    // The room owner/moderator is exempt.
    const now = Date.now();
    if (!conn.admin) {
      const wait = conn.lastChatAt ? RATE_INTERVAL_MS - (now - conn.lastChatAt) : 0;
      if (wait > 0) {
        this.safeSend(conn, { type: "ratelimit", waitMs: wait });
        return;
      }
      conn.lastChatAt = now;
    }

    const cleanText = text.replace(/\s+/g, " ").trim().slice(0, TEXT_MAX);
    const cleanImg = this.sanitizeImage(img);
    if (!cleanText && !cleanImg) return;

    // Reply quote: resolve the referenced message server-side and store a
    // small excerpt so every client can render the quote from history.
    let reply: ChatMessage["reply"];
    if (replyId) {
      const q = this.history.find((m) => m.id === replyId);
      if (q) reply = { id: q.id, from: q.from, text: q.text?.slice(0, 80), img: q.img ? true : undefined };
    }

    const message: ChatMessage = {
      id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      from: conn.nick,
      text: cleanText || undefined,
      img: cleanImg,
      ts: Math.floor(now / 1000),
      owner: conn.admin || undefined,
      reply,
    };
    this.history.push(message);
    this.storeImg(message);
    if (this.history.length > HISTORY_CAP) {
      this.history.splice(0, this.history.length - HISTORY_CAP);
      const keep = new Set(this.history.map((m) => m.id));
      for (const id of this.imgStore.keys()) {
        if (!keep.has(id)) this.imgStore.delete(id);
      }
    }
    this.schedulePersist();
    this.broadcast({ type: "chat", ...this.toWire(message) });
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
      // Kick so the mute applies immediately — the reconnect shows the mute banner
      this.disconnectNick(cleanNick, "You have been muted");
    } else if (action === "ban") {
      this.mod.bans = this.mod.bans.filter((b) => b.nick.toLowerCase() !== cleanNick);
      // record every known IP for this nick — a nick ban alone is bypassable
      const ips = new Set<string>();
      for (const [, c] of this.conns) {
        if (c.nick && c.nick.toLowerCase() === cleanNick) ips.add(c.ip);
      }
      this.mod.bans.push({ nick: cleanNick, ips: [...ips] });
      this.disconnectNick(cleanNick, "You have been banned from the room");
    } else if (action === "unmute") {
      this.mod.mutes = this.mod.mutes.filter((m) => m.nick.toLowerCase() !== cleanNick);
      // Notify the unmuted user live so their input re-enables
      for (const [, c] of this.conns) {
        if (c.nick && c.nick.toLowerCase() === cleanNick) this.safeSend(c, { type: "unmuted" });
      }
    } else if (action === "unban") {
      this.mod.bans = this.mod.bans.filter((b) => b.nick.toLowerCase() !== cleanNick);
    } else {
      return;
    }
    this.schedulePersistMod();
    this.broadcastModState();
    this.log.info({ by: conn.nick, action, nick: cleanNick }, "chat moderation");
  }

  /* ── Admin tools: user info, direct messages, telegram broadcast ── */

  private broadcastAdmins(payload: Record<string, unknown>): void {
    for (const [, c] of this.conns) {
      if (c.admin) this.safeSend(c, payload);
    }
  }

  private connectedIps(nick: string): string[] {
    const ips = new Set<string>();
    for (const [, c] of this.conns) {
      if (c.nick && c.nick.toLowerCase() === nick.toLowerCase()) ips.add(c.ip);
    }
    return [...ips];
  }

  private async onUserInfo(conn: Conn, nick: string): Promise<void> {
    if (!conn.admin) return;
    const clean = nick.trim().slice(0, NICK_MAX);
    if (!clean) return;
    const entry = this.known.get(clean.toLowerCase());
    // Last known IP: live connection first, else the roster record.
    const lastIp = this.connectedIps(clean)[0] ?? entry?.ip ?? null;
    const country = lastIp ? await geoLookup(lastIp) : null;
    this.safeSend(conn, { type: "userinfo", nick: clean, lastIp, online: this.connectedIps(clean).length > 0, country });
  }

  private onAdminDm(conn: Conn, nick: string, text: string, id: string, img?: string): void {
    if (!conn.admin || !id) return;
    const cleanNick = nick.trim().slice(0, NICK_MAX);
    const cleanText = text.replace(/\s+/g, " ").trim().slice(0, 500);
    const cleanImg = this.sanitizeImage(img);
    if (!cleanNick || (!cleanText && !cleanImg)) return;
    let delivered = false;
    for (const [, c] of this.conns) {
      if (c.nick && c.nick.toLowerCase() === cleanNick.toLowerCase() && c.socket.readyState === c.socket.OPEN) {
        this.safeSend(c, { type: "admin_dm", id, text: cleanText || undefined, img: cleanImg });
        delivered = true;
        // remember where to deliver the Read receipt
        this.pendingDms.set(id, { socket: conn.socket, nick: cleanNick });
        break;
      }
    }
    if (!delivered) this.safeSend(conn, { type: "dm_status", id, nick: cleanNick, read: false, offline: true });
  }

  private onDmRead(user: Conn, id: string): void {
    const pending = this.pendingDms.get(id);
    if (!pending) return;
    // Only the ACTUAL recipient can mark a DM read — an observer who saw
    // the id in a broadcast must not forge receipts.
    if (!user.nick || user.nick.toLowerCase() !== pending.nick.toLowerCase()) return;
    this.pendingDms.delete(id);
    for (const [, c] of this.conns) {
      if (c.socket === pending.socket) {
        this.safeSend(c, { type: "dm_status", id, nick: user.nick ?? "", read: true, offline: false });
        break;
      }
    }
  }

  private onTgBroadcast(conn: Conn, id: string): void {
    if (!conn.admin || !id) return;
    for (const [, c] of this.conns) {
      // every signed-in member except admins themselves
      if (c.nick && !c.admin && c.socket.readyState === c.socket.OPEN) {
        this.safeSend(c, { type: "tg_popup", id });
        c.tgPopups.add(id);
      }
    }
  }

  private onTgResult(user: Conn, id: string, action: string): void {
    if (!user.nick || !id) return;
    if (action !== "join" && action !== "close") return;
    // Only accept results from sockets that actually RECEIVED this popup.
    if (!user.tgPopups.has(id)) return;
    user.tgPopups.delete(id);
    this.broadcastAdmins({ type: "tg_result", nick: user.nick, id, action });
  }

  private disconnectNick(nick: string, reason = "You have been moderated"): void {
    for (const [, c] of this.conns) {
      if (c.nick && c.nick.toLowerCase() === nick.toLowerCase()) {
        this.safeSend(c, { type: "error", message: reason });
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

  private loadKnown(): Map<string, { lastSeen: number; ip?: string }> {
    const out = new Map<string, { lastSeen: number; ip?: string }>();
    try {
      const raw = JSON.parse(readFileSync(join(this.dataDir, KNOWN_FILE), "utf8")) as
        Array<{ nick?: unknown; lastSeen?: unknown; ip?: unknown }>;
      if (Array.isArray(raw)) {
        for (const k of raw) {
          if (typeof k.nick === "string" && typeof k.lastSeen === "number") {
            out.set(k.nick.toLowerCase(), { lastSeen: k.lastSeen, ip: typeof k.ip === "string" ? k.ip : undefined });
          }
        }
      }
    } catch {}
    return out;
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
      const knownList = [...this.known.entries()].map(([nick, v]) => ({ nick, lastSeen: v.lastSeen, ip: v.ip }));
      writeFileSync(join(this.dataDir, KNOWN_FILE), JSON.stringify(knownList));
    } catch (err) {
      this.log.warn({ err: err instanceof Error ? err.message : "unknown" }, "chat history save failed");
    }
    if (this.useRedis) {
      void this.redisSet("chat:history", JSON.stringify(this.history));
      const known = [...this.known.entries()].map(([nick, v]) => ({
        nick,
        lastSeen: v.lastSeen,
        ips: v.ip ? [v.ip] : [],
      }));
      void this.redisSet("chat:known", JSON.stringify(known));
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
    if (this.useRedis) void this.redisSet("chat:mod", JSON.stringify(this.mod));
  }
}
