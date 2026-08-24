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
  "EUR_USD",
  "GBP_USD",
  "USD_JPY",
  "USD_CHF",
  "AUD_USD",
  "USD_CAD",
  "NZD_USD",
  "EUR_GBP",
]);

const ALLOWED_TIMEFRAMES = new Set(["1s", "5s", "10s", "15s", "30s", "1m", "5m", "15m", "30m", "1h", "1d"]);

function normalizeInstrument(raw: string): string {
  return raw.trim().toUpperCase().replace(/[/\-.]/g, "_");
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

  const upstreamUrl =
    `${marketServerUrl}/api/candles` +
    `?instrument=${encodeURIComponent(instrument)}` +
    `&timeframe=${encodeURIComponent(rawTimeframe)}` +
    `&count=${encodeURIComponent(String(count))}`;

  let res: Response;
  try {
    res = await fetch(upstreamUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return {
      statusCode: 502,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: { code: "UPSTREAM_UNAVAILABLE", message: "Market server is temporarily unavailable" } }),
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
