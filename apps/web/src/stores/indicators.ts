import { defineStore } from "pinia";
import { useMarketStore } from "@/stores/market";
import { ref, computed, watch } from "vue";

const KEY = "tk-indicators-v1";

/** One SMA/EMA line on the chart — a chart can carry several, each with
 *  its own length/color. Per symbol (like every other added indicator). */
export interface MaInstance {
  id: number;
  kind: "sma" | "ema";
  length: number;
  color: string;
  visible: boolean;
}

/** Built-in sessions form a CHAIN anchored to each market's real opening
 *  bell in its HOME clock (DST-aware): Sydney 08:00 → Tokyo 09:00 →
 *  Tokyo 09:00 → London 08:00 → NY 08:00 → NY 10:00 (overlap end) →
 *  next Sydney 08:00. Each session spans from its anchor boundary to the
 *  next one, so windows adapt automatically when summer time changes.
 *  In Tehran time (UTC+3:30, no DST) that is currently:
 *  Sydney 01:30–03:30 · Asia 03:30–10:30 ·
 *  London 10:30–15:30 · NY&LN 15:30–19:30 · New York 19:30–01:30 *  (London/NY boundaries shift by an hour when DST flips). */
export type SessionKind = "sydney" | "asia" | "london" | "nyln" | "newyork";

export interface SessionDef {
  id: SessionKind;
  name: string;
  tz: string;
  /** boundary time: minutes-of-day in `tz` (the session's OPEN) */
  anchor: number;
  color: string;
  city: string;
}

export const SESSIONS: SessionDef[] = [
  { id: "sydney", name: "Sydney", tz: "Australia/Sydney", anchor: 480, color: "#ff9f43", city: "Sydney" },
  { id: "asia", name: "Asia", tz: "Asia/Tokyo", anchor: 540, color: "#8b93a7", city: "Tokyo" },
  { id: "london", name: "London", tz: "Europe/London", anchor: 480, color: "#4dd0e9", city: "London" },
  { id: "nyln", name: "NY & LN Overlap", tz: "America/New_York", anchor: 480, color: "#9575cd", city: "New York" },
  { id: "newyork", name: "New York", tz: "America/New_York", anchor: 720, color: "#f06292", city: "New York" },
];

/** The boundary that ENDS each session = the next link in the chain. */
export const CHAIN_NEXT: Record<SessionKind, SessionKind> = {
  sydney: "asia",
  asia: "london",
  london: "nyln",
  nyln: "newyork",
  newyork: "sydney",
};

/** UTC-offset (minutes) of `tz` on the UTC day containing `utcDaySec`
 *  (probed at 12:00 UTC — DST transitions happen around local midnight,
 *  never at noon). Cached per timezone+day. */
const offCache = new Map<string, number>();
const dtfCache = new Map<string, Intl.DateTimeFormat>();
export function tzOffsetMin(tz: string, utcDaySec: number): number {
  const key = tz + ":" + utcDaySec;
  const hit = offCache.get(key);
  if (hit !== undefined) return hit;
  let dtf = dtfCache.get(tz);
  if (!dtf) {
    dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
    });
    dtfCache.set(tz, dtf);
  }
  const parts = dtf.formatToParts(new Date((utcDaySec + 43200) * 1000));
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const off = h * 60 + m - 720;
  offCache.set(key, off);
  return off;
}

/** Epoch seconds of a session's opening boundary on a given UTC day
 *  (may land on the previous/next UTC day — offsets are up to ±11h). */
const bCache = new Map<string, number>();
export function boundaryEpoch(def: SessionDef, utcDaySec: number): number {
  const key = def.id + ":" + utcDaySec;
  const hit = bCache.get(key);
  if (hit !== undefined) return hit;
  const off = tzOffsetMin(def.tz, utcDaySec);
  const t = utcDaySec + (def.anchor - off) * 60;
  bCache.set(key, t);
  return t;
}

/** Which built-in session a candle belongs to: the session whose opening
 *  boundary is the latest one at or before the candle's time. */
export function sessionKindAt(timeSec: number): SessionKind | null {
  const d = Math.floor(timeSec / 86400);
  let bestT = -Infinity;
  let bestKind: SessionKind | null = null;
  for (const day of [d - 1, d, d + 1]) {
    for (const def of SESSIONS) {
      const t = boundaryEpoch(def, day * 86400);
      if (t <= timeSec && t > bestT) {
        bestT = t;
        bestKind = def.id;
      }
    }
  }
  return bestKind;
}

/** Epoch seconds of the NEXT opening boundary of a session after `t`
 *  (used to extend the in-progress session to its scheduled end). */
export function nextBoundaryAfter(def: SessionDef, t: number): number {
  const d = Math.floor(t / 86400);
  for (const day of [d, d + 1, d + 2]) {
    const b = boundaryEpoch(def, day * 86400);
    if (b > t) return b;
  }
  return t;
}

