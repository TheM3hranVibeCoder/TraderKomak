<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, TransitionGroup } from "vue";
import { SEARCHABLE_INSTRUMENTS, providerOf, normalizeInstrument, instrumentPrecision, type Candle } from "@traderkomak/shared";
import { useWatchlistStore } from "@/stores/watchlist";
import { useMarketStore } from "@/stores/market";
import { WatchWsClient } from "@/services/watchWs";
import { fetchCandles } from "@/services/api";
import { currencyFlagUrl, commodityIcon } from "@/utils/flags";

const watchlist = useWatchlistStore();
const market = useMarketStore();

const search = ref("");

function formatPrice(inst: string, price: number | null) {
  if (price === null || !Number.isFinite(price)) return "—";
  const prec = instrumentPrecision(inst);
  return price.toFixed(prec);
}

function changeClass(item: { change: number | null }) {
  if (item.change === null) return "neutral";
  if (item.change > 0) return "up";
  if (item.change < 0) return "down";
  return "neutral";
}

function changeText(item: { change: number | null; changePercent: number | null }) {
  if (item.change === null || item.changePercent === null) return "—";
  const sign = item.change > 0 ? "+" : "";
  return `${sign}${item.changePercent.toFixed(2)}%`;
}

function onSearchEnter() {
  const q = search.value.trim();
  if (!q) return;
  const norm = normalizeInstrument(q);
  const exact = SEARCHABLE_INSTRUMENTS.find((s) => normalizeInstrument(s) === norm);
  if (exact && watchlist.add(exact)) {
    search.value = "";
    return;
  }
  const upper = q.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const found = SEARCHABLE_INSTRUMENTS.find(
    (s) => s.replace("_", "").includes(upper)
  );
  if (found) watchlist.add(found);
  search.value = "";
}

function flagFor(currency: string): { type: "flag" | "icon"; value: string } {
  const flag = currencyFlagUrl(currency);
  if (flag) return { type: "flag", value: flag };
  const icon = commodityIcon(currency);
  if (icon) return { type: "icon", value: icon };
  return { type: "icon", value: "◈" };
}

/* ── Live pointer-based drag reordering ─────────────────────────────── */
/* Slots are tracked on a virtual grid measured ONCE at drag start (uniform
   rows). Swaps are decided from that grid, never from live rects — reading
   rects of rows mid-glide fed the animation back into the swap decision,
   which is what made dragging feel jerky. */

const ROW_GAP = 6; // .watchlist-list gap

const listRef = ref<HTMLElement | null>(null);
const dragActive = ref(false);       // true once movement exceeds threshold
const dragSettling = ref(false);     // true while the row glides into its slot on drop
const listDragging = ref(false);     // true while any drag is in progress (dims siblings)
const dragOffsetY = ref(0);          // dragged row's visual offset (px)
let dragIdx: number | null = null;   // current slot index of the dragged row
let dragStartY = 0;                  // clientY anchor so the row tracks the cursor 1:1
let slotStep = 52;                   // row height + gap, measured at start
let rowHeight = 46;                  // row height, measured at start
let contentTop = 0;                  // slot 0's home top in CONTENT coordinates
let listTop = 0;                     // viewport top of the list (fixed during drag)
let rowCount = 0;
let lastPointerY = 0;                // last cursor position (for edge auto-scroll)
let autoScrollRaf = 0;               // rAF handle for edge auto-scroll loop
let settleTimer: ReturnType<typeof setTimeout> | null = null;
let suppressClick = false;

function listEl(): HTMLElement | null {
  // TransitionGroup ref exposes the rendered element via $el
  const raw = listRef.value as unknown as { $el?: HTMLElement } | null;
  return raw ? (raw.$el ?? (raw as unknown as HTMLElement)) : null;
}

