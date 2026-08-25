/**
 * Netlify Function: short-lived HTTP proxy for historical candles.
 *
 * Path mapping (via netlify.toml redirect):
 *   GET /api/candles → /.netlify/functions/candles
 *
 * This function NEVER holds an OANDA streaming connection. It only forwards
 * a single REST request to the persistent market server (MARKET_SERVER_URL)
 * and returns the normalized response.
 *
 * Secrets: OANDA credentials live only on the market server. This function
 * only needs MARKET_SERVER_URL (no token).
 */

import type { Handler } from "@netlify/functions";

const ALLOWED_INSTRUMENTS = new Set([
  // OANDA
  "EUR_USD", "GBP_USD", "USD_JPY", "USD_CHF", "AUD_USD", "USD_CAD",
  "NZD_USD", "EUR_GBP", "XAU_USD", "XAG_USD", "GBP_JPY", "EUR_JPY",
  "AUD_JPY", "BCO_USD", "SPX500_USD", "NAS100_USD", "BTC_USD", "ETH_USD",
  // Binance (canonical = concatenated)
  "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT", "ADAUSDT", "DOGEUSDT",
]);

const ALLOWED_TIMEFRAMES = new Set(["1s", "5s", "10s", "15s", "30s", "1m", "5m", "15m", "30m", "1h", "1d"]);

const BINANCE_SET = new Set(["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT", "ADAUSDT", "DOGEUSDT"]);

/**
 * Mirrors packages/shared normalizeInstrument: Binance symbols stay
 * concatenated (btcusdt / BTC_USDT → BTCUSDT); others use OANDA form.
 */
function normalizeInstrument(raw: string): string {
  const s = raw.trim().toUpperCase().replace(/[/\-.]/g, "_").replace(/\s+/g, "");
  if (BINANCE_SET.has(s)) return s;
  if (s.includes("_")) {
    const flat = s.replace(/_/g, "");
    if (BINANCE_SET.has(flat)) return flat;
    return s;
  }
  if (s.length === 6) return `${s.slice(0, 3)}_${s.slice(3)}`;
  return s;
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: { code: "METHOD_NOT_ALLOWED", message: "Only GET is allowed" } }),
    };
  }

  const marketServerUrl = process.env.MARKET_SERVER_URL?.replace(/\/$/, "");
  if (!marketServerUrl) {
    return {
      statusCode: 502,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: {
          code: "NOT_CONFIGURED",
          message: "Market data server is not configured. Set MARKET_SERVER_URL in Netlify environment variables.",
        },
      }),
    };
  }

  const params = event.queryStringParameters ?? {};
  const rawInstrument = params.instrument ?? "";
  const rawTimeframe = params.timeframe ?? "";
  const rawCount = params.count ?? "500";
  const rawTo = params.to;

  const instrument = normalizeInstrument(rawInstrument);
  if (!ALLOWED_INSTRUMENTS.has(instrument)) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: { code: "INVALID_INSTRUMENT", message: "Unknown or unsupported instrument" } }),
    };
  }

  if (!ALLOWED_TIMEFRAMES.has(rawTimeframe)) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: { code: "INVALID_TIMEFRAME", message: "Unknown or unsupported timeframe" } }),
    };
  }

  const count = Number.parseInt(rawCount, 10);
  if (!Number.isInteger(count) || count <= 0 || count > 5000) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: { code: "INVALID_COUNT", message: "count must be between 1 and 5000" } }),
    };
  }

  let upstreamUrl =
    `${marketServerUrl}/api/candles` +
    `?instrument=${encodeURIComponent(instrument)}` +
    `&timeframe=${encodeURIComponent(rawTimeframe)}` +
    `&count=${encodeURIComponent(String(count))}`;

  // Lazy-load pagination: pass the `to` cursor through to the server.
  if (rawTo !== undefined) {
    const to = Number(rawTo);
    if (!Number.isFinite(to) || to <= 0) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: { code: "INVALID_TO", message: "to must be unix seconds" } }),
      };
    }
    upstreamUrl += `&to=${encodeURIComponent(String(Math.floor(to)))}`;
  }

  // Render free instances sleep after ~15 min idle; the first request pays
  // a long cold start. Retry once so a wake-up ping still succeeds within
  // the Netlify function budget.
  let res: Response | null = null;
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      res = await fetch(upstreamUrl, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(9_000),
      });
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 800));
    }
  }

  if (!res) {
    return {
      statusCode: 502,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: {
          code: "UPSTREAM_UNAVAILABLE",
          message: "Market server is waking up or unreachable — retry in a few seconds",
        },
      }),
    };
  }

  const body = await res.text();
  // Pass through status + body (already normalized JSON from market server).
  // Ensure safe headers and CORS handled by Netlify.
  return {
    statusCode: res.status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body,
  };
};
