 /** Per-account cloud sync of chart state via the Supabase `user_settings`
 *  table (one JSONB row per user): drawings, watchlist symbols and the
 *  last instrument/timeframe. Local storage stays the offline cache; the
 *  cloud copy wins on login if it exists, otherwise the local one is
 *  pushed up. Changes are debounced-upserted while the user works. */
import { ref, watch } from "vue";
import { isInstrument, isTimeframe } from "@traderkomak/shared";
import type { Timeframe } from "@traderkomak/shared";
import { supabase, supabaseReady, SUPABASE_URL, SUPABASE_ANON_KEY, getAccessTokenSync } from "./supabase";
import { useAuthStore } from "@/stores/auth";
import { useWatchlistStore } from "@/stores/watchlist";
import { useDrawingsStore } from "@/stores/drawings";
import { useMarketStore } from "@/stores/market";
import { useThemeStore } from "@/stores/theme";
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
  /** Light/dark look — part of the account's saved setup. */
  theme?: "dark" | "light";
}

const PUSH_DEBOUNCE_MS = 1500;
let started = false;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let applying = false;

/** True while an account's saved look is being restored into a chart that is
 *  already on screen. The chart hides itself for that moment, so the user sees
 *  ONE clean paint (saved colors + drawings) instead of a default-colored chart
 *  that repaints itself a beat later. Capped, so a slow or blocked cloud can
 *  never leave the chart hidden. */
export const chartRestorePending = ref(false);
const RESTORE_CAP_MS = 5000;
let restoreCapTimer: ReturnType<typeof setTimeout> | null = null;

function beginRestore(): void {
  if (restoreCapTimer) clearTimeout(restoreCapTimer);
  chartRestorePending.value = true;
  restoreCapTimer = setTimeout(endRestore, RESTORE_CAP_MS);
  restoreCapTimer.unref?.();
}

function endRestore(): void {
  if (restoreCapTimer) {
    clearTimeout(restoreCapTimer);
    restoreCapTimer = null;
  }
  chartRestorePending.value = false;
}

/** Would applying this row visibly change the chart's look? Compared field by
 *  field (JSON key order would differ) and treating an absent theme as the
 *  light default. A same-account boot with identical settings must NOT pay
 *  for the gate. */
/** Is this browser's account cache empty? An account switch wipes it before
 *  the reload, so an empty cache means the chart is about to be restored with
 *  a different account's look. */
function accountCacheIsEmpty(): boolean {
  try { return localStorage.getItem("tk-chart-style") === null; } catch { return false; }
}

function lookDiffers(cloud: CloudData): boolean {
  const style = cloud.chart?.style as Record<string, unknown> | null | undefined;
  if (style && typeof style === "object") {
    let local: Record<string, unknown> = {};
    try { local = JSON.parse(localStorage.getItem("tk-chart-style") ?? "{}") as Record<string, unknown>; } catch {}
    for (const k of ["bgSolid", "bgTop", "bgBottom", "up", "down", "borderUp", "borderDown", "wickUp", "wickDown", "axisText", "axisBorder", "crossVert", "crossHorz"]) {
      if ((style[k] ?? null) !== (local[k] ?? null)) return true;
    }
    const mode = style.bgMode ?? "gradient";
    if (mode !== (local.bgMode ?? "gradient")) return true;
  }
  if (cloud.theme === "dark" || cloud.theme === "light") {
    let cur: string | null = null;
    try { cur = localStorage.getItem("tk-theme"); } catch {}
    if (cloud.theme !== (cur === "dark" || cur === "light" ? cur : "light")) return true;
  }
  return false;
}
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
 *  themselves"). */
const LOCAL_CHANGE_KEY = "tk-cloud-local-change-at";
/** Timestamp of the last CONFIRMED successful push (this device's clock).
 *  Decision rule needs NO cross-device clock comparison: if a local change
 *  happened after the last confirmed sync, local is definitively newer —
 *  keep it and heal the cloud row. Otherwise the cloud row already contains
 *  every local change, so applying it can never lose data. */
const SYNCED_AT_KEY = "tk-cloud-synced-at";
/** Which ACCOUNT the local cache belongs to. Set on every ready login; when a
 *  DIFFERENT account signs in on this browser, the previous account's cached
 *  settings are wiped and the page reloaded so every store re-seeds from clean
 *  defaults — then THAT account's own cloud row is applied. Without this a
 *  brand-new account inherited the previous account's chart colors (reported:
 *  "signing in with another Google account came up with a black chart"). */
const OWNER_KEY = "tk-cloud-owner";
/** Set across the reload of an account switch: the cloud row must win over
 *  anything the page writes back while booting. */
