<script setup lang="ts">
import { ref, computed, nextTick, watch, onMounted, onBeforeUnmount } from "vue";
import { useChatStore } from "@/stores/chat";
import { useAuthStore } from "@/stores/auth";
import type { ChatMessage, ChatReactionKind } from "@traderkomak/shared";
import { compressImage } from "@/utils/image";
import { chatImgUrl } from "@/services/api";

const chat = useChatStore();
const auth = useAuthStore();

/** Photo source for a message: own optimistic echoes carry the inline data
 *  URL; server history/broadcasts carry an id → cacheable REST URL. */
function msgSrc(m: ChatMessage): string | undefined {
  return m.img ?? (m.imgId ? chatImgUrl(m.imgId) : undefined);
}

const draft = ref("");
const pendingImg = ref<string | null>(null);
/** Mobile browsers can re-deliver a ghost tap after the file picker
 *  closes — that ghost once landed on Send and shipped the photo without
 *  a caption. Send is ignored for a short window after staging. */
let stageGuardUntil = 0;
const showMembers = ref(false);
/** 1s ticker for the send-cooldown countdown display. */
const nowTick = ref(Date.now());
let tickTimer: ReturnType<typeof setInterval> | null = null;
const cooldownLeft = computed(() => Math.max(0, Math.ceil((chat.rateWaitUntil - nowTick.value) / 1000)));
const mutedLeft = computed(() => Math.max(0, Math.ceil((chat.mutedUntil - nowTick.value) / 60000)));
const isMuted = computed(() => chat.mutedUntil > nowTick.value);

/* ── Message reactions (Telegram-style: one per user, toggle to clear) ── */
const REACTIONS: { kind: ChatReactionKind; emoji: string }[] = [
  { kind: "like", emoji: "👍" },
  { kind: "dislike", emoji: "👎" },
  { kind: "heart", emoji: "❤️" },
];
const canReact = computed(() => !!chat.nick && !isMuted.value);
const reactForId = ref<string | null>(null);
function toggleReactPalette(m: ChatMessage): void {
  reactForId.value = reactForId.value === m.id ? null : m.id;
}
function onReact(m: ChatMessage, kind: ChatReactionKind): void {
  chat.react(m.id, kind);
  reactForId.value = null;
}
function reactionChips(m: ChatMessage): { kind: ChatReactionKind; emoji: string; count: number; mine: boolean }[] {
  const rx = chat.reactions[m.id];
  if (!rx) return [];
  const myNick = chat.nick?.toLowerCase();
  const out: { kind: ChatReactionKind; emoji: string; count: number; mine: boolean }[] = [];
  for (const { kind, emoji } of REACTIONS) {
    let count = 0;
    let mine = false;
    for (const [n, k] of Object.entries(rx)) {
      if (k !== kind) continue;
      count++;
      if (myNick && n.toLowerCase() === myNick) mine = true;
    }
    if (count > 0) out.push({ kind, emoji, count, mine });
  }
  return out;
}
const nickDraft = ref("");
const lightbox = ref<string | null>(null);
const listEl = ref<HTMLElement | null>(null);
const inputEl = ref<HTMLInputElement | null>(null);
const fileEl = ref<HTMLInputElement | null>(null);
let errorTimer: ReturnType<typeof setTimeout> | null = null;

const offlineNicks = computed(() => chat.knownNicks.filter((k) => !k.online));

/** Sticker set — sent as `sticker:<emoji>` text and rendered large. */
const STICKERS = [
  "🚀", "📈", "📉", "💰", "🔥", "😂", "👍", "🙌", "😱", "🤯", "🧠", "☕",
  "🦅", "🐂", "🐻", "💎", "⏰", "🎯", "✅", "❌", "🤝", "👀", "🥂", "😎",
  "🐋", "🦈", "💸", "🤑", "📊", "🕯️", "⚡", "🌙", "☀️", "🥇", "🛢️", "🏦",
  "😮‍💨", "🥲", "🤖", "🐐", "🍀", "🧨", "🍻", "🙋", "🙏", "💪", "👑", "🐸",
];
const showStickers = ref(false);

function pickSticker(st: string): void {
  showStickers.value = false;
  if (chat.sendChat("sticker:" + st, undefined)) scrollTop();
}

let flashTimers: ReturnType<typeof setTimeout>[] = [];
function jumpTo(id: string): void {
  const el = listEl.value?.querySelector(`[data-id="${CSS.escape(id)}"]`) as HTMLElement | null;
  if (!el) return; // original was pruned — stay put, like Telegram
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  // Inline styles instead of a CSS animation — always fires, even mid-scroll
  flashTimers.forEach(clearTimeout);
  flashTimers = [];
  el.style.backgroundColor = "rgba(59, 130, 246, 0.28)";
  el.style.borderRadius = "8px";
  flashTimers.push(setTimeout(() => {
    el.style.transition = "background-color 0.8s ease";
    el.style.backgroundColor = "transparent";
  }, 1400));
  flashTimers.push(setTimeout(() => {
    el.style.transition = "";
    el.style.borderRadius = "";
    el.style.backgroundColor = "";
  }, 2400));
}

