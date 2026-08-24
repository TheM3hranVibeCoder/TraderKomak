import { describe, it, expect } from "vitest";
import { CandleAggregator, aggregateCandles } from "../src/market/aggregator";
import type { MarketTick } from "@traderkomak/shared";
import { bucketStart } from "@traderkomak/shared";

function tick(price: number, timeMs: number, instrument = "EUR_USD"): MarketTick {
  return { instrument, timestamp: timeMs, bid: price - 0.00005, ask: price + 0.00005, mid: price };
}

describe("CandleAggregator OHLC", () => {
  it("calculates open/high/low/close correctly", () => {
    const agg = new CandleAggregator("5s");
    const base = Date.parse("2026-01-01T09:30:00.000Z");
    const prices = [100, 101, 99, 100.5];
    let last = null;
    for (let i = 0; i < prices.length; i++) {
      const res = agg.apply(tick(prices[i]!, base + i * 200));
      if (res) last = res.candle;
    }
    expect(last).not.toBeNull();
    expect(last!.open).toBe(100);
    expect(last!.high).toBe(101);
    expect(last!.low).toBe(99);
    expect(last!.close).toBe(100.5);
  });

  it("creates new candle on timeframe boundary", () => {
    const agg = new CandleAggregator("5s");
    const t1 = Date.parse("2026-01-01T10:00:04.999Z");
    const t2 = Date.parse("2026-01-01T10:00:05.001Z");
    const r1 = agg.apply(tick(1.1, t1));
    expect(r1?.closed).toBeNull();
    expect(r1?.candle.time).toBe(bucketStart(t1, 5) / 1000);
    const r2 = agg.apply(tick(1.2, t2));
    expect(r2?.closed).not.toBeNull();
    expect(r2?.closed!.time).toBe(bucketStart(t1, 5) / 1000);
    expect(r2?.candle.time).toBe(bucketStart(t2, 5) / 1000);
    expect(r2?.candle.open).toBe(1.2);
  });

  it("handles 1s timeframe with real boundaries", () => {
    const agg = new CandleAggregator("1s");
    const base = Date.parse("2026-01-01T09:30:00.000Z");
    const r1 = agg.apply(tick(1.0, base + 200));
    const r2 = agg.apply(tick(1.1, base + 700));
    expect(r1?.candle.time).toBe(r2?.candle.time);
    expect(r2?.candle.high).toBe(1.1);
    const r3 = agg.apply(tick(1.2, base + 1100));
    expect(r3?.closed).not.toBeNull();
    expect(r3?.candle.time).toBe(base / 1000 + 1);
  });

  it("ignores stale ticks older than active bucket", () => {
    const agg = new CandleAggregator("5s");
    const base = Date.parse("2026-01-01T10:00:00.000Z");
    agg.apply(tick(1.1, base + 6000)); // bucket 10:00:05
    const stale = agg.apply(tick(1.5, base + 1000)); // older bucket
    expect(stale).toBeNull();
    expect(agg.ignoredStaleTicks).toBe(1);
  });

  it("drops ticks with no usable price", () => {
    const agg = new CandleAggregator("5s");
    const base = Date.parse("2026-01-01T10:00:00.000Z");
    const bad: MarketTick = { instrument: "EUR_USD", timestamp: base, bid: null, ask: null, mid: null };
    expect(agg.apply(bad)).toBeNull();
  });

  it("prevents duplicate candles — same bucket updates, not duplicates", () => {
    const agg = new CandleAggregator("5s");
    const base = Date.parse("2026-01-01T10:00:00.000Z");
    agg.apply(tick(1.1, base + 100));
    agg.apply(tick(1.2, base + 200));
    agg.apply(tick(1.0, base + 300));
    const active = agg.active!;
    expect(active.open).toBe(1.1);
    expect(active.close).toBe(1.0);
    // Only one candle in this bucket, not three.
    expect(active.time).toBe(bucketStart(base, 5) / 1000);
  });

  it("seeds correctly when primed from history", () => {
    const agg = new CandleAggregator("5s");
    const nowBucket = bucketStart(Date.now(), 5) / 1000;
    agg.seed({ time: nowBucket, open: 1.1, high: 1.2, low: 1.0, close: 1.15 });
    expect(agg.active?.time).toBe(nowBucket);
    // Older seed ignored
    agg.seed({ time: nowBucket - 5, open: 1, high: 1, low: 1, close: 1 });
    expect(agg.active?.time).toBe(nowBucket);
  });
});

describe("aggregateCandles batch", () => {
  it("derives 10s candles from 5s candles", () => {
    const base = Date.parse("2026-01-01T10:00:00.000Z") / 1000;
    const source = [
      { time: base, open: 1.0, high: 1.1, low: 0.9, close: 1.05 },
      { time: base + 5, open: 1.05, high: 1.2, low: 1.0, close: 1.15 },
      { time: base + 10, open: 1.15, high: 1.3, low: 1.1, close: 1.25 },
    ];
    const out = aggregateCandles(source, 10);
    expect(out).toHaveLength(2);
    expect(out[0]!.time).toBe(base);
    expect(out[0]!.open).toBe(1.0);
    expect(out[0]!.high).toBe(1.2);
    expect(out[0]!.low).toBe(0.9);
    expect(out[0]!.close).toBe(1.15);
  });

  it("derives 30s from 5s", () => {
    const base = Date.parse("2026-01-01T10:00:00.000Z") / 1000;
    const source = Array.from({ length: 6 }, (_, i) => ({
      time: base + i * 5,
      open: 1 + i * 0.01,
      high: 1 + i * 0.01 + 0.005,
      low: 1 + i * 0.01 - 0.005,
      close: 1 + i * 0.01 + 0.002,
    }));
    const out = aggregateCandles(source, 30);
    expect(out).toHaveLength(1);
    expect(out[0]!.open).toBe(source[0]!.open);
    expect(out[0]!.close).toBe(source[5]!.close);
  });
});
