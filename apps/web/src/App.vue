<script setup lang="ts">
import { onMounted, onBeforeUnmount, watch } from "vue";
import { useMarketStore } from "@/stores/market";
import { useThemeStore } from "@/stores/theme";
import { useWatchlistStore } from "@/stores/watchlist";
import { useChatStore } from "@/stores/chat";
import { useAuthStore } from "@/stores/auth";
import { startCloudSync } from "@/services/cloudSync";
import { useNewsStore } from "@/stores/news";
import NewsPanel from "@/components/NewsPanel.vue";
import TopToolbar from "@/components/TopToolbar.vue";
import ChartPane from "@/components/ChartPane.vue";
import WatchlistPanel from "@/components/WatchlistPanel.vue";
import ChatPanel from "@/components/ChatPanel.vue";
import DrawingToolbar from "@/components/DrawingToolbar.vue";
import LandingPage from "@/components/LandingPage.vue";
import AuthModal from "@/components/AuthModal.vue";
import { computed } from "vue";
import type { Timeframe } from "@traderkomak/shared";

const market = useMarketStore();
const theme = useThemeStore();
const watchlist = useWatchlistStore();
const chat = useChatStore();
const news = useNewsStore();
const auth = useAuthStore();

// Gate: charts only for signed-in users with a username picked. While the
// session is still restoring ("loading") we also show the landing — it
// flips to the app within a moment for returning users.
const gate = computed(() => auth.status !== "ready");

// Signed-in identity drives the chat nickname; re-join when it lands.
watch(
  () => auth.status,
  (s) => {
    if (s === "ready" && auth.profile) {
      if (chat.nick !== auth.profile.username) chat.setNick(auth.profile.username);
    } else if (s === "needs-username") {
      auth.authModalOpen = true;
    }
  }
);

// The right column shows one panel at a time
watch(
  () => chat.open,
  (open) => {
    if (open && watchlist.isOpen) watchlist.isOpen = false;
    if (open && news.open) news.setOpen(false);
  }
);
watch(
  () => watchlist.isOpen,
  (open) => {
    if (open && chat.open) chat.setOpen(false);
    if (open && news.open) news.setOpen(false);
  }
);
watch(
  () => news.open,
  (open) => {
    if (open && chat.open) chat.setOpen(false);
    if (open && watchlist.isOpen) watchlist.isOpen = false;
  }
);

function toggleChat(): void {
  chat.setOpen(!chat.open);
}

function toggleNews(): void {
  news.setOpen(!news.open);
}

onMounted(() => {
  void theme.theme;
  void auth.init();
  startCloudSync();
  // Only connect market data once the gate lets the user in.
  watch(gate, (blocked) => {
    if (!blocked) market.init();
  }, { immediate: true });
});

onBeforeUnmount(() => {
  market.destroy();
  chat.leave();
});

function onInstrumentChange(next: string): void {
  void market.setInstrument(next);
}

function onTimeframeChange(next: Timeframe): void {
  void market.setTimeframe(next);
}
</script>

<template>
  <div class="app" :data-theme="theme.theme">
    <h1 class="sr-only">TraderKomak — live forex and crypto charting platform</h1>
    <div v-if="auth.status === 'loading'" class="boot-splash" aria-hidden="true">
      <img src="/favicon.png" alt="" width="72" height="72" />
    </div>
    <LandingPage v-else-if="gate" />
    <AuthModal v-if="auth.authModalOpen" />
    <template v-else>
    <TopToolbar
      :instrument="market.instrument"
      :timeframe="market.timeframe"
      @update:instrument="onInstrumentChange"
      @update:timeframe="onTimeframeChange"
    />
    <main class="main">
      <DrawingToolbar />
      <ChartPane :candles="market.candles" :is-loading="market.isLoading" :error="market.error" :instrument="market.instrument" />
      <WatchlistPanel />
      <ChatPanel />
      <NewsPanel />
      <!-- Right rail: watchlist (top half) + live chat (bottom half) -->
      <nav class="right-rail" aria-label="Panels">
        <button
          class="rail-half"
          :class="{ active: watchlist.isOpen }"
          @click="watchlist.toggle()"
          :title="watchlist.isOpen ? 'Close watchlist' : 'Open watchlist'"
          aria-label="Toggle watchlist"
        >
          <span class="rail-lines">
            <span></span><span></span><span></span>
          </span>
        </button>
        <button
          class="rail-half"
          :class="{ active: chat.open }"
          @click="toggleChat"
          :title="chat.open ? 'Close live chat' : chat.unread > 0 ? `${chat.unread} new messages — open live chat` : 'Open live chat'"
          aria-label="Toggle live chat"
        >
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M21 12a8 8 0 0 1-8 8H5.5a1.5 1.5 0 0 1-1.06-2.56l1.2-1.2A8 8 0 1 1 21 12z" />
            <path d="M8.5 10.5h7M8.5 13.5h4.5" />
          </svg>
          <span v-if="chat.unread > 0 && !chat.open" class="unread-badge">{{ chat.unread > 99 ? '99+' : chat.unread }}</span>
        </button>
        <button
          class="rail-half news"
          :class="{ active: news.open, alarm: news.alarmActive }"
          @click="toggleNews"
          :title="news.alarmActive ? `High impact news in ${news.alarmLabel}` : 'Economic news calendar'"
          aria-label="Toggle economic news"
        >
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 8v4l2.5 2.5" />
            <circle cx="12" cy="12" r="9" />
          </svg>
          <span v-if="news.alarmActive" class="alarm-badge">{{ news.alarmLabel }}</span>
        </button>
      </nav>
    </main>
    </template>
    <footer class="sr-only">TraderKomak — traderkomak.ir</footer>
  </div>
