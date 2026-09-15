<script setup lang="ts">
import { useAuthStore } from "@/stores/auth";

const auth = useAuthStore();
</script>

<template>
  <div class="landing">
    <!-- soft floating glows over a light gradient -->
    <div class="glow glow-a" aria-hidden="true"></div>
    <div class="glow glow-b" aria-hidden="true"></div>
    <div class="glow glow-c" aria-hidden="true"></div>

    <div class="landing-center">
      <img class="landing-logo" src="/favicon.png" alt="TraderKomak logo" width="96" height="96" />
      <p class="landing-title">TraderKomak</p>
      <p class="landing-sub">
        Live forex &amp; crypto charts — sessions, indicators, replay mode and a
        trader community.
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
    radial-gradient(1200px 700px at 12% -10%, #dbe9ff 0%, transparent 55%),
    radial-gradient(1000px 600px at 88% 108%, #e7dcff 0%, transparent 55%),
    linear-gradient(160deg, #f2f6ff 0%, #e9efff 45%, #f4effe 100%);
  color: #1f2430;
}
.glow {
  position: absolute;
  border-radius: 50%;
  filter: blur(60px);
  opacity: 0.55;
  pointer-events: none;
}
.glow-a {
  width: 420px; height: 420px;
  left: -120px; top: -140px;
  background: rgba(96, 148, 255, 0.35);
}
.glow-b {
  width: 480px; height: 480px;
  right: -160px; bottom: -180px;
  background: rgba(150, 110, 255, 0.3);
}
.glow-c {
  width: 260px; height: 260px;
  right: 18%; top: 8%;
  background: rgba(45, 212, 167, 0.22);
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
  display: block;
  margin: 0 auto 20px;
  border-radius: 20px;
  filter: drop-shadow(0 14px 34px rgba(59, 130, 246, 0.35));
}
.landing-title {
  margin: 0 0 10px;
  font-size: clamp(26px, 6vw, 34px);
  font-weight: 800;
  letter-spacing: -0.5px;
  color: #171c2b;
}
.landing-sub {
  margin: 0 0 28px;
  font-size: 14.5px;
  line-height: 1.65;
  color: #5a6378;
}
.google-btn {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  min-height: 48px;
  padding: 14px 28px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 14px;
  background: #ffffff;
  color: #1f2430;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 8px 28px rgba(30, 60, 130, 0.18);
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.google-btn:hover { transform: translateY(-1px); box-shadow: 0 12px 34px rgba(30, 60, 130, 0.26); }
</style>
