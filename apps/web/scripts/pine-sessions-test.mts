/**
 * Engine test: compiles + runs the pasted LuxAlgo "Sessions" script on
 * synthetic 15-minute FX candles and reports plots / drawings / inputs.
 * Run: npx tsx apps/web/scripts/pine-sessions-test.mts
 */
import { readFileSync } from "node:fs";
import { compile } from "../src/pine/index";
import type { Candle } from "@traderkomak/shared";

const script = readFileSync(new URL("./sessions-sample.pine", import.meta.url), "utf8");

const out = compile(script);
if (!out.ok) {
  console.error("COMPILE ERROR:", out.error.line, out.error.message);
  process.exit(1);
}
console.log("compiled:", out.script.title, "overlay:", out.script.overlay, "inputs:", out.script.inputs.length);

// Synthetic candles: 6 days × 96 bars/day of 15m, walking price with a
// session-shaped intraday curve.
const candles: Candle[] = [];
const start = Date.UTC(2026, 10, 16, 0, 0, 0) / 1000; // Mon
let price = 10500;
let seed = 42;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
for (let day = 0; day < 6; day++) {
  for (let b = 0; b < 96; b++) {
    const t = start + (day * 96 + b) * 900;
    const hour = Math.floor(b / 4);
    // bigger moves during NY/London hours
    const vol = hour >= 7 && hour < 22 ? 12 : 4;
    const drift = Math.sin((hour / 24) * Math.PI * 2) * vol * 0.6;
    const open = price;
    price += drift + (rnd() - 0.5) * vol;
    const high = Math.max(open, price) + rnd() * 3;
    const low = Math.min(open, price) - rnd() * 3;
    candles.push({ time: t, open, high, low, close: price, volume: 1000 + rnd() * 9000 });
  }
}
console.log("candles:", candles.length);

const vm = out.script.vm;
vm.setChartInfo({ timeframe: "15", mintick: 0.01, precisionDigits: 2, ticker: "EUR/USD" });
const ran = vm.run(candles);
console.log("ran:", ran, "barsRun:", vm.result().barsRun);

const res = vm.result();
console.log("plots:", res.plots.length);
for (const p of res.plots) {
  const pts = p.data.filter((d) => d.value !== undefined).length;
  console.log(`  plot "${p.title}" style=${p.style} color=${p.color} points=${pts}/${p.data.length}`);
}
const objs = vm.drawingObjects();
const byKind: Record<string, number> = {};
for (const o of objs) byKind[o.__kind] = (byKind[o.__kind] ?? 0) + 1;
console.log("drawings:", objs.length, JSON.stringify(byKind));
const box = objs.find((o) => o.__kind === "box");
if (box) console.log("  sample box props:", JSON.stringify(box.props));
const label = objs.find((o) => o.__kind === "label");
if (label) console.log("  sample label props:", JSON.stringify(label.props));
const line = objs.find((o) => o.__kind === "line");
if (line) console.log("  sample line props:", JSON.stringify(line.props));
const table = objs.find((o) => o.__kind === "table");
if (table) {
  const cells = table.props?.["cells"] as Record<string, { text: string }>;
  console.log("  table cells:", Object.keys(cells ?? {}).length, JSON.stringify(Object.entries(cells ?? {}).slice(0, 8)));
}

// Incremental tick: same last bar updated
const withTick = candles.slice();
withTick[withTick.length - 1] = { ...withTick[withTick.length - 1]!, close: price + 5 };
const ran2 = vm.run(withTick);
console.log("tick rerun:", ran2);
// New bar
withTick.push({ time: candles[candles.length - 1]!.time + 900, open: price, high: price + 4, low: price - 4, close: price + 1, volume: 3000 });
const ran3 = vm.run(withTick);
console.log("new bar rerun:", ran3, "barsRun:", vm.result().barsRun);

// Phase 2: enable Max/Min, VWAP and the dashboard, recompile + full run.
vm2Test();

function vm2Test(): void {
  const out2 = compile(script);
  if (!out2.ok) {
    console.error("COMPILE ERROR 2:", out2.error.line, out2.error.message);
    process.exit(1);
  }
  const values: Record<string, number | boolean | string> = {};
  for (const inp of out2.script.inputs) {
    if (inp.title === "Max/Min") values[inp.title] = true;
    if (inp.title === "VWAP") values[inp.title] = true;
    if (inp.title === "Dashboard") values[inp.title] = true;
    if (inp.title === "Position") values[inp.title] = "Bottom Left";
  }
  const vm2 = out2.script.vm;
  vm2.setChartInfo({ timeframe: "15", mintick: 0.01, precisionDigits: 2, ticker: "EUR/USD" });
  vm2.setInputValues(values);
  vm2.run(candles);
  const res2 = vm2.result();
  const withPts = res2.plots.filter((p) => p.data.some((d) => d.value !== undefined));
  console.log("phase2 plots with points:", withPts.length, "sample:", withPts[0]?.data.filter((d) => d.value !== undefined).length, "points");
  const tbl = vm2.drawingObjects().find((o) => o.__kind === "table");
  const cells = (tbl?.props?.["cells"] ?? {}) as Record<string, { text: string; color: string; bg: string }>;
  console.log("phase2 table position:", tbl?.props?.["position"], "cells:", Object.keys(cells).length);
  for (const [k, c] of Object.entries(cells).slice(0, 10)) console.log(`   [${k}] "${c.text}"`);
}
console.log("OK");
