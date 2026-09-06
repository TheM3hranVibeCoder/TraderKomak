/**
 * Demo trading (paper trading) store.
 *
 * The account starts at $100,000. Trades are placed on the active chart
 * (market or limit), sized by lot with $-risk (stop distance) and
 * $-reward (target distance). Fills and TP/SL exits are processed against
 * the live price of the ACTIVE symbol (other symbols' positions update
 * the next time their symbol becomes active).
 */
import { defineStore } from "pinia";
import { ref, computed, watch } from "vue";
import { useMarketStore } from "@/stores/market";
import { instrumentPrecision } from "@traderkomak/shared";

export type DemoSide = "long" | "short";
export type DemoStatus = "pending" | "open" | "closed";
export type DemoKind = "market" | "limit";

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

  function placeOrder(
    symbol: string,
    direction: DemoSide,
    kind: DemoKind,
    entry: number,
    sl: number | null,
    tp: number | null
  ): DemoPosition | null {
    error.value = null;
    if (!(lot.value > 0)) {
      error.value = "Lot size must be positive";
      return null;
    }
    const long = direction === "long";
    if (kind === "market") {
      // market order: fill immediately at the current price
      const market = useMarketStore();
      const c = market.candles;
      const px = c.length ? c[c.length - 1]!.close : entry;
      entry = px;
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
      lot: lot.value,
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
    const prec = precisionOf(p.symbol);
    p[level] = +price.toFixed(prec);
    persist();
  }

  function closePosition(p: DemoPosition, price: number, reason: "tp" | "sl" | "manual"): void {
    const dirMult = p.direction === "long" ? 1 : -1;
    const pnl = (price - p.entry) * dirMult * p.lot;
    p.status = "closed";
    p.closePrice = price;
    p.closeTime = nowSec();
    p.closeReason = reason;
    p.pnl = +pnl.toFixed(2);
    p.pnlPct = +(((price - p.entry) * dirMult) / p.entry * 100).toFixed(2);
    balance.value = +(balance.value + pnl).toFixed(2);
    persist();
  }

  /* ── Live processing: fills + TP/SL exits against the current price ── */

  const market = useMarketStore();
  const lastPrice = computed(() => {
    const c = market.candles;
    return c.length ? c[c.length - 1]!.close : null;
  });

  function processPrice(price: number, symbol: string): void {
    if (!active.value) return;
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

  watch(lastPrice, (price) => {
    if (price === null) return;
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
    const market = useMarketStore();
    const px = lastPrice.value;
    let total = 0;
    if (px === null) return 0;
    for (const p of openPositions.value) {
      const price = p.symbol === market.instrument ? px : (p.lastPrice ?? p.entry);
      total += (price - p.entry) * (p.direction === "long" ? 1 : -1) * p.lot;
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
    error,
    lastPrice,
    placeOrder,
    closeAtMarket,
    removePending,
    updateLevel,
    processPrice,
    summaryFor,
    resetAccount,
    persist,
  };
});
