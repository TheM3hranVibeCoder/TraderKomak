import { describe, it, expect } from "vitest";
import { backoffDelayMs } from "../src/market/backoff";

describe("backoffDelayMs", () => {
  it("starts at base", () => {
    const d = backoffDelayMs(1, 1000, 30000);
    expect(d).toBeGreaterThanOrEqual(800);
    expect(d).toBeLessThanOrEqual(1200);
  });

  it("grows exponentially but caps", () => {
    const d10 = backoffDelayMs(10, 1000, 30000);
    expect(d10).toBeGreaterThanOrEqual(1000);
    expect(d10).toBeLessThanOrEqual(30000);

    const d20 = backoffDelayMs(20, 1000, 30000);
    expect(d20).toBeLessThanOrEqual(30000);
  });

  it("floors attempt at 1", () => {
    const d0 = backoffDelayMs(0, 1000, 30000);
    const d1 = backoffDelayMs(1, 1000, 30000);
    // Both should be in base range
    expect(d0).toBeGreaterThanOrEqual(800);
    expect(d1).toBeGreaterThanOrEqual(800);
  });

  it("never exceeds cap", () => {
    for (let i = 1; i <= 15; i++) {
      expect(backoffDelayMs(i, 1000, 5000)).toBeLessThanOrEqual(5000);
    }
  });

  it("never below base", () => {
    for (let i = 1; i <= 10; i++) {
      expect(backoffDelayMs(i, 2000, 30000)).toBeGreaterThanOrEqual(2000);
    }
  });
});
