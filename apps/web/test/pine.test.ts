import { describe, it, expect } from "vitest";
import { compile } from "../src/pine";
import type { Candle } from "@traderkomak/shared";

function candles(n: number): Candle[] {
  // Deterministic price walk: close = 100 + i, high = close+1, low = close-1
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const c = 100 + i;
    out.push({ time: 1700000000 + i * 60, open: c - 0.5, high: c + 1, low: c - 1, close: c });
  }
  return out;
}

/** Plot points with actual values (whitespace entries — value undefined —
 *  mark line breaks and carry no value). */
function valued(data: Array<{ time: number; value?: number }>): Array<{ time: number; value: number }> {
  return data.filter((d): d is { time: number; value: number } => d.value !== undefined && Number.isFinite(d.value));
}

function runPlots(code: string, n = 30) {
  const res = compile(code);
  if (!res.ok) throw new Error(`compile failed: ${res.error.message} (line ${res.error.line})`);
  const vm = res.script.vm;
  vm.run(candles(n));
  return vm.result();
}

describe("pine compile", () => {
  it("requires an indicator() header", () => {
    const res = compile("plot(close)");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.message).toContain("indicator");
  });

  it("rejects strategies", () => {
    const res = compile('indicator("x")\nstrategy.entry("long")');
    expect(res.ok).toBe(false);
  });

  it("reports line numbers on syntax errors", () => {
    const res = compile('indicator("x")\nlet = := 3');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.line).toBe(2);
  });
});

describe("pine runtime basics", () => {
  it("plots sma(close, 3) correctly", () => {
    const r = runPlots('indicator("t", overlay=true)\nplot(ta.sma(close, 3))');
    expect(r.plots).toHaveLength(1);
    const data = valued(r.plots[0]!.data);
    // bars 0,1 are too short; bar 2 = mean(100,101,102) = 101
    expect(data[0]!.value).toBeCloseTo(101);
    expect(data[1]!.value).toBeCloseTo(102);
  });

  it("supports the history operator", () => {
    const r = runPlots('indicator("t")\nprev = close[1]\nplot(prev)');
    const data = valued(r.plots[0]!.data);
    // first bar has no history → skipped; second bar plots close[0]=100
    expect(data[0]!.value).toBe(100);
    expect(data[1]!.value).toBe(101);
  });

  it("computes ema with rma-style convergence", () => {
    const r = runPlots('indicator("t")\nplot(ta.ema(close, 5))');
    const data = r.plots[0]!.data;
    expect(data.length).toBeGreaterThan(20);
    // EMA of an arithmetic ramp lags by (len-1)/2 = 2 bars
    const last = data[data.length - 1]!;
    expect(last.value).toBeCloseTo(100 + 29 - 2, 0);
  });

  it("computes rsi in range", () => {
    const r = runPlots('indicator("t")\nplot(ta.rsi(close, 14))');
    const data = r.plots[0]!.data;
    // constant uptrend → RSI pins at 100
    const last = data[data.length - 1]!;
    expect(last.value).toBeCloseTo(100);
  });

  it("handles if/else statements", () => {
    const code = [
      'indicator("t")',
      "trend = 0",
      "if close > open",
      "    trend := 1",
      "else",
      "    trend := -1",
      "plot(trend, style=plot.style_histogram)",
    ].join("\n");
    const r = runPlots(code);
    expect(r.plots[0]!.style).toBe("histogram");
    expect(r.plots[0]!.data[0]!.value).toBe(1); // close = open + 0.5
  });

  it("handles for loops", () => {
    const code = [
      'indicator("t")',
      "s = 0.0",
      "for i = 1 to 10",
      "    s := s + i",
      "plot(s)",
    ].join("\n");
    const r = runPlots(code);
    expect(r.plots[0]!.data[0]!.value).toBe(55);
  });

  it("supports user functions", () => {
    const code = [
      'indicator("t")',
      "double(x) =>",
      "    x * 2",
      "plot(double(close))",
    ].join("\n");
    const r = runPlots(code);
    expect(r.plots[0]!.data[0]!.value).toBe(200);
  });

  it("supports tuple destructuring (ta.macd)", () => {
    const code = [
      'indicator("t")',
      "[macdLine, signalLine, hist] = ta.macd(close, 12, 26, 9)",
      "plot(macdLine)",
      "plot(signalLine)",
    ].join("\n");
    const r = runPlots(code);
    expect(r.plots).toHaveLength(2);
    expect(r.plots[0]!.data.length).toBeGreaterThan(0);
  });

  it("respects input overrides", () => {
    const code = [
      'indicator("t")',
      "length = input.int(9, title=\"Length\")",
      "plot(ta.sma(close, length))",
    ].join("\n");
    const res = compile(code);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    res.script.vm.setInputValues({ Length: 3 });
    res.script.vm.run(candles(30));
    const r = res.script.vm.result();
    expect(r.inputs).toHaveLength(1);
    expect(r.inputs[0]!.title).toBe("Length");
    const data = valued(r.plots[0]!.data);
    expect(data[0]!.value).toBeCloseTo(101); // SMA(3)
  });

  it("supports ternary colors on plots", () => {
    const code = [
      'indicator("t")',
      "col = close > open ? color.green : color.red",
      "plot(close, color=col, style=plot.style_histogram)",
    ].join("\n");
    const r = runPlots(code);
    const d = r.plots[0]!.data;
    expect(d[0]!.color).toBeTruthy();
    expect(r.plots[0]!.colors![0]).toBeTruthy();
  });

  it("hline collects static levels", () => {
    const code = [
      'indicator("t")',
      "hline(70, color=color.red)",
      "hline(30)",
    ].join("\n");
    const r = runPlots(code);
    expect(r.hlines.map((h) => h.price).sort()).toEqual([30, 70]);
  });
});

