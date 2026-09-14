<script setup lang="ts">
import { useAuthStore } from "@/stores/auth";

const auth = useAuthStore();
</script>

<template>
  <div class="landing">
    <!-- Decorative candlestick skyline, pure CSS/SVG so it needs no assets -->
    <svg class="landing-chart" viewBox="0 0 1200 420" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <g class="candles" stroke-width="0">
        <g v-for="(c, i) in 42" :key="i" :transform="`translate(${i * 29 + 6}, 0)`">
          <rect
            class="wick"
            :x="13"
            :y="140 + Math.abs(Math.sin(i * 1.7)) * 90"
            width="3"
            :height="90 + Math.abs(Math.cos(i * 2.3)) * 120"
          />
          <rect
            :class="['body', i % 3 === 0 ? 'down' : 'up']"
            x="4"
            :y="170 + Math.abs(Math.sin(i * 1.7)) * 80"
            width="21"
            :height="40 + Math.abs(Math.cos(i * 2.1)) * 90"
            rx="2.5"
          />
        </g>
      </g>
      <path
        class="trendline"
        d="M0 340 C 180 320 300 260 480 240 S 800 200 960 130 S 1120 90 1200 60"
        fill="none"
      />
    </svg>

    <div class="landing-center">
      <div class="landing-logo" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 17l5-6 4 3 6-8" />
          <path d="M15 6h4v4" />
          <path d="M3 21h18" />
        </svg>
      </div>
      <h1 class="landing-title">TraderKomak</h1>
      <p class="landing-sub">
        Live forex &amp; crypto charts — sessions, indicators, replay mode and a
        trader community. Sign in to make the market yours.
      </p>
      <button class="google-btn" type="button" @click="auth.signInWithGoogle()">
        <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">
          <path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.66-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.87c2.26-2.09 3.57-5.16 3.57-8.81z" />
          <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.87-3c-1.07.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.29v3.1A12 12 0 0 0 12 24z" />
          <path fill="#FBBC05" d="M5.27 14.28A7.2 7.2 0 0 1 4.9 12c0-.79.14-1.56.37-2.28v-3.1H1.29a12 12 0 0 0 0 10.76l3.98-3.1z" />
          <path fill="#EA4335" d="M12 4.77c1.76 0 3.34.61 4.59 1.8l3.44-3.44A11.98 11.98 0 0 0 12 0 12 12 0 0 0 1.29 6.62l3.98 3.1C6.22 6.88 8.87 4.77 12 4.77z" />
        </svg>
        Sign in with Google
      </button>
      <p class="landing-note">
        Your username, chat identity, drawings and watchlist follow your account.
      </p>
    </div>
  </div>
</template>

<style scoped>
.landing {
  position: relative;
  min-height: 100vh;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(1100px 600px at 18% -8%, rgba(59, 130, 246, 0.22), transparent 55%),
    radial-gradient(900px 500px at 85% 110%, rgba(139, 92, 246, 0.18), transparent 55%),
    linear-gradient(165deg, #0a1020 0%, #0d1220 45%, #120e26 100%);
  color: #e8eaf2;
}
.landing-chart {
  position: absolute;
  inset: auto 0 0 0;
  width: 100%;
  height: 52%;
  opacity: 0.5;
  pointer-events: none;
}
.landing-chart .wick { fill: rgba(148, 163, 205, 0.35); }
.landing-chart .body.up { fill: rgba(45, 212, 167, 0.5); }
.landing-chart .body.down { fill: rgba(248, 113, 113, 0.5); }
.landing-chart .trendline {
  stroke: rgba(99, 102, 241, 0.6);
  stroke-width: 2.5;
  stroke-dasharray: 7 7;
}
.landing-center {
  position: relative;
  z-index: 1;
  text-align: center;
  max-width: 480px;
  padding: 24px;
  animation: rise 0.7s ease both;
}
@keyframes rise {
  from { opacity: 0; transform: translateY(16px); }
  to { opacity: 1; transform: none; }
}
.landing-logo {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 62px;
  height: 62px;
  border-radius: 18px;
  background: linear-gradient(135deg, #3b82f6 0%, #6366f1 50%, #8b5cf6 100%);
  color: #fff;
  box-shadow: 0 10px 34px rgba(59, 130, 246, 0.4);
  margin-bottom: 18px;
}
.landing-title {
  margin: 0 0 10px;
  font-size: 34px;
  font-weight: 800;
  letter-spacing: -0.5px;
}
.landing-sub {
  margin: 0 0 26px;
  font-size: 14.5px;
  line-height: 1.65;
  color: #9aa3bc;
}
.google-btn {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  padding: 13px 26px;
  border: none;
  border-radius: 12px;
  background: #fff;
  color: #1f2430;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35);
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.google-btn:hover { transform: translateY(-1px); box-shadow: 0 12px 34px rgba(0, 0, 0, 0.45); }
.landing-note {
  margin: 20px 0 0;
  font-size: 12px;
  color: #6f778f;
}
</style>
