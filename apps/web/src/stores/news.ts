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
  /** Local-midnight epoch of the day being viewed. Tracked as a timestamp
   *  (not a feed index) so the panel opens on the REAL today — an async
   *  feed can never shift it to a neighbouring day for a moment. */
  const selectedStart = ref<number>(todayLocalStart());

  function todayLocalStart(): number {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }

  /** 1s ticker drives all countdowns and the Today label. */
  const now = ref<number>(Date.now());
  setInterval(() => {
    now.value = Date.now();
  }, 1000);

  async function refresh(): Promise<void> {
    try {
      const feed = await fetchNews();
      // An empty result (weekend rollover, transient upstream) must not
      // wipe the panel — keep showing the last known week.
      if (feed.items.length === 0) {
        error.value = "No news in the feed yet — retrying";
        return;
      }
      items.value = feed.items;
      fetchedAt.value = feed.fetchedAt;
      error.value = null;
    } catch {
      error.value = "News feed unavailable";
    }
  }

  /** Pick the day the panel opens on: TODAY if it has news, otherwise the
   *  most recent day that does, otherwise the next upcoming one. */
  function goToRelevantDay(): void {
    // Open on the real today when it has events; otherwise snap to the
    // nearest day that does (weekend rollover → the feed's first day).
    const todayStart = todayLocalStart();
    const hasItems = (start: number) =>
      items.value.some((it) => it.date >= start && it.date < start + 86_400_000);
    if (hasItems(todayStart)) {
      selectedStart.value = todayStart;
      return;
    }
    const starts = days.value.map((x) => x.start);
    if (!starts.length) return;
    if (todayStart < starts[0]!) {
      selectedStart.value = starts[0]!;
      return;
    }
    if (todayStart > starts[starts.length - 1]!) {
      selectedStart.value = starts[starts.length - 1]!;
      return;
    }
    for (let st = todayStart - 86_400_000; st >= starts[0]!; st -= 86_400_000) {
      if (hasItems(st)) {
        selectedStart.value = st;
        return;
      }
    }
    for (let st = todayStart + 86_400_000; st <= starts[starts.length - 1]!; st += 86_400_000) {
      if (hasItems(st)) {
        selectedStart.value = st;
        return;
      }
    }
    selectedStart.value = todayStart;
  }

  function setOpen(v: boolean): void {
    open.value = v;
    localStorage.setItem(OPEN_KEY, v ? "1" : "0");
    if (v) {
      void refresh().then(() => goToRelevantDay());
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
    const d = new Date(selectedStart.value);
    return {
      key: `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`,
      start: selectedStart.value,
      label: `${DAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`,
    };
  });

  const dayItems = computed(() => {
    const start = selectedStart.value;
    const end = start + 86_400_000;
    return items.value.filter((it) => it.date >= start && it.date < end).sort((a, b) => a.date - b.date);
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
    selectedStart.value += dir * 86_400_000;
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
    selectedStart,
    nearestHigh,
    alarmActive,
    alarmLabel,
    shiftDay,
    setOpen,
    goToRelevantDay,
    refresh,
  };
});
