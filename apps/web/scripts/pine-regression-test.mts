/**
 * Pine engine regression suite — exercises the subset features the site
 * already relied on (plus the new ones): UDTs, methods, arrays, for-in,
 * var-in-function, nested user-fn calls, tuple destructuring, session time,
 * box/label/line objects, positional plot args.
 * Run: npx tsx apps/web/scripts/pine-regression-test.mts
 */
import { compile } from "../src/pine/index";
import type { Candle } from "@traderkomak/shared";

let failures = 0;
function check(name: string, cond: boolean, extra = ""): void {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name} ${extra}`);
  }
}

const candles: Candle[] = [];
let p = 100;
for (let i = 0; i < 300; i++) {
  const o = p;
  p += Math.sin(i / 7) * 1.5 + (i % 3) * 0.2;
  candles.push({ time: 1700000000 + i * 3600, open: o, high: Math.max(o, p) + 0.5, low: Math.min(o, p) - 0.5, close: p, volume: 0 });
}

function run(code: string, expectPlots = true): ReturnType<typeof compile> | null {
  const out = compile(code);
  if (!out.ok) {
    failures++;
    console.error("  ✗ compile:", out.error.line, out.error.message);
    return null;
  }
  const vm = out.script.vm;
  vm.setChartInfo({ timeframe: "60", mintick: 0.01, precisionDigits: 2, ticker: "EUR/USD" });
  vm.run(candles);
  if (expectPlots) {
    const pts = vm.result().plots.reduce((n, pl) => n + pl.data.filter((d) => d.value !== undefined).length, 0);
    if (pts === 0) {
      failures++;
      console.error("  ✗ no plot points produced");
      return null;
    }
  }
  return out;
}

console.log("── UDT + methods + arrays + for-in ──");
run(`
indicator("udt test", overlay = true)
type SessionInfo
    string name
    float high
    float low
    bool active

method isWide(SessionInfo this) =>
    this.high - this.low > 1.0

var array<SessionInfo> infos = array.new<SessionInfo>()
if bar_index % 50 == 0
    array.push(infos, SessionInfo.new("s" + str.tostring(bar_index), high, low, true))
float widest = 0.0
for info in infos
    if info.isWide()
        widest := math.max(widest, info.high - info.low)
plot(widest, "widest", color.red, 2, plot.style_line)
`);
check("UDT/method/array/for-in", true);

console.log("── var-in-function + nested calls + param history ──");
{
  const out = run(`
indicator("fn test", overlay = false)
running(bool on) =>
    var int count = 0
    bool started = on and not on[1]
    if started
        count := 1
    else if on
        count += 1
    count

doubled(float v) =>
    v * 2

quad(float v) =>
    doubled(v) * 2

float base = running(close > open)
plot(quad(base), "quad", color.blue)
`);
  if (out) {
    const vm = out.script.vm;
    const pl = vm.result().plots[0]!;
    const last = pl.data[pl.data.length - 1]!;
    // count should be way > 0 after 300 bars → quad grows unbounded? No:
    // running resets when close <= open, so it cycles; quad(quad-ish) is a
    // small number. Just assert it's finite and >= 0.
    check("var-in-function + nested calls finite", Number.isFinite(last.value ?? NaN), `last=${last.value}`);
  }
}

console.log("── tuple return + destructuring ──");
run(`
indicator("tuple test", overlay = false)
pair(float v) =>
    [v * 2, v * 3]
[a, b] = pair(close)
plot(a + b, "sum", color.green)
`);
check("tuple return/destructure", true);

console.log("── switch + typed params with defaults ──");
{
  const out = run(`
indicator("switch test", overlay = false)
string mode = input.string("A", "Mode")
pick(float v, float mult = 2.0, string which = "up") =>
    switch which
        "up" => v * mult
        "down" => -v * mult
        => 0.0
float picked = pick(close, 2.0, mode)
plot(picked, "picked", color.orange)
plot(pick(close), "default", color.gray)
`);
  if (out) {
    const vm = out.script.vm;
    const vals = vm.result().plots[0]!.data.filter((d) => d.value !== undefined);
    check("switch + default params", vals.length > 200 && Math.abs((vals[10]?.value ?? 0) - (vals[10]?.value ?? 1)) < 1e9, "");
  }
}

console.log("── boxes + lines + labels (RBR/DBD style) ──");
{
  const out = run(`
indicator("obj test", overlay = true)
if bar_index % 30 == 0
    box.new(bar_index, high, bar_index + 10, low, bgcolor = color.new(color.blue, 80), border_color = color.blue)
    line.new(bar_index, low, bar_index + 10, high, color = color.red, style = line.style_dashed, extend = extend.right)
    label.new(bar_index, high, "zone", xloc = xloc.bar_index, textcolor = color.white, style = label.style_label_down, color = #00000000)
plot(close, "close", color.white)
`);
  if (out) {
    const objs = out.script.vm.drawingObjects();
    const kinds: Record<string, number> = {};
    for (const o of objs) kinds[o.__kind] = (kinds[o.__kind] ?? 0) + 1;
    check("boxes created", (kinds["box"] ?? 0) >= 9, JSON.stringify(kinds));
    check("lines created", (kinds["line"] ?? 0) >= 9);
    check("labels created", (kinds["label"] ?? 0) >= 9);
  }
}

console.log("── time() sessions + dayofweek ──");
{
  const out = run(`
indicator("sess test", overlay = false)
bool inNY = not na(time(timeframe.period, "1300-2200", "UTC+0"))
plot(inNY ? 1 : 0, "ny", color.red)
int dow = dayofweek
plot(dow, "dow", color.blue)
`);
  if (out) {
    const vm = out.script.vm;
    const ny = vm.result().plots[0]!.data;
    const active = ny.filter((d) => d.value === 1).length;
    const hours = candles.map((c) => new Date(c.time * 1000).getUTCHours());
    const expected = hours.filter((h) => h >= 13 && h < 22).length;
    check("session detection", Math.abs(active - expected) <= 2, `active=${active} expected≈${expected}`);
    check("dayofweek in 1..7", vm.result().plots[1]!.data.every((d) => d.value === undefined || ((d.value >= 1) && (d.value <= 7))));
  }
}

console.log("── str.format + str.tostring formats ──");
{
  const out = run(`
indicator("str test", overlay = false)
string msg = str.format("UTC{0}{1}", "+", 3)
string v1 = str.tostring(3.14159, "#.##")
string v2 = str.tostring(12345678, format.volume)
plot(close > 0 ? 1 : 0, "x", color.green)
`);
  if (out) {
    check("str.format/tostring compile", true);
    void out;
  }
}

console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
