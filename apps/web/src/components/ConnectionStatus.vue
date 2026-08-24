<script setup lang="ts">
import { computed } from "vue";
import type { WsStatus } from "@/services/wsClient";

const props = defineProps<{ status: WsStatus }>();

const label = computed(() => {
  switch (props.status) {
    case "connected":
      return "LIVE";
    case "connecting":
      return "CONNECTING";
    case "reconnecting":
      return "RECONNECTING";
    case "offline":
      return "OFFLINE";
    default:
      return String(props.status).toUpperCase();
  }
});

const dotClass = computed(() => {
  switch (props.status) {
    case "connected":
      return "dot-live";
    case "reconnecting":
      return "dot-reconnecting";
    case "offline":
      return "dot-offline";
    default:
      return "dot-connecting";
  }
});
</script>

<template>
  <span class="status" :class="dotClass" :title="`Connection status: ${label}`">
    <span class="dot" />
    {{ label }}
  </span>
</template>

<style scoped>
.status {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.07em;
  padding: 6px 12px;
  border-radius: 20px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  box-shadow: var(--card-shadow);
  backdrop-filter: blur(8px);
  transition: all 200ms;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  position: relative;
}
.dot::after {
  content: "";
  position: absolute;
  inset: -4px;
  border-radius: 50%;
  opacity: 0;
  transition: opacity 200ms;
}
.dot-live .dot {
  background: var(--live);
  box-shadow: 0 0 8px var(--live);
  animation: pulse 2s infinite;
}
.dot-live .dot::after {
  background: var(--live);
  opacity: 0.15;
  animation: ping 2s infinite;
}
.dot-reconnecting .dot {
  background: var(--reconnecting);
  box-shadow: 0 0 6px var(--reconnecting);
  animation: pulse 1.2s infinite;
}
.dot-offline .dot {
  background: var(--offline);
  box-shadow: 0 0 6px var(--offline);
}
.dot-connecting .dot {
  background: var(--connecting);
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.7;
    transform: scale(0.92);
  }
}
@keyframes ping {
  0% {
    transform: scale(0.8);
    opacity: 0.25;
  }
  70% {
    transform: scale(2);
    opacity: 0;
  }
  100% {
    transform: scale(2);
    opacity: 0;
  }
}
</style>
