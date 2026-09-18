import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { supabase, supabaseReady } from "@/services/supabase";
import { useChatStore } from "@/stores/chat";

export type AuthStatus = "guest" | "needs-username" | "ready" | "loading";

export interface Profile {
  username: string;
  avatarUrl: string | null;
  /** Room owner/admin flag — set in the Supabase profiles table. */
  isAdmin?: boolean;
}

const USERNAME_RE = /^[a-zA-Z0-9_]+$/;
/** Sliding login window: each visit re-marks this stamp; if the user stays
 *  away longer than 7 days the session is dropped and they sign in again. */
const LASTVISIT_KEY = "tk-auth-lastvisit";
const SESSION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Render hint for the app gate: "was logged in on this device" — lets the
 *  app render optimistically during session restore (no landing flash).
 *  Mirrored into a cookie so a localStorage wipe (site-data clear /
 *  aggressive privacy settings) doesn't send returning users through the
 *  landing + Google round-trip again. */
const WASAUTH_KEY = "tk-was-auth";
const WASAUTH_COOKIE = "tk-was-auth";

function writeWasAuthCookie(on: boolean): void {
  try {
    document.cookie = on
      ? `${WASAUTH_COOKIE}=1; Max-Age=${60 * 60 * 24 * 180}; path=/; SameSite=Lax`
      : `${WASAUTH_COOKIE}=; Max-Age=0; path=/; SameSite=Lax`;
  } catch {}
}

function markVisit(): void {
  try { localStorage.setItem(LASTVISIT_KEY, String(Date.now())); } catch {}
}
function setWasAuth(v: boolean): void {
  try {
    if (v) localStorage.setItem(WASAUTH_KEY, "1");
    else localStorage.removeItem(WASAUTH_KEY);
  } catch {}
  writeWasAuthCookie(v);
}
const PROFILE_KEY = "tk-profile-cache";

function loadCachedProfile(): Profile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Profile;
      if (parsed && typeof parsed.username === "string") return parsed;
    }
  } catch {}
  return null;
}

/** Set while an OAuth redirect is in flight — the app gate uses it to
 *  render the chart (not the landing) during session restore, because a
 *  returning OAuth visitor IS signed in, just not confirmed yet. */
const INFLIGHT_KEY = "tk-auth-inflight";

export function authInFlight(): boolean {
  try { return sessionStorage.getItem(INFLIGHT_KEY) === "1"; } catch { return false; }
}

export function wasAuthOnDevice(): boolean {
  try {
    if (localStorage.getItem(WASAUTH_KEY) === "1") return true;
    // Fallback: a Supabase session blob in storage means a login existed on
    // this device even if our own flag was lost (e.g. partial site-data
    // clear) — render the app optimistically instead of the landing.
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("sb-") && k.includes("auth-token")) return true;
    }
  } catch {}
  // Cookie mirror survives a full localStorage wipe
  try {
    if (document.cookie.includes(`${WASAUTH_COOKIE}=1`)) return true;
  } catch {}
  return false;
}

export function validateUsername(raw: string): string | null {
  const u = raw.trim();
  if (u.length < 5) return "Username must be at least 5 characters";
  if (u.length > 20) return "Username must be at most 20 characters";
  if (!USERNAME_RE.test(u)) return "Only letters, numbers and _ are allowed";
  return null;
}

