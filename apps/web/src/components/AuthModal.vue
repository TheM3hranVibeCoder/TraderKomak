<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from "vue";
import { useAuthStore, validateUsername } from "@/stores/auth";
import { supabaseReady } from "@/services/supabase";

const auth = useAuthStore();

const draft = ref("");
const hint = ref<null | { kind: "ok" | "err" | "busy"; text: string }>(null);
let debounce: ReturnType<typeof setTimeout> | null = null;

/** "google" until the user is authenticated but has no username yet,
 *  then switch to the username picker. */
const step = computed<"google" | "username">(() =>
  auth.status === "needs-username" ? "username" : "google"
);

const invalid = computed(() => validateUsername(draft.value));

watch(draft, (v) => {
  if (debounce) clearTimeout(debounce);
  hint.value = null;
  const trimmed = v.trim();
  if (!trimmed) return;
  const err = validateUsername(trimmed);
  if (err) {
    hint.value = { kind: "err", text: err };
    return;
  }
  hint.value = { kind: "busy", text: "Checking…" };
  debounce = setTimeout(async () => {
    const avail = await auth.checkUsernameAvailable(trimmed);
    if (!avail) hint.value = { kind: "err", text: "That username is already taken" };
    else hint.value = { kind: "ok", text: "Available ✓" };
  }, 400);
});
onUnmounted(() => {
  if (debounce) clearTimeout(debounce);
});

async function claim(): Promise<void> {
  const err = await auth.claimUsername(draft.value);
  if (err) hint.value = { kind: "err", text: err };
}

function close(): void {
  // A user WITHOUT a username may not dismiss the picker — signing out is
  // the only way out (charts stay locked, per product rule).
  if (auth.status === "needs-username") return;
  auth.authModalOpen = false;
}

function onKey(e: KeyboardEvent): void {
  if (e.key === "Escape") close();
}
window.addEventListener("keydown", onKey);
onUnmounted(() => window.removeEventListener("keydown", onKey));
</script>

<template>
  <Teleport to="body">
    <div class="auth-backdrop" @click.self="close">
      <div class="auth-modal" role="dialog" aria-modal="true" aria-label="Sign in to TraderKomak" @click.self.stop>
        <button
          v-if="auth.status !== 'needs-username'"
          class="auth-close"
          type="button"
          aria-label="Close"
          @click="close"
        >✕</button>

        <!-- Step 1: sign in with Google -->
        <template v-if="step === 'google'">
          <div class="auth-logo" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 8.5L12 4l9 4.5" />
              <path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9" />
            </svg>
          </div>
          <h2 class="auth-title">Sign in to TraderKomak</h2>
          <p class="auth-sub">
            Save your chart drawings, watchlist and join the live chat with your own username.
          </p>
          <button
            v-if="supabaseReady"
            class="google-btn"
            type="button"
            @click="auth.signInWithGoogle()"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.66-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.87c2.26-2.09 3.57-5.16 3.57-8.81z" />
              <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.87-3c-1.07.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.29v3.1A12 12 0 0 0 12 24z" />
              <path fill="#FBBC05" d="M5.27 14.28A7.2 7.2 0 0 1 4.9 12c0-.79.14-1.56.37-2.28v-3.1H1.29a12 12 0 0 0 0 10.76l3.98-3.1z" />
              <path fill="#EA4335" d="M12 4.77c1.76 0 3.34.61 4.59 1.8l3.44-3.44A11.98 11.98 0 0 0 12 0 12 12 0 0 0 1.29 6.62l3.98 3.1C6.22 6.88 8.87 4.77 12 4.77z" />
            </svg>
            Continue with Google
          </button>
          <p v-else class="auth-note">
            Sign-in is not configured yet — the site still works in guest mode.
          </p>
        </template>

        <!-- Step 2: pick a username -->
        <template v-else>
          <h2 class="auth-title">Choose a username</h2>
          <p class="auth-sub">
            This is how others see you in the live chat. 5–20 characters, letters, numbers and _.
          </p>
          <div class="uname-row">
            <input
              v-model="draft"
              class="uname-input"
              :class="hint?.kind"
              type="text"
              maxlength="20"
              autocomplete="off"
              spellcheck="false"
              placeholder="e.g. chart_wizard"
              aria-label="Choose a username"
              @keydown.enter="claim"
            />
            <button
              class="uname-go"
              type="button"
              :disabled="!!invalid || auth.claiming || hint?.kind === 'err' || hint?.kind === 'busy'"
              @click="claim"
            >
              {{ auth.claiming ? "…" : "Join" }}
            </button>
          </div>
          <p v-if="hint" class="uname-hint" :class="hint.kind">{{ hint.text }}</p>
          <button class="auth-signout" type="button" @click="auth.signOut()">
            Sign out instead
          </button>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.auth-backdrop {
  position: fixed;
  inset: 0;
  z-index: 300;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(4, 8, 18, 0.6);
  backdrop-filter: blur(4px);
}
.auth-modal {
  position: relative;
  width: min(360px, calc(100vw - 32px));
  padding: 26px 24px 22px;
  border-radius: var(--radius-lg);
  background: var(--bg-panel-solid);
  border: 1px solid var(--border);
  box-shadow: var(--card-shadow);
  text-align: center;
}
.auth-close {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}
.auth-close:hover { background: var(--btn-hover); color: var(--text); }
.auth-logo {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 14px;
  background: var(--accent-gradient);
  color: #fff;
  margin-bottom: 10px;
}
.auth-title {
  margin: 0 0 6px;
  font-size: 17px;
  font-weight: 700;
  color: var(--text);
}
.auth-sub {
  margin: 0 0 16px;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--text-muted);
}
.google-btn {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 10px 18px;
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  background: var(--btn-bg);
  color: var(--text);
  font-size: 13.5px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease;
}
.google-btn:hover { background: var(--btn-hover); }
.auth-note { font-size: 12px; color: var(--text-muted); }
.uname-row { display: flex; gap: 8px; }
.uname-input {
  flex: 1;
  min-width: 0;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--border-strong);
  background: var(--btn-bg);
  color: var(--text);
  font-size: 13.5px;
}
.uname-input:focus { outline: none; border-color: var(--accent); }
.uname-input.ok { border-color: var(--live); }
.uname-input.err { border-color: var(--offline); }
.uname-go {
  padding: 10px 16px;
  border: none;
  border-radius: 10px;
  background: var(--accent-gradient);
  color: #fff;
  font-weight: 700;
  font-size: 13px;
  cursor: pointer;
}
.uname-go:disabled { opacity: 0.45; cursor: default; }
.uname-hint { margin: 10px 0 0; font-size: 12px; }
.uname-hint.ok { color: var(--live); }
.uname-hint.err { color: var(--offline); }
.uname-hint.busy { color: var(--text-muted); }
.auth-signout {
  margin-top: 18px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
  text-decoration: underline;
}
.auth-signout:hover { color: var(--text); }
</style>
