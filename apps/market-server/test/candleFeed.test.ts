import { describe, it, expect, vi } from "vitest";
import { CandleFeed, type HistorySource } from "../src/market/candleFeed";
import type { Candle, MarketTick } from "@traderkomak/shared";

const TF = 5; // 5s session

function tick(price: number, ms: number): MarketTick {
  return { instrument: "EUR_USD", timestamp: ms, bid: price - 0.00005, ask: price + 0.00005, mid: price };
}

/** Aligns to a 5s bucket boundary so tests are time-independent. */
const BASE = Math.floor(Date.now() / (TF * 1000)) * TF * 1000 + TF * 1000 * 40; // 40 buckets in the future

describe("CandleFeed reconciliation", () => {
  it("replaces the stream-subset closed candle with the authoritative one", async () => {
    // Bucket B (BASE..BASE+5s): authoritative close = 1.1050
    // Our stream subset only saw up to 1.1040 → mismatch to be corrected.
    const authCandle: Candle = {
      time: BASE / 1000,
      open: 1.1000,
      high: 1.1050,
      low: 1.0995,
      close: 1.1050,
    };

    const getNativeCandles = vi.fn(
      async (
        _i: string,
        _t: string,
        count: number,
        toIso?: string
      ): Promise<Candle[]> => {
        // prime() call (count=2) → nothing to seed
        if (count >= 2) return [];
        // reconcile call (count=1, toIso inside bucket B) → authoritative
        if (toIso) return [authCandle];
        return [];
      }
    );

    const rest: HistorySource = { getNativeCandles };
    const feed = new CandleFeed(rest, { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} });

    const events: Array<{ closed: boolean; c: Candle }> = [];
    feed.on("candle", (e) => events.push({ closed: e.closed, c: e.candle }));

    feed.addSubscriber("EUR_USD", "5s");
    await vi.waitFor(() => {
      // priming settled once the first tick flows through
      feed.handleTick(tick(1.1000, BASE + 100));
      if (events.length === 0) throw new Error("priming not settled");
    });

    // Cross the boundary into the next bucket → closes bucket B
    events.length = 0;
    feed.handleTick(tick(1.1040, BASE + TF * 1000 - 100)); // last tick of B (subset close=1.1040)
    feed.handleTick(tick(1.1041, BASE + TF * 1000 + 100)); // first tick of B+1

    const closedFromTicks = events.find((e) => e.closed && e.c.time === BASE / 1000);
    expect(closedFromTicks).toBeTruthy();
    expect(closedFromTicks!.c.close).toBe(1.104); // subset value initially

    // Wait for reconciliation to swap in the authoritative close
    await vi.waitFor(() => {
      const corrected = events.find(
        (e) => e.closed && e.c.time === BASE / 1000 && e.c.close === 1.105
      );
      if (!corrected) throw new Error("authoritative close not applied yet");
    });

    // Buffer's last-but-one must now hold the authoritative OHLC
    const snap = feed.bufferSnapshot("EUR_USD", "5s", 10);
    const b = snap.find((c) => c.time === BASE / 1000)!;
    expect(b.close).toBe(1.105);
    expect(b.high).toBe(1.105);
  });

  it("tick-closed candle chains to the PREVIOUS bucket's close, not its own (no doji collapse)", async () => {
    const rest: HistorySource = { getNativeCandles: async () => [] };
    const feed = new CandleFeed(rest, { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} });

    const events: Array<{ closed: boolean; c: Candle }> = [];
    feed.on("candle", (e) => events.push({ closed: e.closed, c: e.candle }));

    feed.addSubscriber("EUR_USD", "5s");
    await vi.waitFor(() => {
      feed.handleTick(tick(1.2000, BASE + 100));
      if (events.length === 0) throw new Error("priming not settled");
    });

    // Bucket A: 1.2000 → 1.2000 (first bucket, no predecessor)
    // Bucket B: real intrabar movement 1.2010 → 1.2015 → 1.2005, closes at 1.2005
    events.length = 0;
    feed.handleTick(tick(1.2000, BASE + TF * 1000 - 100)); // last tick of A
    feed.handleTick(tick(1.2010, BASE + TF * 1000 + 100)); // first tick of B
    feed.handleTick(tick(1.2015, BASE + TF * 1000 + 1500));
    feed.handleTick(tick(1.2005, BASE + TF * 1000 + 2500));
    feed.handleTick(tick(1.2007, BASE + TF * 2 * 1000 + 100)); // first tick of C → closes B

    const closedB = events.find((e) => e.closed && e.c.time === (BASE + TF * 1000) / 1000);
    expect(closedB).toBeTruthy();
    // open must chain to bucket A's close (1.2), NOT collapse onto B's own
    // close — o === c is the "live candles render as bodyless dojis" bug.
    expect(closedB!.c.open).toBe(1.2);
    expect(closedB!.c.close).toBe(1.2005);
    expect(closedB!.c.high).toBe(1.2015);
    expect(closedB!.c.open).not.toBe(closedB!.c.close);
  });
});
