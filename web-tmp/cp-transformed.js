import { createHotContext as __vite__createHotContext } from "/@vite/client";import.meta.hot = __vite__createHotContext("/src/components/ChartPane.vue");import { defineComponent as _defineComponent } from "/node_modules/.vite/deps/vue.js?v=10d01972";
import { ref, watch, onMounted, onBeforeUnmount, nextTick, computed } from "/node_modules/.vite/deps/vue.js?v=10d01972";
import { createChartAdapter } from "/src/chart/chartAdapter.ts";
import { useThemeStore } from "/src/stores/theme.ts";
import { useMarketStore } from "/src/stores/market.ts";
import { useDrawingsStore } from "/src/stores/drawings.ts";
import { useReplayStore } from "/src/stores/replay.ts";
import { useDemoStore, demoValuePerPrice } from "/src/stores/demo.ts";
import { useIndicatorsStore, sessionKindAt, nextBoundaryAfter, boundaryEpoch, CHAIN_NEXT, tzOffsetMin, inSession, localMinutesOfDay } from "/src/stores/indicators.ts";
import { currencyFlagUrl, commodityIcon, symbolParts } from "/src/utils/flags.ts";
import { TIMEFRAME_SECONDS, instrumentPrecision, instrumentPipSize, providerOf, binanceBucketStart, oandaDailyBucketStart, oandaH4BucketStart, oandaWeeklyBucketStart, oandaMonthlyBucketStart } from "/node_modules/.vite/deps/@traderkomak_shared.js?v=fa304be1";
const CHART_STYLE_KEY = "tk-chart-style";
const TPL_KEY = "tk-chart-templates";
const PANEL_W = 366;
const PANEL_H = 40;
const _sfc_main = /* @__PURE__ */ _defineComponent({
  __name: "ChartPane",
  props: {
    candles: { type: Array, required: true },
    isLoading: { type: Boolean, required: true },
    error: { type: [String, null], required: true },
    instrument: { type: String, required: false }
  },
  setup(__props, { expose: __expose }) {
    __expose();
    const props = __props;
    const market = useMarketStore();
    const drawingsStore = useDrawingsStore();
    const replay = useReplayStore();
    const demo = useDemoStore();
    const indicators = useIndicatorsStore();
    const sessionPixels = ref([]);
    const indSettingsOpen = ref(false);
    const DEFAULT_CANDLES = {
      up: "#26a69a",
      down: "#ef5350",
      borderUp: "#26a69a",
      borderDown: "#ef5350",
      wickUp: "#26a69a",
      wickDown: "#ef5350"
    };
    function defaultChartStyle() {
      return {
        bgMode: "gradient",
        bgSolid: null,
        bgTop: null,
        bgBottom: null,
        up: null,
        down: null,
        borderUp: null,
        borderDown: null,
        wickUp: null,
        wickDown: null,
        axisText: null,
        axisBorder: null,
        crossVert: null,
        crossHorz: null
      };
    }
    const HEX = (v) => typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);
    function loadChartStyle() {
      const base = defaultChartStyle();
      try {
        const raw = localStorage.getItem(CHART_STYLE_KEY);
        if (raw) {
          const p = JSON.parse(raw);
          if (p.bgMode === "solid" || p.bgMode === "gradient") base.bgMode = p.bgMode;
          for (const k of ["bgSolid", "bgTop", "bgBottom", "up", "down", "borderUp", "borderDown", "wickUp", "wickDown", "axisText", "axisBorder", "crossVert", "crossHorz"]) {
            const v = p[k];
            if (v === null || HEX(v)) base[k] = v;
          }
        }
      } catch {
      }
      return base;
    }
    const paneRef = ref(null);
    const chartStyle = ref(loadChartStyle());
    const chartSettingsOpen = ref(false);
    const isDarkTheme = computed(() => themeStore.theme === "dark");
    function themeBgPair() {
      return isDarkTheme.value ? ["#171a3a", "#0b1120"] : ["#e4e9ff", "#fdf2f8"];
    }
    function themeAxisPair() {
      return isDarkTheme.value ? ["#d1d4dc", "#2a2e6a"] : ["#1e1b4b", "#c7d2fe"];
    }
    function eff(v, theme) {
      return v ?? theme;
    }
    function applyChartStyle() {
      const s = chartStyle.value;
      const pane = paneRef.value;
      if (pane) {
        pane.style.background = s.bgMode === "solid" ? s.bgSolid ?? themeBgPair()[0] : `linear-gradient(180deg, ${s.bgTop ?? themeBgPair()[0]} 0%, ${s.bgBottom ?? themeBgPair()[1]} 100%)`;
      }
      adapter?.setCandleColors({
        up: s.up ?? DEFAULT_CANDLES.up,
        down: s.down ?? DEFAULT_CANDLES.down,
        borderUp: s.borderUp ?? DEFAULT_CANDLES.borderUp,
        borderDown: s.borderDown ?? DEFAULT_CANDLES.borderDown,
        wickUp: s.wickUp ?? DEFAULT_CANDLES.wickUp,
        wickDown: s.wickDown ?? DEFAULT_CANDLES.wickDown
      });
      adapter?.setAxisColors({ text: s.axisText, border: s.axisBorder });
      adapter?.setCrosshairColors({ vert: s.crossVert, horz: s.crossHorz });
      localStorage.setItem(CHART_STYLE_KEY, JSON.stringify(s));
    }
    watch(chartStyle, applyChartStyle, { deep: true });
    watch(isDarkTheme, () => applyChartStyle());
    function resetChartStyle() {
      chartStyle.value = defaultChartStyle();
    }
    function setColor(key, e) {
      const v = e.target.value;
      if (HEX(v)) chartStyle.value[key] = v;
    }
    function resetGroup(group) {
      const s = chartStyle.value;
      if (group === "bg") {
        s.bgSolid = null;
        s.bgTop = null;
        s.bgBottom = null;
        s.bgMode = "gradient";
      } else if (group === "candles") {
        s.up = s.down = s.borderUp = s.borderDown = s.wickUp = s.wickDown = null;
      } else if (group === "scales") {
        s.axisText = null;
        s.axisBorder = null;
      } else {
        s.crossVert = null;
        s.crossHorz = null;
      }
    }
    function loadTemplates() {
      try {
        const raw = localStorage.getItem(TPL_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr.filter((t) => t && typeof t.name === "string" && t.style) : [];
      } catch {
        return [];
      }
    }
    const templates = ref(loadTemplates());
    const tplName = ref("");
    const selectedTpl = ref("");
    function persistTemplates() {
      localStorage.setItem(TPL_KEY, JSON.stringify(templates.value));
    }
    function saveTemplate() {
      const clean = tplName.value.trim().slice(0, 24);
      const name = clean || `Template ${templates.value.length + 1}`;
      templates.value = templates.value.filter((t) => t.name !== name);
      templates.value.push({ name, style: JSON.parse(JSON.stringify(chartStyle.value)) });
      persistTemplates();
      tplName.value = "";
      selectedTpl.value = name;
    }
    function applyTemplate() {
      const t = templates.value.find((x) => x.name === selectedTpl.value);
      if (t) chartStyle.value = JSON.parse(JSON.stringify(t.style));
    }
    function deleteTemplate() {
      if (!selectedTpl.value) return;
      templates.value = templates.value.filter((t) => t.name !== selectedTpl.value);
      persistTemplates();
      selectedTpl.value = "";
    }
    function indSettingsOutside(e) {
      const pop = document.querySelector(".ind-settings");
      if (pop && pop.contains(e.target)) return;
      const legend = document.querySelector(".indicator-legend");
      if (legend && legend.contains(e.target)) return;
      indSettingsOpen.value = false;
    }
    watch(indSettingsOpen, (open) => {
      if (open) document.addEventListener("pointerdown", indSettingsOutside, true);
      else document.removeEventListener("pointerdown", indSettingsOutside, true);
    });
    let runsCache = null;
    let lastBoxesJson = "";
    function computeSessionBoxes() {
      if (!indicators.sessionsAdded || !indicators.sessionsVisible || !adapter) {
        if (sessionPixels.value.length) sessionPixels.value = [];
        lastBoxesJson = "";
        return;
      }
      const c = props.candles;
      const n = c.length;
      if (n < 2) {
        if (sessionPixels.value.length) sessionPixels.value = [];
        lastBoxesJson = "";
        return;
      }
      const chartW = (containerRef.value?.clientWidth ?? 0) - axisRightW.value;
      const tfSec = TIMEFRAME_SECONDS[market.timeframe] ?? Math.max(1, c[n - 1].time - c[n - 2].time);
      const cfgKey = JSON.stringify([
        indicators.defs.map((d) => [d.id, d.name, d.color]),
        indicators.customs.map((d) => [d.id, d.name, d.color]),
        indicators.sessionsEnabled
      ]);
      const cacheKey = [
        market.instrument,
        market.timeframe,
        n,
        c[0].time,
        c[n - 1].time,
        c[n - 1].high,
        c[n - 1].low,
        cfgKey
      ].join("|");
      if (!runsCache || runsCache.key !== cacheKey) {
        const runs = [];
        const scheduledEndFor = (def, t) => {
          const nextId = CHAIN_NEXT[def.id];
          const nextDef = nextId ? indicators.defs.find((d) => d.id === nextId) : void 0;
          return nextDef ? nextBoundaryAfter(nextDef, t) : nextBoundaryAfter(def, t);
        };
        const scheduledEndCustom = (def, t) => {
          const d = Math.floor(t / 86400);
          for (const day of [d, d + 1]) {
            const end = day * 86400 + (def.end - tzOffsetMin(def.tz, day)) * 60;
            if (end > t) return end;
          }
          return t;
        };
        const scanRuns = (member, endT, id, name, color) => {
          let runStart = -1;
          let runHigh = -Infinity;
          let runLow = Infinity;
          const closeRun = (endIdx) => {
            if (runStart < 0) return;
            const lastIdx = endIdx - 1;
            const t1 = c[runStart].time;
            const streaming = lastIdx === n - 1 && Date.now() / 1e3 - c[lastIdx].time < Math.max(tfSec * 2, 120);
            const t2 = c[lastIdx].time + tfSec;
            const extendTo = lastIdx === n - 1 && streaming ? endT(c[lastIdx].time) : null;
            runStart = -1;
            runs.push({ id, name, color, t1, t2, high: runHigh, low: runLow, extendTo });
          };
          for (let i = 0; i <= n; i++) {
            const isIn = i < n && member(i);
            if (isIn) {
              if (runStart < 0) {
                runStart = i;
                runHigh = -Infinity;
                runLow = Infinity;
              }
              runHigh = Math.max(runHigh, c[i].high);
              runLow = Math.min(runLow, c[i].low);
            } else {
              closeRun(i);
            }
          }
        };
        for (const def of indicators.defs) {
          if (!indicators.isEnabled(def.id)) continue;
          scanRuns(
            (i) => sessionKindAt(c[i].time) === def.id,
            (t) => scheduledEndFor(def, t),
            def.id,
            def.name,
            def.color
          );
        }
        for (const def of indicators.customs) {
          if (!indicators.isEnabled(def.id)) continue;
          scanRuns(
            (i) => inSession(def, localMinutesOfDay(def.tz, c[i].time)),
            (t) => scheduledEndCustom(def, t),
            def.id,
            def.name,
            def.color
          );
        }
        runsCache = { key: cacheKey, runs };
      }
      const out = [];
      for (const run of runsCache.runs) {
        const x1 = adapter.timeToX(run.t1);
        const x2 = adapter.timeToX(run.extendTo ?? run.t2);
        const top = adapter.getPriceY(run.high);
        const bottom = adapter.getPriceY(run.low);
        if (x1 === null || x2 === null || top === null || bottom === null) continue;
        const left = Math.max(-2, Math.min(x1, x2));
        const right = Math.min(chartW + 2, Math.max(x1, x2));
        const width = right - left;
        if (width < 1) continue;
        const yTop = Math.min(top, bottom);
        const yBot = Math.max(top, bottom);
        out.push({
          key: run.id + "-" + run.t1,
          name: run.name,
          color: run.color,
          left,
          width,
          top: yTop,
          height: Math.max(2, yBot - yTop),
          showLabel: width > 56 && indicators.sessionsLabels,
          labelTop: 3
        });
      }
      const LABEL_H = 12;
      const placed = [];
      for (const b of [...out].sort((a, b2) => a.left - b2.left)) {
        if (!b.showLabel) continue;
        const l = b.left;
        const r = b.left + b.width;
        let lt = 3;
        while (placed.some((p) => l < p.r && r > p.l && b.top + lt < p.b && b.top + lt + LABEL_H > p.t)) {
          lt += LABEL_H + 2;
        }
        if (lt + LABEL_H > b.height) {
          b.showLabel = false;
          continue;
        }
        placed.push({ l, r, t: b.top + lt, b: b.top + lt + LABEL_H });
        b.labelTop = lt;
      }
      const j = JSON.stringify(out);
      if (j !== lastBoxesJson) {
        lastBoxesJson = j;
        sessionPixels.value = out;
      }
    }
    function toTimeStr(min) {
      const m = (Math.round(min) % 1440 + 1440) % 1440;
      return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
    }
    function onCustomTimeChange(s, which, ev) {
      const v = ev.target.value;
      const [h = 0, m = 0] = v.split(":").map(Number);
      if (Number.isFinite(h) && Number.isFinite(m)) s[which] = h * 60 + m;
    }
    function sessionWindowLocal(def) {
      const now = Math.floor(Date.now() / 1e3);
      const day = Math.floor(now / 86400);
      const bounds = [];
      for (const dd of [day - 2, day - 1, day, day + 1, day + 2]) {
        for (const d of indicators.defs) {
          const t = boundaryEpoch(d, dd * 86400);
          if (t > now - 36 * 3600 && t < now + 36 * 3600) bounds.push({ t, id: d.id });
        }
      }
      bounds.sort((a, b) => a.t - b.t);
      let si = bounds.findIndex((b, i) => b.id === def.id && b.t <= now && (i + 1 >= bounds.length || bounds[i + 1].t > now));
      if (si < 0) si = bounds.findIndex((b) => b.id === def.id && b.t > now);
      if (si < 0 || si + 1 >= bounds.length) return "—";
      const fmt = (t) => new Date(t * 1e3).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
      const startT = bounds[si].t;
      const endT = bounds[si + 1].t;
      const wrap = endT <= startT ? " +1" : "";
      return fmt(startT) + " – " + fmt(endT) + wrap;
    }
    const newSessName = ref("");
    const newSessColor = ref("#7bd88f");
    const newSessStart = ref("08:00");
    const newSessEnd = ref("12:00");
    function onAddSession() {
      const parse = (v) => {
        const [h = 0, m = 0] = v.split(":").map(Number);
        return h * 60 + m;
      };
      if (indicators.addCustomSession(newSessName.value, parse(newSessStart.value), parse(newSessEnd.value), newSessColor.value)) {
        newSessName.value = "";
      }
    }
    watch(
      () => [indicators.sessionsAdded, indicators.sessionsVisible, indicators.sessionsLabels, indicators.sessionsEnabled, indicators.defs, indicators.customs],
      () => recalcRects(),
      { deep: true }
    );
    const prec = computed(() => instrumentPrecision(market.instrument));
    const demoLines = ref([]);
    let demoLineDrag = null;
    const demoTab = ref("positions");
    const demoPeriod = ref("week");
    const demoBottomH = ref(96);
    const demoChartH = ref(0);
    const demoMini = ref(false);
    function demoLevelY(price) {
      return adapter ? adapter.getPriceY(price) : null;
    }
    function rebuildDemoLines() {
      const out = [];
      if (!demo.active) {
        demoLines.value = out;
        return;
      }
      const prec2 = instrumentPrecision(market.instrument);
      const vppOf = (p) => demoValuePerPrice(p.symbol, p.entry);
      for (const p of demo.openPositions) {
        if (p.symbol !== market.instrument) continue;
        const vpp = vppOf(p);
        const risk = p.sl !== null ? Math.abs(p.entry - p.sl) * p.lot * vpp : 0;
        const reward = p.tp !== null ? Math.abs(p.tp - p.entry) * p.lot * vpp : 0;
        const rr = risk > 0 ? +(reward / risk).toFixed(2) : null;
        {
          const y = demoLevelY(p.entry);
          if (y !== null) out.push({ id: p.id, level: "entry", y, price: p.entry, color: "#2962ff", dashed: false, direction: p.direction, status: "open", lot: p.lot, money: 0, rr: null });
        }
        if (p.sl !== null) {
          const y = demoLevelY(p.sl);
          if (y !== null) out.push({ id: p.id, level: "sl", y, price: p.sl, color: "#ef5350", dashed: false, direction: p.direction, status: "open", lot: p.lot, money: +risk.toFixed(2), rr: null });
        }
        if (p.tp !== null) {
          const y = demoLevelY(p.tp);
          if (y !== null) out.push({ id: p.id, level: "tp", y, price: p.tp, color: "#26a69a", dashed: false, direction: p.direction, status: "open", lot: p.lot, money: +reward.toFixed(2), rr });
        }
      }
      for (const p of demo.positions) {
        if (p.symbol !== market.instrument || p.status !== "pending") continue;
        const vpp = vppOf(p);
        const risk = p.sl !== null ? Math.abs(p.entry - p.sl) * p.lot * vpp : 0;
        const reward = p.tp !== null ? Math.abs(p.tp - p.entry) * p.lot * vpp : 0;
        const rr = risk > 0 && p.tp !== null ? +(Math.abs(p.tp - p.entry) * p.lot * vpp / risk).toFixed(2) : null;
        const yEntry = demoLevelY(p.entry);
        if (yEntry !== null) out.push({ id: p.id, level: "entry", y: yEntry, price: p.entry, color: "#2962ff", dashed: true, direction: p.direction, status: "pending", lot: p.lot, money: 0, rr: null });
        if (p.sl !== null) {
          const y = demoLevelY(p.sl);
          if (y !== null) out.push({ id: p.id, level: "sl", y, price: p.sl, color: "#ef5350", dashed: false, direction: p.direction, status: "pending", lot: p.lot, money: +risk.toFixed(2), rr: null });
        }
        if (p.tp !== null) {
          const y = demoLevelY(p.tp);
          if (y !== null) out.push({ id: p.id, level: "tp", y, price: p.tp, color: "#26a69a", dashed: false, direction: p.direction, status: "pending", lot: p.lot, money: +reward.toFixed(2), rr });
        }
      }
      if (draft.value) {
        const d = draft.value;
        const distSl = Math.abs(d.entry - d.sl);
        const distTp = Math.abs(d.tp - d.entry);
        const vpp = demoValuePerPrice(market.instrument, d.entry);
        const risk = demo.sizeMode === "lot" ? distSl * demo.lot * vpp : demo.sizeMode === "percent" ? demo.balance * demo.riskPct / 100 : demo.riskUsd;
        const lotEff = demo.sizeMode === "lot" ? demo.lot : distSl > 0 ? Math.min(100, Math.max(0.01, +(risk / (distSl * vpp)).toFixed(2))) : demo.lot;
        const reward = distTp * lotEff * vpp;
        const rr = distSl > 0 ? +(distTp / distSl).toFixed(2) : null;
        const ySl = demoLevelY(d.sl);
        const yTp = demoLevelY(d.tp);
        if (d.kind === "limit") {
          const yEntry = demoLevelY(d.entry);
          if (yEntry !== null) out.push({ id: "__draft", level: "entry", y: yEntry, price: d.entry, color: "#2962ff", dashed: true, direction: d.side, status: "pending", lot: lotEff, money: 0, rr: null });
        }
        if (ySl !== null) out.push({ id: "__draft", level: "sl", y: ySl, price: d.sl, color: "#ef5350", dashed: false, direction: d.side, status: "pending", lot: lotEff, money: +risk.toFixed(2), rr: null });
        if (yTp !== null) out.push({ id: "__draft", level: "tp", y: yTp, price: d.tp, color: "#26a69a", dashed: false, direction: d.side, status: "pending", lot: lotEff, money: +reward.toFixed(2), rr });
      }
      demoLines.value = out;
    }
    function onDemoLineDragStart(e, id, level) {
      if (e.button !== 0 || !adapter || !containerRef.value) return;
      if (id !== "__draft" && level === "entry") {
        const pos = demo.positions.find((x) => x.id === id);
        if (pos && pos.status === "open") return;
      }
      e.preventDefault();
      e.stopPropagation();
      demoLineDrag = { id, level };
      const move = (ev) => {
        if (!demoLineDrag || !adapter || !containerRef.value) return;
        const r = containerRef.value.getBoundingClientRect();
        const cy = Math.min(Math.max(ev.clientY, r.top + 2), r.bottom - 2);
        const p = adapter.yToPrice(cy - r.top);
        if (p === null || !Number.isFinite(p) || p <= 0) return;
        if (id === "__draft" && draft.value) {
          const d = draft.value;
          const long = d.side === "long";
          if (level === "entry") {
            d.entry = long ? Math.min(Math.max(p, d.sl), d.tp) : Math.min(Math.max(p, d.tp), d.sl);
          } else if (level === "sl") {
            d.sl = long ? Math.min(p, d.entry) : Math.max(p, d.entry);
          } else {
            d.tp = long ? Math.max(p, d.entry) : Math.min(p, d.entry);
          }
        } else {
          demo.updateLevel(id, level, p);
        }
        recalcRects();
      };
      const up = () => {
        demoLineDrag = null;
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    }
    const draft = ref(null);
    function armDemo(side, kind) {
      if (!replay.active && demo.isClosed()) return;
      const c = market.candles;
      if (!c.length) return;
      const last = replay.active && replay.cutoff !== null ? c.filter((x) => x.time <= replay.cutoff).slice(-1)[0].close : c[c.length - 1].close;
      const long = side === "long";
      const dir = long ? 1 : -1;
      const visible = replay.active && replay.cutoff !== null ? c.filter((x) => x.time <= replay.cutoff) : c;
      const win = visible.slice(-14);
      const atr = win.length > 1 ? win.reduce((s, x) => s + (x.high - x.low), 0) / win.length : 0;
      const slDist = atr > 0 ? atr * 1.5 : last * 5e-3;
      const entry = kind === "limit" ? last - dir * slDist : last;
      draft.value = {
        side,
        kind,
        entry,
        sl: entry - dir * slDist,
        tp: entry + dir * slDist * 2
      };
      demo.error = null;
      recalcRects();
    }
    function setDemoDraft() {
      const d = draft.value;
      if (!d) return;
      if (!replay.active && isForexClosed()) {
        demo.error = "Market closed — use Replay to place trades";
        return;
      }
      demo.placeOrder(market.instrument, d.side, d.kind, d.entry, d.sl, d.tp);
      draft.value = null;
    }
    function cancelDemoDraft() {
      draft.value = null;
    }
    const demoSummary = computed(() => demo.summaryFor(demoPeriod.value));
    const pendingOrders = computed(() => demo.positions.filter((p) => p.status === "pending"));
    const marketClosedNote = computed(() => !replay.active && isForexClosed());
    function pnlClass(v) {
      return (v ?? 0) >= 0 ? "pos" : "neg";
    }
    function fmtMoney(v) {
      return (v >= 0 ? "$" : "-$") + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    const themeStore = useThemeStore();
    const containerRef = ref(null);
    let adapter = null;
    let ro = null;
    const displayCandles = computed(
      () => replay.active && replay.cutoff !== null ? props.candles.filter((c) => c.time <= replay.cutoff) : props.candles
    );
    const pickTime = ref(null);
    const replayVlX = ref(null);
    const replayTag = ref(null);
    let replayTimer = null;
    let holdTimer = null;
    let holdTimeout = null;
    let pickingMove = null;
    function replayStep(dir) {
      const arr = props.candles;
      if (!arr.length || replay.cutoff === null) return;
      if (dir === 1) {
        const next = arr.find((c) => c.time > replay.cutoff);
        if (!next) {
          replay.playing = false;
          return;
        }
        if (replay.dataEnd !== null && next.time > replay.dataEnd) {
          replay.playing = false;
          return;
        }
        replay.stepTo(next.time);
      } else {
        let prev = null;
        for (const c of arr) {
          if (c.time < replay.cutoff) prev = c;
          else break;
        }
        if (prev) replay.stepTo(prev.time);
      }
    }
    function togglePlay() {
      if (replay.picking) {
        if (pickTime.value !== null) replay.startAt(pickTime.value);
        replay.playing = true;
        return;
      }
      replay.playing = !replay.playing;
    }
    function holdStep(dir) {
      stopHold();
      replayStep(dir);
      holdTimeout = setTimeout(() => {
        holdTimer = setInterval(() => replayStep(dir), 1e3 / replay.speed);
      }, 350);
    }
    function stopHold() {
      if (holdTimeout) {
        clearTimeout(holdTimeout);
        holdTimeout = null;
      }
      if (holdTimer) {
        clearInterval(holdTimer);
        holdTimer = null;
      }
    }
    function replayTimeAt(clientX) {
      if (!adapter || !containerRef.value || !displayCandles.value.length) return null;
      const r = containerRef.value.getBoundingClientRect();
      const lr = adapter.getLogicalRange();
      if (!lr || lr.to <= lr.from) return null;
      const chartW = containerRef.value.clientWidth - axisRightW.value;
      const frac = Math.min(Math.max((clientX - r.left) / chartW, 0), 1);
      const idx = Math.round(lr.from + frac * (lr.to - lr.from));
      const clamped = Math.min(Math.max(idx, 0), displayCandles.value.length - 1);
      return displayCandles.value[clamped].time;
    }
    function onPickingMove(ev) {
      const t = replayTimeAt(ev.clientX);
      if (t === null) return;
      pickTime.value = t;
      recalcRects();
    }
    function stopPickingListeners() {
      if (pickingMove) {
        const root = document.querySelector(".chart-pane") ?? containerRef.value;
        root.removeEventListener("mousemove", pickingMove, { capture: true });
      }
      pickingMove = null;
    }
    watch(
      () => replay.picking,
      (picking) => {
        stopPickingListeners();
        if (picking && containerRef.value && displayCandles.value.length) {
          const w = containerRef.value.clientWidth - axisRightW.value;
          const lr = adapter?.getLogicalRange();
          let idx;
          if (lr && lr.to > lr.from) {
            idx = Math.round(lr.from + 0.6 * (lr.to - lr.from));
          } else {
            idx = displayCandles.value.length - 1;
          }
          idx = Math.min(Math.max(idx, 0), displayCandles.value.length - 1);
          pickTime.value = displayCandles.value[idx].time;
          pickingMove = onPickingMove;
          const pickRoot = document.querySelector(".chart-pane") ?? containerRef.value;
          pickRoot.addEventListener("mousemove", pickingMove, { capture: true });
          recalcRects();
        }
      }
    );
    watch(
      () => [replay.playing, replay.speed, replay.active, replay.picking],
      () => {
        if (replayTimer) {
          clearInterval(replayTimer);
          replayTimer = null;
        }
        if (replay.active && replay.playing && !replay.picking) {
          replayTimer = setInterval(() => replayStep(1), 1e3 / replay.speed);
        }
      }
    );
    function focusReplayEdge() {
      nextTick(() => nextTick(() => adapter?.focusLast()));
    }
    watch(
      () => replay.cutoff,
      (cutoff, prev) => {
        if (!replay.active || cutoff === null || prev === null) return;
        const lastShown = displayCandles.value[displayCandles.value.length - 1];
        if (lastShown && cutoff > prev) demo.processReplayCandle(lastShown, market.instrument);
        else if (lastShown) demo.processReplayPrice(lastShown.close, market.instrument);
        if (cutoff < prev) demo.deleteBeyond(cutoff, market.instrument);
        if (cutoff <= prev) return;
        const idx = displayCandles.value.length - 1;
        const r = adapter?.getLogicalRange();
        const ad = adapter;
        if (!r || !ad) return;
        if (idx > r.to - 3) {
          const width = r.to - r.from;
          ad.setLogicalRange({ from: idx - width + 15, to: idx + 15 });
        }
      }
    );
    watch(
      () => replay.active,
      (active) => {
        adapter?.setPriceAutoScale(!active);
        adapter?.setLastValueVisible(!active);
        if (!active) {
          focusReplayEdge();
        }
      }
    );
    async function onReplayExit() {
      await market.loadHistory(true);
      replay.exit();
      focusReplayEdge();
    }
    watch(
      () => market.timeframe,
      () => {
        if (replay.active) {
          adapter?.setPriceAutoScale(false);
          if (replay.cutoff !== null) focusReplayEdge();
        }
      }
    );
    function flagFor(currency) {
      const flag = currencyFlagUrl(currency);
      if (flag) return { type: "flag", value: flag };
      const icon = commodityIcon(currency);
      if (icon) return { type: "icon", value: icon };
      return { type: "icon", value: "◈" };
    }
    watch(
      displayCandles,
      (next, prev) => {
        if (!adapter) return;
        nextTick(updateBadgePosition);
        if (!prev || prev.length === 0 || next.length === 0) {
          adapter.setPriceAutoScale(!replay.active);
          adapter.setData(next);
          return;
        }
        const isPrepend = next.length > prev.length && next[0].time < prev[0].time;
        if (isPrepend) {
          const prevRange = adapter.getLogicalRange();
          adapter.setData(next);
          if (prevRange) {
            const added = next.length - prev.length;
            adapter.setLogicalRange({ from: prevRange.from + added, to: prevRange.to + added });
          }
          return;
        }
        if (next.length < prev.length - 5) {
          adapter.setData(next);
          return;
        }
        const preShrinkRange = adapter.getLogicalRange();
        const prevLast = prev[prev.length - 1];
        const nextLast = next[next.length - 1];
        if (!nextLast || !prevLast) {
          adapter.setData(next);
          restoreRange(preShrinkRange, prev.length - next.length);
          return;
        }
        if (next.length === prev.length + 1 && next[next.length - 2].time === prevLast.time && nextLast.time > prevLast.time) {
          adapter.updateCandle(nextLast);
          return;
        }
        if (next.length !== prev.length) {
          adapter.setData(next);
          if (next.length < prev.length && preShrinkRange) {
            restoreRange(preShrinkRange, prev.length - next.length);
          }
          return;
        }
        if (prevLast.time === nextLast.time) {
          const pp = prev[prev.length - 2];
          const np = next[next.length - 2];
          const olderChanged = pp && np && (np.time !== pp.time || np.open !== pp.open || np.high !== pp.high || np.low !== pp.low || np.close !== pp.close);
          if (olderChanged) {
            adapter.setData(next);
          } else {
            adapter.updateCandle(nextLast);
          }
        } else {
          adapter.setData(next);
        }
      },
      { deep: false }
    );
    watch(
      () => themeStore.theme,
      (t) => {
        adapter?.setTheme(t === "dark");
      }
    );
    watch(
      () => props.instrument,
      (inst) => {
        if (inst) adapter?.setInstrument(inst);
      }
    );
    watch(
      () => drawingsStore.activeTool,
      (tool) => {
        rectMenu.value = null;
        closePalette();
        linePaletteOpen.value = false;
        polyPaletteOpen.value = false;
        cancelDraw();
      }
    );
    let visibleCb = null;
    let dataCb = null;
    let lazyThrottled = false;
    let interactionEl = null;
    let interactCb = null;
    let overlayWheelEl = null;
    let overlayWheelCb = null;
    let recalcRaf = 0;
    let recalcDeadline = 0;
    let loadSettleDeadline = 0;
    let pointerHeld = false;
    let pointerDownEl = null;
    let pointerDownCb = null;
    let pointerUpCb = null;
    let chartMouseDownEl = null;
    let chartMouseDownCb = null;
    let tapDownEl = null;
    let tapDownCb = null;
    let tapUpCb = null;
    let chartDblClickEl = null;
    let chartDblClickCb = null;
    let paneCtxEl = null;
    let paneCtxCb = null;
    let escCb = null;
    let magnetKeyCb = null;
    let magnetBlurCb = null;
    let magnetAnyMoveCb = null;
    let xhairMoveEl = null;
    let xhairMoveCb = null;
    let xhairLeaveCb = null;
    let crosshairModeStop = null;
    let windowLostCb = null;
    const countdown = ref("");
    const marketClosed = ref(false);
    const tagW = ref(0);
    const tagRight = ref(0);
    const tagVisible = ref(false);
    const timerTop = ref(0);
    const smallTagH = ref(19);
    let countdownTimer = null;
    function isForexClosed() {
      return demo.isClosed(market.instrument);
    }
    function restoreRange(pre, removed) {
      const ad = adapter;
      if (!pre || !ad) return;
      const apply = (from, to) => ad.setLogicalRange({ from, to });
      const drifted = ad.getLogicalRange();
      if (!drifted) return;
      const dFrom = pre.from - drifted.from;
      const dTo = pre.to - drifted.to;
      if (Math.abs(dFrom) < 0.1 && Math.abs(dTo) < 0.1) return;
      apply(drifted.from + dFrom, drifted.to + dTo);
      const check = ad.getLogicalRange();
      if (check && (Math.abs(pre.from - check.from) > 0.1 || Math.abs(pre.to - check.to) > 0.1)) {
        apply(check.from + (pre.from - check.from), check.to + (pre.to - check.to));
      }
    }
    function updateBadgePosition() {
      if (replay.active) {
        tagVisible.value = false;
        return;
      }
      const last = displayCandles.value[displayCandles.value.length - 1];
      if (!last || !adapter || !containerRef.value) {
        tagVisible.value = false;
        return;
      }
      const y = adapter.getPriceY(last.close);
      if (y === null) {
        tagVisible.value = false;
        return;
      }
      smallTagH.value = adapter.getPriceLabelHeight();
      const priceText = last.close.toFixed(instrumentPrecision(market.instrument));
      const nativeW = adapter.getPriceLabelWidth(priceText) + 16;
      const textW = adapter.getPriceLabelWidth(countdown.value || "0") + 12;
      tagW.value = Math.max(nativeW, textW);
      tagRight.value = Math.max(0, axisRightW.value - tagW.value);
      const timeAxis = 26;
      const paneH = containerRef.value.clientHeight - timeAxis;
      timerTop.value = Math.min(Math.max(y + smallTagH.value / 2, 4), paneH - smallTagH.value);
      tagVisible.value = true;
    }
    function updateCountdown() {
      marketClosed.value = isForexClosed();
      updateBadgePosition();
      const db = document.querySelector(".demo-bottom");
      if (db) demoBottomH.value = db.getBoundingClientRect().height;
      if (replay.active) {
        countdown.value = "";
        return;
      }
      if (marketClosed.value) {
        countdown.value = "CLOSED";
        return;
      }
      const tf = market.timeframe;
      const sec = TIMEFRAME_SECONDS[tf] ?? 5;
      const now = Date.now();
      const DAY = 864e5;
      const isBinance = providerOf(market.instrument) === "binance";
      let next;
      if (isBinance) {
        if (sec === 2592e3) {
          const d = new Date(now);
          next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
        } else if (sec === 604800) {
          next = binanceBucketStart(now, sec) + sec * 1e3;
        } else {
          next = Math.floor(now / (sec * 1e3)) * sec * 1e3 + sec * 1e3;
        }
      } else if (sec === 14400) next = oandaH4BucketStart(now + 4 * 36e5);
      else if (sec === 86400) {
        next = oandaDailyBucketStart(now + 12 * 36e5);
        if (next <= now) next = oandaDailyBucketStart(now + 36 * 36e5);
      } else if (sec === 604800) next = oandaWeeklyBucketStart(oandaWeeklyBucketStart(now) + 7 * DAY + 1e3);
      else if (sec === 2592e3) next = oandaMonthlyBucketStart(oandaMonthlyBucketStart(now) + 32 * DAY);
      else next = Math.floor(now / (sec * 1e3)) * sec * 1e3 + sec * 1e3;
      const rem = Math.max(0, next - now);
      const pad2 = (n) => String(n).padStart(2, "0");
      if (sec >= 604800) {
        const total = Math.floor(rem / 1e3);
        const dd = Math.floor(total / 86400);
        const hh = Math.floor(total % 86400 / 3600);
        const mm = Math.floor(total % 3600 / 60);
        const ss = total % 60;
        countdown.value = `${dd}d ${pad2(hh)}:${pad2(mm)}:${pad2(ss)}`;
      } else if (sec >= 14400) {
        const total = Math.floor(rem / 1e3);
        const hh = Math.floor(total / 3600);
        const mm = Math.floor(total % 3600 / 60);
        const ss = total % 60;
        countdown.value = `${pad2(hh)}:${pad2(mm)}:${pad2(ss)}`;
      } else if (sec >= 60) {
        const s = Math.floor(rem / 1e3);
        countdown.value = `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`;
      } else {
        countdown.value = `${Math.max(0, Math.ceil(rem / 1e3))}s`;
      }
    }
    const rectPixels = ref([]);
    const hitRects = computed(() => rectPixels.value.filter((r) => r.id !== "__preview"));
    const drawingState = ref(null);
    const drawingPreview = ref(null);
    const selectedRect = ref(null);
    const editPanelPos = ref(null);
    const editPanelEl = ref(null);
    const editMenuEl = ref(null);
    const rectMenu = ref(null);
    const paletteOpen = ref(null);
    function clampToPane(x, y, el) {
      const pane = containerRef.value;
      if (!pane) return { x, y };
      const w = el?.offsetWidth || PANEL_W;
      const h = el?.offsetHeight || PANEL_H;
      return {
        x: Math.min(Math.max(4, x), Math.max(4, pane.clientWidth - w - 6)),
        y: Math.min(Math.max(4, y), Math.max(4, pane.clientHeight - h - 6))
      };
    }
    function togglePalette(which) {
      paletteOpen.value = paletteOpen.value === which ? null : which;
    }
    function closePalette() {
      paletteOpen.value = null;
    }
    const menuRectColor = computed(() => {
      const m = rectMenu.value;
      if (!m) return "#2962ff";
      return drawingsStore.getFor(market.instrument).find((r) => r.id === m.id)?.color ?? "#2962ff";
    });
    const menuRectOpacity = computed(() => {
      const m = rectMenu.value;
      if (!m) return 0.3;
      return drawingsStore.getFor(market.instrument).find((r) => r.id === m.id)?.opacity ?? 0.3;
    });
    const menuRectFilled = computed(() => {
      const m = rectMenu.value;
      if (!m) return true;
      return drawingsStore.getFor(market.instrument).find((r) => r.id === m.id)?.filled !== false;
    });
    const renderTick = ref(0);
    const DASH_ARRAY = { solid: "", dashed: "9 6", dotted: "2 6" };
    const DASH_STYLES = ["solid", "dashed", "dotted"];
    const trendPixels = ref([]);
    const hitTrends = computed(() => trendPixels.value.filter((t) => t.id !== "__preview"));
    const selectedLine = ref(null);
    const linePanelPos = ref(null);
    const linePanelEl = ref(null);
    const linePaletteOpen = ref(false);
    const drawingToolActive = computed(() => drawingsStore.activeTool !== "cursor");
    const magnetActive = computed(() => drawingsStore.magnetActive);
    const snapXhair = ref(null);
    let lastPtrClient = null;
    let preSnap = null;
    watch(magnetActive, (on) => {
      if (on) {
        preSnap = null;
        if (!adapter) return;
        if (drawingState.value) {
          const d = drawingState.value;
          preSnap = { drawingObj: d, drawing: { ...d }, polyObj: null, polyCursor: null, posObj: null, pos: null };
          const s1 = snapToCandle(d.time1, d.price1, true);
          const s2 = snapToCandle(d.time2, d.price2, true);
          d.time1 = s1.time;
          d.price1 = s1.price;
          d.time2 = s2.time;
          d.price2 = s2.price;
        } else if (polyState.value) {
          preSnap = { drawingObj: null, drawing: null, polyObj: polyState.value, polyCursor: polyState.value.cursor ? { ...polyState.value.cursor } : null, posObj: null, pos: null };
          const cur = polyState.value.cursor;
          if (cur) {
            const s = snapToCandle(cur.time, cur.price, true);
            polyState.value.cursor = { time: s.time, price: s.price };
          }
        } else if (posState.value) {
          preSnap = { drawingObj: null, drawing: null, polyObj: null, polyCursor: null, posObj: posState.value, pos: { ...posState.value } };
          const s = snapToCandle(posState.value.time1, posState.value.entry, true);
          posState.value.time1 = s.time;
          posState.value.entry = s.price;
          if (posCursor.value) {
            const cs = snapToCandle(posCursor.value.time, posCursor.value.price, true);
            posCursor.value = { time: cs.time, price: cs.price };
          }
        }
        replayPointerAt(lastPtrClient);
        recalcRects();
        return;
      }
      snapXhair.value = null;
      if (preSnap) {
        if (preSnap.drawingObj && drawingState.value === preSnap.drawingObj && preSnap.drawing) {
          drawingState.value = { ...preSnap.drawing };
        }
        if (preSnap.polyObj && polyState.value === preSnap.polyObj && preSnap.polyCursor) {
          polyState.value.cursor = { ...preSnap.polyCursor };
        }
        if (preSnap.posObj && posState.value === preSnap.posObj && preSnap.pos) {
          posState.value = { ...preSnap.pos };
        }
        preSnap = null;
      }
      replayPointerAt(lastPtrClient);
      recalcRects();
    });
    function replayPointerAt(p) {
      if (!p) return;
      window.dispatchEvent(new PointerEvent("pointermove", {
        bubbles: true,
        cancelable: true,
        clientX: p.clientX,
        clientY: p.clientY,
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true,
        button: -1,
        buttons: 1
      }));
    }
    watch(drawingToolActive, (on) => adapter?.setDrawingMode(on));
    const polyPixels = ref([]);
    const hitPolys = computed(() => polyPixels.value.filter((p) => p.id !== "__preview"));
    const selectedPoly = ref(null);
    const polyPanelPos = ref(null);
    const polyPanelEl = ref(null);
    const polyPaletteOpen = ref(false);
    const polyState = ref(null);
    let lastPolyClickAt = null;
    let onPolyMoveRef = null;
    const posPixels = ref([]);
    const selectedPos = ref(null);
    const posPanelPos = ref(null);
    const posPanelEl = ref(null);
    const posPanelReady = ref(false);
    const posState = ref(null);
    const posCursor = ref(null);
    let onPosMoveRef = null;
    const fmtPrice = (v, precision) => v.toFixed(precision);
    const singlePixels = ref([]);
    const singlePanelPos = ref(null);
    const singlePanelEl = ref(null);
    const singlePanelReady = ref(false);
    function getSingle(kind, id) {
      return drawingsStore.getSingles(kind, market.instrument).find((i) => i.id === id) ?? null;
    }
    function snapToCandle(time, price, snap) {
      if (!snap || !adapter || !displayCandles.value.length) return { time, price };
      const arr = displayCandles.value;
      let lo = 0;
      let hi = arr.length - 1;
      while (hi - lo > 1) {
        const mid = lo + hi >> 1;
        if (arr[mid].time < time) lo = mid;
        else hi = mid;
      }
      const c = Math.abs(arr[lo].time - time) <= Math.abs(arr[hi].time - time) ? arr[lo] : arr[hi];
      const yP = adapter.getPriceY(price);
      const yH = adapter.getPriceY(c.high);
      const yL = adapter.getPriceY(c.low);
      if (yP === null || yH === null || yL === null) return { time, price };
      return { time: c.time, price: Math.abs(yP - yH) <= Math.abs(yP - yL) ? c.high : c.low };
    }
    const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    function fmtAxisTime(t) {
      const d = new Date(t * 1e3);
      const p2 = (n) => String(n).padStart(2, "0");
      const date = `${p2(d.getUTCDate())} ${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
      const sec = TIMEFRAME_SECONDS[market.timeframe] ?? 60;
      if (sec >= 86400) return date;
      return `${date} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
    }
    const axisRightW = ref(0);
    const axisBottomH = ref(0);
    let axisRetry = 0;
    function updateAxisSizes() {
      const c = containerRef.value;
      if (!c) return;
      let main = null;
      let area = 0;
      for (const cv of c.querySelectorAll("canvas")) {
        const r2 = cv.getBoundingClientRect();
        if (r2.width * r2.height > area) {
          area = r2.width * r2.height;
          main = cv;
        }
      }
      if (!main) return;
      const r = main.getBoundingClientRect();
      if (r.width < c.clientWidth * 0.5) {
        if (axisRetry < 60) {
          axisRetry += 1;
          requestAnimationFrame(updateAxisSizes);
        }
        return;
      }
      const rightW = Math.max(0, Math.round(c.clientWidth - r.width));
      const bottomH = Math.max(0, Math.round(c.clientHeight - r.height));
      const changed = rightW !== axisRightW.value || bottomH !== axisBottomH.value;
      axisRightW.value = rightW;
      axisBottomH.value = bottomH;
      if (changed) {
        recalcRects();
        if (axisRetry < 60) {
          axisRetry += 1;
          requestAnimationFrame(() => {
            updateAxisSizes();
            updateBadgePosition();
            recalcRects();
          });
        }
      } else {
        axisRetry = 0;
      }
    }
    function isInChartArea(e) {
      const c = containerRef.value;
      if (!c) return false;
      const r = c.getBoundingClientRect();
      const lx = e.clientX - r.left;
      const ly = e.clientY - r.top;
      return lx <= c.clientWidth - axisRightW.value && ly <= c.clientHeight - axisBottomH.value;
    }
    function recalcRects() {
      if (!adapter) {
        rectPixels.value = [];
        return;
      }
      const rects = drawingsStore.getFor(market.instrument);
      const out = [];
      const project = (x1, y1, x2, y2) => ({
        left: Math.min(x1, x2),
        top: Math.min(y1, y2),
        width: Math.max(1, Math.abs(x2 - x1)),
        height: Math.max(1, Math.abs(y2 - y1))
      });
      for (const rect of rects) {
        const x1 = adapter.timeToX(rect.time1);
        const y1 = adapter.getPriceY(rect.price1);
        const x2 = adapter.timeToX(rect.time2);
        const y2 = adapter.getPriceY(rect.price2);
        if (x1 === null || y1 === null || x2 === null || y2 === null) continue;
        out.push({
          id: rect.id,
          ...project(x1, y1, x2, y2),
          color: rect.color,
          opacity: rect.opacity,
          filled: rect.filled !== false,
          selected: drawingsStore.selectedId === rect.id
        });
      }
      if (drawingState.value && adapter && drawingsStore.activeTool === "rectangle") {
        const x1 = adapter.timeToX(drawingState.value.time1);
        const y1 = adapter.getPriceY(drawingState.value.price1);
        const x2 = adapter.timeToX(drawingState.value.time2);
        const y2 = adapter.getPriceY(drawingState.value.price2);
        if (x1 !== null && y1 !== null && x2 !== null && y2 !== null) {
          out.push({
            id: "__preview",
            ...project(x1, y1, x2, y2),
            color: "#2962ff",
            opacity: 0.15,
            filled: true,
            selected: false
          });
        }
      }
      rectPixels.value = out;
      computeSessionBoxes();
      const trendsOut = [];
      for (const ln of drawingsStore.getLinesFor(market.instrument)) {
        const x1 = adapter.timeToX(ln.time1);
        const y1 = adapter.getPriceY(ln.price1);
        const x2 = adapter.timeToX(ln.time2);
        const y2 = adapter.getPriceY(ln.price2);
        if (x1 === null || y1 === null || x2 === null || y2 === null) continue;
        trendsOut.push({
          id: ln.id,
          x1,
          y1,
          x2,
          y2,
          color: ln.color,
          width: ln.width,
          dash: ln.dash,
          selected: drawingsStore.selectedLineId === ln.id
        });
      }
      if (drawingState.value && adapter && drawingsStore.activeTool === "trendline") {
        const x1 = adapter.timeToX(drawingState.value.time1);
        const y1 = adapter.getPriceY(drawingState.value.price1);
        const x2 = adapter.timeToX(drawingState.value.time2);
        const y2 = adapter.getPriceY(drawingState.value.price2);
        if (x1 !== null && y1 !== null && x2 !== null && y2 !== null) {
          trendsOut.push({
            id: "__preview",
            x1,
            y1,
            x2,
            y2,
            color: "#2962ff",
            width: 2,
            dash: "solid",
            selected: false
          });
        }
      }
      trendPixels.value = trendsOut;
      const polysOut = [];
      const ad = adapter;
      const projectPt = (pt) => {
        const x = ad.timeToX(pt.time);
        const y = ad.getPriceY(pt.price);
        return x === null || y === null ? null : { x, y };
      };
      function simplifyPts(pts, eps) {
        if (pts.length < 3) return pts;
        const keep = new Array(pts.length).fill(false);
        keep[0] = keep[pts.length - 1] = true;
        const stack = [[0, pts.length - 1]];
        while (stack.length) {
          const [s, e] = stack.pop();
          const A = pts[s];
          const B = pts[e];
          const dx = B.x - A.x;
          const dy = B.y - A.y;
          const len = Math.hypot(dx, dy) || 1e-9;
          let maxD = 0;
          let idx = -1;
          for (let i = s + 1; i < e; i++) {
            const d = Math.abs(dy * (pts[i].x - A.x) - dx * (pts[i].y - A.y)) / len;
            if (d > maxD) {
              maxD = d;
              idx = i;
            }
          }
          if (maxD > eps && idx > 0) {
            keep[idx] = true;
            stack.push([s, idx], [idx, e]);
          }
        }
        return pts.filter((_, i) => keep[i]);
      }
      function reducePerCluster(pts, clusterPx = 5) {
        if (pts.length < 3) return pts;
        const out2 = [];
        let i = 0;
        while (i < pts.length) {
          let j = i;
          while (j + 1 < pts.length && Math.abs(pts[j + 1].x - pts[i].x) <= clusterPx) j++;
          const group = pts.slice(i, j + 1);
          if (group.length <= 4) {
            out2.push(...group);
          } else {
            let maxY = group[0];
            let minY = group[0];
            for (const p of group) {
              if (p.y > maxY.y) maxY = p;
              if (p.y < minY.y) minY = p;
            }
            const keep = /* @__PURE__ */ new Set([group[0].src, group[group.length - 1].src, maxY.src, minY.src]);
            out2.push(...group.filter((p) => keep.has(p.src)));
          }
          i = j + 1;
        }
        return out2;
      }
      const buildPolyPixel = (id, pts, color, width, dash, arrow, selected) => {
        let arrowTri = null;
        if (arrow && pts.length >= 2) {
          const tip = pts[pts.length - 1];
          const prev = pts[pts.length - 2];
          const ang = Math.atan2(tip.y - prev.y, tip.x - prev.x);
          const size = 12;
          const p1 = { x: tip.x + size * Math.cos(ang + Math.PI - 0.45), y: tip.y + size * Math.sin(ang + Math.PI - 0.45) };
          const p2 = { x: tip.x + size * Math.cos(ang + Math.PI + 0.45), y: tip.y + size * Math.sin(ang + Math.PI + 0.45) };
          arrowTri = `${tip.x},${tip.y} ${p1.x},${p1.y} ${p2.x},${p2.y}`;
        }
        return { id, pts, color, width, dash, arrowTri, selected };
      };
      for (const pl of drawingsStore.getPolysFor(market.instrument)) {
        const pts = [];
        let ok = true;
        for (let i = 0; i < pl.points.length; i++) {
          const p = projectPt(pl.points[i]);
          if (!p) {
            ok = false;
            break;
          }
          pts.push({ ...p, src: i });
        }
        if (!ok || pts.length < 2) continue;
        const simplified = reducePerCluster(simplifyPts(pts, 3));
        if (simplified.length < 2) continue;
        polysOut.push(buildPolyPixel(pl.id, simplified, pl.color, pl.width, pl.dash, pl.arrow, drawingsStore.selectedPolyId === pl.id));
      }
      if (polyState.value && adapter && drawingsStore.activeTool === "polyline") {
        const pts = [];
        let ok = true;
        for (let i = 0; i < polyState.value.points.length; i++) {
          const p = projectPt(polyState.value.points[i]);
          if (!p) {
            ok = false;
            break;
          }
          pts.push({ ...p, src: i });
        }
        const cur = polyState.value.cursor ? projectPt(polyState.value.cursor) : null;
        if (ok && cur) pts.push({ ...cur, src: pts.length });
        if (ok && cur && pts.length >= 2) {
          polysOut.push(buildPolyPixel("__preview", pts, "#2962ff", 2, "solid", false, false));
        }
      }
      polyPixels.value = polysOut;
      const posOut = [];
      const precision = instrumentPrecision(market.instrument);
      const pipSize = instrumentPipSize(market.instrument);
      const buildPosPixel = (ps) => {
        const x1 = ad.timeToX(ps.time1);
        const x2 = ad.timeToX(ps.time2);
        const entryY = ad.getPriceY(ps.entry);
        const slY = ad.getPriceY(ps.sl);
        const tpY = ad.getPriceY(ps.tp);
        if (x1 === null || x2 === null || entryY === null || slY === null || tpY === null) return null;
        const long = ps.direction !== "short";
        const risk = Math.abs(ps.entry - ps.sl);
        const rr = risk > 0 ? Math.abs(ps.tp - ps.entry) / risk : 0;
        const levels = [];
        if (ps.showLevels) {
          const dir = long ? 1 : -1;
          for (let k = 1; k <= Math.floor(rr); k++) {
            const y = ad.getPriceY(ps.entry + dir * k * risk);
            if (y !== null) levels.push({ y, r: k });
          }
        }
        return {
          id: ps.id,
          direction: ps.direction,
          left: Math.min(x1, x2),
          width: Math.max(1, Math.abs(x2 - x1)),
          entryY,
          slY,
          tpY,
          profitTop: long ? tpY : entryY,
          profitH: Math.max(1, Math.abs(entryY - tpY)),
          lossTop: long ? entryY : slY,
          lossH: Math.max(1, Math.abs(slY - entryY)),
          rr,
          slPct: (long ? ps.sl - ps.entry : ps.entry - ps.sl) / ps.entry * 100,
          tpPct: (long ? ps.tp - ps.entry : ps.entry - ps.tp) / ps.entry * 100,
          slPips: risk / pipSize,
          tpPips: Math.abs(ps.tp - ps.entry) / pipSize,
          precision,
          levels,
          selected: ps.selected,
          preview: ps.preview
        };
      };
      for (const ps of drawingsStore.getPositionsFor(market.instrument)) {
        const px = buildPosPixel({ ...ps, selected: drawingsStore.selectedPositionId === ps.id, preview: false });
        if (px) posOut.push(px);
      }
      if (posState.value && posCursor.value && drawingsStore.activeTool === "position") {
        const long = posCursor.value.price < posState.value.entry;
        const risk = Math.abs(posState.value.entry - posCursor.value.price);
        const px = buildPosPixel({
          id: "__pospreview",
          direction: long ? "long" : "short",
          time1: posState.value.time1,
          time2: posCursor.value.time,
          entry: posState.value.entry,
          sl: posCursor.value.price,
          tp: posState.value.entry + (long ? 1 : -1) * 3 * risk,
          // default R:R 1:3
          showLevels: false,
          selected: false,
          preview: true
        });
        if (px) posOut.push(px);
      }
      posPixels.value = posOut;
      const sel1 = drawingsStore.selectedSingle;
      const singleOut = [];
      const chartW1 = ad ? containerRef.value.clientWidth - axisRightW.value : 0;
      const chartH1 = ad ? containerRef.value.clientHeight - axisBottomH.value : 0;
      for (const kind of ["hline", "hray", "vline"]) {
        for (const it of drawingsStore.getSingles(kind, market.instrument)) {
          const selected = sel1?.kind === kind && sel1.id === it.id;
          if (kind === "vline") {
            const x = ad.timeToX(it.time);
            if (x === null) continue;
            singleOut.push({ id: it.id, kind, x, y: 0, hx: x, hy: chartH1 / 2, time: it.time, price: 0, color: it.color, dash: it.dash, width: it.width, selected });
          } else {
            const y = ad.getPriceY(it.price);
            if (y === null) continue;
            const t = kind === "hray" ? it.time : 0;
            const x = kind === "hray" ? ad.timeToX(t) ?? 0 : chartW1 / 2;
            singleOut.push({ id: it.id, kind, x, y, hx: x, hy: y, time: t, price: it.price, color: it.color, dash: it.dash, width: it.width, selected });
          }
        }
      }
      singlePixels.value = singleOut;
      rebuildDemoLines();
      if (containerRef.value) {
        demoChartH.value = containerRef.value.clientHeight - axisBottomH.value;
      }
      const replayT = replay.picking ? pickTime.value : replay.cutoff;
      replayVlX.value = replay.active && replayT !== null ? ad.timeToX(replayT) ?? null : null;
      if (replay.active && !replay.picking && displayCandles.value.length) {
        const lastC = displayCandles.value[displayCandles.value.length - 1];
        const y = ad.getPriceY(lastC.close);
        const lh = adapter.getPriceLabelHeight();
        replayTag.value = y !== null ? { y: y + lh / 2 + 1, text: lastC.close.toFixed(instrumentPrecision(market.instrument)) } : null;
      } else {
        replayTag.value = null;
      }
      if (selectedRect.value && editPanelPos.value) positionEditPanel(selectedRect.value.id);
      if (selectedLine.value && linePanelPos.value) positionLinePanel(selectedLine.value.id);
      if (selectedPoly.value && polyPanelPos.value) positionPolyPanel(selectedPoly.value.id);
      if (selectedPos.value && posPanelPos.value) positionPosPanel(selectedPos.value.id);
      const selS = drawingsStore.selectedSingle;
      if (selS && singlePanelPos.value) positionSinglePanel(selS.kind, selS.id);
    }
    function recalcFrame() {
      recalcRaf = 0;
      updateBadgePosition();
      recalcRects();
      if (hasUnprojectedDrawings() && performance.now() < loadSettleDeadline) {
        recalcDeadline = Math.max(recalcDeadline, performance.now() + 60);
      }
      if (pointerHeld || performance.now() < recalcDeadline) {
        recalcRaf = requestAnimationFrame(recalcFrame);
      }
    }
    function hasUnprojectedDrawings() {
      const stored = drawingsStore.getFor(market.instrument).length + drawingsStore.getLinesFor(market.instrument).length + drawingsStore.getPolysFor(market.instrument).length + drawingsStore.getPositionsFor(market.instrument).length + drawingsStore.getSingles("hline", market.instrument).length + drawingsStore.getSingles("hray", market.instrument).length + drawingsStore.getSingles("vline", market.instrument).length;
      if (stored === 0) return false;
      const rendered = rectPixels.value.filter((r) => r.id !== "__preview").length + trendPixels.value.filter((t) => t.id !== "__preview").length + polyPixels.value.filter((p) => p.id !== "__preview").length + posPixels.value.filter((p) => p.id !== "__pospreview").length + singlePixels.value.length;
      return rendered < stored;
    }
    function extendRecalcFrames(ms) {
      recalcDeadline = Math.max(recalcDeadline, performance.now() + ms);
      if (!recalcRaf) recalcRaf = requestAnimationFrame(recalcFrame);
    }
    function beginDraw(e) {
      if (!adapter || !containerRef.value) return;
      const crect = containerRef.value.getBoundingClientRect();
      const x = e.clientX - crect.left;
      const y = e.clientY - crect.top;
      const time = adapter.xToTime(x);
      const price = adapter.yToPrice(y);
      if (time === null || price === null) return;
      const s1 = snapToCandle(time, price, magnetActive.value);
      drawingState.value = { time1: s1.time, price1: s1.price, time2: s1.time, price2: s1.price };
      const startX = e.clientX;
      const startY = e.clientY;
      recalcRects();
      const move = (ev) => {
        if (!drawingState.value || !adapter || !containerRef.value) return;
        const r = containerRef.value.getBoundingClientRect();
        const mx = ev.clientX - r.left;
        const my = ev.clientY - r.top;
        const t = adapter.xToTime(mx);
        const p = adapter.yToPrice(my);
        if (t !== null && p !== null) {
          const s2 = snapToCandle(t, p, magnetActive.value);
          drawingState.value.time2 = s2.time;
          drawingState.value.price2 = s2.price;
        }
        recalcRects();
      };
      function stopMove() {
        window.removeEventListener("pointermove", move);
        if (onMouseMoveRef === move) onMouseMoveRef = null;
      }
      const up = (ev) => {
        window.removeEventListener("pointerup", up);
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 4) {
          stopMove();
          finalizeDraw();
        }
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      onMouseMoveRef = move;
    }
    function finalizeDraw() {
      const d = drawingState.value;
      drawingState.value = null;
      if (onMouseMoveRef) {
        window.removeEventListener("pointermove", onMouseMoveRef);
        onMouseMoveRef = null;
      }
      if (d && (Math.abs(d.time2 - d.time1) >= 1 || Math.abs(d.price2 - d.price1) > 0)) {
        if (drawingsStore.activeTool === "trendline") {
          drawingsStore.addLine(market.instrument, {
            time1: d.time1,
            price1: d.price1,
            time2: d.time2,
            price2: d.price2
          });
        } else {
          drawingsStore.add(market.instrument, {
            time1: Math.min(d.time1, d.time2),
            price1: Math.min(d.price1, d.price2),
            time2: Math.max(d.time1, d.time2),
            price2: Math.max(d.price1, d.price2)
          });
        }
      }
      drawingsStore.activeTool = "cursor";
      recalcRects();
    }
    function cancelDraw() {
      const had = drawingState.value !== null || polyState.value !== null || posState.value !== null;
      drawingState.value = null;
      polyState.value = null;
      posState.value = null;
      posCursor.value = null;
      stopPosCursor();
      stopPolyPreview();
      if (onMouseMoveRef) {
        window.removeEventListener("pointermove", onMouseMoveRef);
        onMouseMoveRef = null;
      }
      if (had) recalcRects();
    }
    function startPolyPreview() {
      stopPolyPreview();
      const move = (ev) => {
        if (!polyState.value || !adapter || !containerRef.value) return;
        const r = containerRef.value.getBoundingClientRect();
        const t = adapter.xToTime(ev.clientX - r.left);
        const p = adapter.yToPrice(ev.clientY - r.top);
        if (t !== null && p !== null) {
          const s = snapToCandle(t, p, magnetActive.value);
          polyState.value.cursor = { time: s.time, price: s.price };
        }
        recalcRects();
      };
      window.addEventListener("pointermove", move);
      onPolyMoveRef = move;
    }
    function stopPolyPreview() {
      if (onPolyMoveRef) {
        window.removeEventListener("pointermove", onPolyMoveRef);
        onPolyMoveRef = null;
      }
    }
    function handlePolyClick(e) {
      if (!adapter || !containerRef.value) return;
      const r = containerRef.value.getBoundingClientRect();
      const t = adapter.xToTime(e.clientX - r.left);
      const p = adapter.yToPrice(e.clientY - r.top);
      if (t === null || p === null) return;
      const s = snapToCandle(t, p, magnetActive.value);
      const pt = { time: s.time, price: s.price };
      if (!polyState.value) {
        polyState.value = { points: [pt], cursor: pt };
        lastPolyClickAt = { x: e.clientX, y: e.clientY, at: performance.now() };
        startPolyPreview();
        recalcRects();
        return;
      }
      if (lastPolyClickAt && Math.hypot(e.clientX - lastPolyClickAt.x, e.clientY - lastPolyClickAt.y) < 6) {
        if (performance.now() - lastPolyClickAt.at < 400) {
          finalizePoly();
        }
        return;
      }
      lastPolyClickAt = { x: e.clientX, y: e.clientY, at: performance.now() };
      polyState.value.points.push(pt);
      polyState.value.cursor = pt;
      recalcRects();
    }
    function finalizePoly() {
      const st = polyState.value;
      polyState.value = null;
      stopPolyPreview();
      if (st && st.points.length >= 2) {
        drawingsStore.addPoly(market.instrument, { points: st.points });
      }
      drawingsStore.activeTool = "cursor";
      recalcRects();
    }
    let onMouseMoveRef = null;
    function onRectClick(id, e) {
      e.stopPropagation();
      rectMenu.value = null;
      closePalette();
      clearSingleSelection();
      if (drawingsStore.activeTool !== "cursor") {
        drawingsStore.activeTool = "cursor";
      }
      drawingsStore.selectedId = id;
      selectedRect.value = drawingsStore.getFor(market.instrument).find((r) => r.id === id) ?? null;
      recalcRects();
      positionEditPanel(id);
    }
    function positionEditPanel(id) {
      const pixel = rectPixels.value.find((r) => r.id === id);
      const pane = containerRef.value;
      if (!pixel || !pane) return;
      editPanelPos.value = computePanelPos(pixel, pane);
      if (!editPanelEl.value) {
        void nextTick(() => {
          const sel = selectedRect.value;
          if (!editPanelEl.value || !sel || !containerRef.value) return;
          const px = rectPixels.value.find((r) => r.id === sel.id);
          if (px) editPanelPos.value = computePanelPos(px, containerRef.value);
        });
      }
    }
    function computePanelPos(pixel, pane) {
      const w = editPanelEl.value?.offsetWidth || PANEL_W;
      const h = editPanelEl.value?.offsetHeight || PANEL_H;
      const gap = 8;
      let x = pixel.left + pixel.width - w;
      let y = pixel.top - h - gap;
      if (y < 4) y = pixel.top + pixel.height + gap;
      x = Math.min(Math.max(4, x), Math.max(4, pane.clientWidth - w - 6));
      y = Math.min(Math.max(4, y), Math.max(4, pane.clientHeight - h - 6));
      return { x, y };
    }
    function onRectDragStart(e, id) {
      if (e.button !== 0 || drawingsStore.activeTool !== "cursor") return;
      if (!adapter || !containerRef.value) return;
      const rect = drawingsStore.getFor(market.instrument).find((r) => r.id === id);
      if (!rect) return;
      e.preventDefault();
      e.stopPropagation();
      rectMenu.value = null;
      closePalette();
      clearSingleSelection();
      const rGuard = containerRef.value.getBoundingClientRect();
      const px = e.clientX - rGuard.left;
      const py = e.clientY - rGuard.top;
      const pixel = rectPixels.value.find((r) => r.id === id);
      if (pixel?.selected) {
        const near = 9;
        const withinY = py >= pixel.top - near && py <= pixel.top + pixel.height + near;
        if (withinY && Math.abs(px - pixel.left) <= near) {
          onResizeStart(e, "w");
          return;
        }
        if (withinY && Math.abs(px - (pixel.left + pixel.width)) <= near) {
          onResizeStart(e, "e");
          return;
        }
      }
      drawingsStore.selectedId = id;
      selectedRect.value = rect;
      recalcRects();
      positionEditPanel(id);
      const r0 = containerRef.value.getBoundingClientRect();
      const startT = adapter.xToTime(e.clientX - r0.left);
      const startP = adapter.yToPrice(e.clientY - r0.top);
      if (startT === null || startP === null) return;
      const orig = { time1: rect.time1, price1: rect.price1, time2: rect.time2, price2: rect.price2 };
      const onMove = (ev) => {
        if (!adapter || !containerRef.value) return;
        const r = containerRef.value.getBoundingClientRect();
        const t = adapter.xToTime(ev.clientX - r.left);
        const p = adapter.yToPrice(ev.clientY - r.top);
        if (t === null || p === null) return;
        const dt = t - startT;
        const dp = p - startP;
        drawingsStore.updateRect(market.instrument, id, {
          time1: orig.time1 + dt,
          time2: orig.time2 + dt,
          price1: orig.price1 + dp,
          price2: orig.price2 + dp
        });
        const updated = drawingsStore.getFor(market.instrument).find((x) => x.id === id);
        if (updated) selectedRect.value = updated;
        recalcRects();
        positionEditPanel(id);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    }
    function onChartClick() {
      if (rectMenu.value) rectMenu.value = null;
      closePalette();
      if (drawingsStore.activeTool === "cursor" && drawingsStore.selectedId) {
        drawingsStore.selectedId = null;
        selectedRect.value = null;
        editPanelPos.value = null;
        recalcRects();
      }
      if (drawingsStore.activeTool === "cursor" && (drawingsStore.selectedLineId || selectedLine.value)) {
        drawingsStore.selectedLineId = null;
        selectedLine.value = null;
        linePanelPos.value = null;
        linePaletteOpen.value = false;
        recalcRects();
      }
      if (drawingsStore.activeTool === "cursor" && (drawingsStore.selectedPolyId || selectedPoly.value)) {
        drawingsStore.selectedPolyId = null;
        selectedPoly.value = null;
        polyPanelPos.value = null;
        polyPaletteOpen.value = false;
        recalcRects();
      }
      if (drawingsStore.activeTool === "cursor" && (drawingsStore.selectedPositionId || selectedPos.value)) {
        drawingsStore.selectedPositionId = null;
        selectedPos.value = null;
        posPanelPos.value = null;
        recalcRects();
      }
      if (drawingsStore.activeTool === "cursor" && drawingsStore.selectedSingle) {
        drawingsStore.selectedSingle = null;
        singlePanelPos.value = null;
        recalcRects();
      }
    }
    function deleteSelected() {
      if (!selectedRect.value) return;
      drawingsStore.remove(market.instrument, selectedRect.value.id);
      selectedRect.value = null;
      editPanelPos.value = null;
      rectMenu.value = null;
      closePalette();
      recalcRects();
    }
    function setColorInMenu(color) {
      const menu = rectMenu.value;
      if (!menu) return;
      drawingsStore.updateStyle(market.instrument, menu.id, { color });
      if (selectedRect.value?.id === menu.id) syncSelected();
      else recalcRects();
    }
    function setOpacityInMenu(opacity) {
      const menu = rectMenu.value;
      if (!menu) return;
      drawingsStore.updateStyle(market.instrument, menu.id, { opacity });
      if (selectedRect.value?.id === menu.id) syncSelected();
      else recalcRects();
    }
    function toggleFillInMenu() {
      const menu = rectMenu.value;
      if (!menu) return;
      const rect = drawingsStore.getFor(market.instrument).find((r) => r.id === menu.id);
      if (!rect) return;
      drawingsStore.updateStyle(market.instrument, menu.id, { filled: rect.filled === false });
      if (selectedRect.value?.id === menu.id) syncSelected();
      else recalcRects();
    }
    function deleteFromMenu() {
      const menu = rectMenu.value;
      if (!menu) return;
      drawingsStore.remove(market.instrument, menu.id);
      if (selectedRect.value?.id === menu.id) {
        selectedRect.value = null;
        editPanelPos.value = null;
      }
      rectMenu.value = null;
      closePalette();
      recalcRects();
    }
    function setColorSelected(color) {
      if (!selectedRect.value) return;
      drawingsStore.updateStyle(market.instrument, selectedRect.value.id, { color });
      syncSelected();
    }
    function setOpacitySelected(opacity) {
      if (!selectedRect.value) return;
      drawingsStore.updateStyle(market.instrument, selectedRect.value.id, { opacity });
      syncSelected();
    }
    function toggleFillSelected() {
      if (!selectedRect.value) return;
      drawingsStore.updateStyle(market.instrument, selectedRect.value.id, {
        filled: selectedRect.value.filled === false
      });
      syncSelected();
    }
    function syncSelected() {
      if (!selectedRect.value) return;
      const updated = drawingsStore.getFor(market.instrument).find((r) => r.id === selectedRect.value.id);
      if (updated) selectedRect.value = updated;
      recalcRects();
    }
    function onResizeStart(e, handle) {
      if (!selectedRect.value || !adapter || !containerRef.value) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = { ...selectedRect.value };
      rectMenu.value = null;
      const edgeTime = handle.includes("e") ? rect.time1 > rect.time2 ? "time1" : "time2" : handle.includes("w") ? rect.time1 > rect.time2 ? "time2" : "time1" : null;
      const edgePrice = handle.includes("n") ? rect.price1 > rect.price2 ? "price1" : "price2" : handle.includes("s") ? rect.price1 > rect.price2 ? "price2" : "price1" : null;
      const onMove = (ev) => {
        if (!adapter || !containerRef.value) return;
        const r = containerRef.value.getBoundingClientRect();
        const mx = ev.clientX - r.left;
        const my = ev.clientY - r.top;
        const t = adapter.xToTime(mx);
        const p = adapter.yToPrice(my);
        if (t === null || p === null) return;
        const s = snapToCandle(t, p, magnetActive.value);
        const newRect = {};
        if (edgeTime) newRect[edgeTime] = s.time;
        if (edgePrice) newRect[edgePrice] = s.price;
        drawingsStore.updateRect(market.instrument, rect.id, newRect);
        const updated = drawingsStore.getFor(market.instrument).find((r2) => r2.id === rect.id);
        if (updated) selectedRect.value = updated;
        recalcRects();
        positionEditPanel(rect.id);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    }
    function onTrendClick(id, e) {
      e.stopPropagation();
      rectMenu.value = null;
      closePalette();
      linePaletteOpen.value = false;
      clearSingleSelection();
      if (drawingsStore.activeTool !== "cursor") {
        drawingsStore.activeTool = "cursor";
      }
      drawingsStore.selectedId = null;
      selectedRect.value = null;
      editPanelPos.value = null;
      drawingsStore.selectedLineId = id;
      selectedLine.value = drawingsStore.getLinesFor(market.instrument).find((l) => l.id === id) ?? null;
      recalcRects();
      positionLinePanel(id);
    }
    function positionLinePanel(id) {
      const px = trendPixels.value.find((t) => t.id === id);
      const pane = containerRef.value;
      if (!px || !pane) return;
      linePanelPos.value = computeLinePanelPos(px, pane);
      if (!linePanelEl.value) {
        void nextTick(() => {
          const sel = selectedLine.value;
          if (!linePanelEl.value || !sel || !containerRef.value) return;
          const p = trendPixels.value.find((t) => t.id === sel.id);
          if (p) linePanelPos.value = computeLinePanelPos(p, containerRef.value);
        });
      }
    }
    function computeLinePanelPos(pixel, pane) {
      const w = linePanelEl.value?.offsetWidth || PANEL_W;
      const h = linePanelEl.value?.offsetHeight || PANEL_H;
      const gap = 8;
      const atStart = pixel.x1 >= pixel.x2;
      const ex = atStart ? pixel.x1 : pixel.x2;
      const ey = atStart ? pixel.y1 : pixel.y2;
      let x = ex + gap;
      let y = ey - h - gap;
      if (x + w > pane.clientWidth - 6) x = ex - w - gap;
      if (y < 4) y = ey + gap;
      x = Math.min(Math.max(4, x), Math.max(4, pane.clientWidth - w - 6));
      y = Math.min(Math.max(4, y), Math.max(4, pane.clientHeight - h - 6));
      return { x, y };
    }
    function onTrendDragStart(e, id) {
      if (e.button !== 0 || drawingsStore.activeTool !== "cursor") return;
      if (!adapter || !containerRef.value) return;
      const line = drawingsStore.getLinesFor(market.instrument).find((l) => l.id === id);
      if (!line) return;
      e.preventDefault();
      e.stopPropagation();
      rectMenu.value = null;
      closePalette();
      clearSingleSelection();
      drawingsStore.selectedId = null;
      selectedRect.value = null;
      editPanelPos.value = null;
      drawingsStore.selectedLineId = id;
      selectedLine.value = line;
      recalcRects();
      positionLinePanel(id);
      const r0 = containerRef.value.getBoundingClientRect();
      const startT = adapter.xToTime(e.clientX - r0.left);
      const startP = adapter.yToPrice(e.clientY - r0.top);
      if (startT === null || startP === null) return;
      const orig = { time1: line.time1, price1: line.price1, time2: line.time2, price2: line.price2 };
      const onMove = (ev) => {
        if (!adapter || !containerRef.value) return;
        const r = containerRef.value.getBoundingClientRect();
        const t = adapter.xToTime(ev.clientX - r.left);
        const p = adapter.yToPrice(ev.clientY - r.top);
        if (t === null || p === null) return;
        const dt = t - startT;
        const dp = p - startP;
        drawingsStore.updateLine(market.instrument, id, {
          time1: orig.time1 + dt,
          price1: orig.price1 + dp,
          time2: orig.time2 + dt,
          price2: orig.price2 + dp
        });
        const updated = drawingsStore.getLinesFor(market.instrument).find((x) => x.id === id);
        if (updated) selectedLine.value = updated;
        recalcRects();
        positionLinePanel(id);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    }
    function onTrendHandleStart(e, id, which) {
      if (e.button !== 0 || !adapter || !containerRef.value) return;
      e.preventDefault();
      e.stopPropagation();
      rectMenu.value = null;
      closePalette();
      const onMove = (ev) => {
        if (!adapter || !containerRef.value) return;
        const r = containerRef.value.getBoundingClientRect();
        const t = adapter.xToTime(ev.clientX - r.left);
        const p = adapter.yToPrice(ev.clientY - r.top);
        if (t === null || p === null) return;
        const s = snapToCandle(t, p, magnetActive.value);
        drawingsStore.updateLine(market.instrument, id, which === 1 ? { time1: s.time, price1: s.price } : { time2: s.time, price2: s.price });
        const updated = drawingsStore.getLinesFor(market.instrument).find((x) => x.id === id);
        if (updated) selectedLine.value = updated;
        recalcRects();
        positionLinePanel(id);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    }
    function deleteSelectedLine() {
      if (!selectedLine.value) return;
      drawingsStore.removeLine(market.instrument, selectedLine.value.id);
      selectedLine.value = null;
      linePanelPos.value = null;
      linePaletteOpen.value = false;
      recalcRects();
    }
    function setLineColorSelected(color) {
      if (!selectedLine.value) return;
      drawingsStore.updateLineStyle(market.instrument, selectedLine.value.id, { color });
      syncSelectedLine();
    }
    function setLineDashSelected(dash) {
      if (!selectedLine.value) return;
      drawingsStore.updateLineStyle(market.instrument, selectedLine.value.id, { dash });
      syncSelectedLine();
    }
    function syncSelectedLine() {
      if (!selectedLine.value) return;
      const updated = drawingsStore.getLinesFor(market.instrument).find((l) => l.id === selectedLine.value.id);
      if (updated) selectedLine.value = updated;
      recalcRects();
    }
    function onPolyClick(id, e) {
      e.stopPropagation();
      rectMenu.value = null;
      closePalette();
      polyPaletteOpen.value = false;
      linePaletteOpen.value = false;
      clearSingleSelection();
      if (drawingsStore.activeTool !== "cursor") {
        drawingsStore.activeTool = "cursor";
      }
      drawingsStore.selectedId = null;
      selectedRect.value = null;
      editPanelPos.value = null;
      drawingsStore.selectedLineId = null;
      selectedLine.value = null;
      linePanelPos.value = null;
      drawingsStore.selectedPolyId = id;
      selectedPoly.value = drawingsStore.getPolysFor(market.instrument).find((p) => p.id === id) ?? null;
      recalcRects();
      positionPolyPanel(id);
    }
    function positionPolyPanel(id) {
      const px = polyPixels.value.find((p) => p.id === id);
      const pane = containerRef.value;
      if (!px || !pane) return;
      const corner = px.pts[px.pts.length - 1];
      polyPanelPos.value = computeCornerPanelPos(corner.x, corner.y, pane, polyPanelEl.value);
      if (!polyPanelEl.value) {
        void nextTick(() => {
          const sel = selectedPoly.value;
          if (!polyPanelEl.value || !sel || !containerRef.value) return;
          const p = polyPixels.value.find((q) => q.id === sel.id);
          if (p) {
            const c = p.pts[p.pts.length - 1];
            polyPanelPos.value = computeCornerPanelPos(c.x, c.y, containerRef.value, polyPanelEl.value);
          }
        });
      }
    }
    function computeCornerPanelPos(ex, ey, pane, el, forceW, forceH) {
      const w = forceW != null ? forceW : el?.offsetWidth || PANEL_W;
      const h = forceH != null ? forceH : el?.offsetHeight || PANEL_H;
      const gap = 8;
      let x = ex + gap;
      let y = ey - h - gap;
      if (x + w > pane.clientWidth - 6) x = ex - w - gap;
      if (y < 4) y = ey + gap;
      x = Math.min(Math.max(4, x), Math.max(4, pane.clientWidth - w - 6));
      y = Math.min(Math.max(4, y), Math.max(4, pane.clientHeight - h - 6));
      return { x, y };
    }
    function onPolyDragStart(e, id) {
      if (e.button !== 0 || drawingsStore.activeTool !== "cursor") return;
      if (!adapter || !containerRef.value) return;
      const poly = drawingsStore.getPolysFor(market.instrument).find((p) => p.id === id);
      if (!poly) return;
      e.preventDefault();
      e.stopPropagation();
      rectMenu.value = null;
      closePalette();
      clearSingleSelection();
      drawingsStore.selectedId = null;
      selectedRect.value = null;
      editPanelPos.value = null;
      drawingsStore.selectedLineId = null;
      selectedLine.value = null;
      linePanelPos.value = null;
      drawingsStore.selectedPolyId = id;
      selectedPoly.value = poly;
      recalcRects();
      positionPolyPanel(id);
      const r0 = containerRef.value.getBoundingClientRect();
      const startT = adapter.xToTime(e.clientX - r0.left);
      const startP = adapter.yToPrice(e.clientY - r0.top);
      if (startT === null || startP === null) return;
      const orig = poly.points.map((pt) => ({ ...pt }));
      const onMove = (ev) => {
        if (!adapter || !containerRef.value) return;
        const r = containerRef.value.getBoundingClientRect();
        const t = adapter.xToTime(ev.clientX - r.left);
        const p = adapter.yToPrice(ev.clientY - r.top);
        if (t === null || p === null) return;
        const dt = t - startT;
        const dp = p - startP;
        drawingsStore.updatePolyPoints(
          market.instrument,
          id,
          orig.map((pt) => ({ time: pt.time + dt, price: pt.price + dp }))
        );
        const updated = drawingsStore.getPolysFor(market.instrument).find((x) => x.id === id);
        if (updated) selectedPoly.value = updated;
        recalcRects();
        positionPolyPanel(id);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    }
    function onPolyVertexStart(e, id, index) {
      if (e.button !== 0 || !adapter || !containerRef.value) return;
      e.preventDefault();
      e.stopPropagation();
      rectMenu.value = null;
      closePalette();
      const onMove = (ev) => {
        if (!adapter || !containerRef.value) return;
        const r = containerRef.value.getBoundingClientRect();
        const t = adapter.xToTime(ev.clientX - r.left);
        const p = adapter.yToPrice(ev.clientY - r.top);
        if (t === null || p === null) return;
        const s = snapToCandle(t, p, magnetActive.value);
        const poly = drawingsStore.getPolysFor(market.instrument).find((x) => x.id === id);
        if (!poly || !poly.points[index]) return;
        const next = poly.points.map((pt, i) => i === index ? { time: s.time, price: s.price } : { ...pt });
        drawingsStore.updatePolyPoints(market.instrument, id, next);
        const updated = drawingsStore.getPolysFor(market.instrument).find((x) => x.id === id);
        if (updated) selectedPoly.value = updated;
        recalcRects();
        positionPolyPanel(id);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    }
    function deleteSelectedPoly() {
      if (!selectedPoly.value) return;
      drawingsStore.removePoly(market.instrument, selectedPoly.value.id);
      selectedPoly.value = null;
      polyPanelPos.value = null;
      polyPaletteOpen.value = false;
      recalcRects();
    }
    function setPolyColorSelected(color) {
      if (!selectedPoly.value) return;
      drawingsStore.updatePolyStyle(market.instrument, selectedPoly.value.id, { color });
      syncSelectedPoly();
    }
    function setPolyDashSelected(dash) {
      if (!selectedPoly.value) return;
      drawingsStore.updatePolyStyle(market.instrument, selectedPoly.value.id, { dash });
      syncSelectedPoly();
    }
    function toggleArrowSelected() {
      if (!selectedPoly.value) return;
      drawingsStore.updatePolyStyle(market.instrument, selectedPoly.value.id, {
        arrow: selectedPoly.value.arrow === false
      });
      syncSelectedPoly();
    }
    function syncSelectedPoly() {
      if (!selectedPoly.value) return;
      const updated = drawingsStore.getPolysFor(market.instrument).find((p) => p.id === selectedPoly.value.id);
      if (updated) selectedPoly.value = updated;
      recalcRects();
    }
    function beginPos(e) {
      if (!adapter || !containerRef.value) return;
      const r = containerRef.value.getBoundingClientRect();
      const t = adapter.xToTime(e.clientX - r.left);
      const p = adapter.yToPrice(e.clientY - r.top);
      if (t === null || p === null) return;
      const s = snapToCandle(t, p, magnetActive.value);
      posState.value = { time1: s.time, entry: s.price };
      posCursor.value = { time: s.time, price: s.price };
      recalcRects();
      stopPosCursor();
      const move = (ev) => {
        if (!posState.value || !adapter || !containerRef.value) return;
        const rr = containerRef.value.getBoundingClientRect();
        const ct = adapter.xToTime(ev.clientX - rr.left);
        const cp = adapter.yToPrice(ev.clientY - rr.top);
        if (ct !== null && cp !== null) {
          const cs = snapToCandle(ct, cp, magnetActive.value);
          posCursor.value = { time: cs.time, price: cs.price };
        }
        recalcRects();
      };
      window.addEventListener("pointermove", move);
      onPosMoveRef = move;
    }
    function stopPosCursor() {
      if (onPosMoveRef) {
        window.removeEventListener("pointermove", onPosMoveRef);
        onPosMoveRef = null;
      }
    }
    function finalizePos(e) {
      if (!adapter || !containerRef.value) return;
      const st = posState.value;
      posState.value = null;
      posCursor.value = null;
      stopPosCursor();
      if (st) {
        const r = containerRef.value.getBoundingClientRect();
        const t = adapter.xToTime(e.clientX - r.left);
        const p = adapter.yToPrice(e.clientY - r.top);
        if (t !== null && p !== null) {
          const s = snapToCandle(t, p, magnetActive.value);
          if (Math.abs(s.price - st.entry) > 0) {
            const long = s.price < st.entry;
            const risk = Math.abs(st.entry - s.price);
            drawingsStore.addPosition(market.instrument, {
              direction: long ? "long" : "short",
              time1: st.time1,
              time2: s.time,
              entry: st.entry,
              sl: s.price,
              tp: st.entry + (long ? 1 : -1) * 3 * risk
              // default R:R 1:3
            });
          }
        }
      }
      drawingsStore.activeTool = "cursor";
      recalcRects();
    }
    function onPosClick(id, e) {
      e.stopPropagation();
      rectMenu.value = null;
      closePalette();
      clearSingleSelection();
      if (drawingsStore.activeTool !== "cursor") drawingsStore.activeTool = "cursor";
      drawingsStore.selectedId = null;
      selectedRect.value = null;
      editPanelPos.value = null;
      drawingsStore.selectedLineId = null;
      selectedLine.value = null;
      linePanelPos.value = null;
      drawingsStore.selectedPolyId = null;
      selectedPoly.value = null;
      polyPanelPos.value = null;
      drawingsStore.selectedPositionId = id;
      selectedPos.value = drawingsStore.getPositionsFor(market.instrument).find((p) => p.id === id) ?? null;
      recalcRects();
      positionPosPanel(id);
    }
    let posPanelW = 0;
    let posPanelH = 0;
    function positionPosPanel(id) {
      const px = posPixels.value.find((p) => p.id === id);
      const pane = containerRef.value;
      if (!px || !pane) return;
      const topY = Math.min(px.tpY, px.entryY);
      const anchorY = px.width >= 140 ? topY : topY - 35;
      const place = () => {
        const p2 = posPixels.value.find((q) => q.id === id);
        if (!p2 || !containerRef.value) return;
        const t2 = Math.min(p2.tpY, p2.entryY);
        posPanelPos.value = computeCornerPanelPos(
          p2.left + p2.width,
          p2.width >= 140 ? t2 : t2 - 35,
          containerRef.value,
          posPanelEl.value,
          posPanelW || void 0,
          posPanelH || void 0
        );
      };
      posPanelPos.value = computeCornerPanelPos(
        px.left + px.width,
        anchorY,
        pane,
        posPanelEl.value,
        posPanelW || void 0,
        posPanelH || void 0
      );
      if (!posPanelEl.value) {
        posPanelReady.value = false;
        void nextTick(() => {
          if (!posPanelEl.value) return;
          posPanelW = posPanelEl.value.offsetWidth;
          posPanelH = posPanelEl.value.offsetHeight;
          place();
          posPanelReady.value = true;
        });
      } else {
        posPanelW = posPanelEl.value.offsetWidth;
        posPanelH = posPanelEl.value.offsetHeight;
        posPanelReady.value = true;
      }
    }
    function clampPosPrice(cur, which, price) {
      const long = cur.direction !== "short";
      if (which === "sl") return long ? Math.min(price, cur.entry) : Math.max(price, cur.entry);
      if (which === "tp") return long ? Math.max(price, cur.entry) : Math.min(price, cur.entry);
      const lo = Math.min(cur.sl, cur.tp);
      const hi = Math.max(cur.sl, cur.tp);
      return Math.min(Math.max(price, lo), hi);
    }
    function onPosLevelStart(e, id, which) {
      if (e.button !== 0 || !adapter || !containerRef.value) return;
      e.preventDefault();
      e.stopPropagation();
      rectMenu.value = null;
      closePalette();
      const onMove = (ev) => {
        if (!adapter || !containerRef.value) return;
        const r = containerRef.value.getBoundingClientRect();
        const t = adapter.xToTime(ev.clientX - r.left);
        const p = adapter.yToPrice(ev.clientY - r.top);
        if (t === null || p === null) return;
        const sp = snapToCandle(t, p, magnetActive.value).price;
        const cur = drawingsStore.getPositionsFor(market.instrument).find((x) => x.id === id);
        const price = cur ? clampPosPrice(cur, which, sp) : sp;
        drawingsStore.updatePosition(market.instrument, id, { [which]: price });
        const updated = drawingsStore.getPositionsFor(market.instrument).find((x) => x.id === id);
        if (updated) selectedPos.value = updated;
        recalcRects();
        positionPosPanel(id);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    }
    function onPosEdgeStart(e, id, which) {
      if (e.button !== 0 || !adapter || !containerRef.value) return;
      e.preventDefault();
      e.stopPropagation();
      rectMenu.value = null;
      closePalette();
      const onMove = (ev) => {
        if (!adapter || !containerRef.value) return;
        const r = containerRef.value.getBoundingClientRect();
        const t = adapter.xToTime(ev.clientX - r.left);
        if (t === null) return;
        const p = adapter.yToPrice(ev.clientY - r.top);
        const st = p !== null ? snapToCandle(t, p, magnetActive.value) : null;
        drawingsStore.updatePosition(market.instrument, id, { [which]: st ? st.time : t });
        const updated = drawingsStore.getPositionsFor(market.instrument).find((x) => x.id === id);
        if (updated) selectedPos.value = updated;
        recalcRects();
        positionPosPanel(id);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    }
    function onPosCornerStart(e, id, which, side) {
      if (e.button !== 0 || !adapter || !containerRef.value) return;
      e.preventDefault();
      e.stopPropagation();
      rectMenu.value = null;
      closePalette();
      const onMove = (ev) => {
        if (!adapter || !containerRef.value) return;
        const r = containerRef.value.getBoundingClientRect();
        const t = adapter.xToTime(ev.clientX - r.left);
        const p = adapter.yToPrice(ev.clientY - r.top);
        if (t === null || p === null) return;
        const s = snapToCandle(t, p, magnetActive.value);
        const cur = drawingsStore.getPositionsFor(market.instrument).find((x) => x.id === id);
        const price = cur ? clampPosPrice(cur, which, s.price) : s.price;
        drawingsStore.updatePosition(market.instrument, id, { [which]: price, [side]: s.time });
        const updated = drawingsStore.getPositionsFor(market.instrument).find((x) => x.id === id);
        if (updated) selectedPos.value = updated;
        recalcRects();
        positionPosPanel(id);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    }
    function onPosDragStart(e, id) {
      if (e.button !== 0 || drawingsStore.activeTool !== "cursor") return;
      if (!adapter || !containerRef.value) return;
      const pos = drawingsStore.getPositionsFor(market.instrument).find((p) => p.id === id);
      if (!pos) return;
      e.preventDefault();
      e.stopPropagation();
      rectMenu.value = null;
      closePalette();
      void onPosClick(id, e);
      const r0 = containerRef.value.getBoundingClientRect();
      const startT = adapter.xToTime(e.clientX - r0.left);
      const startP = adapter.yToPrice(e.clientY - r0.top);
      if (startT === null || startP === null) return;
      const orig = { time1: pos.time1, time2: pos.time2, entry: pos.entry, sl: pos.sl, tp: pos.tp };
      const onMove = (ev) => {
        if (!adapter || !containerRef.value) return;
        const r = containerRef.value.getBoundingClientRect();
        const t = adapter.xToTime(ev.clientX - r.left);
        const p = adapter.yToPrice(ev.clientY - r.top);
        if (t === null || p === null) return;
        drawingsStore.updatePosition(market.instrument, id, {
          time1: orig.time1 + (t - startT),
          time2: orig.time2 + (t - startT),
          entry: orig.entry + (p - startP),
          sl: orig.sl + (p - startP),
          tp: orig.tp + (p - startP)
        });
        const updated = drawingsStore.getPositionsFor(market.instrument).find((x) => x.id === id);
        if (updated) selectedPos.value = updated;
        recalcRects();
        positionPosPanel(id);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    }
    function deleteSelectedPos() {
      if (!selectedPos.value) return;
      drawingsStore.removePosition(market.instrument, selectedPos.value.id);
      selectedPos.value = null;
      posPanelPos.value = null;
      recalcRects();
    }
    function togglePosLevels() {
      if (!selectedPos.value) return;
      drawingsStore.updatePositionFlags(market.instrument, selectedPos.value.id, {
        showLevels: selectedPos.value.showLevels === false
      });
      const updated = drawingsStore.getPositionsFor(market.instrument).find((p) => p.id === selectedPos.value.id);
      if (updated) selectedPos.value = updated;
      recalcRects();
    }
    function createSingle(e, kind) {
      if (!adapter || !containerRef.value) return;
      const r = containerRef.value.getBoundingClientRect();
      const t = adapter.xToTime(e.clientX - r.left);
      const p = adapter.yToPrice(e.clientY - r.top);
      if (t === null || p === null) return;
      let item;
      if (kind === "vline") {
        item = { time: snapToCandle(t, p, magnetActive.value).time };
      } else {
        const s = snapToCandle(t, p, magnetActive.value);
        item = kind === "hray" ? { time: s.time, price: s.price } : { price: s.price };
      }
      const full = drawingsStore.addSingle(kind, market.instrument, item);
      drawingsStore.activeTool = "cursor";
      drawingsStore.selectedPositionId = null;
      selectedPos.value = null;
      posPanelPos.value = null;
      drawingsStore.selectedSingle = { kind, id: full.id };
      recalcRects();
      positionSinglePanel(kind, full.id);
    }
    function onSingleClick(kind, id, e) {
      e.stopPropagation();
      rectMenu.value = null;
      closePalette();
      if (drawingsStore.activeTool !== "cursor") drawingsStore.activeTool = "cursor";
      drawingsStore.selectedId = null;
      selectedRect.value = null;
      editPanelPos.value = null;
      drawingsStore.selectedLineId = null;
      selectedLine.value = null;
      linePanelPos.value = null;
      drawingsStore.selectedPolyId = null;
      selectedPoly.value = null;
      polyPanelPos.value = null;
      drawingsStore.selectedPositionId = null;
      selectedPos.value = null;
      posPanelPos.value = null;
      drawingsStore.selectedSingle = { kind, id };
      recalcRects();
      positionSinglePanel(kind, id);
    }
    let singlePanelW = 0;
    let singlePanelH = 0;
    function positionSinglePanel(kind, id) {
      const px = singlePixels.value.find((s) => s.id === id && s.kind === kind);
      const pane = containerRef.value;
      if (!px || !pane) return;
      const chartW = pane.clientWidth - axisRightW.value;
      const chartH = pane.clientHeight - axisBottomH.value;
      const anchor = kind === "hline" ? { x: chartW / 2, y: px.y } : kind === "hray" ? { x: px.x, y: px.y } : { x: px.x, y: chartH / 2 };
      const place = () => {
        const p2 = singlePixels.value.find((s) => s.id === id && s.kind === kind);
        if (!p2 || !containerRef.value) return;
        const chartW2 = containerRef.value.clientWidth - axisRightW.value;
        const chartH2 = containerRef.value.clientHeight - axisBottomH.value;
        const a = kind === "hline" ? { x: chartW2 / 2, y: p2.y } : kind === "hray" ? { x: p2.x, y: p2.y } : { x: p2.x, y: chartH2 / 2 };
        const w = singlePanelW || PANEL_W;
        const h = singlePanelH || PANEL_H;
        const gap = 8;
        let x = a.x + gap;
        let y = a.y - h - gap;
        if (x + w > containerRef.value.clientWidth - 6) x = a.x - w - gap;
        if (y < 4) y = a.y + gap;
        x = Math.min(Math.max(4, x), Math.max(4, containerRef.value.clientWidth - w - 6));
        y = Math.min(Math.max(4, y), Math.max(4, containerRef.value.clientHeight - h - 6));
        singlePanelPos.value = { x, y };
      };
      place();
      if (!singlePanelEl.value) {
        singlePanelReady.value = false;
        void nextTick(() => {
          if (!singlePanelEl.value) return;
          singlePanelW = singlePanelEl.value.offsetWidth;
          singlePanelH = singlePanelEl.value.offsetHeight;
          place();
          singlePanelReady.value = true;
        });
      } else {
        singlePanelW = singlePanelEl.value.offsetWidth;
        singlePanelH = singlePanelEl.value.offsetHeight;
        singlePanelReady.value = true;
      }
    }
    function onSingleDragStart(e, kind, id) {
      if (e.button !== 0 || !adapter || !containerRef.value) return;
      e.preventDefault();
      e.stopPropagation();
      rectMenu.value = null;
      closePalette();
      drawingsStore.selectedId = null;
      selectedRect.value = null;
      editPanelPos.value = null;
      drawingsStore.selectedLineId = null;
      selectedLine.value = null;
      linePanelPos.value = null;
      drawingsStore.selectedPolyId = null;
      selectedPoly.value = null;
      polyPanelPos.value = null;
      drawingsStore.selectedPositionId = null;
      selectedPos.value = null;
      posPanelPos.value = null;
      drawingsStore.selectedSingle = { kind, id };
      recalcRects();
      positionSinglePanel(kind, id);
      const startX = e.clientX;
      const startY = e.clientY;
      let moved = false;
      const onMove = (ev) => {
        if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 3) return;
        moved = true;
        if (!adapter || !containerRef.value) return;
        const r = containerRef.value.getBoundingClientRect();
        const t = adapter.xToTime(ev.clientX - r.left);
        const p = adapter.yToPrice(ev.clientY - r.top);
        if (t === null || p === null) return;
        if (kind === "hline") {
          drawingsStore.updateSingle(kind, market.instrument, id, { price: snapToCandle(t, p, magnetActive.value).price });
        } else if (kind === "vline") {
          drawingsStore.updateSingle(kind, market.instrument, id, { time: snapToCandle(t, p, magnetActive.value).time });
        } else {
          const s = snapToCandle(t, p, magnetActive.value);
          drawingsStore.updateSingle(kind, market.instrument, id, { time: s.time, price: s.price });
        }
        recalcRects();
        positionSinglePanel(kind, id);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    }
    function deleteSelectedSingle() {
      const sel = drawingsStore.selectedSingle;
      if (!sel) return;
      drawingsStore.removeSingle(sel.kind, market.instrument, sel.id);
      singlePanelPos.value = null;
      recalcRects();
    }
    function clearSingleSelection() {
      if (!drawingsStore.selectedSingle && !singlePanelPos.value) return;
      drawingsStore.selectedSingle = null;
      singlePanelPos.value = null;
      recalcRects();
    }
    function setSingleColor(color) {
      const sel = drawingsStore.selectedSingle;
      if (!sel) return;
      drawingsStore.updateSingle(sel.kind, market.instrument, sel.id, { color });
      recalcRects();
    }
    function setSingleDash(dash) {
      const sel = drawingsStore.selectedSingle;
      if (!sel) return;
      drawingsStore.updateSingle(sel.kind, market.instrument, sel.id, { dash });
      recalcRects();
    }
    onMounted(async () => {
      await nextTick();
      if (!containerRef.value) return;
      adapter = createChartAdapter(containerRef.value);
      applyChartStyle();
      adapter.setTheme(themeStore.theme === "dark");
      if (props.instrument) adapter.setInstrument(props.instrument);
      adapter.setData(displayCandles.value);
      requestAnimationFrame(updateAxisSizes);
      loadSettleDeadline = performance.now() + 5e3;
      extendRecalcFrames(300);
      window.__tkChartAdapter = adapter;
      visibleCb = (range) => {
        updateBadgePosition();
        recalcRects();
        if (!range) return;
        if (lazyThrottled) return;
        if (range.from > 15) return;
        if (market.isLoading || market.isLoadingMore || !market.hasMore) return;
        lazyThrottled = true;
        void market.loadMore().finally(() => {
          setTimeout(() => lazyThrottled = false, 400);
        });
      };
      adapter.subscribeVisibleRange(visibleCb);
      dataCb = () => {
        updateBadgePosition();
        recalcRects();
        updateAxisSizes();
        loadSettleDeadline = performance.now() + 5e3;
        extendRecalcFrames(120);
      };
      adapter.subscribeDataChanged(dataCb);
      const el = containerRef.value;
      const onInteract = () => {
        updateBadgePosition();
        recalcRects();
        extendRecalcFrames(250);
      };
      el.addEventListener("pointermove", onInteract, { passive: true });
      el.addEventListener("pointerdown", onInteract, { passive: true });
      el.addEventListener("wheel", onInteract, { passive: true });
      el.addEventListener("touchmove", onInteract, { passive: true });
      interactionEl = el;
      interactCb = onInteract;
      const onOverlayWheel = (e) => {
        if (e.target?.tagName === "CANVAS") return;
        const t = e.target;
        if (t?.closest?.(".indicator-legend")) return;
        const canvas = el.querySelector("canvas");
        if (!canvas) return;
        const r = canvas.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
        canvas.dispatchEvent(new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          deltaX: e.deltaX,
          deltaY: e.deltaY,
          deltaZ: e.deltaZ,
          deltaMode: e.deltaMode,
          clientX: e.clientX,
          clientY: e.clientY,
          screenX: e.screenX,
          screenY: e.screenY,
          ctrlKey: e.ctrlKey,
          altKey: e.altKey,
          shiftKey: e.shiftKey,
          metaKey: e.metaKey
        }));
      };
      const paneHost = el.parentElement;
      if (paneHost) {
        paneHost.addEventListener("wheel", onOverlayWheel, true);
        overlayWheelEl = paneHost;
        overlayWheelCb = onOverlayWheel;
      }
      const onPointerDown = () => {
        pointerHeld = true;
        extendRecalcFrames(300);
      };
      const onPointerUp = () => {
        pointerHeld = false;
        extendRecalcFrames(200);
      };
      el.addEventListener("pointerdown", onPointerDown, { passive: true });
      window.addEventListener("pointerup", onPointerUp, { passive: true });
      pointerDownEl = el;
      pointerDownCb = onPointerDown;
      pointerUpCb = onPointerUp;
      const onChartMouseDown = (e) => {
        indSettingsOpen.value = false;
        if (demo.active && draft.value) {
          if (e.button !== 0 || !isInChartArea(e) || !adapter || !containerRef.value) return;
          e.preventDefault();
          e.stopPropagation();
          const r = containerRef.value.getBoundingClientRect();
          const p = adapter.yToPrice(e.clientY - r.top);
          if (p !== null) {
            const delta = p - draft.value.entry;
            draft.value.entry = p;
            draft.value.sl += delta;
            draft.value.tp += delta;
          }
          recalcRects();
          return;
        }
        if (replay.active && replay.picking) {
          if (e.button !== 0 || !isInChartArea(e) || !adapter || !containerRef.value) return;
          e.preventDefault();
          e.stopPropagation();
          const t = replayTimeAt(e.clientX);
          if (t !== null) {
            replay.startAt(t);
            focusReplayEdge();
          }
          return;
        }
        if (!isInChartArea(e)) return;
        const tool = drawingsStore.activeTool;
        if (tool === "hline" || tool === "hray" || tool === "vline") {
          if (e.button !== 0) return;
          e.preventDefault();
          e.stopPropagation();
          createSingle(e, tool);
          return;
        }
        if (tool === "position") {
          if (e.button !== 0) return;
          e.preventDefault();
          e.stopPropagation();
          if (posState.value) {
            finalizePos(e);
          } else {
            beginPos(e);
          }
          return;
        }
        if (tool !== "rectangle" && tool !== "trendline" && tool !== "polyline" || e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        if (tool === "polyline") {
          handlePolyClick(e);
        } else if (drawingState.value) {
          if (adapter && containerRef.value) {
            const r = containerRef.value.getBoundingClientRect();
            const t = adapter.xToTime(e.clientX - r.left);
            const p = adapter.yToPrice(e.clientY - r.top);
            if (t !== null && p !== null) {
              const s2 = snapToCandle(t, p, magnetActive.value);
              drawingState.value.time2 = s2.time;
              drawingState.value.price2 = s2.price;
            }
          }
          finalizeDraw();
        } else {
          beginDraw(e);
        }
      };
      el.addEventListener("pointerdown", onChartMouseDown, true);
      chartMouseDownEl = el;
      chartMouseDownCb = onChartMouseDown;
      let tapPress = null;
      const onTapDown = (e) => {
        if (e.pointerType === "mouse") return;
        const target = e.target;
        tapPress = {
          x: e.clientX,
          y: e.clientY,
          onHit: !!target?.closest?.(".drawing-hit-layer, .demo-hit-layer")
        };
      };
      const onTapUp = (e) => {
        const press = tapPress;
        tapPress = null;
        if (!press || e.pointerType === "mouse" || press.onHit) return;
        if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > 8) return;
        if (!isInChartArea(e)) return;
        onChartClick();
      };
      el.addEventListener("pointerdown", onTapDown, true);
      window.addEventListener("pointerup", onTapUp);
      tapDownEl = el;
      tapDownCb = onTapDown;
      tapUpCb = onTapUp;
      const onChartDblClick = (e) => {
        if (drawingsStore.activeTool !== "polyline" || !polyState.value) return;
        e.preventDefault();
        e.stopPropagation();
        finalizePoly();
      };
      el.addEventListener("dblclick", onChartDblClick);
      chartDblClickEl = el;
      chartDblClickCb = onChartDblClick;
      const paneEl = el.closest(".chart-pane") ?? el;
      const onPaneContextMenu = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const target = e.target;
        const rectEl = target?.closest?.(".drawing-hit-rect");
        const rectId = rectEl?.getAttribute("data-rect-id") ?? null;
        if (rectId) {
          if (drawingsStore.activeTool !== "cursor") drawingsStore.activeTool = "cursor";
          drawingsStore.selectedId = rectId;
          selectedRect.value = drawingsStore.getFor(market.instrument).find((r) => r.id === rectId) ?? null;
          recalcRects();
          positionEditPanel(rectId);
          const paneRect = paneEl.getBoundingClientRect();
          const pos = clampToPane(e.clientX - paneRect.left, e.clientY - paneRect.top, editMenuEl.value);
          rectMenu.value = { id: rectId, x: pos.x, y: pos.y };
          closePalette();
          return;
        }
        rectMenu.value = null;
        closePalette();
        if (drawingsStore.activeTool !== "cursor") drawingsStore.activeTool = "cursor";
        cancelDraw();
        if (drawingsStore.selectedId || selectedRect.value) {
          drawingsStore.selectedId = null;
          selectedRect.value = null;
          editPanelPos.value = null;
          recalcRects();
        }
        if (drawingsStore.selectedLineId || selectedLine.value) {
          drawingsStore.selectedLineId = null;
          selectedLine.value = null;
          linePanelPos.value = null;
          linePaletteOpen.value = false;
          recalcRects();
        }
        if (drawingsStore.selectedPolyId || selectedPoly.value) {
          drawingsStore.selectedPolyId = null;
          selectedPoly.value = null;
          polyPanelPos.value = null;
          polyPaletteOpen.value = false;
          recalcRects();
        }
        if (drawingsStore.selectedPositionId || selectedPos.value) {
          drawingsStore.selectedPositionId = null;
          selectedPos.value = null;
          posPanelPos.value = null;
          recalcRects();
        }
        if (drawingsStore.selectedSingle) {
          drawingsStore.selectedSingle = null;
          singlePanelPos.value = null;
          recalcRects();
        }
      };
      paneEl.addEventListener("contextmenu", onPaneContextMenu);
      paneCtxEl = paneEl;
      paneCtxCb = onPaneContextMenu;
      const onKey = (e) => {
        if (e.key === "Escape") {
          cancelDraw();
          rectMenu.value = null;
          closePalette();
          linePaletteOpen.value = false;
          polyPaletteOpen.value = false;
        } else if (e.key === "Delete" || e.key === "Backspace") {
          const t = e.target;
          if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
          if (selectedRect.value) {
            e.preventDefault();
            deleteSelected();
          } else if (selectedLine.value) {
            e.preventDefault();
            deleteSelectedLine();
          } else if (selectedPoly.value) {
            e.preventDefault();
            deleteSelectedPoly();
          } else if (selectedPos.value) {
            e.preventDefault();
            deleteSelectedPos();
          } else if (drawingsStore.selectedSingle) {
            e.preventDefault();
            deleteSelectedSingle();
          }
        }
      };
      window.addEventListener("keydown", onKey);
      escCb = onKey;
      const onMagnetKey = (e) => {
        if (e.key === "Control") {
          drawingsStore.setCtrlHeld(e.type === "keydown");
          if (e.type === "keyup") snapXhair.value = null;
        }
      };
      const onMagnetBlur = () => {
        drawingsStore.setCtrlHeld(false);
        snapXhair.value = null;
      };
      window.addEventListener("keydown", onMagnetKey);
      window.addEventListener("keyup", onMagnetKey);
      window.addEventListener("blur", onMagnetBlur);
      magnetKeyCb = onMagnetKey;
      magnetBlurCb = onMagnetBlur;
      const onAnyMove = (e) => {
        lastPtrClient = { clientX: e.clientX, clientY: e.clientY };
      };
      window.addEventListener("pointermove", onAnyMove, { passive: true });
      magnetAnyMoveCb = onAnyMove;
      const computeSnapXhair = (clientX, clientY) => {
        if (!drawingToolActive.value || !magnetActive.value || !adapter || !containerRef.value) {
          snapXhair.value = null;
          return;
        }
        const r = containerRef.value.getBoundingClientRect();
        const fake = { clientX, clientY, button: 0, buttons: 0 };
        if (!isInChartArea(fake)) {
          snapXhair.value = null;
          return;
        }
        const t = adapter.xToTime(clientX - r.left);
        const p = adapter.yToPrice(clientY - r.top);
        const s = t !== null && p !== null ? snapToCandle(t, p, true) : null;
        const x = s ? adapter.timeToX(s.time) : null;
        const y = s ? adapter.getPriceY(s.price) : null;
        snapXhair.value = x !== null && y !== null && s ? { x, y, priceText: fmtPrice(s.price, instrumentPrecision(market.instrument)), timeText: fmtAxisTime(s.time) } : null;
      };
      const onXhairMove = (e) => {
        lastPtrClient = { clientX: e.clientX, clientY: e.clientY };
        computeSnapXhair(e.clientX, e.clientY);
      };
      const onXhairLeave = () => {
        lastPtrClient = null;
        snapXhair.value = null;
      };
      el.addEventListener("pointermove", onXhairMove);
      el.addEventListener("pointerleave", onXhairLeave);
      xhairMoveEl = el;
      xhairMoveCb = onXhairMove;
      xhairLeaveCb = onXhairLeave;
      const syncCrosshairMode = () => {
        const custom = drawingToolActive.value && magnetActive.value;
        adapter?.setCrosshairVisible(!custom);
        if (custom && lastPtrClient) computeSnapXhair(lastPtrClient.clientX, lastPtrClient.clientY);
        else if (!custom) snapXhair.value = null;
      };
      syncCrosshairMode();
      crosshairModeStop = watch([drawingToolActive, magnetActive], syncCrosshairMode);
      const onWindowLost = () => cancelDraw();
      window.addEventListener("blur", onWindowLost);
      window.addEventListener("pointercancel", onWindowLost);
      windowLostCb = onWindowLost;
      updateCountdown();
      countdownTimer = setInterval(updateCountdown, 200);
      ro = new ResizeObserver(() => {
        if (!containerRef.value || !adapter) return;
        const { clientWidth, clientHeight } = containerRef.value;
        adapter.resize(clientWidth, clientHeight);
        updateAxisSizes();
        requestAnimationFrame(() => {
          if (!adapter) return;
          updateBadgePosition();
          recalcRects();
          extendRecalcFrames(300);
        });
      });
      ro.observe(containerRef.value);
    });
    onBeforeUnmount(() => {
      document.removeEventListener("pointerdown", indSettingsOutside, true);
      if (visibleCb && adapter) adapter.unsubscribeVisibleRange(visibleCb);
      if (dataCb && adapter) adapter.unsubscribeDataChanged(dataCb);
      if (countdownTimer) clearInterval(countdownTimer);
      stopHold();
      stopPickingListeners();
      demoLineDrag = null;
      if (replayTimer) {
        clearInterval(replayTimer);
        replayTimer = null;
      }
      if (interactionEl && interactCb) {
        interactionEl.removeEventListener("pointermove", interactCb);
        interactionEl.removeEventListener("pointerdown", interactCb);
        interactionEl.removeEventListener("wheel", interactCb);
        interactionEl.removeEventListener("touchmove", interactCb);
      }
      if (overlayWheelEl && overlayWheelCb) {
        overlayWheelEl.removeEventListener("wheel", overlayWheelCb, true);
      }
      if (chartMouseDownEl && chartMouseDownCb) {
        chartMouseDownEl.removeEventListener("pointerdown", chartMouseDownCb, true);
      }
      if (tapDownEl && tapDownCb) {
        tapDownEl.removeEventListener("pointerdown", tapDownCb, true);
      }
      if (tapUpCb) {
        window.removeEventListener("pointerup", tapUpCb);
      }
      if (chartDblClickEl && chartDblClickCb) {
        chartDblClickEl.removeEventListener("dblclick", chartDblClickCb);
      }
      if (recalcRaf) cancelAnimationFrame(recalcRaf);
      if (pointerDownEl && pointerDownCb) {
        pointerDownEl.removeEventListener("pointerdown", pointerDownCb);
      }
      if (pointerUpCb) {
        window.removeEventListener("pointerup", pointerUpCb);
      }
      if (paneCtxEl && paneCtxCb) {
        paneCtxEl.removeEventListener("contextmenu", paneCtxCb);
      }
      if (escCb) {
        window.removeEventListener("keydown", escCb);
      }
      if (magnetKeyCb) {
        window.removeEventListener("keydown", magnetKeyCb);
        window.removeEventListener("keyup", magnetKeyCb);
      }
      if (magnetBlurCb) {
        window.removeEventListener("blur", magnetBlurCb);
      }
      if (magnetAnyMoveCb) {
        window.removeEventListener("pointermove", magnetAnyMoveCb);
      }
      if (xhairMoveEl && xhairMoveCb) {
        xhairMoveEl.removeEventListener("pointermove", xhairMoveCb);
        xhairMoveEl.removeEventListener("pointerleave", xhairLeaveCb);
      }
      crosshairModeStop?.();
      adapter?.setCrosshairVisible(true);
      if (windowLostCb) {
        window.removeEventListener("blur", windowLostCb);
        window.removeEventListener("pointercancel", windowLostCb);
      }
      if (onMouseMoveRef) {
        window.removeEventListener("pointermove", onMouseMoveRef);
      }
      ro?.disconnect();
      adapter?.destroy();
      adapter = null;
    });
    const __returned__ = { props, market, drawingsStore, replay, demo, indicators, sessionPixels, indSettingsOpen, CHART_STYLE_KEY, TPL_KEY, DEFAULT_CANDLES, defaultChartStyle, HEX, loadChartStyle, paneRef, chartStyle, chartSettingsOpen, isDarkTheme, themeBgPair, themeAxisPair, eff, applyChartStyle, resetChartStyle, setColor, resetGroup, loadTemplates, templates, tplName, selectedTpl, persistTemplates, saveTemplate, applyTemplate, deleteTemplate, indSettingsOutside, get runsCache() {
      return runsCache;
    }, set runsCache(v) {
      runsCache = v;
    }, get lastBoxesJson() {
      return lastBoxesJson;
    }, set lastBoxesJson(v) {
      lastBoxesJson = v;
    }, computeSessionBoxes, toTimeStr, onCustomTimeChange, sessionWindowLocal, newSessName, newSessColor, newSessStart, newSessEnd, onAddSession, prec, demoLines, get demoLineDrag() {
      return demoLineDrag;
    }, set demoLineDrag(v) {
      demoLineDrag = v;
    }, demoTab, demoPeriod, demoBottomH, demoChartH, demoMini, demoLevelY, rebuildDemoLines, onDemoLineDragStart, draft, armDemo, setDemoDraft, cancelDemoDraft, demoSummary, pendingOrders, marketClosedNote, pnlClass, fmtMoney, themeStore, containerRef, get adapter() {
      return adapter;
    }, set adapter(v) {
      adapter = v;
    }, get ro() {
      return ro;
    }, set ro(v) {
      ro = v;
    }, displayCandles, pickTime, replayVlX, replayTag, get replayTimer() {
      return replayTimer;
    }, set replayTimer(v) {
      replayTimer = v;
    }, get holdTimer() {
      return holdTimer;
    }, set holdTimer(v) {
      holdTimer = v;
    }, get holdTimeout() {
      return holdTimeout;
    }, set holdTimeout(v) {
      holdTimeout = v;
    }, get pickingMove() {
      return pickingMove;
    }, set pickingMove(v) {
      pickingMove = v;
    }, replayStep, togglePlay, holdStep, stopHold, replayTimeAt, onPickingMove, stopPickingListeners, focusReplayEdge, onReplayExit, flagFor, get visibleCb() {
      return visibleCb;
    }, set visibleCb(v) {
      visibleCb = v;
    }, get dataCb() {
      return dataCb;
    }, set dataCb(v) {
      dataCb = v;
    }, get lazyThrottled() {
      return lazyThrottled;
    }, set lazyThrottled(v) {
      lazyThrottled = v;
    }, get interactionEl() {
      return interactionEl;
    }, set interactionEl(v) {
      interactionEl = v;
    }, get interactCb() {
      return interactCb;
    }, set interactCb(v) {
      interactCb = v;
    }, get overlayWheelEl() {
      return overlayWheelEl;
    }, set overlayWheelEl(v) {
      overlayWheelEl = v;
    }, get overlayWheelCb() {
      return overlayWheelCb;
    }, set overlayWheelCb(v) {
      overlayWheelCb = v;
    }, get recalcRaf() {
      return recalcRaf;
    }, set recalcRaf(v) {
      recalcRaf = v;
    }, get recalcDeadline() {
      return recalcDeadline;
    }, set recalcDeadline(v) {
      recalcDeadline = v;
    }, get loadSettleDeadline() {
      return loadSettleDeadline;
    }, set loadSettleDeadline(v) {
      loadSettleDeadline = v;
    }, get pointerHeld() {
      return pointerHeld;
    }, set pointerHeld(v) {
      pointerHeld = v;
    }, get pointerDownEl() {
      return pointerDownEl;
    }, set pointerDownEl(v) {
      pointerDownEl = v;
    }, get pointerDownCb() {
      return pointerDownCb;
    }, set pointerDownCb(v) {
      pointerDownCb = v;
    }, get pointerUpCb() {
      return pointerUpCb;
    }, set pointerUpCb(v) {
      pointerUpCb = v;
    }, get chartMouseDownEl() {
      return chartMouseDownEl;
    }, set chartMouseDownEl(v) {
      chartMouseDownEl = v;
    }, get chartMouseDownCb() {
      return chartMouseDownCb;
    }, set chartMouseDownCb(v) {
      chartMouseDownCb = v;
    }, get tapDownEl() {
      return tapDownEl;
    }, set tapDownEl(v) {
      tapDownEl = v;
    }, get tapDownCb() {
      return tapDownCb;
    }, set tapDownCb(v) {
      tapDownCb = v;
    }, get tapUpCb() {
      return tapUpCb;
    }, set tapUpCb(v) {
      tapUpCb = v;
    }, get chartDblClickEl() {
      return chartDblClickEl;
    }, set chartDblClickEl(v) {
      chartDblClickEl = v;
    }, get chartDblClickCb() {
      return chartDblClickCb;
    }, set chartDblClickCb(v) {
      chartDblClickCb = v;
    }, get paneCtxEl() {
      return paneCtxEl;
    }, set paneCtxEl(v) {
      paneCtxEl = v;
    }, get paneCtxCb() {
      return paneCtxCb;
    }, set paneCtxCb(v) {
      paneCtxCb = v;
    }, get escCb() {
      return escCb;
    }, set escCb(v) {
      escCb = v;
    }, get magnetKeyCb() {
      return magnetKeyCb;
    }, set magnetKeyCb(v) {
      magnetKeyCb = v;
    }, get magnetBlurCb() {
      return magnetBlurCb;
    }, set magnetBlurCb(v) {
      magnetBlurCb = v;
    }, get magnetAnyMoveCb() {
      return magnetAnyMoveCb;
    }, set magnetAnyMoveCb(v) {
      magnetAnyMoveCb = v;
    }, get xhairMoveEl() {
      return xhairMoveEl;
    }, set xhairMoveEl(v) {
      xhairMoveEl = v;
    }, get xhairMoveCb() {
      return xhairMoveCb;
    }, set xhairMoveCb(v) {
      xhairMoveCb = v;
    }, get xhairLeaveCb() {
      return xhairLeaveCb;
    }, set xhairLeaveCb(v) {
      xhairLeaveCb = v;
    }, get crosshairModeStop() {
      return crosshairModeStop;
    }, set crosshairModeStop(v) {
      crosshairModeStop = v;
    }, get windowLostCb() {
      return windowLostCb;
    }, set windowLostCb(v) {
      windowLostCb = v;
    }, countdown, marketClosed, tagW, tagRight, tagVisible, timerTop, smallTagH, get countdownTimer() {
      return countdownTimer;
    }, set countdownTimer(v) {
      countdownTimer = v;
    }, isForexClosed, restoreRange, updateBadgePosition, updateCountdown, rectPixels, hitRects, drawingState, drawingPreview, selectedRect, editPanelPos, editPanelEl, editMenuEl, rectMenu, paletteOpen, PANEL_W, PANEL_H, clampToPane, togglePalette, closePalette, menuRectColor, menuRectOpacity, menuRectFilled, renderTick, DASH_ARRAY, DASH_STYLES, trendPixels, hitTrends, selectedLine, linePanelPos, linePanelEl, linePaletteOpen, drawingToolActive, magnetActive, snapXhair, get lastPtrClient() {
      return lastPtrClient;
    }, set lastPtrClient(v) {
      lastPtrClient = v;
    }, get preSnap() {
      return preSnap;
    }, set preSnap(v) {
      preSnap = v;
    }, replayPointerAt, polyPixels, hitPolys, selectedPoly, polyPanelPos, polyPanelEl, polyPaletteOpen, polyState, get lastPolyClickAt() {
      return lastPolyClickAt;
    }, set lastPolyClickAt(v) {
      lastPolyClickAt = v;
    }, get onPolyMoveRef() {
      return onPolyMoveRef;
    }, set onPolyMoveRef(v) {
      onPolyMoveRef = v;
    }, posPixels, selectedPos, posPanelPos, posPanelEl, posPanelReady, posState, posCursor, get onPosMoveRef() {
      return onPosMoveRef;
    }, set onPosMoveRef(v) {
      onPosMoveRef = v;
    }, fmtPrice, singlePixels, singlePanelPos, singlePanelEl, singlePanelReady, getSingle, snapToCandle, MONTHS_SHORT, fmtAxisTime, axisRightW, axisBottomH, get axisRetry() {
      return axisRetry;
    }, set axisRetry(v) {
      axisRetry = v;
    }, updateAxisSizes, isInChartArea, recalcRects, recalcFrame, hasUnprojectedDrawings, extendRecalcFrames, beginDraw, finalizeDraw, cancelDraw, startPolyPreview, stopPolyPreview, handlePolyClick, finalizePoly, get onMouseMoveRef() {
      return onMouseMoveRef;
    }, set onMouseMoveRef(v) {
      onMouseMoveRef = v;
    }, onRectClick, positionEditPanel, computePanelPos, onRectDragStart, onChartClick, deleteSelected, setColorInMenu, setOpacityInMenu, toggleFillInMenu, deleteFromMenu, setColorSelected, setOpacitySelected, toggleFillSelected, syncSelected, onResizeStart, onTrendClick, positionLinePanel, computeLinePanelPos, onTrendDragStart, onTrendHandleStart, deleteSelectedLine, setLineColorSelected, setLineDashSelected, syncSelectedLine, onPolyClick, positionPolyPanel, computeCornerPanelPos, onPolyDragStart, onPolyVertexStart, deleteSelectedPoly, setPolyColorSelected, setPolyDashSelected, toggleArrowSelected, syncSelectedPoly, beginPos, stopPosCursor, finalizePos, onPosClick, get posPanelW() {
      return posPanelW;
    }, set posPanelW(v) {
      posPanelW = v;
    }, get posPanelH() {
      return posPanelH;
    }, set posPanelH(v) {
      posPanelH = v;
    }, positionPosPanel, clampPosPrice, onPosLevelStart, onPosEdgeStart, onPosCornerStart, onPosDragStart, deleteSelectedPos, togglePosLevels, createSingle, onSingleClick, get singlePanelW() {
      return singlePanelW;
    }, set singlePanelW(v) {
      singlePanelW = v;
    }, get singlePanelH() {
      return singlePanelH;
    }, set singlePanelH(v) {
      singlePanelH = v;
    }, positionSinglePanel, onSingleDragStart, deleteSelectedSingle, clearSingleSelection, setSingleColor, setSingleDash, get symbolParts() {
      return symbolParts;
    }, get instrumentPrecision() {
      return instrumentPrecision;
    }, get providerOf() {
      return providerOf;
    } };
    Object.defineProperty(__returned__, "__isScriptSetup", { enumerable: false, value: true });
    return __returned__;
  }
});
import { createCommentVNode as _createCommentVNode, renderList as _renderList, Fragment as _Fragment, openBlock as _openBlock, createElementBlock as _createElementBlock, toDisplayString as _toDisplayString, createTextVNode as _createTextVNode, createElementVNode as _createElementVNode, normalizeClass as _normalizeClass, vModelCheckbox as _vModelCheckbox, withDirectives as _withDirectives, vModelText as _vModelText, withModifiers as _withModifiers, normalizeStyle as _normalizeStyle, vShow as _vShow, vModelSelect as _vModelSelect, createStaticVNode as _createStaticVNode } from "/node_modules/.vite/deps/vue.js?v=10d01972";
const _hoisted_1 = {
  ref: "paneRef",
  class: "chart-pane"
};
const _hoisted_2 = {
  key: 0,
  class: "chart-symbol-label"
};
const _hoisted_3 = { class: "label-text" };
const _hoisted_4 = ["src", "alt"];
const _hoisted_5 = {
  key: 1,
  class: "flag-emoji"
};
const _hoisted_6 = { key: 2 };
const _hoisted_7 = {
  key: 1,
  class: "indicator-legend"
};
const _hoisted_8 = ["title"];
const _hoisted_9 = {
  key: 0,
  viewBox: "0 0 24 24",
  width: "13",
  height: "13",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": "1.8",
  "stroke-linecap": "round",
  "stroke-linejoin": "round",
  "aria-hidden": "true"
};
const _hoisted_10 = {
  key: 1,
  viewBox: "0 0 24 24",
  width: "13",
  height: "13",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": "1.8",
  "stroke-linecap": "round",
  "stroke-linejoin": "round",
  "aria-hidden": "true"
};
const _hoisted_11 = ["onUpdate:modelValue"];
const _hoisted_12 = ["onUpdate:modelValue", "aria-label", "title"];
const _hoisted_13 = ["onUpdate:modelValue", "aria-label"];
const _hoisted_14 = { class: "ind-set-time" };
const _hoisted_15 = { class: "ind-set-city" };
const _hoisted_16 = ["onUpdate:modelValue"];
const _hoisted_17 = ["onUpdate:modelValue", "aria-label", "title"];
const _hoisted_18 = ["onUpdate:modelValue", "aria-label"];
const _hoisted_19 = ["value", "onChange"];
const _hoisted_20 = ["value", "onChange"];
const _hoisted_21 = ["title", "aria-label", "onClick"];
const _hoisted_22 = { class: "ind-set-add" };
const _hoisted_23 = { class: "ind-set-row" };
const _hoisted_24 = {
  key: 2,
  class: "overlay center loading-only"
};
const _hoisted_25 = {
  key: 3,
  class: "overlay error"
};
const _hoisted_26 = {
  key: 4,
  class: "overlay muted center"
};
const _hoisted_27 = {
  key: 5,
  class: "overlay loading-more"
};
const _hoisted_28 = ["title"];
const _hoisted_29 = { class: "trend-svg" };
const _hoisted_30 = ["x1", "y1", "x2", "y2", "stroke", "stroke-width", "stroke-dasharray", "opacity"];
const _hoisted_31 = { class: "trend-svg poly-svg" };
const _hoisted_32 = ["points", "stroke", "stroke-width", "stroke-dasharray", "opacity"];
const _hoisted_33 = ["points", "fill", "opacity"];
const _hoisted_34 = { class: "trend-svg pos-svg" };
const _hoisted_35 = ["x", "y", "width", "height", "fill-opacity"];
const _hoisted_36 = ["x", "y", "width", "height", "fill-opacity"];
const _hoisted_37 = ["x1", "y1", "x2", "y2"];
const _hoisted_38 = ["data-rect-id", "onPointerdown", "onClick"];
const _hoisted_39 = ["onPointerdown", "onClick"];
const _hoisted_40 = ["onPointerdown", "onClick"];
const _hoisted_41 = ["onPointerdown", "onClick"];
const _hoisted_42 = ["onPointerdown", "onClick"];
const _hoisted_43 = { class: "trend-hit-svg" };
const _hoisted_44 = ["x1", "y1", "x2", "y2", "onPointerdown", "onClick"];
const _hoisted_45 = ["cx", "cy", "onPointerdown"];
const _hoisted_46 = ["cx", "cy", "onPointerdown"];
const _hoisted_47 = { class: "trend-hit-svg poly-hit-svg" };
const _hoisted_48 = ["points", "onPointerdown", "onClick"];
const _hoisted_49 = ["cx", "cy", "onPointerdown"];
const _hoisted_50 = ["onPointerdown", "onClick"];
const _hoisted_51 = ["onPointerdown"];
const _hoisted_52 = ["onPointerdown"];
const _hoisted_53 = ["onPointerdown"];
const _hoisted_54 = ["onPointerdown"];
const _hoisted_55 = ["onPointerdown"];
const _hoisted_56 = ["onPointerdown"];
const _hoisted_57 = ["onPointerdown"];
const _hoisted_58 = ["onPointerdown", "onClick"];
const _hoisted_59 = ["onPointerdown"];
const _hoisted_60 = { class: "single-tag-layer" };
const _hoisted_61 = { class: "edit-colors" };
const _hoisted_62 = ["onClick"];
const _hoisted_63 = { class: "palette-anchor" };
const _hoisted_64 = ["onClick"];
const _hoisted_65 = {
  class: "opacity-row",
  title: "Fill opacity"
};
const _hoisted_66 = ["value"];
const _hoisted_67 = { class: "opacity-value" };
const _hoisted_68 = ["title"];
const _hoisted_69 = {
  viewBox: "0 0 16 16",
  width: "15",
  height: "15",
  "aria-hidden": "true"
};
const _hoisted_70 = ["fill", "fill-opacity"];
const _hoisted_71 = { class: "edit-colors" };
const _hoisted_72 = ["onClick"];
const _hoisted_73 = { class: "palette-anchor" };
const _hoisted_74 = ["onClick"];
const _hoisted_75 = {
  class: "dash-row",
  title: "Line style"
};
const _hoisted_76 = ["title", "onClick"];
const _hoisted_77 = { class: "edit-colors" };
const _hoisted_78 = ["onClick"];
const _hoisted_79 = { class: "palette-anchor" };
const _hoisted_80 = ["onClick"];
const _hoisted_81 = {
  class: "dash-row",
  title: "Line style"
};
const _hoisted_82 = ["title", "onClick"];
const _hoisted_83 = ["title"];
const _hoisted_84 = ["title"];
const _hoisted_85 = ["onPointerdown"];
const _hoisted_86 = { class: "demo-mgr-head" };
const _hoisted_87 = {
  key: 0,
  class: "demo-mgr-title"
};
const _hoisted_88 = ["title"];
const _hoisted_89 = { class: "demo-size-modes" };
const _hoisted_90 = {
  key: 0,
  class: "demo-mgr-inp"
};
const _hoisted_91 = {
  key: 1,
  class: "demo-mgr-inp"
};
const _hoisted_92 = {
  key: 2,
  class: "demo-mgr-inp"
};
const _hoisted_93 = { class: "demo-mgr-btns" };
const _hoisted_94 = {
  key: 3,
  class: "demo-draft-btns"
};
const _hoisted_95 = {
  key: 4,
  class: "demo-err"
};
const _hoisted_96 = ["title"];
const _hoisted_97 = ["title", "onClick"];
const _hoisted_98 = { class: "edit-colors" };
const _hoisted_99 = ["onClick"];
const _hoisted_100 = {
  class: "dash-row",
  title: "Line style"
};
const _hoisted_101 = ["title", "onClick"];
const _hoisted_102 = { class: "edit-colors" };
const _hoisted_103 = ["onClick"];
const _hoisted_104 = { class: "palette-anchor" };
const _hoisted_105 = ["onClick"];
const _hoisted_106 = {
  class: "opacity-row",
  title: "Fill opacity"
};
const _hoisted_107 = ["value"];
const _hoisted_108 = { class: "opacity-value" };
const _hoisted_109 = ["title"];
const _hoisted_110 = {
  viewBox: "0 0 16 16",
  width: "15",
  height: "15",
  "aria-hidden": "true"
};
const _hoisted_111 = ["fill", "fill-opacity"];
const _hoisted_112 = {
  key: 20,
  class: "demo-bottom"
};
const _hoisted_113 = { class: "demo-bottom-head" };
const _hoisted_114 = { class: "demo-stat" };
const _hoisted_115 = { class: "demo-stat" };
const _hoisted_116 = { class: "demo-stat" };
const _hoisted_117 = { class: "demo-tabs" };
const _hoisted_118 = ["onClick"];
const _hoisted_119 = {
  key: 0,
  class: "demo-table"
};
const _hoisted_120 = {
  key: 0,
  class: "demo-empty"
};
const _hoisted_121 = { key: 1 };
const _hoisted_122 = ["onClick"];
const _hoisted_123 = { key: 2 };
const _hoisted_124 = ["onClick"];
const _hoisted_125 = {
  key: 1,
  class: "demo-table"
};
const _hoisted_126 = {
  key: 0,
  class: "demo-empty"
};
const _hoisted_127 = { key: 1 };
const _hoisted_128 = {
  key: 2,
  class: "demo-table"
};
const _hoisted_129 = { class: "demo-stats" };
const _hoisted_130 = { class: "demo-stat-card" };
const _hoisted_131 = { class: "demo-stat-card" };
const _hoisted_132 = { class: "demo-stat-card" };
const _hoisted_133 = { class: "demo-stat-card" };
const _hoisted_134 = { class: "demo-stat-card" };
const _hoisted_135 = { class: "demo-stat-card" };
const _hoisted_136 = { class: "pos" };
const _hoisted_137 = { class: "demo-stat-card" };
const _hoisted_138 = { class: "neg" };
const _hoisted_139 = { class: "demo-stat-card" };
const _hoisted_140 = {
  class: "chart-settings-panel",
  role: "dialog",
  "aria-label": "Chart settings"
};
const _hoisted_141 = { class: "cs-head" };
const _hoisted_142 = { class: "cs-section" };
const _hoisted_143 = { class: "cs-label" };
const _hoisted_144 = { class: "cs-row" };
const _hoisted_145 = { class: "cs-modes" };
const _hoisted_146 = {
  key: 0,
  class: "cs-row"
};
const _hoisted_147 = ["value"];
const _hoisted_148 = { class: "cs-row" };
const _hoisted_149 = ["value"];
const _hoisted_150 = { class: "cs-row" };
const _hoisted_151 = ["value"];
const _hoisted_152 = { class: "cs-section" };
const _hoisted_153 = { class: "cs-label" };
const _hoisted_154 = { class: "cs-candles" };
const _hoisted_155 = { class: "cs-candle" };
const _hoisted_156 = ["value"];
const _hoisted_157 = { class: "cs-candle" };
const _hoisted_158 = ["value"];
const _hoisted_159 = { class: "cs-candle" };
const _hoisted_160 = ["value"];
const _hoisted_161 = { class: "cs-candle" };
const _hoisted_162 = ["value"];
const _hoisted_163 = { class: "cs-candle" };
const _hoisted_164 = ["value"];
const _hoisted_165 = { class: "cs-candle" };
const _hoisted_166 = ["value"];
const _hoisted_167 = { class: "cs-section" };
const _hoisted_168 = { class: "cs-label" };
const _hoisted_169 = { class: "cs-row" };
const _hoisted_170 = ["value"];
const _hoisted_171 = { class: "cs-row" };
const _hoisted_172 = ["value"];
const _hoisted_173 = { class: "cs-section" };
const _hoisted_174 = { class: "cs-label" };
const _hoisted_175 = { class: "cs-row" };
const _hoisted_176 = ["value"];
const _hoisted_177 = { class: "cs-row" };
const _hoisted_178 = ["value"];
const _hoisted_179 = { class: "cs-templates" };
const _hoisted_180 = ["value"];
function _sfc_render(_ctx, _cache, $props, $setup, $data, $options) {
  return _openBlock(), _createElementBlock(
    "div",
    _hoisted_1,
    [
      _createCommentVNode(" Top-left symbol label like TradingView — transparent, only letters with flags "),
      $props.instrument ? (_openBlock(), _createElementBlock("div", _hoisted_2, [
        _createElementVNode("span", _hoisted_3, [
          (_openBlock(true), _createElementBlock(
            _Fragment,
            null,
            _renderList($setup.symbolParts($props.instrument), (part, idx) => {
              return _openBlock(), _createElementBlock(
                _Fragment,
                { key: part },
                [
                  $setup.flagFor(part).type === "flag" ? (_openBlock(), _createElementBlock("img", {
                    key: 0,
                    src: $setup.flagFor(part).value,
                    alt: part,
                    class: "flag-img"
                  }, null, 8, _hoisted_4)) : (_openBlock(), _createElementBlock(
                    "span",
                    _hoisted_5,
                    _toDisplayString($setup.flagFor(part).value),
                    1
                    /* TEXT */
                  )),
                  _createTextVNode(
                    " " + _toDisplayString(part) + " ",
                    1
                    /* TEXT */
                  ),
                  idx === 0 ? (_openBlock(), _createElementBlock("span", _hoisted_6, " / ")) : _createCommentVNode("v-if", true)
                ],
                64
                /* STABLE_FRAGMENT */
              );
            }),
            128
            /* KEYED_FRAGMENT */
          )),
          _createTextVNode(
            " - " + _toDisplayString($props.instrument && $setup.providerOf($props.instrument) === "binance" ? "BINANCE" : "OANDA"),
            1
            /* TEXT */
          )
        ])
      ])) : _createCommentVNode("v-if", true),
      _createCommentVNode(" Indicator legend (TradingView-style): name + eye/settings/remove "),
      $setup.indicators.sessionsAdded && $props.instrument ? (_openBlock(), _createElementBlock("div", _hoisted_7, [
        _createElementVNode(
          "span",
          {
            class: _normalizeClass(["ind-legend-name", { off: !$setup.indicators.sessionsVisible }])
          },
          "Sessions",
          2
          /* CLASS */
        ),
        _createElementVNode("button", {
          class: "ind-legend-btn",
          type: "button",
          title: $setup.indicators.sessionsVisible ? "Hide" : "Show",
          onClick: _cache[0] || (_cache[0] = ($event) => $setup.indicators.sessionsVisible = !$setup.indicators.sessionsVisible)
        }, [
          $setup.indicators.sessionsVisible ? (_openBlock(), _createElementBlock("svg", _hoisted_9, [..._cache[76] || (_cache[76] = [
            _createElementVNode(
              "path",
              { d: "M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z" },
              null,
              -1
              /* CACHED */
            ),
            _createElementVNode(
              "circle",
              {
                cx: "12",
                cy: "12",
                r: "2.6"
              },
              null,
              -1
              /* CACHED */
            )
          ])])) : (_openBlock(), _createElementBlock("svg", _hoisted_10, [..._cache[77] || (_cache[77] = [
            _createElementVNode(
              "path",
              { d: "M2 12s3.5-6.5 10-6.5c2 0 3.7.6 5.1 1.5M22 12s-3.5 6.5-10 6.5c-2 0-3.7-.6-5.1-1.5" },
              null,
              -1
              /* CACHED */
            ),
            _createElementVNode(
              "path",
              { d: "M4 20L20 4" },
              null,
              -1
              /* CACHED */
            )
          ])]))
        ], 8, _hoisted_8),
        _createElementVNode("button", {
          class: "ind-legend-btn",
          type: "button",
          title: "Settings",
          onClick: _cache[1] || (_cache[1] = ($event) => $setup.indSettingsOpen = !$setup.indSettingsOpen)
        }, [..._cache[78] || (_cache[78] = [
          _createElementVNode(
            "svg",
            {
              viewBox: "0 0 24 24",
              width: "13",
              height: "13",
              fill: "none",
              stroke: "currentColor",
              "stroke-width": "1.8",
              "stroke-linecap": "round",
              "stroke-linejoin": "round",
              "aria-hidden": "true"
            },
            [
              _createElementVNode("circle", {
                cx: "12",
                cy: "12",
                r: "3"
              }),
              _createElementVNode("path", { d: "M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h0a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55h0a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v0a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z" })
            ],
            -1
            /* CACHED */
          )
        ])]),
        _createElementVNode("button", {
          class: "ind-legend-btn",
          type: "button",
          title: "Remove",
          onClick: _cache[2] || (_cache[2] = ($event) => $setup.indicators.removeSessions())
        }, [..._cache[79] || (_cache[79] = [
          _createElementVNode(
            "svg",
            {
              viewBox: "0 0 24 24",
              width: "13",
              height: "13",
              fill: "none",
              stroke: "currentColor",
              "stroke-width": "1.8",
              "stroke-linecap": "round",
              "aria-hidden": "true"
            },
            [
              _createElementVNode("path", { d: "M6 6l12 12M18 6L6 18" })
            ],
            -1
            /* CACHED */
          )
        ])]),
        _createCommentVNode(" Settings popup: enable/rename/recolor sessions; built-in windows\n           are chained to real market opens and shown in the VISITOR's own\n           local clock (DST adjusts itself); custom sessions are free. "),
        $setup.indSettingsOpen ? (_openBlock(), _createElementBlock("div", {
          key: 0,
          class: "ind-settings",
          onClick: _cache[8] || (_cache[8] = _withModifiers(() => {
          }, ["stop"]))
        }, [
          _cache[82] || (_cache[82] = _createElementVNode(
            "div",
            { class: "ind-settings-title" },
            "Sessions — settings",
            -1
            /* CACHED */
          )),
          (_openBlock(true), _createElementBlock(
            _Fragment,
            null,
            _renderList($setup.indicators.defs, (s) => {
              return _openBlock(), _createElementBlock("div", {
                key: s.id,
                class: "ind-set-row ind-set-edit"
              }, [
                _withDirectives(_createElementVNode("input", {
                  type: "checkbox",
                  "onUpdate:modelValue": ($event) => $setup.indicators.sessionsEnabled[s.id] = $event
                }, null, 8, _hoisted_11), [
                  [_vModelCheckbox, $setup.indicators.sessionsEnabled[s.id]]
                ]),
                _withDirectives(_createElementVNode("input", {
                  class: "ind-set-color",
                  type: "color",
                  "onUpdate:modelValue": ($event) => s.color = $event,
                  "aria-label": s.id + " color",
                  title: "Color of " + s.name
                }, null, 8, _hoisted_12), [
                  [_vModelText, s.color]
                ]),
                _withDirectives(_createElementVNode("input", {
                  class: "ind-set-name",
                  type: "text",
                  "onUpdate:modelValue": ($event) => s.name = $event,
                  maxlength: "20",
                  "aria-label": s.id + " name"
                }, null, 8, _hoisted_13), [
                  [_vModelText, s.name]
                ]),
                _createElementVNode(
                  "span",
                  _hoisted_14,
                  _toDisplayString($setup.sessionWindowLocal(s)),
                  1
                  /* TEXT */
                ),
                _createElementVNode(
                  "span",
                  _hoisted_15,
                  _toDisplayString(s.city),
                  1
                  /* TEXT */
                )
              ]);
            }),
            128
            /* KEYED_FRAGMENT */
          )),
          (_openBlock(true), _createElementBlock(
            _Fragment,
            null,
            _renderList($setup.indicators.customs, (s) => {
              return _openBlock(), _createElementBlock("div", {
                key: s.id,
                class: "ind-set-row ind-set-edit"
              }, [
                _withDirectives(_createElementVNode("input", {
                  type: "checkbox",
                  "onUpdate:modelValue": ($event) => $setup.indicators.sessionsEnabled[s.id] = $event
                }, null, 8, _hoisted_16), [
                  [_vModelCheckbox, $setup.indicators.sessionsEnabled[s.id]]
                ]),
                _withDirectives(_createElementVNode("input", {
                  class: "ind-set-color",
                  type: "color",
                  "onUpdate:modelValue": ($event) => s.color = $event,
                  "aria-label": s.id + " color",
                  title: "Color of " + s.name
                }, null, 8, _hoisted_17), [
                  [_vModelText, s.color]
                ]),
                _withDirectives(_createElementVNode("input", {
                  class: "ind-set-name",
                  type: "text",
                  "onUpdate:modelValue": ($event) => s.name = $event,
                  maxlength: "20",
                  "aria-label": s.id + " name"
                }, null, 8, _hoisted_18), [
                  [_vModelText, s.name]
                ]),
                _createElementVNode("input", {
                  class: "ind-set-time",
                  type: "time",
                  value: $setup.toTimeStr(s.start),
                  onChange: ($event) => $setup.onCustomTimeChange(s, "start", $event)
                }, null, 40, _hoisted_19),
                _createElementVNode("input", {
                  class: "ind-set-time",
                  type: "time",
                  value: $setup.toTimeStr(s.end),
                  onChange: ($event) => $setup.onCustomTimeChange(s, "end", $event)
                }, null, 40, _hoisted_20),
                _cache[80] || (_cache[80] = _createElementVNode(
                  "span",
                  { class: "ind-set-city" },
                  "Custom",
                  -1
                  /* CACHED */
                )),
                _createElementVNode("button", {
                  class: "ind-set-remove",
                  type: "button",
                  title: "Delete " + s.name,
                  "aria-label": "Delete " + s.name,
                  onClick: ($event) => $setup.indicators.removeCustomSession(s.id)
                }, "✕", 8, _hoisted_21)
              ]);
            }),
            128
            /* KEYED_FRAGMENT */
          )),
          _createCommentVNode(" Add a new custom session (visitor's local clock) "),
          _createElementVNode("div", _hoisted_22, [
            _withDirectives(_createElementVNode(
              "input",
              {
                class: "ind-set-name",
                type: "text",
                "onUpdate:modelValue": _cache[3] || (_cache[3] = ($event) => $setup.newSessName = $event),
                maxlength: "20",
                placeholder: "Session name",
                "aria-label": "New session name"
              },
              null,
              512
              /* NEED_PATCH */
            ), [
              [_vModelText, $setup.newSessName]
            ]),
            _withDirectives(_createElementVNode(
              "input",
              {
                class: "ind-set-color",
                type: "color",
                "onUpdate:modelValue": _cache[4] || (_cache[4] = ($event) => $setup.newSessColor = $event),
                "aria-label": "New session color",
                title: "Color"
              },
              null,
              512
              /* NEED_PATCH */
            ), [
              [_vModelText, $setup.newSessColor]
            ]),
            _withDirectives(_createElementVNode(
              "input",
              {
                class: "ind-set-time",
                type: "time",
                "onUpdate:modelValue": _cache[5] || (_cache[5] = ($event) => $setup.newSessStart = $event),
                "aria-label": "New session start"
              },
              null,
              512
              /* NEED_PATCH */
            ), [
              [_vModelText, $setup.newSessStart]
            ]),
            _withDirectives(_createElementVNode(
              "input",
              {
                class: "ind-set-time",
                type: "time",
                "onUpdate:modelValue": _cache[6] || (_cache[6] = ($event) => $setup.newSessEnd = $event),
                "aria-label": "New session end"
              },
              null,
              512
              /* NEED_PATCH */
            ), [
              [_vModelText, $setup.newSessEnd]
            ]),
            _createElementVNode("button", {
              class: "ind-set-add-btn",
              type: "button",
              title: "Add session",
              onClick: $setup.onAddSession
            }, "+ Add")
          ]),
          _createElementVNode("label", _hoisted_23, [
            _withDirectives(_createElementVNode(
              "input",
              {
                type: "checkbox",
                "onUpdate:modelValue": _cache[7] || (_cache[7] = ($event) => $setup.indicators.sessionsLabels = $event)
              },
              null,
              512
              /* NEED_PATCH */
            ), [
              [_vModelCheckbox, $setup.indicators.sessionsLabels]
            ]),
            _cache[81] || (_cache[81] = _createElementVNode(
              "span",
              null,
              "Show session names",
              -1
              /* CACHED */
            ))
          ])
        ])) : _createCommentVNode("v-if", true)
      ])) : _createCommentVNode("v-if", true),
      $props.isLoading ? (_openBlock(), _createElementBlock("div", _hoisted_24, [..._cache[83] || (_cache[83] = [
        _createElementVNode(
          "span",
          { class: "overlay-spinner large" },
          null,
          -1
          /* CACHED */
        )
      ])])) : $props.error ? (_openBlock(), _createElementBlock(
        "div",
        _hoisted_25,
        "⚠ " + _toDisplayString($props.error),
        1
        /* TEXT */
      )) : $props.candles.length === 0 ? (_openBlock(), _createElementBlock("div", _hoisted_26, [..._cache[84] || (_cache[84] = [
        _createElementVNode(
          "span",
          { class: "overlay-title" },
          "No candles yet — waiting for market data",
          -1
          /* CACHED */
        ),
        _createElementVNode(
          "span",
          { class: "hint" },
          "Check that the market server is running and OANDA credentials are configured. On weekends the market is closed.",
          -1
          /* CACHED */
        )
      ])])) : _createCommentVNode("v-if", true),
      $setup.market.isLoadingMore ? (_openBlock(), _createElementBlock("div", _hoisted_27, "Loading more…")) : _createCommentVNode("v-if", true),
      _createCommentVNode(" TradingView-style countdown: glued to the live-price marker on the\n         right axis. Tracks pan/zoom instantly; hides when price is off-screen\n         or the market is closed. "),
      _createCommentVNode(" Timer label: identical to the native live-price label, stuck\n         directly beneath it on the price scale. "),
      $setup.tagVisible && $props.candles.length > 0 ? (_openBlock(), _createElementBlock("div", {
        key: 6,
        class: "axis-tag",
        style: _normalizeStyle({ top: $setup.timerTop + "px", height: $setup.smallTagH + "px", width: $setup.tagW + "px", right: $setup.tagRight + "px" }),
        title: $setup.marketClosed ? "Forex market is closed" : `Next ${$setup.market.timeframe} candle in`
      }, _toDisplayString($setup.countdown), 13, _hoisted_28)) : _createCommentVNode("v-if", true),
      _createCommentVNode(" Sessions indicator: translucent session background boxes, painted\n         behind the drawings layer (which itself sits behind the candles).\n         Non-interactive. "),
      $setup.sessionPixels.length ? (_openBlock(), _createElementBlock(
        "div",
        {
          key: 7,
          class: "session-layer drawing-clip",
          style: _normalizeStyle({ right: $setup.axisRightW + "px", bottom: $setup.axisBottomH + "px" })
        },
        [
          (_openBlock(true), _createElementBlock(
            _Fragment,
            null,
            _renderList($setup.sessionPixels, (b) => {
              return _openBlock(), _createElementBlock(
                "div",
                {
                  key: b.key,
                  class: "session-box",
                  style: _normalizeStyle({ left: b.left + "px", width: b.width + "px", top: b.top + "px", height: b.height + "px", background: b.color + "26" })
                },
                [
                  b.showLabel ? (_openBlock(), _createElementBlock(
                    "span",
                    {
                      key: 0,
                      class: "session-label",
                      style: _normalizeStyle({ color: b.color, top: b.labelTop + "px" })
                    },
                    _toDisplayString(b.name),
                    5
                    /* TEXT, STYLE */
                  )) : _createCommentVNode("v-if", true)
                ],
                4
                /* STYLE */
              );
            }),
            128
            /* KEYED_FRAGMENT */
          ))
        ],
        4
        /* STYLE */
      )) : _createCommentVNode("v-if", true),
      _createCommentVNode(" Visible drawing layer: z-ordered BEHIND the candle painting, so a\n         small rectangle drawn on a low timeframe never covers candle bodies\n         on coarser timeframes (TradingView-style). Non-interactive. "),
      _createElementVNode(
        "div",
        {
          class: _normalizeClass(["drawing-layer drawing-clip", { "drawing-mode": $setup.drawingToolActive }]),
          style: _normalizeStyle({ right: $setup.axisRightW + "px", bottom: $setup.axisBottomH + "px" })
        },
        [
          (_openBlock(true), _createElementBlock(
            _Fragment,
            null,
            _renderList($setup.rectPixels, (rect) => {
              return _openBlock(), _createElementBlock(
                "div",
                {
                  key: rect.id,
                  class: _normalizeClass(["drawing-rect", { preview: rect.id === "__preview", "border-only": rect.filled === false }]),
                  style: _normalizeStyle({
                    left: rect.left + "px",
                    top: rect.top + "px",
                    width: rect.width + "px",
                    height: rect.height + "px",
                    backgroundColor: rect.filled ? rect.color : "transparent",
                    opacity: rect.filled ? rect.opacity : 1,
                    borderColor: rect.color
                  })
                },
                null,
                6
                /* CLASS, STYLE */
              );
            }),
            128
            /* KEYED_FRAGMENT */
          )),
          _createCommentVNode(" Trendlines render as SVG so they can be any angle. They come AFTER\n           the rectangles in DOM order so a line drawn over a rect body paints\n           on top of it (TradingView-style). "),
          (_openBlock(), _createElementBlock("svg", _hoisted_29, [
            (_openBlock(true), _createElementBlock(
              _Fragment,
              null,
              _renderList($setup.trendPixels, (t) => {
                return _openBlock(), _createElementBlock("line", {
                  key: t.id,
                  x1: t.x1,
                  y1: t.y1,
                  x2: t.x2,
                  y2: t.y2,
                  stroke: t.color,
                  "stroke-width": t.width + (t.selected ? 1 : 0),
                  "stroke-dasharray": $setup.DASH_ARRAY[t.dash] || void 0,
                  "stroke-linecap": "round",
                  opacity: t.id === "__preview" ? 0.8 : 1
                }, null, 8, _hoisted_30);
              }),
              128
              /* KEYED_FRAGMENT */
            ))
          ])),
          _createCommentVNode(" Polylines render on top of trendlines; multi-segment + optional\n           arrowhead on the last corner. "),
          (_openBlock(), _createElementBlock("svg", _hoisted_31, [
            (_openBlock(true), _createElementBlock(
              _Fragment,
              null,
              _renderList($setup.polyPixels, (p) => {
                return _openBlock(), _createElementBlock("g", {
                  key: p.id
                }, [
                  _createElementVNode("polyline", {
                    points: p.pts.map((q) => q.x + "," + q.y).join(" "),
                    fill: "none",
                    stroke: p.color,
                    "stroke-width": p.width + (p.selected ? 1 : 0),
                    "stroke-dasharray": $setup.DASH_ARRAY[p.dash] || void 0,
                    "stroke-linecap": "round",
                    "stroke-linejoin": "round",
                    opacity: p.id === "__preview" ? 0.8 : 1
                  }, null, 8, _hoisted_32),
                  p.arrowTri ? (_openBlock(), _createElementBlock("polygon", {
                    key: 0,
                    points: p.arrowTri,
                    fill: p.color,
                    opacity: p.id === "__preview" ? 0.8 : 1
                  }, null, 8, _hoisted_33)) : _createCommentVNode("v-if", true)
                ]);
              }),
              128
              /* KEYED_FRAGMENT */
            ))
          ])),
          _createCommentVNode(" Long/Short positions: green profit box (entry↔TP) + red loss box\n           (entry↔SL) at 20% opacity, level lines, and 1R..NR reward lines. "),
          (_openBlock(), _createElementBlock("svg", _hoisted_34, [
            (_openBlock(true), _createElementBlock(
              _Fragment,
              null,
              _renderList($setup.posPixels, (p) => {
                return _openBlock(), _createElementBlock("g", {
                  key: p.id
                }, [
                  _createElementVNode("rect", {
                    x: p.left,
                    y: p.profitTop,
                    width: p.width,
                    height: p.profitH,
                    fill: "#26a69a",
                    "fill-opacity": p.preview ? 0.12 : 0.2
                  }, null, 8, _hoisted_35),
                  _createElementVNode("rect", {
                    x: p.left,
                    y: p.lossTop,
                    width: p.width,
                    height: p.lossH,
                    fill: "#ef5350",
                    "fill-opacity": p.preview ? 0.12 : 0.2
                  }, null, 8, _hoisted_36),
                  (_openBlock(true), _createElementBlock(
                    _Fragment,
                    null,
                    _renderList(p.levels, (l) => {
                      return _openBlock(), _createElementBlock("line", {
                        key: l.r,
                        x1: p.left,
                        y1: l.y,
                        x2: p.left + p.width,
                        y2: l.y,
                        stroke: "#26a69a",
                        "stroke-width": "1",
                        "stroke-dasharray": "4 4",
                        opacity: 0.9
                      }, null, 8, _hoisted_37);
                    }),
                    128
                    /* KEYED_FRAGMENT */
                  ))
                ]);
              }),
              128
              /* KEYED_FRAGMENT */
            ))
          ])),
          _createCommentVNode(" One-click lines: horizontal line / horizontal ray / vertical line "),
          (_openBlock(true), _createElementBlock(
            _Fragment,
            null,
            _renderList($setup.singlePixels, (s) => {
              return _openBlock(), _createElementBlock(
                "div",
                {
                  key: s.id,
                  class: _normalizeClass(["single-line", [s.kind, s.dash, { selected: s.selected }]]),
                  style: _normalizeStyle(
                    s.kind === "vline" ? { left: s.x + "px", borderColor: s.color } : { top: s.y + "px", left: s.kind === "hray" ? s.x + "px" : "0px", borderColor: s.color }
                  )
                },
                null,
                6
                /* CLASS, STYLE */
              );
            }),
            128
            /* KEYED_FRAGMENT */
          ))
        ],
        6
        /* CLASS, STYLE */
      ),
      _createCommentVNode(" Interaction layer: invisible duplicates of the same geometry sitting\n         ABOVE the candles, carrying hit-testing, the selection handles and\n         the context-menu target — so a behind-the-candles rectangle stays\n         selectable and resizable. "),
      _createElementVNode(
        "div",
        {
          class: _normalizeClass(["drawing-hit-layer drawing-clip", { "drawing-mode": $setup.drawingToolActive || $setup.replay.picking }]),
          style: _normalizeStyle({ right: $setup.axisRightW + "px", bottom: $setup.axisBottomH + "px" })
        },
        [
          (_openBlock(true), _createElementBlock(
            _Fragment,
            null,
            _renderList($setup.hitRects, (rect) => {
              return _openBlock(), _createElementBlock("div", {
                key: rect.id,
                class: _normalizeClass(["drawing-hit-rect", { selected: rect.selected, "border-only": rect.filled === false }]),
                "data-rect-id": rect.id === "__preview" ? null : rect.id,
                style: _normalizeStyle({
                  left: rect.left + "px",
                  top: rect.top + "px",
                  width: rect.width + "px",
                  height: rect.height + "px"
                }),
                onPointerdown: _withModifiers(($event) => $setup.onRectDragStart($event, rect.id), ["stop"]),
                onClick: _withModifiers(($event) => $setup.onRectClick(rect.id, $event), ["stop"])
              }, [
                _createCommentVNode(" Border-only rectangles: the body is click-transparent (clicks\n             pass to the chart), only the 4 edge strips select/drag. "),
                rect.filled === false ? (_openBlock(), _createElementBlock(
                  _Fragment,
                  { key: 0 },
                  [
                    _createElementVNode("div", {
                      class: "rect-edge-hit top",
                      onPointerdown: _withModifiers(($event) => $setup.onRectDragStart($event, rect.id), ["stop"]),
                      onClick: _withModifiers(($event) => $setup.onRectClick(rect.id, $event), ["stop"])
                    }, null, 40, _hoisted_39),
                    _createElementVNode("div", {
                      class: "rect-edge-hit bottom",
                      onPointerdown: _withModifiers(($event) => $setup.onRectDragStart($event, rect.id), ["stop"]),
                      onClick: _withModifiers(($event) => $setup.onRectClick(rect.id, $event), ["stop"])
                    }, null, 40, _hoisted_40),
                    _createElementVNode("div", {
                      class: "rect-edge-hit left",
                      onPointerdown: _withModifiers(($event) => $setup.onRectDragStart($event, rect.id), ["stop"]),
                      onClick: _withModifiers(($event) => $setup.onRectClick(rect.id, $event), ["stop"])
                    }, null, 40, _hoisted_41),
                    _createElementVNode("div", {
                      class: "rect-edge-hit right",
                      onPointerdown: _withModifiers(($event) => $setup.onRectDragStart($event, rect.id), ["stop"]),
                      onClick: _withModifiers(($event) => $setup.onRectClick(rect.id, $event), ["stop"])
                    }, null, 40, _hoisted_42)
                  ],
                  64
                  /* STABLE_FRAGMENT */
                )) : _createCommentVNode("v-if", true),
                rect.selected ? (_openBlock(), _createElementBlock(
                  _Fragment,
                  { key: 1 },
                  [
                    _createElementVNode(
                      "div",
                      {
                        class: "resize-handle nw",
                        onPointerdown: _cache[9] || (_cache[9] = _withModifiers(($event) => $setup.onResizeStart($event, "nw"), ["stop", "prevent"]))
                      },
                      null,
                      32
                      /* NEED_HYDRATION */
                    ),
                    _createElementVNode(
                      "div",
                      {
                        class: "resize-handle ne",
                        onPointerdown: _cache[10] || (_cache[10] = _withModifiers(($event) => $setup.onResizeStart($event, "ne"), ["stop", "prevent"]))
                      },
                      null,
                      32
                      /* NEED_HYDRATION */
                    ),
                    _createElementVNode(
                      "div",
                      {
                        class: "resize-handle sw",
                        onPointerdown: _cache[11] || (_cache[11] = _withModifiers(($event) => $setup.onResizeStart($event, "sw"), ["stop", "prevent"]))
                      },
                      null,
                      32
                      /* NEED_HYDRATION */
                    ),
                    _createElementVNode(
                      "div",
                      {
                        class: "resize-handle se",
                        onPointerdown: _cache[12] || (_cache[12] = _withModifiers(($event) => $setup.onResizeStart($event, "se"), ["stop", "prevent"]))
                      },
                      null,
                      32
                      /* NEED_HYDRATION */
                    ),
                    _createElementVNode(
                      "div",
                      {
                        class: "resize-handle n",
                        onPointerdown: _cache[13] || (_cache[13] = _withModifiers(($event) => $setup.onResizeStart($event, "n"), ["stop", "prevent"]))
                      },
                      null,
                      32
                      /* NEED_HYDRATION */
                    ),
                    _createElementVNode(
                      "div",
                      {
                        class: "resize-handle s",
                        onPointerdown: _cache[14] || (_cache[14] = _withModifiers(($event) => $setup.onResizeStart($event, "s"), ["stop", "prevent"]))
                      },
                      null,
                      32
                      /* NEED_HYDRATION */
                    ),
                    _createElementVNode(
                      "div",
                      {
                        class: "resize-handle w",
                        onPointerdown: _cache[15] || (_cache[15] = _withModifiers(($event) => $setup.onResizeStart($event, "w"), ["stop", "prevent"]))
                      },
                      null,
                      32
                      /* NEED_HYDRATION */
                    ),
                    _createElementVNode(
                      "div",
                      {
                        class: "resize-handle e",
                        onPointerdown: _cache[16] || (_cache[16] = _withModifiers(($event) => $setup.onResizeStart($event, "e"), ["stop", "prevent"]))
                      },
                      null,
                      32
                      /* NEED_HYDRATION */
                    )
                  ],
                  64
                  /* STABLE_FRAGMENT */
                )) : _createCommentVNode("v-if", true)
              ], 46, _hoisted_38);
            }),
            128
            /* KEYED_FRAGMENT */
          )),
          _createCommentVNode(" Trendline hit-testing sits AFTER the rectangle hit-rects in DOM\n           order: when a line crosses a rectangle body, the line's fat\n           transparent stroke wins the pointer so it stays selectable. "),
          (_openBlock(), _createElementBlock("svg", _hoisted_43, [
            (_openBlock(true), _createElementBlock(
              _Fragment,
              null,
              _renderList($setup.hitTrends, (t) => {
                return _openBlock(), _createElementBlock("g", {
                  key: t.id
                }, [
                  _createElementVNode("line", {
                    x1: t.x1,
                    y1: t.y1,
                    x2: t.x2,
                    y2: t.y2,
                    class: _normalizeClass(["trend-hit", { selected: t.selected }]),
                    stroke: "transparent",
                    "stroke-width": "14",
                    "stroke-linecap": "round",
                    onPointerdown: _withModifiers(($event) => $setup.onTrendDragStart($event, t.id), ["stop"]),
                    onClick: _withModifiers(($event) => $setup.onTrendClick(t.id, $event), ["stop"])
                  }, null, 42, _hoisted_44),
                  t.selected ? (_openBlock(), _createElementBlock(
                    _Fragment,
                    { key: 0 },
                    [
                      _createElementVNode("circle", {
                        cx: t.x1,
                        cy: t.y1,
                        r: "5",
                        class: "trend-handle",
                        onPointerdown: _withModifiers(($event) => $setup.onTrendHandleStart($event, t.id, 1), ["stop", "prevent"])
                      }, null, 40, _hoisted_45),
                      _createElementVNode("circle", {
                        cx: t.x2,
                        cy: t.y2,
                        r: "5",
                        class: "trend-handle",
                        onPointerdown: _withModifiers(($event) => $setup.onTrendHandleStart($event, t.id, 2), ["stop", "prevent"])
                      }, null, 40, _hoisted_46)
                    ],
                    64
                    /* STABLE_FRAGMENT */
                  )) : _createCommentVNode("v-if", true)
                ]);
              }),
              128
              /* KEYED_FRAGMENT */
            ))
          ])),
          _createCommentVNode(" Polyline hit-testing: fat transparent stroke over the whole path\n           plus a handle on every vertex when selected. "),
          (_openBlock(), _createElementBlock("svg", _hoisted_47, [
            (_openBlock(true), _createElementBlock(
              _Fragment,
              null,
              _renderList($setup.hitPolys, (p) => {
                return _openBlock(), _createElementBlock("g", {
                  key: p.id
                }, [
                  _createElementVNode("polyline", {
                    points: p.pts.map((q) => q.x + "," + q.y).join(" "),
                    class: _normalizeClass(["trend-hit", { selected: p.selected }]),
                    fill: "none",
                    stroke: "transparent",
                    "stroke-width": "14",
                    "stroke-linecap": "round",
                    "stroke-linejoin": "round",
                    onPointerdown: _withModifiers(($event) => $setup.onPolyDragStart($event, p.id), ["stop"]),
                    onClick: _withModifiers(($event) => $setup.onPolyClick(p.id, $event), ["stop"])
                  }, null, 42, _hoisted_48),
                  p.selected ? (_openBlock(true), _createElementBlock(
                    _Fragment,
                    { key: 0 },
                    _renderList(p.pts, (q) => {
                      return _openBlock(), _createElementBlock("circle", {
                        key: q.src,
                        cx: q.x,
                        cy: q.y,
                        r: "5",
                        class: "trend-handle",
                        onPointerdown: _withModifiers(($event) => $setup.onPolyVertexStart($event, p.id, q.src), ["stop", "prevent"])
                      }, null, 40, _hoisted_49);
                    }),
                    128
                    /* KEYED_FRAGMENT */
                  )) : _createCommentVNode("v-if", true)
                ]);
              }),
              128
              /* KEYED_FRAGMENT */
            ))
          ])),
          _createCommentVNode(" Long/Short position hit areas: full body (move), the three price\n           level lines (resize entry/TP/SL), the two time edges, and corner\n           handles on every level end. "),
          (_openBlock(true), _createElementBlock(
            _Fragment,
            null,
            _renderList($setup.posPixels, (p) => {
              return _withDirectives((_openBlock(), _createElementBlock("div", {
                key: p.id,
                class: _normalizeClass(["pos-hit", { selected: p.selected }]),
                style: _normalizeStyle({
                  left: p.left + "px",
                  top: Math.min(p.tpY, p.slY) + "px",
                  width: p.width + "px",
                  height: Math.abs(p.slY - p.tpY) + "px"
                }),
                onPointerdown: _withModifiers(($event) => $setup.onPosDragStart($event, p.id), ["stop"]),
                onClick: _withModifiers(($event) => $setup.onPosClick(p.id, $event), ["stop"])
              }, [
                p.selected ? (_openBlock(), _createElementBlock(
                  _Fragment,
                  { key: 0 },
                  [
                    _createElementVNode("div", {
                      class: "pos-level-hit",
                      style: _normalizeStyle({ top: p.tpY - Math.min(p.tpY, p.slY) - 4 + "px" }),
                      onPointerdown: _withModifiers(($event) => $setup.onPosLevelStart($event, p.id, "tp"), ["stop", "prevent"])
                    }, null, 44, _hoisted_51),
                    _createElementVNode("div", {
                      class: "pos-level-hit",
                      style: _normalizeStyle({ top: p.entryY - Math.min(p.tpY, p.slY) - 4 + "px" }),
                      onPointerdown: _withModifiers(($event) => $setup.onPosLevelStart($event, p.id, "entry"), ["stop", "prevent"])
                    }, null, 44, _hoisted_52),
                    _createElementVNode("div", {
                      class: "pos-level-hit",
                      style: _normalizeStyle({ top: p.slY - Math.min(p.tpY, p.slY) - 4 + "px" }),
                      onPointerdown: _withModifiers(($event) => $setup.onPosLevelStart($event, p.id, "sl"), ["stop", "prevent"])
                    }, null, 44, _hoisted_53),
                    _createElementVNode("div", {
                      class: "pos-edge-hit",
                      style: { left: "-3px" },
                      onPointerdown: _withModifiers(($event) => $setup.onPosEdgeStart($event, p.id, "time1"), ["stop", "prevent"])
                    }, null, 40, _hoisted_54),
                    _createElementVNode("div", {
                      class: "pos-edge-hit",
                      style: { right: "-3px" },
                      onPointerdown: _withModifiers(($event) => $setup.onPosEdgeStart($event, p.id, "time2"), ["stop", "prevent"])
                    }, null, 40, _hoisted_55),
                    _createCommentVNode(" corner handles at both ends of each level line: vertical drag\n               resizes the level's price, horizontal drag resizes the width "),
                    (_openBlock(true), _createElementBlock(
                      _Fragment,
                      null,
                      _renderList([
                        { y: p.tpY - Math.min(p.tpY, p.slY), kind: "tp" },
                        { y: p.entryY - Math.min(p.tpY, p.slY), kind: "entry" },
                        { y: p.slY - Math.min(p.tpY, p.slY), kind: "sl" }
                      ], (lvl, li) => {
                        return _openBlock(), _createElementBlock("div", { key: li }, [
                          _createElementVNode("div", {
                            class: "resize-handle pos-handle",
                            style: _normalizeStyle({ top: lvl.y - 4 + "px", left: "-4px" }),
                            onPointerdown: _withModifiers(($event) => $setup.onPosCornerStart($event, p.id, lvl.kind, "time1"), ["stop", "prevent"])
                          }, null, 44, _hoisted_56),
                          _createElementVNode("div", {
                            class: "resize-handle pos-handle",
                            style: _normalizeStyle({ top: lvl.y - 4 + "px", right: "-4px" }),
                            onPointerdown: _withModifiers(($event) => $setup.onPosCornerStart($event, p.id, lvl.kind, "time2"), ["stop", "prevent"])
                          }, null, 44, _hoisted_57)
                        ]);
                      }),
                      128
                      /* KEYED_FRAGMENT */
                    ))
                  ],
                  64
                  /* STABLE_FRAGMENT */
                )) : _createCommentVNode("v-if", true)
              ], 46, _hoisted_50)), [
                [_vShow, p.id !== "__pospreview"]
              ]);
            }),
            128
            /* KEYED_FRAGMENT */
          )),
          _createCommentVNode(" One-click line hit areas: fat invisible strips over each line "),
          (_openBlock(true), _createElementBlock(
            _Fragment,
            null,
            _renderList($setup.singlePixels, (s) => {
              return _openBlock(), _createElementBlock("div", {
                key: "hit-" + s.id,
                class: _normalizeClass(["single-hit", [s.kind, { selected: s.selected }]]),
                style: _normalizeStyle(
                  s.kind === "vline" ? { left: s.x - 4 + "px" } : { top: s.y - 4 + "px", left: s.kind === "hray" ? s.x - 4 + "px" : "0px" }
                ),
                onPointerdown: _withModifiers(($event) => $setup.onSingleDragStart($event, s.kind, s.id), ["stop"]),
                onClick: _withModifiers(($event) => $setup.onSingleClick(s.kind, s.id, $event), ["stop"])
              }, null, 46, _hoisted_58);
            }),
            128
            /* KEYED_FRAGMENT */
          )),
          _createCommentVNode(" One-click line resize corners: middle of hline / middle of vline /\n           left anchor of hray (drags like the trendline end dots) "),
          (_openBlock(true), _createElementBlock(
            _Fragment,
            null,
            _renderList($setup.singlePixels, (s) => {
              return _openBlock(), _createElementBlock(
                _Fragment,
                {
                  key: "hd-" + s.id
                },
                [
                  s.selected ? (_openBlock(), _createElementBlock("div", {
                    key: 0,
                    class: _normalizeClass(["resize-handle single-handle", s.kind]),
                    style: _normalizeStyle({ top: s.hy - 4 + "px", left: s.hx - 4 + "px" }),
                    onPointerdown: _withModifiers(($event) => $setup.onSingleDragStart($event, s.kind, s.id), ["stop", "prevent"])
                  }, null, 46, _hoisted_59)) : _createCommentVNode("v-if", true)
                ],
                64
                /* STABLE_FRAGMENT */
              );
            }),
            128
            /* KEYED_FRAGMENT */
          ))
        ],
        6
        /* CLASS, STYLE */
      ),
      _createCommentVNode(" Position labels: R:R centered on the entry line (always visible);\n         TP/SL % + pips centered on their lines while selected. When the box\n         is narrower than a label the % stats move just INSIDE the box —\n         below the TP line and above the SL line — instead of beside it. "),
      _createElementVNode(
        "div",
        {
          class: "pos-label-layer drawing-clip",
          style: _normalizeStyle({ right: $setup.axisRightW + "px", bottom: $setup.axisBottomH + "px" })
        },
        [
          (_openBlock(true), _createElementBlock(
            _Fragment,
            null,
            _renderList($setup.posPixels, (p) => {
              return _openBlock(), _createElementBlock(
                _Fragment,
                {
                  key: p.id
                },
                [
                  p.id !== "__pospreview" ? (_openBlock(), _createElementBlock(
                    _Fragment,
                    { key: 0 },
                    [
                      _createElementVNode(
                        "span",
                        {
                          class: "pos-label entry",
                          style: _normalizeStyle({ top: p.entryY - 9 + "px", left: p.left + p.width / 2 + "px", transform: "translateX(-50%)" })
                        },
                        _toDisplayString(p.rr.toFixed(1)),
                        5
                        /* TEXT, STYLE */
                      ),
                      p.selected ? (_openBlock(), _createElementBlock(
                        _Fragment,
                        { key: 0 },
                        [
                          _createElementVNode(
                            "span",
                            {
                              class: "pos-label tp",
                              style: _normalizeStyle({
                                top: (p.width >= 140 ? p.tpY - 9 : p.direction === "long" ? p.tpY - 27 : p.tpY + 9) + "px",
                                left: p.left + p.width / 2 + "px",
                                transform: "translateX(-50%)"
                              })
                            },
                            "TP " + _toDisplayString(p.tpPct >= 0 ? "+" : "") + _toDisplayString(p.tpPct.toFixed(2)) + "% · " + _toDisplayString(p.tpPips.toFixed(1)) + " pips",
                            5
                            /* TEXT, STYLE */
                          ),
                          _createElementVNode(
                            "span",
                            {
                              class: "pos-label sl",
                              style: _normalizeStyle({
                                top: (p.width >= 140 ? p.slY - 9 : p.direction === "long" ? p.slY + 9 : p.slY - 27) + "px",
                                left: p.left + p.width / 2 + "px",
                                transform: "translateX(-50%)"
                              })
                            },
                            "SL " + _toDisplayString(p.slPct >= 0 ? "+" : "") + _toDisplayString(p.slPct.toFixed(2)) + "% · " + _toDisplayString(p.slPips.toFixed(1)) + " pips",
                            5
                            /* TEXT, STYLE */
                          )
                        ],
                        64
                        /* STABLE_FRAGMENT */
                      )) : _createCommentVNode("v-if", true),
                      (_openBlock(true), _createElementBlock(
                        _Fragment,
                        null,
                        _renderList(p.levels, (l) => {
                          return _openBlock(), _createElementBlock(
                            "span",
                            {
                              key: l.r,
                              class: "pos-label rline",
                              style: _normalizeStyle({ top: l.y - 9 + "px", left: p.left + p.width + 6 + "px" })
                            },
                            _toDisplayString(l.r),
                            5
                            /* TEXT, STYLE */
                          );
                        }),
                        128
                        /* KEYED_FRAGMENT */
                      ))
                    ],
                    64
                    /* STABLE_FRAGMENT */
                  )) : _createCommentVNode("v-if", true)
                ],
                64
                /* STABLE_FRAGMENT */
              );
            }),
            128
            /* KEYED_FRAGMENT */
          ))
        ],
        4
        /* STYLE */
      ),
      _createCommentVNode(" Axis tags for one-click lines (unclipped so they sit ON the scales):\n         vertical line → time/date tag on the time scale (always); horizontal\n         line / ray → current price tag on the price scale while selected. "),
      _createElementVNode("div", _hoisted_60, [
        (_openBlock(true), _createElementBlock(
          _Fragment,
          null,
          _renderList($setup.singlePixels, (s) => {
            return _openBlock(), _createElementBlock(
              _Fragment,
              {
                key: "tag-" + s.id
              },
              [
                s.kind === "vline" ? (_openBlock(), _createElementBlock(
                  "div",
                  {
                    key: 0,
                    class: _normalizeClass(["single-time-tag", { selected: s.selected }]),
                    style: _normalizeStyle({ left: s.x + "px", bottom: Math.max(2, $setup.axisBottomH / 2 - 9) + "px" })
                  },
                  _toDisplayString($setup.fmtAxisTime(s.time)),
                  7
                  /* TEXT, CLASS, STYLE */
                )) : s.selected ? (_openBlock(), _createElementBlock(
                  "div",
                  {
                    key: 1,
                    class: "single-price-tag",
                    style: _normalizeStyle({ top: s.y - 9 + "px", background: s.color })
                  },
                  _toDisplayString($setup.fmtPrice(s.price, $setup.instrumentPrecision($setup.market.instrument))),
                  5
                  /* TEXT, STYLE */
                )) : _createCommentVNode("v-if", true)
              ],
              64
              /* STABLE_FRAGMENT */
            );
          }),
          128
          /* KEYED_FRAGMENT */
        ))
      ]),
      _createCommentVNode(" Magnet snapping crosshair: replaces the native crosshair while a\n         drawing tool + magnet are active — sticks to candle high/low and\n         shows the snapped price/time on the axes. "),
      $setup.snapXhair && $setup.drawingToolActive && $setup.magnetActive ? (_openBlock(), _createElementBlock(
        _Fragment,
        { key: 8 },
        [
          _createElementVNode(
            "div",
            {
              class: "xhair-line v",
              style: _normalizeStyle({ left: $setup.snapXhair.x + "px", bottom: $setup.axisBottomH + "px" })
            },
            null,
            4
            /* STYLE */
          ),
          _createElementVNode(
            "div",
            {
              class: "xhair-line h",
              style: _normalizeStyle({ top: $setup.snapXhair.y + "px", right: $setup.axisRightW + "px" })
            },
            null,
            4
            /* STYLE */
          ),
          _createElementVNode(
            "div",
            {
              class: "single-price-tag",
              style: _normalizeStyle({ top: $setup.snapXhair.y - 9 + "px", background: "#2962ff" })
            },
            _toDisplayString($setup.snapXhair.priceText),
            5
            /* TEXT, STYLE */
          ),
          _createElementVNode(
            "div",
            {
              class: "single-time-tag",
              style: _normalizeStyle({ left: $setup.snapXhair.x + "px", bottom: Math.max(2, $setup.axisBottomH / 2 - 9) + "px" })
            },
            _toDisplayString($setup.snapXhair.timeText),
            5
            /* TEXT, STYLE */
          )
        ],
        64
        /* STABLE_FRAGMENT */
      )) : _createCommentVNode("v-if", true),
      _createCommentVNode(" Edit panel for selected rectangle "),
      $setup.selectedRect && $setup.editPanelPos ? (_openBlock(), _createElementBlock(
        "div",
        {
          key: 9,
          ref: "editPanelEl",
          class: "rect-edit-panel",
          style: _normalizeStyle({ left: $setup.editPanelPos.x + "px", top: $setup.editPanelPos.y + "px" }),
          onClick: _cache[20] || (_cache[20] = _withModifiers(() => {
          }, ["stop"]))
        },
        [
          _createElementVNode("div", _hoisted_61, [
            (_openBlock(true), _createElementBlock(
              _Fragment,
              null,
              _renderList($setup.drawingsStore.PANEL_COLORS, (c) => {
                return _openBlock(), _createElementBlock("button", {
                  key: c,
                  class: _normalizeClass(["color-swatch", { active: $setup.selectedRect.color === c }]),
                  style: _normalizeStyle({ backgroundColor: c }),
                  onClick: ($event) => $setup.setColorSelected(c)
                }, null, 14, _hoisted_62);
              }),
              128
              /* KEYED_FRAGMENT */
            )),
            _createElementVNode("div", _hoisted_63, [
              _createElementVNode(
                "button",
                {
                  class: _normalizeClass(["color-more", { active: $setup.paletteOpen === "panel" }]),
                  title: "More colors",
                  onClick: _cache[17] || (_cache[17] = _withModifiers(($event) => $setup.togglePalette("panel"), ["stop"]))
                },
                "＋",
                2
                /* CLASS */
              ),
              $setup.paletteOpen === "panel" ? (_openBlock(), _createElementBlock("div", {
                key: 0,
                class: "palette-pop",
                onClick: _cache[18] || (_cache[18] = _withModifiers(() => {
                }, ["stop"]))
              }, [
                (_openBlock(true), _createElementBlock(
                  _Fragment,
                  null,
                  _renderList($setup.drawingsStore.PRESET_COLORS, (c) => {
                    return _openBlock(), _createElementBlock("button", {
                      key: c,
                      class: _normalizeClass(["color-swatch", { active: $setup.selectedRect.color === c }]),
                      style: _normalizeStyle({ backgroundColor: c }),
                      onClick: ($event) => {
                        $setup.setColorSelected(c);
                        $setup.paletteOpen = null;
                      }
                    }, null, 14, _hoisted_64);
                  }),
                  128
                  /* KEYED_FRAGMENT */
                ))
              ])) : _createCommentVNode("v-if", true)
            ])
          ]),
          _cache[87] || (_cache[87] = _createElementVNode(
            "span",
            { class: "panel-divider" },
            null,
            -1
            /* CACHED */
          )),
          _createElementVNode("label", _hoisted_65, [
            _cache[85] || (_cache[85] = _createElementVNode(
              "span",
              { class: "opacity-icon" },
              "◻",
              -1
              /* CACHED */
            )),
            _createElementVNode("input", {
              type: "range",
              class: "opacity-slider",
              min: "0",
              max: "100",
              value: Math.round(($setup.selectedRect.opacity ?? 0.3) * 100),
              onInput: _cache[19] || (_cache[19] = ($event) => $setup.setOpacitySelected(Number($event.target.value) / 100))
            }, null, 40, _hoisted_66),
            _createElementVNode(
              "span",
              _hoisted_67,
              _toDisplayString(Math.round(($setup.selectedRect.opacity ?? 0.3) * 100)) + "%",
              1
              /* TEXT */
            )
          ]),
          _cache[88] || (_cache[88] = _createElementVNode(
            "span",
            { class: "panel-divider" },
            null,
            -1
            /* CACHED */
          )),
          _cache[89] || (_cache[89] = _createElementVNode(
            "span",
            { class: "panel-divider" },
            null,
            -1
            /* CACHED */
          )),
          _createElementVNode("button", {
            class: _normalizeClass(["edit-btn", { off: $setup.selectedRect.filled === false }]),
            title: $setup.selectedRect.filled === false ? "Show background fill" : "Border only (no fill)",
            onClick: $setup.toggleFillSelected
          }, [
            (_openBlock(), _createElementBlock("svg", _hoisted_69, [
              _createElementVNode("rect", {
                x: "2.25",
                y: "3.25",
                width: "11.5",
                height: "9.5",
                rx: "2",
                fill: $setup.selectedRect.filled === false ? "none" : "currentColor",
                "fill-opacity": $setup.selectedRect.filled === false ? 0 : 0.32,
                stroke: "currentColor",
                "stroke-width": "1.5"
              }, null, 8, _hoisted_70)
            ]))
          ], 10, _hoisted_68),
          _createElementVNode("button", {
            class: "edit-btn danger",
            onClick: $setup.deleteSelected,
            title: "Delete rectangle"
          }, [..._cache[86] || (_cache[86] = [
            _createStaticVNode('<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" data-v-364c1f40><path d="M2.75 4.5h10.5" data-v-364c1f40></path><path d="M5.75 4.5V3.4c0-.5.4-.9.9-.9h2.7c.5 0 .9.4.9.9v1.1" data-v-364c1f40></path><path d="M4.4 4.5l.5 7.9c.05.64.57 1.1 1.2 1.1h3.8c.63 0 1.15-.46 1.2-1.1l.5-7.9" data-v-364c1f40></path><path d="M6.7 7.2v3.9M9.3 7.2v3.9" data-v-364c1f40></path></svg>', 1)
          ])])
        ],
        4
        /* STYLE */
      )) : _createCommentVNode("v-if", true),
      _createCommentVNode(" Edit panel for selected trendline (anchored to its right endpoint) "),
      $setup.selectedLine && $setup.linePanelPos ? (_openBlock(), _createElementBlock(
        "div",
        {
          key: 10,
          ref: "linePanelEl",
          class: "rect-edit-panel",
          style: _normalizeStyle({ left: $setup.linePanelPos.x + "px", top: $setup.linePanelPos.y + "px" }),
          onClick: _cache[23] || (_cache[23] = _withModifiers(() => {
          }, ["stop"]))
        },
        [
          _createElementVNode("div", _hoisted_71, [
            (_openBlock(true), _createElementBlock(
              _Fragment,
              null,
              _renderList($setup.drawingsStore.PANEL_COLORS, (c) => {
                return _openBlock(), _createElementBlock("button", {
                  key: c,
                  class: _normalizeClass(["color-swatch", { active: $setup.selectedLine.color === c }]),
                  style: _normalizeStyle({ backgroundColor: c }),
                  onClick: ($event) => $setup.setLineColorSelected(c)
                }, null, 14, _hoisted_72);
              }),
              128
              /* KEYED_FRAGMENT */
            )),
            _createElementVNode("div", _hoisted_73, [
              _createElementVNode(
                "button",
                {
                  class: _normalizeClass(["color-more", { active: $setup.linePaletteOpen }]),
                  title: "More colors",
                  onClick: _cache[21] || (_cache[21] = _withModifiers(($event) => $setup.linePaletteOpen = !$setup.linePaletteOpen, ["stop"]))
                },
                "＋",
                2
                /* CLASS */
              ),
              $setup.linePaletteOpen ? (_openBlock(), _createElementBlock("div", {
                key: 0,
                class: "palette-pop",
                onClick: _cache[22] || (_cache[22] = _withModifiers(() => {
                }, ["stop"]))
              }, [
                (_openBlock(true), _createElementBlock(
                  _Fragment,
                  null,
                  _renderList($setup.drawingsStore.PRESET_COLORS, (c) => {
                    return _openBlock(), _createElementBlock("button", {
                      key: c,
                      class: _normalizeClass(["color-swatch", { active: $setup.selectedLine.color === c }]),
                      style: _normalizeStyle({ backgroundColor: c }),
                      onClick: ($event) => {
                        $setup.setLineColorSelected(c);
                        $setup.linePaletteOpen = false;
                      }
                    }, null, 14, _hoisted_74);
                  }),
                  128
                  /* KEYED_FRAGMENT */
                ))
              ])) : _createCommentVNode("v-if", true)
            ])
          ]),
          _cache[91] || (_cache[91] = _createElementVNode(
            "span",
            { class: "panel-divider" },
            null,
            -1
            /* CACHED */
          )),
          _createElementVNode("div", _hoisted_75, [
            (_openBlock(), _createElementBlock(
              _Fragment,
              null,
              _renderList($setup.DASH_STYLES, (d) => {
                return _createElementVNode("button", {
                  key: d,
                  class: _normalizeClass(["dash-btn", { active: $setup.selectedLine.dash === d }]),
                  title: d.charAt(0).toUpperCase() + d.slice(1),
                  onClick: ($event) => $setup.setLineDashSelected(d)
                }, [
                  _createElementVNode(
                    "span",
                    {
                      class: _normalizeClass(["dash-sample", d])
                    },
                    null,
                    2
                    /* CLASS */
                  )
                ], 10, _hoisted_76);
              }),
              64
              /* STABLE_FRAGMENT */
            ))
          ]),
          _cache[92] || (_cache[92] = _createElementVNode(
            "span",
            { class: "panel-divider" },
            null,
            -1
            /* CACHED */
          )),
          _createElementVNode("button", {
            class: "edit-btn danger",
            onClick: $setup.deleteSelectedLine,
            title: "Delete trendline"
          }, [..._cache[90] || (_cache[90] = [
            _createStaticVNode('<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" data-v-364c1f40><path d="M2.75 4.5h10.5" data-v-364c1f40></path><path d="M5.75 4.5V3.4c0-.5.4-.9.9-.9h2.7c.5 0 .9.4.9.9v1.1" data-v-364c1f40></path><path d="M4.4 4.5l.5 7.9c.05.64.57 1.1 1.2 1.1h3.8c.63 0 1.15-.46 1.2-1.1l.5-7.9" data-v-364c1f40></path><path d="M6.7 7.2v3.9M9.3 7.2v3.9" data-v-364c1f40></path></svg>', 1)
          ])])
        ],
        4
        /* STYLE */
      )) : _createCommentVNode("v-if", true),
      _createCommentVNode(" Edit panel for selected polyline (anchored at its last corner) "),
      $setup.selectedPoly && $setup.polyPanelPos ? (_openBlock(), _createElementBlock(
        "div",
        {
          key: 11,
          ref: "polyPanelEl",
          class: "rect-edit-panel",
          style: _normalizeStyle({ left: $setup.polyPanelPos.x + "px", top: $setup.polyPanelPos.y + "px" }),
          onClick: _cache[26] || (_cache[26] = _withModifiers(() => {
          }, ["stop"]))
        },
        [
          _createElementVNode("div", _hoisted_77, [
            (_openBlock(true), _createElementBlock(
              _Fragment,
              null,
              _renderList($setup.drawingsStore.PANEL_COLORS, (c) => {
                return _openBlock(), _createElementBlock("button", {
                  key: c,
                  class: _normalizeClass(["color-swatch", { active: $setup.selectedPoly.color === c }]),
                  style: _normalizeStyle({ backgroundColor: c }),
                  onClick: ($event) => $setup.setPolyColorSelected(c)
                }, null, 14, _hoisted_78);
              }),
              128
              /* KEYED_FRAGMENT */
            )),
            _createElementVNode("div", _hoisted_79, [
              _createElementVNode(
                "button",
                {
                  class: _normalizeClass(["color-more", { active: $setup.polyPaletteOpen }]),
                  title: "More colors",
                  onClick: _cache[24] || (_cache[24] = _withModifiers(($event) => $setup.polyPaletteOpen = !$setup.polyPaletteOpen, ["stop"]))
                },
                "＋",
                2
                /* CLASS */
              ),
              $setup.polyPaletteOpen ? (_openBlock(), _createElementBlock("div", {
                key: 0,
                class: "palette-pop",
                onClick: _cache[25] || (_cache[25] = _withModifiers(() => {
                }, ["stop"]))
              }, [
                (_openBlock(true), _createElementBlock(
                  _Fragment,
                  null,
                  _renderList($setup.drawingsStore.PRESET_COLORS, (c) => {
                    return _openBlock(), _createElementBlock("button", {
                      key: c,
                      class: _normalizeClass(["color-swatch", { active: $setup.selectedPoly.color === c }]),
                      style: _normalizeStyle({ backgroundColor: c }),
                      onClick: ($event) => {
                        $setup.setPolyColorSelected(c);
                        $setup.polyPaletteOpen = false;
                      }
                    }, null, 14, _hoisted_80);
                  }),
                  128
                  /* KEYED_FRAGMENT */
                ))
              ])) : _createCommentVNode("v-if", true)
            ])
          ]),
          _cache[95] || (_cache[95] = _createElementVNode(
            "span",
            { class: "panel-divider" },
            null,
            -1
            /* CACHED */
          )),
          _createElementVNode("div", _hoisted_81, [
            (_openBlock(), _createElementBlock(
              _Fragment,
              null,
              _renderList($setup.DASH_STYLES, (d) => {
                return _createElementVNode("button", {
                  key: d,
                  class: _normalizeClass(["dash-btn", { active: $setup.selectedPoly.dash === d }]),
                  title: d.charAt(0).toUpperCase() + d.slice(1),
                  onClick: ($event) => $setup.setPolyDashSelected(d)
                }, [
                  _createElementVNode(
                    "span",
                    {
                      class: _normalizeClass(["dash-sample", d])
                    },
                    null,
                    2
                    /* CLASS */
                  )
                ], 10, _hoisted_82);
              }),
              64
              /* STABLE_FRAGMENT */
            ))
          ]),
          _cache[96] || (_cache[96] = _createElementVNode(
            "span",
            { class: "panel-divider" },
            null,
            -1
            /* CACHED */
          )),
          _createElementVNode("button", {
            class: _normalizeClass(["edit-btn", { off: $setup.selectedPoly.arrow === false }]),
            title: $setup.selectedPoly.arrow === false ? "Add arrow on last corner" : "Remove arrow",
            onClick: $setup.toggleArrowSelected
          }, [..._cache[93] || (_cache[93] = [
            _createElementVNode(
              "svg",
              {
                viewBox: "0 0 16 16",
                width: "15",
                height: "15",
                "aria-hidden": "true"
              },
              [
                _createElementVNode("path", {
                  d: "M2.5 12.5 L10.5 6.5",
                  fill: "none",
                  stroke: "currentColor",
                  "stroke-width": "1.6",
                  "stroke-linecap": "round"
                }),
                _createElementVNode("path", {
                  d: "M8.2 4.9 L13.6 4.4 L12.6 9.6 Z",
                  fill: "currentColor",
                  stroke: "none"
                })
              ],
              -1
              /* CACHED */
            )
          ])], 10, _hoisted_83),
          _createElementVNode("button", {
            class: "edit-btn danger",
            onClick: $setup.deleteSelectedPoly,
            title: "Delete polyline"
          }, [..._cache[94] || (_cache[94] = [
            _createStaticVNode('<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" data-v-364c1f40><path d="M2.75 4.5h10.5" data-v-364c1f40></path><path d="M5.75 4.5V3.4c0-.5.4-.9.9-.9h2.7c.5 0 .9.4.9.9v1.1" data-v-364c1f40></path><path d="M4.4 4.5l.5 7.9c.05.64.57 1.1 1.2 1.1h3.8c.63 0 1.15-.46 1.2-1.1l.5-7.9" data-v-364c1f40></path><path d="M6.7 7.2v3.9M9.3 7.2v3.9" data-v-364c1f40></path></svg>', 1)
          ])])
        ],
        4
        /* STYLE */
      )) : _createCommentVNode("v-if", true),
      _createCommentVNode(" Edit panel for the selected Long/Short position "),
      $setup.selectedPos && $setup.posPanelPos ? (_openBlock(), _createElementBlock(
        "div",
        {
          key: 12,
          ref: "posPanelEl",
          class: "rect-edit-panel",
          style: _normalizeStyle({ left: $setup.posPanelPos.x + "px", top: $setup.posPanelPos.y + "px", visibility: $setup.posPanelReady ? "visible" : "hidden" }),
          onClick: _cache[27] || (_cache[27] = _withModifiers(() => {
          }, ["stop"]))
        },
        [
          _createElementVNode("button", {
            class: _normalizeClass(["edit-btn", { off: $setup.selectedPos.showLevels === false }]),
            title: $setup.selectedPos.showLevels === false ? "Show 1R..NR reward lines" : "Hide reward lines",
            onClick: $setup.togglePosLevels
          }, [..._cache[97] || (_cache[97] = [
            _createElementVNode(
              "svg",
              {
                viewBox: "0 0 16 16",
                width: "15",
                height: "15",
                "aria-hidden": "true",
                stroke: "currentColor",
                "stroke-width": "1.4",
                "stroke-linecap": "round"
              },
              [
                _createElementVNode("path", { d: "M3 4.5h10" }),
                _createElementVNode("path", {
                  d: "M3 8h10",
                  "stroke-dasharray": "2.5 2"
                }),
                _createElementVNode("path", {
                  d: "M3 11.5h10",
                  "stroke-dasharray": "2.5 2"
                })
              ],
              -1
              /* CACHED */
            )
          ])], 10, _hoisted_84),
          _createElementVNode("button", {
            class: "edit-btn danger",
            onClick: $setup.deleteSelectedPos,
            title: "Delete position"
          }, [..._cache[98] || (_cache[98] = [
            _createStaticVNode('<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" data-v-364c1f40><path d="M2.75 4.5h10.5" data-v-364c1f40></path><path d="M5.75 4.5V3.4c0-.5.4-.9.9-.9h2.7c.5 0 .9.4.9.9v1.1" data-v-364c1f40></path><path d="M4.4 4.5l.5 7.9c.05.64.57 1.1 1.2 1.1h3.8c.63 0 1.15-.46 1.2-1.1l.5-7.9" data-v-364c1f40></path><path d="M6.7 7.2v3.9M9.3 7.2v3.9" data-v-364c1f40></path></svg>', 1)
          ])])
        ],
        4
        /* STYLE */
      )) : _createCommentVNode("v-if", true),
      _createCommentVNode(" Replay mode: vertical line while picking the start point "),
      $setup.replay.active && $setup.replay.picking ? (_openBlock(), _createElementBlock(
        "div",
        {
          key: 13,
          class: "replay-layer drawing-clip",
          style: _normalizeStyle({ right: $setup.axisRightW + "px", bottom: $setup.axisBottomH + "px" })
        },
        [
          $setup.replayVlX !== null ? (_openBlock(), _createElementBlock(
            "div",
            {
              key: 0,
              class: "replay-vl picking",
              style: _normalizeStyle({ left: $setup.replayVlX + "px" })
            },
            [..._cache[99] || (_cache[99] = [
              _createElementVNode(
                "span",
                { class: "replay-vl-knob" },
                "▶",
                -1
                /* CACHED */
              )
            ])],
            4
            /* STYLE */
          )) : _createCommentVNode("v-if", true)
        ],
        4
        /* STYLE */
      )) : _createCommentVNode("v-if", true),
      _createCommentVNode(" Replay price tag: under the live price label on the price scale "),
      $setup.replayTag ? (_openBlock(), _createElementBlock(
        "div",
        {
          key: 14,
          class: "replay-price-tag",
          style: _normalizeStyle({ top: $setup.replayTag.y + "px" })
        },
        _toDisplayString($setup.replayTag.text),
        5
        /* TEXT, STYLE */
      )) : _createCommentVNode("v-if", true),
      _createCommentVNode(" Demo trading: entry/SL/TP lines for the active symbol's positions\n         and pending orders, with drag strips and price tags on the scale "),
      $setup.demo.active ? (_openBlock(), _createElementBlock(
        _Fragment,
        { key: 15 },
        [
          _createElementVNode(
            "div",
            {
              class: "demo-lines drawing-clip",
              style: _normalizeStyle({ right: $setup.axisRightW + "px", bottom: $setup.axisBottomH + $setup.demoBottomH + "px" })
            },
            [
              (_openBlock(true), _createElementBlock(
                _Fragment,
                null,
                _renderList($setup.demoLines, (l) => {
                  return _openBlock(), _createElementBlock(
                    "div",
                    {
                      key: l.id + l.level,
                      class: _normalizeClass(["demo-line", [l.level, { dashed: l.dashed }]]),
                      style: _normalizeStyle({ top: l.y + "px", background: l.color })
                    },
                    null,
                    6
                    /* CLASS, STYLE */
                  );
                }),
                128
                /* KEYED_FRAGMENT */
              )),
              _createCommentVNode(" Left-edge line labels for open positions AND pending orders:\n             lot + $ loss on the SL line, $ reward + R:R on the TP line "),
              (_openBlock(true), _createElementBlock(
                _Fragment,
                null,
                _renderList($setup.demo.positions.filter((x) => x.symbol === $setup.market.instrument && x.status !== "closed"), (p) => {
                  return _openBlock(), _createElementBlock(
                    _Fragment,
                    {
                      key: "lbl-" + p.id
                    },
                    [
                      (_openBlock(true), _createElementBlock(
                        _Fragment,
                        null,
                        _renderList($setup.demoLines.filter((x) => x.id === p.id), (l) => {
                          return _openBlock(), _createElementBlock(
                            "div",
                            {
                              key: "lbl-" + l.level,
                              class: _normalizeClass(["demo-line-label", l.level]),
                              style: _normalizeStyle({ top: l.y - 10 + "px" })
                            },
                            [
                              l.level === "entry" ? (_openBlock(), _createElementBlock(
                                _Fragment,
                                { key: 0 },
                                [
                                  _createTextVNode(
                                    "ENTRY " + _toDisplayString(p.lot) + " lot",
                                    1
                                    /* TEXT */
                                  )
                                ],
                                64
                                /* STABLE_FRAGMENT */
                              )) : l.level === "sl" ? (_openBlock(), _createElementBlock(
                                _Fragment,
                                { key: 1 },
                                [
                                  _createTextVNode(
                                    "SL " + _toDisplayString(p.lot) + " lot · -$" + _toDisplayString(l.money),
                                    1
                                    /* TEXT */
                                  )
                                ],
                                64
                                /* STABLE_FRAGMENT */
                              )) : l.level === "tp" ? (_openBlock(), _createElementBlock(
                                _Fragment,
                                { key: 2 },
                                [
                                  _createTextVNode(
                                    "TP $" + _toDisplayString(l.money) + " · R:R " + _toDisplayString(l.rr),
                                    1
                                    /* TEXT */
                                  )
                                ],
                                64
                                /* STABLE_FRAGMENT */
                              )) : _createCommentVNode("v-if", true)
                            ],
                            6
                            /* CLASS, STYLE */
                          );
                        }),
                        128
                        /* KEYED_FRAGMENT */
                      ))
                    ],
                    64
                    /* STABLE_FRAGMENT */
                  );
                }),
                128
                /* KEYED_FRAGMENT */
              ))
            ],
            4
            /* STYLE */
          ),
          _createElementVNode(
            "div",
            {
              class: _normalizeClass(["demo-hit-layer", { "drawing-mode": $setup.replay.picking }]),
              style: _normalizeStyle({ right: $setup.axisRightW + "px", bottom: $setup.axisBottomH + $setup.demoBottomH + "px" })
            },
            [
              (_openBlock(true), _createElementBlock(
                _Fragment,
                null,
                _renderList($setup.demoLines, (l) => {
                  return _openBlock(), _createElementBlock("div", {
                    key: "dhit-" + l.id + l.level,
                    class: "demo-line-hit",
                    style: _normalizeStyle({ top: l.y - 4 + "px" }),
                    onPointerdown: _withModifiers(($event) => $setup.onDemoLineDragStart($event, l.id, l.level), ["stop", "prevent"])
                  }, null, 44, _hoisted_85);
                }),
                128
                /* KEYED_FRAGMENT */
              ))
            ],
            6
            /* CLASS, STYLE */
          ),
          _createElementVNode(
            "div",
            {
              class: "demo-tag-layer",
              style: _normalizeStyle({ bottom: $setup.axisBottomH + $setup.demoBottomH + "px" })
            },
            [
              (_openBlock(true), _createElementBlock(
                _Fragment,
                null,
                _renderList($setup.demoLines, (l) => {
                  return _openBlock(), _createElementBlock(
                    _Fragment,
                    {
                      key: "tag-" + l.id + l.level
                    },
                    [
                      l.y >= 9 && l.y <= $setup.demoChartH - 10 ? (_openBlock(), _createElementBlock(
                        "div",
                        {
                          key: 0,
                          class: _normalizeClass(["demo-axis-tag", l.level]),
                          style: _normalizeStyle({ top: l.y - 9 + "px" })
                        },
                        _toDisplayString(l.price.toFixed($setup.prec)),
                        7
                        /* TEXT, CLASS, STYLE */
                      )) : _createCommentVNode("v-if", true)
                    ],
                    64
                    /* STABLE_FRAGMENT */
                  );
                }),
                128
                /* KEYED_FRAGMENT */
              ))
            ],
            4
            /* STYLE */
          )
        ],
        64
        /* STABLE_FRAGMENT */
      )) : _createCommentVNode("v-if", true),
      _createCommentVNode(" Demo money management (compact, top-right, collapsible) "),
      $setup.demo.active ? (_openBlock(), _createElementBlock(
        "div",
        {
          key: 16,
          class: _normalizeClass(["demo-mgr", { mini: $setup.demoMini }])
        },
        [
          _createElementVNode("div", _hoisted_86, [
            !$setup.demoMini ? (_openBlock(), _createElementBlock("span", _hoisted_87, "DEMO")) : _createCommentVNode("v-if", true),
            _createElementVNode("button", {
              class: "demo-mini-btn",
              title: $setup.demoMini ? "Expand" : "Minimize",
              onClick: _cache[28] || (_cache[28] = _withModifiers(($event) => $setup.demoMini = !$setup.demoMini, ["stop"]))
            }, _toDisplayString($setup.demoMini ? "+" : "−"), 9, _hoisted_88)
          ]),
          !$setup.demoMini ? (_openBlock(), _createElementBlock(
            _Fragment,
            { key: 0 },
            [
              _createElementVNode("div", _hoisted_89, [
                _createElementVNode(
                  "button",
                  {
                    class: _normalizeClass(["demo-mode", { active: $setup.demo.sizeMode === "lot" }]),
                    title: "Size by lot (risk $ per SL)",
                    onClick: _cache[29] || (_cache[29] = _withModifiers(($event) => $setup.demo.sizeMode = "lot", ["stop"]))
                  },
                  "Lot",
                  2
                  /* CLASS */
                ),
                _createElementVNode(
                  "button",
                  {
                    class: _normalizeClass(["demo-mode", { active: $setup.demo.sizeMode === "percent" }]),
                    title: "Risk = % of balance",
                    onClick: _cache[30] || (_cache[30] = _withModifiers(($event) => $setup.demo.sizeMode = "percent", ["stop"]))
                  },
                  "%",
                  2
                  /* CLASS */
                ),
                _createElementVNode(
                  "button",
                  {
                    class: _normalizeClass(["demo-mode", { active: $setup.demo.sizeMode === "usd" }]),
                    title: "Risk = entered $ amount",
                    onClick: _cache[31] || (_cache[31] = _withModifiers(($event) => $setup.demo.sizeMode = "usd", ["stop"]))
                  },
                  "$",
                  2
                  /* CLASS */
                )
              ]),
              $setup.demo.sizeMode === "lot" ? (_openBlock(), _createElementBlock("label", _hoisted_90, [
                _cache[100] || (_cache[100] = _createElementVNode(
                  "span",
                  null,
                  "Lot",
                  -1
                  /* CACHED */
                )),
                _withDirectives(_createElementVNode(
                  "input",
                  {
                    type: "number",
                    min: "0.01",
                    step: "0.01",
                    "onUpdate:modelValue": _cache[32] || (_cache[32] = ($event) => $setup.demo.lot = $event)
                  },
                  null,
                  512
                  /* NEED_PATCH */
                ), [
                  [
                    _vModelText,
                    $setup.demo.lot,
                    void 0,
                    { number: true }
                  ]
                ])
              ])) : _createCommentVNode("v-if", true),
              $setup.demo.sizeMode === "usd" ? (_openBlock(), _createElementBlock("label", _hoisted_91, [
                _cache[101] || (_cache[101] = _createElementVNode(
                  "span",
                  null,
                  "Risk $",
                  -1
                  /* CACHED */
                )),
                _withDirectives(_createElementVNode(
                  "input",
                  {
                    type: "number",
                    min: "1",
                    step: "1",
                    "onUpdate:modelValue": _cache[33] || (_cache[33] = ($event) => $setup.demo.riskUsd = $event)
                  },
                  null,
                  512
                  /* NEED_PATCH */
                ), [
                  [
                    _vModelText,
                    $setup.demo.riskUsd,
                    void 0,
                    { number: true }
                  ]
                ])
              ])) : _createCommentVNode("v-if", true),
              $setup.demo.sizeMode === "percent" ? (_openBlock(), _createElementBlock("label", _hoisted_92, [
                _cache[102] || (_cache[102] = _createElementVNode(
                  "span",
                  null,
                  "Risk %",
                  -1
                  /* CACHED */
                )),
                _withDirectives(_createElementVNode(
                  "input",
                  {
                    type: "number",
                    min: "0.1",
                    step: "0.1",
                    "onUpdate:modelValue": _cache[34] || (_cache[34] = ($event) => $setup.demo.riskPct = $event)
                  },
                  null,
                  512
                  /* NEED_PATCH */
                ), [
                  [
                    _vModelText,
                    $setup.demo.riskPct,
                    void 0,
                    { number: true }
                  ]
                ])
              ])) : _createCommentVNode("v-if", true),
              _createElementVNode("div", _hoisted_93, [
                _createElementVNode("button", {
                  class: "dm-btn buy",
                  title: "Buy Limit — lines draw on the chart, then Set",
                  onClick: _cache[35] || (_cache[35] = _withModifiers(($event) => $setup.armDemo("long", "limit"), ["stop"]))
                }, "Buy Lim"),
                _createElementVNode("button", {
                  class: "dm-btn sell",
                  title: "Sell Limit — lines draw on the chart, then Set",
                  onClick: _cache[36] || (_cache[36] = _withModifiers(($event) => $setup.armDemo("short", "limit"), ["stop"]))
                }, "Sell Lim"),
                _createElementVNode("button", {
                  class: "dm-btn buy",
                  title: "Market Buy — lines draw, then Set fills at market",
                  onClick: _cache[37] || (_cache[37] = _withModifiers(($event) => $setup.armDemo("long", "market"), ["stop"]))
                }, "Buy"),
                _createElementVNode("button", {
                  class: "dm-btn sell",
                  title: "Market Sell — lines draw, then Set fills at market",
                  onClick: _cache[38] || (_cache[38] = _withModifiers(($event) => $setup.armDemo("short", "market"), ["stop"]))
                }, "Sell")
              ]),
              $setup.draft ? (_openBlock(), _createElementBlock("div", _hoisted_94, [
                _createElementVNode("button", {
                  class: "dm-btn set",
                  title: "Place the order",
                  onClick: _withModifiers($setup.setDemoDraft, ["stop"])
                }, "Set"),
                _createElementVNode("button", {
                  class: "dm-btn cancel",
                  title: "Cancel",
                  onClick: _withModifiers($setup.cancelDemoDraft, ["stop"])
                }, "✕")
              ])) : _createCommentVNode("v-if", true),
              $setup.demo.error ? (_openBlock(), _createElementBlock(
                "div",
                _hoisted_95,
                _toDisplayString($setup.demo.error),
                1
                /* TEXT */
              )) : _createCommentVNode("v-if", true)
            ],
            64
            /* STABLE_FRAGMENT */
          )) : _createCommentVNode("v-if", true)
        ],
        2
        /* CLASS */
      )) : _createCommentVNode("v-if", true),
      _createCommentVNode(" Replay control panel: when the demo panel is open it sits above\n         it, right of the Open P/L stat "),
      $setup.replay.active ? (_openBlock(), _createElementBlock(
        "div",
        {
          key: 17,
          class: _normalizeClass(["replay-panel", { "demo-shift": $setup.demo.active }]),
          style: _normalizeStyle($setup.demo.active ? { bottom: $setup.demoBottomH + 6 + "px", right: "12px", left: "auto", transform: "none" } : void 0)
        },
        [
          $setup.replay.picking ? (_openBlock(), _createElementBlock(
            _Fragment,
            { key: 0 },
            [
              _cache[103] || (_cache[103] = _createElementVNode(
                "span",
                { class: "replay-hint" },
                "Replay — click a candle to start",
                -1
                /* CACHED */
              )),
              _createElementVNode("button", {
                class: "rp-btn accent",
                title: "Start replay at the line",
                onClick: $setup.togglePlay
              }, "▶"),
              _createElementVNode("button", {
                class: "rp-btn danger",
                title: "Exit replay",
                onClick: $setup.onReplayExit
              }, "✕")
            ],
            64
            /* STABLE_FRAGMENT */
          )) : (_openBlock(), _createElementBlock(
            _Fragment,
            { key: 1 },
            [
              _createElementVNode(
                "button",
                {
                  class: "rp-btn",
                  title: "Step back (hold to repeat)",
                  onPointerdown: _cache[39] || (_cache[39] = _withModifiers(($event) => $setup.holdStep(-1), ["prevent"])),
                  onMouseup: $setup.stopHold,
                  onMouseleave: $setup.stopHold
                },
                "⏮",
                32
                /* NEED_HYDRATION */
              ),
              _createElementVNode("button", {
                class: "rp-btn accent",
                title: $setup.replay.playing ? "Pause" : "Play",
                onClick: $setup.togglePlay
              }, _toDisplayString($setup.replay.playing ? "⏸" : "▶"), 9, _hoisted_96),
              _createElementVNode(
                "button",
                {
                  class: "rp-btn",
                  title: "Step forward (hold to repeat)",
                  onPointerdown: _cache[40] || (_cache[40] = _withModifiers(($event) => $setup.holdStep(1), ["prevent"])),
                  onMouseup: $setup.stopHold,
                  onMouseleave: $setup.stopHold
                },
                "⏭",
                32
                /* NEED_HYDRATION */
              ),
              _cache[104] || (_cache[104] = _createElementVNode(
                "span",
                { class: "rp-sep" },
                null,
                -1
                /* CACHED */
              )),
              (_openBlock(), _createElementBlock(
                _Fragment,
                null,
                _renderList([1, 2, 5, 10], (s) => {
                  return _createElementVNode("button", {
                    key: s,
                    class: _normalizeClass(["rp-btn speed", { active: $setup.replay.speed === s }]),
                    title: `Speed ${s}x`,
                    onClick: ($event) => $setup.replay.speed = s
                  }, _toDisplayString(s) + "x", 11, _hoisted_97);
                }),
                64
                /* STABLE_FRAGMENT */
              )),
              _cache[105] || (_cache[105] = _createElementVNode(
                "span",
                { class: "rp-sep" },
                null,
                -1
                /* CACHED */
              )),
              _createElementVNode("button", {
                class: "rp-btn danger",
                title: "Exit replay",
                onClick: $setup.onReplayExit
              }, "✕")
            ],
            64
            /* STABLE_FRAGMENT */
          ))
        ],
        6
        /* CLASS, STYLE */
      )) : _createCommentVNode("v-if", true),
      _createCommentVNode(" Edit panel for the selected one-click line "),
      $setup.drawingsStore.selectedSingle && $setup.singlePanelPos ? (_openBlock(), _createElementBlock(
        "div",
        {
          key: 18,
          ref: "singlePanelEl",
          class: "rect-edit-panel",
          style: _normalizeStyle({ left: $setup.singlePanelPos.x + "px", top: $setup.singlePanelPos.y + "px", visibility: $setup.singlePanelReady ? "visible" : "hidden" }),
          onClick: _cache[41] || (_cache[41] = _withModifiers(() => {
          }, ["stop"]))
        },
        [
          _createElementVNode("div", _hoisted_98, [
            (_openBlock(true), _createElementBlock(
              _Fragment,
              null,
              _renderList($setup.drawingsStore.PANEL_COLORS, (c) => {
                return _openBlock(), _createElementBlock("button", {
                  key: c,
                  class: _normalizeClass(["color-swatch", { active: $setup.getSingle($setup.drawingsStore.selectedSingle.kind, $setup.drawingsStore.selectedSingle.id)?.color === c }]),
                  style: _normalizeStyle({ backgroundColor: c }),
                  onClick: ($event) => $setup.setSingleColor(c)
                }, null, 14, _hoisted_99);
              }),
              128
              /* KEYED_FRAGMENT */
            ))
          ]),
          _cache[107] || (_cache[107] = _createElementVNode(
            "span",
            { class: "panel-divider" },
            null,
            -1
            /* CACHED */
          )),
          _createElementVNode("div", _hoisted_100, [
            (_openBlock(), _createElementBlock(
              _Fragment,
              null,
              _renderList($setup.DASH_STYLES, (d) => {
                return _createElementVNode("button", {
                  key: d,
                  class: _normalizeClass(["dash-btn", { active: $setup.getSingle($setup.drawingsStore.selectedSingle.kind, $setup.drawingsStore.selectedSingle.id)?.dash === d }]),
                  title: d.charAt(0).toUpperCase() + d.slice(1),
                  onClick: ($event) => $setup.setSingleDash(d)
                }, [
                  _createElementVNode(
                    "span",
                    {
                      class: _normalizeClass(["dash-sample", d])
                    },
                    null,
                    2
                    /* CLASS */
                  )
                ], 10, _hoisted_101);
              }),
              64
              /* STABLE_FRAGMENT */
            ))
          ]),
          _cache[108] || (_cache[108] = _createElementVNode(
            "span",
            { class: "panel-divider" },
            null,
            -1
            /* CACHED */
          )),
          _createElementVNode("button", {
            class: "edit-btn danger",
            onClick: $setup.deleteSelectedSingle,
            title: "Delete line"
          }, [..._cache[106] || (_cache[106] = [
            _createStaticVNode('<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" data-v-364c1f40><path d="M2.75 4.5h10.5" data-v-364c1f40></path><path d="M5.75 4.5V3.4c0-.5.4-.9.9-.9h2.7c.5 0 .9.4.9.9v1.1" data-v-364c1f40></path><path d="M4.4 4.5l.5 7.9c.05.64.57 1.1 1.2 1.1h3.8c.63 0 1.15-.46 1.2-1.1l.5-7.9" data-v-364c1f40></path><path d="M6.7 7.2v3.9M9.3 7.2v3.9" data-v-364c1f40></path></svg>', 1)
          ])])
        ],
        4
        /* STYLE */
      )) : _createCommentVNode("v-if", true),
      _createCommentVNode(" TradingView-style right-click menu on a rectangle "),
      $setup.rectMenu ? (_openBlock(), _createElementBlock(
        "div",
        {
          key: 19,
          ref: "editMenuEl",
          class: "rect-edit-panel rect-context-menu",
          style: _normalizeStyle({ left: $setup.rectMenu.x + "px", top: $setup.rectMenu.y + "px" }),
          onClick: _cache[45] || (_cache[45] = _withModifiers(() => {
          }, ["stop"])),
          onContextmenu: _cache[46] || (_cache[46] = _withModifiers(() => {
          }, ["prevent", "stop"]))
        },
        [
          _createElementVNode("div", _hoisted_102, [
            (_openBlock(true), _createElementBlock(
              _Fragment,
              null,
              _renderList($setup.drawingsStore.PANEL_COLORS, (c) => {
                return _openBlock(), _createElementBlock("button", {
                  key: c,
                  class: _normalizeClass(["color-swatch", { active: $setup.selectedRect?.id === $setup.rectMenu.id && $setup.selectedRect.color === c }]),
                  style: _normalizeStyle({ backgroundColor: c }),
                  onClick: ($event) => $setup.setColorInMenu(c)
                }, null, 14, _hoisted_103);
              }),
              128
              /* KEYED_FRAGMENT */
            )),
            _createElementVNode("div", _hoisted_104, [
              _createElementVNode(
                "button",
                {
                  class: _normalizeClass(["color-more", { active: $setup.paletteOpen === "menu" }]),
                  title: "More colors",
                  onClick: _cache[42] || (_cache[42] = _withModifiers(($event) => $setup.togglePalette("menu"), ["stop"]))
                },
                "＋",
                2
                /* CLASS */
              ),
              $setup.paletteOpen === "menu" ? (_openBlock(), _createElementBlock("div", {
                key: 0,
                class: "palette-pop",
                onClick: _cache[43] || (_cache[43] = _withModifiers(() => {
                }, ["stop"]))
              }, [
                (_openBlock(true), _createElementBlock(
                  _Fragment,
                  null,
                  _renderList($setup.drawingsStore.PRESET_COLORS, (c) => {
                    return _openBlock(), _createElementBlock("button", {
                      key: c,
                      class: _normalizeClass(["color-swatch", { active: $setup.menuRectColor === c }]),
                      style: _normalizeStyle({ backgroundColor: c }),
                      onClick: ($event) => {
                        $setup.setColorInMenu(c);
                        $setup.paletteOpen = null;
                      }
                    }, null, 14, _hoisted_105);
                  }),
                  128
                  /* KEYED_FRAGMENT */
                ))
              ])) : _createCommentVNode("v-if", true)
            ])
          ]),
          _cache[111] || (_cache[111] = _createElementVNode(
            "span",
            { class: "panel-divider" },
            null,
            -1
            /* CACHED */
          )),
          _createElementVNode("label", _hoisted_106, [
            _cache[109] || (_cache[109] = _createElementVNode(
              "span",
              { class: "opacity-icon" },
              "◻",
              -1
              /* CACHED */
            )),
            _createElementVNode("input", {
              type: "range",
              class: "opacity-slider",
              min: "0",
              max: "100",
              value: Math.round($setup.menuRectOpacity * 100),
              onInput: _cache[44] || (_cache[44] = ($event) => $setup.setOpacityInMenu(Number($event.target.value) / 100))
            }, null, 40, _hoisted_107),
            _createElementVNode(
              "span",
              _hoisted_108,
              _toDisplayString(Math.round($setup.menuRectOpacity * 100)) + "%",
              1
              /* TEXT */
            )
          ]),
          _cache[112] || (_cache[112] = _createElementVNode(
            "span",
            { class: "panel-divider" },
            null,
            -1
            /* CACHED */
          )),
          _cache[113] || (_cache[113] = _createElementVNode(
            "span",
            { class: "panel-divider" },
            null,
            -1
            /* CACHED */
          )),
          _createElementVNode("button", {
            class: _normalizeClass(["edit-btn", { off: !$setup.menuRectFilled }]),
            title: $setup.menuRectFilled ? "Border only (no fill)" : "Show background fill",
            onClick: $setup.toggleFillInMenu
          }, [
            (_openBlock(), _createElementBlock("svg", _hoisted_110, [
              _createElementVNode("rect", {
                x: "2.25",
                y: "3.25",
                width: "11.5",
                height: "9.5",
                rx: "2",
                fill: $setup.menuRectFilled ? "currentColor" : "none",
                "fill-opacity": $setup.menuRectFilled ? 0.32 : 0,
                stroke: "currentColor",
                "stroke-width": "1.5"
              }, null, 8, _hoisted_111)
            ]))
          ], 10, _hoisted_109),
          _createElementVNode("button", {
            class: "edit-btn danger",
            onClick: $setup.deleteFromMenu,
            title: "Delete rectangle"
          }, [..._cache[110] || (_cache[110] = [
            _createStaticVNode('<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" data-v-364c1f40><path d="M2.75 4.5h10.5" data-v-364c1f40></path><path d="M5.75 4.5V3.4c0-.5.4-.9.9-.9h2.7c.5 0 .9.4.9.9v1.1" data-v-364c1f40></path><path d="M4.4 4.5l.5 7.9c.05.64.57 1.1 1.2 1.1h3.8c.63 0 1.15-.46 1.2-1.1l.5-7.9" data-v-364c1f40></path><path d="M6.7 7.2v3.9M9.3 7.2v3.9" data-v-364c1f40></path></svg>', 1)
          ])])
        ],
        36
        /* STYLE, NEED_HYDRATION */
      )) : _createCommentVNode("v-if", true),
      _createElementVNode(
        "div",
        {
          ref: "containerRef",
          class: _normalizeClass(["chart-container", { "rect-mode": $setup.drawingToolActive }]),
          onClick: $setup.onChartClick
        },
        null,
        2
        /* CLASS */
      ),
      _createCommentVNode(" Demo positions / history / stats panel (under the chart) "),
      $setup.demo.active ? (_openBlock(), _createElementBlock("div", _hoisted_112, [
        _createElementVNode("div", _hoisted_113, [
          _cache[117] || (_cache[117] = _createElementVNode(
            "span",
            { class: "demo-badge" },
            "DEMO",
            -1
            /* CACHED */
          )),
          _createElementVNode("span", _hoisted_114, [
            _cache[114] || (_cache[114] = _createTextVNode(
              "Balance ",
              -1
              /* CACHED */
            )),
            _createElementVNode(
              "b",
              null,
              _toDisplayString($setup.fmtMoney($setup.demo.balance)),
              1
              /* TEXT */
            )
          ]),
          _createElementVNode("span", _hoisted_115, [
            _cache[115] || (_cache[115] = _createTextVNode(
              "Equity ",
              -1
              /* CACHED */
            )),
            _createElementVNode(
              "b",
              null,
              _toDisplayString($setup.fmtMoney($setup.demo.equity)),
              1
              /* TEXT */
            )
          ]),
          _createElementVNode("span", _hoisted_116, [
            _cache[116] || (_cache[116] = _createTextVNode(
              "Open P/L ",
              -1
              /* CACHED */
            )),
            _createElementVNode(
              "b",
              {
                class: _normalizeClass($setup.pnlClass($setup.demo.unrealized))
              },
              _toDisplayString($setup.fmtMoney($setup.demo.unrealized)),
              3
              /* TEXT, CLASS */
            )
          ]),
          _cache[118] || (_cache[118] = _createElementVNode(
            "span",
            { class: "demo-flex" },
            null,
            -1
            /* CACHED */
          )),
          _createElementVNode("button", {
            class: "demo-reset",
            title: "Reset demo account to $100,000",
            onClick: _cache[47] || (_cache[47] = ($event) => $setup.demo.resetAccount())
          }, "Reset")
        ]),
        _createElementVNode("div", _hoisted_117, [
          _createElementVNode(
            "button",
            {
              class: _normalizeClass(["demo-tab", { active: $setup.demoTab === "positions" }]),
              onClick: _cache[48] || (_cache[48] = ($event) => $setup.demoTab = "positions")
            },
            "Positions (" + _toDisplayString($setup.demo.openPositions.length + $setup.pendingOrders.length) + ")",
            3
            /* TEXT, CLASS */
          ),
          _createElementVNode(
            "button",
            {
              class: _normalizeClass(["demo-tab", { active: $setup.demoTab === "history" }]),
              onClick: _cache[49] || (_cache[49] = ($event) => $setup.demoTab = "history")
            },
            "History (" + _toDisplayString($setup.demo.closedPositions.length) + ")",
            3
            /* TEXT, CLASS */
          ),
          _createElementVNode(
            "button",
            {
              class: _normalizeClass(["demo-tab", { active: $setup.demoTab === "stats" }]),
              onClick: _cache[50] || (_cache[50] = ($event) => $setup.demoTab = "stats")
            },
            "Stats",
            2
            /* CLASS */
          ),
          _cache[119] || (_cache[119] = _createElementVNode(
            "span",
            { class: "demo-flex" },
            null,
            -1
            /* CACHED */
          )),
          $setup.demoTab === "stats" ? (_openBlock(), _createElementBlock(
            _Fragment,
            { key: 0 },
            _renderList(["day", "week", "month", "all"], (p) => {
              return _createElementVNode("button", {
                key: p,
                class: _normalizeClass(["demo-period", { active: $setup.demoPeriod === p }]),
                onClick: ($event) => $setup.demoPeriod = p
              }, _toDisplayString(p === "day" ? "Day" : p === "week" ? "Week" : p === "month" ? "Month" : "All"), 11, _hoisted_118);
            }),
            64
            /* STABLE_FRAGMENT */
          )) : _createCommentVNode("v-if", true)
        ]),
        $setup.demoTab === "positions" ? (_openBlock(), _createElementBlock("div", _hoisted_119, [
          !$setup.demo.openPositions.length && !$setup.pendingOrders.length ? (_openBlock(), _createElementBlock("div", _hoisted_120, "No open positions — place a trade from the toolbar above the chart.")) : _createCommentVNode("v-if", true),
          $setup.demo.openPositions.length ? (_openBlock(), _createElementBlock("table", _hoisted_121, [
            _cache[120] || (_cache[120] = _createElementVNode(
              "thead",
              null,
              [
                _createElementVNode("tr", null, [
                  _createElementVNode("th", null, "Symbol"),
                  _createElementVNode("th", null, "Side"),
                  _createElementVNode("th", null, "Lot"),
                  _createElementVNode("th", null, "Entry"),
                  _createElementVNode("th", null, "SL"),
                  _createElementVNode("th", null, "TP"),
                  _createElementVNode("th", null, "P/L $"),
                  _createElementVNode("th", null, "P/L %"),
                  _createElementVNode("th")
                ])
              ],
              -1
              /* CACHED */
            )),
            _createElementVNode("tbody", null, [
              (_openBlock(true), _createElementBlock(
                _Fragment,
                null,
                _renderList($setup.demo.openPositions, (p) => {
                  return _openBlock(), _createElementBlock("tr", {
                    key: p.id
                  }, [
                    _createElementVNode(
                      "td",
                      null,
                      _toDisplayString(p.symbol.replace("_", "/")),
                      1
                      /* TEXT */
                    ),
                    _createElementVNode(
                      "td",
                      {
                        class: _normalizeClass(p.direction === "long" ? "pos" : "neg")
                      },
                      _toDisplayString(p.direction === "long" ? "LONG" : "SHORT"),
                      3
                      /* TEXT, CLASS */
                    ),
                    _createElementVNode(
                      "td",
                      null,
                      _toDisplayString(p.lot),
                      1
                      /* TEXT */
                    ),
                    _createElementVNode(
                      "td",
                      null,
                      _toDisplayString(p.entry),
                      1
                      /* TEXT */
                    ),
                    _createElementVNode(
                      "td",
                      null,
                      _toDisplayString(p.sl ?? "-"),
                      1
                      /* TEXT */
                    ),
                    _createElementVNode(
                      "td",
                      null,
                      _toDisplayString(p.tp ?? "-"),
                      1
                      /* TEXT */
                    ),
                    _createElementVNode(
                      "td",
                      {
                        class: _normalizeClass($setup.pnlClass($setup.demo.pnlFor(p, p.lastPrice ?? p.entry)))
                      },
                      _toDisplayString($setup.fmtMoney($setup.demo.pnlFor(p, p.lastPrice ?? p.entry))),
                      3
                      /* TEXT, CLASS */
                    ),
                    _createElementVNode(
                      "td",
                      {
                        class: _normalizeClass($setup.pnlClass(((p.lastPrice ?? p.entry) - p.entry) * (p.direction === "long" ? 1 : -1)))
                      },
                      _toDisplayString((((p.lastPrice ?? p.entry) - p.entry) * (p.direction === "long" ? 1 : -1) * 100 / p.entry).toFixed(2)) + "%",
                      3
                      /* TEXT, CLASS */
                    ),
                    _createElementVNode("td", null, [
                      _createElementVNode("button", {
                        class: "demo-close",
                        title: "Close position",
                        onClick: ($event) => $setup.demo.closeAtMarket(p.id)
                      }, "✕", 8, _hoisted_122)
                    ])
                  ]);
                }),
                128
                /* KEYED_FRAGMENT */
              ))
            ])
          ])) : _createCommentVNode("v-if", true),
          $setup.pendingOrders.length ? (_openBlock(), _createElementBlock("table", _hoisted_123, [
            _cache[123] || (_cache[123] = _createElementVNode(
              "thead",
              null,
              [
                _createElementVNode("tr", null, [
                  _createElementVNode("th", {
                    colspan: "6",
                    style: { "text-align": "left" }
                  }, "Pending orders"),
                  _createElementVNode("th"),
                  _createElementVNode("th"),
                  _createElementVNode("th")
                ])
              ],
              -1
              /* CACHED */
            )),
            _createElementVNode("tbody", null, [
              (_openBlock(true), _createElementBlock(
                _Fragment,
                null,
                _renderList($setup.pendingOrders, (p) => {
                  return _openBlock(), _createElementBlock("tr", {
                    key: p.id
                  }, [
                    _createElementVNode(
                      "td",
                      null,
                      _toDisplayString(p.symbol.replace("_", "/")),
                      1
                      /* TEXT */
                    ),
                    _createElementVNode(
                      "td",
                      {
                        class: _normalizeClass(p.direction === "long" ? "pos" : "neg")
                      },
                      _toDisplayString(p.direction === "long" ? "BUY LIM" : "SELL LIM"),
                      3
                      /* TEXT, CLASS */
                    ),
                    _createElementVNode(
                      "td",
                      null,
                      _toDisplayString(p.lot),
                      1
                      /* TEXT */
                    ),
                    _createElementVNode(
                      "td",
                      null,
                      _toDisplayString(p.entry),
                      1
                      /* TEXT */
                    ),
                    _createElementVNode(
                      "td",
                      null,
                      _toDisplayString(p.sl ?? "-"),
                      1
                      /* TEXT */
                    ),
                    _createElementVNode(
                      "td",
                      null,
                      _toDisplayString(p.tp ?? "-"),
                      1
                      /* TEXT */
                    ),
                    _cache[121] || (_cache[121] = _createElementVNode(
                      "td",
                      null,
                      null,
                      -1
                      /* CACHED */
                    )),
                    _cache[122] || (_cache[122] = _createElementVNode(
                      "td",
                      null,
                      null,
                      -1
                      /* CACHED */
                    )),
                    _createElementVNode("td", null, [
                      _createElementVNode("button", {
                        class: "demo-close",
                        title: "Delete pending order",
                        onClick: ($event) => $setup.demo.removePending(p.id)
                      }, "✕", 8, _hoisted_124)
                    ])
                  ]);
                }),
                128
                /* KEYED_FRAGMENT */
              ))
            ])
          ])) : _createCommentVNode("v-if", true)
        ])) : $setup.demoTab === "history" ? (_openBlock(), _createElementBlock("div", _hoisted_125, [
          !$setup.demo.closedPositions.length ? (_openBlock(), _createElementBlock("div", _hoisted_126, "No closed trades yet.")) : (_openBlock(), _createElementBlock("table", _hoisted_127, [
            _cache[124] || (_cache[124] = _createElementVNode(
              "thead",
              null,
              [
                _createElementVNode("tr", null, [
                  _createElementVNode("th", null, "Symbol"),
                  _createElementVNode("th", null, "Side"),
                  _createElementVNode("th", null, "Lot"),
                  _createElementVNode("th", null, "Entry"),
                  _createElementVNode("th", null, "Exit"),
                  _createElementVNode("th", null, "Reason"),
                  _createElementVNode("th", null, "P/L $"),
                  _createElementVNode("th", null, "P/L %"),
                  _createElementVNode("th", null, "Closed")
                ])
              ],
              -1
              /* CACHED */
            )),
            _createElementVNode("tbody", null, [
              (_openBlock(true), _createElementBlock(
                _Fragment,
                null,
                _renderList([...$setup.demo.closedPositions].reverse(), (p) => {
                  return _openBlock(), _createElementBlock("tr", {
                    key: p.id
                  }, [
                    _createElementVNode(
                      "td",
                      null,
                      _toDisplayString(p.symbol.replace("_", "/")),
                      1
                      /* TEXT */
                    ),
                    _createElementVNode(
                      "td",
                      {
                        class: _normalizeClass(p.direction === "long" ? "pos" : "neg")
                      },
                      _toDisplayString(p.direction === "long" ? "LONG" : "SHORT"),
                      3
                      /* TEXT, CLASS */
                    ),
                    _createElementVNode(
                      "td",
                      null,
                      _toDisplayString(p.lot),
                      1
                      /* TEXT */
                    ),
                    _createElementVNode(
                      "td",
                      null,
                      _toDisplayString(p.entry),
                      1
                      /* TEXT */
                    ),
                    _createElementVNode(
                      "td",
                      null,
                      _toDisplayString(p.closePrice),
                      1
                      /* TEXT */
                    ),
                    _createElementVNode(
                      "td",
                      null,
                      _toDisplayString((p.closeReason ?? "").toUpperCase()),
                      1
                      /* TEXT */
                    ),
                    _createElementVNode(
                      "td",
                      {
                        class: _normalizeClass($setup.pnlClass(p.pnl))
                      },
                      _toDisplayString($setup.fmtMoney(p.pnl ?? 0)),
                      3
                      /* TEXT, CLASS */
                    ),
                    _createElementVNode(
                      "td",
                      {
                        class: _normalizeClass($setup.pnlClass(p.pnlPct))
                      },
                      _toDisplayString((p.pnlPct ?? 0) >= 0 ? "+" : "") + _toDisplayString((p.pnlPct ?? 0).toFixed(2)) + "%",
                      3
                      /* TEXT, CLASS */
                    ),
                    _createElementVNode(
                      "td",
                      null,
                      _toDisplayString(p.closeTime ? new Date(p.closeTime * 1e3).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : ""),
                      1
                      /* TEXT */
                    )
                  ]);
                }),
                128
                /* KEYED_FRAGMENT */
              ))
            ])
          ]))
        ])) : (_openBlock(), _createElementBlock("div", _hoisted_128, [
          _createElementVNode("div", _hoisted_129, [
            _createElementVNode("div", _hoisted_130, [
              _cache[125] || (_cache[125] = _createElementVNode(
                "span",
                null,
                "Trades",
                -1
                /* CACHED */
              )),
              _createElementVNode(
                "b",
                null,
                _toDisplayString($setup.demoSummary.trades),
                1
                /* TEXT */
              )
            ]),
            _createElementVNode("div", _hoisted_131, [
              _cache[126] || (_cache[126] = _createElementVNode(
                "span",
                null,
                "Wins",
                -1
                /* CACHED */
              )),
              _createElementVNode(
                "b",
                null,
                _toDisplayString($setup.demoSummary.wins),
                1
                /* TEXT */
              )
            ]),
            _createElementVNode("div", _hoisted_132, [
              _cache[127] || (_cache[127] = _createElementVNode(
                "span",
                null,
                "Winrate",
                -1
                /* CACHED */
              )),
              _createElementVNode(
                "b",
                null,
                _toDisplayString($setup.demoSummary.winrate) + "%",
                1
                /* TEXT */
              )
            ]),
            _createElementVNode("div", _hoisted_133, [
              _cache[128] || (_cache[128] = _createElementVNode(
                "span",
                null,
                "Profit factor",
                -1
                /* CACHED */
              )),
              _createElementVNode(
                "b",
                null,
                _toDisplayString($setup.demoSummary.profitFactor ?? "-"),
                1
                /* TEXT */
              )
            ]),
            _createElementVNode("div", _hoisted_134, [
              _createElementVNode(
                "span",
                {
                  class: _normalizeClass($setup.pnlClass($setup.demoSummary.profit))
                },
                "P/L %",
                2
                /* CLASS */
              ),
              _createElementVNode(
                "b",
                {
                  class: _normalizeClass($setup.pnlClass($setup.demoSummary.profit))
                },
                _toDisplayString($setup.demoSummary.profitPct >= 0 ? "+" : "") + _toDisplayString($setup.demoSummary.profitPct.toFixed(2)) + "%",
                3
                /* TEXT, CLASS */
              )
            ]),
            _createElementVNode("div", _hoisted_135, [
              _cache[129] || (_cache[129] = _createElementVNode(
                "span",
                null,
                "Gross profit",
                -1
                /* CACHED */
              )),
              _createElementVNode(
                "b",
                _hoisted_136,
                _toDisplayString($setup.fmtMoney($setup.demoSummary.grossProfit)),
                1
                /* TEXT */
              )
            ]),
            _createElementVNode("div", _hoisted_137, [
              _cache[130] || (_cache[130] = _createElementVNode(
                "span",
                null,
                "Gross loss",
                -1
                /* CACHED */
              )),
              _createElementVNode(
                "b",
                _hoisted_138,
                _toDisplayString($setup.fmtMoney($setup.demoSummary.grossLoss)),
                1
                /* TEXT */
              )
            ]),
            _createElementVNode("div", _hoisted_139, [
              _cache[131] || (_cache[131] = _createElementVNode(
                "span",
                null,
                "Symbols",
                -1
                /* CACHED */
              )),
              _createElementVNode(
                "b",
                null,
                _toDisplayString($setup.demo.tradedSymbols.length),
                1
                /* TEXT */
              )
            ])
          ])
        ]))
      ])) : _createCommentVNode("v-if", true),
      _createCommentVNode(" Chart settings: TradingView-style gear in the bottom-right corner +\n         a centered panel for background (solid/gradient) and candle colors "),
      _createElementVNode(
        "button",
        {
          class: "chart-settings-btn",
          type: "button",
          title: "Chart settings",
          "aria-label": "Chart settings",
          style: _normalizeStyle({ right: "0px", bottom: "0px", width: $setup.axisRightW + "px", height: $setup.axisBottomH + "px" }),
          onClick: _cache[51] || (_cache[51] = ($event) => $setup.chartSettingsOpen = !$setup.chartSettingsOpen)
        },
        [..._cache[132] || (_cache[132] = [
          _createElementVNode(
            "svg",
            {
              viewBox: "0 0 24 24",
              width: "15",
              height: "15",
              fill: "none",
              stroke: "currentColor",
              "stroke-width": "1.9",
              "stroke-linecap": "round",
              "stroke-linejoin": "round",
              "aria-hidden": "true"
            },
            [
              _createElementVNode("circle", {
                cx: "12",
                cy: "12",
                r: "3"
              }),
              _createElementVNode("path", { d: "M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h0a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55h0a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v0a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z" })
            ],
            -1
            /* CACHED */
          )
        ])],
        4
        /* STYLE */
      ),
      $setup.chartSettingsOpen ? (_openBlock(), _createElementBlock(
        _Fragment,
        { key: 21 },
        [
          _createElementVNode("div", {
            class: "chart-settings-backdrop",
            onClick: _cache[52] || (_cache[52] = ($event) => $setup.chartSettingsOpen = false)
          }),
          _createElementVNode("div", _hoisted_140, [
            _createElementVNode("div", _hoisted_141, [
              _cache[133] || (_cache[133] = _createElementVNode(
                "span",
                { class: "cs-title" },
                "Chart settings",
                -1
                /* CACHED */
              )),
              _createElementVNode("button", {
                class: "cs-close",
                type: "button",
                "aria-label": "Close",
                onClick: _cache[53] || (_cache[53] = ($event) => $setup.chartSettingsOpen = false)
              }, "✕")
            ]),
            _createElementVNode("div", _hoisted_142, [
              _createElementVNode("div", _hoisted_143, [
                _cache[134] || (_cache[134] = _createTextVNode(
                  " Background ",
                  -1
                  /* CACHED */
                )),
                _createElementVNode("button", {
                  class: "cs-theme-btn",
                  type: "button",
                  title: "Follow theme",
                  onClick: _cache[54] || (_cache[54] = ($event) => $setup.resetGroup("bg"))
                }, "⟲ theme")
              ]),
              _createElementVNode("div", _hoisted_144, [
                _cache[135] || (_cache[135] = _createElementVNode(
                  "span",
                  { class: "cs-cap" },
                  "Type",
                  -1
                  /* CACHED */
                )),
                _createElementVNode("div", _hoisted_145, [
                  _createElementVNode(
                    "button",
                    {
                      class: _normalizeClass(["cs-mode", { on: $setup.chartStyle.bgMode === "solid" }]),
                      type: "button",
                      onClick: _cache[55] || (_cache[55] = ($event) => $setup.chartStyle.bgMode = "solid")
                    },
                    "Solid",
                    2
                    /* CLASS */
                  ),
                  _createElementVNode(
                    "button",
                    {
                      class: _normalizeClass(["cs-mode", { on: $setup.chartStyle.bgMode === "gradient" }]),
                      type: "button",
                      onClick: _cache[56] || (_cache[56] = ($event) => $setup.chartStyle.bgMode = "gradient")
                    },
                    "Gradient",
                    2
                    /* CLASS */
                  )
                ])
              ]),
              $setup.chartStyle.bgMode === "solid" ? (_openBlock(), _createElementBlock("div", _hoisted_146, [
                _cache[136] || (_cache[136] = _createElementVNode(
                  "span",
                  { class: "cs-cap" },
                  "Color",
                  -1
                  /* CACHED */
                )),
                _createElementVNode("input", {
                  type: "color",
                  value: $setup.eff($setup.chartStyle.bgSolid, $setup.themeBgPair()[0]),
                  onInput: _cache[57] || (_cache[57] = ($event) => $setup.setColor("bgSolid", $event)),
                  "aria-label": "Background color"
                }, null, 40, _hoisted_147)
              ])) : _createCommentVNode("v-if", true),
              $setup.chartStyle.bgMode === "gradient" ? (_openBlock(), _createElementBlock(
                _Fragment,
                { key: 1 },
                [
                  _createElementVNode("div", _hoisted_148, [
                    _cache[137] || (_cache[137] = _createElementVNode(
                      "span",
                      { class: "cs-cap" },
                      "Top",
                      -1
                      /* CACHED */
                    )),
                    _createElementVNode("input", {
                      type: "color",
                      value: $setup.eff($setup.chartStyle.bgTop, $setup.themeBgPair()[0]),
                      onInput: _cache[58] || (_cache[58] = ($event) => $setup.setColor("bgTop", $event)),
                      "aria-label": "Gradient top color"
                    }, null, 40, _hoisted_149)
                  ]),
                  _createElementVNode("div", _hoisted_150, [
                    _cache[138] || (_cache[138] = _createElementVNode(
                      "span",
                      { class: "cs-cap" },
                      "Bottom",
                      -1
                      /* CACHED */
                    )),
                    _createElementVNode("input", {
                      type: "color",
                      value: $setup.eff($setup.chartStyle.bgBottom, $setup.themeBgPair()[1]),
                      onInput: _cache[59] || (_cache[59] = ($event) => $setup.setColor("bgBottom", $event)),
                      "aria-label": "Gradient bottom color"
                    }, null, 40, _hoisted_151)
                  ]),
                  _createElementVNode(
                    "div",
                    {
                      class: "cs-preview",
                      style: _normalizeStyle({ background: `linear-gradient(180deg, ${$setup.eff($setup.chartStyle.bgTop, $setup.themeBgPair()[0])} 0%, ${$setup.eff($setup.chartStyle.bgBottom, $setup.themeBgPair()[1])} 100%)` })
                    },
                    null,
                    4
                    /* STYLE */
                  )
                ],
                64
                /* STABLE_FRAGMENT */
              )) : _createCommentVNode("v-if", true)
            ]),
            _createElementVNode("div", _hoisted_152, [
              _createElementVNode("div", _hoisted_153, [
                _cache[139] || (_cache[139] = _createTextVNode(
                  " Candles ",
                  -1
                  /* CACHED */
                )),
                _createElementVNode("button", {
                  class: "cs-theme-btn",
                  type: "button",
                  title: "Follow theme",
                  onClick: _cache[60] || (_cache[60] = ($event) => $setup.resetGroup("candles"))
                }, "⟲ theme")
              ]),
              _createElementVNode("div", _hoisted_154, [
                _createElementVNode("label", _hoisted_155, [
                  _createElementVNode("input", {
                    type: "color",
                    value: $setup.eff($setup.chartStyle.up, $setup.DEFAULT_CANDLES.up),
                    onInput: _cache[61] || (_cache[61] = ($event) => $setup.setColor("up", $event))
                  }, null, 40, _hoisted_156),
                  _cache[140] || (_cache[140] = _createElementVNode(
                    "span",
                    null,
                    "Body ▲",
                    -1
                    /* CACHED */
                  ))
                ]),
                _createElementVNode("label", _hoisted_157, [
                  _createElementVNode("input", {
                    type: "color",
                    value: $setup.eff($setup.chartStyle.down, $setup.DEFAULT_CANDLES.down),
                    onInput: _cache[62] || (_cache[62] = ($event) => $setup.setColor("down", $event))
                  }, null, 40, _hoisted_158),
                  _cache[141] || (_cache[141] = _createElementVNode(
                    "span",
                    null,
                    "Body ▼",
                    -1
                    /* CACHED */
                  ))
                ]),
                _createElementVNode("label", _hoisted_159, [
                  _createElementVNode("input", {
                    type: "color",
                    value: $setup.eff($setup.chartStyle.borderUp, $setup.DEFAULT_CANDLES.borderUp),
                    onInput: _cache[63] || (_cache[63] = ($event) => $setup.setColor("borderUp", $event))
                  }, null, 40, _hoisted_160),
                  _cache[142] || (_cache[142] = _createElementVNode(
                    "span",
                    null,
                    "Border ▲",
                    -1
                    /* CACHED */
                  ))
                ]),
                _createElementVNode("label", _hoisted_161, [
                  _createElementVNode("input", {
                    type: "color",
                    value: $setup.eff($setup.chartStyle.borderDown, $setup.DEFAULT_CANDLES.borderDown),
                    onInput: _cache[64] || (_cache[64] = ($event) => $setup.setColor("borderDown", $event))
                  }, null, 40, _hoisted_162),
                  _cache[143] || (_cache[143] = _createElementVNode(
                    "span",
                    null,
                    "Border ▼",
                    -1
                    /* CACHED */
                  ))
                ]),
                _createElementVNode("label", _hoisted_163, [
                  _createElementVNode("input", {
                    type: "color",
                    value: $setup.eff($setup.chartStyle.wickUp, $setup.DEFAULT_CANDLES.wickUp),
                    onInput: _cache[65] || (_cache[65] = ($event) => $setup.setColor("wickUp", $event))
                  }, null, 40, _hoisted_164),
                  _cache[144] || (_cache[144] = _createElementVNode(
                    "span",
                    null,
                    "Wick ▲",
                    -1
                    /* CACHED */
                  ))
                ]),
                _createElementVNode("label", _hoisted_165, [
                  _createElementVNode("input", {
                    type: "color",
                    value: $setup.eff($setup.chartStyle.wickDown, $setup.DEFAULT_CANDLES.wickDown),
                    onInput: _cache[66] || (_cache[66] = ($event) => $setup.setColor("wickDown", $event))
                  }, null, 40, _hoisted_166),
                  _cache[145] || (_cache[145] = _createElementVNode(
                    "span",
                    null,
                    "Wick ▼",
                    -1
                    /* CACHED */
                  ))
                ])
              ])
            ]),
            _createElementVNode("div", _hoisted_167, [
              _createElementVNode("div", _hoisted_168, [
                _cache[146] || (_cache[146] = _createTextVNode(
                  " Price & time scale ",
                  -1
                  /* CACHED */
                )),
                _createElementVNode("button", {
                  class: "cs-theme-btn",
                  type: "button",
                  title: "Follow theme",
                  onClick: _cache[67] || (_cache[67] = ($event) => $setup.resetGroup("scales"))
                }, "⟲ theme")
              ]),
              _createElementVNode("div", _hoisted_169, [
                _cache[147] || (_cache[147] = _createElementVNode(
                  "span",
                  { class: "cs-cap" },
                  "Text",
                  -1
                  /* CACHED */
                )),
                _createElementVNode("input", {
                  type: "color",
                  value: $setup.eff($setup.chartStyle.axisText, $setup.themeAxisPair()[0]),
                  onInput: _cache[68] || (_cache[68] = ($event) => $setup.setColor("axisText", $event)),
                  "aria-label": "Axis text color"
                }, null, 40, _hoisted_170)
              ]),
              _createElementVNode("div", _hoisted_171, [
                _cache[148] || (_cache[148] = _createElementVNode(
                  "span",
                  { class: "cs-cap" },
                  "Border",
                  -1
                  /* CACHED */
                )),
                _createElementVNode("input", {
                  type: "color",
                  value: $setup.eff($setup.chartStyle.axisBorder, $setup.themeAxisPair()[1]),
                  onInput: _cache[69] || (_cache[69] = ($event) => $setup.setColor("axisBorder", $event)),
                  "aria-label": "Axis border color"
                }, null, 40, _hoisted_172)
              ])
            ]),
            _createElementVNode("div", _hoisted_173, [
              _createElementVNode("div", _hoisted_174, [
                _cache[149] || (_cache[149] = _createTextVNode(
                  " Crosshair ",
                  -1
                  /* CACHED */
                )),
                _createElementVNode("button", {
                  class: "cs-theme-btn",
                  type: "button",
                  title: "Follow theme",
                  onClick: _cache[70] || (_cache[70] = ($event) => $setup.resetGroup("cross"))
                }, "⟲ theme")
              ]),
              _createElementVNode("div", _hoisted_175, [
                _cache[150] || (_cache[150] = _createElementVNode(
                  "span",
                  { class: "cs-cap" },
                  "Vertical",
                  -1
                  /* CACHED */
                )),
                _createElementVNode("input", {
                  type: "color",
                  value: $setup.eff($setup.chartStyle.crossVert, "#758696"),
                  onInput: _cache[71] || (_cache[71] = ($event) => $setup.setColor("crossVert", $event)),
                  "aria-label": "Crosshair vertical color"
                }, null, 40, _hoisted_176)
              ]),
              _createElementVNode("div", _hoisted_177, [
                _cache[151] || (_cache[151] = _createElementVNode(
                  "span",
                  { class: "cs-cap" },
                  "Horizontal",
                  -1
                  /* CACHED */
                )),
                _createElementVNode("input", {
                  type: "color",
                  value: $setup.eff($setup.chartStyle.crossHorz, "#758696"),
                  onInput: _cache[72] || (_cache[72] = ($event) => $setup.setColor("crossHorz", $event)),
                  "aria-label": "Crosshair horizontal color"
                }, null, 40, _hoisted_178)
              ])
            ]),
            _createElementVNode("div", _hoisted_179, [
              _createElementVNode("button", {
                class: "cs-reset",
                type: "button",
                title: "Apply the theme defaults",
                onClick: _cache[73] || (_cache[73] = ($event) => {
                  $setup.resetChartStyle();
                  $setup.selectedTpl = "";
                })
              }, "Defaults"),
              $setup.templates.length ? _withDirectives((_openBlock(), _createElementBlock(
                "select",
                {
                  key: 0,
                  class: "cs-select",
                  "onUpdate:modelValue": _cache[74] || (_cache[74] = ($event) => $setup.selectedTpl = $event),
                  onChange: $setup.applyTemplate,
                  "aria-label": "Saved templates"
                },
                [
                  _cache[152] || (_cache[152] = _createElementVNode(
                    "option",
                    {
                      value: "",
                      disabled: ""
                    },
                    "Templates…",
                    -1
                    /* CACHED */
                  )),
                  (_openBlock(true), _createElementBlock(
                    _Fragment,
                    null,
                    _renderList($setup.templates, (t) => {
                      return _openBlock(), _createElementBlock("option", {
                        key: t.name,
                        value: t.name
                      }, _toDisplayString(t.name), 9, _hoisted_180);
                    }),
                    128
                    /* KEYED_FRAGMENT */
                  ))
                ],
                544
                /* NEED_HYDRATION, NEED_PATCH */
              )), [
                [_vModelSelect, $setup.selectedTpl]
              ]) : _createCommentVNode("v-if", true),
              $setup.templates.length && $setup.selectedTpl ? (_openBlock(), _createElementBlock("button", {
                key: 1,
                class: "cs-del",
                type: "button",
                title: "Delete template",
                onClick: $setup.deleteTemplate
              }, "🗑")) : _createCommentVNode("v-if", true),
              _withDirectives(_createElementVNode(
                "input",
                {
                  class: "cs-tpl-name",
                  "onUpdate:modelValue": _cache[75] || (_cache[75] = ($event) => $setup.tplName = $event),
                  maxlength: "24",
                  placeholder: "Template name",
                  "aria-label": "Template name"
                },
                null,
                512
                /* NEED_PATCH */
              ), [
                [_vModelText, $setup.tplName]
              ]),
              _createElementVNode("button", {
                class: "cs-save",
                type: "button",
                title: "Save current colors as a template",
                onClick: $setup.saveTemplate
              }, "Save as")
            ])
          ])
        ],
        64
        /* STABLE_FRAGMENT */
      )) : _createCommentVNode("v-if", true)
    ],
    512
    /* NEED_PATCH */
  );
}
import "/src/components/ChartPane.vue?vue&type=style&index=0&scoped=364c1f40&lang.css";
_sfc_main.__hmrId = "364c1f40";
typeof __VUE_HMR_RUNTIME__ !== "undefined" && __VUE_HMR_RUNTIME__.createRecord(_sfc_main.__hmrId, _sfc_main);
import.meta.hot.on("file-changed", ({ file }) => {
  __VUE_HMR_RUNTIME__.CHANGED_FILE = file;
});
import.meta.hot.accept((mod) => {
  if (!mod) return;
  const { default: updated, _rerender_only } = mod;
  if (_rerender_only) {
    __VUE_HMR_RUNTIME__.rerender(updated.__hmrId, updated.render);
  } else {
    __VUE_HMR_RUNTIME__.reload(updated.__hmrId, updated);
  }
});
import _export_sfc from "/@id/__x00__plugin-vue:export-helper";
export default /* @__PURE__ */ _export_sfc(_sfc_main, [["render", _sfc_render], ["__scopeId", "data-v-364c1f40"], ["__file", "C:/Users/AFRAA/Desktop/TraderKomak.ir/traderkomak/apps/web/src/components/ChartPane.vue"]]);

//# sourceMappingURL=data:application/json;base64,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VSx3Q0FBeEI7QUFBQSxnQkFHUztBQUFBO0FBQUE7a0JBSHVCLE9BQU07QUFBQSxpRkFBcUIscUJBQVc7QUFBQSxrQkFBRyxVQUFRO0FBQUEsa0JBQWUsY0FBVztBQUFBOztnREFDekc7QUFBQSxvQkFBNkM7QUFBQTtBQUFBLHNCQUFyQyxPQUFNO0FBQUEsc0JBQUc7QUFBQTtvQkFBUztBQUFBLG9CQUFVO0FBQUE7QUFBQTtBQUFBLHFDQUNwQztBQUFBLG9CQUFrRjtBQUFBO0FBQUEsZ0NBQTlELGtCQUFTLENBQWQsTUFBQzsyQ0FBaEIsb0JBQWtGO0FBQUEsd0JBQWxELEtBQUssRUFBRTtBQUFBLHdCQUFPLE9BQU8sRUFBRTtBQUFBLDBDQUFTLEVBQUUsSUFBSTtBQUFBOzs7Ozs7OztnQ0FGYixrQkFBVztBQUFBO2NBSXhELGlCQUFVLFVBQVUsb0NBQWxDLG9CQUF1STtBQUFBO2dCQUF4RixPQUFNO0FBQUEsZ0JBQVMsTUFBSztBQUFBLGdCQUFTLE9BQU07QUFBQSxnQkFBbUIsU0FBTztBQUFBLGlCQUFnQixJQUFFOzhCQUM5SDtBQUFBLGdCQUFxSDtBQUFBO0FBQUEsa0JBQTlHLE9BQU07QUFBQSxpRkFBdUIsaUJBQU87QUFBQSxrQkFBRSxXQUFVO0FBQUEsa0JBQUssYUFBWTtBQUFBLGtCQUFnQixjQUFXO0FBQUE7Ozs7OzhCQUEvRCxjQUFPO0FBQUE7Y0FDM0Msb0JBQXNIO0FBQUEsZ0JBQTlHLE9BQU07QUFBQSxnQkFBVSxNQUFLO0FBQUEsZ0JBQVMsT0FBTTtBQUFBLGdCQUFxQyxTQUFPO0FBQUEsaUJBQWMsU0FBTztBQUFBIiwibmFtZXMiOlsiYiIsInByZWMiLCJyIiwib3V0Il0sImlnbm9yZUxpc3QiOltdLCJzb3VyY2VzIjpbIkNoYXJ0UGFuZS52dWUiXSwic291cmNlc0NvbnRlbnQiOlsiPHNjcmlwdCBzZXR1cCBsYW5nPVwidHNcIj5cbmltcG9ydCB7IHJlZiwgd2F0Y2gsIG9uTW91bnRlZCwgb25CZWZvcmVVbm1vdW50LCBuZXh0VGljaywgY29tcHV0ZWQgfSBmcm9tIFwidnVlXCI7XG5pbXBvcnQgeyBjcmVhdGVDaGFydEFkYXB0ZXIsIHR5cGUgQ2hhcnRBZGFwdGVyIH0gZnJvbSBcIkAvY2hhcnQvY2hhcnRBZGFwdGVyXCI7XG5pbXBvcnQgeyB1c2VUaGVtZVN0b3JlIH0gZnJvbSBcIkAvc3RvcmVzL3RoZW1lXCI7XG5pbXBvcnQgeyB1c2VNYXJrZXRTdG9yZSB9IGZyb20gXCJAL3N0b3Jlcy9tYXJrZXRcIjtcbmltcG9ydCB7IHVzZURyYXdpbmdzU3RvcmUsIHR5cGUgRHJhd2luZ1JlY3QsIHR5cGUgRHJhd2luZ1RyZW5kLCB0eXBlIERyYXdpbmdQb2x5LCB0eXBlIERyYXdpbmdQb3NpdGlvbiwgdHlwZSBEcmF3aW5nSExpbmUsIHR5cGUgRHJhd2luZ0hSYXksIHR5cGUgRHJhd2luZ1ZMaW5lLCB0eXBlIFNpbmdsZUtpbmQsIHR5cGUgU2luZ2xlRHJhd2luZywgdHlwZSBEYXNoU3R5bGUgfSBmcm9tIFwiQC9zdG9yZXMvZHJhd2luZ3NcIjtcbmltcG9ydCB7IHVzZVJlcGxheVN0b3JlIH0gZnJvbSBcIkAvc3RvcmVzL3JlcGxheVwiO1xuaW1wb3J0IHsgdXNlRGVtb1N0b3JlLCBkZW1vVmFsdWVQZXJQcmljZSwgdHlwZSBEZW1vU2lkZSwgdHlwZSBEZW1vU3RhdHVzLCB0eXBlIERlbW9LaW5kIH0gZnJvbSBcIkAvc3RvcmVzL2RlbW9cIjtcbmltcG9ydCB7IHVzZUluZGljYXRvcnNTdG9yZSwgc2Vzc2lvbktpbmRBdCwgbmV4dEJvdW5kYXJ5QWZ0ZXIsIGJvdW5kYXJ5RXBvY2gsIENIQUlOX05FWFQsIHR6T2Zmc2V0TWluLCBpblNlc3Npb24sIGxvY2FsTWludXRlc09mRGF5LCB0eXBlIFNlc3Npb25EZWYsIHR5cGUgQ3VzdG9tU2Vzc2lvbiB9IGZyb20gXCJAL3N0b3Jlcy9pbmRpY2F0b3JzXCI7XG5pbXBvcnQgRGVtb1BhbmVsIGZyb20gXCIuL0RlbW9QYW5lbC52dWVcIjtcbmltcG9ydCB0eXBlIHsgQ2FuZGxlIH0gZnJvbSBcIkB0cmFkZXJrb21hay9zaGFyZWRcIjtcbmltcG9ydCB7IGN1cnJlbmN5RmxhZ1VybCwgY29tbW9kaXR5SWNvbiwgc3ltYm9sUGFydHMgfSBmcm9tIFwiQC91dGlscy9mbGFnc1wiO1xuaW1wb3J0IHsgVElNRUZSQU1FX1NFQ09ORFMsIGluc3RydW1lbnRQcmVjaXNpb24sIGluc3RydW1lbnRQaXBTaXplLCBwcm92aWRlck9mLCBiaW5hbmNlQnVja2V0U3RhcnQsIG9hbmRhRGFpbHlCdWNrZXRTdGFydCwgb2FuZGFINEJ1Y2tldFN0YXJ0LCBvYW5kYVdlZWtseUJ1Y2tldFN0YXJ0LCBvYW5kYU1vbnRobHlCdWNrZXRTdGFydCB9IGZyb20gXCJAdHJhZGVya29tYWsvc2hhcmVkXCI7XG5cbmNvbnN0IHByb3BzID0gZGVmaW5lUHJvcHM8e1xuICBjYW5kbGVzOiBDYW5kbGVbXTtcbiAgaXNMb2FkaW5nOiBib29sZWFuO1xuICBlcnJvcjogc3RyaW5nIHwgbnVsbDtcbiAgaW5zdHJ1bWVudD86IHN0cmluZztcbn0+KCk7XG5cbmNvbnN0IG1hcmtldCA9IHVzZU1hcmtldFN0b3JlKCk7XG5jb25zdCBkcmF3aW5nc1N0b3JlID0gdXNlRHJhd2luZ3NTdG9yZSgpO1xuY29uc3QgcmVwbGF5ID0gdXNlUmVwbGF5U3RvcmUoKTtcbmNvbnN0IGRlbW8gPSB1c2VEZW1vU3RvcmUoKTtcbmNvbnN0IGluZGljYXRvcnMgPSB1c2VJbmRpY2F0b3JzU3RvcmUoKTtcblxuLyog4pSA4pSAIFNlc3Npb25zIGluZGljYXRvcjogbWFya2V0LXNlc3Npb24gYmFja2dyb3VuZCBib3hlcyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIAgKi9cbmludGVyZmFjZSBTZXNzaW9uQm94UHgge1xuICBrZXk6IHN0cmluZztcbiAgbmFtZTogc3RyaW5nO1xuICBjb2xvcjogc3RyaW5nO1xuICBsZWZ0OiBudW1iZXI7XG4gIHdpZHRoOiBudW1iZXI7XG4gIHRvcDogbnVtYmVyO1xuICBoZWlnaHQ6IG51bWJlcjtcbiAgc2hvd0xhYmVsOiBib29sZWFuO1xuICAvKiogdmVydGljYWwgb2Zmc2V0IG9mIHRoZSBuYW1lIGluc2lkZSB0aGUgYm94IChsYWJlbCBhbnRpLWNvbGxpc2lvbikgKi9cbiAgbGFiZWxUb3A6IG51bWJlcjtcbn1cbmNvbnN0IHNlc3Npb25QaXhlbHMgPSByZWY8U2Vzc2lvbkJveFB4W10+KFtdKTtcbmNvbnN0IGluZFNldHRpbmdzT3BlbiA9IHJlZihmYWxzZSk7XG5cbi8qIOKUgOKUgCBDaGFydCBzZXR0aW5nczogYmFja2dyb3VuZCAoc29saWQvZ3JhZGllbnQpICsgY2FuZGxlL2F4aXMvY3Jvc3NoYWlyXG4gICBjb2xvcnMuIEEgYG51bGxgIGNvbG9yIG1lYW5zIFwiZm9sbG93IHRoZSBhY3RpdmUgdGhlbWVcIiDigJQgc28gdGhlIGRlZmF1bHRcbiAgIGxvb2sgaXMgZXhhY3RseSB0aGUgb2xkIGxpZ2h0L2RhcmsgdGhlbWUsIGFuZCBhbnkgcGlja2VkIGNvbG9yIG92ZXJyaWRlc1xuICAgaXQgdW50aWwgRGVmYXVsdHMgaXMgcHJlc3NlZC4gKi9cbmludGVyZmFjZSBDaGFydFN0eWxlIHtcbiAgYmdNb2RlOiBcInNvbGlkXCIgfCBcImdyYWRpZW50XCI7XG4gIGJnU29saWQ6IHN0cmluZyB8IG51bGw7XG4gIGJnVG9wOiBzdHJpbmcgfCBudWxsO1xuICBiZ0JvdHRvbTogc3RyaW5nIHwgbnVsbDtcbiAgdXA6IHN0cmluZyB8IG51bGw7XG4gIGRvd246IHN0cmluZyB8IG51bGw7XG4gIGJvcmRlclVwOiBzdHJpbmcgfCBudWxsO1xuICBib3JkZXJEb3duOiBzdHJpbmcgfCBudWxsO1xuICB3aWNrVXA6IHN0cmluZyB8IG51bGw7XG4gIHdpY2tEb3duOiBzdHJpbmcgfCBudWxsO1xuICBheGlzVGV4dDogc3RyaW5nIHwgbnVsbDtcbiAgYXhpc0JvcmRlcjogc3RyaW5nIHwgbnVsbDtcbiAgY3Jvc3NWZXJ0OiBzdHJpbmcgfCBudWxsO1xuICBjcm9zc0hvcno6IHN0cmluZyB8IG51bGw7XG59XG5jb25zdCBDSEFSVF9TVFlMRV9LRVkgPSBcInRrLWNoYXJ0LXN0eWxlXCI7XG5jb25zdCBUUExfS0VZID0gXCJ0ay1jaGFydC10ZW1wbGF0ZXNcIjtcbi8qKiBMaWdodHdlaWdodCBDaGFydHMnIG93biBjYW5kbGUgZGVmYXVsdHMgKHVzZWQgd2hlbiBhIGNhbmRsZSBjb2xvciBpcyBudWxsKS4gKi9cbmNvbnN0IERFRkFVTFRfQ0FORExFUyA9IHtcbiAgdXA6IFwiIzI2YTY5YVwiLFxuICBkb3duOiBcIiNlZjUzNTBcIixcbiAgYm9yZGVyVXA6IFwiIzI2YTY5YVwiLFxuICBib3JkZXJEb3duOiBcIiNlZjUzNTBcIixcbiAgd2lja1VwOiBcIiMyNmE2OWFcIixcbiAgd2lja0Rvd246IFwiI2VmNTM1MFwiLFxufTtcbmZ1bmN0aW9uIGRlZmF1bHRDaGFydFN0eWxlKCk6IENoYXJ0U3R5bGUge1xuICByZXR1cm4ge1xuICAgIGJnTW9kZTogXCJncmFkaWVudFwiLFxuICAgIGJnU29saWQ6IG51bGwsXG4gICAgYmdUb3A6IG51bGwsXG4gICAgYmdCb3R0b206IG51bGwsXG4gICAgdXA6IG51bGwsXG4gICAgZG93bjogbnVsbCxcbiAgICBib3JkZXJVcDogbnVsbCxcbiAgICBib3JkZXJEb3duOiBudWxsLFxuICAgIHdpY2tVcDogbnVsbCxcbiAgICB3aWNrRG93bjogbnVsbCxcbiAgICBheGlzVGV4dDogbnVsbCxcbiAgICBheGlzQm9yZGVyOiBudWxsLFxuICAgIGNyb3NzVmVydDogbnVsbCxcbiAgICBjcm9zc0hvcno6IG51bGwsXG4gIH07XG59XG5jb25zdCBIRVggPSAodjogdW5rbm93bik6IHYgaXMgc3RyaW5nID0+IHR5cGVvZiB2ID09PSBcInN0cmluZ1wiICYmIC9eI1swLTlhLWZBLUZdezZ9JC8udGVzdCh2KTtcbmZ1bmN0aW9uIGxvYWRDaGFydFN0eWxlKCk6IENoYXJ0U3R5bGUge1xuICBjb25zdCBiYXNlID0gZGVmYXVsdENoYXJ0U3R5bGUoKTtcbiAgdHJ5IHtcbiAgICBjb25zdCByYXcgPSBsb2NhbFN0b3JhZ2UuZ2V0SXRlbShDSEFSVF9TVFlMRV9LRVkpO1xuICAgIGlmIChyYXcpIHtcbiAgICAgIGNvbnN0IHAgPSBKU09OLnBhcnNlKHJhdykgYXMgUGFydGlhbDxDaGFydFN0eWxlPjtcbiAgICAgIGlmIChwLmJnTW9kZSA9PT0gXCJzb2xpZFwiIHx8IHAuYmdNb2RlID09PSBcImdyYWRpZW50XCIpIGJhc2UuYmdNb2RlID0gcC5iZ01vZGU7XG4gICAgICBmb3IgKGNvbnN0IGsgb2YgW1wiYmdTb2xpZFwiLCBcImJnVG9wXCIsIFwiYmdCb3R0b21cIiwgXCJ1cFwiLCBcImRvd25cIiwgXCJib3JkZXJVcFwiLCBcImJvcmRlckRvd25cIiwgXCJ3aWNrVXBcIiwgXCJ3aWNrRG93blwiLCBcImF4aXNUZXh0XCIsIFwiYXhpc0JvcmRlclwiLCBcImNyb3NzVmVydFwiLCBcImNyb3NzSG9yelwiXSBhcyBjb25zdCkge1xuICAgICAgICBjb25zdCB2ID0gcFtrXTtcbiAgICAgICAgaWYgKHYgPT09IG51bGwgfHwgSEVYKHYpKSAoYmFzZVtrXSBhcyBzdHJpbmcgfCBudWxsKSA9IHY7XG4gICAgICB9XG4gICAgfVxuICB9IGNhdGNoIHt9XG4gIHJldHVybiBiYXNlO1xufVxuY29uc3QgcGFuZVJlZiA9IHJlZjxIVE1MRWxlbWVudCB8IG51bGw+KG51bGwpO1xuY29uc3QgY2hhcnRTdHlsZSA9IHJlZjxDaGFydFN0eWxlPihsb2FkQ2hhcnRTdHlsZSgpKTtcbmNvbnN0IGNoYXJ0U2V0dGluZ3NPcGVuID0gcmVmKGZhbHNlKTtcblxuY29uc3QgaXNEYXJrVGhlbWUgPSBjb21wdXRlZCgoKSA9PiB0aGVtZVN0b3JlLnRoZW1lID09PSBcImRhcmtcIik7XG4vKiogVGhlbWUgZ3JhZGllbnQgKG1hdGNoZXMgdGhlIENTUyAtLWNoYXJ0LWJnLWdyYWRpZW50IG9mIGVhY2ggdGhlbWUpLiAqL1xuZnVuY3Rpb24gdGhlbWVCZ1BhaXIoKTogW3N0cmluZywgc3RyaW5nXSB7XG4gIHJldHVybiBpc0RhcmtUaGVtZS52YWx1ZSA/IFtcIiMxNzFhM2FcIiwgXCIjMGIxMTIwXCJdIDogW1wiI2U0ZTlmZlwiLCBcIiNmZGYyZjhcIl07XG59XG4vKiogVGhlbWUgYXhpcyB0ZXh0L2JvcmRlciAobWF0Y2hlcyBjaGFydEFkYXB0ZXIncyB0aGVtZUNvbG9ycykuICovXG5mdW5jdGlvbiB0aGVtZUF4aXNQYWlyKCk6IFtzdHJpbmcsIHN0cmluZ10ge1xuICByZXR1cm4gaXNEYXJrVGhlbWUudmFsdWUgPyBbXCIjZDFkNGRjXCIsIFwiIzJhMmU2YVwiXSA6IFtcIiMxZTFiNGJcIiwgXCIjYzdkMmZlXCJdO1xufVxuZnVuY3Rpb24gZWZmKHY6IHN0cmluZyB8IG51bGwsIHRoZW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gdiA/PyB0aGVtZTtcbn1cblxuZnVuY3Rpb24gYXBwbHlDaGFydFN0eWxlKCk6IHZvaWQge1xuICBjb25zdCBzID0gY2hhcnRTdHlsZS52YWx1ZTtcbiAgY29uc3QgcGFuZSA9IHBhbmVSZWYudmFsdWU7XG4gIGlmIChwYW5lKSB7XG4gICAgcGFuZS5zdHlsZS5iYWNrZ3JvdW5kID1cbiAgICAgIHMuYmdNb2RlID09PSBcInNvbGlkXCJcbiAgICAgICAgPyAocy5iZ1NvbGlkID8/IHRoZW1lQmdQYWlyKClbMF0pXG4gICAgICAgIDogYGxpbmVhci1ncmFkaWVudCgxODBkZWcsICR7cy5iZ1RvcCA/PyB0aGVtZUJnUGFpcigpWzBdfSAwJSwgJHtzLmJnQm90dG9tID8/IHRoZW1lQmdQYWlyKClbMV19IDEwMCUpYDtcbiAgfVxuICBhZGFwdGVyPy5zZXRDYW5kbGVDb2xvcnMoe1xuICAgIHVwOiBzLnVwID8/IERFRkFVTFRfQ0FORExFUy51cCxcbiAgICBkb3duOiBzLmRvd24gPz8gREVGQVVMVF9DQU5ETEVTLmRvd24sXG4gICAgYm9yZGVyVXA6IHMuYm9yZGVyVXAgPz8gREVGQVVMVF9DQU5ETEVTLmJvcmRlclVwLFxuICAgIGJvcmRlckRvd246IHMuYm9yZGVyRG93biA/PyBERUZBVUxUX0NBTkRMRVMuYm9yZGVyRG93bixcbiAgICB3aWNrVXA6IHMud2lja1VwID8/IERFRkFVTFRfQ0FORExFUy53aWNrVXAsXG4gICAgd2lja0Rvd246IHMud2lja0Rvd24gPz8gREVGQVVMVF9DQU5ETEVTLndpY2tEb3duLFxuICB9KTtcbiAgYWRhcHRlcj8uc2V0QXhpc0NvbG9ycyh7IHRleHQ6IHMuYXhpc1RleHQsIGJvcmRlcjogcy5heGlzQm9yZGVyIH0pO1xuICBhZGFwdGVyPy5zZXRDcm9zc2hhaXJDb2xvcnMoeyB2ZXJ0OiBzLmNyb3NzVmVydCwgaG9yejogcy5jcm9zc0hvcnogfSk7XG4gIGxvY2FsU3RvcmFnZS5zZXRJdGVtKENIQVJUX1NUWUxFX0tFWSwgSlNPTi5zdHJpbmdpZnkocykpO1xufVxud2F0Y2goY2hhcnRTdHlsZSwgYXBwbHlDaGFydFN0eWxlLCB7IGRlZXA6IHRydWUgfSk7XG4vLyBUaGVtZSBmbGlwcyByZS1yZXNvbHZlIGV2ZXJ5IG51bGwgY29sb3Ig4oCUIHRoZSBkZWZhdWx0IGxvb2sgYWx3YXlzIGZvbGxvd3MgbGlnaHQvZGFya1xud2F0Y2goaXNEYXJrVGhlbWUsICgpID0+IGFwcGx5Q2hhcnRTdHlsZSgpKTtcbmZ1bmN0aW9uIHJlc2V0Q2hhcnRTdHlsZSgpOiB2b2lkIHtcbiAgY2hhcnRTdHlsZS52YWx1ZSA9IGRlZmF1bHRDaGFydFN0eWxlKCk7XG59XG5mdW5jdGlvbiBzZXRDb2xvcihrZXk6IGtleW9mIENoYXJ0U3R5bGUsIGU6IEV2ZW50KTogdm9pZCB7XG4gIGNvbnN0IHYgPSAoZS50YXJnZXQgYXMgSFRNTElucHV0RWxlbWVudCkudmFsdWU7XG4gIGlmIChIRVgodikpIChjaGFydFN0eWxlLnZhbHVlW2tleV0gYXMgc3RyaW5nIHwgbnVsbCkgPSB2O1xufVxuZnVuY3Rpb24gcmVzZXRHcm91cChncm91cDogXCJiZ1wiIHwgXCJjYW5kbGVzXCIgfCBcInNjYWxlc1wiIHwgXCJjcm9zc1wiKTogdm9pZCB7XG4gIGNvbnN0IHMgPSBjaGFydFN0eWxlLnZhbHVlO1xuICBpZiAoZ3JvdXAgPT09IFwiYmdcIikgeyBzLmJnU29saWQgPSBudWxsOyBzLmJnVG9wID0gbnVsbDsgcy5iZ0JvdHRvbSA9IG51bGw7IHMuYmdNb2RlID0gXCJncmFkaWVudFwiOyB9XG4gIGVsc2UgaWYgKGdyb3VwID09PSBcImNhbmRsZXNcIikgeyBzLnVwID0gcy5kb3duID0gcy5ib3JkZXJVcCA9IHMuYm9yZGVyRG93biA9IHMud2lja1VwID0gcy53aWNrRG93biA9IG51bGw7IH1cbiAgZWxzZSBpZiAoZ3JvdXAgPT09IFwic2NhbGVzXCIpIHsgcy5heGlzVGV4dCA9IG51bGw7IHMuYXhpc0JvcmRlciA9IG51bGw7IH1cbiAgZWxzZSB7IHMuY3Jvc3NWZXJ0ID0gbnVsbDsgcy5jcm9zc0hvcnogPSBudWxsOyB9XG59XG5cbi8qIOKUgOKUgCBDaGFydCB0ZW1wbGF0ZXMgKHNhdmVkIGNvbG9yIHNjaGVtZXMpIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgCAqL1xuaW50ZXJmYWNlIENoYXJ0VGVtcGxhdGUge1xuICBuYW1lOiBzdHJpbmc7XG4gIHN0eWxlOiBDaGFydFN0eWxlO1xufVxuZnVuY3Rpb24gbG9hZFRlbXBsYXRlcygpOiBDaGFydFRlbXBsYXRlW10ge1xuICB0cnkge1xuICAgIGNvbnN0IHJhdyA9IGxvY2FsU3RvcmFnZS5nZXRJdGVtKFRQTF9LRVkpO1xuICAgIGNvbnN0IGFyciA9IHJhdyA/IChKU09OLnBhcnNlKHJhdykgYXMgQ2hhcnRUZW1wbGF0ZVtdKSA6IFtdO1xuICAgIHJldHVybiBBcnJheS5pc0FycmF5KGFycikgPyBhcnIuZmlsdGVyKCh0KSA9PiB0ICYmIHR5cGVvZiB0Lm5hbWUgPT09IFwic3RyaW5nXCIgJiYgdC5zdHlsZSkgOiBbXTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIFtdO1xuICB9XG59XG5jb25zdCB0ZW1wbGF0ZXMgPSByZWY8Q2hhcnRUZW1wbGF0ZVtdPihsb2FkVGVtcGxhdGVzKCkpO1xuY29uc3QgdHBsTmFtZSA9IHJlZihcIlwiKTtcbmNvbnN0IHNlbGVjdGVkVHBsID0gcmVmKFwiXCIpO1xuZnVuY3Rpb24gcGVyc2lzdFRlbXBsYXRlcygpOiB2b2lkIHtcbiAgbG9jYWxTdG9yYWdlLnNldEl0ZW0oVFBMX0tFWSwgSlNPTi5zdHJpbmdpZnkodGVtcGxhdGVzLnZhbHVlKSk7XG59XG5mdW5jdGlvbiBzYXZlVGVtcGxhdGUoKTogdm9pZCB7XG4gIGNvbnN0IGNsZWFuID0gdHBsTmFtZS52YWx1ZS50cmltKCkuc2xpY2UoMCwgMjQpO1xuICBjb25zdCBuYW1lID0gY2xlYW4gfHwgYFRlbXBsYXRlICR7dGVtcGxhdGVzLnZhbHVlLmxlbmd0aCArIDF9YDtcbiAgdGVtcGxhdGVzLnZhbHVlID0gdGVtcGxhdGVzLnZhbHVlLmZpbHRlcigodCkgPT4gdC5uYW1lICE9PSBuYW1lKTtcbiAgdGVtcGxhdGVzLnZhbHVlLnB1c2goeyBuYW1lLCBzdHlsZTogSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShjaGFydFN0eWxlLnZhbHVlKSkgfSk7XG4gIHBlcnNpc3RUZW1wbGF0ZXMoKTtcbiAgdHBsTmFtZS52YWx1ZSA9IFwiXCI7XG4gIHNlbGVjdGVkVHBsLnZhbHVlID0gbmFtZTtcbn1cbmZ1bmN0aW9uIGFwcGx5VGVtcGxhdGUoKTogdm9pZCB7XG4gIGNvbnN0IHQgPSB0ZW1wbGF0ZXMudmFsdWUuZmluZCgoeCkgPT4geC5uYW1lID09PSBzZWxlY3RlZFRwbC52YWx1ZSk7XG4gIGlmICh0KSBjaGFydFN0eWxlLnZhbHVlID0gSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeSh0LnN0eWxlKSk7XG59XG5mdW5jdGlvbiBkZWxldGVUZW1wbGF0ZSgpOiB2b2lkIHtcbiAgaWYgKCFzZWxlY3RlZFRwbC52YWx1ZSkgcmV0dXJuO1xuICB0ZW1wbGF0ZXMudmFsdWUgPSB0ZW1wbGF0ZXMudmFsdWUuZmlsdGVyKCh0KSA9PiB0Lm5hbWUgIT09IHNlbGVjdGVkVHBsLnZhbHVlKTtcbiAgcGVyc2lzdFRlbXBsYXRlcygpO1xuICBzZWxlY3RlZFRwbC52YWx1ZSA9IFwiXCI7XG59XG5cbi8qKiBXaGlsZSB0aGUgc2V0dGluZ3MgcG9wdXAgaXMgb3BlbiwgYW55IHBvaW50ZXJkb3duIG91dHNpZGUgaXQgKHRoZSBjaGFydCxcbiAqICB3YXRjaGxpc3QsIG5ld3PigKYpIGNsb3NlcyBpdC4gVGhlIGxlZ2VuZCBidXR0b25zIGFyZSBleGNsdWRlZCDigJQgdGhlIGdlYXJcbiAqICB0b2dnbGVzIGl0c2VsZi4gKi9cbmZ1bmN0aW9uIGluZFNldHRpbmdzT3V0c2lkZShlOiBQb2ludGVyRXZlbnQpOiB2b2lkIHtcbiAgY29uc3QgcG9wID0gZG9jdW1lbnQucXVlcnlTZWxlY3RvcihcIi5pbmQtc2V0dGluZ3NcIik7XG4gIGlmIChwb3AgJiYgcG9wLmNvbnRhaW5zKGUudGFyZ2V0IGFzIE5vZGUpKSByZXR1cm47XG4gIGNvbnN0IGxlZ2VuZCA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IoXCIuaW5kaWNhdG9yLWxlZ2VuZFwiKTtcbiAgaWYgKGxlZ2VuZCAmJiBsZWdlbmQuY29udGFpbnMoZS50YXJnZXQgYXMgTm9kZSkpIHJldHVybjtcbiAgaW5kU2V0dGluZ3NPcGVuLnZhbHVlID0gZmFsc2U7XG59XG53YXRjaChpbmRTZXR0aW5nc09wZW4sIChvcGVuKSA9PiB7XG4gIGlmIChvcGVuKSBkb2N1bWVudC5hZGRFdmVudExpc3RlbmVyKFwicG9pbnRlcmRvd25cIiwgaW5kU2V0dGluZ3NPdXRzaWRlLCB0cnVlKTtcbiAgZWxzZSBkb2N1bWVudC5yZW1vdmVFdmVudExpc3RlbmVyKFwicG9pbnRlcmRvd25cIiwgaW5kU2V0dGluZ3NPdXRzaWRlLCB0cnVlKTtcbn0pO1xuXG4vKiogR3JvdXBzIGNhbmRsZXMgaW50byBjb250aWd1b3VzIHJ1bnMgb2YgZWFjaCBzZXNzaW9uIGFuZCBwcm9qZWN0cyBlYWNoXG4gKiAgcnVuIHRvIGEgYm94IHNwYW5uaW5nIHRoZSBydW4ncyBoaWdo4oaSbG93LCBUcmFkaW5nVmlldyBTZXNzaW9ucy1zdHlsZS5cbiAqICBCdWlsdC1pbnMgYXJlIGEgQ0hBSU4gb2YgbWFya2V0LW9wZW4gYm91bmRhcmllcyAoRFNULWF3YXJlLCBzZWUgc3RvcmUpO1xuICogIHRoZSBydW4gY3VycmVudGx5IGluIHByb2dyZXNzIGV4dGVuZHMgcmlnaHQgdG8gaXRzIFNDSEVEVUxFRCBlbmQg4oCUXG4gKiAgZS5nLiB0aGUgTlkmTE4gYm94IHJlYWNoZXMgMTc6MzAsIE5ldyBZb3JrJ3MgcmVhY2hlcyB0aGUgbmV4dCBTeWRuZXlcbiAqICBvcGVuIOKAlCBwcm9qZWN0aW5nIGludG8gdGhlIGZ1dHVyZSB3aGl0ZXNwYWNlIHBhc3QgdGhlIGxhc3QgY2FuZGxlLiAqL1xuLyoqIFRoZSBoZWF2eSBwYXJ0OiBvbmUgc2NhbiBvZiBhbGwgY2FuZGxlcyBwZXIgc2Vzc2lvbiBwcm9kdWNpbmcgVElNRS1iYXNlZFxuICogIHJ1bnMgKG5vIGNoYXJ0IGNvb3JkaW5hdGVzKS4gQ2FjaGVkIOKAlCByZWNvbXB1dGVkIG9ubHkgd2hlbiB0aGUgY2FuZGxlXG4gKiAgZGF0YSBvciB0aGUgc2Vzc2lvbiBjb25maWcgYWN0dWFsbHkgY2hhbmdlcywgbmV2ZXIgb24gcGFuL3pvb20vbW91c2VcbiAqICBldmVudHMgKHRoZXkgb25seSByZS1QUk9KRUNUIHRoZSBjYWNoZWQgcnVucywgd2hpY2ggaXMgfjQwIG9wcykuICovXG5pbnRlcmZhY2UgU2Vzc2lvblJ1biB7XG4gIGlkOiBzdHJpbmc7XG4gIG5hbWU6IHN0cmluZztcbiAgY29sb3I6IHN0cmluZztcbiAgdDE6IG51bWJlcjtcbiAgdDI6IG51bWJlcjtcbiAgaGlnaDogbnVtYmVyO1xuICBsb3c6IG51bWJlcjtcbiAgZXh0ZW5kVG86IG51bWJlciB8IG51bGw7IC8vIHNjaGVkdWxlZCBlbmQgZm9yIHRoZSBpbi1wcm9ncmVzcyBydW4gKGxpdmUpXG59XG5sZXQgcnVuc0NhY2hlOiB7IGtleTogc3RyaW5nOyBydW5zOiBTZXNzaW9uUnVuW10gfSB8IG51bGwgPSBudWxsO1xubGV0IGxhc3RCb3hlc0pzb24gPSBcIlwiO1xuXG5mdW5jdGlvbiBjb21wdXRlU2Vzc2lvbkJveGVzKCk6IHZvaWQge1xuICBpZiAoIWluZGljYXRvcnMuc2Vzc2lvbnNBZGRlZCB8fCAhaW5kaWNhdG9ycy5zZXNzaW9uc1Zpc2libGUgfHwgIWFkYXB0ZXIpIHtcbiAgICBpZiAoc2Vzc2lvblBpeGVscy52YWx1ZS5sZW5ndGgpIHNlc3Npb25QaXhlbHMudmFsdWUgPSBbXTtcbiAgICBsYXN0Qm94ZXNKc29uID0gXCJcIjtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgYyA9IHByb3BzLmNhbmRsZXM7XG4gIGNvbnN0IG4gPSBjLmxlbmd0aDtcbiAgaWYgKG4gPCAyKSB7XG4gICAgaWYgKHNlc3Npb25QaXhlbHMudmFsdWUubGVuZ3RoKSBzZXNzaW9uUGl4ZWxzLnZhbHVlID0gW107XG4gICAgbGFzdEJveGVzSnNvbiA9IFwiXCI7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IGNoYXJ0VyA9IChjb250YWluZXJSZWYudmFsdWU/LmNsaWVudFdpZHRoID8/IDApIC0gYXhpc1JpZ2h0Vy52YWx1ZTtcbiAgLy8gYmFyIGludGVydmFsIGZvciBleHRlbmRpbmcgYSBydW4gdG8gdGhlIGVuZCBvZiBpdHMgbGFzdCBjYW5kbGVcbiAgY29uc3QgdGZTZWMgPSAoVElNRUZSQU1FX1NFQ09ORFMgYXMgUmVjb3JkPHN0cmluZywgbnVtYmVyPilbbWFya2V0LnRpbWVmcmFtZV0gPz8gTWF0aC5tYXgoMSwgKGNbbiAtIDFdIS50aW1lIC0gY1tuIC0gMl0hLnRpbWUpKTtcblxuICAvLyDilIDilIAgUnVuIHNjYW4gKGNhY2hlZCkg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gIC8vIFRoZSBsYXN0IGNhbmRsZSdzIGhpZ2gvbG93IGFyZSBpbiB0aGUga2V5OiBhIGZvcm1pbmcgY2FuZGxlJ3MgcmFuZ2VcbiAgLy8gZ3Jvd3MgdGljayBieSB0aWNrLCBhbmQgdGhlIGluLXByb2dyZXNzIGJveCBtdXN0IGZvbGxvdyBpdC5cbiAgY29uc3QgY2ZnS2V5ID0gSlNPTi5zdHJpbmdpZnkoW1xuICAgIGluZGljYXRvcnMuZGVmcy5tYXAoKGQpID0+IFtkLmlkLCBkLm5hbWUsIGQuY29sb3JdKSxcbiAgICBpbmRpY2F0b3JzLmN1c3RvbXMubWFwKChkKSA9PiBbZC5pZCwgZC5uYW1lLCBkLmNvbG9yXSksXG4gICAgaW5kaWNhdG9ycy5zZXNzaW9uc0VuYWJsZWQsXG4gIF0pO1xuICBjb25zdCBjYWNoZUtleSA9IFtcbiAgICBtYXJrZXQuaW5zdHJ1bWVudCxcbiAgICBtYXJrZXQudGltZWZyYW1lLFxuICAgIG4sXG4gICAgY1swXSEudGltZSxcbiAgICBjW24gLSAxXSEudGltZSxcbiAgICBjW24gLSAxXSEuaGlnaCxcbiAgICBjW24gLSAxXSEubG93LFxuICAgIGNmZ0tleSxcbiAgXS5qb2luKFwifFwiKTtcbiAgaWYgKCFydW5zQ2FjaGUgfHwgcnVuc0NhY2hlLmtleSAhPT0gY2FjaGVLZXkpIHtcbiAgICBjb25zdCBydW5zOiBTZXNzaW9uUnVuW10gPSBbXTtcblxuICAgIC8qKiBFbmQgdGltZSBvZiB0aGUgcnVuIHRoYXQgY29udGFpbnMgdGhlIExBU1QgY2FuZGxlOiBpdHMgc2NoZWR1bGVkXG4gICAgICogIHNlc3Npb24gZW5kIChmdXR1cmUpIOKAlCB0aGUgYm94IGRyYXdzIHVwIHRvIGl0LCBub3QganVzdCB0byB0aGUgbGFzdFxuICAgICAqICBjYW5kbGUuIEJ1aWx0LWluczogdGhlIE5FWFQgTElOSyBvZiB0aGUgY2hhaW4gKE5ldyBZb3JrIGVuZHMgYXRcbiAgICAgKiAgU3lkbmV5J3Mgb3BlbiwgTlkmTE4gYXQgTmV3IFlvcmsncyBvcGVu4oCmKSDigJQgZXh0ZW5kaW5nIHRvIHRoZVxuICAgICAqICBzZXNzaW9uJ3Mgb3duIG5leHQgb2NjdXJyZW5jZSB3b3VsZCBkcmF3IGEgd2hvbGUgZXh0cmEgZGF5LiAqL1xuICAgIGNvbnN0IHNjaGVkdWxlZEVuZEZvciA9IChkZWY6IFNlc3Npb25EZWYsIHQ6IG51bWJlcik6IG51bWJlciA9PiB7XG4gICAgICBjb25zdCBuZXh0SWQgPSBDSEFJTl9ORVhUW2RlZi5pZF07XG4gICAgICBjb25zdCBuZXh0RGVmID0gbmV4dElkID8gaW5kaWNhdG9ycy5kZWZzLmZpbmQoKGQpID0+IGQuaWQgPT09IG5leHRJZCkgOiB1bmRlZmluZWQ7XG4gICAgICByZXR1cm4gbmV4dERlZiA/IG5leHRCb3VuZGFyeUFmdGVyKG5leHREZWYsIHQpIDogbmV4dEJvdW5kYXJ5QWZ0ZXIoZGVmLCB0KTtcbiAgICB9O1xuICAgIGNvbnN0IHNjaGVkdWxlZEVuZEN1c3RvbSA9IChkZWY6IEN1c3RvbVNlc3Npb24sIHQ6IG51bWJlcik6IG51bWJlciA9PiB7XG4gICAgICBjb25zdCBkID0gTWF0aC5mbG9vcih0IC8gODY0MDApO1xuICAgICAgZm9yIChjb25zdCBkYXkgb2YgW2QsIGQgKyAxXSkge1xuICAgICAgICBjb25zdCBlbmQgPSBkYXkgKiA4NjQwMCArIChkZWYuZW5kIC0gdHpPZmZzZXRNaW4oZGVmLnR6LCBkYXkpKSAqIDYwO1xuICAgICAgICBpZiAoZW5kID4gdCkgcmV0dXJuIGVuZDtcbiAgICAgIH1cbiAgICAgIHJldHVybiB0O1xuICAgIH07XG5cbiAgICAvKiogT25lIGNvbnRpZ3VvdXMtcnVuIHNjYW4gb3ZlciBgbWVtYmVyYDogdHJ1ZSA9IGNhbmRsZSBiZWxvbmdzIHRvIHRoZVxuICAgICAqICBzZXNzaW9uLiBSdW5zIHJlY29yZCBUSU1FICsgaGlnaC9sb3cgb25seS4gKi9cbiAgICBjb25zdCBzY2FuUnVucyA9IChcbiAgICAgIG1lbWJlcjogKGk6IG51bWJlcikgPT4gYm9vbGVhbixcbiAgICAgIGVuZFQ6IChsYXN0VGltZTogbnVtYmVyKSA9PiBudW1iZXIsXG4gICAgICBpZDogc3RyaW5nLFxuICAgICAgbmFtZTogc3RyaW5nLFxuICAgICAgY29sb3I6IHN0cmluZ1xuICAgICk6IHZvaWQgPT4ge1xuICAgICAgbGV0IHJ1blN0YXJ0ID0gLTE7XG4gICAgICBsZXQgcnVuSGlnaCA9IC1JbmZpbml0eTtcbiAgICAgIGxldCBydW5Mb3cgPSBJbmZpbml0eTtcbiAgICAgIGNvbnN0IGNsb3NlUnVuID0gKGVuZElkeDogbnVtYmVyKTogdm9pZCA9PiB7XG4gICAgICAgIGlmIChydW5TdGFydCA8IDApIHJldHVybjtcbiAgICAgICAgY29uc3QgbGFzdElkeCA9IGVuZElkeCAtIDE7XG4gICAgICAgIGNvbnN0IHQxID0gY1tydW5TdGFydF0hLnRpbWU7XG4gICAgICAgIC8vIFRoZSBzY2hlZHVsZWQtZW5kIGV4dGVuc2lvbiBhcHBsaWVzIE9OTFkgd2hpbGUgZGF0YSBpcyBhY3R1YWxseVxuICAgICAgICAvLyBzdHJlYW1pbmcg4oCUIHdoZW4gdGhlIG1hcmtldCBpcyBjbG9zZWQgKHdlZWtlbmQvYWZ0ZXIgY2xvc2UpIHRoZVxuICAgICAgICAvLyBib3ggbXVzdCBzdG9wIGF0IHRoZSBsYXN0IGNhbmRsZSwgbm90IHJlYWNoIGludG8gdGhlIGJsYW5rIGFyZWEuXG4gICAgICAgIGNvbnN0IHN0cmVhbWluZyA9XG4gICAgICAgICAgbGFzdElkeCA9PT0gbiAtIDEgJiZcbiAgICAgICAgICBEYXRlLm5vdygpIC8gMTAwMCAtIGNbbGFzdElkeF0hLnRpbWUgPCBNYXRoLm1heCh0ZlNlYyAqIDIsIDEyMCk7XG4gICAgICAgIGNvbnN0IHQyID0gY1tsYXN0SWR4XSEudGltZSArIHRmU2VjO1xuICAgICAgICBjb25zdCBleHRlbmRUbyA9IGxhc3RJZHggPT09IG4gLSAxICYmIHN0cmVhbWluZyA/IGVuZFQoY1tsYXN0SWR4XSEudGltZSkgOiBudWxsO1xuICAgICAgICBydW5TdGFydCA9IC0xO1xuICAgICAgICBydW5zLnB1c2goeyBpZCwgbmFtZSwgY29sb3IsIHQxLCB0MiwgaGlnaDogcnVuSGlnaCwgbG93OiBydW5Mb3csIGV4dGVuZFRvIH0pO1xuICAgICAgfTtcbiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDw9IG47IGkrKykge1xuICAgICAgICBjb25zdCBpc0luID0gaSA8IG4gJiYgbWVtYmVyKGkpO1xuICAgICAgICBpZiAoaXNJbikge1xuICAgICAgICAgIGlmIChydW5TdGFydCA8IDApIHtcbiAgICAgICAgICAgIHJ1blN0YXJ0ID0gaTtcbiAgICAgICAgICAgIHJ1bkhpZ2ggPSAtSW5maW5pdHk7XG4gICAgICAgICAgICBydW5Mb3cgPSBJbmZpbml0eTtcbiAgICAgICAgICB9XG4gICAgICAgICAgcnVuSGlnaCA9IE1hdGgubWF4KHJ1bkhpZ2gsIGNbaV0hLmhpZ2gpO1xuICAgICAgICAgIHJ1bkxvdyA9IE1hdGgubWluKHJ1bkxvdywgY1tpXSEubG93KTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjbG9zZVJ1bihpKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH07XG5cbiAgICAvLyBCdWlsdC1pbnM6IG1lbWJlcnNoaXAgYnkgY2hhaW5lZCBtYXJrZXQtb3BlbiBib3VuZGFyaWVzXG4gICAgZm9yIChjb25zdCBkZWYgb2YgaW5kaWNhdG9ycy5kZWZzKSB7XG4gICAgICBpZiAoIWluZGljYXRvcnMuaXNFbmFibGVkKGRlZi5pZCkpIGNvbnRpbnVlO1xuICAgICAgc2NhblJ1bnMoXG4gICAgICAgIChpKSA9PiBzZXNzaW9uS2luZEF0KGNbaV0hLnRpbWUpID09PSBkZWYuaWQsXG4gICAgICAgICh0KSA9PiBzY2hlZHVsZWRFbmRGb3IoZGVmLCB0KSxcbiAgICAgICAgZGVmLmlkLFxuICAgICAgICBkZWYubmFtZSxcbiAgICAgICAgZGVmLmNvbG9yXG4gICAgICApO1xuICAgIH1cbiAgICAvLyBDdXN0b20gc2Vzc2lvbnM6IGZyZWUgd2luZG93cyBpbiB0aGUgdmlzaXRvcidzIGxvY2FsIGNsb2NrXG4gICAgZm9yIChjb25zdCBkZWYgb2YgaW5kaWNhdG9ycy5jdXN0b21zKSB7XG4gICAgICBpZiAoIWluZGljYXRvcnMuaXNFbmFibGVkKGRlZi5pZCkpIGNvbnRpbnVlO1xuICAgICAgc2NhblJ1bnMoXG4gICAgICAgIChpKSA9PiBpblNlc3Npb24oZGVmLCBsb2NhbE1pbnV0ZXNPZkRheShkZWYudHosIGNbaV0hLnRpbWUpKSxcbiAgICAgICAgKHQpID0+IHNjaGVkdWxlZEVuZEN1c3RvbShkZWYsIHQpLFxuICAgICAgICBkZWYuaWQsXG4gICAgICAgIGRlZi5uYW1lLFxuICAgICAgICBkZWYuY29sb3JcbiAgICAgICk7XG4gICAgfVxuICAgIHJ1bnNDYWNoZSA9IHsga2V5OiBjYWNoZUtleSwgcnVucyB9O1xuICB9XG5cbiAgLy8g4pSA4pSAIFByb2plY3Rpb24gKGNoZWFwOiB+NDAgcnVucyDihpIgcGl4ZWxzKSDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgY29uc3Qgb3V0OiBTZXNzaW9uQm94UHhbXSA9IFtdO1xuICBmb3IgKGNvbnN0IHJ1biBvZiBydW5zQ2FjaGUucnVucykge1xuICAgIGNvbnN0IHgxID0gYWRhcHRlci50aW1lVG9YKHJ1bi50MSk7XG4gICAgY29uc3QgeDIgPSBhZGFwdGVyLnRpbWVUb1gocnVuLmV4dGVuZFRvID8/IHJ1bi50Mik7XG4gICAgY29uc3QgdG9wID0gYWRhcHRlci5nZXRQcmljZVkocnVuLmhpZ2gpO1xuICAgIGNvbnN0IGJvdHRvbSA9IGFkYXB0ZXIuZ2V0UHJpY2VZKHJ1bi5sb3cpO1xuICAgIGlmICh4MSA9PT0gbnVsbCB8fCB4MiA9PT0gbnVsbCB8fCB0b3AgPT09IG51bGwgfHwgYm90dG9tID09PSBudWxsKSBjb250aW51ZTtcbiAgICBjb25zdCBsZWZ0ID0gTWF0aC5tYXgoLTIsIE1hdGgubWluKHgxLCB4MikpO1xuICAgIGNvbnN0IHJpZ2h0ID0gTWF0aC5taW4oY2hhcnRXICsgMiwgTWF0aC5tYXgoeDEsIHgyKSk7XG4gICAgY29uc3Qgd2lkdGggPSByaWdodCAtIGxlZnQ7XG4gICAgaWYgKHdpZHRoIDwgMSkgY29udGludWU7XG4gICAgY29uc3QgeVRvcCA9IE1hdGgubWluKHRvcCwgYm90dG9tKTtcbiAgICBjb25zdCB5Qm90ID0gTWF0aC5tYXgodG9wLCBib3R0b20pO1xuICAgIG91dC5wdXNoKHtcbiAgICAgIGtleTogcnVuLmlkICsgXCItXCIgKyBydW4udDEsXG4gICAgICBuYW1lOiBydW4ubmFtZSxcbiAgICAgIGNvbG9yOiBydW4uY29sb3IsXG4gICAgICBsZWZ0LFxuICAgICAgd2lkdGgsXG4gICAgICB0b3A6IHlUb3AsXG4gICAgICBoZWlnaHQ6IE1hdGgubWF4KDIsIHlCb3QgLSB5VG9wKSxcbiAgICAgIHNob3dMYWJlbDogd2lkdGggPiA1NiAmJiBpbmRpY2F0b3JzLnNlc3Npb25zTGFiZWxzLFxuICAgICAgbGFiZWxUb3A6IDMsXG4gICAgfSk7XG4gIH1cbiAgLy8gTGFiZWwgYW50aS1jb2xsaXNpb246IHR3byBzZXNzaW9ucyBzaGFyaW5nIHRoZSBzYW1lIHRpbWUgcmVnaW9uIGFuZCBhXG4gIC8vIHNpbWlsYXIgaGlnaCB3b3VsZCBwdXQgdGhlaXIgbmFtZXMgb24gdG9wIG9mIGVhY2ggb3RoZXIg4oCUIHN0YWNrIHRoZVxuICAvLyBsYXRlciBsYWJlbCBsb3dlciBpbnNpZGUgaXRzIG93biBib3ggKGhpZGUgaXQgaWYgdGhlIGJveCBpcyB0b28gc2hvcnQpLlxuICBjb25zdCBMQUJFTF9IID0gMTI7XG4gIGNvbnN0IHBsYWNlZDogeyBsOiBudW1iZXI7IHI6IG51bWJlcjsgdDogbnVtYmVyOyBiOiBudW1iZXIgfVtdID0gW107XG4gIGZvciAoY29uc3QgYiBvZiBbLi4ub3V0XS5zb3J0KChhLCBiKSA9PiBhLmxlZnQgLSBiLmxlZnQpKSB7XG4gICAgaWYgKCFiLnNob3dMYWJlbCkgY29udGludWU7XG4gICAgY29uc3QgbCA9IGIubGVmdDtcbiAgICBjb25zdCByID0gYi5sZWZ0ICsgYi53aWR0aDtcbiAgICBsZXQgbHQgPSAzO1xuICAgIHdoaWxlIChwbGFjZWQuc29tZSgocCkgPT4gbCA8IHAuciAmJiByID4gcC5sICYmIGIudG9wICsgbHQgPCBwLmIgJiYgYi50b3AgKyBsdCArIExBQkVMX0ggPiBwLnQpKSB7XG4gICAgICBsdCArPSBMQUJFTF9IICsgMjtcbiAgICB9XG4gICAgaWYgKGx0ICsgTEFCRUxfSCA+IGIuaGVpZ2h0KSB7XG4gICAgICBiLnNob3dMYWJlbCA9IGZhbHNlO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIHBsYWNlZC5wdXNoKHsgbCwgciwgdDogYi50b3AgKyBsdCwgYjogYi50b3AgKyBsdCArIExBQkVMX0ggfSk7XG4gICAgYi5sYWJlbFRvcCA9IGx0O1xuICB9XG4gIC8vIE9ubHkgdG91Y2ggdGhlIERPTSB3aGVuIHRoZSBnZW9tZXRyeSBhY3R1YWxseSBjaGFuZ2VkIOKAlCB0aGlzIGZ1bmN0aW9uXG4gIC8vIHJ1bnMgb24gZXZlcnkgbW91c2UgbW92ZSAvIHBhbiBmcmFtZSwgYW5kIHJlLXJlbmRlcmluZyBpZGVudGljYWwgZGl2c1xuICAvLyBodW5kcmVkcyBvZiB0aW1lcyBwZXIgc2Vjb25kIGlzIHdoYXQgbWFkZSB0aGUgY2hhcnQgZmVlbCBoZWF2eS5cbiAgY29uc3QgaiA9IEpTT04uc3RyaW5naWZ5KG91dCk7XG4gIGlmIChqICE9PSBsYXN0Qm94ZXNKc29uKSB7XG4gICAgbGFzdEJveGVzSnNvbiA9IGo7XG4gICAgc2Vzc2lvblBpeGVscy52YWx1ZSA9IG91dDtcbiAgfVxufVxuXG4vKiogXCIwOTowMFwiIOKGlCBtaW51dGVzLW9mLWRheSBoZWxwZXJzIGZvciB0aGUgc2V0dGluZ3MgdGltZSBpbnB1dHMuICovXG5mdW5jdGlvbiB0b1RpbWVTdHIobWluOiBudW1iZXIpOiBzdHJpbmcge1xuICBjb25zdCBtID0gKChNYXRoLnJvdW5kKG1pbikgJSAxNDQwKSArIDE0NDApICUgMTQ0MDtcbiAgcmV0dXJuIFN0cmluZyhNYXRoLmZsb29yKG0gLyA2MCkpLnBhZFN0YXJ0KDIsIFwiMFwiKSArIFwiOlwiICsgU3RyaW5nKG0gJSA2MCkucGFkU3RhcnQoMiwgXCIwXCIpO1xufVxuZnVuY3Rpb24gb25DdXN0b21UaW1lQ2hhbmdlKHM6IEN1c3RvbVNlc3Npb24sIHdoaWNoOiBcInN0YXJ0XCIgfCBcImVuZFwiLCBldjogRXZlbnQpOiB2b2lkIHtcbiAgY29uc3QgdiA9IChldi50YXJnZXQgYXMgSFRNTElucHV0RWxlbWVudCkudmFsdWU7IC8vIFwiSEg6TU1cIlxuICBjb25zdCBbaCA9IDAsIG0gPSAwXSA9IHYuc3BsaXQoXCI6XCIpLm1hcChOdW1iZXIpO1xuICBpZiAoTnVtYmVyLmlzRmluaXRlKGgpICYmIE51bWJlci5pc0Zpbml0ZShtKSkgc1t3aGljaF0gPSBoICogNjAgKyBtO1xufVxuXG4vKiogQSBidWlsdC1pbiBzZXNzaW9uJ3MgY3VycmVudCB3aW5kb3csIHJlbmRlcmVkIGluIHRoZSBWSVNJVE9SJ3Mgb3duXG4gKiAgbG9jYWwgY2xvY2sgKGUuZy4gXCIwMTozMCDigJMgMDM6MzBcIikuIEJvdW5kYXJpZXMgYXJlIGNoYWluZWQgbWFya2V0XG4gKiAgb3BlbnMsIHNvIHRoaXMgdGV4dCBzaGlmdHMgYnkgYW4gaG91ciB3aGVuIERTVCBjaGFuZ2VzIGFueXdoZXJlLiAqL1xuZnVuY3Rpb24gc2Vzc2lvbldpbmRvd0xvY2FsKGRlZjogU2Vzc2lvbkRlZik6IHN0cmluZyB7XG4gIGNvbnN0IG5vdyA9IE1hdGguZmxvb3IoRGF0ZS5ub3coKSAvIDEwMDApO1xuICBjb25zdCBkYXkgPSBNYXRoLmZsb29yKG5vdyAvIDg2NDAwKTtcbiAgLy8gYm91bmRhcnkgaW5zdGFuY2VzIHdpdGhpbiDCsTM2aCBvZiBub3csIHNvcnRlZFxuICBjb25zdCBib3VuZHM6IHsgdDogbnVtYmVyOyBpZDogU2Vzc2lvbkRlZltcImlkXCJdIH1bXSA9IFtdO1xuICBmb3IgKGNvbnN0IGRkIG9mIFtkYXkgLSAyLCBkYXkgLSAxLCBkYXksIGRheSArIDEsIGRheSArIDJdKSB7XG4gICAgZm9yIChjb25zdCBkIG9mIGluZGljYXRvcnMuZGVmcykge1xuICAgICAgY29uc3QgdCA9IGJvdW5kYXJ5RXBvY2goZCwgZGQgKiA4NjQwMCk7XG4gICAgICBpZiAodCA+IG5vdyAtIDM2ICogMzYwMCAmJiB0IDwgbm93ICsgMzYgKiAzNjAwKSBib3VuZHMucHVzaCh7IHQsIGlkOiBkLmlkIH0pO1xuICAgIH1cbiAgfVxuICBib3VuZHMuc29ydCgoYSwgYikgPT4gYS50IC0gYi50KTtcbiAgLy8gdGhlIHdpbmRvdyB0aGF0IGNvbnRhaW5zIG5vdywgZWxzZSB0aGUgbmV4dCBvbmUgdG8gc3RhcnRcbiAgbGV0IHNpID0gYm91bmRzLmZpbmRJbmRleCgoYiwgaSkgPT4gYi5pZCA9PT0gZGVmLmlkICYmIGIudCA8PSBub3cgJiYgKGkgKyAxID49IGJvdW5kcy5sZW5ndGggfHwgYm91bmRzW2kgKyAxXSEudCA+IG5vdykpO1xuICBpZiAoc2kgPCAwKSBzaSA9IGJvdW5kcy5maW5kSW5kZXgoKGIpID0+IGIuaWQgPT09IGRlZi5pZCAmJiBiLnQgPiBub3cpO1xuICBpZiAoc2kgPCAwIHx8IHNpICsgMSA+PSBib3VuZHMubGVuZ3RoKSByZXR1cm4gXCLigJRcIjtcbiAgY29uc3QgZm10ID0gKHQ6IG51bWJlcik6IHN0cmluZyA9PlxuICAgIG5ldyBEYXRlKHQgKiAxMDAwKS50b0xvY2FsZVRpbWVTdHJpbmcoW10sIHsgaG91cjogXCIyLWRpZ2l0XCIsIG1pbnV0ZTogXCIyLWRpZ2l0XCIsIGhvdXIxMjogZmFsc2UgfSk7XG4gIGNvbnN0IHN0YXJ0VCA9IGJvdW5kc1tzaV0hLnQ7XG4gIGNvbnN0IGVuZFQgPSBib3VuZHNbc2kgKyAxXSEudDtcbiAgY29uc3Qgd3JhcCA9IGVuZFQgPD0gc3RhcnRUID8gXCIgKzFcIiA6IFwiXCI7XG4gIHJldHVybiBmbXQoc3RhcnRUKSArIFwiIOKAkyBcIiArIGZtdChlbmRUKSArIHdyYXA7XG59XG5cbi8qKiBOZXctY3VzdG9tLXNlc3Npb24gZm9ybSBzdGF0ZSAodGhlIHNldHRpbmdzIHBvcHVwJ3MgYWRkIHJvdykuICovXG5jb25zdCBuZXdTZXNzTmFtZSA9IHJlZihcIlwiKTtcbmNvbnN0IG5ld1Nlc3NDb2xvciA9IHJlZihcIiM3YmQ4OGZcIik7XG5jb25zdCBuZXdTZXNzU3RhcnQgPSByZWYoXCIwODowMFwiKTtcbmNvbnN0IG5ld1Nlc3NFbmQgPSByZWYoXCIxMjowMFwiKTtcbmZ1bmN0aW9uIG9uQWRkU2Vzc2lvbigpOiB2b2lkIHtcbiAgY29uc3QgcGFyc2UgPSAodjogc3RyaW5nKTogbnVtYmVyID0+IHtcbiAgICBjb25zdCBbaCA9IDAsIG0gPSAwXSA9IHYuc3BsaXQoXCI6XCIpLm1hcChOdW1iZXIpO1xuICAgIHJldHVybiBoICogNjAgKyBtO1xuICB9O1xuICBpZiAoaW5kaWNhdG9ycy5hZGRDdXN0b21TZXNzaW9uKG5ld1Nlc3NOYW1lLnZhbHVlLCBwYXJzZShuZXdTZXNzU3RhcnQudmFsdWUpLCBwYXJzZShuZXdTZXNzRW5kLnZhbHVlKSwgbmV3U2Vzc0NvbG9yLnZhbHVlKSkge1xuICAgIG5ld1Nlc3NOYW1lLnZhbHVlID0gXCJcIjtcbiAgfVxufVxuXG4vLyBJbmRpY2F0b3IgdG9nZ2xlcyBkb24ndCBtb3ZlIHRoZSBjaGFydCDigJQgcmUtcHJvamVjdCB0aGUgYm94ZXMgZGlyZWN0bHlcbndhdGNoKFxuICAoKSA9PiBbaW5kaWNhdG9ycy5zZXNzaW9uc0FkZGVkLCBpbmRpY2F0b3JzLnNlc3Npb25zVmlzaWJsZSwgaW5kaWNhdG9ycy5zZXNzaW9uc0xhYmVscywgaW5kaWNhdG9ycy5zZXNzaW9uc0VuYWJsZWQsIGluZGljYXRvcnMuZGVmcywgaW5kaWNhdG9ycy5jdXN0b21zXSxcbiAgKCkgPT4gcmVjYWxjUmVjdHMoKSxcbiAgeyBkZWVwOiB0cnVlIH1cbik7XG5cbi8qKiBQcmljZSBkaXNwbGF5IHByZWNpc2lvbiBvZiB0aGUgYWN0aXZlIGluc3RydW1lbnQgKHRlbXBsYXRlICsgdGFncykuICovXG5jb25zdCBwcmVjID0gY29tcHV0ZWQoKCkgPT4gaW5zdHJ1bWVudFByZWNpc2lvbihtYXJrZXQuaW5zdHJ1bWVudCkpO1xuXG4vKiDilIDilIAgRGVtbyB0cmFkaW5nOiBjaGFydCBsaW5lcyBmb3IgcGVuZGluZy9vcGVuIHBvc2l0aW9ucyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIAgKi9cbmludGVyZmFjZSBEZW1vTGluZVB4IHtcbiAgaWQ6IHN0cmluZztcbiAgbGV2ZWw6IFwiZW50cnlcIiB8IFwic2xcIiB8IFwidHBcIjtcbiAgeTogbnVtYmVyO1xuICAvKiogdGhlIGxpbmUncyBwcmljZSDigJQgc2hvd24gb24gdGhlIHByaWNlLXNjYWxlIHRhZyAqL1xuICBwcmljZTogbnVtYmVyO1xuICBjb2xvcjogc3RyaW5nO1xuICBkYXNoZWQ6IGJvb2xlYW47XG4gIGRpcmVjdGlvbjogRGVtb1NpZGU7XG4gIHN0YXR1czogRGVtb1N0YXR1cztcbiAgbG90OiBudW1iZXI7XG4gIC8qKiAkIHZhbHVlcyBmb3IgdGhlIGxpbmUgbGFiZWxzICovXG4gIG1vbmV5OiBudW1iZXI7XG4gIHJyOiBudW1iZXIgfCBudWxsO1xufVxuY29uc3QgZGVtb0xpbmVzID0gcmVmPERlbW9MaW5lUHhbXT4oW10pO1xubGV0IGRlbW9MaW5lRHJhZzogeyBpZDogc3RyaW5nOyBsZXZlbDogXCJlbnRyeVwiIHwgXCJzbFwiIHwgXCJ0cFwiIH0gfCBudWxsID0gbnVsbDtcbmNvbnN0IGRlbW9UYWIgPSByZWY8XCJwb3NpdGlvbnNcIiB8IFwiaGlzdG9yeVwiIHwgXCJzdGF0c1wiPihcInBvc2l0aW9uc1wiKTtcbmNvbnN0IGRlbW9QZXJpb2QgPSByZWY8XCJkYXlcIiB8IFwid2Vla1wiIHwgXCJtb250aFwiIHwgXCJhbGxcIj4oXCJ3ZWVrXCIpO1xuLyoqIEhlaWdodCBvZiB0aGUgZGVtbyBib3R0b20gcGFuZWwgKG1lYXN1cmVkKSDigJQgdGhlIHJlcGxheSBwYW5lbCBmbG9hdHNcbiAqICBqdXN0IGFib3ZlIGl0IHdoaWxlIGJvdGggYXJlIGFjdGl2ZS4gKi9cbmNvbnN0IGRlbW9Cb3R0b21IID0gcmVmKDk2KTtcbi8qKiBWaXNpYmxlIGNoYXJ0IGhlaWdodCAoZXhjbHVkZXMgdGltZSBheGlzKSDigJQgaGlkZXMgZGVtbyB0YWdzIGZvciBsZXZlbHNcbiAqICB0aGF0IHNjcm9sbGVkIG91dCBvZiB0aGUgY2hhcnQgaW5zdGVhZCBvZiBkcmF3aW5nIHRoZW0gb3ZlciB0aGUgcGFuZWwuICovXG5jb25zdCBkZW1vQ2hhcnRIID0gcmVmKDApO1xuY29uc3QgZGVtb01pbmkgPSByZWYoZmFsc2UpO1xuXG5mdW5jdGlvbiBkZW1vTGV2ZWxZKHByaWNlOiBudW1iZXIpOiBudW1iZXIgfCBudWxsIHtcbiAgcmV0dXJuIGFkYXB0ZXIgPyBhZGFwdGVyLmdldFByaWNlWShwcmljZSkgOiBudWxsO1xufVxuXG5mdW5jdGlvbiByZWJ1aWxkRGVtb0xpbmVzKCk6IHZvaWQge1xuICBjb25zdCBvdXQ6IERlbW9MaW5lUHhbXSA9IFtdO1xuICBpZiAoIWRlbW8uYWN0aXZlKSB7IGRlbW9MaW5lcy52YWx1ZSA9IG91dDsgcmV0dXJuOyB9XG4gIGNvbnN0IHByZWMgPSBpbnN0cnVtZW50UHJlY2lzaW9uKG1hcmtldC5pbnN0cnVtZW50KTtcbiAgY29uc3QgdnBwT2YgPSAocDogeyBzeW1ib2w6IHN0cmluZzsgZW50cnk6IG51bWJlciB9KSA9PiBkZW1vVmFsdWVQZXJQcmljZShwLnN5bWJvbCwgcC5lbnRyeSk7XG4gIGZvciAoY29uc3QgcCBvZiBkZW1vLm9wZW5Qb3NpdGlvbnMpIHtcbiAgICBpZiAocC5zeW1ib2wgIT09IG1hcmtldC5pbnN0cnVtZW50KSBjb250aW51ZTtcbiAgICBjb25zdCB2cHAgPSB2cHBPZihwKTtcbiAgICBjb25zdCByaXNrID0gcC5zbCAhPT0gbnVsbCA/IE1hdGguYWJzKHAuZW50cnkgLSBwLnNsKSAqIHAubG90ICogdnBwIDogMDtcbiAgICBjb25zdCByZXdhcmQgPSBwLnRwICE9PSBudWxsID8gTWF0aC5hYnMocC50cCAtIHAuZW50cnkpICogcC5sb3QgKiB2cHAgOiAwO1xuICAgIGNvbnN0IHJyID0gcmlzayA+IDAgPyArKHJld2FyZCAvIHJpc2spLnRvRml4ZWQoMikgOiBudWxsO1xuICAgIC8vIGJsdWUgZW50cnkgbGluZSBhdCB0aGUgZmlsbGVkIHByaWNlIChtYXJrZXQgYW5kIGZpbGxlZCBsaW1pdHMgYWxpa2UpXG4gICAge1xuICAgICAgY29uc3QgeSA9IGRlbW9MZXZlbFkocC5lbnRyeSk7XG4gICAgICBpZiAoeSAhPT0gbnVsbCkgb3V0LnB1c2goeyBpZDogcC5pZCwgbGV2ZWw6IFwiZW50cnlcIiwgeSwgcHJpY2U6IHAuZW50cnksIGNvbG9yOiBcIiMyOTYyZmZcIiwgZGFzaGVkOiBmYWxzZSwgZGlyZWN0aW9uOiBwLmRpcmVjdGlvbiwgc3RhdHVzOiBcIm9wZW5cIiwgbG90OiBwLmxvdCwgbW9uZXk6IDAsIHJyOiBudWxsIH0pO1xuICAgIH1cbiAgICBpZiAocC5zbCAhPT0gbnVsbCkge1xuICAgICAgY29uc3QgeSA9IGRlbW9MZXZlbFkocC5zbCk7XG4gICAgICBpZiAoeSAhPT0gbnVsbCkgb3V0LnB1c2goeyBpZDogcC5pZCwgbGV2ZWw6IFwic2xcIiwgeSwgcHJpY2U6IHAuc2wsIGNvbG9yOiBcIiNlZjUzNTBcIiwgZGFzaGVkOiBmYWxzZSwgZGlyZWN0aW9uOiBwLmRpcmVjdGlvbiwgc3RhdHVzOiBcIm9wZW5cIiwgbG90OiBwLmxvdCwgbW9uZXk6ICtyaXNrLnRvRml4ZWQoMiksIHJyOiBudWxsIH0pO1xuICAgIH1cbiAgICBpZiAocC50cCAhPT0gbnVsbCkge1xuICAgICAgY29uc3QgeSA9IGRlbW9MZXZlbFkocC50cCk7XG4gICAgICBpZiAoeSAhPT0gbnVsbCkgb3V0LnB1c2goeyBpZDogcC5pZCwgbGV2ZWw6IFwidHBcIiwgeSwgcHJpY2U6IHAudHAsIGNvbG9yOiBcIiMyNmE2OWFcIiwgZGFzaGVkOiBmYWxzZSwgZGlyZWN0aW9uOiBwLmRpcmVjdGlvbiwgc3RhdHVzOiBcIm9wZW5cIiwgbG90OiBwLmxvdCwgbW9uZXk6ICtyZXdhcmQudG9GaXhlZCgyKSwgcnIgfSk7XG4gICAgfVxuICB9XG4gIC8vIFBlbmRpbmcgbGltaXQgb3JkZXJzOiBhbGwgdGhyZWUgbGluZXMgKGVudHJ5IGRhc2hlZCksIGxpa2UgdGhlIGRyYWZ0XG4gIGZvciAoY29uc3QgcCBvZiBkZW1vLnBvc2l0aW9ucykge1xuICAgIGlmIChwLnN5bWJvbCAhPT0gbWFya2V0Lmluc3RydW1lbnQgfHwgcC5zdGF0dXMgIT09IFwicGVuZGluZ1wiKSBjb250aW51ZTtcbiAgICBjb25zdCB2cHAgPSB2cHBPZihwKTtcbiAgICBjb25zdCByaXNrID0gcC5zbCAhPT0gbnVsbCA/IE1hdGguYWJzKHAuZW50cnkgLSBwLnNsKSAqIHAubG90ICogdnBwIDogMDtcbiAgICBjb25zdCByZXdhcmQgPSBwLnRwICE9PSBudWxsID8gTWF0aC5hYnMocC50cCAtIHAuZW50cnkpICogcC5sb3QgKiB2cHAgOiAwO1xuICAgIGNvbnN0IHJyID0gcmlzayA+IDAgJiYgcC50cCAhPT0gbnVsbCA/ICsoKE1hdGguYWJzKHAudHAgLSBwLmVudHJ5KSAqIHAubG90ICogdnBwKSAvIHJpc2spLnRvRml4ZWQoMikgOiBudWxsO1xuICAgIGNvbnN0IHlFbnRyeSA9IGRlbW9MZXZlbFkocC5lbnRyeSk7XG4gICAgaWYgKHlFbnRyeSAhPT0gbnVsbCkgb3V0LnB1c2goeyBpZDogcC5pZCwgbGV2ZWw6IFwiZW50cnlcIiwgeTogeUVudHJ5LCBwcmljZTogcC5lbnRyeSwgY29sb3I6IFwiIzI5NjJmZlwiLCBkYXNoZWQ6IHRydWUsIGRpcmVjdGlvbjogcC5kaXJlY3Rpb24sIHN0YXR1czogXCJwZW5kaW5nXCIsIGxvdDogcC5sb3QsIG1vbmV5OiAwLCBycjogbnVsbCB9KTtcbiAgICBpZiAocC5zbCAhPT0gbnVsbCkge1xuICAgICAgY29uc3QgeSA9IGRlbW9MZXZlbFkocC5zbCk7XG4gICAgICBpZiAoeSAhPT0gbnVsbCkgb3V0LnB1c2goeyBpZDogcC5pZCwgbGV2ZWw6IFwic2xcIiwgeSwgcHJpY2U6IHAuc2wsIGNvbG9yOiBcIiNlZjUzNTBcIiwgZGFzaGVkOiBmYWxzZSwgZGlyZWN0aW9uOiBwLmRpcmVjdGlvbiwgc3RhdHVzOiBcInBlbmRpbmdcIiwgbG90OiBwLmxvdCwgbW9uZXk6ICtyaXNrLnRvRml4ZWQoMiksIHJyOiBudWxsIH0pO1xuICAgIH1cbiAgICBpZiAocC50cCAhPT0gbnVsbCkge1xuICAgICAgY29uc3QgeSA9IGRlbW9MZXZlbFkocC50cCk7XG4gICAgICBpZiAoeSAhPT0gbnVsbCkgb3V0LnB1c2goeyBpZDogcC5pZCwgbGV2ZWw6IFwidHBcIiwgeSwgcHJpY2U6IHAudHAsIGNvbG9yOiBcIiMyNmE2OWFcIiwgZGFzaGVkOiBmYWxzZSwgZGlyZWN0aW9uOiBwLmRpcmVjdGlvbiwgc3RhdHVzOiBcInBlbmRpbmdcIiwgbG90OiBwLmxvdCwgbW9uZXk6ICtyZXdhcmQudG9GaXhlZCgyKSwgcnIgfSk7XG4gICAgfVxuICB9XG4gIC8vIERyYWZ0IG9yZGVyIGxpbmVzIChhcm1lZCBidXQgbm90IHlldCBTZXQpIOKAlCBtYXJrZXQ6IFNML1RQIG9ubHkgKGVudHJ5XG4gIC8vIGlzIHRoZSBwaW5uZWQgY3VycmVudCBwcmljZSBhbmQgZ2V0cyBpdHMgbGluZSBhZnRlciBTZXQgZmlsbHMpO1xuICAvLyBsaW1pdDogYWxsIHRocmVlIGxpbmVzLCBlbnRyeSBkYXNoZWQgYW5kIGRyYWdnYWJsZS5cbiAgaWYgKGRyYWZ0LnZhbHVlKSB7XG4gICAgY29uc3QgZCA9IGRyYWZ0LnZhbHVlO1xuICAgIGNvbnN0IGRpc3RTbCA9IE1hdGguYWJzKGQuZW50cnkgLSBkLnNsKTtcbiAgICBjb25zdCBkaXN0VHAgPSBNYXRoLmFicyhkLnRwIC0gZC5lbnRyeSk7XG4gICAgY29uc3QgdnBwID0gZGVtb1ZhbHVlUGVyUHJpY2UobWFya2V0Lmluc3RydW1lbnQsIGQuZW50cnkpO1xuICAgIGNvbnN0IHJpc2sgPVxuICAgICAgZGVtby5zaXplTW9kZSA9PT0gXCJsb3RcIlxuICAgICAgICA/IGRpc3RTbCAqIGRlbW8ubG90ICogdnBwXG4gICAgICAgIDogZGVtby5zaXplTW9kZSA9PT0gXCJwZXJjZW50XCJcbiAgICAgICAgICA/IChkZW1vLmJhbGFuY2UgKiBkZW1vLnJpc2tQY3QpIC8gMTAwXG4gICAgICAgICAgOiBkZW1vLnJpc2tVc2Q7XG4gICAgY29uc3QgbG90RWZmID1cbiAgICAgIGRlbW8uc2l6ZU1vZGUgPT09IFwibG90XCJcbiAgICAgICAgPyBkZW1vLmxvdFxuICAgICAgICA6IGRpc3RTbCA+IDAgPyBNYXRoLm1pbigxMDAsIE1hdGgubWF4KDAuMDEsICsocmlzayAvIChkaXN0U2wgKiB2cHApKS50b0ZpeGVkKDIpKSkgOiBkZW1vLmxvdDtcbiAgICBjb25zdCByZXdhcmQgPSBkaXN0VHAgKiBsb3RFZmYgKiB2cHA7XG4gICAgY29uc3QgcnIgPSBkaXN0U2wgPiAwID8gKyhkaXN0VHAgLyBkaXN0U2wpLnRvRml4ZWQoMikgOiBudWxsO1xuICAgIGNvbnN0IHlTbCA9IGRlbW9MZXZlbFkoZC5zbCk7XG4gICAgY29uc3QgeVRwID0gZGVtb0xldmVsWShkLnRwKTtcbiAgICBpZiAoZC5raW5kID09PSBcImxpbWl0XCIpIHtcbiAgICAgIGNvbnN0IHlFbnRyeSA9IGRlbW9MZXZlbFkoZC5lbnRyeSk7XG4gICAgICBpZiAoeUVudHJ5ICE9PSBudWxsKSBvdXQucHVzaCh7IGlkOiBcIl9fZHJhZnRcIiwgbGV2ZWw6IFwiZW50cnlcIiwgeTogeUVudHJ5LCBwcmljZTogZC5lbnRyeSwgY29sb3I6IFwiIzI5NjJmZlwiLCBkYXNoZWQ6IHRydWUsIGRpcmVjdGlvbjogZC5zaWRlLCBzdGF0dXM6IFwicGVuZGluZ1wiLCBsb3Q6IGxvdEVmZiwgbW9uZXk6IDAsIHJyOiBudWxsIH0pO1xuICAgIH1cbiAgICBpZiAoeVNsICE9PSBudWxsKSBvdXQucHVzaCh7IGlkOiBcIl9fZHJhZnRcIiwgbGV2ZWw6IFwic2xcIiwgeTogeVNsLCBwcmljZTogZC5zbCwgY29sb3I6IFwiI2VmNTM1MFwiLCBkYXNoZWQ6IGZhbHNlLCBkaXJlY3Rpb246IGQuc2lkZSwgc3RhdHVzOiBcInBlbmRpbmdcIiwgbG90OiBsb3RFZmYsIG1vbmV5OiArcmlzay50b0ZpeGVkKDIpLCBycjogbnVsbCB9KTtcbiAgICBpZiAoeVRwICE9PSBudWxsKSBvdXQucHVzaCh7IGlkOiBcIl9fZHJhZnRcIiwgbGV2ZWw6IFwidHBcIiwgeTogeVRwLCBwcmljZTogZC50cCwgY29sb3I6IFwiIzI2YTY5YVwiLCBkYXNoZWQ6IGZhbHNlLCBkaXJlY3Rpb246IGQuc2lkZSwgc3RhdHVzOiBcInBlbmRpbmdcIiwgbG90OiBsb3RFZmYsIG1vbmV5OiArcmV3YXJkLnRvRml4ZWQoMiksIHJyIH0pO1xuICB9XG4gIGRlbW9MaW5lcy52YWx1ZSA9IG91dDtcbn1cblxuZnVuY3Rpb24gb25EZW1vTGluZURyYWdTdGFydChlOiBNb3VzZUV2ZW50LCBpZDogc3RyaW5nLCBsZXZlbDogXCJlbnRyeVwiIHwgXCJzbFwiIHwgXCJ0cFwiKTogdm9pZCB7XG4gIGlmIChlLmJ1dHRvbiAhPT0gMCB8fCAhYWRhcHRlciB8fCAhY29udGFpbmVyUmVmLnZhbHVlKSByZXR1cm47XG4gIC8vIFRoZSBlbnRyeSBvZiBhbiBPUEVOIHBvc2l0aW9uIGlzIGZpbGxlZCDigJQgaXQgbXVzdCBub3QgbW92ZS4gT25seVxuICAvLyBwZW5kaW5nIChsaW1pdCkgb3JkZXJzIGFuZCB0aGUgZHJhZnQga2VlcCBhIGRyYWdnYWJsZSBlbnRyeS5cbiAgaWYgKGlkICE9PSBcIl9fZHJhZnRcIiAmJiBsZXZlbCA9PT0gXCJlbnRyeVwiKSB7XG4gICAgY29uc3QgcG9zID0gZGVtby5wb3NpdGlvbnMuZmluZCgoeCkgPT4geC5pZCA9PT0gaWQpO1xuICAgIGlmIChwb3MgJiYgcG9zLnN0YXR1cyA9PT0gXCJvcGVuXCIpIHJldHVybjtcbiAgfVxuICBlLnByZXZlbnREZWZhdWx0KCk7XG4gIGUuc3RvcFByb3BhZ2F0aW9uKCk7XG4gIGRlbW9MaW5lRHJhZyA9IHsgaWQsIGxldmVsIH07XG4gIGNvbnN0IG1vdmUgPSAoZXY6IE1vdXNlRXZlbnQpID0+IHtcbiAgICBpZiAoIWRlbW9MaW5lRHJhZyB8fCAhYWRhcHRlciB8fCAhY29udGFpbmVyUmVmLnZhbHVlKSByZXR1cm47XG4gICAgY29uc3QgciA9IGNvbnRhaW5lclJlZi52YWx1ZS5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgICAvLyBDbGFtcCB0aGUgY3Vyc29yIHRvIHRoZSBjaGFydCBhcmVhOiB5VG9QcmljZSBleHRyYXBvbGF0ZXMgd2lsZGx5XG4gICAgLy8gb3V0c2lkZSBpdCwgc28gYSBmYXN0IGRyYWcgaW50byB0aGUgZGVtbyBwYW5lbCAvIGF4ZXMgd291bGQgc2V0XG4gICAgLy8gU0wvVFAgdG8gYWJzdXJkIHByaWNlcyAoZS5nLiAtOTk5OTk5KS5cbiAgICBjb25zdCBjeSA9IE1hdGgubWluKE1hdGgubWF4KGV2LmNsaWVudFksIHIudG9wICsgMiksIHIuYm90dG9tIC0gMik7XG4gICAgY29uc3QgcCA9IGFkYXB0ZXIueVRvUHJpY2UoY3kgLSByLnRvcCk7XG4gICAgaWYgKHAgPT09IG51bGwgfHwgIU51bWJlci5pc0Zpbml0ZShwKSB8fCBwIDw9IDApIHJldHVybjtcbiAgICAvLyBEcmFmdCBsaW5lcyBhZGp1c3QgdGhlIGluLXByb2dyZXNzIG9yZGVyIChlbnRyeSBzaGlmdHMgdGhlIHdob2xlXG4gICAgLy8gc3RydWN0dXJlOyBTTC9UUCBjbGFtcCB0byB0aGUgbG9zcy9wcm9maXQgc2lkZXMpOyByZWFsIHBvc2l0aW9uc1xuICAgIC8vIHVwZGF0ZSB0aHJvdWdoIHRoZSBzdG9yZS5cbiAgICBpZiAoaWQgPT09IFwiX19kcmFmdFwiICYmIGRyYWZ0LnZhbHVlKSB7XG4gICAgICBjb25zdCBkID0gZHJhZnQudmFsdWU7XG4gICAgICBjb25zdCBsb25nID0gZC5zaWRlID09PSBcImxvbmdcIjtcbiAgICAgIGlmIChsZXZlbCA9PT0gXCJlbnRyeVwiKSB7XG4gICAgICAgIC8vIGVudHJ5IG1vdmVzIG9uIGl0cyBvd24g4oCUIGNsYW1wZWQgYmV0d2VlbiBTTCBhbmQgVFAsIG5ldmVyXG4gICAgICAgIC8vIGRyYWdnaW5nIHRoZSBvdGhlciBsaW5lcyB3aXRoIGl0XG4gICAgICAgIGQuZW50cnkgPSBsb25nXG4gICAgICAgICAgPyBNYXRoLm1pbihNYXRoLm1heChwLCBkLnNsKSwgZC50cClcbiAgICAgICAgICA6IE1hdGgubWluKE1hdGgubWF4KHAsIGQudHApLCBkLnNsKTtcbiAgICAgIH0gZWxzZSBpZiAobGV2ZWwgPT09IFwic2xcIikge1xuICAgICAgICBkLnNsID0gbG9uZyA/IE1hdGgubWluKHAsIGQuZW50cnkpIDogTWF0aC5tYXgocCwgZC5lbnRyeSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBkLnRwID0gbG9uZyA/IE1hdGgubWF4KHAsIGQuZW50cnkpIDogTWF0aC5taW4ocCwgZC5lbnRyeSk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIGRlbW8udXBkYXRlTGV2ZWwoaWQsIGxldmVsLCBwKTtcbiAgICB9XG4gICAgcmVjYWxjUmVjdHMoKTtcbiAgfTtcbiAgY29uc3QgdXAgPSAoKSA9PiB7XG4gICAgZGVtb0xpbmVEcmFnID0gbnVsbDtcbiAgICB3aW5kb3cucmVtb3ZlRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJtb3ZlXCIsIG1vdmUpO1xuICAgIHdpbmRvdy5yZW1vdmVFdmVudExpc3RlbmVyKFwicG9pbnRlcnVwXCIsIHVwKTtcbiAgfTtcbiAgd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoXCJwb2ludGVybW92ZVwiLCBtb3ZlKTtcbiAgd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoXCJwb2ludGVydXBcIiwgdXApO1xufVxuXG4vKiogRHJhZnQgb3JkZXI6IGxpbmVzIGRyYXcgb24gdGhlIGNoYXJ0IChlbnRyeS9TTC9UUCksIGFkanVzdGFibGUgYnlcbiAqICBkcmFnZ2luZywgdW50aWwgU2V0IHBsYWNlcyBpdCBvciBDYW5jZWwgZGlzY2FyZHMgaXQuICovXG5jb25zdCBkcmFmdCA9IHJlZjxudWxsIHwge1xuICBzaWRlOiBEZW1vU2lkZTtcbiAga2luZDogRGVtb0tpbmQ7XG4gIGVudHJ5OiBudW1iZXI7XG4gIHNsOiBudW1iZXI7XG4gIHRwOiBudW1iZXI7XG59PihudWxsKTtcblxuZnVuY3Rpb24gYXJtRGVtbyhzaWRlOiBEZW1vU2lkZSwga2luZDogRGVtb0tpbmQpOiB2b2lkIHtcbiAgLy8gTWFya2V0IGNsb3NlZCAobGl2ZSk6IHRoZSBvcmRlciBidXR0b25zIGRvIG5vdGhpbmcg4oCUIHJlcGxheSBpcyBhbGxvd2VkXG4gIGlmICghcmVwbGF5LmFjdGl2ZSAmJiBkZW1vLmlzQ2xvc2VkKCkpIHJldHVybjtcbiAgY29uc3QgYyA9IG1hcmtldC5jYW5kbGVzO1xuICBpZiAoIWMubGVuZ3RoKSByZXR1cm47XG4gIC8vIE1hcmtldDogZW50cnkgaXMgdGhlIGN1cnJlbnQgcHJpY2Ug4oCUIGluIHJlcGxheSBtb2RlIHRoYXQgaXMgdGhlIGxhc3RcbiAgLy8gVklTSUJMRSAoYm91bmRhcnkpIGNhbmRsZSdzIGNsb3NlLCBub3QgdGhlIGxpdmUgcHJpY2VcbiAgY29uc3QgbGFzdCA9XG4gICAgcmVwbGF5LmFjdGl2ZSAmJiByZXBsYXkuY3V0b2ZmICE9PSBudWxsXG4gICAgICA/IGMuZmlsdGVyKCh4KSA9PiB4LnRpbWUgPD0gcmVwbGF5LmN1dG9mZiEpLnNsaWNlKC0xKVswXSEuY2xvc2VcbiAgICAgIDogY1tjLmxlbmd0aCAtIDFdIS5jbG9zZTtcbiAgY29uc3QgbG9uZyA9IHNpZGUgPT09IFwibG9uZ1wiO1xuICBjb25zdCBkaXIgPSBsb25nID8gMSA6IC0xO1xuICAvLyBkZWZhdWx0IFNML1RQIGRpc3RhbmNlcyBzY2FsZSB3aXRoIHRoZSB0aW1lZnJhbWUgdmlhIHRoZSBhdmVyYWdlXG4gIC8vIGNhbmRsZSByYW5nZSAoQVRSLTE0KTogdGlnaHQgb24gMW0sIHdpZGUgb24gRC9XXG4gIGNvbnN0IHZpc2libGUgPVxuICAgIHJlcGxheS5hY3RpdmUgJiYgcmVwbGF5LmN1dG9mZiAhPT0gbnVsbCA/IGMuZmlsdGVyKCh4KSA9PiB4LnRpbWUgPD0gcmVwbGF5LmN1dG9mZiEpIDogYztcbiAgY29uc3Qgd2luID0gdmlzaWJsZS5zbGljZSgtMTQpO1xuICBjb25zdCBhdHIgPVxuICAgIHdpbi5sZW5ndGggPiAxXG4gICAgICA/IHdpbi5yZWR1Y2UoKHMsIHgpID0+IHMgKyAoeC5oaWdoIC0geC5sb3cpLCAwKSAvIHdpbi5sZW5ndGhcbiAgICAgIDogMDtcbiAgY29uc3Qgc2xEaXN0ID0gYXRyID4gMCA/IGF0ciAqIDEuNSA6IGxhc3QgKiAwLjAwNTtcbiAgLy8gbGltaXQ6IGVudHJ5IDEgQVRSIGF3YXkgKGRyYWdnYWJsZSlcbiAgY29uc3QgZW50cnkgPSBraW5kID09PSBcImxpbWl0XCIgPyBsYXN0IC0gZGlyICogc2xEaXN0IDogbGFzdDtcbiAgZHJhZnQudmFsdWUgPSB7XG4gICAgc2lkZSxcbiAgICBraW5kLFxuICAgIGVudHJ5LFxuICAgIHNsOiBlbnRyeSAtIGRpciAqIHNsRGlzdCxcbiAgICB0cDogZW50cnkgKyBkaXIgKiBzbERpc3QgKiAyLFxuICB9O1xuICBkZW1vLmVycm9yID0gbnVsbDtcbiAgcmVjYWxjUmVjdHMoKTtcbn1cblxuZnVuY3Rpb24gc2V0RGVtb0RyYWZ0KCk6IHZvaWQge1xuICBjb25zdCBkID0gZHJhZnQudmFsdWU7XG4gIGlmICghZCkgcmV0dXJuO1xuICAvLyBMaXZlIG1hcmtldCBjbG9zZWQg4oaSIGJsb2NrIChyZXBsYXkgdHJhZGVzIGFnYWluc3QgdGhlIGN1dCBkYXRhIGFyZSBmaW5lKVxuICBpZiAoIXJlcGxheS5hY3RpdmUgJiYgaXNGb3JleENsb3NlZCgpKSB7XG4gICAgZGVtby5lcnJvciA9IFwiTWFya2V0IGNsb3NlZCDigJQgdXNlIFJlcGxheSB0byBwbGFjZSB0cmFkZXNcIjtcbiAgICByZXR1cm47XG4gIH1cbiAgZGVtby5wbGFjZU9yZGVyKG1hcmtldC5pbnN0cnVtZW50LCBkLnNpZGUsIGQua2luZCwgZC5lbnRyeSwgZC5zbCwgZC50cCk7XG4gIGRyYWZ0LnZhbHVlID0gbnVsbDtcbn1cblxuZnVuY3Rpb24gY2FuY2VsRGVtb0RyYWZ0KCk6IHZvaWQge1xuICBkcmFmdC52YWx1ZSA9IG51bGw7XG59XG5cbmNvbnN0IGRlbW9TdW1tYXJ5ID0gY29tcHV0ZWQoKCkgPT4gZGVtby5zdW1tYXJ5Rm9yKGRlbW9QZXJpb2QudmFsdWUpKTtcbmNvbnN0IHBlbmRpbmdPcmRlcnMgPSBjb21wdXRlZCgoKSA9PiBkZW1vLnBvc2l0aW9ucy5maWx0ZXIoKHApID0+IHAuc3RhdHVzID09PSBcInBlbmRpbmdcIikpO1xuY29uc3QgbWFya2V0Q2xvc2VkTm90ZSA9IGNvbXB1dGVkKCgpID0+ICFyZXBsYXkuYWN0aXZlICYmIGlzRm9yZXhDbG9zZWQoKSk7XG5mdW5jdGlvbiBwbmxDbGFzcyh2OiBudW1iZXIgfCB1bmRlZmluZWQpOiBzdHJpbmcge1xuICByZXR1cm4gKHYgPz8gMCkgPj0gMCA/IFwicG9zXCIgOiBcIm5lZ1wiO1xufVxuZnVuY3Rpb24gZm10TW9uZXkodjogbnVtYmVyKTogc3RyaW5nIHtcbiAgcmV0dXJuICh2ID49IDAgPyBcIiRcIiA6IFwiLSRcIikgKyBNYXRoLmFicyh2KS50b0xvY2FsZVN0cmluZyhcImVuLVVTXCIsIHsgbWluaW11bUZyYWN0aW9uRGlnaXRzOiAyLCBtYXhpbXVtRnJhY3Rpb25EaWdpdHM6IDIgfSk7XG59XG5cbmNvbnN0IHRoZW1lU3RvcmUgPSB1c2VUaGVtZVN0b3JlKCk7XG5jb25zdCBjb250YWluZXJSZWYgPSByZWY8SFRNTEVsZW1lbnQgfCBudWxsPihudWxsKTtcbmxldCBhZGFwdGVyOiBDaGFydEFkYXB0ZXIgfCBudWxsID0gbnVsbDtcbmxldCBybzogUmVzaXplT2JzZXJ2ZXIgfCBudWxsID0gbnVsbDtcblxuLyoqIENhbmRsZXMgdGhlIGNoYXJ0IGFjdHVhbGx5IHNob3dzOiBpbiByZXBsYXkgbW9kZSBldmVyeXRoaW5nIGFmdGVyIHRoZVxuICogIHJlcGxheSBib3VuZGFyeSBpcyBoaWRkZW4uIFRoZSBmdWxsIHNlcmllcyBzdGF5cyB1bnRvdWNoZWQgaW4gdGhlIHN0b3JlLFxuICogIHNvIGxhenktbG9hZGluZyBrZWVwcyB3b3JraW5nIGFuZCBleGl0IHJlc3RvcmVzIHRoZSBjaGFydCBpbnN0YW50bHkuICovXG5jb25zdCBkaXNwbGF5Q2FuZGxlcyA9IGNvbXB1dGVkKCgpID0+XG4gIHJlcGxheS5hY3RpdmUgJiYgcmVwbGF5LmN1dG9mZiAhPT0gbnVsbFxuICAgID8gcHJvcHMuY2FuZGxlcy5maWx0ZXIoKGMpID0+IGMudGltZSA8PSByZXBsYXkuY3V0b2ZmISlcbiAgICA6IHByb3BzLmNhbmRsZXNcbik7XG5cbi8qIOKUgOKUgCBSZXBsYXkgcGxheWJhY2sgZW5naW5lIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgCAqL1xuY29uc3QgcGlja1RpbWUgPSByZWY8bnVtYmVyIHwgbnVsbD4obnVsbCk7XG5jb25zdCByZXBsYXlWbFggPSByZWY8bnVtYmVyIHwgbnVsbD4obnVsbCk7XG5jb25zdCByZXBsYXlUYWcgPSByZWY8eyB5OiBudW1iZXI7IHRleHQ6IHN0cmluZyB9IHwgbnVsbD4obnVsbCk7XG5sZXQgcmVwbGF5VGltZXI6IFJldHVyblR5cGU8dHlwZW9mIHNldEludGVydmFsPiB8IG51bGwgPSBudWxsO1xubGV0IGhvbGRUaW1lcjogUmV0dXJuVHlwZTx0eXBlb2Ygc2V0SW50ZXJ2YWw+IHwgbnVsbCA9IG51bGw7XG5sZXQgaG9sZFRpbWVvdXQ6IFJldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgbnVsbCA9IG51bGw7XG5sZXQgcGlja2luZ01vdmU6ICgoZXY6IE1vdXNlRXZlbnQpID0+IHZvaWQpIHwgbnVsbCA9IG51bGw7XG5cbi8qKiBBZHZhbmNlIHRoZSByZXBsYXkgYm91bmRhcnkgdG8gdGhlIG5leHQgLyBwcmV2aW91cyBjYW5kbGUuICovXG5mdW5jdGlvbiByZXBsYXlTdGVwKGRpcjogMSB8IC0xKTogdm9pZCB7XG4gIGNvbnN0IGFyciA9IHByb3BzLmNhbmRsZXM7XG4gIGlmICghYXJyLmxlbmd0aCB8fCByZXBsYXkuY3V0b2ZmID09PSBudWxsKSByZXR1cm47XG4gIGlmIChkaXIgPT09IDEpIHtcbiAgICBjb25zdCBuZXh0ID0gYXJyLmZpbmQoKGMpID0+IGMudGltZSA+IHJlcGxheS5jdXRvZmYhKTtcbiAgICBpZiAoIW5leHQpIHtcbiAgICAgIHJlcGxheS5wbGF5aW5nID0gZmFsc2U7IC8vIHJlYWNoZWQgdGhlIG5ld2VzdCBjYW5kbGVcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgLy8gTmV2ZXIgc3RlcCBhY3Jvc3MgYSBkYXRhIGRpc2NvbnRpbnVpdHk6IGFmdGVyIGEgVEYvc3ltYm9sIHN3aXRjaCBpblxuICAgIC8vIHJlcGxheSB0aGUgbG9hZGVkIGhpc3RvcnkgRU5EUyBhdCB0aGUgYm91bmRhcnkg4oCUIHRoZSBuZXh0IGNhbmRsZSBpblxuICAgIC8vIHRoZSBmdWxsIGFycmF5IGlzIGEgbGl2ZS1zdHJlYW0gY2FuZGxlIGZyb20gYWZ0ZXIgdGhlIGZldGNoIHdpbmRvdyxcbiAgICAvLyBhbmQgcmV2ZWFsaW5nIGl0IHdvdWxkIGRyYXcgb25lIGh1Z2UgY2FuZGxlIGFjcm9zcyB0aGUgZ2FwLlxuICAgIGlmIChyZXBsYXkuZGF0YUVuZCAhPT0gbnVsbCAmJiBuZXh0LnRpbWUgPiByZXBsYXkuZGF0YUVuZCkge1xuICAgICAgcmVwbGF5LnBsYXlpbmcgPSBmYWxzZTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgcmVwbGF5LnN0ZXBUbyhuZXh0LnRpbWUpO1xuICB9IGVsc2Uge1xuICAgIGxldCBwcmV2ID0gbnVsbCBhcyBudWxsIHwgKHR5cGVvZiBhcnIpW251bWJlcl07XG4gICAgZm9yIChjb25zdCBjIG9mIGFycikge1xuICAgICAgaWYgKGMudGltZSA8IHJlcGxheS5jdXRvZmYhKSBwcmV2ID0gYztcbiAgICAgIGVsc2UgYnJlYWs7XG4gICAgfVxuICAgIGlmIChwcmV2KSByZXBsYXkuc3RlcFRvKHByZXYudGltZSk7XG4gIH1cbn1cblxuZnVuY3Rpb24gdG9nZ2xlUGxheSgpOiB2b2lkIHtcbiAgaWYgKHJlcGxheS5waWNraW5nKSB7XG4gICAgaWYgKHBpY2tUaW1lLnZhbHVlICE9PSBudWxsKSByZXBsYXkuc3RhcnRBdChwaWNrVGltZS52YWx1ZSk7XG4gICAgcmVwbGF5LnBsYXlpbmcgPSB0cnVlO1xuICAgIHJldHVybjtcbiAgfVxuICByZXBsYXkucGxheWluZyA9ICFyZXBsYXkucGxheWluZztcbn1cblxuLyoqIEhvbGQtdG8tcmVwZWF0IHN0ZXBwaW5nIChmb3J3YXJkIC8gYmFja3dhcmQgYnV0dG9ucyk6IG9uZSBzdGVwIG9uIHByZXNzLFxuICogIHRoZW4gdGhlIHJlcGVhdCBzdGFydHMgYWZ0ZXIgYSBzaG9ydCBob2xkIGF0IHRoZSBTRUxFQ1RFRCBzcGVlZFxuICogICgxeCA9IDEgY2FuZGxlL3NlYyDigKYgMTB4ID0gMTAgY2FuZGxlcy9zZWMpLiAqL1xuZnVuY3Rpb24gaG9sZFN0ZXAoZGlyOiAxIHwgLTEpOiB2b2lkIHtcbiAgc3RvcEhvbGQoKTtcbiAgcmVwbGF5U3RlcChkaXIpO1xuICBob2xkVGltZW91dCA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgIGhvbGRUaW1lciA9IHNldEludGVydmFsKCgpID0+IHJlcGxheVN0ZXAoZGlyKSwgMTAwMCAvIHJlcGxheS5zcGVlZCk7XG4gIH0sIDM1MCk7XG59XG5mdW5jdGlvbiBzdG9wSG9sZCgpOiB2b2lkIHtcbiAgaWYgKGhvbGRUaW1lb3V0KSB7XG4gICAgY2xlYXJUaW1lb3V0KGhvbGRUaW1lb3V0KTtcbiAgICBob2xkVGltZW91dCA9IG51bGw7XG4gIH1cbiAgaWYgKGhvbGRUaW1lcikge1xuICAgIGNsZWFySW50ZXJ2YWwoaG9sZFRpbWVyKTtcbiAgICBob2xkVGltZXIgPSBudWxsO1xuICB9XG59XG5cbi8qKiBXaGlsZSBwaWNraW5nLCB0aGUgcmVwbGF5IGxpbmUgZm9sbG93cyB0aGUgbW91c2UgYWNyb3NzIHRoZSBjaGFydC4gKi9cbi8qKiBNb3VzZSB4IOKGkiB0aW1lIHZpYSB0aGUgVklTSUJMRSBMT0dJQ0FMIFJBTkdFIChkZXRlcm1pbmlzdGljIOKAlCBpbW11bmUgdG9cbiAqICB0aGUgYmFyLWdyaWQgY2FsaWJyYXRpb24gZ2xpdGNoZXMgdGhhdCBjb3VsZCBwcm9kdWNlIHRpbWVzIGZhciBvdXRzaWRlXG4gKiAgdGhlIGRhdGEgZHVyaW5nIGxheW91dCB0cmFuc2l0aW9ucykuICovXG5mdW5jdGlvbiByZXBsYXlUaW1lQXQoY2xpZW50WDogbnVtYmVyKTogbnVtYmVyIHwgbnVsbCB7XG4gIGlmICghYWRhcHRlciB8fCAhY29udGFpbmVyUmVmLnZhbHVlIHx8ICFkaXNwbGF5Q2FuZGxlcy52YWx1ZS5sZW5ndGgpIHJldHVybiBudWxsO1xuICBjb25zdCByID0gY29udGFpbmVyUmVmLnZhbHVlLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuICBjb25zdCBsciA9IGFkYXB0ZXIuZ2V0TG9naWNhbFJhbmdlKCk7XG4gIGlmICghbHIgfHwgbHIudG8gPD0gbHIuZnJvbSkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGNoYXJ0VyA9IGNvbnRhaW5lclJlZi52YWx1ZS5jbGllbnRXaWR0aCAtIGF4aXNSaWdodFcudmFsdWU7XG4gIGNvbnN0IGZyYWMgPSBNYXRoLm1pbihNYXRoLm1heCgoY2xpZW50WCAtIHIubGVmdCkgLyBjaGFydFcsIDApLCAxKTtcbiAgY29uc3QgaWR4ID0gTWF0aC5yb3VuZChsci5mcm9tICsgZnJhYyAqIChsci50byAtIGxyLmZyb20pKTtcbiAgY29uc3QgY2xhbXBlZCA9IE1hdGgubWluKE1hdGgubWF4KGlkeCwgMCksIGRpc3BsYXlDYW5kbGVzLnZhbHVlLmxlbmd0aCAtIDEpO1xuICByZXR1cm4gZGlzcGxheUNhbmRsZXMudmFsdWVbY2xhbXBlZF0hLnRpbWU7XG59XG5cbmZ1bmN0aW9uIG9uUGlja2luZ01vdmUoZXY6IE1vdXNlRXZlbnQpOiB2b2lkIHtcbiAgY29uc3QgdCA9IHJlcGxheVRpbWVBdChldi5jbGllbnRYKTtcbiAgaWYgKHQgPT09IG51bGwpIHJldHVybjtcbiAgcGlja1RpbWUudmFsdWUgPSB0O1xuICByZWNhbGNSZWN0cygpO1xufVxuXG5mdW5jdGlvbiBzdG9wUGlja2luZ0xpc3RlbmVycygpOiB2b2lkIHtcbiAgaWYgKHBpY2tpbmdNb3ZlKSB7XG4gICAgLy8gQ0FQVFVSRSBwaGFzZSBvbiB0aGUgcGFuZSByb290IChjb21tb24gYW5jZXN0b3Igb2YgdGhlIExXQyBjb250YWluZXJcbiAgICAvLyBBTkQgdGhlIGRyYXdpbmcvZGVtbyBoaXQgbGF5ZXJzKTogTFdDJ3MgY2FudmFzIHN0b3BzIHByb3BhZ2F0aW9uIG9uXG4gICAgLy8gbW91c2UgbW92ZXMgYW5kIHRoZSBoaXQgbGF5ZXJzIGFyZSBzaWJsaW5ncyBvZiB0aGUgY2hhcnQgY29udGFpbmVyLFxuICAgIC8vIHNvIGEgbGlzdGVuZXIgb24gdGhlIGNvbnRhaW5lciBpdHNlbGYgd291bGQgZnJlZXplIHdoaWxlIHRoZSBjdXJzb3JcbiAgICAvLyBpcyBvdmVyIGFueSBkcmF3aW5nIOKAlCBjYXB0dXJlIG9uIHRoZSBhbmNlc3RvciBhbHdheXMgZmlyZXMuXG4gICAgY29uc3Qgcm9vdCA9IChkb2N1bWVudC5xdWVyeVNlbGVjdG9yKFwiLmNoYXJ0LXBhbmVcIikgPz8gY29udGFpbmVyUmVmLnZhbHVlKSBhcyBIVE1MRWxlbWVudDtcbiAgICByb290LnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJtb3VzZW1vdmVcIiwgcGlja2luZ01vdmUsIHsgY2FwdHVyZTogdHJ1ZSB9KTtcbiAgfVxuICBwaWNraW5nTW92ZSA9IG51bGw7XG59XG5cbndhdGNoKFxuICAoKSA9PiByZXBsYXkucGlja2luZyxcbiAgKHBpY2tpbmcpID0+IHtcbiAgICBzdG9wUGlja2luZ0xpc3RlbmVycygpO1xuICAgIGlmIChwaWNraW5nICYmIGNvbnRhaW5lclJlZi52YWx1ZSAmJiBkaXNwbGF5Q2FuZGxlcy52YWx1ZS5sZW5ndGgpIHtcbiAgICAgIC8vIFN0YXJ0IHRoZSBsaW5lIGF0IH42MCUgb2YgdGhlIHZpc2libGUgY2hhcnRcbiAgICAgIGNvbnN0IHcgPSBjb250YWluZXJSZWYudmFsdWUuY2xpZW50V2lkdGggLSBheGlzUmlnaHRXLnZhbHVlO1xuICAgICAgY29uc3QgbHIgPSBhZGFwdGVyPy5nZXRMb2dpY2FsUmFuZ2UoKTtcbiAgICAgIGxldCBpZHg6IG51bWJlcjtcbiAgICAgIGlmIChsciAmJiBsci50byA+IGxyLmZyb20pIHtcbiAgICAgICAgaWR4ID0gTWF0aC5yb3VuZChsci5mcm9tICsgMC42ICogKGxyLnRvIC0gbHIuZnJvbSkpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaWR4ID0gZGlzcGxheUNhbmRsZXMudmFsdWUubGVuZ3RoIC0gMTtcbiAgICAgIH1cbiAgICAgIGlkeCA9IE1hdGgubWluKE1hdGgubWF4KGlkeCwgMCksIGRpc3BsYXlDYW5kbGVzLnZhbHVlLmxlbmd0aCAtIDEpO1xuICAgICAgcGlja1RpbWUudmFsdWUgPSBkaXNwbGF5Q2FuZGxlcy52YWx1ZVtpZHhdIS50aW1lO1xuICAgICAgcGlja2luZ01vdmUgPSBvblBpY2tpbmdNb3ZlO1xuICAgICAgY29uc3QgcGlja1Jvb3QgPSAoZG9jdW1lbnQucXVlcnlTZWxlY3RvcihcIi5jaGFydC1wYW5lXCIpID8/IGNvbnRhaW5lclJlZi52YWx1ZSkgYXMgSFRNTEVsZW1lbnQ7XG4gICAgICBwaWNrUm9vdC5hZGRFdmVudExpc3RlbmVyKFwibW91c2Vtb3ZlXCIsIHBpY2tpbmdNb3ZlLCB7IGNhcHR1cmU6IHRydWUgfSk7XG4gICAgICByZWNhbGNSZWN0cygpO1xuICAgIH1cbiAgfVxuKTtcblxud2F0Y2goXG4gICgpID0+IFtyZXBsYXkucGxheWluZywgcmVwbGF5LnNwZWVkLCByZXBsYXkuYWN0aXZlLCByZXBsYXkucGlja2luZ10gYXMgY29uc3QsXG4gICgpID0+IHtcbiAgICBpZiAocmVwbGF5VGltZXIpIHtcbiAgICAgIGNsZWFySW50ZXJ2YWwocmVwbGF5VGltZXIpO1xuICAgICAgcmVwbGF5VGltZXIgPSBudWxsO1xuICAgIH1cbiAgICBpZiAocmVwbGF5LmFjdGl2ZSAmJiByZXBsYXkucGxheWluZyAmJiAhcmVwbGF5LnBpY2tpbmcpIHtcbiAgICAgIHJlcGxheVRpbWVyID0gc2V0SW50ZXJ2YWwoKCkgPT4gcmVwbGF5U3RlcCgxKSwgMTAwMCAvIHJlcGxheS5zcGVlZCk7XG4gICAgfVxuICB9XG4pO1xuXG4vKiogS2VlcCB0aGUgcmVwbGF5IGNhbmRsZSBhdCB0aGUgcmlnaHQgZWRnZSB3aXRoIGZyZWUgc3BhY2U6IG9uIGN1dCwgd2hpbGVcbiAqICBwbGF5aW5nLCBhbmQgb24gZXhpdC4gRG91YmxlIG5leHRUaWNrIGRlZmVycyBwYXN0IHRoZSBkaXNwbGF5Q2FuZGxlc1xuICogIHdhdGNoZXIncyBzZXREYXRhIHNvIHRoZSB2aWV3cG9ydCBzdXJ2aXZlcyBpdC4gKi9cbmZ1bmN0aW9uIGZvY3VzUmVwbGF5RWRnZSgpOiB2b2lkIHtcbiAgbmV4dFRpY2soKCkgPT4gbmV4dFRpY2soKCkgPT4gYWRhcHRlcj8uZm9jdXNMYXN0KCkpKTtcbn1cbndhdGNoKFxuICAoKSA9PiByZXBsYXkuY3V0b2ZmLFxuICAoY3V0b2ZmLCBwcmV2KSA9PiB7XG4gICAgLy8gV2hpbGUgcmVwbGF5aW5nIGZvcndhcmQsIHRoZSBjaGFydCBzdGF5cyBzdGlsbCBhcyBjYW5kbGVzIGZpbGwgdGhlXG4gICAgLy8gZnJlZSBzcGFjZTsgaXQgb25seSBmb2xsb3dzIG9uY2UgdGhlIG5ld2VzdCBjYW5kbGUgcmVhY2hlcyB0aGUgcmlnaHRcbiAgICAvLyBlZGdlIOKAlCBwYW5uaW5nIGJ5IHRoZSBjdXJyZW50IHZpZXcgV0lEVEggKG5vIGRlcGVuZGVuY2Ugb24gdGhlXG4gICAgLy8gYWRhcHRlcidzIGNhcHBlZCBkYXRhIGxlbmd0aCkuXG4gICAgaWYgKCFyZXBsYXkuYWN0aXZlIHx8IGN1dG9mZiA9PT0gbnVsbCB8fCBwcmV2ID09PSBudWxsKSByZXR1cm47XG4gICAgLy8gRGVtbyBwb3NpdGlvbnMgdHJhY2sgdGhlIHByaWNlIEFUIHRoZSByZXBsYXkgYm91bmRhcnkuIEZvcndhcmQgc3RlcHNcbiAgICAvLyBwcm9jZXNzIHRoZSB3aG9sZSByZXZlYWxlZCBjYW5kbGUg4oCUIGl0cyBXSUNLIGNhbiBmaWxsIHBlbmRpbmcgbGltaXRzXG4gICAgLy8gYW5kIGhpdCBUUC9TTCwgbm90IGp1c3QgdGhlIGNsb3NlLlxuICAgIGNvbnN0IGxhc3RTaG93biA9IGRpc3BsYXlDYW5kbGVzLnZhbHVlW2Rpc3BsYXlDYW5kbGVzLnZhbHVlLmxlbmd0aCAtIDFdO1xuICAgIGlmIChsYXN0U2hvd24gJiYgY3V0b2ZmID4gcHJldikgZGVtby5wcm9jZXNzUmVwbGF5Q2FuZGxlKGxhc3RTaG93biwgbWFya2V0Lmluc3RydW1lbnQpO1xuICAgIGVsc2UgaWYgKGxhc3RTaG93bikgZGVtby5wcm9jZXNzUmVwbGF5UHJpY2UobGFzdFNob3duLmNsb3NlLCBtYXJrZXQuaW5zdHJ1bWVudCk7XG4gICAgLy8gU3RlcHBpbmcgYmFja3dhcmQgcGFzdCBhIHRyYWRlJ3MgZW50cnkgZGVsZXRlcyB0aGUgd2hvbGUgdHJhZGVcbiAgICBpZiAoY3V0b2ZmIDwgcHJldikgZGVtby5kZWxldGVCZXlvbmQoY3V0b2ZmLCBtYXJrZXQuaW5zdHJ1bWVudCk7XG4gICAgaWYgKGN1dG9mZiA8PSBwcmV2KSByZXR1cm47XG4gICAgY29uc3QgaWR4ID0gZGlzcGxheUNhbmRsZXMudmFsdWUubGVuZ3RoIC0gMTtcbiAgICBjb25zdCByID0gYWRhcHRlcj8uZ2V0TG9naWNhbFJhbmdlKCk7XG4gICAgY29uc3QgYWQgPSBhZGFwdGVyO1xuICAgIGlmICghciB8fCAhYWQpIHJldHVybjtcbiAgICBpZiAoaWR4ID4gci50byAtIDMpIHtcbiAgICAgIGNvbnN0IHdpZHRoID0gci50byAtIHIuZnJvbTtcbiAgICAgIGFkLnNldExvZ2ljYWxSYW5nZSh7IGZyb206IGlkeCAtIHdpZHRoICsgMTUsIHRvOiBpZHggKyAxNSB9KTtcbiAgICB9XG4gIH1cbik7XG53YXRjaChcbiAgKCkgPT4gcmVwbGF5LmFjdGl2ZSxcbiAgKGFjdGl2ZSkgPT4ge1xuICAgIC8vIEZyZWV6ZSB0aGUgcHJpY2Ugc2NhbGUgYW5kIGhpZGUgdGhlIHNlcmllcycgbGl2ZS1wcmljZSBsYWJlbCB3aGlsZVxuICAgIC8vIHJlcGxheWluZyDigJQgdGhlIHJlcGxheSBwcmljZSB0YWcgdGFrZXMgaXRzIHBsYWNlIG9uIHRoZSBzY2FsZS4gVGhpc1xuICAgIC8vIGlzIHdoYXQga2VlcHMgYmFja3dhcmQvcGxheSBmcm9tIG1vdmluZyB0aGUgY2hhcnQuXG4gICAgYWRhcHRlcj8uc2V0UHJpY2VBdXRvU2NhbGUoIWFjdGl2ZSk7XG4gICAgYWRhcHRlcj8uc2V0TGFzdFZhbHVlVmlzaWJsZSghYWN0aXZlKTtcbiAgICBpZiAoIWFjdGl2ZSkge1xuICAgICAgLy8gRXhpdGluZyByZXBsYXkgcmVsb2FkcyB0aGUgbGl2ZSBjaGFydDogd2hpbGUgcmVwbGF5aW5nLCBsaXZlIGNhbmRsZXNcbiAgICAgIC8vIGtlcHQgYXBwZW5kaW5nIGF0IFwibm93XCIgd2hpbGUgdGhlIHZpZXcgc2hvd2VkIHRoZSBjdXQg4oCUIHRoZSBhcnJheVxuICAgICAgLy8gaGVsZCB0d28gcmVnaW9ucyB3aXRoIGEgaHVnZSB0aW1lIGdhcCwgd2hpY2ggcmVuZGVyZWQgYXMgb25lIGdpYW50XG4gICAgICAvLyBjYW5kbGUgb25jZSB0aGUgZnVsbCByYW5nZSB3YXMgcmV2ZWFsZWQuXG4gICAgICBmb2N1c1JlcGxheUVkZ2UoKTsgLy8gc21vb3RoIHJldHVybiB0byB0aGUgbGl2ZSBlZGdlIG9uIGV4aXRcbiAgICB9XG4gIH1cbik7XG5cbi8qKiBFeGl0IHJlcGxheTogZmV0Y2ggdGhlIGxpdmUgd2luZG93IFdISUxFIHRoZSByZXBsYXkgdmlldyBpcyBzdGlsbFxuICogIGZyb3plbiwgdGhlbiByZXZlYWwgaXQg4oCUIGV4aXRpbmcgZGlyZWN0bHkgd291bGQgZmlyc3Qgc2hvdyB0aGUgZ2FwcGVkXG4gKiAgaW50ZXJtZWRpYXRlIGFycmF5IChkZWVwLXBhc3QgY2FuZGxlcyArIGxpdmUgdGFpbCkgYXMgb25lIGh1Z2UganVtcC4gKi9cbmFzeW5jIGZ1bmN0aW9uIG9uUmVwbGF5RXhpdCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgYXdhaXQgbWFya2V0LmxvYWRIaXN0b3J5KHRydWUpO1xuICByZXBsYXkuZXhpdCgpO1xuICBmb2N1c1JlcGxheUVkZ2UoKTtcbn1cbndhdGNoKFxuICAoKSA9PiBtYXJrZXQudGltZWZyYW1lLFxuICAoKSA9PiB7XG4gICAgLy8gQSB0aW1lZnJhbWUgc3dpdGNoIHJlLWVuYWJsZXMgYXV0b1NjYWxlIChmcmVzaC1tb3VudCBicmFuY2ggb2ZcbiAgICAvLyBzZXREYXRhKSDigJQgcmUtZnJlZXplIGl0IHdoaWxlIHJlcGxheSBpcyBzdGlsbCBhY3RpdmUsIGFuZCBwaW4gdGhlXG4gICAgLy8gcmVwbGF5IGVkZ2UgYmFjayB0byB0aGUgcmlnaHQgd2l0aCBmcmVlIHNwYWNlLlxuICAgIGlmIChyZXBsYXkuYWN0aXZlKSB7XG4gICAgICBhZGFwdGVyPy5zZXRQcmljZUF1dG9TY2FsZShmYWxzZSk7XG4gICAgICBpZiAocmVwbGF5LmN1dG9mZiAhPT0gbnVsbCkgZm9jdXNSZXBsYXlFZGdlKCk7XG4gICAgfVxuICB9XG4pO1xuXG5mdW5jdGlvbiBmbGFnRm9yKGN1cnJlbmN5OiBzdHJpbmcpOiB7IHR5cGU6IFwiZmxhZ1wiIHwgXCJpY29uXCI7IHZhbHVlOiBzdHJpbmcgfSB7XG4gIGNvbnN0IGZsYWcgPSBjdXJyZW5jeUZsYWdVcmwoY3VycmVuY3kpO1xuICBpZiAoZmxhZykgcmV0dXJuIHsgdHlwZTogXCJmbGFnXCIsIHZhbHVlOiBmbGFnIH07XG4gIGNvbnN0IGljb24gPSBjb21tb2RpdHlJY29uKGN1cnJlbmN5KTtcbiAgaWYgKGljb24pIHJldHVybiB7IHR5cGU6IFwiaWNvblwiLCB2YWx1ZTogaWNvbiB9O1xuICByZXR1cm4geyB0eXBlOiBcImljb25cIiwgdmFsdWU6IFwi4peIXCIgfTtcbn1cblxud2F0Y2goXG4gIGRpc3BsYXlDYW5kbGVzLFxuICAobmV4dCwgcHJldikgPT4ge1xuICAgIGlmICghYWRhcHRlcikgcmV0dXJuO1xuICAgIC8vIFJlLWFuY2hvciB0aGUgYmFkZ2UgYWZ0ZXIgYW55IGRhdGEgY2hhbmdlIChzY2FsZSBtYXkgc2hpZnQpXG4gICAgbmV4dFRpY2sodXBkYXRlQmFkZ2VQb3NpdGlvbik7XG4gICAgaWYgKCFwcmV2IHx8IHByZXYubGVuZ3RoID09PSAwIHx8IG5leHQubGVuZ3RoID09PSAwKSB7XG4gICAgICAvLyBGcmVzaCBoaXN0b3J5IGFmdGVyIGEgc3ltYm9sL3RpbWVmcmFtZSBzd2l0Y2ggKG9yIGZpcnN0IGxvYWQpOiB0aGVcbiAgICAgIC8vIHByaWNlIHNjYWxlIG1heSBjYXJyeSBhIE1BTlVBTExZLWRyYWdnZWQgcmFuZ2UgZnJvbSB0aGUgcHJldmlvdXNcbiAgICAgIC8vIGNoYXJ0IOKAlCBhIGRpZmZlcmVudCBzeW1ib2wncyBjYW5kbGVzIHRoZW4gc3F1YXNoIGludG8gYSB0aGluIGJhbmRcbiAgICAgIC8vIHVudGlsIHRoZSB1c2VyIGRyYWdzIHRoZSBzY2FsZS4gUmUtYXJtIGF1dG9zY2FsZSBCRUZPUkUgc2V0RGF0YSBzb1xuICAgICAgLy8gdGhlIHktYXhpcyByZWZpdHMgdG8gdGhlIG5ldyBzeW1ib2wncyBvd24gcHJpY2UgcmFuZ2UuIFJlcGxheSBrZWVwc1xuICAgICAgLy8gaXRzIGZyb3plbiBzY2FsZS5cbiAgICAgIGFkYXB0ZXIuc2V0UHJpY2VBdXRvU2NhbGUoIXJlcGxheS5hY3RpdmUpO1xuICAgICAgYWRhcHRlci5zZXREYXRhKG5leHQpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICAvLyBEZXRlY3QgbGF6eS1sb2FkIHByZXBlbmQgKG9sZGVyIGNhbmRsZXMgYWRkZWQgdG8gZnJvbnQpXG4gICAgY29uc3QgaXNQcmVwZW5kID0gbmV4dC5sZW5ndGggPiBwcmV2Lmxlbmd0aCAmJiBuZXh0WzBdIS50aW1lIDwgcHJldlswXSEudGltZTtcbiAgICBpZiAoaXNQcmVwZW5kKSB7XG4gICAgICBjb25zdCBwcmV2UmFuZ2UgPSBhZGFwdGVyLmdldExvZ2ljYWxSYW5nZSgpO1xuICAgICAgYWRhcHRlci5zZXREYXRhKG5leHQpO1xuICAgICAgaWYgKHByZXZSYW5nZSkge1xuICAgICAgICBjb25zdCBhZGRlZCA9IG5leHQubGVuZ3RoIC0gcHJldi5sZW5ndGg7XG4gICAgICAgIGFkYXB0ZXIuc2V0TG9naWNhbFJhbmdlKHsgZnJvbTogcHJldlJhbmdlLmZyb20gKyBhZGRlZCwgdG86IHByZXZSYW5nZS50byArIGFkZGVkIH0pO1xuICAgICAgfVxuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAobmV4dC5sZW5ndGggPCBwcmV2Lmxlbmd0aCAtIDUpIHtcbiAgICAgIGFkYXB0ZXIuc2V0RGF0YShuZXh0KTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgLy8gUmVtb3ZpbmcgY2FuZGxlKHMpIGZyb20gdGhlIEVORCAocmVwbGF5IGJhY2t3YXJkIHN0ZXApOiByZXN0b3JlIHRoZVxuICAgIC8vIGV4YWN0IHByZS1zaHJpbmsgdmlzaWJsZSByYW5nZSBzbyB0aGUgY2hhcnQgc3RheXMgcGVyZmVjdGx5IHN0aWxsXG4gICAgLy8gKExXQyB3b3VsZCBvdGhlcndpc2UgcmUtYW5jaG9yIHRoZSByaWdodCBlZGdlIGFuZCBzaGlmdCB0aGUgdmlldykuXG4gICAgY29uc3QgcHJlU2hyaW5rUmFuZ2UgPSBhZGFwdGVyLmdldExvZ2ljYWxSYW5nZSgpO1xuICAgIGNvbnN0IHByZXZMYXN0ID0gcHJldltwcmV2Lmxlbmd0aCAtIDFdO1xuICAgIGNvbnN0IG5leHRMYXN0ID0gbmV4dFtuZXh0Lmxlbmd0aCAtIDFdO1xuICAgIGlmICghbmV4dExhc3QgfHwgIXByZXZMYXN0KSB7XG4gICAgICBhZGFwdGVyLnNldERhdGEobmV4dCk7XG4gICAgICByZXN0b3JlUmFuZ2UocHJlU2hyaW5rUmFuZ2UsIHByZXYubGVuZ3RoIC0gbmV4dC5sZW5ndGgpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICAvLyBTaW5nbGUgbmV3IGNhbmRsZSBhcHBlbmRlZCBhdCBlbmQgKGxpdmUpIOKAlCB1cGRhdGUgd2l0aG91dCByZWZpdFxuICAgIGlmIChuZXh0Lmxlbmd0aCA9PT0gcHJldi5sZW5ndGggKyAxICYmIG5leHRbbmV4dC5sZW5ndGggLSAyXSEudGltZSA9PT0gcHJldkxhc3QudGltZSAmJiBuZXh0TGFzdC50aW1lID4gcHJldkxhc3QudGltZSkge1xuICAgICAgYWRhcHRlci51cGRhdGVDYW5kbGUobmV4dExhc3QpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAobmV4dC5sZW5ndGggIT09IHByZXYubGVuZ3RoKSB7XG4gICAgICBhZGFwdGVyLnNldERhdGEobmV4dCk7XG4gICAgICBpZiAobmV4dC5sZW5ndGggPCBwcmV2Lmxlbmd0aCAmJiBwcmVTaHJpbmtSYW5nZSkge1xuICAgICAgICByZXN0b3JlUmFuZ2UocHJlU2hyaW5rUmFuZ2UsIHByZXYubGVuZ3RoIC0gbmV4dC5sZW5ndGgpO1xuICAgICAgfVxuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAocHJldkxhc3QudGltZSA9PT0gbmV4dExhc3QudGltZSkge1xuICAgICAgLy8gUmVjb25jaWxpYXRpb24gY2FuIGNvcnJlY3QgdGhlIEpVU1QtQ0xPU0VEIGJhciAocG9zaXRpb24gbGVuLTIpLlxuICAgICAgLy8gc2VyaWVzLnVwZGF0ZSgpIG9ubHkgdG91Y2hlcyB0aGUgbGFzdCBiYXIsIHNvIGFuIG9sZGVyLWJhciBjaGFuZ2VcbiAgICAgIC8vIG11c3QgZ28gdGhyb3VnaCBzZXREYXRhICh3aGljaCBwcmVzZXJ2ZXMgdGhlIHZpZXdwb3J0KS5cbiAgICAgIGNvbnN0IHBwID0gcHJldltwcmV2Lmxlbmd0aCAtIDJdO1xuICAgICAgY29uc3QgbnAgPSBuZXh0W25leHQubGVuZ3RoIC0gMl07XG4gICAgICBjb25zdCBvbGRlckNoYW5nZWQgPVxuICAgICAgICBwcCAmJlxuICAgICAgICBucCAmJlxuICAgICAgICAobnAudGltZSAhPT0gcHAudGltZSB8fFxuICAgICAgICAgIG5wLm9wZW4gIT09IHBwLm9wZW4gfHxcbiAgICAgICAgICBucC5oaWdoICE9PSBwcC5oaWdoIHx8XG4gICAgICAgICAgbnAubG93ICE9PSBwcC5sb3cgfHxcbiAgICAgICAgICBucC5jbG9zZSAhPT0gcHAuY2xvc2UpO1xuICAgICAgaWYgKG9sZGVyQ2hhbmdlZCkge1xuICAgICAgICBhZGFwdGVyLnNldERhdGEobmV4dCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBhZGFwdGVyLnVwZGF0ZUNhbmRsZShuZXh0TGFzdCk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIGFkYXB0ZXIuc2V0RGF0YShuZXh0KTtcbiAgICB9XG4gIH0sXG4gIHsgZGVlcDogZmFsc2UgfVxuKTtcblxud2F0Y2goXG4gICgpID0+IHRoZW1lU3RvcmUudGhlbWUsXG4gICh0KSA9PiB7XG4gICAgYWRhcHRlcj8uc2V0VGhlbWUodCA9PT0gXCJkYXJrXCIpO1xuICB9XG4pO1xuXG53YXRjaChcbiAgKCkgPT4gcHJvcHMuaW5zdHJ1bWVudCxcbiAgKGluc3QpID0+IHtcbiAgICBpZiAoaW5zdCkgYWRhcHRlcj8uc2V0SW5zdHJ1bWVudChpbnN0KTtcbiAgfVxuKTtcblxud2F0Y2goXG4gICgpID0+IGRyYXdpbmdzU3RvcmUuYWN0aXZlVG9vbCxcbiAgKHRvb2wpID0+IHtcbiAgICByZWN0TWVudS52YWx1ZSA9IG51bGw7XG4gICAgY2xvc2VQYWxldHRlKCk7XG4gICAgbGluZVBhbGV0dGVPcGVuLnZhbHVlID0gZmFsc2U7XG4gICAgcG9seVBhbGV0dGVPcGVuLnZhbHVlID0gZmFsc2U7XG4gICAgLy8gU3dpdGNoaW5nIGF3YXkgZnJvbSBhIGRyYXdpbmcgdG9vbCBhYm9ydHMgYW55IGluLXByb2dyZXNzIGRyYXdpbmdcbiAgICBjYW5jZWxEcmF3KCk7XG4gIH1cbik7XG5cbmxldCB2aXNpYmxlQ2I6ICgocmFuZ2U6IHsgZnJvbTogbnVtYmVyOyB0bzogbnVtYmVyIH0gfCBudWxsKSA9PiB2b2lkKSB8IG51bGwgPSBudWxsO1xubGV0IGRhdGFDYjogKCgpID0+IHZvaWQpIHwgbnVsbCA9IG51bGw7XG5sZXQgbGF6eVRocm90dGxlZCA9IGZhbHNlO1xubGV0IGludGVyYWN0aW9uRWw6IEhUTUxFbGVtZW50IHwgbnVsbCA9IG51bGw7XG5sZXQgaW50ZXJhY3RDYjogKCgpID0+IHZvaWQpIHwgbnVsbCA9IG51bGw7XG4vKiogV2hlZWwtZm9yd2FyZGluZyBvdmVyIGRyYXdpbmcgb3ZlcmxheXMgKHNlZSBvbk92ZXJsYXlXaGVlbCkuICovXG5sZXQgb3ZlcmxheVdoZWVsRWw6IEhUTUxFbGVtZW50IHwgbnVsbCA9IG51bGw7XG5sZXQgb3ZlcmxheVdoZWVsQ2I6ICgoZTogV2hlZWxFdmVudCkgPT4gdm9pZCkgfCBudWxsID0gbnVsbDtcbi8qKiBQZXItZnJhbWUgb3ZlcmxheSByZS1wcm9qZWN0aW9uIChzZWUgcmVjYWxjRnJhbWUpLiAqL1xubGV0IHJlY2FsY1JhZiA9IDA7XG5sZXQgcmVjYWxjRGVhZGxpbmUgPSAwO1xuLyoqIFdoaWxlIGluc2lkZSB0aGlzIHdpbmRvdywgcmVjYWxjRnJhbWUga2VlcHMgcG9sbGluZyB1bnRpbCBhbGwgc3RvcmVkXG4gKiAgZHJhd2luZ3MgaGF2ZSBwcm9qZWN0ZWQgKGNoYXJ0IGxheW91dCBhZnRlciBsb2FkIG1heSBsYWcgYSBmZXcgZnJhbWVzKS4gKi9cbmxldCBsb2FkU2V0dGxlRGVhZGxpbmUgPSAwO1xubGV0IHBvaW50ZXJIZWxkID0gZmFsc2U7XG5sZXQgcG9pbnRlckRvd25FbDogSFRNTEVsZW1lbnQgfCBudWxsID0gbnVsbDtcbmxldCBwb2ludGVyRG93bkNiOiAoKCkgPT4gdm9pZCkgfCBudWxsID0gbnVsbDtcbmxldCBwb2ludGVyVXBDYjogKCgpID0+IHZvaWQpIHwgbnVsbCA9IG51bGw7XG5sZXQgY2hhcnRNb3VzZURvd25FbDogSFRNTEVsZW1lbnQgfCBudWxsID0gbnVsbDtcbmxldCBjaGFydE1vdXNlRG93bkNiOiAoKGU6IE1vdXNlRXZlbnQpID0+IHZvaWQpIHwgbnVsbCA9IG51bGw7XG5sZXQgdGFwRG93bkVsOiBIVE1MRWxlbWVudCB8IG51bGwgPSBudWxsO1xubGV0IHRhcERvd25DYjogKChlOiBNb3VzZUV2ZW50KSA9PiB2b2lkKSB8IG51bGwgPSBudWxsO1xubGV0IHRhcFVwQ2I6ICgoZTogTW91c2VFdmVudCkgPT4gdm9pZCkgfCBudWxsID0gbnVsbDtcbmxldCBjaGFydERibENsaWNrRWw6IEhUTUxFbGVtZW50IHwgbnVsbCA9IG51bGw7XG5sZXQgY2hhcnREYmxDbGlja0NiOiAoKGU6IE1vdXNlRXZlbnQpID0+IHZvaWQpIHwgbnVsbCA9IG51bGw7XG5sZXQgcGFuZUN0eEVsOiBIVE1MRWxlbWVudCB8IG51bGwgPSBudWxsO1xubGV0IHBhbmVDdHhDYjogKChlOiBNb3VzZUV2ZW50KSA9PiB2b2lkKSB8IG51bGwgPSBudWxsO1xubGV0IGVzY0NiOiAoKGU6IEtleWJvYXJkRXZlbnQpID0+IHZvaWQpIHwgbnVsbCA9IG51bGw7XG5sZXQgbWFnbmV0S2V5Q2I6ICgoZTogS2V5Ym9hcmRFdmVudCkgPT4gdm9pZCkgfCBudWxsID0gbnVsbDtcbmxldCBtYWduZXRCbHVyQ2I6ICgoKSA9PiB2b2lkKSB8IG51bGwgPSBudWxsO1xubGV0IG1hZ25ldEFueU1vdmVDYjogKChlOiBQb2ludGVyRXZlbnQpID0+IHZvaWQpIHwgbnVsbCA9IG51bGw7XG5sZXQgeGhhaXJNb3ZlRWw6IEhUTUxFbGVtZW50IHwgbnVsbCA9IG51bGw7XG5sZXQgeGhhaXJNb3ZlQ2I6ICgoZTogTW91c2VFdmVudCkgPT4gdm9pZCkgfCBudWxsID0gbnVsbDtcbmxldCB4aGFpckxlYXZlQ2I6ICgoKSA9PiB2b2lkKSB8IG51bGwgPSBudWxsO1xubGV0IGNyb3NzaGFpck1vZGVTdG9wOiAoKCkgPT4gdm9pZCkgfCBudWxsID0gbnVsbDtcbmxldCB3aW5kb3dMb3N0Q2I6ICgoKSA9PiB2b2lkKSB8IG51bGwgPSBudWxsO1xuLy8gYWRkRXZlbnRMaXN0ZW5lciByZXF1aXJlcyBFdmVudExpc3RlbmVyLCBub3QgYSBzcGVjaWZpYyBNb3VzZUV2ZW50IGhhbmRsZXJcbnR5cGUgQW55TGlzdGVuZXIgPSBFdmVudExpc3RlbmVyO1xuY29uc3QgY291bnRkb3duID0gcmVmKFwiXCIpO1xuY29uc3QgbWFya2V0Q2xvc2VkID0gcmVmKGZhbHNlKTtcbi8qKiBDb3VudGRvd24gdGFnIHdpZHRoL3JpZ2h0IOKAlCBtYXRjaGVzIHRoZSBuYXRpdmUgcHJpY2UgbGFiZWwgZ2VvbWV0cnlcbiAqICAod2lkdGggPSBwcmljZSB0ZXh0ICsgcGFkZGluZzsgbGVmdC1hbGlnbmVkIHdpdGggdGhlIHByaWNlIGF4aXMpLiAqL1xuY29uc3QgdGFnVyA9IHJlZigwKTtcbmNvbnN0IHRhZ1JpZ2h0ID0gcmVmKDApO1xuXG4vKiBBeGlzIHRhZzogdGhlIHRpbWVyLCBzdHlsZWQgaWRlbnRpY2FsIHRvIExXQydzIG5hdGl2ZSBwcmljZSBsYWJlbCBhbmRcbiAgIHN0YWNrZWQgZmx1c2ggZGlyZWN0bHkgYmVuZWF0aCBpdC4gKi9cbmNvbnN0IHRhZ1Zpc2libGUgPSByZWYoZmFsc2UpO1xuY29uc3QgdGltZXJUb3AgPSByZWYoMCk7XG5jb25zdCBzbWFsbFRhZ0ggPSByZWYoMTkpOyAvLyBiYXNlICgxw5cpIGxhYmVsIGhlaWdodFxubGV0IGNvdW50ZG93blRpbWVyOiBSZXR1cm5UeXBlPHR5cGVvZiBzZXRJbnRlcnZhbD4gfCBudWxsID0gbnVsbDtcblxuLyoqXG4gKiBNYXJrZXQtaG91cnMgZ2F0ZSAoRFNULWF3YXJlLCBwZXIgaW5zdHJ1bWVudCkg4oCUIHNoYXJlZCB3aXRoIHRoZSBkZW1vXG4gKiBzdG9yZSBzbyB0aGUgY291bnRkb3duLCBvcmRlciBidXR0b25zIGFuZCBub3RlcyBhbGwgYWdyZWUuIEZvcmV4IHJ1bnNcbiAqIFN1bmRheSA1cG0gTlkg4oaSIEZyaWRheSA1cG0gTlk7IG1ldGFscyBhZGRpdGlvbmFsbHkgYnJlYWsgNeKAkzZwbSBOWSBkYWlseS5cbiAqL1xuZnVuY3Rpb24gaXNGb3JleENsb3NlZCgpOiBib29sZWFuIHtcbiAgcmV0dXJuIGRlbW8uaXNDbG9zZWQobWFya2V0Lmluc3RydW1lbnQpO1xufVxuXG4vKipcbiAqIFBvc2l0aW9ucyB0aGUgdGltZXIgbGFiZWwgZmx1c2ggdW5kZXIgTFdDJ3MgbmF0aXZlIGxpdmUtcHJpY2UgbGFiZWw6XG4gKiBzYW1lIHNpemUsIHNhbWUgYmx1ZSBiYWNrZ3JvdW5kIOKAlCB0aGV5IHJlYWQgYXMgb25lIHN0YWNrZWQgdW5pdC5cbiAqL1xuXG4vKiogUmVzdG9yZSB0aGUgdmlzaWJsZSByYW5nZSBhZnRlciBjYW5kbGVzIHdlcmUgcmVtb3ZlZCBmcm9tIHRoZSBlbmQuXG4gKiAgTFdDIHJlLWFuY2hvcnMgdGhlIHdpbmRvdyBieSByaWdodC1vZmZzZXQgKHNoaWZ0aW5nIGl0IH4xIGJhciBwZXJcbiAqICByZW1vdmVkIGNhbmRsZSkgYW5kIG5vcm1hbGl6ZXMgc2V0IHJhbmdlcywgc28gbWVhc3VyZSB0aGUgYWN0dWFsIGRyaWZ0XG4gKiAgYW5kIGNvcnJlY3QgaXQuICovXG5mdW5jdGlvbiByZXN0b3JlUmFuZ2UocHJlOiB7IGZyb206IG51bWJlcjsgdG86IG51bWJlciB9IHwgbnVsbCwgcmVtb3ZlZDogbnVtYmVyKTogdm9pZCB7XG4gIGNvbnN0IGFkID0gYWRhcHRlcjtcbiAgaWYgKCFwcmUgfHwgIWFkKSByZXR1cm47XG4gIGNvbnN0IGFwcGx5ID0gKGZyb206IG51bWJlciwgdG86IG51bWJlcikgPT4gYWQuc2V0TG9naWNhbFJhbmdlKHsgZnJvbSwgdG8gfSk7XG4gIGNvbnN0IGRyaWZ0ZWQgPSBhZC5nZXRMb2dpY2FsUmFuZ2UoKTtcbiAgaWYgKCFkcmlmdGVkKSByZXR1cm47XG4gIGNvbnN0IGRGcm9tID0gcHJlLmZyb20gLSBkcmlmdGVkLmZyb207XG4gIGNvbnN0IGRUbyA9IHByZS50byAtIGRyaWZ0ZWQudG87XG4gIGlmIChNYXRoLmFicyhkRnJvbSkgPCAwLjEgJiYgTWF0aC5hYnMoZFRvKSA8IDAuMSkgcmV0dXJuO1xuICBhcHBseShkcmlmdGVkLmZyb20gKyBkRnJvbSwgZHJpZnRlZC50byArIGRUbyk7XG4gIC8vIExXQyBtYXkgcmUtbm9ybWFsaXplIG9uY2Ug4oCUIHZlcmlmeSBhbmQgY29ycmVjdCBhZ2FpbiBpZiBuZWVkZWRcbiAgY29uc3QgY2hlY2sgPSBhZC5nZXRMb2dpY2FsUmFuZ2UoKTtcbiAgaWYgKGNoZWNrICYmIChNYXRoLmFicyhwcmUuZnJvbSAtIGNoZWNrLmZyb20pID4gMC4xIHx8IE1hdGguYWJzKHByZS50byAtIGNoZWNrLnRvKSA+IDAuMSkpIHtcbiAgICBhcHBseShjaGVjay5mcm9tICsgKHByZS5mcm9tIC0gY2hlY2suZnJvbSksIGNoZWNrLnRvICsgKHByZS50byAtIGNoZWNrLnRvKSk7XG4gIH1cbn1cblxuZnVuY3Rpb24gdXBkYXRlQmFkZ2VQb3NpdGlvbigpOiB2b2lkIHtcbiAgLy8gRHVyaW5nIHJlcGxheSB0aGUgcmVhbC10aW1lIHByaWNlIGlzIGluIHRoZSBoaWRkZW4gZnV0dXJlIOKAlCBoaWRlIHRoZSB0YWdcbiAgaWYgKHJlcGxheS5hY3RpdmUpIHtcbiAgICB0YWdWaXNpYmxlLnZhbHVlID0gZmFsc2U7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IGxhc3QgPSBkaXNwbGF5Q2FuZGxlcy52YWx1ZVtkaXNwbGF5Q2FuZGxlcy52YWx1ZS5sZW5ndGggLSAxXTtcbiAgaWYgKCFsYXN0IHx8ICFhZGFwdGVyIHx8ICFjb250YWluZXJSZWYudmFsdWUpIHtcbiAgICB0YWdWaXNpYmxlLnZhbHVlID0gZmFsc2U7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHkgPSBhZGFwdGVyLmdldFByaWNlWShsYXN0LmNsb3NlKTtcbiAgaWYgKHkgPT09IG51bGwpIHtcbiAgICB0YWdWaXNpYmxlLnZhbHVlID0gZmFsc2U7IC8vIHByaWNlIHNjcm9sbGVkIG91dCBvZiB2aWV3XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgc21hbGxUYWdILnZhbHVlID0gYWRhcHRlci5nZXRQcmljZUxhYmVsSGVpZ2h0KCk7IC8vIG1hdGNoZXMgbmF0aXZlIGxhYmVsXG5cbiAgLy8gTWF0Y2ggdGhlIG5hdGl2ZSBsaXZlLXByaWNlIGxhYmVsOiBpdHMgd2lkdGggZm9sbG93cyB0aGUgcHJpY2UgdGV4dFxuICAvLyAodGV4dCArIH44cHggc2lkZSBwYWRkaW5nKSBhbmQgaXQgaXMgTEVGVC1hbGlnbmVkIGluc2lkZSB0aGUgcHJpY2VcbiAgLy8gYXhpcyDigJQgc28gdGhlIHRhZyB1c2VzIHRoZSBzYW1lIHdpZHRoIGFuZCB0aGUgc2FtZSBsZWZ0IG9mZnNldFxuICAvLyAoYXhpcyB3aWR0aCDiiJIgdGFnIHdpZHRoKS4gTG9uZ2VyIGNvdW50ZG93biB0ZXh0cyBvbiBsYXJnZSB0aW1lZnJhbWVzXG4gIC8vIChcIjJkIDA0OjMzOjEyXCIpIHdpZGVuIHRoZSB0YWcgbGVmdHdhcmQgaW5zdGVhZCBvZiBvdmVyZmxvd2luZy5cbiAgY29uc3QgcHJpY2VUZXh0ID0gbGFzdC5jbG9zZS50b0ZpeGVkKGluc3RydW1lbnRQcmVjaXNpb24obWFya2V0Lmluc3RydW1lbnQpKTtcbiAgY29uc3QgbmF0aXZlVyA9IGFkYXB0ZXIuZ2V0UHJpY2VMYWJlbFdpZHRoKHByaWNlVGV4dCkgKyAxNjtcbiAgY29uc3QgdGV4dFcgPSBhZGFwdGVyLmdldFByaWNlTGFiZWxXaWR0aChjb3VudGRvd24udmFsdWUgfHwgXCIwXCIpICsgMTI7IC8vIHRhZyBwYWRkaW5nIDZweMOXMlxuICB0YWdXLnZhbHVlID0gTWF0aC5tYXgobmF0aXZlVywgdGV4dFcpO1xuICB0YWdSaWdodC52YWx1ZSA9IE1hdGgubWF4KDAsIGF4aXNSaWdodFcudmFsdWUgLSB0YWdXLnZhbHVlKTtcblxuICBjb25zdCB0aW1lQXhpcyA9IDI2O1xuICBjb25zdCBwYW5lSCA9IGNvbnRhaW5lclJlZi52YWx1ZS5jbGllbnRIZWlnaHQgLSB0aW1lQXhpcztcbiAgLy8gTmF0aXZlIGxhYmVsIGlzIGNlbnRlcmVkIG9uIHByaWNlIFkg4oaSIGl0cyBib3R0b20gZWRnZSBpcyBhdCB5ICsgaC8yXG4gIHRpbWVyVG9wLnZhbHVlID0gTWF0aC5taW4oTWF0aC5tYXgoeSArIHNtYWxsVGFnSC52YWx1ZSAvIDIsIDQpLCBwYW5lSCAtIHNtYWxsVGFnSC52YWx1ZSk7XG4gIHRhZ1Zpc2libGUudmFsdWUgPSB0cnVlO1xufVxuXG5mdW5jdGlvbiB1cGRhdGVDb3VudGRvd24oKSB7XG4gIG1hcmtldENsb3NlZC52YWx1ZSA9IGlzRm9yZXhDbG9zZWQoKTtcbiAgdXBkYXRlQmFkZ2VQb3NpdGlvbigpO1xuICAvLyBUcmFjayB0aGUgZGVtbyBib3R0b20gcGFuZWwgaGVpZ2h0ICh0aGUgcmVwbGF5IHBhbmVsIGZsb2F0cyBhYm92ZSBpdClcbiAgY29uc3QgZGIgPSBkb2N1bWVudC5xdWVyeVNlbGVjdG9yKFwiLmRlbW8tYm90dG9tXCIpO1xuICBpZiAoZGIpIGRlbW9Cb3R0b21ILnZhbHVlID0gZGIuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCkuaGVpZ2h0O1xuXG4gIC8vIFJlYWwtdGltZSBjb3VudGRvd24gbWFrZXMgbm8gc2Vuc2Ugd2hpbGUgcmVwbGF5aW5nIHRoZSBwYXN0XG4gIGlmIChyZXBsYXkuYWN0aXZlKSB7XG4gICAgY291bnRkb3duLnZhbHVlID0gXCJcIjtcbiAgICByZXR1cm47XG4gIH1cblxuICBpZiAobWFya2V0Q2xvc2VkLnZhbHVlKSB7XG4gICAgY291bnRkb3duLnZhbHVlID0gXCJDTE9TRURcIjtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgdGYgPSBtYXJrZXQudGltZWZyYW1lO1xuICBjb25zdCBzZWMgPSBUSU1FRlJBTUVfU0VDT05EU1t0ZiBhcyBrZXlvZiB0eXBlb2YgVElNRUZSQU1FX1NFQ09ORFNdID8/IDU7XG4gIGNvbnN0IG5vdyA9IERhdGUubm93KCk7XG4gIGNvbnN0IERBWSA9IDg2NDAwMDAwO1xuICAvLyBOZXh0IGJvdW5kYXJ5IG9uIHRoZSBjYW5kbGUgZ3JpZCB0aGUgUFJPVklERVIgYWN0dWFsbHkgdXNlcy4gT0FOREFcbiAgLy8gYWxpZ25zIHRoZSBsYXJnZSB0aW1lZnJhbWVzIHRvIDVwbS1OZXctWW9yayBzZXNzaW9uczsgQmluYW5jZSBpc1xuICAvLyBVVEMtYWxpZ25lZCAoTW9uZGF5IHdlZWtzLCBjYWxlbmRhciBtb250aHMpLiBVc2luZyB0aGUgd3JvbmcgY29udmVudGlvblxuICAvLyBjb3VudHMgZG93biB0byBhIG1vbWVudCB3aGVyZSBubyBjYW5kbGUgZXZlciBvcGVucyAoZS5nLiBhIEJpbmFuY2UgNGhcbiAgLy8gc2hvd2luZyAxOjM3IGluc3RlYWQgb2YgMDozNyDigJQgZXhhY3RseSBvbmUgaG91ciBvZiBOWS1vZmZzZXQgZHJpZnQpLlxuICBjb25zdCBpc0JpbmFuY2UgPSBwcm92aWRlck9mKG1hcmtldC5pbnN0cnVtZW50KSA9PT0gXCJiaW5hbmNlXCI7XG4gIGxldCBuZXh0OiBudW1iZXI7XG4gIGlmIChpc0JpbmFuY2UpIHtcbiAgICBpZiAoc2VjID09PSAyNTkyMDAwKSB7XG4gICAgICAvLyBOZXh0IGNhbGVuZGFyIG1vbnRoLCAwMDowMCBVVENcbiAgICAgIGNvbnN0IGQgPSBuZXcgRGF0ZShub3cpO1xuICAgICAgbmV4dCA9IERhdGUuVVRDKGQuZ2V0VVRDRnVsbFllYXIoKSwgZC5nZXRVVENNb250aCgpICsgMSwgMSk7XG4gICAgfSBlbHNlIGlmIChzZWMgPT09IDYwNDgwMCkge1xuICAgICAgLy8gQ3VycmVudCB3ZWVrJ3MgTW9uZGF5IDAwOjAwIFVUQyArIDdkID0gdGhlIG5leHQgTW9uZGF5XG4gICAgICBuZXh0ID0gYmluYW5jZUJ1Y2tldFN0YXJ0KG5vdywgc2VjKSArIHNlYyAqIDEwMDA7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIDRoIC8gMWQgLyBtaW51dGUgLyBzZWNvbmQgVEZzOiBwbGFpbiBVVEMgbXVsdGlwbGVzXG4gICAgICBuZXh0ID0gTWF0aC5mbG9vcihub3cgLyAoc2VjICogMTAwMCkpICogc2VjICogMTAwMCArIHNlYyAqIDEwMDA7XG4gICAgfVxuICB9XG4gIGVsc2UgaWYgKHNlYyA9PT0gMTQ0MDApIG5leHQgPSBvYW5kYUg0QnVja2V0U3RhcnQobm93ICsgNCAqIDM2MDAwMDApO1xuICBlbHNlIGlmIChzZWMgPT09IDg2NDAwKSB7XG4gICAgLy8gc2Vzc2lvbiBzdGFydCBvZiBhIGxhdGVyIG1vbWVudCDigJQgc3RlcCBmdXJ0aGVyIHdoaWxlIGl0IGxhbmRzIGJhY2tcbiAgICAvLyBpbiB0aGUgQ1VSUkVOVCBzZXNzaW9uIChlLmcuIHJpZ2h0IGFmdGVyIGEgY2FuZGxlIG9wZW5zKVxuICAgIG5leHQgPSBvYW5kYURhaWx5QnVja2V0U3RhcnQobm93ICsgMTIgKiAzNjAwMDAwKTtcbiAgICBpZiAobmV4dCA8PSBub3cpIG5leHQgPSBvYW5kYURhaWx5QnVja2V0U3RhcnQobm93ICsgMzYgKiAzNjAwMDAwKTtcbiAgfVxuICBlbHNlIGlmIChzZWMgPT09IDYwNDgwMCkgbmV4dCA9IG9hbmRhV2Vla2x5QnVja2V0U3RhcnQob2FuZGFXZWVrbHlCdWNrZXRTdGFydChub3cpICsgNyAqIERBWSArIDEwMDApO1xuICBlbHNlIGlmIChzZWMgPT09IDI1OTIwMDApIG5leHQgPSBvYW5kYU1vbnRobHlCdWNrZXRTdGFydChvYW5kYU1vbnRobHlCdWNrZXRTdGFydChub3cpICsgMzIgKiBEQVkpO1xuICBlbHNlIG5leHQgPSBNYXRoLmZsb29yKG5vdyAvIChzZWMgKiAxMDAwKSkgKiBzZWMgKiAxMDAwICsgc2VjICogMTAwMDtcbiAgY29uc3QgcmVtID0gTWF0aC5tYXgoMCwgbmV4dCAtIG5vdyk7XG5cbiAgY29uc3QgcGFkMiA9IChuOiBudW1iZXIpID0+IFN0cmluZyhuKS5wYWRTdGFydCgyLCBcIjBcIik7XG5cbiAgaWYgKHNlYyA+PSA2MDQ4MDApIHtcbiAgICAvLyBXZWVrbHkgLyBtb250aGx5IGNhbmRsZXMg4oaSIERkIEhIOk1NOlNTXG4gICAgY29uc3QgdG90YWwgPSBNYXRoLmZsb29yKHJlbSAvIDEwMDApO1xuICAgIGNvbnN0IGRkID0gTWF0aC5mbG9vcih0b3RhbCAvIDg2NDAwKTtcbiAgICBjb25zdCBoaCA9IE1hdGguZmxvb3IoKHRvdGFsICUgODY0MDApIC8gMzYwMCk7XG4gICAgY29uc3QgbW0gPSBNYXRoLmZsb29yKCh0b3RhbCAlIDM2MDApIC8gNjApO1xuICAgIGNvbnN0IHNzID0gdG90YWwgJSA2MDtcbiAgICBjb3VudGRvd24udmFsdWUgPSBgJHtkZH1kICR7cGFkMihoaCl9OiR7cGFkMihtbSl9OiR7cGFkMihzcyl9YDtcbiAgfSBlbHNlIGlmIChzZWMgPj0gMTQ0MDApIHtcbiAgICAvLyA0aCAvIGRhaWx5IGNhbmRsZXMg4oaSIEhIOk1NOlNTXG4gICAgY29uc3QgdG90YWwgPSBNYXRoLmZsb29yKHJlbSAvIDEwMDApO1xuICAgIGNvbnN0IGhoID0gTWF0aC5mbG9vcih0b3RhbCAvIDM2MDApO1xuICAgIGNvbnN0IG1tID0gTWF0aC5mbG9vcigodG90YWwgJSAzNjAwKSAvIDYwKTtcbiAgICBjb25zdCBzcyA9IHRvdGFsICUgNjA7XG4gICAgY291bnRkb3duLnZhbHVlID0gYCR7cGFkMihoaCl9OiR7cGFkMihtbSl9OiR7cGFkMihzcyl9YDtcbiAgfSBlbHNlIGlmIChzZWMgPj0gNjApIHtcbiAgICAvLyBNaW51dGUvaG91ciBjYW5kbGVzIOKGkiBNTTpTU1xuICAgIGNvbnN0IHMgPSBNYXRoLmZsb29yKHJlbSAvIDEwMDApO1xuICAgIGNvdW50ZG93bi52YWx1ZSA9IGAke3BhZDIoTWF0aC5mbG9vcihzIC8gNjApKX06JHtwYWQyKHMgJSA2MCl9YDtcbiAgfSBlbHNlIHtcbiAgICAvLyBTZWNvbmQtYmFzZWQgY2FuZGxlcyDihpIgc2Vjb25kcyB3aXRoIFwic1wiIHN1ZmZpeCAoZS5nLiBcIjRzXCIpXG4gICAgY291bnRkb3duLnZhbHVlID0gYCR7TWF0aC5tYXgoMCwgTWF0aC5jZWlsKHJlbSAvIDEwMDApKX1zYDtcbiAgfVxufVxuXG4vKiDilIDilIAgUmVjdGFuZ2xlIGRyYXdpbmcg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAICovXG5cbmludGVyZmFjZSBSZWN0UGl4ZWwge1xuICBpZDogc3RyaW5nO1xuICBsZWZ0OiBudW1iZXI7XG4gIHRvcDogbnVtYmVyO1xuICB3aWR0aDogbnVtYmVyO1xuICBoZWlnaHQ6IG51bWJlcjtcbiAgY29sb3I6IHN0cmluZztcbiAgb3BhY2l0eTogbnVtYmVyO1xuICBmaWxsZWQ6IGJvb2xlYW47XG4gIHNlbGVjdGVkOiBib29sZWFuO1xufVxuXG5jb25zdCByZWN0UGl4ZWxzID0gcmVmPFJlY3RQaXhlbFtdPihbXSk7XG4vKiogcmVjdFBpeGVscyBtaW51cyB0aGUgbGl2ZSBwcmV2aWV3IOKAlCB0aGUgaW50ZXJhY3Rpb24gbGF5ZXIgaGl0LXRlc3RzIG9ubHlcbiAqICByZWFsIChzdG9yZWQpIHJlY3RhbmdsZXMuICovXG5jb25zdCBoaXRSZWN0cyA9IGNvbXB1dGVkKCgpID0+IHJlY3RQaXhlbHMudmFsdWUuZmlsdGVyKChyKSA9PiByLmlkICE9PSBcIl9fcHJldmlld1wiKSk7XG5jb25zdCBkcmF3aW5nU3RhdGUgPSByZWY8eyB0aW1lMTogbnVtYmVyOyBwcmljZTE6IG51bWJlcjsgdGltZTI6IG51bWJlcjsgcHJpY2UyOiBudW1iZXIgfSB8IG51bGw+KG51bGwpO1xuY29uc3QgZHJhd2luZ1ByZXZpZXcgPSByZWY8UmVjdFBpeGVsIHwgbnVsbD4obnVsbCk7XG5jb25zdCBzZWxlY3RlZFJlY3QgPSByZWY8RHJhd2luZ1JlY3QgfCBudWxsPihudWxsKTtcbmNvbnN0IGVkaXRQYW5lbFBvcyA9IHJlZjx7IHg6IG51bWJlcjsgeTogbnVtYmVyIH0gfCBudWxsPihudWxsKTtcbmNvbnN0IGVkaXRQYW5lbEVsID0gcmVmPEhUTUxFbGVtZW50IHwgbnVsbD4obnVsbCk7XG5jb25zdCBlZGl0TWVudUVsID0gcmVmPEhUTUxFbGVtZW50IHwgbnVsbD4obnVsbCk7XG4vKiogVHJhZGluZ1ZpZXctc3R5bGUgcmlnaHQtY2xpY2sgbWVudTogeyBpZCwgeCwgeSB9IHJlbGF0aXZlIHRvIHRoZSBjaGFydCBwYW5lLiAqL1xuY29uc3QgcmVjdE1lbnUgPSByZWY8eyBpZDogc3RyaW5nOyB4OiBudW1iZXI7IHk6IG51bWJlciB9IHwgbnVsbD4obnVsbCk7XG4vKiogV2hpY2ggY29sb3IgcGFsZXR0ZSBwb3B1cCBpcyBvcGVuIChlZGl0IHBhbmVsIC8gY29udGV4dCBtZW51IC8gbm9uZSkuICovXG5jb25zdCBwYWxldHRlT3BlbiA9IHJlZjxudWxsIHwgXCJwYW5lbFwiIHwgXCJtZW51XCI+KG51bGwpO1xuLyogUmVuZGVyZWQgZmxvYXRpbmctcGFuZWwgc2l6ZSBmYWxsYmFjayAodGhlIHJlYWwgYm94IGlzIG1lYXN1cmVkIG9uY2VcbiAgIG1vdW50ZWQ7IGtlZXAgdGhlc2UgY2xvc2UgdG8gdGhlIG1lYXN1cmVkIDM2NcOXNDAgc28gdGhlIHZlcnkgZmlyc3QgcGFpbnRcbiAgIG9mIGEgZnJlc2hseSBvcGVuZWQgcGFuZWwgbGFuZHMgd2l0aGluIGEgZmV3IHB4IG9mIGl0cyBmaW5hbCBzcG90KS4gKi9cbmNvbnN0IFBBTkVMX1cgPSAzNjY7XG5jb25zdCBQQU5FTF9IID0gNDA7XG5cbi8qKiBLZWVwcyBhIGZsb2F0aW5nIHBhbmVsIGZ1bGx5IGluc2lkZSB0aGUgY2hhcnQgcGFuZSwgYm90aCBheGVzLiAqL1xuZnVuY3Rpb24gY2xhbXBUb1BhbmUoeDogbnVtYmVyLCB5OiBudW1iZXIsIGVsOiBIVE1MRWxlbWVudCB8IG51bGwpOiB7IHg6IG51bWJlcjsgeTogbnVtYmVyIH0ge1xuICBjb25zdCBwYW5lID0gY29udGFpbmVyUmVmLnZhbHVlO1xuICBpZiAoIXBhbmUpIHJldHVybiB7IHgsIHkgfTtcbiAgY29uc3QgdyA9IGVsPy5vZmZzZXRXaWR0aCB8fCBQQU5FTF9XO1xuICBjb25zdCBoID0gZWw/Lm9mZnNldEhlaWdodCB8fCBQQU5FTF9IO1xuICByZXR1cm4ge1xuICAgIHg6IE1hdGgubWluKE1hdGgubWF4KDQsIHgpLCBNYXRoLm1heCg0LCBwYW5lLmNsaWVudFdpZHRoIC0gdyAtIDYpKSxcbiAgICB5OiBNYXRoLm1pbihNYXRoLm1heCg0LCB5KSwgTWF0aC5tYXgoNCwgcGFuZS5jbGllbnRIZWlnaHQgLSBoIC0gNikpLFxuICB9O1xufVxuXG5mdW5jdGlvbiB0b2dnbGVQYWxldHRlKHdoaWNoOiBcInBhbmVsXCIgfCBcIm1lbnVcIik6IHZvaWQge1xuICBwYWxldHRlT3Blbi52YWx1ZSA9IHBhbGV0dGVPcGVuLnZhbHVlID09PSB3aGljaCA/IG51bGwgOiB3aGljaDtcbn1cbmZ1bmN0aW9uIGNsb3NlUGFsZXR0ZSgpOiB2b2lkIHtcbiAgcGFsZXR0ZU9wZW4udmFsdWUgPSBudWxsO1xufVxuLyoqIFN0eWxlIG9mIHRoZSByZWN0YW5nbGUgY3VycmVudGx5IG9wZW5lZCBpbiB0aGUgY29udGV4dCBtZW51LiAqL1xuY29uc3QgbWVudVJlY3RDb2xvciA9IGNvbXB1dGVkKCgpID0+IHtcbiAgY29uc3QgbSA9IHJlY3RNZW51LnZhbHVlO1xuICBpZiAoIW0pIHJldHVybiBcIiMyOTYyZmZcIjtcbiAgcmV0dXJuIGRyYXdpbmdzU3RvcmUuZ2V0Rm9yKG1hcmtldC5pbnN0cnVtZW50KS5maW5kKChyKSA9PiByLmlkID09PSBtLmlkKT8uY29sb3IgPz8gXCIjMjk2MmZmXCI7XG59KTtcbmNvbnN0IG1lbnVSZWN0T3BhY2l0eSA9IGNvbXB1dGVkKCgpID0+IHtcbiAgY29uc3QgbSA9IHJlY3RNZW51LnZhbHVlO1xuICBpZiAoIW0pIHJldHVybiAwLjM7XG4gIHJldHVybiBkcmF3aW5nc1N0b3JlLmdldEZvcihtYXJrZXQuaW5zdHJ1bWVudCkuZmluZCgocikgPT4gci5pZCA9PT0gbS5pZCk/Lm9wYWNpdHkgPz8gMC4zO1xufSk7XG5jb25zdCBtZW51UmVjdEZpbGxlZCA9IGNvbXB1dGVkKCgpID0+IHtcbiAgY29uc3QgbSA9IHJlY3RNZW51LnZhbHVlO1xuICBpZiAoIW0pIHJldHVybiB0cnVlO1xuICByZXR1cm4gZHJhd2luZ3NTdG9yZS5nZXRGb3IobWFya2V0Lmluc3RydW1lbnQpLmZpbmQoKHIpID0+IHIuaWQgPT09IG0uaWQpPy5maWxsZWQgIT09IGZhbHNlO1xufSk7XG5jb25zdCByZW5kZXJUaWNrID0gcmVmKDApO1xuXG4vKiDilIDilIAgVHJlbmRsaW5lIGRyYXdpbmcgKG1pcnJvcnMgcmVjdGFuZ2xlIGxvZ2ljKSDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIAgKi9cblxuaW50ZXJmYWNlIFRyZW5kUGl4ZWwge1xuICBpZDogc3RyaW5nO1xuICB4MTogbnVtYmVyO1xuICB5MTogbnVtYmVyO1xuICB4MjogbnVtYmVyO1xuICB5MjogbnVtYmVyO1xuICBjb2xvcjogc3RyaW5nO1xuICB3aWR0aDogbnVtYmVyO1xuICBkYXNoOiBEYXNoU3R5bGU7XG4gIHNlbGVjdGVkOiBib29sZWFuO1xufVxuLyoqIFNWRyBzdHJva2UtZGFzaGFycmF5IHBlciBkYXNoIHN0eWxlIChcInNvbGlkXCIgcmVuZGVycyB1bi1kYXNoZWQpLiAqL1xuY29uc3QgREFTSF9BUlJBWTogUmVjb3JkPERhc2hTdHlsZSwgc3RyaW5nPiA9IHsgc29saWQ6IFwiXCIsIGRhc2hlZDogXCI5IDZcIiwgZG90dGVkOiBcIjIgNlwiIH07XG5jb25zdCBEQVNIX1NUWUxFUzogRGFzaFN0eWxlW10gPSBbXCJzb2xpZFwiLCBcImRhc2hlZFwiLCBcImRvdHRlZFwiXTtcblxuY29uc3QgdHJlbmRQaXhlbHMgPSByZWY8VHJlbmRQaXhlbFtdPihbXSk7XG4vKiogdHJlbmRQaXhlbHMgbWludXMgdGhlIGxpdmUgcHJldmlldyDigJQgdGhlIGludGVyYWN0aW9uIGxheWVyIGhpdC10ZXN0cyBvbmx5XG4gKiAgcmVhbCAoc3RvcmVkKSB0cmVuZGxpbmVzLiAqL1xuY29uc3QgaGl0VHJlbmRzID0gY29tcHV0ZWQoKCkgPT4gdHJlbmRQaXhlbHMudmFsdWUuZmlsdGVyKCh0KSA9PiB0LmlkICE9PSBcIl9fcHJldmlld1wiKSk7XG5jb25zdCBzZWxlY3RlZExpbmUgPSByZWY8RHJhd2luZ1RyZW5kIHwgbnVsbD4obnVsbCk7XG5jb25zdCBsaW5lUGFuZWxQb3MgPSByZWY8eyB4OiBudW1iZXI7IHk6IG51bWJlciB9IHwgbnVsbD4obnVsbCk7XG5jb25zdCBsaW5lUGFuZWxFbCA9IHJlZjxIVE1MRWxlbWVudCB8IG51bGw+KG51bGwpO1xuY29uc3QgbGluZVBhbGV0dGVPcGVuID0gcmVmKGZhbHNlKTtcbmNvbnN0IGRyYXdpbmdUb29sQWN0aXZlID0gY29tcHV0ZWQoKCkgPT4gZHJhd2luZ3NTdG9yZS5hY3RpdmVUb29sICE9PSBcImN1cnNvclwiKTtcblxuLyog4pSA4pSAIE1hZ25ldCBtb2RlIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgTGF0Y2hlZCBieSB0aGUgdG9vbGJhciBtYWduZXQgYnV0dG9uOyBob2xkaW5nIEN0cmwgdGVtcG9yYXJpbHkgZm9yY2VzXG4gICBzbmFwcGluZyAoVHJhZGluZ1ZpZXctc3R5bGUgbW9kaWZpZXIgaG9sZCkuIFRoZSBzdG9yZSBvd25zIHRoZSBlZmZlY3RpdmVcbiAgIHN0YXRlIHNvIHRoZSB0b29sYmFyIGhpZ2hsaWdodCBhbmQgdGhlIHNuYXBwaW5nIGNyb3NzaGFpciBzdGF5IGluIHN5bmMuICovXG5jb25zdCBtYWduZXRBY3RpdmUgPSBjb21wdXRlZCgoKSA9PiBkcmF3aW5nc1N0b3JlLm1hZ25ldEFjdGl2ZSk7XG4vKiogU25hcHBpbmcgY3Jvc3NoYWlyOiB3aGVuIGEgZHJhd2luZyB0b29sICsgbWFnbmV0IGFyZSBhY3RpdmUgdGhlIG5hdGl2ZVxuICogIGNyb3NzaGFpciBoaWRlcyBhbmQgdGhpcyBvbmUgZHJhd3Mgc3R1Y2sgdG8gdGhlIHNuYXBwZWQgY2FuZGxlIGxldmVsLiAqL1xuY29uc3Qgc25hcFhoYWlyID0gcmVmPHsgeDogbnVtYmVyOyB5OiBudW1iZXI7IHByaWNlVGV4dDogc3RyaW5nOyB0aW1lVGV4dDogc3RyaW5nIH0gfCBudWxsPihudWxsKTtcblxuLy8gV2hlbiB0aGUgbWFnbmV0IHR1cm5zIE9OIG1pZC1kcmF3aW5nIChlLmcuIEN0cmwgcHJlc3NlZCB3aGlsZSB0aGUgY3Vyc29yXG4vLyBpcyBzdGF0aW9uYXJ5KSwgcmUtc25hcCBldmVyeSBpbi1wcm9ncmVzcyBhbmNob3IgaW1tZWRpYXRlbHkg4oCUIG90aGVyd2lzZVxuLy8gdGhlIGNyb3NzaGFpciBzdGlja3MgYnV0IHRoZSBoYWxmLWRyYXduIHNoYXBlIHN0YXlzIGF0IGl0cyByYXcgcG9zaXRpb25cbi8vIHVudGlsIHRoZSBuZXh0IG1vdXNlIG1vdmUuIFdoZW4gaXQgdHVybnMgT0ZGLCB0aGUgcHJlLXNuYXAgcG9zaXRpb25zIGFyZVxuLy8gcmVzdG9yZWQgYW5kIHRoZSByYXcgY3Vyc29yIHBvc2l0aW9uIGlzIHJlcGxheWVkIHRocm91Z2ggdGhlIGFjdGl2ZSBtb3ZlXG4vLyBoYW5kbGVycywgc28gdGhlIHNoYXBlIHJldHVybnMgdG8gdGhlIGN1cnNvciBleGFjdGx5LlxubGV0IGxhc3RQdHJDbGllbnQ6IHsgY2xpZW50WDogbnVtYmVyOyBjbGllbnRZOiBudW1iZXIgfSB8IG51bGwgPSBudWxsO1xubGV0IHByZVNuYXA6IHtcbiAgZHJhd2luZ09iajogb2JqZWN0IHwgbnVsbDtcbiAgZHJhd2luZzogeyB0aW1lMTogbnVtYmVyOyBwcmljZTE6IG51bWJlcjsgdGltZTI6IG51bWJlcjsgcHJpY2UyOiBudW1iZXIgfSB8IG51bGw7XG4gIHBvbHlPYmo6IG9iamVjdCB8IG51bGw7XG4gIHBvbHlDdXJzb3I6IHsgdGltZTogbnVtYmVyOyBwcmljZTogbnVtYmVyIH0gfCBudWxsO1xuICBwb3NPYmo6IG9iamVjdCB8IG51bGw7XG4gIHBvczogeyB0aW1lMTogbnVtYmVyOyBlbnRyeTogbnVtYmVyIH0gfCBudWxsO1xufSB8IG51bGwgPSBudWxsO1xud2F0Y2gobWFnbmV0QWN0aXZlLCAob24pID0+IHtcbiAgaWYgKG9uKSB7XG4gICAgcHJlU25hcCA9IG51bGw7XG4gICAgaWYgKCFhZGFwdGVyKSByZXR1cm47XG4gICAgaWYgKGRyYXdpbmdTdGF0ZS52YWx1ZSkge1xuICAgICAgY29uc3QgZCA9IGRyYXdpbmdTdGF0ZS52YWx1ZTtcbiAgICAgIHByZVNuYXAgPSB7IGRyYXdpbmdPYmo6IGQsIGRyYXdpbmc6IHsgLi4uZCB9LCBwb2x5T2JqOiBudWxsLCBwb2x5Q3Vyc29yOiBudWxsLCBwb3NPYmo6IG51bGwsIHBvczogbnVsbCB9O1xuICAgICAgLy8gTXV0YXRlIGluIHBsYWNlIOKAlCB0aGUgT0ZGIGJyYW5jaCByZXN0b3JlcyB2aWEgb2JqZWN0IGlkZW50aXR5XG4gICAgICBjb25zdCBzMSA9IHNuYXBUb0NhbmRsZShkLnRpbWUxLCBkLnByaWNlMSwgdHJ1ZSk7XG4gICAgICBjb25zdCBzMiA9IHNuYXBUb0NhbmRsZShkLnRpbWUyLCBkLnByaWNlMiwgdHJ1ZSk7XG4gICAgICBkLnRpbWUxID0gczEudGltZTtcbiAgICAgIGQucHJpY2UxID0gczEucHJpY2U7XG4gICAgICBkLnRpbWUyID0gczIudGltZTtcbiAgICAgIGQucHJpY2UyID0gczIucHJpY2U7XG4gICAgfSBlbHNlIGlmIChwb2x5U3RhdGUudmFsdWUpIHtcbiAgICAgIHByZVNuYXAgPSB7IGRyYXdpbmdPYmo6IG51bGwsIGRyYXdpbmc6IG51bGwsIHBvbHlPYmo6IHBvbHlTdGF0ZS52YWx1ZSwgcG9seUN1cnNvcjogcG9seVN0YXRlLnZhbHVlLmN1cnNvciA/IHsgLi4ucG9seVN0YXRlLnZhbHVlLmN1cnNvciB9IDogbnVsbCwgcG9zT2JqOiBudWxsLCBwb3M6IG51bGwgfTtcbiAgICAgIC8vIFBsYWNlZCB2ZXJ0aWNlcyBzdGF5IGFzIGNsaWNrZWQ7IHRoZSBtb3ZpbmcgY3Vyc29yIHNuYXBzLlxuICAgICAgY29uc3QgY3VyID0gcG9seVN0YXRlLnZhbHVlLmN1cnNvcjtcbiAgICAgIGlmIChjdXIpIHtcbiAgICAgICAgY29uc3QgcyA9IHNuYXBUb0NhbmRsZShjdXIudGltZSwgY3VyLnByaWNlLCB0cnVlKTtcbiAgICAgICAgcG9seVN0YXRlLnZhbHVlLmN1cnNvciA9IHsgdGltZTogcy50aW1lLCBwcmljZTogcy5wcmljZSB9O1xuICAgICAgfVxuICAgIH0gZWxzZSBpZiAocG9zU3RhdGUudmFsdWUpIHtcbiAgICAgIHByZVNuYXAgPSB7IGRyYXdpbmdPYmo6IG51bGwsIGRyYXdpbmc6IG51bGwsIHBvbHlPYmo6IG51bGwsIHBvbHlDdXJzb3I6IG51bGwsIHBvc09iajogcG9zU3RhdGUudmFsdWUsIHBvczogeyAuLi5wb3NTdGF0ZS52YWx1ZSB9IH07XG4gICAgICBjb25zdCBzID0gc25hcFRvQ2FuZGxlKHBvc1N0YXRlLnZhbHVlLnRpbWUxLCBwb3NTdGF0ZS52YWx1ZS5lbnRyeSwgdHJ1ZSk7XG4gICAgICBwb3NTdGF0ZS52YWx1ZS50aW1lMSA9IHMudGltZTtcbiAgICAgIHBvc1N0YXRlLnZhbHVlLmVudHJ5ID0gcy5wcmljZTtcbiAgICAgIGlmIChwb3NDdXJzb3IudmFsdWUpIHtcbiAgICAgICAgY29uc3QgY3MgPSBzbmFwVG9DYW5kbGUocG9zQ3Vyc29yLnZhbHVlLnRpbWUsIHBvc0N1cnNvci52YWx1ZS5wcmljZSwgdHJ1ZSk7XG4gICAgICAgIHBvc0N1cnNvci52YWx1ZSA9IHsgdGltZTogY3MudGltZSwgcHJpY2U6IGNzLnByaWNlIH07XG4gICAgICB9XG4gICAgfVxuICAgIC8vIFJlc2l6ZSBoYW5kbGVzIHNuYXAgcGVyLW1vdmUg4oCUIHJlcGxheSB0aGUgbGFzdCBjdXJzb3IgcG9zaXRpb24gc28gYVxuICAgIC8vIHN0YXRpb25hcnkgcmVzaXplIHJlLWFwcGxpZXMgdGhlIHNuYXAgdGhlIGluc3RhbnQgQ3RybCBpcyBwcmVzc2VkLlxuICAgIHJlcGxheVBvaW50ZXJBdChsYXN0UHRyQ2xpZW50KTtcbiAgICByZWNhbGNSZWN0cygpO1xuICAgIHJldHVybjtcbiAgfVxuICAvLyDilIDilIAgTWFnbmV0IE9GRiDilIDilIBcbiAgc25hcFhoYWlyLnZhbHVlID0gbnVsbDtcbiAgaWYgKHByZVNuYXApIHtcbiAgICAvLyBSZXN0b3JlIG9ubHkgaWYgaXQncyBzdGlsbCB0aGUgc2FtZSBpbi1wcm9ncmVzcyBkcmF3aW5nIHNlc3Npb25cbiAgICBpZiAocHJlU25hcC5kcmF3aW5nT2JqICYmIGRyYXdpbmdTdGF0ZS52YWx1ZSA9PT0gcHJlU25hcC5kcmF3aW5nT2JqICYmIHByZVNuYXAuZHJhd2luZykge1xuICAgICAgZHJhd2luZ1N0YXRlLnZhbHVlID0geyAuLi5wcmVTbmFwLmRyYXdpbmcgfTtcbiAgICB9XG4gICAgaWYgKHByZVNuYXAucG9seU9iaiAmJiBwb2x5U3RhdGUudmFsdWUgPT09IHByZVNuYXAucG9seU9iaiAmJiBwcmVTbmFwLnBvbHlDdXJzb3IpIHtcbiAgICAgIHBvbHlTdGF0ZS52YWx1ZS5jdXJzb3IgPSB7IC4uLnByZVNuYXAucG9seUN1cnNvciB9O1xuICAgIH1cbiAgICBpZiAocHJlU25hcC5wb3NPYmogJiYgcG9zU3RhdGUudmFsdWUgPT09IHByZVNuYXAucG9zT2JqICYmIHByZVNuYXAucG9zKSB7XG4gICAgICBwb3NTdGF0ZS52YWx1ZSA9IHsgLi4ucHJlU25hcC5wb3MgfTtcbiAgICB9XG4gICAgcHJlU25hcCA9IG51bGw7XG4gIH1cbiAgLy8gUmVwbGF5IHRoZSByYXcgY3Vyc29yIHBvc2l0aW9uIHNvIGN1cnNvci1kcml2ZW4gY29ybmVycy9sZXZlbHMgcmV0dXJuXG4gIC8vIHRvIGV4YWN0bHkgd2hlcmUgdGhlIHBvaW50ZXIgaXMuXG4gIHJlcGxheVBvaW50ZXJBdChsYXN0UHRyQ2xpZW50KTtcbiAgcmVjYWxjUmVjdHMoKTtcbn0pO1xuXG4vKiogUmVwbGF5cyB0aGUgbGFzdCBwb2ludGVyIHBvc2l0aW9uIHRocm91Z2ggZXZlcnkgYWN0aXZlIG1vdmUgaGFuZGxlclxuICogIChkcmF3aW5nIHByZXZpZXcsIHJlc2l6ZSBoYW5kbGVzKSBzbyBhIG1hZ25ldCB0b2dnbGUgYXBwbGllcyBpbnN0YW50bHlcbiAqICBldmVuIHdoZW4gdGhlIGN1cnNvciBpcyBzdGF0aW9uYXJ5LiAqL1xuZnVuY3Rpb24gcmVwbGF5UG9pbnRlckF0KHA6IHsgY2xpZW50WDogbnVtYmVyOyBjbGllbnRZOiBudW1iZXIgfSB8IG51bGwpOiB2b2lkIHtcbiAgaWYgKCFwKSByZXR1cm47XG4gIHdpbmRvdy5kaXNwYXRjaEV2ZW50KG5ldyBQb2ludGVyRXZlbnQoXCJwb2ludGVybW92ZVwiLCB7XG4gICAgYnViYmxlczogdHJ1ZSwgY2FuY2VsYWJsZTogdHJ1ZSxcbiAgICBjbGllbnRYOiBwLmNsaWVudFgsIGNsaWVudFk6IHAuY2xpZW50WSxcbiAgICBwb2ludGVySWQ6IDEsIHBvaW50ZXJUeXBlOiBcIm1vdXNlXCIsIGlzUHJpbWFyeTogdHJ1ZSwgYnV0dG9uOiAtMSwgYnV0dG9uczogMSxcbiAgfSkpO1xufVxuLy8gV2hpbGUgYSBzaGFwZSB0b29sIGlzIGFjdGl2ZSB0aGUgY2hhcnQgbXVzdCBub3QgcGFuIHVuZGVyIHRoZSBmaW5nZXIg4oCUXG4vLyB0b3VjaCBkcmF3aW5nIHN0YXJ0cyBmcm9tIHBvaW50ZXJkb3duLCBhbmQgTFdDJ3Mgb3duIHRvdWNoIGhhbmRsZXJzIHdvdWxkXG4vLyBvdGhlcndpc2UgdHJlYXQgdGhlIHNhbWUgZ2VzdHVyZSBhcyBhIHBhbiBhbmQgc3dhbGxvdyB0aGUgZHJhd2luZy5cbndhdGNoKGRyYXdpbmdUb29sQWN0aXZlLCAob24pID0+IGFkYXB0ZXI/LnNldERyYXdpbmdNb2RlKG9uKSk7XG5cbi8qIOKUgOKUgCBQb2x5bGluZSBkcmF3aW5nIChtdWx0aS1jbGljazsgZG91YmxlLWNsaWNrIGZpbmlzaGVzKSDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIAgKi9cblxuaW50ZXJmYWNlIFBvbHlQaXhlbCB7XG4gIGlkOiBzdHJpbmc7XG4gIC8qKiBwcm9qZWN0ZWQgdmVydGljZXM7IGBzcmNgIGlzIHRoZSBpbmRleCBpbiB0aGUgc3RvcmVkIHBvaW50cyBhcnJheSAqL1xuICBwdHM6IHsgeDogbnVtYmVyOyB5OiBudW1iZXI7IHNyYzogbnVtYmVyIH1bXTtcbiAgY29sb3I6IHN0cmluZztcbiAgd2lkdGg6IG51bWJlcjtcbiAgZGFzaDogRGFzaFN0eWxlO1xuICAvKiogU1ZHIHBvaW50cyBmb3IgdGhlIGFycm93aGVhZCB0cmlhbmdsZSBvbiB0aGUgbGFzdCBjb3JuZXIgKG9yIG51bGwpICovXG4gIGFycm93VHJpOiBzdHJpbmcgfCBudWxsO1xuICBzZWxlY3RlZDogYm9vbGVhbjtcbn1cblxuY29uc3QgcG9seVBpeGVscyA9IHJlZjxQb2x5UGl4ZWxbXT4oW10pO1xuY29uc3QgaGl0UG9seXMgPSBjb21wdXRlZCgoKSA9PiBwb2x5UGl4ZWxzLnZhbHVlLmZpbHRlcigocCkgPT4gcC5pZCAhPT0gXCJfX3ByZXZpZXdcIikpO1xuY29uc3Qgc2VsZWN0ZWRQb2x5ID0gcmVmPERyYXdpbmdQb2x5IHwgbnVsbD4obnVsbCk7XG5jb25zdCBwb2x5UGFuZWxQb3MgPSByZWY8eyB4OiBudW1iZXI7IHk6IG51bWJlciB9IHwgbnVsbD4obnVsbCk7XG5jb25zdCBwb2x5UGFuZWxFbCA9IHJlZjxIVE1MRWxlbWVudCB8IG51bGw+KG51bGwpO1xuY29uc3QgcG9seVBhbGV0dGVPcGVuID0gcmVmKGZhbHNlKTtcbi8qKiBJbi1wcm9ncmVzcyBwb2x5bGluZTogY29uZmlybWVkIHZlcnRpY2VzICsgdGhlIGxpdmUgY3Vyc29yIHBvc2l0aW9uLiAqL1xuY29uc3QgcG9seVN0YXRlID0gcmVmPHsgcG9pbnRzOiB7IHRpbWU6IG51bWJlcjsgcHJpY2U6IG51bWJlciB9W107IGN1cnNvcjogeyB0aW1lOiBudW1iZXI7IHByaWNlOiBudW1iZXIgfSB8IG51bGwgfSB8IG51bGw+KG51bGwpO1xubGV0IGxhc3RQb2x5Q2xpY2tBdDogeyB4OiBudW1iZXI7IHk6IG51bWJlcjsgYXQ6IG51bWJlciB9IHwgbnVsbCA9IG51bGw7XG5sZXQgb25Qb2x5TW92ZVJlZjogKChldjogTW91c2VFdmVudCkgPT4gdm9pZCkgfCBudWxsID0gbnVsbDtcblxuLyog4pSA4pSAIExvbmcgLyBTaG9ydCBwb3NpdGlvbiAoVHJhZGluZ1ZpZXctc3R5bGUpIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgCAqL1xuXG5pbnRlcmZhY2UgUG9zTGV2ZWwge1xuICB5OiBudW1iZXI7XG4gIC8qKiAxUiBsaW5lIGluZGV4ICgxLWJhc2VkKSDigJQgdW5kZWZpbmVkIGZvciBlbnRyeS90cC9zbCAqL1xuICByPzogbnVtYmVyO1xufVxuaW50ZXJmYWNlIFBvc2l0aW9uUGl4ZWwge1xuICBpZDogc3RyaW5nO1xuICBkaXJlY3Rpb246IFwibG9uZ1wiIHwgXCJzaG9ydFwiO1xuICBsZWZ0OiBudW1iZXI7XG4gIHdpZHRoOiBudW1iZXI7XG4gIGVudHJ5WTogbnVtYmVyO1xuICBzbFk6IG51bWJlcjtcbiAgdHBZOiBudW1iZXI7XG4gIC8qKiBwcm9maXQgYm94IChlbnRyeSDihpQgVFApICovXG4gIHByb2ZpdFRvcDogbnVtYmVyO1xuICBwcm9maXRIOiBudW1iZXI7XG4gIC8qKiBsb3NzIGJveCAoZW50cnkg4oaUIFNMKSAqL1xuICBsb3NzVG9wOiBudW1iZXI7XG4gIGxvc3NIOiBudW1iZXI7XG4gIHJyOiBudW1iZXI7XG4gIHNsUGN0OiBudW1iZXI7XG4gIHRwUGN0OiBudW1iZXI7XG4gIC8qKiB8U0ziiJJlbnRyeXwgYW5kIHxUUOKIkmVudHJ5fCBleHByZXNzZWQgaW4gcGlwcyAqL1xuICBzbFBpcHM6IG51bWJlcjtcbiAgdHBQaXBzOiBudW1iZXI7XG4gIHByZWNpc2lvbjogbnVtYmVyO1xuICAvKiogMVIuLk5SIHJld2FyZCBsaW5lcyB3aGVuIGVuYWJsZWQgKi9cbiAgbGV2ZWxzOiBQb3NMZXZlbFtdO1xuICBzZWxlY3RlZDogYm9vbGVhbjtcbiAgLyoqIGxpdmUgdHdvLWNsaWNrIHByZXZpZXcgKGxpZ2h0ZXIgc3R5bGluZykgKi9cbiAgcHJldmlldzogYm9vbGVhbjtcbn1cblxuY29uc3QgcG9zUGl4ZWxzID0gcmVmPFBvc2l0aW9uUGl4ZWxbXT4oW10pO1xuY29uc3Qgc2VsZWN0ZWRQb3MgPSByZWY8RHJhd2luZ1Bvc2l0aW9uIHwgbnVsbD4obnVsbCk7XG5jb25zdCBwb3NQYW5lbFBvcyA9IHJlZjx7IHg6IG51bWJlcjsgeTogbnVtYmVyIH0gfCBudWxsPihudWxsKTtcbmNvbnN0IHBvc1BhbmVsRWwgPSByZWY8SFRNTEVsZW1lbnQgfCBudWxsPihudWxsKTtcbi8qKiBIaWRkZW4gdW50aWwgdGhlIHBhbmVsJ3MgcmVhbCBzaXplIGlzIG1lYXN1cmVkIOKAlCBubyB3cm9uZy1zcG90IGZsYXNoLiAqL1xuY29uc3QgcG9zUGFuZWxSZWFkeSA9IHJlZihmYWxzZSk7XG4vKiogSW4tcHJvZ3Jlc3MgcG9zaXRpb246IGZpcnN0IGNsaWNrIHNldCAoZW50cnkgKyBsZWZ0IGVkZ2UpLCB0aGUgY3Vyc29yXG4gKiAgc3VwcGxpZXMgdGhlIFNMIHByaWNlIGFuZCByaWdodCBlZGdlIHVudGlsIHRoZSBzZWNvbmQgY2xpY2suICovXG5jb25zdCBwb3NTdGF0ZSA9IHJlZjx7IHRpbWUxOiBudW1iZXI7IGVudHJ5OiBudW1iZXIgfSB8IG51bGw+KG51bGwpO1xuY29uc3QgcG9zQ3Vyc29yID0gcmVmPHsgdGltZTogbnVtYmVyOyBwcmljZTogbnVtYmVyIH0gfCBudWxsPihudWxsKTtcbmxldCBvblBvc01vdmVSZWY6ICgoZXY6IE1vdXNlRXZlbnQpID0+IHZvaWQpIHwgbnVsbCA9IG51bGw7XG5cbmNvbnN0IGZtdFByaWNlID0gKHY6IG51bWJlciwgcHJlY2lzaW9uOiBudW1iZXIpID0+IHYudG9GaXhlZChwcmVjaXNpb24pO1xuXG4vKiDilIDilIAgT25lLWNsaWNrIGxpbmVzOiBobGluZSAvIGhyYXkgLyB2bGluZSDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIAgKi9cblxuaW50ZXJmYWNlIFNpbmdsZVBpeGVsIHtcbiAgaWQ6IHN0cmluZztcbiAga2luZDogU2luZ2xlS2luZDtcbiAgLyoqIGhsaW5lL2hyYXk6IHBpeGVsIHkgb2YgdGhlIHByaWNlOyB2bGluZTogcGl4ZWwgeCBvZiB0aGUgdGltZSAqL1xuICB5OiBudW1iZXI7XG4gIHg6IG51bWJlcjtcbiAgLyoqIHJlc2l6ZS1jb3JuZXIgcG9zaXRpb24gKGhsaW5lL3ZsaW5lOiBtaWRkbGUgb2YgdGhlIGxpbmUsIGhyYXk6IGFuY2hvcikgKi9cbiAgaHg6IG51bWJlcjtcbiAgaHk6IG51bWJlcjtcbiAgLyoqIHNvdXJjZSB2YWx1ZXMgZm9yIHRoZSBheGlzIHRhZ3MgKi9cbiAgdGltZTogbnVtYmVyO1xuICBwcmljZTogbnVtYmVyO1xuICBjb2xvcjogc3RyaW5nO1xuICBkYXNoOiBEYXNoU3R5bGU7XG4gIHdpZHRoOiBudW1iZXI7XG4gIHNlbGVjdGVkOiBib29sZWFuO1xufVxuY29uc3Qgc2luZ2xlUGl4ZWxzID0gcmVmPFNpbmdsZVBpeGVsW10+KFtdKTtcbmNvbnN0IHNpbmdsZVBhbmVsUG9zID0gcmVmPHsgeDogbnVtYmVyOyB5OiBudW1iZXIgfSB8IG51bGw+KG51bGwpO1xuY29uc3Qgc2luZ2xlUGFuZWxFbCA9IHJlZjxIVE1MRWxlbWVudCB8IG51bGw+KG51bGwpO1xuLyoqIFdoaWxlIHRoZSBwYW5lbCBlbGVtZW50IGlzbid0IG1lYXN1cmVkIHlldCwga2VlcCBpdCBpbnZpc2libGUgc28gaXQgbmV2ZXJcbiAqICBmbGFzaGVzIGF0IGEgd3JvbmcgcG9zaXRpb247IGl0IHRoZW4gc3RpY2tzIHRvIHRoZSBsaW5lLiAqL1xuY29uc3Qgc2luZ2xlUGFuZWxSZWFkeSA9IHJlZihmYWxzZSk7XG5cbmZ1bmN0aW9uIGdldFNpbmdsZShraW5kOiBTaW5nbGVLaW5kLCBpZDogc3RyaW5nKTogU2luZ2xlRHJhd2luZyB8IG51bGwge1xuICByZXR1cm4gZHJhd2luZ3NTdG9yZS5nZXRTaW5nbGVzKGtpbmQsIG1hcmtldC5pbnN0cnVtZW50KS5maW5kKChpKSA9PiBpLmlkID09PSBpZCkgPz8gbnVsbDtcbn1cblxuLyoqXG4gKiBNYWduZXQgbW9kZTogc25hcCB0aGUgY3Vyc29yIHRvIHRoZSBoaWdoL2xvdyBvZiB0aGUgbmVhcmVzdCBjYW5kbGVcbiAqICh3aGljaGV2ZXIgaXMgY2xvc2VyIGluIHBpeGVscykuIFdoZW4gdGhlIG1hZ25ldCBpcyBhY3RpdmUgaXQgQUxXQVlTXG4gKiBhdHRyYWN0cyDigJQgVHJhZGluZ1ZpZXctc3R5bGUg4oCUIHNvIHRoZSBhbmNob3IgbGFuZHMgZXhhY3RseSBvbiB0aGUgbGV2ZWxcbiAqIG5vIG1hdHRlciBob3cgZmFyIHRoZSBjdXJzb3Igc2l0cyBmcm9tIGl0IHZlcnRpY2FsbHkuIFRoZSBjYW5kbGUgaXNcbiAqIGNob3NlbiBieSB0aW1lICh0aGUgYmFyIHVuZGVyIHRoZSBjdXJzb3IpLlxuICovXG5mdW5jdGlvbiBzbmFwVG9DYW5kbGUodGltZTogbnVtYmVyLCBwcmljZTogbnVtYmVyLCBzbmFwOiBib29sZWFuKTogeyB0aW1lOiBudW1iZXI7IHByaWNlOiBudW1iZXIgfSB7XG4gIGlmICghc25hcCB8fCAhYWRhcHRlciB8fCAhZGlzcGxheUNhbmRsZXMudmFsdWUubGVuZ3RoKSByZXR1cm4geyB0aW1lLCBwcmljZSB9O1xuICBjb25zdCBhcnIgPSBkaXNwbGF5Q2FuZGxlcy52YWx1ZTtcbiAgbGV0IGxvID0gMDtcbiAgbGV0IGhpID0gYXJyLmxlbmd0aCAtIDE7XG4gIHdoaWxlIChoaSAtIGxvID4gMSkge1xuICAgIGNvbnN0IG1pZCA9IChsbyArIGhpKSA+PiAxO1xuICAgIGlmIChhcnJbbWlkXSEudGltZSA8IHRpbWUpIGxvID0gbWlkO1xuICAgIGVsc2UgaGkgPSBtaWQ7XG4gIH1cbiAgY29uc3QgYyA9IE1hdGguYWJzKGFycltsb10hLnRpbWUgLSB0aW1lKSA8PSBNYXRoLmFicyhhcnJbaGldIS50aW1lIC0gdGltZSkgPyBhcnJbbG9dISA6IGFycltoaV0hO1xuICBjb25zdCB5UCA9IGFkYXB0ZXIuZ2V0UHJpY2VZKHByaWNlKTtcbiAgY29uc3QgeUggPSBhZGFwdGVyLmdldFByaWNlWShjLmhpZ2gpO1xuICBjb25zdCB5TCA9IGFkYXB0ZXIuZ2V0UHJpY2VZKGMubG93KTtcbiAgaWYgKHlQID09PSBudWxsIHx8IHlIID09PSBudWxsIHx8IHlMID09PSBudWxsKSByZXR1cm4geyB0aW1lLCBwcmljZSB9O1xuICByZXR1cm4geyB0aW1lOiBjLnRpbWUsIHByaWNlOiBNYXRoLmFicyh5UCAtIHlIKSA8PSBNYXRoLmFicyh5UCAtIHlMKSA/IGMuaGlnaCA6IGMubG93IH07XG59XG5cbi8qKiBGb3JtYXQgYSB0aW1lIGZvciB0aGUgdmVydGljYWwtbGluZSB0YWcgb24gdGhlIHRpbWUgc2NhbGUuIExpZ2h0d2VpZ2h0XG4gKiAgQ2hhcnRzIHRyZWF0cyBpdHMgdGltZXMgYXMgVVRDLCBzbyB0aGUgdGFnIGlzIGZvcm1hdHRlZCBpbiBVVEMgdG9vIOKAlFxuICogIG90aGVyd2lzZSBpdCB3b3VsZCBkaXNhZ3JlZSB3aXRoIHRoZSBjaGFydCdzIG93biBheGlzIGxhYmVscy4gKi9cbmNvbnN0IE1PTlRIU19TSE9SVCA9IFtcIkphblwiLCBcIkZlYlwiLCBcIk1hclwiLCBcIkFwclwiLCBcIk1heVwiLCBcIkp1blwiLCBcIkp1bFwiLCBcIkF1Z1wiLCBcIlNlcFwiLCBcIk9jdFwiLCBcIk5vdlwiLCBcIkRlY1wiXTtcbmZ1bmN0aW9uIGZtdEF4aXNUaW1lKHQ6IG51bWJlcik6IHN0cmluZyB7XG4gIGNvbnN0IGQgPSBuZXcgRGF0ZSh0ICogMTAwMCk7XG4gIGNvbnN0IHAyID0gKG46IG51bWJlcikgPT4gU3RyaW5nKG4pLnBhZFN0YXJ0KDIsIFwiMFwiKTtcbiAgY29uc3QgZGF0ZSA9IGAke3AyKGQuZ2V0VVRDRGF0ZSgpKX0gJHtNT05USFNfU0hPUlRbZC5nZXRVVENNb250aCgpXX0gJHtkLmdldFVUQ0Z1bGxZZWFyKCl9YDtcbiAgY29uc3Qgc2VjID0gVElNRUZSQU1FX1NFQ09ORFNbbWFya2V0LnRpbWVmcmFtZSBhcyBrZXlvZiB0eXBlb2YgVElNRUZSQU1FX1NFQ09ORFNdID8/IDYwO1xuICBpZiAoc2VjID49IDg2NDAwKSByZXR1cm4gZGF0ZTtcbiAgcmV0dXJuIGAke2RhdGV9ICR7cDIoZC5nZXRVVENIb3VycygpKX06JHtwMihkLmdldFVUQ01pbnV0ZXMoKSl9YDtcbn1cblxuLyoqIFdpZHRoIG9mIHRoZSBwcmljZSBzY2FsZSAvIGhlaWdodCBvZiB0aGUgdGltZSBzY2FsZSAobWVhc3VyZWQgZnJvbSB0aGVcbiAqICBMV0MgY2FudmFzZXMpLiBEcmF3aW5nIG92ZXJsYXlzIGFyZSBjbGlwcGVkIHRvIHRoZSBjaGFydCBhcmVhIHNvIG5vdGhpbmdcbiAqICBjYW4gYmUgZHJhd24gb24gdGhlIGF4ZXMuICovXG5jb25zdCBheGlzUmlnaHRXID0gcmVmKDApO1xuY29uc3QgYXhpc0JvdHRvbUggPSByZWYoMCk7XG5sZXQgYXhpc1JldHJ5ID0gMDtcbmZ1bmN0aW9uIHVwZGF0ZUF4aXNTaXplcygpOiB2b2lkIHtcbiAgY29uc3QgYyA9IGNvbnRhaW5lclJlZi52YWx1ZTtcbiAgaWYgKCFjKSByZXR1cm47XG4gIGxldCBtYWluOiBFbGVtZW50IHwgbnVsbCA9IG51bGw7XG4gIGxldCBhcmVhID0gMDtcbiAgZm9yIChjb25zdCBjdiBvZiBjLnF1ZXJ5U2VsZWN0b3JBbGwoXCJjYW52YXNcIikpIHtcbiAgICBjb25zdCByID0gY3YuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gICAgaWYgKHIud2lkdGggKiByLmhlaWdodCA+IGFyZWEpIHtcbiAgICAgIGFyZWEgPSByLndpZHRoICogci5oZWlnaHQ7XG4gICAgICBtYWluID0gY3Y7XG4gICAgfVxuICB9XG4gIGlmICghbWFpbikgcmV0dXJuO1xuICBjb25zdCByID0gbWFpbi5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgLy8gTFdDIG1heSBub3QgaGF2ZSBsYWlkIG91dCBpdHMgcGFuZXMgeWV0IChjYW52YXMgc3RpbGwgdGlueSkg4oCUIGEgYmFkXG4gIC8vIG1lYXN1cmVtZW50IHdvdWxkIHNocmluayBldmVyeSBvdmVybGF5IHRvIGEgc2xpdmVyLCBzbyByZXRyeSBpbnN0ZWFkLlxuICBpZiAoci53aWR0aCA8IGMuY2xpZW50V2lkdGggKiAwLjUpIHtcbiAgICBpZiAoYXhpc1JldHJ5IDwgNjApIHtcbiAgICAgIGF4aXNSZXRyeSArPSAxO1xuICAgICAgcmVxdWVzdEFuaW1hdGlvbkZyYW1lKHVwZGF0ZUF4aXNTaXplcyk7XG4gICAgfVxuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCByaWdodFcgPSBNYXRoLm1heCgwLCBNYXRoLnJvdW5kKGMuY2xpZW50V2lkdGggLSByLndpZHRoKSk7XG4gIGNvbnN0IGJvdHRvbUggPSBNYXRoLm1heCgwLCBNYXRoLnJvdW5kKGMuY2xpZW50SGVpZ2h0IC0gci5oZWlnaHQpKTtcbiAgY29uc3QgY2hhbmdlZCA9IHJpZ2h0VyAhPT0gYXhpc1JpZ2h0Vy52YWx1ZSB8fCBib3R0b21IICE9PSBheGlzQm90dG9tSC52YWx1ZTtcbiAgYXhpc1JpZ2h0Vy52YWx1ZSA9IHJpZ2h0VztcbiAgYXhpc0JvdHRvbUgudmFsdWUgPSBib3R0b21IO1xuICBpZiAoY2hhbmdlZCkge1xuICAgIC8vIFRoZSBMV0MgY2FudmFzIHJlc2l6ZXMgQVNZTkMgYWZ0ZXIgYSBjb250YWluZXIgbGF5b3V0IGNoYW5nZSAoZS5nLlxuICAgIC8vIHRoZSB3YXRjaGxpc3Qgc2xpZGUpIOKAlCB0aGUgZmlyc3QgbWVhc3VyZW1lbnQgY2FuIHN0aWxsIHNlZSB0aGUgb2xkXG4gICAgLy8gY2FudmFzIHNpemUsIHlpZWxkaW5nIGEgd2lsZGx5IHdyb25nIGF4aXMgd2lkdGggKDM4MnB4IGluc3RlYWQgb2ZcbiAgICAvLyA2MnB4KSB0aGF0IHdvdWxkIHBlcm1hbmVudGx5IGNsaXAgdGhlIG92ZXJsYXlzLiBLZWVwIHJlLW1lYXN1cmluZ1xuICAgIC8vIGV2ZXJ5IGZyYW1lIHVudGlsIHRoZSB2YWx1ZSBzZXR0bGVzLCB0aGVuIHJlLXByb2plY3QgdGhlIG92ZXJsYXlzLlxuICAgIHJlY2FsY1JlY3RzKCk7XG4gICAgaWYgKGF4aXNSZXRyeSA8IDYwKSB7XG4gICAgICBheGlzUmV0cnkgKz0gMTtcbiAgICAgIHJlcXVlc3RBbmltYXRpb25GcmFtZSgoKSA9PiB7XG4gICAgICAgIHVwZGF0ZUF4aXNTaXplcygpO1xuICAgICAgICB1cGRhdGVCYWRnZVBvc2l0aW9uKCk7XG4gICAgICAgIHJlY2FsY1JlY3RzKCk7XG4gICAgICB9KTtcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgYXhpc1JldHJ5ID0gMDtcbiAgfVxufVxuLyoqIFRydWUgd2hlbiB0aGUgZXZlbnQgaXMgaW5zaWRlIHRoZSBkcmF3YWJsZSBjaGFydCBhcmVhIChub3Qgb24gYW4gYXhpcykuICovXG5mdW5jdGlvbiBpc0luQ2hhcnRBcmVhKGU6IE1vdXNlRXZlbnQpOiBib29sZWFuIHtcbiAgY29uc3QgYyA9IGNvbnRhaW5lclJlZi52YWx1ZTtcbiAgaWYgKCFjKSByZXR1cm4gZmFsc2U7XG4gIGNvbnN0IHIgPSBjLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuICBjb25zdCBseCA9IGUuY2xpZW50WCAtIHIubGVmdDtcbiAgY29uc3QgbHkgPSBlLmNsaWVudFkgLSByLnRvcDtcbiAgcmV0dXJuIGx4IDw9IGMuY2xpZW50V2lkdGggLSBheGlzUmlnaHRXLnZhbHVlICYmIGx5IDw9IGMuY2xpZW50SGVpZ2h0IC0gYXhpc0JvdHRvbUgudmFsdWU7XG59XG5cbmZ1bmN0aW9uIHJlY2FsY1JlY3RzKCk6IHZvaWQge1xuICBpZiAoIWFkYXB0ZXIpIHtcbiAgICByZWN0UGl4ZWxzLnZhbHVlID0gW107XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHJlY3RzID0gZHJhd2luZ3NTdG9yZS5nZXRGb3IobWFya2V0Lmluc3RydW1lbnQpO1xuICBjb25zdCBvdXQ6IFJlY3RQaXhlbFtdID0gW107XG5cbiAgY29uc3QgcHJvamVjdCA9ICh4MTogbnVtYmVyLCB5MTogbnVtYmVyLCB4MjogbnVtYmVyLCB5MjogbnVtYmVyKSA9PiAoe1xuICAgIGxlZnQ6IE1hdGgubWluKHgxLCB4MiksXG4gICAgdG9wOiBNYXRoLm1pbih5MSwgeTIpLFxuICAgIHdpZHRoOiBNYXRoLm1heCgxLCBNYXRoLmFicyh4MiAtIHgxKSksXG4gICAgaGVpZ2h0OiBNYXRoLm1heCgxLCBNYXRoLmFicyh5MiAtIHkxKSksXG4gIH0pO1xuXG4gIGZvciAoY29uc3QgcmVjdCBvZiByZWN0cykge1xuICAgIGNvbnN0IHgxID0gYWRhcHRlci50aW1lVG9YKHJlY3QudGltZTEpO1xuICAgIGNvbnN0IHkxID0gYWRhcHRlci5nZXRQcmljZVkocmVjdC5wcmljZTEpO1xuICAgIGNvbnN0IHgyID0gYWRhcHRlci50aW1lVG9YKHJlY3QudGltZTIpO1xuICAgIGNvbnN0IHkyID0gYWRhcHRlci5nZXRQcmljZVkocmVjdC5wcmljZTIpO1xuICAgIGlmICh4MSA9PT0gbnVsbCB8fCB5MSA9PT0gbnVsbCB8fCB4MiA9PT0gbnVsbCB8fCB5MiA9PT0gbnVsbCkgY29udGludWU7XG4gICAgb3V0LnB1c2goe1xuICAgICAgaWQ6IHJlY3QuaWQsXG4gICAgICAuLi5wcm9qZWN0KHgxLCB5MSwgeDIsIHkyKSxcbiAgICAgIGNvbG9yOiByZWN0LmNvbG9yLFxuICAgICAgb3BhY2l0eTogcmVjdC5vcGFjaXR5LFxuICAgICAgZmlsbGVkOiByZWN0LmZpbGxlZCAhPT0gZmFsc2UsXG4gICAgICBzZWxlY3RlZDogZHJhd2luZ3NTdG9yZS5zZWxlY3RlZElkID09PSByZWN0LmlkLFxuICAgIH0pO1xuICB9XG5cbiAgLy8gRHJhd2luZyBwcmV2aWV3XG4gIGlmIChkcmF3aW5nU3RhdGUudmFsdWUgJiYgYWRhcHRlciAmJiBkcmF3aW5nc1N0b3JlLmFjdGl2ZVRvb2wgPT09IFwicmVjdGFuZ2xlXCIpIHtcbiAgICBjb25zdCB4MSA9IGFkYXB0ZXIudGltZVRvWChkcmF3aW5nU3RhdGUudmFsdWUudGltZTEpO1xuICAgIGNvbnN0IHkxID0gYWRhcHRlci5nZXRQcmljZVkoZHJhd2luZ1N0YXRlLnZhbHVlLnByaWNlMSk7XG4gICAgY29uc3QgeDIgPSBhZGFwdGVyLnRpbWVUb1goZHJhd2luZ1N0YXRlLnZhbHVlLnRpbWUyKTtcbiAgICBjb25zdCB5MiA9IGFkYXB0ZXIuZ2V0UHJpY2VZKGRyYXdpbmdTdGF0ZS52YWx1ZS5wcmljZTIpO1xuICAgIGlmICh4MSAhPT0gbnVsbCAmJiB5MSAhPT0gbnVsbCAmJiB4MiAhPT0gbnVsbCAmJiB5MiAhPT0gbnVsbCkge1xuICAgICAgb3V0LnB1c2goe1xuICAgICAgICBpZDogXCJfX3ByZXZpZXdcIixcbiAgICAgICAgLi4ucHJvamVjdCh4MSwgeTEsIHgyLCB5MiksXG4gICAgICAgIGNvbG9yOiBcIiMyOTYyZmZcIixcbiAgICAgICAgb3BhY2l0eTogMC4xNSxcbiAgICAgICAgZmlsbGVkOiB0cnVlLFxuICAgICAgICBzZWxlY3RlZDogZmFsc2UsXG4gICAgICB9KTtcbiAgICB9XG4gIH1cblxuICByZWN0UGl4ZWxzLnZhbHVlID0gb3V0O1xuXG4gIC8vIFNlc3Npb25zIGluZGljYXRvciBiYWNrZ3JvdW5kIGJveGVzIChzYW1lIHRyaWdnZXJzIGFzIGRyYXdpbmdzKVxuICBjb21wdXRlU2Vzc2lvbkJveGVzKCk7XG5cbiAgLy8gVHJlbmRsaW5lczogZW5kcG9pbnRzIHByb2plY3QgZGlyZWN0bHkgKG5vIG1pbi9tYXgg4oCUIGEgbGluZSBrZWVwcyBpdHNcbiAgLy8gZHJhd24gZGlyZWN0aW9uOyB2ZXJ0aWNhbCBsaW5lcyB3aXRoIGVxdWFsIHRpbWVzIGFyZSB2YWxpZCkuXG4gIGNvbnN0IHRyZW5kc091dDogVHJlbmRQaXhlbFtdID0gW107XG4gIGZvciAoY29uc3QgbG4gb2YgZHJhd2luZ3NTdG9yZS5nZXRMaW5lc0ZvcihtYXJrZXQuaW5zdHJ1bWVudCkpIHtcbiAgICBjb25zdCB4MSA9IGFkYXB0ZXIudGltZVRvWChsbi50aW1lMSk7XG4gICAgY29uc3QgeTEgPSBhZGFwdGVyLmdldFByaWNlWShsbi5wcmljZTEpO1xuICAgIGNvbnN0IHgyID0gYWRhcHRlci50aW1lVG9YKGxuLnRpbWUyKTtcbiAgICBjb25zdCB5MiA9IGFkYXB0ZXIuZ2V0UHJpY2VZKGxuLnByaWNlMik7XG4gICAgaWYgKHgxID09PSBudWxsIHx8IHkxID09PSBudWxsIHx8IHgyID09PSBudWxsIHx8IHkyID09PSBudWxsKSBjb250aW51ZTtcbiAgICB0cmVuZHNPdXQucHVzaCh7XG4gICAgICBpZDogbG4uaWQsXG4gICAgICB4MSxcbiAgICAgIHkxLFxuICAgICAgeDIsXG4gICAgICB5MixcbiAgICAgIGNvbG9yOiBsbi5jb2xvcixcbiAgICAgIHdpZHRoOiBsbi53aWR0aCxcbiAgICAgIGRhc2g6IGxuLmRhc2gsXG4gICAgICBzZWxlY3RlZDogZHJhd2luZ3NTdG9yZS5zZWxlY3RlZExpbmVJZCA9PT0gbG4uaWQsXG4gICAgfSk7XG4gIH1cbiAgaWYgKGRyYXdpbmdTdGF0ZS52YWx1ZSAmJiBhZGFwdGVyICYmIGRyYXdpbmdzU3RvcmUuYWN0aXZlVG9vbCA9PT0gXCJ0cmVuZGxpbmVcIikge1xuICAgIGNvbnN0IHgxID0gYWRhcHRlci50aW1lVG9YKGRyYXdpbmdTdGF0ZS52YWx1ZS50aW1lMSk7XG4gICAgY29uc3QgeTEgPSBhZGFwdGVyLmdldFByaWNlWShkcmF3aW5nU3RhdGUudmFsdWUucHJpY2UxKTtcbiAgICBjb25zdCB4MiA9IGFkYXB0ZXIudGltZVRvWChkcmF3aW5nU3RhdGUudmFsdWUudGltZTIpO1xuICAgIGNvbnN0IHkyID0gYWRhcHRlci5nZXRQcmljZVkoZHJhd2luZ1N0YXRlLnZhbHVlLnByaWNlMik7XG4gICAgaWYgKHgxICE9PSBudWxsICYmIHkxICE9PSBudWxsICYmIHgyICE9PSBudWxsICYmIHkyICE9PSBudWxsKSB7XG4gICAgICB0cmVuZHNPdXQucHVzaCh7XG4gICAgICAgIGlkOiBcIl9fcHJldmlld1wiLFxuICAgICAgICB4MSxcbiAgICAgICAgeTEsXG4gICAgICAgIHgyLFxuICAgICAgICB5MixcbiAgICAgICAgY29sb3I6IFwiIzI5NjJmZlwiLFxuICAgICAgICB3aWR0aDogMixcbiAgICAgICAgZGFzaDogXCJzb2xpZFwiLFxuICAgICAgICBzZWxlY3RlZDogZmFsc2UsXG4gICAgICB9KTtcbiAgICB9XG4gIH1cbiAgdHJlbmRQaXhlbHMudmFsdWUgPSB0cmVuZHNPdXQ7XG5cbiAgLy8gUG9seWxpbmVzOiBlYWNoIHZlcnRleCBwcm9qZWN0cyBpbmRlcGVuZGVudGx5OyBza2lwIGEgcG9seSBpZiBhbnkgdmVydGV4XG4gIC8vIGlzIHVucHJvamVjdGFibGUgKGNoYXJ0IG5vdCBsYWlkIG91dCB5ZXQgLyBzeW1ib2wgbWlzbWF0Y2gpLlxuICBjb25zdCBwb2x5c091dDogUG9seVBpeGVsW10gPSBbXTtcbiAgY29uc3QgYWQgPSBhZGFwdGVyO1xuICBjb25zdCBwcm9qZWN0UHQgPSAocHQ6IHsgdGltZTogbnVtYmVyOyBwcmljZTogbnVtYmVyIH0pID0+IHtcbiAgICBjb25zdCB4ID0gYWQudGltZVRvWChwdC50aW1lKTtcbiAgICBjb25zdCB5ID0gYWQuZ2V0UHJpY2VZKHB0LnByaWNlKTtcbiAgICByZXR1cm4geCA9PT0gbnVsbCB8fCB5ID09PSBudWxsID8gbnVsbCA6IHsgeCwgeSB9O1xuICB9O1xuICAvKiogRG91Z2xhcy1QZXVja2VyIHNpbXBsaWZpY2F0aW9uIG9mIHRoZSBwcm9qZWN0ZWQgdmVydGljZXMgKGVuZHBvaW50cyBhbHdheXNcbiAqICBrZXB0KS4gQSBwb2x5bGluZSBkcmF3biBvbiBhIGZpbmUgdGltZWZyYW1lIGNhbiBjb2xsYXBzZSBpbnRvIGEgfjEtY2FuZGxlXG4gKiAgY29sdW1uIG9uIGEgY29hcnNlciBvbmUsIHdoZXJlIGl0cyBkZW5zZSB6aWd6YWcgcmVuZGVycyBhcyBhIGZhdCBibG9iIG92ZXJcbiAqICB0aGF0IGNhbmRsZTsgZHJvcHBpbmcgdmVydGljZXMgd2l0aGluIGBlcHNgIHB4IG9mIHRoZSBsb2NhbCBjaG9yZCByZW5kZXJzXG4gKiAgYSBjbGVhbiB0aGluIGxpbmUgaW5zdGVhZC4gU3RvcmFnZSBrZWVwcyBldmVyeSB2ZXJ0ZXguICovXG5mdW5jdGlvbiBzaW1wbGlmeVB0cyhcbiAgcHRzOiB7IHg6IG51bWJlcjsgeTogbnVtYmVyOyBzcmM6IG51bWJlciB9W10sXG4gIGVwczogbnVtYmVyXG4pOiB7IHg6IG51bWJlcjsgeTogbnVtYmVyOyBzcmM6IG51bWJlciB9W10ge1xuICBpZiAocHRzLmxlbmd0aCA8IDMpIHJldHVybiBwdHM7XG4gIGNvbnN0IGtlZXAgPSBuZXcgQXJyYXk8Ym9vbGVhbj4ocHRzLmxlbmd0aCkuZmlsbChmYWxzZSk7XG4gIGtlZXBbMF0gPSBrZWVwW3B0cy5sZW5ndGggLSAxXSA9IHRydWU7XG4gIGNvbnN0IHN0YWNrOiBBcnJheTxbbnVtYmVyLCBudW1iZXJdPiA9IFtbMCwgcHRzLmxlbmd0aCAtIDFdXTtcbiAgd2hpbGUgKHN0YWNrLmxlbmd0aCkge1xuICAgIGNvbnN0IFtzLCBlXSA9IHN0YWNrLnBvcCgpITtcbiAgICBjb25zdCBBID0gcHRzW3NdITtcbiAgICBjb25zdCBCID0gcHRzW2VdITtcbiAgICBjb25zdCBkeCA9IEIueCAtIEEueDtcbiAgICBjb25zdCBkeSA9IEIueSAtIEEueTtcbiAgICBjb25zdCBsZW4gPSBNYXRoLmh5cG90KGR4LCBkeSkgfHwgMWUtOTtcbiAgICBsZXQgbWF4RCA9IDA7XG4gICAgbGV0IGlkeCA9IC0xO1xuICAgIGZvciAobGV0IGkgPSBzICsgMTsgaSA8IGU7IGkrKykge1xuICAgICAgY29uc3QgZCA9IE1hdGguYWJzKGR5ICogKHB0c1tpXSEueCAtIEEueCkgLSBkeCAqIChwdHNbaV0hLnkgLSBBLnkpKSAvIGxlbjtcbiAgICAgIGlmIChkID4gbWF4RCkge1xuICAgICAgICBtYXhEID0gZDtcbiAgICAgICAgaWR4ID0gaTtcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKG1heEQgPiBlcHMgJiYgaWR4ID4gMCkge1xuICAgICAga2VlcFtpZHhdID0gdHJ1ZTtcbiAgICAgIHN0YWNrLnB1c2goW3MsIGlkeF0sIFtpZHgsIGVdKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHB0cy5maWx0ZXIoKF8sIGkpID0+IGtlZXBbaV0pO1xufVxuXG4gIC8qKiBXaXRoaW4gZWFjaCB+b25lLWNhbmRsZS13aWRlIGNsdXN0ZXIgb2YgY29sbGFwc2VkIHZlcnRpY2VzIGtlZXAgb25seSB0aGVcbiAqICBib3VuZGFyeSBhbmQgZXh0cmVtZSBwb2ludHMgKGZpcnN0IC8gbGFzdCAvIGhpZ2hlc3QgLyBsb3dlc3QpLCBzbyBhXG4gKiAgZmluZS10aW1lZnJhbWUgcG9seWxpbmUgc3F1ZWV6ZWQgb250byBhIGNvYXJzZSBjYW5kbGUgcmVuZGVycyBhcyBhIHNtYWxsXG4gKiAgY2xlYW4gemlnemFnIGluc3RlYWQgb2YgYSBmYXQgYmxvYiBvdmVyIHRoYXQgY2FuZGxlLiAqL1xuZnVuY3Rpb24gcmVkdWNlUGVyQ2x1c3RlcihcbiAgcHRzOiB7IHg6IG51bWJlcjsgeTogbnVtYmVyOyBzcmM6IG51bWJlciB9W10sXG4gIGNsdXN0ZXJQeCA9IDVcbik6IHsgeDogbnVtYmVyOyB5OiBudW1iZXI7IHNyYzogbnVtYmVyIH1bXSB7XG4gIGlmIChwdHMubGVuZ3RoIDwgMykgcmV0dXJuIHB0cztcbiAgY29uc3Qgb3V0OiB7IHg6IG51bWJlcjsgeTogbnVtYmVyOyBzcmM6IG51bWJlciB9W10gPSBbXTtcbiAgbGV0IGkgPSAwO1xuICB3aGlsZSAoaSA8IHB0cy5sZW5ndGgpIHtcbiAgICBsZXQgaiA9IGk7XG4gICAgd2hpbGUgKGogKyAxIDwgcHRzLmxlbmd0aCAmJiBNYXRoLmFicyhwdHNbaiArIDFdIS54IC0gcHRzW2ldIS54KSA8PSBjbHVzdGVyUHgpIGorKztcbiAgICBjb25zdCBncm91cCA9IHB0cy5zbGljZShpLCBqICsgMSk7XG4gICAgaWYgKGdyb3VwLmxlbmd0aCA8PSA0KSB7XG4gICAgICBvdXQucHVzaCguLi5ncm91cCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGxldCBtYXhZID0gZ3JvdXBbMF0hO1xuICAgICAgbGV0IG1pblkgPSBncm91cFswXSE7XG4gICAgICBmb3IgKGNvbnN0IHAgb2YgZ3JvdXApIHtcbiAgICAgICAgaWYgKHAueSA+IG1heFkueSkgbWF4WSA9IHA7XG4gICAgICAgIGlmIChwLnkgPCBtaW5ZLnkpIG1pblkgPSBwO1xuICAgICAgfVxuICAgICAgY29uc3Qga2VlcCA9IG5ldyBTZXQoW2dyb3VwWzBdIS5zcmMsIGdyb3VwW2dyb3VwLmxlbmd0aCAtIDFdIS5zcmMsIG1heFkuc3JjLCBtaW5ZLnNyY10pO1xuICAgICAgb3V0LnB1c2goLi4uZ3JvdXAuZmlsdGVyKChwKSA9PiBrZWVwLmhhcyhwLnNyYykpKTtcbiAgICB9XG4gICAgaSA9IGogKyAxO1xuICB9XG4gIHJldHVybiBvdXQ7XG59XG5cbmNvbnN0IGJ1aWxkUG9seVBpeGVsID0gKFxuICAgIGlkOiBzdHJpbmcsXG4gICAgcHRzOiB7IHg6IG51bWJlcjsgeTogbnVtYmVyOyBzcmM6IG51bWJlciB9W10sXG4gICAgY29sb3I6IHN0cmluZyxcbiAgICB3aWR0aDogbnVtYmVyLFxuICAgIGRhc2g6IERhc2hTdHlsZSxcbiAgICBhcnJvdzogYm9vbGVhbixcbiAgICBzZWxlY3RlZDogYm9vbGVhblxuICApOiBQb2x5UGl4ZWwgPT4ge1xuICAgIGxldCBhcnJvd1RyaTogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gICAgaWYgKGFycm93ICYmIHB0cy5sZW5ndGggPj0gMikge1xuICAgICAgY29uc3QgdGlwID0gcHRzW3B0cy5sZW5ndGggLSAxXSE7XG4gICAgICBjb25zdCBwcmV2ID0gcHRzW3B0cy5sZW5ndGggLSAyXSE7XG4gICAgICBjb25zdCBhbmcgPSBNYXRoLmF0YW4yKHRpcC55IC0gcHJldi55LCB0aXAueCAtIHByZXYueCk7XG4gICAgICBjb25zdCBzaXplID0gMTI7XG4gICAgICBjb25zdCBwMSA9IHsgeDogdGlwLnggKyBzaXplICogTWF0aC5jb3MoYW5nICsgTWF0aC5QSSAtIDAuNDUpLCB5OiB0aXAueSArIHNpemUgKiBNYXRoLnNpbihhbmcgKyBNYXRoLlBJIC0gMC40NSkgfTtcbiAgICAgIGNvbnN0IHAyID0geyB4OiB0aXAueCArIHNpemUgKiBNYXRoLmNvcyhhbmcgKyBNYXRoLlBJICsgMC40NSksIHk6IHRpcC55ICsgc2l6ZSAqIE1hdGguc2luKGFuZyArIE1hdGguUEkgKyAwLjQ1KSB9O1xuICAgICAgYXJyb3dUcmkgPSBgJHt0aXAueH0sJHt0aXAueX0gJHtwMS54fSwke3AxLnl9ICR7cDIueH0sJHtwMi55fWA7XG4gICAgfVxuICAgIHJldHVybiB7IGlkLCBwdHMsIGNvbG9yLCB3aWR0aCwgZGFzaCwgYXJyb3dUcmksIHNlbGVjdGVkIH07XG4gIH07XG4gIGZvciAoY29uc3QgcGwgb2YgZHJhd2luZ3NTdG9yZS5nZXRQb2x5c0ZvcihtYXJrZXQuaW5zdHJ1bWVudCkpIHtcbiAgICBjb25zdCBwdHM6IHsgeDogbnVtYmVyOyB5OiBudW1iZXI7IHNyYzogbnVtYmVyIH1bXSA9IFtdO1xuICAgIGxldCBvayA9IHRydWU7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBwbC5wb2ludHMubGVuZ3RoOyBpKyspIHtcbiAgICAgIGNvbnN0IHAgPSBwcm9qZWN0UHQocGwucG9pbnRzW2ldISk7XG4gICAgICBpZiAoIXApIHsgb2sgPSBmYWxzZTsgYnJlYWs7IH1cbiAgICAgIHB0cy5wdXNoKHsgLi4ucCwgc3JjOiBpIH0pO1xuICAgIH1cbiAgICBpZiAoIW9rIHx8IHB0cy5sZW5ndGggPCAyKSBjb250aW51ZTtcbiAgICAvLyBWZXJ0aWNlcyBkcmF3biBvbiBhIGZpbmUgdGltZWZyYW1lIGNhbiBjb2xsYXBzZSBpbnRvIGEgfjEtY2FuZGxlLXdpZGVcbiAgICAvLyBjb2x1bW4gb24gYSBjb2Fyc2VyIG9uZSDigJQgdGhlIGRlbnNlIHppZ3phZyAod2l0aCByb3VuZCBqb2lucykgdGhlblxuICAgIC8vIHJlbmRlcnMgYXMgYSBmYXQgYmxvYiBvdmVyIHRoYXQgY2FuZGxlLiBDb2xsYXBzZSB2ZXJ0aWNlcyB0aGF0IHByb2plY3RcbiAgICAvLyB3aXRoaW4gYSBjb3VwbGUgb2YgcGl4ZWxzIG9mIGVhY2ggb3RoZXIgc28gdGhlIGNvYXJzZSB2aWV3IHNob3dzIGFcbiAgICAvLyBjbGVhbiB0aGluIGxpbmUgaW5zdGVhZC4gU3RvcmFnZSBrZWVwcyBldmVyeSB2ZXJ0ZXguXG4gICAgY29uc3Qgc2ltcGxpZmllZCA9IHJlZHVjZVBlckNsdXN0ZXIoc2ltcGxpZnlQdHMocHRzLCAzKSk7XG4gICAgaWYgKHNpbXBsaWZpZWQubGVuZ3RoIDwgMikgY29udGludWU7XG4gICAgcG9seXNPdXQucHVzaChidWlsZFBvbHlQaXhlbChwbC5pZCwgc2ltcGxpZmllZCwgcGwuY29sb3IsIHBsLndpZHRoLCBwbC5kYXNoLCBwbC5hcnJvdywgZHJhd2luZ3NTdG9yZS5zZWxlY3RlZFBvbHlJZCA9PT0gcGwuaWQpKTtcbiAgfVxuICAvLyBMaXZlIHBvbHlsaW5lIHByZXZpZXc6IGNvbmZpcm1lZCB2ZXJ0aWNlcyArIHRoZSBjdXJzb3IgcG9zaXRpb25cbiAgaWYgKHBvbHlTdGF0ZS52YWx1ZSAmJiBhZGFwdGVyICYmIGRyYXdpbmdzU3RvcmUuYWN0aXZlVG9vbCA9PT0gXCJwb2x5bGluZVwiKSB7XG4gICAgY29uc3QgcHRzOiB7IHg6IG51bWJlcjsgeTogbnVtYmVyOyBzcmM6IG51bWJlciB9W10gPSBbXTtcbiAgICBsZXQgb2sgPSB0cnVlO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcG9seVN0YXRlLnZhbHVlLnBvaW50cy5sZW5ndGg7IGkrKykge1xuICAgICAgY29uc3QgcCA9IHByb2plY3RQdChwb2x5U3RhdGUudmFsdWUucG9pbnRzW2ldISk7XG4gICAgICBpZiAoIXApIHsgb2sgPSBmYWxzZTsgYnJlYWs7IH1cbiAgICAgIHB0cy5wdXNoKHsgLi4ucCwgc3JjOiBpIH0pO1xuICAgIH1cbiAgICBjb25zdCBjdXIgPSBwb2x5U3RhdGUudmFsdWUuY3Vyc29yID8gcHJvamVjdFB0KHBvbHlTdGF0ZS52YWx1ZS5jdXJzb3IpIDogbnVsbDtcbiAgICBpZiAob2sgJiYgY3VyKSBwdHMucHVzaCh7IC4uLmN1ciwgc3JjOiBwdHMubGVuZ3RoIH0pO1xuICAgIGlmIChvayAmJiBjdXIgJiYgcHRzLmxlbmd0aCA+PSAyKSB7XG4gICAgICBwb2x5c091dC5wdXNoKGJ1aWxkUG9seVBpeGVsKFwiX19wcmV2aWV3XCIsIHB0cywgXCIjMjk2MmZmXCIsIDIsIFwic29saWRcIiwgZmFsc2UsIGZhbHNlKSk7XG4gICAgfVxuICB9XG4gIHBvbHlQaXhlbHMudmFsdWUgPSBwb2x5c091dDtcblxuICAvLyBMb25nL1Nob3J0IHBvc2l0aW9uc1xuICBjb25zdCBwb3NPdXQ6IFBvc2l0aW9uUGl4ZWxbXSA9IFtdO1xuICBjb25zdCBwcmVjaXNpb24gPSBpbnN0cnVtZW50UHJlY2lzaW9uKG1hcmtldC5pbnN0cnVtZW50KTtcbiAgY29uc3QgcGlwU2l6ZSA9IGluc3RydW1lbnRQaXBTaXplKG1hcmtldC5pbnN0cnVtZW50KTtcbiAgY29uc3QgYnVpbGRQb3NQaXhlbCA9IChcbiAgICBwczoge1xuICAgICAgaWQ6IHN0cmluZztcbiAgICAgIGRpcmVjdGlvbjogXCJsb25nXCIgfCBcInNob3J0XCI7XG4gICAgICB0aW1lMTogbnVtYmVyO1xuICAgICAgdGltZTI6IG51bWJlcjtcbiAgICAgIGVudHJ5OiBudW1iZXI7XG4gICAgICBzbDogbnVtYmVyO1xuICAgICAgdHA6IG51bWJlcjtcbiAgICAgIHNob3dMZXZlbHM6IGJvb2xlYW47XG4gICAgICBzZWxlY3RlZDogYm9vbGVhbjtcbiAgICAgIHByZXZpZXc6IGJvb2xlYW47XG4gICAgfVxuICApOiBQb3NpdGlvblBpeGVsIHwgbnVsbCA9PiB7XG4gICAgY29uc3QgeDEgPSBhZC50aW1lVG9YKHBzLnRpbWUxKTtcbiAgICBjb25zdCB4MiA9IGFkLnRpbWVUb1gocHMudGltZTIpO1xuICAgIGNvbnN0IGVudHJ5WSA9IGFkLmdldFByaWNlWShwcy5lbnRyeSk7XG4gICAgY29uc3Qgc2xZID0gYWQuZ2V0UHJpY2VZKHBzLnNsKTtcbiAgICBjb25zdCB0cFkgPSBhZC5nZXRQcmljZVkocHMudHApO1xuICAgIGlmICh4MSA9PT0gbnVsbCB8fCB4MiA9PT0gbnVsbCB8fCBlbnRyeVkgPT09IG51bGwgfHwgc2xZID09PSBudWxsIHx8IHRwWSA9PT0gbnVsbCkgcmV0dXJuIG51bGw7XG4gICAgY29uc3QgbG9uZyA9IHBzLmRpcmVjdGlvbiAhPT0gXCJzaG9ydFwiO1xuICAgIGNvbnN0IHJpc2sgPSBNYXRoLmFicyhwcy5lbnRyeSAtIHBzLnNsKTtcbiAgICBjb25zdCByciA9IHJpc2sgPiAwID8gTWF0aC5hYnMocHMudHAgLSBwcy5lbnRyeSkgLyByaXNrIDogMDtcbiAgICAvLyAxUi4uTlIgcmV3YXJkIGxpbmVzIGJldHdlZW4gZW50cnkgYW5kIFRQIChOID0gZmxvb3IoUjpSKSlcbiAgICBjb25zdCBsZXZlbHM6IFBvc0xldmVsW10gPSBbXTtcbiAgICBpZiAocHMuc2hvd0xldmVscykge1xuICAgICAgY29uc3QgZGlyID0gbG9uZyA/IDEgOiAtMTtcbiAgICAgIGZvciAobGV0IGsgPSAxOyBrIDw9IE1hdGguZmxvb3IocnIpOyBrKyspIHtcbiAgICAgICAgY29uc3QgeSA9IGFkLmdldFByaWNlWShwcy5lbnRyeSArIGRpciAqIGsgKiByaXNrKTtcbiAgICAgICAgaWYgKHkgIT09IG51bGwpIGxldmVscy5wdXNoKHsgeSwgcjogayB9KTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHtcbiAgICAgIGlkOiBwcy5pZCxcbiAgICAgIGRpcmVjdGlvbjogcHMuZGlyZWN0aW9uLFxuICAgICAgbGVmdDogTWF0aC5taW4oeDEsIHgyKSxcbiAgICAgIHdpZHRoOiBNYXRoLm1heCgxLCBNYXRoLmFicyh4MiAtIHgxKSksXG4gICAgICBlbnRyeVksXG4gICAgICBzbFksXG4gICAgICB0cFksXG4gICAgICBwcm9maXRUb3A6IGxvbmcgPyB0cFkgOiBlbnRyeVksXG4gICAgICBwcm9maXRIOiBNYXRoLm1heCgxLCBNYXRoLmFicyhlbnRyeVkgLSB0cFkpKSxcbiAgICAgIGxvc3NUb3A6IGxvbmcgPyBlbnRyeVkgOiBzbFksXG4gICAgICBsb3NzSDogTWF0aC5tYXgoMSwgTWF0aC5hYnMoc2xZIC0gZW50cnlZKSksXG4gICAgICBycixcbiAgICAgIHNsUGN0OiAoKGxvbmcgPyBwcy5zbCAtIHBzLmVudHJ5IDogcHMuZW50cnkgLSBwcy5zbCkgLyBwcy5lbnRyeSkgKiAxMDAsXG4gICAgICB0cFBjdDogKChsb25nID8gcHMudHAgLSBwcy5lbnRyeSA6IHBzLmVudHJ5IC0gcHMudHApIC8gcHMuZW50cnkpICogMTAwLFxuICAgICAgc2xQaXBzOiByaXNrIC8gcGlwU2l6ZSxcbiAgICAgIHRwUGlwczogTWF0aC5hYnMocHMudHAgLSBwcy5lbnRyeSkgLyBwaXBTaXplLFxuICAgICAgcHJlY2lzaW9uLFxuICAgICAgbGV2ZWxzLFxuICAgICAgc2VsZWN0ZWQ6IHBzLnNlbGVjdGVkLFxuICAgICAgcHJldmlldzogcHMucHJldmlldyxcbiAgICB9O1xuICB9O1xuICBmb3IgKGNvbnN0IHBzIG9mIGRyYXdpbmdzU3RvcmUuZ2V0UG9zaXRpb25zRm9yKG1hcmtldC5pbnN0cnVtZW50KSkge1xuICAgIGNvbnN0IHB4ID0gYnVpbGRQb3NQaXhlbCh7IC4uLnBzLCBzZWxlY3RlZDogZHJhd2luZ3NTdG9yZS5zZWxlY3RlZFBvc2l0aW9uSWQgPT09IHBzLmlkLCBwcmV2aWV3OiBmYWxzZSB9KTtcbiAgICBpZiAocHgpIHBvc091dC5wdXNoKHB4KTtcbiAgfVxuICAvLyBMaXZlIHR3by1jbGljayBwcmV2aWV3OiBlbnRyeSBpcyBzZXQsIHRoZSBjdXJzb3IgaXMgdGhlIFNMIOKAlCB0aGUgcHJvZml0XG4gIC8vIHNpZGUgZ2V0cyBhIGxpZ2h0IGdyZWVuIGJveCBhdCAyUiwgdGhlIFNMIHNpZGUgYSBsaWdodCByZWQgb25lLlxuICBpZiAocG9zU3RhdGUudmFsdWUgJiYgcG9zQ3Vyc29yLnZhbHVlICYmIGRyYXdpbmdzU3RvcmUuYWN0aXZlVG9vbCA9PT0gXCJwb3NpdGlvblwiKSB7XG4gICAgY29uc3QgbG9uZyA9IHBvc0N1cnNvci52YWx1ZS5wcmljZSA8IHBvc1N0YXRlLnZhbHVlLmVudHJ5O1xuICAgIGNvbnN0IHJpc2sgPSBNYXRoLmFicyhwb3NTdGF0ZS52YWx1ZS5lbnRyeSAtIHBvc0N1cnNvci52YWx1ZS5wcmljZSk7XG4gICAgY29uc3QgcHggPSBidWlsZFBvc1BpeGVsKHtcbiAgICAgIGlkOiBcIl9fcG9zcHJldmlld1wiLFxuICAgICAgZGlyZWN0aW9uOiBsb25nID8gXCJsb25nXCIgOiBcInNob3J0XCIsXG4gICAgICB0aW1lMTogcG9zU3RhdGUudmFsdWUudGltZTEsXG4gICAgICB0aW1lMjogcG9zQ3Vyc29yLnZhbHVlLnRpbWUsXG4gICAgICBlbnRyeTogcG9zU3RhdGUudmFsdWUuZW50cnksXG4gICAgICBzbDogcG9zQ3Vyc29yLnZhbHVlLnByaWNlLFxuICAgICAgdHA6IHBvc1N0YXRlLnZhbHVlLmVudHJ5ICsgKGxvbmcgPyAxIDogLTEpICogMyAqIHJpc2ssIC8vIGRlZmF1bHQgUjpSIDE6M1xuICAgICAgc2hvd0xldmVsczogZmFsc2UsXG4gICAgICBzZWxlY3RlZDogZmFsc2UsXG4gICAgICBwcmV2aWV3OiB0cnVlLFxuICAgIH0pO1xuICAgIGlmIChweCkgcG9zT3V0LnB1c2gocHgpO1xuICB9XG4gIHBvc1BpeGVscy52YWx1ZSA9IHBvc091dDtcblxuICAvLyBPbmUtY2xpY2sgbGluZXMgKGhsaW5lIC8gaHJheSAvIHZsaW5lKVxuICBjb25zdCBzZWwxID0gZHJhd2luZ3NTdG9yZS5zZWxlY3RlZFNpbmdsZTtcbiAgY29uc3Qgc2luZ2xlT3V0OiBTaW5nbGVQaXhlbFtdID0gW107XG4gIGNvbnN0IGNoYXJ0VzEgPSBhZCA/IGNvbnRhaW5lclJlZi52YWx1ZSEuY2xpZW50V2lkdGggLSBheGlzUmlnaHRXLnZhbHVlIDogMDtcbiAgY29uc3QgY2hhcnRIMSA9IGFkID8gY29udGFpbmVyUmVmLnZhbHVlIS5jbGllbnRIZWlnaHQgLSBheGlzQm90dG9tSC52YWx1ZSA6IDA7XG4gIGZvciAoY29uc3Qga2luZCBvZiBbXCJobGluZVwiLCBcImhyYXlcIiwgXCJ2bGluZVwiXSBhcyBTaW5nbGVLaW5kW10pIHtcbiAgICBmb3IgKGNvbnN0IGl0IG9mIGRyYXdpbmdzU3RvcmUuZ2V0U2luZ2xlcyhraW5kLCBtYXJrZXQuaW5zdHJ1bWVudCkpIHtcbiAgICAgIGNvbnN0IHNlbGVjdGVkID0gc2VsMT8ua2luZCA9PT0ga2luZCAmJiBzZWwxLmlkID09PSBpdC5pZDtcbiAgICAgIGlmIChraW5kID09PSBcInZsaW5lXCIpIHtcbiAgICAgICAgY29uc3QgeCA9IGFkLnRpbWVUb1goKGl0IGFzIERyYXdpbmdWTGluZSkudGltZSk7XG4gICAgICAgIGlmICh4ID09PSBudWxsKSBjb250aW51ZTtcbiAgICAgICAgc2luZ2xlT3V0LnB1c2goeyBpZDogaXQuaWQsIGtpbmQsIHgsIHk6IDAsIGh4OiB4LCBoeTogY2hhcnRIMSAvIDIsIHRpbWU6IChpdCBhcyBEcmF3aW5nVkxpbmUpLnRpbWUsIHByaWNlOiAwLCBjb2xvcjogaXQuY29sb3IsIGRhc2g6IGl0LmRhc2gsIHdpZHRoOiBpdC53aWR0aCwgc2VsZWN0ZWQgfSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb25zdCB5ID0gYWQuZ2V0UHJpY2VZKChpdCBhcyBEcmF3aW5nSExpbmUpLnByaWNlKTtcbiAgICAgICAgaWYgKHkgPT09IG51bGwpIGNvbnRpbnVlO1xuICAgICAgICBjb25zdCB0ID0ga2luZCA9PT0gXCJocmF5XCIgPyAoaXQgYXMgRHJhd2luZ0hSYXkpLnRpbWUgOiAwO1xuICAgICAgICBjb25zdCB4ID0ga2luZCA9PT0gXCJocmF5XCIgPyAoYWQudGltZVRvWCh0KSA/PyAwKSA6IGNoYXJ0VzEgLyAyO1xuICAgICAgICBzaW5nbGVPdXQucHVzaCh7IGlkOiBpdC5pZCwga2luZCwgeCwgeSwgaHg6IHgsIGh5OiB5LCB0aW1lOiB0LCBwcmljZTogKGl0IGFzIERyYXdpbmdITGluZSkucHJpY2UsIGNvbG9yOiBpdC5jb2xvciwgZGFzaDogaXQuZGFzaCwgd2lkdGg6IGl0LndpZHRoLCBzZWxlY3RlZCB9KTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgc2luZ2xlUGl4ZWxzLnZhbHVlID0gc2luZ2xlT3V0O1xuXG4gIHJlYnVpbGREZW1vTGluZXMoKTtcbiAgLy8gVmlzaWJsZSBjaGFydCBoZWlnaHQgZm9yIHRoZSBkZW1vIHRhZyB2aXNpYmlsaXR5IGNoZWNrXG4gIGlmIChjb250YWluZXJSZWYudmFsdWUpIHtcbiAgICBkZW1vQ2hhcnRILnZhbHVlID0gY29udGFpbmVyUmVmLnZhbHVlLmNsaWVudEhlaWdodCAtIGF4aXNCb3R0b21ILnZhbHVlO1xuICB9XG5cbiAgLy8gUmVwbGF5IHZlcnRpY2FsIGxpbmUgcG9zaXRpb25cbiAgY29uc3QgcmVwbGF5VCA9IHJlcGxheS5waWNraW5nID8gcGlja1RpbWUudmFsdWUgOiByZXBsYXkuY3V0b2ZmO1xuICByZXBsYXlWbFgudmFsdWUgPSByZXBsYXkuYWN0aXZlICYmIHJlcGxheVQgIT09IG51bGwgPyAoYWQudGltZVRvWChyZXBsYXlUKSA/PyBudWxsKSA6IG51bGw7XG5cbiAgLy8gUmVwbGF5IHByaWNlIHRhZzogdGhlIGNsb3NlIG9mIHRoZSBsYXN0IHZpc2libGUgY2FuZGxlLCByZW5kZXJlZCBvbiB0aGVcbiAgLy8gcHJpY2Ugc2NhbGUgZGlyZWN0bHkgVU5ERVIgdGhlIGxpdmUgcHJpY2UgbGFiZWwgKHRoZSBzZXJpZXMgZW5kcyB0aGVyZSxcbiAgLy8gc28gTFdDJ3Mgb3duIGxhYmVsIHNpdHMgYXQgdGhlIHNhbWUgcHJpY2UpLlxuICBpZiAocmVwbGF5LmFjdGl2ZSAmJiAhcmVwbGF5LnBpY2tpbmcgJiYgZGlzcGxheUNhbmRsZXMudmFsdWUubGVuZ3RoKSB7XG4gICAgY29uc3QgbGFzdEMgPSBkaXNwbGF5Q2FuZGxlcy52YWx1ZVtkaXNwbGF5Q2FuZGxlcy52YWx1ZS5sZW5ndGggLSAxXSE7XG4gICAgY29uc3QgeSA9IGFkLmdldFByaWNlWShsYXN0Qy5jbG9zZSk7XG4gICAgY29uc3QgbGggPSBhZGFwdGVyLmdldFByaWNlTGFiZWxIZWlnaHQoKTtcbiAgICByZXBsYXlUYWcudmFsdWUgPSB5ICE9PSBudWxsID8geyB5OiB5ICsgbGggLyAyICsgMSwgdGV4dDogbGFzdEMuY2xvc2UudG9GaXhlZChpbnN0cnVtZW50UHJlY2lzaW9uKG1hcmtldC5pbnN0cnVtZW50KSkgfSA6IG51bGw7XG4gIH0gZWxzZSB7XG4gICAgcmVwbGF5VGFnLnZhbHVlID0gbnVsbDtcbiAgfVxuXG4gIC8vIEtlZXAgdGhlIG9wZW4gZWRpdCBwYW5lbCBhbmNob3JlZCB0byBpdHMgcmVjdGFuZ2xlIHRocm91Z2ggcGFuL3pvb20gYW5kXG4gIC8vIGNoYXJ0IHJlc2l6ZXMgKHdhdGNobGlzdCB0b2dnbGUsIHdpbmRvdyByZXNpemUpIOKAlCB0aGUgcmVjdGFuZ2xlJ3MgcGl4ZWxzXG4gIC8vIGNoYW5nZWQgdW5kZXIgaXQsIHNvIHRoZSBwYW5lbCB3b3VsZCBvdGhlcndpc2Ugc2l0IGF0IHN0YWxlIGNvb3JkaW5hdGVzLlxuICBpZiAoc2VsZWN0ZWRSZWN0LnZhbHVlICYmIGVkaXRQYW5lbFBvcy52YWx1ZSkgcG9zaXRpb25FZGl0UGFuZWwoc2VsZWN0ZWRSZWN0LnZhbHVlLmlkKTtcbiAgaWYgKHNlbGVjdGVkTGluZS52YWx1ZSAmJiBsaW5lUGFuZWxQb3MudmFsdWUpIHBvc2l0aW9uTGluZVBhbmVsKHNlbGVjdGVkTGluZS52YWx1ZS5pZCk7XG4gIGlmIChzZWxlY3RlZFBvbHkudmFsdWUgJiYgcG9seVBhbmVsUG9zLnZhbHVlKSBwb3NpdGlvblBvbHlQYW5lbChzZWxlY3RlZFBvbHkudmFsdWUuaWQpO1xuICBpZiAoc2VsZWN0ZWRQb3MudmFsdWUgJiYgcG9zUGFuZWxQb3MudmFsdWUpIHBvc2l0aW9uUG9zUGFuZWwoc2VsZWN0ZWRQb3MudmFsdWUuaWQpO1xuICBjb25zdCBzZWxTID0gZHJhd2luZ3NTdG9yZS5zZWxlY3RlZFNpbmdsZTtcbiAgaWYgKHNlbFMgJiYgc2luZ2xlUGFuZWxQb3MudmFsdWUpIHBvc2l0aW9uU2luZ2xlUGFuZWwoc2VsUy5raW5kLCBzZWxTLmlkKTtcbn1cblxuLyoqXG4gKiBSZS1wcm9qZWN0cyBvdmVybGF5cyBvbiBldmVyeSBhbmltYXRpb24gZnJhbWUgd2hpbGUgdGhlIHBvaW50ZXIgaXMgaGVsZFxuICogKHBhbiBkcmFnLCBwcmljZS1heGlzIHNjYWxlIGRyYWcpIG9yIGZvciBhIHNob3J0IHNldHRsZSB3aW5kb3cgYWZ0ZXIgZGF0YVxuICogY2hhbmdlcyDigJQgdGhlIGNhbnZhcyByZS1yZW5kZXJzIG9uIHJBRiwgc28gZXZlbnQtZHJpdmVuIHJlLXByb2plY3Rpb25cbiAqIGFsb25lIHRyYWlscyB0aGUgcmVuZGVyIGJ5IGEgZnJhbWUgYW5kIGRyYXdpbmdzIHZpc2libHkgbGFnIHRoZSBjaGFydFxuICogZHVyaW5nIHByaWNlLXNjYWxlIHJlZml0cyBhbmQgdGltZWZyYW1lIHN3aXRjaGVzLlxuICovXG5mdW5jdGlvbiByZWNhbGNGcmFtZSgpOiB2b2lkIHtcbiAgcmVjYWxjUmFmID0gMDtcbiAgdXBkYXRlQmFkZ2VQb3NpdGlvbigpO1xuICByZWNhbGNSZWN0cygpO1xuICAvLyBBZnRlciBhIGZyZXNoIGxvYWQgdGhlIGNoYXJ0IGxheW91dCAodGltZS9wcmljZSBzY2FsZXMpIG1heSBub3QgYmVcbiAgLy8gc2V0dGxlZCB3aGVuIHRoZSBmaXJzdCByZS1wcm9qZWN0aW9uIHJ1bnMg4oCUIHNvbWUgZHJhd2luZ3MgdGhlbiBmYWlsIHRvXG4gIC8vIHByb2plY3QgKG51bGwgY29vcmRpbmF0ZXMpIGFuZCB3b3VsZCBvbmx5IHJlbmRlciBvbiB0aGUgTkVYVCB1bnJlbGF0ZWRcbiAgLy8gZXZlbnQgKHdpdGggbm8gbGl2ZSB0aWNrcywgdGhhdCBjYW4gdGFrZSBzZWNvbmRzKS4gS2VlcCByZS1wcm9qZWN0aW5nXG4gIC8vIGV2ZXJ5IGZyYW1lIHVudGlsIGV2ZXJ5IHN0b3JlZCBkcmF3aW5nIGhhcyBsYW5kZWQsIGJvdW5kZWQgYnkgYSBzZXR0bGVcbiAgLy8gd2luZG93IHNvIGEgZ2VudWluZWx5IHVucHJvamVjdGFibGUgZHJhd2luZyBjYW4ndCBsb29wIGZvcmV2ZXIuXG4gIGlmIChoYXNVbnByb2plY3RlZERyYXdpbmdzKCkgJiYgcGVyZm9ybWFuY2Uubm93KCkgPCBsb2FkU2V0dGxlRGVhZGxpbmUpIHtcbiAgICByZWNhbGNEZWFkbGluZSA9IE1hdGgubWF4KHJlY2FsY0RlYWRsaW5lLCBwZXJmb3JtYW5jZS5ub3coKSArIDYwKTtcbiAgfVxuICBpZiAocG9pbnRlckhlbGQgfHwgcGVyZm9ybWFuY2Uubm93KCkgPCByZWNhbGNEZWFkbGluZSkge1xuICAgIHJlY2FsY1JhZiA9IHJlcXVlc3RBbmltYXRpb25GcmFtZShyZWNhbGNGcmFtZSk7XG4gIH1cbn1cblxuLyoqIFRydWUgd2hlbiBmZXdlciBkcmF3aW5ncyBhcmUgcmVuZGVyZWQgdGhhbiBzdG9yZWQg4oCUIGkuZS4gYXQgbGVhc3Qgb25lXG4gKiAgZmFpbGVkIHRvIHByb2plY3Qgb24gdGhlIGxhc3QgcGFzcy4gKi9cbmZ1bmN0aW9uIGhhc1VucHJvamVjdGVkRHJhd2luZ3MoKTogYm9vbGVhbiB7XG4gIGNvbnN0IHN0b3JlZCA9XG4gICAgZHJhd2luZ3NTdG9yZS5nZXRGb3IobWFya2V0Lmluc3RydW1lbnQpLmxlbmd0aCArXG4gICAgZHJhd2luZ3NTdG9yZS5nZXRMaW5lc0ZvcihtYXJrZXQuaW5zdHJ1bWVudCkubGVuZ3RoICtcbiAgICBkcmF3aW5nc1N0b3JlLmdldFBvbHlzRm9yKG1hcmtldC5pbnN0cnVtZW50KS5sZW5ndGggK1xuICAgIGRyYXdpbmdzU3RvcmUuZ2V0UG9zaXRpb25zRm9yKG1hcmtldC5pbnN0cnVtZW50KS5sZW5ndGggK1xuICAgIGRyYXdpbmdzU3RvcmUuZ2V0U2luZ2xlcyhcImhsaW5lXCIsIG1hcmtldC5pbnN0cnVtZW50KS5sZW5ndGggK1xuICAgIGRyYXdpbmdzU3RvcmUuZ2V0U2luZ2xlcyhcImhyYXlcIiwgbWFya2V0Lmluc3RydW1lbnQpLmxlbmd0aCArXG4gICAgZHJhd2luZ3NTdG9yZS5nZXRTaW5nbGVzKFwidmxpbmVcIiwgbWFya2V0Lmluc3RydW1lbnQpLmxlbmd0aDtcbiAgaWYgKHN0b3JlZCA9PT0gMCkgcmV0dXJuIGZhbHNlO1xuICBjb25zdCByZW5kZXJlZCA9XG4gICAgcmVjdFBpeGVscy52YWx1ZS5maWx0ZXIoKHIpID0+IHIuaWQgIT09IFwiX19wcmV2aWV3XCIpLmxlbmd0aCArXG4gICAgdHJlbmRQaXhlbHMudmFsdWUuZmlsdGVyKCh0KSA9PiB0LmlkICE9PSBcIl9fcHJldmlld1wiKS5sZW5ndGggK1xuICAgIHBvbHlQaXhlbHMudmFsdWUuZmlsdGVyKChwKSA9PiBwLmlkICE9PSBcIl9fcHJldmlld1wiKS5sZW5ndGggK1xuICAgIHBvc1BpeGVscy52YWx1ZS5maWx0ZXIoKHApID0+IHAuaWQgIT09IFwiX19wb3NwcmV2aWV3XCIpLmxlbmd0aCArXG4gICAgc2luZ2xlUGl4ZWxzLnZhbHVlLmxlbmd0aDtcbiAgcmV0dXJuIHJlbmRlcmVkIDwgc3RvcmVkO1xufVxuXG5mdW5jdGlvbiBleHRlbmRSZWNhbGNGcmFtZXMobXM6IG51bWJlcik6IHZvaWQge1xuICByZWNhbGNEZWFkbGluZSA9IE1hdGgubWF4KHJlY2FsY0RlYWRsaW5lLCBwZXJmb3JtYW5jZS5ub3coKSArIG1zKTtcbiAgaWYgKCFyZWNhbGNSYWYpIHJlY2FsY1JhZiA9IHJlcXVlc3RBbmltYXRpb25GcmFtZShyZWNhbGNGcmFtZSk7XG59XG5cbi8qKiBCZWdpbiBhIHJlY3RhbmdsZTogY29ybmVyIDEgYXQgdGhlIHBvaW50ZXIsIHByZXZpZXcgZm9sbG93cyB0aGUgbW91c2UuICovXG5mdW5jdGlvbiBiZWdpbkRyYXcoZTogTW91c2VFdmVudCk6IHZvaWQge1xuICBpZiAoIWFkYXB0ZXIgfHwgIWNvbnRhaW5lclJlZi52YWx1ZSkgcmV0dXJuO1xuICBjb25zdCBjcmVjdCA9IGNvbnRhaW5lclJlZi52YWx1ZS5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgY29uc3QgeCA9IGUuY2xpZW50WCAtIGNyZWN0LmxlZnQ7XG4gIGNvbnN0IHkgPSBlLmNsaWVudFkgLSBjcmVjdC50b3A7XG5cbiAgY29uc3QgdGltZSA9IGFkYXB0ZXIueFRvVGltZSh4KTtcbiAgY29uc3QgcHJpY2UgPSBhZGFwdGVyLnlUb1ByaWNlKHkpO1xuICBpZiAodGltZSA9PT0gbnVsbCB8fCBwcmljZSA9PT0gbnVsbCkgcmV0dXJuO1xuXG4gIC8vIENUUkw6IHNuYXAgdGhlIGFuY2hvciB0byB0aGUgaGlnaC9sb3cgb2YgdGhlIG5lYXJlc3QgY2FuZGxlXG4gIGNvbnN0IHMxID0gc25hcFRvQ2FuZGxlKHRpbWUsIHByaWNlLCBtYWduZXRBY3RpdmUudmFsdWUpO1xuICBkcmF3aW5nU3RhdGUudmFsdWUgPSB7IHRpbWUxOiBzMS50aW1lLCBwcmljZTE6IHMxLnByaWNlLCB0aW1lMjogczEudGltZSwgcHJpY2UyOiBzMS5wcmljZSB9O1xuICBjb25zdCBzdGFydFggPSBlLmNsaWVudFg7XG4gIGNvbnN0IHN0YXJ0WSA9IGUuY2xpZW50WTtcbiAgcmVjYWxjUmVjdHMoKTtcblxuICAvLyBQcmV2aWV3IGZvbGxvd3MgdGhlIG1vdXNlIHVudGlsIHRoZSByZWN0YW5nbGUgaXMgZmluYWxpemVkXG4gIGNvbnN0IG1vdmUgPSAoZXY6IE1vdXNlRXZlbnQpID0+IHtcbiAgICBpZiAoIWRyYXdpbmdTdGF0ZS52YWx1ZSB8fCAhYWRhcHRlciB8fCAhY29udGFpbmVyUmVmLnZhbHVlKSByZXR1cm47XG4gICAgY29uc3QgciA9IGNvbnRhaW5lclJlZi52YWx1ZS5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgICBjb25zdCBteCA9IGV2LmNsaWVudFggLSByLmxlZnQ7XG4gICAgY29uc3QgbXkgPSBldi5jbGllbnRZIC0gci50b3A7XG4gICAgY29uc3QgdCA9IGFkYXB0ZXIueFRvVGltZShteCk7XG4gICAgY29uc3QgcCA9IGFkYXB0ZXIueVRvUHJpY2UobXkpO1xuICAgIGlmICh0ICE9PSBudWxsICYmIHAgIT09IG51bGwpIHtcbiAgICAgIC8vIENUUkw6IHNuYXAgdGhlIGZyZWUgZW5kIHRvIHRoZSBuZWFyZXN0IGNhbmRsZSBoaWdoL2xvd1xuICAgICAgY29uc3QgczIgPSBzbmFwVG9DYW5kbGUodCwgcCwgbWFnbmV0QWN0aXZlLnZhbHVlKTtcbiAgICAgIGRyYXdpbmdTdGF0ZS52YWx1ZS50aW1lMiA9IHMyLnRpbWU7XG4gICAgICBkcmF3aW5nU3RhdGUudmFsdWUucHJpY2UyID0gczIucHJpY2U7XG4gICAgfVxuICAgIHJlY2FsY1JlY3RzKCk7XG4gIH07XG5cbiAgZnVuY3Rpb24gc3RvcE1vdmUoKTogdm9pZCB7XG4gICAgd2luZG93LnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJwb2ludGVybW92ZVwiLCBtb3ZlKTtcbiAgICBpZiAob25Nb3VzZU1vdmVSZWYgPT09IG1vdmUpIG9uTW91c2VNb3ZlUmVmID0gbnVsbDtcbiAgfVxuXG4gIGNvbnN0IHVwID0gKGV2OiBNb3VzZUV2ZW50KSA9PiB7XG4gICAgd2luZG93LnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJwb2ludGVydXBcIiwgdXApO1xuICAgIC8vIFByZXNzLWRyYWctcmVsZWFzZSBmaW5hbGl6ZXMgaW1tZWRpYXRlbHkuIENsaWNrLW1vdmUtY2xpY2sga2VlcHMgdGhlXG4gICAgLy8gcHJldmlldyBhbGl2ZTsgdGhlIG5leHQgbGVmdC1wcmVzcyAoY2FwdHVyZSBoYW5kbGVyKSBmaW5hbGl6ZXMuXG4gICAgaWYgKE1hdGguaHlwb3QoZXYuY2xpZW50WCAtIHN0YXJ0WCwgZXYuY2xpZW50WSAtIHN0YXJ0WSkgPiA0KSB7XG4gICAgICBzdG9wTW92ZSgpO1xuICAgICAgZmluYWxpemVEcmF3KCk7XG4gICAgfVxuICB9O1xuXG4gIHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKFwicG9pbnRlcm1vdmVcIiwgbW92ZSk7XG4gIHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKFwicG9pbnRlcnVwXCIsIHVwKTtcbiAgb25Nb3VzZU1vdmVSZWYgPSBtb3ZlO1xufVxuXG4vKiogU3RvcmUgdGhlIHByZXZpZXcgYXMgYSByZWFsIGRyYXdpbmcgYW5kIHN3aXRjaCBiYWNrIHRvIHRoZSBjdXJzb3IgdG9vbC4gKi9cbmZ1bmN0aW9uIGZpbmFsaXplRHJhdygpOiB2b2lkIHtcbiAgY29uc3QgZCA9IGRyYXdpbmdTdGF0ZS52YWx1ZTtcbiAgZHJhd2luZ1N0YXRlLnZhbHVlID0gbnVsbDtcbiAgaWYgKG9uTW91c2VNb3ZlUmVmKSB7XG4gICAgd2luZG93LnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJwb2ludGVybW92ZVwiLCBvbk1vdXNlTW92ZVJlZik7XG4gICAgb25Nb3VzZU1vdmVSZWYgPSBudWxsO1xuICB9XG4gIGlmIChkICYmIChNYXRoLmFicyhkLnRpbWUyIC0gZC50aW1lMSkgPj0gMSB8fCBNYXRoLmFicyhkLnByaWNlMiAtIGQucHJpY2UxKSA+IDApKSB7XG4gICAgaWYgKGRyYXdpbmdzU3RvcmUuYWN0aXZlVG9vbCA9PT0gXCJ0cmVuZGxpbmVcIikge1xuICAgICAgLy8gRW5kcG9pbnRzIHN0YXkgYXMgZHJhd24gKG5vIG1pbi9tYXgpIOKAlCBkaXJlY3Rpb24gaXMgcHJlc2VydmVkXG4gICAgICBkcmF3aW5nc1N0b3JlLmFkZExpbmUobWFya2V0Lmluc3RydW1lbnQsIHtcbiAgICAgICAgdGltZTE6IGQudGltZTEsXG4gICAgICAgIHByaWNlMTogZC5wcmljZTEsXG4gICAgICAgIHRpbWUyOiBkLnRpbWUyLFxuICAgICAgICBwcmljZTI6IGQucHJpY2UyLFxuICAgICAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGRyYXdpbmdzU3RvcmUuYWRkKG1hcmtldC5pbnN0cnVtZW50LCB7XG4gICAgICAgIHRpbWUxOiBNYXRoLm1pbihkLnRpbWUxLCBkLnRpbWUyKSxcbiAgICAgICAgcHJpY2UxOiBNYXRoLm1pbihkLnByaWNlMSwgZC5wcmljZTIpLFxuICAgICAgICB0aW1lMjogTWF0aC5tYXgoZC50aW1lMSwgZC50aW1lMiksXG4gICAgICAgIHByaWNlMjogTWF0aC5tYXgoZC5wcmljZTEsIGQucHJpY2UyKSxcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuICBkcmF3aW5nc1N0b3JlLmFjdGl2ZVRvb2wgPSBcImN1cnNvclwiO1xuICByZWNhbGNSZWN0cygpO1xufVxuXG4vKiogQWJvcnQgYW4gaW4tcHJvZ3Jlc3MgZHJhd2luZyAocmlnaHQtY2xpY2ssIEVzY2FwZSwgdG9vbCBzd2l0Y2gpLiAqL1xuZnVuY3Rpb24gY2FuY2VsRHJhdygpOiB2b2lkIHtcbiAgY29uc3QgaGFkID0gZHJhd2luZ1N0YXRlLnZhbHVlICE9PSBudWxsIHx8IHBvbHlTdGF0ZS52YWx1ZSAhPT0gbnVsbCB8fCBwb3NTdGF0ZS52YWx1ZSAhPT0gbnVsbDtcbiAgZHJhd2luZ1N0YXRlLnZhbHVlID0gbnVsbDtcbiAgcG9seVN0YXRlLnZhbHVlID0gbnVsbDtcbiAgcG9zU3RhdGUudmFsdWUgPSBudWxsO1xuICBwb3NDdXJzb3IudmFsdWUgPSBudWxsO1xuICBzdG9wUG9zQ3Vyc29yKCk7XG4gIHN0b3BQb2x5UHJldmlldygpO1xuICBpZiAob25Nb3VzZU1vdmVSZWYpIHtcbiAgICB3aW5kb3cucmVtb3ZlRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJtb3ZlXCIsIG9uTW91c2VNb3ZlUmVmKTtcbiAgICBvbk1vdXNlTW92ZVJlZiA9IG51bGw7XG4gIH1cbiAgaWYgKGhhZCkgcmVjYWxjUmVjdHMoKTtcbn1cblxuLyoqIExpdmUgcHJldmlldyBsaXN0ZW5lciBmb3IgdGhlIGluLXByb2dyZXNzIHBvbHlsaW5lOiB0cmFja3MgdGhlIGN1cnNvclxuICogIChtYWduZXQtc25hcHBlZCwgc28gdGhlIHJ1YmJlciBiYW5kIHN0aWNrcyB0byBjYW5kbGUgaGlnaC9sb3cgdG9vKS4gKi9cbmZ1bmN0aW9uIHN0YXJ0UG9seVByZXZpZXcoKTogdm9pZCB7XG4gIHN0b3BQb2x5UHJldmlldygpO1xuICBjb25zdCBtb3ZlID0gKGV2OiBNb3VzZUV2ZW50KSA9PiB7XG4gICAgaWYgKCFwb2x5U3RhdGUudmFsdWUgfHwgIWFkYXB0ZXIgfHwgIWNvbnRhaW5lclJlZi52YWx1ZSkgcmV0dXJuO1xuICAgIGNvbnN0IHIgPSBjb250YWluZXJSZWYudmFsdWUuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gICAgY29uc3QgdCA9IGFkYXB0ZXIueFRvVGltZShldi5jbGllbnRYIC0gci5sZWZ0KTtcbiAgICBjb25zdCBwID0gYWRhcHRlci55VG9QcmljZShldi5jbGllbnRZIC0gci50b3ApO1xuICAgIGlmICh0ICE9PSBudWxsICYmIHAgIT09IG51bGwpIHtcbiAgICAgIGNvbnN0IHMgPSBzbmFwVG9DYW5kbGUodCwgcCwgbWFnbmV0QWN0aXZlLnZhbHVlKTtcbiAgICAgIHBvbHlTdGF0ZS52YWx1ZS5jdXJzb3IgPSB7IHRpbWU6IHMudGltZSwgcHJpY2U6IHMucHJpY2UgfTtcbiAgICB9XG4gICAgcmVjYWxjUmVjdHMoKTtcbiAgfTtcbiAgd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoXCJwb2ludGVybW92ZVwiLCBtb3ZlKTtcbiAgb25Qb2x5TW92ZVJlZiA9IG1vdmU7XG59XG5cbmZ1bmN0aW9uIHN0b3BQb2x5UHJldmlldygpOiB2b2lkIHtcbiAgaWYgKG9uUG9seU1vdmVSZWYpIHtcbiAgICB3aW5kb3cucmVtb3ZlRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJtb3ZlXCIsIG9uUG9seU1vdmVSZWYpO1xuICAgIG9uUG9seU1vdmVSZWYgPSBudWxsO1xuICB9XG59XG5cbi8qKiBPbmUgbGVmdC1jbGljayBvZiB0aGUgcG9seWxpbmUgdG9vbDogc3RhcnQsIG9yIGFkZCBhIHZlcnRleC4gRmluaXNoaW5nXG4gKiAgaGFwcGVucyBvbiB0aGUgbmF0aXZlIGRvdWJsZS1jbGljayAoc2VlIHRoZSBkYmxjbGljayBsaXN0ZW5lciBpblxuICogIG9uTW91bnRlZCkuIENsaWNrcyB0aGF0IGxhbmQgb24gdGhlIHNhbWUgc3BvdCBhZGQgbm8gZHVwbGljYXRlIHZlcnRleC4gKi9cbmZ1bmN0aW9uIGhhbmRsZVBvbHlDbGljayhlOiBNb3VzZUV2ZW50KTogdm9pZCB7XG4gIGlmICghYWRhcHRlciB8fCAhY29udGFpbmVyUmVmLnZhbHVlKSByZXR1cm47XG4gIGNvbnN0IHIgPSBjb250YWluZXJSZWYudmFsdWUuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gIGNvbnN0IHQgPSBhZGFwdGVyLnhUb1RpbWUoZS5jbGllbnRYIC0gci5sZWZ0KTtcbiAgY29uc3QgcCA9IGFkYXB0ZXIueVRvUHJpY2UoZS5jbGllbnRZIC0gci50b3ApO1xuICBpZiAodCA9PT0gbnVsbCB8fCBwID09PSBudWxsKSByZXR1cm47XG4gIGNvbnN0IHMgPSBzbmFwVG9DYW5kbGUodCwgcCwgbWFnbmV0QWN0aXZlLnZhbHVlKTtcbiAgY29uc3QgcHQgPSB7IHRpbWU6IHMudGltZSwgcHJpY2U6IHMucHJpY2UgfTtcblxuICBpZiAoIXBvbHlTdGF0ZS52YWx1ZSkge1xuICAgIHBvbHlTdGF0ZS52YWx1ZSA9IHsgcG9pbnRzOiBbcHRdLCBjdXJzb3I6IHB0IH07XG4gICAgbGFzdFBvbHlDbGlja0F0ID0geyB4OiBlLmNsaWVudFgsIHk6IGUuY2xpZW50WSwgYXQ6IHBlcmZvcm1hbmNlLm5vdygpIH07XG4gICAgc3RhcnRQb2x5UHJldmlldygpO1xuICAgIHJlY2FsY1JlY3RzKCk7XG4gICAgcmV0dXJuO1xuICB9XG4gIC8vIFNhbWUtc3BvdCBjbGljayAodGhlIHNlY29uZCBwcmVzcyBvZiBhIGRvdWJsZS1jbGljaykg4oaSIGZpbmFsaXplLiBUaGVcbiAgLy8gbmF0aXZlIGRibGNsaWNrIGV2ZW50IGlzIHVucmVsaWFibGUgb24gdG91Y2ggKGRvdWJsZS1UQVAgb2Z0ZW4gZG9lc24ndFxuICAvLyBwcm9kdWNlIG9uZSksIHNvIGEgc2FtZS1zcG90IHByZXNzIHdpdGhpbiA0MDBtcyBmaW5pc2hlcyB0aGUgcG9seWxpbmUgb25cbiAgLy8gZGVza3RvcCBBTkQgdG91Y2g7IHRoZSBuYXRpdmUgZGJsY2xpY2sgaGFuZGxlciB0aGVuIGJlY29tZXMgYSBuby1vcC5cbiAgaWYgKGxhc3RQb2x5Q2xpY2tBdCAmJiBNYXRoLmh5cG90KGUuY2xpZW50WCAtIGxhc3RQb2x5Q2xpY2tBdC54LCBlLmNsaWVudFkgLSBsYXN0UG9seUNsaWNrQXQueSkgPCA2KSB7XG4gICAgaWYgKHBlcmZvcm1hbmNlLm5vdygpIC0gbGFzdFBvbHlDbGlja0F0LmF0IDwgNDAwKSB7XG4gICAgICBmaW5hbGl6ZVBvbHkoKTtcbiAgICB9XG4gICAgcmV0dXJuO1xuICB9XG4gIGxhc3RQb2x5Q2xpY2tBdCA9IHsgeDogZS5jbGllbnRYLCB5OiBlLmNsaWVudFksIGF0OiBwZXJmb3JtYW5jZS5ub3coKSB9O1xuICBwb2x5U3RhdGUudmFsdWUucG9pbnRzLnB1c2gocHQpO1xuICBwb2x5U3RhdGUudmFsdWUuY3Vyc29yID0gcHQ7XG4gIHJlY2FsY1JlY3RzKCk7XG59XG5cbi8qKiBTdG9yZSB0aGUgZmluaXNoZWQgcG9seWxpbmUgYW5kIHN3aXRjaCBiYWNrIHRvIHRoZSBjdXJzb3IgdG9vbC4gKi9cbmZ1bmN0aW9uIGZpbmFsaXplUG9seSgpOiB2b2lkIHtcbiAgY29uc3Qgc3QgPSBwb2x5U3RhdGUudmFsdWU7XG4gIHBvbHlTdGF0ZS52YWx1ZSA9IG51bGw7XG4gIHN0b3BQb2x5UHJldmlldygpO1xuICBpZiAoc3QgJiYgc3QucG9pbnRzLmxlbmd0aCA+PSAyKSB7XG4gICAgZHJhd2luZ3NTdG9yZS5hZGRQb2x5KG1hcmtldC5pbnN0cnVtZW50LCB7IHBvaW50czogc3QucG9pbnRzIH0pO1xuICB9XG4gIGRyYXdpbmdzU3RvcmUuYWN0aXZlVG9vbCA9IFwiY3Vyc29yXCI7XG4gIHJlY2FsY1JlY3RzKCk7XG59XG5cbmxldCBvbk1vdXNlTW92ZVJlZjogKChldjogTW91c2VFdmVudCkgPT4gdm9pZCkgfCBudWxsID0gbnVsbDtcblxuZnVuY3Rpb24gb25SZWN0Q2xpY2soaWQ6IHN0cmluZywgZTogTW91c2VFdmVudCk6IHZvaWQge1xuICBlLnN0b3BQcm9wYWdhdGlvbigpO1xuICByZWN0TWVudS52YWx1ZSA9IG51bGw7XG4gIGNsb3NlUGFsZXR0ZSgpO1xuICBjbGVhclNpbmdsZVNlbGVjdGlvbigpO1xuICAvLyBBdXRvLXN3aXRjaCB0byBjdXJzb3Igd2hlbiBzZWxlY3RpbmdcbiAgaWYgKGRyYXdpbmdzU3RvcmUuYWN0aXZlVG9vbCAhPT0gXCJjdXJzb3JcIikge1xuICAgIGRyYXdpbmdzU3RvcmUuYWN0aXZlVG9vbCA9IFwiY3Vyc29yXCI7XG4gIH1cbiAgZHJhd2luZ3NTdG9yZS5zZWxlY3RlZElkID0gaWQ7XG4gIHNlbGVjdGVkUmVjdC52YWx1ZSA9IGRyYXdpbmdzU3RvcmUuZ2V0Rm9yKG1hcmtldC5pbnN0cnVtZW50KS5maW5kKChyKSA9PiByLmlkID09PSBpZCkgPz8gbnVsbDtcbiAgcmVjYWxjUmVjdHMoKTtcbiAgcG9zaXRpb25FZGl0UGFuZWwoaWQpO1xufVxuXG4vKiogUGxhY2VzIHRoZSBmbG9hdGluZyBlZGl0IHBhbmVsIGp1c3QgQUJPVkUgdGhlIHJlY3RhbmdsZSdzIHRvcC1yaWdodCBjb3JuZXJcbiAqICAoVHJhZGluZ1ZpZXctc3R5bGUpIHNvIHRoZSByZXNpemUgaGFuZGxlcyBzdGF5IHZpc2libGUgYW5kIGV2ZW4gYSB0aW55XG4gKiAgcmVjdCBpc24ndCBjb3ZlcmVkOyBmbGlwcyBiZWxvdyB3aGVuIHRoZXJlJ3Mgbm8gcm9vbSBhYm92ZS4gKi9cbmZ1bmN0aW9uIHBvc2l0aW9uRWRpdFBhbmVsKGlkOiBzdHJpbmcpOiB2b2lkIHtcbiAgY29uc3QgcGl4ZWwgPSByZWN0UGl4ZWxzLnZhbHVlLmZpbmQoKHIpID0+IHIuaWQgPT09IGlkKTtcbiAgY29uc3QgcGFuZSA9IGNvbnRhaW5lclJlZi52YWx1ZTtcbiAgaWYgKCFwaXhlbCB8fCAhcGFuZSkgcmV0dXJuO1xuICBlZGl0UGFuZWxQb3MudmFsdWUgPSBjb21wdXRlUGFuZWxQb3MocGl4ZWwsIHBhbmUpO1xuICAvLyBGaXJzdCBvcGVuOiB0aGUgcGFuZWwgZWxlbWVudCBpc24ndCBtb3VudGVkIHlldCwgc28gdGhlIHBvc2l0aW9uIGFib3ZlXG4gIC8vIHVzZWQgdGhlIGZhbGxiYWNrIHNpemUuIFJlLW1lYXN1cmUgYXMgc29vbiBhcyBpdCBtb3VudHMgKG5leHRUaWNrIHJ1bnNcbiAgLy8gYmVmb3JlIHRoZSBicm93c2VyIHBhaW50cywgc28gdGhlIHBhbmVsIG5ldmVyIGFwcGVhcnMgbWlzcGxhY2VkIGFuZFxuICAvLyBkb2Vzbid0IGp1bXAgYSBtb21lbnQgbGF0ZXIpLlxuICBpZiAoIWVkaXRQYW5lbEVsLnZhbHVlKSB7XG4gICAgdm9pZCBuZXh0VGljaygoKSA9PiB7XG4gICAgICBjb25zdCBzZWwgPSBzZWxlY3RlZFJlY3QudmFsdWU7XG4gICAgICBpZiAoIWVkaXRQYW5lbEVsLnZhbHVlIHx8ICFzZWwgfHwgIWNvbnRhaW5lclJlZi52YWx1ZSkgcmV0dXJuO1xuICAgICAgY29uc3QgcHggPSByZWN0UGl4ZWxzLnZhbHVlLmZpbmQoKHIpID0+IHIuaWQgPT09IHNlbC5pZCk7XG4gICAgICBpZiAocHgpIGVkaXRQYW5lbFBvcy52YWx1ZSA9IGNvbXB1dGVQYW5lbFBvcyhweCwgY29udGFpbmVyUmVmLnZhbHVlKTtcbiAgICB9KTtcbiAgfVxufVxuXG5mdW5jdGlvbiBjb21wdXRlUGFuZWxQb3MocGl4ZWw6IFJlY3RQaXhlbCwgcGFuZTogSFRNTEVsZW1lbnQpOiB7IHg6IG51bWJlcjsgeTogbnVtYmVyIH0ge1xuICBjb25zdCB3ID0gZWRpdFBhbmVsRWwudmFsdWU/Lm9mZnNldFdpZHRoIHx8IFBBTkVMX1c7XG4gIGNvbnN0IGggPSBlZGl0UGFuZWxFbC52YWx1ZT8ub2Zmc2V0SGVpZ2h0IHx8IFBBTkVMX0g7XG4gIGNvbnN0IGdhcCA9IDg7XG4gIC8vIFJpZ2h0IGVkZ2VzIGFsaWduZWQgd2l0aCB0aGUgcmVjdGFuZ2xlLCA4cHggYWJvdmUgaXRzIHRvcCBlZGdlXG4gIGxldCB4ID0gcGl4ZWwubGVmdCArIHBpeGVsLndpZHRoIC0gdztcbiAgbGV0IHkgPSBwaXhlbC50b3AgLSBoIC0gZ2FwO1xuICBpZiAoeSA8IDQpIHkgPSBwaXhlbC50b3AgKyBwaXhlbC5oZWlnaHQgKyBnYXA7IC8vIGZsaXAgYmVsb3cgdGhlIHJlY3RcbiAgLy8gU2FmZXR5IGNsYW1wOiBmdWxseSBpbnNpZGUgdGhlIHBhbmUgb24gYm90aCBheGVzLlxuICB4ID0gTWF0aC5taW4oTWF0aC5tYXgoNCwgeCksIE1hdGgubWF4KDQsIHBhbmUuY2xpZW50V2lkdGggLSB3IC0gNikpO1xuICB5ID0gTWF0aC5taW4oTWF0aC5tYXgoNCwgeSksIE1hdGgubWF4KDQsIHBhbmUuY2xpZW50SGVpZ2h0IC0gaCAtIDYpKTtcbiAgcmV0dXJuIHsgeCwgeSB9O1xufVxuXG4vKiogRHJhZyB0aGUgd2hvbGUgcmVjdGFuZ2xlIHRvIG1vdmUgaXQgKFRyYWRpbmdWaWV3LXN0eWxlIGJvZHkgZHJhZykuICovXG5mdW5jdGlvbiBvblJlY3REcmFnU3RhcnQoZTogTW91c2VFdmVudCwgaWQ6IHN0cmluZyk6IHZvaWQge1xuICBpZiAoZS5idXR0b24gIT09IDAgfHwgZHJhd2luZ3NTdG9yZS5hY3RpdmVUb29sICE9PSBcImN1cnNvclwiKSByZXR1cm47XG4gIGlmICghYWRhcHRlciB8fCAhY29udGFpbmVyUmVmLnZhbHVlKSByZXR1cm47XG4gIGNvbnN0IHJlY3QgPSBkcmF3aW5nc1N0b3JlLmdldEZvcihtYXJrZXQuaW5zdHJ1bWVudCkuZmluZCgocikgPT4gci5pZCA9PT0gaWQpO1xuICBpZiAoIXJlY3QpIHJldHVybjtcbiAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICBlLnN0b3BQcm9wYWdhdGlvbigpO1xuICByZWN0TWVudS52YWx1ZSA9IG51bGw7XG4gIGNsb3NlUGFsZXR0ZSgpO1xuICBjbGVhclNpbmdsZVNlbGVjdGlvbigpO1xuXG4gIC8vIEVER0UgR1VBUkQ6IHRoZSByZXNpemUgaGFuZGxlcyBhcmUgdGlueSAoOHB4KS4gQSBwcmVzcyBhaW1lZCBhdCBhICAvLyBsZWZ0L3JpZ2h0IGhhbmRsZSB0aGF0IG1pc3NlcyBieSBhIGZldyBwaXhlbHMgd291bGQgb3RoZXJ3aXNlIGxhbmQgb24gdGhlXG4gIC8vIGJvZHkgYW5kIERSQUcgdGhlIHdob2xlIHJlY3RhbmdsZSB0byB0aGUgY3Vyc29yLiBJZiB0aGUgcmVjdCBpcyBhbHJlYWR5XG4gIC8vIHNlbGVjdGVkIGFuZCB0aGUgcHJlc3MgaXMgd2l0aGluIHRoZSBlZGdlIHpvbmUsIHJlc2l6ZSBpbnN0ZWFkIG9mIG1vdmUuXG4gIGNvbnN0IHJHdWFyZCA9IGNvbnRhaW5lclJlZi52YWx1ZS5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgY29uc3QgcHggPSBlLmNsaWVudFggLSByR3VhcmQubGVmdDtcbiAgY29uc3QgcHkgPSBlLmNsaWVudFkgLSByR3VhcmQudG9wO1xuICBjb25zdCBwaXhlbCA9IHJlY3RQaXhlbHMudmFsdWUuZmluZCgocikgPT4gci5pZCA9PT0gaWQpO1xuICBpZiAocGl4ZWw/LnNlbGVjdGVkKSB7XG4gICAgY29uc3QgbmVhciA9IDk7IC8vIGhhbmRsZSBoaXQgcmFkaXVzICg4cHggaGFuZGxlICsgMXB4IHNsYWNrKVxuICAgIGNvbnN0IHdpdGhpblkgPSBweSA+PSBwaXhlbC50b3AgLSBuZWFyICYmIHB5IDw9IHBpeGVsLnRvcCArIHBpeGVsLmhlaWdodCArIG5lYXI7XG4gICAgaWYgKHdpdGhpblkgJiYgTWF0aC5hYnMocHggLSBwaXhlbC5sZWZ0KSA8PSBuZWFyKSB7XG4gICAgICBvblJlc2l6ZVN0YXJ0KGUsIFwid1wiKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKHdpdGhpblkgJiYgTWF0aC5hYnMocHggLSAocGl4ZWwubGVmdCArIHBpeGVsLndpZHRoKSkgPD0gbmVhcikge1xuICAgICAgb25SZXNpemVTdGFydChlLCBcImVcIik7XG4gICAgICByZXR1cm47XG4gICAgfVxuICB9XG5cbiAgLy8gU2VsZWN0IG9uIHByZXNzIHNvIHRoZSBoYW5kbGVzICsgZWRpdCBwYW5lbCBhcHBlYXIgaW1tZWRpYXRlbHlcbiAgZHJhd2luZ3NTdG9yZS5zZWxlY3RlZElkID0gaWQ7XG4gIHNlbGVjdGVkUmVjdC52YWx1ZSA9IHJlY3Q7XG4gIHJlY2FsY1JlY3RzKCk7XG4gIHBvc2l0aW9uRWRpdFBhbmVsKGlkKTtcblxuICBjb25zdCByMCA9IGNvbnRhaW5lclJlZi52YWx1ZS5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgY29uc3Qgc3RhcnRUID0gYWRhcHRlci54VG9UaW1lKGUuY2xpZW50WCAtIHIwLmxlZnQpO1xuICBjb25zdCBzdGFydFAgPSBhZGFwdGVyLnlUb1ByaWNlKGUuY2xpZW50WSAtIHIwLnRvcCk7XG4gIGlmIChzdGFydFQgPT09IG51bGwgfHwgc3RhcnRQID09PSBudWxsKSByZXR1cm47XG4gIGNvbnN0IG9yaWcgPSB7IHRpbWUxOiByZWN0LnRpbWUxLCBwcmljZTE6IHJlY3QucHJpY2UxLCB0aW1lMjogcmVjdC50aW1lMiwgcHJpY2UyOiByZWN0LnByaWNlMiB9O1xuXG4gIGNvbnN0IG9uTW92ZSA9IChldjogTW91c2VFdmVudCkgPT4ge1xuICAgIGlmICghYWRhcHRlciB8fCAhY29udGFpbmVyUmVmLnZhbHVlKSByZXR1cm47XG4gICAgY29uc3QgciA9IGNvbnRhaW5lclJlZi52YWx1ZS5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgICBjb25zdCB0ID0gYWRhcHRlci54VG9UaW1lKGV2LmNsaWVudFggLSByLmxlZnQpO1xuICAgIGNvbnN0IHAgPSBhZGFwdGVyLnlUb1ByaWNlKGV2LmNsaWVudFkgLSByLnRvcCk7XG4gICAgaWYgKHQgPT09IG51bGwgfHwgcCA9PT0gbnVsbCkgcmV0dXJuO1xuICAgIGNvbnN0IGR0ID0gdCAtIHN0YXJ0VDtcbiAgICBjb25zdCBkcCA9IHAgLSBzdGFydFA7XG4gICAgZHJhd2luZ3NTdG9yZS51cGRhdGVSZWN0KG1hcmtldC5pbnN0cnVtZW50LCBpZCwge1xuICAgICAgdGltZTE6IG9yaWcudGltZTEgKyBkdCxcbiAgICAgIHRpbWUyOiBvcmlnLnRpbWUyICsgZHQsXG4gICAgICBwcmljZTE6IG9yaWcucHJpY2UxICsgZHAsXG4gICAgICBwcmljZTI6IG9yaWcucHJpY2UyICsgZHAsXG4gICAgfSk7XG4gICAgY29uc3QgdXBkYXRlZCA9IGRyYXdpbmdzU3RvcmUuZ2V0Rm9yKG1hcmtldC5pbnN0cnVtZW50KS5maW5kKCh4KSA9PiB4LmlkID09PSBpZCk7XG4gICAgaWYgKHVwZGF0ZWQpIHNlbGVjdGVkUmVjdC52YWx1ZSA9IHVwZGF0ZWQ7XG4gICAgcmVjYWxjUmVjdHMoKTtcbiAgICBwb3NpdGlvbkVkaXRQYW5lbChpZCk7XG4gIH07XG5cbiAgY29uc3Qgb25VcCA9ICgpID0+IHtcbiAgICB3aW5kb3cucmVtb3ZlRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJtb3ZlXCIsIG9uTW92ZSk7XG4gICAgd2luZG93LnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJwb2ludGVydXBcIiwgb25VcCk7XG4gIH07XG4gIHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKFwicG9pbnRlcm1vdmVcIiwgb25Nb3ZlKTtcbiAgd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoXCJwb2ludGVydXBcIiwgb25VcCk7XG59XG5cbmZ1bmN0aW9uIG9uQ2hhcnRDbGljaygpOiB2b2lkIHtcbiAgaWYgKHJlY3RNZW51LnZhbHVlKSByZWN0TWVudS52YWx1ZSA9IG51bGw7XG4gIGNsb3NlUGFsZXR0ZSgpO1xuICBpZiAoZHJhd2luZ3NTdG9yZS5hY3RpdmVUb29sID09PSBcImN1cnNvclwiICYmIGRyYXdpbmdzU3RvcmUuc2VsZWN0ZWRJZCkge1xuICAgIGRyYXdpbmdzU3RvcmUuc2VsZWN0ZWRJZCA9IG51bGw7XG4gICAgc2VsZWN0ZWRSZWN0LnZhbHVlID0gbnVsbDtcbiAgICBlZGl0UGFuZWxQb3MudmFsdWUgPSBudWxsO1xuICAgIHJlY2FsY1JlY3RzKCk7XG4gIH1cbiAgaWYgKGRyYXdpbmdzU3RvcmUuYWN0aXZlVG9vbCA9PT0gXCJjdXJzb3JcIiAmJiAoZHJhd2luZ3NTdG9yZS5zZWxlY3RlZExpbmVJZCB8fCBzZWxlY3RlZExpbmUudmFsdWUpKSB7XG4gICAgZHJhd2luZ3NTdG9yZS5zZWxlY3RlZExpbmVJZCA9IG51bGw7XG4gICAgc2VsZWN0ZWRMaW5lLnZhbHVlID0gbnVsbDtcbiAgICBsaW5lUGFuZWxQb3MudmFsdWUgPSBudWxsO1xuICAgIGxpbmVQYWxldHRlT3Blbi52YWx1ZSA9IGZhbHNlO1xuICAgIHJlY2FsY1JlY3RzKCk7XG4gIH1cbiAgaWYgKGRyYXdpbmdzU3RvcmUuYWN0aXZlVG9vbCA9PT0gXCJjdXJzb3JcIiAmJiAoZHJhd2luZ3NTdG9yZS5zZWxlY3RlZFBvbHlJZCB8fCBzZWxlY3RlZFBvbHkudmFsdWUpKSB7XG4gICAgZHJhd2luZ3NTdG9yZS5zZWxlY3RlZFBvbHlJZCA9IG51bGw7XG4gICAgc2VsZWN0ZWRQb2x5LnZhbHVlID0gbnVsbDtcbiAgICBwb2x5UGFuZWxQb3MudmFsdWUgPSBudWxsO1xuICAgIHBvbHlQYWxldHRlT3Blbi52YWx1ZSA9IGZhbHNlO1xuICAgIHJlY2FsY1JlY3RzKCk7XG4gIH1cbiAgaWYgKGRyYXdpbmdzU3RvcmUuYWN0aXZlVG9vbCA9PT0gXCJjdXJzb3JcIiAmJiAoZHJhd2luZ3NTdG9yZS5zZWxlY3RlZFBvc2l0aW9uSWQgfHwgc2VsZWN0ZWRQb3MudmFsdWUpKSB7XG4gICAgZHJhd2luZ3NTdG9yZS5zZWxlY3RlZFBvc2l0aW9uSWQgPSBudWxsO1xuICAgIHNlbGVjdGVkUG9zLnZhbHVlID0gbnVsbDtcbiAgICBwb3NQYW5lbFBvcy52YWx1ZSA9IG51bGw7XG4gICAgcmVjYWxjUmVjdHMoKTtcbiAgfVxuICBpZiAoZHJhd2luZ3NTdG9yZS5hY3RpdmVUb29sID09PSBcImN1cnNvclwiICYmIGRyYXdpbmdzU3RvcmUuc2VsZWN0ZWRTaW5nbGUpIHtcbiAgICBkcmF3aW5nc1N0b3JlLnNlbGVjdGVkU2luZ2xlID0gbnVsbDtcbiAgICBzaW5nbGVQYW5lbFBvcy52YWx1ZSA9IG51bGw7XG4gICAgcmVjYWxjUmVjdHMoKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBkZWxldGVTZWxlY3RlZCgpOiB2b2lkIHtcbiAgaWYgKCFzZWxlY3RlZFJlY3QudmFsdWUpIHJldHVybjtcbiAgZHJhd2luZ3NTdG9yZS5yZW1vdmUobWFya2V0Lmluc3RydW1lbnQsIHNlbGVjdGVkUmVjdC52YWx1ZS5pZCk7XG4gIHNlbGVjdGVkUmVjdC52YWx1ZSA9IG51bGw7XG4gIGVkaXRQYW5lbFBvcy52YWx1ZSA9IG51bGw7XG4gIHJlY3RNZW51LnZhbHVlID0gbnVsbDtcbiAgY2xvc2VQYWxldHRlKCk7XG4gIHJlY2FsY1JlY3RzKCk7XG59XG5cbi8qKiBDb250ZXh0LW1lbnUgY29sb3IgY2hhbmdlOiB3b3JrcyBvbiB0aGUgcmlnaHQtY2xpY2tlZCByZWN0YW5nbGUuICovXG5mdW5jdGlvbiBzZXRDb2xvckluTWVudShjb2xvcjogc3RyaW5nKTogdm9pZCB7XG4gIGNvbnN0IG1lbnUgPSByZWN0TWVudS52YWx1ZTtcbiAgaWYgKCFtZW51KSByZXR1cm47XG4gIGRyYXdpbmdzU3RvcmUudXBkYXRlU3R5bGUobWFya2V0Lmluc3RydW1lbnQsIG1lbnUuaWQsIHsgY29sb3IgfSk7XG4gIGlmIChzZWxlY3RlZFJlY3QudmFsdWU/LmlkID09PSBtZW51LmlkKSBzeW5jU2VsZWN0ZWQoKTtcbiAgZWxzZSByZWNhbGNSZWN0cygpO1xufVxuXG5mdW5jdGlvbiBzZXRPcGFjaXR5SW5NZW51KG9wYWNpdHk6IG51bWJlcik6IHZvaWQge1xuICBjb25zdCBtZW51ID0gcmVjdE1lbnUudmFsdWU7XG4gIGlmICghbWVudSkgcmV0dXJuO1xuICBkcmF3aW5nc1N0b3JlLnVwZGF0ZVN0eWxlKG1hcmtldC5pbnN0cnVtZW50LCBtZW51LmlkLCB7IG9wYWNpdHkgfSk7XG4gIGlmIChzZWxlY3RlZFJlY3QudmFsdWU/LmlkID09PSBtZW51LmlkKSBzeW5jU2VsZWN0ZWQoKTtcbiAgZWxzZSByZWNhbGNSZWN0cygpO1xufVxuXG4vKiogQ29udGV4dC1tZW51IGZpbGwgdG9nZ2xlIChib3JkZXItb25seSDih4QgZmlsbGVkKS4gKi9cbmZ1bmN0aW9uIHRvZ2dsZUZpbGxJbk1lbnUoKTogdm9pZCB7XG4gIGNvbnN0IG1lbnUgPSByZWN0TWVudS52YWx1ZTtcbiAgaWYgKCFtZW51KSByZXR1cm47XG4gIGNvbnN0IHJlY3QgPSBkcmF3aW5nc1N0b3JlLmdldEZvcihtYXJrZXQuaW5zdHJ1bWVudCkuZmluZCgocikgPT4gci5pZCA9PT0gbWVudS5pZCk7XG4gIGlmICghcmVjdCkgcmV0dXJuO1xuICBkcmF3aW5nc1N0b3JlLnVwZGF0ZVN0eWxlKG1hcmtldC5pbnN0cnVtZW50LCBtZW51LmlkLCB7IGZpbGxlZDogcmVjdC5maWxsZWQgPT09IGZhbHNlIH0pO1xuICBpZiAoc2VsZWN0ZWRSZWN0LnZhbHVlPy5pZCA9PT0gbWVudS5pZCkgc3luY1NlbGVjdGVkKCk7XG4gIGVsc2UgcmVjYWxjUmVjdHMoKTtcbn1cblxuLyoqIENvbnRleHQtbWVudSBkZWxldGUuICovXG5mdW5jdGlvbiBkZWxldGVGcm9tTWVudSgpOiB2b2lkIHtcbiAgY29uc3QgbWVudSA9IHJlY3RNZW51LnZhbHVlO1xuICBpZiAoIW1lbnUpIHJldHVybjtcbiAgZHJhd2luZ3NTdG9yZS5yZW1vdmUobWFya2V0Lmluc3RydW1lbnQsIG1lbnUuaWQpO1xuICBpZiAoc2VsZWN0ZWRSZWN0LnZhbHVlPy5pZCA9PT0gbWVudS5pZCkge1xuICAgIHNlbGVjdGVkUmVjdC52YWx1ZSA9IG51bGw7XG4gICAgZWRpdFBhbmVsUG9zLnZhbHVlID0gbnVsbDtcbiAgfVxuICByZWN0TWVudS52YWx1ZSA9IG51bGw7XG4gIGNsb3NlUGFsZXR0ZSgpO1xuICByZWNhbGNSZWN0cygpO1xufVxuXG5mdW5jdGlvbiBzZXRDb2xvclNlbGVjdGVkKGNvbG9yOiBzdHJpbmcpOiB2b2lkIHtcbiAgaWYgKCFzZWxlY3RlZFJlY3QudmFsdWUpIHJldHVybjtcbiAgZHJhd2luZ3NTdG9yZS51cGRhdGVTdHlsZShtYXJrZXQuaW5zdHJ1bWVudCwgc2VsZWN0ZWRSZWN0LnZhbHVlLmlkLCB7IGNvbG9yIH0pO1xuICBzeW5jU2VsZWN0ZWQoKTtcbn1cblxuZnVuY3Rpb24gc2V0T3BhY2l0eVNlbGVjdGVkKG9wYWNpdHk6IG51bWJlcik6IHZvaWQge1xuICBpZiAoIXNlbGVjdGVkUmVjdC52YWx1ZSkgcmV0dXJuO1xuICBkcmF3aW5nc1N0b3JlLnVwZGF0ZVN0eWxlKG1hcmtldC5pbnN0cnVtZW50LCBzZWxlY3RlZFJlY3QudmFsdWUuaWQsIHsgb3BhY2l0eSB9KTtcbiAgc3luY1NlbGVjdGVkKCk7XG59XG5cbi8qKiBUb2dnbGUgYmFja2dyb3VuZCBmaWxsOyBib3JkZXItb25seSByZWN0cyByZW5kZXIgYXQgMTAwJSBvcGFjaXR5LiAqL1xuZnVuY3Rpb24gdG9nZ2xlRmlsbFNlbGVjdGVkKCk6IHZvaWQge1xuICBpZiAoIXNlbGVjdGVkUmVjdC52YWx1ZSkgcmV0dXJuO1xuICBkcmF3aW5nc1N0b3JlLnVwZGF0ZVN0eWxlKG1hcmtldC5pbnN0cnVtZW50LCBzZWxlY3RlZFJlY3QudmFsdWUuaWQsIHtcbiAgICBmaWxsZWQ6IHNlbGVjdGVkUmVjdC52YWx1ZS5maWxsZWQgPT09IGZhbHNlLFxuICB9KTtcbiAgc3luY1NlbGVjdGVkKCk7XG59XG5cbi8qKiBSZS1yZWFkIHRoZSBzZWxlY3RlZCByZWN0IGZyb20gdGhlIHN0b3JlIGFuZCByZWZyZXNoIHRoZSBvdmVybGF5LiAqL1xuZnVuY3Rpb24gc3luY1NlbGVjdGVkKCk6IHZvaWQge1xuICBpZiAoIXNlbGVjdGVkUmVjdC52YWx1ZSkgcmV0dXJuO1xuICBjb25zdCB1cGRhdGVkID0gZHJhd2luZ3NTdG9yZS5nZXRGb3IobWFya2V0Lmluc3RydW1lbnQpLmZpbmQoKHIpID0+IHIuaWQgPT09IHNlbGVjdGVkUmVjdC52YWx1ZSEuaWQpO1xuICBpZiAodXBkYXRlZCkgc2VsZWN0ZWRSZWN0LnZhbHVlID0gdXBkYXRlZDtcbiAgcmVjYWxjUmVjdHMoKTtcbn1cblxuZnVuY3Rpb24gb25SZXNpemVTdGFydChlOiBNb3VzZUV2ZW50LCBoYW5kbGU6IHN0cmluZyk6IHZvaWQge1xuICBpZiAoIXNlbGVjdGVkUmVjdC52YWx1ZSB8fCAhYWRhcHRlciB8fCAhY29udGFpbmVyUmVmLnZhbHVlKSByZXR1cm47XG4gIGUucHJldmVudERlZmF1bHQoKTtcbiAgZS5zdG9wUHJvcGFnYXRpb24oKTtcbiAgY29uc3QgcmVjdCA9IHsgLi4uc2VsZWN0ZWRSZWN0LnZhbHVlIH07XG4gIHJlY3RNZW51LnZhbHVlID0gbnVsbDtcblxuICAvLyBNYXAgdGhlIGRyYWdnZWQgU0NSRUVOIGVkZ2UgdG8gdGhlIHN0b3JlZCBjb3JuZXIgY3VycmVudGx5IHNpdHRpbmcgb24gaXQuXG4gIC8vIENvcm5lcnMgY2FuIGJlIHVuLW9yZGVyZWQgKGFmdGVyIGEgZmxpcCBtaWQtcmVzaXplKSwgc28gYSBmaXhlZCBtYXBwaW5nXG4gIC8vIGxpa2UgXCJlXCIg4oaSIHRpbWUyIHdvdWxkIGdyYWIgdGhlIHdyb25nIHNpZGUgYW5kIG1ha2UgdGhlIHJlY3QganVtcC5cbiAgLy8gICByaWdodCBlZGdlID0gbWF4KHRpbWUxLHRpbWUyKSwgbGVmdCA9IG1pbjsgdG9wID0gbWF4KHByaWNlMSxwcmljZTIpXG4gIC8vICAgKGhpZ2hlciBwcmljZSA9IGhpZ2hlciBvbiBzY3JlZW4pLCBib3R0b20gPSBtaW4uXG4gIGNvbnN0IGVkZ2VUaW1lID1cbiAgICBoYW5kbGUuaW5jbHVkZXMoXCJlXCIpID8gKHJlY3QudGltZTEgPiByZWN0LnRpbWUyID8gXCJ0aW1lMVwiIDogXCJ0aW1lMlwiKVxuICAgIDogaGFuZGxlLmluY2x1ZGVzKFwid1wiKSA/IChyZWN0LnRpbWUxID4gcmVjdC50aW1lMiA/IFwidGltZTJcIiA6IFwidGltZTFcIilcbiAgICA6IG51bGw7XG4gIGNvbnN0IGVkZ2VQcmljZSA9XG4gICAgaGFuZGxlLmluY2x1ZGVzKFwiblwiKSA/IChyZWN0LnByaWNlMSA+IHJlY3QucHJpY2UyID8gXCJwcmljZTFcIiA6IFwicHJpY2UyXCIpXG4gICAgOiBoYW5kbGUuaW5jbHVkZXMoXCJzXCIpID8gKHJlY3QucHJpY2UxID4gcmVjdC5wcmljZTIgPyBcInByaWNlMlwiIDogXCJwcmljZTFcIilcbiAgICA6IG51bGw7XG5cbiAgY29uc3Qgb25Nb3ZlID0gKGV2OiBNb3VzZUV2ZW50KSA9PiB7XG4gICAgaWYgKCFhZGFwdGVyIHx8ICFjb250YWluZXJSZWYudmFsdWUpIHJldHVybjtcbiAgICBjb25zdCByID0gY29udGFpbmVyUmVmLnZhbHVlLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuICAgIGNvbnN0IG14ID0gZXYuY2xpZW50WCAtIHIubGVmdDtcbiAgICBjb25zdCBteSA9IGV2LmNsaWVudFkgLSByLnRvcDtcbiAgICBjb25zdCB0ID0gYWRhcHRlci54VG9UaW1lKG14KTtcbiAgICBjb25zdCBwID0gYWRhcHRlci55VG9QcmljZShteSk7XG4gICAgaWYgKHQgPT09IG51bGwgfHwgcCA9PT0gbnVsbCkgcmV0dXJuO1xuXG4gICAgLy8gTWFnbmV0OiBzbmFwIHRoZSBkcmFnZ2VkIGFuY2hvciB0byB0aGUgY2FuZGxlIGhpZ2gvbG93IChvbmx5IHRoZVxuICAgIC8vIGRyYWdnZWQgYXhpcyBpcyBhcHBsaWVkLCBzbyBhIHZlcnRpY2FsLWVkZ2UgZHJhZyBzdGF5cyB2ZXJ0aWNhbCkuXG4gICAgY29uc3QgcyA9IHNuYXBUb0NhbmRsZSh0LCBwLCBtYWduZXRBY3RpdmUudmFsdWUpO1xuXG4gICAgLy8gT25seSB0aGUgZHJhZ2dlZCBlZGdlIG1vdmVzOyB0aGUgb3Bwb3NpdGUgZWRnZSBzdGF5cyBhbmNob3JlZC5cbiAgICBjb25zdCBuZXdSZWN0OiBQYXJ0aWFsPERyYXdpbmdSZWN0PiA9IHt9O1xuICAgIGlmIChlZGdlVGltZSkgbmV3UmVjdFtlZGdlVGltZV0gPSBzLnRpbWU7XG4gICAgaWYgKGVkZ2VQcmljZSkgbmV3UmVjdFtlZGdlUHJpY2VdID0gcy5wcmljZTtcblxuICAgIGRyYXdpbmdzU3RvcmUudXBkYXRlUmVjdChtYXJrZXQuaW5zdHJ1bWVudCwgcmVjdC5pZCwgbmV3UmVjdCk7XG4gICAgLy8gVXBkYXRlIHNlbGVjdGVkUmVjdCByZWZlcmVuY2VcbiAgICBjb25zdCB1cGRhdGVkID0gZHJhd2luZ3NTdG9yZS5nZXRGb3IobWFya2V0Lmluc3RydW1lbnQpLmZpbmQoKHIpID0+IHIuaWQgPT09IHJlY3QuaWQpO1xuICAgIGlmICh1cGRhdGVkKSBzZWxlY3RlZFJlY3QudmFsdWUgPSB1cGRhdGVkO1xuICAgIHJlY2FsY1JlY3RzKCk7XG4gICAgcG9zaXRpb25FZGl0UGFuZWwocmVjdC5pZCk7XG4gIH07XG5cbiAgY29uc3Qgb25VcCA9ICgpID0+IHtcbiAgICB3aW5kb3cucmVtb3ZlRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJtb3ZlXCIsIG9uTW92ZSk7XG4gICAgd2luZG93LnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJwb2ludGVydXBcIiwgb25VcCk7XG4gIH07XG5cbiAgd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoXCJwb2ludGVybW92ZVwiLCBvbk1vdmUpO1xuICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJ1cFwiLCBvblVwKTtcbn1cblxuLyog4pSA4pSAIFRyZW5kbGluZSBpbnRlcmFjdGlvbiDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIAgKi9cblxuLyoqIFNlbGVjdCBhIHRyZW5kbGluZSBhbmQgb3BlbiBpdHMgZWRpdCBwYW5lbC4gKi9cbmZ1bmN0aW9uIG9uVHJlbmRDbGljayhpZDogc3RyaW5nLCBlOiBNb3VzZUV2ZW50KTogdm9pZCB7XG4gIGUuc3RvcFByb3BhZ2F0aW9uKCk7XG4gIHJlY3RNZW51LnZhbHVlID0gbnVsbDtcbiAgY2xvc2VQYWxldHRlKCk7XG4gIGxpbmVQYWxldHRlT3Blbi52YWx1ZSA9IGZhbHNlO1xuICBjbGVhclNpbmdsZVNlbGVjdGlvbigpO1xuICBpZiAoZHJhd2luZ3NTdG9yZS5hY3RpdmVUb29sICE9PSBcImN1cnNvclwiKSB7XG4gICAgZHJhd2luZ3NTdG9yZS5hY3RpdmVUb29sID0gXCJjdXJzb3JcIjtcbiAgfVxuICBkcmF3aW5nc1N0b3JlLnNlbGVjdGVkSWQgPSBudWxsO1xuICBzZWxlY3RlZFJlY3QudmFsdWUgPSBudWxsO1xuICBlZGl0UGFuZWxQb3MudmFsdWUgPSBudWxsO1xuICBkcmF3aW5nc1N0b3JlLnNlbGVjdGVkTGluZUlkID0gaWQ7XG4gIHNlbGVjdGVkTGluZS52YWx1ZSA9IGRyYXdpbmdzU3RvcmUuZ2V0TGluZXNGb3IobWFya2V0Lmluc3RydW1lbnQpLmZpbmQoKGwpID0+IGwuaWQgPT09IGlkKSA/PyBudWxsO1xuICByZWNhbGNSZWN0cygpO1xuICBwb3NpdGlvbkxpbmVQYW5lbChpZCk7XG59XG5cbi8qKiBBbmNob3JzIHRoZSBmbG9hdGluZyBlZGl0IHBhbmVsIHRvIHRoZSB0cmVuZGxpbmUncyBSSUdIVCBlbmRwb2ludFxuICogIChcInJpZ2h0IGNvcm5lclwiKTogOHB4IGJlc2lkZS9hYm92ZSBpdCwgZmxpcHBpbmcgd2hlbiBvdXQgb2Ygcm9vbSxcbiAqICBmdWxseSBjbGFtcGVkIGluc2lkZSB0aGUgcGFuZS4gKi9cbmZ1bmN0aW9uIHBvc2l0aW9uTGluZVBhbmVsKGlkOiBzdHJpbmcpOiB2b2lkIHtcbiAgY29uc3QgcHggPSB0cmVuZFBpeGVscy52YWx1ZS5maW5kKCh0KSA9PiB0LmlkID09PSBpZCk7XG4gIGNvbnN0IHBhbmUgPSBjb250YWluZXJSZWYudmFsdWU7XG4gIGlmICghcHggfHwgIXBhbmUpIHJldHVybjtcbiAgbGluZVBhbmVsUG9zLnZhbHVlID0gY29tcHV0ZUxpbmVQYW5lbFBvcyhweCwgcGFuZSk7XG4gIGlmICghbGluZVBhbmVsRWwudmFsdWUpIHtcbiAgICB2b2lkIG5leHRUaWNrKCgpID0+IHtcbiAgICAgIGNvbnN0IHNlbCA9IHNlbGVjdGVkTGluZS52YWx1ZTtcbiAgICAgIGlmICghbGluZVBhbmVsRWwudmFsdWUgfHwgIXNlbCB8fCAhY29udGFpbmVyUmVmLnZhbHVlKSByZXR1cm47XG4gICAgICBjb25zdCBwID0gdHJlbmRQaXhlbHMudmFsdWUuZmluZCgodCkgPT4gdC5pZCA9PT0gc2VsLmlkKTtcbiAgICAgIGlmIChwKSBsaW5lUGFuZWxQb3MudmFsdWUgPSBjb21wdXRlTGluZVBhbmVsUG9zKHAsIGNvbnRhaW5lclJlZi52YWx1ZSk7XG4gICAgfSk7XG4gIH1cbn1cblxuZnVuY3Rpb24gY29tcHV0ZUxpbmVQYW5lbFBvcyhwaXhlbDogVHJlbmRQaXhlbCwgcGFuZTogSFRNTEVsZW1lbnQpOiB7IHg6IG51bWJlcjsgeTogbnVtYmVyIH0ge1xuICBjb25zdCB3ID0gbGluZVBhbmVsRWwudmFsdWU/Lm9mZnNldFdpZHRoIHx8IFBBTkVMX1c7XG4gIGNvbnN0IGggPSBsaW5lUGFuZWxFbC52YWx1ZT8ub2Zmc2V0SGVpZ2h0IHx8IFBBTkVMX0g7XG4gIGNvbnN0IGdhcCA9IDg7XG4gIGNvbnN0IGF0U3RhcnQgPSBwaXhlbC54MSA+PSBwaXhlbC54MjsgLy8gcmlnaHQgZW5kcG9pbnQgb2YgdGhlIGxpbmVcbiAgY29uc3QgZXggPSBhdFN0YXJ0ID8gcGl4ZWwueDEgOiBwaXhlbC54MjtcbiAgY29uc3QgZXkgPSBhdFN0YXJ0ID8gcGl4ZWwueTEgOiBwaXhlbC55MjtcbiAgLy8gUHJlZmVyIHJpZ2h0IG9mIHRoZSBlbmRwb2ludCwgYWJvdmUgaXQ7IGZsaXAgbGVmdCAvIGJlbG93IHdoZW4gY2xpcHBlZFxuICBsZXQgeCA9IGV4ICsgZ2FwO1xuICBsZXQgeSA9IGV5IC0gaCAtIGdhcDtcbiAgaWYgKHggKyB3ID4gcGFuZS5jbGllbnRXaWR0aCAtIDYpIHggPSBleCAtIHcgLSBnYXA7XG4gIGlmICh5IDwgNCkgeSA9IGV5ICsgZ2FwO1xuICB4ID0gTWF0aC5taW4oTWF0aC5tYXgoNCwgeCksIE1hdGgubWF4KDQsIHBhbmUuY2xpZW50V2lkdGggLSB3IC0gNikpO1xuICB5ID0gTWF0aC5taW4oTWF0aC5tYXgoNCwgeSksIE1hdGgubWF4KDQsIHBhbmUuY2xpZW50SGVpZ2h0IC0gaCAtIDYpKTtcbiAgcmV0dXJuIHsgeCwgeSB9O1xufVxuXG4vKiogRHJhZyB0aGUgd2hvbGUgdHJlbmRsaW5lIChib2R5IHByZXNzKSDigJQgYm90aCBlbmRwb2ludHMgbW92ZSB0b2dldGhlci4gKi9cbmZ1bmN0aW9uIG9uVHJlbmREcmFnU3RhcnQoZTogTW91c2VFdmVudCwgaWQ6IHN0cmluZyk6IHZvaWQge1xuICBpZiAoZS5idXR0b24gIT09IDAgfHwgZHJhd2luZ3NTdG9yZS5hY3RpdmVUb29sICE9PSBcImN1cnNvclwiKSByZXR1cm47XG4gIGlmICghYWRhcHRlciB8fCAhY29udGFpbmVyUmVmLnZhbHVlKSByZXR1cm47XG4gIGNvbnN0IGxpbmUgPSBkcmF3aW5nc1N0b3JlLmdldExpbmVzRm9yKG1hcmtldC5pbnN0cnVtZW50KS5maW5kKChsKSA9PiBsLmlkID09PSBpZCk7XG4gIGlmICghbGluZSkgcmV0dXJuO1xuICBlLnByZXZlbnREZWZhdWx0KCk7XG4gIGUuc3RvcFByb3BhZ2F0aW9uKCk7XG4gIHJlY3RNZW51LnZhbHVlID0gbnVsbDtcbiAgY2xvc2VQYWxldHRlKCk7XG4gIGNsZWFyU2luZ2xlU2VsZWN0aW9uKCk7XG5cbiAgZHJhd2luZ3NTdG9yZS5zZWxlY3RlZElkID0gbnVsbDtcbiAgc2VsZWN0ZWRSZWN0LnZhbHVlID0gbnVsbDtcbiAgZWRpdFBhbmVsUG9zLnZhbHVlID0gbnVsbDtcbiAgZHJhd2luZ3NTdG9yZS5zZWxlY3RlZExpbmVJZCA9IGlkO1xuICBzZWxlY3RlZExpbmUudmFsdWUgPSBsaW5lO1xuICByZWNhbGNSZWN0cygpO1xuICBwb3NpdGlvbkxpbmVQYW5lbChpZCk7XG5cbiAgY29uc3QgcjAgPSBjb250YWluZXJSZWYudmFsdWUuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gIGNvbnN0IHN0YXJ0VCA9IGFkYXB0ZXIueFRvVGltZShlLmNsaWVudFggLSByMC5sZWZ0KTtcbiAgY29uc3Qgc3RhcnRQID0gYWRhcHRlci55VG9QcmljZShlLmNsaWVudFkgLSByMC50b3ApO1xuICBpZiAoc3RhcnRUID09PSBudWxsIHx8IHN0YXJ0UCA9PT0gbnVsbCkgcmV0dXJuO1xuICBjb25zdCBvcmlnID0geyB0aW1lMTogbGluZS50aW1lMSwgcHJpY2UxOiBsaW5lLnByaWNlMSwgdGltZTI6IGxpbmUudGltZTIsIHByaWNlMjogbGluZS5wcmljZTIgfTtcblxuICBjb25zdCBvbk1vdmUgPSAoZXY6IE1vdXNlRXZlbnQpID0+IHtcbiAgICBpZiAoIWFkYXB0ZXIgfHwgIWNvbnRhaW5lclJlZi52YWx1ZSkgcmV0dXJuO1xuICAgIGNvbnN0IHIgPSBjb250YWluZXJSZWYudmFsdWUuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gICAgY29uc3QgdCA9IGFkYXB0ZXIueFRvVGltZShldi5jbGllbnRYIC0gci5sZWZ0KTtcbiAgICBjb25zdCBwID0gYWRhcHRlci55VG9QcmljZShldi5jbGllbnRZIC0gci50b3ApO1xuICAgIGlmICh0ID09PSBudWxsIHx8IHAgPT09IG51bGwpIHJldHVybjtcbiAgICBjb25zdCBkdCA9IHQgLSBzdGFydFQ7XG4gICAgY29uc3QgZHAgPSBwIC0gc3RhcnRQO1xuICAgIGRyYXdpbmdzU3RvcmUudXBkYXRlTGluZShtYXJrZXQuaW5zdHJ1bWVudCwgaWQsIHtcbiAgICAgIHRpbWUxOiBvcmlnLnRpbWUxICsgZHQsXG4gICAgICBwcmljZTE6IG9yaWcucHJpY2UxICsgZHAsXG4gICAgICB0aW1lMjogb3JpZy50aW1lMiArIGR0LFxuICAgICAgcHJpY2UyOiBvcmlnLnByaWNlMiArIGRwLFxuICAgIH0pO1xuICAgIGNvbnN0IHVwZGF0ZWQgPSBkcmF3aW5nc1N0b3JlLmdldExpbmVzRm9yKG1hcmtldC5pbnN0cnVtZW50KS5maW5kKCh4KSA9PiB4LmlkID09PSBpZCk7XG4gICAgaWYgKHVwZGF0ZWQpIHNlbGVjdGVkTGluZS52YWx1ZSA9IHVwZGF0ZWQ7XG4gICAgcmVjYWxjUmVjdHMoKTtcbiAgICBwb3NpdGlvbkxpbmVQYW5lbChpZCk7XG4gIH07XG5cbiAgY29uc3Qgb25VcCA9ICgpID0+IHtcbiAgICB3aW5kb3cucmVtb3ZlRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJtb3ZlXCIsIG9uTW92ZSk7XG4gICAgd2luZG93LnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJwb2ludGVydXBcIiwgb25VcCk7XG4gIH07XG4gIHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKFwicG9pbnRlcm1vdmVcIiwgb25Nb3ZlKTtcbiAgd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoXCJwb2ludGVydXBcIiwgb25VcCk7XG59XG5cbi8qKiBEcmFnIGFuIGVuZHBvaW50IGhhbmRsZSAoXCJjb3JuZXJcIikgdG8gcmVzaXplL3JlZHJhdyB0aGUgbGluZTsgdGhlIG90aGVyXG4gKiAgZW5kcG9pbnQgc3RheXMgYW5jaG9yZWQuICovXG5mdW5jdGlvbiBvblRyZW5kSGFuZGxlU3RhcnQoZTogTW91c2VFdmVudCwgaWQ6IHN0cmluZywgd2hpY2g6IDEgfCAyKTogdm9pZCB7XG4gIGlmIChlLmJ1dHRvbiAhPT0gMCB8fCAhYWRhcHRlciB8fCAhY29udGFpbmVyUmVmLnZhbHVlKSByZXR1cm47XG4gIGUucHJldmVudERlZmF1bHQoKTtcbiAgZS5zdG9wUHJvcGFnYXRpb24oKTtcbiAgcmVjdE1lbnUudmFsdWUgPSBudWxsO1xuICBjbG9zZVBhbGV0dGUoKTtcblxuICBjb25zdCBvbk1vdmUgPSAoZXY6IE1vdXNlRXZlbnQpID0+IHtcbiAgICBpZiAoIWFkYXB0ZXIgfHwgIWNvbnRhaW5lclJlZi52YWx1ZSkgcmV0dXJuO1xuICAgIGNvbnN0IHIgPSBjb250YWluZXJSZWYudmFsdWUuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gICAgY29uc3QgdCA9IGFkYXB0ZXIueFRvVGltZShldi5jbGllbnRYIC0gci5sZWZ0KTtcbiAgICBjb25zdCBwID0gYWRhcHRlci55VG9QcmljZShldi5jbGllbnRZIC0gci50b3ApO1xuICAgIGlmICh0ID09PSBudWxsIHx8IHAgPT09IG51bGwpIHJldHVybjtcbiAgICBjb25zdCBzID0gc25hcFRvQ2FuZGxlKHQsIHAsIG1hZ25ldEFjdGl2ZS52YWx1ZSk7XG4gICAgZHJhd2luZ3NTdG9yZS51cGRhdGVMaW5lKG1hcmtldC5pbnN0cnVtZW50LCBpZCwgd2hpY2ggPT09IDEgPyB7IHRpbWUxOiBzLnRpbWUsIHByaWNlMTogcy5wcmljZSB9IDogeyB0aW1lMjogcy50aW1lLCBwcmljZTI6IHMucHJpY2UgfSk7XG4gICAgY29uc3QgdXBkYXRlZCA9IGRyYXdpbmdzU3RvcmUuZ2V0TGluZXNGb3IobWFya2V0Lmluc3RydW1lbnQpLmZpbmQoKHgpID0+IHguaWQgPT09IGlkKTtcbiAgICBpZiAodXBkYXRlZCkgc2VsZWN0ZWRMaW5lLnZhbHVlID0gdXBkYXRlZDtcbiAgICByZWNhbGNSZWN0cygpO1xuICAgIHBvc2l0aW9uTGluZVBhbmVsKGlkKTtcbiAgfTtcblxuICBjb25zdCBvblVwID0gKCkgPT4ge1xuICAgIHdpbmRvdy5yZW1vdmVFdmVudExpc3RlbmVyKFwicG9pbnRlcm1vdmVcIiwgb25Nb3ZlKTtcbiAgICB3aW5kb3cucmVtb3ZlRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJ1cFwiLCBvblVwKTtcbiAgfTtcbiAgd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoXCJwb2ludGVybW92ZVwiLCBvbk1vdmUpO1xuICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJ1cFwiLCBvblVwKTtcbn1cblxuZnVuY3Rpb24gZGVsZXRlU2VsZWN0ZWRMaW5lKCk6IHZvaWQge1xuICBpZiAoIXNlbGVjdGVkTGluZS52YWx1ZSkgcmV0dXJuO1xuICBkcmF3aW5nc1N0b3JlLnJlbW92ZUxpbmUobWFya2V0Lmluc3RydW1lbnQsIHNlbGVjdGVkTGluZS52YWx1ZS5pZCk7XG4gIHNlbGVjdGVkTGluZS52YWx1ZSA9IG51bGw7XG4gIGxpbmVQYW5lbFBvcy52YWx1ZSA9IG51bGw7XG4gIGxpbmVQYWxldHRlT3Blbi52YWx1ZSA9IGZhbHNlO1xuICByZWNhbGNSZWN0cygpO1xufVxuXG5mdW5jdGlvbiBzZXRMaW5lQ29sb3JTZWxlY3RlZChjb2xvcjogc3RyaW5nKTogdm9pZCB7XG4gIGlmICghc2VsZWN0ZWRMaW5lLnZhbHVlKSByZXR1cm47XG4gIGRyYXdpbmdzU3RvcmUudXBkYXRlTGluZVN0eWxlKG1hcmtldC5pbnN0cnVtZW50LCBzZWxlY3RlZExpbmUudmFsdWUuaWQsIHsgY29sb3IgfSk7XG4gIHN5bmNTZWxlY3RlZExpbmUoKTtcbn1cblxuZnVuY3Rpb24gc2V0TGluZURhc2hTZWxlY3RlZChkYXNoOiBEYXNoU3R5bGUpOiB2b2lkIHtcbiAgaWYgKCFzZWxlY3RlZExpbmUudmFsdWUpIHJldHVybjtcbiAgZHJhd2luZ3NTdG9yZS51cGRhdGVMaW5lU3R5bGUobWFya2V0Lmluc3RydW1lbnQsIHNlbGVjdGVkTGluZS52YWx1ZS5pZCwgeyBkYXNoIH0pO1xuICBzeW5jU2VsZWN0ZWRMaW5lKCk7XG59XG5cbi8qKiBSZS1yZWFkIHRoZSBzZWxlY3RlZCB0cmVuZGxpbmUgZnJvbSB0aGUgc3RvcmUgYW5kIHJlZnJlc2ggdGhlIG92ZXJsYXkuICovXG5mdW5jdGlvbiBzeW5jU2VsZWN0ZWRMaW5lKCk6IHZvaWQge1xuICBpZiAoIXNlbGVjdGVkTGluZS52YWx1ZSkgcmV0dXJuO1xuICBjb25zdCB1cGRhdGVkID0gZHJhd2luZ3NTdG9yZS5nZXRMaW5lc0ZvcihtYXJrZXQuaW5zdHJ1bWVudCkuZmluZCgobCkgPT4gbC5pZCA9PT0gc2VsZWN0ZWRMaW5lLnZhbHVlIS5pZCk7XG4gIGlmICh1cGRhdGVkKSBzZWxlY3RlZExpbmUudmFsdWUgPSB1cGRhdGVkO1xuICByZWNhbGNSZWN0cygpO1xufVxuXG4vKiDilIDilIAgUG9seWxpbmUgaW50ZXJhY3Rpb24g4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAICovXG5cbi8qKiBTZWxlY3QgYSBwb2x5bGluZSBhbmQgb3BlbiBpdHMgZWRpdCBwYW5lbCAoYW5jaG9yZWQgYXQgdGhlIExBU1QgY29ybmVyKS4gKi9cbmZ1bmN0aW9uIG9uUG9seUNsaWNrKGlkOiBzdHJpbmcsIGU6IE1vdXNlRXZlbnQpOiB2b2lkIHtcbiAgZS5zdG9wUHJvcGFnYXRpb24oKTtcbiAgcmVjdE1lbnUudmFsdWUgPSBudWxsO1xuICBjbG9zZVBhbGV0dGUoKTtcbiAgcG9seVBhbGV0dGVPcGVuLnZhbHVlID0gZmFsc2U7XG4gIGxpbmVQYWxldHRlT3Blbi52YWx1ZSA9IGZhbHNlO1xuICBjbGVhclNpbmdsZVNlbGVjdGlvbigpO1xuICBpZiAoZHJhd2luZ3NTdG9yZS5hY3RpdmVUb29sICE9PSBcImN1cnNvclwiKSB7XG4gICAgZHJhd2luZ3NTdG9yZS5hY3RpdmVUb29sID0gXCJjdXJzb3JcIjtcbiAgfVxuICBkcmF3aW5nc1N0b3JlLnNlbGVjdGVkSWQgPSBudWxsO1xuICBzZWxlY3RlZFJlY3QudmFsdWUgPSBudWxsO1xuICBlZGl0UGFuZWxQb3MudmFsdWUgPSBudWxsO1xuICBkcmF3aW5nc1N0b3JlLnNlbGVjdGVkTGluZUlkID0gbnVsbDtcbiAgc2VsZWN0ZWRMaW5lLnZhbHVlID0gbnVsbDtcbiAgbGluZVBhbmVsUG9zLnZhbHVlID0gbnVsbDtcbiAgZHJhd2luZ3NTdG9yZS5zZWxlY3RlZFBvbHlJZCA9IGlkO1xuICBzZWxlY3RlZFBvbHkudmFsdWUgPSBkcmF3aW5nc1N0b3JlLmdldFBvbHlzRm9yKG1hcmtldC5pbnN0cnVtZW50KS5maW5kKChwKSA9PiBwLmlkID09PSBpZCkgPz8gbnVsbDtcbiAgcmVjYWxjUmVjdHMoKTtcbiAgcG9zaXRpb25Qb2x5UGFuZWwoaWQpO1xufVxuXG4vKiogQW5jaG9ycyB0aGUgZmxvYXRpbmcgZWRpdCBwYW5lbCB0byB0aGUgcG9seWxpbmUncyBMQVNUIGNvcm5lciwgY2xhbXBlZFxuICogIGluc2lkZSB0aGUgcGFuZSwgZmxpcHBpbmcgd2hlbiBvdXQgb2Ygcm9vbS4gKi9cbmZ1bmN0aW9uIHBvc2l0aW9uUG9seVBhbmVsKGlkOiBzdHJpbmcpOiB2b2lkIHtcbiAgY29uc3QgcHggPSBwb2x5UGl4ZWxzLnZhbHVlLmZpbmQoKHApID0+IHAuaWQgPT09IGlkKTtcbiAgY29uc3QgcGFuZSA9IGNvbnRhaW5lclJlZi52YWx1ZTtcbiAgaWYgKCFweCB8fCAhcGFuZSkgcmV0dXJuO1xuICBjb25zdCBjb3JuZXIgPSBweC5wdHNbcHgucHRzLmxlbmd0aCAtIDFdITtcbiAgcG9seVBhbmVsUG9zLnZhbHVlID0gY29tcHV0ZUNvcm5lclBhbmVsUG9zKGNvcm5lci54LCBjb3JuZXIueSwgcGFuZSwgcG9seVBhbmVsRWwudmFsdWUpO1xuICBpZiAoIXBvbHlQYW5lbEVsLnZhbHVlKSB7XG4gICAgdm9pZCBuZXh0VGljaygoKSA9PiB7XG4gICAgICBjb25zdCBzZWwgPSBzZWxlY3RlZFBvbHkudmFsdWU7XG4gICAgICBpZiAoIXBvbHlQYW5lbEVsLnZhbHVlIHx8ICFzZWwgfHwgIWNvbnRhaW5lclJlZi52YWx1ZSkgcmV0dXJuO1xuICAgICAgY29uc3QgcCA9IHBvbHlQaXhlbHMudmFsdWUuZmluZCgocSkgPT4gcS5pZCA9PT0gc2VsLmlkKTtcbiAgICAgIGlmIChwKSB7XG4gICAgICAgIGNvbnN0IGMgPSBwLnB0c1twLnB0cy5sZW5ndGggLSAxXSE7XG4gICAgICAgIHBvbHlQYW5lbFBvcy52YWx1ZSA9IGNvbXB1dGVDb3JuZXJQYW5lbFBvcyhjLngsIGMueSwgY29udGFpbmVyUmVmLnZhbHVlLCBwb2x5UGFuZWxFbC52YWx1ZSk7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cbn1cblxuLyoqIFNoYXJlZCBjb3JuZXItYW5jaG9yZWQgcGFuZWwgcGxhY2VtZW50ICh1c2VkIGJ5IHRyZW5kbGluZSArIHBvbHlsaW5lKS5cbiAqICBgZm9yY2VXYC9gZm9yY2VIYCBtYXkgYmUgcGFzc2VkIHNvIGEgZmlyc3QgcGFpbnQgd2l0aCBhIGhpZGRlbiBwYW5lbFxuICogIChkaXNwbGF5Omxlc3MgbWVhc3VyaW5nKSBuZXZlciBmbGlwcyB0byB0aGUgd3Jvbmcgc2lkZS4gKi9cbmZ1bmN0aW9uIGNvbXB1dGVDb3JuZXJQYW5lbFBvcyhcbiAgZXg6IG51bWJlcixcbiAgZXk6IG51bWJlcixcbiAgcGFuZTogSFRNTEVsZW1lbnQsXG4gIGVsOiBIVE1MRWxlbWVudCB8IG51bGwsXG4gIGZvcmNlVz86IG51bWJlcixcbiAgZm9yY2VIPzogbnVtYmVyXG4pOiB7IHg6IG51bWJlcjsgeTogbnVtYmVyIH0ge1xuICBjb25zdCB3ID0gZm9yY2VXICE9IG51bGwgPyBmb3JjZVcgOiBlbD8ub2Zmc2V0V2lkdGggfHwgUEFORUxfVztcbiAgY29uc3QgaCA9IGZvcmNlSCAhPSBudWxsID8gZm9yY2VIIDogZWw/Lm9mZnNldEhlaWdodCB8fCBQQU5FTF9IO1xuICBjb25zdCBnYXAgPSA4O1xuICBsZXQgeCA9IGV4ICsgZ2FwO1xuICBsZXQgeSA9IGV5IC0gaCAtIGdhcDtcbiAgaWYgKHggKyB3ID4gcGFuZS5jbGllbnRXaWR0aCAtIDYpIHggPSBleCAtIHcgLSBnYXA7XG4gIGlmICh5IDwgNCkgeSA9IGV5ICsgZ2FwO1xuICB4ID0gTWF0aC5taW4oTWF0aC5tYXgoNCwgeCksIE1hdGgubWF4KDQsIHBhbmUuY2xpZW50V2lkdGggLSB3IC0gNikpO1xuICB5ID0gTWF0aC5taW4oTWF0aC5tYXgoNCwgeSksIE1hdGgubWF4KDQsIHBhbmUuY2xpZW50SGVpZ2h0IC0gaCAtIDYpKTtcbiAgcmV0dXJuIHsgeCwgeSB9O1xufVxuXG4vKiogRHJhZyB0aGUgd2hvbGUgcG9seWxpbmUg4oCUIGV2ZXJ5IHZlcnRleCBtb3ZlcyB0b2dldGhlci4gKi9cbmZ1bmN0aW9uIG9uUG9seURyYWdTdGFydChlOiBNb3VzZUV2ZW50LCBpZDogc3RyaW5nKTogdm9pZCB7XG4gIGlmIChlLmJ1dHRvbiAhPT0gMCB8fCBkcmF3aW5nc1N0b3JlLmFjdGl2ZVRvb2wgIT09IFwiY3Vyc29yXCIpIHJldHVybjtcbiAgaWYgKCFhZGFwdGVyIHx8ICFjb250YWluZXJSZWYudmFsdWUpIHJldHVybjtcbiAgY29uc3QgcG9seSA9IGRyYXdpbmdzU3RvcmUuZ2V0UG9seXNGb3IobWFya2V0Lmluc3RydW1lbnQpLmZpbmQoKHApID0+IHAuaWQgPT09IGlkKTtcbiAgaWYgKCFwb2x5KSByZXR1cm47XG4gIGUucHJldmVudERlZmF1bHQoKTtcbiAgZS5zdG9wUHJvcGFnYXRpb24oKTtcbiAgcmVjdE1lbnUudmFsdWUgPSBudWxsO1xuICBjbG9zZVBhbGV0dGUoKTtcbiAgY2xlYXJTaW5nbGVTZWxlY3Rpb24oKTtcbiAgZHJhd2luZ3NTdG9yZS5zZWxlY3RlZElkID0gbnVsbDtcbiAgc2VsZWN0ZWRSZWN0LnZhbHVlID0gbnVsbDtcbiAgZWRpdFBhbmVsUG9zLnZhbHVlID0gbnVsbDtcbiAgZHJhd2luZ3NTdG9yZS5zZWxlY3RlZExpbmVJZCA9IG51bGw7XG4gIHNlbGVjdGVkTGluZS52YWx1ZSA9IG51bGw7XG4gIGxpbmVQYW5lbFBvcy52YWx1ZSA9IG51bGw7XG4gIGRyYXdpbmdzU3RvcmUuc2VsZWN0ZWRQb2x5SWQgPSBpZDtcbiAgc2VsZWN0ZWRQb2x5LnZhbHVlID0gcG9seTtcbiAgcmVjYWxjUmVjdHMoKTtcbiAgcG9zaXRpb25Qb2x5UGFuZWwoaWQpO1xuXG4gIGNvbnN0IHIwID0gY29udGFpbmVyUmVmLnZhbHVlLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuICBjb25zdCBzdGFydFQgPSBhZGFwdGVyLnhUb1RpbWUoZS5jbGllbnRYIC0gcjAubGVmdCk7XG4gIGNvbnN0IHN0YXJ0UCA9IGFkYXB0ZXIueVRvUHJpY2UoZS5jbGllbnRZIC0gcjAudG9wKTtcbiAgaWYgKHN0YXJ0VCA9PT0gbnVsbCB8fCBzdGFydFAgPT09IG51bGwpIHJldHVybjtcbiAgY29uc3Qgb3JpZyA9IHBvbHkucG9pbnRzLm1hcCgocHQpID0+ICh7IC4uLnB0IH0pKTtcblxuICBjb25zdCBvbk1vdmUgPSAoZXY6IE1vdXNlRXZlbnQpID0+IHtcbiAgICBpZiAoIWFkYXB0ZXIgfHwgIWNvbnRhaW5lclJlZi52YWx1ZSkgcmV0dXJuO1xuICAgIGNvbnN0IHIgPSBjb250YWluZXJSZWYudmFsdWUuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gICAgY29uc3QgdCA9IGFkYXB0ZXIueFRvVGltZShldi5jbGllbnRYIC0gci5sZWZ0KTtcbiAgICBjb25zdCBwID0gYWRhcHRlci55VG9QcmljZShldi5jbGllbnRZIC0gci50b3ApO1xuICAgIGlmICh0ID09PSBudWxsIHx8IHAgPT09IG51bGwpIHJldHVybjtcbiAgICBjb25zdCBkdCA9IHQgLSBzdGFydFQ7XG4gICAgY29uc3QgZHAgPSBwIC0gc3RhcnRQO1xuICAgIGRyYXdpbmdzU3RvcmUudXBkYXRlUG9seVBvaW50cyhcbiAgICAgIG1hcmtldC5pbnN0cnVtZW50LFxuICAgICAgaWQsXG4gICAgICBvcmlnLm1hcCgocHQpID0+ICh7IHRpbWU6IHB0LnRpbWUgKyBkdCwgcHJpY2U6IHB0LnByaWNlICsgZHAgfSkpXG4gICAgKTtcbiAgICBjb25zdCB1cGRhdGVkID0gZHJhd2luZ3NTdG9yZS5nZXRQb2x5c0ZvcihtYXJrZXQuaW5zdHJ1bWVudCkuZmluZCgoeCkgPT4geC5pZCA9PT0gaWQpO1xuICAgIGlmICh1cGRhdGVkKSBzZWxlY3RlZFBvbHkudmFsdWUgPSB1cGRhdGVkO1xuICAgIHJlY2FsY1JlY3RzKCk7XG4gICAgcG9zaXRpb25Qb2x5UGFuZWwoaWQpO1xuICB9O1xuICBjb25zdCBvblVwID0gKCkgPT4ge1xuICAgIHdpbmRvdy5yZW1vdmVFdmVudExpc3RlbmVyKFwicG9pbnRlcm1vdmVcIiwgb25Nb3ZlKTtcbiAgICB3aW5kb3cucmVtb3ZlRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJ1cFwiLCBvblVwKTtcbiAgfTtcbiAgd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoXCJwb2ludGVybW92ZVwiLCBvbk1vdmUpO1xuICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJ1cFwiLCBvblVwKTtcbn1cblxuLyoqIERyYWcgb25lIHZlcnRleCAoXCJjb3JuZXJcIikgb2YgdGhlIHBvbHlsaW5lOyB0aGUgb3RoZXIgdmVydGljZXMgc3RheS4gKi9cbmZ1bmN0aW9uIG9uUG9seVZlcnRleFN0YXJ0KGU6IE1vdXNlRXZlbnQsIGlkOiBzdHJpbmcsIGluZGV4OiBudW1iZXIpOiB2b2lkIHtcbiAgaWYgKGUuYnV0dG9uICE9PSAwIHx8ICFhZGFwdGVyIHx8ICFjb250YWluZXJSZWYudmFsdWUpIHJldHVybjtcbiAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICBlLnN0b3BQcm9wYWdhdGlvbigpO1xuICByZWN0TWVudS52YWx1ZSA9IG51bGw7XG4gIGNsb3NlUGFsZXR0ZSgpO1xuXG4gIGNvbnN0IG9uTW92ZSA9IChldjogTW91c2VFdmVudCkgPT4ge1xuICAgIGlmICghYWRhcHRlciB8fCAhY29udGFpbmVyUmVmLnZhbHVlKSByZXR1cm47XG4gICAgY29uc3QgciA9IGNvbnRhaW5lclJlZi52YWx1ZS5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgICBjb25zdCB0ID0gYWRhcHRlci54VG9UaW1lKGV2LmNsaWVudFggLSByLmxlZnQpO1xuICAgIGNvbnN0IHAgPSBhZGFwdGVyLnlUb1ByaWNlKGV2LmNsaWVudFkgLSByLnRvcCk7XG4gICAgaWYgKHQgPT09IG51bGwgfHwgcCA9PT0gbnVsbCkgcmV0dXJuO1xuICAgIGNvbnN0IHMgPSBzbmFwVG9DYW5kbGUodCwgcCwgbWFnbmV0QWN0aXZlLnZhbHVlKTtcbiAgICBjb25zdCBwb2x5ID0gZHJhd2luZ3NTdG9yZS5nZXRQb2x5c0ZvcihtYXJrZXQuaW5zdHJ1bWVudCkuZmluZCgoeCkgPT4geC5pZCA9PT0gaWQpO1xuICAgIGlmICghcG9seSB8fCAhcG9seS5wb2ludHNbaW5kZXhdKSByZXR1cm47XG4gICAgY29uc3QgbmV4dCA9IHBvbHkucG9pbnRzLm1hcCgocHQsIGkpID0+IChpID09PSBpbmRleCA/IHsgdGltZTogcy50aW1lLCBwcmljZTogcy5wcmljZSB9IDogeyAuLi5wdCB9KSk7XG4gICAgZHJhd2luZ3NTdG9yZS51cGRhdGVQb2x5UG9pbnRzKG1hcmtldC5pbnN0cnVtZW50LCBpZCwgbmV4dCk7XG4gICAgY29uc3QgdXBkYXRlZCA9IGRyYXdpbmdzU3RvcmUuZ2V0UG9seXNGb3IobWFya2V0Lmluc3RydW1lbnQpLmZpbmQoKHgpID0+IHguaWQgPT09IGlkKTtcbiAgICBpZiAodXBkYXRlZCkgc2VsZWN0ZWRQb2x5LnZhbHVlID0gdXBkYXRlZDtcbiAgICByZWNhbGNSZWN0cygpO1xuICAgIHBvc2l0aW9uUG9seVBhbmVsKGlkKTtcbiAgfTtcbiAgY29uc3Qgb25VcCA9ICgpID0+IHtcbiAgICB3aW5kb3cucmVtb3ZlRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJtb3ZlXCIsIG9uTW92ZSk7XG4gICAgd2luZG93LnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJwb2ludGVydXBcIiwgb25VcCk7XG4gIH07XG4gIHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKFwicG9pbnRlcm1vdmVcIiwgb25Nb3ZlKTtcbiAgd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoXCJwb2ludGVydXBcIiwgb25VcCk7XG59XG5cbmZ1bmN0aW9uIGRlbGV0ZVNlbGVjdGVkUG9seSgpOiB2b2lkIHtcbiAgaWYgKCFzZWxlY3RlZFBvbHkudmFsdWUpIHJldHVybjtcbiAgZHJhd2luZ3NTdG9yZS5yZW1vdmVQb2x5KG1hcmtldC5pbnN0cnVtZW50LCBzZWxlY3RlZFBvbHkudmFsdWUuaWQpO1xuICBzZWxlY3RlZFBvbHkudmFsdWUgPSBudWxsO1xuICBwb2x5UGFuZWxQb3MudmFsdWUgPSBudWxsO1xuICBwb2x5UGFsZXR0ZU9wZW4udmFsdWUgPSBmYWxzZTtcbiAgcmVjYWxjUmVjdHMoKTtcbn1cblxuZnVuY3Rpb24gc2V0UG9seUNvbG9yU2VsZWN0ZWQoY29sb3I6IHN0cmluZyk6IHZvaWQge1xuICBpZiAoIXNlbGVjdGVkUG9seS52YWx1ZSkgcmV0dXJuO1xuICBkcmF3aW5nc1N0b3JlLnVwZGF0ZVBvbHlTdHlsZShtYXJrZXQuaW5zdHJ1bWVudCwgc2VsZWN0ZWRQb2x5LnZhbHVlLmlkLCB7IGNvbG9yIH0pO1xuICBzeW5jU2VsZWN0ZWRQb2x5KCk7XG59XG5cbmZ1bmN0aW9uIHNldFBvbHlEYXNoU2VsZWN0ZWQoZGFzaDogRGFzaFN0eWxlKTogdm9pZCB7XG4gIGlmICghc2VsZWN0ZWRQb2x5LnZhbHVlKSByZXR1cm47XG4gIGRyYXdpbmdzU3RvcmUudXBkYXRlUG9seVN0eWxlKG1hcmtldC5pbnN0cnVtZW50LCBzZWxlY3RlZFBvbHkudmFsdWUuaWQsIHsgZGFzaCB9KTtcbiAgc3luY1NlbGVjdGVkUG9seSgpO1xufVxuXG4vKiogVG9nZ2xlIHRoZSBhcnJvd2hlYWQgb24gdGhlIHBvbHlsaW5lJ3MgbGFzdCBjb3JuZXIuICovXG5mdW5jdGlvbiB0b2dnbGVBcnJvd1NlbGVjdGVkKCk6IHZvaWQge1xuICBpZiAoIXNlbGVjdGVkUG9seS52YWx1ZSkgcmV0dXJuO1xuICBkcmF3aW5nc1N0b3JlLnVwZGF0ZVBvbHlTdHlsZShtYXJrZXQuaW5zdHJ1bWVudCwgc2VsZWN0ZWRQb2x5LnZhbHVlLmlkLCB7XG4gICAgYXJyb3c6IHNlbGVjdGVkUG9seS52YWx1ZS5hcnJvdyA9PT0gZmFsc2UsXG4gIH0pO1xuICBzeW5jU2VsZWN0ZWRQb2x5KCk7XG59XG5cbi8qKiBSZS1yZWFkIHRoZSBzZWxlY3RlZCBwb2x5bGluZSBmcm9tIHRoZSBzdG9yZSBhbmQgcmVmcmVzaCB0aGUgb3ZlcmxheS4gKi9cbmZ1bmN0aW9uIHN5bmNTZWxlY3RlZFBvbHkoKTogdm9pZCB7XG4gIGlmICghc2VsZWN0ZWRQb2x5LnZhbHVlKSByZXR1cm47XG4gIGNvbnN0IHVwZGF0ZWQgPSBkcmF3aW5nc1N0b3JlLmdldFBvbHlzRm9yKG1hcmtldC5pbnN0cnVtZW50KS5maW5kKChwKSA9PiBwLmlkID09PSBzZWxlY3RlZFBvbHkudmFsdWUhLmlkKTtcbiAgaWYgKHVwZGF0ZWQpIHNlbGVjdGVkUG9seS52YWx1ZSA9IHVwZGF0ZWQ7XG4gIHJlY2FsY1JlY3RzKCk7XG59XG5cbi8qIOKUgOKUgCBMb25nIC8gU2hvcnQgcG9zaXRpb24gaW50ZXJhY3Rpb24g4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAICovXG5cbi8qKiBGaXJzdCBjbGljayBvZiB0aGUgcG9zaXRpb24gdG9vbDogc2V0cyB0aGUgZW50cnkgcHJpY2UgYW5kIHRoZSBsZWZ0XG4gKiAgZWRnZTsgdGhlIHByZXZpZXcgdGhlbiBmb2xsb3dzIHRoZSBtb3VzZSB1bnRpbCB0aGUgc2Vjb25kIGNsaWNrLiAqL1xuZnVuY3Rpb24gYmVnaW5Qb3MoZTogTW91c2VFdmVudCk6IHZvaWQge1xuICBpZiAoIWFkYXB0ZXIgfHwgIWNvbnRhaW5lclJlZi52YWx1ZSkgcmV0dXJuO1xuICBjb25zdCByID0gY29udGFpbmVyUmVmLnZhbHVlLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuICBjb25zdCB0ID0gYWRhcHRlci54VG9UaW1lKGUuY2xpZW50WCAtIHIubGVmdCk7XG4gIGNvbnN0IHAgPSBhZGFwdGVyLnlUb1ByaWNlKGUuY2xpZW50WSAtIHIudG9wKTtcbiAgaWYgKHQgPT09IG51bGwgfHwgcCA9PT0gbnVsbCkgcmV0dXJuO1xuICBjb25zdCBzID0gc25hcFRvQ2FuZGxlKHQsIHAsIG1hZ25ldEFjdGl2ZS52YWx1ZSk7XG4gIHBvc1N0YXRlLnZhbHVlID0geyB0aW1lMTogcy50aW1lLCBlbnRyeTogcy5wcmljZSB9O1xuICBwb3NDdXJzb3IudmFsdWUgPSB7IHRpbWU6IHMudGltZSwgcHJpY2U6IHMucHJpY2UgfTtcbiAgcmVjYWxjUmVjdHMoKTtcbiAgc3RvcFBvc0N1cnNvcigpO1xuICBjb25zdCBtb3ZlID0gKGV2OiBNb3VzZUV2ZW50KSA9PiB7XG4gICAgaWYgKCFwb3NTdGF0ZS52YWx1ZSB8fCAhYWRhcHRlciB8fCAhY29udGFpbmVyUmVmLnZhbHVlKSByZXR1cm47XG4gICAgY29uc3QgcnIgPSBjb250YWluZXJSZWYudmFsdWUuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gICAgY29uc3QgY3QgPSBhZGFwdGVyLnhUb1RpbWUoZXYuY2xpZW50WCAtIHJyLmxlZnQpO1xuICAgIGNvbnN0IGNwID0gYWRhcHRlci55VG9QcmljZShldi5jbGllbnRZIC0gcnIudG9wKTtcbiAgICBpZiAoY3QgIT09IG51bGwgJiYgY3AgIT09IG51bGwpIHtcbiAgICAgIGNvbnN0IGNzID0gc25hcFRvQ2FuZGxlKGN0LCBjcCwgbWFnbmV0QWN0aXZlLnZhbHVlKTtcbiAgICAgIHBvc0N1cnNvci52YWx1ZSA9IHsgdGltZTogY3MudGltZSwgcHJpY2U6IGNzLnByaWNlIH07XG4gICAgfVxuICAgIHJlY2FsY1JlY3RzKCk7XG4gIH07XG4gIHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKFwicG9pbnRlcm1vdmVcIiwgbW92ZSk7XG4gIG9uUG9zTW92ZVJlZiA9IG1vdmU7XG59XG5cbmZ1bmN0aW9uIHN0b3BQb3NDdXJzb3IoKTogdm9pZCB7XG4gIGlmIChvblBvc01vdmVSZWYpIHtcbiAgICB3aW5kb3cucmVtb3ZlRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJtb3ZlXCIsIG9uUG9zTW92ZVJlZik7XG4gICAgb25Qb3NNb3ZlUmVmID0gbnVsbDtcbiAgfVxufVxuXG4vKiogU2Vjb25kIGNsaWNrIG9mIHRoZSBwb3NpdGlvbiB0b29sOiBzZXRzIHRoZSBTTCDigJQgYmVsb3cgdGhlIGVudHJ5IGl0J3MgYVxuICogIExPTkcsIGFib3ZlIGl0IGEgU0hPUlQuIFRoZSByaWdodCBlZGdlIGlzIHRoZSBzZWNvbmQgY2xpY2sncyB0aW1lIGFuZCB0aGVcbiAqICBUUCBkZWZhdWx0cyB0byAyUiBmcm9tIHRoZSBlbnRyeSAoUiA9IHxlbnRyeSDiiJIgU0x8KS4gKi9cbmZ1bmN0aW9uIGZpbmFsaXplUG9zKGU6IE1vdXNlRXZlbnQpOiB2b2lkIHtcbiAgaWYgKCFhZGFwdGVyIHx8ICFjb250YWluZXJSZWYudmFsdWUpIHJldHVybjtcbiAgY29uc3Qgc3QgPSBwb3NTdGF0ZS52YWx1ZTtcbiAgcG9zU3RhdGUudmFsdWUgPSBudWxsO1xuICBwb3NDdXJzb3IudmFsdWUgPSBudWxsO1xuICBzdG9wUG9zQ3Vyc29yKCk7XG4gIGlmIChzdCkge1xuICAgIGNvbnN0IHIgPSBjb250YWluZXJSZWYudmFsdWUuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gICAgY29uc3QgdCA9IGFkYXB0ZXIueFRvVGltZShlLmNsaWVudFggLSByLmxlZnQpO1xuICAgIGNvbnN0IHAgPSBhZGFwdGVyLnlUb1ByaWNlKGUuY2xpZW50WSAtIHIudG9wKTtcbiAgICBpZiAodCAhPT0gbnVsbCAmJiBwICE9PSBudWxsKSB7XG4gICAgICAvLyBTbmFwIHRoZSBTTCBhbmNob3IgdG8gdGhlIGNhbmRsZSBoaWdoL2xvdyB1bmRlciB0aGUgbWFnbmV0XG4gICAgICBjb25zdCBzID0gc25hcFRvQ2FuZGxlKHQsIHAsIG1hZ25ldEFjdGl2ZS52YWx1ZSk7XG4gICAgICBpZiAoTWF0aC5hYnMocy5wcmljZSAtIHN0LmVudHJ5KSA+IDApIHtcbiAgICAgICAgY29uc3QgbG9uZyA9IHMucHJpY2UgPCBzdC5lbnRyeTtcbiAgICAgICAgY29uc3QgcmlzayA9IE1hdGguYWJzKHN0LmVudHJ5IC0gcy5wcmljZSk7XG4gICAgICAgIGRyYXdpbmdzU3RvcmUuYWRkUG9zaXRpb24obWFya2V0Lmluc3RydW1lbnQsIHtcbiAgICAgICAgICBkaXJlY3Rpb246IGxvbmcgPyBcImxvbmdcIiA6IFwic2hvcnRcIixcbiAgICAgICAgICB0aW1lMTogc3QudGltZTEsXG4gICAgICAgICAgdGltZTI6IHMudGltZSxcbiAgICAgICAgICBlbnRyeTogc3QuZW50cnksXG4gICAgICAgICAgc2w6IHMucHJpY2UsXG4gICAgICAgICAgdHA6IHN0LmVudHJ5ICsgKGxvbmcgPyAxIDogLTEpICogMyAqIHJpc2ssIC8vIGRlZmF1bHQgUjpSIDE6M1xuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgZHJhd2luZ3NTdG9yZS5hY3RpdmVUb29sID0gXCJjdXJzb3JcIjtcbiAgcmVjYWxjUmVjdHMoKTtcbn1cblxuLyoqIERlc2VsZWN0IGV2ZXJ5dGhpbmcgZWxzZSBhbmQgc2VsZWN0IHRoaXMgcG9zaXRpb24sIG9wZW5pbmcgaXRzIHBhbmVsLiAqL1xuZnVuY3Rpb24gb25Qb3NDbGljayhpZDogc3RyaW5nLCBlOiBNb3VzZUV2ZW50KTogdm9pZCB7XG4gIGUuc3RvcFByb3BhZ2F0aW9uKCk7XG4gIHJlY3RNZW51LnZhbHVlID0gbnVsbDtcbiAgY2xvc2VQYWxldHRlKCk7XG4gIGNsZWFyU2luZ2xlU2VsZWN0aW9uKCk7XG4gIGlmIChkcmF3aW5nc1N0b3JlLmFjdGl2ZVRvb2wgIT09IFwiY3Vyc29yXCIpIGRyYXdpbmdzU3RvcmUuYWN0aXZlVG9vbCA9IFwiY3Vyc29yXCI7XG4gIGRyYXdpbmdzU3RvcmUuc2VsZWN0ZWRJZCA9IG51bGw7XG4gIHNlbGVjdGVkUmVjdC52YWx1ZSA9IG51bGw7XG4gIGVkaXRQYW5lbFBvcy52YWx1ZSA9IG51bGw7XG4gIGRyYXdpbmdzU3RvcmUuc2VsZWN0ZWRMaW5lSWQgPSBudWxsO1xuICBzZWxlY3RlZExpbmUudmFsdWUgPSBudWxsO1xuICBsaW5lUGFuZWxQb3MudmFsdWUgPSBudWxsO1xuICBkcmF3aW5nc1N0b3JlLnNlbGVjdGVkUG9seUlkID0gbnVsbDtcbiAgc2VsZWN0ZWRQb2x5LnZhbHVlID0gbnVsbDtcbiAgcG9seVBhbmVsUG9zLnZhbHVlID0gbnVsbDtcbiAgZHJhd2luZ3NTdG9yZS5zZWxlY3RlZFBvc2l0aW9uSWQgPSBpZDtcbiAgc2VsZWN0ZWRQb3MudmFsdWUgPSBkcmF3aW5nc1N0b3JlLmdldFBvc2l0aW9uc0ZvcihtYXJrZXQuaW5zdHJ1bWVudCkuZmluZCgocCkgPT4gcC5pZCA9PT0gaWQpID8/IG51bGw7XG4gIHJlY2FsY1JlY3RzKCk7XG4gIHBvc2l0aW9uUG9zUGFuZWwoaWQpO1xufVxuXG4vKiogUGFuZWwgYW5jaG9yZWQgdG8gdGhlIHBvc2l0aW9uJ3MgdG9wLXJpZ2h0IGNvcm5lciAocHJvZml0LWJveCBzaWRlKS5cbiAqICBXaGVuIHRoZSBwb3NpdGlvbiBpcyBzbWFsbCB0aGUgJS9waXBzIHN0YXRzIHNpdCBhYm92ZSB0aGUgVFAgbGluZSwgc29cbiAqICB0aGUgcGFuZWwgaXMgbGlmdGVkIGhpZ2hlciB0byBuZXZlciBjb3ZlciB0aGVtLiBUaGUgcGFuZWwncyByZWFsIHNpemUgaXNcbiAqICBjYWNoZWQgKG1lYXN1cmVkIGV2ZW4gd2hpbGUgdmlzaWJpbGl0eS1oaWRkZW4pIHNvIHRoZSBmaXJzdCBwbGFjZW1lbnQg4oCUXG4gKiAgaW5jbHVkaW5nIHRoZSBsZWZ0L3JpZ2h0IGZsaXAgZGVjaXNpb24g4oCUIGlzIGFscmVhZHkgY29ycmVjdC4gKi9cbmxldCBwb3NQYW5lbFcgPSAwO1xubGV0IHBvc1BhbmVsSCA9IDA7XG5mdW5jdGlvbiBwb3NpdGlvblBvc1BhbmVsKGlkOiBzdHJpbmcpOiB2b2lkIHtcbiAgY29uc3QgcHggPSBwb3NQaXhlbHMudmFsdWUuZmluZCgocCkgPT4gcC5pZCA9PT0gaWQpO1xuICBjb25zdCBwYW5lID0gY29udGFpbmVyUmVmLnZhbHVlO1xuICBpZiAoIXB4IHx8ICFwYW5lKSByZXR1cm47XG4gIGNvbnN0IHRvcFkgPSBNYXRoLm1pbihweC50cFksIHB4LmVudHJ5WSk7XG4gIGNvbnN0IGFuY2hvclkgPSBweC53aWR0aCA+PSAxNDAgPyB0b3BZIDogdG9wWSAtIDM1O1xuICBjb25zdCBwbGFjZSA9ICgpID0+IHtcbiAgICBjb25zdCBwMiA9IHBvc1BpeGVscy52YWx1ZS5maW5kKChxKSA9PiBxLmlkID09PSBpZCk7XG4gICAgaWYgKCFwMiB8fCAhY29udGFpbmVyUmVmLnZhbHVlKSByZXR1cm47XG4gICAgY29uc3QgdDIgPSBNYXRoLm1pbihwMi50cFksIHAyLmVudHJ5WSk7XG4gICAgcG9zUGFuZWxQb3MudmFsdWUgPSBjb21wdXRlQ29ybmVyUGFuZWxQb3MoXG4gICAgICBwMi5sZWZ0ICsgcDIud2lkdGgsXG4gICAgICBwMi53aWR0aCA+PSAxNDAgPyB0MiA6IHQyIC0gMzUsXG4gICAgICBjb250YWluZXJSZWYudmFsdWUsXG4gICAgICBwb3NQYW5lbEVsLnZhbHVlLFxuICAgICAgcG9zUGFuZWxXIHx8IHVuZGVmaW5lZCxcbiAgICAgIHBvc1BhbmVsSCB8fCB1bmRlZmluZWRcbiAgICApO1xuICB9O1xuICBwb3NQYW5lbFBvcy52YWx1ZSA9IGNvbXB1dGVDb3JuZXJQYW5lbFBvcyhcbiAgICBweC5sZWZ0ICsgcHgud2lkdGgsXG4gICAgYW5jaG9yWSxcbiAgICBwYW5lLFxuICAgIHBvc1BhbmVsRWwudmFsdWUsXG4gICAgcG9zUGFuZWxXIHx8IHVuZGVmaW5lZCxcbiAgICBwb3NQYW5lbEggfHwgdW5kZWZpbmVkXG4gICk7XG4gIGlmICghcG9zUGFuZWxFbC52YWx1ZSkge1xuICAgIHBvc1BhbmVsUmVhZHkudmFsdWUgPSBmYWxzZTtcbiAgICB2b2lkIG5leHRUaWNrKCgpID0+IHtcbiAgICAgIGlmICghcG9zUGFuZWxFbC52YWx1ZSkgcmV0dXJuO1xuICAgICAgcG9zUGFuZWxXID0gcG9zUGFuZWxFbC52YWx1ZS5vZmZzZXRXaWR0aDtcbiAgICAgIHBvc1BhbmVsSCA9IHBvc1BhbmVsRWwudmFsdWUub2Zmc2V0SGVpZ2h0O1xuICAgICAgcGxhY2UoKTtcbiAgICAgIHBvc1BhbmVsUmVhZHkudmFsdWUgPSB0cnVlO1xuICAgIH0pO1xuICB9IGVsc2Uge1xuICAgIHBvc1BhbmVsVyA9IHBvc1BhbmVsRWwudmFsdWUub2Zmc2V0V2lkdGg7XG4gICAgcG9zUGFuZWxIID0gcG9zUGFuZWxFbC52YWx1ZS5vZmZzZXRIZWlnaHQ7XG4gICAgcG9zUGFuZWxSZWFkeS52YWx1ZSA9IHRydWU7XG4gIH1cbn1cblxuLyoqIE5ldmVyIGxldCBhIGxldmVsIGNyb3NzIGl0cyBuZWlnaGJvdXI6IFNMIHN0YXlzIG9uIHRoZSBsb3NzIHNpZGUgb2YgdGhlXG4gKiAgZW50cnksIFRQIG9uIHRoZSBwcm9maXQgc2lkZSwgZW50cnkgYmV0d2VlbiB0aGUgdHdvLiAqL1xuZnVuY3Rpb24gY2xhbXBQb3NQcmljZShcbiAgY3VyOiBEcmF3aW5nUG9zaXRpb24sXG4gIHdoaWNoOiBcInRwXCIgfCBcImVudHJ5XCIgfCBcInNsXCIsXG4gIHByaWNlOiBudW1iZXJcbik6IG51bWJlciB7XG4gIGNvbnN0IGxvbmcgPSBjdXIuZGlyZWN0aW9uICE9PSBcInNob3J0XCI7XG4gIGlmICh3aGljaCA9PT0gXCJzbFwiKSByZXR1cm4gbG9uZyA/IE1hdGgubWluKHByaWNlLCBjdXIuZW50cnkpIDogTWF0aC5tYXgocHJpY2UsIGN1ci5lbnRyeSk7XG4gIGlmICh3aGljaCA9PT0gXCJ0cFwiKSByZXR1cm4gbG9uZyA/IE1hdGgubWF4KHByaWNlLCBjdXIuZW50cnkpIDogTWF0aC5taW4ocHJpY2UsIGN1ci5lbnRyeSk7XG4gIGNvbnN0IGxvID0gTWF0aC5taW4oY3VyLnNsLCBjdXIudHApO1xuICBjb25zdCBoaSA9IE1hdGgubWF4KGN1ci5zbCwgY3VyLnRwKTtcbiAgcmV0dXJuIE1hdGgubWluKE1hdGgubWF4KHByaWNlLCBsbyksIGhpKTtcbn1cblxuLyoqIERyYWcgb25lIHByaWNlIGxldmVsICh0cCAvIGVudHJ5IC8gc2wpIHZlcnRpY2FsbHk7IHRoZSBvdGhlcnMgc3RheS4gKi9cbmZ1bmN0aW9uIG9uUG9zTGV2ZWxTdGFydChlOiBNb3VzZUV2ZW50LCBpZDogc3RyaW5nLCB3aGljaDogXCJ0cFwiIHwgXCJlbnRyeVwiIHwgXCJzbFwiKTogdm9pZCB7XG4gIGlmIChlLmJ1dHRvbiAhPT0gMCB8fCAhYWRhcHRlciB8fCAhY29udGFpbmVyUmVmLnZhbHVlKSByZXR1cm47XG4gIGUucHJldmVudERlZmF1bHQoKTtcbiAgZS5zdG9wUHJvcGFnYXRpb24oKTtcbiAgcmVjdE1lbnUudmFsdWUgPSBudWxsO1xuICBjbG9zZVBhbGV0dGUoKTtcblxuICBjb25zdCBvbk1vdmUgPSAoZXY6IE1vdXNlRXZlbnQpID0+IHtcbiAgICBpZiAoIWFkYXB0ZXIgfHwgIWNvbnRhaW5lclJlZi52YWx1ZSkgcmV0dXJuO1xuICAgIGNvbnN0IHIgPSBjb250YWluZXJSZWYudmFsdWUuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gICAgY29uc3QgdCA9IGFkYXB0ZXIueFRvVGltZShldi5jbGllbnRYIC0gci5sZWZ0KTtcbiAgICBjb25zdCBwID0gYWRhcHRlci55VG9QcmljZShldi5jbGllbnRZIC0gci50b3ApO1xuICAgIGlmICh0ID09PSBudWxsIHx8IHAgPT09IG51bGwpIHJldHVybjtcbiAgICAvLyBNYWduZXQ6IHNuYXAgdGhlIGxldmVsIHRvIHRoZSBjYW5kbGUgaGlnaC9sb3cgdW5kZXIgdGhlIGN1cnNvclxuICAgIGNvbnN0IHNwID0gc25hcFRvQ2FuZGxlKHQsIHAsIG1hZ25ldEFjdGl2ZS52YWx1ZSkucHJpY2U7XG4gICAgY29uc3QgY3VyID0gZHJhd2luZ3NTdG9yZS5nZXRQb3NpdGlvbnNGb3IobWFya2V0Lmluc3RydW1lbnQpLmZpbmQoKHgpID0+IHguaWQgPT09IGlkKTtcbiAgICBjb25zdCBwcmljZSA9IGN1ciA/IGNsYW1wUG9zUHJpY2UoY3VyLCB3aGljaCwgc3ApIDogc3A7XG4gICAgZHJhd2luZ3NTdG9yZS51cGRhdGVQb3NpdGlvbihtYXJrZXQuaW5zdHJ1bWVudCwgaWQsIHsgW3doaWNoXTogcHJpY2UgfSk7XG4gICAgY29uc3QgdXBkYXRlZCA9IGRyYXdpbmdzU3RvcmUuZ2V0UG9zaXRpb25zRm9yKG1hcmtldC5pbnN0cnVtZW50KS5maW5kKCh4KSA9PiB4LmlkID09PSBpZCk7XG4gICAgaWYgKHVwZGF0ZWQpIHNlbGVjdGVkUG9zLnZhbHVlID0gdXBkYXRlZDtcbiAgICByZWNhbGNSZWN0cygpO1xuICAgIHBvc2l0aW9uUG9zUGFuZWwoaWQpO1xuICB9O1xuICBjb25zdCBvblVwID0gKCkgPT4ge1xuICAgIHdpbmRvdy5yZW1vdmVFdmVudExpc3RlbmVyKFwicG9pbnRlcm1vdmVcIiwgb25Nb3ZlKTtcbiAgICB3aW5kb3cucmVtb3ZlRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJ1cFwiLCBvblVwKTtcbiAgfTtcbiAgd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoXCJwb2ludGVybW92ZVwiLCBvbk1vdmUpO1xuICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJ1cFwiLCBvblVwKTtcbn1cblxuLyoqIERyYWcgYSB2ZXJ0aWNhbCB0aW1lIGVkZ2UgKGxlZnQgLyByaWdodCkgaG9yaXpvbnRhbGx5LiAqL1xuZnVuY3Rpb24gb25Qb3NFZGdlU3RhcnQoZTogTW91c2VFdmVudCwgaWQ6IHN0cmluZywgd2hpY2g6IFwidGltZTFcIiB8IFwidGltZTJcIik6IHZvaWQge1xuICBpZiAoZS5idXR0b24gIT09IDAgfHwgIWFkYXB0ZXIgfHwgIWNvbnRhaW5lclJlZi52YWx1ZSkgcmV0dXJuO1xuICBlLnByZXZlbnREZWZhdWx0KCk7XG4gIGUuc3RvcFByb3BhZ2F0aW9uKCk7XG4gIHJlY3RNZW51LnZhbHVlID0gbnVsbDtcbiAgY2xvc2VQYWxldHRlKCk7XG5cbiAgY29uc3Qgb25Nb3ZlID0gKGV2OiBNb3VzZUV2ZW50KSA9PiB7XG4gICAgaWYgKCFhZGFwdGVyIHx8ICFjb250YWluZXJSZWYudmFsdWUpIHJldHVybjtcbiAgICBjb25zdCByID0gY29udGFpbmVyUmVmLnZhbHVlLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuICAgIGNvbnN0IHQgPSBhZGFwdGVyLnhUb1RpbWUoZXYuY2xpZW50WCAtIHIubGVmdCk7XG4gICAgaWYgKHQgPT09IG51bGwpIHJldHVybjtcbiAgICAvLyBNYWduZXQ6IHNuYXAgdGhlIGVkZ2UgdG8gdGhlIGNhbmRsZSB1bmRlciB0aGUgY3Vyc29yIChuZWVkcyBhIHByaWNlXG4gICAgLy8gZm9yIHRoZSBzbmFwIGxvb2t1cDsgb25seSB0aGUgc25hcHBlZCB0aW1lIGlzIGFwcGxpZWQpXG4gICAgY29uc3QgcCA9IGFkYXB0ZXIueVRvUHJpY2UoZXYuY2xpZW50WSAtIHIudG9wKTtcbiAgICBjb25zdCBzdCA9IHAgIT09IG51bGwgPyBzbmFwVG9DYW5kbGUodCwgcCwgbWFnbmV0QWN0aXZlLnZhbHVlKSA6IG51bGw7XG4gICAgZHJhd2luZ3NTdG9yZS51cGRhdGVQb3NpdGlvbihtYXJrZXQuaW5zdHJ1bWVudCwgaWQsIHsgW3doaWNoXTogc3QgPyBzdC50aW1lIDogdCB9KTtcbiAgICBjb25zdCB1cGRhdGVkID0gZHJhd2luZ3NTdG9yZS5nZXRQb3NpdGlvbnNGb3IobWFya2V0Lmluc3RydW1lbnQpLmZpbmQoKHgpID0+IHguaWQgPT09IGlkKTtcbiAgICBpZiAodXBkYXRlZCkgc2VsZWN0ZWRQb3MudmFsdWUgPSB1cGRhdGVkO1xuICAgIHJlY2FsY1JlY3RzKCk7XG4gICAgcG9zaXRpb25Qb3NQYW5lbChpZCk7XG4gIH07XG4gIGNvbnN0IG9uVXAgPSAoKSA9PiB7XG4gICAgd2luZG93LnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJwb2ludGVybW92ZVwiLCBvbk1vdmUpO1xuICAgIHdpbmRvdy5yZW1vdmVFdmVudExpc3RlbmVyKFwicG9pbnRlcnVwXCIsIG9uVXApO1xuICB9O1xuICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJtb3ZlXCIsIG9uTW92ZSk7XG4gIHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKFwicG9pbnRlcnVwXCIsIG9uVXApO1xufVxuXG4vKiogRHJhZyBhIGNvcm5lciBoYW5kbGUgb2YgdGhlIHBvc2l0aW9uOiB2ZXJ0aWNhbCBtb3ZlbWVudCByZXNpemVzIHRoYXRcbiAqICBsZXZlbCdzIHByaWNlLCBob3Jpem9udGFsIG1vdmVtZW50IHJlc2l6ZXMgdGhlIHdpZHRoIG9uIHRoYXQgc2lkZVxuICogIChsZWZ0IGNvcm5lcnMgbW92ZSB0aGUgbGVmdCBlZGdlLCByaWdodCBjb3JuZXJzIHRoZSByaWdodCBlZGdlKS4gKi9cbmZ1bmN0aW9uIG9uUG9zQ29ybmVyU3RhcnQoXG4gIGU6IE1vdXNlRXZlbnQsXG4gIGlkOiBzdHJpbmcsXG4gIHdoaWNoOiBcInRwXCIgfCBcImVudHJ5XCIgfCBcInNsXCIsXG4gIHNpZGU6IFwidGltZTFcIiB8IFwidGltZTJcIlxuKTogdm9pZCB7XG4gIGlmIChlLmJ1dHRvbiAhPT0gMCB8fCAhYWRhcHRlciB8fCAhY29udGFpbmVyUmVmLnZhbHVlKSByZXR1cm47XG4gIGUucHJldmVudERlZmF1bHQoKTtcbiAgZS5zdG9wUHJvcGFnYXRpb24oKTtcbiAgcmVjdE1lbnUudmFsdWUgPSBudWxsO1xuICBjbG9zZVBhbGV0dGUoKTtcblxuICBjb25zdCBvbk1vdmUgPSAoZXY6IE1vdXNlRXZlbnQpID0+IHtcbiAgICBpZiAoIWFkYXB0ZXIgfHwgIWNvbnRhaW5lclJlZi52YWx1ZSkgcmV0dXJuO1xuICAgIGNvbnN0IHIgPSBjb250YWluZXJSZWYudmFsdWUuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gICAgY29uc3QgdCA9IGFkYXB0ZXIueFRvVGltZShldi5jbGllbnRYIC0gci5sZWZ0KTtcbiAgICBjb25zdCBwID0gYWRhcHRlci55VG9QcmljZShldi5jbGllbnRZIC0gci50b3ApO1xuICAgIGlmICh0ID09PSBudWxsIHx8IHAgPT09IG51bGwpIHJldHVybjtcbiAgICBjb25zdCBzID0gc25hcFRvQ2FuZGxlKHQsIHAsIG1hZ25ldEFjdGl2ZS52YWx1ZSk7XG4gICAgY29uc3QgY3VyID0gZHJhd2luZ3NTdG9yZS5nZXRQb3NpdGlvbnNGb3IobWFya2V0Lmluc3RydW1lbnQpLmZpbmQoKHgpID0+IHguaWQgPT09IGlkKTtcbiAgICBjb25zdCBwcmljZSA9IGN1ciA/IGNsYW1wUG9zUHJpY2UoY3VyLCB3aGljaCwgcy5wcmljZSkgOiBzLnByaWNlO1xuICAgIGRyYXdpbmdzU3RvcmUudXBkYXRlUG9zaXRpb24obWFya2V0Lmluc3RydW1lbnQsIGlkLCB7IFt3aGljaF06IHByaWNlLCBbc2lkZV06IHMudGltZSB9KTtcbiAgICBjb25zdCB1cGRhdGVkID0gZHJhd2luZ3NTdG9yZS5nZXRQb3NpdGlvbnNGb3IobWFya2V0Lmluc3RydW1lbnQpLmZpbmQoKHgpID0+IHguaWQgPT09IGlkKTtcbiAgICBpZiAodXBkYXRlZCkgc2VsZWN0ZWRQb3MudmFsdWUgPSB1cGRhdGVkO1xuICAgIHJlY2FsY1JlY3RzKCk7XG4gICAgcG9zaXRpb25Qb3NQYW5lbChpZCk7XG4gIH07XG4gIGNvbnN0IG9uVXAgPSAoKSA9PiB7XG4gICAgd2luZG93LnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJwb2ludGVybW92ZVwiLCBvbk1vdmUpO1xuICAgIHdpbmRvdy5yZW1vdmVFdmVudExpc3RlbmVyKFwicG9pbnRlcnVwXCIsIG9uVXApO1xuICB9O1xuICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJtb3ZlXCIsIG9uTW92ZSk7XG4gIHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKFwicG9pbnRlcnVwXCIsIG9uVXApO1xufVxuXG4vKiogRHJhZyB0aGUgcG9zaXRpb24gYm9keTogZXZlcnl0aGluZyAodGltZXMgKyBhbGwgdGhyZWUgcHJpY2VzKSBtb3Zlcy4gKi9cbmZ1bmN0aW9uIG9uUG9zRHJhZ1N0YXJ0KGU6IE1vdXNlRXZlbnQsIGlkOiBzdHJpbmcpOiB2b2lkIHtcbiAgaWYgKGUuYnV0dG9uICE9PSAwIHx8IGRyYXdpbmdzU3RvcmUuYWN0aXZlVG9vbCAhPT0gXCJjdXJzb3JcIikgcmV0dXJuO1xuICBpZiAoIWFkYXB0ZXIgfHwgIWNvbnRhaW5lclJlZi52YWx1ZSkgcmV0dXJuO1xuICBjb25zdCBwb3MgPSBkcmF3aW5nc1N0b3JlLmdldFBvc2l0aW9uc0ZvcihtYXJrZXQuaW5zdHJ1bWVudCkuZmluZCgocCkgPT4gcC5pZCA9PT0gaWQpO1xuICBpZiAoIXBvcykgcmV0dXJuO1xuICBlLnByZXZlbnREZWZhdWx0KCk7XG4gIGUuc3RvcFByb3BhZ2F0aW9uKCk7XG4gIHJlY3RNZW51LnZhbHVlID0gbnVsbDtcbiAgY2xvc2VQYWxldHRlKCk7XG4gIHZvaWQgb25Qb3NDbGljayhpZCwgZSk7XG5cbiAgY29uc3QgcjAgPSBjb250YWluZXJSZWYudmFsdWUuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gIGNvbnN0IHN0YXJ0VCA9IGFkYXB0ZXIueFRvVGltZShlLmNsaWVudFggLSByMC5sZWZ0KTtcbiAgY29uc3Qgc3RhcnRQID0gYWRhcHRlci55VG9QcmljZShlLmNsaWVudFkgLSByMC50b3ApO1xuICBpZiAoc3RhcnRUID09PSBudWxsIHx8IHN0YXJ0UCA9PT0gbnVsbCkgcmV0dXJuO1xuICBjb25zdCBvcmlnID0geyB0aW1lMTogcG9zLnRpbWUxLCB0aW1lMjogcG9zLnRpbWUyLCBlbnRyeTogcG9zLmVudHJ5LCBzbDogcG9zLnNsLCB0cDogcG9zLnRwIH07XG5cbiAgY29uc3Qgb25Nb3ZlID0gKGV2OiBNb3VzZUV2ZW50KSA9PiB7XG4gICAgaWYgKCFhZGFwdGVyIHx8ICFjb250YWluZXJSZWYudmFsdWUpIHJldHVybjtcbiAgICBjb25zdCByID0gY29udGFpbmVyUmVmLnZhbHVlLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuICAgIGNvbnN0IHQgPSBhZGFwdGVyLnhUb1RpbWUoZXYuY2xpZW50WCAtIHIubGVmdCk7XG4gICAgY29uc3QgcCA9IGFkYXB0ZXIueVRvUHJpY2UoZXYuY2xpZW50WSAtIHIudG9wKTtcbiAgICBpZiAodCA9PT0gbnVsbCB8fCBwID09PSBudWxsKSByZXR1cm47XG4gICAgZHJhd2luZ3NTdG9yZS51cGRhdGVQb3NpdGlvbihtYXJrZXQuaW5zdHJ1bWVudCwgaWQsIHtcbiAgICAgIHRpbWUxOiBvcmlnLnRpbWUxICsgKHQgLSBzdGFydFQpLFxuICAgICAgdGltZTI6IG9yaWcudGltZTIgKyAodCAtIHN0YXJ0VCksXG4gICAgICBlbnRyeTogb3JpZy5lbnRyeSArIChwIC0gc3RhcnRQKSxcbiAgICAgIHNsOiBvcmlnLnNsICsgKHAgLSBzdGFydFApLFxuICAgICAgdHA6IG9yaWcudHAgKyAocCAtIHN0YXJ0UCksXG4gICAgfSk7XG4gICAgY29uc3QgdXBkYXRlZCA9IGRyYXdpbmdzU3RvcmUuZ2V0UG9zaXRpb25zRm9yKG1hcmtldC5pbnN0cnVtZW50KS5maW5kKCh4KSA9PiB4LmlkID09PSBpZCk7XG4gICAgaWYgKHVwZGF0ZWQpIHNlbGVjdGVkUG9zLnZhbHVlID0gdXBkYXRlZDtcbiAgICByZWNhbGNSZWN0cygpO1xuICAgIHBvc2l0aW9uUG9zUGFuZWwoaWQpO1xuICB9O1xuICBjb25zdCBvblVwID0gKCkgPT4ge1xuICAgIHdpbmRvdy5yZW1vdmVFdmVudExpc3RlbmVyKFwicG9pbnRlcm1vdmVcIiwgb25Nb3ZlKTtcbiAgICB3aW5kb3cucmVtb3ZlRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJ1cFwiLCBvblVwKTtcbiAgfTtcbiAgd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoXCJwb2ludGVybW92ZVwiLCBvbk1vdmUpO1xuICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJ1cFwiLCBvblVwKTtcbn1cblxuZnVuY3Rpb24gZGVsZXRlU2VsZWN0ZWRQb3MoKTogdm9pZCB7XG4gIGlmICghc2VsZWN0ZWRQb3MudmFsdWUpIHJldHVybjtcbiAgZHJhd2luZ3NTdG9yZS5yZW1vdmVQb3NpdGlvbihtYXJrZXQuaW5zdHJ1bWVudCwgc2VsZWN0ZWRQb3MudmFsdWUuaWQpO1xuICBzZWxlY3RlZFBvcy52YWx1ZSA9IG51bGw7XG4gIHBvc1BhbmVsUG9zLnZhbHVlID0gbnVsbDtcbiAgcmVjYWxjUmVjdHMoKTtcbn1cblxuZnVuY3Rpb24gdG9nZ2xlUG9zTGV2ZWxzKCk6IHZvaWQge1xuICBpZiAoIXNlbGVjdGVkUG9zLnZhbHVlKSByZXR1cm47XG4gIGRyYXdpbmdzU3RvcmUudXBkYXRlUG9zaXRpb25GbGFncyhtYXJrZXQuaW5zdHJ1bWVudCwgc2VsZWN0ZWRQb3MudmFsdWUuaWQsIHtcbiAgICBzaG93TGV2ZWxzOiBzZWxlY3RlZFBvcy52YWx1ZS5zaG93TGV2ZWxzID09PSBmYWxzZSxcbiAgfSk7XG4gIGNvbnN0IHVwZGF0ZWQgPSBkcmF3aW5nc1N0b3JlLmdldFBvc2l0aW9uc0ZvcihtYXJrZXQuaW5zdHJ1bWVudCkuZmluZCgocCkgPT4gcC5pZCA9PT0gc2VsZWN0ZWRQb3MudmFsdWUhLmlkKTtcbiAgaWYgKHVwZGF0ZWQpIHNlbGVjdGVkUG9zLnZhbHVlID0gdXBkYXRlZDtcbiAgcmVjYWxjUmVjdHMoKTtcbn1cblxuLyog4pSA4pSAIE9uZS1jbGljayBsaW5lIGludGVyYWN0aW9uIChobGluZSAvIGhyYXkgLyB2bGluZSkg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAICovXG5cbi8qKiBDcmVhdGUgdGhlIGxpbmUgYXQgdGhlIGNsaWNrZWQgcG9pbnQgKDEgY2xpY2spIGFuZCBzZWxlY3QgaXQuIFdpdGggQ1RSTFxuICogIGhlbGQgdGhlIHByaWNlIChvciB0aW1lLCBmb3IgdmVydGljYWwgbGluZXMpIHNuYXBzIHRvIHRoZSBuZWFyZXN0IGNhbmRsZS4gKi9cbmZ1bmN0aW9uIGNyZWF0ZVNpbmdsZShlOiBNb3VzZUV2ZW50LCBraW5kOiBTaW5nbGVLaW5kKTogdm9pZCB7XG4gIGlmICghYWRhcHRlciB8fCAhY29udGFpbmVyUmVmLnZhbHVlKSByZXR1cm47XG4gIGNvbnN0IHIgPSBjb250YWluZXJSZWYudmFsdWUuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gIGNvbnN0IHQgPSBhZGFwdGVyLnhUb1RpbWUoZS5jbGllbnRYIC0gci5sZWZ0KTtcbiAgY29uc3QgcCA9IGFkYXB0ZXIueVRvUHJpY2UoZS5jbGllbnRZIC0gci50b3ApO1xuICBpZiAodCA9PT0gbnVsbCB8fCBwID09PSBudWxsKSByZXR1cm47XG4gIGxldCBpdGVtOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgaWYgKGtpbmQgPT09IFwidmxpbmVcIikge1xuICAgIGl0ZW0gPSB7IHRpbWU6IHNuYXBUb0NhbmRsZSh0LCBwLCBtYWduZXRBY3RpdmUudmFsdWUpLnRpbWUgfTtcbiAgfSBlbHNlIHtcbiAgICBjb25zdCBzID0gc25hcFRvQ2FuZGxlKHQsIHAsIG1hZ25ldEFjdGl2ZS52YWx1ZSk7XG4gICAgaXRlbSA9IGtpbmQgPT09IFwiaHJheVwiID8geyB0aW1lOiBzLnRpbWUsIHByaWNlOiBzLnByaWNlIH0gOiB7IHByaWNlOiBzLnByaWNlIH07XG4gIH1cbiAgY29uc3QgZnVsbCA9IGRyYXdpbmdzU3RvcmUuYWRkU2luZ2xlKGtpbmQsIG1hcmtldC5pbnN0cnVtZW50LCBpdGVtKTtcbiAgZHJhd2luZ3NTdG9yZS5hY3RpdmVUb29sID0gXCJjdXJzb3JcIjtcbiAgZHJhd2luZ3NTdG9yZS5zZWxlY3RlZFBvc2l0aW9uSWQgPSBudWxsO1xuICBzZWxlY3RlZFBvcy52YWx1ZSA9IG51bGw7XG4gIHBvc1BhbmVsUG9zLnZhbHVlID0gbnVsbDtcbiAgZHJhd2luZ3NTdG9yZS5zZWxlY3RlZFNpbmdsZSA9IHsga2luZCwgaWQ6IGZ1bGwuaWQgfTtcbiAgcmVjYWxjUmVjdHMoKTtcbiAgcG9zaXRpb25TaW5nbGVQYW5lbChraW5kLCBmdWxsLmlkKTtcbn1cblxuZnVuY3Rpb24gb25TaW5nbGVDbGljayhraW5kOiBTaW5nbGVLaW5kLCBpZDogc3RyaW5nLCBlOiBNb3VzZUV2ZW50KTogdm9pZCB7XG4gIGUuc3RvcFByb3BhZ2F0aW9uKCk7XG4gIHJlY3RNZW51LnZhbHVlID0gbnVsbDtcbiAgY2xvc2VQYWxldHRlKCk7XG4gIGlmIChkcmF3aW5nc1N0b3JlLmFjdGl2ZVRvb2wgIT09IFwiY3Vyc29yXCIpIGRyYXdpbmdzU3RvcmUuYWN0aXZlVG9vbCA9IFwiY3Vyc29yXCI7XG4gIGRyYXdpbmdzU3RvcmUuc2VsZWN0ZWRJZCA9IG51bGw7XG4gIHNlbGVjdGVkUmVjdC52YWx1ZSA9IG51bGw7XG4gIGVkaXRQYW5lbFBvcy52YWx1ZSA9IG51bGw7XG4gIGRyYXdpbmdzU3RvcmUuc2VsZWN0ZWRMaW5lSWQgPSBudWxsO1xuICBzZWxlY3RlZExpbmUudmFsdWUgPSBudWxsO1xuICBsaW5lUGFuZWxQb3MudmFsdWUgPSBudWxsO1xuICBkcmF3aW5nc1N0b3JlLnNlbGVjdGVkUG9seUlkID0gbnVsbDtcbiAgc2VsZWN0ZWRQb2x5LnZhbHVlID0gbnVsbDtcbiAgcG9seVBhbmVsUG9zLnZhbHVlID0gbnVsbDtcbiAgZHJhd2luZ3NTdG9yZS5zZWxlY3RlZFBvc2l0aW9uSWQgPSBudWxsO1xuICBzZWxlY3RlZFBvcy52YWx1ZSA9IG51bGw7XG4gIHBvc1BhbmVsUG9zLnZhbHVlID0gbnVsbDtcbiAgZHJhd2luZ3NTdG9yZS5zZWxlY3RlZFNpbmdsZSA9IHsga2luZCwgaWQgfTtcbiAgcmVjYWxjUmVjdHMoKTtcbiAgcG9zaXRpb25TaW5nbGVQYW5lbChraW5kLCBpZCk7XG59XG5cbi8qKiBQYW5lbCBhbmNob3JlZCB0byB0aGUgTElORSdzIGdlb21ldHJ5IChsaWtlIHJlY3RhbmdsZXMvdHJlbmRsaW5lcyksIG5vdFxuICogIHRvIHRoZSBjbGljayBwb2ludDogaGxpbmUg4oaSIGFib3ZlIHRoZSBsaW5lJ3MgY2VudGVyLCBocmF5IOKGkiBhYm92ZSBpdHNcbiAqICBhbmNob3IgcG9pbnQsIHZsaW5lIOKGkiBiZXNpZGUgdGhlIGxpbmUgYXQgbWlkLWhlaWdodC4gQWx3YXlzIGRldGVybWluaXN0aWMsXG4gKiAgZm9sbG93cyB0aGUgbGluZSB3aGlsZSBkcmFnZ2luZywgbmV2ZXIgcmVsb2NhdGVzLiAqL1xubGV0IHNpbmdsZVBhbmVsVyA9IDA7XG5sZXQgc2luZ2xlUGFuZWxIID0gMDtcbmZ1bmN0aW9uIHBvc2l0aW9uU2luZ2xlUGFuZWwoa2luZDogU2luZ2xlS2luZCwgaWQ6IHN0cmluZyk6IHZvaWQge1xuICBjb25zdCBweCA9IHNpbmdsZVBpeGVscy52YWx1ZS5maW5kKChzKSA9PiBzLmlkID09PSBpZCAmJiBzLmtpbmQgPT09IGtpbmQpO1xuICBjb25zdCBwYW5lID0gY29udGFpbmVyUmVmLnZhbHVlO1xuICBpZiAoIXB4IHx8ICFwYW5lKSByZXR1cm47XG4gIGNvbnN0IGNoYXJ0VyA9IHBhbmUuY2xpZW50V2lkdGggLSBheGlzUmlnaHRXLnZhbHVlO1xuICBjb25zdCBjaGFydEggPSBwYW5lLmNsaWVudEhlaWdodCAtIGF4aXNCb3R0b21ILnZhbHVlO1xuICBjb25zdCBhbmNob3IgPVxuICAgIGtpbmQgPT09IFwiaGxpbmVcIiA/IHsgeDogY2hhcnRXIC8gMiwgeTogcHgueSB9XG4gICAgOiBraW5kID09PSBcImhyYXlcIiA/IHsgeDogcHgueCwgeTogcHgueSB9XG4gICAgOiB7IHg6IHB4LngsIHk6IGNoYXJ0SCAvIDIgfTtcblxuICBjb25zdCBwbGFjZSA9ICgpID0+IHtcbiAgICBjb25zdCBwMiA9IHNpbmdsZVBpeGVscy52YWx1ZS5maW5kKChzKSA9PiBzLmlkID09PSBpZCAmJiBzLmtpbmQgPT09IGtpbmQpO1xuICAgIGlmICghcDIgfHwgIWNvbnRhaW5lclJlZi52YWx1ZSkgcmV0dXJuO1xuICAgIGNvbnN0IGNoYXJ0VzIgPSBjb250YWluZXJSZWYudmFsdWUuY2xpZW50V2lkdGggLSBheGlzUmlnaHRXLnZhbHVlO1xuICAgIGNvbnN0IGNoYXJ0SDIgPSBjb250YWluZXJSZWYudmFsdWUuY2xpZW50SGVpZ2h0IC0gYXhpc0JvdHRvbUgudmFsdWU7XG4gICAgY29uc3QgYSA9XG4gICAgICBraW5kID09PSBcImhsaW5lXCIgPyB7IHg6IGNoYXJ0VzIgLyAyLCB5OiBwMi55IH1cbiAgICAgIDoga2luZCA9PT0gXCJocmF5XCIgPyB7IHg6IHAyLngsIHk6IHAyLnkgfVxuICAgICAgOiB7IHg6IHAyLngsIHk6IGNoYXJ0SDIgLyAyIH07XG4gICAgLy8gU2FtZSBwbGFjZW1lbnQgbWF0aCBhcyB0aGUgdHJlbmRsaW5lIHBhbmVsOiB0aGUgcGFuZWwncyBMRUZUIGVkZ2UgaXNcbiAgICAvLyBhbmNob3JlZCBhdCB0aGUgY29ybmVyICsgZ2FwLCBzbyB4IG5ldmVyIGRlcGVuZHMgb24gdGhlIHBhbmVsIHdpZHRoXG4gICAgLy8gKG9ubHkgdGhlIHJhcmUgcmlnaHQtZWRnZSBmbGlwIGRvZXMpIOKAlCBubyBmaXJzdC1wYWludCBzaGlmdC5cbiAgICBjb25zdCB3ID0gc2luZ2xlUGFuZWxXIHx8IFBBTkVMX1c7XG4gICAgY29uc3QgaCA9IHNpbmdsZVBhbmVsSCB8fCBQQU5FTF9IO1xuICAgIGNvbnN0IGdhcCA9IDg7XG4gICAgbGV0IHggPSBhLnggKyBnYXA7XG4gICAgbGV0IHkgPSBhLnkgLSBoIC0gZ2FwO1xuICAgIGlmICh4ICsgdyA+IGNvbnRhaW5lclJlZi52YWx1ZS5jbGllbnRXaWR0aCAtIDYpIHggPSBhLnggLSB3IC0gZ2FwO1xuICAgIGlmICh5IDwgNCkgeSA9IGEueSArIGdhcDtcbiAgICB4ID0gTWF0aC5taW4oTWF0aC5tYXgoNCwgeCksIE1hdGgubWF4KDQsIGNvbnRhaW5lclJlZi52YWx1ZS5jbGllbnRXaWR0aCAtIHcgLSA2KSk7XG4gICAgeSA9IE1hdGgubWluKE1hdGgubWF4KDQsIHkpLCBNYXRoLm1heCg0LCBjb250YWluZXJSZWYudmFsdWUuY2xpZW50SGVpZ2h0IC0gaCAtIDYpKTtcbiAgICBzaW5nbGVQYW5lbFBvcy52YWx1ZSA9IHsgeCwgeSB9O1xuICB9O1xuXG4gIHBsYWNlKCk7XG4gIGlmICghc2luZ2xlUGFuZWxFbC52YWx1ZSkge1xuICAgIC8vIEZpcnN0IHBhaW50OiBoaWRkZW4gdW50aWwgdGhlIHJlYWwgc2l6ZSBpcyBtZWFzdXJlZCBhbmQgcGxhY2VtZW50XG4gICAgLy8gcmVjb21wdXRlZCDigJQgdGhlIHBhbmVsIG5ldmVyIGFwcGVhcnMgYXQgYSB3cm9uZyBzcG90LlxuICAgIHNpbmdsZVBhbmVsUmVhZHkudmFsdWUgPSBmYWxzZTtcbiAgICB2b2lkIG5leHRUaWNrKCgpID0+IHtcbiAgICAgIGlmICghc2luZ2xlUGFuZWxFbC52YWx1ZSkgcmV0dXJuO1xuICAgICAgc2luZ2xlUGFuZWxXID0gc2luZ2xlUGFuZWxFbC52YWx1ZS5vZmZzZXRXaWR0aDtcbiAgICAgIHNpbmdsZVBhbmVsSCA9IHNpbmdsZVBhbmVsRWwudmFsdWUub2Zmc2V0SGVpZ2h0O1xuICAgICAgcGxhY2UoKTtcbiAgICAgIHNpbmdsZVBhbmVsUmVhZHkudmFsdWUgPSB0cnVlO1xuICAgIH0pO1xuICB9IGVsc2Uge1xuICAgIHNpbmdsZVBhbmVsVyA9IHNpbmdsZVBhbmVsRWwudmFsdWUub2Zmc2V0V2lkdGg7XG4gICAgc2luZ2xlUGFuZWxIID0gc2luZ2xlUGFuZWxFbC52YWx1ZS5vZmZzZXRIZWlnaHQ7XG4gICAgc2luZ2xlUGFuZWxSZWFkeS52YWx1ZSA9IHRydWU7XG4gIH1cbn1cblxuLyoqIERyYWcgYSBvbmUtY2xpY2sgbGluZTogaGxpbmUgdmVydGljYWwsIHZsaW5lIGhvcml6b250YWwsIGhyYXkgYm90aC5cbiAqICBBIDNweCBkZWFkIHpvbmUga2VlcHMgYWNjaWRlbnRhbCBtaWNyby1tb3ZlbWVudHMgKGUuZy4gZHVyaW5nIGFcbiAqICBkb3VibGUtY2xpY2spIGZyb20gZHJhZ2dpbmcgdGhlIGxpbmUuICovXG5mdW5jdGlvbiBvblNpbmdsZURyYWdTdGFydChlOiBNb3VzZUV2ZW50LCBraW5kOiBTaW5nbGVLaW5kLCBpZDogc3RyaW5nKTogdm9pZCB7XG4gIGlmIChlLmJ1dHRvbiAhPT0gMCB8fCAhYWRhcHRlciB8fCAhY29udGFpbmVyUmVmLnZhbHVlKSByZXR1cm47XG4gIGUucHJldmVudERlZmF1bHQoKTtcbiAgZS5zdG9wUHJvcGFnYXRpb24oKTtcbiAgcmVjdE1lbnUudmFsdWUgPSBudWxsO1xuICBjbG9zZVBhbGV0dGUoKTtcbiAgZHJhd2luZ3NTdG9yZS5zZWxlY3RlZElkID0gbnVsbDtcbiAgc2VsZWN0ZWRSZWN0LnZhbHVlID0gbnVsbDtcbiAgZWRpdFBhbmVsUG9zLnZhbHVlID0gbnVsbDtcbiAgZHJhd2luZ3NTdG9yZS5zZWxlY3RlZExpbmVJZCA9IG51bGw7XG4gIHNlbGVjdGVkTGluZS52YWx1ZSA9IG51bGw7XG4gIGxpbmVQYW5lbFBvcy52YWx1ZSA9IG51bGw7XG4gIGRyYXdpbmdzU3RvcmUuc2VsZWN0ZWRQb2x5SWQgPSBudWxsO1xuICBzZWxlY3RlZFBvbHkudmFsdWUgPSBudWxsO1xuICBwb2x5UGFuZWxQb3MudmFsdWUgPSBudWxsO1xuICBkcmF3aW5nc1N0b3JlLnNlbGVjdGVkUG9zaXRpb25JZCA9IG51bGw7XG4gIHNlbGVjdGVkUG9zLnZhbHVlID0gbnVsbDtcbiAgcG9zUGFuZWxQb3MudmFsdWUgPSBudWxsO1xuICBkcmF3aW5nc1N0b3JlLnNlbGVjdGVkU2luZ2xlID0geyBraW5kLCBpZCB9O1xuICByZWNhbGNSZWN0cygpO1xuICBwb3NpdGlvblNpbmdsZVBhbmVsKGtpbmQsIGlkKTtcblxuICBjb25zdCBzdGFydFggPSBlLmNsaWVudFg7XG4gIGNvbnN0IHN0YXJ0WSA9IGUuY2xpZW50WTtcbiAgbGV0IG1vdmVkID0gZmFsc2U7XG5cbiAgY29uc3Qgb25Nb3ZlID0gKGV2OiBNb3VzZUV2ZW50KSA9PiB7XG4gICAgaWYgKCFtb3ZlZCAmJiBNYXRoLmh5cG90KGV2LmNsaWVudFggLSBzdGFydFgsIGV2LmNsaWVudFkgLSBzdGFydFkpIDwgMykgcmV0dXJuO1xuICAgIG1vdmVkID0gdHJ1ZTtcbiAgICBpZiAoIWFkYXB0ZXIgfHwgIWNvbnRhaW5lclJlZi52YWx1ZSkgcmV0dXJuO1xuICAgIGNvbnN0IHIgPSBjb250YWluZXJSZWYudmFsdWUuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gICAgY29uc3QgdCA9IGFkYXB0ZXIueFRvVGltZShldi5jbGllbnRYIC0gci5sZWZ0KTtcbiAgICBjb25zdCBwID0gYWRhcHRlci55VG9QcmljZShldi5jbGllbnRZIC0gci50b3ApO1xuICAgIGlmICh0ID09PSBudWxsIHx8IHAgPT09IG51bGwpIHJldHVybjtcbiAgICBpZiAoa2luZCA9PT0gXCJobGluZVwiKSB7XG4gICAgICBkcmF3aW5nc1N0b3JlLnVwZGF0ZVNpbmdsZShraW5kLCBtYXJrZXQuaW5zdHJ1bWVudCwgaWQsIHsgcHJpY2U6IHNuYXBUb0NhbmRsZSh0LCBwLCBtYWduZXRBY3RpdmUudmFsdWUpLnByaWNlIH0pO1xuICAgIH0gZWxzZSBpZiAoa2luZCA9PT0gXCJ2bGluZVwiKSB7XG4gICAgICBkcmF3aW5nc1N0b3JlLnVwZGF0ZVNpbmdsZShraW5kLCBtYXJrZXQuaW5zdHJ1bWVudCwgaWQsIHsgdGltZTogc25hcFRvQ2FuZGxlKHQsIHAsIG1hZ25ldEFjdGl2ZS52YWx1ZSkudGltZSB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgY29uc3QgcyA9IHNuYXBUb0NhbmRsZSh0LCBwLCBtYWduZXRBY3RpdmUudmFsdWUpO1xuICAgICAgZHJhd2luZ3NTdG9yZS51cGRhdGVTaW5nbGUoa2luZCwgbWFya2V0Lmluc3RydW1lbnQsIGlkLCB7IHRpbWU6IHMudGltZSwgcHJpY2U6IHMucHJpY2UgfSk7XG4gICAgfVxuICAgIHJlY2FsY1JlY3RzKCk7XG4gICAgcG9zaXRpb25TaW5nbGVQYW5lbChraW5kLCBpZCk7XG4gIH07XG4gIGNvbnN0IG9uVXAgPSAoKSA9PiB7XG4gICAgd2luZG93LnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJwb2ludGVybW92ZVwiLCBvbk1vdmUpO1xuICAgIHdpbmRvdy5yZW1vdmVFdmVudExpc3RlbmVyKFwicG9pbnRlcnVwXCIsIG9uVXApO1xuICB9O1xuICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJtb3ZlXCIsIG9uTW92ZSk7XG4gIHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKFwicG9pbnRlcnVwXCIsIG9uVXApO1xufVxuXG5mdW5jdGlvbiBkZWxldGVTZWxlY3RlZFNpbmdsZSgpOiB2b2lkIHtcbiAgY29uc3Qgc2VsID0gZHJhd2luZ3NTdG9yZS5zZWxlY3RlZFNpbmdsZTtcbiAgaWYgKCFzZWwpIHJldHVybjtcbiAgZHJhd2luZ3NTdG9yZS5yZW1vdmVTaW5nbGUoc2VsLmtpbmQsIG1hcmtldC5pbnN0cnVtZW50LCBzZWwuaWQpO1xuICBzaW5nbGVQYW5lbFBvcy52YWx1ZSA9IG51bGw7XG4gIHJlY2FsY1JlY3RzKCk7XG59XG5cbi8qKiBEZXNlbGVjdCB0aGUgb25lLWNsaWNrIGxpbmUgKHVzZWQgd2hlbiBhbm90aGVyIGRyYXdpbmcgZ2V0cyBzZWxlY3RlZCBzb1xuICogIG9ubHkgb25lIGVkaXQgcGFuZWwgaXMgZXZlciBvcGVuKS4gKi9cbmZ1bmN0aW9uIGNsZWFyU2luZ2xlU2VsZWN0aW9uKCk6IHZvaWQge1xuICBpZiAoIWRyYXdpbmdzU3RvcmUuc2VsZWN0ZWRTaW5nbGUgJiYgIXNpbmdsZVBhbmVsUG9zLnZhbHVlKSByZXR1cm47XG4gIGRyYXdpbmdzU3RvcmUuc2VsZWN0ZWRTaW5nbGUgPSBudWxsO1xuICBzaW5nbGVQYW5lbFBvcy52YWx1ZSA9IG51bGw7XG4gIHJlY2FsY1JlY3RzKCk7XG59XG5cbmZ1bmN0aW9uIHNldFNpbmdsZUNvbG9yKGNvbG9yOiBzdHJpbmcpOiB2b2lkIHtcbiAgY29uc3Qgc2VsID0gZHJhd2luZ3NTdG9yZS5zZWxlY3RlZFNpbmdsZTtcbiAgaWYgKCFzZWwpIHJldHVybjtcbiAgZHJhd2luZ3NTdG9yZS51cGRhdGVTaW5nbGUoc2VsLmtpbmQsIG1hcmtldC5pbnN0cnVtZW50LCBzZWwuaWQsIHsgY29sb3IgfSk7XG4gIHJlY2FsY1JlY3RzKCk7XG59XG5cbmZ1bmN0aW9uIHNldFNpbmdsZURhc2goZGFzaDogRGFzaFN0eWxlKTogdm9pZCB7XG4gIGNvbnN0IHNlbCA9IGRyYXdpbmdzU3RvcmUuc2VsZWN0ZWRTaW5nbGU7XG4gIGlmICghc2VsKSByZXR1cm47XG4gIGRyYXdpbmdzU3RvcmUudXBkYXRlU2luZ2xlKHNlbC5raW5kLCBtYXJrZXQuaW5zdHJ1bWVudCwgc2VsLmlkLCB7IGRhc2ggfSk7XG4gIHJlY2FsY1JlY3RzKCk7XG59XG5cblxuXG5vbk1vdW50ZWQoYXN5bmMgKCkgPT4ge1xuICBhd2FpdCBuZXh0VGljaygpO1xuICBpZiAoIWNvbnRhaW5lclJlZi52YWx1ZSkgcmV0dXJuO1xuICBhZGFwdGVyID0gY3JlYXRlQ2hhcnRBZGFwdGVyKGNvbnRhaW5lclJlZi52YWx1ZSk7XG4gIGFwcGx5Q2hhcnRTdHlsZSgpO1xuICBhZGFwdGVyLnNldFRoZW1lKHRoZW1lU3RvcmUudGhlbWUgPT09IFwiZGFya1wiKTtcbiAgaWYgKHByb3BzLmluc3RydW1lbnQpIGFkYXB0ZXIuc2V0SW5zdHJ1bWVudChwcm9wcy5pbnN0cnVtZW50KTtcbiAgYWRhcHRlci5zZXREYXRhKGRpc3BsYXlDYW5kbGVzLnZhbHVlKTtcbiAgLy8gTWVhc3VyZSB0aGUgcHJpY2UvdGltZSBzY2FsZXMgb25jZSBMV0MgaGFzIGxhaWQgb3V0IGl0cyBwYW5lc1xuICByZXF1ZXN0QW5pbWF0aW9uRnJhbWUodXBkYXRlQXhpc1NpemVzKTtcbiAgLy8gTWFrZSBzdXJlIGRyYXdpbmdzIHN0b3JlZCBmcm9tIGEgcHJldmlvdXMgc2Vzc2lvbiByZW5kZXIgYXMgc29vbiBhcyB0aGVcbiAgLy8gY2hhcnQgY2FuIHByb2plY3QgdGhlbSDigJQgbm90IHNlY29uZHMgbGF0ZXIgb24gdGhlIG5leHQgc3RyYXkgZXZlbnQuXG4gIGxvYWRTZXR0bGVEZWFkbGluZSA9IHBlcmZvcm1hbmNlLm5vdygpICsgNTAwMDtcbiAgZXh0ZW5kUmVjYWxjRnJhbWVzKDMwMCk7XG5cbiAgLy8gRGVidWcvdGVzdGluZyBob29rOiBsZXRzIEUyRSB0ZXN0cyByZWFkIHRoZSBjaGFydCB2aWV3cG9ydCBwcmVjaXNlbHkuXG4gICh3aW5kb3cgYXMgdW5rbm93biBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikuX190a0NoYXJ0QWRhcHRlciA9IGFkYXB0ZXI7XG5cbiAgdmlzaWJsZUNiID0gKHJhbmdlKSA9PiB7XG4gICAgLy8gVHJhY2sgdGhlIHByaWNlIG1hcmtlciArIHJlZHJhdyByZWN0YW5nbGVzIG9uIGV2ZXJ5IHBhbi96b29tXG4gICAgdXBkYXRlQmFkZ2VQb3NpdGlvbigpO1xuICAgIHJlY2FsY1JlY3RzKCk7XG4gICAgaWYgKCFyYW5nZSkgcmV0dXJuO1xuICAgIGlmIChsYXp5VGhyb3R0bGVkKSByZXR1cm47XG4gICAgaWYgKHJhbmdlLmZyb20gPiAxNSkgcmV0dXJuO1xuICAgIGlmIChtYXJrZXQuaXNMb2FkaW5nIHx8IG1hcmtldC5pc0xvYWRpbmdNb3JlIHx8ICFtYXJrZXQuaGFzTW9yZSkgcmV0dXJuO1xuICAgIGxhenlUaHJvdHRsZWQgPSB0cnVlO1xuICAgIHZvaWQgbWFya2V0LmxvYWRNb3JlKCkuZmluYWxseSgoKSA9PiB7XG4gICAgICBzZXRUaW1lb3V0KCgpID0+IChsYXp5VGhyb3R0bGVkID0gZmFsc2UpLCA0MDApO1xuICAgIH0pO1xuICB9O1xuICBhZGFwdGVyLnN1YnNjcmliZVZpc2libGVSYW5nZSh2aXNpYmxlQ2IpO1xuXG4gIC8vIFJlLXByb2plY3QgcHJpY2UtYW5jaG9yZWQgb3ZlcmxheXMgd2hlbmV2ZXIgdGhlIHNlcmllcyBkYXRhIGNoYW5nZXM6XG4gIC8vIGF1dG9TY2FsZSByZWZpdHMgdGhlIHByaWNlIHNjYWxlIGFmdGVyIGxvYWQgLyBsaXZlIHRpY2tzIC8gY29ycmVjdGlvbnMsXG4gIC8vIHdoaWNoIHNoaWZ0cyBldmVyeSBwaXhlbCBwb3NpdGlvbiDigJQgd2l0aG91dCB0aGlzLCByZWN0YW5nbGVzIHNpdCBhdCBhXG4gIC8vIHN0YWxlIGhlaWdodCBmb3IgYSBtb21lbnQgYWZ0ZXIgcmVmcmVzaCBiZWZvcmUgdGhlIG5leHQgaW50ZXJhY3Rpb24uXG4gIGRhdGFDYiA9ICgpID0+IHtcbiAgICB1cGRhdGVCYWRnZVBvc2l0aW9uKCk7XG4gICAgcmVjYWxjUmVjdHMoKTtcbiAgICB1cGRhdGVBeGlzU2l6ZXMoKTtcbiAgICBsb2FkU2V0dGxlRGVhZGxpbmUgPSBwZXJmb3JtYW5jZS5ub3coKSArIDUwMDA7XG4gICAgZXh0ZW5kUmVjYWxjRnJhbWVzKDEyMCk7XG4gIH07XG4gIGFkYXB0ZXIuc3Vic2NyaWJlRGF0YUNoYW5nZWQoZGF0YUNiKTtcblxuICAvLyBWZXJ0aWNhbCBkcmFncyAmIHBpbmNoLXpvb20gY2hhbmdlIHRoZSBQUklDRSBzY2FsZSB3aXRob3V0IGZpcmluZyB0aGVcbiAgLy8gdGltZS1yYW5nZSBjYWxsYmFjayDigJQgdHJhY2sgcG9pbnRlci93aGVlbCBkaXJlY3RseSBmb3IgaW5zdGFudCByZXBvc2l0aW9uLlxuICBjb25zdCBlbCA9IGNvbnRhaW5lclJlZi52YWx1ZTtcbiAgY29uc3Qgb25JbnRlcmFjdCA9ICgpID0+IHtcbiAgICB1cGRhdGVCYWRnZVBvc2l0aW9uKCk7XG4gICAgcmVjYWxjUmVjdHMoKTtcbiAgICBleHRlbmRSZWNhbGNGcmFtZXMoMjUwKTtcbiAgfTtcbiAgZWwuYWRkRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJtb3ZlXCIsIG9uSW50ZXJhY3QsIHsgcGFzc2l2ZTogdHJ1ZSB9KTtcbiAgZWwuYWRkRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJkb3duXCIsIG9uSW50ZXJhY3QsIHsgcGFzc2l2ZTogdHJ1ZSB9KTtcbiAgZWwuYWRkRXZlbnRMaXN0ZW5lcihcIndoZWVsXCIsIG9uSW50ZXJhY3QsIHsgcGFzc2l2ZTogdHJ1ZSB9KTtcbiAgZWwuYWRkRXZlbnRMaXN0ZW5lcihcInRvdWNobW92ZVwiLCBvbkludGVyYWN0LCB7IHBhc3NpdmU6IHRydWUgfSk7XG4gIGludGVyYWN0aW9uRWwgPSBlbDtcbiAgaW50ZXJhY3RDYiA9IG9uSW50ZXJhY3Q7XG5cbiAgLy8gV2hlZWwtem9vbSBvdmVyIGRyYXdpbmdzOiB0aGUgZHJhd2luZy9kZW1vIGhpdCBsYXllcnMgc2l0IEFCT1ZFIHRoZVxuICAvLyBjaGFydCBjYW52YXMgYXMgU0lCTElOR1Mgb2YgdGhlIGNoYXJ0IGNvbnRhaW5lciwgc28gYSB3aGVlbCBvdmVyIGFcbiAgLy8gcmVjdGFuZ2xlL3Bvc2l0aW9uIG5ldmVyIHJlYWNoZXMgTGlnaHR3ZWlnaHQgQ2hhcnRzIGFuZCB6b29tIHNpbGVudGx5XG4gIC8vIGRpZXMuIFRoZSBmb3J3YXJkZXIgbGl2ZXMgb24gdGhlIGNvbW1vbiBhbmNlc3RvciAoLmNoYXJ0LXBhbmUpIGFuZFxuICAvLyByZS1kaXNwYXRjaGVzIGFueSB3aGVlbCB3aG9zZSB0YXJnZXQgaXMgYW4gb3ZlcmxheSBvbnRvIHRoZSBjaGFydCdzXG4gIC8vIG93biBjYW52YXMg4oCUIGJ1dCBPTkxZIHdoZW4gdGhlIGN1cnNvciBpcyBvdmVyIHRoZSBwYW5lIGFyZWEgKHdoZWVsc1xuICAvLyBvdmVyIHRoZSBkZW1vIHBhbmVsLCBsZWdlbmQgZXRjLiBzdGF5IHVudG91Y2hlZCkuXG4gIGNvbnN0IG9uT3ZlcmxheVdoZWVsID0gKGU6IFdoZWVsRXZlbnQpID0+IHtcbiAgICBpZiAoKGUudGFyZ2V0IGFzIEhUTUxFbGVtZW50KT8udGFnTmFtZSA9PT0gXCJDQU5WQVNcIikgcmV0dXJuO1xuICAgIC8vIFVJIGlzbGFuZHMgb24gdGhlIHBhbmUgKGluZGljYXRvciBsZWdlbmQvc2V0dGluZ3MpIHNjcm9sbCB0aGVpciBvd25cbiAgICAvLyBjb250ZW50IOKAlCBuZXZlciB6b29tIHRoZSBjaGFydCBmcm9tIHRoZW0uXG4gICAgY29uc3QgdCA9IGUudGFyZ2V0IGFzIEhUTUxFbGVtZW50IHwgbnVsbDtcbiAgICBpZiAodD8uY2xvc2VzdD8uKFwiLmluZGljYXRvci1sZWdlbmRcIikpIHJldHVybjtcbiAgICBjb25zdCBjYW52YXMgPSBlbC5xdWVyeVNlbGVjdG9yKFwiY2FudmFzXCIpO1xuICAgIGlmICghY2FudmFzKSByZXR1cm47XG4gICAgY29uc3QgciA9IGNhbnZhcy5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgICBpZiAoZS5jbGllbnRYIDwgci5sZWZ0IHx8IGUuY2xpZW50WCA+IHIucmlnaHQgfHwgZS5jbGllbnRZIDwgci50b3AgfHwgZS5jbGllbnRZID4gci5ib3R0b20pIHJldHVybjtcbiAgICBjYW52YXMuZGlzcGF0Y2hFdmVudChuZXcgV2hlZWxFdmVudChcIndoZWVsXCIsIHtcbiAgICAgIGJ1YmJsZXM6IHRydWUsXG4gICAgICBjYW5jZWxhYmxlOiB0cnVlLFxuICAgICAgZGVsdGFYOiBlLmRlbHRhWCxcbiAgICAgIGRlbHRhWTogZS5kZWx0YVksXG4gICAgICBkZWx0YVo6IGUuZGVsdGFaLFxuICAgICAgZGVsdGFNb2RlOiBlLmRlbHRhTW9kZSxcbiAgICAgIGNsaWVudFg6IGUuY2xpZW50WCxcbiAgICAgIGNsaWVudFk6IGUuY2xpZW50WSxcbiAgICAgIHNjcmVlblg6IGUuc2NyZWVuWCxcbiAgICAgIHNjcmVlblk6IGUuc2NyZWVuWSxcbiAgICAgIGN0cmxLZXk6IGUuY3RybEtleSxcbiAgICAgIGFsdEtleTogZS5hbHRLZXksXG4gICAgICBzaGlmdEtleTogZS5zaGlmdEtleSxcbiAgICAgIG1ldGFLZXk6IGUubWV0YUtleSxcbiAgICB9KSk7XG4gIH07XG4gIGNvbnN0IHBhbmVIb3N0ID0gZWwucGFyZW50RWxlbWVudDsgLy8gLmNoYXJ0LXBhbmUg4oCUIGNvbnRhaW5zIHRoZSBvdmVybGF5IGxheWVycyB0b29cbiAgaWYgKHBhbmVIb3N0KSB7XG4gICAgcGFuZUhvc3QuYWRkRXZlbnRMaXN0ZW5lcihcIndoZWVsXCIsIG9uT3ZlcmxheVdoZWVsLCB0cnVlKTtcbiAgICBvdmVybGF5V2hlZWxFbCA9IHBhbmVIb3N0O1xuICAgIG92ZXJsYXlXaGVlbENiID0gb25PdmVybGF5V2hlZWw7XG4gIH1cblxuICAvLyBXaGlsZSBhbnkgYnV0dG9uIGlzIGhlbGQgb3ZlciB0aGUgY2hhcnQgKHBhbiBkcmFnLCBwcmljZS1heGlzIHNjYWxlXG4gIC8vIGRyYWcpLCByZS1wcm9qZWN0IG92ZXJsYXlzIEVWRVJZIGZyYW1lIHNvIHRoZXkgc3RheSBnbHVlZCB0byB0aGUgY2FudmFzXG4gIC8vIHJlbmRlciBpbnN0ZWFkIG9mIHRyYWlsaW5nIGl0IGJ5IGEgZnJhbWUgb24gY29hcnNlIHRpbWVmcmFtZXMuXG4gIGNvbnN0IG9uUG9pbnRlckRvd24gPSAoKSA9PiB7XG4gICAgcG9pbnRlckhlbGQgPSB0cnVlO1xuICAgIGV4dGVuZFJlY2FsY0ZyYW1lcygzMDApO1xuICB9O1xuICBjb25zdCBvblBvaW50ZXJVcCA9ICgpID0+IHtcbiAgICBwb2ludGVySGVsZCA9IGZhbHNlO1xuICAgIGV4dGVuZFJlY2FsY0ZyYW1lcygyMDApO1xuICB9O1xuICBlbC5hZGRFdmVudExpc3RlbmVyKFwicG9pbnRlcmRvd25cIiwgb25Qb2ludGVyRG93biwgeyBwYXNzaXZlOiB0cnVlIH0pO1xuICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJ1cFwiLCBvblBvaW50ZXJVcCwgeyBwYXNzaXZlOiB0cnVlIH0pO1xuICBwb2ludGVyRG93bkVsID0gZWw7XG4gIHBvaW50ZXJEb3duQ2IgPSBvblBvaW50ZXJEb3duO1xuICBwb2ludGVyVXBDYiA9IG9uUG9pbnRlclVwO1xuXG4gIC8vIFJlY3RhbmdsZSAvIHRyZW5kbGluZSBkcmF3aW5nOiBpbnRlcmNlcHQgbGVmdC1wcmVzc2VzIEJFRk9SRSBMaWdodHdlaWdodFxuICAvLyBDaGFydHMgc2VlcyB0aGVtIChjYXB0dXJlIHBoYXNlKSBzbyB0aGUgY2hhcnQgZG9lcyBub3QgcGFuIHdoaWxlIGEgZHJhd2luZ1xuICAvLyB0b29sIGlzIGFjdGl2ZS4gSW4gY3Vyc29yIG1vZGUgdGhpcyBoYW5kbGVyIGRvZXMgbm90aGluZyBhbmQgdGhlIGNoYXJ0XG4gIC8vIGJlaGF2ZXMgbm9ybWFsbHkuXG4gIGNvbnN0IG9uQ2hhcnRNb3VzZURvd24gPSAoZTogTW91c2VFdmVudCkgPT4ge1xuICAgIC8vIEFueSBjbGljayBvbiB0aGUgY2hhcnQgY2xvc2VzIHRoZSBpbmRpY2F0b3Igc2V0dGluZ3MgcG9wdXBcbiAgICBpbmRTZXR0aW5nc09wZW4udmFsdWUgPSBmYWxzZTtcbiAgICAvLyBEZW1vIGxpbWl0IHBsYWNlbWVudDogYSBjbGljayBzZXRzIHRoZSBkcmFmdCBlbnRyeSBwcmljZVxuICAgIGlmIChkZW1vLmFjdGl2ZSAmJiBkcmFmdC52YWx1ZSkge1xuICAgICAgaWYgKGUuYnV0dG9uICE9PSAwIHx8ICFpc0luQ2hhcnRBcmVhKGUpIHx8ICFhZGFwdGVyIHx8ICFjb250YWluZXJSZWYudmFsdWUpIHJldHVybjtcbiAgICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICAgIGUuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgICBjb25zdCByID0gY29udGFpbmVyUmVmLnZhbHVlLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuICAgICAgY29uc3QgcCA9IGFkYXB0ZXIueVRvUHJpY2UoZS5jbGllbnRZIC0gci50b3ApO1xuICAgICAgaWYgKHAgIT09IG51bGwpIHtcbiAgICAgICAgLy8gU2hpZnQgdGhlIHdob2xlIHN0cnVjdHVyZSAoU0wvVFAga2VlcCB0aGVpciBkaXN0YW5jZXMgdG8gZW50cnkpXG4gICAgICAgIGNvbnN0IGRlbHRhID0gcCAtIGRyYWZ0LnZhbHVlLmVudHJ5O1xuICAgICAgICBkcmFmdC52YWx1ZS5lbnRyeSA9IHA7XG4gICAgICAgIGRyYWZ0LnZhbHVlLnNsICs9IGRlbHRhO1xuICAgICAgICBkcmFmdC52YWx1ZS50cCArPSBkZWx0YTtcbiAgICAgIH1cbiAgICAgIHJlY2FsY1JlY3RzKCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIC8vIFJlcGxheSBwaWNraW5nOiBhIGNsaWNrIG9uIHRoZSBjaGFydCBzdGFydHMgcmVwbGF5IGF0IHRoYXQgY2FuZGxlIOKAlFxuICAgIC8vIGV2ZXJ5dGhpbmcgdG8gdGhlIHJpZ2h0IG9mIHRoZSBsaW5lIGJlY29tZXMgaGlkZGVuLlxuICAgIGlmIChyZXBsYXkuYWN0aXZlICYmIHJlcGxheS5waWNraW5nKSB7XG4gICAgICBpZiAoZS5idXR0b24gIT09IDAgfHwgIWlzSW5DaGFydEFyZWEoZSkgfHwgIWFkYXB0ZXIgfHwgIWNvbnRhaW5lclJlZi52YWx1ZSkgcmV0dXJuO1xuICAgICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgZS5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgIGNvbnN0IHQgPSByZXBsYXlUaW1lQXQoZS5jbGllbnRYKTtcbiAgICAgIGlmICh0ICE9PSBudWxsKSB7XG4gICAgICAgIHJlcGxheS5zdGFydEF0KHQpO1xuICAgICAgICAvLyBDdXQgaGVyZToganVtcCBzbyB0aGUgbGFzdCBjYW5kbGUgc2l0cyBhdCB0aGUgcmlnaHQgd2l0aCBmcmVlIHNwYWNlXG4gICAgICAgIGZvY3VzUmVwbGF5RWRnZSgpO1xuICAgICAgfVxuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICAvLyBUaGUgcHJpY2UvdGltZSBzY2FsZXMgYXJlIG5vdCBkcmF3aW5nIHN1cmZhY2VzIOKAlCBpZ25vcmUgcHJlc3NlcyB0aGVyZVxuICAgIGlmICghaXNJbkNoYXJ0QXJlYShlKSkgcmV0dXJuO1xuICAgIGNvbnN0IHRvb2wgPSBkcmF3aW5nc1N0b3JlLmFjdGl2ZVRvb2w7XG4gICAgaWYgKHRvb2wgPT09IFwiaGxpbmVcIiB8fCB0b29sID09PSBcImhyYXlcIiB8fCB0b29sID09PSBcInZsaW5lXCIpIHtcbiAgICAgIGlmIChlLmJ1dHRvbiAhPT0gMCkgcmV0dXJuO1xuICAgICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgZS5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgIGNyZWF0ZVNpbmdsZShlLCB0b29sKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKHRvb2wgPT09IFwicG9zaXRpb25cIikge1xuICAgICAgaWYgKGUuYnV0dG9uICE9PSAwKSByZXR1cm47XG4gICAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgICBlLnN0b3BQcm9wYWdhdGlvbigpO1xuICAgICAgaWYgKHBvc1N0YXRlLnZhbHVlKSB7XG4gICAgICAgIGZpbmFsaXplUG9zKGUpOyAvLyBzZWNvbmQgY2xpY2s6IFNMICsgZGlyZWN0aW9uXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBiZWdpblBvcyhlKTsgLy8gZmlyc3QgY2xpY2s6IGVudHJ5XG4gICAgICB9XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGlmICgodG9vbCAhPT0gXCJyZWN0YW5nbGVcIiAmJiB0b29sICE9PSBcInRyZW5kbGluZVwiICYmIHRvb2wgIT09IFwicG9seWxpbmVcIikgfHwgZS5idXR0b24gIT09IDApIHJldHVybjtcbiAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgZS5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICBpZiAodG9vbCA9PT0gXCJwb2x5bGluZVwiKSB7XG4gICAgICBoYW5kbGVQb2x5Q2xpY2soZSk7XG4gICAgfSBlbHNlIGlmIChkcmF3aW5nU3RhdGUudmFsdWUpIHtcbiAgICAgIC8vIFNlY29uZCBwcmVzcyBvZiBjbGljayAtPiBtb3ZlIC0+IGNsaWNrLiBUb3VjaCBzZW5kcyBubyBwb2ludGVybW92ZVxuICAgICAgLy8gYmV0d2VlbiB0d28gdGFwcywgc28gdGhlIGZyZWUgY29ybmVyIG11c3QgYmUgbW92ZWQgdG8gVEhJUyBwcmVzc1xuICAgICAgLy8gYmVmb3JlIGZpbmFsaXppbmcg4oCUIG90aGVyd2lzZSB0aGUgc2hhcGUgaGFzIHplcm8gc2l6ZSBhbmQgaXNcbiAgICAgIC8vIGRpc2NhcmRlZCAobW91c2UgaXMgdW5hZmZlY3RlZDogbW92ZSBhbHJlYWR5IHB1dCBpdCBhdCB0aGUgY3Vyc29yKS5cbiAgICAgIGlmIChhZGFwdGVyICYmIGNvbnRhaW5lclJlZi52YWx1ZSkge1xuICAgICAgICBjb25zdCByID0gY29udGFpbmVyUmVmLnZhbHVlLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuICAgICAgICBjb25zdCB0ID0gYWRhcHRlci54VG9UaW1lKGUuY2xpZW50WCAtIHIubGVmdCk7XG4gICAgICAgIGNvbnN0IHAgPSBhZGFwdGVyLnlUb1ByaWNlKGUuY2xpZW50WSAtIHIudG9wKTtcbiAgICAgICAgaWYgKHQgIT09IG51bGwgJiYgcCAhPT0gbnVsbCkge1xuICAgICAgICAgIGNvbnN0IHMyID0gc25hcFRvQ2FuZGxlKHQsIHAsIG1hZ25ldEFjdGl2ZS52YWx1ZSk7XG4gICAgICAgICAgZHJhd2luZ1N0YXRlLnZhbHVlLnRpbWUyID0gczIudGltZTtcbiAgICAgICAgICBkcmF3aW5nU3RhdGUudmFsdWUucHJpY2UyID0gczIucHJpY2U7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGZpbmFsaXplRHJhdygpOyAvLyBzZWNvbmQgY2xpY2sgb2YgY2xpY2sgLT4gbW92ZSAtPiBjbGlja1xuICAgIH0gZWxzZSB7XG4gICAgICBiZWdpbkRyYXcoZSk7XG4gICAgfVxuICB9O1xuICBlbC5hZGRFdmVudExpc3RlbmVyKFwicG9pbnRlcmRvd25cIiwgb25DaGFydE1vdXNlRG93biBhcyBBbnlMaXN0ZW5lciwgdHJ1ZSk7XG4gIGNoYXJ0TW91c2VEb3duRWwgPSBlbDtcbiAgY2hhcnRNb3VzZURvd25DYiA9IG9uQ2hhcnRNb3VzZURvd247XG5cbiAgLy8gVG91Y2ggZGVzZWxlY3Q6IExXQyBwcmV2ZW50LWRlZmF1bHRzIHRvdWNoZXMgb24gaXRzIGNhbnZhcywgc28gdGhlXG4gIC8vIGJyb3dzZXIgbmV2ZXIgc3ludGhlc2l6ZXMgYSBgY2xpY2tgIHRoZXJlIGFuZCB0aGUgY29udGFpbmVyJ3NcbiAgLy8gQGNsaWNrIChkZXNrdG9wIGRlc2VsZWN0KSBuZXZlciBmaXJlcy4gRGV0ZWN0IGEgc3RhdGlvbmFyeSB0b3VjaCB0YXBcbiAgLy8gd2l0aCBwb2ludGVyIGV2ZW50cyBpbnN0ZWFkLiBUYXBzIG9uIGRyYXdpbmcvZGVtbyBoaXQgdGFyZ2V0cyBhcmVcbiAgLy8gZXhjbHVkZWQg4oCUIHRoZWlyIG93biBAY2xpY2sgaGFuZGxlcnMgc2VsZWN0L2Rlc2VsZWN0LlxuICBsZXQgdGFwUHJlc3M6IHsgeDogbnVtYmVyOyB5OiBudW1iZXI7IG9uSGl0OiBib29sZWFuIH0gfCBudWxsID0gbnVsbDtcbiAgY29uc3Qgb25UYXBEb3duID0gKGU6IE1vdXNlRXZlbnQpID0+IHtcbiAgICBpZiAoKGUgYXMgUG9pbnRlckV2ZW50KS5wb2ludGVyVHlwZSA9PT0gXCJtb3VzZVwiKSByZXR1cm47XG4gICAgY29uc3QgdGFyZ2V0ID0gZS50YXJnZXQgYXMgSFRNTEVsZW1lbnQgfCBudWxsO1xuICAgIHRhcFByZXNzID0ge1xuICAgICAgeDogZS5jbGllbnRYLFxuICAgICAgeTogZS5jbGllbnRZLFxuICAgICAgb25IaXQ6ICEhdGFyZ2V0Py5jbG9zZXN0Py4oXCIuZHJhd2luZy1oaXQtbGF5ZXIsIC5kZW1vLWhpdC1sYXllclwiKSxcbiAgICB9O1xuICB9O1xuICBjb25zdCBvblRhcFVwID0gKGU6IE1vdXNlRXZlbnQpID0+IHtcbiAgICBjb25zdCBwcmVzcyA9IHRhcFByZXNzO1xuICAgIHRhcFByZXNzID0gbnVsbDtcbiAgICBpZiAoIXByZXNzIHx8IChlIGFzIFBvaW50ZXJFdmVudCkucG9pbnRlclR5cGUgPT09IFwibW91c2VcIiB8fCBwcmVzcy5vbkhpdCkgcmV0dXJuO1xuICAgIGlmIChNYXRoLmh5cG90KGUuY2xpZW50WCAtIHByZXNzLngsIGUuY2xpZW50WSAtIHByZXNzLnkpID4gOCkgcmV0dXJuOyAvLyBwYW4vc2Nyb2xsXG4gICAgaWYgKCFpc0luQ2hhcnRBcmVhKGUpKSByZXR1cm47XG4gICAgb25DaGFydENsaWNrKCk7XG4gIH07XG4gIGVsLmFkZEV2ZW50TGlzdGVuZXIoXCJwb2ludGVyZG93blwiLCBvblRhcERvd24gYXMgQW55TGlzdGVuZXIsIHRydWUpO1xuICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJ1cFwiLCBvblRhcFVwIGFzIEFueUxpc3RlbmVyKTtcbiAgdGFwRG93bkVsID0gZWw7XG4gIHRhcERvd25DYiA9IG9uVGFwRG93bjtcbiAgdGFwVXBDYiA9IG9uVGFwVXA7XG5cbiAgLy8gRG91YmxlLWNsaWNrIGZpbmlzaGVzIGFuIGluLXByb2dyZXNzIHBvbHlsaW5lIChUcmFkaW5nVmlldy1zdHlsZSk7XG4gIC8vIHRoZSBzZWNvbmQgcHJlc3Mgb2YgdGhlIGRvdWJsZS1jbGljayBhZGRzIG5vIHZlcnRleCAoc2VlIGhhbmRsZVBvbHlDbGljaykuXG4gIGNvbnN0IG9uQ2hhcnREYmxDbGljayA9IChlOiBNb3VzZUV2ZW50KSA9PiB7XG4gICAgaWYgKGRyYXdpbmdzU3RvcmUuYWN0aXZlVG9vbCAhPT0gXCJwb2x5bGluZVwiIHx8ICFwb2x5U3RhdGUudmFsdWUpIHJldHVybjtcbiAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgZS5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICBmaW5hbGl6ZVBvbHkoKTtcbiAgfTtcbiAgZWwuYWRkRXZlbnRMaXN0ZW5lcihcImRibGNsaWNrXCIsIG9uQ2hhcnREYmxDbGljayBhcyBBbnlMaXN0ZW5lcik7XG4gIGNoYXJ0RGJsQ2xpY2tFbCA9IGVsO1xuICBjaGFydERibENsaWNrQ2IgPSBvbkNoYXJ0RGJsQ2xpY2s7XG5cbiAgLy8gUmlnaHQtY2xpY2sgT04gVEhFIENIQVJUIFBBTkU6IGNhbmNlbCBpbi1wcm9ncmVzcyBkcmF3aW5nLCBkZXNlbGVjdCxcbiAgLy8gYmFjayB0byBjdXJzb3IuIFNjb3BlZCB0byB0aGUgcGFuZSBzbyB0aGUgYnJvd3NlciBjb250ZXh0IG1lbnUgc3RpbGxcbiAgLy8gd29ya3MgZXZlcnl3aGVyZSBlbHNlIGluIHRoZSBhcHAuXG4gIGNvbnN0IHBhbmVFbCA9IChlbC5jbG9zZXN0KFwiLmNoYXJ0LXBhbmVcIikgYXMgSFRNTEVsZW1lbnQgfCBudWxsKSA/PyBlbDtcbiAgY29uc3Qgb25QYW5lQ29udGV4dE1lbnUgPSAoZTogTW91c2VFdmVudCkgPT4ge1xuICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICBlLnN0b3BQcm9wYWdhdGlvbigpO1xuICAgIC8vIFJpZ2h0LWNsaWNrIE9OIGEgcmVjdGFuZ2xlIOKGkiBUcmFkaW5nVmlldy1zdHlsZSBjb250ZXh0IG1lbnUgZm9yIGl0XG4gICAgY29uc3QgdGFyZ2V0ID0gZS50YXJnZXQgYXMgSFRNTEVsZW1lbnQgfCBudWxsO1xuICAgIGNvbnN0IHJlY3RFbCA9IHRhcmdldD8uY2xvc2VzdD8uKFwiLmRyYXdpbmctaGl0LXJlY3RcIikgYXMgSFRNTEVsZW1lbnQgfCBudWxsO1xuICAgIGNvbnN0IHJlY3RJZCA9IHJlY3RFbD8uZ2V0QXR0cmlidXRlKFwiZGF0YS1yZWN0LWlkXCIpID8/IG51bGw7XG4gICAgaWYgKHJlY3RJZCkge1xuICAgICAgaWYgKGRyYXdpbmdzU3RvcmUuYWN0aXZlVG9vbCAhPT0gXCJjdXJzb3JcIikgZHJhd2luZ3NTdG9yZS5hY3RpdmVUb29sID0gXCJjdXJzb3JcIjtcbiAgICAgIGRyYXdpbmdzU3RvcmUuc2VsZWN0ZWRJZCA9IHJlY3RJZDtcbiAgICAgIHNlbGVjdGVkUmVjdC52YWx1ZSA9IGRyYXdpbmdzU3RvcmUuZ2V0Rm9yKG1hcmtldC5pbnN0cnVtZW50KS5maW5kKChyKSA9PiByLmlkID09PSByZWN0SWQpID8/IG51bGw7XG4gICAgICByZWNhbGNSZWN0cygpO1xuICAgICAgcG9zaXRpb25FZGl0UGFuZWwocmVjdElkKTtcbiAgICAgIGNvbnN0IHBhbmVSZWN0ID0gcGFuZUVsLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuICAgICAgLy8gS2VlcCB0aGUgbWVudSBpbnNpZGUgdGhlIHBhbmUgKG1lYXN1cmVkIG9uY2UgbW91bnRlZCwgZmFsbGJhY2sgYmVsb3cpXG4gICAgICBjb25zdCBwb3MgPSBjbGFtcFRvUGFuZShlLmNsaWVudFggLSBwYW5lUmVjdC5sZWZ0LCBlLmNsaWVudFkgLSBwYW5lUmVjdC50b3AsIGVkaXRNZW51RWwudmFsdWUpO1xuICAgICAgcmVjdE1lbnUudmFsdWUgPSB7IGlkOiByZWN0SWQsIHg6IHBvcy54LCB5OiBwb3MueSB9O1xuICAgICAgY2xvc2VQYWxldHRlKCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHJlY3RNZW51LnZhbHVlID0gbnVsbDtcbiAgICBjbG9zZVBhbGV0dGUoKTtcbiAgICBpZiAoZHJhd2luZ3NTdG9yZS5hY3RpdmVUb29sICE9PSBcImN1cnNvclwiKSBkcmF3aW5nc1N0b3JlLmFjdGl2ZVRvb2wgPSBcImN1cnNvclwiO1xuICAgIGNhbmNlbERyYXcoKTtcbiAgICBpZiAoZHJhd2luZ3NTdG9yZS5zZWxlY3RlZElkIHx8IHNlbGVjdGVkUmVjdC52YWx1ZSkge1xuICAgICAgZHJhd2luZ3NTdG9yZS5zZWxlY3RlZElkID0gbnVsbDtcbiAgICAgIHNlbGVjdGVkUmVjdC52YWx1ZSA9IG51bGw7XG4gICAgICBlZGl0UGFuZWxQb3MudmFsdWUgPSBudWxsO1xuICAgICAgcmVjYWxjUmVjdHMoKTtcbiAgICB9XG4gICAgaWYgKGRyYXdpbmdzU3RvcmUuc2VsZWN0ZWRMaW5lSWQgfHwgc2VsZWN0ZWRMaW5lLnZhbHVlKSB7XG4gICAgICBkcmF3aW5nc1N0b3JlLnNlbGVjdGVkTGluZUlkID0gbnVsbDtcbiAgICAgIHNlbGVjdGVkTGluZS52YWx1ZSA9IG51bGw7XG4gICAgICBsaW5lUGFuZWxQb3MudmFsdWUgPSBudWxsO1xuICAgICAgbGluZVBhbGV0dGVPcGVuLnZhbHVlID0gZmFsc2U7XG4gICAgICByZWNhbGNSZWN0cygpO1xuICAgIH1cbiAgICBpZiAoZHJhd2luZ3NTdG9yZS5zZWxlY3RlZFBvbHlJZCB8fCBzZWxlY3RlZFBvbHkudmFsdWUpIHtcbiAgICAgIGRyYXdpbmdzU3RvcmUuc2VsZWN0ZWRQb2x5SWQgPSBudWxsO1xuICAgICAgc2VsZWN0ZWRQb2x5LnZhbHVlID0gbnVsbDtcbiAgICAgIHBvbHlQYW5lbFBvcy52YWx1ZSA9IG51bGw7XG4gICAgICBwb2x5UGFsZXR0ZU9wZW4udmFsdWUgPSBmYWxzZTtcbiAgICAgIHJlY2FsY1JlY3RzKCk7XG4gICAgfVxuICAgIGlmIChkcmF3aW5nc1N0b3JlLnNlbGVjdGVkUG9zaXRpb25JZCB8fCBzZWxlY3RlZFBvcy52YWx1ZSkge1xuICAgICAgZHJhd2luZ3NTdG9yZS5zZWxlY3RlZFBvc2l0aW9uSWQgPSBudWxsO1xuICAgICAgc2VsZWN0ZWRQb3MudmFsdWUgPSBudWxsO1xuICAgICAgcG9zUGFuZWxQb3MudmFsdWUgPSBudWxsO1xuICAgICAgcmVjYWxjUmVjdHMoKTtcbiAgICB9XG4gICAgaWYgKGRyYXdpbmdzU3RvcmUuc2VsZWN0ZWRTaW5nbGUpIHtcbiAgICAgIGRyYXdpbmdzU3RvcmUuc2VsZWN0ZWRTaW5nbGUgPSBudWxsO1xuICAgICAgc2luZ2xlUGFuZWxQb3MudmFsdWUgPSBudWxsO1xuICAgICAgcmVjYWxjUmVjdHMoKTtcbiAgICB9XG4gIH07XG4gIHBhbmVFbC5hZGRFdmVudExpc3RlbmVyKFwiY29udGV4dG1lbnVcIiwgb25QYW5lQ29udGV4dE1lbnUgYXMgQW55TGlzdGVuZXIpO1xuICBwYW5lQ3R4RWwgPSBwYW5lRWw7XG4gIHBhbmVDdHhDYiA9IG9uUGFuZUNvbnRleHRNZW51O1xuXG4gIC8vIEVzY2FwZSBhYm9ydHMgYW4gaW4tcHJvZ3Jlc3MgZHJhd2luZzsgRGVsZXRlIHJlbW92ZXMgdGhlIHNlbGVjdGVkIHJlY3RhbmdsZVxuICBjb25zdCBvbktleSA9IChlOiBLZXlib2FyZEV2ZW50KSA9PiB7XG4gICAgaWYgKGUua2V5ID09PSBcIkVzY2FwZVwiKSB7XG4gICAgICBjYW5jZWxEcmF3KCk7XG4gICAgICByZWN0TWVudS52YWx1ZSA9IG51bGw7XG4gICAgICBjbG9zZVBhbGV0dGUoKTtcbiAgICAgIGxpbmVQYWxldHRlT3Blbi52YWx1ZSA9IGZhbHNlO1xuICAgICAgcG9seVBhbGV0dGVPcGVuLnZhbHVlID0gZmFsc2U7XG4gICAgfSBlbHNlIGlmIChlLmtleSA9PT0gXCJEZWxldGVcIiB8fCBlLmtleSA9PT0gXCJCYWNrc3BhY2VcIikge1xuICAgICAgLy8gTmV2ZXIgaGlqYWNrIHR5cGluZyBpbnNpZGUgZm9ybSBmaWVsZHNcbiAgICAgIGNvbnN0IHQgPSBlLnRhcmdldCBhcyBIVE1MRWxlbWVudCB8IG51bGw7XG4gICAgICBpZiAodCAmJiAodC50YWdOYW1lID09PSBcIklOUFVUXCIgfHwgdC50YWdOYW1lID09PSBcIlRFWFRBUkVBXCIgfHwgdC5pc0NvbnRlbnRFZGl0YWJsZSkpIHJldHVybjtcbiAgICAgIGlmIChzZWxlY3RlZFJlY3QudmFsdWUpIHtcbiAgICAgICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICBkZWxldGVTZWxlY3RlZCgpO1xuICAgICAgfSBlbHNlIGlmIChzZWxlY3RlZExpbmUudmFsdWUpIHtcbiAgICAgICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICBkZWxldGVTZWxlY3RlZExpbmUoKTtcbiAgICAgIH0gZWxzZSBpZiAoc2VsZWN0ZWRQb2x5LnZhbHVlKSB7XG4gICAgICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgZGVsZXRlU2VsZWN0ZWRQb2x5KCk7XG4gICAgICB9IGVsc2UgaWYgKHNlbGVjdGVkUG9zLnZhbHVlKSB7XG4gICAgICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgZGVsZXRlU2VsZWN0ZWRQb3MoKTtcbiAgICAgIH0gZWxzZSBpZiAoZHJhd2luZ3NTdG9yZS5zZWxlY3RlZFNpbmdsZSkge1xuICAgICAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgIGRlbGV0ZVNlbGVjdGVkU2luZ2xlKCk7XG4gICAgICB9XG4gICAgfVxuICB9O1xuICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcihcImtleWRvd25cIiwgb25LZXkgYXMgQW55TGlzdGVuZXIpO1xuICBlc2NDYiA9IG9uS2V5O1xuXG4gIC8vIE1hZ25ldCBtb2RpZmllcjogaG9sZGluZyBDdHJsIGZvcmNlcyBzbmFwLXRvLWNhbmRsZSB3aGlsZSBoZWxkICh0aGVcbiAgLy8gdG9vbGJhciBtYWduZXQgYnV0dG9uIGxhdGNoZXMgaXQg4oCUIHRoZSBzdG9yZSdzIG1hZ25ldEFjdGl2ZSBkcml2ZXMgYm90aFxuICAvLyB0aGUgYnV0dG9uIGhpZ2hsaWdodCBhbmQgdGhlIHNuYXBwaW5nIGNyb3NzaGFpcikuIEJsdXIgY2xlYXJzIHRoZSBoZWxkXG4gIC8vIHN0YXRlIHNvIEN0cmwgcmVsZWFzZWQgb3V0c2lkZSB0aGUgd2luZG93IGNhbid0IHN0aWNrIG9uLlxuICBjb25zdCBvbk1hZ25ldEtleSA9IChlOiBLZXlib2FyZEV2ZW50KSA9PiB7XG4gICAgaWYgKGUua2V5ID09PSBcIkNvbnRyb2xcIikge1xuICAgICAgZHJhd2luZ3NTdG9yZS5zZXRDdHJsSGVsZChlLnR5cGUgPT09IFwia2V5ZG93blwiKTtcbiAgICAgIGlmIChlLnR5cGUgPT09IFwia2V5dXBcIikgc25hcFhoYWlyLnZhbHVlID0gbnVsbDtcbiAgICB9XG4gIH07XG4gIGNvbnN0IG9uTWFnbmV0Qmx1ciA9ICgpID0+IHtcbiAgICBkcmF3aW5nc1N0b3JlLnNldEN0cmxIZWxkKGZhbHNlKTtcbiAgICBzbmFwWGhhaXIudmFsdWUgPSBudWxsO1xuICB9O1xuICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcihcImtleWRvd25cIiwgb25NYWduZXRLZXkpO1xuICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcihcImtleXVwXCIsIG9uTWFnbmV0S2V5KTtcbiAgd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoXCJibHVyXCIsIG9uTWFnbmV0Qmx1cik7XG4gIG1hZ25ldEtleUNiID0gb25NYWduZXRLZXk7XG4gIG1hZ25ldEJsdXJDYiA9IG9uTWFnbmV0Qmx1cjtcblxuICAvLyBUcmFjayB0aGUgY3Vyc29yIGdsb2JhbGx5IChub3QganVzdCBvdmVyIHRoZSBjaGFydCkgc28gdGhlIG1hZ25ldFxuICAvLyB0b2dnbGUgcmVwbGF5IGFsd2F5cyB1c2VzIHRoZSBDVVJSRU5UIHBvaW50ZXIgcG9zaXRpb24sIGV2ZW4gd2hlbiBpdFxuICAvLyBsYXN0IHBhc3NlZCBvdmVyIHRoZSBlZGl0IHBhbmVsIG9yIGEgdG9vbGJhci5cbiAgY29uc3Qgb25BbnlNb3ZlID0gKGU6IFBvaW50ZXJFdmVudCkgPT4ge1xuICAgIGxhc3RQdHJDbGllbnQgPSB7IGNsaWVudFg6IGUuY2xpZW50WCwgY2xpZW50WTogZS5jbGllbnRZIH07XG4gIH07XG4gIHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKFwicG9pbnRlcm1vdmVcIiwgb25BbnlNb3ZlLCB7IHBhc3NpdmU6IHRydWUgfSk7XG4gIG1hZ25ldEFueU1vdmVDYiA9IG9uQW55TW92ZTtcblxuICAvLyBTbmFwcGluZyBjcm9zc2hhaXIgdHJhY2tpbmc6IHdoaWxlIGEgZHJhd2luZyB0b29sICsgbWFnbmV0IGFyZSBhY3RpdmUsXG4gIC8vIHRoZSBuYXRpdmUgY3Jvc3NoYWlyIGlzIGhpZGRlbiBhbmQgdGhpcyBvbmUgc3RpY2tzIHRvIGNhbmRsZSBoaWdoL2xvdy5cbiAgLy8gVGhlIGxhc3QgcG9pbnRlciBwb3NpdGlvbiBpcyBrZXB0IHNvIHRoZSBzbmFwcGVkIGNyb3NzaGFpciBhcHBlYXJzIHRoZVxuICAvLyBJTlNUQU5UIEN0cmwgaXMgaGVsZCAvIHRoZSBtYWduZXQgbGF0Y2hlcyDigJQgYmVmb3JlIGFueSBtb3VzZSBtb3ZlbWVudC5cbiAgY29uc3QgY29tcHV0ZVNuYXBYaGFpciA9IChjbGllbnRYOiBudW1iZXIsIGNsaWVudFk6IG51bWJlcik6IHZvaWQgPT4ge1xuICAgIGlmICghZHJhd2luZ1Rvb2xBY3RpdmUudmFsdWUgfHwgIW1hZ25ldEFjdGl2ZS52YWx1ZSB8fCAhYWRhcHRlciB8fCAhY29udGFpbmVyUmVmLnZhbHVlKSB7XG4gICAgICBzbmFwWGhhaXIudmFsdWUgPSBudWxsO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCByID0gY29udGFpbmVyUmVmLnZhbHVlLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuICAgIGNvbnN0IGZha2UgPSB7IGNsaWVudFgsIGNsaWVudFksIGJ1dHRvbjogMCwgYnV0dG9uczogMCB9IGFzIE1vdXNlRXZlbnQ7XG4gICAgaWYgKCFpc0luQ2hhcnRBcmVhKGZha2UpKSB7XG4gICAgICBzbmFwWGhhaXIudmFsdWUgPSBudWxsO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCB0ID0gYWRhcHRlci54VG9UaW1lKGNsaWVudFggLSByLmxlZnQpO1xuICAgIGNvbnN0IHAgPSBhZGFwdGVyLnlUb1ByaWNlKGNsaWVudFkgLSByLnRvcCk7XG4gICAgY29uc3QgcyA9IHQgIT09IG51bGwgJiYgcCAhPT0gbnVsbCA/IHNuYXBUb0NhbmRsZSh0LCBwLCB0cnVlKSA6IG51bGw7XG4gICAgY29uc3QgeCA9IHMgPyBhZGFwdGVyLnRpbWVUb1gocy50aW1lKSA6IG51bGw7XG4gICAgY29uc3QgeSA9IHMgPyBhZGFwdGVyLmdldFByaWNlWShzLnByaWNlKSA6IG51bGw7XG4gICAgc25hcFhoYWlyLnZhbHVlID0geCAhPT0gbnVsbCAmJiB5ICE9PSBudWxsICYmIHNcbiAgICAgID8geyB4LCB5LCBwcmljZVRleHQ6IGZtdFByaWNlKHMucHJpY2UsIGluc3RydW1lbnRQcmVjaXNpb24obWFya2V0Lmluc3RydW1lbnQpKSwgdGltZVRleHQ6IGZtdEF4aXNUaW1lKHMudGltZSkgfVxuICAgICAgOiBudWxsO1xuICB9O1xuICBjb25zdCBvblhoYWlyTW92ZSA9IChlOiBNb3VzZUV2ZW50KSA9PiB7XG4gICAgbGFzdFB0ckNsaWVudCA9IHsgY2xpZW50WDogZS5jbGllbnRYLCBjbGllbnRZOiBlLmNsaWVudFkgfTtcbiAgICBjb21wdXRlU25hcFhoYWlyKGUuY2xpZW50WCwgZS5jbGllbnRZKTtcbiAgfTtcbiAgY29uc3Qgb25YaGFpckxlYXZlID0gKCkgPT4ge1xuICAgIGxhc3RQdHJDbGllbnQgPSBudWxsO1xuICAgIHNuYXBYaGFpci52YWx1ZSA9IG51bGw7XG4gIH07XG4gIGVsLmFkZEV2ZW50TGlzdGVuZXIoXCJwb2ludGVybW92ZVwiLCBvblhoYWlyTW92ZSk7XG4gIGVsLmFkZEV2ZW50TGlzdGVuZXIoXCJwb2ludGVybGVhdmVcIiwgb25YaGFpckxlYXZlKTtcbiAgeGhhaXJNb3ZlRWwgPSBlbDtcbiAgeGhhaXJNb3ZlQ2IgPSBvblhoYWlyTW92ZTtcbiAgeGhhaXJMZWF2ZUNiID0gb25YaGFpckxlYXZlO1xuXG4gIC8vIFN3YXAgdGhlIG5hdGl2ZSBjcm9zc2hhaXIgZm9yIHRoZSBzbmFwcGluZyBvbmUgb25seSB3aGlsZSBuZWVkZWRcbiAgY29uc3Qgc3luY0Nyb3NzaGFpck1vZGUgPSAoKSA9PiB7XG4gICAgY29uc3QgY3VzdG9tID0gZHJhd2luZ1Rvb2xBY3RpdmUudmFsdWUgJiYgbWFnbmV0QWN0aXZlLnZhbHVlO1xuICAgIGFkYXB0ZXI/LnNldENyb3NzaGFpclZpc2libGUoIWN1c3RvbSk7XG4gICAgaWYgKGN1c3RvbSAmJiBsYXN0UHRyQ2xpZW50KSBjb21wdXRlU25hcFhoYWlyKGxhc3RQdHJDbGllbnQuY2xpZW50WCwgbGFzdFB0ckNsaWVudC5jbGllbnRZKTtcbiAgICBlbHNlIGlmICghY3VzdG9tKSBzbmFwWGhhaXIudmFsdWUgPSBudWxsO1xuICB9O1xuICBzeW5jQ3Jvc3NoYWlyTW9kZSgpO1xuICBjcm9zc2hhaXJNb2RlU3RvcCA9IHdhdGNoKFtkcmF3aW5nVG9vbEFjdGl2ZSwgbWFnbmV0QWN0aXZlXSwgc3luY0Nyb3NzaGFpck1vZGUpO1xuXG4gIC8vIEEgbW91c2V1cCByZWxlYXNlZCBPVVRTSURFIHRoZSBicm93c2VyIHdpbmRvdyBuZXZlciByZWFjaGVzIHVzIOKAlCB3aXRob3V0XG4gIC8vIHRoaXMsIHRoZSBoYWxmLWRyYXduIHByZXZpZXcgc3RheXMgYWxpdmUgYW5kIHRoZSBuZXh0IGNoYXJ0IGNsaWNrXG4gIC8vIGZpbmFsaXplcyBpdCBhcyBhIGR1cGxpY2F0ZSByZWN0YW5nbGUuXG4gIGNvbnN0IG9uV2luZG93TG9zdCA9ICgpID0+IGNhbmNlbERyYXcoKTtcbiAgd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoXCJibHVyXCIsIG9uV2luZG93TG9zdCk7XG4gIHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKFwicG9pbnRlcmNhbmNlbFwiLCBvbldpbmRvd0xvc3QgYXMgQW55TGlzdGVuZXIpO1xuICB3aW5kb3dMb3N0Q2IgPSBvbldpbmRvd0xvc3Q7XG5cbiAgLy8gQ291bnRkb3duIHRleHQgKyBwb3NpdGlvbiB0aWNrIChwb3NpdGlvbiBhbHNvIHVwZGF0ZXMgb24gcGFuL3pvb20gYWJvdmUpXG4gIHVwZGF0ZUNvdW50ZG93bigpO1xuICBjb3VudGRvd25UaW1lciA9IHNldEludGVydmFsKHVwZGF0ZUNvdW50ZG93biwgMjAwKTtcblxuICBybyA9IG5ldyBSZXNpemVPYnNlcnZlcigoKSA9PiB7XG4gICAgaWYgKCFjb250YWluZXJSZWYudmFsdWUgfHwgIWFkYXB0ZXIpIHJldHVybjtcbiAgICBjb25zdCB7IGNsaWVudFdpZHRoLCBjbGllbnRIZWlnaHQgfSA9IGNvbnRhaW5lclJlZi52YWx1ZTtcbiAgICBhZGFwdGVyLnJlc2l6ZShjbGllbnRXaWR0aCwgY2xpZW50SGVpZ2h0KTtcbiAgICAvLyBSZS1tZWFzdXJlIHRoZSBheGlzIHNpemVzIG9uIGV2ZXJ5IGxheW91dCBjaGFuZ2VcbiAgICB1cGRhdGVBeGlzU2l6ZXMoKTtcbiAgICAvLyBSZS1wcm9qZWN0IHJlY3RhbmdsZXMgJiB0aGUgYmFkZ2Ugb250byB0aGUgTkVXIGNvb3JkaW5hdGUgbWFwcGluZyByaWdodFxuICAgIC8vIGF3YXkg4oCUIG90aGVyd2lzZSB0aGV5IGtlZXAgdGhlIG9sZCBwaXhlbCBnZW9tZXRyeSAoYW5kIGFwcGVhciB0byBzbGlkZVxuICAgIC8vIGFyb3VuZCkgdW50aWwgdGhlIG5leHQgcGFuL3pvb20gZXZlbnQgbGFuZHMuIFRoZSByQUYgZ3VhcmFudGVlcyB0aGVcbiAgICAvLyBsaWJyYXJ5IGhhcyBmaW5pc2hlZCBpdHMgb3duIHJlLWxheW91dCBiZWZvcmUgd2UgcmVhZCBjb29yZGluYXRlcy5cbiAgICByZXF1ZXN0QW5pbWF0aW9uRnJhbWUoKCkgPT4ge1xuICAgICAgaWYgKCFhZGFwdGVyKSByZXR1cm47XG4gICAgICB1cGRhdGVCYWRnZVBvc2l0aW9uKCk7XG4gICAgICByZWNhbGNSZWN0cygpO1xuICAgICAgZXh0ZW5kUmVjYWxjRnJhbWVzKDMwMCk7XG4gICAgfSk7XG4gIH0pO1xuICByby5vYnNlcnZlKGNvbnRhaW5lclJlZi52YWx1ZSk7XG59KTtcblxub25CZWZvcmVVbm1vdW50KCgpID0+IHtcbiAgZG9jdW1lbnQucmVtb3ZlRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJkb3duXCIsIGluZFNldHRpbmdzT3V0c2lkZSwgdHJ1ZSk7XG4gIGlmICh2aXNpYmxlQ2IgJiYgYWRhcHRlcikgYWRhcHRlci51bnN1YnNjcmliZVZpc2libGVSYW5nZSh2aXNpYmxlQ2IpO1xuICBpZiAoZGF0YUNiICYmIGFkYXB0ZXIpIGFkYXB0ZXIudW5zdWJzY3JpYmVEYXRhQ2hhbmdlZChkYXRhQ2IpO1xuICBpZiAoY291bnRkb3duVGltZXIpIGNsZWFySW50ZXJ2YWwoY291bnRkb3duVGltZXIpO1xuICBzdG9wSG9sZCgpO1xuICBzdG9wUGlja2luZ0xpc3RlbmVycygpO1xuICBkZW1vTGluZURyYWcgPSBudWxsO1xuICBpZiAocmVwbGF5VGltZXIpIHtcbiAgICBjbGVhckludGVydmFsKHJlcGxheVRpbWVyKTtcbiAgICByZXBsYXlUaW1lciA9IG51bGw7XG4gIH1cbiAgaWYgKGludGVyYWN0aW9uRWwgJiYgaW50ZXJhY3RDYikge1xuICAgIGludGVyYWN0aW9uRWwucmVtb3ZlRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJtb3ZlXCIsIGludGVyYWN0Q2IpO1xuICAgIGludGVyYWN0aW9uRWwucmVtb3ZlRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJkb3duXCIsIGludGVyYWN0Q2IpO1xuICAgIGludGVyYWN0aW9uRWwucmVtb3ZlRXZlbnRMaXN0ZW5lcihcIndoZWVsXCIsIGludGVyYWN0Q2IpO1xuICAgIGludGVyYWN0aW9uRWwucmVtb3ZlRXZlbnRMaXN0ZW5lcihcInRvdWNobW92ZVwiLCBpbnRlcmFjdENiKTtcbiAgfVxuICBpZiAob3ZlcmxheVdoZWVsRWwgJiYgb3ZlcmxheVdoZWVsQ2IpIHtcbiAgICBvdmVybGF5V2hlZWxFbC5yZW1vdmVFdmVudExpc3RlbmVyKFwid2hlZWxcIiwgb3ZlcmxheVdoZWVsQ2IsIHRydWUpO1xuICB9XG4gIGlmIChjaGFydE1vdXNlRG93bkVsICYmIGNoYXJ0TW91c2VEb3duQ2IpIHtcbiAgICBjaGFydE1vdXNlRG93bkVsLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJwb2ludGVyZG93blwiLCBjaGFydE1vdXNlRG93bkNiIGFzIEFueUxpc3RlbmVyLCB0cnVlKTtcbiAgfVxuICBpZiAodGFwRG93bkVsICYmIHRhcERvd25DYikge1xuICAgIHRhcERvd25FbC5yZW1vdmVFdmVudExpc3RlbmVyKFwicG9pbnRlcmRvd25cIiwgdGFwRG93bkNiIGFzIEFueUxpc3RlbmVyLCB0cnVlKTtcbiAgfVxuICBpZiAodGFwVXBDYikge1xuICAgIHdpbmRvdy5yZW1vdmVFdmVudExpc3RlbmVyKFwicG9pbnRlcnVwXCIsIHRhcFVwQ2IgYXMgQW55TGlzdGVuZXIpO1xuICB9XG4gIGlmIChjaGFydERibENsaWNrRWwgJiYgY2hhcnREYmxDbGlja0NiKSB7XG4gICAgY2hhcnREYmxDbGlja0VsLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJkYmxjbGlja1wiLCBjaGFydERibENsaWNrQ2IgYXMgQW55TGlzdGVuZXIpO1xuICB9XG4gIGlmIChyZWNhbGNSYWYpIGNhbmNlbEFuaW1hdGlvbkZyYW1lKHJlY2FsY1JhZik7XG4gIGlmIChwb2ludGVyRG93bkVsICYmIHBvaW50ZXJEb3duQ2IpIHtcbiAgICBwb2ludGVyRG93bkVsLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJwb2ludGVyZG93blwiLCBwb2ludGVyRG93bkNiKTtcbiAgfVxuICBpZiAocG9pbnRlclVwQ2IpIHtcbiAgICB3aW5kb3cucmVtb3ZlRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJ1cFwiLCBwb2ludGVyVXBDYik7XG4gIH1cbiAgaWYgKHBhbmVDdHhFbCAmJiBwYW5lQ3R4Q2IpIHtcbiAgICBwYW5lQ3R4RWwucmVtb3ZlRXZlbnRMaXN0ZW5lcihcImNvbnRleHRtZW51XCIsIHBhbmVDdHhDYiBhcyBBbnlMaXN0ZW5lcik7XG4gIH1cbiAgaWYgKGVzY0NiKSB7XG4gICAgd2luZG93LnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJrZXlkb3duXCIsIGVzY0NiIGFzIEFueUxpc3RlbmVyKTtcbiAgfVxuICBpZiAobWFnbmV0S2V5Q2IpIHtcbiAgICB3aW5kb3cucmVtb3ZlRXZlbnRMaXN0ZW5lcihcImtleWRvd25cIiwgbWFnbmV0S2V5Q2IpO1xuICAgIHdpbmRvdy5yZW1vdmVFdmVudExpc3RlbmVyKFwia2V5dXBcIiwgbWFnbmV0S2V5Q2IpO1xuICB9XG4gIGlmIChtYWduZXRCbHVyQ2IpIHtcbiAgICB3aW5kb3cucmVtb3ZlRXZlbnRMaXN0ZW5lcihcImJsdXJcIiwgbWFnbmV0Qmx1ckNiKTtcbiAgfVxuICBpZiAobWFnbmV0QW55TW92ZUNiKSB7XG4gICAgd2luZG93LnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJwb2ludGVybW92ZVwiLCBtYWduZXRBbnlNb3ZlQ2IpO1xuICB9XG4gIGlmICh4aGFpck1vdmVFbCAmJiB4aGFpck1vdmVDYikge1xuICAgIHhoYWlyTW92ZUVsLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJwb2ludGVybW92ZVwiLCB4aGFpck1vdmVDYik7XG4gICAgeGhhaXJNb3ZlRWwucmVtb3ZlRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJsZWF2ZVwiLCB4aGFpckxlYXZlQ2IhKTtcbiAgfVxuICBjcm9zc2hhaXJNb2RlU3RvcD8uKCk7XG4gIGFkYXB0ZXI/LnNldENyb3NzaGFpclZpc2libGUodHJ1ZSk7XG4gIGlmICh3aW5kb3dMb3N0Q2IpIHtcbiAgICB3aW5kb3cucmVtb3ZlRXZlbnRMaXN0ZW5lcihcImJsdXJcIiwgd2luZG93TG9zdENiKTtcbiAgICB3aW5kb3cucmVtb3ZlRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJjYW5jZWxcIiwgd2luZG93TG9zdENiIGFzIEFueUxpc3RlbmVyKTtcbiAgfVxuICBpZiAob25Nb3VzZU1vdmVSZWYpIHtcbiAgICB3aW5kb3cucmVtb3ZlRXZlbnRMaXN0ZW5lcihcInBvaW50ZXJtb3ZlXCIsIG9uTW91c2VNb3ZlUmVmKTtcbiAgfVxuICBybz8uZGlzY29ubmVjdCgpO1xuICBhZGFwdGVyPy5kZXN0cm95KCk7XG4gIGFkYXB0ZXIgPSBudWxsO1xufSk7XG48L3NjcmlwdD5cblxuPHRlbXBsYXRlPlxuICA8ZGl2IHJlZj1cInBhbmVSZWZcIiBjbGFzcz1cImNoYXJ0LXBhbmVcIj5cbiAgICA8IS0tIFRvcC1sZWZ0IHN5bWJvbCBsYWJlbCBsaWtlIFRyYWRpbmdWaWV3IOKAlCB0cmFuc3BhcmVudCwgb25seSBsZXR0ZXJzIHdpdGggZmxhZ3MgLS0+XG4gICAgPGRpdiB2LWlmPVwiaW5zdHJ1bWVudFwiIGNsYXNzPVwiY2hhcnQtc3ltYm9sLWxhYmVsXCI+XG4gICAgICA8c3BhbiBjbGFzcz1cImxhYmVsLXRleHRcIj5cbiAgICAgICAgPHRlbXBsYXRlIHYtZm9yPVwiKHBhcnQsIGlkeCkgaW4gc3ltYm9sUGFydHMoaW5zdHJ1bWVudClcIiA6a2V5PVwicGFydFwiPlxuICAgICAgICAgIDxpbWcgdi1pZj1cImZsYWdGb3IocGFydCkudHlwZSA9PT0gJ2ZsYWcnXCIgOnNyYz1cImZsYWdGb3IocGFydCkudmFsdWVcIiA6YWx0PVwicGFydFwiIGNsYXNzPVwiZmxhZy1pbWdcIiAvPlxuICAgICAgICAgIDxzcGFuIHYtZWxzZSBjbGFzcz1cImZsYWctZW1vamlcIj57eyBmbGFnRm9yKHBhcnQpLnZhbHVlIH19PC9zcGFuPlxuICAgICAgICAgIHt7IHBhcnQgfX1cbiAgICAgICAgICA8c3BhbiB2LWlmPVwiaWR4ID09PSAwXCI+IC8gPC9zcGFuPlxuICAgICAgICA8L3RlbXBsYXRlPlxuICAgICAgICAtIHt7IGluc3RydW1lbnQgJiYgcHJvdmlkZXJPZihpbnN0cnVtZW50KSA9PT0gXCJiaW5hbmNlXCIgPyBcIkJJTkFOQ0VcIiA6IFwiT0FOREFcIiB9fVxuICAgICAgPC9zcGFuPlxuICAgIDwvZGl2PlxuXG4gICAgPCEtLSBJbmRpY2F0b3IgbGVnZW5kIChUcmFkaW5nVmlldy1zdHlsZSk6IG5hbWUgKyBleWUvc2V0dGluZ3MvcmVtb3ZlIC0tPlxuICAgIDxkaXYgdi1pZj1cImluZGljYXRvcnMuc2Vzc2lvbnNBZGRlZCAmJiBpbnN0cnVtZW50XCIgY2xhc3M9XCJpbmRpY2F0b3ItbGVnZW5kXCI+XG4gICAgICA8c3BhbiBjbGFzcz1cImluZC1sZWdlbmQtbmFtZVwiIDpjbGFzcz1cInsgb2ZmOiAhaW5kaWNhdG9ycy5zZXNzaW9uc1Zpc2libGUgfVwiPlNlc3Npb25zPC9zcGFuPlxuICAgICAgPGJ1dHRvbiBjbGFzcz1cImluZC1sZWdlbmQtYnRuXCIgdHlwZT1cImJ1dHRvblwiIDp0aXRsZT1cImluZGljYXRvcnMuc2Vzc2lvbnNWaXNpYmxlID8gJ0hpZGUnIDogJ1Nob3cnXCIgQGNsaWNrPVwiaW5kaWNhdG9ycy5zZXNzaW9uc1Zpc2libGUgPSAhaW5kaWNhdG9ycy5zZXNzaW9uc1Zpc2libGVcIj5cbiAgICAgICAgPHN2ZyB2LWlmPVwiaW5kaWNhdG9ycy5zZXNzaW9uc1Zpc2libGVcIiB2aWV3Qm94PVwiMCAwIDI0IDI0XCIgd2lkdGg9XCIxM1wiIGhlaWdodD1cIjEzXCIgZmlsbD1cIm5vbmVcIiBzdHJva2U9XCJjdXJyZW50Q29sb3JcIiBzdHJva2Utd2lkdGg9XCIxLjhcIiBzdHJva2UtbGluZWNhcD1cInJvdW5kXCIgc3Ryb2tlLWxpbmVqb2luPVwicm91bmRcIiBhcmlhLWhpZGRlbj1cInRydWVcIj5cbiAgICAgICAgICA8cGF0aCBkPVwiTTIgMTJzMy41LTYuNSAxMC02LjVTMjIgMTIgMjIgMTJzLTMuNSA2LjUtMTAgNi41UzIgMTIgMiAxMnpcIiAvPlxuICAgICAgICAgIDxjaXJjbGUgY3g9XCIxMlwiIGN5PVwiMTJcIiByPVwiMi42XCIgLz5cbiAgICAgICAgPC9zdmc+XG4gICAgICAgIDxzdmcgdi1lbHNlIHZpZXdCb3g9XCIwIDAgMjQgMjRcIiB3aWR0aD1cIjEzXCIgaGVpZ2h0PVwiMTNcIiBmaWxsPVwibm9uZVwiIHN0cm9rZT1cImN1cnJlbnRDb2xvclwiIHN0cm9rZS13aWR0aD1cIjEuOFwiIHN0cm9rZS1saW5lY2FwPVwicm91bmRcIiBzdHJva2UtbGluZWpvaW49XCJyb3VuZFwiIGFyaWEtaGlkZGVuPVwidHJ1ZVwiPlxuICAgICAgICAgIDxwYXRoIGQ9XCJNMiAxMnMzLjUtNi41IDEwLTYuNWMyIDAgMy43LjYgNS4xIDEuNU0yMiAxMnMtMy41IDYuNS0xMCA2LjVjLTIgMC0zLjctLjYtNS4xLTEuNVwiIC8+XG4gICAgICAgICAgPHBhdGggZD1cIk00IDIwTDIwIDRcIiAvPlxuICAgICAgICA8L3N2Zz5cbiAgICAgIDwvYnV0dG9uPlxuICAgICAgPGJ1dHRvbiBjbGFzcz1cImluZC1sZWdlbmQtYnRuXCIgdHlwZT1cImJ1dHRvblwiIHRpdGxlPVwiU2V0dGluZ3NcIiBAY2xpY2s9XCJpbmRTZXR0aW5nc09wZW4gPSAhaW5kU2V0dGluZ3NPcGVuXCI+XG4gICAgICAgIDxzdmcgdmlld0JveD1cIjAgMCAyNCAyNFwiIHdpZHRoPVwiMTNcIiBoZWlnaHQ9XCIxM1wiIGZpbGw9XCJub25lXCIgc3Ryb2tlPVwiY3VycmVudENvbG9yXCIgc3Ryb2tlLXdpZHRoPVwiMS44XCIgc3Ryb2tlLWxpbmVjYXA9XCJyb3VuZFwiIHN0cm9rZS1saW5lam9pbj1cInJvdW5kXCIgYXJpYS1oaWRkZW49XCJ0cnVlXCI+XG4gICAgICAgICAgPGNpcmNsZSBjeD1cIjEyXCIgY3k9XCIxMlwiIHI9XCIzXCIgLz5cbiAgICAgICAgICA8cGF0aCBkPVwiTTE5LjQgMTVhMS43IDEuNyAwIDAgMCAuMzQgMS44N2wuMDYuMDZhMiAyIDAgMSAxLTIuODMgMi44M2wtLjA2LS4wNmExLjcgMS43IDAgMCAwLTEuODctLjM0IDEuNyAxLjcgMCAwIDAtMSAxLjU1VjIxYTIgMiAwIDEgMS00IDB2LS4wOWExLjcgMS43IDAgMCAwLTEtMS41NSAxLjcgMS43IDAgMCAwLTEuODcuMzRsLS4wNi4wNmEyIDIgMCAxIDEtMi44My0yLjgzbC4wNi0uMDZhMS43IDEuNyAwIDAgMCAuMzQtMS44NyAxLjcgMS43IDAgMCAwLTEuNTUtMUgzYTIgMiAwIDEgMSAwLTRoLjA5YTEuNyAxLjcgMCAwIDAgMS41NS0xIDEuNyAxLjcgMCAwIDAtLjM0LTEuODdsLS4wNi0uMDZhMiAyIDAgMSAxIDIuODMtMi44M2wuMDYuMDZhMS43IDEuNyAwIDAgMCAxLjg3LjM0aDBhMS43IDEuNyAwIDAgMCAxLTEuNTVWM2EyIDIgMCAxIDEgNCAwdi4wOWExLjcgMS43IDAgMCAwIDEgMS41NWgwYTEuNyAxLjcgMCAwIDAgMS44Ny0uMzRsLjA2LS4wNmEyIDIgMCAxIDEgMi44MyAyLjgzbC0uMDYuMDZhMS43IDEuNyAwIDAgMC0uMzQgMS44N3YwYTEuNyAxLjcgMCAwIDAgMS41NSAxSDIxYTIgMiAwIDEgMSAwIDRoLS4wOWExLjcgMS43IDAgMCAwLTEuNTUgMXpcIiAvPlxuICAgICAgICA8L3N2Zz5cbiAgICAgIDwvYnV0dG9uPlxuICAgICAgPGJ1dHRvbiBjbGFzcz1cImluZC1sZWdlbmQtYnRuXCIgdHlwZT1cImJ1dHRvblwiIHRpdGxlPVwiUmVtb3ZlXCIgQGNsaWNrPVwiaW5kaWNhdG9ycy5yZW1vdmVTZXNzaW9ucygpXCI+XG4gICAgICAgIDxzdmcgdmlld0JveD1cIjAgMCAyNCAyNFwiIHdpZHRoPVwiMTNcIiBoZWlnaHQ9XCIxM1wiIGZpbGw9XCJub25lXCIgc3Ryb2tlPVwiY3VycmVudENvbG9yXCIgc3Ryb2tlLXdpZHRoPVwiMS44XCIgc3Ryb2tlLWxpbmVjYXA9XCJyb3VuZFwiIGFyaWEtaGlkZGVuPVwidHJ1ZVwiPlxuICAgICAgICAgIDxwYXRoIGQ9XCJNNiA2bDEyIDEyTTE4IDZMNiAxOFwiIC8+XG4gICAgICAgIDwvc3ZnPlxuICAgICAgPC9idXR0b24+XG4gICAgICA8IS0tIFNldHRpbmdzIHBvcHVwOiBlbmFibGUvcmVuYW1lL3JlY29sb3Igc2Vzc2lvbnM7IGJ1aWx0LWluIHdpbmRvd3NcbiAgICAgICAgICAgYXJlIGNoYWluZWQgdG8gcmVhbCBtYXJrZXQgb3BlbnMgYW5kIHNob3duIGluIHRoZSBWSVNJVE9SJ3Mgb3duXG4gICAgICAgICAgIGxvY2FsIGNsb2NrIChEU1QgYWRqdXN0cyBpdHNlbGYpOyBjdXN0b20gc2Vzc2lvbnMgYXJlIGZyZWUuIC0tPlxuICAgICAgPGRpdiB2LWlmPVwiaW5kU2V0dGluZ3NPcGVuXCIgY2xhc3M9XCJpbmQtc2V0dGluZ3NcIiBAY2xpY2suc3RvcD5cbiAgICAgICAgPGRpdiBjbGFzcz1cImluZC1zZXR0aW5ncy10aXRsZVwiPlNlc3Npb25zIOKAlCBzZXR0aW5nczwvZGl2PlxuICAgICAgICA8ZGl2IHYtZm9yPVwicyBpbiBpbmRpY2F0b3JzLmRlZnNcIiA6a2V5PVwicy5pZFwiIGNsYXNzPVwiaW5kLXNldC1yb3cgaW5kLXNldC1lZGl0XCI+XG4gICAgICAgICAgPGlucHV0IHR5cGU9XCJjaGVja2JveFwiIHYtbW9kZWw9XCJpbmRpY2F0b3JzLnNlc3Npb25zRW5hYmxlZFtzLmlkXVwiIC8+XG4gICAgICAgICAgPGlucHV0XG4gICAgICAgICAgICBjbGFzcz1cImluZC1zZXQtY29sb3JcIlxuICAgICAgICAgICAgdHlwZT1cImNvbG9yXCJcbiAgICAgICAgICAgIHYtbW9kZWw9XCJzLmNvbG9yXCJcbiAgICAgICAgICAgIDphcmlhLWxhYmVsPVwicy5pZCArICcgY29sb3InXCJcbiAgICAgICAgICAgIDp0aXRsZT1cIidDb2xvciBvZiAnICsgcy5uYW1lXCJcbiAgICAgICAgICAvPlxuICAgICAgICAgIDxpbnB1dFxuICAgICAgICAgICAgY2xhc3M9XCJpbmQtc2V0LW5hbWVcIlxuICAgICAgICAgICAgdHlwZT1cInRleHRcIlxuICAgICAgICAgICAgdi1tb2RlbD1cInMubmFtZVwiXG4gICAgICAgICAgICBtYXhsZW5ndGg9XCIyMFwiXG4gICAgICAgICAgICA6YXJpYS1sYWJlbD1cInMuaWQgKyAnIG5hbWUnXCJcbiAgICAgICAgICAvPlxuICAgICAgICAgIDxzcGFuIGNsYXNzPVwiaW5kLXNldC10aW1lXCI+e3sgc2Vzc2lvbldpbmRvd0xvY2FsKHMpIH19PC9zcGFuPlxuICAgICAgICAgIDxzcGFuIGNsYXNzPVwiaW5kLXNldC1jaXR5XCI+e3sgcy5jaXR5IH19PC9zcGFuPlxuICAgICAgICA8L2Rpdj5cbiAgICAgICAgPGRpdiB2LWZvcj1cInMgaW4gaW5kaWNhdG9ycy5jdXN0b21zXCIgOmtleT1cInMuaWRcIiBjbGFzcz1cImluZC1zZXQtcm93IGluZC1zZXQtZWRpdFwiPlxuICAgICAgICAgIDxpbnB1dCB0eXBlPVwiY2hlY2tib3hcIiB2LW1vZGVsPVwiaW5kaWNhdG9ycy5zZXNzaW9uc0VuYWJsZWRbcy5pZF1cIiAvPlxuICAgICAgICAgIDxpbnB1dFxuICAgICAgICAgICAgY2xhc3M9XCJpbmQtc2V0LWNvbG9yXCJcbiAgICAgICAgICAgIHR5cGU9XCJjb2xvclwiXG4gICAgICAgICAgICB2LW1vZGVsPVwicy5jb2xvclwiXG4gICAgICAgICAgICA6YXJpYS1sYWJlbD1cInMuaWQgKyAnIGNvbG9yJ1wiXG4gICAgICAgICAgICA6dGl0bGU9XCInQ29sb3Igb2YgJyArIHMubmFtZVwiXG4gICAgICAgICAgLz5cbiAgICAgICAgICA8aW5wdXRcbiAgICAgICAgICAgIGNsYXNzPVwiaW5kLXNldC1uYW1lXCJcbiAgICAgICAgICAgIHR5cGU9XCJ0ZXh0XCJcbiAgICAgICAgICAgIHYtbW9kZWw9XCJzLm5hbWVcIlxuICAgICAgICAgICAgbWF4bGVuZ3RoPVwiMjBcIlxuICAgICAgICAgICAgOmFyaWEtbGFiZWw9XCJzLmlkICsgJyBuYW1lJ1wiXG4gICAgICAgICAgLz5cbiAgICAgICAgICA8aW5wdXQgY2xhc3M9XCJpbmQtc2V0LXRpbWVcIiB0eXBlPVwidGltZVwiIDp2YWx1ZT1cInRvVGltZVN0cihzLnN0YXJ0KVwiIEBjaGFuZ2U9XCJvbkN1c3RvbVRpbWVDaGFuZ2UocywgJ3N0YXJ0JywgJGV2ZW50KVwiIC8+XG4gICAgICAgICAgPGlucHV0IGNsYXNzPVwiaW5kLXNldC10aW1lXCIgdHlwZT1cInRpbWVcIiA6dmFsdWU9XCJ0b1RpbWVTdHIocy5lbmQpXCIgQGNoYW5nZT1cIm9uQ3VzdG9tVGltZUNoYW5nZShzLCAnZW5kJywgJGV2ZW50KVwiIC8+XG4gICAgICAgICAgPHNwYW4gY2xhc3M9XCJpbmQtc2V0LWNpdHlcIj5DdXN0b208L3NwYW4+XG4gICAgICAgICAgPGJ1dHRvblxuICAgICAgICAgICAgY2xhc3M9XCJpbmQtc2V0LXJlbW92ZVwiXG4gICAgICAgICAgICB0eXBlPVwiYnV0dG9uXCJcbiAgICAgICAgICAgIDp0aXRsZT1cIidEZWxldGUgJyArIHMubmFtZVwiXG4gICAgICAgICAgICA6YXJpYS1sYWJlbD1cIidEZWxldGUgJyArIHMubmFtZVwiXG4gICAgICAgICAgICBAY2xpY2s9XCJpbmRpY2F0b3JzLnJlbW92ZUN1c3RvbVNlc3Npb24ocy5pZClcIlxuICAgICAgICAgID7inJU8L2J1dHRvbj5cbiAgICAgICAgPC9kaXY+XG4gICAgICAgIDwhLS0gQWRkIGEgbmV3IGN1c3RvbSBzZXNzaW9uICh2aXNpdG9yJ3MgbG9jYWwgY2xvY2spIC0tPlxuICAgICAgICA8ZGl2IGNsYXNzPVwiaW5kLXNldC1hZGRcIj5cbiAgICAgICAgICA8aW5wdXQgY2xhc3M9XCJpbmQtc2V0LW5hbWVcIiB0eXBlPVwidGV4dFwiIHYtbW9kZWw9XCJuZXdTZXNzTmFtZVwiIG1heGxlbmd0aD1cIjIwXCIgcGxhY2Vob2xkZXI9XCJTZXNzaW9uIG5hbWVcIiBhcmlhLWxhYmVsPVwiTmV3IHNlc3Npb24gbmFtZVwiIC8+XG4gICAgICAgICAgPGlucHV0IGNsYXNzPVwiaW5kLXNldC1jb2xvclwiIHR5cGU9XCJjb2xvclwiIHYtbW9kZWw9XCJuZXdTZXNzQ29sb3JcIiBhcmlhLWxhYmVsPVwiTmV3IHNlc3Npb24gY29sb3JcIiB0aXRsZT1cIkNvbG9yXCIgLz5cbiAgICAgICAgICA8aW5wdXQgY2xhc3M9XCJpbmQtc2V0LXRpbWVcIiB0eXBlPVwidGltZVwiIHYtbW9kZWw9XCJuZXdTZXNzU3RhcnRcIiBhcmlhLWxhYmVsPVwiTmV3IHNlc3Npb24gc3RhcnRcIiAvPlxuICAgICAgICAgIDxpbnB1dCBjbGFzcz1cImluZC1zZXQtdGltZVwiIHR5cGU9XCJ0aW1lXCIgdi1tb2RlbD1cIm5ld1Nlc3NFbmRcIiBhcmlhLWxhYmVsPVwiTmV3IHNlc3Npb24gZW5kXCIgLz5cbiAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwiaW5kLXNldC1hZGQtYnRuXCIgdHlwZT1cImJ1dHRvblwiIHRpdGxlPVwiQWRkIHNlc3Npb25cIiBAY2xpY2s9XCJvbkFkZFNlc3Npb25cIj4rIEFkZDwvYnV0dG9uPlxuICAgICAgICA8L2Rpdj5cbiAgICAgICAgPGxhYmVsIGNsYXNzPVwiaW5kLXNldC1yb3dcIj5cbiAgICAgICAgICA8aW5wdXQgdHlwZT1cImNoZWNrYm94XCIgdi1tb2RlbD1cImluZGljYXRvcnMuc2Vzc2lvbnNMYWJlbHNcIiAvPlxuICAgICAgICAgIDxzcGFuPlNob3cgc2Vzc2lvbiBuYW1lczwvc3Bhbj5cbiAgICAgICAgPC9sYWJlbD5cbiAgICAgIDwvZGl2PlxuICAgIDwvZGl2PlxuXG4gICAgPGRpdiB2LWlmPVwiaXNMb2FkaW5nXCIgY2xhc3M9XCJvdmVybGF5IGNlbnRlciBsb2FkaW5nLW9ubHlcIj5cbiAgICAgIDxzcGFuIGNsYXNzPVwib3ZlcmxheS1zcGlubmVyIGxhcmdlXCI+PC9zcGFuPlxuICAgIDwvZGl2PlxuICAgIDxkaXYgdi1lbHNlLWlmPVwiZXJyb3JcIiBjbGFzcz1cIm92ZXJsYXkgZXJyb3JcIj7imqAge3sgZXJyb3IgfX08L2Rpdj5cbiAgICA8ZGl2IHYtZWxzZS1pZj1cImNhbmRsZXMubGVuZ3RoID09PSAwXCIgY2xhc3M9XCJvdmVybGF5IG11dGVkIGNlbnRlclwiPlxuICAgICAgPHNwYW4gY2xhc3M9XCJvdmVybGF5LXRpdGxlXCI+Tm8gY2FuZGxlcyB5ZXQg4oCUIHdhaXRpbmcgZm9yIG1hcmtldCBkYXRhPC9zcGFuPlxuICAgICAgPHNwYW4gY2xhc3M9XCJoaW50XCI+Q2hlY2sgdGhhdCB0aGUgbWFya2V0IHNlcnZlciBpcyBydW5uaW5nIGFuZCBPQU5EQSBjcmVkZW50aWFscyBhcmUgY29uZmlndXJlZC4gT24gd2Vla2VuZHMgdGhlIG1hcmtldCBpcyBjbG9zZWQuPC9zcGFuPlxuICAgIDwvZGl2PlxuICAgIDxkaXYgdi1pZj1cIm1hcmtldC5pc0xvYWRpbmdNb3JlXCIgY2xhc3M9XCJvdmVybGF5IGxvYWRpbmctbW9yZVwiPkxvYWRpbmcgbW9yZeKApjwvZGl2PlxuICAgIDwhLS0gVHJhZGluZ1ZpZXctc3R5bGUgY291bnRkb3duOiBnbHVlZCB0byB0aGUgbGl2ZS1wcmljZSBtYXJrZXIgb24gdGhlXG4gICAgICAgICByaWdodCBheGlzLiBUcmFja3MgcGFuL3pvb20gaW5zdGFudGx5OyBoaWRlcyB3aGVuIHByaWNlIGlzIG9mZi1zY3JlZW5cbiAgICAgICAgIG9yIHRoZSBtYXJrZXQgaXMgY2xvc2VkLiAtLT5cbiAgICA8IS0tIFRpbWVyIGxhYmVsOiBpZGVudGljYWwgdG8gdGhlIG5hdGl2ZSBsaXZlLXByaWNlIGxhYmVsLCBzdHVja1xuICAgICAgICAgZGlyZWN0bHkgYmVuZWF0aCBpdCBvbiB0aGUgcHJpY2Ugc2NhbGUuIC0tPlxuICAgIDxkaXZcbiAgICAgIHYtaWY9XCJ0YWdWaXNpYmxlICYmIGNhbmRsZXMubGVuZ3RoID4gMFwiXG4gICAgICBjbGFzcz1cImF4aXMtdGFnXCJcbiAgICAgIDpzdHlsZT1cInsgdG9wOiB0aW1lclRvcCArICdweCcsIGhlaWdodDogc21hbGxUYWdIICsgJ3B4Jywgd2lkdGg6IHRhZ1cgKyAncHgnLCByaWdodDogdGFnUmlnaHQgKyAncHgnIH1cIlxuICAgICAgOnRpdGxlPVwibWFya2V0Q2xvc2VkID8gJ0ZvcmV4IG1hcmtldCBpcyBjbG9zZWQnIDogYE5leHQgJHttYXJrZXQudGltZWZyYW1lfSBjYW5kbGUgaW5gXCJcbiAgICA+XG4gICAgICB7eyBjb3VudGRvd24gfX1cbiAgICA8L2Rpdj5cbiAgICA8IS0tIFNlc3Npb25zIGluZGljYXRvcjogdHJhbnNsdWNlbnQgc2Vzc2lvbiBiYWNrZ3JvdW5kIGJveGVzLCBwYWludGVkXG4gICAgICAgICBiZWhpbmQgdGhlIGRyYXdpbmdzIGxheWVyICh3aGljaCBpdHNlbGYgc2l0cyBiZWhpbmQgdGhlIGNhbmRsZXMpLlxuICAgICAgICAgTm9uLWludGVyYWN0aXZlLiAtLT5cbiAgICA8ZGl2XG4gICAgICB2LWlmPVwic2Vzc2lvblBpeGVscy5sZW5ndGhcIlxuICAgICAgY2xhc3M9XCJzZXNzaW9uLWxheWVyIGRyYXdpbmctY2xpcFwiXG4gICAgICA6c3R5bGU9XCJ7IHJpZ2h0OiBheGlzUmlnaHRXICsgJ3B4JywgYm90dG9tOiBheGlzQm90dG9tSCArICdweCcgfVwiXG4gICAgPlxuICAgICAgPGRpdlxuICAgICAgICB2LWZvcj1cImIgaW4gc2Vzc2lvblBpeGVsc1wiXG4gICAgICAgIDprZXk9XCJiLmtleVwiXG4gICAgICAgIGNsYXNzPVwic2Vzc2lvbi1ib3hcIlxuICAgICAgICA6c3R5bGU9XCJ7IGxlZnQ6IGIubGVmdCArICdweCcsIHdpZHRoOiBiLndpZHRoICsgJ3B4JywgdG9wOiBiLnRvcCArICdweCcsIGhlaWdodDogYi5oZWlnaHQgKyAncHgnLCBiYWNrZ3JvdW5kOiBiLmNvbG9yICsgJzI2JyB9XCJcbiAgICAgID5cbiAgICAgICAgPHNwYW4gdi1pZj1cImIuc2hvd0xhYmVsXCIgY2xhc3M9XCJzZXNzaW9uLWxhYmVsXCIgOnN0eWxlPVwieyBjb2xvcjogYi5jb2xvciwgdG9wOiBiLmxhYmVsVG9wICsgJ3B4JyB9XCI+e3sgYi5uYW1lIH19PC9zcGFuPlxuICAgICAgPC9kaXY+XG4gICAgPC9kaXY+XG4gICAgPCEtLSBWaXNpYmxlIGRyYXdpbmcgbGF5ZXI6IHotb3JkZXJlZCBCRUhJTkQgdGhlIGNhbmRsZSBwYWludGluZywgc28gYVxuICAgICAgICAgc21hbGwgcmVjdGFuZ2xlIGRyYXduIG9uIGEgbG93IHRpbWVmcmFtZSBuZXZlciBjb3ZlcnMgY2FuZGxlIGJvZGllc1xuICAgICAgICAgb24gY29hcnNlciB0aW1lZnJhbWVzIChUcmFkaW5nVmlldy1zdHlsZSkuIE5vbi1pbnRlcmFjdGl2ZS4gLS0+XG4gICAgPGRpdlxuICAgICAgY2xhc3M9XCJkcmF3aW5nLWxheWVyIGRyYXdpbmctY2xpcFwiXG4gICAgICA6Y2xhc3M9XCJ7ICdkcmF3aW5nLW1vZGUnOiBkcmF3aW5nVG9vbEFjdGl2ZSB9XCJcbiAgICAgIDpzdHlsZT1cInsgcmlnaHQ6IGF4aXNSaWdodFcgKyAncHgnLCBib3R0b206IGF4aXNCb3R0b21IICsgJ3B4JyB9XCJcbiAgICA+XG4gICAgICA8ZGl2XG4gICAgICAgIHYtZm9yPVwicmVjdCBpbiByZWN0UGl4ZWxzXCJcbiAgICAgICAgOmtleT1cInJlY3QuaWRcIlxuICAgICAgICBjbGFzcz1cImRyYXdpbmctcmVjdFwiXG4gICAgICAgIDpjbGFzcz1cInsgcHJldmlldzogcmVjdC5pZCA9PT0gJ19fcHJldmlldycsICdib3JkZXItb25seSc6IHJlY3QuZmlsbGVkID09PSBmYWxzZSB9XCJcbiAgICAgICAgOnN0eWxlPVwie1xuICAgICAgICAgIGxlZnQ6IHJlY3QubGVmdCArICdweCcsXG4gICAgICAgICAgdG9wOiByZWN0LnRvcCArICdweCcsXG4gICAgICAgICAgd2lkdGg6IHJlY3Qud2lkdGggKyAncHgnLFxuICAgICAgICAgIGhlaWdodDogcmVjdC5oZWlnaHQgKyAncHgnLFxuICAgICAgICAgIGJhY2tncm91bmRDb2xvcjogcmVjdC5maWxsZWQgPyByZWN0LmNvbG9yIDogJ3RyYW5zcGFyZW50JyxcbiAgICAgICAgICBvcGFjaXR5OiByZWN0LmZpbGxlZCA/IHJlY3Qub3BhY2l0eSA6IDEsXG4gICAgICAgICAgYm9yZGVyQ29sb3I6IHJlY3QuY29sb3IsXG4gICAgICAgIH1cIlxuICAgICAgPjwvZGl2PlxuICAgICAgPCEtLSBUcmVuZGxpbmVzIHJlbmRlciBhcyBTVkcgc28gdGhleSBjYW4gYmUgYW55IGFuZ2xlLiBUaGV5IGNvbWUgQUZURVJcbiAgICAgICAgICAgdGhlIHJlY3RhbmdsZXMgaW4gRE9NIG9yZGVyIHNvIGEgbGluZSBkcmF3biBvdmVyIGEgcmVjdCBib2R5IHBhaW50c1xuICAgICAgICAgICBvbiB0b3Agb2YgaXQgKFRyYWRpbmdWaWV3LXN0eWxlKS4gLS0+XG4gICAgICA8c3ZnIGNsYXNzPVwidHJlbmQtc3ZnXCI+XG4gICAgICAgIDxsaW5lXG4gICAgICAgICAgdi1mb3I9XCJ0IGluIHRyZW5kUGl4ZWxzXCJcbiAgICAgICAgICA6a2V5PVwidC5pZFwiXG4gICAgICAgICAgOngxPVwidC54MVwiIDp5MT1cInQueTFcIiA6eDI9XCJ0LngyXCIgOnkyPVwidC55MlwiXG4gICAgICAgICAgOnN0cm9rZT1cInQuY29sb3JcIlxuICAgICAgICAgIDpzdHJva2Utd2lkdGg9XCJ0LndpZHRoICsgKHQuc2VsZWN0ZWQgPyAxIDogMClcIlxuICAgICAgICAgIDpzdHJva2UtZGFzaGFycmF5PVwiREFTSF9BUlJBWVt0LmRhc2hdIHx8IHVuZGVmaW5lZFwiXG4gICAgICAgICAgc3Ryb2tlLWxpbmVjYXA9XCJyb3VuZFwiXG4gICAgICAgICAgOm9wYWNpdHk9XCJ0LmlkID09PSAnX19wcmV2aWV3JyA/IDAuOCA6IDFcIlxuICAgICAgICAvPlxuICAgICAgPC9zdmc+XG4gICAgICA8IS0tIFBvbHlsaW5lcyByZW5kZXIgb24gdG9wIG9mIHRyZW5kbGluZXM7IG11bHRpLXNlZ21lbnQgKyBvcHRpb25hbFxuICAgICAgICAgICBhcnJvd2hlYWQgb24gdGhlIGxhc3QgY29ybmVyLiAtLT5cbiAgICAgIDxzdmcgY2xhc3M9XCJ0cmVuZC1zdmcgcG9seS1zdmdcIj5cbiAgICAgICAgPGcgdi1mb3I9XCJwIGluIHBvbHlQaXhlbHNcIiA6a2V5PVwicC5pZFwiPlxuICAgICAgICAgIDxwb2x5bGluZVxuICAgICAgICAgICAgOnBvaW50cz1cInAucHRzLm1hcCgocSkgPT4gcS54ICsgJywnICsgcS55KS5qb2luKCcgJylcIlxuICAgICAgICAgICAgZmlsbD1cIm5vbmVcIlxuICAgICAgICAgICAgOnN0cm9rZT1cInAuY29sb3JcIlxuICAgICAgICAgICAgOnN0cm9rZS13aWR0aD1cInAud2lkdGggKyAocC5zZWxlY3RlZCA/IDEgOiAwKVwiXG4gICAgICAgICAgICA6c3Ryb2tlLWRhc2hhcnJheT1cIkRBU0hfQVJSQVlbcC5kYXNoXSB8fCB1bmRlZmluZWRcIlxuICAgICAgICAgICAgc3Ryb2tlLWxpbmVjYXA9XCJyb3VuZFwiXG4gICAgICAgICAgICBzdHJva2UtbGluZWpvaW49XCJyb3VuZFwiXG4gICAgICAgICAgICA6b3BhY2l0eT1cInAuaWQgPT09ICdfX3ByZXZpZXcnID8gMC44IDogMVwiXG4gICAgICAgICAgLz5cbiAgICAgICAgICA8cG9seWdvblxuICAgICAgICAgICAgdi1pZj1cInAuYXJyb3dUcmlcIlxuICAgICAgICAgICAgOnBvaW50cz1cInAuYXJyb3dUcmlcIlxuICAgICAgICAgICAgOmZpbGw9XCJwLmNvbG9yXCJcbiAgICAgICAgICAgIDpvcGFjaXR5PVwicC5pZCA9PT0gJ19fcHJldmlldycgPyAwLjggOiAxXCJcbiAgICAgICAgICAvPlxuICAgICAgICA8L2c+XG4gICAgICA8L3N2Zz5cbiAgICAgIDwhLS0gTG9uZy9TaG9ydCBwb3NpdGlvbnM6IGdyZWVuIHByb2ZpdCBib3ggKGVudHJ54oaUVFApICsgcmVkIGxvc3MgYm94XG4gICAgICAgICAgIChlbnRyeeKGlFNMKSBhdCAyMCUgb3BhY2l0eSwgbGV2ZWwgbGluZXMsIGFuZCAxUi4uTlIgcmV3YXJkIGxpbmVzLiAtLT5cbiAgICAgIDxzdmcgY2xhc3M9XCJ0cmVuZC1zdmcgcG9zLXN2Z1wiPlxuICAgICAgICA8ZyB2LWZvcj1cInAgaW4gcG9zUGl4ZWxzXCIgOmtleT1cInAuaWRcIj5cbiAgICAgICAgICA8cmVjdFxuICAgICAgICAgICAgOng9XCJwLmxlZnRcIiA6eT1cInAucHJvZml0VG9wXCIgOndpZHRoPVwicC53aWR0aFwiIDpoZWlnaHQ9XCJwLnByb2ZpdEhcIlxuICAgICAgICAgICAgZmlsbD1cIiMyNmE2OWFcIlxuICAgICAgICAgICAgOmZpbGwtb3BhY2l0eT1cInAucHJldmlldyA/IDAuMTIgOiAwLjJcIlxuICAgICAgICAgIC8+XG4gICAgICAgICAgPHJlY3RcbiAgICAgICAgICAgIDp4PVwicC5sZWZ0XCIgOnk9XCJwLmxvc3NUb3BcIiA6d2lkdGg9XCJwLndpZHRoXCIgOmhlaWdodD1cInAubG9zc0hcIlxuICAgICAgICAgICAgZmlsbD1cIiNlZjUzNTBcIlxuICAgICAgICAgICAgOmZpbGwtb3BhY2l0eT1cInAucHJldmlldyA/IDAuMTIgOiAwLjJcIlxuICAgICAgICAgIC8+XG4gICAgICAgICAgPGxpbmVcbiAgICAgICAgICAgIHYtZm9yPVwibCBpbiBwLmxldmVsc1wiXG4gICAgICAgICAgICA6a2V5PVwibC5yXCJcbiAgICAgICAgICAgIDp4MT1cInAubGVmdFwiIDp5MT1cImwueVwiIDp4Mj1cInAubGVmdCArIHAud2lkdGhcIiA6eTI9XCJsLnlcIlxuICAgICAgICAgICAgc3Ryb2tlPVwiIzI2YTY5YVwiXG4gICAgICAgICAgICBzdHJva2Utd2lkdGg9XCIxXCJcbiAgICAgICAgICAgIHN0cm9rZS1kYXNoYXJyYXk9XCI0IDRcIlxuICAgICAgICAgICAgOm9wYWNpdHk9XCIwLjlcIlxuICAgICAgICAgIC8+XG4gICAgICAgIDwvZz5cbiAgICAgIDwvc3ZnPlxuICAgICAgPCEtLSBPbmUtY2xpY2sgbGluZXM6IGhvcml6b250YWwgbGluZSAvIGhvcml6b250YWwgcmF5IC8gdmVydGljYWwgbGluZSAtLT5cbiAgICAgIDxkaXZcbiAgICAgICAgdi1mb3I9XCJzIGluIHNpbmdsZVBpeGVsc1wiXG4gICAgICAgIDprZXk9XCJzLmlkXCJcbiAgICAgICAgY2xhc3M9XCJzaW5nbGUtbGluZVwiXG4gICAgICAgIDpjbGFzcz1cIltzLmtpbmQsIHMuZGFzaCwgeyBzZWxlY3RlZDogcy5zZWxlY3RlZCB9XVwiXG4gICAgICAgIDpzdHlsZT1cIlxuICAgICAgICAgIHMua2luZCA9PT0gJ3ZsaW5lJ1xuICAgICAgICAgICAgPyB7IGxlZnQ6IHMueCArICdweCcsIGJvcmRlckNvbG9yOiBzLmNvbG9yIH1cbiAgICAgICAgICAgIDogeyB0b3A6IHMueSArICdweCcsIGxlZnQ6IHMua2luZCA9PT0gJ2hyYXknID8gcy54ICsgJ3B4JyA6ICcwcHgnLCBib3JkZXJDb2xvcjogcy5jb2xvciB9XG4gICAgICAgIFwiXG4gICAgICA+PC9kaXY+XG4gICAgPC9kaXY+XG5cbiAgICA8IS0tIEludGVyYWN0aW9uIGxheWVyOiBpbnZpc2libGUgZHVwbGljYXRlcyBvZiB0aGUgc2FtZSBnZW9tZXRyeSBzaXR0aW5nXG4gICAgICAgICBBQk9WRSB0aGUgY2FuZGxlcywgY2FycnlpbmcgaGl0LXRlc3RpbmcsIHRoZSBzZWxlY3Rpb24gaGFuZGxlcyBhbmRcbiAgICAgICAgIHRoZSBjb250ZXh0LW1lbnUgdGFyZ2V0IOKAlCBzbyBhIGJlaGluZC10aGUtY2FuZGxlcyByZWN0YW5nbGUgc3RheXNcbiAgICAgICAgIHNlbGVjdGFibGUgYW5kIHJlc2l6YWJsZS4gLS0+XG4gICAgPGRpdlxuICAgICAgY2xhc3M9XCJkcmF3aW5nLWhpdC1sYXllciBkcmF3aW5nLWNsaXBcIlxuICAgICAgOmNsYXNzPVwieyAnZHJhd2luZy1tb2RlJzogZHJhd2luZ1Rvb2xBY3RpdmUgfHwgcmVwbGF5LnBpY2tpbmcgfVwiXG4gICAgICA6c3R5bGU9XCJ7IHJpZ2h0OiBheGlzUmlnaHRXICsgJ3B4JywgYm90dG9tOiBheGlzQm90dG9tSCArICdweCcgfVwiXG4gICAgPlxuICAgICAgPGRpdlxuICAgICAgICB2LWZvcj1cInJlY3QgaW4gaGl0UmVjdHNcIlxuICAgICAgICA6a2V5PVwicmVjdC5pZFwiXG4gICAgICAgIGNsYXNzPVwiZHJhd2luZy1oaXQtcmVjdFwiXG4gICAgICAgIDpjbGFzcz1cInsgc2VsZWN0ZWQ6IHJlY3Quc2VsZWN0ZWQsICdib3JkZXItb25seSc6IHJlY3QuZmlsbGVkID09PSBmYWxzZSB9XCJcbiAgICAgICAgOmRhdGEtcmVjdC1pZD1cInJlY3QuaWQgPT09ICdfX3ByZXZpZXcnID8gbnVsbCA6IHJlY3QuaWRcIlxuICAgICAgICA6c3R5bGU9XCJ7XG4gICAgICAgICAgbGVmdDogcmVjdC5sZWZ0ICsgJ3B4JyxcbiAgICAgICAgICB0b3A6IHJlY3QudG9wICsgJ3B4JyxcbiAgICAgICAgICB3aWR0aDogcmVjdC53aWR0aCArICdweCcsXG4gICAgICAgICAgaGVpZ2h0OiByZWN0LmhlaWdodCArICdweCcsXG4gICAgICAgIH1cIlxuICAgICAgICBAcG9pbnRlcmRvd24uc3RvcD1cIm9uUmVjdERyYWdTdGFydCgkZXZlbnQsIHJlY3QuaWQpXCJcbiAgICAgICAgQGNsaWNrLnN0b3A9XCJvblJlY3RDbGljayhyZWN0LmlkLCAkZXZlbnQpXCJcbiAgICAgID5cbiAgICAgICAgPCEtLSBCb3JkZXItb25seSByZWN0YW5nbGVzOiB0aGUgYm9keSBpcyBjbGljay10cmFuc3BhcmVudCAoY2xpY2tzXG4gICAgICAgICAgICAgcGFzcyB0byB0aGUgY2hhcnQpLCBvbmx5IHRoZSA0IGVkZ2Ugc3RyaXBzIHNlbGVjdC9kcmFnLiAtLT5cbiAgICAgICAgPHRlbXBsYXRlIHYtaWY9XCJyZWN0LmZpbGxlZCA9PT0gZmFsc2VcIj5cbiAgICAgICAgICA8ZGl2IGNsYXNzPVwicmVjdC1lZGdlLWhpdCB0b3BcIiBAcG9pbnRlcmRvd24uc3RvcD1cIm9uUmVjdERyYWdTdGFydCgkZXZlbnQsIHJlY3QuaWQpXCIgQGNsaWNrLnN0b3A9XCJvblJlY3RDbGljayhyZWN0LmlkLCAkZXZlbnQpXCI+PC9kaXY+XG4gICAgICAgICAgPGRpdiBjbGFzcz1cInJlY3QtZWRnZS1oaXQgYm90dG9tXCIgQHBvaW50ZXJkb3duLnN0b3A9XCJvblJlY3REcmFnU3RhcnQoJGV2ZW50LCByZWN0LmlkKVwiIEBjbGljay5zdG9wPVwib25SZWN0Q2xpY2socmVjdC5pZCwgJGV2ZW50KVwiPjwvZGl2PlxuICAgICAgICAgIDxkaXYgY2xhc3M9XCJyZWN0LWVkZ2UtaGl0IGxlZnRcIiBAcG9pbnRlcmRvd24uc3RvcD1cIm9uUmVjdERyYWdTdGFydCgkZXZlbnQsIHJlY3QuaWQpXCIgQGNsaWNrLnN0b3A9XCJvblJlY3RDbGljayhyZWN0LmlkLCAkZXZlbnQpXCI+PC9kaXY+XG4gICAgICAgICAgPGRpdiBjbGFzcz1cInJlY3QtZWRnZS1oaXQgcmlnaHRcIiBAcG9pbnRlcmRvd24uc3RvcD1cIm9uUmVjdERyYWdTdGFydCgkZXZlbnQsIHJlY3QuaWQpXCIgQGNsaWNrLnN0b3A9XCJvblJlY3RDbGljayhyZWN0LmlkLCAkZXZlbnQpXCI+PC9kaXY+XG4gICAgICAgIDwvdGVtcGxhdGU+XG4gICAgICAgIDx0ZW1wbGF0ZSB2LWlmPVwicmVjdC5zZWxlY3RlZFwiPlxuICAgICAgICAgIDxkaXYgY2xhc3M9XCJyZXNpemUtaGFuZGxlIG53XCIgQHBvaW50ZXJkb3duLnN0b3AucHJldmVudD1cIm9uUmVzaXplU3RhcnQoJGV2ZW50LCAnbncnKVwiPjwvZGl2PlxuICAgICAgICAgIDxkaXYgY2xhc3M9XCJyZXNpemUtaGFuZGxlIG5lXCIgQHBvaW50ZXJkb3duLnN0b3AucHJldmVudD1cIm9uUmVzaXplU3RhcnQoJGV2ZW50LCAnbmUnKVwiPjwvZGl2PlxuICAgICAgICAgIDxkaXYgY2xhc3M9XCJyZXNpemUtaGFuZGxlIHN3XCIgQHBvaW50ZXJkb3duLnN0b3AucHJldmVudD1cIm9uUmVzaXplU3RhcnQoJGV2ZW50LCAnc3cnKVwiPjwvZGl2PlxuICAgICAgICAgIDxkaXYgY2xhc3M9XCJyZXNpemUtaGFuZGxlIHNlXCIgQHBvaW50ZXJkb3duLnN0b3AucHJldmVudD1cIm9uUmVzaXplU3RhcnQoJGV2ZW50LCAnc2UnKVwiPjwvZGl2PlxuICAgICAgICAgIDxkaXYgY2xhc3M9XCJyZXNpemUtaGFuZGxlIG5cIiBAcG9pbnRlcmRvd24uc3RvcC5wcmV2ZW50PVwib25SZXNpemVTdGFydCgkZXZlbnQsICduJylcIj48L2Rpdj5cbiAgICAgICAgICA8ZGl2IGNsYXNzPVwicmVzaXplLWhhbmRsZSBzXCIgQHBvaW50ZXJkb3duLnN0b3AucHJldmVudD1cIm9uUmVzaXplU3RhcnQoJGV2ZW50LCAncycpXCI+PC9kaXY+XG4gICAgICAgICAgPGRpdiBjbGFzcz1cInJlc2l6ZS1oYW5kbGUgd1wiIEBwb2ludGVyZG93bi5zdG9wLnByZXZlbnQ9XCJvblJlc2l6ZVN0YXJ0KCRldmVudCwgJ3cnKVwiPjwvZGl2PlxuICAgICAgICAgIDxkaXYgY2xhc3M9XCJyZXNpemUtaGFuZGxlIGVcIiBAcG9pbnRlcmRvd24uc3RvcC5wcmV2ZW50PVwib25SZXNpemVTdGFydCgkZXZlbnQsICdlJylcIj48L2Rpdj5cbiAgICAgICAgPC90ZW1wbGF0ZT5cbiAgICAgIDwvZGl2PlxuXG4gICAgICA8IS0tIFRyZW5kbGluZSBoaXQtdGVzdGluZyBzaXRzIEFGVEVSIHRoZSByZWN0YW5nbGUgaGl0LXJlY3RzIGluIERPTVxuICAgICAgICAgICBvcmRlcjogd2hlbiBhIGxpbmUgY3Jvc3NlcyBhIHJlY3RhbmdsZSBib2R5LCB0aGUgbGluZSdzIGZhdFxuICAgICAgICAgICB0cmFuc3BhcmVudCBzdHJva2Ugd2lucyB0aGUgcG9pbnRlciBzbyBpdCBzdGF5cyBzZWxlY3RhYmxlLiAtLT5cbiAgICAgIDxzdmcgY2xhc3M9XCJ0cmVuZC1oaXQtc3ZnXCI+XG4gICAgICAgIDxnIHYtZm9yPVwidCBpbiBoaXRUcmVuZHNcIiA6a2V5PVwidC5pZFwiPlxuICAgICAgICAgIDxsaW5lXG4gICAgICAgICAgICA6eDE9XCJ0LngxXCIgOnkxPVwidC55MVwiIDp4Mj1cInQueDJcIiA6eTI9XCJ0LnkyXCJcbiAgICAgICAgICAgIGNsYXNzPVwidHJlbmQtaGl0XCJcbiAgICAgICAgICAgIDpjbGFzcz1cInsgc2VsZWN0ZWQ6IHQuc2VsZWN0ZWQgfVwiXG4gICAgICAgICAgICBzdHJva2U9XCJ0cmFuc3BhcmVudFwiXG4gICAgICAgICAgICBzdHJva2Utd2lkdGg9XCIxNFwiXG4gICAgICAgICAgICBzdHJva2UtbGluZWNhcD1cInJvdW5kXCJcbiAgICAgICAgICAgIEBwb2ludGVyZG93bi5zdG9wPVwib25UcmVuZERyYWdTdGFydCgkZXZlbnQsIHQuaWQpXCJcbiAgICAgICAgICAgIEBjbGljay5zdG9wPVwib25UcmVuZENsaWNrKHQuaWQsICRldmVudClcIlxuICAgICAgICAgIC8+XG4gICAgICAgICAgPHRlbXBsYXRlIHYtaWY9XCJ0LnNlbGVjdGVkXCI+XG4gICAgICAgICAgICA8Y2lyY2xlXG4gICAgICAgICAgICAgIDpjeD1cInQueDFcIiA6Y3k9XCJ0LnkxXCIgcj1cIjVcIlxuICAgICAgICAgICAgICBjbGFzcz1cInRyZW5kLWhhbmRsZVwiXG4gICAgICAgICAgICAgIEBwb2ludGVyZG93bi5zdG9wLnByZXZlbnQ9XCJvblRyZW5kSGFuZGxlU3RhcnQoJGV2ZW50LCB0LmlkLCAxKVwiXG4gICAgICAgICAgICAvPlxuICAgICAgICAgICAgPGNpcmNsZVxuICAgICAgICAgICAgICA6Y3g9XCJ0LngyXCIgOmN5PVwidC55MlwiIHI9XCI1XCJcbiAgICAgICAgICAgICAgY2xhc3M9XCJ0cmVuZC1oYW5kbGVcIlxuICAgICAgICAgICAgICBAcG9pbnRlcmRvd24uc3RvcC5wcmV2ZW50PVwib25UcmVuZEhhbmRsZVN0YXJ0KCRldmVudCwgdC5pZCwgMilcIlxuICAgICAgICAgICAgLz5cbiAgICAgICAgICA8L3RlbXBsYXRlPlxuICAgICAgICA8L2c+XG4gICAgICA8L3N2Zz5cblxuICAgICAgPCEtLSBQb2x5bGluZSBoaXQtdGVzdGluZzogZmF0IHRyYW5zcGFyZW50IHN0cm9rZSBvdmVyIHRoZSB3aG9sZSBwYXRoXG4gICAgICAgICAgIHBsdXMgYSBoYW5kbGUgb24gZXZlcnkgdmVydGV4IHdoZW4gc2VsZWN0ZWQuIC0tPlxuICAgICAgPHN2ZyBjbGFzcz1cInRyZW5kLWhpdC1zdmcgcG9seS1oaXQtc3ZnXCI+XG4gICAgICAgIDxnIHYtZm9yPVwicCBpbiBoaXRQb2x5c1wiIDprZXk9XCJwLmlkXCI+XG4gICAgICAgICAgPHBvbHlsaW5lXG4gICAgICAgICAgICA6cG9pbnRzPVwicC5wdHMubWFwKChxKSA9PiBxLnggKyAnLCcgKyBxLnkpLmpvaW4oJyAnKVwiXG4gICAgICAgICAgICBjbGFzcz1cInRyZW5kLWhpdFwiXG4gICAgICAgICAgICA6Y2xhc3M9XCJ7IHNlbGVjdGVkOiBwLnNlbGVjdGVkIH1cIlxuICAgICAgICAgICAgZmlsbD1cIm5vbmVcIlxuICAgICAgICAgICAgc3Ryb2tlPVwidHJhbnNwYXJlbnRcIlxuICAgICAgICAgICAgc3Ryb2tlLXdpZHRoPVwiMTRcIlxuICAgICAgICAgICAgc3Ryb2tlLWxpbmVjYXA9XCJyb3VuZFwiXG4gICAgICAgICAgICBzdHJva2UtbGluZWpvaW49XCJyb3VuZFwiXG4gICAgICAgICAgICBAcG9pbnRlcmRvd24uc3RvcD1cIm9uUG9seURyYWdTdGFydCgkZXZlbnQsIHAuaWQpXCJcbiAgICAgICAgICAgIEBjbGljay5zdG9wPVwib25Qb2x5Q2xpY2socC5pZCwgJGV2ZW50KVwiXG4gICAgICAgICAgLz5cbiAgICAgICAgICA8dGVtcGxhdGUgdi1pZj1cInAuc2VsZWN0ZWRcIj5cbiAgICAgICAgICAgIDxjaXJjbGVcbiAgICAgICAgICAgICAgdi1mb3I9XCJxIGluIHAucHRzXCJcbiAgICAgICAgICAgICAgOmtleT1cInEuc3JjXCJcbiAgICAgICAgICAgICAgOmN4PVwicS54XCIgOmN5PVwicS55XCIgcj1cIjVcIlxuICAgICAgICAgICAgICBjbGFzcz1cInRyZW5kLWhhbmRsZVwiXG4gICAgICAgICAgICAgIEBwb2ludGVyZG93bi5zdG9wLnByZXZlbnQ9XCJvblBvbHlWZXJ0ZXhTdGFydCgkZXZlbnQsIHAuaWQsIHEuc3JjKVwiXG4gICAgICAgICAgICAvPlxuICAgICAgICAgIDwvdGVtcGxhdGU+XG4gICAgICAgIDwvZz5cbiAgICAgIDwvc3ZnPlxuXG4gICAgICA8IS0tIExvbmcvU2hvcnQgcG9zaXRpb24gaGl0IGFyZWFzOiBmdWxsIGJvZHkgKG1vdmUpLCB0aGUgdGhyZWUgcHJpY2VcbiAgICAgICAgICAgbGV2ZWwgbGluZXMgKHJlc2l6ZSBlbnRyeS9UUC9TTCksIHRoZSB0d28gdGltZSBlZGdlcywgYW5kIGNvcm5lclxuICAgICAgICAgICBoYW5kbGVzIG9uIGV2ZXJ5IGxldmVsIGVuZC4gLS0+XG4gICAgICA8ZGl2XG4gICAgICAgIHYtZm9yPVwicCBpbiBwb3NQaXhlbHNcIlxuICAgICAgICB2LXNob3c9XCJwLmlkICE9PSAnX19wb3NwcmV2aWV3J1wiXG4gICAgICAgIDprZXk9XCJwLmlkXCJcbiAgICAgICAgY2xhc3M9XCJwb3MtaGl0XCJcbiAgICAgICAgOmNsYXNzPVwieyBzZWxlY3RlZDogcC5zZWxlY3RlZCB9XCJcbiAgICAgICAgOnN0eWxlPVwie1xuICAgICAgICAgIGxlZnQ6IHAubGVmdCArICdweCcsXG4gICAgICAgICAgdG9wOiBNYXRoLm1pbihwLnRwWSwgcC5zbFkpICsgJ3B4JyxcbiAgICAgICAgICB3aWR0aDogcC53aWR0aCArICdweCcsXG4gICAgICAgICAgaGVpZ2h0OiBNYXRoLmFicyhwLnNsWSAtIHAudHBZKSArICdweCcsXG4gICAgICAgIH1cIlxuICAgICAgICBAcG9pbnRlcmRvd24uc3RvcD1cIm9uUG9zRHJhZ1N0YXJ0KCRldmVudCwgcC5pZClcIlxuICAgICAgICBAY2xpY2suc3RvcD1cIm9uUG9zQ2xpY2socC5pZCwgJGV2ZW50KVwiXG4gICAgICA+XG4gICAgICAgIDx0ZW1wbGF0ZSB2LWlmPVwicC5zZWxlY3RlZFwiPlxuICAgICAgICAgIDxkaXZcbiAgICAgICAgICAgIGNsYXNzPVwicG9zLWxldmVsLWhpdFwiXG4gICAgICAgICAgICA6c3R5bGU9XCJ7IHRvcDogcC50cFkgLSBNYXRoLm1pbihwLnRwWSwgcC5zbFkpIC0gNCArICdweCcgfVwiXG4gICAgICAgICAgICBAcG9pbnRlcmRvd24uc3RvcC5wcmV2ZW50PVwib25Qb3NMZXZlbFN0YXJ0KCRldmVudCwgcC5pZCwgJ3RwJylcIlxuICAgICAgICAgID48L2Rpdj5cbiAgICAgICAgICA8ZGl2XG4gICAgICAgICAgICBjbGFzcz1cInBvcy1sZXZlbC1oaXRcIlxuICAgICAgICAgICAgOnN0eWxlPVwieyB0b3A6IHAuZW50cnlZIC0gTWF0aC5taW4ocC50cFksIHAuc2xZKSAtIDQgKyAncHgnIH1cIlxuICAgICAgICAgICAgQHBvaW50ZXJkb3duLnN0b3AucHJldmVudD1cIm9uUG9zTGV2ZWxTdGFydCgkZXZlbnQsIHAuaWQsICdlbnRyeScpXCJcbiAgICAgICAgICA+PC9kaXY+XG4gICAgICAgICAgPGRpdlxuICAgICAgICAgICAgY2xhc3M9XCJwb3MtbGV2ZWwtaGl0XCJcbiAgICAgICAgICAgIDpzdHlsZT1cInsgdG9wOiBwLnNsWSAtIE1hdGgubWluKHAudHBZLCBwLnNsWSkgLSA0ICsgJ3B4JyB9XCJcbiAgICAgICAgICAgIEBwb2ludGVyZG93bi5zdG9wLnByZXZlbnQ9XCJvblBvc0xldmVsU3RhcnQoJGV2ZW50LCBwLmlkLCAnc2wnKVwiXG4gICAgICAgICAgPjwvZGl2PlxuICAgICAgICAgIDxkaXZcbiAgICAgICAgICAgIGNsYXNzPVwicG9zLWVkZ2UtaGl0XCJcbiAgICAgICAgICAgIDpzdHlsZT1cInsgbGVmdDogJy0zcHgnIH1cIlxuICAgICAgICAgICAgQHBvaW50ZXJkb3duLnN0b3AucHJldmVudD1cIm9uUG9zRWRnZVN0YXJ0KCRldmVudCwgcC5pZCwgJ3RpbWUxJylcIlxuICAgICAgICAgID48L2Rpdj5cbiAgICAgICAgICA8ZGl2XG4gICAgICAgICAgICBjbGFzcz1cInBvcy1lZGdlLWhpdFwiXG4gICAgICAgICAgICA6c3R5bGU9XCJ7IHJpZ2h0OiAnLTNweCcgfVwiXG4gICAgICAgICAgICBAcG9pbnRlcmRvd24uc3RvcC5wcmV2ZW50PVwib25Qb3NFZGdlU3RhcnQoJGV2ZW50LCBwLmlkLCAndGltZTInKVwiXG4gICAgICAgICAgPjwvZGl2PlxuICAgICAgICAgIDwhLS0gY29ybmVyIGhhbmRsZXMgYXQgYm90aCBlbmRzIG9mIGVhY2ggbGV2ZWwgbGluZTogdmVydGljYWwgZHJhZ1xuICAgICAgICAgICAgICAgcmVzaXplcyB0aGUgbGV2ZWwncyBwcmljZSwgaG9yaXpvbnRhbCBkcmFnIHJlc2l6ZXMgdGhlIHdpZHRoIC0tPlxuICAgICAgICAgIDxkaXZcbiAgICAgICAgICAgIHYtZm9yPVwiKGx2bCwgbGkpIGluIFtcbiAgICAgICAgICAgICAgeyB5OiBwLnRwWSAtIE1hdGgubWluKHAudHBZLCBwLnNsWSksIGtpbmQ6ICd0cCcgfSxcbiAgICAgICAgICAgICAgeyB5OiBwLmVudHJ5WSAtIE1hdGgubWluKHAudHBZLCBwLnNsWSksIGtpbmQ6ICdlbnRyeScgfSxcbiAgICAgICAgICAgICAgeyB5OiBwLnNsWSAtIE1hdGgubWluKHAudHBZLCBwLnNsWSksIGtpbmQ6ICdzbCcgfSxcbiAgICAgICAgICAgIF1cIlxuICAgICAgICAgICAgOmtleT1cImxpXCJcbiAgICAgICAgICA+XG4gICAgICAgICAgICA8ZGl2XG4gICAgICAgICAgICAgIGNsYXNzPVwicmVzaXplLWhhbmRsZSBwb3MtaGFuZGxlXCJcbiAgICAgICAgICAgICAgOnN0eWxlPVwieyB0b3A6IGx2bC55IC0gNCArICdweCcsIGxlZnQ6ICctNHB4JyB9XCJcbiAgICAgICAgICAgICAgQHBvaW50ZXJkb3duLnN0b3AucHJldmVudD1cIm9uUG9zQ29ybmVyU3RhcnQoJGV2ZW50LCBwLmlkLCBsdmwua2luZCBhcyBhbnksICd0aW1lMScpXCJcbiAgICAgICAgICAgID48L2Rpdj5cbiAgICAgICAgICAgIDxkaXZcbiAgICAgICAgICAgICAgY2xhc3M9XCJyZXNpemUtaGFuZGxlIHBvcy1oYW5kbGVcIlxuICAgICAgICAgICAgICA6c3R5bGU9XCJ7IHRvcDogbHZsLnkgLSA0ICsgJ3B4JywgcmlnaHQ6ICctNHB4JyB9XCJcbiAgICAgICAgICAgICAgQHBvaW50ZXJkb3duLnN0b3AucHJldmVudD1cIm9uUG9zQ29ybmVyU3RhcnQoJGV2ZW50LCBwLmlkLCBsdmwua2luZCBhcyBhbnksICd0aW1lMicpXCJcbiAgICAgICAgICAgID48L2Rpdj5cbiAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgPC90ZW1wbGF0ZT5cbiAgICAgIDwvZGl2PlxuXG4gICAgICA8IS0tIE9uZS1jbGljayBsaW5lIGhpdCBhcmVhczogZmF0IGludmlzaWJsZSBzdHJpcHMgb3ZlciBlYWNoIGxpbmUgLS0+XG4gICAgICA8ZGl2XG4gICAgICAgIHYtZm9yPVwicyBpbiBzaW5nbGVQaXhlbHNcIlxuICAgICAgICA6a2V5PVwiJ2hpdC0nICsgcy5pZFwiXG4gICAgICAgIGNsYXNzPVwic2luZ2xlLWhpdFwiXG4gICAgICAgIDpjbGFzcz1cIltzLmtpbmQsIHsgc2VsZWN0ZWQ6IHMuc2VsZWN0ZWQgfV1cIlxuICAgICAgICA6c3R5bGU9XCJcbiAgICAgICAgICBzLmtpbmQgPT09ICd2bGluZSdcbiAgICAgICAgICAgID8geyBsZWZ0OiBzLnggLSA0ICsgJ3B4JyB9XG4gICAgICAgICAgICA6IHsgdG9wOiBzLnkgLSA0ICsgJ3B4JywgbGVmdDogcy5raW5kID09PSAnaHJheScgPyBzLnggLSA0ICsgJ3B4JyA6ICcwcHgnIH1cbiAgICAgICAgXCJcbiAgICAgICAgQHBvaW50ZXJkb3duLnN0b3A9XCJvblNpbmdsZURyYWdTdGFydCgkZXZlbnQsIHMua2luZCwgcy5pZClcIlxuICAgICAgICBAY2xpY2suc3RvcD1cIm9uU2luZ2xlQ2xpY2socy5raW5kLCBzLmlkLCAkZXZlbnQpXCJcbiAgICAgID48L2Rpdj5cblxuICAgICAgPCEtLSBPbmUtY2xpY2sgbGluZSByZXNpemUgY29ybmVyczogbWlkZGxlIG9mIGhsaW5lIC8gbWlkZGxlIG9mIHZsaW5lIC9cbiAgICAgICAgICAgbGVmdCBhbmNob3Igb2YgaHJheSAoZHJhZ3MgbGlrZSB0aGUgdHJlbmRsaW5lIGVuZCBkb3RzKSAtLT5cbiAgICAgIDx0ZW1wbGF0ZSB2LWZvcj1cInMgaW4gc2luZ2xlUGl4ZWxzXCIgOmtleT1cIidoZC0nICsgcy5pZFwiPlxuICAgICAgICA8ZGl2XG4gICAgICAgICAgdi1pZj1cInMuc2VsZWN0ZWRcIlxuICAgICAgICAgIGNsYXNzPVwicmVzaXplLWhhbmRsZSBzaW5nbGUtaGFuZGxlXCJcbiAgICAgICAgICA6Y2xhc3M9XCJzLmtpbmRcIlxuICAgICAgICAgIDpzdHlsZT1cInsgdG9wOiBzLmh5IC0gNCArICdweCcsIGxlZnQ6IHMuaHggLSA0ICsgJ3B4JyB9XCJcbiAgICAgICAgICBAcG9pbnRlcmRvd24uc3RvcC5wcmV2ZW50PVwib25TaW5nbGVEcmFnU3RhcnQoJGV2ZW50LCBzLmtpbmQsIHMuaWQpXCJcbiAgICAgICAgPjwvZGl2PlxuICAgICAgPC90ZW1wbGF0ZT5cbiAgICA8L2Rpdj5cblxuICAgIDwhLS0gUG9zaXRpb24gbGFiZWxzOiBSOlIgY2VudGVyZWQgb24gdGhlIGVudHJ5IGxpbmUgKGFsd2F5cyB2aXNpYmxlKTtcbiAgICAgICAgIFRQL1NMICUgKyBwaXBzIGNlbnRlcmVkIG9uIHRoZWlyIGxpbmVzIHdoaWxlIHNlbGVjdGVkLiBXaGVuIHRoZSBib3hcbiAgICAgICAgIGlzIG5hcnJvd2VyIHRoYW4gYSBsYWJlbCB0aGUgJSBzdGF0cyBtb3ZlIGp1c3QgSU5TSURFIHRoZSBib3gg4oCUXG4gICAgICAgICBiZWxvdyB0aGUgVFAgbGluZSBhbmQgYWJvdmUgdGhlIFNMIGxpbmUg4oCUIGluc3RlYWQgb2YgYmVzaWRlIGl0LiAtLT5cbiAgICA8ZGl2XG4gICAgICBjbGFzcz1cInBvcy1sYWJlbC1sYXllciBkcmF3aW5nLWNsaXBcIlxuICAgICAgOnN0eWxlPVwieyByaWdodDogYXhpc1JpZ2h0VyArICdweCcsIGJvdHRvbTogYXhpc0JvdHRvbUggKyAncHgnIH1cIlxuICAgID5cbiAgICAgIDx0ZW1wbGF0ZSB2LWZvcj1cInAgaW4gcG9zUGl4ZWxzXCIgOmtleT1cInAuaWRcIj5cbiAgICAgICAgPHRlbXBsYXRlIHYtaWY9XCJwLmlkICE9PSAnX19wb3NwcmV2aWV3J1wiPlxuICAgICAgICAgIDxzcGFuXG4gICAgICAgICAgICBjbGFzcz1cInBvcy1sYWJlbCBlbnRyeVwiXG4gICAgICAgICAgICA6c3R5bGU9XCJ7IHRvcDogcC5lbnRyeVkgLSA5ICsgJ3B4JywgbGVmdDogcC5sZWZ0ICsgcC53aWR0aCAvIDIgKyAncHgnLCB0cmFuc2Zvcm06ICd0cmFuc2xhdGVYKC01MCUpJyB9XCJcbiAgICAgICAgICA+e3sgcC5yci50b0ZpeGVkKDEpIH19PC9zcGFuPlxuICAgICAgICAgIDx0ZW1wbGF0ZSB2LWlmPVwicC5zZWxlY3RlZFwiPlxuICAgICAgICAgICAgPHNwYW5cbiAgICAgICAgICAgICAgY2xhc3M9XCJwb3MtbGFiZWwgdHBcIlxuICAgICAgICAgICAgICA6c3R5bGU9XCJ7XG4gICAgICAgICAgICAgICAgdG9wOiAocC53aWR0aCA+PSAxNDAgPyBwLnRwWSAtIDkgOiAocC5kaXJlY3Rpb24gPT09ICdsb25nJyA/IHAudHBZIC0gMjcgOiBwLnRwWSArIDkpKSArICdweCcsXG4gICAgICAgICAgICAgICAgbGVmdDogcC5sZWZ0ICsgcC53aWR0aCAvIDIgKyAncHgnLFxuICAgICAgICAgICAgICAgIHRyYW5zZm9ybTogJ3RyYW5zbGF0ZVgoLTUwJSknLFxuICAgICAgICAgICAgICB9XCJcbiAgICAgICAgICAgID5UUCB7eyBwLnRwUGN0ID49IDAgPyAnKycgOiAnJyB9fXt7IHAudHBQY3QudG9GaXhlZCgyKSB9fSUgwrcge3sgcC50cFBpcHMudG9GaXhlZCgxKSB9fSBwaXBzPC9zcGFuPlxuICAgICAgICAgICAgPHNwYW5cbiAgICAgICAgICAgICAgY2xhc3M9XCJwb3MtbGFiZWwgc2xcIlxuICAgICAgICAgICAgICA6c3R5bGU9XCJ7XG4gICAgICAgICAgICAgICAgdG9wOiAocC53aWR0aCA+PSAxNDAgPyBwLnNsWSAtIDkgOiAocC5kaXJlY3Rpb24gPT09ICdsb25nJyA/IHAuc2xZICsgOSA6IHAuc2xZIC0gMjcpKSArICdweCcsXG4gICAgICAgICAgICAgICAgbGVmdDogcC5sZWZ0ICsgcC53aWR0aCAvIDIgKyAncHgnLFxuICAgICAgICAgICAgICAgIHRyYW5zZm9ybTogJ3RyYW5zbGF0ZVgoLTUwJSknLFxuICAgICAgICAgICAgICB9XCJcbiAgICAgICAgICAgID5TTCB7eyBwLnNsUGN0ID49IDAgPyAnKycgOiAnJyB9fXt7IHAuc2xQY3QudG9GaXhlZCgyKSB9fSUgwrcge3sgcC5zbFBpcHMudG9GaXhlZCgxKSB9fSBwaXBzPC9zcGFuPlxuICAgICAgICAgIDwvdGVtcGxhdGU+XG4gICAgICAgICAgPHNwYW5cbiAgICAgICAgICAgIHYtZm9yPVwibCBpbiBwLmxldmVsc1wiXG4gICAgICAgICAgICA6a2V5PVwibC5yXCJcbiAgICAgICAgICAgIGNsYXNzPVwicG9zLWxhYmVsIHJsaW5lXCJcbiAgICAgICAgICAgIDpzdHlsZT1cInsgdG9wOiBsLnkgLSA5ICsgJ3B4JywgbGVmdDogcC5sZWZ0ICsgcC53aWR0aCArIDYgKyAncHgnIH1cIlxuICAgICAgICAgID57eyBsLnIgfX08L3NwYW4+XG4gICAgICAgIDwvdGVtcGxhdGU+XG4gICAgICA8L3RlbXBsYXRlPlxuICAgIDwvZGl2PlxuXG4gICAgPCEtLSBBeGlzIHRhZ3MgZm9yIG9uZS1jbGljayBsaW5lcyAodW5jbGlwcGVkIHNvIHRoZXkgc2l0IE9OIHRoZSBzY2FsZXMpOlxuICAgICAgICAgdmVydGljYWwgbGluZSDihpIgdGltZS9kYXRlIHRhZyBvbiB0aGUgdGltZSBzY2FsZSAoYWx3YXlzKTsgaG9yaXpvbnRhbFxuICAgICAgICAgbGluZSAvIHJheSDihpIgY3VycmVudCBwcmljZSB0YWcgb24gdGhlIHByaWNlIHNjYWxlIHdoaWxlIHNlbGVjdGVkLiAtLT5cbiAgICA8ZGl2IGNsYXNzPVwic2luZ2xlLXRhZy1sYXllclwiPlxuICAgICAgPHRlbXBsYXRlIHYtZm9yPVwicyBpbiBzaW5nbGVQaXhlbHNcIiA6a2V5PVwiJ3RhZy0nICsgcy5pZFwiPlxuICAgICAgICA8ZGl2XG4gICAgICAgICAgdi1pZj1cInMua2luZCA9PT0gJ3ZsaW5lJ1wiXG4gICAgICAgICAgY2xhc3M9XCJzaW5nbGUtdGltZS10YWdcIlxuICAgICAgICAgIDpjbGFzcz1cInsgc2VsZWN0ZWQ6IHMuc2VsZWN0ZWQgfVwiXG4gICAgICAgICAgOnN0eWxlPVwieyBsZWZ0OiBzLnggKyAncHgnLCBib3R0b206IE1hdGgubWF4KDIsIGF4aXNCb3R0b21IIC8gMiAtIDkpICsgJ3B4JyB9XCJcbiAgICAgICAgPnt7IGZtdEF4aXNUaW1lKHMudGltZSkgfX08L2Rpdj5cbiAgICAgICAgPGRpdlxuICAgICAgICAgIHYtZWxzZS1pZj1cInMuc2VsZWN0ZWRcIlxuICAgICAgICAgIGNsYXNzPVwic2luZ2xlLXByaWNlLXRhZ1wiXG4gICAgICAgICAgOnN0eWxlPVwieyB0b3A6IHMueSAtIDkgKyAncHgnLCBiYWNrZ3JvdW5kOiBzLmNvbG9yIH1cIlxuICAgICAgICA+e3sgZm10UHJpY2Uocy5wcmljZSwgaW5zdHJ1bWVudFByZWNpc2lvbihtYXJrZXQuaW5zdHJ1bWVudCkpIH19PC9kaXY+XG4gICAgICA8L3RlbXBsYXRlPlxuICAgIDwvZGl2PlxuXG4gICAgPCEtLSBNYWduZXQgc25hcHBpbmcgY3Jvc3NoYWlyOiByZXBsYWNlcyB0aGUgbmF0aXZlIGNyb3NzaGFpciB3aGlsZSBhXG4gICAgICAgICBkcmF3aW5nIHRvb2wgKyBtYWduZXQgYXJlIGFjdGl2ZSDigJQgc3RpY2tzIHRvIGNhbmRsZSBoaWdoL2xvdyBhbmRcbiAgICAgICAgIHNob3dzIHRoZSBzbmFwcGVkIHByaWNlL3RpbWUgb24gdGhlIGF4ZXMuIC0tPlxuICAgIDx0ZW1wbGF0ZSB2LWlmPVwic25hcFhoYWlyICYmIGRyYXdpbmdUb29sQWN0aXZlICYmIG1hZ25ldEFjdGl2ZVwiPlxuICAgICAgPGRpdlxuICAgICAgICBjbGFzcz1cInhoYWlyLWxpbmUgdlwiXG4gICAgICAgIDpzdHlsZT1cInsgbGVmdDogc25hcFhoYWlyLnggKyAncHgnLCBib3R0b206IGF4aXNCb3R0b21IICsgJ3B4JyB9XCJcbiAgICAgID48L2Rpdj5cbiAgICAgIDxkaXZcbiAgICAgICAgY2xhc3M9XCJ4aGFpci1saW5lIGhcIlxuICAgICAgICA6c3R5bGU9XCJ7IHRvcDogc25hcFhoYWlyLnkgKyAncHgnLCByaWdodDogYXhpc1JpZ2h0VyArICdweCcgfVwiXG4gICAgICA+PC9kaXY+XG4gICAgICA8ZGl2XG4gICAgICAgIGNsYXNzPVwic2luZ2xlLXByaWNlLXRhZ1wiXG4gICAgICAgIDpzdHlsZT1cInsgdG9wOiBzbmFwWGhhaXIueSAtIDkgKyAncHgnLCBiYWNrZ3JvdW5kOiAnIzI5NjJmZicgfVwiXG4gICAgICA+e3sgc25hcFhoYWlyLnByaWNlVGV4dCB9fTwvZGl2PlxuICAgICAgPGRpdlxuICAgICAgICBjbGFzcz1cInNpbmdsZS10aW1lLXRhZ1wiXG4gICAgICAgIDpzdHlsZT1cInsgbGVmdDogc25hcFhoYWlyLnggKyAncHgnLCBib3R0b206IE1hdGgubWF4KDIsIGF4aXNCb3R0b21IIC8gMiAtIDkpICsgJ3B4JyB9XCJcbiAgICAgID57eyBzbmFwWGhhaXIudGltZVRleHQgfX08L2Rpdj5cbiAgICA8L3RlbXBsYXRlPlxuXG4gICAgPCEtLSBFZGl0IHBhbmVsIGZvciBzZWxlY3RlZCByZWN0YW5nbGUgLS0+XG4gICAgPGRpdlxuICAgICAgdi1pZj1cInNlbGVjdGVkUmVjdCAmJiBlZGl0UGFuZWxQb3NcIlxuICAgICAgcmVmPVwiZWRpdFBhbmVsRWxcIlxuICAgICAgY2xhc3M9XCJyZWN0LWVkaXQtcGFuZWxcIlxuICAgICAgOnN0eWxlPVwieyBsZWZ0OiBlZGl0UGFuZWxQb3MueCArICdweCcsIHRvcDogZWRpdFBhbmVsUG9zLnkgKyAncHgnIH1cIlxuICAgICAgQGNsaWNrLnN0b3BcbiAgICA+XG4gICAgICA8ZGl2IGNsYXNzPVwiZWRpdC1jb2xvcnNcIj5cbiAgICAgICAgPGJ1dHRvblxuICAgICAgICAgIHYtZm9yPVwiYyBpbiBkcmF3aW5nc1N0b3JlLlBBTkVMX0NPTE9SU1wiXG4gICAgICAgICAgOmtleT1cImNcIlxuICAgICAgICAgIGNsYXNzPVwiY29sb3Itc3dhdGNoXCJcbiAgICAgICAgICA6Y2xhc3M9XCJ7IGFjdGl2ZTogc2VsZWN0ZWRSZWN0LmNvbG9yID09PSBjIH1cIlxuICAgICAgICAgIDpzdHlsZT1cInsgYmFja2dyb3VuZENvbG9yOiBjIH1cIlxuICAgICAgICAgIEBjbGljaz1cInNldENvbG9yU2VsZWN0ZWQoYylcIlxuICAgICAgICAvPlxuICAgICAgICA8ZGl2IGNsYXNzPVwicGFsZXR0ZS1hbmNob3JcIj5cbiAgICAgICAgICA8YnV0dG9uXG4gICAgICAgICAgICBjbGFzcz1cImNvbG9yLW1vcmVcIlxuICAgICAgICAgICAgOmNsYXNzPVwieyBhY3RpdmU6IHBhbGV0dGVPcGVuID09PSAncGFuZWwnIH1cIlxuICAgICAgICAgICAgdGl0bGU9XCJNb3JlIGNvbG9yc1wiXG4gICAgICAgICAgICBAY2xpY2suc3RvcD1cInRvZ2dsZVBhbGV0dGUoJ3BhbmVsJylcIlxuICAgICAgICAgID7vvIs8L2J1dHRvbj5cbiAgICAgICAgICA8ZGl2IHYtaWY9XCJwYWxldHRlT3BlbiA9PT0gJ3BhbmVsJ1wiIGNsYXNzPVwicGFsZXR0ZS1wb3BcIiBAY2xpY2suc3RvcD5cbiAgICAgICAgICAgIDxidXR0b25cbiAgICAgICAgICAgICAgdi1mb3I9XCJjIGluIGRyYXdpbmdzU3RvcmUuUFJFU0VUX0NPTE9SU1wiXG4gICAgICAgICAgICAgIDprZXk9XCJjXCJcbiAgICAgICAgICAgICAgY2xhc3M9XCJjb2xvci1zd2F0Y2hcIlxuICAgICAgICAgICAgICA6Y2xhc3M9XCJ7IGFjdGl2ZTogc2VsZWN0ZWRSZWN0LmNvbG9yID09PSBjIH1cIlxuICAgICAgICAgICAgICA6c3R5bGU9XCJ7IGJhY2tncm91bmRDb2xvcjogYyB9XCJcbiAgICAgICAgICAgICAgQGNsaWNrPVwic2V0Q29sb3JTZWxlY3RlZChjKTsgcGFsZXR0ZU9wZW4gPSBudWxsXCJcbiAgICAgICAgICAgIC8+XG4gICAgICAgICAgPC9kaXY+XG4gICAgICAgIDwvZGl2PlxuICAgICAgPC9kaXY+XG4gICAgICA8c3BhbiBjbGFzcz1cInBhbmVsLWRpdmlkZXJcIiAvPlxuICAgICAgPGxhYmVsIGNsYXNzPVwib3BhY2l0eS1yb3dcIiB0aXRsZT1cIkZpbGwgb3BhY2l0eVwiPlxuICAgICAgICA8c3BhbiBjbGFzcz1cIm9wYWNpdHktaWNvblwiPuKXuzwvc3Bhbj5cbiAgICAgICAgPGlucHV0XG4gICAgICAgICAgdHlwZT1cInJhbmdlXCJcbiAgICAgICAgICBjbGFzcz1cIm9wYWNpdHktc2xpZGVyXCJcbiAgICAgICAgICBtaW49XCIwXCJcbiAgICAgICAgICBtYXg9XCIxMDBcIlxuICAgICAgICAgIDp2YWx1ZT1cIk1hdGgucm91bmQoKHNlbGVjdGVkUmVjdC5vcGFjaXR5ID8/IDAuMykgKiAxMDApXCJcbiAgICAgICAgICBAaW5wdXQ9XCJzZXRPcGFjaXR5U2VsZWN0ZWQoTnVtYmVyKCgkZXZlbnQudGFyZ2V0IGFzIEhUTUxJbnB1dEVsZW1lbnQpLnZhbHVlKSAvIDEwMClcIlxuICAgICAgICAvPlxuICAgICAgICA8c3BhbiBjbGFzcz1cIm9wYWNpdHktdmFsdWVcIj57eyBNYXRoLnJvdW5kKChzZWxlY3RlZFJlY3Qub3BhY2l0eSA/PyAwLjMpICogMTAwKSB9fSU8L3NwYW4+XG4gICAgICA8L2xhYmVsPlxuICAgICAgPHNwYW4gY2xhc3M9XCJwYW5lbC1kaXZpZGVyXCIgLz5cbiAgICAgIDxzcGFuIGNsYXNzPVwicGFuZWwtZGl2aWRlclwiIC8+XG4gICAgICA8YnV0dG9uXG4gICAgICAgIGNsYXNzPVwiZWRpdC1idG5cIlxuICAgICAgICA6Y2xhc3M9XCJ7IG9mZjogc2VsZWN0ZWRSZWN0LmZpbGxlZCA9PT0gZmFsc2UgfVwiXG4gICAgICAgIDp0aXRsZT1cInNlbGVjdGVkUmVjdC5maWxsZWQgPT09IGZhbHNlID8gJ1Nob3cgYmFja2dyb3VuZCBmaWxsJyA6ICdCb3JkZXIgb25seSAobm8gZmlsbCknXCJcbiAgICAgICAgQGNsaWNrPVwidG9nZ2xlRmlsbFNlbGVjdGVkXCJcbiAgICAgID5cbiAgICAgICAgPHN2ZyB2aWV3Qm94PVwiMCAwIDE2IDE2XCIgd2lkdGg9XCIxNVwiIGhlaWdodD1cIjE1XCIgYXJpYS1oaWRkZW49XCJ0cnVlXCI+XG4gICAgICAgICAgPHJlY3RcbiAgICAgICAgICAgIHg9XCIyLjI1XCJcbiAgICAgICAgICAgIHk9XCIzLjI1XCJcbiAgICAgICAgICAgIHdpZHRoPVwiMTEuNVwiXG4gICAgICAgICAgICBoZWlnaHQ9XCI5LjVcIlxuICAgICAgICAgICAgcng9XCIyXCJcbiAgICAgICAgICAgIDpmaWxsPVwic2VsZWN0ZWRSZWN0LmZpbGxlZCA9PT0gZmFsc2UgPyAnbm9uZScgOiAnY3VycmVudENvbG9yJ1wiXG4gICAgICAgICAgICA6ZmlsbC1vcGFjaXR5PVwic2VsZWN0ZWRSZWN0LmZpbGxlZCA9PT0gZmFsc2UgPyAwIDogMC4zMlwiXG4gICAgICAgICAgICBzdHJva2U9XCJjdXJyZW50Q29sb3JcIlxuICAgICAgICAgICAgc3Ryb2tlLXdpZHRoPVwiMS41XCJcbiAgICAgICAgICAvPlxuICAgICAgICA8L3N2Zz5cbiAgICAgIDwvYnV0dG9uPlxuICAgICAgPGJ1dHRvbiBjbGFzcz1cImVkaXQtYnRuIGRhbmdlclwiIEBjbGljaz1cImRlbGV0ZVNlbGVjdGVkXCIgdGl0bGU9XCJEZWxldGUgcmVjdGFuZ2xlXCI+XG4gICAgICAgIDxzdmdcbiAgICAgICAgICB2aWV3Qm94PVwiMCAwIDE2IDE2XCJcbiAgICAgICAgICB3aWR0aD1cIjE1XCJcbiAgICAgICAgICBoZWlnaHQ9XCIxNVwiXG4gICAgICAgICAgYXJpYS1oaWRkZW49XCJ0cnVlXCJcbiAgICAgICAgICBmaWxsPVwibm9uZVwiXG4gICAgICAgICAgc3Ryb2tlPVwiY3VycmVudENvbG9yXCJcbiAgICAgICAgICBzdHJva2Utd2lkdGg9XCIxLjRcIlxuICAgICAgICAgIHN0cm9rZS1saW5lY2FwPVwicm91bmRcIlxuICAgICAgICAgIHN0cm9rZS1saW5lam9pbj1cInJvdW5kXCJcbiAgICAgICAgPlxuICAgICAgICAgIDxwYXRoIGQ9XCJNMi43NSA0LjVoMTAuNVwiIC8+XG4gICAgICAgICAgPHBhdGggZD1cIk01Ljc1IDQuNVYzLjRjMC0uNS40LS45LjktLjloMi43Yy41IDAgLjkuNC45Ljl2MS4xXCIgLz5cbiAgICAgICAgICA8cGF0aCBkPVwiTTQuNCA0LjVsLjUgNy45Yy4wNS42NC41NyAxLjEgMS4yIDEuMWgzLjhjLjYzIDAgMS4xNS0uNDYgMS4yLTEuMWwuNS03LjlcIiAvPlxuICAgICAgICAgIDxwYXRoIGQ9XCJNNi43IDcuMnYzLjlNOS4zIDcuMnYzLjlcIiAvPlxuICAgICAgICA8L3N2Zz5cbiAgICAgIDwvYnV0dG9uPlxuICAgIDwvZGl2PlxuXG4gICAgPCEtLSBFZGl0IHBhbmVsIGZvciBzZWxlY3RlZCB0cmVuZGxpbmUgKGFuY2hvcmVkIHRvIGl0cyByaWdodCBlbmRwb2ludCkgLS0+XG4gICAgPGRpdlxuICAgICAgdi1pZj1cInNlbGVjdGVkTGluZSAmJiBsaW5lUGFuZWxQb3NcIlxuICAgICAgcmVmPVwibGluZVBhbmVsRWxcIlxuICAgICAgY2xhc3M9XCJyZWN0LWVkaXQtcGFuZWxcIlxuICAgICAgOnN0eWxlPVwieyBsZWZ0OiBsaW5lUGFuZWxQb3MueCArICdweCcsIHRvcDogbGluZVBhbmVsUG9zLnkgKyAncHgnIH1cIlxuICAgICAgQGNsaWNrLnN0b3BcbiAgICA+XG4gICAgICA8ZGl2IGNsYXNzPVwiZWRpdC1jb2xvcnNcIj5cbiAgICAgICAgPGJ1dHRvblxuICAgICAgICAgIHYtZm9yPVwiYyBpbiBkcmF3aW5nc1N0b3JlLlBBTkVMX0NPTE9SU1wiXG4gICAgICAgICAgOmtleT1cImNcIlxuICAgICAgICAgIGNsYXNzPVwiY29sb3Itc3dhdGNoXCJcbiAgICAgICAgICA6Y2xhc3M9XCJ7IGFjdGl2ZTogc2VsZWN0ZWRMaW5lLmNvbG9yID09PSBjIH1cIlxuICAgICAgICAgIDpzdHlsZT1cInsgYmFja2dyb3VuZENvbG9yOiBjIH1cIlxuICAgICAgICAgIEBjbGljaz1cInNldExpbmVDb2xvclNlbGVjdGVkKGMpXCJcbiAgICAgICAgLz5cbiAgICAgICAgPGRpdiBjbGFzcz1cInBhbGV0dGUtYW5jaG9yXCI+XG4gICAgICAgICAgPGJ1dHRvblxuICAgICAgICAgICAgY2xhc3M9XCJjb2xvci1tb3JlXCJcbiAgICAgICAgICAgIDpjbGFzcz1cInsgYWN0aXZlOiBsaW5lUGFsZXR0ZU9wZW4gfVwiXG4gICAgICAgICAgICB0aXRsZT1cIk1vcmUgY29sb3JzXCJcbiAgICAgICAgICAgIEBjbGljay5zdG9wPVwibGluZVBhbGV0dGVPcGVuID0gIWxpbmVQYWxldHRlT3BlblwiXG4gICAgICAgICAgPu+8izwvYnV0dG9uPlxuICAgICAgICAgIDxkaXYgdi1pZj1cImxpbmVQYWxldHRlT3BlblwiIGNsYXNzPVwicGFsZXR0ZS1wb3BcIiBAY2xpY2suc3RvcD5cbiAgICAgICAgICAgIDxidXR0b25cbiAgICAgICAgICAgICAgdi1mb3I9XCJjIGluIGRyYXdpbmdzU3RvcmUuUFJFU0VUX0NPTE9SU1wiXG4gICAgICAgICAgICAgIDprZXk9XCJjXCJcbiAgICAgICAgICAgICAgY2xhc3M9XCJjb2xvci1zd2F0Y2hcIlxuICAgICAgICAgICAgICA6Y2xhc3M9XCJ7IGFjdGl2ZTogc2VsZWN0ZWRMaW5lLmNvbG9yID09PSBjIH1cIlxuICAgICAgICAgICAgICA6c3R5bGU9XCJ7IGJhY2tncm91bmRDb2xvcjogYyB9XCJcbiAgICAgICAgICAgICAgQGNsaWNrPVwic2V0TGluZUNvbG9yU2VsZWN0ZWQoYyk7IGxpbmVQYWxldHRlT3BlbiA9IGZhbHNlXCJcbiAgICAgICAgICAgIC8+XG4gICAgICAgICAgPC9kaXY+XG4gICAgICAgIDwvZGl2PlxuICAgICAgPC9kaXY+XG4gICAgICA8c3BhbiBjbGFzcz1cInBhbmVsLWRpdmlkZXJcIiAvPlxuICAgICAgPGRpdiBjbGFzcz1cImRhc2gtcm93XCIgdGl0bGU9XCJMaW5lIHN0eWxlXCI+XG4gICAgICAgIDxidXR0b25cbiAgICAgICAgICB2LWZvcj1cImQgaW4gREFTSF9TVFlMRVNcIlxuICAgICAgICAgIDprZXk9XCJkXCJcbiAgICAgICAgICBjbGFzcz1cImRhc2gtYnRuXCJcbiAgICAgICAgICA6Y2xhc3M9XCJ7IGFjdGl2ZTogc2VsZWN0ZWRMaW5lLmRhc2ggPT09IGQgfVwiXG4gICAgICAgICAgOnRpdGxlPVwiZC5jaGFyQXQoMCkudG9VcHBlckNhc2UoKSArIGQuc2xpY2UoMSlcIlxuICAgICAgICAgIEBjbGljaz1cInNldExpbmVEYXNoU2VsZWN0ZWQoZClcIlxuICAgICAgICA+XG4gICAgICAgICAgPHNwYW4gY2xhc3M9XCJkYXNoLXNhbXBsZVwiIDpjbGFzcz1cImRcIj48L3NwYW4+XG4gICAgICAgIDwvYnV0dG9uPlxuICAgICAgPC9kaXY+XG4gICAgICA8c3BhbiBjbGFzcz1cInBhbmVsLWRpdmlkZXJcIiAvPlxuICAgICAgPGJ1dHRvbiBjbGFzcz1cImVkaXQtYnRuIGRhbmdlclwiIEBjbGljaz1cImRlbGV0ZVNlbGVjdGVkTGluZVwiIHRpdGxlPVwiRGVsZXRlIHRyZW5kbGluZVwiPlxuICAgICAgICA8c3ZnXG4gICAgICAgICAgdmlld0JveD1cIjAgMCAxNiAxNlwiXG4gICAgICAgICAgd2lkdGg9XCIxNVwiXG4gICAgICAgICAgaGVpZ2h0PVwiMTVcIlxuICAgICAgICAgIGFyaWEtaGlkZGVuPVwidHJ1ZVwiXG4gICAgICAgICAgZmlsbD1cIm5vbmVcIlxuICAgICAgICAgIHN0cm9rZT1cImN1cnJlbnRDb2xvclwiXG4gICAgICAgICAgc3Ryb2tlLXdpZHRoPVwiMS40XCJcbiAgICAgICAgICBzdHJva2UtbGluZWNhcD1cInJvdW5kXCJcbiAgICAgICAgICBzdHJva2UtbGluZWpvaW49XCJyb3VuZFwiXG4gICAgICAgID5cbiAgICAgICAgICA8cGF0aCBkPVwiTTIuNzUgNC41aDEwLjVcIiAvPlxuICAgICAgICAgIDxwYXRoIGQ9XCJNNS43NSA0LjVWMy40YzAtLjUuNC0uOS45LS45aDIuN2MuNSAwIC45LjQuOS45djEuMVwiIC8+XG4gICAgICAgICAgPHBhdGggZD1cIk00LjQgNC41bC41IDcuOWMuMDUuNjQuNTcgMS4xIDEuMiAxLjFoMy44Yy42MyAwIDEuMTUtLjQ2IDEuMi0xLjFsLjUtNy45XCIgLz5cbiAgICAgICAgICA8cGF0aCBkPVwiTTYuNyA3LjJ2My45TTkuMyA3LjJ2My45XCIgLz5cbiAgICAgICAgPC9zdmc+XG4gICAgICA8L2J1dHRvbj5cbiAgICA8L2Rpdj5cblxuICAgIDwhLS0gRWRpdCBwYW5lbCBmb3Igc2VsZWN0ZWQgcG9seWxpbmUgKGFuY2hvcmVkIGF0IGl0cyBsYXN0IGNvcm5lcikgLS0+XG4gICAgPGRpdlxuICAgICAgdi1pZj1cInNlbGVjdGVkUG9seSAmJiBwb2x5UGFuZWxQb3NcIlxuICAgICAgcmVmPVwicG9seVBhbmVsRWxcIlxuICAgICAgY2xhc3M9XCJyZWN0LWVkaXQtcGFuZWxcIlxuICAgICAgOnN0eWxlPVwieyBsZWZ0OiBwb2x5UGFuZWxQb3MueCArICdweCcsIHRvcDogcG9seVBhbmVsUG9zLnkgKyAncHgnIH1cIlxuICAgICAgQGNsaWNrLnN0b3BcbiAgICA+XG4gICAgICA8ZGl2IGNsYXNzPVwiZWRpdC1jb2xvcnNcIj5cbiAgICAgICAgPGJ1dHRvblxuICAgICAgICAgIHYtZm9yPVwiYyBpbiBkcmF3aW5nc1N0b3JlLlBBTkVMX0NPTE9SU1wiXG4gICAgICAgICAgOmtleT1cImNcIlxuICAgICAgICAgIGNsYXNzPVwiY29sb3Itc3dhdGNoXCJcbiAgICAgICAgICA6Y2xhc3M9XCJ7IGFjdGl2ZTogc2VsZWN0ZWRQb2x5LmNvbG9yID09PSBjIH1cIlxuICAgICAgICAgIDpzdHlsZT1cInsgYmFja2dyb3VuZENvbG9yOiBjIH1cIlxuICAgICAgICAgIEBjbGljaz1cInNldFBvbHlDb2xvclNlbGVjdGVkKGMpXCJcbiAgICAgICAgLz5cbiAgICAgICAgPGRpdiBjbGFzcz1cInBhbGV0dGUtYW5jaG9yXCI+XG4gICAgICAgICAgPGJ1dHRvblxuICAgICAgICAgICAgY2xhc3M9XCJjb2xvci1tb3JlXCJcbiAgICAgICAgICAgIDpjbGFzcz1cInsgYWN0aXZlOiBwb2x5UGFsZXR0ZU9wZW4gfVwiXG4gICAgICAgICAgICB0aXRsZT1cIk1vcmUgY29sb3JzXCJcbiAgICAgICAgICAgIEBjbGljay5zdG9wPVwicG9seVBhbGV0dGVPcGVuID0gIXBvbHlQYWxldHRlT3BlblwiXG4gICAgICAgICAgPu+8izwvYnV0dG9uPlxuICAgICAgICAgIDxkaXYgdi1pZj1cInBvbHlQYWxldHRlT3BlblwiIGNsYXNzPVwicGFsZXR0ZS1wb3BcIiBAY2xpY2suc3RvcD5cbiAgICAgICAgICAgIDxidXR0b25cbiAgICAgICAgICAgICAgdi1mb3I9XCJjIGluIGRyYXdpbmdzU3RvcmUuUFJFU0VUX0NPTE9SU1wiXG4gICAgICAgICAgICAgIDprZXk9XCJjXCJcbiAgICAgICAgICAgICAgY2xhc3M9XCJjb2xvci1zd2F0Y2hcIlxuICAgICAgICAgICAgICA6Y2xhc3M9XCJ7IGFjdGl2ZTogc2VsZWN0ZWRQb2x5LmNvbG9yID09PSBjIH1cIlxuICAgICAgICAgICAgICA6c3R5bGU9XCJ7IGJhY2tncm91bmRDb2xvcjogYyB9XCJcbiAgICAgICAgICAgICAgQGNsaWNrPVwic2V0UG9seUNvbG9yU2VsZWN0ZWQoYyk7IHBvbHlQYWxldHRlT3BlbiA9IGZhbHNlXCJcbiAgICAgICAgICAgIC8+XG4gICAgICAgICAgPC9kaXY+XG4gICAgICAgIDwvZGl2PlxuICAgICAgPC9kaXY+XG4gICAgICA8c3BhbiBjbGFzcz1cInBhbmVsLWRpdmlkZXJcIiAvPlxuICAgICAgPGRpdiBjbGFzcz1cImRhc2gtcm93XCIgdGl0bGU9XCJMaW5lIHN0eWxlXCI+XG4gICAgICAgIDxidXR0b25cbiAgICAgICAgICB2LWZvcj1cImQgaW4gREFTSF9TVFlMRVNcIlxuICAgICAgICAgIDprZXk9XCJkXCJcbiAgICAgICAgICBjbGFzcz1cImRhc2gtYnRuXCJcbiAgICAgICAgICA6Y2xhc3M9XCJ7IGFjdGl2ZTogc2VsZWN0ZWRQb2x5LmRhc2ggPT09IGQgfVwiXG4gICAgICAgICAgOnRpdGxlPVwiZC5jaGFyQXQoMCkudG9VcHBlckNhc2UoKSArIGQuc2xpY2UoMSlcIlxuICAgICAgICAgIEBjbGljaz1cInNldFBvbHlEYXNoU2VsZWN0ZWQoZClcIlxuICAgICAgICA+XG4gICAgICAgICAgPHNwYW4gY2xhc3M9XCJkYXNoLXNhbXBsZVwiIDpjbGFzcz1cImRcIj48L3NwYW4+XG4gICAgICAgIDwvYnV0dG9uPlxuICAgICAgPC9kaXY+XG4gICAgICA8c3BhbiBjbGFzcz1cInBhbmVsLWRpdmlkZXJcIiAvPlxuICAgICAgPGJ1dHRvblxuICAgICAgICBjbGFzcz1cImVkaXQtYnRuXCJcbiAgICAgICAgOmNsYXNzPVwieyBvZmY6IHNlbGVjdGVkUG9seS5hcnJvdyA9PT0gZmFsc2UgfVwiXG4gICAgICAgIDp0aXRsZT1cInNlbGVjdGVkUG9seS5hcnJvdyA9PT0gZmFsc2UgPyAnQWRkIGFycm93IG9uIGxhc3QgY29ybmVyJyA6ICdSZW1vdmUgYXJyb3cnXCJcbiAgICAgICAgQGNsaWNrPVwidG9nZ2xlQXJyb3dTZWxlY3RlZFwiXG4gICAgICA+XG4gICAgICAgIDxzdmcgdmlld0JveD1cIjAgMCAxNiAxNlwiIHdpZHRoPVwiMTVcIiBoZWlnaHQ9XCIxNVwiIGFyaWEtaGlkZGVuPVwidHJ1ZVwiPlxuICAgICAgICAgIDxwYXRoIGQ9XCJNMi41IDEyLjUgTDEwLjUgNi41XCIgZmlsbD1cIm5vbmVcIiBzdHJva2U9XCJjdXJyZW50Q29sb3JcIiBzdHJva2Utd2lkdGg9XCIxLjZcIiBzdHJva2UtbGluZWNhcD1cInJvdW5kXCIgLz5cbiAgICAgICAgICA8cGF0aCBkPVwiTTguMiA0LjkgTDEzLjYgNC40IEwxMi42IDkuNiBaXCIgZmlsbD1cImN1cnJlbnRDb2xvclwiIHN0cm9rZT1cIm5vbmVcIiAvPlxuICAgICAgICA8L3N2Zz5cbiAgICAgIDwvYnV0dG9uPlxuICAgICAgPGJ1dHRvbiBjbGFzcz1cImVkaXQtYnRuIGRhbmdlclwiIEBjbGljaz1cImRlbGV0ZVNlbGVjdGVkUG9seVwiIHRpdGxlPVwiRGVsZXRlIHBvbHlsaW5lXCI+XG4gICAgICAgIDxzdmdcbiAgICAgICAgICB2aWV3Qm94PVwiMCAwIDE2IDE2XCJcbiAgICAgICAgICB3aWR0aD1cIjE1XCJcbiAgICAgICAgICBoZWlnaHQ9XCIxNVwiXG4gICAgICAgICAgYXJpYS1oaWRkZW49XCJ0cnVlXCJcbiAgICAgICAgICBmaWxsPVwibm9uZVwiXG4gICAgICAgICAgc3Ryb2tlPVwiY3VycmVudENvbG9yXCJcbiAgICAgICAgICBzdHJva2Utd2lkdGg9XCIxLjRcIlxuICAgICAgICAgIHN0cm9rZS1saW5lY2FwPVwicm91bmRcIlxuICAgICAgICAgIHN0cm9rZS1saW5lam9pbj1cInJvdW5kXCJcbiAgICAgICAgPlxuICAgICAgICAgIDxwYXRoIGQ9XCJNMi43NSA0LjVoMTAuNVwiIC8+XG4gICAgICAgICAgPHBhdGggZD1cIk01Ljc1IDQuNVYzLjRjMC0uNS40LS45LjktLjloMi43Yy41IDAgLjkuNC45Ljl2MS4xXCIgLz5cbiAgICAgICAgICA8cGF0aCBkPVwiTTQuNCA0LjVsLjUgNy45Yy4wNS42NC41NyAxLjEgMS4yIDEuMWgzLjhjLjYzIDAgMS4xNS0uNDYgMS4yLTEuMWwuNS03LjlcIiAvPlxuICAgICAgICAgIDxwYXRoIGQ9XCJNNi43IDcuMnYzLjlNOS4zIDcuMnYzLjlcIiAvPlxuICAgICAgICA8L3N2Zz5cbiAgICAgIDwvYnV0dG9uPlxuICAgIDwvZGl2PlxuXG4gICAgPCEtLSBFZGl0IHBhbmVsIGZvciB0aGUgc2VsZWN0ZWQgTG9uZy9TaG9ydCBwb3NpdGlvbiAtLT5cbiAgICA8ZGl2XG4gICAgICB2LWlmPVwic2VsZWN0ZWRQb3MgJiYgcG9zUGFuZWxQb3NcIlxuICAgICAgcmVmPVwicG9zUGFuZWxFbFwiXG4gICAgICBjbGFzcz1cInJlY3QtZWRpdC1wYW5lbFwiXG4gICAgICA6c3R5bGU9XCJ7IGxlZnQ6IHBvc1BhbmVsUG9zLnggKyAncHgnLCB0b3A6IHBvc1BhbmVsUG9zLnkgKyAncHgnLCB2aXNpYmlsaXR5OiBwb3NQYW5lbFJlYWR5ID8gJ3Zpc2libGUnIDogJ2hpZGRlbicgfVwiXG4gICAgICBAY2xpY2suc3RvcFxuICAgID5cbiAgICAgIDxidXR0b25cbiAgICAgICAgY2xhc3M9XCJlZGl0LWJ0blwiXG4gICAgICAgIDpjbGFzcz1cInsgb2ZmOiBzZWxlY3RlZFBvcy5zaG93TGV2ZWxzID09PSBmYWxzZSB9XCJcbiAgICAgICAgOnRpdGxlPVwic2VsZWN0ZWRQb3Muc2hvd0xldmVscyA9PT0gZmFsc2UgPyAnU2hvdyAxUi4uTlIgcmV3YXJkIGxpbmVzJyA6ICdIaWRlIHJld2FyZCBsaW5lcydcIlxuICAgICAgICBAY2xpY2s9XCJ0b2dnbGVQb3NMZXZlbHNcIlxuICAgICAgPlxuICAgICAgICA8c3ZnIHZpZXdCb3g9XCIwIDAgMTYgMTZcIiB3aWR0aD1cIjE1XCIgaGVpZ2h0PVwiMTVcIiBhcmlhLWhpZGRlbj1cInRydWVcIiBzdHJva2U9XCJjdXJyZW50Q29sb3JcIiBzdHJva2Utd2lkdGg9XCIxLjRcIiBzdHJva2UtbGluZWNhcD1cInJvdW5kXCI+XG4gICAgICAgICAgPHBhdGggZD1cIk0zIDQuNWgxMFwiIC8+XG4gICAgICAgICAgPHBhdGggZD1cIk0zIDhoMTBcIiBzdHJva2UtZGFzaGFycmF5PVwiMi41IDJcIiAvPlxuICAgICAgICAgIDxwYXRoIGQ9XCJNMyAxMS41aDEwXCIgc3Ryb2tlLWRhc2hhcnJheT1cIjIuNSAyXCIgLz5cbiAgICAgICAgPC9zdmc+XG4gICAgICA8L2J1dHRvbj5cbiAgICAgIDxidXR0b24gY2xhc3M9XCJlZGl0LWJ0biBkYW5nZXJcIiBAY2xpY2s9XCJkZWxldGVTZWxlY3RlZFBvc1wiIHRpdGxlPVwiRGVsZXRlIHBvc2l0aW9uXCI+XG4gICAgICAgIDxzdmdcbiAgICAgICAgICB2aWV3Qm94PVwiMCAwIDE2IDE2XCJcbiAgICAgICAgICB3aWR0aD1cIjE1XCJcbiAgICAgICAgICBoZWlnaHQ9XCIxNVwiXG4gICAgICAgICAgYXJpYS1oaWRkZW49XCJ0cnVlXCJcbiAgICAgICAgICBmaWxsPVwibm9uZVwiXG4gICAgICAgICAgc3Ryb2tlPVwiY3VycmVudENvbG9yXCJcbiAgICAgICAgICBzdHJva2Utd2lkdGg9XCIxLjRcIlxuICAgICAgICAgIHN0cm9rZS1saW5lY2FwPVwicm91bmRcIlxuICAgICAgICAgIHN0cm9rZS1saW5lam9pbj1cInJvdW5kXCJcbiAgICAgICAgPlxuICAgICAgICAgIDxwYXRoIGQ9XCJNMi43NSA0LjVoMTAuNVwiIC8+XG4gICAgICAgICAgPHBhdGggZD1cIk01Ljc1IDQuNVYzLjRjMC0uNS40LS45LjktLjloMi43Yy41IDAgLjkuNC45Ljl2MS4xXCIgLz5cbiAgICAgICAgICA8cGF0aCBkPVwiTTQuNCA0LjVsLjUgNy45Yy4wNS42NC41NyAxLjEgMS4yIDEuMWgzLjhjLjYzIDAgMS4xNS0uNDYgMS4yLTEuMWwuNS03LjlcIiAvPlxuICAgICAgICAgIDxwYXRoIGQ9XCJNNi43IDcuMnYzLjlNOS4zIDcuMnYzLjlcIiAvPlxuICAgICAgICA8L3N2Zz5cbiAgICAgIDwvYnV0dG9uPlxuICAgIDwvZGl2PlxuXG4gICAgPCEtLSBSZXBsYXkgbW9kZTogdmVydGljYWwgbGluZSB3aGlsZSBwaWNraW5nIHRoZSBzdGFydCBwb2ludCAtLT5cbiAgICA8ZGl2XG4gICAgICB2LWlmPVwicmVwbGF5LmFjdGl2ZSAmJiByZXBsYXkucGlja2luZ1wiXG4gICAgICBjbGFzcz1cInJlcGxheS1sYXllciBkcmF3aW5nLWNsaXBcIlxuICAgICAgOnN0eWxlPVwieyByaWdodDogYXhpc1JpZ2h0VyArICdweCcsIGJvdHRvbTogYXhpc0JvdHRvbUggKyAncHgnIH1cIlxuICAgID5cbiAgICAgIDxkaXZcbiAgICAgICAgdi1pZj1cInJlcGxheVZsWCAhPT0gbnVsbFwiXG4gICAgICAgIGNsYXNzPVwicmVwbGF5LXZsIHBpY2tpbmdcIlxuICAgICAgICA6c3R5bGU9XCJ7IGxlZnQ6IHJlcGxheVZsWCArICdweCcgfVwiXG4gICAgICA+XG4gICAgICAgIDxzcGFuIGNsYXNzPVwicmVwbGF5LXZsLWtub2JcIj7ilrY8L3NwYW4+XG4gICAgICA8L2Rpdj5cbiAgICA8L2Rpdj5cblxuICAgIDwhLS0gUmVwbGF5IHByaWNlIHRhZzogdW5kZXIgdGhlIGxpdmUgcHJpY2UgbGFiZWwgb24gdGhlIHByaWNlIHNjYWxlIC0tPlxuICAgIDxkaXYgdi1pZj1cInJlcGxheVRhZ1wiIGNsYXNzPVwicmVwbGF5LXByaWNlLXRhZ1wiIDpzdHlsZT1cInsgdG9wOiByZXBsYXlUYWcueSArICdweCcgfVwiPnt7IHJlcGxheVRhZy50ZXh0IH19PC9kaXY+XG5cbiAgICA8IS0tIERlbW8gdHJhZGluZzogZW50cnkvU0wvVFAgbGluZXMgZm9yIHRoZSBhY3RpdmUgc3ltYm9sJ3MgcG9zaXRpb25zXG4gICAgICAgICBhbmQgcGVuZGluZyBvcmRlcnMsIHdpdGggZHJhZyBzdHJpcHMgYW5kIHByaWNlIHRhZ3Mgb24gdGhlIHNjYWxlIC0tPlxuICAgIDx0ZW1wbGF0ZSB2LWlmPVwiZGVtby5hY3RpdmVcIj5cbiAgICAgIDxkaXYgY2xhc3M9XCJkZW1vLWxpbmVzIGRyYXdpbmctY2xpcFwiIDpzdHlsZT1cInsgcmlnaHQ6IGF4aXNSaWdodFcgKyAncHgnLCBib3R0b206IChheGlzQm90dG9tSCArIGRlbW9Cb3R0b21IKSArICdweCcgfVwiPlxuICAgICAgICA8ZGl2XG4gICAgICAgICAgdi1mb3I9XCJsIGluIGRlbW9MaW5lc1wiXG4gICAgICAgICAgOmtleT1cImwuaWQgKyBsLmxldmVsXCJcbiAgICAgICAgICBjbGFzcz1cImRlbW8tbGluZVwiXG4gICAgICAgICAgOmNsYXNzPVwiW2wubGV2ZWwsIHsgZGFzaGVkOiBsLmRhc2hlZCB9XVwiXG4gICAgICAgICAgOnN0eWxlPVwieyB0b3A6IGwueSArICdweCcsIGJhY2tncm91bmQ6IGwuY29sb3IgfVwiXG4gICAgICAgID48L2Rpdj5cbiAgICAgICAgPCEtLSBMZWZ0LWVkZ2UgbGluZSBsYWJlbHMgZm9yIG9wZW4gcG9zaXRpb25zIEFORCBwZW5kaW5nIG9yZGVyczpcbiAgICAgICAgICAgICBsb3QgKyAkIGxvc3Mgb24gdGhlIFNMIGxpbmUsICQgcmV3YXJkICsgUjpSIG9uIHRoZSBUUCBsaW5lIC0tPlxuICAgICAgICA8dGVtcGxhdGUgdi1mb3I9XCJwIGluIGRlbW8ucG9zaXRpb25zLmZpbHRlcigoeCkgPT4geC5zeW1ib2wgPT09IG1hcmtldC5pbnN0cnVtZW50ICYmIHguc3RhdHVzICE9PSAnY2xvc2VkJylcIiA6a2V5PVwiJ2xibC0nICsgcC5pZFwiPlxuICAgICAgICAgIDxkaXZcbiAgICAgICAgICAgIHYtZm9yPVwibCBpbiBkZW1vTGluZXMuZmlsdGVyKCh4KSA9PiB4LmlkID09PSBwLmlkKVwiXG4gICAgICAgICAgICA6a2V5PVwiJ2xibC0nICsgbC5sZXZlbFwiXG4gICAgICAgICAgICBjbGFzcz1cImRlbW8tbGluZS1sYWJlbFwiXG4gICAgICAgICAgICA6Y2xhc3M9XCJsLmxldmVsXCJcbiAgICAgICAgICAgIDpzdHlsZT1cInsgdG9wOiBsLnkgLSAxMCArICdweCcgfVwiXG4gICAgICAgICAgPlxuICAgICAgICAgICAgPHRlbXBsYXRlIHYtaWY9XCJsLmxldmVsID09PSAnZW50cnknXCI+RU5UUlkge3sgcC5sb3QgfX0gbG90PC90ZW1wbGF0ZT5cbiAgICAgICAgICAgIDx0ZW1wbGF0ZSB2LWVsc2UtaWY9XCJsLmxldmVsID09PSAnc2wnXCI+U0wge3sgcC5sb3QgfX0gbG90ICYjMTgzOyAtJHt7IGwubW9uZXkgfX08L3RlbXBsYXRlPlxuICAgICAgICAgICAgPHRlbXBsYXRlIHYtZWxzZS1pZj1cImwubGV2ZWwgPT09ICd0cCdcIj5UUCAke3sgbC5tb25leSB9fSAmIzE4MzsgUjpSIHt7IGwucnIgfX08L3RlbXBsYXRlPlxuICAgICAgICAgIDwvZGl2PlxuICAgICAgICA8L3RlbXBsYXRlPlxuICAgICAgPC9kaXY+XG4gICAgICA8ZGl2IGNsYXNzPVwiZGVtby1oaXQtbGF5ZXJcIiA6Y2xhc3M9XCJ7ICdkcmF3aW5nLW1vZGUnOiByZXBsYXkucGlja2luZyB9XCIgOnN0eWxlPVwieyByaWdodDogYXhpc1JpZ2h0VyArICdweCcsIGJvdHRvbTogKGF4aXNCb3R0b21IICsgZGVtb0JvdHRvbUgpICsgJ3B4JyB9XCI+XG4gICAgICAgIDxkaXZcbiAgICAgICAgICB2LWZvcj1cImwgaW4gZGVtb0xpbmVzXCJcbiAgICAgICAgICA6a2V5PVwiJ2RoaXQtJyArIGwuaWQgKyBsLmxldmVsXCJcbiAgICAgICAgICBjbGFzcz1cImRlbW8tbGluZS1oaXRcIlxuICAgICAgICAgIDpzdHlsZT1cInsgdG9wOiBsLnkgLSA0ICsgJ3B4JyB9XCJcbiAgICAgICAgICBAcG9pbnRlcmRvd24uc3RvcC5wcmV2ZW50PVwib25EZW1vTGluZURyYWdTdGFydCgkZXZlbnQsIGwuaWQsIGwubGV2ZWwpXCJcbiAgICAgICAgPjwvZGl2PlxuICAgICAgPC9kaXY+XG4gICAgICA8ZGl2IGNsYXNzPVwiZGVtby10YWctbGF5ZXJcIiA6c3R5bGU9XCJ7IGJvdHRvbTogKGF4aXNCb3R0b21IICsgZGVtb0JvdHRvbUgpICsgJ3B4JyB9XCI+XG4gICAgICAgIDx0ZW1wbGF0ZSB2LWZvcj1cImwgaW4gZGVtb0xpbmVzXCIgOmtleT1cIid0YWctJyArIGwuaWQgKyBsLmxldmVsXCI+XG4gICAgICAgICAgPGRpdlxuICAgICAgICAgICAgdi1pZj1cImwueSA+PSA5ICYmIGwueSA8PSBkZW1vQ2hhcnRIIC0gMTBcIlxuICAgICAgICAgICAgY2xhc3M9XCJkZW1vLWF4aXMtdGFnXCJcbiAgICAgICAgICAgIDpjbGFzcz1cImwubGV2ZWxcIlxuICAgICAgICAgICAgOnN0eWxlPVwieyB0b3A6IGwueSAtIDkgKyAncHgnIH1cIlxuICAgICAgICAgID57eyBsLnByaWNlLnRvRml4ZWQocHJlYykgfX08L2Rpdj5cbiAgICAgICAgPC90ZW1wbGF0ZT5cbiAgICAgIDwvZGl2PlxuICAgIDwvdGVtcGxhdGU+XG5cbiAgICA8IS0tIERlbW8gbW9uZXkgbWFuYWdlbWVudCAoY29tcGFjdCwgdG9wLXJpZ2h0LCBjb2xsYXBzaWJsZSkgLS0+XG4gICAgPGRpdiB2LWlmPVwiZGVtby5hY3RpdmVcIiBjbGFzcz1cImRlbW8tbWdyXCIgOmNsYXNzPVwieyBtaW5pOiBkZW1vTWluaSB9XCI+XG4gICAgICA8ZGl2IGNsYXNzPVwiZGVtby1tZ3ItaGVhZFwiPlxuICAgICAgICA8c3BhbiB2LWlmPVwiIWRlbW9NaW5pXCIgY2xhc3M9XCJkZW1vLW1nci10aXRsZVwiPkRFTU88L3NwYW4+XG4gICAgICAgIDxidXR0b24gY2xhc3M9XCJkZW1vLW1pbmktYnRuXCIgOnRpdGxlPVwiZGVtb01pbmkgPyAnRXhwYW5kJyA6ICdNaW5pbWl6ZSdcIiBAY2xpY2suc3RvcD1cImRlbW9NaW5pID0gIWRlbW9NaW5pXCI+e3sgZGVtb01pbmkgPyBcIitcIiA6IFwi4oiSXCIgfX08L2J1dHRvbj5cbiAgICAgIDwvZGl2PlxuICAgICAgPHRlbXBsYXRlIHYtaWY9XCIhZGVtb01pbmlcIj5cbiAgICAgICAgPGRpdiBjbGFzcz1cImRlbW8tc2l6ZS1tb2Rlc1wiPlxuICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJkZW1vLW1vZGVcIiA6Y2xhc3M9XCJ7IGFjdGl2ZTogZGVtby5zaXplTW9kZSA9PT0gJ2xvdCcgfVwiIHRpdGxlPVwiU2l6ZSBieSBsb3QgKHJpc2sgJCBwZXIgU0wpXCIgQGNsaWNrLnN0b3A9XCJkZW1vLnNpemVNb2RlID0gJ2xvdCdcIj5Mb3Q8L2J1dHRvbj5cbiAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwiZGVtby1tb2RlXCIgOmNsYXNzPVwieyBhY3RpdmU6IGRlbW8uc2l6ZU1vZGUgPT09ICdwZXJjZW50JyB9XCIgdGl0bGU9XCJSaXNrID0gJSBvZiBiYWxhbmNlXCIgQGNsaWNrLnN0b3A9XCJkZW1vLnNpemVNb2RlID0gJ3BlcmNlbnQnXCI+JTwvYnV0dG9uPlxuICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJkZW1vLW1vZGVcIiA6Y2xhc3M9XCJ7IGFjdGl2ZTogZGVtby5zaXplTW9kZSA9PT0gJ3VzZCcgfVwiIHRpdGxlPVwiUmlzayA9IGVudGVyZWQgJCBhbW91bnRcIiBAY2xpY2suc3RvcD1cImRlbW8uc2l6ZU1vZGUgPSAndXNkJ1wiPiQ8L2J1dHRvbj5cbiAgICAgICAgPC9kaXY+XG4gICAgICAgIDxsYWJlbCB2LWlmPVwiZGVtby5zaXplTW9kZSA9PT0gJ2xvdCdcIiBjbGFzcz1cImRlbW8tbWdyLWlucFwiPjxzcGFuPkxvdDwvc3Bhbj48aW5wdXQgdHlwZT1cIm51bWJlclwiIG1pbj1cIjAuMDFcIiBzdGVwPVwiMC4wMVwiIHYtbW9kZWwubnVtYmVyPVwiZGVtby5sb3RcIiAvPjwvbGFiZWw+XG4gICAgICAgIDxsYWJlbCB2LWlmPVwiZGVtby5zaXplTW9kZSA9PT0gJ3VzZCdcIiBjbGFzcz1cImRlbW8tbWdyLWlucFwiPjxzcGFuPlJpc2sgJDwvc3Bhbj48aW5wdXQgdHlwZT1cIm51bWJlclwiIG1pbj1cIjFcIiBzdGVwPVwiMVwiIHYtbW9kZWwubnVtYmVyPVwiZGVtby5yaXNrVXNkXCIgLz48L2xhYmVsPlxuICAgICAgICA8bGFiZWwgdi1pZj1cImRlbW8uc2l6ZU1vZGUgPT09ICdwZXJjZW50J1wiIGNsYXNzPVwiZGVtby1tZ3ItaW5wXCI+PHNwYW4+UmlzayAlPC9zcGFuPjxpbnB1dCB0eXBlPVwibnVtYmVyXCIgbWluPVwiMC4xXCIgc3RlcD1cIjAuMVwiIHYtbW9kZWwubnVtYmVyPVwiZGVtby5yaXNrUGN0XCIgLz48L2xhYmVsPlxuICAgICAgICA8ZGl2IGNsYXNzPVwiZGVtby1tZ3ItYnRuc1wiPlxuICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJkbS1idG4gYnV5XCIgdGl0bGU9XCJCdXkgTGltaXQg4oCUIGxpbmVzIGRyYXcgb24gdGhlIGNoYXJ0LCB0aGVuIFNldFwiIEBjbGljay5zdG9wPVwiYXJtRGVtbygnbG9uZycsICdsaW1pdCcpXCI+QnV5IExpbTwvYnV0dG9uPlxuICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJkbS1idG4gc2VsbFwiIHRpdGxlPVwiU2VsbCBMaW1pdCDigJQgbGluZXMgZHJhdyBvbiB0aGUgY2hhcnQsIHRoZW4gU2V0XCIgQGNsaWNrLnN0b3A9XCJhcm1EZW1vKCdzaG9ydCcsICdsaW1pdCcpXCI+U2VsbCBMaW08L2J1dHRvbj5cbiAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwiZG0tYnRuIGJ1eVwiIHRpdGxlPVwiTWFya2V0IEJ1eSDigJQgbGluZXMgZHJhdywgdGhlbiBTZXQgZmlsbHMgYXQgbWFya2V0XCIgQGNsaWNrLnN0b3A9XCJhcm1EZW1vKCdsb25nJywgJ21hcmtldCcpXCI+QnV5PC9idXR0b24+XG4gICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cImRtLWJ0biBzZWxsXCIgdGl0bGU9XCJNYXJrZXQgU2VsbCDigJQgbGluZXMgZHJhdywgdGhlbiBTZXQgZmlsbHMgYXQgbWFya2V0XCIgQGNsaWNrLnN0b3A9XCJhcm1EZW1vKCdzaG9ydCcsICdtYXJrZXQnKVwiPlNlbGw8L2J1dHRvbj5cbiAgICAgICAgPC9kaXY+XG4gICAgICAgIDxkaXYgdi1pZj1cImRyYWZ0XCIgY2xhc3M9XCJkZW1vLWRyYWZ0LWJ0bnNcIj5cbiAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwiZG0tYnRuIHNldFwiIHRpdGxlPVwiUGxhY2UgdGhlIG9yZGVyXCIgQGNsaWNrLnN0b3A9XCJzZXREZW1vRHJhZnRcIj5TZXQ8L2J1dHRvbj5cbiAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwiZG0tYnRuIGNhbmNlbFwiIHRpdGxlPVwiQ2FuY2VsXCIgQGNsaWNrLnN0b3A9XCJjYW5jZWxEZW1vRHJhZnRcIj7inJU8L2J1dHRvbj5cbiAgICAgICAgPC9kaXY+XG4gICAgICAgIDxkaXYgdi1pZj1cImRlbW8uZXJyb3JcIiBjbGFzcz1cImRlbW8tZXJyXCI+e3sgZGVtby5lcnJvciB9fTwvZGl2PlxuICAgICAgPC90ZW1wbGF0ZT5cbiAgICA8L2Rpdj5cblxuICAgIDwhLS0gUmVwbGF5IGNvbnRyb2wgcGFuZWw6IHdoZW4gdGhlIGRlbW8gcGFuZWwgaXMgb3BlbiBpdCBzaXRzIGFib3ZlXG4gICAgICAgICBpdCwgcmlnaHQgb2YgdGhlIE9wZW4gUC9MIHN0YXQgLS0+XG4gICAgPGRpdlxuICAgICAgdi1pZj1cInJlcGxheS5hY3RpdmVcIlxuICAgICAgY2xhc3M9XCJyZXBsYXktcGFuZWxcIlxuICAgICAgOmNsYXNzPVwieyAnZGVtby1zaGlmdCc6IGRlbW8uYWN0aXZlIH1cIlxuICAgICAgOnN0eWxlPVwiZGVtby5hY3RpdmUgPyB7IGJvdHRvbTogZGVtb0JvdHRvbUggKyA2ICsgJ3B4JywgcmlnaHQ6ICcxMnB4JywgbGVmdDogJ2F1dG8nLCB0cmFuc2Zvcm06ICdub25lJyB9IDogdW5kZWZpbmVkXCJcbiAgICA+XG4gICAgICA8dGVtcGxhdGUgdi1pZj1cInJlcGxheS5waWNraW5nXCI+XG4gICAgICAgIDxzcGFuIGNsYXNzPVwicmVwbGF5LWhpbnRcIj5SZXBsYXkg4oCUIGNsaWNrIGEgY2FuZGxlIHRvIHN0YXJ0PC9zcGFuPlxuICAgICAgICA8YnV0dG9uIGNsYXNzPVwicnAtYnRuIGFjY2VudFwiIHRpdGxlPVwiU3RhcnQgcmVwbGF5IGF0IHRoZSBsaW5lXCIgQGNsaWNrPVwidG9nZ2xlUGxheVwiPuKWtjwvYnV0dG9uPlxuICAgICAgICA8YnV0dG9uIGNsYXNzPVwicnAtYnRuIGRhbmdlclwiIHRpdGxlPVwiRXhpdCByZXBsYXlcIiBAY2xpY2s9XCJvblJlcGxheUV4aXRcIj7inJU8L2J1dHRvbj5cbiAgICAgIDwvdGVtcGxhdGU+XG4gICAgICA8dGVtcGxhdGUgdi1lbHNlPlxuICAgICAgICA8YnV0dG9uXG4gICAgICAgICAgY2xhc3M9XCJycC1idG5cIlxuICAgICAgICAgIHRpdGxlPVwiU3RlcCBiYWNrIChob2xkIHRvIHJlcGVhdClcIlxuICAgICAgICAgIEBwb2ludGVyZG93bi5wcmV2ZW50PVwiaG9sZFN0ZXAoLTEpXCJcbiAgICAgICAgICBAbW91c2V1cD1cInN0b3BIb2xkXCJcbiAgICAgICAgICBAbW91c2VsZWF2ZT1cInN0b3BIb2xkXCJcbiAgICAgICAgPuKPrjwvYnV0dG9uPlxuICAgICAgICA8YnV0dG9uIGNsYXNzPVwicnAtYnRuIGFjY2VudFwiIDp0aXRsZT1cInJlcGxheS5wbGF5aW5nID8gJ1BhdXNlJyA6ICdQbGF5J1wiIEBjbGljaz1cInRvZ2dsZVBsYXlcIj5cbiAgICAgICAgICB7eyByZXBsYXkucGxheWluZyA/IFwi4o+4XCIgOiBcIuKWtlwiIH19XG4gICAgICAgIDwvYnV0dG9uPlxuICAgICAgICA8YnV0dG9uXG4gICAgICAgICAgY2xhc3M9XCJycC1idG5cIlxuICAgICAgICAgIHRpdGxlPVwiU3RlcCBmb3J3YXJkIChob2xkIHRvIHJlcGVhdClcIlxuICAgICAgICAgIEBwb2ludGVyZG93bi5wcmV2ZW50PVwiaG9sZFN0ZXAoMSlcIlxuICAgICAgICAgIEBtb3VzZXVwPVwic3RvcEhvbGRcIlxuICAgICAgICAgIEBtb3VzZWxlYXZlPVwic3RvcEhvbGRcIlxuICAgICAgICA+4o+tPC9idXR0b24+XG4gICAgICAgIDxzcGFuIGNsYXNzPVwicnAtc2VwXCIgLz5cbiAgICAgICAgPGJ1dHRvblxuICAgICAgICAgIHYtZm9yPVwicyBpbiBbMSwgMiwgNSwgMTBdXCJcbiAgICAgICAgICA6a2V5PVwic1wiXG4gICAgICAgICAgY2xhc3M9XCJycC1idG4gc3BlZWRcIlxuICAgICAgICAgIDpjbGFzcz1cInsgYWN0aXZlOiByZXBsYXkuc3BlZWQgPT09IHMgfVwiXG4gICAgICAgICAgOnRpdGxlPVwiYFNwZWVkICR7c314YFwiXG4gICAgICAgICAgQGNsaWNrPVwicmVwbGF5LnNwZWVkID0gcyBhcyBhbnlcIlxuICAgICAgICA+e3sgcyB9fXg8L2J1dHRvbj5cbiAgICAgICAgPHNwYW4gY2xhc3M9XCJycC1zZXBcIiAvPlxuICAgICAgICA8YnV0dG9uIGNsYXNzPVwicnAtYnRuIGRhbmdlclwiIHRpdGxlPVwiRXhpdCByZXBsYXlcIiBAY2xpY2s9XCJvblJlcGxheUV4aXRcIj7inJU8L2J1dHRvbj5cbiAgICAgIDwvdGVtcGxhdGU+XG4gICAgPC9kaXY+XG5cbiAgICA8IS0tIEVkaXQgcGFuZWwgZm9yIHRoZSBzZWxlY3RlZCBvbmUtY2xpY2sgbGluZSAtLT5cbiAgICA8ZGl2XG4gICAgICB2LWlmPVwiZHJhd2luZ3NTdG9yZS5zZWxlY3RlZFNpbmdsZSAmJiBzaW5nbGVQYW5lbFBvc1wiXG4gICAgICByZWY9XCJzaW5nbGVQYW5lbEVsXCJcbiAgICAgIGNsYXNzPVwicmVjdC1lZGl0LXBhbmVsXCJcbiAgICAgIDpzdHlsZT1cInsgbGVmdDogc2luZ2xlUGFuZWxQb3MueCArICdweCcsIHRvcDogc2luZ2xlUGFuZWxQb3MueSArICdweCcsIHZpc2liaWxpdHk6IHNpbmdsZVBhbmVsUmVhZHkgPyAndmlzaWJsZScgOiAnaGlkZGVuJyB9XCJcbiAgICAgIEBjbGljay5zdG9wXG4gICAgPlxuICAgICAgPGRpdiBjbGFzcz1cImVkaXQtY29sb3JzXCI+XG4gICAgICAgIDxidXR0b25cbiAgICAgICAgICB2LWZvcj1cImMgaW4gZHJhd2luZ3NTdG9yZS5QQU5FTF9DT0xPUlNcIlxuICAgICAgICAgIDprZXk9XCJjXCJcbiAgICAgICAgICBjbGFzcz1cImNvbG9yLXN3YXRjaFwiXG4gICAgICAgICAgOmNsYXNzPVwieyBhY3RpdmU6IGdldFNpbmdsZShkcmF3aW5nc1N0b3JlLnNlbGVjdGVkU2luZ2xlLmtpbmQsIGRyYXdpbmdzU3RvcmUuc2VsZWN0ZWRTaW5nbGUuaWQpPy5jb2xvciA9PT0gYyB9XCJcbiAgICAgICAgICA6c3R5bGU9XCJ7IGJhY2tncm91bmRDb2xvcjogYyB9XCJcbiAgICAgICAgICBAY2xpY2s9XCJzZXRTaW5nbGVDb2xvcihjKVwiXG4gICAgICAgIC8+XG4gICAgICA8L2Rpdj5cbiAgICAgIDxzcGFuIGNsYXNzPVwicGFuZWwtZGl2aWRlclwiIC8+XG4gICAgICA8ZGl2IGNsYXNzPVwiZGFzaC1yb3dcIiB0aXRsZT1cIkxpbmUgc3R5bGVcIj5cbiAgICAgICAgPGJ1dHRvblxuICAgICAgICAgIHYtZm9yPVwiZCBpbiBEQVNIX1NUWUxFU1wiXG4gICAgICAgICAgOmtleT1cImRcIlxuICAgICAgICAgIGNsYXNzPVwiZGFzaC1idG5cIlxuICAgICAgICAgIDpjbGFzcz1cInsgYWN0aXZlOiBnZXRTaW5nbGUoZHJhd2luZ3NTdG9yZS5zZWxlY3RlZFNpbmdsZS5raW5kLCBkcmF3aW5nc1N0b3JlLnNlbGVjdGVkU2luZ2xlLmlkKT8uZGFzaCA9PT0gZCB9XCJcbiAgICAgICAgICA6dGl0bGU9XCJkLmNoYXJBdCgwKS50b1VwcGVyQ2FzZSgpICsgZC5zbGljZSgxKVwiXG4gICAgICAgICAgQGNsaWNrPVwic2V0U2luZ2xlRGFzaChkKVwiXG4gICAgICAgID5cbiAgICAgICAgICA8c3BhbiBjbGFzcz1cImRhc2gtc2FtcGxlXCIgOmNsYXNzPVwiZFwiPjwvc3Bhbj5cbiAgICAgICAgPC9idXR0b24+XG4gICAgICA8L2Rpdj5cbiAgICAgIDxzcGFuIGNsYXNzPVwicGFuZWwtZGl2aWRlclwiIC8+XG4gICAgICA8YnV0dG9uIGNsYXNzPVwiZWRpdC1idG4gZGFuZ2VyXCIgQGNsaWNrPVwiZGVsZXRlU2VsZWN0ZWRTaW5nbGVcIiB0aXRsZT1cIkRlbGV0ZSBsaW5lXCI+XG4gICAgICAgIDxzdmdcbiAgICAgICAgICB2aWV3Qm94PVwiMCAwIDE2IDE2XCJcbiAgICAgICAgICB3aWR0aD1cIjE1XCJcbiAgICAgICAgICBoZWlnaHQ9XCIxNVwiXG4gICAgICAgICAgYXJpYS1oaWRkZW49XCJ0cnVlXCJcbiAgICAgICAgICBmaWxsPVwibm9uZVwiXG4gICAgICAgICAgc3Ryb2tlPVwiY3VycmVudENvbG9yXCJcbiAgICAgICAgICBzdHJva2Utd2lkdGg9XCIxLjRcIlxuICAgICAgICAgIHN0cm9rZS1saW5lY2FwPVwicm91bmRcIlxuICAgICAgICAgIHN0cm9rZS1saW5lam9pbj1cInJvdW5kXCJcbiAgICAgICAgPlxuICAgICAgICAgIDxwYXRoIGQ9XCJNMi43NSA0LjVoMTAuNVwiIC8+XG4gICAgICAgICAgPHBhdGggZD1cIk01Ljc1IDQuNVYzLjRjMC0uNS40LS45LjktLjloMi43Yy41IDAgLjkuNC45Ljl2MS4xXCIgLz5cbiAgICAgICAgICA8cGF0aCBkPVwiTTQuNCA0LjVsLjUgNy45Yy4wNS42NC41NyAxLjEgMS4yIDEuMWgzLjhjLjYzIDAgMS4xNS0uNDYgMS4yLTEuMWwuNS03LjlcIiAvPlxuICAgICAgICAgIDxwYXRoIGQ9XCJNNi43IDcuMnYzLjlNOS4zIDcuMnYzLjlcIiAvPlxuICAgICAgICA8L3N2Zz5cbiAgICAgIDwvYnV0dG9uPlxuICAgIDwvZGl2PlxuXG4gICAgPCEtLSBUcmFkaW5nVmlldy1zdHlsZSByaWdodC1jbGljayBtZW51IG9uIGEgcmVjdGFuZ2xlIC0tPlxuICAgIDxkaXZcbiAgICAgIHYtaWY9XCJyZWN0TWVudVwiXG4gICAgICByZWY9XCJlZGl0TWVudUVsXCJcbiAgICAgIGNsYXNzPVwicmVjdC1lZGl0LXBhbmVsIHJlY3QtY29udGV4dC1tZW51XCJcbiAgICAgIDpzdHlsZT1cInsgbGVmdDogcmVjdE1lbnUueCArICdweCcsIHRvcDogcmVjdE1lbnUueSArICdweCcgfVwiXG4gICAgICBAY2xpY2suc3RvcFxuICAgICAgQGNvbnRleHRtZW51LnByZXZlbnQuc3RvcFxuICAgID5cbiAgICAgIDxkaXYgY2xhc3M9XCJlZGl0LWNvbG9yc1wiPlxuICAgICAgICA8YnV0dG9uXG4gICAgICAgICAgdi1mb3I9XCJjIGluIGRyYXdpbmdzU3RvcmUuUEFORUxfQ09MT1JTXCJcbiAgICAgICAgICA6a2V5PVwiY1wiXG4gICAgICAgICAgY2xhc3M9XCJjb2xvci1zd2F0Y2hcIlxuICAgICAgICAgIDpjbGFzcz1cInsgYWN0aXZlOiBzZWxlY3RlZFJlY3Q/LmlkID09PSByZWN0TWVudS5pZCAmJiBzZWxlY3RlZFJlY3QuY29sb3IgPT09IGMgfVwiXG4gICAgICAgICAgOnN0eWxlPVwieyBiYWNrZ3JvdW5kQ29sb3I6IGMgfVwiXG4gICAgICAgICAgQGNsaWNrPVwic2V0Q29sb3JJbk1lbnUoYylcIlxuICAgICAgICAvPlxuICAgICAgICA8ZGl2IGNsYXNzPVwicGFsZXR0ZS1hbmNob3JcIj5cbiAgICAgICAgICA8YnV0dG9uXG4gICAgICAgICAgICBjbGFzcz1cImNvbG9yLW1vcmVcIlxuICAgICAgICAgICAgOmNsYXNzPVwieyBhY3RpdmU6IHBhbGV0dGVPcGVuID09PSAnbWVudScgfVwiXG4gICAgICAgICAgICB0aXRsZT1cIk1vcmUgY29sb3JzXCJcbiAgICAgICAgICAgIEBjbGljay5zdG9wPVwidG9nZ2xlUGFsZXR0ZSgnbWVudScpXCJcbiAgICAgICAgICA+77yLPC9idXR0b24+XG4gICAgICAgICAgPGRpdiB2LWlmPVwicGFsZXR0ZU9wZW4gPT09ICdtZW51J1wiIGNsYXNzPVwicGFsZXR0ZS1wb3BcIiBAY2xpY2suc3RvcD5cbiAgICAgICAgICAgIDxidXR0b25cbiAgICAgICAgICAgICAgdi1mb3I9XCJjIGluIGRyYXdpbmdzU3RvcmUuUFJFU0VUX0NPTE9SU1wiXG4gICAgICAgICAgICAgIDprZXk9XCJjXCJcbiAgICAgICAgICAgICAgY2xhc3M9XCJjb2xvci1zd2F0Y2hcIlxuICAgICAgICAgICAgICA6Y2xhc3M9XCJ7IGFjdGl2ZTogbWVudVJlY3RDb2xvciA9PT0gYyB9XCJcbiAgICAgICAgICAgICAgOnN0eWxlPVwieyBiYWNrZ3JvdW5kQ29sb3I6IGMgfVwiXG4gICAgICAgICAgICAgIEBjbGljaz1cInNldENvbG9ySW5NZW51KGMpOyBwYWxldHRlT3BlbiA9IG51bGxcIlxuICAgICAgICAgICAgLz5cbiAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgPC9kaXY+XG4gICAgICA8L2Rpdj5cbiAgICAgIDxzcGFuIGNsYXNzPVwicGFuZWwtZGl2aWRlclwiIC8+XG4gICAgICA8bGFiZWwgY2xhc3M9XCJvcGFjaXR5LXJvd1wiIHRpdGxlPVwiRmlsbCBvcGFjaXR5XCI+XG4gICAgICAgIDxzcGFuIGNsYXNzPVwib3BhY2l0eS1pY29uXCI+4pe7PC9zcGFuPlxuICAgICAgICA8aW5wdXRcbiAgICAgICAgICB0eXBlPVwicmFuZ2VcIlxuICAgICAgICAgIGNsYXNzPVwib3BhY2l0eS1zbGlkZXJcIlxuICAgICAgICAgIG1pbj1cIjBcIlxuICAgICAgICAgIG1heD1cIjEwMFwiXG4gICAgICAgICAgOnZhbHVlPVwiTWF0aC5yb3VuZChtZW51UmVjdE9wYWNpdHkgKiAxMDApXCJcbiAgICAgICAgICBAaW5wdXQ9XCJzZXRPcGFjaXR5SW5NZW51KE51bWJlcigoJGV2ZW50LnRhcmdldCBhcyBIVE1MSW5wdXRFbGVtZW50KS52YWx1ZSkgLyAxMDApXCJcbiAgICAgICAgLz5cbiAgICAgICAgPHNwYW4gY2xhc3M9XCJvcGFjaXR5LXZhbHVlXCI+e3sgTWF0aC5yb3VuZChtZW51UmVjdE9wYWNpdHkgKiAxMDApIH19JTwvc3Bhbj5cbiAgICAgIDwvbGFiZWw+XG4gICAgICA8c3BhbiBjbGFzcz1cInBhbmVsLWRpdmlkZXJcIiAvPlxuICAgICAgPHNwYW4gY2xhc3M9XCJwYW5lbC1kaXZpZGVyXCIgLz5cbiAgICAgIDxidXR0b25cbiAgICAgICAgY2xhc3M9XCJlZGl0LWJ0blwiXG4gICAgICAgIDpjbGFzcz1cInsgb2ZmOiAhbWVudVJlY3RGaWxsZWQgfVwiXG4gICAgICAgIDp0aXRsZT1cIm1lbnVSZWN0RmlsbGVkID8gJ0JvcmRlciBvbmx5IChubyBmaWxsKScgOiAnU2hvdyBiYWNrZ3JvdW5kIGZpbGwnXCJcbiAgICAgICAgQGNsaWNrPVwidG9nZ2xlRmlsbEluTWVudVwiXG4gICAgICA+XG4gICAgICAgIDxzdmcgdmlld0JveD1cIjAgMCAxNiAxNlwiIHdpZHRoPVwiMTVcIiBoZWlnaHQ9XCIxNVwiIGFyaWEtaGlkZGVuPVwidHJ1ZVwiPlxuICAgICAgICAgIDxyZWN0XG4gICAgICAgICAgICB4PVwiMi4yNVwiXG4gICAgICAgICAgICB5PVwiMy4yNVwiXG4gICAgICAgICAgICB3aWR0aD1cIjExLjVcIlxuICAgICAgICAgICAgaGVpZ2h0PVwiOS41XCJcbiAgICAgICAgICAgIHJ4PVwiMlwiXG4gICAgICAgICAgICA6ZmlsbD1cIm1lbnVSZWN0RmlsbGVkID8gJ2N1cnJlbnRDb2xvcicgOiAnbm9uZSdcIlxuICAgICAgICAgICAgOmZpbGwtb3BhY2l0eT1cIm1lbnVSZWN0RmlsbGVkID8gMC4zMiA6IDBcIlxuICAgICAgICAgICAgc3Ryb2tlPVwiY3VycmVudENvbG9yXCJcbiAgICAgICAgICAgIHN0cm9rZS13aWR0aD1cIjEuNVwiXG4gICAgICAgICAgLz5cbiAgICAgICAgPC9zdmc+XG4gICAgICA8L2J1dHRvbj5cbiAgICAgIDxidXR0b24gY2xhc3M9XCJlZGl0LWJ0biBkYW5nZXJcIiBAY2xpY2s9XCJkZWxldGVGcm9tTWVudVwiIHRpdGxlPVwiRGVsZXRlIHJlY3RhbmdsZVwiPlxuICAgICAgICA8c3ZnXG4gICAgICAgICAgdmlld0JveD1cIjAgMCAxNiAxNlwiXG4gICAgICAgICAgd2lkdGg9XCIxNVwiXG4gICAgICAgICAgaGVpZ2h0PVwiMTVcIlxuICAgICAgICAgIGFyaWEtaGlkZGVuPVwidHJ1ZVwiXG4gICAgICAgICAgZmlsbD1cIm5vbmVcIlxuICAgICAgICAgIHN0cm9rZT1cImN1cnJlbnRDb2xvclwiXG4gICAgICAgICAgc3Ryb2tlLXdpZHRoPVwiMS40XCJcbiAgICAgICAgICBzdHJva2UtbGluZWNhcD1cInJvdW5kXCJcbiAgICAgICAgICBzdHJva2UtbGluZWpvaW49XCJyb3VuZFwiXG4gICAgICAgID5cbiAgICAgICAgICA8cGF0aCBkPVwiTTIuNzUgNC41aDEwLjVcIiAvPlxuICAgICAgICAgIDxwYXRoIGQ9XCJNNS43NSA0LjVWMy40YzAtLjUuNC0uOS45LS45aDIuN2MuNSAwIC45LjQuOS45djEuMVwiIC8+XG4gICAgICAgICAgPHBhdGggZD1cIk00LjQgNC41bC41IDcuOWMuMDUuNjQuNTcgMS4xIDEuMiAxLjFoMy44Yy42MyAwIDEuMTUtLjQ2IDEuMi0xLjFsLjUtNy45XCIgLz5cbiAgICAgICAgICA8cGF0aCBkPVwiTTYuNyA3LjJ2My45TTkuMyA3LjJ2My45XCIgLz5cbiAgICAgICAgPC9zdmc+XG4gICAgICA8L2J1dHRvbj5cbiAgICA8L2Rpdj5cblxuICAgIDxkaXZcbiAgICAgIHJlZj1cImNvbnRhaW5lclJlZlwiXG4gICAgICBjbGFzcz1cImNoYXJ0LWNvbnRhaW5lclwiXG4gICAgICA6Y2xhc3M9XCJ7ICdyZWN0LW1vZGUnOiBkcmF3aW5nVG9vbEFjdGl2ZSB9XCJcbiAgICAgIEBjbGljaz1cIm9uQ2hhcnRDbGlja1wiXG4gICAgLz5cblxuICAgIDwhLS0gRGVtbyBwb3NpdGlvbnMgLyBoaXN0b3J5IC8gc3RhdHMgcGFuZWwgKHVuZGVyIHRoZSBjaGFydCkgLS0+XG4gICAgPGRpdiB2LWlmPVwiZGVtby5hY3RpdmVcIiBjbGFzcz1cImRlbW8tYm90dG9tXCI+XG4gICAgICA8ZGl2IGNsYXNzPVwiZGVtby1ib3R0b20taGVhZFwiPlxuICAgICAgICA8c3BhbiBjbGFzcz1cImRlbW8tYmFkZ2VcIj5ERU1PPC9zcGFuPlxuICAgICAgICA8c3BhbiBjbGFzcz1cImRlbW8tc3RhdFwiPkJhbGFuY2UgPGI+e3sgZm10TW9uZXkoZGVtby5iYWxhbmNlKSB9fTwvYj48L3NwYW4+XG4gICAgICAgIDxzcGFuIGNsYXNzPVwiZGVtby1zdGF0XCI+RXF1aXR5IDxiPnt7IGZtdE1vbmV5KGRlbW8uZXF1aXR5KSB9fTwvYj48L3NwYW4+XG4gICAgICAgIDxzcGFuIGNsYXNzPVwiZGVtby1zdGF0XCI+T3BlbiBQL0wgPGIgOmNsYXNzPVwicG5sQ2xhc3MoZGVtby51bnJlYWxpemVkKVwiPnt7IGZtdE1vbmV5KGRlbW8udW5yZWFsaXplZCkgfX08L2I+PC9zcGFuPlxuICAgICAgICA8c3BhbiBjbGFzcz1cImRlbW8tZmxleFwiIC8+XG4gICAgICAgIDxidXR0b24gY2xhc3M9XCJkZW1vLXJlc2V0XCIgdGl0bGU9XCJSZXNldCBkZW1vIGFjY291bnQgdG8gJDEwMCwwMDBcIiBAY2xpY2s9XCJkZW1vLnJlc2V0QWNjb3VudCgpXCI+UmVzZXQ8L2J1dHRvbj5cbiAgICAgIDwvZGl2PlxuICAgICAgPGRpdiBjbGFzcz1cImRlbW8tdGFic1wiPlxuICAgICAgICA8YnV0dG9uIGNsYXNzPVwiZGVtby10YWJcIiA6Y2xhc3M9XCJ7IGFjdGl2ZTogZGVtb1RhYiA9PT0gJ3Bvc2l0aW9ucycgfVwiIEBjbGljaz1cImRlbW9UYWIgPSAncG9zaXRpb25zJ1wiPlBvc2l0aW9ucyAoe3sgZGVtby5vcGVuUG9zaXRpb25zLmxlbmd0aCArIHBlbmRpbmdPcmRlcnMubGVuZ3RoIH19KTwvYnV0dG9uPlxuICAgICAgICA8YnV0dG9uIGNsYXNzPVwiZGVtby10YWJcIiA6Y2xhc3M9XCJ7IGFjdGl2ZTogZGVtb1RhYiA9PT0gJ2hpc3RvcnknIH1cIiBAY2xpY2s9XCJkZW1vVGFiID0gJ2hpc3RvcnknXCI+SGlzdG9yeSAoe3sgZGVtby5jbG9zZWRQb3NpdGlvbnMubGVuZ3RoIH19KTwvYnV0dG9uPlxuICAgICAgICA8YnV0dG9uIGNsYXNzPVwiZGVtby10YWJcIiA6Y2xhc3M9XCJ7IGFjdGl2ZTogZGVtb1RhYiA9PT0gJ3N0YXRzJyB9XCIgQGNsaWNrPVwiZGVtb1RhYiA9ICdzdGF0cydcIj5TdGF0czwvYnV0dG9uPlxuICAgICAgICA8c3BhbiBjbGFzcz1cImRlbW8tZmxleFwiIC8+XG4gICAgICAgIDx0ZW1wbGF0ZSB2LWlmPVwiZGVtb1RhYiA9PT0gJ3N0YXRzJ1wiPlxuICAgICAgICAgIDxidXR0b24gdi1mb3I9XCJwIGluIFsnZGF5JywgJ3dlZWsnLCAnbW9udGgnLCAnYWxsJ11cIiA6a2V5PVwicFwiIGNsYXNzPVwiZGVtby1wZXJpb2RcIiA6Y2xhc3M9XCJ7IGFjdGl2ZTogZGVtb1BlcmlvZCA9PT0gcCB9XCIgQGNsaWNrPVwiZGVtb1BlcmlvZCA9IHAgYXMgYW55XCI+e3sgcCA9PT0gJ2RheScgPyAnRGF5JyA6IHAgPT09ICd3ZWVrJyA/ICdXZWVrJyA6IHAgPT09ICdtb250aCcgPyAnTW9udGgnIDogJ0FsbCcgfX08L2J1dHRvbj5cbiAgICAgICAgPC90ZW1wbGF0ZT5cbiAgICAgIDwvZGl2PlxuICAgICAgPGRpdiB2LWlmPVwiZGVtb1RhYiA9PT0gJ3Bvc2l0aW9ucydcIiBjbGFzcz1cImRlbW8tdGFibGVcIj5cbiAgICAgICAgPGRpdiB2LWlmPVwiIWRlbW8ub3BlblBvc2l0aW9ucy5sZW5ndGggJiYgIXBlbmRpbmdPcmRlcnMubGVuZ3RoXCIgY2xhc3M9XCJkZW1vLWVtcHR5XCI+Tm8gb3BlbiBwb3NpdGlvbnMg4oCUIHBsYWNlIGEgdHJhZGUgZnJvbSB0aGUgdG9vbGJhciBhYm92ZSB0aGUgY2hhcnQuPC9kaXY+XG4gICAgICAgIDx0YWJsZSB2LWlmPVwiZGVtby5vcGVuUG9zaXRpb25zLmxlbmd0aFwiPlxuICAgICAgICAgIDx0aGVhZD48dHI+PHRoPlN5bWJvbDwvdGg+PHRoPlNpZGU8L3RoPjx0aD5Mb3Q8L3RoPjx0aD5FbnRyeTwvdGg+PHRoPlNMPC90aD48dGg+VFA8L3RoPjx0aD5QL0wgJDwvdGg+PHRoPlAvTCAlPC90aD48dGg+PC90aD48L3RyPjwvdGhlYWQ+XG4gICAgICAgICAgPHRib2R5PlxuICAgICAgICAgICAgPHRyIHYtZm9yPVwicCBpbiBkZW1vLm9wZW5Qb3NpdGlvbnNcIiA6a2V5PVwicC5pZFwiPlxuICAgICAgICAgICAgICA8dGQ+e3sgcC5zeW1ib2wucmVwbGFjZSgnXycsICcvJykgfX08L3RkPlxuICAgICAgICAgICAgICA8dGQgOmNsYXNzPVwicC5kaXJlY3Rpb24gPT09ICdsb25nJyA/ICdwb3MnIDogJ25lZydcIj57eyBwLmRpcmVjdGlvbiA9PT0gJ2xvbmcnID8gJ0xPTkcnIDogJ1NIT1JUJyB9fTwvdGQ+XG4gICAgICAgICAgICAgIDx0ZD57eyBwLmxvdCB9fTwvdGQ+XG4gICAgICAgICAgICAgIDx0ZD57eyBwLmVudHJ5IH19PC90ZD5cbiAgICAgICAgICAgICAgPHRkPnt7IHAuc2wgPz8gJy0nIH19PC90ZD5cbiAgICAgICAgICAgICAgPHRkPnt7IHAudHAgPz8gJy0nIH19PC90ZD5cbiAgICAgICAgICAgICAgPHRkIDpjbGFzcz1cInBubENsYXNzKGRlbW8ucG5sRm9yKHAsIHAubGFzdFByaWNlID8/IHAuZW50cnkpKVwiPnt7IGZtdE1vbmV5KGRlbW8ucG5sRm9yKHAsIHAubGFzdFByaWNlID8/IHAuZW50cnkpKSB9fTwvdGQ+XG4gICAgICAgICAgICAgIDx0ZCA6Y2xhc3M9XCJwbmxDbGFzcygoKHAubGFzdFByaWNlID8/IHAuZW50cnkpIC0gcC5lbnRyeSkgKiAocC5kaXJlY3Rpb24gPT09ICdsb25nJyA/IDEgOiAtMSkpXCI+e3sgKCgocC5sYXN0UHJpY2UgPz8gcC5lbnRyeSkgLSBwLmVudHJ5KSAqIChwLmRpcmVjdGlvbiA9PT0gJ2xvbmcnID8gMSA6IC0xKSAqIDEwMCAvIHAuZW50cnkpLnRvRml4ZWQoMikgfX0lPC90ZD5cbiAgICAgICAgICAgICAgPHRkPjxidXR0b24gY2xhc3M9XCJkZW1vLWNsb3NlXCIgdGl0bGU9XCJDbG9zZSBwb3NpdGlvblwiIEBjbGljaz1cImRlbW8uY2xvc2VBdE1hcmtldChwLmlkKVwiPuKclTwvYnV0dG9uPjwvdGQ+XG4gICAgICAgICAgICA8L3RyPlxuICAgICAgICAgIDwvdGJvZHk+XG4gICAgICAgIDwvdGFibGU+XG4gICAgICAgIDx0YWJsZSB2LWlmPVwicGVuZGluZ09yZGVycy5sZW5ndGhcIj5cbiAgICAgICAgICA8dGhlYWQ+PHRyPjx0aCBjb2xzcGFuPVwiNlwiIHN0eWxlPVwidGV4dC1hbGlnbjpsZWZ0XCI+UGVuZGluZyBvcmRlcnM8L3RoPjx0aD48L3RoPjx0aD48L3RoPjx0aD48L3RoPjwvdHI+PC90aGVhZD5cbiAgICAgICAgICA8dGJvZHk+XG4gICAgICAgICAgICA8dHIgdi1mb3I9XCJwIGluIHBlbmRpbmdPcmRlcnNcIiA6a2V5PVwicC5pZFwiPlxuICAgICAgICAgICAgICA8dGQ+e3sgcC5zeW1ib2wucmVwbGFjZSgnXycsICcvJykgfX08L3RkPlxuICAgICAgICAgICAgICA8dGQgOmNsYXNzPVwicC5kaXJlY3Rpb24gPT09ICdsb25nJyA/ICdwb3MnIDogJ25lZydcIj57eyBwLmRpcmVjdGlvbiA9PT0gJ2xvbmcnID8gJ0JVWSBMSU0nIDogJ1NFTEwgTElNJyB9fTwvdGQ+XG4gICAgICAgICAgICAgIDx0ZD57eyBwLmxvdCB9fTwvdGQ+XG4gICAgICAgICAgICAgIDx0ZD57eyBwLmVudHJ5IH19PC90ZD5cbiAgICAgICAgICAgICAgPHRkPnt7IHAuc2wgPz8gJy0nIH19PC90ZD5cbiAgICAgICAgICAgICAgPHRkPnt7IHAudHAgPz8gJy0nIH19PC90ZD5cbiAgICAgICAgICAgICAgPHRkPjwvdGQ+XG4gICAgICAgICAgICAgIDx0ZD48L3RkPlxuICAgICAgICAgICAgICA8dGQ+PGJ1dHRvbiBjbGFzcz1cImRlbW8tY2xvc2VcIiB0aXRsZT1cIkRlbGV0ZSBwZW5kaW5nIG9yZGVyXCIgQGNsaWNrPVwiZGVtby5yZW1vdmVQZW5kaW5nKHAuaWQpXCI+4pyVPC9idXR0b24+PC90ZD5cbiAgICAgICAgICAgIDwvdHI+XG4gICAgICAgICAgPC90Ym9keT5cbiAgICAgICAgPC90YWJsZT5cbiAgICAgIDwvZGl2PlxuICAgICAgPGRpdiB2LWVsc2UtaWY9XCJkZW1vVGFiID09PSAnaGlzdG9yeSdcIiBjbGFzcz1cImRlbW8tdGFibGVcIj5cbiAgICAgICAgPGRpdiB2LWlmPVwiIWRlbW8uY2xvc2VkUG9zaXRpb25zLmxlbmd0aFwiIGNsYXNzPVwiZGVtby1lbXB0eVwiPk5vIGNsb3NlZCB0cmFkZXMgeWV0LjwvZGl2PlxuICAgICAgICA8dGFibGUgdi1lbHNlPlxuICAgICAgICAgIDx0aGVhZD48dHI+PHRoPlN5bWJvbDwvdGg+PHRoPlNpZGU8L3RoPjx0aD5Mb3Q8L3RoPjx0aD5FbnRyeTwvdGg+PHRoPkV4aXQ8L3RoPjx0aD5SZWFzb248L3RoPjx0aD5QL0wgJDwvdGg+PHRoPlAvTCAlPC90aD48dGg+Q2xvc2VkPC90aD48L3RyPjwvdGhlYWQ+XG4gICAgICAgICAgPHRib2R5PlxuICAgICAgICAgICAgPHRyIHYtZm9yPVwicCBpbiBbLi4uZGVtby5jbG9zZWRQb3NpdGlvbnNdLnJldmVyc2UoKVwiIDprZXk9XCJwLmlkXCI+XG4gICAgICAgICAgICAgIDx0ZD57eyBwLnN5bWJvbC5yZXBsYWNlKCdfJywgJy8nKSB9fTwvdGQ+XG4gICAgICAgICAgICAgIDx0ZCA6Y2xhc3M9XCJwLmRpcmVjdGlvbiA9PT0gJ2xvbmcnID8gJ3BvcycgOiAnbmVnJ1wiPnt7IHAuZGlyZWN0aW9uID09PSAnbG9uZycgPyAnTE9ORycgOiAnU0hPUlQnIH19PC90ZD5cbiAgICAgICAgICAgICAgPHRkPnt7IHAubG90IH19PC90ZD5cbiAgICAgICAgICAgICAgPHRkPnt7IHAuZW50cnkgfX08L3RkPlxuICAgICAgICAgICAgICA8dGQ+e3sgcC5jbG9zZVByaWNlIH19PC90ZD5cbiAgICAgICAgICAgICAgPHRkPnt7IChwLmNsb3NlUmVhc29uID8/ICcnKS50b1VwcGVyQ2FzZSgpIH19PC90ZD5cbiAgICAgICAgICAgICAgPHRkIDpjbGFzcz1cInBubENsYXNzKHAucG5sKVwiPnt7IGZtdE1vbmV5KHAucG5sID8/IDApIH19PC90ZD5cbiAgICAgICAgICAgICAgPHRkIDpjbGFzcz1cInBubENsYXNzKHAucG5sUGN0KVwiPnt7IChwLnBubFBjdCA/PyAwKSA+PSAwID8gJysnIDogJycgfX17eyAocC5wbmxQY3QgPz8gMCkudG9GaXhlZCgyKSB9fSU8L3RkPlxuICAgICAgICAgICAgICA8dGQ+e3sgcC5jbG9zZVRpbWUgPyBuZXcgRGF0ZShwLmNsb3NlVGltZSAqIDEwMDApLnRvTG9jYWxlU3RyaW5nKCdlbi1HQicsIHsgZGF5OiAnMi1kaWdpdCcsIG1vbnRoOiAnc2hvcnQnLCBob3VyOiAnMi1kaWdpdCcsIG1pbnV0ZTogJzItZGlnaXQnIH0pIDogJycgfX08L3RkPlxuICAgICAgICAgICAgPC90cj5cbiAgICAgICAgICA8L3Rib2R5PlxuICAgICAgICA8L3RhYmxlPlxuICAgICAgPC9kaXY+XG4gICAgICA8ZGl2IHYtZWxzZSBjbGFzcz1cImRlbW8tdGFibGVcIj5cbiAgICAgICAgPGRpdiBjbGFzcz1cImRlbW8tc3RhdHNcIj5cbiAgICAgICAgICA8ZGl2IGNsYXNzPVwiZGVtby1zdGF0LWNhcmRcIj48c3Bhbj5UcmFkZXM8L3NwYW4+PGI+e3sgZGVtb1N1bW1hcnkudHJhZGVzIH19PC9iPjwvZGl2PlxuICAgICAgICAgIDxkaXYgY2xhc3M9XCJkZW1vLXN0YXQtY2FyZFwiPjxzcGFuPldpbnM8L3NwYW4+PGI+e3sgZGVtb1N1bW1hcnkud2lucyB9fTwvYj48L2Rpdj5cbiAgICAgICAgICA8ZGl2IGNsYXNzPVwiZGVtby1zdGF0LWNhcmRcIj48c3Bhbj5XaW5yYXRlPC9zcGFuPjxiPnt7IGRlbW9TdW1tYXJ5LndpbnJhdGUgfX0lPC9iPjwvZGl2PlxuICAgICAgICAgIDxkaXYgY2xhc3M9XCJkZW1vLXN0YXQtY2FyZFwiPjxzcGFuPlByb2ZpdCBmYWN0b3I8L3NwYW4+PGI+e3sgZGVtb1N1bW1hcnkucHJvZml0RmFjdG9yID8/ICctJyB9fTwvYj48L2Rpdj5cbiAgICAgICAgICA8ZGl2IGNsYXNzPVwiZGVtby1zdGF0LWNhcmRcIj48c3BhbiA6Y2xhc3M9XCJwbmxDbGFzcyhkZW1vU3VtbWFyeS5wcm9maXQpXCI+UC9MICU8L3NwYW4+PGIgOmNsYXNzPVwicG5sQ2xhc3MoZGVtb1N1bW1hcnkucHJvZml0KVwiPnt7IGRlbW9TdW1tYXJ5LnByb2ZpdFBjdCA+PSAwID8gJysnIDogJycgfX17eyBkZW1vU3VtbWFyeS5wcm9maXRQY3QudG9GaXhlZCgyKSB9fSU8L2I+PC9kaXY+XG4gICAgICAgICAgPGRpdiBjbGFzcz1cImRlbW8tc3RhdC1jYXJkXCI+PHNwYW4+R3Jvc3MgcHJvZml0PC9zcGFuPjxiIGNsYXNzPVwicG9zXCI+e3sgZm10TW9uZXkoZGVtb1N1bW1hcnkuZ3Jvc3NQcm9maXQpIH19PC9iPjwvZGl2PlxuICAgICAgICAgIDxkaXYgY2xhc3M9XCJkZW1vLXN0YXQtY2FyZFwiPjxzcGFuPkdyb3NzIGxvc3M8L3NwYW4+PGIgY2xhc3M9XCJuZWdcIj57eyBmbXRNb25leShkZW1vU3VtbWFyeS5ncm9zc0xvc3MpIH19PC9iPjwvZGl2PlxuICAgICAgICAgIDxkaXYgY2xhc3M9XCJkZW1vLXN0YXQtY2FyZFwiPjxzcGFuPlN5bWJvbHM8L3NwYW4+PGI+e3sgZGVtby50cmFkZWRTeW1ib2xzLmxlbmd0aCB9fTwvYj48L2Rpdj5cbiAgICAgICAgPC9kaXY+XG4gICAgICA8L2Rpdj5cbiAgICA8L2Rpdj5cblxuICAgIDwhLS0gQ2hhcnQgc2V0dGluZ3M6IFRyYWRpbmdWaWV3LXN0eWxlIGdlYXIgaW4gdGhlIGJvdHRvbS1yaWdodCBjb3JuZXIgK1xuICAgICAgICAgYSBjZW50ZXJlZCBwYW5lbCBmb3IgYmFja2dyb3VuZCAoc29saWQvZ3JhZGllbnQpIGFuZCBjYW5kbGUgY29sb3JzIC0tPlxuICAgIDxidXR0b25cbiAgICAgIGNsYXNzPVwiY2hhcnQtc2V0dGluZ3MtYnRuXCJcbiAgICAgIHR5cGU9XCJidXR0b25cIlxuICAgICAgdGl0bGU9XCJDaGFydCBzZXR0aW5nc1wiXG4gICAgICBhcmlhLWxhYmVsPVwiQ2hhcnQgc2V0dGluZ3NcIlxuICAgICAgOnN0eWxlPVwieyByaWdodDogJzBweCcsIGJvdHRvbTogJzBweCcsIHdpZHRoOiBheGlzUmlnaHRXICsgJ3B4JywgaGVpZ2h0OiBheGlzQm90dG9tSCArICdweCcgfVwiXG4gICAgICBAY2xpY2s9XCJjaGFydFNldHRpbmdzT3BlbiA9ICFjaGFydFNldHRpbmdzT3BlblwiXG4gICAgPlxuICAgICAgPHN2ZyB2aWV3Qm94PVwiMCAwIDI0IDI0XCIgd2lkdGg9XCIxNVwiIGhlaWdodD1cIjE1XCIgZmlsbD1cIm5vbmVcIiBzdHJva2U9XCJjdXJyZW50Q29sb3JcIiBzdHJva2Utd2lkdGg9XCIxLjlcIiBzdHJva2UtbGluZWNhcD1cInJvdW5kXCIgc3Ryb2tlLWxpbmVqb2luPVwicm91bmRcIiBhcmlhLWhpZGRlbj1cInRydWVcIj5cbiAgICAgICAgPGNpcmNsZSBjeD1cIjEyXCIgY3k9XCIxMlwiIHI9XCIzXCIgLz5cbiAgICAgICAgPHBhdGggZD1cIk0xOS40IDE1YTEuNyAxLjcgMCAwIDAgLjM0IDEuODdsLjA2LjA2YTIgMiAwIDEgMS0yLjgzIDIuODNsLS4wNi0uMDZhMS43IDEuNyAwIDAgMC0xLjg3LS4zNCAxLjcgMS43IDAgMCAwLTEgMS41NVYyMWEyIDIgMCAxIDEtNCAwdi0uMDlhMS43IDEuNyAwIDAgMC0xLTEuNTUgMS43IDEuNyAwIDAgMC0xLjg3LjM0bC0uMDYuMDZhMiAyIDAgMSAxLTIuODMtMi44M2wuMDYtLjA2YTEuNyAxLjcgMCAwIDAgLjM0LTEuODcgMS43IDEuNyAwIDAgMC0xLjU1LTFIM2EyIDIgMCAxIDEgMC00aC4wOWExLjcgMS43IDAgMCAwIDEuNTUtMSAxLjcgMS43IDAgMCAwLS4zNC0xLjg3bC0uMDYtLjA2YTIgMiAwIDEgMSAyLjgzLTIuODNsLjA2LjA2YTEuNyAxLjcgMCAwIDAgMS44Ny4zNGgwYTEuNyAxLjcgMCAwIDAgMS0xLjU1VjNhMiAyIDAgMSAxIDQgMHYuMDlhMS43IDEuNyAwIDAgMCAxIDEuNTVoMGExLjcgMS43IDAgMCAwIDEuODctLjM0bC4wNi0uMDZhMiAyIDAgMSAxIDIuODMgMi44M2wtLjA2LjA2YTEuNyAxLjcgMCAwIDAtLjM0IDEuODd2MGExLjcgMS43IDAgMCAwIDEuNTUgMUgyMWEyIDIgMCAxIDEgMCA0aC0uMDlhMS43IDEuNyAwIDAgMC0xLjU1IDF6XCIgLz5cbiAgICAgIDwvc3ZnPlxuICAgIDwvYnV0dG9uPlxuICAgIDx0ZW1wbGF0ZSB2LWlmPVwiY2hhcnRTZXR0aW5nc09wZW5cIj5cbiAgICAgIDxkaXYgY2xhc3M9XCJjaGFydC1zZXR0aW5ncy1iYWNrZHJvcFwiIEBjbGljaz1cImNoYXJ0U2V0dGluZ3NPcGVuID0gZmFsc2VcIj48L2Rpdj5cbiAgICAgIDxkaXYgY2xhc3M9XCJjaGFydC1zZXR0aW5ncy1wYW5lbFwiIHJvbGU9XCJkaWFsb2dcIiBhcmlhLWxhYmVsPVwiQ2hhcnQgc2V0dGluZ3NcIj5cbiAgICAgICAgPGRpdiBjbGFzcz1cImNzLWhlYWRcIj5cbiAgICAgICAgICA8c3BhbiBjbGFzcz1cImNzLXRpdGxlXCI+Q2hhcnQgc2V0dGluZ3M8L3NwYW4+XG4gICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cImNzLWNsb3NlXCIgdHlwZT1cImJ1dHRvblwiIGFyaWEtbGFiZWw9XCJDbG9zZVwiIEBjbGljaz1cImNoYXJ0U2V0dGluZ3NPcGVuID0gZmFsc2VcIj7inJU8L2J1dHRvbj5cbiAgICAgICAgPC9kaXY+XG4gICAgICAgIDxkaXYgY2xhc3M9XCJjcy1zZWN0aW9uXCI+XG4gICAgICAgICAgPGRpdiBjbGFzcz1cImNzLWxhYmVsXCI+XG4gICAgICAgICAgICBCYWNrZ3JvdW5kXG4gICAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwiY3MtdGhlbWUtYnRuXCIgdHlwZT1cImJ1dHRvblwiIHRpdGxlPVwiRm9sbG93IHRoZW1lXCIgQGNsaWNrPVwicmVzZXRHcm91cCgnYmcnKVwiPuKfsiB0aGVtZTwvYnV0dG9uPlxuICAgICAgICAgIDwvZGl2PlxuICAgICAgICAgIDxkaXYgY2xhc3M9XCJjcy1yb3dcIj5cbiAgICAgICAgICAgIDxzcGFuIGNsYXNzPVwiY3MtY2FwXCI+VHlwZTwvc3Bhbj5cbiAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJjcy1tb2Rlc1wiPlxuICAgICAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwiY3MtbW9kZVwiIDpjbGFzcz1cInsgb246IGNoYXJ0U3R5bGUuYmdNb2RlID09PSAnc29saWQnIH1cIiB0eXBlPVwiYnV0dG9uXCIgQGNsaWNrPVwiY2hhcnRTdHlsZS5iZ01vZGUgPSAnc29saWQnXCI+U29saWQ8L2J1dHRvbj5cbiAgICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cImNzLW1vZGVcIiA6Y2xhc3M9XCJ7IG9uOiBjaGFydFN0eWxlLmJnTW9kZSA9PT0gJ2dyYWRpZW50JyB9XCIgdHlwZT1cImJ1dHRvblwiIEBjbGljaz1cImNoYXJ0U3R5bGUuYmdNb2RlID0gJ2dyYWRpZW50J1wiPkdyYWRpZW50PC9idXR0b24+XG4gICAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgICA8ZGl2IHYtaWY9XCJjaGFydFN0eWxlLmJnTW9kZSA9PT0gJ3NvbGlkJ1wiIGNsYXNzPVwiY3Mtcm93XCI+XG4gICAgICAgICAgICA8c3BhbiBjbGFzcz1cImNzLWNhcFwiPkNvbG9yPC9zcGFuPlxuICAgICAgICAgICAgPGlucHV0IHR5cGU9XCJjb2xvclwiIDp2YWx1ZT1cImVmZihjaGFydFN0eWxlLmJnU29saWQsIHRoZW1lQmdQYWlyKClbMF0pXCIgQGlucHV0PVwic2V0Q29sb3IoJ2JnU29saWQnLCAkZXZlbnQpXCIgYXJpYS1sYWJlbD1cIkJhY2tncm91bmQgY29sb3JcIiAvPlxuICAgICAgICAgIDwvZGl2PlxuICAgICAgICAgIDx0ZW1wbGF0ZSB2LWlmPVwiY2hhcnRTdHlsZS5iZ01vZGUgPT09ICdncmFkaWVudCdcIj5cbiAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJjcy1yb3dcIj5cbiAgICAgICAgICAgICAgPHNwYW4gY2xhc3M9XCJjcy1jYXBcIj5Ub3A8L3NwYW4+XG4gICAgICAgICAgICAgIDxpbnB1dCB0eXBlPVwiY29sb3JcIiA6dmFsdWU9XCJlZmYoY2hhcnRTdHlsZS5iZ1RvcCwgdGhlbWVCZ1BhaXIoKVswXSlcIiBAaW5wdXQ9XCJzZXRDb2xvcignYmdUb3AnLCAkZXZlbnQpXCIgYXJpYS1sYWJlbD1cIkdyYWRpZW50IHRvcCBjb2xvclwiIC8+XG4gICAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJjcy1yb3dcIj5cbiAgICAgICAgICAgICAgPHNwYW4gY2xhc3M9XCJjcy1jYXBcIj5Cb3R0b208L3NwYW4+XG4gICAgICAgICAgICAgIDxpbnB1dCB0eXBlPVwiY29sb3JcIiA6dmFsdWU9XCJlZmYoY2hhcnRTdHlsZS5iZ0JvdHRvbSwgdGhlbWVCZ1BhaXIoKVsxXSlcIiBAaW5wdXQ9XCJzZXRDb2xvcignYmdCb3R0b20nLCAkZXZlbnQpXCIgYXJpYS1sYWJlbD1cIkdyYWRpZW50IGJvdHRvbSBjb2xvclwiIC8+XG4gICAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJjcy1wcmV2aWV3XCIgOnN0eWxlPVwieyBiYWNrZ3JvdW5kOiBgbGluZWFyLWdyYWRpZW50KDE4MGRlZywgJHtlZmYoY2hhcnRTdHlsZS5iZ1RvcCwgdGhlbWVCZ1BhaXIoKVswXSl9IDAlLCAke2VmZihjaGFydFN0eWxlLmJnQm90dG9tLCB0aGVtZUJnUGFpcigpWzFdKX0gMTAwJSlgIH1cIj48L2Rpdj5cbiAgICAgICAgICA8L3RlbXBsYXRlPlxuICAgICAgICA8L2Rpdj5cbiAgICAgICAgPGRpdiBjbGFzcz1cImNzLXNlY3Rpb25cIj5cbiAgICAgICAgICA8ZGl2IGNsYXNzPVwiY3MtbGFiZWxcIj5cbiAgICAgICAgICAgIENhbmRsZXNcbiAgICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJjcy10aGVtZS1idG5cIiB0eXBlPVwiYnV0dG9uXCIgdGl0bGU9XCJGb2xsb3cgdGhlbWVcIiBAY2xpY2s9XCJyZXNldEdyb3VwKCdjYW5kbGVzJylcIj7in7IgdGhlbWU8L2J1dHRvbj5cbiAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgICA8ZGl2IGNsYXNzPVwiY3MtY2FuZGxlc1wiPlxuICAgICAgICAgICAgPGxhYmVsIGNsYXNzPVwiY3MtY2FuZGxlXCI+PGlucHV0IHR5cGU9XCJjb2xvclwiIDp2YWx1ZT1cImVmZihjaGFydFN0eWxlLnVwLCBERUZBVUxUX0NBTkRMRVMudXApXCIgQGlucHV0PVwic2V0Q29sb3IoJ3VwJywgJGV2ZW50KVwiIC8+PHNwYW4+Qm9keSDilrI8L3NwYW4+PC9sYWJlbD5cbiAgICAgICAgICAgIDxsYWJlbCBjbGFzcz1cImNzLWNhbmRsZVwiPjxpbnB1dCB0eXBlPVwiY29sb3JcIiA6dmFsdWU9XCJlZmYoY2hhcnRTdHlsZS5kb3duLCBERUZBVUxUX0NBTkRMRVMuZG93bilcIiBAaW5wdXQ9XCJzZXRDb2xvcignZG93bicsICRldmVudClcIiAvPjxzcGFuPkJvZHkg4pa8PC9zcGFuPjwvbGFiZWw+XG4gICAgICAgICAgICA8bGFiZWwgY2xhc3M9XCJjcy1jYW5kbGVcIj48aW5wdXQgdHlwZT1cImNvbG9yXCIgOnZhbHVlPVwiZWZmKGNoYXJ0U3R5bGUuYm9yZGVyVXAsIERFRkFVTFRfQ0FORExFUy5ib3JkZXJVcClcIiBAaW5wdXQ9XCJzZXRDb2xvcignYm9yZGVyVXAnLCAkZXZlbnQpXCIgLz48c3Bhbj5Cb3JkZXIg4payPC9zcGFuPjwvbGFiZWw+XG4gICAgICAgICAgICA8bGFiZWwgY2xhc3M9XCJjcy1jYW5kbGVcIj48aW5wdXQgdHlwZT1cImNvbG9yXCIgOnZhbHVlPVwiZWZmKGNoYXJ0U3R5bGUuYm9yZGVyRG93biwgREVGQVVMVF9DQU5ETEVTLmJvcmRlckRvd24pXCIgQGlucHV0PVwic2V0Q29sb3IoJ2JvcmRlckRvd24nLCAkZXZlbnQpXCIgLz48c3Bhbj5Cb3JkZXIg4pa8PC9zcGFuPjwvbGFiZWw+XG4gICAgICAgICAgICA8bGFiZWwgY2xhc3M9XCJjcy1jYW5kbGVcIj48aW5wdXQgdHlwZT1cImNvbG9yXCIgOnZhbHVlPVwiZWZmKGNoYXJ0U3R5bGUud2lja1VwLCBERUZBVUxUX0NBTkRMRVMud2lja1VwKVwiIEBpbnB1dD1cInNldENvbG9yKCd3aWNrVXAnLCAkZXZlbnQpXCIgLz48c3Bhbj5XaWNrIOKWsjwvc3Bhbj48L2xhYmVsPlxuICAgICAgICAgICAgPGxhYmVsIGNsYXNzPVwiY3MtY2FuZGxlXCI+PGlucHV0IHR5cGU9XCJjb2xvclwiIDp2YWx1ZT1cImVmZihjaGFydFN0eWxlLndpY2tEb3duLCBERUZBVUxUX0NBTkRMRVMud2lja0Rvd24pXCIgQGlucHV0PVwic2V0Q29sb3IoJ3dpY2tEb3duJywgJGV2ZW50KVwiIC8+PHNwYW4+V2ljayDilrw8L3NwYW4+PC9sYWJlbD5cbiAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgPC9kaXY+XG4gICAgICAgIDxkaXYgY2xhc3M9XCJjcy1zZWN0aW9uXCI+XG4gICAgICAgICAgPGRpdiBjbGFzcz1cImNzLWxhYmVsXCI+XG4gICAgICAgICAgICBQcmljZSAmIHRpbWUgc2NhbGVcbiAgICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJjcy10aGVtZS1idG5cIiB0eXBlPVwiYnV0dG9uXCIgdGl0bGU9XCJGb2xsb3cgdGhlbWVcIiBAY2xpY2s9XCJyZXNldEdyb3VwKCdzY2FsZXMnKVwiPuKfsiB0aGVtZTwvYnV0dG9uPlxuICAgICAgICAgIDwvZGl2PlxuICAgICAgICAgIDxkaXYgY2xhc3M9XCJjcy1yb3dcIj5cbiAgICAgICAgICAgIDxzcGFuIGNsYXNzPVwiY3MtY2FwXCI+VGV4dDwvc3Bhbj5cbiAgICAgICAgICAgIDxpbnB1dCB0eXBlPVwiY29sb3JcIiA6dmFsdWU9XCJlZmYoY2hhcnRTdHlsZS5heGlzVGV4dCwgdGhlbWVBeGlzUGFpcigpWzBdKVwiIEBpbnB1dD1cInNldENvbG9yKCdheGlzVGV4dCcsICRldmVudClcIiBhcmlhLWxhYmVsPVwiQXhpcyB0ZXh0IGNvbG9yXCIgLz5cbiAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgICA8ZGl2IGNsYXNzPVwiY3Mtcm93XCI+XG4gICAgICAgICAgICA8c3BhbiBjbGFzcz1cImNzLWNhcFwiPkJvcmRlcjwvc3Bhbj5cbiAgICAgICAgICAgIDxpbnB1dCB0eXBlPVwiY29sb3JcIiA6dmFsdWU9XCJlZmYoY2hhcnRTdHlsZS5heGlzQm9yZGVyLCB0aGVtZUF4aXNQYWlyKClbMV0pXCIgQGlucHV0PVwic2V0Q29sb3IoJ2F4aXNCb3JkZXInLCAkZXZlbnQpXCIgYXJpYS1sYWJlbD1cIkF4aXMgYm9yZGVyIGNvbG9yXCIgLz5cbiAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgPC9kaXY+XG4gICAgICAgIDxkaXYgY2xhc3M9XCJjcy1zZWN0aW9uXCI+XG4gICAgICAgICAgPGRpdiBjbGFzcz1cImNzLWxhYmVsXCI+XG4gICAgICAgICAgICBDcm9zc2hhaXJcbiAgICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJjcy10aGVtZS1idG5cIiB0eXBlPVwiYnV0dG9uXCIgdGl0bGU9XCJGb2xsb3cgdGhlbWVcIiBAY2xpY2s9XCJyZXNldEdyb3VwKCdjcm9zcycpXCI+4p+yIHRoZW1lPC9idXR0b24+XG4gICAgICAgICAgPC9kaXY+XG4gICAgICAgICAgPGRpdiBjbGFzcz1cImNzLXJvd1wiPlxuICAgICAgICAgICAgPHNwYW4gY2xhc3M9XCJjcy1jYXBcIj5WZXJ0aWNhbDwvc3Bhbj5cbiAgICAgICAgICAgIDxpbnB1dCB0eXBlPVwiY29sb3JcIiA6dmFsdWU9XCJlZmYoY2hhcnRTdHlsZS5jcm9zc1ZlcnQsICcjNzU4Njk2JylcIiBAaW5wdXQ9XCJzZXRDb2xvcignY3Jvc3NWZXJ0JywgJGV2ZW50KVwiIGFyaWEtbGFiZWw9XCJDcm9zc2hhaXIgdmVydGljYWwgY29sb3JcIiAvPlxuICAgICAgICAgIDwvZGl2PlxuICAgICAgICAgIDxkaXYgY2xhc3M9XCJjcy1yb3dcIj5cbiAgICAgICAgICAgIDxzcGFuIGNsYXNzPVwiY3MtY2FwXCI+SG9yaXpvbnRhbDwvc3Bhbj5cbiAgICAgICAgICAgIDxpbnB1dCB0eXBlPVwiY29sb3JcIiA6dmFsdWU9XCJlZmYoY2hhcnRTdHlsZS5jcm9zc0hvcnosICcjNzU4Njk2JylcIiBAaW5wdXQ9XCJzZXRDb2xvcignY3Jvc3NIb3J6JywgJGV2ZW50KVwiIGFyaWEtbGFiZWw9XCJDcm9zc2hhaXIgaG9yaXpvbnRhbCBjb2xvclwiIC8+XG4gICAgICAgICAgPC9kaXY+XG4gICAgICAgIDwvZGl2PlxuICAgICAgICA8ZGl2IGNsYXNzPVwiY3MtdGVtcGxhdGVzXCI+XG4gICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cImNzLXJlc2V0XCIgdHlwZT1cImJ1dHRvblwiIHRpdGxlPVwiQXBwbHkgdGhlIHRoZW1lIGRlZmF1bHRzXCIgQGNsaWNrPVwicmVzZXRDaGFydFN0eWxlKCk7IHNlbGVjdGVkVHBsID0gJydcIj5EZWZhdWx0czwvYnV0dG9uPlxuICAgICAgICAgIDxzZWxlY3Qgdi1pZj1cInRlbXBsYXRlcy5sZW5ndGhcIiBjbGFzcz1cImNzLXNlbGVjdFwiIHYtbW9kZWw9XCJzZWxlY3RlZFRwbFwiIEBjaGFuZ2U9XCJhcHBseVRlbXBsYXRlXCIgYXJpYS1sYWJlbD1cIlNhdmVkIHRlbXBsYXRlc1wiPlxuICAgICAgICAgICAgPG9wdGlvbiB2YWx1ZT1cIlwiIGRpc2FibGVkPlRlbXBsYXRlc+KApjwvb3B0aW9uPlxuICAgICAgICAgICAgPG9wdGlvbiB2LWZvcj1cInQgaW4gdGVtcGxhdGVzXCIgOmtleT1cInQubmFtZVwiIDp2YWx1ZT1cInQubmFtZVwiPnt7IHQubmFtZSB9fTwvb3B0aW9uPlxuICAgICAgICAgIDwvc2VsZWN0PlxuICAgICAgICAgIDxidXR0b24gdi1pZj1cInRlbXBsYXRlcy5sZW5ndGggJiYgc2VsZWN0ZWRUcGxcIiBjbGFzcz1cImNzLWRlbFwiIHR5cGU9XCJidXR0b25cIiB0aXRsZT1cIkRlbGV0ZSB0ZW1wbGF0ZVwiIEBjbGljaz1cImRlbGV0ZVRlbXBsYXRlXCI+8J+XkTwvYnV0dG9uPlxuICAgICAgICAgIDxpbnB1dCBjbGFzcz1cImNzLXRwbC1uYW1lXCIgdi1tb2RlbD1cInRwbE5hbWVcIiBtYXhsZW5ndGg9XCIyNFwiIHBsYWNlaG9sZGVyPVwiVGVtcGxhdGUgbmFtZVwiIGFyaWEtbGFiZWw9XCJUZW1wbGF0ZSBuYW1lXCIgLz5cbiAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwiY3Mtc2F2ZVwiIHR5cGU9XCJidXR0b25cIiB0aXRsZT1cIlNhdmUgY3VycmVudCBjb2xvcnMgYXMgYSB0ZW1wbGF0ZVwiIEBjbGljaz1cInNhdmVUZW1wbGF0ZVwiPlNhdmUgYXM8L2J1dHRvbj5cbiAgICAgICAgPC9kaXY+XG4gICAgICA8L2Rpdj5cbiAgICA8L3RlbXBsYXRlPlxuXG4gIDwvZGl2PlxuPC90ZW1wbGF0ZT5cblxuPHN0eWxlIHNjb3BlZD5cbi8qIENoYXJ0IHNldHRpbmdzOiBjb3JuZXIgZ2VhciArIGNlbnRlcmVkIHBhbmVsIChUcmFkaW5nVmlldy1zdHlsZSkgKi9cbi5jaGFydC1zZXR0aW5ncy1idG4ge1xuICBwb3NpdGlvbjogYWJzb2x1dGU7XG4gIHotaW5kZXg6IDQwO1xuICBkaXNwbGF5OiBncmlkO1xuICBwbGFjZS1pdGVtczogY2VudGVyO1xuICBib3JkZXI6IG5vbmU7XG4gIGJvcmRlci1sZWZ0OiAxcHggc29saWQgdmFyKC0tYm9yZGVyKTtcbiAgYm9yZGVyLXRvcDogMXB4IHNvbGlkIHZhcigtLWJvcmRlcik7XG4gIGJhY2tncm91bmQ6IHRyYW5zcGFyZW50O1xuICBjb2xvcjogdmFyKC0tdGV4dC1tdXRlZCk7XG4gIGN1cnNvcjogcG9pbnRlcjtcbiAgdHJhbnNpdGlvbjogYWxsIDE2MG1zO1xuICBwYWRkaW5nOiAwO1xufVxuLmNoYXJ0LXNldHRpbmdzLWJ0bjpob3ZlciB7XG4gIGNvbG9yOiB2YXIoLS1hY2NlbnQpO1xuICBib3JkZXItY29sb3I6IHZhcigtLWFjY2VudCk7XG59XG4uY2hhcnQtc2V0dGluZ3MtYmFja2Ryb3Age1xuICBwb3NpdGlvbjogYWJzb2x1dGU7XG4gIGluc2V0OiAwO1xuICB6LWluZGV4OiA2MDtcbiAgYmFja2dyb3VuZDogcmdiYSgwLCAwLCAwLCAwLjM1KTtcbn1cbi5jaGFydC1zZXR0aW5ncy1wYW5lbCB7XG4gIHBvc2l0aW9uOiBhYnNvbHV0ZTtcbiAgei1pbmRleDogNjE7XG4gIGxlZnQ6IDUwJTtcbiAgdG9wOiA0NSU7XG4gIHRyYW5zZm9ybTogdHJhbnNsYXRlKC01MCUsIC01MCUpO1xuICB3aWR0aDogbWluKDM2MHB4LCBjYWxjKDEwMCUgLSAzMnB4KSk7XG4gIHBhZGRpbmc6IDEycHggMTRweDtcbiAgYm9yZGVyLXJhZGl1czogMTJweDtcbiAgYm9yZGVyOiAxcHggc29saWQgdmFyKC0tZ2xhc3MtYm9yZGVyKTtcbiAgYmFja2dyb3VuZDogdmFyKC0tYmctcGFuZWwsICMxNzFiMjYpO1xuICBiYWNrZHJvcC1maWx0ZXI6IGJsdXIoMjJweCkgc2F0dXJhdGUoMS40KTtcbiAgLXdlYmtpdC1iYWNrZHJvcC1maWx0ZXI6IGJsdXIoMjJweCkgc2F0dXJhdGUoMS40KTtcbiAgYm94LXNoYWRvdzogMCAxOHB4IDQ4cHggcmdiYSgwLCAwLCAwLCAwLjQ1KTtcbn1cbi5jcy1oZWFkIHtcbiAgZGlzcGxheTogZmxleDtcbiAgYWxpZ24taXRlbXM6IGNlbnRlcjtcbiAganVzdGlmeS1jb250ZW50OiBzcGFjZS1iZXR3ZWVuO1xuICBtYXJnaW4tYm90dG9tOiAxMHB4O1xufVxuLmNzLXRpdGxlIHtcbiAgZm9udC1zaXplOiAxMnB4O1xuICBmb250LXdlaWdodDogODAwO1xuICBjb2xvcjogdmFyKC0tdGV4dCk7XG59XG4uY3MtY2xvc2Uge1xuICBib3JkZXI6IG5vbmU7XG4gIGJhY2tncm91bmQ6IHRyYW5zcGFyZW50O1xuICBjb2xvcjogdmFyKC0tdGV4dC1tdXRlZCk7XG4gIGZvbnQtc2l6ZTogMTNweDtcbiAgY3Vyc29yOiBwb2ludGVyO1xuICBwYWRkaW5nOiAycHggNnB4O1xuICBib3JkZXItcmFkaXVzOiA2cHg7XG59XG4uY3MtY2xvc2U6aG92ZXIge1xuICBjb2xvcjogdmFyKC0tdGV4dCk7XG4gIGJhY2tncm91bmQ6IHZhcigtLWJ0bi1ob3Zlcik7XG59XG4uY3Mtc2VjdGlvbiB7XG4gIHBhZGRpbmc6IDhweCAwO1xuICBib3JkZXItdG9wOiAxcHggc29saWQgdmFyKC0tYm9yZGVyKTtcbn1cbi5jcy1sYWJlbCB7XG4gIGZvbnQtc2l6ZTogMTBweDtcbiAgZm9udC13ZWlnaHQ6IDgwMDtcbiAgbGV0dGVyLXNwYWNpbmc6IDAuMDdlbTtcbiAgdGV4dC10cmFuc2Zvcm06IHVwcGVyY2FzZTtcbiAgY29sb3I6IHZhcigtLXRleHQtbXV0ZWQpO1xuICBtYXJnaW4tYm90dG9tOiA4cHg7XG59XG4uY3MtbW9kZXMge1xuICBkaXNwbGF5OiBmbGV4O1xuICBnYXA6IDZweDtcbiAgbWFyZ2luLWJvdHRvbTogOHB4O1xufVxuLmNzLW1vZGUge1xuICBmbGV4OiAxO1xuICBwYWRkaW5nOiA2cHggMDtcbiAgYm9yZGVyLXJhZGl1czogN3B4O1xuICBib3JkZXI6IDFweCBzb2xpZCB2YXIoLS1ib3JkZXIpO1xuICBiYWNrZ3JvdW5kOiB0cmFuc3BhcmVudDtcbiAgY29sb3I6IHZhcigtLXRleHQtbXV0ZWQpO1xuICBmb250LXNpemU6IDExcHg7XG4gIGZvbnQtd2VpZ2h0OiA3MDA7XG4gIGN1cnNvcjogcG9pbnRlcjtcbn1cbi5jcy1tb2RlLm9uIHtcbiAgYm9yZGVyLWNvbG9yOiB2YXIoLS1hY2NlbnQpO1xuICBjb2xvcjogdmFyKC0tYWNjZW50KTtcbiAgYmFja2dyb3VuZDogcmdiYSg1OSwgMTMwLCAyNDYsIDAuMDgpO1xufVxuLmNzLXJvdyB7XG4gIGRpc3BsYXk6IGZsZXg7XG4gIGFsaWduLWl0ZW1zOiBjZW50ZXI7XG4gIGdhcDogOHB4O1xuICBwYWRkaW5nOiAzcHggMDtcbn1cbi5jcy1jYXAge1xuICBmb250LXNpemU6IDExcHg7XG4gIGZvbnQtd2VpZ2h0OiA2MDA7XG4gIGNvbG9yOiB2YXIoLS10ZXh0KTtcbiAgd2lkdGg6IDYwcHg7XG59XG4uY3MtcHJldmlldyB7XG4gIGhlaWdodDogMjZweDtcbiAgYm9yZGVyLXJhZGl1czogNnB4O1xuICBib3JkZXI6IDFweCBzb2xpZCB2YXIoLS1ib3JkZXIpO1xuICBtYXJnaW4tdG9wOiA2cHg7XG59XG4uY3MtY2FuZGxlcyB7XG4gIGRpc3BsYXk6IGdyaWQ7XG4gIGdyaWQtdGVtcGxhdGUtY29sdW1uczogcmVwZWF0KDMsIDFmcik7XG4gIGdhcDogNnB4O1xufVxuLmNzLWNhbmRsZSB7XG4gIGRpc3BsYXk6IGZsZXg7XG4gIGFsaWduLWl0ZW1zOiBjZW50ZXI7XG4gIGdhcDogNnB4O1xuICBmb250LXNpemU6IDEwLjVweDtcbiAgZm9udC13ZWlnaHQ6IDYwMDtcbiAgY29sb3I6IHZhcigtLXRleHQpO1xuICBjdXJzb3I6IHBvaW50ZXI7XG59XG4uY3MtY2FuZGxlIGlucHV0W3R5cGU9XCJjb2xvclwiXSB7XG4gIHdpZHRoOiAyMnB4O1xuICBoZWlnaHQ6IDIycHg7XG4gIHBhZGRpbmc6IDA7XG4gIGJvcmRlcjogbm9uZTtcbiAgYm9yZGVyLXJhZGl1czogNXB4O1xuICBiYWNrZ3JvdW5kOiB0cmFuc3BhcmVudDtcbiAgY3Vyc29yOiBwb2ludGVyO1xufVxuLmNzLXRoZW1lLWJ0biB7XG4gIG1hcmdpbi1sZWZ0OiBhdXRvO1xuICBib3JkZXI6IG5vbmU7XG4gIGJhY2tncm91bmQ6IHRyYW5zcGFyZW50O1xuICBjb2xvcjogdmFyKC0tdGV4dC1tdXRlZCk7XG4gIGZvbnQtc2l6ZTogOS41cHg7XG4gIGZvbnQtd2VpZ2h0OiA3MDA7XG4gIGN1cnNvcjogcG9pbnRlcjtcbiAgcGFkZGluZzogMXB4IDVweDtcbiAgYm9yZGVyLXJhZGl1czogNXB4O1xufVxuLmNzLXRoZW1lLWJ0bjpob3ZlciB7XG4gIGNvbG9yOiB2YXIoLS1hY2NlbnQpO1xuICBiYWNrZ3JvdW5kOiB2YXIoLS1idG4taG92ZXIpO1xufVxuLmNzLXRlbXBsYXRlcyB7XG4gIHBhZGRpbmctdG9wOiAxMHB4O1xuICBib3JkZXItdG9wOiAxcHggc29saWQgdmFyKC0tYm9yZGVyKTtcbiAgZGlzcGxheTogZmxleDtcbiAgYWxpZ24taXRlbXM6IGNlbnRlcjtcbiAgZ2FwOiA2cHg7XG4gIGZsZXgtd3JhcDogd3JhcDtcbn1cbi5jcy1zZWxlY3Qge1xuICBtYXgtd2lkdGg6IDExMHB4O1xuICBmb250LXNpemU6IDExcHg7XG4gIGZvbnQtd2VpZ2h0OiA2MDA7XG4gIGNvbG9yOiB2YXIoLS10ZXh0KTtcbiAgYmFja2dyb3VuZDogdmFyKC0tYmctcGFuZWwtc29saWQsICMxNzFiMjYpO1xuICBib3JkZXI6IDFweCBzb2xpZCB2YXIoLS1ib3JkZXIpO1xuICBib3JkZXItcmFkaXVzOiA2cHg7XG4gIHBhZGRpbmc6IDVweCA0cHg7XG4gIGN1cnNvcjogcG9pbnRlcjtcbn1cbi5jcy1kZWwge1xuICBib3JkZXI6IG5vbmU7XG4gIGJhY2tncm91bmQ6IHRyYW5zcGFyZW50O1xuICBjdXJzb3I6IHBvaW50ZXI7XG4gIGZvbnQtc2l6ZTogMTJweDtcbiAgcGFkZGluZzogMnB4IDRweDtcbiAgYm9yZGVyLXJhZGl1czogNXB4O1xufVxuLmNzLWRlbDpob3ZlciB7XG4gIGJhY2tncm91bmQ6IHJnYmEoMjQyLCA1NCwgNjksIDAuMTIpO1xufVxuLmNzLXRwbC1uYW1lIHtcbiAgZmxleDogMTtcbiAgbWluLXdpZHRoOiA4MHB4O1xuICBmb250LXNpemU6IDExcHg7XG4gIGNvbG9yOiB2YXIoLS10ZXh0KTtcbiAgYmFja2dyb3VuZDogdHJhbnNwYXJlbnQ7XG4gIGJvcmRlcjogMXB4IHNvbGlkIHZhcigtLWJvcmRlcik7XG4gIGJvcmRlci1yYWRpdXM6IDZweDtcbiAgcGFkZGluZzogNXB4IDdweDtcbn1cbi5jcy10cGwtbmFtZTpmb2N1cyB7XG4gIG91dGxpbmU6IG5vbmU7XG4gIGJvcmRlci1jb2xvcjogdmFyKC0tYWNjZW50KTtcbn1cbi5jcy1zYXZlIHtcbiAgYm9yZGVyOiBub25lO1xuICBiYWNrZ3JvdW5kOiB2YXIoLS1hY2NlbnQsICMzYjgyZjYpO1xuICBjb2xvcjogI2ZmZjtcbiAgZm9udC1zaXplOiAxMXB4O1xuICBmb250LXdlaWdodDogNzAwO1xuICBwYWRkaW5nOiA2cHggMTBweDtcbiAgYm9yZGVyLXJhZGl1czogN3B4O1xuICBjdXJzb3I6IHBvaW50ZXI7XG4gIHdoaXRlLXNwYWNlOiBub3dyYXA7XG59XG4uY3Mtc2F2ZTpob3ZlciB7XG4gIGZpbHRlcjogYnJpZ2h0bmVzcygxLjEyKTtcbn1cbi5jcy1yZXNldCB7XG4gIGJvcmRlcjogMXB4IHNvbGlkIHZhcigtLWJvcmRlcik7XG4gIGJhY2tncm91bmQ6IHRyYW5zcGFyZW50O1xuICBjb2xvcjogdmFyKC0tdGV4dC1tdXRlZCk7XG4gIGZvbnQtc2l6ZTogMTFweDtcbiAgZm9udC13ZWlnaHQ6IDcwMDtcbiAgcGFkZGluZzogNnB4IDEwcHg7XG4gIGJvcmRlci1yYWRpdXM6IDdweDtcbiAgY3Vyc29yOiBwb2ludGVyO1xufVxuLmNzLXJlc2V0OmhvdmVyIHtcbiAgY29sb3I6IHZhcigtLXRleHQpO1xuICBib3JkZXItY29sb3I6IHZhcigtLXRleHQtbXV0ZWQpO1xufVxuLmNoYXJ0LXBhbmUge1xuICBwb3NpdGlvbjogcmVsYXRpdmU7XG4gIGZsZXg6IDE7XG4gIG1pbi1oZWlnaHQ6IDA7XG4gIC8qIEdyYWRpZW50IHBhaW50ZWQgaW4gQ1NTIChub3QgYnkgdGhlIGNoYXJ0aW5nIGNhbnZhcykgc28gdGhlIGRyYXdpbmdcbiAgICAgbGF5ZXIgY2FuIHNpdCBiZXR3ZWVuIHRoaXMgYmFja2dyb3VuZCBhbmQgdGhlIGNhbmRsZSBjYW52YXMgKi9cbiAgYmFja2dyb3VuZDogdmFyKC0tY2hhcnQtYmctZ3JhZGllbnQpO1xuICBkaXNwbGF5OiBmbGV4O1xuICBmbGV4LWRpcmVjdGlvbjogY29sdW1uO1xuICBib3JkZXItcmFkaXVzOiB2YXIoLS1yYWRpdXMtbGcpO1xuICBtYXJnaW46IDhweDtcbiAgb3ZlcmZsb3c6IGhpZGRlbjtcbiAgYm94LXNoYWRvdzogdmFyKC0tZ2xhc3Mtc2hhZG93KTtcbiAgYm9yZGVyOiAxcHggc29saWQgdmFyKC0tYm9yZGVyKTtcbn1cbi5jaGFydC1jb250YWluZXIge1xuICBmbGV4OiAxO1xuICBtaW4taGVpZ2h0OiAwO1xuICB3aWR0aDogMTAwJTtcbiAgLyogY3Jvc3MgY3Vyc29yIG92ZXIgdGhlIGNoYXJ0IGF0IGFsbCB0aW1lcyAoVHJhZGluZ1ZpZXctc3R5bGUpICovXG4gIGN1cnNvcjogY3Jvc3NoYWlyO1xuICAvKiBDaGFydCBnZXN0dXJlcyAocGFuLCBwaW5jaCwgcHJpY2UtYXhpcyBkcmFnLCBkcmF3aW5nIGRyYWdzKSBhcmUgaGFuZGxlZFxuICAgICBieSBMaWdodHdlaWdodCBDaGFydHMgYW5kIHRoZSBkcmF3aW5nIHBvaW50ZXIgaGFuZGxlcnMuIFdpdGggdGhlIGRlZmF1bHRcbiAgICAgYGF1dG9gLCB0aGUgcGhvbmUvdGFibGV0IGJyb3dzZXIgY2xhaW1zIHRoZSB0b3VjaCBmb3Igc2Nyb2xsIGFyYml0cmF0aW9uXG4gICAgIGFuZCBmaXJlcyBwb2ludGVyY2FuY2VsIG1pZC1nZXN0dXJlIOKAlCBkcmF3aW5ncyBuZXZlciBsYW5kIGFuZCBheGlzIGRyYWdzXG4gICAgIGRpZSBpbnN0YW50bHkuIGBub25lYCBrZWVwcyBldmVyeSBnZXN0dXJlIGluc2lkZSB0aGUgY2hhcnQgaGFuZGxlcnMuICovXG4gIHRvdWNoLWFjdGlvbjogbm9uZTtcbn1cbi5jaGFydC1zeW1ib2wtbGFiZWwge1xuICBwb3NpdGlvbjogYWJzb2x1dGU7XG4gIHRvcDogMTBweDtcbiAgbGVmdDogMTRweDtcbiAgei1pbmRleDogNjsgLyogYWJvdmUgcmVjdGFuZ2xlcyBzbyBkcmF3aW5ncyBuZXZlciBjb3ZlciB0aGUgc3ltYm9sIGxhYmVsICovXG4gIGRpc3BsYXk6IGlubGluZS1mbGV4O1xuICBhbGlnbi1pdGVtczogY2VudGVyO1xuICBnYXA6IDZweDtcbiAgYmFja2dyb3VuZDogdHJhbnNwYXJlbnQ7XG4gIGJvcmRlcjogbm9uZTtcbiAgcGFkZGluZzogMDtcbiAgcG9pbnRlci1ldmVudHM6IG5vbmU7XG59XG4vKiBJbmRpY2F0b3IgbGVnZW5kIHJvdyB1bmRlciB0aGUgc3ltYm9sIGxhYmVsICovXG4uaW5kaWNhdG9yLWxlZ2VuZCB7XG4gIHBvc2l0aW9uOiBhYnNvbHV0ZTtcbiAgdG9wOiAzMHB4O1xuICBsZWZ0OiAxNHB4O1xuICB6LWluZGV4OiA3O1xuICBkaXNwbGF5OiBpbmxpbmUtZmxleDtcbiAgYWxpZ24taXRlbXM6IGNlbnRlcjtcbiAgZ2FwOiAycHg7XG4gIHBvaW50ZXItZXZlbnRzOiBhdXRvO1xufVxuLmluZC1sZWdlbmQtbmFtZSB7XG4gIGZvbnQtc2l6ZTogMTAuNXB4O1xuICBmb250LXdlaWdodDogODAwO1xuICBjb2xvcjogdmFyKC0tdGV4dC1tdXRlZCk7XG4gIG1hcmdpbi1yaWdodDogM3B4O1xuICB3aGl0ZS1zcGFjZTogbm93cmFwO1xufVxuLmluZC1sZWdlbmQtbmFtZS5vZmYge1xuICB0ZXh0LWRlY29yYXRpb246IGxpbmUtdGhyb3VnaDtcbiAgb3BhY2l0eTogMC41NTtcbn1cbi5pbmQtbGVnZW5kLWJ0biB7XG4gIHdpZHRoOiAxOHB4O1xuICBoZWlnaHQ6IDE4cHg7XG4gIGRpc3BsYXk6IGdyaWQ7XG4gIHBsYWNlLWl0ZW1zOiBjZW50ZXI7XG4gIGJvcmRlcjogbm9uZTtcbiAgYm9yZGVyLXJhZGl1czogNXB4O1xuICBiYWNrZ3JvdW5kOiB0cmFuc3BhcmVudDtcbiAgY29sb3I6IHZhcigtLXRleHQtbXV0ZWQpO1xuICBjdXJzb3I6IHBvaW50ZXI7XG4gIHBhZGRpbmc6IDA7XG59XG4uaW5kLWxlZ2VuZC1idG46aG92ZXIge1xuICBiYWNrZ3JvdW5kOiB2YXIoLS1idG4taG92ZXIpO1xuICBjb2xvcjogdmFyKC0tdGV4dCk7XG59XG4uaW5kLXNldHRpbmdzIHtcbiAgcG9zaXRpb246IGFic29sdXRlO1xuICB0b3A6IDIycHg7XG4gIGxlZnQ6IDA7XG4gIHotaW5kZXg6IDg7XG4gIG1pbi13aWR0aDogMjA1cHg7XG4gIHBhZGRpbmc6IDhweCAxMHB4O1xuICBib3JkZXItcmFkaXVzOiAxMHB4O1xuICBib3JkZXI6IDFweCBzb2xpZCB2YXIoLS1nbGFzcy1ib3JkZXIpO1xuICBiYWNrZ3JvdW5kOiB2YXIoLS1iZy1wYW5lbCwgIzE3MWIyNik7XG4gIGJveC1zaGFkb3c6IDAgMTJweCAzMnB4IHJnYmEoMCwgMCwgMCwgMC4zNSk7XG4gIGN1cnNvcjogZGVmYXVsdDtcbn1cbi5pbmQtc2V0dGluZ3MtdGl0bGUge1xuICBmb250LXNpemU6IDEwcHg7XG4gIGZvbnQtd2VpZ2h0OiA4MDA7XG4gIHRleHQtdHJhbnNmb3JtOiB1cHBlcmNhc2U7XG4gIGxldHRlci1zcGFjaW5nOiAwLjA3ZW07XG4gIGNvbG9yOiB2YXIoLS10ZXh0LW11dGVkKTtcbiAgbWFyZ2luLWJvdHRvbTogNnB4O1xufVxuLmluZC1zZXQtcm93IHtcbiAgZGlzcGxheTogZmxleDtcbiAgYWxpZ24taXRlbXM6IGNlbnRlcjtcbiAgZ2FwOiA3cHg7XG4gIGZvbnQtc2l6ZTogMTEuNXB4O1xuICBmb250LXdlaWdodDogNjAwO1xuICBjb2xvcjogdmFyKC0tdGV4dCk7XG4gIHBhZGRpbmc6IDNweCAwO1xuICBjdXJzb3I6IHBvaW50ZXI7XG4gIHdoaXRlLXNwYWNlOiBub3dyYXA7XG59XG4uaW5kLXNldC1yb3cgaW5wdXRbdHlwZT1cImNoZWNrYm94XCJdIHtcbiAgYWNjZW50LWNvbG9yOiB2YXIoLS1hY2NlbnQsICMzYjgyZjYpO1xuICBtYXJnaW46IDA7XG59XG4uaW5kLXNldC1kb3Qge1xuICB3aWR0aDogOXB4O1xuICBoZWlnaHQ6IDlweDtcbiAgYm9yZGVyLXJhZGl1czogNTAlO1xuICBmbGV4LXNocmluazogMDtcbn1cbi5pbmQtc2V0LWNvbG9yIHtcbiAgd2lkdGg6IDE4cHg7XG4gIGhlaWdodDogMThweDtcbiAgcGFkZGluZzogMDtcbiAgYm9yZGVyOiBub25lO1xuICBib3JkZXItcmFkaXVzOiA0cHg7XG4gIGJhY2tncm91bmQ6IHRyYW5zcGFyZW50O1xuICBjdXJzb3I6IHBvaW50ZXI7XG4gIGZsZXgtc2hyaW5rOiAwO1xufVxuLmluZC1zZXQtdGltZSB7XG4gIG1hcmdpbi1sZWZ0OiBhdXRvO1xuICBmb250LXNpemU6IDEwcHg7XG4gIGNvbG9yOiB2YXIoLS10ZXh0LW11dGVkKTtcbiAgZm9udC13ZWlnaHQ6IDYwMDtcbiAgcGFkZGluZy1sZWZ0OiAxMHB4O1xufVxuLyogRWRpdGFibGUgc2Vzc2lvbiByb3dzOiBlbmFibGUg4pyTICsgY29sb3IgZG90ICsgbmFtZSArIHN0YXJ0L2VuZCB0aW1lcyAqL1xuLmluZC1zZXQtZWRpdCB7XG4gIGRpc3BsYXk6IGZsZXg7XG4gIGFsaWduLWl0ZW1zOiBjZW50ZXI7XG4gIGdhcDogNnB4O1xufVxuLmluZC1zZXQtbmFtZSB7XG4gIHdpZHRoOiA5MnB4O1xuICBmb250LXNpemU6IDExcHg7XG4gIGZvbnQtd2VpZ2h0OiA3MDA7XG4gIGNvbG9yOiB2YXIoLS10ZXh0KTtcbiAgYmFja2dyb3VuZDogdHJhbnNwYXJlbnQ7XG4gIGJvcmRlcjogMXB4IHNvbGlkIHRyYW5zcGFyZW50O1xuICBib3JkZXItcmFkaXVzOiA0cHg7XG4gIHBhZGRpbmc6IDJweCA0cHg7XG59XG4uaW5kLXNldC1uYW1lOmhvdmVyLFxuLmluZC1zZXQtbmFtZTpmb2N1cyB7XG4gIGJvcmRlci1jb2xvcjogdmFyKC0tYm9yZGVyLCAjNDQ0KTtcbiAgb3V0bGluZTogbm9uZTtcbn1cbi5pbmQtc2V0LWVkaXQgLmluZC1zZXQtdGltZSB7XG4gIG1hcmdpbi1sZWZ0OiAwO1xuICBmb250LXNpemU6IDEwLjVweDtcbiAgY29sb3I6IHZhcigtLXRleHQpO1xuICBiYWNrZ3JvdW5kOiB0cmFuc3BhcmVudDtcbiAgYm9yZGVyOiAxcHggc29saWQgdHJhbnNwYXJlbnQ7XG4gIGJvcmRlci1yYWRpdXM6IDRweDtcbiAgcGFkZGluZzogMXB4IDJweDtcbiAgd2lkdGg6IDg0cHg7XG59XG4uaW5kLXNldC1lZGl0IC5pbmQtc2V0LXRpbWU6aG92ZXIsXG4uaW5kLXNldC1lZGl0IC5pbmQtc2V0LXRpbWU6Zm9jdXMge1xuICBib3JkZXItY29sb3I6IHZhcigtLWJvcmRlciwgIzQ0NCk7XG4gIG91dGxpbmU6IG5vbmU7XG59XG4uaW5kLXNldC1jaXR5IHtcbiAgZm9udC1zaXplOiA5LjVweDtcbiAgY29sb3I6IHZhcigtLXRleHQtbXV0ZWQpO1xuICBtYXJnaW4tbGVmdDogYXV0bztcbiAgd2hpdGUtc3BhY2U6IG5vd3JhcDtcbn1cbi5pbmQtc2V0LXJlbW92ZSB7XG4gIGJvcmRlcjogbm9uZTtcbiAgYmFja2dyb3VuZDogdHJhbnNwYXJlbnQ7XG4gIGNvbG9yOiB2YXIoLS10ZXh0LW11dGVkKTtcbiAgZm9udC1zaXplOiAxMXB4O1xuICBjdXJzb3I6IHBvaW50ZXI7XG4gIHBhZGRpbmc6IDAgM3B4O1xuICBib3JkZXItcmFkaXVzOiA0cHg7XG4gIGxpbmUtaGVpZ2h0OiAxO1xufVxuLmluZC1zZXQtcmVtb3ZlOmhvdmVyIHtcbiAgY29sb3I6ICNmMjM2NDU7XG4gIGJhY2tncm91bmQ6IHJnYmEoMjQyLCA1NCwgNjksIDAuMTIpO1xufVxuLmluZC1zZXQtYWRkIHtcbiAgZGlzcGxheTogZmxleDtcbiAgYWxpZ24taXRlbXM6IGNlbnRlcjtcbiAgZ2FwOiA2cHg7XG4gIG1hcmdpbi10b3A6IDZweDtcbiAgcGFkZGluZy10b3A6IDZweDtcbiAgYm9yZGVyLXRvcDogMXB4IGRhc2hlZCB2YXIoLS1ib3JkZXIsICM0NDQpO1xufVxuLmluZC1zZXQtYWRkIC5pbmQtc2V0LW5hbWUge1xuICBmbGV4OiAxO1xuICBtaW4td2lkdGg6IDA7XG4gIGJvcmRlci1jb2xvcjogdmFyKC0tYm9yZGVyLCAjNDQ0KTtcbn1cbi5pbmQtc2V0LWFkZCAuaW5kLXNldC10aW1lIHtcbiAgbWFyZ2luLWxlZnQ6IDA7XG4gIHdpZHRoOiA4NHB4O1xuICBmb250LXNpemU6IDEwLjVweDtcbiAgY29sb3I6IHZhcigtLXRleHQpO1xuICBiYWNrZ3JvdW5kOiB0cmFuc3BhcmVudDtcbiAgYm9yZGVyOiAxcHggc29saWQgdmFyKC0tYm9yZGVyLCAjNDQ0KTtcbiAgYm9yZGVyLXJhZGl1czogNHB4O1xuICBwYWRkaW5nOiAxcHggMnB4O1xufVxuLmluZC1zZXQtYWRkLWJ0biB7XG4gIGJvcmRlcjogbm9uZTtcbiAgYmFja2dyb3VuZDogdmFyKC0tYWNjZW50LCAjM2I4MmY2KTtcbiAgY29sb3I6ICNmZmY7XG4gIGZvbnQtc2l6ZTogMTAuNXB4O1xuICBmb250LXdlaWdodDogNzAwO1xuICBwYWRkaW5nOiA0cHggOHB4O1xuICBib3JkZXItcmFkaXVzOiA1cHg7XG4gIGN1cnNvcjogcG9pbnRlcjtcbiAgd2hpdGUtc3BhY2U6IG5vd3JhcDtcbn1cbi5pbmQtc2V0LWFkZC1idG46aG92ZXIge1xuICBmaWx0ZXI6IGJyaWdodG5lc3MoMS4xMik7XG59XG4ubGFiZWwtdGV4dCB7XG4gIGZvbnQtd2VpZ2h0OiA4MDA7XG4gIGZvbnQtc2l6ZTogMTNweDtcbiAgY29sb3I6IHZhcigtLXRleHQpO1xuICBsZXR0ZXItc3BhY2luZzogLTAuMDJlbTtcbiAgdGV4dC1zaGFkb3c6IDAgMXB4IDhweCByZ2JhKDAsIDAsIDAsIDAuMDgpO1xuICBkaXNwbGF5OiBpbmxpbmUtZmxleDtcbiAgYWxpZ24taXRlbXM6IGNlbnRlcjtcbiAgZ2FwOiA0cHg7XG59XG4uZmxhZy1pbWcge1xuICB3aWR0aDogMTZweDtcbiAgaGVpZ2h0OiAxMnB4O1xuICBvYmplY3QtZml0OiBjb3ZlcjtcbiAgYm9yZGVyLXJhZGl1czogMnB4O1xuICB2ZXJ0aWNhbC1hbGlnbjogbWlkZGxlO1xuICBib3gtc2hhZG93OiAwIDAgMCAxcHggcmdiYSgwLCAwLCAwLCAwLjA2KTtcbn1cbi8qIFJvdW5kIGNvaW4vbWV0YWwgbG9nb3MgYXJlIHNxdWFyZSDigJQgdGhlIDE2w5cxMiBmbGFnIGZyYW1lIGNyb3BzIHRoZWlyXG4gICB0b3BzIGFuZCBib3R0b21zLiBDcnlwdG8gaWNvbnMgY29tZSBmcm9tIGpzRGVsaXZyLCBtZXRhbHMgYXJlIGRhdGEtVVJJcy4gKi9cbi5mbGFnLWltZ1tzcmMqPVwianNkZWxpdnJcIl0sXG4uZmxhZy1pbWdbc3JjXj1cImRhdGE6XCJdIHtcbiAgd2lkdGg6IDE3cHg7XG4gIGhlaWdodDogMTdweDtcbiAgYm9yZGVyLXJhZGl1czogNTAlO1xuICBvYmplY3QtZml0OiBjb250YWluO1xuICBiYWNrZ3JvdW5kOiB2YXIoLS1idG4tYmcpO1xuICBib3gtc2hhZG93OiAwIDAgMCAxcHggcmdiYSgwLCAwLCAwLCAwLjA4KTtcbiAgdmVydGljYWwtYWxpZ246IG1pZGRsZTtcbn1cbi5mbGFnLWVtb2ppIHtcbiAgZm9udC1zaXplOiAxMnB4O1xuICBsaW5lLWhlaWdodDogMTtcbn1cbi5vdmVybGF5IHtcbiAgcG9zaXRpb246IGFic29sdXRlO1xuICB0b3A6IDE0cHg7XG4gIGxlZnQ6IDUwJTtcbiAgdHJhbnNmb3JtOiB0cmFuc2xhdGVYKC01MCUpO1xuICB6LWluZGV4OiA1OyAvKiBhYm92ZSB0aGUgZHJhd2luZyBsYXllciAoMykgKi9cbiAgYmFja2dyb3VuZDogdmFyKC0tYmctcGFuZWwpO1xuICBib3JkZXI6IDFweCBzb2xpZCB2YXIoLS1ib3JkZXIpO1xuICBjb2xvcjogdmFyKC0tdGV4dCk7XG4gIGZvbnQtc2l6ZTogMTJweDtcbiAgZm9udC13ZWlnaHQ6IDYwMDtcbiAgcGFkZGluZzogOHB4IDE0cHg7XG4gIGJvcmRlci1yYWRpdXM6IDIwcHg7XG4gIG1heC13aWR0aDogOTAlO1xuICB0ZXh0LWFsaWduOiBjZW50ZXI7XG4gIHBvaW50ZXItZXZlbnRzOiBub25lO1xuICBib3gtc2hhZG93OiB2YXIoLS1jYXJkLXNoYWRvdyk7XG4gIGJhY2tkcm9wLWZpbHRlcjogYmx1cigxMnB4KTtcbiAgZGlzcGxheTogaW5saW5lLWZsZXg7XG4gIGFsaWduLWl0ZW1zOiBjZW50ZXI7XG4gIGdhcDogOHB4O1xufVxuLm92ZXJsYXkuY2VudGVyIHtcbiAgdG9wOiA1MCU7XG4gIGxlZnQ6IDUwJTtcbiAgdHJhbnNmb3JtOiB0cmFuc2xhdGUoLTUwJSwgLTUwJSk7XG4gIGZsZXgtZGlyZWN0aW9uOiBjb2x1bW47XG4gIHBhZGRpbmc6IDA7XG4gIGJvcmRlci1yYWRpdXM6IDE2cHg7XG59XG4ub3ZlcmxheS5sb2FkaW5nLW9ubHkge1xuICBiYWNrZ3JvdW5kOiB0cmFuc3BhcmVudDtcbiAgYm9yZGVyOiBub25lO1xuICBib3gtc2hhZG93OiBub25lO1xuICBiYWNrZHJvcC1maWx0ZXI6IG5vbmU7XG59XG4ubG9hZGluZy1jYXJkIHtcbiAgZGlzcGxheTogZmxleDtcbiAgZmxleC1kaXJlY3Rpb246IGNvbHVtbjtcbiAgYWxpZ24taXRlbXM6IGNlbnRlcjtcbiAgZ2FwOiAxMHB4O1xufVxuLmxvYWRpbmctdGl0bGUge1xuICBmb250LXdlaWdodDogODAwO1xuICBmb250LXNpemU6IDEzcHg7XG4gIGNvbG9yOiB2YXIoLS10ZXh0KTtcbn1cbi5sb2FkaW5nLXN1YiB7XG4gIGZvbnQtc2l6ZTogMTFweDtcbiAgY29sb3I6IHZhcigtLXRleHQtbXV0ZWQpO1xuICBmb250LXdlaWdodDogNTAwO1xufVxuLm92ZXJsYXkuZXJyb3Ige1xuICBib3JkZXItY29sb3I6IHJnYmEoMjM5LCA4MywgODAsIDAuMzUpO1xuICBjb2xvcjogI2VmNTM1MDtcbiAgYmFja2dyb3VuZDogcmdiYSgyMzksIDgzLCA4MCwgMC4wOCk7XG59XG4ub3ZlcmxheS5tdXRlZCB7XG4gIGZsZXgtZGlyZWN0aW9uOiBjb2x1bW47XG4gIGdhcDogNHB4O1xuICBjb2xvcjogdmFyKC0tdGV4dC1tdXRlZCk7XG4gIHBhZGRpbmc6IDEycHggMTZweDtcbiAgYm9yZGVyLXJhZGl1czogMTJweDtcbn1cbi5vdmVybGF5LmxvYWRpbmctbW9yZSB7XG4gIHRvcDogYXV0bztcbiAgYm90dG9tOiAxMnB4O1xuICBiYWNrZ3JvdW5kOiB2YXIoLS1iZy1wYW5lbCk7XG4gIGZvbnQtc2l6ZTogMTFweDtcbiAgcGFkZGluZzogNnB4IDEwcHg7XG4gIGJvcmRlci1yYWRpdXM6IDEycHg7XG59XG4ub3ZlcmxheS10aXRsZSB7XG4gIGNvbG9yOiB2YXIoLS10ZXh0KTtcbiAgZm9udC13ZWlnaHQ6IDcwMDtcbn1cbi5vdmVybGF5LXNwaW5uZXIge1xuICB3aWR0aDogMTRweDtcbiAgaGVpZ2h0OiAxNHB4O1xuICBib3JkZXI6IDJweCBzb2xpZCB2YXIoLS1ib3JkZXIpO1xuICBib3JkZXItdG9wLWNvbG9yOiB2YXIoLS1hY2NlbnQpO1xuICBib3JkZXItcmFkaXVzOiA1MCU7XG4gIGFuaW1hdGlvbjogc3BpbiAwLjhzIGxpbmVhciBpbmZpbml0ZTtcbiAgZmxleC1zaHJpbms6IDA7XG59XG4ub3ZlcmxheS1zcGlubmVyLmxhcmdlIHtcbiAgd2lkdGg6IDQwcHg7XG4gIGhlaWdodDogNDBweDtcbiAgYm9yZGVyLXdpZHRoOiA0cHg7XG4gIGJvcmRlci1jb2xvcjogdHJhbnNwYXJlbnQ7XG4gIGJvcmRlci10b3AtY29sb3I6IHZhcigtLWFjY2VudCk7XG4gIGJvcmRlci1yaWdodC1jb2xvcjogdmFyKC0tYWNjZW50KTtcbiAgZmlsdGVyOiBkcm9wLXNoYWRvdygwIDAgNnB4IHJnYmEoNDEsIDk4LCAyNTUsIDAuMzUpKTtcbn1cbi5oaW50IHtcbiAgZGlzcGxheTogYmxvY2s7XG4gIG1hcmdpbi10b3A6IDJweDtcbiAgZm9udC1zaXplOiAxMXB4O1xuICBvcGFjaXR5OiAwLjg1O1xuICBmb250LXdlaWdodDogNTAwO1xuICBtYXgtd2lkdGg6IDQyMHB4O1xufVxuLmF4aXMtdGFnIHtcbiAgcG9zaXRpb246IGFic29sdXRlO1xuICByaWdodDogMDtcbiAgei1pbmRleDogNTsgLyogYWJvdmUgdGhlIGRyYXdpbmcgbGF5ZXIgKDMpIHNvIHJlY3RzIG5ldmVyIGNvdmVyIHRoZSBjb3VudGRvd24gKi9cbiAgZGlzcGxheTogaW5saW5lLWZsZXg7XG4gIGFsaWduLWl0ZW1zOiBjZW50ZXI7XG4gIGp1c3RpZnktY29udGVudDogY2VudGVyO1xuICBiYWNrZ3JvdW5kOiB2YXIoLS1hY2NlbnQpOyAvKiBzYW1lIGJsdWUgYXMgdGhlIGxpdmUtcHJpY2UgbGFiZWwgKi9cbiAgY29sb3I6ICNmZmY7XG4gIGJvcmRlci1yYWRpdXM6IDNweCAwIDAgM3B4O1xuICBwb2ludGVyLWV2ZW50czogbm9uZTtcbiAgYm94LXNpemluZzogYm9yZGVyLWJveDtcbiAgZm9udC1zaXplOiAxMXB4O1xuICBmb250LXdlaWdodDogNzAwO1xuICBmb250LXZhcmlhbnQtbnVtZXJpYzogdGFidWxhci1udW1zO1xuICBsZXR0ZXItc3BhY2luZzogMC4wMmVtO1xuICB3aGl0ZS1zcGFjZTogbm93cmFwO1xuICBwYWRkaW5nOiAwIDZweDtcbn1cbkBrZXlmcmFtZXMgc3BpbiB7XG4gIHRvIHtcbiAgICB0cmFuc2Zvcm06IHJvdGF0ZSgzNjBkZWcpO1xuICB9XG59XG5cbi8qIOKUgOKUgCBEcmF3aW5nIG92ZXJsYXkg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAICovXG4vKiBUd28gc3RhY2tlZCBsYXllcnMgb3ZlciB0aGUgY2hhcnQ6XG4gKiAgIC5kcmF3aW5nLWxheWVyICAgICDigJQgdmlzaWJsZSByZWN0YW5nbGVzLCB6LW9yZGVyZWQgQkVISU5EIHRoZSBjYW5kbGVcbiAqICAgICAgICAgICAgICAgICAgICAgICAgcGFpbnRpbmcgKExXQydzIHNlcmllcyBjYW52YXMgc2l0cyBhdCB6LWluZGV4IDEsXG4gKiAgICAgICAgICAgICAgICAgICAgICAgIGNyb3NzaGFpciBhdCAyKSwgc28gYSBzbWFsbCByZWN0YW5nbGUgZHJhd24gb24gYVxuICogICAgICAgICAgICAgICAgICAgICAgICBsb3cgdGltZWZyYW1lIGhpZGVzIGJlaGluZCBjYW5kbGUgYm9kaWVzIG9uXG4gKiAgICAgICAgICAgICAgICAgICAgICAgIGNvYXJzZXIgb25lcyBpbnN0ZWFkIG9mIGNvdmVyaW5nIHRoZW0uXG4gKiAgIC5kcmF3aW5nLWhpdC1sYXllciDigJQgaW52aXNpYmxlIGR1cGxpY2F0ZXMgQUJPVkUgdGhlIGNhbmRsZXMgY2FycnlpbmdcbiAqICAgICAgICAgICAgICAgICAgICAgICAgYWxsIGhpdC10ZXN0aW5nIChzZWxlY3QgLyBkcmFnIC8gcmVzaXplIGhhbmRsZXMpLlxuICogVGhlIHdob2xlIHZpc2libGUgbGF5ZXIgaXMgcG9pbnRlci10cmFuc3BhcmVudDsgb25seSB0aGUgaGl0IHJlY3RzXG4gKiBjYXB0dXJlIHRoZSBwb2ludGVyLiAqL1xuLmRyYXdpbmctbGF5ZXIge1xuICBwb3NpdGlvbjogYWJzb2x1dGU7XG4gIGluc2V0OiAwO1xuICB6LWluZGV4OiAwO1xuICBwb2ludGVyLWV2ZW50czogbm9uZTtcbn1cbi8qIFNlc3Npb25zIGluZGljYXRvciBiYWNrZ3JvdW5kIGJveGVzIOKAlCBiZWhpbmQgdGhlIGRyYXdpbmdzIGxheWVyLiAqL1xuLnNlc3Npb24tbGF5ZXIge1xuICBwb3NpdGlvbjogYWJzb2x1dGU7XG4gIGluc2V0OiAwO1xuICB6LWluZGV4OiAwO1xuICBwb2ludGVyLWV2ZW50czogbm9uZTtcbn1cbi5zZXNzaW9uLWJveCB7XG4gIHBvc2l0aW9uOiBhYnNvbHV0ZTtcbn1cbi5zZXNzaW9uLWxhYmVsIHtcbiAgcG9zaXRpb246IGFic29sdXRlO1xuICBsZWZ0OiA1cHg7XG4gIGZvbnQtc2l6ZTogOS41cHg7XG4gIGZvbnQtd2VpZ2h0OiA4MDA7XG4gIGxldHRlci1zcGFjaW5nOiAwLjAzZW07XG4gIHdoaXRlLXNwYWNlOiBub3dyYXA7XG4gIHRleHQtc2hhZG93OiAwIDFweCAycHggcmdiYSgwLCAwLCAwLCAwLjI1KTtcbn1cbi8qIENsaXAgb3ZlcmxheSBjaGlsZHJlbiAoYm94ZXMsIGhpdCBhcmVhcywgaGFuZGxlcykgdG8gdGhlIGNoYXJ0IGFyZWEgc29cbiAgIG5vdGhpbmcgcmVuZGVycyBvdmVyIG9yIGNhbiBiZSBkcmF3biBvbiB0aGUgcHJpY2UvdGltZSBzY2FsZXMuICovXG4uZHJhd2luZy1jbGlwIHtcbiAgb3ZlcmZsb3c6IGhpZGRlbjtcbn1cbi5kcmF3aW5nLWhpdC1sYXllciB7XG4gIHBvc2l0aW9uOiBhYnNvbHV0ZTtcbiAgaW5zZXQ6IDA7XG4gIHotaW5kZXg6IDM7XG4gIHBvaW50ZXItZXZlbnRzOiBub25lO1xufVxuLyogVGhlIFNFTEVDVEVEIGRyYXdpbmcncyBncmFiIGFyZWFzIGFsd2F5cyB3aW4gdGhlIHBvaW50ZXIg4oCUIHJlc2l6aW5nXG4gICBmb2xsb3dzIHRoZSBzZWxlY3Rpb24gbm8gbWF0dGVyIHdoaWNoIGRyYXdpbmdzIG92ZXJsYXAgaXQuIEhhbmRsZXNcbiAgIG9ubHkgZXhpc3Qgb24gdGhlIHNlbGVjdGVkIGRyYXdpbmcsIHNvIGxpZnRpbmcgdGhlbSBpcyBzYWZlIHRvby4gKi9cbi5kcmF3aW5nLWhpdC1yZWN0LnNlbGVjdGVkLFxuLmRyYXdpbmctaGl0LXJlY3Quc2VsZWN0ZWQgLnJlY3QtZWRnZS1oaXQsXG4udHJlbmQtaGl0LnNlbGVjdGVkLFxuLnBvcy1oaXQuc2VsZWN0ZWQsXG4ucG9zLWhpdC5zZWxlY3RlZCAucG9zLWxldmVsLWhpdCxcbi5wb3MtaGl0LnNlbGVjdGVkIC5wb3MtZWRnZS1oaXQsXG4ucG9zLWhpdC5zZWxlY3RlZCAucmVzaXplLWhhbmRsZS5wb3MtaGFuZGxlLFxuLnNpbmdsZS1oaXQuc2VsZWN0ZWQsXG4uc2luZ2xlLWhhbmRsZSxcbi5yZXNpemUtaGFuZGxlIHtcbiAgei1pbmRleDogMzA7XG59XG5cbi8qIFRvdWNoOiBhIGZpbmdlci1kcmFnIG9uIGEgZHJhd2luZyBtdXN0IG1vdmUgdGhlIGRyYXdpbmcsIG5vdCBzY3JvbGwgdGhlXG4gICBwYWdlIOKAlCB3aXRob3V0IHRoaXMgdGhlIGJyb3dzZXIgZmlyZXMgcG9pbnRlcmNhbmNlbCBtaWQtZ2VzdHVyZSAqL1xuLmRyYXdpbmctaGl0LXJlY3QsXG4ucmVjdC1lZGdlLWhpdCxcbi5yZXNpemUtaGFuZGxlLFxuLnRyZW5kLWhpdCxcbi50cmVuZC1oYW5kbGUsXG4ucG9zLWhpdCxcbi5wb3MtbGV2ZWwtaGl0LFxuLnBvcy1lZGdlLWhpdCxcbi5zaW5nbGUtaGl0LFxuLmRlbW8tbGluZS1oaXQge1xuICB0b3VjaC1hY3Rpb246IG5vbmU7XG59XG4vKiBXaGlsZSBhIGRyYXdpbmcgdG9vbCBpcyBhY3RpdmUsIGV4aXN0aW5nIGRyYXdpbmdzIG11c3Qgbm90IHN3YWxsb3dcbiAgIHRoZSBwcmVzcywgYW5kIHRoZSBsaXZlIHByZXZpZXcgaXMgbmV2ZXIgaW50ZXJhY3RpdmUuICovXG4uZHJhd2luZy1oaXQtbGF5ZXIuZHJhd2luZy1tb2RlIC5kcmF3aW5nLWhpdC1yZWN0LFxuLmRyYXdpbmctaGl0LWxheWVyLmRyYXdpbmctbW9kZSAucmVjdC1lZGdlLWhpdCxcbi5kcmF3aW5nLWhpdC1sYXllci5kcmF3aW5nLW1vZGUgLnRyZW5kLWhpdCxcbi5kcmF3aW5nLWhpdC1sYXllci5kcmF3aW5nLW1vZGUgLnRyZW5kLWhhbmRsZSxcbi5kcmF3aW5nLWhpdC1sYXllci5kcmF3aW5nLW1vZGUgLnBvcy1oaXQsXG4uZHJhd2luZy1oaXQtbGF5ZXIuZHJhd2luZy1tb2RlIC5wb3MtbGV2ZWwtaGl0LFxuLmRyYXdpbmctaGl0LWxheWVyLmRyYXdpbmctbW9kZSAucG9zLWVkZ2UtaGl0LFxuLmRyYXdpbmctaGl0LWxheWVyLmRyYXdpbmctbW9kZSAucG9zLWhhbmRsZSxcbi5kcmF3aW5nLWhpdC1sYXllci5kcmF3aW5nLW1vZGUgLnNpbmdsZS1oaXQsXG4uZHJhd2luZy1oaXQtbGF5ZXIuZHJhd2luZy1tb2RlIC5zaW5nbGUtaGFuZGxlIHtcbiAgcG9pbnRlci1ldmVudHM6IG5vbmU7XG59XG4vKiBSZXBsYXkgcGljayBtb2RlOiB0aGUgY2xpY2sgbXVzdCBjdXQgdGhlIGNoYXJ0LCBuZXZlciBzZWxlY3QgYSBkcmF3aW5nXG4gICBvciBncmFiIGEgZGVtbyBsaW5lIOKAlCBhbGwgaGl0IHRhcmdldHMgZ28gY2xpY2stdHJhbnNwYXJlbnQuICovXG4uZGVtby1oaXQtbGF5ZXIuZHJhd2luZy1tb2RlIC5kZW1vLWxpbmUtaGl0IHtcbiAgcG9pbnRlci1ldmVudHM6IG5vbmU7XG59XG4uY2hhcnQtY29udGFpbmVyLnJlY3QtbW9kZSxcbi5jaGFydC1jb250YWluZXIucmVjdC1tb2RlICoge1xuICBjdXJzb3I6IGNyb3NzaGFpcjtcbn1cbi5kcmF3aW5nLXJlY3Qge1xuICBwb3NpdGlvbjogYWJzb2x1dGU7XG4gIGJvcmRlcjogMS41cHggc29saWQ7XG4gIGJvcmRlci1yYWRpdXM6IDJweDtcbiAgcG9pbnRlci1ldmVudHM6IG5vbmU7XG4gIHRyYW5zaXRpb246IGJveC1zaGFkb3cgMTUwbXM7XG59XG4uZHJhd2luZy1oaXQtcmVjdCB7XG4gIHBvc2l0aW9uOiBhYnNvbHV0ZTtcbiAgcG9pbnRlci1ldmVudHM6IGF1dG87XG4gIGN1cnNvcjogcG9pbnRlcjtcbn1cbi8qIEJvcmRlci1vbmx5IHJlY3RhbmdsZXM6IHRoZSBib2R5IHBhc3NlcyBjbGlja3MgdGhyb3VnaCB0byB0aGUgY2hhcnQg4oCUXG4gICBvbmx5IHRoZSA0IGVkZ2Ugc3RyaXBzICh0aGUgdmlzaWJsZSBib3JkZXIgYXJlYSkgc2VsZWN0L2RyYWcuICovXG4uZHJhd2luZy1oaXQtcmVjdC5ib3JkZXItb25seSB7XG4gIHBvaW50ZXItZXZlbnRzOiBub25lO1xufVxuLnJlY3QtZWRnZS1oaXQge1xuICBwb3NpdGlvbjogYWJzb2x1dGU7XG4gIHBvaW50ZXItZXZlbnRzOiBhdXRvO1xuICBjdXJzb3I6IG1vdmU7XG59XG4ucmVjdC1lZGdlLWhpdC50b3Age1xuICB0b3A6IC00cHg7XG4gIGxlZnQ6IDA7XG4gIHJpZ2h0OiAwO1xuICBoZWlnaHQ6IDhweDtcbn1cbi5yZWN0LWVkZ2UtaGl0LmJvdHRvbSB7XG4gIGJvdHRvbTogLTRweDtcbiAgbGVmdDogMDtcbiAgcmlnaHQ6IDA7XG4gIGhlaWdodDogOHB4O1xufVxuLnJlY3QtZWRnZS1oaXQubGVmdCB7XG4gIGxlZnQ6IC00cHg7XG4gIHRvcDogMDtcbiAgYm90dG9tOiAwO1xuICB3aWR0aDogOHB4O1xufVxuLnJlY3QtZWRnZS1oaXQucmlnaHQge1xuICByaWdodDogLTRweDtcbiAgdG9wOiAwO1xuICBib3R0b206IDA7XG4gIHdpZHRoOiA4cHg7XG59XG4uZHJhd2luZy1oaXQtcmVjdC5zZWxlY3RlZCB7XG4gIGN1cnNvcjogbW92ZTtcbn1cbi5kcmF3aW5nLXJlY3Q6aG92ZXIge1xuICBib3gtc2hhZG93OiAwIDAgMCAxcHggcmdiYSg0MSwgOTgsIDI1NSwgMC40KTtcbn1cbi5kcmF3aW5nLXJlY3Quc2VsZWN0ZWQge1xuICBib3JkZXItd2lkdGg6IDJweDtcbiAgYm94LXNoYWRvdzogMCAwIDAgMnB4IHJnYmEoNDEsIDk4LCAyNTUsIDAuNSk7XG59XG4vKiBCb3JkZXItb25seSBtb2RlOiB+MS41w5cgYm9yZGVyIHRoaWNrbmVzcy4gMi4yNXB4IHdvdWxkIGJlIHNuYXBwZWQgdG8gMnB4XG4gICBieSB0aGUgYnJvd3Nlciwgc28gMi41cHggaXMgdXNlZCB0byBrZWVwIHRoZSBzdGVwIHZpc2libGUgKDNweCBzZWxlY3RlZCkuICovXG4uZHJhd2luZy1yZWN0LmJvcmRlci1vbmx5IHtcbiAgYm9yZGVyLXdpZHRoOiAyLjVweDtcbn1cbi5kcmF3aW5nLXJlY3QuYm9yZGVyLW9ubHkuc2VsZWN0ZWQge1xuICBib3JkZXItd2lkdGg6IDNweDtcbiAgYm94LXNoYWRvdzogMCAwIDAgMXB4IHJnYmEoNDEsIDk4LCAyNTUsIDAuNSk7XG59XG5cbi8qIOKUgOKUgCBUcmVuZGxpbmUgU1ZHIGxheWVycyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIAgKi9cbi50cmVuZC1zdmcsXG4udHJlbmQtaGl0LXN2ZyB7XG4gIHBvc2l0aW9uOiBhYnNvbHV0ZTtcbiAgaW5zZXQ6IDA7XG4gIHdpZHRoOiAxMDAlO1xuICBoZWlnaHQ6IDEwMCU7XG4gIG92ZXJmbG93OiB2aXNpYmxlO1xuICBwb2ludGVyLWV2ZW50czogbm9uZTtcbn1cbi8qIEZhdCB0cmFuc3BhcmVudCBzdHJva2UgZ3JhYnMgdGhlIHBvaW50ZXI7IGhhbmRsZXMgc2l0IG9uIHRvcCBvZiBpdCAqL1xuLnRyZW5kLWhpdCB7XG4gIHBvaW50ZXItZXZlbnRzOiBzdHJva2U7XG4gIGN1cnNvcjogbW92ZTtcbn1cbi50cmVuZC1oaXQ6aG92ZXIge1xuICBjdXJzb3I6IHBvaW50ZXI7XG59XG4udHJlbmQtaGFuZGxlIHtcbiAgcG9pbnRlci1ldmVudHM6IGFsbDtcbiAgZmlsbDogI2ZmZjtcbiAgc3Ryb2tlOiAjMjk2MmZmO1xuICBzdHJva2Utd2lkdGg6IDEuNTtcbiAgY3Vyc29yOiBwb2ludGVyO1xufVxuLyogSW52aXNpYmxlIGhhbG8gZG91YmxpbmcgdGhlIGdyYWIgYXJlYSBvZiBlYWNoIGhhbmRsZSAqL1xuLnRyZW5kLWhhbmRsZTo6YmVmb3JlIHtcbiAgY29udGVudDogXCJcIjtcbiAgcG9zaXRpb246IGFic29sdXRlO1xuICBpbnNldDogLTZweDtcbn1cbi5yZXNpemUtaGFuZGxlIHtcbiAgcG9zaXRpb246IGFic29sdXRlO1xuICB3aWR0aDogOHB4O1xuICBoZWlnaHQ6IDhweDtcbiAgYmFja2dyb3VuZDogI2ZmZjtcbiAgYm9yZGVyOiAxcHggc29saWQgIzI5NjJmZjtcbiAgYm9yZGVyLXJhZGl1czogMnB4O1xuICBwb2ludGVyLWV2ZW50czogYXV0bztcbn1cbi8qIEludmlzaWJsZSBoYWxvIHRoYXQgZG91YmxlcyB0aGUgZ3JhYiBhcmVhIG9mIGVhY2ggaGFuZGxlIHNvIGFpbWluZyBpcyBlYXN5ICovXG4ucmVzaXplLWhhbmRsZTo6YmVmb3JlIHtcbiAgY29udGVudDogXCJcIjtcbiAgcG9zaXRpb246IGFic29sdXRlO1xuICBpbnNldDogLTVweDtcbn1cbi5yZXNpemUtaGFuZGxlLm53IHtcbiAgbGVmdDogLTRweDtcbiAgdG9wOiAtNHB4O1xuICBjdXJzb3I6IG53LXJlc2l6ZTtcbn1cbi5yZXNpemUtaGFuZGxlLm5lIHtcbiAgcmlnaHQ6IC00cHg7XG4gIHRvcDogLTRweDtcbiAgY3Vyc29yOiBuZS1yZXNpemU7XG59XG4ucmVzaXplLWhhbmRsZS5zdyB7XG4gIGxlZnQ6IC00cHg7XG4gIGJvdHRvbTogLTRweDtcbiAgY3Vyc29yOiBzdy1yZXNpemU7XG59XG4ucmVzaXplLWhhbmRsZS5zZSB7XG4gIHJpZ2h0OiAtNHB4O1xuICBib3R0b206IC00cHg7XG4gIGN1cnNvcjogc2UtcmVzaXplO1xufVxuLnJlc2l6ZS1oYW5kbGUubiB7XG4gIGxlZnQ6IDUwJTtcbiAgdG9wOiAtNHB4O1xuICB0cmFuc2Zvcm06IHRyYW5zbGF0ZVgoLTUwJSk7XG4gIGN1cnNvcjogbi1yZXNpemU7XG59XG4ucmVzaXplLWhhbmRsZS5zIHtcbiAgbGVmdDogNTAlO1xuICBib3R0b206IC00cHg7XG4gIHRyYW5zZm9ybTogdHJhbnNsYXRlWCgtNTAlKTtcbiAgY3Vyc29yOiBzLXJlc2l6ZTtcbn1cbi5yZXNpemUtaGFuZGxlLncge1xuICBsZWZ0OiAtNHB4O1xuICB0b3A6IDUwJTtcbiAgdHJhbnNmb3JtOiB0cmFuc2xhdGVZKC01MCUpO1xuICBjdXJzb3I6IHctcmVzaXplO1xufVxuLnJlc2l6ZS1oYW5kbGUuZSB7XG4gIHJpZ2h0OiAtNHB4O1xuICB0b3A6IDUwJTtcbiAgdHJhbnNmb3JtOiB0cmFuc2xhdGVZKC01MCUpO1xuICBjdXJzb3I6IGUtcmVzaXplO1xufVxuXG4vKiDilIDilIAgUmVjdGFuZ2xlIGVkaXQgcGFuZWwg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAICovXG4ucmVjdC1lZGl0LXBhbmVsIHtcbiAgcG9zaXRpb246IGFic29sdXRlO1xuICB6LWluZGV4OiAyMDtcbiAgZGlzcGxheTogZmxleDtcbiAgYWxpZ24taXRlbXM6IGNlbnRlcjtcbiAgZ2FwOiA2cHg7XG4gIGJhY2tncm91bmQ6IHZhcigtLWJnLXBhbmVsKTtcbiAgYm9yZGVyOiAxcHggc29saWQgdmFyKC0tYm9yZGVyKTtcbiAgYm9yZGVyLXJhZGl1czogOHB4O1xuICBwYWRkaW5nOiA2cHggOHB4O1xuICBib3gtc2hhZG93OiAwIDRweCAxNnB4IHJnYmEoMCwgMCwgMCwgMC4xNSk7XG4gIHBvaW50ZXItZXZlbnRzOiBhdXRvO1xufVxuLyogUGhvbmVzL3RhYmxldHM6IHRoZSBwYW5lbCByb3cgaXMgfjM2NnB4IHdpZGUg4oCUIG9uIGEgc21hbGwgcGFuZSB0aGUgZGVsZXRlXG4gICBidXR0b24gd291bGQgbGFuZCBvZmYtY2hhcnQgKGNsaXBwZWQgYnkgdGhlIHBhbmUpLiBMZXQgaXQgd3JhcCBhbmQgY2FwIGl0XG4gICB0byB0aGUgdmlld3BvcnQgaW5zdGVhZCwgd2l0aCBzbGlnaHRseSBsYXJnZXIgdG91Y2ggdGFyZ2V0cy4gKi9cbkBtZWRpYSAobWF4LXdpZHRoOiA2NDBweCkge1xuICAucmVjdC1lZGl0LXBhbmVsIHtcbiAgICBtYXgtd2lkdGg6IGNhbGMoMTAwdncgLSAyNHB4KTtcbiAgICBmbGV4LXdyYXA6IHdyYXA7XG4gICAgcm93LWdhcDogNnB4O1xuICAgIHBhZGRpbmc6IDVweCA2cHg7XG4gIH1cbiAgLmVkaXQtYnRuIHtcbiAgICB3aWR0aDogMzBweDtcbiAgICBoZWlnaHQ6IDMwcHg7XG4gIH1cbiAgLmNvbG9yLXN3YXRjaCB7XG4gICAgd2lkdGg6IDIwcHg7XG4gICAgaGVpZ2h0OiAyMHB4O1xuICB9XG59XG4uZWRpdC1jb2xvcnMge1xuICBkaXNwbGF5OiBmbGV4O1xuICBnYXA6IDRweDtcbn1cbi5jb2xvci1zd2F0Y2gge1xuICB3aWR0aDogMThweDtcbiAgaGVpZ2h0OiAxOHB4O1xuICBib3JkZXItcmFkaXVzOiA0cHg7XG4gIGJvcmRlcjogMnB4IHNvbGlkIHRyYW5zcGFyZW50O1xuICBjdXJzb3I6IHBvaW50ZXI7XG4gIHRyYW5zaXRpb246IGFsbCAxMjBtcztcbn1cbi5jb2xvci1zd2F0Y2g6aG92ZXIge1xuICB0cmFuc2Zvcm06IHNjYWxlKDEuMTUpO1xufVxuLmNvbG9yLXN3YXRjaC5hY3RpdmUge1xuICBib3JkZXItY29sb3I6IHZhcigtLXRleHQpO1xuICB0cmFuc2Zvcm06IHNjYWxlKDEuMSk7XG59XG4vKiBJY29uIGJ1dHRvbnMgKGZpbGwgdG9nZ2xlIC8gZGVsZXRlKSBhbmQgZ3JvdXAgc2VwYXJhdG9ycyAqL1xuLnBhbmVsLWRpdmlkZXIge1xuICB3aWR0aDogMXB4O1xuICBoZWlnaHQ6IDE4cHg7XG4gIGJhY2tncm91bmQ6IHZhcigtLWJvcmRlcik7XG4gIGZsZXgtc2hyaW5rOiAwO1xufVxuLmVkaXQtYnRuIHtcbiAgd2lkdGg6IDI2cHg7XG4gIGhlaWdodDogMjZweDtcbiAgZGlzcGxheTogZ3JpZDtcbiAgcGxhY2UtaXRlbXM6IGNlbnRlcjtcbiAgcGFkZGluZzogMDtcbiAgYm9yZGVyOiAxcHggc29saWQgdmFyKC0tYm9yZGVyKTtcbiAgYmFja2dyb3VuZDogdmFyKC0tYnRuLWJnKTtcbiAgY29sb3I6IHZhcigtLXRleHQpO1xuICBib3JkZXItcmFkaXVzOiA3cHg7XG4gIGN1cnNvcjogcG9pbnRlcjtcbiAgZmxleC1zaHJpbms6IDA7XG4gIHRyYW5zaXRpb246XG4gICAgY29sb3IgMTQwbXMsXG4gICAgYmFja2dyb3VuZCAxNDBtcyxcbiAgICBib3JkZXItY29sb3IgMTQwbXMsXG4gICAgdHJhbnNmb3JtIDE0MG1zO1xufVxuLmVkaXQtYnRuOmhvdmVyIHtcbiAgY29sb3I6IHZhcigtLWFjY2VudCk7XG4gIGJvcmRlci1jb2xvcjogdmFyKC0tYWNjZW50KTtcbiAgYmFja2dyb3VuZDogcmdiYSg0MSwgOTgsIDI1NSwgMC4xKTtcbiAgdHJhbnNmb3JtOiB0cmFuc2xhdGVZKC0xcHgpO1xufVxuLmVkaXQtYnRuOmFjdGl2ZSB7XG4gIHRyYW5zZm9ybTogdHJhbnNsYXRlWSgwKTtcbn1cbi8qIEJvcmRlci1vbmx5IHN0YXRlOiBkYXNoZWQgb3V0bGluZSBlY2hvZXMgdGhlIHJlY3QncyBib3JkZXItb25seSBsb29rICovXG4uZWRpdC1idG4ub2ZmIHtcbiAgY29sb3I6IHZhcigtLXRleHQtbXV0ZWQpO1xuICBib3JkZXItc3R5bGU6IGRhc2hlZDtcbn1cbi5lZGl0LWJ0bi5vZmY6aG92ZXIge1xuICBjb2xvcjogdmFyKC0tYWNjZW50KTtcbiAgYm9yZGVyLXN0eWxlOiBzb2xpZDtcbn1cbi5lZGl0LWJ0bi5kYW5nZXI6aG92ZXIge1xuICBjb2xvcjogI2VmNTM1MDtcbiAgYm9yZGVyLWNvbG9yOiByZ2JhKDIzOSwgODMsIDgwLCAwLjU1KTtcbiAgYmFja2dyb3VuZDogcmdiYSgyMzksIDgzLCA4MCwgMC4xKTtcbn1cbi5yZWN0LWNvbnRleHQtbWVudSB7XG4gIHotaW5kZXg6IDMwOyAvKiBhYm92ZSB0aGUgZWRpdCBwYW5lbCAoMjApIGFuZCByZWN0YW5nbGVzICgyKSAqL1xufVxuLyogXCJNb3JlIGNvbG9yc1wiIGNoaXAgKyB0b2dnbGVhYmxlIHBhbGV0dGUgcG9wdXAgKi9cbi5wYWxldHRlLWFuY2hvciB7XG4gIHBvc2l0aW9uOiByZWxhdGl2ZTtcbiAgZGlzcGxheTogaW5saW5lLWZsZXg7XG59XG4uY29sb3ItbW9yZSB7XG4gIHdpZHRoOiAxOHB4O1xuICBoZWlnaHQ6IDE4cHg7XG4gIGJvcmRlci1yYWRpdXM6IDRweDtcbiAgY3Vyc29yOiBwb2ludGVyO1xuICBib3JkZXI6IDFweCBkYXNoZWQgdmFyKC0tYm9yZGVyKTtcbiAgYmFja2dyb3VuZDogdHJhbnNwYXJlbnQ7XG4gIGNvbG9yOiB2YXIoLS10ZXh0LW11dGVkKTtcbiAgZm9udC1zaXplOiAxMXB4O1xuICBsaW5lLWhlaWdodDogMTtcbiAgZGlzcGxheTogZ3JpZDtcbiAgcGxhY2UtaXRlbXM6IGNlbnRlcjtcbiAgcGFkZGluZzogMDtcbiAgdHJhbnNpdGlvbjogYWxsIDEyMG1zO1xufVxuLmNvbG9yLW1vcmU6aG92ZXIsXG4uY29sb3ItbW9yZS5hY3RpdmUge1xuICBib3JkZXItY29sb3I6IHZhcigtLWFjY2VudCk7XG4gIGNvbG9yOiB2YXIoLS1hY2NlbnQpO1xufVxuLnBhbGV0dGUtcG9wIHtcbiAgcG9zaXRpb246IGFic29sdXRlO1xuICB0b3A6IDI0cHg7XG4gIGxlZnQ6IDA7XG4gIHotaW5kZXg6IDQwO1xuICBkaXNwbGF5OiBncmlkO1xuICBncmlkLXRlbXBsYXRlLWNvbHVtbnM6IHJlcGVhdCg0LCAxOHB4KTtcbiAgZ2FwOiA1cHg7XG4gIGJhY2tncm91bmQ6IHZhcigtLWJnLXBhbmVsKTtcbiAgYm9yZGVyOiAxcHggc29saWQgdmFyKC0tYm9yZGVyKTtcbiAgYm9yZGVyLXJhZGl1czogOHB4O1xuICBwYWRkaW5nOiA4cHg7XG4gIGJveC1zaGFkb3c6IDAgNnB4IDIwcHggcmdiYSgwLCAwLCAwLCAwLjI1KTtcbn1cbi8qIE9wYWNpdHkgc2xpZGVyIHJvdyAqL1xuLm9wYWNpdHktcm93IHtcbiAgZGlzcGxheTogaW5saW5lLWZsZXg7XG4gIGFsaWduLWl0ZW1zOiBjZW50ZXI7XG4gIGdhcDogNHB4O1xuICBjdXJzb3I6IGRlZmF1bHQ7XG59XG4ub3BhY2l0eS1pY29uIHtcbiAgZm9udC1zaXplOiAxMHB4O1xuICBjb2xvcjogdmFyKC0tdGV4dC1tdXRlZCk7XG59XG4ub3BhY2l0eS1zbGlkZXIge1xuICB3aWR0aDogNjRweDtcbiAgaGVpZ2h0OiAzcHg7XG4gIGFjY2VudC1jb2xvcjogdmFyKC0tYWNjZW50KTtcbiAgY3Vyc29yOiBwb2ludGVyO1xufVxuLm9wYWNpdHktdmFsdWUge1xuICBmb250LXNpemU6IDEwcHg7XG4gIGNvbG9yOiB2YXIoLS10ZXh0LW11dGVkKTtcbiAgbWluLXdpZHRoOiAyNnB4O1xuICB0ZXh0LWFsaWduOiByaWdodDtcbiAgZm9udC12YXJpYW50LW51bWVyaWM6IHRhYnVsYXItbnVtcztcbn1cbi8qIERhc2ggc3R5bGUgc3dpdGNoZXIgcm93ICh0cmVuZGxpbmUgZWRpdCBwYW5lbCkgKi9cbi5kYXNoLXJvdyB7XG4gIGRpc3BsYXk6IGlubGluZS1mbGV4O1xuICBnYXA6IDRweDtcbn1cbi5kYXNoLWJ0biB7XG4gIHdpZHRoOiAyNnB4O1xuICBoZWlnaHQ6IDI2cHg7XG4gIGRpc3BsYXk6IGdyaWQ7XG4gIHBsYWNlLWl0ZW1zOiBjZW50ZXI7XG4gIHBhZGRpbmc6IDA7XG4gIGJvcmRlcjogMXB4IHNvbGlkIHZhcigtLWJvcmRlcik7XG4gIGJhY2tncm91bmQ6IHZhcigtLWJ0bi1iZyk7XG4gIGNvbG9yOiB2YXIoLS10ZXh0KTtcbiAgYm9yZGVyLXJhZGl1czogN3B4O1xuICBjdXJzb3I6IHBvaW50ZXI7XG4gIGZsZXgtc2hyaW5rOiAwO1xuICB0cmFuc2l0aW9uOiBhbGwgMTQwbXM7XG59XG4uZGFzaC1idG46aG92ZXIge1xuICBjb2xvcjogdmFyKC0tYWNjZW50KTtcbiAgYm9yZGVyLWNvbG9yOiB2YXIoLS1hY2NlbnQpO1xufVxuLmRhc2gtYnRuLmFjdGl2ZSB7XG4gIGNvbG9yOiB2YXIoLS1hY2NlbnQpO1xuICBib3JkZXItY29sb3I6IHZhcigtLWFjY2VudCk7XG4gIGJhY2tncm91bmQ6IHJnYmEoNDEsIDk4LCAyNTUsIDAuMSk7XG59XG4uZGFzaC1zYW1wbGUge1xuICBkaXNwbGF5OiBibG9jaztcbiAgd2lkdGg6IDE2cHg7XG4gIGJvcmRlci10b3A6IDJweCBzb2xpZCBjdXJyZW50Q29sb3I7XG59XG4uZGFzaC1zYW1wbGUuZG90dGVkIHtcbiAgYm9yZGVyLXRvcC1zdHlsZTogZG90dGVkO1xuICBib3JkZXItdG9wLXdpZHRoOiAzcHg7XG59XG4uZGFzaC1zYW1wbGUuZGFzaGVkIHtcbiAgYm9yZGVyLXRvcC1zdHlsZTogZGFzaGVkO1xufVxuXG4vKiDilIDilIAgTG9uZyAvIFNob3J0IHBvc2l0aW9uIGxheWVycyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIAgKi9cbi5wb3Mtc3ZnIHtcbiAgLyogaW5oZXJpdHMgLnRyZW5kLXN2ZyBnZW9tZXRyeSAoYWJzb2x1dGUgaW5zZXQgMCwgcG9pbnRlci1ldmVudHMgbm9uZSkgKi9cbn1cbi5wb3MtaGl0IHtcbiAgcG9zaXRpb246IGFic29sdXRlO1xuICBwb2ludGVyLWV2ZW50czogYXV0bztcbiAgY3Vyc29yOiBtb3ZlO1xuICAvKiBpbnZpc2libGU6IGdlb21ldHJ5IG9ubHkgKi9cbn1cbi5wb3MtbGV2ZWwtaGl0IHtcbiAgcG9zaXRpb246IGFic29sdXRlO1xuICBsZWZ0OiAwO1xuICByaWdodDogMDtcbiAgaGVpZ2h0OiA4cHg7XG4gIGN1cnNvcjogbnMtcmVzaXplO1xufVxuLnBvcy1lZGdlLWhpdCB7XG4gIHBvc2l0aW9uOiBhYnNvbHV0ZTtcbiAgdG9wOiAwO1xuICBib3R0b206IDA7XG4gIHdpZHRoOiA2cHg7XG4gIGN1cnNvcjogZXctcmVzaXplO1xufVxuLnBvcy1oYW5kbGUge1xuICBjdXJzb3I6IG53c2UtcmVzaXplO1xufVxuLnBvcy1sYWJlbC1sYXllciB7XG4gIHBvc2l0aW9uOiBhYnNvbHV0ZTtcbiAgaW5zZXQ6IDA7XG4gIC8qIEJFTE9XIHRoZSBoaXQgbGF5ZXIgKDMpIHNvIHRoZSBjb3JuZXIgaGFuZGxlcyBuZXZlciBoaWRlIGJlaGluZCBhXG4gICAgIGxhYmVsLCBidXQgc3RpbGwgYWJvdmUgdGhlIGNhbmRsZSBjYW52YXMgKDEpIGFuZCB0aGUgZHJhd2luZyBib3hlcy4gKi9cbiAgei1pbmRleDogMjtcbiAgcG9pbnRlci1ldmVudHM6IG5vbmU7XG59XG4ucG9zLWxhYmVsIHtcbiAgcG9zaXRpb246IGFic29sdXRlO1xuICBmb250LXNpemU6IDEwcHg7XG4gIGZvbnQtd2VpZ2h0OiA3MDA7XG4gIGZvbnQtdmFyaWFudC1udW1lcmljOiB0YWJ1bGFyLW51bXM7XG4gIHBhZGRpbmc6IDFweCA1cHg7XG4gIGJvcmRlci1yYWRpdXM6IDRweDtcbiAgd2hpdGUtc3BhY2U6IG5vd3JhcDtcbiAgYmFja2dyb3VuZDogdmFyKC0tYmctcGFuZWwpO1xuICBib3JkZXI6IDFweCBzb2xpZCB2YXIoLS1ib3JkZXIpO1xuICBjb2xvcjogdmFyKC0tdGV4dCk7XG59XG4ucG9zLWxhYmVsLmVudHJ5IHtcbiAgY29sb3I6IHZhcigtLWFjY2VudCk7XG4gIGJvcmRlci1jb2xvcjogcmdiYSg0MSwgOTgsIDI1NSwgMC41KTtcbn1cbi5wb3MtbGFiZWwudHAge1xuICBjb2xvcjogIzI2YTY5YTtcbiAgYm9yZGVyLWNvbG9yOiByZ2JhKDM4LCAxNjYsIDE1NCwgMC41KTtcbn1cbi5wb3MtbGFiZWwuc2wge1xuICBjb2xvcjogI2VmNTM1MDtcbiAgYm9yZGVyLWNvbG9yOiByZ2JhKDIzOSwgODMsIDgwLCAwLjUpO1xufVxuLnBvcy1sYWJlbC5ybGluZSB7XG4gIGNvbG9yOiAjMjZhNjlhO1xuICBib3JkZXItY29sb3I6IHJnYmEoMzgsIDE2NiwgMTU0LCAwLjM1KTtcbiAgbWluLXdpZHRoOiAxNHB4O1xuICB0ZXh0LWFsaWduOiBjZW50ZXI7XG4gIHBhZGRpbmc6IDFweCAzcHg7XG59XG4ucG9zLWRpcmVjdGlvbi1iYWRnZSB7XG4gIGZvbnQtc2l6ZTogMTBweDtcbiAgZm9udC13ZWlnaHQ6IDgwMDtcbiAgbGV0dGVyLXNwYWNpbmc6IDAuMDRlbTtcbiAgcGFkZGluZzogM3B4IDhweDtcbiAgYm9yZGVyLXJhZGl1czogNnB4O1xuICBjb2xvcjogI2ZmZjtcbiAgZmxleC1zaHJpbms6IDA7XG59XG4ucG9zLWRpcmVjdGlvbi1iYWRnZS5sb25nIHtcbiAgYmFja2dyb3VuZDogIzI2YTY5YTtcbn1cbi5wb3MtZGlyZWN0aW9uLWJhZGdlLnNob3J0IHtcbiAgYmFja2dyb3VuZDogI2VmNTM1MDtcbn1cblxuLyog4pSA4pSAIE9uZS1jbGljayBsaW5lcyAoaGxpbmUgLyBocmF5IC8gdmxpbmUpIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgCAqL1xuLnNpbmdsZS1saW5lIHtcbiAgcG9zaXRpb246IGFic29sdXRlO1xuICBwb2ludGVyLWV2ZW50czogbm9uZTtcbn1cbi5zaW5nbGUtbGluZS5obGluZSB7XG4gIGxlZnQ6IDA7XG4gIHJpZ2h0OiAwO1xuICBib3JkZXItdG9wOiAycHggc29saWQ7XG59XG4uc2luZ2xlLWxpbmUuaHJheSB7XG4gIHJpZ2h0OiAwO1xuICBib3JkZXItdG9wOiAycHggc29saWQ7XG59XG4uc2luZ2xlLWxpbmUudmxpbmUge1xuICB0b3A6IDA7XG4gIGJvdHRvbTogMDtcbiAgYm9yZGVyLWxlZnQ6IDJweCBzb2xpZDtcbn1cbi5zaW5nbGUtbGluZS5kYXNoZWQge1xuICBib3JkZXItdG9wLXN0eWxlOiBkYXNoZWQ7XG4gIGJvcmRlci1sZWZ0LXN0eWxlOiBkYXNoZWQ7XG59XG4uc2luZ2xlLWxpbmUuZG90dGVkIHtcbiAgYm9yZGVyLXRvcC1zdHlsZTogZG90dGVkO1xuICBib3JkZXItbGVmdC1zdHlsZTogZG90dGVkO1xufVxuLnNpbmdsZS1saW5lLnNlbGVjdGVkLmhsaW5lLFxuLnNpbmdsZS1saW5lLnNlbGVjdGVkLmhyYXkge1xuICBib3JkZXItdG9wLXdpZHRoOiAzcHg7XG4gIGJveC1zaGFkb3c6IDAgMXB4IDAgMCByZ2JhKDI1NSwgMjU1LCAyNTUsIDAuMjUpO1xufVxuLnNpbmdsZS1saW5lLnNlbGVjdGVkLnZsaW5lIHtcbiAgYm9yZGVyLWxlZnQtd2lkdGg6IDNweDtcbn1cbi5zaW5nbGUtaGl0IHtcbiAgcG9zaXRpb246IGFic29sdXRlO1xuICBwb2ludGVyLWV2ZW50czogYXV0bztcbn1cbi5zaW5nbGUtaGl0LmhsaW5lIHtcbiAgbGVmdDogMDtcbiAgcmlnaHQ6IDA7XG4gIGhlaWdodDogOXB4O1xuICBjdXJzb3I6IG5zLXJlc2l6ZTtcbn1cbi5zaW5nbGUtaGl0LmhyYXkge1xuICByaWdodDogMDtcbiAgaGVpZ2h0OiA5cHg7XG4gIGN1cnNvcjogbW92ZTtcbn1cbi5zaW5nbGUtaGl0LnZsaW5lIHtcbiAgdG9wOiAwO1xuICBib3R0b206IDA7XG4gIHdpZHRoOiA5cHg7XG4gIGN1cnNvcjogZXctcmVzaXplO1xufVxuLyogUmVzaXplIGNvcm5lcnM6IG1pZGRsZSBvZiBobGluZS92bGluZSwgbGVmdCBhbmNob3Igb2YgaHJheSAqL1xuLnNpbmdsZS1oYW5kbGUuaGxpbmUge1xuICBjdXJzb3I6IG5zLXJlc2l6ZTtcbn1cbi5zaW5nbGUtaGFuZGxlLnZsaW5lIHtcbiAgY3Vyc29yOiBldy1yZXNpemU7XG59XG4uc2luZ2xlLWhhbmRsZS5ocmF5IHtcbiAgY3Vyc29yOiBtb3ZlO1xufVxuLyogVGFncyByZW5kZXJlZCBPTiB0aGUgcHJpY2UvdGltZSBzY2FsZXMgKHVuY2xpcHBlZCBsYXllcikgKi9cbi5zaW5nbGUtdGFnLWxheWVyIHtcbiAgcG9zaXRpb246IGFic29sdXRlO1xuICBpbnNldDogMDtcbiAgei1pbmRleDogNTtcbiAgcG9pbnRlci1ldmVudHM6IG5vbmU7XG59XG4uc2luZ2xlLXByaWNlLXRhZyxcbi5zaW5nbGUtdGltZS10YWcge1xuICBwb3NpdGlvbjogYWJzb2x1dGU7XG4gIGZvbnQtc2l6ZTogMTFweDtcbiAgZm9udC13ZWlnaHQ6IDcwMDtcbiAgZm9udC12YXJpYW50LW51bWVyaWM6IHRhYnVsYXItbnVtcztcbiAgY29sb3I6ICNmZmY7XG4gIHBhZGRpbmc6IDJweCA2cHg7XG4gIGJvcmRlci1yYWRpdXM6IDNweDtcbiAgd2hpdGUtc3BhY2U6IG5vd3JhcDtcbiAgYmFja2dyb3VuZDogIzI5NjJmZjtcbiAgYm94LXNoYWRvdzogMCAycHggNnB4IHJnYmEoMCwgMCwgMCwgMC4zKTtcbn1cbi8qIFByaWNlIHRhZyBwaW5uZWQgdG8gdGhlIHByaWNlIHNjYWxlIChmbHVzaCByaWdodCwgbGlrZSBMV0MncyBvd24gbGFiZWxzKSAqL1xuLnNpbmdsZS1wcmljZS10YWcge1xuICByaWdodDogMDtcbiAgYm9yZGVyLXJhZGl1czogM3B4IDAgMCAzcHg7XG59XG4vKiDilIDilIAgTWFnbmV0IHNuYXBwaW5nIGNyb3NzaGFpciDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIAgKi9cbi54aGFpci1saW5lIHtcbiAgcG9zaXRpb246IGFic29sdXRlO1xuICB6LWluZGV4OiA2O1xuICBwb2ludGVyLWV2ZW50czogbm9uZTtcbn1cbi54aGFpci1saW5lLnYge1xuICB0b3A6IDA7XG4gIHdpZHRoOiAwO1xuICBib3JkZXItbGVmdDogMXB4IGRhc2hlZCByZ2JhKDExNywgMTM0LCAxNTAsIDAuNzUpO1xufVxuLnhoYWlyLWxpbmUuaCB7XG4gIGxlZnQ6IDA7XG4gIGhlaWdodDogMDtcbiAgYm9yZGVyLXRvcDogMXB4IGRhc2hlZCByZ2JhKDExNywgMTM0LCAxNTAsIDAuNzUpO1xufVxuLnNpbmdsZS10aW1lLXRhZyB7XG4gIHRyYW5zZm9ybTogdHJhbnNsYXRlWCgtNTAlKTtcbiAgYmFja2dyb3VuZDogdmFyKC0tYmctcGFuZWwpO1xuICBib3JkZXI6IDFweCBzb2xpZCB2YXIoLS1ib3JkZXIpO1xuICBjb2xvcjogdmFyKC0tdGV4dCk7XG59XG4uc2luZ2xlLXRpbWUtdGFnLnNlbGVjdGVkIHtcbiAgYm9yZGVyLWNvbG9yOiB2YXIoLS1hY2NlbnQpO1xuICBjb2xvcjogdmFyKC0tYWNjZW50KTtcbn1cblxuLyog4pSA4pSAIFJlcGxheSBtb2RlIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgCAqL1xuLnJlcGxheS1sYXllciB7XG4gIHBvc2l0aW9uOiBhYnNvbHV0ZTtcbiAgaW5zZXQ6IDA7XG4gIHotaW5kZXg6IDQ7XG4gIHBvaW50ZXItZXZlbnRzOiBub25lO1xufVxuLnJlcGxheS12bCB7XG4gIHBvc2l0aW9uOiBhYnNvbHV0ZTtcbiAgdG9wOiAwO1xuICBib3R0b206IDA7XG4gIHdpZHRoOiAxLjVweDtcbiAgYmFja2dyb3VuZDogdmFyKC0tYWNjZW50KTtcbiAgYm94LXNoYWRvdzogMCAwIDhweCByZ2JhKDQxLCA5OCwgMjU1LCAwLjUpO1xufVxuLnJlcGxheS12bC5waWNraW5nIHtcbiAgYmFja2dyb3VuZDogI2Y1OWUwYjtcbiAgYm94LXNoYWRvdzogMCAwIDhweCByZ2JhKDI0NSwgMTU4LCAxMSwgMC41KTtcbn1cbi5yZXBsYXktdmwucGxheWluZyB7XG4gIGJhY2tncm91bmQ6ICMyNmE2OWE7XG4gIGJveC1zaGFkb3c6IDAgMCA4cHggcmdiYSgzOCwgMTY2LCAxNTQsIDAuNSk7XG59XG4ucmVwbGF5LXZsLWtub2Ige1xuICBwb3NpdGlvbjogYWJzb2x1dGU7XG4gIHRvcDogNnB4O1xuICBsZWZ0OiA1MCU7XG4gIHRyYW5zZm9ybTogdHJhbnNsYXRlWCgtNTAlKTtcbiAgYmFja2dyb3VuZDogdmFyKC0tYmctcGFuZWwpO1xuICBib3JkZXI6IDFweCBzb2xpZCB2YXIoLS1hY2NlbnQpO1xuICBjb2xvcjogdmFyKC0tYWNjZW50KTtcbiAgYm9yZGVyLXJhZGl1czogNHB4O1xuICBmb250LXNpemU6IDhweDtcbiAgbGluZS1oZWlnaHQ6IDE7XG4gIHBhZGRpbmc6IDJweCAzcHg7XG59XG4ucmVwbGF5LXBhbmVsIHtcbiAgcG9zaXRpb246IGFic29sdXRlO1xuICBib3R0b206IDQwcHg7XG4gIGxlZnQ6IDUwJTtcbiAgdHJhbnNmb3JtOiB0cmFuc2xhdGVYKC01MCUpO1xuICB6LWluZGV4OiAyNTtcbiAgZGlzcGxheTogZmxleDtcbiAgYWxpZ24taXRlbXM6IGNlbnRlcjtcbiAgZ2FwOiA1cHg7XG4gIGJhY2tncm91bmQ6IHZhcigtLWJnLXBhbmVsKTtcbiAgYm9yZGVyOiAxcHggc29saWQgdmFyKC0tYm9yZGVyKTtcbiAgYm9yZGVyLXJhZGl1czogMTBweDtcbiAgcGFkZGluZzogNnB4IDEwcHg7XG4gIGJveC1zaGFkb3c6IDAgNnB4IDIwcHggcmdiYSgwLCAwLCAwLCAwLjMpO1xuICBwb2ludGVyLWV2ZW50czogYXV0bztcbn1cbi5yZXBsYXktaGludCB7XG4gIGZvbnQtc2l6ZTogMTFweDtcbiAgZm9udC13ZWlnaHQ6IDcwMDtcbiAgY29sb3I6IHZhcigtLXRleHQtbXV0ZWQpO1xuICBtYXJnaW4tcmlnaHQ6IDRweDtcbiAgd2hpdGUtc3BhY2U6IG5vd3JhcDtcbn1cbi5ycC1idG4ge1xuICBtaW4td2lkdGg6IDI2cHg7XG4gIGhlaWdodDogMjZweDtcbiAgZGlzcGxheTogZ3JpZDtcbiAgcGxhY2UtaXRlbXM6IGNlbnRlcjtcbiAgcGFkZGluZzogMCA2cHg7XG4gIGJvcmRlcjogMXB4IHNvbGlkIHZhcigtLWJvcmRlcik7XG4gIGJhY2tncm91bmQ6IHZhcigtLWJ0bi1iZyk7XG4gIGNvbG9yOiB2YXIoLS10ZXh0KTtcbiAgYm9yZGVyLXJhZGl1czogN3B4O1xuICBjdXJzb3I6IHBvaW50ZXI7XG4gIGZvbnQtc2l6ZTogMTFweDtcbiAgZm9udC13ZWlnaHQ6IDcwMDtcbiAgZmxleC1zaHJpbms6IDA7XG4gIHRyYW5zaXRpb246IGFsbCAxNDBtcztcbiAgdXNlci1zZWxlY3Q6IG5vbmU7XG59XG4ucnAtYnRuOmhvdmVyIHtcbiAgY29sb3I6IHZhcigtLWFjY2VudCk7XG4gIGJvcmRlci1jb2xvcjogdmFyKC0tYWNjZW50KTtcbn1cbi5ycC1idG4uYWNjZW50IHtcbiAgYmFja2dyb3VuZDogdmFyKC0tYWNjZW50LWdyYWRpZW50KTtcbiAgYm9yZGVyLWNvbG9yOiB0cmFuc3BhcmVudDtcbiAgY29sb3I6ICNmZmY7XG59XG4ucnAtYnRuLmRhbmdlcjpob3ZlciB7XG4gIGNvbG9yOiAjZWY1MzUwO1xuICBib3JkZXItY29sb3I6IHJnYmEoMjM5LCA4MywgODAsIDAuNTUpO1xufVxuLnJwLWJ0bi5zcGVlZC5hY3RpdmUge1xuICBjb2xvcjogdmFyKC0tYWNjZW50KTtcbiAgYm9yZGVyLWNvbG9yOiB2YXIoLS1hY2NlbnQpO1xuICBiYWNrZ3JvdW5kOiByZ2JhKDQxLCA5OCwgMjU1LCAwLjEyKTtcbn1cbi5yZXBsYXktcHJpY2UtdGFnIHtcbiAgcG9zaXRpb246IGFic29sdXRlO1xuICByaWdodDogMDtcbiAgYmFja2dyb3VuZDogIzI2YTY5YTtcbiAgY29sb3I6ICNmZmY7XG4gIGZvbnQtc2l6ZTogMTFweDtcbiAgZm9udC13ZWlnaHQ6IDcwMDtcbiAgZm9udC12YXJpYW50LW51bWVyaWM6IHRhYnVsYXItbnVtcztcbiAgcGFkZGluZzogMnB4IDZweDtcbiAgYm9yZGVyLXJhZGl1czogM3B4IDAgMCAzcHg7XG4gIGJveC1zaGFkb3c6IDAgMnB4IDZweCByZ2JhKDAsIDAsIDAsIDAuMyk7XG59XG5cbi8qIOKUgOKUgCBEZW1vIHRyYWRpbmcgKHBhcGVyIHRyYWRpbmcpIOKUgOKUgCAqL1xuLmRlbW8tbGluZXMsXG4uZGVtby1oaXQtbGF5ZXIsXG4uZGVtby10YWctbGF5ZXIge1xuICBwb3NpdGlvbjogYWJzb2x1dGU7XG4gIGluc2V0OiAwO1xuICBwb2ludGVyLWV2ZW50czogbm9uZTtcbn1cbi5kZW1vLWxpbmVzLFxuLmRlbW8tdGFnLWxheWVyIHtcbiAgei1pbmRleDogNTtcbn1cbi5kZW1vLWhpdC1sYXllciB7XG4gIHotaW5kZXg6IDc7XG59XG4uZGVtby1saW5lIHtcbiAgcG9zaXRpb246IGFic29sdXRlO1xuICBsZWZ0OiAwO1xuICByaWdodDogMDtcbiAgaGVpZ2h0OiAxLjVweDtcbiAgcG9pbnRlci1ldmVudHM6IG5vbmU7XG59XG4uZGVtby1saW5lLmRhc2hlZCB7XG4gIGJhY2tncm91bmQ6IHJlcGVhdGluZy1saW5lYXItZ3JhZGllbnQoOTBkZWcsIGN1cnJlbnRDb2xvciAwIDZweCwgdHJhbnNwYXJlbnQgNnB4IDExcHgpO1xufVxuLmRlbW8tbGluZS1oaXQge1xuICBwb3NpdGlvbjogYWJzb2x1dGU7XG4gIGxlZnQ6IDA7XG4gIHJpZ2h0OiAwO1xuICBoZWlnaHQ6IDlweDtcbiAgcG9pbnRlci1ldmVudHM6IGF1dG87XG4gIGN1cnNvcjogbnMtcmVzaXplO1xufVxuLmRlbW8tdGFnLWxheWVyIHtcbiAgcG9zaXRpb246IGFic29sdXRlO1xuICBpbnNldDogMDtcbiAgei1pbmRleDogODtcbiAgcG9pbnRlci1ldmVudHM6IG5vbmU7XG59XG4uZGVtby1heGlzLXRhZyB7XG4gIHBvc2l0aW9uOiBhYnNvbHV0ZTtcbiAgcmlnaHQ6IDA7XG4gIGZvbnQtc2l6ZTogMTFweDtcbiAgZm9udC13ZWlnaHQ6IDcwMDtcbiAgZm9udC12YXJpYW50LW51bWVyaWM6IHRhYnVsYXItbnVtcztcbiAgY29sb3I6ICNmZmY7XG4gIHBhZGRpbmc6IDJweCA2cHg7XG4gIGJvcmRlci1yYWRpdXM6IDNweCAwIDAgM3B4O1xuICB3aGl0ZS1zcGFjZTogbm93cmFwO1xufVxuLmRlbW8tYXhpcy10YWcuZW50cnkge1xuICBiYWNrZ3JvdW5kOiAjMjk2MmZmO1xufVxuLmRlbW8tYXhpcy10YWcuc2wge1xuICBiYWNrZ3JvdW5kOiAjZWY1MzUwO1xufVxuLmRlbW8tYXhpcy10YWcudHAge1xuICBiYWNrZ3JvdW5kOiAjMjZhNjlhO1xufVxuLyogTGVmdC1lZGdlIGxpbmUgbGFiZWxzOiBsb3QgKyAkIGxvc3Mgb24gU0wsICQgcmV3YXJkICsgUjpSIG9uIFRQIOKAlFxuICAgc29saWQgbGV2ZWwgY29sb3JzIHdpdGggd2hpdGUgdGV4dCBzbyB0aGV5IHN0YXkgcmVhZGFibGUgb24gYW55XG4gICBiYWNrZ3JvdW5kIC8gdGhlbWUgKi9cbi5kZW1vLWxpbmUtbGFiZWwge1xuICBwb3NpdGlvbjogYWJzb2x1dGU7XG4gIC8qIHBpbm5lZCB0byB0aGUgbGVmdCBlZGdlIG9mIHRoZSBjaGFydCBwYW5lICovXG4gIGxlZnQ6IDJweDtcbiAgZm9udC1zaXplOiAxMHB4O1xuICBmb250LXdlaWdodDogNzAwO1xuICBmb250LXZhcmlhbnQtbnVtZXJpYzogdGFidWxhci1udW1zO1xuICBwYWRkaW5nOiAxcHggNnB4O1xuICBib3JkZXItcmFkaXVzOiA0cHg7XG4gIGNvbG9yOiAjZmZmO1xuICBiYWNrZ3JvdW5kOiAjMjk2MmZmO1xuICB3aGl0ZS1zcGFjZTogbm93cmFwO1xuICBwb2ludGVyLWV2ZW50czogbm9uZTtcbiAgdGV4dC1zaGFkb3c6IG5vbmU7XG59XG4uZGVtby1saW5lLWxhYmVsLmVudHJ5IHtcbiAgYmFja2dyb3VuZDogIzI5NjJmZjtcbn1cbi5kZW1vLWxpbmUtbGFiZWwuc2wge1xuICBiYWNrZ3JvdW5kOiAjZWY1MzUwO1xufVxuLmRlbW8tbGluZS1sYWJlbC50cCB7XG4gIGJhY2tncm91bmQ6ICMyNmE2OWE7XG59XG4uZGVtby1zaXplLW1vZGVzIHtcbiAgZGlzcGxheTogaW5saW5lLWZsZXg7XG4gIGdhcDogMnB4O1xuICBiYWNrZ3JvdW5kOiB2YXIoLS1idG4tYmcpO1xuICBib3JkZXI6IDFweCBzb2xpZCB2YXIoLS1ib3JkZXIpO1xuICBib3JkZXItcmFkaXVzOiA3cHg7XG4gIHBhZGRpbmc6IDJweDtcbn1cbi5kZW1vLW1vZGUge1xuICBib3JkZXI6IG5vbmU7XG4gIGJhY2tncm91bmQ6IHRyYW5zcGFyZW50O1xuICBjb2xvcjogdmFyKC0tdGV4dC1tdXRlZCk7XG4gIGZvbnQtc2l6ZTogMTBweDtcbiAgZm9udC13ZWlnaHQ6IDgwMDtcbiAgcGFkZGluZzogM3B4IDhweDtcbiAgYm9yZGVyLXJhZGl1czogNXB4O1xuICBjdXJzb3I6IHBvaW50ZXI7XG59XG4uZGVtby1tb2RlLmFjdGl2ZSB7XG4gIGJhY2tncm91bmQ6IHZhcigtLWFjY2VudC1ncmFkaWVudCk7XG4gIGNvbG9yOiAjZmZmO1xufVxuLmRlbW8tZXJyIHtcbiAgZm9udC1zaXplOiAxMHB4O1xuICBjb2xvcjogI2VmNTM1MDtcbiAgZm9udC13ZWlnaHQ6IDcwMDtcbiAgd2hpdGUtc3BhY2U6IG5vd3JhcDtcbn1cbi5kZW1vLW1nciB7XG4gIHBvc2l0aW9uOiBhYnNvbHV0ZTtcbiAgdG9wOiAxMnB4O1xuICByaWdodDogMTJweDsgLyogbmVhciB0aGUgd2F0Y2hsaXN0IHNpZGUgb2YgdGhlIGNoYXJ0ICovXG4gIHotaW5kZXg6IDI2O1xuICBkaXNwbGF5OiBmbGV4O1xuICBmbGV4LWRpcmVjdGlvbjogY29sdW1uO1xuICBnYXA6IDVweDtcbiAgd2lkdGg6IDEzMnB4O1xuICBiYWNrZ3JvdW5kOiB2YXIoLS1iZy1wYW5lbCk7XG4gIGJvcmRlcjogMXB4IHNvbGlkIHZhcigtLWJvcmRlcik7XG4gIGJvcmRlci1yYWRpdXM6IDEwcHg7XG4gIHBhZGRpbmc6IDZweCA4cHg7XG4gIGJveC1zaGFkb3c6IDAgNnB4IDIwcHggcmdiYSgwLCAwLCAwLCAwLjMpO1xufVxuLmRlbW8tbWdyLm1pbmkge1xuICB3aWR0aDogYXV0bztcbiAgcGFkZGluZzogM3B4O1xuICBiYWNrZ3JvdW5kOiB0cmFuc3BhcmVudDtcbiAgYm9yZGVyOiBub25lO1xuICBib3gtc2hhZG93OiBub25lO1xufVxuLmRlbW8tbWdyLWhlYWQge1xuICBkaXNwbGF5OiBmbGV4O1xuICBhbGlnbi1pdGVtczogY2VudGVyO1xuICBqdXN0aWZ5LWNvbnRlbnQ6IHNwYWNlLWJldHdlZW47XG59XG4uZGVtby1tZ3ItdGl0bGUge1xuICBmb250LXNpemU6IDlweDtcbiAgZm9udC13ZWlnaHQ6IDgwMDtcbiAgbGV0dGVyLXNwYWNpbmc6IDAuMDhlbTtcbiAgY29sb3I6ICMyNmE2OWE7XG59XG4uZGVtby1taW5pLWJ0biB7XG4gIHdpZHRoOiAxOHB4O1xuICBoZWlnaHQ6IDE4cHg7XG4gIGRpc3BsYXk6IGdyaWQ7XG4gIHBsYWNlLWl0ZW1zOiBjZW50ZXI7XG4gIGJvcmRlcjogMXB4IHNvbGlkIHZhcigtLWJvcmRlcik7XG4gIGJhY2tncm91bmQ6IHZhcigtLWJ0bi1iZyk7XG4gIGNvbG9yOiB2YXIoLS10ZXh0LW11dGVkKTtcbiAgYm9yZGVyLXJhZGl1czogNXB4O1xuICBjdXJzb3I6IHBvaW50ZXI7XG4gIGZvbnQtc2l6ZTogMTFweDtcbiAgbGluZS1oZWlnaHQ6IDE7XG4gIHBhZGRpbmc6IDA7XG59XG4uZGVtby1taW5pLWJ0bjpob3ZlciB7XG4gIGNvbG9yOiB2YXIoLS10ZXh0KTtcbiAgYm9yZGVyLWNvbG9yOiB2YXIoLS1ib3JkZXItc3Ryb25nLCB2YXIoLS1ib3JkZXIpKTtcbn1cbi5kZW1vLW1nci1pbnAge1xuICBkaXNwbGF5OiBmbGV4O1xuICBhbGlnbi1pdGVtczogY2VudGVyO1xuICBqdXN0aWZ5LWNvbnRlbnQ6IHNwYWNlLWJldHdlZW47XG4gIGdhcDogNHB4O1xuICBmb250LXNpemU6IDEwcHg7XG4gIGNvbG9yOiB2YXIoLS10ZXh0LW11dGVkKTtcbiAgZm9udC13ZWlnaHQ6IDYwMDtcbn1cbi5kZW1vLW1nci1pbnAgaW5wdXQge1xuICB3aWR0aDogNjRweDtcbiAgcGFkZGluZzogM3B4IDZweDtcbiAgYm9yZGVyLXJhZGl1czogNnB4O1xuICBib3JkZXI6IDFweCBzb2xpZCB2YXIoLS1ib3JkZXIpO1xuICBiYWNrZ3JvdW5kOiB2YXIoLS1iZy1wYW5lbCk7XG4gIGNvbG9yOiB2YXIoLS10ZXh0KTtcbiAgZm9udC1zaXplOiAxMXB4O1xuICBmb250LXdlaWdodDogNzAwO1xuICBvdXRsaW5lOiBub25lO1xuICB0ZXh0LWFsaWduOiByaWdodDtcbn1cbi5kZW1vLW1nci1pbnAgaW5wdXQ6Zm9jdXMge1xuICBib3JkZXItY29sb3I6IHZhcigtLWFjY2VudCk7XG59XG4uZGVtby1tZ3ItYnRucyxcbi5kZW1vLWRyYWZ0LWJ0bnMge1xuICBkaXNwbGF5OiBncmlkO1xuICBncmlkLXRlbXBsYXRlLWNvbHVtbnM6IDFmciAxZnI7XG4gIGdhcDogNHB4O1xufVxuLmRlbW8tZHJhZnQtYnRucyB7XG4gIGdyaWQtdGVtcGxhdGUtY29sdW1uczogMmZyIDFmcjtcbn1cbi5kbS1idG4ge1xuICBoZWlnaHQ6IDI0cHg7XG4gIGJvcmRlci1yYWRpdXM6IDZweDtcbiAgYm9yZGVyOiAxcHggc29saWQgdmFyKC0tYm9yZGVyKTtcbiAgYmFja2dyb3VuZDogdmFyKC0tYnRuLWJnKTtcbiAgY29sb3I6IHZhcigtLXRleHQpO1xuICBmb250LXNpemU6IDEwcHg7XG4gIGZvbnQtd2VpZ2h0OiA3MDA7XG4gIGN1cnNvcjogcG9pbnRlcjtcbiAgdHJhbnNpdGlvbjogYWxsIDE0MG1zO1xuICB3aGl0ZS1zcGFjZTogbm93cmFwO1xufVxuLmRtLWJ0bi5idXk6aG92ZXIge1xuICBjb2xvcjogIzI2YTY5YTtcbiAgYm9yZGVyLWNvbG9yOiAjMjZhNjlhO1xufVxuLmRtLWJ0bi5zZWxsOmhvdmVyIHtcbiAgY29sb3I6ICNlZjUzNTA7XG4gIGJvcmRlci1jb2xvcjogI2VmNTM1MDtcbn1cbi5kbS1idG4uc2V0IHtcbiAgYmFja2dyb3VuZDogdmFyKC0tYWNjZW50LWdyYWRpZW50KTtcbiAgYm9yZGVyLWNvbG9yOiB0cmFuc3BhcmVudDtcbiAgY29sb3I6ICNmZmY7XG59XG4uZG0tYnRuLmNhbmNlbCB7XG4gIGNvbG9yOiB2YXIoLS10ZXh0LW11dGVkKTtcbn1cbi5kbS1idG4uY2FuY2VsOmhvdmVyIHtcbiAgY29sb3I6ICNlZjUzNTA7XG4gIGJvcmRlci1jb2xvcjogcmdiYSgyMzksIDgzLCA4MCwgMC41KTtcbn1cbi5kZW1vLXRiLXRpdGxlIHtcbiAgZm9udC1zaXplOiAxMHB4O1xuICBmb250LXdlaWdodDogODAwO1xuICBsZXR0ZXItc3BhY2luZzogMC4wOGVtO1xuICBjb2xvcjogIzI2YTY5YTtcbiAgbWFyZ2luLXJpZ2h0OiAycHg7XG59XG4uZGVtby1pbnAge1xuICBkaXNwbGF5OiBpbmxpbmUtZmxleDtcbiAgYWxpZ24taXRlbXM6IGNlbnRlcjtcbiAgZ2FwOiA0cHg7XG4gIGZvbnQtc2l6ZTogMTFweDtcbiAgY29sb3I6IHZhcigtLXRleHQtbXV0ZWQpO1xufVxuLmRlbW8taW5wIGlucHV0IHtcbiAgd2lkdGg6IDYycHg7XG4gIHBhZGRpbmc6IDRweCA2cHg7XG4gIGJvcmRlci1yYWRpdXM6IDZweDtcbiAgYm9yZGVyOiAxcHggc29saWQgdmFyKC0tYm9yZGVyKTtcbiAgYmFja2dyb3VuZDogdmFyKC0tYmctcGFuZWwpO1xuICBjb2xvcjogdmFyKC0tdGV4dCk7XG4gIGZvbnQtc2l6ZTogMTFweDtcbiAgZm9udC13ZWlnaHQ6IDcwMDtcbiAgb3V0bGluZTogbm9uZTtcbn1cbi5kZW1vLWlucCBpbnB1dDpmb2N1cyB7XG4gIGJvcmRlci1jb2xvcjogdmFyKC0tYWNjZW50KTtcbn1cbi5kZW1vLXRiLWJ0biB7XG4gIGhlaWdodDogMjZweDtcbiAgcGFkZGluZzogMCA4cHg7XG4gIGJvcmRlci1yYWRpdXM6IDZweDtcbiAgYm9yZGVyOiAxcHggc29saWQgdmFyKC0tYm9yZGVyKTtcbiAgYmFja2dyb3VuZDogdmFyKC0tYnRuLWJnKTtcbiAgY29sb3I6IHZhcigtLXRleHQpO1xuICBmb250LXNpemU6IDExcHg7XG4gIGZvbnQtd2VpZ2h0OiA3MDA7XG4gIGN1cnNvcjogcG9pbnRlcjtcbiAgdHJhbnNpdGlvbjogYWxsIDE0MG1zO1xufVxuLmRlbW8tdGItYnRuLmJ1eTpob3ZlciB7XG4gIGNvbG9yOiAjMjZhNjlhO1xuICBib3JkZXItY29sb3I6ICMyNmE2OWE7XG59XG4uZGVtby10Yi1idG4uc2VsbDpob3ZlciB7XG4gIGNvbG9yOiAjZWY1MzUwO1xuICBib3JkZXItY29sb3I6ICNlZjUzNTA7XG59XG4uZGVtby10Yi1idG4uYnV5LmFybWVkLFxuLmRlbW8tdGItYnRuLnNlbGwuYXJtZWQge1xuICBiYWNrZ3JvdW5kOiB2YXIoLS1hY2NlbnQtZ3JhZGllbnQpO1xuICBib3JkZXItY29sb3I6IHRyYW5zcGFyZW50O1xuICBjb2xvcjogI2ZmZjtcbiAgYm94LXNoYWRvdzogMCAycHggMTBweCByZ2JhKDQxLCA5OCwgMjU1LCAwLjM1KTtcbn1cbi5kZW1vLWVyciB7XG4gIGZvbnQtc2l6ZTogMTBweDtcbiAgY29sb3I6ICNlZjUzNTA7XG4gIGZvbnQtd2VpZ2h0OiA3MDA7XG4gIHdoaXRlLXNwYWNlOiBub3dyYXA7XG59XG4uZGVtby1ib3R0b20ge1xuICAvKiBpbi1mbG93IHNlY3Rpb24gVU5ERVIgdGhlIGNoYXJ0IChmbGV4IGNvbHVtbiBzaWJsaW5nKSDigJQgbmV2ZXIgY292ZXJzXG4gICAgIHRoZSBjYW5kbGVzICovXG4gIGJvcmRlci10b3A6IDFweCBzb2xpZCB2YXIoLS1ib3JkZXIpO1xuICBiYWNrZ3JvdW5kOiB2YXIoLS1iZy1wYW5lbCk7XG4gIG1heC1oZWlnaHQ6IDI0MHB4O1xuICBkaXNwbGF5OiBmbGV4O1xuICBmbGV4LWRpcmVjdGlvbjogY29sdW1uO1xuICBmbGV4LXNocmluazogMDtcbn1cbi5kZW1vLWJvdHRvbS1oZWFkIHtcbiAgZGlzcGxheTogZmxleDtcbiAgYWxpZ24taXRlbXM6IGNlbnRlcjtcbiAgZ2FwOiAxNHB4O1xuICBwYWRkaW5nOiA4cHggMTJweCA0cHg7XG4gIGZsZXgtd3JhcDogd3JhcDtcbn1cbi5kZW1vLWJhZGdlIHtcbiAgZm9udC1zaXplOiAxMHB4O1xuICBmb250LXdlaWdodDogODAwO1xuICBsZXR0ZXItc3BhY2luZzogMC4wOGVtO1xuICBjb2xvcjogI2ZmZjtcbiAgYmFja2dyb3VuZDogIzI2YTY5YTtcbiAgYm9yZGVyLXJhZGl1czogNXB4O1xuICBwYWRkaW5nOiAzcHggOHB4O1xufVxuLmRlbW8tc3RhdCB7XG4gIGZvbnQtc2l6ZTogMTFweDtcbiAgY29sb3I6IHZhcigtLXRleHQtbXV0ZWQpO1xuICBmb250LXdlaWdodDogNjAwO1xufVxuLmRlbW8tc3RhdCBiIHtcbiAgY29sb3I6IHZhcigtLXRleHQpO1xuICBmb250LXdlaWdodDogODAwO1xuICBtYXJnaW4tbGVmdDogNHB4O1xuICBmb250LXZhcmlhbnQtbnVtZXJpYzogdGFidWxhci1udW1zO1xufVxuLmRlbW8tZmxleCB7XG4gIGZsZXg6IDE7XG59XG4uZGVtby1yZXNldCB7XG4gIGJvcmRlcjogMXB4IHNvbGlkIHZhcigtLWJvcmRlcik7XG4gIGJhY2tncm91bmQ6IHZhcigtLWJ0bi1iZyk7XG4gIGNvbG9yOiB2YXIoLS10ZXh0LW11dGVkKTtcbiAgZm9udC1zaXplOiAxMHB4O1xuICBmb250LXdlaWdodDogNzAwO1xuICBib3JkZXItcmFkaXVzOiA2cHg7XG4gIHBhZGRpbmc6IDNweCA4cHg7XG4gIGN1cnNvcjogcG9pbnRlcjtcbn1cbi5kZW1vLXJlc2V0OmhvdmVyIHtcbiAgY29sb3I6ICNlZjUzNTA7XG4gIGJvcmRlci1jb2xvcjogcmdiYSgyMzksIDgzLCA4MCwgMC41KTtcbn1cbi5kZW1vLXRhYnMge1xuICBkaXNwbGF5OiBmbGV4O1xuICBhbGlnbi1pdGVtczogY2VudGVyO1xuICBnYXA6IDRweDtcbiAgcGFkZGluZzogMnB4IDEycHggNnB4O1xufVxuLmRlbW8tdGFiIHtcbiAgYm9yZGVyOiBub25lO1xuICBiYWNrZ3JvdW5kOiB0cmFuc3BhcmVudDtcbiAgY29sb3I6IHZhcigtLXRleHQtbXV0ZWQpO1xuICBmb250LXNpemU6IDExcHg7XG4gIGZvbnQtd2VpZ2h0OiA3MDA7XG4gIHBhZGRpbmc6IDNweCA4cHg7XG4gIGJvcmRlci1yYWRpdXM6IDZweDtcbiAgY3Vyc29yOiBwb2ludGVyO1xufVxuLmRlbW8tdGFiLmFjdGl2ZSB7XG4gIGJhY2tncm91bmQ6IHZhcigtLWJ0bi1iZyk7XG4gIGNvbG9yOiB2YXIoLS10ZXh0KTtcbn1cbi5kZW1vLXBlcmlvZCB7XG4gIGJvcmRlcjogMXB4IHNvbGlkIHZhcigtLWJvcmRlcik7XG4gIGJhY2tncm91bmQ6IHRyYW5zcGFyZW50O1xuICBjb2xvcjogdmFyKC0tdGV4dC1tdXRlZCk7XG4gIGZvbnQtc2l6ZTogMTBweDtcbiAgZm9udC13ZWlnaHQ6IDcwMDtcbiAgYm9yZGVyLXJhZGl1czogNnB4O1xuICBwYWRkaW5nOiAycHggN3B4O1xuICBjdXJzb3I6IHBvaW50ZXI7XG59XG4uZGVtby1wZXJpb2QuYWN0aXZlIHtcbiAgY29sb3I6IHZhcigtLWFjY2VudCk7XG4gIGJvcmRlci1jb2xvcjogdmFyKC0tYWNjZW50KTtcbn1cbi5kZW1vLXRhYmxlIHtcbiAgb3ZlcmZsb3c6IGF1dG87XG4gIHBhZGRpbmc6IDAgMTJweCAxMHB4O1xufVxuLmRlbW8tZW1wdHkge1xuICBmb250LXNpemU6IDExcHg7XG4gIGNvbG9yOiB2YXIoLS10ZXh0LW11dGVkKTtcbiAgcGFkZGluZzogOHB4IDRweDtcbn1cbi5kZW1vLXRhYmxlIHRhYmxlIHtcbiAgd2lkdGg6IDEwMCU7XG4gIGJvcmRlci1jb2xsYXBzZTogY29sbGFwc2U7XG4gIGZvbnQtc2l6ZTogMTFweDtcbn1cbi5kZW1vLXRhYmxlIHRoIHtcbiAgdGV4dC1hbGlnbjogbGVmdDtcbiAgY29sb3I6IHZhcigtLXRleHQtbXV0ZWQpO1xuICBmb250LXdlaWdodDogNzAwO1xuICBwYWRkaW5nOiAzcHggOHB4O1xuICBib3JkZXItYm90dG9tOiAxcHggc29saWQgdmFyKC0tYm9yZGVyKTtcbiAgcG9zaXRpb246IHN0aWNreTtcbiAgdG9wOiAwO1xuICBiYWNrZ3JvdW5kOiB2YXIoLS1iZy1wYW5lbCk7XG59XG4uZGVtby10YWJsZSB0ZCB7XG4gIHBhZGRpbmc6IDRweCA4cHg7XG4gIGJvcmRlci1ib3R0b206IDFweCBzb2xpZCB2YXIoLS1ib3JkZXIpO1xuICBmb250LXZhcmlhbnQtbnVtZXJpYzogdGFidWxhci1udW1zO1xuICBjb2xvcjogdmFyKC0tdGV4dCk7XG59XG4uZGVtby10YWJsZSAucG9zIHtcbiAgY29sb3I6ICMyNmE2OWE7XG59XG4uZGVtby10YWJsZSAubmVnIHtcbiAgY29sb3I6ICNlZjUzNTA7XG59XG4uZGVtby1jbG9zZSB7XG4gIGJvcmRlcjogbm9uZTtcbiAgYmFja2dyb3VuZDogdHJhbnNwYXJlbnQ7XG4gIGNvbG9yOiB2YXIoLS10ZXh0LW11dGVkKTtcbiAgY3Vyc29yOiBwb2ludGVyO1xuICBmb250LXNpemU6IDExcHg7XG4gIHBhZGRpbmc6IDJweCA0cHg7XG4gIGJvcmRlci1yYWRpdXM6IDRweDtcbn1cbi5kZW1vLWNsb3NlOmhvdmVyIHtcbiAgY29sb3I6ICNlZjUzNTA7XG4gIGJhY2tncm91bmQ6IHJnYmEoMjM5LCA4MywgODAsIDAuMSk7XG59XG4uZGVtby1zdGF0cyB7XG4gIGRpc3BsYXk6IGZsZXg7XG4gIGdhcDogOHB4O1xuICBmbGV4LXdyYXA6IHdyYXA7XG4gIHBhZGRpbmc6IDRweCAwIDJweDtcbn1cbi5kZW1vLXN0YXQtY2FyZCB7XG4gIGJvcmRlcjogMXB4IHNvbGlkIHZhcigtLWJvcmRlcik7XG4gIGJvcmRlci1yYWRpdXM6IDhweDtcbiAgcGFkZGluZzogNnB4IDEycHg7XG4gIG1pbi13aWR0aDogOTBweDtcbiAgZGlzcGxheTogZmxleDtcbiAgZmxleC1kaXJlY3Rpb246IGNvbHVtbjtcbiAgZ2FwOiAycHg7XG59XG4uZGVtby1zdGF0LWNhcmQgc3BhbiB7XG4gIGZvbnQtc2l6ZTogOXB4O1xuICBjb2xvcjogdmFyKC0tdGV4dC1tdXRlZCk7XG4gIGZvbnQtd2VpZ2h0OiA3MDA7XG4gIGxldHRlci1zcGFjaW5nOiAwLjA0ZW07XG59XG4uZGVtby1zdGF0LWNhcmQgYiB7XG4gIGZvbnQtc2l6ZTogMTNweDtcbiAgY29sb3I6IHZhcigtLXRleHQpO1xuICBmb250LXZhcmlhbnQtbnVtZXJpYzogdGFidWxhci1udW1zO1xufVxuLmRlbW8tc3RhdC1jYXJkIC5wb3Mge1xuICBjb2xvcjogIzI2YTY5YTtcbn1cbi5kZW1vLXN0YXQtY2FyZCAubmVnIHtcbiAgY29sb3I6ICNlZjUzNTA7XG59XG4ucnAtc2VwIHtcbiAgd2lkdGg6IDFweDtcbiAgaGVpZ2h0OiAxOHB4O1xuICBiYWNrZ3JvdW5kOiB2YXIoLS1ib3JkZXIpO1xuICBmbGV4LXNocmluazogMDtcbn1cbjwvc3R5bGU+XG4iXSwiZmlsZSI6IkM6L1VzZXJzL0FGUkFBL0Rlc2t0b3AvVHJhZGVyS29tYWsuaXIvdHJhZGVya29tYWsvYXBwcy93ZWIvc3JjL2NvbXBvbmVudHMvQ2hhcnRQYW5lLnZ1ZSJ9