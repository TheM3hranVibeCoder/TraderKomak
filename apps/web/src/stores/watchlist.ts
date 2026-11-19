import { defineStore } from "pinia";
import { ref, watch } from "vue";
import { SEARCHABLE_INSTRUMENTS, displayInstrument, normalizeInstrument } from "@traderkomak/shared";
import { useAuthStore } from "@/stores/auth";

const STORAGE_KEY = "tk-watchlist";
const DEFAULT_WATCH = [
  "XAU_USD",
  "XAG_USD",
  "SPX500_USD",
  "NAS100_USD",
  "BTCUSDT",
  "ETHUSDT",
  "EUR_USD",
  "GBP_USD",
  "US30",
];

/** Stock-index rows added to EVERY existing watchlist (once, per user
 *  request): OANDA's SPX500/NAS100 plus cTrader's US30 — appended without
 *  touching the symbols the user already picked. A localStorage flag marks
 *  the migration done so a symbol the user deliberately removes afterwards
 *  never comes back on the next boot. */
const INDEX_DEFAULTS = ["SPX500_USD", "NAS100_USD", "US30"];
/** Guests use the bare key; signed-in users get a PER-ACCOUNT key — a cloud
 *  row that predates the index defaults must get them appended exactly once
 *  per account (the old single shared key was consumed by the local load
 *  before the cloud row replaced the list, so signed-in users never saw the
 *  new rows — the "SPX500/NAS100 missing from my watchlist" report). */
const INDEX_MIGRATION_FLAG = "tk-watchlist-idx-migrated";
const WATCH_CAP = 25;

function migrationFlagKey(owner: string | null): string {
  return owner ? `${INDEX_MIGRATION_FLAG}:${owner}` : INDEX_MIGRATION_FLAG;
}

/** Crypto rows moved from the OANDA pairs to the Binance spot pairs —
 *  migrate stored lists once so existing users see the new rows too. */
const MIGRATIONS: Record<string, string> = { BTC_USD: "BTCUSDT", ETH_USD: "ETHUSDT" };

function loadWatch(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const migrated = parsed
          .filter((x): x is string => typeof x === "string")
          .map((x) => MIGRATIONS[x] ?? x);
        // Keep the migration idempotent without rewriting history every load
        if (parsed.some((x: string) => MIGRATIONS[x])) {
          try { localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated)); } catch {}
        }
        return migrated;
      }
    }
  } catch {}
  return [...DEFAULT_WATCH];
}

export interface WatchItem {
  instrument: string;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  change: number | null;
  changePercent: number | null;
  prevClose: number | null;
}

