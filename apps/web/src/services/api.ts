/**
 * Historical candles HTTP client.
 *
 * Routing (candle delivery off the market server):
 *   - Binance symbols → fetched DIRECTLY from Binance by the browser
 *     (binanceDirect.ts, public endpoints; server fallback on geo-block —
 *     a Cloudflare relay is not viable, Binance blocks datacenter IPs).
 *   - OANDA symbols   → DIRECTLY to OANDA's practice API with a practice-account
 *     token from the pool in oandaAccounts.ts (browser CORS is allowed), with the
 *     oanda-proxy Cloudflare Worker as fallback for ISPs that block OANDA.
 *   - Everything else → the market-server REST API (as before).
 */
import { isTimeframe, providerOf, type Candle } from "@traderkomak/shared";
import { fetchBinanceCandles } from "./binanceDirect";
import { fetchOandaCandles, oandaProxyConfigured } from "./oandaDirect";

interface CandlesResponse {
  instrument: string;
  timeframe: string;
  candles: Candle[];
}

interface ErrorBody {
  error?: { code: string; message: string };
}

function httpBase(): string {
  // VITE_API_HTTP_URL: "" (same origin, proxied) or explicit market-server URL.
  const raw = (import.meta.env.VITE_API_HTTP_URL as string | undefined)?.trim();
  if (raw) return raw.replace(/\/$/, "");
  // Production serves the SPA from Vercel with NO /api proxy, so relative
  // REST URLs would hit the SPA rewrite and return HTML. Derive the
  // absolute market-server origin from the WS URL instead:
  //   wss://edge.traderkomak.ir/ws → https://edge.traderkomak.ir
  const ws = (import.meta.env.VITE_MARKET_WS_URL as string | undefined)?.trim();
  if (ws) {
    const m = /^wss?:\/\/([^/]+)/i.exec(ws);
    if (m) return `${/^wss/i.test(ws) ? "https" : "http"}://${m[1]!}`;
  }
  return "";
}

/** Chat photos come from the server as an id (the history frame no longer
 *  carries multi-MB base64); the bytes live at /api/chat-img/:id behind an
 *  immutable browser cache, so each photo downloads exactly once. */
export function chatImgUrl(imgId: string): string {
  return `${httpBase()}/api/chat-img/${encodeURIComponent(imgId)}`;
}

export async function fetchCandles(
  instrument: string,
  timeframe: string,
  count: number,
  to?: number
): Promise<Candle[]> {
  const provider = providerOf(instrument);
  if (isTimeframe(timeframe)) {
    if (provider === "binance") {
      try {
        return await fetchBinanceCandles(instrument, timeframe, count, to);
      } catch {
        // Direct Binance is unreachable for this visitor (geo-block / reset)
        // and no Cloudflare relay can help — Binance blocks datacenter IPs.
        // The market server still serves Binance candles from the VPS, so
        // use it as the last-resort fallback before giving up.
        return fetchServerCandles(instrument, timeframe, count, to);
      }
    }
    if (provider === "oanda" && oandaProxyConfigured()) {
      return fetchOandaCandles(instrument, timeframe, count, to);
    }
  }
  return fetchServerCandles(instrument, timeframe, count, to);
}

/** Market-server REST fallback (dukascopy symbols; OANDA without a proxy). */
export async function fetchServerCandles(
  instrument: string,
  timeframe: string,
  count: number,
  to?: number
): Promise<Candle[]> {
  const base = httpBase();
  let url =
    `${base}/api/candles` +
    `?instrument=${encodeURIComponent(instrument)}` +
    `&timeframe=${encodeURIComponent(timeframe)}` +
    `&count=${encodeURIComponent(String(count))}`;
  if (to !== undefined) url += `&to=${encodeURIComponent(String(to))}`;

  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: "application/json" } });
  } catch {
    throw new Error("Network error — is the market server running?");
  }

  if (!res.ok) {
    let body: ErrorBody | null = null;
    try {
      body = (await res.json()) as ErrorBody;
    } catch {
      // ignore
    }
    const msg = body?.error?.message ?? `Request failed (HTTP ${res.status})`;
    throw new Error(msg);
  }

  let data: CandlesResponse;
  try {
    data = (await res.json()) as CandlesResponse;
  } catch {
    throw new Error("Malformed server response");
  }

  if (!Array.isArray(data.candles)) {
    throw new Error("Malformed candles response");
  }

  // Defensive: ensure ascending and no duplicates (backend already does this,
  // but we guard against malformed payloads without crashing the chart).
  const seen = new Set<number>();
  const out: Candle[] = [];
  for (const c of data.candles as unknown[]) {
    if (
      typeof c !== "object" ||
      c === null ||
      typeof (c as Record<string, unknown>).time !== "number" ||
      typeof (c as Record<string, unknown>).open !== "number"
    ) {
      continue;
    }
    const candle = c as Candle;
    if (seen.has(candle.time)) continue;
    if (
      !Number.isFinite(candle.time) ||
      !Number.isFinite(candle.open) ||
      !Number.isFinite(candle.high) ||
      !Number.isFinite(candle.low) ||
      !Number.isFinite(candle.close)
    ) {
      continue;
    }
    seen.add(candle.time);
    out.push(candle);
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}