const FORCE_KEY = "tk-force-cloud-apply";
/** Local keys owned by an ACCOUNT (each mirrored in user_settings). Device
 *  prefs (panel states, favorites, auth caches) are deliberately untouched. */
const ACCOUNT_KEYS = [
  "tk-chart-style",
  "tk-chart-templates",
  "tk-drawings",
  "tk-drawings-lines",
  "tk-drawings-polys",
  "tk-drawings-positions",
  "tk-drawings-singles",
  "tk-watchlist",
  "tk-instrument",
  "tk-timeframe",
  "tk-indicators-v1",
  "tk-theme",
  LOCAL_CHANGE_KEY,
  SYNCED_AT_KEY,
];

function wipeAccountCache(): void {
  for (const k of ACCOUNT_KEYS) {
    try { localStorage.removeItem(k); } catch {}
  }
}

function readTheme(): "dark" | "light" {
  try { return localStorage.getItem("tk-theme") === "dark" ? "dark" : "light"; } catch { return "light"; }
}

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
    theme: readTheme(),
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

/** Consecutive failed pushes — indexes PUSH_RETRY_DELAYS_MS and resets on
 *  success, so a flaky link gets a bounded second/third/fourth chance instead
 *  of silently dropping the change (a stale cloud row then wins on the next
 *  boot and reverts what the user did). */
let pushFailures = 0;
const PUSH_RETRY_DELAYS_MS = [3_000, 8_000, 20_000];

function isAuthError(error: { message?: string; code?: string }): boolean {
  // PGRST301 = PostgREST "JWT expired"; the message test also covers the
  // 401/403 wording variants supabase-js surfaces for a dead token.
  return error.code === "PGRST301" || /jwt|401|403|expired/i.test(error.message ?? "");
}

async function pushOnce(userId: string, payload: CloudData, stamp: string): Promise<{ error: { message?: string; code?: string } | null }> {
  return supabase()
    .from("user_settings")
    .upsert({ user_id: userId, data: payload, updated_at: stamp });
}

