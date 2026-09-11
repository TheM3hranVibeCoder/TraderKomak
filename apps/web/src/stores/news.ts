import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { fetchNews, type NewsItem } from "@/services/newsService";

const OPEN_KEY = "tk-news-open";
const ALARM_WINDOW_MS = 15 * 60_000; // red alarm when a High is ≤ 15 min away
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const useNewsStore = defineStore("news", () => {
  const items = ref<NewsItem[]>([]);
  const fetchedAt = ref<number>(0);
  const open = ref<boolean>(localStorage.getItem(OPEN_KEY) === "1");
  const error = ref<string | null>(null);
  /** Local-midnight epoch of the day being viewed (index into the feed). */
  const dayOffset = ref<number>(0);

  /** 1s ticker drives all countdowns. */
  const now = ref<number>(Date.now());
  let tickTimer: ReturnType<typeof setInterval> | null = null;

  async function refresh(): Promise<void> {
    try {
      const feed = await fetchNews();
      items.value = feed.items;
      fetchedAt.value = feed.fetchedAt;
      error.value = null;
    } catch {
      error.value = "News feed unavailable";
    }
  }

  function ensureTicker(): void {
    if (tickTimer) return;
    tickTimer = setInterval(() => {
      now.value = Date.now();
    }, 1000);
  }

  function setOpen(v: boolean): void {
    open.value = v;
    localStorage.setItem(OPEN_KEY, v ? "1" : "0");
    if (v) {
      ensureTicker();
      dayOffset.value = 0; // open on today
      void refresh();
    }
  }

  // Periodic background refresh — hits OUR cached endpoint (never FF).
  async function pollLoop(): Promise<void> {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        await refresh();
      } catch {}
      await new Promise((s) => setTimeout(s, 120_000));
    }
  }
  void pollLoop();

  /** Days covered by the feed (local dates), oldest → newest. */
  const days = computed<Array<{ key: string; start: number; label: string }>>(() => {
    const map = new Map<string, { start: number; label: string }>();
    for (const it of items.value) {
      const d = new Date(it.date);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (!map.has(key)) {
        map.set(key, {
          start: new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(),
          label: `${DAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`,
        });
      }
    }
    return [...map.entries()]
      .map(([key, v]) => ({ key, start: v.start, label: v.label }))
      .sort((a, b) => a.start - b.start);
  });

  const selectedDay = computed(() => {
    const list = days.value;
    if (!list.length) return null;
    const idx = Math.min(Math.max(dayOffset.value, 0), list.length - 1);
    return list[idx];
  });

  const dayItems = computed(() => {
    const sel = selectedDay.value;
    if (!sel) return [];
    return items.value
      .filter((it) => {
        const d = new Date(it.date);
        return (
          d.getFullYear() === new Date(sel.start).getFullYear() &&
          d.getMonth() === new Date(sel.start).getMonth() &&
          d.getDate() === new Date(sel.start).getDate()
        );
      })
      .sort((a, b) => a.date - b.date);
  });

  /** Nearest upcoming HIGH-impact release — drives the rail alarm. */
  const nearestHigh = computed<NewsItem | null>(() => {
    let best: NewsItem | null = null;
    for (const it of items.value) {
      if (it.impact !== "High" || it.date <= now.value) continue;
      if (!best || it.date < best.date) best = it;
    }
    return best;
  });

  const alarmActive = computed(() => {
    const n = nearestHigh.value;
    return !!n && n.date - now.value <= ALARM_WINDOW_MS;
  });

  const alarmLabel = computed(() => {
    const n = nearestHigh.value;
    if (!n || n.date <= now.value) return "";
    const total = Math.ceil((n.date - now.value) / 1000);
    const p2 = (x: number) => String(x).padStart(2, "0");
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h > 0 ? `${p2(h)}:${p2(m)}:${p2(s)}` : `${p2(m)}:${p2(s)}`;
  });

  function shiftDay(dir: -1 | 1): void {
    const idx = Math.min(Math.max(dayOffset.value + dir, 0), Math.max(days.value.length - 1, 0));
    dayOffset.value = idx;
  }

  return {
    items,
    fetchedAt,
    open,
    error,
    now,
    days,
    selectedDay,
    dayItems,
    nearestHigh,
    alarmActive,
    alarmLabel,
    dayOffset,
    shiftDay,
    setOpen,
    refresh,
  };
});