export const useAuthStore = defineStore("auth", () => {
  const status = ref<AuthStatus>(supabaseReady ? "loading" : "guest");
  const userId = ref<string | null>(null);
  const email = ref<string | null>(null);
  const profile = ref<Profile | null>(loadCachedProfile());
  const authModalOpen = ref(false);
  /** Error message shown inside the username step. */
  const claimError = ref<string | null>(null);
  const claiming = ref(false);

  const signedIn = computed(() => status.value === "ready");

  async function init(): Promise<void> {
    if (!supabaseReady) return;
    const sb = supabase();
    // Sliding 7-day window: read the PREVIOUS visit stamp first, then
    // re-mark — each visit extends the window by another 7 days.
    const last = Number(localStorage.getItem(LASTVISIT_KEY)) || 0;
    const expired = last && Date.now() - last > SESSION_WINDOW_MS;
    markVisit();
    if (expired) {
      try { await sb.auth.signOut(); } catch {}
      try { localStorage.removeItem(LASTVISIT_KEY); } catch {}
    }
    // A transient failure here must not sign the user out — retry once.
    let { data, error: gsErr } = await sb.auth.getSession();
    if (gsErr || !data.session) {
      await new Promise((r) => setTimeout(r, 1200));
      ({ data } = await sb.auth.getSession());
    }
    await applySession(data.session);
    sb.auth.onAuthStateChange((evt, session) => {
      // Diagnostic: a spontaneous sign-out must be EXPLAINABLE. Supabase
      // fires SIGNED_OUT on real sign-outs — and when a refresh token is
      // permanently invalid (JWT secret rotated / API keys migrated on the
      // project invalidates every stored session at once).
      if (evt === "SIGNED_OUT") {
        console.warn("[auth] event: SIGNED_OUT", session ? "(with session)" : "(no session)");
      }
      void applySession(session);
    });
  }

  async function applySession(session: { user: { id: string; email?: string | null; user_metadata?: Record<string, unknown> } | null } | null): Promise<void> {
    try { sessionStorage.removeItem(INFLIGHT_KEY); } catch {}
    if (!session?.user) {
      userId.value = null;
      email.value = null;
      profile.value = null;
      status.value = "guest";
      setWasAuth(false);
      return;
    }
    userId.value = session.user.id;
    email.value = session.user.email ?? null;
    setWasAuth(true);
    markVisit();
    // Optimistic fast-path ONLY for returning users (profile cached on this
    // device) — a brand-new Google account must wait for the profile check,
    // otherwise the chart flashes for a second before the username picker.
    if (profile.value) status.value = "ready";

    // Profile fetch with retries: a single network hiccup must NEVER kick
    // a signed-in user out (that read as "sign in again after a day").
    let row: { username: string; avatar_url: string | null; is_admin: boolean | null } | null = null;
    let loaded = false;
    for (let attempt = 0; attempt < 3 && !loaded; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 1200 * attempt));
      const { data, error } = await supabase()
        .from("profiles")
        .select("username, avatar_url, is_admin")
        .eq("user_id", session.user.id)
        .maybeSingle();
      if (!error) {
        row = data;
        loaded = true;
      } else {
        console.warn("profile load retry", attempt + 1, error.message);
      }
    }
    if (!loaded) {
      // All retries failed — trust the cached identity instead of forcing
      // a sign-out; the username refreshes on the next successful visit.
      console.error("profile load failed after retries");
      if (profile.value) {
        status.value = "ready";
        return;
      }
      status.value = "guest";
      setWasAuth(false);
      return;
    }
    if (row) {
      profile.value = { username: row.username, avatarUrl: row.avatar_url ?? null, isAdmin: !!row.is_admin };
      try { localStorage.setItem(PROFILE_KEY, JSON.stringify(profile.value)); } catch {}
      status.value = "ready";
      // Keep the email table fresh (readable only by admins) so the admin
      // panel can show which Google account a username belongs to.
      if (email.value) {
        void supabase()
          .from("user_emails")
          .upsert({ user_id: session.user.id, email: email.value });
      }
      // Supabase-driven admin: fetch the moderator key from the
      // admin-only table and upgrade the chat connection with it.
      if (profile.value.isAdmin) {
        const { data: keyRow } = await supabase()
          .from("admin_settings")
          .select("admin_key")
          .eq("id", 1)
          .maybeSingle();
        if (keyRow?.admin_key) useChatStore().setAdminKey(String(keyRow.admin_key));
      }
    } else {
      status.value = "needs-username";
    }
  }

  function signInWithGoogle(): void {
    if (!supabaseReady) return;
    try { sessionStorage.setItem(INFLIGHT_KEY, "1"); } catch {}
    void supabase().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
  }

  async function signOut(): Promise<void> {
    if (supabaseReady) await supabase().auth.signOut();
    userId.value = null;
    email.value = null;
    profile.value = null;
    status.value = "guest";
    setWasAuth(false);
    try {
      localStorage.removeItem(PROFILE_KEY);
      // Never leak the previous account's chat identity into the next one.
      localStorage.removeItem("tk-chat-nick");
    } catch {}
    try { useChatStore().nick = ""; } catch {}
    authModalOpen.value = false;
  }

  /** Returns null on success, or an error string ("taken" / validation). */
  async function claimUsername(raw: string): Promise<string | null> {
    const invalid = validateUsername(raw);
    if (invalid) return invalid;
    if (!userId.value) return "Not signed in";
    claiming.value = true;
    claimError.value = null;
    try {
      const sb = supabase();
      const username = raw.trim();
      // Unique index on username_lower is the real guard; the select just
      // gives a friendlier pre-check (also drives the live availability UI).
      // Case-insensitive availability check. Some legacy rows may have a
      // NULL username_lower (predates the column) — compare against BOTH
      // the normalized column and the raw username so TaymaZ/taymaz/TAYMAZ
      // all collide.
      const lower = username.toLowerCase();
      const { data: existing } = await sb
        .from("profiles")
        .select("user_id, username, username_lower")
        .or(`username_lower.eq.${lower},username.eq.${username}`)
        .maybeSingle();
      if (existing) {
        const stored = String(existing.username_lower ?? existing.username ?? "").toLowerCase();
        if (stored === lower) return "That username is already taken";
      }
      const { error } = await sb.from("profiles").insert({
        user_id: userId.value,
        username,
        username_lower: username.toLowerCase(),
      });
      if (error) {
        if ((error as { code?: string }).code === "23505") return "That username is already taken";
        console.error("claim failed", error);
        return "Could not save username — try again";
      }
      profile.value = { username, avatarUrl: null };
      status.value = "ready";
      authModalOpen.value = false;
      return null;
    } finally {
      claiming.value = false;
    }
  }

  async function checkUsernameAvailable(raw: string): Promise<boolean | null> {
    const invalid = validateUsername(raw);
    if (invalid || !supabaseReady) return null;
    const { data } = await supabase()
      .from("profiles")
      .select("user_id")
      .eq("username_lower", raw.trim().toLowerCase())
      .maybeSingle();
    return !data;
  }

  function openAuthModal(): void {
    authModalOpen.value = true;
  }

  return {
    status,
    signedIn,
    userId,
    email,
    profile,
    authModalOpen,
    claimError,
    claiming,
    init,
    signInWithGoogle,
    signOut,
    claimUsername,
    checkUsernameAvailable,
    openAuthModal,
  };
});
