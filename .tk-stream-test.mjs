/**
 * Observes the live 10s stream and flags degradations:
 *  - a bucket whose OHLC gets replaced by a FLATTER version (body shrink)
 *  - flat candles (o=h=l=c)
 *  - doji-shaped candles (body < 25% of range)
 */
import WebSocket from "ws";

const ws = new WebSocket("ws://localhost:8080/ws");
const seen = new Map(); // time -> {o,h,l,c,updates}
let events = 0;
let degradations = 0;
let flatCount = 0;
let dojiCount = 0;
const samples = [];

const bodyPct = (c) => {
  const range = c.high - c.low;
  if (range <= 0) return 0; // fully flat
  return Math.abs(c.close - c.open) / range;
};

ws.on("open", () => {
  console.log("subscribed, observing 180s of EUR_USD 10s…");
  ws.send(JSON.stringify({ type: "subscribe", instrument: "EUR_USD", timeframe: "10s" }));
});

ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.type !== "candle") return;
  if (!msg.candle || typeof msg.candle.time !== "number") {
    console.log("odd candle frame:", raw.toString().slice(0, 200));
    return;
  }
  events++;
  const c = msg.candle;
  const prev = seen.get(c.time);
  if (prev) {
    // replacement — did the body/range shrink?
    const prevBody = Math.abs(prev.c.close - prev.c.open);
    const newBody = Math.abs(c.close - c.open);
    const prevRange = prev.c.high - prev.c.low;
    const newRange = c.high - c.low;
    if (msg.closed && (newRange < prevRange - 1e-9 || (prevBody > 0 && newBody < prevBody * 0.25 && prevRange > 0))) {
      degradations++;
      if (samples.length < 8) {
        samples.push({
          time: c.time,
          prev: { ...prev.c },
          new: { ...c },
          prevUpdates: prev.updates,
          closed: msg.closed,
        });
      }
    }
    prev.c = { ...c };
    prev.updates++;
  } else {
    seen.set(c.time, { c: { ...c }, updates: 1 });
  }
  if (c.high === c.low && c.open === c.close) flatCount++;
  else if (bodyPct(c) < 0.25 && c.high > c.low) dojiCount++;
});

setTimeout(() => {
  console.log(`events=${events}, buckets=${seen.size}, flat=${flatCount}, doji-shaped=${dojiCount}, degradations=${degradations}`);
  if (samples.length) {
    console.log("degradation samples:");
    for (const s of samples) console.log(JSON.stringify(s));
  }
  // final state of the last 12 buckets
  const sorted = [...seen.entries()].sort((a, b) => a[0] - b[0]).slice(-12);
  console.log("last buckets:");
  for (const [t, v] of sorted) {
    const c = v.c;
    console.log(`  ${new Date(t * 1000).toISOString().slice(11, 19)} o=${c.open.toFixed(5)} h=${c.high.toFixed(5)} l=${c.low.toFixed(5)} c=${c.close.toFixed(5)} updates=${v.updates}`);
  }
  ws.close();
  process.exit(0);
}, 180000);

ws.on("error", (e) => { console.log("WS error:", e.message); process.exit(1); });
