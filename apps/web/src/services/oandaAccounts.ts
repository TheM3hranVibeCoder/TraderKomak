/**
 * OANDA **practice** accounts used for DIRECT browser access.
 *
 * The tokens are deliberately public here: these are demo accounts, OANDA's
 * practice API allows browser CORS (verified — the preflight permits the
 * Authorization header and the responses echo the site origin), and this is
 * exactly what makes every visitor fetch candles/ticks with THEIR OWN
 * internet: no relay, no CDN bandwidth, and it keeps working where ISP
 * filtering resets Cloudflare-hosted relay domains.
 *
 * Rotation: each browser sticks to ONE account (a random sticky index spreads
 * visitors across the pool). A REJECTED account (401/403 — dead/revoked token)
 * is retired for the session and the next one takes over. A RATE-LIMITED one
 * (429) only cools down for a while and comes back — rate limits are
 * transient, and permanently retiring healthy tokens for a busy moment left
 * the whole pool "unavailable" (the proxy-not-configured report). Network
 * failures never retire anything.
 * Add or remove entries freely — this list is the whole configuration.
 *
 * !! PRACTICE ACCOUNTS ONLY. A live-account token must never be placed here:
 *    anyone can read it straight from the page source. !!
 */
export interface OandaAccount {
  id: string;
  token: string;
}

export const OANDA_ACCOUNTS: OandaAccount[] = [
  { id: "101-001-40494694-001", token: "168123a8785fdfae406644276a28719e-abe5b327c3d1e3324218f7a642303bea" },
  { id: "101-001-40494533-001", token: "04b34587b79f68cd2eba9aadac1cd318-0ba55e7fc5b64c23d7204a8b593cab63" },
];

const PICK_KEY = "tk-oanda-acct";
/** Indexes retired for this session (auth-rejected tokens). */
const retired = new Set<number>();
/** Indexes cooling down after a 429 (idx → usable-again epoch ms). */
const cooldown = new Map<number, number>();

function cooling(idx: number): boolean {
  const until = cooldown.get(idx) ?? 0;
  if (until === 0) return false;
  if (Date.now() >= until) {
    cooldown.delete(idx);
    return false;
  }
  return true;
}

/** Why the pool can't serve right now (for honest error messages):
 *  "cooldown" = all tokens rate-limited but recovering, "retired" = all
 *  rejected, null = pool healthy. */
export function oandaPoolState(): "cooldown" | "retired" | null {
  if (OANDA_ACCOUNTS.length === 0) return "retired";
  const anyUsable = OANDA_ACCOUNTS.some((_, i) => !retired.has(i) && !cooling(i));
  if (anyUsable) return null;
  const anyCooling = OANDA_ACCOUNTS.some((_, i) => !retired.has(i) && cooling(i));
  return anyCooling ? "cooldown" : "retired";
}

function persist(idx: number): void {
  try {
    localStorage.setItem(PICK_KEY, String(idx));
  } catch {}
}

/** Sticky account for this browser, skipping retired ones; null when the
 *  pool is exhausted (callers then fall back to the worker relay). */
export function currentOandaAccount(): OandaAccount | null {
  if (OANDA_ACCOUNTS.length === 0) return null;
  const usable = (i: number): boolean => !retired.has(i) && !cooling(i);
  let idx = -1;
  try {
    idx = Number(localStorage.getItem(PICK_KEY));
  } catch {}
  if (!Number.isInteger(idx) || idx < 0 || idx >= OANDA_ACCOUNTS.length || !usable(idx)) {
    idx = OANDA_ACCOUNTS.findIndex((_, i) => usable(i));
    if (idx < 0) return null;
    persist(idx);
  }
  return OANDA_ACCOUNTS[idx]!;
}

/** Retire `used` for the session (auth rejection only) and return the next
 *  usable account (null when none is left). */
export function rotateOandaAccount(used: OandaAccount): OandaAccount | null {
  const idx = OANDA_ACCOUNTS.findIndex((a) => a.id === used.id && a.token === used.token);
  if (idx >= 0) retired.add(idx);
  const next = OANDA_ACCOUNTS.findIndex((_, i) => !retired.has(i) && !cooling(i));
  if (next < 0) return null;
  persist(next);
  return OANDA_ACCOUNTS[next]!;
}

/** Rate-limited: cool `used` down for `ms` and return the next usable
 *  account (may end up being the SAME one once its cooldown expires — a 429
 *  must not permanently kill a healthy token). */
export function cooldownOandaAccount(used: OandaAccount, ms: number): OandaAccount | null {
  const idx = OANDA_ACCOUNTS.findIndex((a) => a.id === used.id && a.token === used.token);
  if (idx >= 0) cooldown.set(idx, Date.now() + ms);
  const next = OANDA_ACCOUNTS.findIndex((_, i) => !retired.has(i) && !cooling(i));
  if (next < 0) return null;
  persist(next);
  return OANDA_ACCOUNTS[next]!;
}
