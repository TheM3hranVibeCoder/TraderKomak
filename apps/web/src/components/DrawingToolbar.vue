<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
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
  magnet: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h4v8a2 2 0 0 0 4 0V3h4v8a6 6 0 0 1-12 0V3z"/><path d="M6 3h4v4.5H6z" fill="currentColor" stroke="none"/><path d="M14 3h4v4.5h-4z" fill="currentColor" stroke="none"/><path d="M9.5 20.5l2.5-2 2.5 2" stroke-width="1.4"/></svg>`,
};

const tools: Array<{ id: string; title: string }> = [
  { id: "position", title: "Long / Short Position — click entry, then click SL (below = long, above = short)" },
  { id: "polyline", title: "Draw Polyline (double-click to finish)" },
  { id: "rectangle", title: "Draw Rectangle" },
];

const LINE_TOOL_IDS = ["trendline", "hline", "hray", "vline"];
const lineTools: Array<{ id: string; title: string }> = [
  { id: "trendline", title: "Trend Line" },
  { id: "hline", title: "Horizontal Line" },
  { id: "hray", title: "Horizontal Ray (extends right)" },
  { id: "vline", title: "Vertical Line" },
];

/* The split button shows and activates the LAST USED line tool; the small
   arrow on its right opens the full line-tools flyout. */
const lastLineTool = ref(localStorage.getItem("tk-last-line-tool") ?? "trendline");
const flyoutOpen = ref(false);
const flyoutEl = ref<HTMLElement | null>(null);
const flyoutTop = ref(80);

const lineToolActive = computed(() => LINE_TOOL_IDS.includes(drawings.activeTool));

function activateLineTool(): void {
  drawings.activeTool = lastLineTool.value as never;
}
function openFlyout(e: MouseEvent): void {
  const btn = (e.currentTarget as HTMLElement).closest(".tool-split");
  if (btn) flyoutTop.value = btn.getBoundingClientRect().top;
  flyoutOpen.value = !flyoutOpen.value;
}
function pickLineTool(id: string): void {
  lastLineTool.value = id;
  localStorage.setItem("tk-last-line-tool", id);
  drawings.activeTool = id as never;
  flyoutOpen.value = false;
}
function onDocClick(e: MouseEvent): void {
  const t = e.target as HTMLElement;
  // clicks on the split button itself are handled by openFlyout's toggle
  if (t.closest?.(".tool-split")) return;
  if (flyoutOpen.value && flyoutEl.value && !flyoutEl.value.contains(t)) {
    flyoutOpen.value = false;
  }
}
function onDocKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape") flyoutOpen.value = false;
}
onMounted(() => {
  document.addEventListener("mousedown", onDocClick);
  document.addEventListener("keydown", onDocKeydown);
});
onBeforeUnmount(() => {
  document.removeEventListener("mousedown", onDocClick);
  document.removeEventListener("keydown", onDocKeydown);
});
</script>

<template>
  <aside class="drawing-toolbar">
    <button
      class="tool-btn"
      :class="{ active: drawings.activeTool === 'cursor' }"
      title="Cursor / Select"
      aria-label="Cursor / Select"
      @click="drawings.activeTool = 'cursor'"
    >
      <span class="tool-ic" v-html="ICONS.cursor"></span>
    </button>

    <!-- Line tools split button: main = last used, arrow = flyout -->
    <div class="tool-split" :class="{ active: lineToolActive }">
      <button
        class="split-main"
        :title="'Line tools — ' + (lineTools.find((t) => t.id === lastLineTool)?.title ?? '')"
        :aria-label="'Line tools — ' + (lineTools.find((t) => t.id === lastLineTool)?.title ?? '')"
        @click="activateLineTool"
      >
        <span class="tool-ic" v-html="ICONS[lastLineTool]"></span>
      </button>
      <button class="split-arrow" title="Line tools" aria-label="More line tools" @click.stop="openFlyout">
        <svg viewBox="0 0 6 8" width="6" height="8" aria-hidden="true"><path d="M0 0l5 4-5 4z" fill="currentColor"/></svg>
      </button>
    </div>

    <button
      v-for="tool in tools"
      :key="tool.id"
      class="tool-btn"
      :class="{ active: drawings.activeTool === tool.id }"
      :title="tool.title"
      :aria-label="tool.title"
      @click="drawings.activeTool = tool.id as any"
    >
      <span class="tool-ic" v-html="ICONS[tool.id]"></span>
    </button>

    <!-- Magnet mode (below the shape tools): latched on/off; Ctrl
         temporarily forces it while held — the button lights up whenever
         snapping is effectively active. Anchors stick to the nearest
         candle's high/low and the crosshair follows. -->
    <button
      class="tool-btn"
      :class="{ active: drawings.magnetActive }"
      :title="drawings.magnet ? 'Magnet ON — drawings snap to candle high/low (click to turn off)' : 'Magnet OFF — hold Ctrl to snap to candle high/low (click to turn on)'"
      aria-label="Magnet mode"
      @click="drawings.toggleMagnet()"
    >
      <span class="tool-ic" v-html="ICONS.magnet"></span>
    </button>

    <!-- Line tools flyout: trend line / horizontal line / ray / vertical.
         Teleported to <body>: the toolbar's backdrop-filter makes it the
         containing block for fixed children and overflow-y clips them —
         without the teleport the flyout opens trapped under the chart. -->
    <Teleport to="body">
      <div v-if="flyoutOpen" ref="flyoutEl" class="line-flyout" :style="{ top: flyoutTop + 'px' }">
        <button
          v-for="t in lineTools"
          :key="t.id"
          class="flyout-btn"
          :class="{ active: drawings.activeTool === t.id }"
          :title="t.title"
          :aria-label="t.title"
          @click.stop="pickLineTool(t.id)"
        >
          <span class="tool-ic" v-html="ICONS[t.id]"></span>
        </button>
      </div>
    </Teleport>
    <div class="toolbar-divider" />
  </aside>
