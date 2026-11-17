/* ── Fixed Range Volume Profile math (pure, no reactive/DOM coupling) ──────
 * Sibling of chart/indicators.ts: takes the candles inside the profile
 * range (each with its traded volume, null when unrecorded) plus the row
 * count and Value-Area percentage, and returns the histogram rows with the
 * POC and Value Area bounds.
 *
 * The up/down distribution mirrors TradingView's "Volume Profile / Fixed
 * Range" script (LonesomeTheBlue, MPL 2.0): a candle's volume is split
 * between its BODY and its WICKS (weight 1 vs 2), the body volume is
 * attributed to the up or down side by candle direction, and the wick
 * volume is split 50/50 between the two sides. Each piece is spread across
 * the price rows its price segment overlaps, proportional to the overlap
 * length. */

export interface VpRow {
  /** Row's price interval [pLow, pHigh). */
  pLow: number;
  pHigh: number;
  /** Volume attributed to rising vs falling candles in this row. */
  up: number;
  down: number;
  /** up + down — the row's horizontal bar length. */
  total: number;
}

export interface VolumeProfile {
  rows: VpRow[];
  /** Largest row total — the histogram's horizontal scale denominator. */
  maxTotal: number;
  /** Sum of all row totals. */
  totalVolume: number;
  /** Index of the Point of Control in `rows` (-1 when the profile is empty). */
  poc: number;
  /** Value Area bounds: the top of the highest VA row / bottom of the lowest
   *  VA row (null when the profile is empty or `vaPercent` is 0). */
  vah: number | null;
  val: number | null;
  /** Row indexes inside the Value Area (POC is always included). */
  vaRows: Set<number>;
  /** True when at least one candle carried a recorded volume. */
  hasVolume: boolean;
}

/** One candle of the profile range: OHLC plus its traded volume
 *  (null when the volume sidecar has no entry for it). */
export interface VpCandle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

export interface VolumeProfileOptions {
  /** Histogram row count (price buckets). Clamped to 1–200. */
  rowCount: number;
  /** Value Area percentage of total volume (0–100). Default 70. */
  vaPercent?: number;
}

const EMPTY: VolumeProfile = {
  rows: [],
  maxTotal: 0,
  totalVolume: 0,
  poc: -1,
  vah: null,
  val: null,
  vaRows: new Set<number>(),
  hasVolume: false,
};

/** Overlap of [aLow, aHigh] with [bLow, bHigh] — the `get_vol` helper of the
 *  TV script (clamped to ≥ 0; caller divides by the segment height). */
function overlapLen(aLow: number, aHigh: number, bLow: number, bHigh: number): number {
  return Math.max(Math.min(Math.max(aLow, aHigh), Math.max(bLow, bHigh)) - Math.max(Math.min(aLow, aHigh), Math.min(bLow, bHigh)), 0);
}

/** Add `vol` × (overlap of [segLow, segHigh] with each row / segHeight) to
 *  the given side of every overlapped row. */
function addSegment(
  rows: VpRow[],
  segLow: number,
  segHigh: number,
  vol: number,
  toUp: boolean
): void {
  if (!(vol > 0) || segHigh <= segLow) return;
  const height = segHigh - segLow;
  const i0 = Math.max(0, Math.floor((segLow - rows[0]!.pLow) / (rows[0]!.pHigh - rows[0]!.pLow)));
  const i1 = Math.min(rows.length - 1, Math.floor((segHigh - rows[0]!.pLow) / (rows[0]!.pHigh - rows[0]!.pLow)));
  for (let i = i0; i <= i1; i++) {
    const row = rows[i]!;
    const len = overlapLen(segLow, segHigh, row.pLow, row.pHigh);
    if (len <= 0) continue;
    const share = (vol * len) / height;
    if (toUp) row.up += share;
    else row.down += share;
    row.total += share;
  }
}

/**
 * Build the profile over `candles` (already sliced to the fixed range).
 * Candles without a recorded volume are skipped — a partially-covered
 * range renders from the rows it has (the lazy backfill keeps shrinking
 * that gap), and a range with no volume at all returns `hasVolume: false`.
 */