/** Captures the drag geometry once, from the still-resting list. */
function measureSlots(): boolean {
  const list = listEl();
  if (!list) return false;
  const rows = Array.from(list.querySelectorAll<HTMLElement>(".watch-item"));
  if (rows.length < 2) return false;
  const listRect = list.getBoundingClientRect();
  const first = rows[0]!.getBoundingClientRect();
  const second = rows[1]!.getBoundingClientRect();
  slotStep = Math.abs(second.top - first.top);
  rowHeight = first.height;
  listTop = listRect.top;
  contentTop = first.top - listRect.top + list.scrollTop;
  rowCount = rows.length;
  return true;
}

/** Viewport Y of slot i's home top for the given scroll position. */
function slotTop(i: number, scrollTop: number): number {
  return listTop + contentTop - scrollTop + i * slotStep;
}

function endSettle(): void {
  if (settleTimer) {
    clearTimeout(settleTimer);
    settleTimer = null;
  }
  dragSettling.value = false;
  dragActive.value = false;
  dragIdx = null;
  listDragging.value = false;
  dragOffsetY.value = 0;
  document.body.style.cursor = "";
}

function onRowPointerDown(e: PointerEvent, idx: number): void {
  if (e.button !== 0) return;
  // Never start a drag from the remove button
  if ((e.target as HTMLElement).closest(".watch-remove")) return;
  // Touch: only the ⋮⋮ handle starts a drag (keeps list scrollable)
  if (e.pointerType !== "mouse" && !(e.target as HTMLElement).closest(".drag-handle")) return;

  // A fresh press cancels any in-flight settle animation
  if (settleTimer) {
    clearTimeout(settleTimer);
    settleTimer = null;
  }
  dragSettling.value = false;
  listDragging.value = false;
  dragActive.value = false;
  dragIdx = null;
  document.body.style.cursor = "";
  // No text selection / native image ghost while dragging rows
  if (e.pointerType === "mouse") e.preventDefault();

  dragIdx = idx;
  dragStartY = e.clientY;
  lastPointerY = e.clientY;
  dragOffsetY.value = 0;
  dragActive.value = false;

  window.addEventListener("pointermove", onRowPointerMove);
  window.addEventListener("pointerup", onRowPointerUp, { once: true });
  window.addEventListener("pointercancel", onRowPointerUp, { once: true });
}

function onRowPointerMove(e: PointerEvent): void {
  if (dragIdx === null) return;
  lastPointerY = e.clientY;
  const dy = e.clientY - dragStartY;

  if (!dragActive.value) {
    if (Math.abs(dy) < 6) return; // dead-zone so clicks still work
    if (!measureSlots()) return;
    dragActive.value = true;
    listDragging.value = true;
    document.body.style.cursor = "grabbing";
    if (!autoScrollRaf) autoScrollRaf = requestAnimationFrame(autoScrollTick);
  }
  applyDragPosition(e.clientY);
}

/** Tracks the cursor 1:1 and splices the list when the dragged row's center
 *  is clearly nearer a neighbouring slot (hysteresis kills edge flicker). */
function applyDragPosition(clientY: number): void {
  if (dragIdx === null) return;
  const list = listEl();
  if (!list) return;
  dragOffsetY.value = clientY - dragStartY;
  if (rowCount < 2) return;

  const scrollTop = list.scrollTop;
  const center = slotTop(dragIdx, scrollTop) + rowHeight / 2 + dragOffsetY.value;

  let target = Math.round((center - slotTop(0, scrollTop) - rowHeight / 2) / slotStep);
  target = Math.max(0, Math.min(rowCount - 1, target));
  if (target === dragIdx) return;

  // Hysteresis: commit only once ~3px past the midpoint toward the target
  const ownCenter = slotTop(dragIdx, scrollTop) + rowHeight / 2;
  const targetCenter = slotTop(target, scrollTop) + rowHeight / 2;
  if (Math.abs(center - ownCenter) - Math.abs(center - targetCenter) < 6) return;

  const arr = [...watchlist.instruments];
  const [moved] = arr.splice(dragIdx, 1);
  if (!moved) return;
  arr.splice(target, 0, moved);
  watchlist.instruments = arr;
  // Keep the dragged row under the cursor after its home slot moved
  dragStartY += (target - dragIdx) * slotStep;
  dragOffsetY.value = clientY - dragStartY;
  dragIdx = target;
}

