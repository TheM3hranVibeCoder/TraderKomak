import { describe, it, expect } from "vitest";
import {
  TIMEFRAME_SECONDS,
  NATIVE_HISTORY_GRANULARITY,
  nativeCandlesNeeded,
  bucketStart,
} from "../src/constants/timeframes";

describe("TIMEFRAME_SECONDS", () => {
  it("maps correctly", () => {
    expect(TIMEFRAME_SECONDS["1s"]).toBe(1);
    expect(TIMEFRAME_SECONDS["5s"]).toBe(5);
    expect(TIMEFRAME_SECONDS["10s"]).toBe(10);
    expect(TIMEFRAME_SECONDS["30s"]).toBe(30);
    expect(TIMEFRAME_SECONDS["1m"]).toBe(60);
  });
});

describe("NATIVE_HISTORY_GRANULARITY", () => {
  it("has null for 1s", () => {
    expect(NATIVE_HISTORY_GRANULARITY["1s"]).toBeNull();
  });
  it("maps 5s to S5 and 1m to M1", () => {
    expect(NATIVE_HISTORY_GRANULARITY["5s"]).toBe("S5");
    expect(NATIVE_HISTORY_GRANULARITY["1m"]).toBe("M1");
  });
});

describe("nativeCandlesNeeded", () => {
  it("returns 0 for 1s", () => {
    expect(nativeCandlesNeeded("1s", 500)).toBe(0);
  });
  it("calculates multiplier for 10s and 30s", () => {
    expect(nativeCandlesNeeded("10s", 100)).toBe(200); // 10/5 * 100
    expect(nativeCandlesNeeded("30s", 100)).toBe(600); // 30/5 *100
    expect(nativeCandlesNeeded("30s", 1000)).toBe(6000); // 30/5*1000=6000 (paginated, no cap)
  });
  it("returns count for 1m", () => {
    expect(nativeCandlesNeeded("1m", 250)).toBe(250);
  });
});

describe("bucketStart", () => {
  it("aligns 5s boundary correctly", () => {
    // 10:00:04.999 and 10:00:05.001 should be different buckets for 5s
    const t1 = Date.parse("2026-01-01T10:00:04.999Z");
    const t2 = Date.parse("2026-01-01T10:00:05.001Z");
    const b1 = bucketStart(t1, 5);
    const b2 = bucketStart(t2, 5);
    expect(b1).not.toBe(b2);
    expect(b1).toBe(Date.parse("2026-01-01T10:00:00.000Z"));
    expect(b2).toBe(Date.parse("2026-01-01T10:00:05.000Z"));
  });

  it("handles 1s boundaries", () => {
    const t = Date.parse("2026-01-01T10:00:00.700Z");
    expect(bucketStart(t, 1)).toBe(Date.parse("2026-01-01T10:00:00.000Z"));
  });

  it("handles 1m boundaries", () => {
    const t = Date.parse("2026-01-01T10:00:30.000Z");
    expect(bucketStart(t, 60)).toBe(Date.parse("2026-01-01T10:00:00.000Z"));
  });
});
