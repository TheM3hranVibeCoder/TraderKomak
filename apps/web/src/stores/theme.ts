import { defineStore } from "pinia";
import { ref, watch } from "vue";
import { TIMEFRAME_SECONDS } from "@traderkomak/shared";

export type Theme = "dark" | "light";

const STORAGE_KEY = "tk-theme";
const FAV_KEY = "tk-fav-timeframes";

function getInitialTheme(): Theme {
  const saved = localStorage.getItem(STORAGE_KEY) as Theme | null;
  if (saved === "dark" || saved === "light") return saved;
  // Prefer dark for trading, but respect system
  if (window.matchMedia?.("(prefers-color-scheme: light)").matches) return "light";
  return "dark";
}

export const useThemeStore = defineStore("theme", () => {
  const theme = ref<Theme>(getInitialTheme());
  const favTimeframes = ref<string[]>( (() => {
    let initial: string[] = ["5s", "1m"];
    try {
      const raw = localStorage.getItem(FAV_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) initial = parsed.filter((x) => typeof x === "string");
      }
    } catch {}
    initial.sort((a, b) => {
      const sa = (TIMEFRAME_SECONDS as Record<string, number>)[a] ?? 9999;
      const sb = (TIMEFRAME_SECONDS as Record<string, number>)[b] ?? 9999;
      return sa - sb;
    });
    return initial;
  })());

  function apply() {
    document.documentElement.setAttribute("data-theme", theme.value);
    document.documentElement.classList.remove("theme-dark", "theme-light");
    document.documentElement.classList.add(`theme-${theme.value}`);
    localStorage.setItem(STORAGE_KEY, theme.value);
  }

  watch(theme, apply, { immediate: true });

  function toggle() {
    theme.value = theme.value === "dark" ? "light" : "dark";
    // Ensure immediate apply even if watcher is lagging (e.g. during HMR)
    apply();
  }

  function setTheme(t: Theme) {
    theme.value = t;
    apply();
  }

  function toggleFavorite(tf: string) {
    const idx = favTimeframes.value.indexOf(tf);
    if (idx >= 0) favTimeframes.value.splice(idx, 1);
    else favTimeframes.value.push(tf);
    // Keep favorites sorted small → big (1s → 1h) left to right
    favTimeframes.value.sort((a, b) => {
      const sa = (TIMEFRAME_SECONDS as Record<string, number>)[a] ?? 9999;
      const sb = (TIMEFRAME_SECONDS as Record<string, number>)[b] ?? 9999;
      return sa - sb;
    });
    localStorage.setItem(FAV_KEY, JSON.stringify(favTimeframes.value));
    favTimeframes.value = [...favTimeframes.value];
  }

  function isFavorite(tf: string) {
    return favTimeframes.value.includes(tf);
  }

  // Persist favorites
  watch(
    favTimeframes,
    (v) => {
      localStorage.setItem(FAV_KEY, JSON.stringify(v));
    },
    { deep: true }
  );

  return { theme, toggle, setTheme, favTimeframes, toggleFavorite, isFavorite };
});
