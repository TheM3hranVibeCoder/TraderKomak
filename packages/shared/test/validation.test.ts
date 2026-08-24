import { describe, it, expect } from "vitest";
import { parseClientMessage, isInstrument, isTimeframe } from "../src/validation";
import { SUPPORTED_INSTRUMENTS } from "../src/constants/instruments";
import { TIMEFRAMES } from "../src/constants/timeframes";

describe("isInstrument", () => {
  it("accepts canonical forms", () => {
    expect(isInstrument("EUR_USD")).toBe(true);
    expect(isInstrument("eur_usd")).toBe(true);
    expect(isInstrument("EUR/USD")).toBe(true);
    expect(isInstrument("eur-usd")).toBe(true);
    expect(isInstrument("  eur_usd  ")).toBe(true);
  });

  it("rejects unknown instruments", () => {
    expect(isInstrument("FAKE_PAIR")).toBe(false);
    expect(isInstrument("")).toBe(false);
    expect(isInstrument(123)).toBe(false);
    expect(isInstrument(null)).toBe(false);
  });

  it("covers all supported instruments", () => {
    for (const inst of SUPPORTED_INSTRUMENTS) {
      expect(isInstrument(inst)).toBe(true);
    }
  });
});

describe("isTimeframe", () => {
  it("accepts all supported timeframes", () => {
    for (const tf of TIMEFRAMES) {
      expect(isTimeframe(tf)).toBe(true);
    }
  });

  it("rejects invalid timeframes", () => {
    expect(isTimeframe("2s")).toBe(false);
    expect(isTimeframe("1M")).toBe(false);
    expect(isTimeframe("")).toBe(false);
    expect(isTimeframe(null)).toBe(false);
  });
});

describe("parseClientMessage", () => {
  it("parses valid subscribe", () => {
    const raw = JSON.stringify({ type: "subscribe", instrument: "EUR_USD", timeframe: "5s" });
    const res = parseClientMessage(raw);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.message).toEqual({ type: "subscribe", instrument: "EUR_USD", timeframe: "5s" });
    }
  });

  it("normalizes instrument in subscribe", () => {
    const raw = JSON.stringify({ type: "subscribe", instrument: "eur/usd", timeframe: "1m" });
    const res = parseClientMessage(raw);
    expect(res.ok).toBe(true);
    if (res.ok && res.message.type === "subscribe") {
      expect(res.message.instrument).toBe("EUR_USD");
    }
  });

  it("rejects unknown instrument", () => {
    const raw = JSON.stringify({ type: "subscribe", instrument: "FAKE", timeframe: "5s" });
    const res = parseClientMessage(raw);
    expect(res.ok).toBe(false);
  });

  it("rejects unknown timeframe", () => {
    const raw = JSON.stringify({ type: "subscribe", instrument: "EUR_USD", timeframe: "2m" });
    const res = parseClientMessage(raw);
    expect(res.ok).toBe(false);
  });

  it("parses unsubscribe", () => {
    const res = parseClientMessage(JSON.stringify({ type: "unsubscribe" }));
    expect(res.ok).toBe(true);
  });

  it("parses ping", () => {
    const res = parseClientMessage(JSON.stringify({ type: "ping" }));
    expect(res.ok).toBe(true);
  });

  it("rejects invalid JSON", () => {
    const res = parseClientMessage("{not json");
    expect(res.ok).toBe(false);
  });

  it("rejects missing type", () => {
    const res = parseClientMessage(JSON.stringify({ instrument: "EUR_USD" }));
    expect(res.ok).toBe(false);
  });

  it("rejects unknown type", () => {
    const res = parseClientMessage(JSON.stringify({ type: "bogus" }));
    expect(res.ok).toBe(false);
  });
});
