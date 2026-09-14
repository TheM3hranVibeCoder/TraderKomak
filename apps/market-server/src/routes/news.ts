/**
 * Forex Factory economic calendar proxy (GET /api/news).
 *
 * Fetches the weekly medium/high-impact + holiday calendar from the free
 * Forex Factory JSON feed — SERVER-SIDE and CACHED, because the feed
 * blocks IPs that request it rapidly (every visitor fetching directly
 * would get everyone blocked). One upstream fetch per ~30 minutes, with
 * a short 2-minute refresh window when a high-impact release just
 * happened so "actual" values appear quickly.
 */
import type { FastifyInstance } from "fastify";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

const FF_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
const BASE_TTL = 30 * 60_000;
const NEAR_RELEASE_TTL = 2 * 60_000;
const NEAR_WINDOW = 10 * 60_000;

interface NewsItem {
  title: string;
  country: string;
  /** ISO 8601 with offset, straight from the feed. */
  date: string;
  impact: string;
  forecast: string | null;
  previous: string | null;
  actual: string | null;
}

let cache: { fetchedAt: number; items: NewsItem[] } | null = null;
let inFlight: Promise<void> | null = null;
/** Upstream is polite-fetched at most once a minute, whatever happens. */
let lastAttempt = 0;

const DATA_DIR = join(process.cwd(), "data");
const CACHE_FILE = join(DATA_DIR, "news-cache.json");

/** Disk-backed cache: a server restart must not blank the panel until the
 *  next upstream fetch succeeds (the feed is rate-limited and the first
 *  post-restart fetch often fails). */
function loadDisk(): void {
  try {
    const raw = JSON.parse(readFileSync(CACHE_FILE, "utf8")) as { fetchedAt: number; items: NewsItem[] };
    if (raw && Array.isArray(raw.items) && raw.items.length > 0) {
      cache = raw;
    }
  } catch {}
}

function saveDisk(): void {
  if (!cache) return;
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify(cache));
  } catch {}
}

function ttlMs(items: NewsItem[], now: number): number {
  // A high-impact release in the last 10 minutes → refresh fast to catch
  // the "actual" value; otherwise the polite 30-minute cadence.
  const recent = items.some(
    (i) =>
      i.impact === "High" &&
      i.date &&
      now - Date.parse(i.date) >= 0 &&
      now - Date.parse(i.date) < NEAR_WINDOW
  );
  return recent ? NEAR_RELEASE_TTL : BASE_TTL;
}

async function refresh(): Promise<void> {
  const res = await fetch(FF_URL, {
    headers: {
      "User-Agent": "TraderKomak/1.0 (trading site calendar widget)",
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`FF feed ${res.status}`);
  const raw = (await res.json()) as Array<Record<string, unknown>>;
  if (!Array.isArray(raw) || raw.length === 0) {
    // The feed sometimes serves an empty list between weeks — keep the
    // previous cached week instead of wiping the panel.
    if (cache) {
      cache.fetchedAt = Date.now();
      return;
    }
    throw new Error("FF feed empty");
  }
  const items: NewsItem[] = [];
  for (const it of raw) {
    const impact = String(it.impact ?? "");
    // Medium + High + bank holidays only — Low is noise for traders
    if (impact !== "High" && impact !== "Medium" && impact !== "Holiday") continue;
    const date = String(it.date ?? "");
    if (!it.title || !date) continue;
    items.push({
      title: String(it.title),
      country: String(it.country ?? ""),
      date,
      impact,
      forecast: it.forecast ? String(it.forecast) : null,
      previous: it.previous ? String(it.previous) : null,
      actual: it.actual ? String(it.actual) : null,
    });
  }
  items.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  cache = { fetchedAt: Date.now(), items };
}

export function registerNewsRoute(app: FastifyInstance): void {
  loadDisk();
  // Warm the cache at startup so the first visitor never waits upstream.
  void maybeRefresh(app);

  app.get("/api/news", async () => {
    const now = Date.now();
    // Fresh enough → answer instantly from memory.
    const cur = cache;
    if (cur && now - cur.fetchedAt < ttlMs(cur.items, now)) {
      return { ...cur, stale: false };
    }
    if (cur) {
      // Stale but present: serve it NOW and refresh in the background.
      // A slow/blocked upstream must never blank the panel.
      void maybeRefresh(app);
      return { ...cur, stale: true };
    }
    // No cache at all (first boot, disk load failed): wait one round.
    await maybeRefresh(app);
    if (cache) return { ...cache, stale: false };
    return { fetchedAt: 0, items: [], stale: true, error: "news feed unavailable" };
  });
}

/** Throttled upstream refresh — at most one attempt per 60s, one in flight. */
function maybeRefresh(app: FastifyInstance): Promise<void> {
  const now = Date.now();
  if (inFlight) return inFlight;
  if (cache && now - lastAttempt < 60_000) return Promise.resolve();
  lastAttempt = now;
  inFlight = refresh()
    .then(() => saveDisk())
    .catch((err) => {
      app.log.warn({ err: err instanceof Error ? err.message : "unknown" }, "FF calendar fetch failed");
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}
