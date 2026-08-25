<script setup lang="ts">
import { useDrawingsStore } from "@/stores/drawings";

const drawings = useDrawingsStore();

const tools = [
  { id: "cursor", label: "✛", title: "Cursor / Select" },
  { id: "rectangle", label: "▭", title: "Draw Rectangle" },
] as const;
</script>

<template>
  <aside class="drawing-toolbar">
    <button
      v-for="tool in tools"
      :key="tool.id"
      class="tool-btn"
      :class="{ active: drawings.activeTool === tool.id }"
      :title="tool.title"
      @click="drawings.activeTool = tool.id as any"
    >
      {{ tool.label }}
    </button>
    <div class="toolbar-divider" />
    <button
      class="tool-btn danger"
      title="Clear all drawings on this chart"
      @click="drawings.clearAll(drawings.drawings ? Object.keys(drawings.drawings)[0] || '' : '', '')"
      v-if="false"
    >🗑</button>
  </aside>
</template>

<style scoped>
.drawing-toolbar {
  width: 42px;
  min-width: 42px;
  background: var(--bg-panel);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 0;
  gap: 4px;
  flex-shrink: 0;
  overflow-y: auto;
}
.tool-btn {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: var(--text-muted);
  font-size: 15px;
  cursor: pointer;
  transition: all 150ms;
  flex-shrink: 0;
}
.tool-btn:hover {
  background: var(--btn-bg);
  color: var(--text);
}
.tool-btn.active {
  background: var(--accent-gradient);
  color: #fff;
  border-color: transparent;
  box-shadow: 0 2px 8px rgba(41, 98, 255, 0.3);
}
.tool-btn.danger:hover {
  background: rgba(239, 83, 80, 0.12);
  color: #ef5350;
}
.toolbar-divider {
  width: 24px;
  height: 1px;
  background: var(--border);
  margin: 4px 0;
  flex-shrink: 0;
}
</style>