/** Scrolls the list when the cursor hovers near its top/bottom edge. */
function autoScrollTick(): void {
  autoScrollRaf = 0;
  const list = listEl();
  if (!list || dragIdx === null || !dragActive.value) return;
  const rect = list.getBoundingClientRect();
  const edge = 44;
  let speed = 0;
  if (lastPointerY < rect.top + edge) {
    speed = -Math.min(16, (rect.top + edge - lastPointerY) / 2.5);
  } else if (lastPointerY > rect.bottom - edge) {
    speed = Math.min(16, (lastPointerY - (rect.bottom - edge)) / 2.5);
  }
  if (speed !== 0) {
    const before = list.scrollTop;
    list.scrollTop += speed;
    // The list scrolled under a stationary cursor — keep the row glued to it
    dragStartY -= list.scrollTop - before;
    dragOffsetY.value = lastPointerY - dragStartY;
    applyDragPosition(lastPointerY);
  }
  autoScrollRaf = requestAnimationFrame(autoScrollTick);
}

function onRowPointerUp(): void {
  window.removeEventListener("pointermove", onRowPointerMove);
  if (autoScrollRaf) {
    cancelAnimationFrame(autoScrollRaf);
    autoScrollRaf = 0;
  }
  if (!dragActive.value) {
    endSettle();
    return;
  }
  suppressClick = true;
  setTimeout(() => (suppressClick = false), 0);
  // Settle: glide the row the remaining distance into its slot instead of snapping
  dragSettling.value = true;
  dragOffsetY.value = 0;
  settleTimer = setTimeout(endSettle, 300);
}

function onClickRow(inst: string): void {
  if (suppressClick) return; // ignore the click that ends a drag
  void market.setInstrument(inst);
}

let watchWs: WatchWsClient | null = null;

/** Symbols already seeded this session — avoids refetching on every change. */
const seeded = new Set<string>();

/**
 * Seeds one symbol with price + % change.
 * Preferred baseline: previous D1 close vs latest H1 close.
 * Fallback (daily unavailable): last two H1 closes — % still shows.
 * Works even while the market is closed; live ticks overwrite later.
 */
async function seedSymbol(inst: string): Promise<void> {
  seeded.add(inst); // claim immediately so parallel calls don't duplicate
  try {
    const [d1, h1] = await Promise.all([
      fetchCandles(inst, "1d", 2),
      fetchCandles(inst, "1h", 2).catch(() => []),
    ]);

    let prevClose: number | null = null;
    let cur: Candle | undefined = h1[h1.length - 1] ?? d1[d1.length - 1];

    if (d1.length >= 2) {
      prevClose = d1[d1.length - 2]!.close;
    } else if (h1.length >= 2) {
      // Daily baseline unavailable (e.g. older server build) → hourly % as fallback
      prevClose = h1[h1.length - 2]!.close;
    }

    if (cur && prevClose !== null) {
      watchlist.seedStaticQuote(inst, cur.close, prevClose);
    } else if (cur) {
      watchlist.seedStaticQuote(inst, cur.close, cur.close);
    } else {
      seeded.delete(inst); // nothing usable — allow retry
    }
  } catch {
    seeded.delete(inst); // allow retry
  }
}

/** Seeds only symbols that haven't been seeded yet — all in parallel. */
function seedNewSymbols(): void {
  const pending = watchlist.instruments.filter((i) => !seeded.has(i));
  if (pending.length === 0) return;
  void Promise.all(pending.map(seedSymbol));
}

