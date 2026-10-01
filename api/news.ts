/**
 * Same-origin news relay (Vercel Serverless Function).
 *
 * The client used to fetch `https://edge.traderkomak.ir/api/news` directly.
 * That host is a Cloudflare custom domain which some Iranian ISPs TLS-reset
 * (ERR_CONNECTION_RESET), leaving the news panel empty for those visitors.
 * Serving it from the site's OWN domain fixes that — same trick as
 * api/oanda/candles.ts.
 *
 *   GET /api/news  ->  forwards to <NEWS_SOURCE_URL> and passes the JSON body
 *                      through unchanged.
 */

const SOURCE = (process.env.NEWS_SOURCE_URL || "https://edge.traderkomak.ir/api/news").replace(/\/+$/, "");

interface RelayRequest {
  method?: string;
}
interface RelayResponse {
  status(code: number): RelayResponse;
  setHeader(name: string, value: string): void;
  send(body: string): void;
}

export default async function handler(req: RelayRequest, res: RelayResponse): Promise<void> {
  if (req.method !== "GET") {
    res.status(405);
    res.setHeader("Content-Type", "application/json");
    res.send(JSON.stringify({ error: { code: "METHOD_NOT_ALLOWED", message: "Only GET is allowed" } }));
    return;
  }

  try {
    const upstream = await fetch(SOURCE, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    const body = await upstream.text();
    res.status(upstream.status);
    res.setHeader("Content-Type", "application/json");
    // The feed is a weekly calendar; a short edge cache spares the worker.
    res.setHeader("Cache-Control", upstream.ok ? "public, max-age=120" : "no-store");
    res.send(body);
  } catch {
    res.status(502);
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.send(JSON.stringify({ error: { code: "UPSTREAM_UNAVAILABLE", message: "News relay unreachable" } }));
  }
}
