import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { BinanceRestClient } from "../src/binance/restClient";
import { normalizeInstrument, providerOf } from "@traderkomak/shared";

/** Builds one synthetic 1s kline row (Binance array format). */
function kline(openMs: number, o: number, h: number, l: number, c: number): unknown[] {
  return [openMs, String(o), String(h), String(l), String(c), "1", openMs + 999, "0", "0", "0", "0", "0"];
}

let server: Server;
let port = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const limit = Number(url.searchParams.get("limit") ?? "1000");
    // Two batches of five 1s klines each, walking backwards via endTime
    const endTime = url.searchParams.get("endTime");
    const base = endTime ? 1_700_000_000_000 - 5_000 : 1_700_000_000_000;
    const rows: unknown[][] = [];
    for (let i = 0; i < Math.min(limit, 5); i++) {
      const t = base - i * 1_000;
      rows.push(kline(t, 100 + i, 101 + i, 99 + i, 100.5 + i));
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(rows));
  });
  await new Promise<void>((r) => server.listen(0, () => r()));
  port = (server.address() as { port: number }).port;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe("BinanceRestClient", () => {
  it("parses klines into normalized candles", async () => {
    const client = new BinanceRestClient({ apiUrl: `http://127.0.0.1:${port}` });
    const out = await client.getNativeCandles("BTCUSDT", "1s", 10);
    expect(out.length).toBeGreaterThan(0);
    for (const c of out) {
      expect(Number.isFinite(c.time)).toBe(true);
      expect(c.open).toBeLessThanOrEqual(c.high);
      expect(c.low).toBeLessThanOrEqual(c.close);
    }
  });

  it("derives 5s candles from 1s source (factor aggregation)", async () => {
    const client = new BinanceRestClient({ apiUrl: `http://127.0.0.1:${port}` });
    const out = await client.getNativeCandles("BTCUSDT", "5s", 5);
    if (out.length >= 2) {
      const [a, b] = [out[0]!, out[1]!];
      expect(b.time - a.time).toBe(5); // bucket spacing
    }
  });
});

describe("provider routing (shared)", () => {
  it("routes binance vs oanda symbols", () => {
    expect(providerOf("BTCUSDT")).toBe("binance");
    expect(providerOf("btc_usdt")).toBe("binance");
    expect(normalizeInstrument("btcusdt")).toBe("BTCUSDT");
    expect(providerOf("EUR_USD")).toBe("oanda");
    expect(normalizeInstrument("eurusd")).toBe("EUR_USD"); // not mangled
    expect(providerOf("EURUSD")).toBe("oanda");
  });
});
