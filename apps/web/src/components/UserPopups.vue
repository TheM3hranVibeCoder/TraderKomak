<script setup lang="ts">
import { useChatStore } from "@/stores/chat";

const chat = useChatStore();

function joinTg(): void {
  window.open("https://t.me/TraderKomak_ir", "_blank", "noopener,noreferrer");
  chat.answerTg("join");
}
function closeTg(): void {
  chat.answerTg("close");
}
</script>

<template>
  <Teleport to="body">
    <!-- Admin direct message -->
    <div v-if="chat.incomingDm" class="pop-backdrop">
      <div class="pop-card dm" role="dialog" aria-modal="true" aria-label="Message from admin">
        <div class="pop-badge admin">Admin message</div>
        <p class="pop-text">{{ chat.incomingDm.text }}</p>
        <button class="pop-btn primary" type="button" @click="chat.dismissDm()">Got it</button>
      </div>
    </div>

    <!-- Telegram broadcast popup -->
    <div v-else-if="chat.tgPopupId" class="pop-backdrop">
      <div class="pop-card tg" role="dialog" aria-modal="true" aria-label="Join our Telegram channel">
        <button class="pop-x" type="button" aria-label="Close" @click="closeTg">✕</button>
        <div class="tg-logo" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor">
            <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
          </svg>
        </div>
        <h2 class="pop-title">Join our Telegram!</h2>
        <p class="pop-text">
          Get trade ideas, session alerts and market updates in the
          <b>TraderKomak</b> channel — right on your phone.
        </p>
        <button class="pop-btn tg" type="button" @click="joinTg">Join channel</button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
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
  width: min(360px, calc(100vw - 40px));
  padding: 30px 26px 24px;
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
.pop-badge {
  display: inline-block;
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.8px;
  text-transform: uppercase;
  padding: 4px 12px;
  border-radius: 999px;
  color: #fff;
  margin-bottom: 12px;
}
.pop-badge.admin { background: linear-gradient(120deg, #8b5cf6, #6366f1, #3b82f6); }
.pop-title { margin: 0 0 8px; font-size: 19px; font-weight: 800; }
.pop-text { margin: 0 0 18px; font-size: 13.5px; line-height: 1.65; color: var(--text-muted); }
.pop-text b { color: var(--text); }
.pop-btn {
  display: inline-block;
  padding: 11px 30px;
  border: none;
  border-radius: 12px;
  color: #fff;
  font-size: 13.5px;
  font-weight: 800;
  cursor: pointer;
  transition: transform 0.12s ease, filter 0.12s ease;
}
.pop-btn:hover { transform: translateY(-1px); filter: brightness(1.08); }
.pop-btn.primary { background: linear-gradient(120deg, #8b5cf6, #6366f1, #3b82f6); }
.pop-btn.tg { background: linear-gradient(135deg, #38bdf8, #2aabee); }
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
.tg-logo {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 62px;
  height: 62px;
  border-radius: 50%;
  color: #fff;
  background: linear-gradient(135deg, #38bdf8, #2aabee);
  box-shadow: 0 10px 30px rgba(42, 171, 238, 0.45);
  margin-bottom: 14px;
}
</style>