describe("pine incremental execution", () => {
  it("live-tick recompute matches a full recompute", () => {
    const code = [
      'indicator("t")',
      "x = ta.sma(close, 5) + ta.ema(close, 10)",
      "plot(x)",
    ].join("\n");
    const cs = candles(50);
    const a = compile(code);
    const b = compile(code);
    if (!a.ok || !b.ok) throw new Error("compile failed");
    // A: full run
    a.script.vm.run(cs);
    const full = valued(a.script.vm.result().plots[0]!.data);
    // B: incremental — 40 bars, then a live tick mutating the last candle,
    // then one new bar
    const part = cs.slice(0, 40);
    b.script.vm.run(part);
    const ticked = [...part.slice(0, -1), { ...part[39]!, close: part[39]!.close + 5 }];
    b.script.vm.run(ticked);
    b.script.vm.run(cs);
    const inc = valued(b.script.vm.result().plots[0]!.data);
    expect(inc.length).toBe(full.length);
    for (let i = 0; i < full.length; i++) {
      expect(inc[i]!.time).toBe(full[i]!.time);
      expect(inc[i]!.value).toBeCloseTo(full[i]!.value, 6);
    }
  });
});

describe("pine crossovers", () => {
  it("detects crossover/crossunder", () => {
    const code = [
      'indicator("t")',
      "fast = ta.sma(close, 3)",
      "slow = ta.sma(close, 10)",
      "plot(ta.crossover(fast, slow) ? 1 : 0)",
      "plot(ta.crossunder(fast, slow) ? 1 : 0)",
    ].join("\n");
    // Dip then rise: fast SMA starts BELOW the slow one and crosses up once
    const cs: Candle[] = [];
    for (let i = 0; i < 45; i++) {
      const c = i < 15 ? 120 - i : 105 + (i - 14) * 2;
      cs.push({ time: 1700000000 + i * 60, open: c - 0.5, high: c + 1, low: c - 1, close: c });
    }
    const res = compile(code);
    if (!res.ok) throw new Error(`compile failed: ${res.error.message}`);
    res.script.vm.run(cs);
    const r = res.script.vm.result();
    const ups = r.plots[0]!.data.filter((d) => d.value === 1);
    expect(ups.length).toBe(1);
    // Cross lands right after the turn (bar ~18)
    const idx = Math.round((ups[0]!.time - cs[0]!.time) / 60);
    expect(idx).toBeGreaterThanOrEqual(16);
    expect(idx).toBeLessThanOrEqual(24);
  });
});

describe("pine builtin window functions", () => {
  it("highest/lowest over a window", () => {
    const r = runPlots('indicator("t")\nplot(ta.highest(high, 3))');
    const data = r.plots[0]!.data;
    // last bar: max(high[0..2]) = close+1 of the last bar
    expect(data[data.length - 1]!.value).toBeCloseTo(129 + 1);
  });

  it("stdev is finite and positive", () => {
    const r = runPlots('indicator("t")\nplot(ta.stdev(close, 10))');
    const last = r.plots[0]!.data[r.plots[0]!.data.length - 1]!;
    expect(last.value).toBeGreaterThan(0);
  });
});
