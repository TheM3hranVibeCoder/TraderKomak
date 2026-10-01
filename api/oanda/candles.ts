/**
 * Same-origin OANDA candle relay (Vercel Serverless Function).
 *
 * The browser used to fetch candles straight from `https://oanda.traderkomak.ir`
 * (a Cloudflare custom domain). Many Iranian ISPs TLS-reset connections to
 * Cloudflare-addressed hosts (ERR_CONNECTION_RESET), so those visitors got no
 * chart at all while the SITE ITSELF (this domain, on Vercel) loaded fine.
 *
 * This relay lives on the site's OWN domain — exactly like the SPA — and
 * forwards the request server-side to the worker (Vercel -> Cloudflare is not
 * affected by the visitor's ISP). The contract is identical to the worker, so
 * the client parser is unchanged:
 *
 *   GET /api/oanda/candles?instrument&granularity&count&to
 *     -> forwards to <OANDA_PROXY_URL>/candles?... and passes the raw OANDA
 *        body through (the client parses { candles: [{ time, mid: {...} }] }).
 *
 * The OANDA token never reaches this function: it stays in the worker's
 * secrets. Configure the upstream with the OANDA_PROXY_URL env var (defaults
 * to the production worker).
 */

const WORKER = (process.env.OANDA_PROXY_URL || "https://oanda.traderkomak.ir").replace(/\/+$/, "");

/** Mirrors cloudflare-worker/oanda/oanda-proxy.js. */
const INSTRUMENT_RE = /^[A-Z0-9]{2,8}(_[A-Z0-9]{2,8}){0,2}$/;
const GRANULARITY_RE = /^(S5|S10|S15|S30|M1|M2|M3|M4|M5|M10|M15|M30|H1|H2|H3|H4|H6|H8|H12|D|W|M)$/;
const MAX_CANDLES = 5000;

interface RelayRequest {
  method?: string;
  query?: Record<string, string | string[] | undefined>;
}
interface RelayResponse {
  status(code: number): RelayResponse;
  setHeader(name: string, value: string): void;
  send(body: string): void;
}

function one(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function fail(res: RelayResponse, status: number, code: string, message: string): void {
  res.status(status);
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.send(JSON.stringify({ error: { code, message } }));
}

export default async function handler(req: RelayRequest, res: RelayResponse): Promise<void> {
  if (req.method !== "GET") {
    fail(res, 405, "METHOD_NOT_ALLOWED", "Only GET is allowed");
    return;
  }

  const instrument = one(req.query?.instrument).toUpperCase();
  const granularity = one(req.query?.granularity) || "M1";
  const to = one(req.query?.to);
  let count = Number.parseInt(one(req.query?.count) || "500", 10);
  if (!Number.isFinite(count) || count < 1) count = 500;
  if (count > MAX_CANDLES) count = MAX_CANDLES;

  if (!INSTRUMENT_RE.test(instrument)) {
    fail(res, 400, "INVALID_INSTRUMENT", "Bad instrument");
    return;
  }
  if (!GRANULARITY_RE.test(granularity)) {
    fail(res, 400, "INVALID_TIMEFRAME", "Bad granularity");
    return;
  }

  let url =
    `${WORKER}/candles` +
    `?instrument=${encodeURIComponent(instrument)}` +
    `&granularity=${granularity}&count=${String(count)}`;
  if (to) url += `&to=${encodeURIComponent(to)}`;

  // One retry: a transient worker/Vercel hop must not blank the whole chart.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const upstream = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(12_000),
      });
      const body = await upstream.text();
      res.status(upstream.status);
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store");
      res.send(body);
      return;
    } catch {
      if (attempt === 2) {
        fail(res, 502, "UPSTREAM_UNAVAILABLE", "OANDA relay unreachable");
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
}