let seedRetryTimer: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  watchWs = new WatchWsClient((tick) => {
    watchlist.updatePrice(tick.instrument, tick.bid, tick.ask, tick.mid, tick.timestamp);
  });
  watchWs.connect();
  watchWs.setInstruments(watchlist.instruments);

  // Seed price + % for all watchlist symbols in parallel (works while closed)
  seedNewSymbols();

  // Retry any symbol that failed to seed (e.g. cold server / transient error)
  seedRetryTimer = setInterval(() => {
    const pending = watchlist.instruments.filter((i) => !seeded.has(i));
    if (pending.length === 0) {
      if (seedRetryTimer) clearInterval(seedRetryTimer);
      return;
    }
    seedNewSymbols();
  }, 8000);

  watch(
    () => watchlist.instruments.join(","),
    (joined) => {
      const arr = joined ? joined.split(",") : [];
      watchWs?.setInstruments(arr);
      // Seed only the newly added symbol(s) — instant % for new rows
      seedNewSymbols();
    }
  );
});

onBeforeUnmount(() => {
  if (seedRetryTimer) clearInterval(seedRetryTimer);
  watchWs?.disconnect();
});
</script>

<template>
  <aside class="watchlist" :class="{ open: watchlist.isOpen, 'is-dragging': listDragging }">
    <div class="watchlist-inner">
      <div class="search-wrap">
        <span class="search-icon">⌕</span>
        <input
          v-model="search"
          @keydown.enter="onSearchEnter"
          placeholder="Search xauusd, eurusd…"
          class="search-input"
        />
        <span v-if="search" class="search-clear" @click="search = ''">✕</span>
      </div>

      <TransitionGroup ref="listRef" name="wl" tag="div" class="watchlist-list">
        <div v-if="watchlist.instruments.length === 0" key="empty" class="empty">
          <span class="empty-icon">☆</span>
          <span>Search above to add symbols</span>
          <span class="empty-hint">Live price & % change via OANDA · Binance</span>
        </div>

        <div
          v-for="(inst, idx) in watchlist.instruments"
          :key="inst"
          class="watch-item"
          :class="{
            active: inst === market.instrument,
            dragging: dragIdx === idx && dragActive,
            settling: dragIdx === idx && dragSettling,
          }"
          :style="
            dragIdx === idx && dragActive ? { transform: `translateY(${dragOffsetY}px)` } : {}
          "
          @pointerdown="onRowPointerDown($event, idx)"
          @click="onClickRow(inst)"
        >
          <span class="drag-handle" title="Drag to reorder">
            <svg width="8" height="14" viewBox="0 0 8 14" fill="currentColor" aria-hidden="true">
              <circle cx="2" cy="2" r="1.4" /><circle cx="6" cy="2" r="1.4" />
              <circle cx="2" cy="7" r="1.4" /><circle cx="6" cy="7" r="1.4" />
              <circle cx="2" cy="12" r="1.4" /><circle cx="6" cy="12" r="1.4" />
            </svg>
          </span>
          <div class="watch-left">
            <span class="watch-symbol">
              <template v-for="part in [inst.split('_')[0]!, inst.split('_')[1]!]" :key="part">
                <img v-if="flagFor(part).type === 'flag'" :src="flagFor(part).value" :alt="part" class="flag-img" draggable="false" />
                <span v-else class="flag-emoji">{{ flagFor(part).value }}</span>
                {{ part }}
                <span v-if="part === inst.split('_')[0]"> / </span>
              </template>
            </span>
            <span class="watch-sub">{{ providerOf(inst) === "binance" ? "BINANCE" : "OANDA" }}</span>
          </div>
          <div class="watch-right">
            <span class="watch-price">{{ formatPrice(inst, watchlist.prices.get(inst)?.mid ?? null) }}</span>
            <span class="watch-change" :class="changeClass(watchlist.prices.get(inst)! )">
              {{ changeText(watchlist.prices.get(inst)! ) }}
            </span>
          </div>
          <button class="watch-remove" @click.stop="watchlist.remove(inst)" title="Remove">✕</button>
        </div>
      </TransitionGroup>
    </div>
  </aside>
</template>

