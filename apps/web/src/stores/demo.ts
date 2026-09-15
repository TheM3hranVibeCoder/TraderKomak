/**
 * Demo trading (paper trading) store.
 *
 * The account starts at $100,000. Trades are placed on the active chart
 * (market or limit), sized in one of three modes:
 *   - "lot":     manual lot size; SL distance from the entered $ risk
 *   - "percent": risk = % of balance; lot derives from the SL distance
 *   - "usd":     risk = entered $ amount; lot derives from the SL distance
 * Fills and TP/SL exits are processed against the live price of the ACTIVE
 * symbol (other symbols' positions update the next time their symbol
 * becomes active). In replay mode the ChartPane feeds the replay price via
 * processReplayPrice(), and stepping backward past a trade's entry deletes
 * the whole trade.
 */
import { defineStore } from "pinia";
import { ref, computed, watch } from "vue";
import { useMarketStore } from "@/stores/market";
import { useReplayStore } from "@/stores/replay";
import { instrumentPrecision, oandaDailyBucketStart, providerOf } from "@traderkomak/shared";

export type DemoSide = "long" | "short";
export type DemoStatus = "pending" | "open" | "closed";
export type DemoKind = "market" | "limit";
export type DemoSizeMode = "lot" | "percent" | "usd";

/** MT5-style contract value: the $ value of a 1.0 price move for 1.0 lot.
 *  Forex (non-JPY quote) 100,000; JPY-quoted 100,000/rate; XAU 100;
 *  XAG 5,000; crypto/indices/energy 1. */
const CRYPTO_BASES = new Set(["BTC", "ETH"]);
export function demoValuePerPrice(symbol: string, price: number): number {
  const norm = symbol.toUpperCase();
  if (norm.endsWith("_JPY")) return 100000 / price;
  if (norm === "XAU_USD") return 100;
  if (norm === "XAG_USD") return 5000;
  const [base] = norm.split("_");
  if (CRYPTO_BASES.has(base ?? "")) return 1;
  if (/^[A-Z]{3}_[A-Z]{3}$/.test(norm)) return 100000;
  return 1;
}

export interface DemoPosition {
  id: string;
  symbol: string;
  direction: DemoSide;
  kind: DemoKind;
  lot: number;
  entry: number;
  sl: number | null;
  tp: number | null;
  openTime: number;
  status: DemoStatus;
  /** pending-limit activation boundary */
  trigger?: number;
  closePrice?: number;
  closeTime?: number;
  closeReason?: "tp" | "sl" | "manual";
  pnl?: number;
  pnlPct?: number;
  /** last processed price for this symbol (for frozen P/L display) */
  lastPrice?: number;
}

const STORAGE_KEY = "tk-demo-trading";
const START_BALANCE = 100000;

function load(): { positions: DemoPosition[]; balance: number } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { positions: DemoPosition[]; balance: number };
      const positions = Array.isArray(parsed.positions)
        ? parsed.positions.filter(
            (p) => p && typeof p.id === "string" && typeof p.entry === "number"
          )
        : [];
      return { positions, balance: typeof parsed.balance === "number" ? parsed.balance : START_BALANCE };
    }
  } catch {}
  return { positions: [], balance: START_BALANCE };
}

