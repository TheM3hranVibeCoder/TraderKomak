<script setup lang="ts">
import { TIMEFRAMES, TIMEFRAME_SECONDS, TIMEFRAME_LABELS, type Timeframe } from "@traderkomak/shared";
import { useThemeStore } from "@/stores/theme";
import { ref, computed, onMounted, onBeforeUnmount } from "vue";

const props = defineProps<{ modelValue: Timeframe }>();
const emit = defineEmits<{ (e: "update:modelValue", value: Timeframe): void }>();

const themeStore = useThemeStore();
const open = ref(false);
const dropdownRef = ref<HTMLElement | null>(null);
const triggerRef = ref<HTMLElement | null>(null);
/** Viewport coords for the teleported menu (computed BEFORE opening so it
 *  never flashes at (0,0), and clamped so phones never cut it off). */
const pop = ref({ top: 0, left: 0 });

function toggleMenu(): void {
  if (!open.value) {
    const r = triggerRef.value?.getBoundingClientRect();
    if (r) {
      const menuW = 220;
      const left = Math.max(8, Math.min(r.left, window.innerWidth - menuW - 8));
      pop.value = { top: r.bottom + 6, left };
    }
  }
  open.value = !open.value;
}

function label(tf: Timeframe): string {
  return TIMEFRAME_LABELS[tf] ?? tf;
}

const favs = computed(() =>
  [...themeStore.favTimeframes].sort(
    (a, b) => (TIMEFRAME_SECONDS[a as Timeframe] ?? 9999) - (TIMEFRAME_SECONDS[b as Timeframe] ?? 9999)
  )
);
function isFav(tf: string) {
  return themeStore.isFavorite(tf);
}

function select(tf: Timeframe) {
  emit("update:modelValue", tf);
  open.value = false;
}

function onClickOutside(e: MouseEvent) {
  const t = e.target as Node;
  if (dropdownRef.value?.contains(t)) return;
  if (triggerRef.value?.contains(t)) return;
  open.value = false;
}
onMounted(() => document.addEventListener("click", onClickOutside));
onBeforeUnmount(() => document.removeEventListener("click", onClickOutside));
</script>

<template>
  <div class="tf-wrapper">
    <!-- Favorites quick bar (TradingView style) -->
    <div v-if="favs.length > 0" class="fav-bar">
      <button
        v-for="tf in favs"
        :key="'fav-' + tf"
        :class="['fav-btn', { active: tf === modelValue }]"
        @click="emit('update:modelValue', tf as Timeframe)"
        :title="`${tf} (favorited)`"
      >
        {{ label(tf as Timeframe) }}
      </button>
    </div>

    <!-- Dropdown for all timeframes sorted small→big. The menu TELEPORTS
         to <body>: the phone header scrolls its tools row (overflow-x),
         which would otherwise clip the menu shut. -->
    <div class="dropdown">
      <button
        ref="triggerRef"
        class="dropdown-trigger"
        @click.stop="toggleMenu"
        @keydown.esc.stop="open = false"
        :aria-expanded="open"
        aria-haspopup="listbox"
      >
        <span class="trigger-label">{{ label(modelValue) }}</span>
        <span class="trigger-caret" :class="{ open }">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </span>
      </button>

      <Teleport to="body">
        <div
          v-if="open"
          ref="dropdownRef"
          class="dropdown-menu"
          :style="{ top: pop.top + 'px', left: pop.left + 'px' }"
          @keydown.esc.stop="open = false"
        >
        <div class="menu-header">Timeframes</div>
        <button
          v-for="tf in TIMEFRAMES"
          :key="tf"
          :class="['menu-item', { active: tf === modelValue }]"
          @click="select(tf as Timeframe)"
        >
          <span class="menu-label">{{ label(tf as Timeframe) }}</span>
          <!-- span, not button: a nested <button> is invalid HTML and the
               parser splits the menu-item row in half -->
          <span
            class="menu-star"
            :class="{ starred: isFav(tf) }"
            role="button"
            tabindex="0"
            :aria-pressed="isFav(tf)"
            :aria-label="isFav(tf) ? `Remove ${tf} from favorites` : `Add ${tf} to favorites`"
            @click.stop="themeStore.toggleFavorite(tf)"
            @keydown.enter.stop.prevent="themeStore.toggleFavorite(tf)"
            @keydown.space.stop.prevent="themeStore.toggleFavorite(tf)"
          >
            {{ isFav(tf) ? "★" : "☆" }}
          </span>
        </button>
        </div>
      </Teleport>
    </div>
  </div>
</template>

<style scoped>
.tf-wrapper {
  display: flex;
  align-items: center;
  gap: 8px;
}
.fav-bar {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 3px;
  background: var(--glass-bg);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid var(--glass-border);
  border-radius: 11px;
  box-shadow: var(--card-shadow);
}
.fav-btn {
  background: transparent;
  border: none;
  color: var(--text-muted);
  padding: 6px 10px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: all 180ms;
}
.fav-btn:hover {
  background: var(--btn-bg);
  color: var(--text);
}
.fav-btn.active {
  background: var(--accent-gradient);
  color: #fff;
  box-shadow: 0 3px 12px rgba(59, 130, 246, 0.4);
}
.dropdown {
  position: relative;
}
.dropdown-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  border-radius: 11px;
  border: 1px solid var(--glass-border);
  background: var(--glass-bg);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  color: var(--text);
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
  box-shadow: var(--card-shadow);
  transition: all 180ms;
  min-width: 70px;
  justify-content: space-between;
}
.dropdown-trigger:hover {
  border-color: var(--border-strong);
  transform: translateY(-1px);
}
.trigger-caret {
  display: grid;
  place-items: center;
  line-height: 0;
  transition: transform 200ms;
  opacity: 0.7;
}
.trigger-caret svg {
  display: block;
}
.trigger-caret.open {
  transform: rotate(180deg);
}
.dropdown-menu {
  position: fixed;
  min-width: 200px;
  max-width: calc(100vw - 16px);
  background: var(--bg-panel);
  backdrop-filter: blur(22px) saturate(1.3);
  -webkit-backdrop-filter: blur(22px) saturate(1.3);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  box-shadow:
    0 18px 44px rgba(2, 6, 18, 0.35),
    0 1px 0 var(--glass-highlight) inset;
  padding: 6px;
  z-index: 50;
  animation: menuIn 180ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
@keyframes menuIn {
  from {
    opacity: 0;
    transform: translateY(-6px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
.menu-header {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
  color: var(--text-muted);
  padding: 6px 8px 4px;
  text-transform: uppercase;
}
.menu-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 8px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: var(--text);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background 150ms;
  text-align: left;
}
.menu-item:hover {
  background: var(--btn-bg);
}
.menu-item.active {
  background: var(--accent-gradient);
  color: #fff;
}
.menu-item.active .menu-meta {
  color: rgba(255, 255, 255, 0.8);
}
.menu-label {
  flex: 1;
  font-weight: 700;
}
.menu-meta {
  font-size: 10px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.menu-star {
  background: transparent;
  border: none;
  font-size: 14px;
  cursor: pointer;
  padding: 2px 6px;
  color: var(--text-muted);
  transition: all 150ms;
  border-radius: 6px;
}
.menu-star:hover {
  background: var(--btn-bg);
  transform: scale(1.15);
}
.menu-star.starred {
  color: #f59e0b;
}
/* Phones/tablets: the favorites bar alone is wider than the viewport —
   the dropdown below still carries every timeframe */
@media (max-width: 860px) {
  .fav-bar {
    display: none;
  }
}
</style>
