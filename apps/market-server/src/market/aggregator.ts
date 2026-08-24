/**
 * Candle aggregation engine.
 *
 * PURE module: no framework, no I/O, no clock access. All boundaries are
 * derived from MarketTick timestamps (epoch ms), never from timers. This
 * makes the engine deterministic, fully unit-testable, and replaceable by
 * another implementation (e.g. a Rust service speaking the same WS
 * protocol) without touching anything else.
 *
 * Accuracy note (documented in README): OANDA's pricing stream is NOT
 * guaranteed to contain every underlying market price event. Generated
 * candles therefore represent the price events RECEIVED via OANDA's
 * stream — not every global market tick.
 */
import {
  TIMEFRAME_SECONDS,
  bucketStart,
  resolveCandlePrice,
  type Candle,
  type MarketTick,
  type Timeframe,
} from "@traderkomak/shared";

export interface ApplyResult {
  /** The active candle after applying the tick. */
  candle: Candle;
  /**
   * When the tick crossed a bucket boundary, the candle that was just
   * finalized. Exactly one `closed` candle is ever emitted per boundary.
   */
  closed: Candle | null;
}

export class CandleAggregator {
  private current: Candle | null = null;
  private staleTicksIgnored = 0;

  constructor(public readonly timeframe: Timeframe) {}

  get timeframeSeconds(): number {
    return TIMEFRAME_SECONDS[this.timeframe];
  }

  /** Active candle, if any. Treat as immutable — copy before mutation. */
  get active(): Readonly<Candle> | null {
    return this.current ? { ...this.current } : null;
  }

  /**
   * Seeds the aggregator with an already-complete or in-progress candle
   * (used when priming from historical data). The candle is adopted only
   * if it is newer than current state.
   */
  seed(candle: Candle): void {
    if (!Number.isFinite(candle.time) || !Number.isFinite(candle.close)) return;
    const expectedBucket = Math.floor(candle.time / this.timeframeSeconds) * this.timeframeSeconds;
    const normalized: Candle = { ...candle, time: expectedBucket };
    if (!this.current || normalized.time > this.current.time) {
      this.current = normalized;
    }
  }

  /**
   * Applies a tick. Boundary handling uses the tick timestamp:
   *
   *   09:30:00.000 → open new bucket candle
   *   09:30:00.700 → update close/high/low of that candle
   *   09:30:01.100 → finalize previous candle, open next bucket
   *
   * Ticks older than the active bucket (out-of-order/late delivery) are
   * ignored so history is never rewritten.
   */
  apply(tick: MarketTick): ApplyResult | null {
    const price = resolveCandlePrice(tick);
    if (price === null) return null; // no usable side — drop safely

    // bucketStart() yields the bucket boundary in epoch ms; candle times
    // are whole seconds, so convert once here.
    const time = bucketStart(tick.timestamp, this.timeframeSeconds) / 1000;

    if (this.current && time < this.current.time) {
      this.staleTicksIgnored++;
      return null;
    }

    if (!this.current || time > this.current.time) {
      const closed = this.current;
      this.current = { time, open: price, high: price, low: price, close: price };
      return { candle: { ...this.current }, closed: closed ? { ...closed } : null };
    }

    // same bucket → update active candle
    if (price > this.current.high) this.current.high = price;
    if (price < this.current.low) this.current.low = price;
    this.current.close = price;
    return { candle: { ...this.current }, closed: null };
  }

  get ignoredStaleTicks(): number {
    return this.staleTicksIgnored;
  }
}

/**
 * Batch aggregation of complete candles into a larger timeframe.
 * Used to derive 10s/30s history from native S5 data with exactly the
 * same bucket rules as the live engine.
 */
export function aggregateCandles(source: Candle[], timeframeSeconds: number): Candle[] {
  const out = new Map<number, Candle>();
  for (const c of source) {
    const time = Math.floor(c.time / timeframeSeconds) * timeframeSeconds;
    const existing = out.get(time);
    if (!existing) {
      out.set(time, { ...c, time });
    } else {
      existing.high = Math.max(existing.high, c.high);
      existing.low = Math.min(existing.low, c.low);
      existing.close = c.close;
    }
  }
  return [...out.values()].sort((a, b) => a.time - b.time);
}
