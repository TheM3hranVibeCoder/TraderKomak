import { describe, it, expect } from "vitest";
import { toCandles, priceEventToTick, oandaTimeToSeconds } from "../src/oanda/adapter";

describe("oandaTimeToSeconds", () => {
  it("parses RFC3339", () => {
    expect(oandaTimeToSeconds("2026-01-01T10:00:00.000000000Z")).toBe(Date.parse("2026-01-01T10:00:00.000Z") / 1000);
  });
  it("returns null for malformed", () => {
    expect(oandaTimeToSeconds("not-a-date")).toBeNull();
    expect(oandaTimeToSeconds(null)).toBeNull();
  });
});

describe("toCandles", () => {
  it("converts complete OANDA candles to internal format", () => {
    const resp = {
      candles: [
        { complete: true, time: "2026-01-01T10:00:00.000000000Z", mid: { o: "1.10000", h: "1.10050", l: "1.09950", c: "1.10020" } },
        { complete: true, time: "2026-01-01T10:00:05.000000000Z", mid: { o: "1.10020", h: "1.10100", l: "1.10010", c: "1.10080" } },
        { complete: false, time: "2026-01-01T10:00:10.000000000Z", mid: { o: "1.10080", h: "1.10100", l: "1.10070", c: "1.10090" } },
      ],
    };
    const out = toCandles(resp);
    // The trailing INCOMPLETE candle is kept — it is the bucket currently
    // forming and is needed to seed the live aggregator on session start.
    expect(out).toHaveLength(3);
    expect(out[0]!.open).toBe(1.1);
    expect(out[1]!.close).toBe(1.1008);
    expect(out[2]!.time).toBe(Date.parse("2026-01-01T10:00:10.000Z") / 1000);
    expect(out[2]!.close).toBe(1.1009);
  });

  it("skips malformed rows without crashing", () => {
    const resp = {
      candles: [
        { complete: true, time: "bad", mid: { o: "1.0", h: "1.1", l: "0.9", c: "1.05" } },
        { complete: true, time: "2026-01-01T10:00:00.000000000Z", mid: { o: "not-a-price", h: "1.1", l: "0.9", c: "1.05" } },
        { complete: true, time: "2026-01-01T10:00:05.000000000Z", mid: { o: "1.0", h: "1.1", l: "0.9", c: "1.05" } },
      ],
    };
    const out = toCandles(resp);
    expect(out).toHaveLength(1);
  });

  it("deduplicates by time", () => {
    const t = "2026-01-01T10:00:00.000000000Z";
    const resp = {
      candles: [
        { complete: true, time: t, mid: { o: "1.0", h: "1.1", l: "0.9", c: "1.05" } },
        { complete: true, time: t, mid: { o: "1.0", h: "1.2", l: "0.8", c: "1.06" } },
      ],
    };
    const out = toCandles(resp);
    expect(out).toHaveLength(1);
    expect(out[0]!.high).toBe(1.2);
  });

  it("returns empty for missing candles array", () => {
    expect(toCandles({})).toEqual([]);
    expect(toCandles({ candles: null as unknown as [] })).toEqual([]);
  });
});

describe("priceEventToTick", () => {
  it("normalizes PRICE events", () => {
    const msg = {
      type: "PRICE",
      instrument: "EUR_USD",
      time: "2026-01-01T10:00:00.123456789Z",
      bids: [{ price: "1.10000" }],
      asks: [{ price: "1.10020" }],
      status: "tradeable",
    };
    const tick = priceEventToTick(msg);
    expect(tick).not.toBeNull();
    expect(tick!.instrument).toBe("EUR_USD");
    expect(tick!.mid).toBeCloseTo(1.1001);
    expect(tick!.bid).toBe(1.1);
    expect(tick!.ask).toBe(1.1002);
  });

  it("returns null for HEARTBEAT", () => {
    expect(priceEventToTick({ type: "HEARTBEAT", time: "2026-01-01T10:00:00Z" })).toBeNull();
  });

  it("drops events with no usable price", () => {
    const msg = { type: "PRICE", instrument: "EUR_USD", time: "2026-01-01T10:00:00Z", bids: [], asks: [] };
    expect(priceEventToTick(msg)).toBeNull();
  });

  it("handles malformed JSON safely", () => {
    expect(priceEventToTick(null)).toBeNull();
    expect(priceEventToTick("string")).toBeNull();
    expect(priceEventToTick({ type: "PRICE" })).toBeNull();
  });

  it("handles single-sided prices", () => {
    const msg = {
      type: "PRICE",
      instrument: "EUR_USD",
      time: "2026-01-01T10:00:00Z",
      bids: [{ price: "1.1" }],
      asks: [],
    };
    const tick = priceEventToTick(msg);
    expect(tick?.bid).toBe(1.1);
    expect(tick?.mid).toBeNull();
  });
});
