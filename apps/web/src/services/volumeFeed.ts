/**
 * Volume sidecar — traded volume for the candles the chart displays.
 *
 * The shared `Candle` type is deliberately OHLC-only (wire protocol kept
 * untouched), so volume is captured where the browser already receives it
 * — Binance klines (base-asset volume), OANDA /candles (tick volume) — and
 * stored here in parallel, keyed by instrument+timeframe and the DISPLAYED
 * candle's time (already aggregated to the active timeframe, so the keys
 * line up 1:1 with the chart's candle times).
 *
 * The Fixed Range Volume Profile reads from this registry. A pair with no
 * entries for a timeframe (Dukascopy-only symbols; nothing fetched yet)
 * simply has no volume data — the indicator surfaces that as a hint.
 */

/** Matches the market store's series cap (MAX_SERIES) so the registry can
 *  never outgrow the candle series it mirrors. */
const REGISTRY_MAX = 20000;

const store = new Map<string, Map<number, number>>();

const keyOf = (instrument: string, timeframe: string): string => `${instrument}|${timeframe}`;

function trimTail(m: Map<number, number>): void {
  if (m.size <= REGISTRY_MAX) return;
  const times = [...m.keys()].sort((a, b) => a - b).slice(-REGISTRY_MAX);
  const trimmed = new Map<number, number>();
  for (const t of times) trimmed.set(t, m.get(t)!);
  m.clear();
  for (const [t, v] of trimmed) m.set(t, v);
}

/** Record volumes for displayed candles. `volumes` maps candle-time → volume;
 *  rows with a missing volume are simply absent (never zero-fill). */
export function recordVolumes(
  instrument: string,
  timeframe: string,
  volumes: Iterable<readonly [number, number]>
): void {
  const k = keyOf(instrument, timeframe);
  let m = store.get(k);
  if (!m) {
    m = new Map();
    store.set(k, m);
  }
  for (const [t, v] of volumes) {
    if (Number.isFinite(t) && Number.isFinite(v) && v > 0) m.set(t, v);
  }
  trimTail(m);
}

/** Volume of one displayed candle, or null when not recorded. */
export function getVolume(instrument: string, timeframe: string, time: number): number | null {
  const v = store.get(keyOf(instrument, timeframe))?.get(time);
  return v === undefined ? null : v;
}

/** True when the pair/timeframe has at least one recorded volume. */
export function hasVolumes(instrument: string, timeframe: string): boolean {
  const m = store.get(keyOf(instrument, timeframe));
  return !!m && m.size > 0;
}

/** How many of `times` are missing from the registry — drives the lazy
 *  backfill when a VP range covers candles whose volume was never fetched
 *  (localStorage-restored history, older lazy-loaded bars). */
export function missingCount(instrument: string, timeframe: string, times: number[]): number {
  const m = store.get(keyOf(instrument, timeframe));
  if (!m) return times.length;
  let n = 0;
  for (const t of times) if (!m.has(t)) n++;
  return n;
}

/** Drop one pair/timeframe (symbol switch housekeeping — keeps memory flat). */
export function forgetVolumes(instrument: string, timeframe: string): void {
  store.delete(keyOf(instrument, timeframe));
}