<style scoped>
.watchlist {
  width: 0;
  min-width: 0;
  max-width: 320px;
  background: var(--bg-watchlist);
  border-left: 1px solid transparent;
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  position: relative;
  transition:
    width 420ms cubic-bezier(0.32, 0.72, 0, 1),
    min-width 420ms cubic-bezier(0.32, 0.72, 0, 1),
    border-color 300ms cubic-bezier(0.4, 0, 0.2, 1),
    box-shadow 420ms cubic-bezier(0.32, 0.72, 0, 1);
  pointer-events: none;
}
.watchlist.open {
  width: 320px;
  min-width: 320px;
  border-left-color: var(--border);
  box-shadow: -8px 0 24px rgba(0, 0, 0, 0.08);
  pointer-events: auto;
}
/* Content glides in with the panel instead of being clipped by it */
.watchlist-inner {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  opacity: 0;
  transform: translateX(-18px);
  transition:
    opacity 220ms cubic-bezier(0.4, 0, 0.2, 1),
    transform 340ms cubic-bezier(0.32, 0.72, 0, 1);
}
.watchlist.open .watchlist-inner {
  opacity: 1;
  transform: translateX(0);
  transition-delay: 90ms; /* content arrives as the panel finishes opening */
}
.search-wrap {
  position: relative;
  margin: 10px 10px 8px;
  flex-shrink: 0;
}
.search-icon {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-muted);
  font-size: 13px;
  pointer-events: none;
}
.search-input {
  width: 100%;
  padding: 9px 30px 9px 30px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--bg-app);
  color: var(--text);
  font-size: 12px;
  font-weight: 600;
  outline: none;
  transition: all 180ms;
}
.search-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(41, 98, 255, 0.12);
}
.search-input::placeholder {
  text-transform: lowercase;
}
.search-clear {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  background: var(--btn-bg);
  border: none;
  border-radius: 50%;
  font-size: 10px;
  color: var(--text-muted);
  cursor: pointer;
}
.watchlist-list {
  flex: 1;
  overflow-y: auto;
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  position: relative; /* anchors leaving rows during remove animation */
}
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 24px 12px;
  color: var(--text-muted);
  font-size: 12px;
  text-align: center;
}
.empty-icon {
  font-size: 18px;
  opacity: 0.7;
}
.empty-hint {
  font-size: 11px;
  opacity: 0.7;
}
.flag-img {
  width: 16px;
  height: 12px;
  object-fit: cover;
  border-radius: 2px;
  vertical-align: middle;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.06);
  -webkit-user-drag: none; /* no native ghost image when dragging rows */
  pointer-events: none;
}
.flag-emoji {
  font-size: 12px;
  line-height: 1;
}
.watch-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 8px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--bg-panel);
  cursor: pointer;
  transition: all 180ms;
  position: relative;
  touch-action: pan-y; /* list stays scrollable on touch */
  user-select: none;
  -webkit-user-select: none;
}
.watch-item:hover {
  border-color: var(--border-strong);
  transform: translateY(-1px);
  box-shadow: var(--card-shadow);
}
.watch-item.active {
  border-color: var(--accent);
  background: linear-gradient(135deg, rgba(41, 98, 255, 0.08) 0%, rgba(106, 92, 255, 0.06) 100%);
  box-shadow: 0 0 0 1px rgba(41, 98, 255, 0.12);
}
/* Picked up: lifts with a slight scale + tilt and an accent ring; transform
   (cursor tracking) stays untransitioned so the row never lags the pointer */
