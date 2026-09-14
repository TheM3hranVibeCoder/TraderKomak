<script setup lang="ts">
import { ref, nextTick, onUnmounted } from "vue";
import TimeframeSelector from "./TimeframeSelector.vue";
import { useReplayStore } from "@/stores/replay";
import { useDemoStore } from "@/stores/demo";
import { useThemeStore } from "@/stores/theme";
import { useIndicatorsStore } from "@/stores/indicators";
import { useAuthStore } from "@/stores/auth";
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
const indicators = useIndicatorsStore();
const auth = useAuthStore();

// Profile chip dropdown (username + sign out)
const profileOpen = ref(false);
const profileEl = ref<HTMLElement | null>(null);
function onProfileOutside(e: PointerEvent): void {
  if (profileEl.value && !profileEl.value.contains(e.target as Node)) profileOpen.value = false;
}
window.addEventListener("pointerdown", onProfileOutside, true);
onUnmounted(() => window.removeEventListener("pointerdown", onProfileOutside, true));

/** Indicators dropdown — Teleported to <body> because the toolbar's
 *  backdrop-filter creates a containing block that clips/anchors
 *  absolutely-positioned children wrongly (same as the line-tools flyout). */
const indOpen = ref(false);
const indBtnEl = ref<HTMLElement | null>(null);
const indPop = ref<{ top: number; left: number }>({ top: 0, left: 0 });

function toggleIndicators(): void {
  const r = indBtnEl.value?.getBoundingClientRect();
  if (r) {
    // Compute the position BEFORE opening — otherwise the pop renders one
    // frame at (0,0) and "flashes" near the header.
    const popW = 260; // .indicators-pop min-width + margin
    const left = Math.max(8, Math.min(r.left, window.innerWidth - popW));
    indPop.value = { top: r.bottom + 6, left };
  }
  indOpen.value = !indOpen.value;
}

function onWindowPointerDown(e: PointerEvent): void {
  const t = e.target as Node;
  if (indBtnEl.value?.contains(t)) return;
  if (document.querySelector(".indicators-pop")?.contains(t)) return;
  indOpen.value = false;
}
window.addEventListener("pointerdown", onWindowPointerDown, true);
onUnmounted(() => window.removeEventListener("pointerdown", onWindowPointerDown, true));

