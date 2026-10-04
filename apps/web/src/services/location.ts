/**
 * "Where is this user?" — last-known IP + country, with NO market server.
 *
 * The admin panel used to ask the chat server for a visitor's IP, because only
 * a WebSocket endpoint sees a connection's address. Two consequences: with no
 * server running the answer never arrives, and for an OFFLINE user there is no
 * connection to ask at all. So every signed-in visitor records its own public
 * IP + country once per session into its own `user_emails` row, and the panel
 * reads them (the existing RLS already allows own-writes and admin reads).
 *
 * Privacy: this stores your users' IP addresses. Flip RECORD_LOCATION to
 * false to stop collecting — the panel then simply shows "unknown" again.
 */
import { supabase } from "@/services/supabase";

/** Master switch for the IP/country capture (privacy opt-out). */
export const RECORD_LOCATION = true;

/** Don't ask again within the same session/tab for this long. */
const THROTTLE_MS = 30 * 60_000;
const THROTTLE_KEY = "tk-loc-recorded-at";

/** CORS-enabled IP echo services, tried in order. ipapi.co used to be the
 *  primary but now sits behind a Cloudflare browser challenge (plain fetch
 *  always gets 403), which left every user's country "unknown" in the admin
 *  panel — so it is gone. ipwho.is and geojs both answer a plain GET from
 *  Iranian ISPs (verified) and return the IP + country in one call. */
const GEO_URLS = ["https://ipwho.is/", "https://get.geojs.io/v1/ip/geo.json"] as const;
const IP_ONLY_URL = "https://api.ipify.org?format=json";

export interface UserLocation {
  ip: string | null;
  country: string | null;
  countryCode: string | null;
  seenAt: string | null;
}

interface GeoResponse {
  ip?: unknown;
  country?: unknown;
  country_code?: unknown;
  success?: unknown;
}

async function fetchJson(url: string, timeoutMs: number): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Record the signed-in visitor's own IP + country on their row. Fire-and-forget
 * (never blocks sign-in), throttled to one call per 30 minutes, and a failure
 * here must never affect anything else — every error is swallowed.
 *
 * `email` (when the auth flow knows it) makes this a full UPSERT so the very
 * first login creates the row — a plain update would match zero rows and the
 * location would be lost until the next login. Without an email the upsert
 * only carries the location columns and leaves the email untouched.
 */
export async function recordMyLocation(userId: string, email?: string | null): Promise<void> {
  if (!RECORD_LOCATION) return;
  try {
    const last = Number(sessionStorage.getItem(THROTTLE_KEY) ?? 0) || 0;
    if (Date.now() - last < THROTTLE_MS) return;
    sessionStorage.setItem(THROTTLE_KEY, String(Date.now()));
  } catch {
    // sessionStorage unavailable (private mode) — still try, just unthrottled.
  }

  let ip: string | null = null;
  let country: string | null = null;
  let countryCode: string | null = null;
  for (const url of GEO_URLS) {
    const geo = (await fetchJson(url, 6000)) as GeoResponse | null;
    ip = typeof geo?.ip === "string" ? geo.ip : null;
    country = typeof geo?.country === "string" && geo.country ? geo.country : null;
    countryCode = typeof geo?.country_code === "string" && geo.country_code ? geo.country_code : null;
    // ipwho.is flags failures with success:false — skip to the next source.
    if (ip && (geo?.success === undefined || geo.success !== false)) break;
    ip = country = countryCode = null;
  }
  if (!ip) {
    // Fallback: IP only, no country (the panel shows the IP at least).
    const fallback = await fetchJson(IP_ONLY_URL, 5000);
    ip = typeof fallback?.ip === "string" ? fallback.ip : null;
  }
  if (!ip) return;

  try {
    // Upsert on the user_id PK: first login creates the row (with the email
    // when known), later logins refresh only the location columns. A missing
    // migration (or a column the user never added) makes this fail, which is
    // harmless by design.
    const row: Record<string, string> = {
      last_ip: ip,
      last_seen_at: new Date().toISOString(),
    };
    if (country) row.last_country = country;
    if (countryCode) row.last_country_code = countryCode;
    if (email) row.email = email;
    await supabase()
      .from("user_emails")
      .upsert({ user_id: userId, ...row });
  } catch {
    // ignore — the email sync above is what matters
  }
}

/**
 * Admin-side read: every user's last-known location, keyed by user_id.
 * Requires an is_admin profile (the table's "admin reads emails" policy).
 */
export async function fetchAllLocations(): Promise<Map<string, UserLocation>> {
  const out = new Map<string, UserLocation>();
  try {
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase()
        .from("user_emails")
        .select("user_id, last_ip, last_country, last_country_code, last_seen_at")
        .range(from, from + PAGE - 1);
      if (error || !data) break;
      for (const row of data as {
        user_id: string;
        last_ip: string | null;
        last_country: string | null;
        last_country_code: string | null;
        last_seen_at: string | null;
      }[]) {
        out.set(row.user_id, {
          ip: row.last_ip ?? null,
          country: row.last_country ?? null,
          countryCode: row.last_country_code ?? null,
          seenAt: row.last_seen_at ?? null,
        });
      }
      if (data.length < PAGE) break;
    }
  } catch {
    // Migration not applied yet, or not an admin — the panel degrades to
    // "unknown" exactly as before.
  }
  return out;
}
