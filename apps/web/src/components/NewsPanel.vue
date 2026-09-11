<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useNewsStore } from "@/stores/news";
import { currencyFlagUrl } from "@/utils/flags";
import type { NewsItem } from "@/services/newsService";

const news = useNewsStore();

function timeLabel(ts: number): string {
  const d = new Date(ts);
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

function flagFor(country: string): string | null {
  return currencyFlagUrl(country);
}

function impactClass(impact: NewsItem["impact"]): string {
  return impact === "High" ? "high" : impact === "Medium" ? "med" : "hol";
}

/** Countdown / status for one news row. */
function rowState(it: NewsItem): { label: string; cls: string } {
  const diff = it.date - news.now;
  if (diff > 0) {
    const total = Math.ceil(diff / 1000);
    const p2 = (x: number) => String(x).padStart(2, "0");
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (diff <= 15 * 60_000) return { label: `${p2(h)}:${p2(m)}:${p2(s)}`, cls: "alarm" };
    if (diff <= 60 * 60_000) return { label: `in ${m}m`, cls: "soon" };
    return { label: `in ${Math.floor(diff / 3600_000)}h`, cls: "far" };
  }
  // released: show actual when the refreshed feed carries it
  if (it.actual) return { label: `A: ${it.actual}`, cls: "actual" };
  const since = Math.floor(-diff / 60000);
  if (since < 15) return { label: "awaiting…", cls: "waiting" };
  return { label: "released", cls: "released" };
}

const panelEl = ref<HTMLElement | null>(null);
function closePanel(): void {
  news.setOpen(false);
}

// open → refresh immediately
onMounted(() => {
  if (news.open) void news.refresh();
});
</script>

<template>
  <div class="news-panel" :class="{ open: news.open }">
    <div class="news-inner">
      <div class="news-head">
        <span class="news-title">Economic News</span>
        <span class="news-sub">ForexFactory · med/high</span>
      </div>

      <!-- Day navigation -->
      <div class="day-nav">
        <button class="day-arrow" aria-label="Previous day" @click="news.shiftDay(-1)">◀</button>
        <span class="day-label">{{ news.selectedDay?.label ?? "—" }}</span>
        <button class="day-arrow" aria-label="Next day" @click="news.shiftDay(1)">▶</button>
      </div>

      <div class="news-list" ref="panelEl">
        <div v-if="news.dayItems.length === 0" class="news-empty">No medium/high impact news on this day</div>
        <div v-for="it in news.dayItems" :key="it.title + it.date" class="news-row" :class="impactClass(it.impact)">
          <div class="row-time">
            <img v-if="flagFor(it.country)" :src="flagFor(it.country)!" class="row-flag" :alt="it.country" />
            <span class="row-time-text">{{ timeLabel(it.date) }}</span>
          </div>
          <div class="row-main">
            <span class="row-title">{{ it.title }}</span>
            <span class="row-vals">
              <span v-if="it.actual" class="val actual">A: {{ it.actual }}</span>
              <span v-else-if="rowState(it).cls === 'waiting'" class="val waiting">A: waiting…</span>
              <span v-if="it.forecast" class="val">F: {{ it.forecast }}</span>
              <span v-if="it.previous" class="val">P: {{ it.previous }}</span>
              <span v-if="!it.forecast && !it.previous && !it.actual" class="val muted">—</span>
            </span>
          </div>
          <div class="row-side">
            <span class="impact-badge" :class="impactClass(it.impact)">{{ it.impact === "Holiday" ? "HOL" : it.impact === "High" ? "HIGH" : "MED" }}</span>
            <span class="row-timer" :class="rowState(it).cls">{{ rowState(it).label }}</span>
          </div>
        </div>
      </div>


    </div>
  </div>
</template>

<style scoped>
.news-panel {
  width: 0;
  min-width: 0;
  max-width: 320px;
  background: var(--bg-watchlist);
  backdrop-filter: blur(20px) saturate(1.3);
  -webkit-backdrop-filter: blur(20px) saturate(1.3);
  border-left: 1px solid transparent;
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  position: relative;
  transition:
    width 420ms cubic-bezier(0.32, 0.72, 0, 1),
    min-width 420ms cubic-bezier(0.32, 0.72, 0, 1),
    border-color 300ms cubic-bezier(0.4, 0, 0.2, 1);
  pointer-events: none;
}
.news-panel.open {
  width: 320px;
  min-width: 320px;
  border-left-color: var(--border);
  pointer-events: auto;
}
.news-inner {
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
.news-panel.open .news-inner {
  opacity: 1;
  transform: translateX(0);
  transition-delay: 90ms;
}
.news-head {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 12px 12px 8px;
  flex-shrink: 0;
}
.news-title {
  font-weight: 800;
  font-size: 13px;
}
.news-sub {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.day-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 0 12px 8px;
  flex-shrink: 0;
}
.day-arrow {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  border: 1px solid var(--glass-border);
  background: var(--glass-bg);
  color: var(--text);
  cursor: pointer;
  font-size: 10px;
}
.day-arrow:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.day-label {
  font-weight: 800;
  font-size: 12px;
}
.news-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.news-empty {
  font-size: 11px;
  color: var(--text-muted);
  text-align: center;
  padding: 20px 10px;
}
.news-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px;
  border-radius: var(--radius-md);
  border: 1px solid var(--glass-border);
  background: var(--glass-bg);
}
.news-row.high {
  border-left: 3px solid #ef4444;
}
.news-row.med {
  border-left: 3px solid #fb923c;
}
.news-row.hol {
  border-left: 3px solid var(--text-muted);
}
.row-time {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}
.row-flag {
  width: 15px;
  height: 15px;
  border-radius: 50%;
  object-fit: contain;
}
.row-time-text {
  font-size: 11px;
  font-weight: 800;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.row-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.row-title {
  font-size: 11px;
  font-weight: 700;
  color: var(--text);
  line-height: 1.3;
}
.row-vals {
  display: flex;
  flex-wrap: wrap;
  gap: 3px 8px;
}
.val {
  font-size: 10px;
  font-weight: 700;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
.val.actual {
  color: var(--live);
  font-weight: 800;
}
.val.waiting {
  color: var(--reconnecting);
}
.val.muted {
  opacity: 0.6;
}
.row-side {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 3px;
  flex-shrink: 0;
}
.impact-badge {
  font-size: 8px;
  font-weight: 900;
  letter-spacing: 0.05em;
  padding: 1px 5px;
  border-radius: 99px;
  color: #fff;
}
.impact-badge.high {
  background: linear-gradient(135deg, #ef4444, #dc2626);
}
.impact-badge.med {
  background: linear-gradient(135deg, #fb923c, #f97316);
}
.impact-badge.hol {
  background: var(--text-muted);
}
.row-timer {
  font-size: 10px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
}
.row-timer.alarm {
  color: var(--offline);
  animation: newsAlarm 1s steps(2, start) infinite;
}
.row-timer.soon {
  color: var(--reconnecting);
}
.row-timer.actual {
  color: var(--live);
  font-weight: 800;
}
@keyframes newsAlarm {
  50% {
    opacity: 0.35;
  }
}
.news-foot {
  padding: 6px 12px 10px;
  flex-shrink: 0;
}
.news-updated {
  font-size: 9px;
  color: var(--text-muted);
}
.news-err {
  font-size: 10px;
  font-weight: 700;
  color: var(--offline);
}
/* Phones: overlay like the watchlist */
@media (max-width: 768px) {
  .news-panel.open {
    position: absolute;
    top: 0;
    right: 36px;
    bottom: 0;
    width: min(320px, calc(100vw - 60px));
    min-width: min(320px, calc(100vw - 60px));
    z-index: 30;
    border-left: 1px solid var(--border);
    box-shadow: -12px 0 28px rgba(0, 0, 0, 0.28);
  }
}
</style>
