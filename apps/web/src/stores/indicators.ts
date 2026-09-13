import { defineStore } from "pinia";
import { ref, watch } from "vue";

const KEY = "tk-indicators-v1";

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
  const sessionsAdded = ref(false);
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

  /* ── RSI indicator ─────────────────────────────────────────────────── */
  const rsiAdded = ref(false);
  const rsiVisible = ref(true);
  const rsiLength = ref(14);
  const rsiColor = ref("#a78bfa");
  const rsiLevelColor = ref("#78909c");
  const rsiUpper = ref(70);
  const rsiLower = ref(30);
  /** User-defined sessions (visitor-local clock). */
  const customs = ref<CustomSession[]>([]);

  function isEnabled(id: string): boolean {
    return sessionsEnabled.value[id] !== false;
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
    [sessionsAdded, sessionsVisible, sessionsLabels, sessionsEnabled, defs, customs, rsiAdded, rsiVisible, rsiLength, rsiColor, rsiLevelColor, rsiUpper, rsiLower],
    () => {
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
        })
      );
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
    rsiVisible,
    rsiLength,
    rsiColor,
    rsiLevelColor,
    rsiUpper,
    rsiLower,
    isEnabled,
    addSessions,
    removeSessions,
    addCustomSession,
    removeCustomSession,
  };
});
