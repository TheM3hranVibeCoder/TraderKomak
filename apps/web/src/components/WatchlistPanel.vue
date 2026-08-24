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

const listRef = ref<HTMLElement | null>(null);
const dragActive = ref(false);       // true once movement exceeds threshold
const dragOffsetY = ref(0);          // dragged row's visual offset (px)
let dragIdx: number | null = null;   // current index of the dragged row
let dragStartY = 0;                  // clientY where the drag began
let dragStep = 46;                   // row height + gap, measured at start
let suppressClick = false;

function rowRects(): DOMRect[] {
  // TransitionGroup ref exposes the rendered element via $el
  const raw = listRef.value as unknown as { $el?: HTMLElement } | null;
  const list = raw ? (raw.$el ?? (raw as unknown as HTMLElement)) : null;
  if (!list) return [];
  return Array.from(list.querySelectorAll<HTMLElement>(".watch-item")).map((el) =>
    el.getBoundingClientRect()
  );
}

function onRowPointerDown(e: PointerEvent, idx: number): void {
  if (e.button !== 0) return;
  // Never start a drag from the remove button
  if ((e.target as HTMLElement).closest(".watch-remove")) return;
  // Touch: only the ⋮⋮ handle starts a drag (keeps list scrollable)
  if (e.pointerType !== "mouse" && !(e.target as HTMLElement).closest(".drag-handle")) return;

  const rects = rowRects();
  const own = rects[idx];
  if (own) dragStep = rects.length > 1 && rects[1] ? Math.abs(rects[1]!.top - rects[0]!.top) : own.height + 6;
  else return;

  dragIdx = idx;
  dragStartY = e.clientY;
  dragOffsetY.value = 0;
  dragActive.value = false;

  window.addEventListener("pointermove", onRowPointerMove);
  window.addEventListener("pointerup", onRowPointerUp, { once: true });
  window.addEventListener("pointercancel", onRowPointerUp, { once: true });
}

function onRowPointerMove(e: PointerEvent): void {
  if (dragIdx === null) return;
  const dy = e.clientY - dragStartY;

  if (!dragActive.value) {
    if (Math.abs(dy) < 5) return; // dead-zone so clicks still work
    dragActive.value = true;
  }
  dragOffsetY.value = dy;

  // Live reorder: when the dragged row's center crosses a neighbour's
  // midpoint, splice the array — siblings slide aside in real time.
  const rects = rowRects();
  const own = rects[dragIdx];
  if (!own) return;
  const center = own.top + own.height / 2 + dy;

  let target = dragIdx;
  for (let i = 0; i < rects.length; i++) {
    if (i === dragIdx) continue;
    const mid = rects[i]!.top + rects[i]!.height / 2;
    if (dragIdx < i ? center > mid : center < mid) {
      target = i;
      break;
    }
  }

  if (target !== dragIdx) {
    const arr = [...watchlist.instruments];
    const [moved] = arr.splice(dragIdx, 1);
    if (!moved) return;
    arr.splice(target, 0, moved);
    watchlist.instruments = arr;
    // Keep the dragged row under the cursor after the splice
    dragStartY += (target - dragIdx) * dragStep;
    dragOffsetY.value = e.clientY - dragStartY;
    dragIdx = target;
  }
}

function onRowPointerUp(): void {
  window.removeEventListener("pointermove", onRowPointerMove);
  if (dragActive.value) {
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 0);
  }
  dragIdx = null;
  dragActive.value = false;
  dragOffsetY.value = 0;
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
  <aside class="watchlist" :class="{ open: watchlist.isOpen }">
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
        }"
        :style="
          dragIdx === idx && dragActive ? { transform: `translateY(${dragOffsetY}px)` } : {}
        "
        @pointerdown="onRowPointerDown($event, idx)"
        @click="onClickRow(inst)"
      >
        <span class="drag-handle" title="Drag to reorder">⋮⋮</span>
        <div class="watch-left">
          <span class="watch-symbol">
            <template v-for="part in [inst.split('_')[0]!, inst.split('_')[1]!]" :key="part">
              <img v-if="flagFor(part).type === 'flag'" :src="flagFor(part).value" :alt="part" class="flag-img" />
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
  </aside>
</template>

<style scoped>
.watchlist {
  width: 0;
  min-width: 0;
  max-width: 320px;
  background: var(--bg-watchlist);
  border-left: 0 solid transparent;
  display: flex;
  flex-direction: column;
  height: 100%;
  backdrop-filter: blur(16px);
  overflow: hidden;
  position: relative;
  transition:
    width 420ms cubic-bezier(0.2, 0.8, 0.2, 1),
    min-width 420ms cubic-bezier(0.2, 0.8, 0.2, 1),
    background 600ms cubic-bezier(0.4, 0, 0.2, 1),
    border-color 300ms,
    opacity 300ms;
  opacity: 0;
  pointer-events: none;
}
.watchlist.open {
  width: 320px;
  min-width: 320px;
  border-left: 1px solid var(--border);
  box-shadow: -8px 0 24px rgba(0, 0, 0, 0.08);
  opacity: 1;
  pointer-events: auto;
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
.watch-item.dragging {
  transition: none;
  z-index: 30;
  cursor: grabbing;
  opacity: 0.95;
  box-shadow:
    0 14px 28px rgba(0, 0, 0, 0.22),
    0 0 0 1px rgba(41, 98, 255, 0.35);
  background: var(--bg-panel);
}
/* Siblings glide aside while a row is dragged */
.wl-move {
  transition: transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
.watch-item {
  touch-action: pan-y; /* list stays scrollable on touch */
}
.drag-handle {
  color: var(--text-muted);
  font-size: 10px;
  cursor: grab;
  padding: 2px;
  opacity: 0.5;
  touch-action: none; /* handle starts drags even on touch devices */
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