</template>

<style scoped>
.drawing-toolbar {
  width: 42px;
  min-width: 42px;
  background: var(--glass-bg);
  backdrop-filter: blur(18px) saturate(1.3);
  -webkit-backdrop-filter: blur(18px) saturate(1.3);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 0;
  gap: 4px;
  flex-shrink: 0;
  overflow-y: auto;
  /* Hide the scrollbar strip (reads as a black border under the tools and
     darkens on hover) — wheel/touch scrolling still works. */
  scrollbar-width: none;
}
.drawing-toolbar::-webkit-scrollbar {
  display: none;
}
.tool-btn {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border: 1px solid transparent;
  border-radius: 9px;
  background: transparent;
  color: var(--text-muted);
  font-size: 15px;
  cursor: pointer;
  transition: all 180ms cubic-bezier(0.4, 0, 0.2, 1);
  flex-shrink: 0;
}
.tool-btn:hover {
  background: var(--glass-bg-hover);
  border-color: var(--glass-border);
  color: var(--text);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(2, 6, 18, 0.25);
}
.tool-btn:active {
  transform: translateY(0);
}
.tool-ic {
  display: grid;
  place-items: center;
  line-height: 0;
}
.tool-ic svg {
  display: block;
}
.tool-btn.active {
  background: var(--accent-gradient);
  color: #fff;
  border-color: transparent;
  box-shadow: 0 4px 14px rgba(59, 130, 246, 0.45), 0 1px 0 rgba(255, 255, 255, 0.25) inset;
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
/* Split button: main icon + flyout arrow */
.tool-split {
  width: 32px;
  height: 32px;
  border-radius: 7px;
  display: flex;
  position: relative;
  transition: all 150ms;
  flex-shrink: 0;
}
.tool-split.active {
  background: var(--accent-gradient);
  box-shadow: 0 2px 8px rgba(41, 98, 255, 0.3);
}
.tool-split.active .split-main,
.tool-split.active .split-arrow {
  color: #fff;
}
.split-main {
  flex: 1;
  display: grid;
  place-items: center;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  padding: 0;
}
.split-arrow {
  position: absolute;
  /* at the right edge of the toolbar column, straddling its border */
  right: -5px;
  top: 50%;
  transform: translateY(-50%);
  width: 12px;
  height: 12px;
  display: grid;
  place-items: center;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  padding: 0;
  /* invisible until the mouse is over the button */
  opacity: 0;
  transition: opacity 150ms;
}
.tool-split:hover .split-arrow {
  opacity: 1;
}
/* the arrow SVG path points right — toward the flyout */
.line-flyout {
  position: fixed;
  left: 46px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: var(--bg-panel);
  backdrop-filter: blur(22px) saturate(1.3);
  -webkit-backdrop-filter: blur(22px) saturate(1.3);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  padding: 6px;
  box-shadow: var(--glass-shadow);
  z-index: 60;
}
.flyout-btn {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border: 1px solid transparent;
  border-radius: 7px;
  color: var(--text-muted);
  cursor: grab;
  transition: all 150ms;
}
.flyout-btn:hover {
  background: var(--btn-bg);
  color: var(--text);
}
.flyout-btn.active {
  background: var(--accent-gradient);
  color: #fff;
  border-color: transparent;
  box-shadow: 0 2px 8px rgba(41, 98, 255, 0.3);
}

/* Phones: slim the rail so the chart keeps its width */
@media (max-width: 640px) {
  .drawing-toolbar {
    width: 36px;
    min-width: 36px;
  }
  .tool-btn {
    width: 28px;
    height: 28px;
  }
}
</style>