function toggleRsi(): void {
  indicators.rsiAdded = !indicators.rsiAdded;
  if (indicators.rsiAdded) indicators.rsiVisible = true;
}

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
      <!-- Account chip: sits between the brand and the symbol search -->
      <div v-if="auth.signedIn" ref="profileEl" class="profile-wrap">
        <button
          class="profile-chip"
          type="button"
          :aria-expanded="profileOpen"
          title="Account"
          @click="profileOpen = !profileOpen"
        >
          <img
            v-if="auth.profile?.avatarUrl"
            class="profile-avatar"
            :src="auth.profile.avatarUrl"
            alt=""
            referrerpolicy="no-referrer"
          />
          <span v-else class="profile-avatar profile-initial">{{
            (auth.profile?.username ?? "?").charAt(0).toUpperCase()
          }}</span>
          <span class="profile-name">{{ auth.profile?.username }}</span>
        </button>
        <div v-if="profileOpen" class="profile-pop" role="menu">
          <div class="profile-pop-head">
            <div class="profile-pop-name">{{ auth.profile?.username }}</div>
            <div class="profile-pop-mail">{{ auth.email }}</div>
          </div>
          <button class="profile-act" type="button" role="menuitem" @click="auth.signOut(); profileOpen = false">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <path d="M16 17l5-5-5-5M21 12H9" />
            </svg>
            Log out
          </button>
        </div>
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
      <!-- Indicators: opens the indicator library dropdown -->
      <button
        ref="indBtnEl"
        class="ind-btn"
        type="button"
        title="Indicators"
        aria-label="Indicators"
        aria-haspopup="true"
        :aria-expanded="indOpen"
        @click.stop="toggleIndicators"
      >
        <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
          <text x="3" y="18" font-size="15" font-weight="700" font-family="Georgia, 'Times New Roman', serif" font-style="italic" fill="currentColor">ƒx</text>
        </svg>
        <span class="ind-label">Indicators</span>
      </button>
    </div>

    <!-- Indicators dropdown (teleported: escapes the toolbar's backdrop-filter) -->
    <Teleport to="body">
      <div
        v-if="indOpen"
        class="indicators-pop"
        :style="{ top: indPop.top + 'px', left: indPop.left + 'px' }"
        role="menu"
      >
        <div class="ind-pop-title">Indicators</div>
        <button
          class="ind-item"
          type="button"
          role="menuitemcheckbox"
          :aria-checked="indicators.sessionsAdded"
          @click="indicators.sessionsAdded ? indicators.removeSessions() : indicators.addSessions()"
        >
          <span class="ind-check" :class="{ on: indicators.sessionsAdded }">
            <svg v-if="indicators.sessionsAdded" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12l5 5L20 7" /></svg>
          </span>
          <span class="ind-item-name">Sessions</span>
        </button>
        <button
          class="ind-item"
          type="button"
          role="menuitemcheckbox"
          :aria-checked="indicators.rsiAdded"
          @click="toggleRsi"
        >
          <span class="ind-check" :class="{ on: indicators.rsiAdded }">
            <svg v-if="indicators.rsiAdded" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12l5 5L20 7" /></svg>
          </span>
          <span class="ind-item-name">Relative Strength Index</span>
        </button>
      </div>
    </Teleport>

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
  padding: 10px 14px;
  background: var(--bg-toolbar);
  backdrop-filter: blur(22px) saturate(1.4);
  -webkit-backdrop-filter: blur(22px) saturate(1.4);
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
  background: linear-gradient(90deg, transparent 0%, rgba(99, 102, 241, 0.05) 50%, transparent 100%);
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
  padding-right: 10px;
  border-right: 1px solid var(--border);
  margin-right: 2px;
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
  border-radius: 9px;
  letter-spacing: 0.04em;
  box-shadow:
    0 4px 16px rgba(59, 130, 246, 0.4),
    0 1px 0 rgba(255, 255, 255, 0.35) inset;
}
.brand-name {
  font-weight: 800;
  font-size: 14px;
  letter-spacing: -0.02em;
  background: linear-gradient(120deg, var(--text) 30%, var(--accent) 75%, #8b5cf6 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  white-space: nowrap;
}
.search-box {
  position: relative;
  width: 190px;
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
  border-radius: 11px;
  border: 1px solid var(--glass-border);
  background: var(--glass-bg);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
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
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15), var(--glow-accent);
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
.profile-wrap {
  position: relative;
  flex-shrink: 0;
}
.profile-chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 34px;
  padding: 0 10px 0 5px;
  border-radius: var(--radius-md);
  border: 1px solid var(--glass-border);
  background: var(--glass-bg);
  color: var(--text);
  cursor: pointer;
  transition: all 200ms;
  max-width: 170px;
}
.profile-chip:hover { background: var(--btn-hover); }
.profile-avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}
.profile-initial {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--accent-gradient);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
}
.profile-name {
  font-size: 12.5px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.profile-pop {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  min-width: 200px;
  padding: 6px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  background: var(--bg-panel-solid);
  box-shadow: var(--card-shadow);
  z-index: 60;
}
.profile-pop-head {
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 4px;
}
.profile-pop-name {
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
}
.profile-pop-mail {
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.profile-act {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-muted);
  font-size: 12.5px;
  cursor: pointer;
}
.profile-act:hover { background: var(--btn-hover); color: var(--offline); }
.telegram-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 34px;
  border-radius: var(--radius-md);
  border: 1px solid var(--glass-border);
  background: var(--glass-bg);
  color: var(--text-muted);
  cursor: pointer;
  transition: all 200ms;
  flex-shrink: 0;
}
.telegram-btn:hover {
  border-color: #2aabee;
  color: #2aabee;
  background: var(--btn-bg);
  box-shadow: 0 4px 14px rgba(42, 171, 238, 0.25);
}
.theme-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* align with the 36px watchlist rail below (cancels the toolbar padding) */
  margin-right: -14px;
  width: 36px;
  height: 34px;
  border-radius: var(--radius-md);
  border: 1px solid var(--glass-border);
  background: var(--glass-bg);
  cursor: pointer;
  transition: all 200ms;
  font-size: 14px;
  flex-shrink: 0;
}
.theme-btn:hover {
  border-color: var(--border-strong);
  background: var(--btn-hover);
  box-shadow: var(--card-shadow);
}
/* Dark mode: panel-colored bg + hairline border vanish against the
   toolbar gradient — brighten the border and lift the surface so the
   button stays visible */
