import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CandlePersist } from "../src/market/candlePersist";
import { CandleFeed } from "../src/market/candleFeed";
import type { Candle, MarketTick } from "@traderkomak/shared";

const TF = 1; // 1s buffer-fed session

function tick(price: number, ms: number): MarketTick {
  return { instrument: "EUR_USD", timestamp: ms, bid: price - 0.00005, ask: price + 0.00005, mid: price };
}

const BASE = Math.floor(Date.now() / (TF * 1000)) * TF * 1000 + TF * 1000 * 40; // 40 buckets in the future

const silentLog = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

let dir: string | null = null;
function freshDir(): string {
  dir = mkdtempSync(path.join(tmpdir(), "tk-persist-"));
  return dir;
}

afterEach(() => {
  if (dir) {
    rmSync(dir, { recursive: true, force: true });
    dir = null;
  }
});

describe("CandlePersist", () => {
  it("appends closed candles and loads them back oldest-first", () => {
    const store = new CandlePersist(freshDir(), silentLog);
    const candles: Candle[] = [0, 1, 2].map((i) => ({
      time: BASE / 1000 + i,
      open: 1.1 + i * 0.001,
      high: 1.1 + i * 0.001 + 0.002,
      low: 1.1 + i * 0.001 - 0.002,
      close: 1.1 + i * 0.001 + 0.001,
    }));
    for (const c of candles) store.append("EUR_USD", "1s", c);

    const loaded = store.load("EUR_USD", "1s", 5000);
    expect(loaded.map((c) => c.time)).toEqual(candles.map((c) => c.time));
    expect(loaded[0]!.close).toBe(candles[0]!.close);
  });

  it("never duplicates a bucket (re-emit corrections are ignored)", () => {
    const store = new CandlePersist(freshDir(), silentLog);
    const c: Candle = { time: BASE / 1000, open: 1.1, high: 1.102, low: 1.098, close: 1.101 };
    store.append("EUR_USD", "1s", c);
    store.append("EUR_USD", "1s", { ...c, close: 1.1015 }); // correction — must not land
    store.append("EUR_USD", "1s", { ...c, time: c.time + 1, close: 1.102 }); // next bucket — lands

    const raw = readFileSync(path.join(dir!, "EUR_USD-1s.jsonl"), "utf8").trim().split("\n");
    expect(raw).toHaveLength(2);
    expect(JSON.parse(raw[0]!).close).toBe(1.101);
    expect(JSON.parse(raw[1]!).close).toBe(1.102);
  });
});

describe("CandleFeed 1s history persistence", () => {
  it("restores the persisted buffer on session creation and keeps it seamless", async () => {
    const store = new CandlePersist(freshDir(), silentLog);
    // Pre-existing history: two closed buckets (as if a previous run wrote them)
    const prev: Candle[] = [
      { time: BASE / 1000, open: 1.1, high: 1.103, low: 1.099, close: 1.102 },
      { time: BASE / 1000 + 1, open: 1.102, high: 1.104, low: 1.101, close: 1.103 },
    ];
    for (const c of prev) store.append("EUR_USD", "1s", c);

    const rest = { getNativeCandles: async () => [] };
    const feed = new CandleFeed(rest, silentLog, store);

    const events: Array<{ closed: boolean; c: Candle }> = [];
    feed.on("candle", (e) => events.push({ closed: e.closed, c: e.candle }));

    // Subscribe at a LATER bucket than the persisted tail → buffer must
    // contain the restored candles even before any tick flows.
    feed.addSubscriber("EUR_USD", "1s");
    const snap = feed.bufferSnapshot("EUR_USD", "1s", 5000);
    expect(snap.map((c) => c.time)).toEqual(prev.map((c) => c.time));

    // The first live bucket (a later bucket) must chain its open to the
    // persisted close so restored history and live candles are seamless.
    const nextBucket = BASE / 1000 + 5; // 5 buckets later
    feed.handleTick(tick(1.105, nextBucket * 1000 + 100));

    await vi.waitFor(() => {
      if (feed.bufferSnapshot("EUR_USD", "1s", 5000).some((c) => c.time === nextBucket)) {
        return;
      }
      throw new Error("live bucket not in buffer yet");
    });

    const all = feed.bufferSnapshot("EUR_USD", "1s", 5000);
    const restoredLast = all.find((c) => c.time === prev[1]!.time)!;
    const live = all.find((c) => c.time === nextBucket)!;
    expect(live.open).toBe(restoredLast.close); // seamless chain
    expect(live.close).toBe(1.105);

    // Closed candles keep flowing to disk
    expect(existsSync(path.join(dir!, "EUR_USD-1s.jsonl"))).toBe(true);
  });
});