function startReply(m: ChatMessage): void {
  chat.setReply(m);
  void nextTick(() => inputEl.value?.focus());
}
function quoteText(m: ChatMessage): string {
  return m.text ? (m.text.startsWith("sticker:") ? m.text.slice(8) + " sticker" : m.text) : m.img || m.imgId ? "📷 photo" : "";
}

function onDocClick(e: MouseEvent): void {
  const t = e.target as HTMLElement;
  if (showMembers.value && !t.closest(".chat-online") && !t.closest(".members-pop")) {
    showMembers.value = false;
  }
  if (reactForId.value && !t.closest(".rx-pop") && !t.closest(".rx-add")) {
    reactForId.value = null;
  }
}
onMounted(() => {
  document.addEventListener("mousedown", onDocClick);
  tickTimer = setInterval(() => {
    nowTick.value = Date.now();
  }, 1000);
});
onBeforeUnmount(() => {
  document.removeEventListener("mousedown", onDocClick);
  tickTimer && clearInterval(tickTimer);
});

const statusLabel: Record<string, string> = {
  connected: "Live",
  connecting: "Connecting…",
  reconnecting: "Reconnecting…",
  offline: "Offline",
};

function authorMuted(from: string): boolean {
  return chat.mutes.some((m) => m.nick.toLowerCase() === from.toLowerCase());
}

function timeLabel(ts: number): string {
  const d = new Date(ts * 1000);
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

function scrollTop(): void {
  void nextTick(() => {
    const el = listEl.value;
    if (el) el.scrollTop = el.scrollHeight;
  });
}

/* ── Open anchoring ─────────────────────────────────────────────────────
 *  The chat must open at the FIRST UNSEEN message (or the bottom). Two
 *  things used to break it: a stale first-unseen anchor surviving reopens
 *  (now consumed+cleared in the store at open), and image messages loading
 *  AFTER the scroll pin, growing the list below the view ("opens a few
 *  messages above the last"). The anchor re-asserts itself on image loads
 *  during a short settle window — cancelled the moment the user scrolls
 *  on their own. */
let anchorTs: number | null = null;
let settleUntil = 0;
let userScrolled = false;

function anchorTo(ts: number | null): void {
  const el = listEl.value;
  if (!el) return;
  if (ts) {
    const t = el.querySelector(`[data-ts="${ts}"]`) as HTMLElement | null;
    if (t) {
      const tr = t.getBoundingClientRect();
      const lr = el.getBoundingClientRect();
      el.scrollTop += tr.top - lr.top - 6;
      return;
    }
  }
  el.scrollTop = el.scrollHeight;
}

function onListImageLoad(e: Event): void {
  if (Date.now() > settleUntil || userScrolled) return;
  if ((e.target as HTMLElement)?.tagName !== "IMG") return;
  // Images trickle in on slow links — every load extends the settle
  // window so the anchor keeps asserting until they stop arriving.
  settleUntil = Math.max(settleUntil, Date.now() + 800);
  anchorTo(anchorTs);
}

function markUserScroll(): void {
  userScrolled = true;
}

let listBound = false;
watch(listEl, (el) => {
  if (el && !listBound) {
    listBound = true;
    // Capture phase: img load events don't bubble
    el.addEventListener("load", onListImageLoad, true);
    el.addEventListener("wheel", markUserScroll, { passive: true });
    el.addEventListener("touchstart", markUserScroll, { passive: true });
    el.addEventListener("pointerdown", markUserScroll, { passive: true });
  }
});

/** On open: jump to the FIRST UNSEEN message (or bottom when all seen).
 *  Uses direct scrollTop math — scrollIntoView walks ancestor containers
 *  and glitches mid-animation. On touch devices the panel is mid-slide
 *  (320ms), so the jump waits for the animation to finish. */
function jumpToUnseen(targetTs: number): void {
  anchorTs = targetTs || null;
  userScrolled = false;
  settleUntil = Date.now() + 1600;
  const jump = () => anchorTo(anchorTs);
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  if (coarse) {
    void nextTick(jump);
    setTimeout(jump, 360); // after the slide-in settles; images may still shift
  } else {
    void nextTick(jump);
  }
}

/** Down-arrow visibility: user is away from the bottom of the list. */
const showJumpDown = ref(false);
function onListScroll(): void {
  const el = listEl.value;
  if (!el) return;
  showJumpDown.value = el.scrollHeight - el.scrollTop - el.clientHeight > 120;
}
function jumpToBottom(): void {
  scrollTop();
}

watch(
  () => [chat.messages.length, chat.open],
  ([, open], old) => {
    if (!open) return;
    const prevLen = old ? Number(old[0]) : 0;
    // Follow the bottom only when a message ARRIVES — deletions must not
    // yank the view away from where the moderator is working.
    if (chat.messages.length > prevLen) {
      // History landing right after open re-asserts the anchor (its images
      // are still loading); later arrivals just follow the bottom.
      if (Date.now() <= settleUntil && !userScrolled) anchorTo(anchorTs);
      else scrollTop();
    }
  }
);
watch(
  () => chat.open,
  (open) => {
    // Consume the anchor so the NEXT open goes to the bottom — a surviving
    // stale anchor re-jumped old messages on every reopen.
    if (open) jumpToUnseen(chat.consumeFirstUnseen());
  }
);

watch(
  () => chat.open,
  (open) => {
    if (open) {
      chat.ensureClient();
      // Auto-focusing pops the on-screen keyboard on phones and glitches
      // the panel open — only focus on pointer devices.
      const coarse = window.matchMedia("(pointer: coarse)").matches;
      if (!coarse) {
        void nextTick(() => (chat.nick ? inputEl.value?.focus() : nickDraft.value && null));
      }
    }
  }
);

function confirmNick(): void {
  if (chat.setNick(nickDraft.value)) {
    nickDraft.value = "";
    void nextTick(() => inputEl.value?.focus());
  }
}

function send(): void {
  if (isMuted.value || cooldownLeft.value > 0 || Date.now() < stageGuardUntil) return;
  const text = draft.value.trim().slice(0, 400) || undefined;
  const img = pendingImg.value ?? undefined;
  if (!text && !img) return;
  if (chat.sendChat(text, img)) {
    draft.value = "";
    pendingImg.value = null;
    scrollTop();
  }
}

function stageImage(dataUrl: string): void {
  pendingImg.value = dataUrl;
  stageGuardUntil = Date.now() + 800;
  void nextTick(() => inputEl.value?.focus());
}

function clearPending(): void {
  pendingImg.value = null;
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send();
  }
}

