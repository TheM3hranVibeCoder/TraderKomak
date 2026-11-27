/**
 * Cloudflare relay budget.
 *
 * Workers Free allows 100,000 requests per DAY **per account** — the
 * oanda-proxy, binance-proxy and warmup Workers all draw from that one
 * counter — and answers anything past it with Cloudflare error 1027 (an HTML
 * error page) until 00:00 UTC. The relay is only the FALLBACK source for
 * OANDA data (visitors normally talk to OANDA directly, see oandaDirect.ts),
 * so once a response proves the quota is gone the app must stop dialing the
 * relay instead of retrying into the wall, and let the visitor's own internet
 * carry the data.
 *
 * Failures are classified, never blanket-parked:
 *   - "quota"   → parked until the next UTC midnight (the counter's reset)
 *   - "network" → a few in a row park the relay for a short window only, so
 *                 one blip never disables the fallback for whole sessions
 * A successful relay call clears the streak.
 */
const PARK_KEY = "tk-relay-parked-until";
/** Consecutive relay failures that mean "this relay is not reachable right
 *  now" (Cloudflare's 1027 page has no CORS headers, so the browser reports a
 *  plain network error — the status is never readable). */
const NETWORK_FAILURE_STREAK = 3;
const SHORT_PARK_MS = 10 * 60_000;

/** Next 00:00 UTC after `from` — when Cloudflare resets the daily counter. */
export function nextUtcMidnight(from: number = Date.now()): number {
  const d = new Date(from);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

function parkedUntil(): number {
  try {
    const raw = Number(localStorage.getItem(PARK_KEY));
    return Number.isFinite(raw) && raw > Date.now() ? raw : 0;
  } catch {
    return 0;
  }
}

/** True while the relay must not be dialed at all. */
export function proxyRelayParked(): boolean {
  return parkedUntil() > Date.now();
}

/** Epoch ms until which the relay is parked (0 = available). */
export function proxyParkedUntil(): number {
  return parkedUntil();
}

function park(until: number): void {
  try {
    localStorage.setItem(PARK_KEY, String(Math.max(parkedUntil(), until)));
  } catch {}
}

let failureStreak = 0;

/** Record a relay failure; parks it when the evidence says it is unusable. */
export function noteRelayFailure(reason: "quota" | "network" = "network"): void {
  if (reason === "quota") {
    failureStreak = 0;
    park(nextUtcMidnight());
    return;
  }
  failureStreak++;
  if (failureStreak >= NETWORK_FAILURE_STREAK) {
    failureStreak = 0;
    park(Date.now() + SHORT_PARK_MS);
  }
}

/** A relay call worked — the streak is over. */
export function noteRelaySuccess(): void {
  failureStreak = 0;
}

/**
 * Classify a non-OK relay response body. The Worker passes OANDA's own errors
 * through untouched, so a 429 alone means "OANDA is rate-limiting", NOT "the
 * relay is out of quota" — only Cloudflare's daily-limit signature parks it.
 */
export function classifyRelayFailure(status: number, bodyText: string | null): "quota" | "network" {
  const text = bodyText ?? "";
  if (status === 429) {
    if (/1027|daily request limit|exceeded the daily/i.test(text)) return "quota";
    // Cloudflare's error page (no JSON) → the request never reached the Worker.
    if (/<!doctype html|<html/i.test(text)) return "quota";
    return "network";
  }
  if (status >= 500) return "network";
  // 4xx from OANDA (bad instrument/timeframe) is our bug, not relay health.
  return "network";
}
