<script setup lang="ts">
import { TIMEFRAMES, TIMEFRAME_SECONDS, type Timeframe } from "@traderkomak/shared";
import { useThemeStore } from "@/stores/theme";
import { ref, computed, onMounted, onBeforeUnmount } from "vue";

const props = defineProps<{ modelValue: Timeframe }>();
const emit = defineEmits<{ (e: "update:modelValue", value: Timeframe): void }>();

const themeStore = useThemeStore();
const open = ref(false);
const dropdownRef = ref<HTMLElement | null>(null);

function label(tf: Timeframe): string {
  return tf;
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
  if (!dropdownRef.value) return;
  if (!dropdownRef.value.contains(e.target as Node)) open.value = false;
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

    <!-- Dropdown for all timeframes sorted small→big -->
    <div class="dropdown" ref="dropdownRef">
      <button class="dropdown-trigger" @click.stop="open = !open" :aria-expanded="open">
        <span class="trigger-label">{{ label(modelValue) }}</span>
        <span class="trigger-caret" :class="{ open }">▾</span>
      </button>

      <div v-if="open" class="dropdown-menu">
        <div class="menu-header">Timeframes</div>
        <button
          v-for="tf in TIMEFRAMES"
          :key="tf"
          :class="['menu-item', { active: tf === modelValue }]"
          @click="select(tf as Timeframe)"
        >
          <span class="menu-label">{{ label(tf as Timeframe) }}</span>
          <button
            class="menu-star"
            :class="{ starred: isFav(tf) }"
            @click.stop="themeStore.toggleFavorite(tf)"
            :title="isFav(tf) ? 'Remove from favorites' : 'Add to favorites'"
          >
            {{ isFav(tf) ? "★" : "☆" }}
          </button>
        </button>
      </div>
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
  gap: 4px;
  padding: 3px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 10px;
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
  box-shadow: 0 3px 10px rgba(41, 98, 255, 0.3);
}
.dropdown {
  position: relative;
}
.dropdown-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--bg-panel);
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
  font-size: 10px;
  transition: transform 200ms;
  opacity: 0.7;
}
.trigger-caret.open {
  transform: rotate(180deg);
}
.dropdown-menu {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  min-width: 200px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow:
    0 12px 32px rgba(0, 0, 0, 0.15),
    0 1px 0 rgba(255, 255, 255, 0.04) inset;
  padding: 6px;
  z-index: 50;
  backdrop-filter: blur(16px);
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
</style>
