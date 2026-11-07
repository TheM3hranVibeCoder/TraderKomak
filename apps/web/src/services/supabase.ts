/** Supabase client — created lazily and only when the anon key is present,
 *  so the site keeps working (guest mode) if the env vars are missing. */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const ANON = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

export const supabaseReady = !!URL && !!ANON;
/** Exported for cloudSync's keepalive unload flush, which issues a raw REST
 *  upsert because the page is dying and cannot await the JS client. */
export const SUPABASE_URL = URL;
export const SUPABASE_ANON_KEY = ANON;

let client: SupabaseClient | null = null;

/* ── Durable session storage ────────────────────────────────────────────
 * The default storage is localStorage only — "clear site data", aggressive
 * browser privacy settings or extensions wipe it and sign the user out
 * (reported as "the site asked me to sign in again"). The auth session is
 * MIRRORED into a first-party cookie: reads prefer localStorage and fall
 * back to the cookie, writes go to both, so the session survives a
 * localStorage wipe and re-seeds it on the next visit. Strictly-necessary
 * auth storage needs no cookie consent (GDPR/ePrivacy exemption). */
const AUTH_COOKIE = "tk-sb-session";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 180; // 180 days

function readCookie(name: string): string | null {
  try {
    const m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]!) : null;
  } catch {
    return null;
  }
}

function writeCookie(name: string, value: string | null): void {
  try {
    // Secure on HTTPS only — a plain-HTTP dev origin would silently drop the
    // cookie and break the session fallback.
    const secure = document.location.protocol === "https:" ? "; Secure" : "";
    if (value === null) {
      document.cookie = `${name}=; Max-Age=0; path=/; SameSite=Lax${secure}`;
      return;
    }
    // Cookies cap at ~4KB — a session that can't fit intact must not be
    // written truncated (corrupt JSON would poison the fallback).
    if (value.length > 3500) return;
    document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${COOKIE_MAX_AGE}; path=/; SameSite=Lax${secure}`;
  } catch {}
}

const durableAuthStorage = {
  getItem(key: string): string | null {
    try {
      const v = localStorage.getItem(key);
      if (v !== null) return v;
    } catch {}
    if (key.includes("auth-token")) return readCookie(AUTH_COOKIE);
    return null;
  },
  setItem(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {}
    if (key.includes("auth-token")) writeCookie(AUTH_COOKIE, value);
  },
  removeItem(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {}
    if (key.includes("auth-token")) writeCookie(AUTH_COOKIE, null);
  },
};

export function supabase(): SupabaseClient {
  if (!client) {
    if (!URL || !ANON) throw new Error("Supabase is not configured");
    client = createClient(URL, ANON, {
      auth: {
        storage: durableAuthStorage,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return client;
}

/** Synchronous best-effort read of the current access token — used by the
 *  unload flush in cloudSync, which cannot await getSession() before the tab
 *  dies. Mirrors durableAuthStorage's localStorage-then-cookie order. */
export function getAccessTokenSync(): string | null {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("sb-") && k.endsWith("-auth-token")) {
        const raw = localStorage.getItem(k);
        if (!raw) continue;
        const parsed = JSON.parse(raw) as { access_token?: unknown; currentSession?: { access_token?: unknown } };
        if (typeof parsed.access_token === "string" && parsed.access_token) return parsed.access_token;
        if (typeof parsed.currentSession?.access_token === "string" && parsed.currentSession.access_token) {
          return parsed.currentSession.access_token;
        }
      }
    }
  } catch {}
  const cookie = readCookie(AUTH_COOKIE);
  if (cookie) {
    try {
      const parsed = JSON.parse(cookie) as { access_token?: unknown; currentSession?: { access_token?: unknown } };
      if (typeof parsed.access_token === "string" && parsed.access_token) return parsed.access_token;
      if (typeof parsed.currentSession?.access_token === "string" && parsed.currentSession.access_token) {
        return parsed.currentSession.access_token;
      }
    } catch {}
  }
  return null;
}
