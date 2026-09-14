<script setup lang="ts">
import { ref, computed, onUnmounted } from "vue";
import { useChatStore } from "@/stores/chat";
import { useAuthStore } from "@/stores/auth";

const chat = useChatStore();
const auth = useAuthStore();

const roasts = [
  "The chart misses you already 📉",
  "Silence is golden… but the chat is quieter 🤫",
  "Somewhere, a candle is rising without you 🕯️",
  "Take this time to reflect… like a mirror. Or support. 🪞",
  "Your seat in the chat is reserved. It's very comfortable. 🪑",
  "XAU/USD hasn't moved just to spite you. Probably. 🥇",
  "Ban speedrun: completed ✅",
];

const roast = ref(roasts[Math.floor(Math.random() * roasts.length)]);
const refreshTries = ref(0);

const daysBanned = computed(() => {
  const ms = chat.bannedAt ? Date.now() - chat.bannedAt : 0;
  if (ms < 60_000) return "just now";
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours > 1 ? "s" : ""}`;
  const days = Math.floor(hours / 24);
  return `${days} day${days > 1 ? "s" : ""}`;
});

let roastTimer: ReturnType<typeof setInterval> | null = setInterval(() => {
  roast.value = roasts[Math.floor(Math.random() * roasts.length)];
}, 5000);
let tryTimer: ReturnType<typeof setInterval> | null = setInterval(() => {
  refreshTries.value++;
}, 7000);

function retry(): void {
  chat.probeConnection();
}

onUnmounted(() => {
  if (roastTimer) clearInterval(roastTimer);
  if (tryTimer) clearInterval(tryTimer);
});
</script>

<template>
  <div class="banned">
    <div class="glow glow-a" aria-hidden="true"></div>
    <div class="glow glow-b" aria-hidden="true"></div>

    <div class="banned-card">
      <div class="banned-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M5.8 5.8l12.4 12.4" />
        </svg>
      </div>
      <h1 class="banned-title">You have been banned</h1>
      <p class="banned-sub">
        An admin banned your account<template v-if="auth.profile"> (<b>@{{ auth.profile.username }}</b>)</template>
        from the TraderKomak community chat. You can still look at the charts
        from afar — this screen — and nothing else.
      </p>

      <div class="stats">
        <div class="stat red"><span class="n">{{ daysBanned }}</span><span class="l">Time banned</span></div>
        <div class="stat amber"><span class="n">{{ refreshTries }}</span><span class="l">Refreshes in hope</span></div>
        <div class="stat blue"><span class="n">0</span><span class="l">Messages allowed</span></div>
        <div class="stat green"><span class="n">∞</span><span class="l">Pips you'll miss</span></div>
      </div>

      <p class="roast">“{{ roast }}”</p>
      <button class="retry" type="button" @click="retry">Try again</button>
      <p class="until">This screen stays until an admin lifts the ban — we check every 30 seconds and open TraderKomak automatically.</p>
    </div>
  </div>
</template>

<style scoped>
.retry {
  display: inline-block;
  margin: 0 0 12px;
  padding: 9px 22px;
  border: none;
  border-radius: 11px;
  background: linear-gradient(120deg, #fb7185, #ef4444);
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 8px 22px rgba(239, 68, 68, 0.35);
}
.retry:hover { filter: brightness(1.08); }
.banned {
  position: fixed;
  inset: 0;
  z-index: 500;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background:
    radial-gradient(1100px 600px at 15% -10%, rgba(239, 68, 68, 0.22), transparent 55%),
    radial-gradient(900px 500px at 85% 110%, rgba(139, 92, 246, 0.2), transparent 55%),
    linear-gradient(160deg, #16101f 0%, #1a0f1a 45%, #0e0a1c 100%);
  color: #e8eaf2;
}
.glow { position: absolute; border-radius: 50%; filter: blur(70px); pointer-events: none; }
.glow-a { width: 420px; height: 420px; left: -120px; top: -140px; background: rgba(239, 68, 68, 0.28); }
.glow-b { width: 460px; height: 460px; right: -150px; bottom: -170px; background: rgba(139, 92, 246, 0.25); }
.banned-card {
  position: relative;
  z-index: 1;
  width: min(520px, calc(100vw - 32px));
  text-align: center;
  padding: 34px 30px 26px;
  border-radius: 22px;
  background: rgba(22, 18, 36, 0.72);
  border: 1px solid rgba(251, 113, 133, 0.25);
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.5);
  animation: rise 0.6s ease both;
}
@keyframes rise {
  from { opacity: 0; transform: translateY(18px); }
  to { opacity: 1; transform: none; }
}
.banned-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  border-radius: 20px;
  color: #fff;
  background: linear-gradient(135deg, #fb7185, #ef4444);
  box-shadow: 0 12px 34px rgba(239, 68, 68, 0.45);
  margin-bottom: 16px;
}
.banned-title { margin: 0 0 8px; font-size: 26px; font-weight: 800; letter-spacing: -0.4px; }
.banned-sub { margin: 0 0 20px; font-size: 13px; line-height: 1.65; color: #a7adc4; }
.banned-sub b { color: #fb7185; }
.stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  margin-bottom: 18px;
}
.stat {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 12px 4px;
  border-radius: 14px;
  color: #fff;
}
.stat.red   { background: linear-gradient(135deg, #fb7185, #ef4444); }
.stat.amber { background: linear-gradient(135deg, #fbbf24, #f59e0b); }
.stat.blue  { background: linear-gradient(135deg, #60a5fa, #3b82f6); }
.stat.green { background: linear-gradient(135deg, #34d399, #10b981); }
.stat .n { font-size: 20px; font-weight: 800; line-height: 1; }
.stat .l { font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; opacity: 0.92; }
.roast { margin: 0 0 10px; font-size: 13.5px; font-style: italic; color: #c9cfe4; min-height: 18px; }
.until { margin: 0; font-size: 11.5px; color: #6f778f; }
</style>
