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
  app.get("/api/news", async () => {
    const now = Date.now();
    if (cache && now - cache.fetchedAt < ttlMs(cache.items, now)) {
      return { ...cache, stale: false };
    }
    if (!inFlight) {
      inFlight = refresh()
        .catch((err) => {
          app.log.warn({ err: err instanceof Error ? err.message : "unknown" }, "FF calendar fetch failed");
        })
        .finally(() => {
          inFlight = null;
        });
    }
    await inFlight;
    if (cache) return { ...cache, stale: now - cache.fetchedAt > ttlMs(cache.items, now) };
    return { fetchedAt: 0, items: [], stale: true, error: "news feed unavailable" };
  });
}