.watch-item.dragging {
  transition:
    scale 220ms cubic-bezier(0.22, 1, 0.36, 1),
    rotate 220ms cubic-bezier(0.22, 1, 0.36, 1),
    box-shadow 220ms cubic-bezier(0.4, 0, 0.2, 1),
    border-color 200ms,
    background 200ms;
  z-index: 30;
  cursor: grabbing;
  scale: 1.03;
  rotate: -0.6deg;
  will-change: transform;
  box-shadow:
    0 14px 30px rgba(0, 0, 0, 0.32),
    0 0 0 1.5px rgba(41, 98, 255, 0.55);
  background: var(--bg-panel);
  border-color: rgba(41, 98, 255, 0.55);
}
/* Dropped: glides the remaining distance into its slot with a soft landing */
.watch-item.dragging.settling {
  scale: 1;
  rotate: 0deg;
  transition:
    transform 300ms cubic-bezier(0.22, 1, 0.36, 1),
    scale 220ms cubic-bezier(0.22, 1, 0.36, 1),
    rotate 220ms cubic-bezier(0.22, 1, 0.36, 1),
    box-shadow 240ms cubic-bezier(0.4, 0, 0.2, 1),
    border-color 240ms;
}
/* Siblings glide aside while a row is dragged */
.wl-move {
  transition: transform 280ms cubic-bezier(0.22, 1, 0.36, 1);
}
/* Siblings stay dimmed and hover-neutral so the dragged row owns the moment */
.watchlist.is-dragging .watch-item:not(.dragging) {
  opacity: 0.55;
  border-color: var(--border);
}
.watchlist.is-dragging .watch-item:not(.dragging):hover {
  transform: none;
  box-shadow: none;
}
.watchlist.is-dragging {
  user-select: none;
  cursor: grabbing;
}
/* New rows fade/slide in; removed rows fade out in place while siblings glide up */
.wl-enter-active {
  transition:
    opacity 260ms cubic-bezier(0.22, 1, 0.36, 1),
    transform 260ms cubic-bezier(0.22, 1, 0.36, 1);
}
.wl-enter-from {
  opacity: 0;
  transform: translateY(-10px) scale(0.98);
}
.wl-leave-active {
  transition:
    opacity 200ms ease,
    transform 200ms ease;
  position: absolute;
  left: 8px;
  right: 8px;
}
.wl-leave-to {
  opacity: 0;
  transform: scale(0.97);
}
@media (prefers-reduced-motion: reduce) {
  .watchlist,
  .watchlist-inner,
  .watch-item,
  .wl-move,
  .wl-enter-active,
  .wl-leave-active {
    transition-duration: 1ms !important;
  }
}
.drag-handle {
  color: var(--text-muted);
  display: grid;
  place-items: center;
  cursor: grab;
  padding: 4px 4px;
  margin: -4px 0 -4px -4px;
  opacity: 0;
  transform: translateX(-4px);
  transition: opacity 160ms ease, transform 180ms cubic-bezier(0.22, 1, 0.36, 1), color 160ms;
  touch-action: none; /* handle starts drags even on touch devices */
  flex-shrink: 0;
}
.watch-item:hover .drag-handle {
  opacity: 0.65;
  transform: translateX(0);
}
.watch-item.dragging .drag-handle {
  opacity: 1;
  transform: translateX(0);
  color: var(--accent);
}
.drag-handle:active {
  cursor: grabbing;
}
.watch-left {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.watch-symbol {
  font-weight: 800;
  font-size: 12px;
  color: var(--text);
  letter-spacing: -0.02em;
}
.watch-sub {
  font-size: 10px;
  color: var(--text-muted);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.watch-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  min-width: 76px;
}
.watch-price {
  font-weight: 700;
  font-size: 12px;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.watch-change {
  font-size: 11px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 6px;
  background: var(--btn-bg);
  color: var(--text-muted);
}
.watch-change.up {
  background: rgba(38, 166, 154, 0.12);
  color: #26a69a;
}
.watch-change.down {
  background: rgba(239, 83, 80, 0.12);
  color: #ef5350;
}
.watch-remove {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  display: grid;
  place-items: center;
  font-size: 10px;
  opacity: 0;
  transition: all 150ms;
  flex-shrink: 0;
}
.watch-item:hover .watch-remove {
  opacity: 1;
}
.watch-remove:hover {
  background: rgba(239, 83, 80, 0.1);
  color: #ef5350;
  border-color: rgba(239, 83, 80, 0.2);
}
</style>
