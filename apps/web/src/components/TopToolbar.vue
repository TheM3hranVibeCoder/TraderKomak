<script setup lang="ts">
import { ref } from "vue";
import TimeframeSelector from "./TimeframeSelector.vue";
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

const themeStore = useThemeStore();

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
        <span class="search-icon">⌕</span>
        <input
          v-model="search"
          @keydown.enter="onSearchEnter"
          @blur="onSearchBlur"
          :placeholder="props.instrument.replace('_', '').toLowerCase()"
          class="search-input"
        />
        <button v-if="search" class="search-clear" @click="search = ''">✕</button>
      </div>
      <TimeframeSelector :model-value="timeframe" @update:model-value="emit('update:timeframe', $event)" />
    </div>

    <div class="right">
      <button
        class="theme-btn"
        type="button"
        :class="themeStore.theme"
        @click="themeStore.toggle()"
        :title="`Switch to ${themeStore.theme === 'dark' ? 'light' : 'dark'} mode`"
        aria-label="Toggle theme"
      >
        <span v-if="themeStore.theme === 'dark'" class="theme-icon">☀️</span>
        <span v-else class="theme-icon">🌙</span>
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
  border-bottom: 1px solid var(--border);
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
  font-size: 13px;
  pointer-events: none;
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
.theme-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--bg-panel);
  cursor: pointer;
  box-shadow: var(--card-shadow);
  transition: all 200ms;
  font-size: 14px;
  flex-shrink: 0;
}
.theme-btn:hover {
  transform: translateY(-1px);
  border-color: var(--border-strong);
}
@media (max-width: 720px) {
  .toolbar {
    padding: 6px 8px;
    gap: 8px;
  }
  .search-box {
    width: 120px;
  }
}
</style>