export const useWatchlistStore = defineStore("watchlist", () => {
  const instruments = ref<string[]>(loadWatch());
  const prices = ref<Map<string, WatchItem>>(new Map());
  const isOpen = ref<boolean>(localStorage.getItem("tk-watchlist-open") !== "false");

  // Initialize prices map
  for (const inst of instruments.value) {
    prices.value.set(inst, {
      instrument: inst,
      bid: null,
      ask: null,
      mid: null,
      change: null,
      changePercent: null,
      prevClose: null,
    });
  }

  watch(
    instruments,
    (v) => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
      } catch {}
      // Ensure prices map has entries
      for (const inst of v) {
        if (!prices.value.has(inst)) {
          prices.value.set(inst, {
            instrument: inst,
            bid: null,
            ask: null,
            mid: null,
            change: null,
            changePercent: null,
            prevClose: null,
          });
        }
      }
      // Remove old
      for (const k of [...prices.value.keys()]) {
        if (!v.includes(k)) prices.value.delete(k);
      }
      prices.value = new Map(prices.value);
    },
    { deep: true }
  );

  watch(isOpen, (v) => {
    try { localStorage.setItem("tk-watchlist-open", String(v)); } catch {}
  });

  function add(instrument: string) {
    const norm = normalizeInstrument(instrument);
    if (!SEARCHABLE_INSTRUMENTS.includes(norm as never)) return false;
    if (instruments.value.includes(norm)) return false;
    if (instruments.value.length >= WATCH_CAP) return false;
    instruments.value = [...instruments.value, norm];
    return true;
  }

  function remove(instrument: string) {
    const norm = normalizeInstrument(instrument);
    instruments.value = instruments.value.filter((x) => x !== norm);
  }

  function toggle() {
    isOpen.value = !isOpen.value;
  }

  function updatePrice(instrument: string, bid: number | null, ask: number | null, mid: number | null, timestamp: number) {
    const norm = normalizeInstrument(instrument);
    let item = prices.value.get(norm);
    if (!item) {
      // Not in watchlist but we still track if needed
      return;
    }
    // Calculate change vs prevClose if available, else vs first mid
    let change: number | null = null;
    let changePercent: number | null = null;
    if (item.prevClose !== null && mid !== null) {
      change = mid - item.prevClose;
      changePercent = item.prevClose !== 0 ? (change / item.prevClose) * 100 : null;
    } else if (item.mid !== null && mid !== null) {
      // First change
      change = mid - item.mid;
      changePercent = item.mid !== 0 ? (change / item.mid) * 100 : null;
    }
    // Update prevClose lazily: if we have no prevClose and we have a mid, set it after first update
    // For now, keep prevClose as first mid seen
    if (item.prevClose === null && item.mid !== null && mid !== null) {
      // keep existing mid as prevClose reference
    } else if (item.prevClose === null && mid !== null) {
      // Will set prevClose on next tick
    }

    const next: WatchItem = {
      instrument: norm,
      bid,
      ask,
      mid,
      change,
      changePercent,
      prevClose: item.prevClose ?? item.mid,
    };
    // If prevClose is still null and we have mid, set it
    if (next.prevClose === null && mid !== null) next.prevClose = mid;

    prices.value.set(norm, next);
    prices.value = new Map(prices.value);
  }

  function setPrevClose(instrument: string, close: number) {
    const norm = normalizeInstrument(instrument);
    const item = prices.value.get(norm);
    if (item) {
      item.prevClose = close;
      prices.value.set(norm, { ...item });
      prices.value = new Map(prices.value);
    }
  }

  /**
   * Seeds a symbol with its last known price + previous daily close so
   * price and % change display immediately — even while the market is
   * closed and no ticks are flowing. Live ticks later overwrite `mid`.
   */
  function seedStaticQuote(instrument: string, lastPrice: number, prevDailyClose: number) {
    const norm = normalizeInstrument(instrument);
    const item = prices.value.get(norm);
    if (!item) return;
    // Don't clobber a live tick with a stale static value
    if (item.mid !== null) {
      // Only fill prevClose if missing
      if (item.prevClose === null && Number.isFinite(prevDailyClose)) {
        prices.value.set(norm, { ...item, prevClose: prevDailyClose });
        prices.value = new Map(prices.value);
      }
      return;
    }
    const change = lastPrice - prevDailyClose;
    const changePercent = prevDailyClose !== 0 ? (change / prevDailyClose) * 100 : null;
    prices.value.set(norm, {
      instrument: norm,
      bid: item.bid,
      ask: item.ask,
      mid: lastPrice,
      change,
      changePercent,
      prevClose: prevDailyClose,
    });
    prices.value = new Map(prices.value);
  }

  /** One-time index-defaults migration (SPX500/NAS100/US30), tracked per
   *  owner: guests use the device key, signed-in users a per-account key —
   *  so it applies once to whichever list ends up authoritative (local for
   *  guests, the cloud row for signed-in users) and afterwards respects
   *  removals. Returns true when the list changed. */
  function applyIndexMigrationOnce(owner: string | null): boolean {
    let migrated = false;
    try { migrated = localStorage.getItem(migrationFlagKey(owner)) === "1"; } catch {}
    if (migrated) return false;
    try { localStorage.setItem(migrationFlagKey(owner), "1"); } catch {}
    const missing = INDEX_DEFAULTS.filter((s) => !instruments.value.includes(s));
    const room = Math.max(0, WATCH_CAP - instruments.value.length);
    const add = missing.slice(0, room);
    if (add.length === 0) return false;
    instruments.value = [...instruments.value, ...add];
    return true;
  }

  // Guests get the migration when their (lack of) session is definitive;
  // signed-in users get it from the cloud-sync restore instead.
  const auth = useAuthStore();
  watch(
    () => auth.status,
    (s) => {
      if (s === "guest") applyIndexMigrationOnce(null);
    },
    { immediate: true }
  );

  return { instruments, prices, isOpen, add, remove, toggle, updatePrice, setPrevClose, seedStaticQuote, applyIndexMigrationOnce };
});
