<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from "vue";
import { useAuthStore, authInFlight } from "@/stores/auth";

/** One-time welcome popup after an INTERACTIVE Google sign-in (OAuth
 *  redirect return — silent session restores never trigger it). Shows once
 *  per account, only after the auth gate opens (the chart is mounting
 *  behind it), promoting the Telegram channel: news + trade signals.
 *  Dismissal (join / later / ✕) persists per user id in localStorage. */

const auth = useAuthStore();
const visible = ref(false);
// An OAuth return boots the app with status "loading" and the inflight
// marker still in sessionStorage — capture it HERE, because the watch's
// `s === "loading"` branch never fires (no change event at mount) and
// applySession clears the marker before flipping to "ready".
let sawOauthReturn = (() => {
  try {
    return auth.status === "loading" && authInFlight();
  } catch {
    return false;
  }
})();
let showTimer: ReturnType<typeof setTimeout> | null = null;

const SEEN_KEY = "tk-tg-welcome-seen";

function alreadySeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === (auth.userId ?? "");
  } catch {
    return false;
  }
}
function markSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, auth.userId ?? "");
  } catch {}
}

watch(
  () => auth.status,
  (s, prev) => {
    // The OAuth redirect back to the site passes through status "loading"
    // with the inflight marker still in sessionStorage — capture that here,
    // because applySession clears the marker before flipping to "ready".
    if (s === "loading" && authInFlight()) sawOauthReturn = true;
    if (s === "ready" && prev === "loading" && sawOauthReturn) {
      sawOauthReturn = false;
      if (!auth.userId || alreadySeen()) return;
      // Let the chart paint first — the popup lands once it has loaded.
      if (showTimer) clearTimeout(showTimer);
      showTimer = setTimeout(() => {
        showTimer = null;
        // Re-check: the user may have signed out within the delay.
        if (auth.status === "ready" && auth.userId && !alreadySeen()) visible.value = true;
      }, 700);
    }
  }
);

function joinTg(): void {
  window.open("https://t.me/TraderKomak_ir", "_blank", "noopener,noreferrer");
  markSeen();
  visible.value = false;
}
function later(): void {
  markSeen();
  visible.value = false;
}

onBeforeUnmount(() => {
  if (showTimer) clearTimeout(showTimer);
});
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="pop-backdrop" @click.self="later">
      <div class="pop-card" role="dialog" aria-modal="true" aria-label="Welcome to TraderKomak — join our Telegram channel">
        <button class="pop-x" type="button" aria-label="Close" @click="later">✕</button>
        <div class="tg-logo" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
            <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
          </svg>
        </div>
        <h2 class="pop-title">Welcome to TraderKomak!</h2>
        <p class="pop-text">
          Join our <b>Telegram channel</b> to get news about TraderKomak and
          <b>trade signals</b> of the market — right on your phone.
        </p>
        <div class="pop-actions">
          <button class="pop-btn tg" type="button" @click="joinTg">Join our Telegram channel</button>
          <button class="pop-btn ghost" type="button" @click="later">Maybe later</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* Mirrors the sanctioned pop styles in UserPopups.vue so both dialogs read
   as the same family. */
.pop-backdrop {
  position: fixed;
  inset: 0;
  z-index: 400;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(10, 12, 28, 0.55);
  backdrop-filter: blur(5px);
  animation: fade 0.2s ease both;
}
@keyframes fade { from { opacity: 0; } }
.pop-card {
  position: relative;
  width: min(320px, calc(100vw - 40px));
  padding: 22px 20px 18px;
  border-radius: 20px;
  background: var(--bg-panel-solid);
  border: 1px solid var(--border);
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.5);
  text-align: center;
  color: var(--text);
  animation: rise 0.25s ease both;
}
@keyframes rise {
  from { opacity: 0; transform: translateY(14px) scale(0.97); }
  to { opacity: 1; transform: none; }
}
.tg-logo {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 46px;
  border-radius: 50%;
  color: #fff;
  background: linear-gradient(135deg, #38bdf8, #2aabee);
  margin-bottom: 10px;
}
.pop-title { margin: 0 0 6px; font-size: 16px; font-weight: 800; }
.pop-text { margin: 0 0 14px; font-size: 12.5px; line-height: 1.55; color: var(--text-muted); }
.pop-text b { color: var(--text); }
.pop-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: stretch;
}
.pop-btn {
  display: inline-block;
  padding: 9px 24px;
  border: none;
  border-radius: 12px;
  color: #fff;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
  transition: transform 0.12s ease, filter 0.12s ease;
}
.pop-btn:hover { transform: translateY(-1px); filter: brightness(1.08); }
.pop-btn.tg { background: linear-gradient(135deg, #38bdf8, #2aabee); }
.pop-btn.ghost {
  background: var(--btn-bg);
  color: var(--text-muted);
  border: 1px solid var(--border);
}
.pop-btn.ghost:hover { background: var(--btn-hover); color: var(--text); filter: none; }
.pop-x {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 9px;
  background: var(--btn-bg);
  color: var(--text-muted);
  font-size: 13px;
  cursor: pointer;
}
.pop-x:hover { background: var(--btn-hover); color: var(--text); }
</style>
