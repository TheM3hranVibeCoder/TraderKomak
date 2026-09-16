/**
 * Economic news service — fetches the medium/high-impact calendar from the
 * market server's cached Forex Factory feed (never from FF directly: the
 * server caches upstream and rate limits are enforced there).
 */
export interface NewsItem {
  title: string;
  country: string;
  /** Epoch ms. */
  date: number;
  impact: "High" | "Medium" | "Holiday";
  forecast: string | null;
  previous: string | null;
  actual: string | null;
}

export interface NewsFeed {
  fetchedAt: number;
  items: NewsItem[];
  stale: boolean;
  /** Authoritative market-server time (ms) — syncs every device's countdown. */
  serverNow?: number;
}

/** Same base as the candles API: the market server in production,
 *  same-origin (Vite proxy) in development. */
function httpBase(): string {
  const raw = import.meta.env.VITE_API_HTTP_URL as string | undefined;
  return (raw ?? "").replace(/\/$/, "");
}

export async function fetchNews(): Promise<NewsFeed> {
  const res = await fetch(`${httpBase()}/api/news`);
  if (!res.ok) throw new Error("news feed unavailable");
  const d = (await res.json()) as {
    fetchedAt: number;
    items: Array<{ title: string; country: string; date: string; impact: string; forecast: string | null; previous: string | null; actual: string | null }>;
    stale?: boolean;
    serverNow?: number;
    error?: string;
  };
  return {
    fetchedAt: d.fetchedAt ?? 0,
    stale: !!d.stale || !!d.error,
    serverNow: d.serverNow,
    items: (d.items ?? []).map((it) => ({
      title: it.title,
      country: it.country,
      date: Date.parse(it.date),
      impact: (["High", "Medium", "Holiday"].includes(it.impact) ? it.impact : "Medium") as NewsItem["impact"],
      forecast: it.forecast,
      previous: it.previous,
      actual: it.actual,
    })),
  };
}
