/**
 * Dukascopy live feed — there is no push stream on the free datafeed, so
 * the current (and previous) hour's tick files are polled every few
 * seconds and NEW ticks are emitted as normalized MarketTicks. The rest
 * of the pipeline (feed aggregator + hub) treats them exactly like
 * OANDA/Binance ticks. Note: datafeed updates carry a short delay.
 */
import { EventEmitter } from "node:events";
import type { MarketTick } from "@traderkomak/shared";
import { getRecentTicks } from "./client.js";
import type { Log } from "../logger.js";

export type DukaStatus = "connected" | "reconnecting" | "offline";

const POLL_MS = 4_000;

export class DukascopyStream extends EventEmitter {
  private instruments: string[] = [];
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  /** Last tick time (seconds) emitted per instrument. */
  private lastEmit = new Map<string, number>();
  private missing = new Map<string, number>();
  status: DukaStatus = "offline";

  constructor(private readonly log: Log) {
    super();
  }

  setInstruments(instruments: readonly string[]): void {
    const next = [...new Set(instruments)].sort();
    const changed = next.length !== this.instruments.length || next.some((v, i) => v !== this.instruments[i]);
    if (!changed) return;
    this.instruments = next;
    for (const inst of next) {
      if (!this.lastEmit.has(inst)) this.lastEmit.set(inst, Math.floor(Date.now() / 1000) - 30);
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.status = "reconnecting";
    this.log.info({ instruments: this.instruments.length }, "dukascopy poll stream started");
    this.timer = setInterval(() => void this.poll(), POLL_MS);
    this.timer.unref?.();
    void this.poll();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.status = "offline";
  }

  private async poll(): Promise<void> {
    if (!this.running || this.instruments.length === 0) return;
    let anyData = false;
    for (const instrument of this.instruments) {
      try {
        const ticks = await getRecentTicks(instrument);
        const last = this.lastEmit.get(instrument) ?? 0;
        let newest = last;
        for (const t of ticks) {
          if (t.t <= last) continue;
          const tick: MarketTick = {
            instrument,
            timestamp: t.t,
            bid: t.bid,
            ask: t.bid,
            mid: t.bid,
          };
          this.emit("tick", tick);
          if (t.t > newest) newest = t.t;
          anyData = true;
        }
        this.lastEmit.set(instrument, newest);
        this.missing.set(instrument, 0);
      } catch {
        this.missing.set(instrument, (this.missing.get(instrument) ?? 0) + 1);
      }
    }
    const nextStatus: DukaStatus = anyData ? "connected" : "reconnecting";
    if (nextStatus !== this.status) {
      this.status = nextStatus;
      this.emit("status", nextStatus);
    }
  }
}
