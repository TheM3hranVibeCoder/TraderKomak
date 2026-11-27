/**
 * Historical candles HTTP client.
 *
 * Routing (candle delivery off the market server):
 *   - Binance symbols → fetched DIRECTLY by the browser from Binance's
 *     public endpoints, falling back to HTX/Gate public mirrors when
 *     Binance geo-blocks the visitor (binanceDirect.ts; never the server).
 *   - OANDA symbols   → DIRECTLY to OANDA's practice API with a practice-account
 *     token from the pool in oandaAccounts.ts (browser CORS is allowed), with the
 *     oanda-proxy Cloudflare Worker as fallback for ISPs that block OANDA.
 *   - cTrader symbols → DIRECTLY to cTrader's JSON WebSocket gateway with
 *     the visitor's own connection (ctraderDirect.ts), market-server relay
 *     as fallback.
 *   - Everything else → the market-server REST API (as before).
 */
import { isTimeframe, providerOf, type Candle } from "@traderkomak/shared";
import { fetchBinanceCandles } from "./binanceDirect";
import { fetchOandaCandles, oandaProxyConfigured } from "./oandaDirect";
import { proxyRelayParked, proxyParkedUntil } from "./proxyBudget";
import { oandaPoolState } from "./oandaAccounts";
import { fetchCtraderCandles, ctraderDirectConfigured } from "./ctraderDirect";
import { httpBase } from "./httpUrl";

interface CandlesResponse {
  instrument: string;
  timeframe: string;
  candles: Candle[];
}

interface ErrorBody {
  error?: { code: string; message: string };
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
      // Strict no-Render policy for Binance: the browser always talks to
      // Binance (or its public mirrors) over the visitor's own internet.
      // If that is geo-blocked/reset for this visitor, we surface the
      // failure instead of falling back to the market server — Render's
      // metered bandwidth must never absorb Binance traffic.
      return fetchBinanceCandles(instrument, timeframe, count, to);
    }
    if (provider === "oanda") {
      // All tokens cooling down after a rate limit is TEMPORARY — say so
      // instead of claiming the proxy is missing.
      if (oandaPoolState() === "cooldown") {
        throw new Error("OANDA rate-limited — try again in a minute");
      }
      if (oandaProxyConfigured()) return fetchOandaCandles(instrument, timeframe, count, to);
      // OANDA without its proxy config: no server fallback — the market
      // server's metered bandwidth must never serve OANDA data.
      throw new Error(
        proxyRelayParked()
          ? `OANDA relay out of daily quota — data resumes after ${new Date(proxyParkedUntil()).toISOString().slice(11, 16)} UTC`
          : "OANDA data unavailable — proxy not configured"
      );
    }
    if (provider === "ctrader") {
      // Browser-direct primary (cTrader's JSON WebSocket — the visitor's
      // own internet carries the data, exactly like OANDA/Binance), with
      // the market server as a relay fallback when the direct connection
      // fails (blocked ISP, WS handshake rejected…).
      if (ctraderDirectConfigured()) {
        try {
          return await fetchCtraderCandles(instrument, timeframe, count, to);
        } catch {
          // fall through to the server relay
        }
      }
      return fetchServerCandles(instrument, timeframe, count, to);
    }
    if (provider === "dukascopy") {
      // Dukascopy has no browser-direct source; serving it from the market
      // server was disabled to save Render bandwidth.
      throw new Error("Dukascopy data is not served by this deployment");
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