/** Paste a screenshot straight into the input. */
function onPaste(e: ClipboardEvent): void {
  const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"));
  if (!item) return;
  e.preventDefault();
  const file = item.getAsFile();
  if (!file) return;
  void compressImage(file).then((dataUrl) => stageImage(dataUrl));
}

function onAttachClick(e: MouseEvent): void {
  // ignore the ghost tap some mobile browsers re-deliver after the picker
  if (Date.now() < stageGuardUntil) return;
  fileEl.value?.click();
}

function onFileChange(e: Event): void {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  void compressImage(file).then((dataUrl) => stageImage(dataUrl));
}

function openImage(src: string): void {
  lightbox.value = src;
}
function closeLightbox(): void {
  lightbox.value = null;
}

function fmtError(msg: string): string {
  errorTimer && clearTimeout(errorTimer);
  return msg;
}

onMounted(() => {
  // Connect ALWAYS (even with the panel closed) — otherwise messages
  // received while closed never arrive and the unread badge can't count.
  chat.ensureClient();
});
onBeforeUnmount(() => {
  errorTimer && clearTimeout(errorTimer);
});
</script>

<template>
  <div class="chat-panel" :class="{ open: chat.open }">
    <div class="chat-inner">
      <div class="chat-head">
        <span class="chat-title">Live Chat</span>
        <span v-if="chat.isAdmin" class="chat-online clickable" :class="chat.status" @click="showMembers = !showMembers" title="Members — click to moderate">
          <span class="dot" :class="chat.status"></span>
          {{ chat.online }} online · {{ statusLabel[chat.status] ?? chat.status }}
          <svg v-if="chat.isAdmin" viewBox="0 0 6 8" width="6" height="8" aria-hidden="true"><path d="M0 0l5 4-5 4z" fill="currentColor"/></svg>
        </span>
        <div v-if="chat.isAdmin && showMembers" class="members-pop">
          <div class="members-title">Online — {{ chat.onlineNicks.length }}</div>
          <div v-for="n in chat.onlineNicks" :key="'on-' + n" class="member-row">
            <span class="member-name">{{ n }}</span>
            <template v-if="chat.isAdmin && n !== chat.nick">
              <button class="member-act" title="Mute 10 minutes" @click.stop="chat.moderate('mute', n, 10)">🔇</button>
              <button class="member-act ban" title="Ban (permanent)" @click.stop="chat.moderate('ban', n)">⛔</button>
            </template>
            <span v-if="chat.nick === n" class="member-you">you</span>
          </div>
          <template v-if="chat.isAdmin">
            <div class="members-title">Offline — {{ offlineNicks.length }}</div>
            <div v-for="k in offlineNicks" :key="'of-' + k.nick" class="member-row offline">
              <span class="member-name">{{ k.nick }}</span>
              <button class="member-act" title="Mute 10 minutes" @click.stop="chat.moderate('mute', k.nick, 10)">🔇</button>
              <button class="member-act ban" title="Ban (permanent)" @click.stop="chat.moderate('ban', k.nick)">⛔</button>
            </div>
            <div v-if="offlineNicks.length === 0" class="member-empty">no offline members yet</div>
          </template>
        </div>
      </div>

      <!-- Nickname gate -->
      <div v-if="!chat.nick" class="nick-gate">
        <template v-if="auth.signedIn">
          <p class="nick-hint">Setting up your chat identity…</p>
        </template>
        <template v-else>
          <p class="nick-hint">Sign in with Google to join the public room — talk charts, share screenshots and trade ideas under your own username.</p>
          <button class="nick-go" @click="auth.openAuthModal()">Sign in with Google</button>
        </template>
        <p v-if="chat.error" class="chat-error">{{ fmtError(chat.error) }}</p>
        <p class="nick-note">Signals and ideas shared here come from other users — not financial advice. Be kind, no spam.</p>
      </div>

      <!-- Conversation -->
      <template v-else>
        <!-- Pinned: join our Telegram channel -->
        <a
          class="tg-pin"
          href="https://t.me/TraderKomak_ir"
          target="_blank"
          rel="noopener noreferrer"
          title="Join our Telegram channel"
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
            <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
          </svg>
          <span class="tg-pin-text">Join our Telegram channel</span>
          <span class="tg-pin-arrow">→</span>
        </a>
        <!-- Admin moderation strip: muted/banned chatters with lift buttons -->
        <div v-if="chat.isAdmin && (chat.mutes.length || chat.bans.length)" class="mod-strip">
          <span
            v-for="m in chat.mutes"
            :key="'mu-' + m.nick"
            class="mod-chip"
            title="Click to unmute"
            @click="chat.moderate('unmute', m.nick)"
          >🔇 {{ m.nick }} ✕</span>
          <span
            v-for="b in chat.bans"
            :key="'ba-' + b.nick"
            class="mod-chip ban"
            title="Click to unban"
            @click="chat.moderate('unban', b.nick)"
          >⛔ {{ b.nick }} ✕</span>
        </div>
        <div ref="listEl" class="chat-list" @scroll="onListScroll">
          <div v-for="m in chat.messages" :key="m.id" class="msg" :class="{ system: m.from === '' }" :data-ts="m.ts" :data-id="m.id">
            <template v-if="m.from === ''">
              <span class="sys-text">— {{ m.text }} —</span>
            </template>
            <template v-else>
              <div class="msg-head">
                <span class="msg-from">{{ m.from }}</span>
                <span v-if="m.owner" class="owner-badge">OWNER</span>
                <span class="msg-time">{{ timeLabel(m.ts) }}</span>
                <span v-if="chat.isAdmin" class="msg-actions">
                  <template v-if="chat.nick !== m.from">
                    <button
                      class="msg-mod"
                      :title="authorMuted(m.from) ? 'Unmute' : 'Mute 10 minutes'"
                      @click="authorMuted(m.from) ? chat.moderate('unmute', m.from) : chat.moderate('mute', m.from, 10)"
                    >{{ authorMuted(m.from) ? '🔊' : '🔇' }}</button>
                    <button class="msg-mod ban" title="Ban (permanent)" @click="chat.moderate('ban', m.from)">⛔</button>
                  </template>
                  <button class="msg-del" title="Delete message" @click="chat.deleteMessage(m.id)">✕</button>
                  <button
                    class="msg-reply-btn"
                    title="Reply"
                    aria-label="Reply to this message"
                    @click="startReply(m)"
                  >↩</button>
                </span>
                <button
                  v-else
                  class="msg-reply-btn"
                  title="Reply"
                  aria-label="Reply to this message"
                  @click="startReply(m)"
                >↩</button>
                <button
                  v-if="canReact"
                  class="rx-add"
                  :class="{ open: reactForId === m.id }"
                  title="Add reaction"
                  aria-label="Add reaction"
                  @click.stop="toggleReactPalette(m)"
                >＋</button>
              </div>
              <div v-if="reactForId === m.id" class="rx-pop">
                <button
                  v-for="r in REACTIONS"
                  :key="r.kind"
                  class="rx-opt"
                  :title="r.kind"
                  :aria-label="'React ' + r.kind"
                  @click.stop="onReact(m, r.kind)"
                >{{ r.emoji }}</button>
              </div>
              <div v-if="m.reply" class="msg-quote" role="button" tabindex="0" title="Jump to the original message" @click="jumpTo(m.reply.id)" @keydown.enter="jumpTo(m.reply.id)">
                <span class="q-from">↩ {{ m.reply.from }}</span>
                <span class="q-text">{{ m.reply.text || (m.reply.img ? "📷 photo" : "") }}</span>
              </div>
              <img
                v-if="msgSrc(m)"
                :src="msgSrc(m)"
                class="msg-img"
                alt="shared chart"
                @click="openImage(msgSrc(m)!)"
              />
              <div
                v-if="m.text"
                class="msg-text msg-caption"
                :class="{ sticker: m.text.startsWith('sticker:') }"
              >{{ m.text.startsWith('sticker:') ? m.text.slice(8) : m.text }}</div>
              <div v-if="reactionChips(m).length" class="msg-reactions">
                <button
                  v-for="c in reactionChips(m)"
                  :key="c.kind"
                  class="rx-chip"
                  :class="{ mine: c.mine }"
                  :title="c.mine ? 'Remove your reaction' : 'React ' + c.kind"
                  @click="canReact && onReact(m, c.kind)"
                >{{ c.emoji }}<span v-if="c.count > 1" class="rx-count">{{ c.count }}</span></button>
              </div>
            </template>
          </div>
        </div>

        <p v-if="chat.error" class="chat-error">{{ fmtError(chat.error) }}</p>
        <p v-if="isMuted" class="muted-banner">
          🔇 You are muted — you can read but not chat{{ mutedLeft ? ` (${mutedLeft} min left)` : '' }}
        </p>

        <div v-if="pendingImg" class="pending-img">
          <img :src="pendingImg" alt="attached chart" />
          <button class="pending-remove" title="Remove image" aria-label="Remove attached image" @click="clearPending">✕</button>
          <span class="pending-hint">Add a caption, then send</span>
        </div>
        <div v-if="chat.replyTo" class="reply-bar">
          <span class="rb-text">Replying to <b>{{ chat.replyTo.from }}</b>: {{ quoteText(chat.replyTo).slice(0, 60) }}</span>
          <button class="rb-x" title="Cancel reply" aria-label="Cancel reply" @click="chat.clearReply()">✕</button>
        </div>
        <div v-if="showStickers" class="sticker-pop">
          <button v-for="st in STICKERS" :key="st" class="sticker-cell" type="button" @click="pickSticker(st)">{{ st }}</button>
        </div>
        <div class="chat-input-row">
          <button class="attach" title="Stickers" aria-label="Send a sticker" @click="showStickers = !showStickers">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M8.5 10h.01M15.5 10h.01" />
              <path d="M8.5 14.5c1 1.2 2.2 1.8 3.5 1.8s2.5-.6 3.5-1.8" />
            </svg>
          </button>
          <button class="attach" title="Attach a chart screenshot" aria-label="Attach image" @click="onAttachClick">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
              <rect x="3" y="5" width="18" height="14" rx="2.5" />
              <circle cx="9" cy="10" r="1.6" />
              <path d="M5 17l4.5-4.5 3 3L17 11l4 4.5" />
            </svg>
          </button>
          <input
            ref="inputEl"
            v-model="draft"
            class="chat-input"
            type="text"
            maxlength="400"
            :placeholder="pendingImg ? 'Describe the image… (optional)' : 'Message the room…'"
            aria-label="Chat message"
            @keydown="onKeydown"
            @paste="onPaste"
          />
          <button
            class="send"
            :title="isMuted ? 'You are muted' : cooldownLeft > 0 ? `Wait ${cooldownLeft}s` : 'Send'"
            :disabled="isMuted || cooldownLeft > 0"
            aria-label="Send message"
            @click="send"
          >{{ cooldownLeft > 0 && !isMuted ? cooldownLeft + 's' : '' }}
            <svg v-if="!cooldownLeft || isMuted" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path d="M2 21l21-9L2 3v7l15 2-15 2z" fill="currentColor" />
            </svg>
          </button>
          <input ref="fileEl" type="file" accept="image/*" class="file-hidden" @change="onFileChange" />
        </div>
      </template>
    </div>

    <!-- Full-size image lightbox — teleported to <body>: the chat panel's
         backdrop-filter would otherwise clip the fixed overlay to the
         320px column and cut the image in half. -->
    <Teleport to="body">
      <div v-if="lightbox" class="lightbox" @click="closeLightbox">
        <img :src="lightbox" alt="shared chart (full size)" />
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.chat-panel {
  width: 0;
  min-width: 0;
  max-width: 320px;
  background: var(--bg-watchlist);
  backdrop-filter: blur(20px) saturate(1.3);
  -webkit-backdrop-filter: blur(20px) saturate(1.3);
  border-left: 1px solid transparent;
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  position: relative;
  transition:
    width 420ms cubic-bezier(0.32, 0.72, 0, 1),
    min-width 420ms cubic-bezier(0.32, 0.72, 0, 1),
    border-color 300ms cubic-bezier(0.4, 0, 0.2, 1);
  pointer-events: none;
}
.chat-panel.open {
  width: 320px;
  min-width: 320px;
  border-left-color: var(--border);
  pointer-events: auto;
}
.chat-inner {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  opacity: 0;
  transform: translateX(-18px);
  transition:
    opacity 220ms cubic-bezier(0.4, 0, 0.2, 1),
    transform 340ms cubic-bezier(0.32, 0.72, 0, 1);
}
.chat-panel.open .chat-inner {
  opacity: 1;
  transform: translateX(0);
  transition-delay: 90ms;
}
.chat-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 12px 8px;
  flex-shrink: 0;
}
.chat-title {
  font-weight: 800;
  font-size: 13px;
  letter-spacing: -0.01em;
}
.chat-online {
  flex: 1;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 10px;
  font-weight: 700;
  color: var(--text-muted);
}
.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--connecting);
}
.dot.connected {
  background: var(--live);
  box-shadow: 0 0 6px var(--live);
}
.dot.reconnecting {
  background: var(--reconnecting);
}
.chat-close {
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 11px;
}
.chat-close:hover {
  background: var(--btn-bg);
  color: var(--text);
}
/* Pinned Telegram channel banner */
.tg-pin {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 10px 8px;
  padding: 8px 10px;
  border-radius: var(--radius-md);
  border: 1px solid rgba(42, 171, 238, 0.35);
  background: linear-gradient(135deg, rgba(42, 171, 238, 0.12), rgba(41, 98, 255, 0.08));
  color: #2aabee;
  text-decoration: none;
  flex-shrink: 0;
  transition: all 180ms;
}
.tg-pin:hover {
  border-color: #2aabee;
  box-shadow: 0 4px 16px rgba(42, 171, 238, 0.25);
  transform: translateY(-1px);
}
.tg-pin-text {
  flex: 1;
  font-size: 11px;
  font-weight: 800;
  color: var(--text);
}
.tg-pin-arrow {
  font-size: 12px;
  font-weight: 900;
}

