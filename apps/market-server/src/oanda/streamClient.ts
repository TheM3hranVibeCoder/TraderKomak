/**
 * Persistent OANDA pricing-stream connection.
 *
 * Responsibilities:
 *  - connect & authenticate (server-side token, never logged)
 *  - subscribe to the union of requested instruments
 *  - parse + normalize incoming pricing events → MarketTick
 *  - automatic reconnect with exponential backoff (capped, jittered)
 *  - heartbeat/silence watchdog — a dead connection is detected and recycled
 *  - no duplicate connections (single-flight dial guard)
 *  - graceful shutdown
 */
import { EventEmitter } from "node:events";
import { priceEventToTick } from "./adapter.js";
import { backoffDelayMs } from "../market/backoff.js";
import type { MarketTick } from "@traderkomak/shared";
import type { Log } from "../logger.js";

export type UpstreamStatus = "connected" | "reconnecting" | "offline";

interface StreamEvents {
  tick: (tick: MarketTick) => void;
  status: (status: UpstreamStatus) => void;
}

const SILENCE_WATCHDOG_MS = 60_000;
const BASE_BACKOFF_MS = 1_000;
const CAP_BACKOFF_MS = 30_000;

export interface OandaStreamClient {
  on<K extends keyof StreamEvents>(event: K, listener: StreamEvents[K]): this;
  off<K extends keyof StreamEvents>(event: K, listener: StreamEvents[K]): this;
  emit<K extends keyof StreamEvents>(event: K, ...args: Parameters<StreamEvents[K]>): boolean;
}

export class OandaStreamClient extends EventEmitter {
  private controller: AbortController | null = null;
  private instruments: string[] = [];
  private running = false;
  private dialing = false;
  private stopped = true;
  private attempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private watchdogTimer: NodeJS.Timeout | null = null;
  /** Set when an instrument-set change requires an immediate redial. */
  private redialRequested = false;

  constructor(
    private readonly cfg: { streamUrl: string; accountId: string; apiToken: string },
    private readonly log: Log
  ) {
    super();
  }

  start(): void {
    if (this.running) return; // idempotent — never two connections
    this.running = true;
    this.stopped = false;
    void this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.running = false;
    this.clearTimers();
    this.controller?.abort();
    this.controller = null;
    this.setStatus("offline");
  }

  /**
   * Updates the instrument subscription set. Redials immediately when the
   * active set actually changed; otherwise it is a no-op.
   */
  setInstruments(instruments: readonly string[]): void {
    const next = [...new Set(instruments)].sort();
    const prev = [...this.instruments].sort();
    const changed =
      next.length !== prev.length || next.some((v, i) => v !== prev[i]);
    if (!changed) return;

    this.instruments = next;
    if (!this.running || !this.controller) {
      // Not connected yet — the next dial will use the new set.
      return;
    }
    this.log.info({ instruments: next.length }, "stream instrument set changed; redialing");
    this.redialRequested = true;
    this.attempt = 0; // deliberate redial, not a failure
    this.controller.abort();
  }

  get isConnected(): boolean {
    return this.running && this.controller !== null && !this.dialing;
  }

  private url(): string {
    const list = encodeURIComponent(this.instruments.join(","));
    return `${this.cfg.streamUrl}/v3/accounts/${this.cfg.accountId}/pricing/stream?instruments=${list}`;
  }

  private async connect(): Promise<void> {
    if (this.stopped || this.dialing) return;
    if (this.instruments.length === 0) {
      // Nothing to subscribe to yet; wait until someone subscribes.
      this.scheduleReconnect();
      return;
    }

    this.dialing = true;
    this.clearWatchdog();
    const controller = new AbortController();
    this.controller = controller;

    try {
      const res = await fetch(this.url(), {
        headers: {
          Authorization: `Bearer ${this.cfg.apiToken}`,
          Accept: "application/json",
        },
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        // Deliberately vague in logs — never echo the header or token.
        this.log.error({ status: res.status }, "oanda stream rejected");
        throw new Error(`stream HTTP ${res.status}`);
      }

      this.attempt = 0;
      this.redialRequested = false;
      this.dialing = false;
      this.log.info(
        { instruments: this.instruments.length },
        "oanda pricing stream connected"
      );
      this.setStatus("connected");
      this.resetWatchdog();

      await this.readLoop(res.body, controller);
    } catch (err) {
      this.dialing = false;
      if (controller.signal.aborted && this.stopped) return;
      if (controller.signal.aborted && this.redialRequested) {
        this.redialRequested = false;
        void this.connect();
        return;
      }
      this.log.warn(
        { reason: err instanceof Error ? err.message : "unknown" },
        "oanda pricing stream interrupted"
      );
    } finally {
      if (this.controller === controller) {
        this.controller = null;
        this.clearWatchdog();
      }
    }

    if (!this.stopped) {
      this.setStatus("reconnecting");
      this.scheduleReconnect();
    }
  }

  private async readLoop(body: ReadableStream<Uint8Array>, controller: AbortController): Promise<void> {
    const decoder = new TextDecoder();
    let buffer = "";

    for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line.length > 0) this.handleLine(line);
      }
      this.resetWatchdog();
      if (controller.signal.aborted) return;
    }
  }

  private handleLine(line: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      this.log.debug({}, "dropping malformed stream line");
      return;
    }
    if (
      typeof msg === "object" &&
      msg !== null &&
      (msg as Record<string, unknown>).type === "HEARTBEAT"
    ) {
      return; // liveness already tracked by the watchdog reset on any line
    }

    const tick = priceEventToTick(msg);
    if (tick) {
      this.emit("tick", tick);
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    this.attempt++;
    const delay = backoffDelayMs(this.attempt, BASE_BACKOFF_MS, CAP_BACKOFF_MS);
    this.log.info({ attempt: this.attempt, delayMs: delay }, "scheduling stream reconnect");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private resetWatchdog(): void {
    this.clearWatchdog();
    this.watchdogTimer = setTimeout(() => {
      this.log.warn({}, "stream silence timeout — forcing reconnect");
      this.controller?.abort();
    }, SILENCE_WATCHDOG_MS);
    this.watchdogTimer.unref?.();
  }

  private clearWatchdog(): void {
    if (this.watchdogTimer) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  private clearTimers(): void {
    this.clearWatchdog();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private setStatus(status: UpstreamStatus): void {
    this.emit("status", status);
  }
}
