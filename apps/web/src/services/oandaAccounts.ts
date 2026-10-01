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
 * visitors across the pool). An account that is rate-limited (429) or rejected
 * (401/403) is retired for the session and the next one takes over; when all
 * are retired the code falls back to the worker relay (if configured).
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
/** Indexes retired for this session (rate-limited / rejected). */
const retired = new Set<number>();

function persist(idx: number): void {
  try {
    localStorage.setItem(PICK_KEY, String(idx));
  } catch {}
}

/** Sticky account for this browser, skipping retired ones; null when the
 *  pool is exhausted (callers then fall back to the worker relay). */
export function currentOandaAccount(): OandaAccount | null {
  if (OANDA_ACCOUNTS.length === 0) return null;
  let idx = -1;
  try {
    idx = Number(localStorage.getItem(PICK_KEY));
  } catch {}
  if (!Number.isInteger(idx) || idx < 0 || idx >= OANDA_ACCOUNTS.length || retired.has(idx)) {
    idx = OANDA_ACCOUNTS.findIndex((_, i) => !retired.has(i));
    if (idx < 0) return null;
    persist(idx);
  }
  return OANDA_ACCOUNTS[idx]!;
}

/** Retire `used` for this session and return the next live account (null when
 *  none is left). */
export function rotateOandaAccount(used: OandaAccount): OandaAccount | null {
  const idx = OANDA_ACCOUNTS.findIndex((a) => a.id === used.id && a.token === used.token);
  if (idx >= 0) retired.add(idx);
  const next = OANDA_ACCOUNTS.findIndex((_, i) => !retired.has(i));
  if (next < 0) return null;
  persist(next);
  return OANDA_ACCOUNTS[next]!;
}