export function computeVolumeProfile(candles: VpCandle[], opts: VolumeProfileOptions): VolumeProfile {
  const rowCount = Math.max(1, Math.min(200, Math.round(opts.rowCount)));
  const vaPercent = Math.max(0, Math.min(100, opts.vaPercent ?? 70));
  if (candles.length === 0 || !candles.some((c) => c.volume !== null && c.volume > 0)) {
    return { ...EMPTY, vaRows: new Set<number>() };
  }

  // Price extent of the range
  let hi = -Infinity;
  let lo = Infinity;
  for (const c of candles) {
    if (c.high > hi) hi = c.high;
    if (c.low < lo) lo = c.low;
  }
  if (!Number.isFinite(hi) || !Number.isFinite(lo)) return { ...EMPTY, vaRows: new Set<number>() };
  // Fully flat range (hi === lo): one effective price level — keep a tiny
  // span so every candle maps into row 0 without dividing by zero.
  const span = hi > lo ? hi - lo : Math.abs(hi) * 1e-9 || 1e-9;
  const rowH = span / rowCount;

  const rows: VpRow[] = [];
  for (let i = 0; i < rowCount; i++) {
    rows.push({ pLow: lo + i * rowH, pHigh: lo + (i + 1) * rowH, up: 0, down: 0, total: 0 });
  }

  for (const c of candles) {
    const v = c.volume;
    if (v === null || !(v > 0)) continue;
    const itsGreen = c.close >= c.open;
    const bodyTop = Math.max(c.close, c.open);
    const bodyBot = Math.min(c.close, c.open);
    const body = bodyTop - bodyBot;
    const topwick = c.high - bodyTop;
    const bottomwick = bodyBot - c.low;
    const denom = 2 * topwick + 2 * bottomwick + body;
    if (denom <= 0) {
      // Flat candle — all of its volume lands on the row holding its price,
      // attributed to its direction (degenerate case of the TV weighting).
      const i = Math.max(0, Math.min(rowCount - 1, Math.floor((c.low - lo) / rowH)));
      const row = rows[i]!;
      if (itsGreen) row.up += v;
      else row.down += v;
      row.total += v;
      continue;
    }
    const bodyVol = (body * v) / denom;
    const topWickVol = (2 * topwick * v) / denom;
    const bottomWickVol = (2 * bottomwick * v) / denom;
    // Body volume follows the candle's direction; each wick's volume is
    // split 50/50 between the two sides (the TV script's /2 on both).
    if (itsGreen) addSegment(rows, bodyBot, bodyTop, bodyVol, true);
    else addSegment(rows, bodyBot, bodyTop, bodyVol, false);
    addSegment(rows, bodyTop, c.high, topWickVol / 2, true);
    addSegment(rows, bodyTop, c.high, topWickVol / 2, false);
    addSegment(rows, c.low, bodyBot, bottomWickVol / 2, true);
    addSegment(rows, c.low, bodyBot, bottomWickVol / 2, false);
  }

  let totalVolume = 0;
  let maxTotal = 0;
  let poc = -1;
  for (let i = 0; i < rowCount; i++) {
    totalVolume += rows[i]!.total;
    if (rows[i]!.total > maxTotal) {
      maxTotal = rows[i]!.total;
      poc = i;
    }
  }
  if (poc < 0) return { ...EMPTY, vaRows: new Set<number>() };

  // Value Area: expand greedily from the POC, always absorbing the neighbor
  // with the larger volume (ties go UPWARD, like the TV script) until the
  // VA holds `vaPercent` of the total.
  const vaRows = new Set<number>([poc]);
  let vaVolume = rows[poc]!.total;
  const target = (totalVolume * vaPercent) / 100;
  let up = poc;
  let down = poc;
  while (vaVolume < target) {
    const volUp = up < rowCount - 1 ? rows[up + 1]!.total : 0;
    const volDown = down > 0 ? rows[down - 1]!.total : 0;
    if (volUp === 0 && volDown === 0) break;
    if (volUp >= volDown) {
      vaVolume += volUp;
      up++;
    } else {
      vaVolume += volDown;
      down--;
    }
    vaRows.add(up);
    vaRows.add(down);
  }

  let vah: number | null = null;
  let val: number | null = null;
  for (const i of vaRows) {
    const r = rows[i]!;
    if (vah === null || r.pHigh > vah) vah = r.pHigh;
    if (val === null || r.pLow < val) val = r.pLow;
  }

  return { rows, maxTotal, totalVolume, poc, vah, val, vaRows, hasVolume: totalVolume > 0 };
}
