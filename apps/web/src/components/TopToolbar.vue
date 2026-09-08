<script setup lang="ts">
import { ref } from "vue";
import TimeframeSelector from "./TimeframeSelector.vue";
import { useReplayStore } from "@/stores/replay";
import { useDemoStore } from "@/stores/demo";
import { useThemeStore } from "@/stores/theme";
import { SUPPORTED_INSTRUMENTS, normalizeInstrument } from "@traderkomak/shared";
import type { Timeframe } from "@traderkomak/shared";

const props = defineProps<{
  instrument: string;
  timeframe: Timeframe;
}>();

const emit = defineEmits<{
  (e: "update:instrument", value: string): void;
  (e: "update:timeframe", value: Timeframe): void;
}>();

const replay = useReplayStore();
const demo = useDemoStore();
const themeStore = useThemeStore();

function toggleDemo(): void {
  demo.active = !demo.active;
}

function toggleReplay(): void {
  if (replay.active) replay.exit();
  else replay.begin();
}

const search = ref("");

function onSearchEnter() {
  const q = search.value.trim();
  if (!q) return;
  const norm = normalizeInstrument(q);
  const exact = SUPPORTED_INSTRUMENTS.find((s) => normalizeInstrument(s) === norm);
  if (exact) {
    emit("update:instrument", normalizeInstrument(exact));
  } else {
    // Try to find partial match
    const upper = q.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const found = SUPPORTED_INSTRUMENTS.find((s) => s.replace("_", "").includes(upper));
    if (found) emit("update:instrument", found);
  }
  search.value = "";
}

function onSearchBlur() {
  // Keep for future, no dropdown now
}
</script>

<template>
  <header class="toolbar">
    <div class="left">
      <div class="brand">
        <span class="brand-name">TraderKomak</span>
      </div>
      <div class="search-box">
        <span class="search-icon">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
        </span>
        <input
          v-model="search"
          type="text"
          autocomplete="off"
          spellcheck="false"
          aria-label="Search symbol"
          @keydown.enter="onSearchEnter"
          @blur="onSearchBlur"
          :placeholder="props.instrument.replace('_', '').toLowerCase()"
          class="search-input"
        />
        <button v-if="search" class="search-clear" type="button" aria-label="Clear search" @click="search = ''">✕</button>
      </div>
      <TimeframeSelector :model-value="timeframe" @update:model-value="emit('update:timeframe', $event)" />
      <!-- Replay mode: pick a point on the chart, hide the right side, then
           play the candles forward bar-by-bar -->
      <button
        class="demo-btn"
        type="button"
        :class="{ active: demo.active }"
        title="Demo trading — 00,000 paper account"
        aria-label="Toggle demo trading"
        @click="toggleDemo"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
          <rect x="3" y="5" width="18" height="14" rx="2.5" />
          <path d="M3 9.5h18" />
          <path d="M7 15.5h4" />
        </svg>
        <span>Demo</span>
      </button>
      <button
        class="replay-btn"
        type="button"
        :class="{ active: replay.active }"
        :title="replay.active ? 'Exit replay mode' : 'Replay mode — click a candle to start'"
        aria-label="Toggle replay mode"
        @click="toggleReplay"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
          <path d="M20 12a8 8 0 1 1-2.34-5.66" />
          <path d="M20.5 3.5v4h-4" stroke-linejoin="round" />
          <path d="M10.4 8.9L15.4 12l-5 3.1z" fill="currentColor" stroke="none" />
        </svg>
        <span>Replay</span>
      </button>
    </div>

    <div class="right">
      <!-- Telegram channel link -->
      <a
        class="telegram-btn"
        href="https://t.me/TraderKomak_ir"
        target="_blank"
        rel="noopener noreferrer"
        title="Join our Telegram channel"
        aria-label="TraderKomak on Telegram (opens in a new tab)"
      >
        <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden="true">
          <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
        </svg>
      </a>
      <!-- theme toggle: in the header, exactly above the watchlist rail -->
      <button
        class="theme-btn"
        type="button"
        :class="themeStore.theme"
        @click="themeStore.toggle()"
        :title="`Switch to ${themeStore.theme === 'dark' ? 'light' : 'dark'} mode`"
        aria-label="Toggle theme"
      >
        <!-- SVG instead of emoji: matches the toolbar's stroke-icon family
             and renders identically on every platform -->
        <span v-if="themeStore.theme === 'dark'" class="theme-icon">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M18.7 5.3l-1.8 1.8M7.1 16.9l-1.8 1.8" />
          </svg>
        </span>
        <span v-else class="theme-icon">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11z" />
          </svg>
        </span>
      </button>
    </div>
  </header>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  background: var(--bg-toolbar);
  backdrop-filter: blur(16px) saturate(1.2);
  border-bottom: none;
  box-shadow: var(--toolbar-shadow);
  flex-shrink: 0;
  flex-wrap: wrap;
  position: relative;
  z-index: 20;
}
.toolbar::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent 0%, rgba(41, 98, 255, 0.03) 50%, transparent 100%);
  pointer-events: none;
}
.left,
.right {
  display: flex;
  align-items: center;
  gap: 10px;
  position: relative;
  z-index: 1;
}
.left {
  flex: 1;
  gap: 12px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.brand-mark {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  background: var(--accent-gradient);
  color: #fff;
  font-weight: 900;
  font-size: 12px;
  border-radius: 8px;
  letter-spacing: 0.04em;
  box-shadow:
    0 3px 12px rgba(41, 98, 255, 0.35),
    0 1px 0 rgba(255, 255, 255, 0.2) inset;
}
.brand-name {
  font-weight: 800;
  font-size: 14px;
  letter-spacing: -0.02em;
  color: var(--text);
  white-space: nowrap;
}
.search-box {
  position: relative;
  width: 180px;
  flex-shrink: 0;
}
.search-icon {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-muted);
  display: grid;
  place-items: center;
  pointer-events: none;
}
.search-icon svg {
  display: block;
}
.theme-icon {
  display: grid;
  place-items: center;
  line-height: 0;
  color: var(--text);
}
.search-input {
  width: 100%;
  padding: 8px 30px 8px 30px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--bg-panel);
  color: var(--text);
  font-size: 12px;
  font-weight: 700;
  outline: none;
  transition: all 180ms;
  box-shadow: var(--card-shadow);
  text-transform: lowercase;
}
.search-input::placeholder {
  color: var(--text-muted);
  opacity: 0.9;
  text-transform: lowercase;
}
.search-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(41, 98, 255, 0.12);
}
.search-clear {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  background: var(--btn-bg);
  border: none;
  border-radius: 50%;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 9px;
}
/* extend the 18px visual dot to a 26px+ hit target */
.search-clear::after {
  content: "";
  position: absolute;
  inset: -4px;
  border-radius: 50%;
}
.telegram-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 34px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg-panel);
  color: var(--text-muted);
  cursor: pointer;
  transition: all 200ms;
  flex-shrink: 0;
}
.telegram-btn:hover {
  border-color: #2aabee;
  color: #2aabee;
  background: var(--btn-bg);
}
.theme-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* align with the 36px watchlist rail below (cancels the toolbar padding) */
  margin-right: -12px;
  width: 36px;
  height: 34px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg-panel);
  cursor: pointer;
  transition: all 200ms;
  font-size: 14px;
  flex-shrink: 0;
}
.theme-btn:hover {
  border-color: var(--border-strong);
  background: var(--btn-bg);
}
/* Dark mode: panel-colored bg + hairline border vanish against the
   toolbar gradient — brighten the border and lift the surface so the
   button stays visible */
