/**
 * Append-only JSONL persistence for buffer-fed aggregation sessions (1s —
 * no upstream-native source exists for it, so the only history is what the
 * session's own ring buffer accumulates).
 *
 * Closed candles are appended to `<dir>/<instrument>-<timeframe>.jsonl`; a
 * freshly created session loads the newest tail back into its buffer, so the
 * 1s chart keeps its history across server restarts instead of starting from
 * an empty buffer (which looked like a lone live candle on an empty chart).
 *
 * Best-effort by design: a failed read/append is logged and never breaks the
 * live streaming path.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Candle } from "@traderkomak/shared";
import type { Log } from "../logger.js";

export class CandlePersist {
  /** Highest bucket time already on disk per pair — dedups re-emit corrections. */
  private readonly lastAppended = new Map<string, number>();

  constructor(
    private readonly dir: string,
    private readonly log: Log
  ) {}

  private fileFor(instrument: string, timeframe: string): string {
    return path.join(this.dir, `${instrument}-${timeframe}.jsonl`);
  }

  private key(instrument: string, timeframe: string): string {
    return `${instrument}|${timeframe}`;
  }

  /** Loads the newest `max` candles for a pair (oldest first). */
  load(instrument: string, timeframe: string, max: number): Candle[] {
    const file = this.fileFor(instrument, timeframe);
    try {
      if (!existsSync(file)) return [];
      const lines = readFileSync(file, "utf8")
        .split(/\r?\n/)
        .filter((line) => line.length > 0);
      // Compaction: an append-only file only ever needs its newest tail
      if (lines.length > max * 4) {
        writeFileSync(file, lines.slice(-max).join("\n") + "\n", "utf8");
        this.log.info({ instrument, timeframe, kept: max }, "candle history file compacted");
      }
      const out: Candle[] = [];
      for (const line of lines.slice(-max)) {
        try {
          const c = JSON.parse(line) as Candle;
          if (typeof c.time === "number" && typeof c.open === "number" && typeof c.close === "number") {
            out.push(c);
          }
        } catch {
          // skip a torn/corrupt tail line
        }
      }
      out.sort((a, b) => a.time - b.time);
      const last = out.at(-1);
      if (last) this.lastAppended.set(this.key(instrument, timeframe), last.time);
      return out;
    } catch (err) {
      this.log.warn(
        { instrument, timeframe, reason: err instanceof Error ? err.message : "unknown" },
        "candle history load failed; starting empty"
      );
      return [];
    }
  }

  /** Appends one closed candle. Only strictly newer buckets land, so the
   *  re-emit corrections that follow a reconcile never duplicate lines. */
  append(instrument: string, timeframe: string, candle: Candle): void {
    const key = this.key(instrument, timeframe);
    const last = this.lastAppended.get(key);
    if (last !== undefined && candle.time <= last) return;
    this.lastAppended.set(key, candle.time);
    try {
      if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
      appendFileSync(this.fileFor(instrument, timeframe), JSON.stringify(candle) + "\n", "utf8");
    } catch (err) {
      this.log.warn(
        { instrument, timeframe, reason: err instanceof Error ? err.message : "unknown" },
        "candle history append failed"
      );
    }
  }
}
