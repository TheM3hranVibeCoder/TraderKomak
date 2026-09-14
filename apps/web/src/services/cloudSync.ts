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

interface CloudData {
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

function snapshot(): CloudData {
  const d = useDrawingsStore();
  const w = useWatchlistStore();
  const m = useMarketStore();
  return {
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

async function push(userId: string): Promise<void> {
  const payload = snapshot();
  const { error } = await supabase()
    .from("user_settings")
    .upsert({ user_id: userId, data: payload, updated_at: new Date().toISOString() });
  if (error) console.error("cloud push failed", error);
}

function schedulePush(userId: string): void {
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
    if (cloud.instrument && isInstrument(cloud.instrument) && cloud.instrument !== m.instrument) {
      void m.setInstrument(cloud.instrument);
    }
    if (cloud.timeframe && isTimeframe(cloud.timeframe) && cloud.timeframe !== m.timeframe) {
      void m.setTimeframe(cloud.timeframe as Timeframe);
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

  watch(
    () => auth.status,
    async (status) => {
      const userId = auth.userId;
      if (status !== "ready" || !userId) return;
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
        applyLocal(data.data as CloudData);
      } else {
        // First login for this account — seed the cloud with local state.
        await push(userId);
      }

      // Push subsequent local changes (debounced), skipping our own apply.
      const d = useDrawingsStore();
      const w = useWatchlistStore();
      const m = useMarketStore();
      const onChange = () => {
        if (applying) return;
        schedulePush(userId);
      };
      watch(() => [d.drawings, d.lines, d.polys, d.positions, d.singles], onChange, { deep: true });
      watch(() => [...w.instruments], onChange);
      watch(() => [m.instrument, m.timeframe], onChange);
    },
    { immediate: true }
  );
}
