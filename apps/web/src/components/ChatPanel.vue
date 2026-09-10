<script setup lang="ts">
import { ref, nextTick, watch, onMounted, onBeforeUnmount } from "vue";
import { useChatStore } from "@/stores/chat";
import { compressImage } from "@/utils/image";

const chat = useChatStore();

const draft = ref("");
const nickDraft = ref("");
const lightbox = ref<string | null>(null);
const listEl = ref<HTMLElement | null>(null);
const inputEl = ref<HTMLInputElement | null>(null);
const fileEl = ref<HTMLInputElement | null>(null);
let errorTimer: ReturnType<typeof setTimeout> | null = null;

const statusLabel: Record<string, string> = {
  connected: "Live",
  connecting: "Connecting…",
  reconnecting: "Reconnecting…",
  offline: "Offline",
};

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

watch(
  () => [chat.messages.length, chat.open],
  () => {
    if (chat.open) scrollTop();
  }
);

watch(
  () => chat.open,
  (open) => {
    if (open) {
      chat.ensureClient();
      void nextTick(() => (chat.nick ? inputEl.value?.focus() : nickDraft.value && null));
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
  if (chat.sendText(draft.value)) {
    draft.value = "";
    scrollTop();
  }
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
  void compressImage(file).then((dataUrl) => {
    if (chat.sendImage(dataUrl)) scrollTop();
  });
}

function onFileChange(e: Event): void {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  void compressImage(file).then((dataUrl) => {
    if (chat.sendImage(dataUrl)) scrollTop();
  });
}

function openImage(src: string): void {
  lightbox.value = src;
}
function closeLightbox(): void {
  lightbox.value = null;
}

function closePanel(): void {
  chat.setOpen(false);
}

function fmtError(msg: string): string {
  errorTimer && clearTimeout(errorTimer);
  return msg;
}

onMounted(() => {
  if (chat.open) chat.ensureClient();
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
        <span class="chat-online" :class="chat.status">
          <span class="dot" :class="chat.status"></span>
          {{ chat.online }} online · {{ statusLabel[chat.status] ?? chat.status }}
        </span>
        <button class="chat-close" title="Close chat" aria-label="Close chat" @click="closePanel">✕</button>
      </div>

      <!-- Nickname gate -->
      <div v-if="!chat.nick" class="nick-gate">
        <p class="nick-hint">Pick a nickname to join the public room — talk charts, share screenshots and trade ideas.</p>
        <div class="nick-row">
          <input
            v-model="nickDraft"
            class="nick-input"
            type="text"
            maxlength="20"
            placeholder="Your nickname"
            aria-label="Choose a nickname"
            @keydown.enter="confirmNick"
          />
          <button class="nick-go" @click="confirmNick">Join</button>
        </div>
        <p v-if="chat.error" class="chat-error">{{ fmtError(chat.error) }}</p>
        <p class="nick-note">Signals and ideas shared here come from other users — not financial advice. Be kind, no spam.</p>
      </div>

      <!-- Conversation -->
      <template v-else>
        <div ref="listEl" class="chat-list">
          <div v-for="m in chat.messages" :key="m.id" class="msg" :class="{ system: m.from === '' }">
            <template v-if="m.from === ''">
              <span class="sys-text">— {{ m.text }} —</span>
            </template>
            <template v-else>
              <div class="msg-head">
                <span class="msg-from">{{ m.from }}</span>
                <span class="msg-time">{{ timeLabel(m.ts) }}</span>
                <button
                  v-if="chat.isAdmin"
                  class="msg-del"
                  title="Delete message (admin)"
                  @click="chat.deleteMessage(m.id)"
                >✕</button>
              </div>
              <div v-if="m.text" class="msg-text">{{ m.text }}</div>
              <img
                v-if="m.img"
                :src="m.img"
                class="msg-img"
                alt="shared chart"
                loading="lazy"
                @click="openImage(m.img!)"
              />
            </template>
          </div>
        </div>

        <p v-if="chat.error" class="chat-error">{{ fmtError(chat.error) }}</p>

        <div class="chat-input-row">
          <button class="attach" title="Attach a chart screenshot" aria-label="Attach image" @click="fileEl?.click()">
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
            placeholder="Message the room…"
            aria-label="Chat message"
            @keydown="onKeydown"
            @paste="onPaste"
          />
          <button class="send" title="Send" aria-label="Send message" @click="send">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M4 12l16-8-6 8 6 8z" />
            </svg>
          </button>
          <input ref="fileEl" type="file" accept="image/*" class="file-hidden" @change="onFileChange" />
        </div>
      </template>
    </div>

    <!-- Full-size image lightbox -->
    <div v-if="lightbox" class="lightbox" @click="closeLightbox">
      <img :src="lightbox" alt="shared chart (full size)" />
    </div>
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
.msg-img {
  display: block;
  margin-top: 6px;
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
/* Phones: overlay like the watchlist */
@media (max-width: 768px) {
  .chat-panel.open {
    position: absolute;
    top: 0;
    right: 36px;
    bottom: 0;
    width: min(320px, calc(100vw - 60px));
    min-width: min(320px, calc(100vw - 60px));
    z-index: 30;
    border-left: 1px solid var(--border);
    box-shadow: -12px 0 28px rgba(0, 0, 0, 0.28);
  }
}
</style>
