<script setup lang="ts">
import { onMounted, onBeforeUnmount } from "vue";
import { useMarketStore } from "@/stores/market";
import { useThemeStore } from "@/stores/theme";
import { useWatchlistStore } from "@/stores/watchlist";
import TopToolbar from "@/components/TopToolbar.vue";
import ChartPane from "@/components/ChartPane.vue";
import WatchlistPanel from "@/components/WatchlistPanel.vue";
import DrawingToolbar from "@/components/DrawingToolbar.vue";
import type { Timeframe } from "@traderkomak/shared";

const market = useMarketStore();
const theme = useThemeStore();
const watchlist = useWatchlistStore();

onMounted(() => {
  void theme.theme;
  market.init();
});

onBeforeUnmount(() => {
  market.destroy();
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
      <!-- Right column hamburger for watchlist -->
      <button
        class="watchlist-rail"
        :class="{ open: watchlist.isOpen }"
        @click="watchlist.toggle()"
        :title="watchlist.isOpen ? 'Close watchlist' : 'Open watchlist'"
        aria-label="Toggle watchlist"
      >
        <span class="rail-lines">
          <span></span><span></span><span></span>
        </span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--bg-app);
  transition: background 600ms cubic-bezier(0.4, 0, 0.2, 1);
}
.main {
  flex: 1;
  display: flex;
  min-height: 0;
  overflow: hidden;
}
.watchlist-rail {
  width: 36px;
  min-width: 36px;
  background: var(--bg-panel);
  border-left: 1px solid var(--border);
  border-top: none;
  border-right: none;
  border-bottom: none;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 14px;
  cursor: pointer;
  transition: background 200ms;
  flex-shrink: 0;
}
.watchlist-rail:hover {
  background: var(--btn-bg);
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
.watchlist-rail.open .rail-lines span {
  background: var(--accent);
}
.watchlist-rail:hover .rail-lines span {
  background: var(--text);
}
</style>
