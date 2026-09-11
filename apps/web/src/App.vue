<script setup lang="ts">
import { onMounted, onBeforeUnmount, watch } from "vue";
import { useMarketStore } from "@/stores/market";
import { useThemeStore } from "@/stores/theme";
import { useWatchlistStore } from "@/stores/watchlist";
import { useChatStore } from "@/stores/chat";
import TopToolbar from "@/components/TopToolbar.vue";
import ChartPane from "@/components/ChartPane.vue";
import WatchlistPanel from "@/components/WatchlistPanel.vue";
import ChatPanel from "@/components/ChatPanel.vue";
import DrawingToolbar from "@/components/DrawingToolbar.vue";
import type { Timeframe } from "@traderkomak/shared";

const market = useMarketStore();
const theme = useThemeStore();
const watchlist = useWatchlistStore();
const chat = useChatStore();

// The right column shows one panel at a time
watch(
  () => chat.open,
  (open) => {
    if (open && watchlist.isOpen) watchlist.isOpen = false;
  }
);
watch(
  () => watchlist.isOpen,
  (open) => {
    if (open && chat.open) chat.setOpen(false);
  }
);

function toggleChat(): void {
  chat.setOpen(!chat.open);
}

onMounted(() => {
  void theme.theme;
  market.init();
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
    <TopToolbar
      :instrument="market.instrument"
      :timeframe="market.timeframe"
      @update:instrument="onInstrumentChange"
      @update:timeframe="onTimeframeChange"
    />
    <div class="main">
      <DrawingToolbar />
      <ChartPane :candles="market.candles" :is-loading="market.isLoading" :error="market.error" :instrument="market.instrument" />
      <WatchlistPanel />
      <ChatPanel />
      <!-- Right rail: watchlist (top half) + live chat (bottom half) -->
      <div class="right-rail">
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
      </div>
    </div>
  </div>
</template>

<style scoped>
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
