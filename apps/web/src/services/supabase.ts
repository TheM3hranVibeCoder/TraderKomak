/** Supabase client — created lazily and only when the anon key is present,
 *  so the site keeps working (guest mode) if the env vars are missing. */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const ANON = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

export const supabaseReady = !!URL && !!ANON;

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
    if (value === null) {
      document.cookie = `${name}=; Max-Age=0; path=/; SameSite=Lax`;
      return;
    }
    // Cookies cap at ~4KB — a session that can't fit intact must not be
    // written truncated (corrupt JSON would poison the fallback).
    if (value.length > 3500) return;
    document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${COOKIE_MAX_AGE}; path=/; SameSite=Lax`;
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
