/** Per-account cloud sync of chart state via the Supabase `user_settings`
 *  table (one JSONB row per user): drawings, watchlist symbols and the
 *  last instrument/timeframe. Local storage stays the offline cache; the
 *  cloud copy wins on login if it exists, otherwise the local one is
 *  pushed up. Changes are debounced-upserted while the user works. */
import { watch } from "vue";
import { isInstrument, isTimeframe } from "@traderkomak/shared";
import type { Timeframe } from "@traderkomak/shared";
import { supabase, supabaseReady } from "./supabase";
import { useAuthStore } from "@/stores/auth";
import { useWatchlistStore } from "@/stores/watchlist";
import { useDrawingsStore } from "@/stores/drawings";
import { useMarketStore } from "@/stores/market";
import { useIndicatorsStore } from "@/stores/indicators";

interface CloudData {
  indicators?: Record<string, Record<string, boolean>>;
  indicatorSettings?: Record<string, unknown>;
  chart?: {
    style?: Record<string, unknown> | null;
    templates?: unknown;
  };
  drawings?: {
    rects?: Record<string, unknown[]>;
    lines?: Record<string, unknown[]>;
    polys?: Record<string, unknown[]>;
    positions?: Record<string, unknown[]>;
    singles?: Record<string, Record<string, unknown[]>>;
  };
  watchlist?: string[];
  instrument?: string;
  timeframe?: string;
}

const PUSH_DEBOUNCE_MS = 1500;
let started = false;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let applying = false;
/** App boot time — symbol/timeframe restore is a BOOT-ONLY convenience.
 *  On flaky links the user_settings fetch lands minutes late and applying
 *  it then yanks the user off whatever they're watching (reported as "the
 *  chart switched to 5m by itself"). */
const bootAt = Date.now();
const RESTORE_WINDOW_MS = 15_000;
/** Last time the user changed anything locally. When pushes fail (flaky
 *  links drop the upsert), the cloud row goes stale — without this stamp
 *  the stale row wins on the next boot and reverts the user's timeframe /
 *  indicators (reported as "1h after refresh" and "SMA/EMA appear by
 *  themselves"). Newer side wins, period. */
const LOCAL_CHANGE_KEY = "tk-cloud-local-change-at";

function markLocalChange(): void {
  try { localStorage.setItem(LOCAL_CHANGE_KEY, String(Date.now())); } catch {}
}

function snapshot(): CloudData {
  const d = useDrawingsStore();
  const w = useWatchlistStore();
  const m = useMarketStore();
  const indStore = useIndicatorsStore();
  return {
    indicators: JSON.parse(JSON.stringify(indStore.addedMap)) as Record<string, Record<string, boolean>>,
    indicatorSettings: JSON.parse(JSON.stringify(indStore.settingsSnapshot())) as Record<string, unknown>,
    chart: {
      style: JSON.parse(localStorage.getItem("tk-chart-style") ?? "null") as Record<string, unknown> | null,
      templates: JSON.parse(localStorage.getItem("tk-chart-templates") ?? "null") as unknown,
    },
    drawings: {
      rects: JSON.parse(JSON.stringify(d.drawings)),
      lines: JSON.parse(JSON.stringify(d.lines)),
      polys: JSON.parse(JSON.stringify(d.polys)),
      positions: JSON.parse(JSON.stringify(d.positions)),
      singles: JSON.parse(JSON.stringify(d.singles)),
    },
    watchlist: [...w.instruments],
    instrument: m.instrument,
    timeframe: m.timeframe,
  };
}

async function push(userId: string, retried = false): Promise<void> {
  const payload = snapshot();
  const { error } = await supabase()
    .from("user_settings")
    .upsert({ user_id: userId, data: payload, updated_at: new Date().toISOString() });
  if (error) {
    console.error("cloud push failed", error);
    // One quiet retry — flaky links drop the upsert, and a stale cloud row
    // would otherwise win on the next boot.
    if (!retried) setTimeout(() => { void push(userId, true); }, 3000);
  }
}

function schedulePush(userId: string): void {
  // Stamp FIRST (before the debounce): the timestamp must survive even if
  // the push itself never makes it out.
  markLocalChange();
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void push(userId);
  }, PUSH_DEBOUNCE_MS);
}