.theme-btn.dark {
  border-color: var(--glass-border);
  background: var(--glass-bg);
  color: #f1c40f;
}
.theme-btn.dark:hover {
  border-color: var(--border-strong);
  background: var(--btn-hover);
}
.demo-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 13px;
  border-radius: 11px;
  border: 1px solid var(--glass-border);
  background: var(--glass-bg);
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
  border-color: rgba(45, 212, 167, 0.55);
  color: var(--live);
  box-shadow: 0 6px 18px rgba(45, 212, 167, 0.18);
}
.demo-btn.active {
  background: linear-gradient(135deg, #10b981, #0d9488);
  border-color: transparent;
  color: #fff;
  box-shadow: 0 4px 16px rgba(16, 185, 129, 0.4);
}
.replay-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 13px;
  border-radius: 11px;
  border: 1px solid var(--glass-border);
  background: var(--glass-bg);
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
  box-shadow: var(--glow-accent);
}
.replay-btn.active {
  background: var(--accent-gradient);
  border-color: transparent;
  color: #fff;
  box-shadow: 0 4px 16px rgba(59, 130, 246, 0.4);
}
.ind-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 13px;
  border-radius: 11px;
  border: 1px solid var(--glass-border);
  background: var(--glass-bg);
  color: var(--text);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: var(--card-shadow);
  transition: all 200ms;
  flex-shrink: 0;
  white-space: nowrap;
}
.ind-btn:hover {
  transform: translateY(-1px);
  border-color: var(--accent);
  color: var(--accent);
  box-shadow: var(--glow-accent);
}
.ind-btn.active {
  border-color: var(--accent);
  color: var(--accent);
}
.indicators-pop {
  position: fixed;
  z-index: 300;
  min-width: 250px;
  padding: 6px;
  border-radius: 12px;
  border: 1px solid var(--glass-border);
  background: var(--bg-panel, #171b26);
  backdrop-filter: blur(22px) saturate(1.4);
  -webkit-backdrop-filter: blur(22px) saturate(1.4);
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.35);
}
.ind-pop-title {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
  padding: 6px 8px 4px;
}
.ind-item {
  display: grid;
  grid-template-columns: auto 1fr;
  grid-template-areas: "check name" "check desc";
  align-items: center;
  column-gap: 9px;
  width: 100%;
  padding: 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
  text-align: left;
}
.ind-item:hover {
  background: var(--btn-hover);
}
.ind-check {
  grid-area: check;
  width: 16px;
  height: 16px;
  display: grid;
  place-items: center;
  border-radius: 5px;
  border: 1.5px solid var(--border-strong);
  color: #fff;
}
.ind-check.on {
  background: var(--accent, #3b82f6);
  border-color: var(--accent, #3b82f6);
}
.ind-item-name {
  grid-area: name;
  font-weight: 700;
}
.ind-item-desc {
  grid-area: desc;
  font-size: 10px;
  color: var(--text-muted);
  margin-top: 1px;
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
  /* Phone header: a two-column grid — the tool group wraps on the left,
     the Telegram/theme icons sit as a tidy aligned column on the right
     (with flex-wrap they used to scatter across rows, misaligned). */
  .toolbar {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 8px 10px;
    padding: 8px 10px;
  }
  .left {
    grid-column: 1;
    grid-row: 1;
    flex-wrap: wrap;
    row-gap: 8px;
  }
  .right {
    grid-column: 2;
    grid-row: 1;
    flex-direction: column;
    gap: 8px;
  }
  .telegram-btn,
  .theme-btn {
    height: 40px;
    justify-content: center;
  }
  /* brand mark keeps the identity, the name frees the row */
  .brand-name {
    display: none;
  }
  .search-box {
    min-width: 110px;
  }
  .demo-btn span,
  .replay-btn span,
  .ind-label {
    display: none;
  }
  .demo-btn,
  .replay-btn,
  .ind-btn {
    padding: 0 10px;
    height: 40px; /* comfortable tap target on touch screens */
  }
  /* the dropdown spans nearly the full width so items are easy to tap */
  .indicators-pop {
    min-width: 220px;
    max-width: calc(100vw - 16px);
  }
  .ind-item {
    padding: 12px 10px; /* taller menu rows for touch */
  }
}
</style>
