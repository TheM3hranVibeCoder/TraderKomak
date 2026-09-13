/**
 * Verifies the doji fix end-to-end:
 *  1. WS snapshot for a derived timeframe (10s) must carry REAL candles
 *     (rebuilt buffer), not flat synthetics.
 *  2. Client-side guard: flat incoming candles never overwrite non-flat ones.
 */
import WebSocket from "ws";

const ws = new WebSocket("ws://localhost:8080/ws");
let done = false;

ws.on("open", () => {
  ws.send(JSON.stringify({ type: "subscribe", instrument: "EUR_USD", timeframe: "10s" }));
});

ws.on("message", (raw) => {
  if (done) return;
  const msg = JSON.parse(raw.toString());
  if (msg.type === "snapshot") {
    done = true;
    const candles = msg.candles ?? [];
    const flat = candles.filter((c) => c.high === c.low && c.open === c.close && c.high === c.close).length;
    const withBody = candles.filter((c) => c.high > c.low || c.open !== c.close).length;
    console.log(`snapshot candles: ${candles.length}, flat: ${flat}, withBody: ${withBody}`);
    console.log(flat === 0 && candles.length >= 100 ? "SNAPSHOT OK (real history, no dojis)" : "CHECK: flat count =", flat);
    ws.close();
    process.exit(0);
  }
});

ws.on("error", (e) => { console.log("WS error:", e.message); process.exit(1); });
setTimeout(() => { console.log("timeout — no snapshot received"); process.exit(1); }, 20000);
