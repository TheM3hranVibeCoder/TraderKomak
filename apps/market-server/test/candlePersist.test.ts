import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CandlePersist } from "../src/market/candlePersist";
import type { Candle } from "@traderkomak/shared";

const TF = 5; // 5s buffer-fed session (smallest supported timeframe)

const BASE = Math.floor(Date.now() / (TF * 1000)) * TF * 1000;

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
    for (const c of candles) store.append("EUR_USD", "5s", c);

    const loaded = store.load("EUR_USD", "5s", 5000);
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
