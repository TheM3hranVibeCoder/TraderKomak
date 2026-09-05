<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from "vue";
import { useDrawingsStore } from "@/stores/drawings";

const drawings = useDrawingsStore();

/* Clean SVG icons for every drawing tool (stroke = currentColor) */
const ICONS: Record<string, string> = {
  cursor: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><line x1="12" y1="3" x2="12" y2="9"/><line x1="12" y1="15" x2="12" y2="21"/><line x1="3" y1="12" x2="9" y2="12"/><line x1="15" y1="12" x2="21" y2="12"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/></svg>`,
  trendline: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><line x1="5" y1="19" x2="19" y2="5" stroke-linecap="round"/><circle cx="5" cy="19" r="2" fill="#fff" stroke="currentColor"/><circle cx="19" cy="5" r="2" fill="#fff" stroke="currentColor"/></svg>`,
  hline: `<svg viewBox="0 0 24 24" width="20" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="1.5" y1="12" x2="22.5" y2="12" stroke-linecap="round"/></svg>`,
  hray: `<svg viewBox="0 0 24 24" width="20" height="18" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><line x1="7" y1="12" x2="22.5" y2="12" stroke-linecap="round"/><circle cx="5" cy="12" r="2.4" fill="#fff" stroke="currentColor"/></svg>`,
  vline: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="12" y1="2.5" x2="12" y2="21.5" stroke-linecap="round"/></svg>`,
  position: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><line x1="3" y1="12" x2="21" y2="12"/><path d="M12 9V3.5M12 3.5L9.5 6M12 3.5L14.5 6"/><path d="M12 15v5.5M12 20.5L9.5 18M12 20.5l2.5-2.5"/></svg>`,
  polyline: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 17l6-10 5 6 7-9"/></svg>`,
  rectangle: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="6.5" width="18" height="11" rx="2"/></svg>`,
};

const tools: Array<{ id: string; title: string; flyout?: boolean }> = [
  { id: "cursor", title: "Cursor / Select" },
  { id: "trendline", title: "Trend Line & Lines", flyout: true },
  { id: "position", title: "Long / Short Position — click entry, then click SL (below = long, above = short)" },
  { id: "polyline", title: "Draw Polyline (double-click to finish)" },
  { id: "rectangle", title: "Draw Rectangle" },
];

/* Line tools grouped inside the trendline button (flyout) */
const lineTools: Array<{ id: string; title: string }> = [
  { id: "trendline", title: "Trend Line" },
  { id: "hline", title: "Horizontal Line" },
  { id: "hray", title: "Horizontal Ray (extends right)" },
  { id: "vline", title: "Vertical Line" },
];
const flyoutOpen = ref(false);
const flyoutEl = ref<HTMLElement | null>(null);
const flyoutTop = ref(80);

function onTrendlineClick(e: MouseEvent): void {
  const btn = e.currentTarget as HTMLElement | null;
  if (btn) flyoutTop.value = btn.getBoundingClientRect().top;
  flyoutOpen.value = !flyoutOpen.value;
}
function pickLineTool(id: string): void {
  drawings.activeTool = id as never;
  flyoutOpen.value = false;
}
function onDocClick(e: MouseEvent): void {
  if (flyoutOpen.value && flyoutEl.value && !flyoutEl.value.contains(e.target as Node)) {
    flyoutOpen.value = false;
  }
}
onMounted(() => document.addEventListener("mousedown", onDocClick));
onBeforeUnmount(() => document.removeEventListener("mousedown", onDocClick));
</script>

<template>
  <aside class="drawing-toolbar">
    <button
      v-for="tool in tools"
      :key="tool.id"
      class="tool-btn"
      :class="{ active: drawings.activeTool === tool.id || (tool.flyout && lineTools.some((t) => t.id === drawings.activeTool)) }"
      :title="tool.title"
      @click="tool.flyout ? onTrendlineClick($event) : (drawings.activeTool = tool.id as any)"
    >
      <span class="tool-ic" v-html="ICONS[tool.id]"></span>
    </button>
    <!-- Line tools flyout: trend line / horizontal line / ray / vertical -->
    <div v-if="flyoutOpen" ref="flyoutEl" class="line-flyout" :style="{ top: flyoutTop + 'px' }">
      <button
        v-for="t in lineTools"
        :key="t.id"
        class="tool-btn flyout-btn"
        :class="{ active: drawings.activeTool === t.id }"
        :title="t.title"
        @click.stop="pickLineTool(t.id)"
      >
        <span class="tool-ic" v-html="ICONS[t.id]"></span>
      </button>
    </div>
    <div class="toolbar-divider" />
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
.tool-ic {
  display: grid;
  place-items: center;
  line-height: 0;
}
.tool-ic svg {
  display: block;
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
.line-flyout {
  position: fixed;
  left: 46px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 6px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.25);
  z-index: 50;
}
.flyout-btn {
  background: var(--btn-bg);
}
</style>