.theme-btn.dark {
  border-color: #3a4155;
  background: #1c2233;
  color: #f1c40f;
}
.theme-btn.dark:hover {
  border-color: #4a5470;
  background: #232b40;
}
.demo-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 12px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--bg-panel);
  color: var(--text);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: var(--card-shadow);
  transition: all 200ms;
  flex-shrink: 0;
  white-space: nowrap;
}
.demo-btn:hover {
  transform: translateY(-1px);
  border-color: #26a69a;
  color: #26a69a;
}
.demo-btn.active {
  background: linear-gradient(135deg, #26a69a, #1b8a80);
  border-color: transparent;
  color: #fff;
  box-shadow: 0 3px 12px rgba(38, 166, 154, 0.35);
}
.replay-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 12px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--bg-panel);
  color: var(--text);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: var(--card-shadow);
  transition: all 200ms;
  flex-shrink: 0;
  white-space: nowrap;
}
.replay-btn:hover {
  transform: translateY(-1px);
  border-color: var(--accent);
  color: var(--accent);
}
.replay-btn.active {
  background: var(--accent-gradient);
  border-color: transparent;
  color: #fff;
  box-shadow: 0 3px 12px rgba(41, 98, 255, 0.35);
}
@media (max-width: 860px) {
  .toolbar {
    padding: 6px 8px;
    gap: 8px;
  }
  .left {
    gap: 8px;
  }
  /* search flexes into the freed space instead of a fixed width */
  .search-box {
    flex: 1;
    min-width: 90px;
    width: auto;
  }
}
@media (max-width: 640px) {
  /* brand mark keeps the identity, the name frees the row */
  .brand-name {
    display: none;
  }
  .demo-btn span,
  .replay-btn span {
    display: none;
  }
  .demo-btn,
  .replay-btn {
    padding: 0 9px;
  }
}
</style>