async function push(userId: string): Promise<void> {
  const payload = snapshot();
  const stamp = new Date().toISOString();
  let { error } = await pushOnce(userId, payload, stamp);
  // An access token left expired by a throttled background tab (browsers
  // pause the refresh timers — the reported "drawings stop saving after an
  // hour") reads as a JWT error: refresh once and retry NOW instead of
  // burning the backoff on a second 401.
  if (error && isAuthError(error)) {
    try { await supabase().auth.refreshSession(); } catch {}
    ({ error } = await pushOnce(userId, payload, stamp));
  }
  if (error) {
    console.error("cloud push failed", error);
    const delay = PUSH_RETRY_DELAYS_MS[pushFailures];
    if (delay !== undefined) {
      pushFailures++;
      setTimeout(() => {
        // A sign-out (or account switch) while the retry waits must not
        // write into the previous account's row.
        const auth = useAuthStore();
        if (auth.status !== "ready" || auth.userId !== userId) {
          pushFailures = 0;
          return;
        }
        void push(userId);
      }, delay);
    }
    return;
  }
  pushFailures = 0;
  // Confirmed: everything local up to this stamp is now safely in the cloud.
  try { localStorage.setItem(SYNCED_AT_KEY, String(Date.parse(stamp))); } catch {}
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

/** Fire-and-forget upsert with fetch keepalive — the ONLY way a pending
 *  change reaches the cloud when the tab is closing or the app is being
 *  backgrounded (the debounced push dies with the page; iOS also suspends
 *  background timers before the debounce fires). Deliberately does NOT set
 *  SYNCED_AT_KEY: keepalive delivery is not confirmable, and a false
 *  "synced" stamp would disable the boot-time local-wins heal that recovers
 *  a lost flush. */
function flushPendingNow(userId: string): void {
  try {
    if (applying) return; // mid-restore snapshot would be half-applied
    const localAt = Number(localStorage.getItem(LOCAL_CHANGE_KEY)) || 0;
    const syncedAt = Number(localStorage.getItem(SYNCED_AT_KEY)) || 0;
    const pending = pushTimer !== null || localAt > syncedAt;
    if (!pending) return;
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
    const token = getAccessTokenSync();
    if (!token) return;
    const stamp = new Date().toISOString();
    void fetch(`${SUPABASE_URL}/rest/v1/user_settings?on_conflict=user_id`, {
      method: "POST",
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({ user_id: userId, data: snapshot(), updated_at: stamp }),
    }).catch(() => {});
  } catch {}
}

let lastFreshCheckAt = 0;

/** Coming back to a tab that was backgrounded: browsers throttle the token
 *  refresh timers, so the access token may sit expired until the next call
 *  fails. Refresh if it is (near-)expired, then re-push anything an earlier
 *  attempt dropped. */
function recoverAfterBackground(userId: string): void {
  void (async () => {
    try {
      if (Date.now() - lastFreshCheckAt > 60_000) {
        lastFreshCheckAt = Date.now();
        const { data } = await supabase().auth.getSession();
        const exp = typeof data.session?.expires_at === "number" ? data.session.expires_at * 1000 : 0;
        if (exp && exp - Date.now() < 5 * 60_000) await supabase().auth.refreshSession();
      }
    } catch {}
    let localAt = 0;
    let syncedAt = 0;
    try { localAt = Number(localStorage.getItem(LOCAL_CHANGE_KEY)) || 0; } catch {}
    try { syncedAt = Number(localStorage.getItem(SYNCED_AT_KEY)) || 0; } catch {}
    if (localAt > syncedAt) void push(userId);
  })();
}

/** Phase 1 — the account's LOOK: light/dark + chart colors and templates.
 *  This only recolors the existing series and restyles chart options; it
 *  never adds/removes a series nor rebuilds the pane, so it is SAFE to run
 *  the moment the row arrives. The heavy restore in applyLocal below is what
 *  crashed Lightweight Charts' render loop when it landed inside the chart's
 *  initial layout window — hence its settle wait, which no longer delays the
 *  saved colors. Theme first: the chart-style write below then overwrites any
 *  theme-baked defaults instead of mixing the two. */
function applyLook(cloud: CloudData): void {
  if (cloud.theme === "dark" || cloud.theme === "light") {
    try { useThemeStore().setTheme(cloud.theme); } catch {}
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
}

/** Deep copy of every drawing list in the store — taken just before the
 *  cloud row replaces them, so drawings the user made while the row was
 *  still in flight can be merged back instead of being wiped. */
interface LocalDrawingsSnapshot {
  rects: Record<string, { id: string }[]>;
  lines: Record<string, { id: string }[]>;
  polys: Record<string, { id: string }[]>;
  positions: Record<string, { id: string }[]>;
  singles: Record<string, Record<string, { id: string }[]>>;
}

function snapshotLocalDrawings(): LocalDrawingsSnapshot {
  const d = useDrawingsStore();
  return {
    rects: JSON.parse(JSON.stringify(d.drawings)),
    lines: JSON.parse(JSON.stringify(d.lines)),
    polys: JSON.parse(JSON.stringify(d.polys)),
    positions: JSON.parse(JSON.stringify(d.positions)),
    singles: JSON.parse(JSON.stringify(d.singles)),
  };
}

/** Union by id: the cloud row wins for ids it already knows; anything that
 *  exists ONLY in the local state (drawn while the row was fetching) is
 *  appended. Drawing ids are unique per creation (timestamp + random), so
 *  two devices can never legitimately hold DIFFERENT versions of one id —
 *  a plain union is safe. Tradeoff: a drawing deleted during the fetch
 *  window comes back; that beats losing a just-drawn one. Returns how many
 *  local-only items were merged so the caller can push the union up. */
function rescueById<T extends { id: string }>(
  cloud: Record<string, T[]> | null | undefined,
  localBefore: Record<string, T[]> | null | undefined
): { merged: Record<string, T[]>; added: number } {
  const merged: Record<string, T[]> = {};
  const seen = new Set<string>();
  if (cloud && typeof cloud === "object") {
    for (const [symbol, list] of Object.entries(cloud)) {
      if (!Array.isArray(list)) continue;
      const target = (merged[symbol] ??= []);
      for (const item of list) {
        if (!item || typeof item.id !== "string" || seen.has(item.id)) continue;
        seen.add(item.id);
        target.push(item);
      }
    }
  }
  let added = 0;
  if (localBefore && typeof localBefore === "object") {
    for (const [symbol, list] of Object.entries(localBefore)) {
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        if (!item || typeof item.id !== "string" || seen.has(item.id)) continue;
        seen.add(item.id);
        (merged[symbol] ??= []).push(item);
        added++;
      }
    }
  }
  return { merged, added };
}

function rescueSingles(
  cloud: Record<string, Record<string, { id: string }[]>> | null | undefined,
  localBefore: Record<string, Record<string, { id: string }[]>> | null | undefined
): { merged: Record<string, Record<string, { id: string }[]>>; added: number } {
  const merged: Record<string, Record<string, { id: string }[]>> = {};
  let added = 0;
  for (const kind of ["hline", "hray", "vline"]) {
    const r = rescueById(cloud?.[kind], localBefore?.[kind]);
    merged[kind] = r.merged;
    added += r.added;
  }
  return { merged, added };
}

/** Returns how many local-only drawings were rescued into the merged state
 *  (0 on a normal restore). */
function applyLocal(cloud: CloudData, localBefore?: LocalDrawingsSnapshot): number {
  applying = true;
  let rescued = 0;
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
    // The look (theme + chart colors/templates) already landed in applyLook
    // the moment the row arrived; only the heavy data waits for the chart to
    // settle.

    if (cloud.drawings && typeof cloud.drawings === "object") {
      const src = cloud.drawings;
      const before = localBefore ?? snapshotLocalDrawings();
      if (src.rects && typeof src.rects === "object") {
        const r = rescueById(src.rects as typeof before.rects, before.rects);
        d.drawings = r.merged as typeof d.drawings;
        rescued += r.added;
      }
      if (src.lines && typeof src.lines === "object") {
        const r = rescueById(src.lines as typeof before.lines, before.lines);
        d.lines = r.merged as typeof d.lines;
        rescued += r.added;
      }
      if (src.polys && typeof src.polys === "object") {
        const r = rescueById(src.polys as typeof before.polys, before.polys);
        d.polys = r.merged as typeof d.polys;
        rescued += r.added;
      }
      if (src.positions && typeof src.positions === "object") {
        const r = rescueById(src.positions as typeof before.positions, before.positions);
        d.positions = r.merged as typeof d.positions;
        rescued += r.added;
      }
      if (src.singles && typeof src.singles === "object") {
        const r = rescueSingles(src.singles as typeof before.singles, before.singles);
        d.singles = r.merged as typeof d.singles;
        rescued += r.added;
      }
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
    return rescued;
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
    endRestore();
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
      // Account switch on this browser: the local cache still holds the
      // PREVIOUS account's settings. Wipe it and reload so every store
      // re-seeds from clean defaults; this account's own cloud row (if any)
      // is then applied authoritatively below. A brand-new account therefore
      // starts on the defaults instead of someone else's chart colors.
      let cacheOwner: string | null = null;
      try { cacheOwner = localStorage.getItem(OWNER_KEY); } catch {}
      if (cacheOwner && cacheOwner !== userId) {
        try {
          localStorage.removeItem(OWNER_KEY);
          sessionStorage.setItem(FORCE_KEY, "1");
        } catch {}
        wipeAccountCache();
        location.reload();
        return;
      }
      try { localStorage.setItem(OWNER_KEY, userId); } catch {}
      // The boot write-back (chart defaults) must not push DEFAULTS over this
      // account's saved settings: drop the pending push and hold the change
      // guard while the cloud row lands.
      let forceApply = false;
      try {
        forceApply = sessionStorage.getItem(FORCE_KEY) === "1";
        sessionStorage.removeItem(FORCE_KEY);
      } catch {}
      if (forceApply) {
        if (pushTimer) {
          clearTimeout(pushTimer);
          pushTimer = null;
        }
        applying = true;
      }
      activeUserId = userId;
      // Arm the restore gate HERE, synchronously, before the chart mounts on
      // the render that follows this status change. Otherwise the chart paints
      // in the default colors and only then hides when the row lands — the
      // "chart appears, disappears, appears again" flicker.
      if (accountCacheIsEmpty()) beginRestore();

      const stillActive = (): boolean => auth.status === "ready" && activeUserId === userId;

      /** Register the push watchers + unload listeners ONCE per activation.
       *  EVERY path below ends here — a failed cloud fetch or a "local wins"
       *  boot previously RETURNED before this point, leaving the whole
       *  session without any sync: edits still reached localStorage but were
       *  never pushed, so other devices never saw them. */
      const registerWatchers = (): void => {
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
          // Light/dark is part of the account's setup: a toggle pushes it so the
          // other devices restore the same look.
          watch(() => useThemeStore().theme, onChange),
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
        // Tab hidden / closed / app backgrounded: the debounced push dies with
        // the page (and iOS suspends background timers before it fires), so
        // flush the pending change with a keepalive fetch instead. Coming
        // BACK to a backgrounded tab: the token may have sat expired (the
        // "drawings stop saving after an hour" report) — refresh it and
        // re-push anything an earlier attempt dropped.
        const onVisibility = () => {
          if (document.visibilityState === "hidden") flushPendingNow(userId);
          else recoverAfterBackground(userId);
        };
        const onPageHide = () => flushPendingNow(userId);
        const onOnline = () => recoverAfterBackground(userId);
        document.addEventListener("visibilitychange", onVisibility);
        window.addEventListener("pagehide", onPageHide);
        window.addEventListener("online", onOnline);
        stops.push(
          () => document.removeEventListener("visibilitychange", onVisibility),
          () => window.removeEventListener("pagehide", onPageHide),
          () => window.removeEventListener("online", onOnline)
        );
      };

      /** Fetch the account's row and apply it. Returns false ONLY on a fetch
       *  error so the caller can schedule exactly one quiet retry. */
      const fetchAndApply = async (): Promise<boolean> => {
        const sb = supabase();
        const { data, error } = await sb
          .from("user_settings")
          .select("data, updated_at")
          .eq("user_id", userId)
          .maybeSingle();
        if (error) {
          console.error("cloud load failed", error);
          applying = false;
          endRestore();
          return false;
        }
        if (data?.data && typeof data.data === "object") {
          // Last-write-wins WITHOUT cross-device clock comparison: pushes fail
          // silently on flaky links, so the cloud row can be OLDER than this
          // device's state (it reverted timeframe/indicators after refresh).
          // If anything changed locally after the last CONFIRMED sync, local
          // is definitively newer — keep it and heal the cloud row. Otherwise
          // the cloud row already contains every local change: apply it.
          let localAt = 0;
          let syncedAt = 0;
          try { localAt = Number(localStorage.getItem(LOCAL_CHANGE_KEY)) || 0; } catch {}
          try { syncedAt = Number(localStorage.getItem(SYNCED_AT_KEY)) || 0; } catch {}
          if (!syncedAt && typeof data.updated_at === "string") {
            // First boot after this update: baseline from the row itself so
            // existing users don't shove an old local snapshot over a newer
            // cloud row once.
            syncedAt = Date.parse(data.updated_at) || 0;
          }
          if (!forceApply && localAt > syncedAt) {
            // Local wins and is already on screen: nothing to wait for.
            endRestore();
            await push(userId);
            return true;
          }
          // The apply churns the chart (indicator series add/remove → pane
          // rebuilds, drawings replaced). Landing it during the chart's
          // initial layout/resize window crashed LWC's render loop ("Value
          // is null") — defer until the chart has fully settled.
          // Colors and light/dark land NOW (recolour only, never a pane
          // rebuild), so the account's saved look appears as soon as its row
          // arrives instead of after the settle delay. The change-guard is held
          // across both phases so nothing pushes half-restored state upstream.
          let changesBefore = 0;
          try { changesBefore = Number(localStorage.getItem(LOCAL_CHANGE_KEY)) || 0; } catch {}
          // Nothing to change visually (e.g. a brand-new account whose setup is
          // all defaults): the chart already on screen is correct — show it now.
          if (!lookDiffers(data.data as CloudData)) endRestore();
          applying = true;
          applyLook(data.data as CloudData);
          await new Promise((r) => setTimeout(r, 1500));
          if (!stillActive()) {
            applying = false;
            endRestore();
            return true;
          }
          // Snapshot the local drawings BEFORE the row replaces them: anything
          // the user drew while the fetch (or the settle wait) was still in
          // flight exists only here — the union-merge inside applyLocal puts
          // those back instead of wiping them.
          const localDrawingsBefore = snapshotLocalDrawings();
          const rescued = applyLocal(data.data as CloudData, localDrawingsBefore);
          // Anything the user touched while the restore was landing never made
          // it into the cloud row — and neither did rescued in-flight drawings:
          // push the merged state once the guard releases.
          let changesAfter = 0;
          try { changesAfter = Number(localStorage.getItem(LOCAL_CHANGE_KEY)) || 0; } catch {}
          if (changesAfter !== changesBefore || rescued > 0) schedulePush(userId);
          endRestore();
        } else {
          // First login for this account — seed the cloud with local state.
          await push(userId);
          // A forced switch holds the change-guard while the cloud row lands;
          // the seed push above already stored the defaults, so release it or
          // every later edit of this account would be blocked from syncing.
          // A brand-new account has nothing to restore: the defaults already on
          // screen ARE its setup. Reveal before the seed push finishes.
          endRestore();
          if (forceApply) applying = false;
        }
        return true;
      };

      const loaded = await fetchAndApply();
      if (stillActive()) registerWatchers();
      if (!loaded && stillActive()) {
        // One quiet retry — on a flaky link the row fetch can fail outright,
        // and without the row this device never restores the account's
        // other-device state (and its next "local wins" heal would overwrite
        // it with a stale snapshot). The rescue-merge keeps a late apply from
        // clobbering anything drawn in the meantime.
        setTimeout(() => {
          if (!stillActive()) return;
          void fetchAndApply();
        }, 10_000);
      }
    },
    { immediate: true }
  );
}
