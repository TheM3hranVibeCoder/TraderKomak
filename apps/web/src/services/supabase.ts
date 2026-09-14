/** Supabase client — created lazily and only when the anon key is present,
 *  so the site keeps working (guest mode) if the env vars are missing. */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const ANON = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

export const supabaseReady = !!URL && !!ANON;

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!client) {
    if (!URL || !ANON) throw new Error("Supabase is not configured");
    client = createClient(URL, ANON, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return client;
}
