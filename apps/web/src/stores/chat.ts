import { defineStore } from "pinia";
import { ref } from "vue";
import type { ChatMessage } from "@traderkomak/shared";
import { ChatClient, type ChatStatus } from "@/services/chatClient";

const NICK_KEY = "tk-chat-nick";
const ADMIN_KEY = "tk-chat-admin";
const OPEN_KEY = "tk-chat-open";
/** Epoch seconds of the last chat message this user has seen. */
const LASTSEEN_KEY = "tk-chat-lastseen";

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
  const onlineNicks = ref<string[]>([]);
  const knownNicks = ref<{ nick: string; lastSeen: number; online: boolean }[]>([]);
  /** Epoch ms when this user's mute lifts (0 = not muted). */
  const mutedUntil = ref<number>(0);
  /** Epoch ms when the 15s chat cooldown lifts (0 = can send now). */
  const rateWaitUntil = ref<number>(0);
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
        onlineNicks.value = nicks;
        knownNicks.value = known;
      },
      onStatus: (s) => {
        status.value = s;
      },
      onError: (msg) => {
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
    });
    clientAdminKey = currentKey;
    client.connect(nick.value, currentKey);
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

  /** Image + caption text in one message. */
  function sendChat(text: string | undefined, img: string | undefined): boolean {
    if (!client || (!text && !img)) return false;
    client.sendChat(text, img);
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
    ensureClient,
    setNick,
    setOpen,
    sendText,
    sendImage,
    sendChat,
    deleteMessage,
    moderate,
    leave,
  };
});
