import { defineStore } from "pinia";
import { ref } from "vue";
import type { ChatMessage, ChatReactionKind } from "@traderkomak/shared";
import { ChatClient, type ChatStatus } from "@/services/chatClient";
import { supabase, supabaseReady } from "@/services/supabase";

const NICK_KEY = "tk-chat-nick";
const ADMIN_KEY = "tk-chat-admin";
const OPEN_KEY = "tk-chat-open";
/** Epoch seconds of the last chat message this user has seen. */
const LASTSEEN_KEY = "tk-chat-lastseen";
const BANNED_KEY = "tk-chat-banned";

export const useChatStore = defineStore("chat", () => {
  const messages = ref<ChatMessage[]>([]);
  const online = ref(0);
  const status = ref<ChatStatus>("offline");
  const nick = ref<string>(localStorage.getItem(NICK_KEY) ?? "");
  const isAdmin = ref<boolean>(!!localStorage.getItem(ADMIN_KEY));
  const open = ref<boolean>(localStorage.getItem(OPEN_KEY) === "1");
  const error = ref<string | null>(null);
  const mutes = ref<{ nick: string; until?: number }[]>([]);
  const bans = ref<{ nick: string; ips?: string[] }[]>([]);
  const rawOnline = ref<string[]>([]);
  const rawKnown = ref<{ nick: string; lastSeen: number; online: boolean }[]>([]);
  /** Usernames that exist in Supabase profiles — Google-signed-in users.
   *  Legacy pick-a-nickname users are not in there, so they are filtered
   *  out of the roster/members/admin lists. */
  const validNicks = ref<Set<string>>(new Set());
  const onlineNicks = ref<string[]>([]);
  const knownNicks = ref<{ nick: string; lastSeen: number; online: boolean }[]>([]);

  /** Only filter once the Supabase usernames have actually loaded —
   *  an empty set must never blank the roster at startup. */
  let validNicksLoaded = false;
  function applyNickFilter(): void {
    if (!validNicksLoaded) {
      onlineNicks.value = rawOnline.value;
      knownNicks.value = rawKnown.value;
      return;
    }
    onlineNicks.value = rawOnline.value.filter((n) => validNicks.value.has(n.toLowerCase()));
    knownNicks.value = rawKnown.value.filter((k) => validNicks.value.has(k.nick.toLowerCase()));
  }

  async function refreshValidNicks(): Promise<void> {
    if (!supabaseReady) return;
    try {
      const { data, error } = await supabase().from("profiles").select("username");
      if (error) return;
      validNicks.value = new Set((data ?? []).map((r) => String(r.username).toLowerCase()));
      validNicksLoaded = true;
      applyNickFilter();
    } catch {}
  }
  void refreshValidNicks();
  setInterval(() => void refreshValidNicks(), 5 * 60_000);
  /** Epoch ms when this user's mute lifts (0 = not muted). */
  const mutedUntil = ref<number>(0);
  /** Epoch ms when the 15s chat cooldown lifts (0 = can send now). */
  const rateWaitUntil = ref<number>(0);
  /** Set when the server rejects/boots this user for a ban. Persists so the
   *  banned screen survives refreshes until the ban is lifted. */
  const banned = ref<boolean>(localStorage.getItem(BANNED_KEY) === "1");
  /** Epoch ms when the ban was first seen on this device (for the stats UI). */
  const bannedAt = ref<number>(Number(localStorage.getItem("tk-chat-banned-at")) || 0);
  /** Unread messages while the panel is closed + the ts of the first one
   *  (opening the panel jumps straight to it). */
  const unread = ref<number>(0);
  const firstUnseenTs = ref<number>(0);
  /** Message reactions: messageId → { nick → kind }. Server echoes are the
   *  authority; the sender applies optimistically for instant feedback. */
  const reactions = ref<Record<string, Record<string, ChatReactionKind>>>({});

  function applyReaction(id: string, reactionNick: string, kind: ChatReactionKind | null): void {
    const cur = { ...(reactions.value[id] ?? {}) };
    if (kind) cur[reactionNick] = kind;
    else delete cur[reactionNick];
    if (Object.keys(cur).length === 0) {
      if (!(id in reactions.value)) return;
      const next = { ...reactions.value };
      delete next[id];
      reactions.value = next;
      return;
    }
    reactions.value = { ...reactions.value, [id]: cur };
  }

  /** Telegram toggle: same kind again clears, otherwise set/switch. */
  function react(id: string, kind: ChatReactionKind): void {
    if (!nick.value || !client) return;
    const mine = reactions.value[id]?.[nick.value];
    const next = mine === kind ? null : kind;
    applyReaction(id, nick.value, next); // optimistic; server echo is idempotent
    client.sendReaction(id, next);
  }
  /** Last message ts this user has seen (persisted, so history loaded at
   *  page-open can be split into seen vs unseen). */
  let lastSeenTs = Number(localStorage.getItem(LASTSEEN_KEY)) || 0;

  function markSeen(upTo: number): void {
    if (upTo <= lastSeenTs) return;
    lastSeenTs = upTo;
    localStorage.setItem(LASTSEEN_KEY, String(Math.floor(upTo)));
  }

let client: ChatClient | null = null;
let clientAdminKey: string | undefined;
let healListenersAdded = false;

/** Browsers throttle background-tab timers and the OS/relay can drop idle
 *  sockets, so a chat socket can die while the user is away. On becoming
 *  visible/focused/online, reconnect IMMEDIATELY (skip the backoff) so the
 *  room is live when the user looks at it — the market socket survives the
 *  same conditions only because candles keep it continuously busy. */
function addHealListeners(): void {
  if (healListenersAdded) return;
  healListenersAdded = true;
  const heal = () => {
    if (document.visibilityState === "hidden") return;
    client?.reconnectNow();
  };
  document.addEventListener("visibilitychange", heal);
  window.addEventListener("focus", heal);
  window.addEventListener("online", heal);
}

  function ensureClient(): void {
    // Moderator key added mid-session (console/UI) — upgrade live instead of
    // waiting for a page refresh. A socket still mid-handshake upgrades IN
    // PLACE (the join-on-open picks up the key); killing it logged a bogus
    // "WebSocket failed:" and added a full extra handshake on every boot.
    const currentKey = localStorage.getItem(ADMIN_KEY) ?? undefined;
    if (client && clientAdminKey !== currentKey) {
      if (client.upgradeAdminKey(currentKey)) {
        clientAdminKey = currentKey;
        return;
      }
      client.disconnect();
      client = null;
    }
    if (client) return;
    addHealListeners();
    // Connect even without a nick — the server accepts an empty-nick
    // observer join so the unread badge counts for visitors who haven't
    // picked a nickname yet.
    client = new ChatClient({
      onHistory: (list) => {
        // History arriving means the join was accepted — the ban is over.
        if (banned.value) {
          banned.value = false;
          bannedAt.value = 0;
          try { localStorage.removeItem(BANNED_KEY); localStorage.removeItem("tk-chat-banned-at"); } catch {}
        }
        messages.value = list;
        // History carries each message's reactions — rebuild the map wholesale
        const rx: Record<string, Record<string, ChatReactionKind>> = {};
        for (const m of list) {
          if (m.reactions && Object.keys(m.reactions).length > 0) {
            const rec: Record<string, ChatReactionKind> = {};
            for (const [n, k] of Object.entries(m.reactions)) {
              if (k === "like" || k === "dislike" || k === "heart") rec[n] = k;
            }
            if (Object.keys(rec).length > 0) rx[m.id] = rec;
          }
        }
        reactions.value = rx;
        if (open.value && nick.value) {
          // Panel open with a nick = the user can actually read the list.
          const last = list[list.length - 1];
          markSeen(last ? last.ts : 0);
        } else {
          // Panel closed (or nick gate still up): everything in history
          // newer than the user's persisted last-seen ts counts as unread.
          const unseen = list.filter((m) => m.ts > lastSeenTs && m.from !== nick.value);
          unread.value = unseen.length;
          const first = unseen[0];
          firstUnseenTs.value = first ? first.ts : 0;
        }
      },
      onChat: (msg) => {
        const norm = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
        // Own echo: swap the optimistic placeholder for the real message.
        if (msg.from === nick.value) {
          // New servers echo the client id (deterministic); fall back to a
          // whitespace-normalized text match for old servers.
          const pIdx = msg.cid
            ? pendingLocal.findIndex((p) => p.localId === msg.cid)
            : pendingLocal.findIndex(
                (p) =>
                  p.from === msg.from &&
                  norm(p.text) === norm(msg.text) &&
                  !!(p.img ?? p.imgId) === !!(msg.img ?? msg.imgId)
              );
          if (pIdx >= 0) {
            const p = pendingLocal.splice(pIdx, 1)[0]!;
            // An old server drops the reply field on the echo — merge the
            // local quote snapshot so the reply block never flashes away.
            let merged = p.reply && !msg.reply ? { ...msg, reply: p.reply } : msg;
            // Keep the LOCAL image bytes on the sender's own message:
            // swapping the optimistic data URL for the server URL would
            // remount the <img> and blink, re-downloading bytes the
            // browser already has.
            merged = { ...merged, img: p.img ?? merged.img };
            const i = messages.value.findIndex((m) => m.id === p.localId);
            if (i >= 0) {
              const next = [...messages.value];
              next[i] = merged;
              messages.value = next;
            } else {
              messages.value = [...messages.value, msg];
            }
            if (open.value) markSeen(msg.ts);
            return;
          }
          // Last line of defense: the echo arrived without a pending match
          // (12s sweep already fired, or the match layers both missed).
          // If an optimistic placeholder with the same signature is still
          // on screen, REPLACE it — never append a duplicate beside it.
          const dupIdx = messages.value.findIndex(
            (m) =>
              m.id.startsWith("local-") &&
              m.from === msg.from &&
              norm(m.text) === norm(msg.text) &&
              !!(m.img ?? m.imgId) === !!(msg.img ?? msg.imgId)
          );
          if (dupIdx >= 0) {
            const ghost = messages.value[dupIdx]!;
            const merged = { ...msg, img: ghost.img ?? msg.img };
            const next = [...messages.value];
            next[dupIdx] = merged;
            messages.value = next;
            const stale = pendingLocal.findIndex((p) => p.localId === ghost.id);
            if (stale >= 0) pendingLocal.splice(stale, 1);
            if (open.value) markSeen(msg.ts);
            return;
          }
        }
        // Messages hidden behind the nick gate count as unseen too.
        if (!open.value || !nick.value) {
          unread.value++;
          if (!firstUnseenTs.value) firstUnseenTs.value = msg.ts;
        } else {
          markSeen(msg.ts);
        }
        messages.value = [...messages.value, msg];
        if (messages.value.length > 300) messages.value = messages.value.slice(-300);
      },
      onDeleted: (id) => {
        messages.value = messages.value.filter((m) => m.id !== id);
        applyReaction(id, "", null); // reactions die with the message
      },
      onSystem: (text, ts) => {
        if (!open.value || !nick.value) {
          unread.value++;
          if (!firstUnseenTs.value) firstUnseenTs.value = ts;
        } else {
          markSeen(ts);
        }
        messages.value = [...messages.value, { id: `s-${ts}-${Math.random().toString(36).slice(2, 6)}`, from: "", text, ts }];
      },
      onOnline: (count, nicks, known) => {
        online.value = count;
        rawOnline.value = nicks;
        rawKnown.value = known;
        applyNickFilter();
      },
      onStatus: (s) => {
        status.value = s;
      },
      onError: (msg) => {
        if (/banned/i.test(msg)) {
          banned.value = true;
          if (!bannedAt.value) bannedAt.value = Date.now();
          try {
            localStorage.setItem(BANNED_KEY, "1");
            localStorage.setItem("tk-chat-banned-at", String(bannedAt.value));
          } catch {}
          error.value = null;
          return;
        }
        error.value = msg;
        setTimeout(() => {
          if (error.value === msg) error.value = null;
        }, 4000);
      },
      onMod: (m, b) => {
        mutes.value = m;
        bans.value = b;
      },
      onMuted: (until) => {
        mutedUntil.value = until;
      },
      onUnmuted: () => {
        mutedUntil.value = 0;
        messages.value = [...messages.value, { id: `u-${Date.now()}`, from: "", text: "You have been unmuted — you can chat again", ts: Math.floor(Date.now() / 1000) }];
      },
      onRateLimit: (waitMs) => {
        rateWaitUntil.value = Date.now() + waitMs;
        // The rejected message never happened — remove its optimistic ghost
        // (it would otherwise sit there "sent" but invisible to everyone).
        const rejected = pendingLocal.pop();
        if (rejected) {
          messages.value = messages.value.filter((m) => m.id !== rejected.localId);
        }
      },
      onUserInfo: (info) => {
        userInfo.value = info;
      },
      onAdminDm: (dm) => {
        incomingDm.value = dm;
      },
      onDmStatus: (st) => {
        setDmStatus(st.id, { nick: st.nick, read: st.read, offline: st.offline });
      },
      onTgPopup: (id) => {
        tgPopupId.value = id;
      },
      onTgResult: (r) => {
        // Latest result per user, shown as a badge on their row; the panel
        // clears them when it closes (ready for the next broadcast).
        tgFlags.value = { ...tgFlags.value, [r.nick]: r.action };
      },
      onReaction: (id, reactionNick, kind) => {
        applyReaction(id, reactionNick, kind);
      },
    });
    clientAdminKey = currentKey;
    client.connect(nick.value, currentKey);
    startBanProbe();
  }

  /** While banned, quietly re-join every 30s — the moment the ban is
   *  lifted the join succeeds, history arrives and banned clears. */
  let banProbeTimer: ReturnType<typeof setInterval> | null = null;
  function startBanProbe(): void {
    if (banProbeTimer) return;
    banProbeTimer = setInterval(() => {
      if (!banned.value) {
        clearInterval(banProbeTimer!);
        banProbeTimer = null;
        return;
      }
      client?.rejoin();
    }, 30_000);
  }

  /** Called when the signed-in user's profile has is_admin: stores the
   *  moderator key fetched from Supabase and upgrades the connection. */
  function setAdminKey(key: string): void {
    try { localStorage.setItem(ADMIN_KEY, key); } catch {}
    isAdmin.value = true;
    ensureClient();
  }

  /** Drop the moderator key: the signed-in account is NOT an admin (or is
   *  signed out). Without this the key stored by a previous admin account
   *  kept `isAdmin` true on every reload — the admin panel and every chat
   *  moderation power (delete, mute, ban, user info, DM-all) followed it
   *  into the next sign-in on this browser. */
  function clearAdminKey(): void {
    try { localStorage.removeItem(ADMIN_KEY); } catch {}
    isAdmin.value = false;
    // Re-join an ALREADY connected room without the key; never open a
    // connection just to downgrade one (the chat panel connects on demand).
    if (client) ensureClient();
  }

  /* ── Admin tools state ── */
  const userInfo = ref<{ nick: string; lastIp: string | null; online: boolean; country: string | null } | null>(null);
  const dmStatuses = ref<Record<string, { nick: string; read: boolean; offline: boolean }>>({});
  /** DM status chips persist while the panel is open: "Sent…" until the
   *  user reads it (→ "Read ✓"), cleared when the panel closes. */
  function setDmStatus(id: string, entry: { nick: string; read: boolean; offline: boolean }): void {
    dmStatuses.value = { ...dmStatuses.value, [id]: entry };
  }
  /** Called when the admin panel closes — statuses reset. */
  function clearDmStatuses(): void {
    dmStatuses.value = {};
  }
  const tgFlags = ref<Record<string, "join" | "close">>({});
  /** Called when the admin panel closes — flags reset for the next broadcast. */
  function clearTgFlags(): void {
    tgFlags.value = {};
  }

  function askUserInfo(nick: string): void {
    userInfo.value = { nick, lastIp: null, online: false, country: null };
    client?.requestUserInfo(nick);
  }
  function clearUserInfo(): void {
    userInfo.value = null;
  }
  /** Send a direct message (text and/or photo); returns its tracking id. */
  function adminDm(nick: string, text: string, img?: string): string {
    const id = `dm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    // "Sent…" until the server reports Read/offline — a fresh DM on the
    // same user replaces the previous state (back to "Sent…").
    setDmStatus(id, { nick, read: false, offline: false });
    client?.sendAdminDm(nick, text || undefined, id, img);
    return id;
  }
  /** Send the same message to every ONLINE user (except the admin).
   *  Each recipient gets its own tracking id → per-user Read receipts. */
  function adminDmAll(text: string): number {
    const clean = text.trim().slice(0, 500);
    if (!clean) return 0;
    let sent = 0;
    const me = nick.value.toLowerCase();
    for (const target of onlineNicks.value) {
      if (!target || target.toLowerCase() === me) continue;
      adminDm(target, clean);
      sent++;
    }
    return sent;
  }

  /* ── User side: incoming admin DM + telegram popup ── */
  const incomingDm = ref<{ id: string; text?: string; img?: string } | null>(null);
  const tgPopupId = ref<string | null>(null);

  function dismissDm(): void {
    const id = incomingDm.value?.id;
    incomingDm.value = null;
    if (id) client?.sendDmRead(id);
  }
  function tgBroadcast(): string {
    const id = `tg-${Date.now()}`;
    client?.sendTgBroadcast(id);
    return id;
  }
  function answerTg(action: "join" | "close"): void {
    const id = tgPopupId.value;
    tgPopupId.value = null;
    if (id) client?.sendTgResult(id, action);
  }

  /** Manual probe (banned screen "Try again") — force a fresh join. */
  function probeConnection(): void {
    client?.rejoin();
  }

  function setNick(value: string): boolean {
    const clean = value.trim().replace(/\s+/g, " ").slice(0, 20);
    if (clean.length < 2) {
      error.value = "Nickname must be at least 2 characters";
      return false;
    }
    nick.value = clean;
    localStorage.setItem(NICK_KEY, clean);
    error.value = null;
    // Upgrade from observer (or an old nick) to this nick: a fresh join so
    // the roster, chat rights and OWNER state apply immediately.
    if (client) {
      client.disconnect();
      client = null;
    }
    ensureClient();
    if (open.value) {
      // The gate just lifted — the visible list is now read.
      unread.value = 0;
      const lastMsg = messages.value[messages.value.length - 1];
      markSeen(lastMsg ? lastMsg.ts : Math.floor(Date.now() / 1000));
    }
    return true;
  }

  /** Panel consumed the first-unseen anchor at open. Clearing it here is
   *  what makes the NEXT open go to the bottom: a surviving stale anchor
   *  re-jumped old messages on every reopen ("opens from the middle of
   *  chats") even though setOpen had already marked everything seen. */
  function consumeFirstUnseen(): number {
    const ts = firstUnseenTs.value;
    firstUnseenTs.value = 0;
    return ts;
  }

  function setOpen(v: boolean): void {
    open.value = v;
    localStorage.setItem(OPEN_KEY, v ? "1" : "0");
    if (v) {
      ensureClient();
      // Only mark seen when the message list is actually visible — with no
      // nick yet the panel shows the nickname gate instead.
      if (nick.value) {
        unread.value = 0; // opened → everything is seen
        const lastMsg = messages.value[messages.value.length - 1];
        markSeen(lastMsg ? lastMsg.ts : Math.floor(Date.now() / 1000));
      }
    }
  }

  function sendText(text: string): boolean {
    const clean = text.trim().slice(0, 400);
    if (!clean || !client) return false;
    client.sendText(clean);
    return true;
  }

  function sendImage(dataUrl: string): boolean {
    if (!client) return false;
    client.sendImage(dataUrl);
    return true;
  }

  /** Message being replied to (quote bar above the composer). */
  const replyTo = ref<ChatMessage | null>(null);
  function setReply(m: ChatMessage): void {
    replyTo.value = m;
  }
  function clearReply(): void {
    replyTo.value = null;
  }

  /** Optimistic-echo bookkeeping: placeholders we rendered for our own
   *  sends, replaced by the server broadcast (deduped in onChat). */
  const pendingLocal: { localId: string; from: string; text?: string; img?: string; imgId?: string; reply?: ChatMessage["reply"] }[] = [];

  /** Image + caption text in one message. */
  function sendChat(text: string | undefined, img: string | undefined): boolean {
    if (!client || (!text && !img)) return false;
    const reply = replyTo.value;
    const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    // cid rides to the server and comes back on the broadcast — the echo
    // swap then NEVER misfires into a duplicate.
    client.sendChat(text, img, reply?.id, localId);
    replyTo.value = null;
    // Telegram-style: render the sent message (with its quote) instantly.
    // The server broadcast swaps this placeholder for the real message.
    if (nick.value) {
      messages.value = [
        ...messages.value,
        {
          id: localId,
          from: nick.value,
          text,
          img,
          ts: Math.floor(Date.now() / 1000),
          reply: reply
            ? { id: reply.id, from: reply.from, text: reply.text?.slice(0, 80), img: reply.img ? true : undefined }
            : undefined,
        },
      ];
      pendingLocal.push({
        localId,
        from: nick.value,
        text,
        img,
        reply: reply ? { id: reply.id, from: reply.from, text: reply.text?.slice(0, 80), img: reply.img ? true : undefined } : undefined,
      });
      // Start the cooldown NOW (the server counts from the accepted send):
      // without this, the client stayed unlocked and a second message flew
      // into the server's 15s rejection — sent locally, seen by no one.
      // Admins are exempt from the server-side cooldown.
      if (!isAdmin.value) {
        rateWaitUntil.value = Math.max(rateWaitUntil.value, Date.now() + 15_000);
      }
      setTimeout(() => {
        const i = pendingLocal.findIndex((p) => p.localId === localId);
        if (i >= 0) {
          // The echo never landed (server rejected silently, crashed,
          // network died mid-send) — remove the optimistic ghost so it
          // can't linger as an undeletable duplicate.
          pendingLocal.splice(i, 1);
          messages.value = messages.value.filter((m) => m.id !== localId);
        }
      }, 12_000);
    }
    return true;
  }

  function deleteMessage(id: string): void {
    client?.deleteMessage(id);
  }

  function moderate(action: "mute" | "ban" | "unmute" | "unban", targetNick: string, minutes?: number): void {
    client?.moderate(action, targetNick, minutes);
  }

  function leave(): void {
    client?.disconnect();
    client = null;
    status.value = "offline";
  }

  return {
    messages,
    online,
    status,
    nick,
    isAdmin,
    open,
    unread,
    firstUnseenTs,
    consumeFirstUnseen,
    reactions,
    react,
    error,
    mutes,
    bans,
    onlineNicks,
    knownNicks,
    mutedUntil,
    rateWaitUntil,
    banned,
    bannedAt,
    probeConnection,
    userInfo,
    askUserInfo,
    clearUserInfo,
    adminDm,
    adminDmAll,
    dmStatuses,
    clearDmStatuses,
    incomingDm,
    dismissDm,
    tgBroadcast,
    tgFlags,
    clearTgFlags,
    tgPopupId,
    answerTg,
    ensureClient,
    setNick,
    setAdminKey,
    clearAdminKey,
    setOpen,
    sendText,
    sendImage,
    sendChat,
    replyTo,
    setReply,
    clearReply,
    deleteMessage,
    moderate,
    leave,
  };
});