export const useDemoStore = defineStore("demo", () => {
  const initial = load();
  const active = ref(false);
  const positions = ref<DemoPosition[]>(initial.positions);
  const balance = ref(initial.balance);

  /** Trading form state (persisted so the inputs survive reloads). */
  const lot = ref(0.1);
  const riskUsd = ref(100);
  const rewardUsd = ref(200);
  const sizeMode = ref<DemoSizeMode>("lot");
  const riskPct = ref(1);

  const error = ref<string | null>(null);

  function persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ positions: positions.value, balance: balance.value }));
    } catch {}
  }

  function precisionOf(symbol: string): number {
    try {
      return instrumentPrecision(symbol);
    } catch {
      return 5;
    }
  }

  const nowSec = () => Math.floor(Date.now() / 1000);

  /** The $ risk for the stop loss, per the selected sizing mode. */
  function riskAmount(): number {
    if (sizeMode.value === "percent") return +((balance.value * riskPct.value) / 100).toFixed(2);
    return riskUsd.value;
  }

  function placeOrder(
    symbol: string,
    direction: DemoSide,
    kind: DemoKind,
    entry: number,
    sl: number | null,
    tp: number | null
  ): DemoPosition | null {
    error.value = null;
    const long = direction === "long";
    const market = useMarketStore();
    if (kind === "market") {
      // market order: fills at the current price — in replay mode that is
      // the price AT the replay boundary, not the live price
      const co = replay.cutoff;
      let px = entry;
      if (replay.active && co !== null) {
        const shown = market.candles.filter((c) => c.time <= co);
        if (shown.length) px = shown[shown.length - 1]!.close;
      } else {
        const c = market.candles;
        if (c.length) px = c[c.length - 1]!.close;
      }
      entry = px;
    }
    // Position size: in lot mode the manual lot is used as-is; in percent/usd
    // modes the lot derives from the $ risk and the SL distance.
    let lotEff = +(lot.value).toFixed(2);
    const risk = riskAmount();
    if (sizeMode.value !== "lot" && sl !== null) {
      const dist = Math.abs(entry - sl) * demoValuePerPrice(symbol, entry);
      lotEff = dist > 0 ? Math.min(100, Math.max(0.01, +(risk / dist).toFixed(2))) : lot.value;
    }
    if (!(lotEff > 0)) {
      error.value = "Position size must be positive";
      return null;
    }
    if (sl !== null && ((long && sl >= entry) || (!long && sl <= entry))) {
      error.value = long ? "SL must be below entry for a long" : "SL must be above entry for a short";
      return null;
    }
    if (tp !== null && ((long && tp <= entry) || (!long && tp >= entry))) {
      error.value = long ? "TP must be above entry for a long" : "TP must be below entry for a short";
      return null;
    }
    const full: DemoPosition = {
      id: `demo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      symbol,
      direction,
      kind,
      lot: lotEff,
      entry: +entry.toFixed(precisionOf(symbol)),
      sl: sl !== null ? +sl.toFixed(precisionOf(symbol)) : null,
      tp: tp !== null ? +tp.toFixed(precisionOf(symbol)) : null,
      openTime: nowSec(),
      status: kind === "limit" ? "pending" : "open",
    };
    positions.value.push(full);
    persist();
    return full;
  }

  function closeAtMarket(id: string): void {
    const p = positions.value.find((x) => x.id === id);
    if (!p || p.status !== "open") return;
    const market = useMarketStore();
    const c = market.candles;
    const px = c.length ? c[c.length - 1]!.close : p.entry;
    closePosition(p, px, "manual");
  }

  function removePending(id: string): void {
    positions.value = positions.value.filter((x) => x.id !== id);
    persist();
  }

  function updateLevel(id: string, level: "entry" | "sl" | "tp", price: number): void {
    const p = positions.value.find((x) => x.id === id);
    if (!p) return;
    // A filled position's entry is fixed — only pending orders can move it.
    if (level === "entry" && p.status === "open") return;
    const prec = precisionOf(p.symbol);
    const long = p.direction !== "short";
    let v = +price.toFixed(prec);
    // Ignore absurd drags (chart extrapolation, fast cursor exits) and
    // physically impossible levels (>10× or <1/10 of entry — e.g. 99999
    // on XAU/USD can only come from a degenerate price projection).
    if (!Number.isFinite(v) || v <= 0) return;
    if (p.entry) {
      if (v > p.entry * 10 || v < p.entry / 10) return;
    }
    // Keep SL on the loss side and TP on the profit side of the entry —
    // dragging a line across the entry corrupts the position's risk math.
    const tick = Math.pow(10, -prec);
    if (level === "sl") v = long ? Math.min(v, p.entry - tick) : Math.max(v, p.entry + tick);
    if (level === "tp") v = long ? Math.max(v, p.entry + tick) : Math.min(v, p.entry - tick);
    p[level] = v;
    // The lot NEVER changes on a level drag. Risk-based sizing (%, $)
    // happens exactly once — when the order is placed (placeOrder derives
    // the lot from the SL distance at that moment). Dragging the SL later,
    // on a pending order or a filled position, only moves the level; the
    // size stays what it was chosen as. (Recomputing here silently turned
    // a $100 trade into 60 lots whenever the SL was dragged near entry.)
    persist();
  }

  function closePosition(p: DemoPosition, price: number, reason: "tp" | "sl" | "manual"): void {
    const pnl = pnlFor(p, price);
    p.status = "closed";
    p.closePrice = price;
    p.closeTime = nowSec();
    p.closeReason = reason;
    p.pnl = +pnl.toFixed(2);
    p.pnlPct = +(((price - p.entry) * (p.direction === "long" ? 1 : -1)) / p.entry * 100).toFixed(2);
    balance.value = +(balance.value + pnl).toFixed(2);
    persist();
  }

  /** MT5-style floating P/L in $: (price − entry) × direction × lot × contract value. */
  function pnlFor(p: DemoPosition, price: number): number {
    const dirMult = p.direction === "long" ? 1 : -1;
    return (price - p.entry) * dirMult * p.lot * demoValuePerPrice(p.symbol, p.entry);
  }

  /* ── Live processing: fills + TP/SL exits against the current price ── */

  const market = useMarketStore();
  const replay = useReplayStore();
  const lastPrice = computed(() => {
    const c = market.candles;
    return c.length ? c[c.length - 1]!.close : null;
  });

  function processPrice(price: number, symbol: string, force = false): void {
    if (!force && (!active.value || replay.active)) return;
    const prec = precisionOf(symbol);
    const px = +price.toFixed(prec);
    let changed = false;

    for (const p of positions.value) {
      if (p.symbol !== symbol) continue;
      const long = p.direction === "long";
      p.lastPrice = px;

      if (p.status === "pending" && p.kind === "limit") {
        const touched = long ? px <= p.entry : px >= p.entry;
        if (touched) {
          p.status = "open";
          changed = true;
        }
        continue;
      }
      if (p.status !== "open") continue;

      // take profit
      if (p.tp !== null && (long ? px >= p.tp : px <= p.tp)) {
        closePosition(p, p.tp, "tp");
        changed = true;
        continue;
      }
      // stop loss
      if (p.sl !== null && (long ? px <= p.sl : px >= p.sl)) {
        closePosition(p, p.sl, "sl");
        changed = true;
      }
    }
    if (changed) persist();
  }

  /** Live market closed (weekend / daily break) — order buttons go inert.
   *  DST-aware: the FX week runs Sunday 5pm New York → Friday 5pm New York
   *  (oandaDailyBucketStart yields those boundaries). Metals (XAU/XAG) also
   *  take a 1-hour break right after each session open (5–6pm NY), which is
   *  why gold opens an hour later than forex on Sunday evenings. */
  function isClosed(symbol = market.instrument): boolean {
    // Crypto trades 24/7 — never closed
    if (providerOf(symbol) === "binance") return false;
    if (providerOf(symbol) === "dukascopy" && symbol.includes("BTC")) return false;
    const now = Date.now();
    const DAY = 86400000;
    const mid = Math.floor(now / DAY) * DAY;
    const sundayMid = mid - new Date(mid).getUTCDay() * DAY;
    // Anchor INSIDE the Sunday session (22:00 UTC is always after the Sun
    // 5pm-NY open) — Sunday noon itself resolves to Saturday's session,
    // which OANDA doesn't trade, shifting the whole week a day early.
    const weekOpen = oandaDailyBucketStart(sundayMid + 22 * 3600000);
    // Week closes after FIVE daily sessions: Sun 5pm NY → Mon → Tue → Wed
    // → Thu → Fri 5pm NY. (The old bucketStart(Fri noon) call returned
    // THURSDAY's session start — a day early — making Friday show CLOSED.)
    const weekClose = weekOpen + 5 * DAY;
    if (now < weekOpen || now >= weekClose) return true;
    const norm = symbol.toUpperCase();
    if (norm === "XAU_USD" || norm === "XAG_USD") {
      if (now - oandaDailyBucketStart(now) < 3600000) return true; // 5–6pm NY break
    }
    return false;
  }

  /** Replay mode: process the price at the replay boundary. */
  function processReplayPrice(price: number, symbol: string): void {
    processPrice(price, symbol, true);
  }

  /** Replay mode, forward step: the WHOLE newly revealed candle can touch
   *  levels with its wick — pending limits fill on high/low, open
   *  positions exit on high/low (SL checked first when both are touched
   *  inside one candle). */
  function processReplayCandle(
    candle: { high: number; low: number; close: number },
    symbol: string
  ): void {
    if (!active.value) return;
    const prec = precisionOf(symbol);
    const px = +candle.close.toFixed(prec);
    let changed = false;
    for (const p of positions.value) {
      if (p.symbol !== symbol) continue;
      const long = p.direction === "long";
      p.lastPrice = px;
      if (p.status === "pending" && p.kind === "limit") {
        if (long ? candle.low <= p.entry : candle.high >= p.entry) {
          p.status = "open";
          changed = true;
        }
        continue;
      }
      if (p.status !== "open") continue;
      if (p.sl !== null && (long ? candle.low <= p.sl : candle.high >= p.sl)) {
        closePosition(p, p.sl, "sl");
        changed = true;
        continue;
      }
      if (p.tp !== null && (long ? candle.high >= p.tp : candle.low <= p.tp)) {
        closePosition(p, p.tp, "tp");
        changed = true;
      }
    }
    if (changed) persist();
  }

  /** Replay backward past a trade's entry → the whole trade is deleted. */
  function deleteBeyond(cutoff: number, symbol: string): void {
    const before = positions.value.length;
    const kept = positions.value.filter((p) => p.symbol !== symbol || p.entry <= cutoff);
    if (kept.length !== before) {
      positions.value = kept;
      persist();
    }
  }

  watch(lastPrice, (price) => {
    if (price === null || replay.active) return;
    processPrice(price, market.instrument);
  });
  watch(
    () => market.instrument,
    (symbol) => {
      const c = market.candles;
      if (c.length) processPrice(c[c.length - 1]!.close, symbol);
    }
  );

  /* ── Account metrics ───────────────────────────────────────────────── */

  const openPositions = computed(() => positions.value.filter((p) => p.status === "open"));
  const closedPositions = computed(() => positions.value.filter((p) => p.status === "closed"));

  const unrealized = computed(() => {
    const px = lastPrice.value;
    if (px === null) return 0;
    let total = 0;
    for (const p of openPositions.value) {
      const price = p.symbol === market.instrument ? px : (p.lastPrice ?? p.entry);
      total += pnlFor(p, price);
    }
    return +total.toFixed(2);
  });

  const equity = computed(() => +(balance.value + unrealized.value).toFixed(2));

  const tradedSymbols = computed(() => [...new Set(positions.value.map((p) => p.symbol))]);

  /** Summary for a period: "day" | "week" | "month" | "all". */
  function summaryFor(period: "day" | "week" | "month" | "all") {
    const now = nowSec() * 1000;
    const span = period === "day" ? 86400000 : period === "week" ? 7 * 86400000 : period === "month" ? 30 * 86400000 : Infinity;
    const closed = closedPositions.value.filter((p) => (p.closeTime ?? 0) * 1000 >= now - span);
    const wins = closed.filter((p) => (p.pnl ?? 0) > 0);
    const losses = closed.filter((p) => (p.pnl ?? 0) < 0);
    const grossProfit = wins.reduce((s, p) => s + (p.pnl ?? 0), 0);
    const grossLoss = Math.abs(losses.reduce((s, p) => s + (p.pnl ?? 0), 0));
    return {
      trades: closed.length,
      wins: wins.length,
      winrate: closed.length ? +((wins.length / closed.length) * 100).toFixed(1) : 0,
      profit: +closed.reduce((s, p) => s + (p.pnl ?? 0), 0).toFixed(2),
      profitFactor: grossLoss > 0 ? +(grossProfit / grossLoss).toFixed(2) : grossProfit > 0 ? null : 0,
      grossProfit: +grossProfit.toFixed(2),
      grossLoss: +grossLoss.toFixed(2),
      /** P/L as % of the balance before the period's trades */
      profitPct: closed.length ? +((closed.reduce((s, p) => s + (p.pnl ?? 0), 0) / Math.max(1, balance.value - closed.reduce((s, p) => s + (p.pnl ?? 0), 0))) * 100).toFixed(2) : 0,
    };
  }

  function resetAccount(): void {
    positions.value = [];
    balance.value = START_BALANCE;
    persist();
  }

  return {
    active,
    positions,
    balance,
    equity,
    unrealized,
    openPositions,
    closedPositions,
    tradedSymbols,
    lot,
    riskUsd,
    rewardUsd,
    sizeMode,
    riskPct,
    error,
    lastPrice,
    riskAmount,
    pnlFor,
    placeOrder,
    closeAtMarket,
    removePending,
    updateLevel,
    processPrice,
    processReplayPrice,
    processReplayCandle,
    isClosed,
    deleteBeyond,
    summaryFor,
    resetAccount,
    persist,
  };
});
