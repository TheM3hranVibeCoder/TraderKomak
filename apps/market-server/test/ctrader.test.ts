import { describe, it, expect } from "vitest";
import { scalePrice, trendbarToCandle, expandTickTimestamps, ticksToS5Candles, type RawTrendbar } from "../src/ctrader/adapter";
import { PT, M, decodeEnvelope, encodeEnvelope, encodeFrame, toNum } from "../src/ctrader/proto";
import { US30_ALIASES } from "../src/ctrader/symbols";

describe("scalePrice", () => {
  it("divides by 100000 and rounds to symbol digits", () => {
    // 4425025000 in protocol = 44250.25 (help.ctrader.com example format)
    expect(scalePrice(4425025000, 2)).toBe(44250.25);
    expect(scalePrice(700025000, 2)).toBe(7000.25);
    expect(scalePrice(123456789, 2)).toBe(1234.57); // rounds
  });
});

describe("trendbarToCandle", () => {
  const tb: RawTrendbar = {
    volume: 42,
    period: 8,
    low: 2750000000, // 27500.00
    deltaOpen: 12000, // +0.12
    deltaClose: 20000, // +0.20
    deltaHigh: 25000, // +0.25
    utcTimestampInMinutes: Math.floor(Date.UTC(2026, 0, 15, 10, 30) / 60000),
  };

  it("builds OHLC from the relative low + deltas", () => {
    const c = trendbarToCandle(tb, 2);
    expect(c).not.toBeNull();
    expect(c!.time).toBe(Date.UTC(2026, 0, 15, 10, 30) / 1000);
    expect(c!.open).toBe(27500.12);
    expect(c!.high).toBe(27500.25);
    expect(c!.low).toBe(27500);
    expect(c!.close).toBe(27500.2);
  });

  it("keeps high ≥ max(open, close) even with corrupt deltas", () => {
    const c = trendbarToCandle({ ...tb, deltaHigh: 100000 }, 2);
    expect(c).not.toBeNull();
    expect(c!.high).toBeGreaterThanOrEqual(Math.max(c!.open, c!.close));
  });

  it("returns null for rows without a timestamp or prices", () => {
    expect(trendbarToCandle({ ...tb, utcTimestampInMinutes: 0 }, 2)).toBeNull();
    expect(trendbarToCandle({ ...tb, low: Number.NaN }, 2)).toBeNull();
  });
});

describe("expandTickTimestamps", () => {
  it("expands first-absolute + subsequent-delta timestamps (newest first)", () => {
    // Server docs: the FIRST tick carries absolute epoch ms; every later
    // row carries the difference to the PREVIOUS tick (walking backwards).
    const rows = [
      { timestamp: 1_000_000, tick: 2750020000 },
      { timestamp: 500, tick: 2750010000 }, // 1_000_000 - 500
      { timestamp: 250, tick: 2750000000 }, // 999_500 - 250
    ];
    const out = expandTickTimestamps(rows);
    expect(out.map((t) => t.timeMs)).toEqual([1_000_000, 999_500, 999_250]);
  });

  it("skips rows that would produce non-positive times", () => {
    const rows = [
      { timestamp: 1000, tick: 2750020000 },
      { timestamp: 5000, tick: 2750010000 }, // would go negative — skipped
    ];
    expect(expandTickTimestamps(rows)).toHaveLength(1);
  });
});

describe("ticksToS5Candles", () => {
  it("buckets ticks into 5s candles; close is the LATEST tick", () => {
    // Prices are raw 1/100000 protocol values (27500.10 → 2750010000)
    const ticks = [
      { timeMs: 1_000, price: 2750010000 },
      { timeMs: 3_000, price: 2750050000 },
      { timeMs: 7_000, price: 2750020000 },
      { timeMs: 8_000, price: 2750040000 },
    ];
    const out = ticksToS5Candles(ticks, 2);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ time: 0, open: 27500.1, high: 27500.5, low: 27500.1, close: 27500.5 });
    expect(out[1]).toEqual({ time: 5, open: 27500.2, high: 27500.4, low: 27500.2, close: 27500.4 });
  });

  it("returns ascending candles regardless of input order", () => {
    const ticks = [
      { timeMs: 8_000, price: 2750040000 },
      { timeMs: 1_000, price: 2750010000 },
    ];
    const out = ticksToS5Candles(ticks, 2);
    expect(out.map((c) => c.time)).toEqual([0, 5]);
  });
});

describe("proto round-trip", () => {
  it("encodes and decodes a ProtoOASpotEvent through the envelope", () => {
    const spot = M.ProtoOASpotEvent.encode(
      M.ProtoOASpotEvent.fromObject({
        payloadType: PT.SPOT_EVENT,
        ctidTraderAccountId: 12345,
        symbolId: 42,
        bid: 4425025000,
        ask: 4425045000,
        timestamp: 1_700_000_000_000,
      })
    ).finish();
    const frame = encodeFrame(encodeEnvelope({ payloadType: PT.SPOT_EVENT, payload: spot as Uint8Array, clientMsgId: "7" }));
    // Wire framing: 4-byte BIG-endian header = BODY size only (header excluded)
    const bodyLen = frame.length - 4;
    expect(frame.readUInt32BE(0)).toBe(bodyLen);

    const env = decodeEnvelope(frame.subarray(4));
    expect(env.payloadType).toBe(PT.SPOT_EVENT);
    expect(env.clientMsgId).toBe("7");

    const dec = M.ProtoOASpotEvent.toObject(M.ProtoOASpotEvent.decode(env.payload!), { defaults: false });
    expect(toNum(dec.symbolId)).toBe(42);
    expect(toNum(dec.bid)).toBe(4425025000);
    expect(toNum(dec.ask)).toBe(4425045000);
    expect(toNum(dec.timestamp)).toBe(1_700_000_000_000);
  });

  it("decodes trendbar payloads with relative prices", () => {
    const tb = M.ProtoOATrendbar.encode(
      M.ProtoOATrendbar.fromObject({
        volume: 10,
        period: 12,
        low: 600000000,
        deltaOpen: 25000,
        deltaClose: 50000,
        deltaHigh: 75000,
        utcTimestampInMinutes: 29_000_000,
      })
    ).finish();
    const env = decodeEnvelope(encodeEnvelope({ payloadType: PT.GET_TRENDBARS_RES, payload: tb as Uint8Array }));
    const dec = M.ProtoOATrendbar.toObject(M.ProtoOATrendbar.decode(env.payload!), { defaults: false });
    const candle = trendbarToCandle(
      {
        volume: toNum(dec.volume),
        low: toNum(dec.low),
        deltaOpen: toNum(dec.deltaOpen),
        deltaClose: toNum(dec.deltaClose),
        deltaHigh: toNum(dec.deltaHigh),
        utcTimestampInMinutes: toNum(dec.utcTimestampInMinutes),
      },
      2
    );
    expect(candle).toEqual({ time: 29_000_000 * 60, open: 6000.25, high: 6000.75, low: 6000, close: 6000.5 });
  });
});

describe("US30 symbol aliases", () => {
  it("prefers the plain US30 name", () => {
    expect(US30_ALIASES[0]).toBe("US30");
  });
});
