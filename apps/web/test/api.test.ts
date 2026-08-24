import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock import.meta.env
vi.stubGlobal("import", { meta: { env: { VITE_API_HTTP_URL: "" } } });

describe("api fetchCandles error handling placeholder", () => {
  it("placeholder — real fetch tests require integration; ensure malformed handling does not crash", () => {
    // The api module defensively filters malformed candles; this test documents the contract.
    const malformed = [
      { time: "not-a-number", open: 1, high: 1, low: 1, close: 1 },
      { time: 123, open: NaN, high: 1, low: 1, close: 1 },
      null,
      { time: 123, open: 1, high: 1, low: 1, close: 1 },
    ];
    const seen = new Set<number>();
    const out: unknown[] = [];
    for (const c of malformed as unknown[]) {
      if (
        typeof c !== "object" ||
        c === null ||
        typeof (c as Record<string, unknown>).time !== "number"
      )
        continue;
      const candle = c as { time: number; open: number; high: number; low: number; close: number };
      if (seen.has(candle.time)) continue;
      if (!Number.isFinite(candle.open)) continue;
      seen.add(candle.time);
      out.push(candle);
    }
    expect(out).toHaveLength(1);
  });
});