</template>

<style scoped>
.boot-splash {
  position: fixed;
  inset: 0;
  z-index: 400;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(160deg, #f2f6ff 0%, #e9efff 45%, #f4effe 100%);
}
.boot-splash img {
  animation: boot-pulse 1.1s ease-in-out infinite;
}
@keyframes boot-pulse {
  0%, 100% { opacity: 0.55; transform: scale(0.96); }
  50% { opacity: 1; transform: scale(1); }
}
/* Screen-reader-only: present for landmarks/SEO, invisible on screen */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
nav.right-rail {
  padding: 0;
  margin: 0;
}
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  /* mobile browsers: 100vh includes the URL-bar area — dvh tracks the
     real viewport so the bottom axis isn't hidden behind browser chrome */
  height: 100dvh;
  background: var(--bg-app);
  transition: background 600ms cubic-bezier(0.4, 0, 0.2, 1);
}
.main {
  flex: 1;
  display: flex;
  min-height: 0;
  overflow: hidden;
  /* anchor for the watchlist overlay on mobile/tablet */
  position: relative;
}
.right-rail {
  width: 36px;
  min-width: 36px;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  flex-shrink: 0;
}
.rail-half {
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-watchlist);
  backdrop-filter: blur(20px) saturate(1.3);
  -webkit-backdrop-filter: blur(20px) saturate(1.3);
  border: none;
  border-left: 1px solid var(--border);
  outline: none;
  color: var(--text-muted);
  cursor: pointer;
  transition: background 200ms, color 200ms;
  flex-shrink: 0;
}
.alarm-badge {
  position: absolute;
  bottom: 3px;
  left: 1px;
  right: 1px;
  display: grid;
  place-items: center;
  border-radius: 5px;
  background: rgba(239, 68, 68, 0.95);
  color: #fff;
  font-size: 8px;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
  animation: railAlarm 1s steps(2, start) infinite;
}
@keyframes railAlarm {
  50% {
    opacity: 0.45;
  }
}
.rail-half.news.alarm {
  color: var(--offline);
}
.unread-badge {
  position: absolute;
  top: 4px;
  right: 3px;
  min-width: 15px;
  height: 15px;
  padding: 0 3px;
  display: grid;
  place-items: center;
  border-radius: 99px;
  background: #ef4444;
  color: #fff;
  font-size: 9px;
  font-weight: 900;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
}
.rail-half {
  position: relative;
}
.rail-half:first-child {
  border-bottom: 1px solid var(--border);
}
.rail-half:hover {
  color: var(--text);
}
.rail-half.active {
  color: var(--accent);
}
.rail-lines {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.rail-lines span {
  display: block;
  width: 16px;
  height: 2px;
  background: var(--text-muted);
  border-radius: 2px;
  transition: all 200ms;
}
.rail-half.active .rail-lines span {
  background: var(--accent);
}
.rail-half:hover .rail-lines span {
  background: var(--text);
}
.rail-half.active:hover .rail-lines span {
  background: var(--accent-hover);
}
</style>
