import { defineStore } from "pinia";
import { ref } from "vue";
import type { ChatMessage } from "@traderkomak/shared";
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

/** Browsers throttle background-tab timers, so a chat socket can silently
 *  die while the user is away. On focus/visibility/online, force-close a
 *  stale socket so it reconnects before the user tries to send. */
function addHealListeners(): void {
  if (healListenersAdded) return;
  healListenersAdded = true;
  const heal = () => client?.ensureFresh();
  document.addEventListener("visibilitychange", heal);
  window.addEventListener("focus", heal);
  window.addEventListener("online", heal);
}

  function ensureClient(): void {
    // Moderator key added mid-session (console/UI) — upgrade live instead of
    // waiting for a page refresh.
    const currentKey = localStorage.getItem(ADMIN_KEY) ?? undefined;
    if (client && clientAdminKey !== currentKey) {
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
        // Own echo: swap the optimistic placeholder for the real message.
        if (msg.from === nick.value) {
          const pIdx = pendingLocal.findIndex(
            (p) => p.from === msg.from && (p.text ?? "") === (msg.text ?? "") && !!p.img === !!msg.img
          );
          if (pIdx >= 0) {
            const p = pendingLocal.splice(pIdx, 1)[0]!;
            // An old server drops the reply field on the echo — merge the
            // local quote snapshot so the reply block never flashes away.
            const merged = p.reply && !msg.reply ? { ...msg, reply: p.reply } : msg;
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
  /** Send a direct message to a user; returns its tracking id. */
  function adminDm(nick: string, text: string): string {
    const id = `dm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    // "Sent…" until the server reports Read/offline — a fresh DM on the
    // same user replaces the previous state (back to "Sent…").
    setDmStatus(id, { nick, read: false, offline: false });
    client?.sendAdminDm(nick, text, id);
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
  const incomingDm = ref<{ id: string; text: string } | null>(null);
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
  const pendingLocal: { localId: string; from: string; text?: string; img?: string; reply?: ChatMessage["reply"] }[] = [];

  /** Image + caption text in one message. */
  function sendChat(text: string | undefined, img: string | undefined): boolean {
    if (!client || (!text && !img)) return false;
    const reply = replyTo.value;
    client.sendChat(text, img, reply?.id);
    replyTo.value = null;
    // Telegram-style: render the sent message (with its quote) instantly.
    // The server broadcast swaps this placeholder for the real message.
    if (nick.value) {
      const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
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
      setTimeout(() => {
        const i = pendingLocal.findIndex((p) => p.localId === localId);
        if (i >= 0) pendingLocal.splice(i, 1);
      }, 60_000);
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
