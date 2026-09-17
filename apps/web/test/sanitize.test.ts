import { describe, it, expect } from "vitest";
import { sanitizeCandles } from "@/stores/market";
import type { Candle } from "@traderkomak/shared";

const c = (time: number, close = 1): Candle => ({ time, open: close, high: close, low: close, close });

describe("sanitizeCandles", () => {
  it("drops null/NaN rows (existing contract)", () => {
    const out = sanitizeCandles([
      c(1),
      { time: 2, open: NaN, high: 2, low: 2, close: 2 },
      c(3),
    ]);
    expect(out.map((x) => x.time)).toEqual([1, 3]);
  });

  it("sorts unordered input strictly ascending (LWC data contract)", () => {
    const out = sanitizeCandles([c(30), c(10), c(20)]);
    expect(out.map((x) => x.time)).toEqual([10, 20, 30]);
  });

  it("removes duplicate timestamps, keeping the last occurrence", () => {
    const out = sanitizeCandles([c(10, 1), c(20, 1), c(10, 5)]);
    expect(out.map((x) => x.time)).toEqual([10, 20]);
    expect(out[0]?.close).toBe(5);
  });

  it("returns an empty array for empty/garbage input", () => {
    expect(sanitizeCandles([])).toEqual([]);
    expect(sanitizeCandles([{ time: NaN, open: 1, high: 1, low: 1, close: 1 } as Candle])).toEqual([]);
  });
});