function applyLocal(cloud: CloudData): void {
  applying = true;
  try {
    const d = useDrawingsStore();
    const w = useWatchlistStore();
    const m = useMarketStore();

    const ind = useIndicatorsStore();
    if (cloud.indicators && typeof cloud.indicators === "object") {
      ind.setAddedMap(cloud.indicators);
    }
    if (cloud.indicatorSettings && typeof cloud.indicatorSettings === "object") {
      ind.applySettings(cloud.indicatorSettings);
    }

    if (cloud.chart && typeof cloud.chart === "object") {
      if (cloud.chart.style && typeof cloud.chart.style === "object") {
        try {
          localStorage.setItem("tk-chart-style", JSON.stringify(cloud.chart.style));
          // ChartPane reloads its style/templates on this event.
          window.dispatchEvent(new CustomEvent("tk-chart-style"));
        } catch {}
      }
      if (Array.isArray(cloud.chart.templates)) {
        try { localStorage.setItem("tk-chart-templates", JSON.stringify(cloud.chart.templates)); } catch {}
      }
    }

    if (cloud.drawings && typeof cloud.drawings === "object") {
      const src = cloud.drawings;
      if (src.rects && typeof src.rects === "object") d.drawings = src.rects as typeof d.drawings;
      if (src.lines && typeof src.lines === "object") d.lines = src.lines as typeof d.lines;
      if (src.polys && typeof src.polys === "object") d.polys = src.polys as typeof d.polys;
      if (src.positions && typeof src.positions === "object") d.positions = src.positions as typeof d.positions;
      if (src.singles && typeof src.singles === "object") d.singles = src.singles as typeof d.singles;
      // The store keeps its persist helpers private — write the same
      // localStorage keys directly so a refresh keeps the cloud state.
      try {
        localStorage.setItem("tk-drawings", JSON.stringify(d.drawings));
        localStorage.setItem("tk-drawings-lines", JSON.stringify(d.lines));
        localStorage.setItem("tk-drawings-polys", JSON.stringify(d.polys));
        localStorage.setItem("tk-drawings-positions", JSON.stringify(d.positions));
        localStorage.setItem("tk-drawings-singles", JSON.stringify(d.singles));
      } catch {}
    }

    if (Array.isArray(cloud.watchlist)) {
      const list = [...new Set(cloud.watchlist.filter((x): x is string => typeof x === "string"))];
      if (list.length) w.instruments = list;
    }

    // Symbol/timeframe last — setInstrument may trigger a history fetch.
    // Only inside the boot window: a late-arriving cloud row must never
    // stomp the symbol/timeframe the user is actively watching.
    if (Date.now() - bootAt <= RESTORE_WINDOW_MS) {
      if (cloud.instrument && isInstrument(cloud.instrument) && cloud.instrument !== m.instrument) {
        void m.setInstrument(cloud.instrument);
      }
      if (cloud.timeframe && isTimeframe(cloud.timeframe) && cloud.timeframe !== m.timeframe) {
        void m.setTimeframe(cloud.timeframe as Timeframe);
      }
    }
  } finally {
    // Let the watchers we just triggered settle before re-enabling pushes.
    setTimeout(() => (applying = false), 100);
  }
}

/** Wire cloud sync once; reacts to auth status changes (login/logout). */
export function startCloudSync(): void {
  if (started || !supabaseReady) return;
  started = true;
  const auth = useAuthStore();

  /** Watchers/listeners owned by the current "ready" activation. */
  let stops: Array<() => void> = [];
  let activeUserId: string | null = null;

  function teardown(): void {
    for (const stop of stops) {
      try { stop(); } catch {}
    }
    stops = [];
    if (pushTimer) {
      clearTimeout(pushTimer);
      pushTimer = null;
    }
    activeUserId = null;
  }

  watch(
    () => auth.status,
    async (status) => {
      // Leaving "ready" (sign-out, session loss) tears everything down and
      // cancels any pending push into the previous account.
      if (status !== "ready") {
        if (activeUserId) teardown();
        return;
      }
      if (activeUserId === auth.userId) return;
      if (activeUserId) teardown();
      const userId = auth.userId;
      if (!userId) return;
      activeUserId = userId;
      const sb = supabase();
      const { data, error } = await sb
        .from("user_settings")
        .select("data, updated_at")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) {
        console.error("cloud load failed", error);
        return;
      }
      if (data?.data && typeof data.data === "object") {
        // Last-write-wins: pushes fail silently on flaky links, so the cloud
        // row can be OLDER than this device's state. Applying it anyway
        // reverted the user's timeframe/indicators after every refresh.
        // If this device changed something more recently than the cloud
        // row, keep local and heal the cloud row instead.
        let localAt = 0;
        try { localAt = Number(localStorage.getItem(LOCAL_CHANGE_KEY)) || 0; } catch {}
        const cloudAt = typeof data.updated_at === "string" ? Date.parse(data.updated_at) || 0 : 0;
        if (localAt > cloudAt) {
          await push(userId);
          return;
        }
        // The apply churns the chart (indicator series add/remove → pane
        // rebuilds, drawings replaced). Landing it during the chart's
        // initial layout/resize window crashed LWC's render loop ("Value
        // is null") — defer until the chart has fully settled.
        await new Promise((r) => setTimeout(r, 1500));
        if (auth.status !== "ready" || activeUserId !== userId) return;
        applyLocal(data.data as CloudData);
      } else {
        // First login for this account — seed the cloud with local state.
        await push(userId);
      }

      // Push subsequent local changes (debounced), skipping our own apply.
      // Every watcher/listener is registered HERE (inside the ready effect)
      // and torn down when auth leaves "ready" — re-logins must not stack
      // duplicate watchers, and a signed-out browser must never push edits
      // into the previous account's cloud row.
      const d = useDrawingsStore();
      const w = useWatchlistStore();
      const m = useMarketStore();
      const ind = useIndicatorsStore();
      const onChange = () => {
        if (applying) return;
        schedulePush(userId);
      };
      stops.push(
        watch(() => [d.drawings, d.lines, d.polys, d.positions, d.singles], onChange, { deep: true }),
        watch(() => [...w.instruments], onChange),
        watch(() => [m.instrument, m.timeframe], onChange),
        watch(() => ind.addedMap, onChange, { deep: true }),
        watch(
          () => [
            ind.sessionsVisible, ind.sessionsLabels, ind.sessionsEnabled, ind.defs, ind.customs,
            ind.rsiVisible, ind.rsiLength, ind.rsiColor, ind.rsiLevelColor, ind.rsiUpper, ind.rsiLower,
            ind.smaVisible, ind.smaLength, ind.smaColor, ind.emaVisible, ind.emaLength, ind.emaColor,
          ],
          onChange,
          { deep: true }
        )
      );
      const onLocalChange = () => {
        if (applying) return;
        schedulePush(userId);
      };
      window.addEventListener("tk-local-change", onLocalChange as EventListener);
      stops.push(() => window.removeEventListener("tk-local-change", onLocalChange as EventListener));
    },
    { immediate: true }
  );
}
