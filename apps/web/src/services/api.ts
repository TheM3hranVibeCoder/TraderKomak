/**
 * Historical candles HTTP client.
 *
 * Talks only to TraderKomak's own backend — never to OANDA directly.
 * Handles validation, error mapping, and prevents secret leakage.
 */
import type { Candle } from "@traderkomak/shared";

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
  const raw = import.meta.env.VITE_API_HTTP_URL ?? "";
  return raw.replace(/\/$/, "");
}

export async function fetchCandles(
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
