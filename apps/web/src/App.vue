<script setup lang="ts">
import { onMounted, onBeforeUnmount, watch, computed, ref } from "vue";
import { useMarketStore } from "@/stores/market";
import { useThemeStore } from "@/stores/theme";
import { useWatchlistStore } from "@/stores/watchlist";
import { useChatStore } from "@/stores/chat";
import { useAuthStore } from "@/stores/auth";
import { startCloudSync } from "@/services/cloudSync";
import { wasAuthOnDevice, authInFlight } from "@/stores/auth";
import { useNewsStore } from "@/stores/news";
import NewsPanel from "@/components/NewsPanel.vue";
import TopToolbar from "@/components/TopToolbar.vue";
import ChartPane from "@/components/ChartPane.vue";
import WatchlistPanel from "@/components/WatchlistPanel.vue";
import ChatPanel from "@/components/ChatPanel.vue";
import DrawingToolbar from "@/components/DrawingToolbar.vue";
import LandingPage from "@/components/LandingPage.vue";
import AuthModal from "@/components/AuthModal.vue";
import BannedPage from "@/components/BannedPage.vue";
import UserPopups from "@/components/UserPopups.vue";
import type { Timeframe } from "@traderkomak/shared";

const market = useMarketStore();
const theme = useThemeStore();
const watchlist = useWatchlistStore();
const chat = useChatStore();
const news = useNewsStore();
const auth = useAuthStore();

// Gate: charts only for signed-in users with a username picked. While the
// session is still restoring we optimistically let returning users in
// (flag survives on the device) so a refresh never flashes the landing —
// guests (no flag) get the landing instantly, nothing leaks.
const wasAuth = wasAuthOnDevice();

// Phone: the drawing-tools column and the watchlist/chat/news rail start
// collapsed so the chart gets the full width; the edge arrows toggle them.
const isPhone = ref(false);
const toolsOpen = ref(false);
const railOpen = ref(false);
function onResize(): void {
  const phone = window.innerWidth <= 640;
  if (phone && !isPhone.value) {
    toolsOpen.value = false;
    railOpen.value = false;
  }
  isPhone.value = phone;
}
onMounted(() => {
  onResize();
  window.addEventListener("resize", onResize);
});

/** Collapsing the rail on phones must also close whichever panel is open,
 *  otherwise it would hang there over the chart with its rail gone. */
function toggleRail(): void {
  railOpen.value = !railOpen.value;
  if (!railOpen.value) {
    watchlist.isOpen = false;
    chat.setOpen(false);
    news.setOpen(false);
  }
}
onBeforeUnmount(() => window.removeEventListener("resize", onResize));
const gate = computed(() => auth.status !== "ready");
/** OAuth just redirected back — show a neutral splash while the session +
 *  profile are confirmed (never the chart: the user may still be new). */
const oauthReturning = computed(() => auth.status === "loading" && authInFlight());

// Signed-in identity drives the chat nickname; re-join when it lands.
watch(
  () => [auth.status, auth.profile?.username] as const,
  ([s, uname]) => {
    if (s === "ready" && uname) {
      if (chat.nick !== uname) chat.setNick(uname);
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
  watch(gate, (blocked, was) => {
    if (!blocked) market.init();
    else if (was === false) market.destroy();
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
    <div v-if="oauthReturning" class="boot-splash" aria-hidden="true">
      <img src="/favicon.png" alt="" width="72" height="72" />
    </div>
    <LandingPage v-else-if="gate" />
    <AuthModal v-if="auth.authModalOpen" />
    <BannedPage v-if="chat.banned" />
    <UserPopups />
    <template v-if="!gate">
    <TopToolbar
      :instrument="market.instrument"
      :timeframe="market.timeframe"
      @update:instrument="onInstrumentChange"
      @update:timeframe="onTimeframeChange"
    />
    <main class="main" :class="{ 'tools-open': toolsOpen, 'rail-open': railOpen }">
      <button
        v-if="isPhone"
        class="edge-handle left"
        type="button"
        :aria-label="toolsOpen ? 'Hide drawing tools' : 'Show drawing tools'"
        :title="toolsOpen ? 'Hide drawing tools' : 'Show drawing tools'"
        @click="toolsOpen = !toolsOpen"
      >
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path :d="toolsOpen ? 'M14 6l-6 6 6 6' : 'M10 6l6 6-6 6'" />
        </svg>
      </button>
      <button
        v-if="isPhone"
        class="edge-handle right"
        type="button"
        :aria-label="railOpen ? 'Hide panels' : 'Show watchlist / chat / news'"
        @click="toggleRail"
      >
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path :d="railOpen ? 'M10 6l6 6-6 6' : 'M14 6l-6 6 6 6'" />
        </svg>
      </button>
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
.boot-splash img { animation: boot-pulse 1.1s ease-in-out infinite; }
@keyframes boot-pulse {
  0%, 100% { opacity: 0.55; transform: scale(0.96); }
  50% { opacity: 1; transform: scale(1); }
}
.edge-handle { display: none; }
@media (max-width: 640px) {
  .edge-handle {
    display: flex;
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    z-index: 56;
    width: 22px;
    height: 46px;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border);
    background: var(--bg-panel-solid);
    color: var(--text-muted);
    cursor: pointer;
    padding: 0;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25);
  }
  .edge-handle.left { left: 0; border-radius: 0 10px 10px 0; border-left: none; }
  .edge-handle.right { right: 0; border-radius: 10px 0 0 10px; border-right: none; }
  .edge-handle:active { color: var(--text); }

  /* Collapse columns: drawing tools slide away to the left, the
     watchlist/chat/news rail to the right — chart gets the full width. */
  :deep(.drawing-toolbar) {
    transition: width 280ms cubic-bezier(0.32, 0.72, 0, 1), min-width 280ms cubic-bezier(0.32, 0.72, 0, 1);
  }
  .main:not(.tools-open) :deep(.drawing-toolbar) {
    width: 0;
    min-width: 0;
    padding-left: 0;
    padding-right: 0;
    border-right-color: transparent;
    overflow: hidden;
  }
  .right-rail {
    transition: width 280ms cubic-bezier(0.32, 0.72, 0, 1), min-width 280ms cubic-bezier(0.32, 0.72, 0, 1);
    overflow: hidden;
  }
  .main:not(.rail-open) .right-rail {
    width: 0;
    min-width: 0;
    border-left-color: transparent;
  }
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
  /* News countdown pill (like the chat unread badge): shows m:ss when a
     High-impact release is < 15 min away. Visible on the rail regardless
     of which panel is open. */
  position: absolute;
  top: 2px;
  left: 50%;
  transform: translateX(-50%);
  min-width: 24px;
  padding: 1px 4px;
  border-radius: 99px;
  background: #ef4444;
  color: #fff;
  font-size: 9px;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
  z-index: 5;
  animation: alarmPulse 1s ease-in-out infinite;
}
@keyframes alarmPulse {
  50% {
    transform: translateX(-50%) scale(1.15);
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