/* Nickname gate */
.nick-gate {
  padding: 8px 12px 12px;
}
.nick-hint {
  font-size: 12px;
  color: var(--text);
  line-height: 1.5;
  margin-bottom: 10px;
}
.nick-row {
  display: flex;
  gap: 6px;
}
.nick-input {
  flex: 1;
  padding: 9px 12px;
  border-radius: 11px;
  border: 1px solid var(--glass-border);
  background: var(--glass-bg);
  color: var(--text);
  font-size: 12px;
  font-weight: 600;
  outline: none;
  transition: all 180ms;
}
.nick-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.14);
}
.nick-go {
  padding: 0 14px;
  border-radius: 11px;
  border: none;
  background: var(--accent-gradient);
  color: #fff;
  font-weight: 800;
  font-size: 12px;
  cursor: pointer;
}
.nick-note {
  margin-top: 10px;
  font-size: 10px;
  line-height: 1.5;
  color: var(--text-muted);
}
.chat-error {
  padding: 4px 12px;
  font-size: 11px;
  font-weight: 700;
  color: var(--offline);
}
/* Conversation */
.chat-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 6px 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.msg {
  padding: 6px 9px;
  border-radius: var(--radius-md);
  border: 1px solid var(--glass-border);
  background: var(--glass-bg);
}
.msg.system {
  border: none;
  background: transparent;
  text-align: center;
  padding: 2px;
}
.sys-text {
  font-size: 10px;
  color: var(--text-muted);
}
.msg-head {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.msg-from {
  font-weight: 800;
  font-size: 11px;
  color: var(--accent);
}
.owner-badge {
  font-size: 8px;
  font-weight: 900;
  letter-spacing: 0.06em;
  padding: 1px 5px;
  border-radius: 99px;
  color: #fff;
  background: linear-gradient(135deg, #ef4444, #dc2626);
  box-shadow: 0 1px 6px rgba(239, 68, 68, 0.45);
}
.msg-mod {
  width: 18px;
  height: 16px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  font-size: 9px;
  cursor: pointer;
}
.msg-mod:hover {
  background: rgba(251, 191, 36, 0.15);
  color: var(--reconnecting);
}
.msg-mod.ban:hover {
  background: rgba(239, 83, 80, 0.12);
  color: var(--offline);
}
.msg-mod + .msg-mod {
  margin-left: 0;
}
.msg-mod.ban {
  margin-left: 0;
}
.mod-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 4px 10px;
  flex-shrink: 0;
}
.mod-chip {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 99px;
  background: var(--btn-bg);
  color: var(--text-muted);
  cursor: pointer;
  transition: all 150ms;
}
.mod-chip:hover {
  background: rgba(239, 83, 80, 0.12);
  color: var(--offline);
}
.mod-chip.ban {
  color: var(--offline);
}
.msg-time {
  font-size: 9px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
.msg-del {
  margin-left: auto;
  width: 16px;
  height: 16px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  font-size: 9px;
  cursor: pointer;
}
.msg-del:hover {
  background: rgba(239, 83, 80, 0.12);
  color: var(--offline);
}
.msg-text {
  font-size: 12px;
  line-height: 1.45;
  color: var(--text);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.msg-caption {
  margin-top: 2px;
}
.msg-img {
  display: block;
  margin-top: 6px;
  margin-bottom: 2px;
  max-width: 100%;
  max-height: 180px;
  border-radius: 8px;
  border: 1px solid var(--border);
  cursor: zoom-in;
}
/* Input row */
.chat-input-row {
  display: flex;
  gap: 6px;
  padding: 8px 10px 10px;
  flex-shrink: 0;
}
.chat-input {
  flex: 1;
  min-width: 0;
  padding: 9px 12px;
  border-radius: 11px;
  border: 1px solid var(--glass-border);
  background: var(--glass-bg);
  color: var(--text);
  font-size: 12px;
  outline: none;
  transition: all 180ms;
}
.chat-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.14);
}
.attach,
.send {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border-radius: 11px;
  border: 1px solid var(--glass-border);
  background: var(--glass-bg);
  color: var(--text-muted);
  cursor: pointer;
  flex-shrink: 0;
  transition: all 180ms;
}
.attach:hover {
  color: var(--text);
}
.send {
  background: var(--accent-gradient);
  border-color: transparent;
  color: #fff;
}
.send:hover {
  box-shadow: 0 4px 14px rgba(59, 130, 246, 0.45);
}
.file-hidden {
  display: none;
}
/* Lightbox */
.lightbox {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(2, 6, 18, 0.8);
  display: grid;
  place-items: center;
  cursor: zoom-out;
}
.lightbox img {
  max-width: min(92vw, 1100px);
  max-height: 88vh;
  border-radius: var(--radius-lg);
  border: 1px solid var(--glass-border);
  box-shadow: var(--glass-shadow);
}
.msg-actions {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}
.muted-banner {
  padding: 6px 12px;
  font-size: 11px;
  font-weight: 700;
  color: var(--reconnecting);
  background: rgba(251, 191, 36, 0.08);
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.send:disabled {
  opacity: 0.55;
  cursor: not-allowed;
  font-size: 11px;
  font-weight: 800;
}

.pending-img {
  position: relative;
  margin: 0 10px 6px;
  padding: 6px;
  border-radius: var(--radius-md);
  border: 1px solid var(--glass-border);
  background: var(--glass-bg);
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.pending-img img {
  height: 44px;
  max-width: 90px;
  border-radius: 6px;
  border: 1px solid var(--border);
  object-fit: cover;
}
.pending-remove {
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 50%;
  background: var(--btn-bg);
  color: var(--text-muted);
  font-size: 9px;
  cursor: pointer;
  display: grid;
  place-items: center;
}
.pending-remove:hover {
  background: rgba(239, 83, 80, 0.12);
  color: var(--offline);
}
.pending-hint {
  font-size: 10px;
  color: var(--text-muted);
}

.jump-down {
  position: absolute;
  right: 12px;
  bottom: 76px;
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  border: 1px solid var(--glass-border);
  background: var(--accent-gradient);
  color: #fff;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(59, 130, 246, 0.4);
  z-index: 5;
}

/* Members dropdown (moderator) */
.chat-online {
  cursor: pointer;
}
.members-pop {
  position: absolute;
  top: 40px;
  left: 10px;
  right: 10px;
  z-index: 20;
  background: var(--bg-panel);
  backdrop-filter: blur(22px) saturate(1.3);
  -webkit-backdrop-filter: blur(22px) saturate(1.3);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  box-shadow: var(--glass-shadow);
  padding: 6px;
  max-height: 300px;
  overflow-y: auto;
}
.members-title {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-muted);
  padding: 4px 4px 2px;
}
.member-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 4px;
  border-radius: 7px;
}
.member-row.offline {
  opacity: 0.6;
}
.member-name {
  flex: 1;
  font-size: 11px;
  font-weight: 700;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.member-you {
  font-size: 9px;
  font-weight: 700;
  color: var(--text-muted);
}
.member-act {
  width: 22px;
  height: 20px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--text-muted);
  font-size: 10px;
  cursor: pointer;
}
.member-act:hover {
  background: rgba(251, 191, 36, 0.15);
  color: var(--reconnecting);
}
.member-act.ban:hover {
  background: rgba(239, 83, 80, 0.12);
  color: var(--offline);
}
.member-empty {
  font-size: 10px;
  color: var(--text-muted);
  padding: 2px 4px;
}
.owner-badge {
  font-size: 8px;
  font-weight: 900;
  letter-spacing: 0.06em;
  padding: 1px 5px;
  border-radius: 99px;
  color: #fff;
  background: linear-gradient(135deg, #ef4444, #dc2626);
  box-shadow: 0 1px 6px rgba(239, 68, 68, 0.45);
}

/* Phones: overlay like the watchlist */
@media (max-width: 768px) {
/* Phone: slide with transform (GPU) instead of animating width —
     animating width + backdrop-filter repaints every frame (laggy). */
  .chat-panel {
    position: absolute;
    top: 0;
    right: 36px;
    bottom: 0;
    width: min(320px, calc(100vw - 60px));
    min-width: min(320px, calc(100vw - 60px));
    transform: translateX(130%);
    transition: transform 320ms cubic-bezier(0.32, 0.72, 0, 1);
    pointer-events: none;
    will-change: transform;
  }
  .chat-panel.open {
    transform: translateX(0);
    pointer-events: auto;
    z-index: 50; /* above chart overlays (settings gear 40) */
    border-left: 1px solid var(--border);
    box-shadow: -12px 0 28px rgba(0, 0, 0, 0.28);
  }

}

/* ── Replies ── */
.msg-actions {
  display: inline-grid;
  grid-template-columns: repeat(3, auto);
  gap: 2px 3px;
  justify-items: end;
  align-items: center;
}
.msg-reply-btn {
  margin-left: auto;
  width: 24px;
  height: 20px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--accent);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.12s ease, background 0.12s ease;
}
/* admin grid: reply sits directly under the ✕ (3rd column, 2nd row) */
.msg-actions .msg-reply-btn { grid-column: 3; }
.msg-reply-btn:hover { background: rgba(59, 130, 246, 0.15); }
.msg:hover .msg-reply-btn { opacity: 1; }

/* ── Reactions (Telegram-style: ＋ opens 👍👎❤️, chips show counts) ── */
.msg { position: relative; }
.rx-add {
  width: 22px;
  height: 20px;
  margin-left: 4px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.12s ease, background 0.12s ease;
  vertical-align: middle;
}
.rx-add:hover, .rx-add.open { background: rgba(59, 130, 246, 0.15); color: var(--accent); }
.msg:hover .rx-add, .rx-add.open { opacity: 1; }
@media (pointer: coarse) {
  .rx-add { opacity: 1; } /* touch has no hover — keep it reachable */
}
.rx-pop {
  position: absolute;
  z-index: 5;
  top: 26px;
  right: 6px;
  display: flex;
  gap: 2px;
  padding: 3px;
  border-radius: 10px;
  border: 1px solid var(--glass-border);
  background: var(--glass-bg-hover);
  backdrop-filter: blur(8px);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.25);
}
.rx-opt {
  border: none;
  background: transparent;
  border-radius: 8px;
  font-size: 16px;
  line-height: 1;
  padding: 4px 6px;
  cursor: pointer;
  transition: transform 0.1s ease, background 0.1s ease;
}
.rx-opt:hover { background: rgba(59, 130, 246, 0.18); transform: scale(1.15); }
.msg-reactions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}
.rx-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 7px;
  border-radius: 999px;
  border: 1px solid var(--glass-border);
  background: var(--glass-bg-hover);
  color: var(--text);
  font-size: 12px;
  line-height: 1.4;
  cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease;
}
.rx-chip:hover { border-color: var(--accent); }
.rx-chip.mine {
  border-color: var(--accent);
  background: rgba(59, 130, 246, 0.18);
}
.rx-count { font-size: 11px; font-weight: 700; color: var(--text-muted); }
.rx-chip.mine .rx-count { color: var(--accent); }
.msg-quote {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin: 3px 0 5px;
  padding: 5px 9px;
  border-left: 2px solid var(--accent);
  border-radius: 6px;
  background: var(--glass-bg-hover);
  max-width: 100%;
  overflow: hidden;
  cursor: pointer;
}
.msg-quote:hover { background: rgba(59, 130, 246, 0.12); }
.q-from {
  font-size: 10.5px;
  font-weight: 700;
  color: var(--accent);
}
.q-text {
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.reply-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 10px 6px;
  padding: 6px 10px;
  border-left: 2px solid var(--accent);
  border-radius: 7px;
  background: var(--glass-bg-hover);
}
.rb-text {
  flex: 1;
  min-width: 0;
  font-size: 11.5px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rb-text b { color: var(--accent); font-weight: 700; }
.rb-x {
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
  flex-shrink: 0;
}
.rb-x:hover { color: var(--text); }

/* ── Stickers ── */
.msg-text.sticker {
  font-size: 30px;
  line-height: 1.15;
  background: transparent;
  border: none;
  padding: 2px 0;
}
.sticker-pop {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 2px;
  margin: 0 10px 8px;
  padding: 6px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  background: var(--bg-panel-solid);
}
.sticker-cell {
  border: none;
  border-radius: 6px;
  background: transparent;
  font-size: 16px;
  line-height: 1;
  padding: 4px 0;
  cursor: pointer;
  transition: background 0.12s ease, transform 0.12s ease;
}
.sticker-cell:hover { background: var(--glass-bg-hover); transform: scale(1.15); }
</style>