/* ── Custom sessions (visitor's own local clock, free windows) ────────── */

export interface CustomSession {
  id: string;
  name: string;
  tz: string;
  start: number; // minutes-of-day in the visitor's local clock
  end: number; // minutes-of-day; end <= start wraps midnight
  color: string;
}

/** Local minutes-of-day in `tz` for a UTC epoch-seconds timestamp. */
export function localMinutesOfDay(tz: string, timeSec: number): number {
  const utcMin = Math.floor((((timeSec % 86400) + 86400) % 86400) / 60);
  const daySec = timeSec - (timeSec % 86400);
  return (((utcMin + tzOffsetMin(tz, daySec)) % 1440) + 1440) % 1440;
}

/** True when `localMin` falls inside the custom window (midnight-safe). */
export function inSession(def: CustomSession, localMin: number): boolean {
  const start = ((def.start % 1440) + 1440) % 1440;
  const end = ((def.end % 1440) + 1440) % 1440;
  if (start < end) return localMin >= start && localMin < end;
  return localMin >= start || localMin < end;
}

function HEXc(v: unknown): v is string {
  return typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);
}
export const useIndicatorsStore = defineStore("indicators", () => {
  const sessionsAdded = computed({
    get: () => addedFor("sessions"),
    set: (v: boolean) => setAdded("sessions", v),
  });
  /** Eye toggle — boxes hidden but the indicator stays on the chart. */
  const sessionsVisible = ref(true);
  /** Session name labels on top of the boxes (default OFF). */
  const sessionsLabels = ref(false);
  /** Per-session enable switches (the gear popup) — every session starts
   *  ticked; the map is pre-filled so checkboxes render checked. */
  const sessionsEnabled = ref<Record<string, boolean>>(
    Object.fromEntries(SESSIONS.map((s) => [s.id, true]))
  );
  /** Built-in sessions: name + color editable, boundaries chained. */
  const defs = ref<SessionDef[]>(SESSIONS.map((s) => ({ ...s })));

  /* ── Per-symbol "added" state for every indicator ─────────────────────
   * Adding Sessions/RSI/SMA/EMA/VP applies to the CURRENT symbol only;
   * removing on another symbol never touches this one. Synced to Supabase
   * via cloudSync (user_settings.indicators). */
  type AddedFlags = { sessions?: boolean; rsi?: boolean; sma?: boolean; ema?: boolean; vp?: boolean };
  const addedMap = ref<Record<string, AddedFlags>>({});

  /** Indicator kinds accepted by the sanitizer (cloud sync / migration). */
  const ADDED_KINDS = ["sessions", "rsi", "sma", "ema", "vp"] as const;

  function addedFor(kind: keyof AddedFlags): boolean {
    const m = addedMap.value[useMarketStore().instrument];
    return !!(m && m[kind]);
  }
  function setAdded(kind: keyof AddedFlags, v: boolean): void {
    const sym = useMarketStore().instrument;
    const next = { ...addedMap.value };
    if (v) {
      next[sym] = { ...(next[sym] ?? {}), [kind]: true };
    } else {
      const flags = { ...(next[sym] ?? {}) };
      delete flags[kind];
      if (Object.keys(flags).length > 0) next[sym] = flags;
      else delete next[sym];
    }
    addedMap.value = next;
  }
  /** Replace the whole map (cloud sync / migration) after sanitizing. */
  function setAddedMap(raw: unknown): void {
    if (!raw || typeof raw !== "object") return;
    const clean: Record<string, AddedFlags> = {};
    for (const [sym, flags] of Object.entries(raw as Record<string, unknown>)) {
      if (!flags || typeof flags !== "object") continue;
      const f = flags as Record<string, unknown>;
      const e: AddedFlags = {};
      for (const k of ADDED_KINDS) {
        if (typeof f[k] === "boolean" && f[k]) e[k] = true;
      }
      if (Object.keys(e).length > 0) clean[sym] = e;
    }
    addedMap.value = clean;
  }

  /* ── RSI indicator ─────────────────────────────────────────────────── */
  const rsiAdded = computed({
    get: () => addedFor("rsi"),
    set: (v: boolean) => setAdded("rsi", v),
  });
  const rsiVisible = ref(true);
  const rsiLength = ref(14);
  const rsiColor = ref("#a78bfa");
  const rsiLevelColor = ref("#78909c");
  const rsiUpper = ref(70);
  const rsiLower = ref(30);

  /* ── Moving averages (SMA / EMA overlays on the main pane) ────────────
   * MULTIPLE instances per symbol: every selection in the menu adds one
   * more line (own length + color), removed via the legend ×. Instances
   * are per-symbol, like the added flags. The legacy single-SMA/EMA
   * settings remain for cloud-payload compatibility. */
  const SMA_LENGTHS = [20, 50, 100, 200];
  const EMA_LENGTHS = [50, 20, 100, 200];
  const SMA_COLORS = ["#f59e0b", "#38bdf8", "#a78bfa", "#f472b6", "#34d399"];
  const EMA_COLORS = ["#38bdf8", "#f59e0b", "#f472b6", "#34d399", "#a78bfa"];

  const maSeq = ref(1);
  const maInstances = ref<Record<string, MaInstance[]>>({});

  function maListFor(sym: string): MaInstance[] {
    return maInstances.value[sym] ?? [];
  }
  function maCurrentList(): MaInstance[] {
    return maListFor(useMarketStore().instrument);
  }

  /** Next default length for a kind: the first cycle value not already on
   *  the chart, so a second SMA comes out 50, then 100, then 200. */
  function nextMaLength(kind: "sma" | "ema", existing: MaInstance[]): number {
    const cycle = kind === "sma" ? SMA_LENGTHS : EMA_LENGTHS;
    const used = new Set(existing.filter((m) => m.kind === kind).map((m) => m.length));
    for (const l of cycle) if (!used.has(l)) return l;
    return cycle[existing.filter((m) => m.kind === kind).length % cycle.length]!;
  }
  /** Palette color not already used by the same kind (falls back to cycle). */
  function nextMaColor(kind: "sma" | "ema", existing: MaInstance[]): string {
    const palette = kind === "sma" ? SMA_COLORS : EMA_COLORS;
    const used = new Set(existing.filter((m) => m.kind === kind).map((m) => m.color));
    for (const c of palette) if (!used.has(c)) return c;
    return palette[existing.filter((m) => m.kind === kind).length % palette.length]!;
  }

  /** Adds one instance to the CURRENT symbol and syncs the legacy single
   *  SMA/EMA settings from the first instance (cloud-payload compat). */
  function addMaInstance(kind: "sma" | "ema"): MaInstance {
    const sym = useMarketStore().instrument;
    const existing = maListFor(sym);
    const inst: MaInstance = {
      id: maSeq.value++,
      kind,
      length: nextMaLength(kind, existing),
      color: nextMaColor(kind, existing),
      visible: true,
    };
    maInstances.value = { ...maInstances.value, [sym]: [...existing, inst] };
    const first = maListFor(sym).find((m) => m.kind === kind);
    if (first) {
      if (kind === "sma") { smaLength.value = first.length; smaColor.value = first.color; smaVisible.value = first.visible; }
      else { emaLength.value = first.length; emaColor.value = first.color; emaVisible.value = first.visible; }
    }
    return inst;
  }

  /** Removes ONE instance (legend ×) from the CURRENT symbol. */
  function removeMaInstance(id: number): void {
    const sym = useMarketStore().instrument;
    const rest = maListFor(sym).filter((m) => m.id !== id);
    const next = { ...maInstances.value };
    if (rest.length > 0) next[sym] = rest;
    else delete next[sym];
    maInstances.value = next;
    syncMaAddedFlags(sym);
  }

  /** Length/color/visibility edit on one instance (gear popup). */
  function patchMaInstance(id: number, patch: { length?: number; color?: string; visible?: boolean }): void {
    const sym = useMarketStore().instrument;
    const list = maListFor(sym);
    const idx = list.findIndex((m) => m.id === id);
    if (idx < 0) return;
    const cur = list[idx]!;
    const nextInst: MaInstance = {
      ...cur,
      length: patch.length !== undefined ? Math.min(500, Math.max(2, Math.round(patch.length))) : cur.length,
      color: patch.color !== undefined && /^#[0-9a-fA-F]{6}$/.test(patch.color) ? patch.color : cur.color,
      visible: patch.visible !== undefined ? patch.visible : cur.visible,
    };
    const next = [...list];
    next[idx] = nextInst;
    maInstances.value = { ...maInstances.value, [sym]: next };
    if (nextInst.id === list.find((m) => m.kind === cur.kind)?.id) {
      if (cur.kind === "sma") { smaLength.value = nextInst.length; smaColor.value = nextInst.color; smaVisible.value = nextInst.visible; }
      else { emaLength.value = nextInst.length; emaColor.value = nextInst.color; emaVisible.value = nextInst.visible; }
    }
  }

  /** Keeps the per-symbol added flags in step with the instance lists, so
   *  the menu checkbox and cloud sync reflect reality. */
  function syncMaAddedFlags(sym: string): void {
    const flags: AddedFlags = {};
    for (const m of maListFor(sym)) flags[m.kind] = true;
    const existing = addedMap.value[sym] ?? {};
    const merged = { ...existing, ...flags };
    for (const k of ["sma", "ema"] as const) {
      if (!flags[k]) delete merged[k];
    }
    const next = { ...addedMap.value };
    if (Object.keys(merged).length > 0) next[sym] = merged;
    else delete next[sym];
    addedMap.value = next;
  }

  /** Menu toggles: selecting SMA/EMA ALWAYS adds one more instance
   *  (removal happens via the legend ×), so the checkbox simply reflects
   *  whether any instance of the kind exists. */
  const smaAdded = computed({
    get: () => maCurrentList().some((m) => m.kind === "sma"),
    set: (v: boolean) => {
      if (v) addMaInstance("sma");
      else {
        const sym = useMarketStore().instrument;
        const rest = maListFor(sym).filter((m) => m.kind !== "sma");
        const next = { ...maInstances.value };
        if (rest.length > 0) next[sym] = rest;
        else delete next[sym];
        maInstances.value = next;
        syncMaAddedFlags(sym);
      }
    },
  });
  const emaAdded = computed({
    get: () => maCurrentList().some((m) => m.kind === "ema"),
    set: (v: boolean) => {
      if (v) addMaInstance("ema");
      else {
        const sym = useMarketStore().instrument;
        const rest = maListFor(sym).filter((m) => m.kind !== "ema");
        const next = { ...maInstances.value };
        if (rest.length > 0) next[sym] = rest;
        else delete next[sym];
        maInstances.value = next;
        syncMaAddedFlags(sym);
      }
    },
  });
  const smaVisible = ref(true);
  const smaLength = ref(20);
  const smaColor = ref("#f59e0b");
  const emaVisible = ref(true);
  const emaLength = ref(50);
  const emaColor = ref("#38bdf8");

  /** Legacy migration: symbols flagged sma/ema-added before instances
   *  existed get one instance each with the stored global settings. */
  function migrateLegacyMas(): void {
    for (const [sym, flags] of Object.entries(addedMap.value)) {
      if (!flags.sma && !flags.ema) continue;
      const existing = maListFor(sym);
      if (existing.some((m) => m.kind === "sma" || m.kind === "ema")) continue;
      const seeded: MaInstance[] = [...existing];
      if (flags.sma) seeded.push({ id: maSeq.value++, kind: "sma", length: smaLength.value, color: smaColor.value, visible: smaVisible.value });
      if (flags.ema) seeded.push({ id: maSeq.value++, kind: "ema", length: emaLength.value, color: emaColor.value, visible: emaVisible.value });
      maInstances.value = { ...maInstances.value, [sym]: seeded };
    }
  }

  /** Sanitizer for cloud/local payloads of the instance map. */
  function applyMaInstances(raw: unknown): void {
    if (!raw || typeof raw !== "object") return;
    let maxId = 0;
    const clean: Record<string, MaInstance[]> = {};
    for (const [sym, list] of Object.entries(raw as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue;
      const insts: MaInstance[] = [];
      for (const m of list as Array<Record<string, unknown>>) {
        const kind = m?.kind === "ema" ? "ema" : m?.kind === "sma" ? "sma" : null;
        if (!kind) continue;
        const id = typeof m.id === "number" && Number.isFinite(m.id) ? Math.round(m.id) : 0;
        const length = typeof m.length === "number" && m.length >= 2 && m.length <= 500 ? Math.round(m.length) : kind === "sma" ? 20 : 50;
        const color = typeof m.color === "string" && /^#[0-9a-fA-F]{6}$/.test(m.color) ? m.color : "#38bdf8";
        insts.push({ id, kind, length, color, visible: m.visible !== false });
        if (id > maxId) maxId = id;
      }
      if (insts.length > 0) clean[sym] = insts.slice(0, 12);
    }
    maInstances.value = clean;
    if (maxId >= maSeq.value) maSeq.value = maxId + 1;
    for (const sym of Object.keys(clean)) syncMaAddedFlags(sym);
  }

  /* ── Fixed Range Volume Profile (TradingView-style) ────────────────────
   * Two draggable time anchors define the profile window; the histogram,
   * POC and Value Area render from the volume sidecar (volumeFeed). The
   * anchors persist PER symbol+timeframe — each view remembers its own
   * window (null = first use; ChartPane then anchors the last 150 bars). */
  const vpAdded = computed({
    get: () => addedFor("vp"),
    set: (v: boolean) => setAdded("vp", v),
  });
  const vpVisible = ref(true);
  /** Histogram rows (price buckets) — TradingView's default is 24. */
  const vpRows = ref(24);
  /** Value Area percentage of total volume. */
  const vpVaPercent = ref(70);
  /** Histogram max width, % of the main-pane width. */
  const vpWidthPercent = ref(30);
  const vpUpColor = ref("#26a69a");
  const vpDownColor = ref("#ef5350");
  const vpPocColor = ref("#f59e0b");
  const vpVaColor = ref("#8b93a7");
  /** "POC: <price>" tag at the POC line's right end (TV script default ON). */
  const vpShowPocLabel = ref(true);
  /** VAH/VAL dashed lines — off by default (visitor prefers a clean look);
   *  the Value Area itself still drives the brighter rows. */
  const vpShowVaLines = ref(false);
  const vpRanges = ref<Record<string, { start: number; end: number }>>({});

  const vpRangeKey = (inst: string, tf: string): string => `${inst}|${tf}`;

  function getVpRange(inst: string, tf: string): { start: number; end: number } | null {
    const r = vpRanges.value[vpRangeKey(inst, tf)];
    if (r && Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start) return { start: r.start, end: r.end };
    return null;
  }

  function setVpRange(inst: string, tf: string, start: number, end: number): void {
    if (!Number.isFinite(start) || !Number.isFinite(end)) return;
    if (end <= start) return;
    vpRanges.value = { ...vpRanges.value, [vpRangeKey(inst, tf)]: { start, end } };
  }

  function removeVpRange(inst: string, tf: string): void {
    const next = { ...vpRanges.value };
    delete next[vpRangeKey(inst, tf)];
    vpRanges.value = next;
  }

  /** User-defined sessions (visitor-local clock). */
  const customs = ref<CustomSession[]>([]);

  function isEnabled(id: string): boolean {
    return sessionsEnabled.value[id] !== false;
  }

  /** Everything except the per-symbol added flags (those sync separately
   *  via addedMap): session names/colors, custom sessions, RSI/SMA/EMA
   *  colors and periods, visibility toggles. */
  function settingsSnapshot() {
    return {
      sessionsVisible: sessionsVisible.value,
      sessionsLabels: sessionsLabels.value,
      sessionsEnabled: { ...sessionsEnabled.value },
      defs: defs.value.map((d) => ({ id: d.id, name: d.name, color: d.color })),
      customs: JSON.parse(JSON.stringify(customs.value)),
      rsiVisible: rsiVisible.value,
      rsiLength: rsiLength.value,
      rsiColor: rsiColor.value,
      rsiLevelColor: rsiLevelColor.value,
      rsiUpper: rsiUpper.value,
      rsiLower: rsiLower.value,
      smaVisible: smaVisible.value,
      smaLength: smaLength.value,
      smaColor: smaColor.value,
      emaVisible: emaVisible.value,
      emaLength: emaLength.value,
      emaColor: emaColor.value,
      maInstances: JSON.parse(JSON.stringify(maInstances.value)),
      vpVisible: vpVisible.value,
      vpRows: vpRows.value,
      vpVaPercent: vpVaPercent.value,
      vpWidthPercent: vpWidthPercent.value,
      vpUpColor: vpUpColor.value,
      vpDownColor: vpDownColor.value,
      vpPocColor: vpPocColor.value,
      vpVaColor: vpVaColor.value,
      vpShowPocLabel: vpShowPocLabel.value,
      vpShowVaLines: vpShowVaLines.value,
      vpRanges: JSON.parse(JSON.stringify(vpRanges.value)),
    };
  }

  function applySettings(raw: unknown): void {
    if (!raw || typeof raw !== "object") return;
    const p = raw as Record<string, unknown>;
    if (typeof p.sessionsVisible === "boolean") sessionsVisible.value = p.sessionsVisible;
    if (typeof p.sessionsLabels === "boolean") sessionsLabels.value = p.sessionsLabels;
    if (p.sessionsEnabled && typeof p.sessionsEnabled === "object") {
      sessionsEnabled.value = {
        ...Object.fromEntries(SESSIONS.map((x) => [x.id, true])),
        ...(p.sessionsEnabled as Record<string, boolean>),
      };
    }
    if (Array.isArray(p.defs)) {
      for (const d of p.defs as Array<{ id?: unknown; name?: unknown; color?: unknown }>) {
        const target = defs.value.find((x) => x.id === d.id);
        if (!target) continue;
        if (typeof d.name === "string" && d.name.trim()) target.name = d.name.trim().slice(0, 20);
        if (typeof d.color === "string" && /^#[0-9a-fA-F]{6}$/.test(d.color)) target.color = d.color;
      }
    }
    if (Array.isArray(p.customs)) {
      const clean: CustomSession[] = [];
      for (const c of p.customs as Array<Record<string, unknown>>) {
        if (typeof c.id === "string" && typeof c.name === "string" && typeof c.start === "number" && typeof c.end === "number") {
          clean.push({
            id: c.id,
            name: String(c.name).slice(0, 20) || "Session",
            tz: typeof c.tz === "string" ? c.tz : "UTC",
            start: c.start,
            end: c.end,
            color: typeof c.color === "string" && /^#[0-9a-fA-F]{6}$/.test(c.color) ? c.color : "#8b93a7",
          });
        }
      }
      customs.value = clean;
    }
    if (typeof p.rsiVisible === "boolean") rsiVisible.value = p.rsiVisible;
    if (typeof p.rsiLength === "number" && p.rsiLength >= 2 && p.rsiLength <= 200) rsiLength.value = Math.round(p.rsiLength);
    if (typeof p.rsiColor === "string" && /^#[0-9a-fA-F]{6}$/.test(p.rsiColor)) rsiColor.value = p.rsiColor;
    if (typeof p.rsiLevelColor === "string" && /^#[0-9a-fA-F]{6}$/.test(p.rsiLevelColor)) rsiLevelColor.value = p.rsiLevelColor;
    if (typeof p.rsiUpper === "number") rsiUpper.value = Math.min(100, Math.max(1, p.rsiUpper));
    if (typeof p.rsiLower === "number") rsiLower.value = Math.min(99, Math.max(0, p.rsiLower));
    if (typeof p.smaVisible === "boolean") smaVisible.value = p.smaVisible;
    if (typeof p.smaLength === "number" && p.smaLength >= 2 && p.smaLength <= 500) smaLength.value = Math.round(p.smaLength);
    if (typeof p.smaColor === "string" && /^#[0-9a-fA-F]{6}$/.test(p.smaColor)) smaColor.value = p.smaColor;
    if (typeof p.emaVisible === "boolean") emaVisible.value = p.emaVisible;
    if (typeof p.emaLength === "number" && p.emaLength >= 2 && p.emaLength <= 500) emaLength.value = Math.round(p.emaLength);
    if (typeof p.emaColor === "string" && /^#[0-9a-fA-F]{6}$/.test(p.emaColor)) emaColor.value = p.emaColor;
    if (p.maInstances && typeof p.maInstances === "object") {
      applyMaInstances(p.maInstances);
    } else {
      // Cloud payload from an older client: seed instances from the legacy
      // flags the payload carries via addedMap (applied before settings).
      migrateLegacyMas();
    }
    if (typeof p.vpVisible === "boolean") vpVisible.value = p.vpVisible;
    if (typeof p.vpRows === "number") vpRows.value = Math.min(200, Math.max(1, Math.round(p.vpRows)));
    if (typeof p.vpVaPercent === "number") vpVaPercent.value = Math.min(100, Math.max(0, p.vpVaPercent));
    if (typeof p.vpWidthPercent === "number") vpWidthPercent.value = Math.min(80, Math.max(5, p.vpWidthPercent));
    if (typeof p.vpUpColor === "string" && /^#[0-9a-fA-F]{6}$/.test(p.vpUpColor)) vpUpColor.value = p.vpUpColor;
    if (typeof p.vpDownColor === "string" && /^#[0-9a-fA-F]{6}$/.test(p.vpDownColor)) vpDownColor.value = p.vpDownColor;
    if (typeof p.vpPocColor === "string" && /^#[0-9a-fA-F]{6}$/.test(p.vpPocColor)) vpPocColor.value = p.vpPocColor;
    if (typeof p.vpVaColor === "string" && /^#[0-9a-fA-F]{6}$/.test(p.vpVaColor)) vpVaColor.value = p.vpVaColor;
    if (typeof p.vpShowPocLabel === "boolean") vpShowPocLabel.value = p.vpShowPocLabel;
    if (typeof p.vpShowVaLines === "boolean") vpShowVaLines.value = p.vpShowVaLines;
    if (p.vpRanges && typeof p.vpRanges === "object") {
      const clean: Record<string, { start: number; end: number }> = {};
      for (const [k, r] of Object.entries(p.vpRanges as Record<string, unknown>)) {
        const rec = r as Record<string, unknown>;
        if (
          typeof rec?.start === "number" && Number.isFinite(rec.start) &&
          typeof rec?.end === "number" && Number.isFinite(rec.end) &&
          rec.end > rec.start
        ) {
          clean[k] = { start: rec.start, end: rec.end };
        }
      }
      vpRanges.value = clean;
    }
  }

  // Restore persisted state
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as {
        added?: boolean;
        visible?: boolean;
        labels?: boolean;
        enabled?: Record<string, boolean>;
        defs?: { id: string; name?: string; color?: string }[];
        customs?: CustomSession[];
        rsiAdded?: boolean;
        rsiVisible?: boolean;
        rsiLength?: number;
        rsiColor?: string;
        rsiLevelColor?: string;
        rsiUpper?: number;
        rsiLower?: number;
        smaAdded?: boolean;
        smaVisible?: boolean;
        smaLength?: number;
        smaColor?: string;
        emaAdded?: boolean;
        emaVisible?: boolean;
        emaLength?: number;
        emaColor?: string;
        vpVisible?: boolean;
        vpRows?: number;
        vpVaPercent?: number;
        vpWidthPercent?: number;
        vpUpColor?: string;
        vpDownColor?: string;
        vpPocColor?: string;
        vpVaColor?: string;
        vpShowPocLabel?: boolean;
        vpShowVaLines?: boolean;
        vpRanges?: Record<string, { start: number; end: number }>;
        addedMap?: Record<string, AddedFlags>;
        maInstances?: Record<string, unknown>;
      };
      if (typeof p.added === "boolean") sessionsAdded.value = p.added;
      if (typeof p.visible === "boolean") sessionsVisible.value = p.visible;
      if (typeof p.labels === "boolean") sessionsLabels.value = p.labels;
      if (p.enabled && typeof p.enabled === "object") {
        // persisted choices win, but every built-in stays present so its
        // checkbox can never render as an undefined/unticked state
        sessionsEnabled.value = {
          ...Object.fromEntries(SESSIONS.map((s) => [s.id, true])),
          ...p.enabled,
        };
      }
      if (Array.isArray(p.defs)) {
        for (const d of p.defs) {
          const target = defs.value.find((x) => x.id === d.id);
          if (!target) continue;
          if (typeof d.name === "string" && d.name.trim()) target.name = d.name.trim().slice(0, 20);
          if (typeof d.color === "string" && /^#[0-9a-fA-F]{6}$/.test(d.color)) target.color = d.color;
        }
      }
      if (typeof p.rsiAdded === "boolean") rsiAdded.value = p.rsiAdded;
      if (typeof p.rsiVisible === "boolean") rsiVisible.value = p.rsiVisible;
      if (typeof p.rsiLength === "number" && p.rsiLength >= 2 && p.rsiLength <= 200) rsiLength.value = Math.round(p.rsiLength);
      if (HEXc(p.rsiColor)) rsiColor.value = p.rsiColor;
      if (HEXc(p.rsiLevelColor)) rsiLevelColor.value = p.rsiLevelColor;
      if (typeof p.rsiUpper === "number") rsiUpper.value = Math.min(100, Math.max(1, p.rsiUpper));
      if (typeof p.rsiLower === "number") rsiLower.value = Math.min(99, Math.max(0, p.rsiLower));
      if (typeof p.smaAdded === "boolean") smaAdded.value = p.smaAdded;
      if (typeof p.smaVisible === "boolean") smaVisible.value = p.smaVisible;
      if (typeof p.smaLength === "number" && p.smaLength >= 2 && p.smaLength <= 500) smaLength.value = Math.round(p.smaLength);
      if (HEXc(p.smaColor)) smaColor.value = p.smaColor;
      if (typeof p.emaAdded === "boolean") emaAdded.value = p.emaAdded;
      if (typeof p.emaVisible === "boolean") emaVisible.value = p.emaVisible;
      if (typeof p.emaLength === "number" && p.emaLength >= 2 && p.emaLength <= 500) emaLength.value = Math.round(p.emaLength);
      if (HEXc(p.emaColor)) emaColor.value = p.emaColor;
      if (typeof p.vpVisible === "boolean") vpVisible.value = p.vpVisible;
      if (typeof p.vpRows === "number") vpRows.value = Math.min(200, Math.max(1, Math.round(p.vpRows)));
      if (typeof p.vpVaPercent === "number") vpVaPercent.value = Math.min(100, Math.max(0, p.vpVaPercent));
      if (typeof p.vpWidthPercent === "number") vpWidthPercent.value = Math.min(80, Math.max(5, p.vpWidthPercent));
      if (HEXc(p.vpUpColor)) vpUpColor.value = p.vpUpColor;
      if (HEXc(p.vpDownColor)) vpDownColor.value = p.vpDownColor;
      if (HEXc(p.vpPocColor)) vpPocColor.value = p.vpPocColor;
      if (HEXc(p.vpVaColor)) vpVaColor.value = p.vpVaColor;
      if (typeof p.vpShowPocLabel === "boolean") vpShowPocLabel.value = p.vpShowPocLabel;
      if (typeof p.vpShowVaLines === "boolean") vpShowVaLines.value = p.vpShowVaLines;
      if (p.vpRanges && typeof p.vpRanges === "object") {
        const clean: Record<string, { start: number; end: number }> = {};
        for (const [k, r] of Object.entries(p.vpRanges)) {
          if (r && Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start) {
            clean[k] = { start: r.start, end: r.end };
          }
        }
        vpRanges.value = clean;
      }
      if (p.addedMap && typeof p.addedMap === "object") {
        setAddedMap(p.addedMap);
      } else {
        // One-time migration from the legacy global flags: seed the CURRENT
        // symbol with whatever was enabled before per-symbol state existed.
        const seed: AddedFlags = {};
        if (p.added) seed.sessions = true;
        if (p.rsiAdded) seed.rsi = true;
        if (p.smaAdded) seed.sma = true;
        if (p.emaAdded) seed.ema = true;
        if (Object.keys(seed).length > 0) {
          addedMap.value = { [useMarketStore().instrument]: seed };
        }
      }
      if (p.maInstances && typeof p.maInstances === "object") {
        applyMaInstances(p.maInstances);
      } else {
        // Legacy single SMA/EMA → seed one instance per flagged symbol.
        migrateLegacyMas();
      }
      if (Array.isArray(p.customs)) {
        for (const c of p.customs) {
          if (c && typeof c.id === "string" && typeof c.name === "string" &&
              typeof c.start === "number" && typeof c.end === "number") {
            customs.value.push({
              id: c.id,
              name: String(c.name).slice(0, 20) || "Session",
              tz: typeof c.tz === "string" ? c.tz : "UTC",
              start: c.start,
              end: c.end,
              color: typeof c.color === "string" && /^#[0-9a-fA-F]{6}$/.test(c.color) ? c.color : "#8b93a7",
            });
          }
        }
      }
    }
  } catch {}

  watch(
    [sessionsAdded, sessionsVisible, sessionsLabels, sessionsEnabled, defs, customs, rsiAdded, rsiVisible, rsiLength, rsiColor, rsiLevelColor, rsiUpper, rsiLower,
     smaAdded, smaVisible, smaLength, smaColor, emaAdded, emaVisible, emaLength, emaColor, addedMap, maInstances,
     vpAdded, vpVisible, vpRows, vpVaPercent, vpWidthPercent, vpUpColor, vpDownColor, vpPocColor, vpVaColor, vpShowPocLabel, vpShowVaLines, vpRanges],
    () => {
      try {
      localStorage.setItem(
        KEY,
        JSON.stringify({
          added: sessionsAdded.value,
          visible: sessionsVisible.value,
          labels: sessionsLabels.value,
          enabled: sessionsEnabled.value,
          defs: defs.value.map((d) => ({ id: d.id, name: d.name, color: d.color })),
          customs: customs.value,
          rsiAdded: rsiAdded.value,
          rsiVisible: rsiVisible.value,
          rsiLength: rsiLength.value,
          rsiColor: rsiColor.value,
          rsiLevelColor: rsiLevelColor.value,
          rsiUpper: rsiUpper.value,
          rsiLower: rsiLower.value,
          smaAdded: smaAdded.value,
          smaVisible: smaVisible.value,
          smaLength: smaLength.value,
          smaColor: smaColor.value,
          emaAdded: emaAdded.value,
          emaVisible: emaVisible.value,
          emaLength: emaLength.value,
          emaColor: emaColor.value,
          maInstances: maInstances.value,
          vpVisible: vpVisible.value,
          vpRows: vpRows.value,
          vpVaPercent: vpVaPercent.value,
          vpWidthPercent: vpWidthPercent.value,
          vpUpColor: vpUpColor.value,
          vpDownColor: vpDownColor.value,
          vpPocColor: vpPocColor.value,
          vpVaColor: vpVaColor.value,
          vpShowPocLabel: vpShowPocLabel.value,
          vpShowVaLines: vpShowVaLines.value,
          vpRanges: vpRanges.value,
          addedMap: addedMap.value,
        })
      );
      } catch {}
    },
    { deep: true }
  );

  function addSessions(): void {
    sessionsAdded.value = true;
    sessionsVisible.value = true;
  }

  function removeSessions(): void {
    sessionsAdded.value = false;
  }

  function addVp(): void {
    vpAdded.value = true;
    vpVisible.value = true;
  }

  function removeVp(): void {
    vpAdded.value = false;
  }

  /** Add a user-defined session — interpreted in the VISITOR's own local
   *  clock (the built-in ones stay anchored to their market's clock). */
  function addCustomSession(name: string, start: number, end: number, color: string): boolean {
    const clean = name.trim().replace(/\s+/g, " ").slice(0, 20);
    if (clean.length < 1) return false;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    customs.value.push({
      id: "custom-" + Date.now().toString(36),
      name: clean,
      tz,
      start: ((Math.round(start) % 1440) + 1440) % 1440,
      end: ((Math.round(end) % 1440) + 1440) % 1440,
      color: /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#8b93a7",
    });
    sessionsEnabled.value[customs.value[customs.value.length - 1]!.id] = true;
    return true;
  }

  /** Remove a user-defined session (built-ins cannot be deleted). */
  function removeCustomSession(id: string): void {
    customs.value = customs.value.filter((c) => c.id !== id);
  }

  return {
    sessionsAdded,
    sessionsVisible,
    sessionsLabels,
    sessionsEnabled,
    defs,
    customs,
    rsiAdded,
    addedMap,
    setAddedMap,
    rsiVisible,
    rsiLength,
    rsiColor,
    rsiLevelColor,
    rsiUpper,
    rsiLower,
    smaAdded,
    smaVisible,
    smaLength,
    smaColor,
    emaAdded,
    emaVisible,
    emaLength,
    emaColor,
    maInstances,
    maListFor,
    maCurrentList,
    addMaInstance,
    removeMaInstance,
    patchMaInstance,
    vpAdded,
    vpVisible,
    vpRows,
    vpVaPercent,
    vpWidthPercent,
    vpUpColor,
    vpDownColor,
    vpPocColor,
    vpVaColor,
    vpShowPocLabel,
    vpShowVaLines,
    vpRanges,
    getVpRange,
    setVpRange,
    removeVpRange,
    isEnabled,
    settingsSnapshot,
    applySettings,
    addSessions,
    removeSessions,
    addVp,
    removeVp,
    addCustomSession,
    removeCustomSession,
  };
});
