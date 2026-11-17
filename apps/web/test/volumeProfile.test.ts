import { describe, it, expect } from "vitest";
import { computeVolumeProfile, type VpCandle } from "../src/chart/volumeProfile";

function candle(o: number, h: number, l: number, c: number, volume: number | null): VpCandle {
  return { open: o, high: h, low: l, close: c, volume };
}

describe("computeVolumeProfile", () => {
  it("returns an empty profile for no candles", () => {
    const p = computeVolumeProfile([], { rowCount: 24 });
    expect(p.rows.length).toBe(0);
    expect(p.poc).toBe(-1);
    expect(p.hasVolume).toBe(false);
  });

  it("returns hasVolume=false when no candle has a recorded volume", () => {
    const p = computeVolumeProfile([candle(1, 2, 0.5, 1.5, null), candle(1.5, 2.5, 1, 2, null)], { rowCount: 10 });
    expect(p.hasVolume).toBe(false);
    expect(p.rows.length).toBe(0);
  });

  it("attributes all volume of a flat candle to one row", () => {
    const p = computeVolumeProfile([candle(100, 100, 100, 100, 50)], { rowCount: 24 });
    expect(p.rows.length).toBe(24);
    expect(p.totalVolume).toBeCloseTo(50);
    const filled = p.rows.filter((r) => r.total > 0);
    expect(filled.length).toBe(1);
    expect(filled[0]!.total).toBeCloseTo(50);
    expect(p.poc).toBe(p.rows.indexOf(filled[0]!));
    expect(p.hasVolume).toBe(true);
  });

  it("spreads a candle's volume across the rows it spans", () => {
    // 4 rows over [0, 4]; candle spans [0, 4] → every row gets 1/4 of 40
    const p = computeVolumeProfile([candle(0, 4, 0, 4, 40)], { rowCount: 4 });
    expect(p.totalVolume).toBeCloseTo(40);
    for (const r of p.rows) expect(r.total).toBeCloseTo(10);
  });

  it("splits up/down volume by candle direction (body-weighted)", () => {
    // Wick-less candles: all volume follows the body direction
    const p = computeVolumeProfile([candle(0, 4, 0, 4, 40)], { rowCount: 4 }); // close >= open → up
    expect(p.rows.every((r) => r.up > 0 && r.down === 0)).toBe(true);
    const q = computeVolumeProfile([candle(4, 4, 0, 0, 40)], { rowCount: 4 }); // close < open → down
    expect(q.rows.every((r) => r.down > 0 && r.up === 0)).toBe(true);
  });

  it("splits wick volume 50/50 between up and down (TV weighting)", () => {
    // Green candle, open 1 close 2, high 4 low 0:
    // body = 1, topwick = 2, bottomwick = 1, denom = 2*2 + 2*1 + 1 = 7
    // bodyvol = 1/7 → up; wick vols (4/7 and 2/7) split 50/50 per side
    // bodyvol = 1*7/7 = 1 → up; topWickVol = 4 → 2 up / 2 down; bottomWickVol = 2 → 1 up / 1 down
    const p = computeVolumeProfile([candle(1, 4, 0, 2, 7)], { rowCount: 8 });
    expect(p.totalVolume).toBeCloseTo(7);
    const up = p.rows.reduce((s, r) => s + r.up, 0);
    const down = p.rows.reduce((s, r) => s + r.down, 0);
    expect(up).toBeCloseTo(1 + 2 + 1); // body + both wick halves
    expect(down).toBeCloseTo(2 + 1); // wick halves only
  });

  it("marks the highest-volume row as the POC", () => {
    // 4 rows over [0, 4] (extent set by all three candles): row 2 (prices
    // [2, 3)) holds the concentrated candle
    const p = computeVolumeProfile(
      [candle(2, 2.9, 2, 2.9, 90), candle(0, 1, 0, 1, 10), candle(3.5, 4, 3.5, 4, 1)],
      { rowCount: 4 }
    );
    expect(p.poc).toBe(2);
    expect(p.rows[2]!.total).toBeCloseTo(90);
  });

  it("builds a 70% Value Area around the POC", () => {
    // 10 rows over [0, 10] — candle i spans exactly row i: rows 4-6 hold 80
    // (POC row 5 holds 40%), edges 4 each → total 108, VA target 75.6, so
    // the greedy expansion from the POC stops after absorbing rows 4-6 (80)
    const candles: VpCandle[] = [];
    for (let i = 0; i < 10; i++) {
      const vol = i >= 4 && i <= 6 ? (i === 5 ? 40 : 20) : 4;
      candles.push(candle(i, i + 1, i, i + 1, vol));
    }
    const p = computeVolumeProfile(candles, { rowCount: 10, vaPercent: 70 });
    expect(p.poc).toBe(5);
    // 100 total → VA target 70; greedy from POC: 40 + 20 (row 4) + 20 (row 6) = 80 ≥ 70
    expect(p.vaRows.has(5)).toBe(true);
    expect(p.vaRows.has(4)).toBe(true);
    expect(p.vaRows.has(6)).toBe(true);
    expect(p.vah).toBeCloseTo(7); // top of row 6 = price 7
    expect(p.val).toBeCloseTo(4); // bottom of row 4 = price 4
  });

  it("clamps the row count to a sane range", () => {
    const p = computeVolumeProfile([candle(1, 2, 0.5, 1.5, 10)], { rowCount: 100000 });
    expect(p.rows.length).toBe(200);
    const q = computeVolumeProfile([candle(1, 2, 0.5, 1.5, 10)], { rowCount: 0 });
    expect(q.rows.length).toBe(1);
  });

  it("tolerates a fully flat price range without dividing by zero", () => {
    const p = computeVolumeProfile([candle(100, 100, 100, 100, 10), candle(100, 100, 100, 100, 5)], { rowCount: 24 });
    expect(p.totalVolume).toBeCloseTo(15);
    expect(p.rows[0]!.total).toBeCloseTo(15);
    expect(p.hasVolume).toBe(true);
  });
});
