<script setup lang="ts">
import { SUPPORTED_INSTRUMENTS, displayInstrument } from "@traderkomak/shared";

defineProps<{ modelValue: string }>();
const emit = defineEmits<{ (e: "update:modelValue", value: string): void }>();
</script>

<template>
  <div class="symbol-selector">
    <label for="symbol-select" class="sr-only">Symbol</label>
    <select
      id="symbol-select"
      :value="modelValue"
      class="select"
      @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
    >
      <option v-for="inst in SUPPORTED_INSTRUMENTS" :key="inst" :value="inst">
        {{ displayInstrument(inst) }}
      </option>
    </select>
  </div>
</template>

<style scoped>
.select {
  appearance: none;
  background: var(--bg-panel);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 8px 32px 8px 12px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  outline: none;
  box-shadow: var(--card-shadow);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2.2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  transition: all 180ms;
}
.select:hover {
  border-color: var(--border-strong);
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.08);
}
.select:focus {
  border-color: var(--accent);
  box-shadow:
    0 0 0 3px rgba(41, 98, 255, 0.12),
    var(--card-shadow);
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
}
</style>
