/**
 * Economic news service — fetches the medium/high-impact Forex Factory
 * calendar. Primary source is the /news route on the oanda-proxy Cloudflare
 * Worker (edge-cached, VPS-independent); the market server's /api/news is
 * the fallback. Never fetched from FF directly by browsers: the feed blocks
 * IPs that hit it rapidly, so one shared egress (worker or server) fetches
 * and caches for everyone.
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

/** News proxy base (Cloudflare worker — keeps news alive while the market
 *  server/VPS is down). A dedicated URL wins; otherwise the oanda-proxy
 *  worker (which also serves /news) is used. */
function newsProxyBase(): string | null {
  const dedicated = (import.meta.env.VITE_NEWS_PROXY_URL as string | undefined)?.trim();
  const base = dedicated || (import.meta.env.VITE_OANDA_PROXY_URL as string | undefined)?.trim();
  return base ? base.replace(/\/+$/, "") : null;
}

type RawFeed = {
  fetchedAt: number;
  items: Array<{ title: string; country: string; date: string; impact: string; forecast: string | null; previous: string | null; actual: string | null }>;
  stale?: boolean;
  serverNow?: number;
  error?: string;
};

function parseFeed(d: RawFeed): NewsFeed {
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

export async function fetchNews(): Promise<NewsFeed> {
  const proxy = newsProxyBase();
  if (proxy) {
    try {
      const res = await fetch(`${proxy}/news`, { signal: AbortSignal.timeout(12000) });
      if (res.ok) return parseFeed((await res.json()) as RawFeed);
    } catch {
      // Worker unreachable → fall through to the market server.
    }
  }
  const res = await fetch(`${httpBase()}/api/news`, { signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error("news feed unavailable");
  return parseFeed((await res.json()) as RawFeed);
}
