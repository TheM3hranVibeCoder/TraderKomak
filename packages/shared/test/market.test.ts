import { describe, it, expect } from "vitest";
import { resolveCandlePrice } from "../src/types/market";
import type { MarketTick } from "../src/types/market";

describe("resolveCandlePrice", () => {
  it("prefers mid when available", () => {
    const tick: MarketTick = { instrument: "EUR_USD", timestamp: 1, bid: 1.1, ask: 1.2, mid: 1.15 };
    expect(resolveCandlePrice(tick)).toBe(1.15);
  });

  it("falls back to bid when mid is null", () => {
    const tick: MarketTick = { instrument: "EUR_USD", timestamp: 1, bid: 1.1, ask: null, mid: null };
    expect(resolveCandlePrice(tick)).toBe(1.1);
  });

  it("falls back to ask when bid and mid are null", () => {
    const tick: MarketTick = { instrument: "EUR_USD", timestamp: 1, bid: null, ask: 1.2, mid: null };
    expect(resolveCandlePrice(tick)).toBe(1.2);
  });

  it("returns null when no price is available", () => {
    const tick: MarketTick = { instrument: "EUR_USD", timestamp: 1, bid: null, ask: null, mid: null };
    expect(resolveCandlePrice(tick)).toBeNull();
  });

  it("handles NaN mid safely", () => {
    const tick: MarketTick = { instrument: "EUR_USD", timestamp: 1, bid: 1.1, ask: 1.2, mid: NaN };
    expect(resolveCandlePrice(tick)).toBe(1.1);
  });
});
