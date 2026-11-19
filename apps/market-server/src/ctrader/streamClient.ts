/**
 * cTrader spot-quote stream — turns ProtoOASpotEvent into MarketTicks.
 *
 * The transport (auth, heartbeat, reconnect) lives in CtraderClient; this
 * class only manages the spot subscription set and converts events.
 * cTrader often updates a single side per event, so the last known bid/ask
 * are carried forward — the watchlist renders `mid`, which needs both.
 *
 * Same surface as the other provider streams: EventEmitter with `tick` and
 * `status` events, plus setInstruments() driven by the hub.
 */
import { EventEmitter } from "node:events";
import { PT, M, toNum } from "./proto.js";
import { accountIdNumber } from "./client.js";
import type { CtraderClient } from "./client.js";
import type { CtraderSymbols } from "./symbols.js";
import { scalePrice } from "./adapter.js";
import type { MarketTick } from "@traderkomak/shared";
import type { Long } from "protobufjs";
import type { Log } from "../logger.js";

export type UpstreamStatus = "connected" | "reconnecting" | "offline";

interface StreamEvents {
  tick: (tick: MarketTick) => void;
  status: (status: UpstreamStatus) => void;
}

export interface CtraderStreamClient {
  on<K extends keyof StreamEvents>(event: K, listener: StreamEvents[K]): this;
  off<K extends keyof StreamEvents>(event: K, listener: StreamEvents[K]): this;
  emit<K extends keyof StreamEvents>(event: K, ...args: Parameters<StreamEvents[K]>): boolean;
}

export class CtraderStreamClient extends EventEmitter {
  /** Canonical instruments currently subscribed ("US30"). */
  private instruments: string[] = [];
  /** symbolId → canonical instrument, from the registry. */
  private bySymbolId = new Map<number, string>();
  private digits = new Map<number, number>();
  /** Last known sides per symbolId — one-sided spot events complete them. */
  private lastBid = new Map<number, number>();
  private lastAsk = new Map<number, number>();
  private subscriptions = new Set<number>();
  private running = false;
  private stopped = true;
  private status: UpstreamStatus = "offline";
  private listenersBound = false;

  constructor(
    private readonly client: CtraderClient,
    private readonly symbols: CtraderSymbols,
    private readonly log: Log
  ) {
    super();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.stopped = false;
    this.bindClient();
    // Registry entries may already be resolved (REST primed them); build
    // the reverse index now and again whenever the set changes.
    void this.refreshRegistry().then(() => this.syncSubscriptions());
    this.client.onReady().then(() => {
      if (this.stopped) return;
      this.setStatus("connected");
      void this.refreshRegistry().then(() => this.syncSubscriptions());
    });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.running = false;
    this.subscriptions.clear();
    this.setStatus("offline");
  }

  setInstruments(instruments: readonly string[]): void {
    const next = [...new Set(instruments)].sort();
    const prev = [...this.instruments].sort();
    const changed = next.length !== prev.length || next.some((v, i) => v !== prev[i]);
    if (!changed) return;
    this.instruments = next;
    if (!this.stopped) void this.refreshRegistry().then(() => this.syncSubscriptions());
  }

  // ── internals ───────────────────────────────────────────────────────────

  private bindClient(): void {
    if (this.listenersBound) return;
    this.listenersBound = true;
    this.client.on("payload", (payloadType, body) => {
      if (payloadType !== PT.SPOT_EVENT) return;
      this.onSpotEvent(body);
    });
    this.client.on("status", (s) => {
      // "connected" from the transport is not account-ready yet — the
      // "ready" handler owns that transition.
      if (s === "connected") return;
      this.setStatus("reconnecting");
    });
    this.client.on("ready", () => {
      if (this.stopped) return;
      this.setStatus("connected");
      void this.refreshRegistry().then(() => this.syncSubscriptions());
    });
  }

  private async refreshRegistry(): Promise<void> {
    for (const inst of this.instruments) {
      if ([...this.bySymbolId.values()].includes(inst)) continue;
      try {
        const info = await this.symbols.get(inst);
        this.bySymbolId.set(info.symbolId, inst);
        this.digits.set(info.symbolId, info.digits);
      } catch (err) {
        this.log.warn(
          { instrument: inst, reason: err instanceof Error ? err.message : "unknown" },
          "cTrader symbol resolution failed"
        );
      }
    }
  }

  /** Diff the wanted instruments against the live subscription set. */
  private async syncSubscriptions(): Promise<void> {
    if (this.stopped || !this.client.isReady) return;
    const wanted = new Set<number>();
    for (const [symbolId, inst] of this.bySymbolId) {
      if (this.instruments.includes(inst)) wanted.add(symbolId);
    }
    const acctId = accountIdNumber(this.client.sessionInfo().accountId);

    const toAdd = [...wanted].filter((id) => !this.subscriptions.has(id));
    const toRemove = [...this.subscriptions].filter((id) => !wanted.has(id));

    if (toAdd.length > 0) {
      try {
        const req = M.ProtoOASubscribeSpotsReq.encode(
          M.ProtoOASubscribeSpotsReq.fromObject({
            payloadType: PT.SUBSCRIBE_SPOTS_REQ,
            ctidTraderAccountId: acctId,
            symbolId: toAdd,
            subscribeToSpotTimestamp: true,
          })
        ).finish();
        await this.client.request(PT.SUBSCRIBE_SPOTS_REQ, req as Uint8Array);
        for (const id of toAdd) this.subscriptions.add(id);
        this.log.info({ symbols: toAdd }, "cTrader spot subscription added");
      } catch (err) {
        this.log.warn(
          { reason: err instanceof Error ? err.message : "unknown" },
          "cTrader spot subscribe failed"
        );
      }
    }
    if (toRemove.length > 0) {
      try {
        const req = M.ProtoOAUnsubscribeSpotsReq.encode(
          M.ProtoOAUnsubscribeSpotsReq.fromObject({
            payloadType: PT.UNSUBSCRIBE_SPOTS_REQ,
            ctidTraderAccountId: acctId,
            symbolId: toRemove,
          })
        ).finish();
        await this.client.request(PT.UNSUBSCRIBE_SPOTS_REQ, req as Uint8Array);
        for (const id of toRemove) this.subscriptions.delete(id);
      } catch {
        // unsubscribe failures only leak a little traffic — non-fatal
      }
    }
  }

  private onSpotEvent(body: Uint8Array): void {
    let dec: {
      symbolId?: Long | number;
      bid?: Long | number;
      ask?: Long | number;
      timestamp?: Long | number;
    };
    try {
      dec = M.ProtoOASpotEvent.toObject(M.ProtoOASpotEvent.decode(body), {
        defaults: false,
      }) as typeof dec;
    } catch {
      return;
    }
    const symbolId = toNum(dec.symbolId);
    const instrument = this.bySymbolId.get(symbolId);
    if (!instrument) return;
    const digits = this.digits.get(symbolId) ?? 2;

    if (dec.bid !== undefined) this.lastBid.set(symbolId, scalePrice(toNum(dec.bid), digits));
    if (dec.ask !== undefined) this.lastAsk.set(symbolId, scalePrice(toNum(dec.ask), digits));

    const bid = this.lastBid.get(symbolId) ?? null;
    const ask = this.lastAsk.get(symbolId) ?? null;
    if (bid === null && ask === null) return;

    const ts = dec.timestamp !== undefined ? toNum(dec.timestamp) : Date.now();
    const mid = bid !== null && ask !== null ? (bid + ask) / 2 : null;
    this.emit("tick", { instrument, timestamp: ts, bid, ask, mid } satisfies MarketTick);
  }

  private setStatus(status: UpstreamStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.emit("status", status);
  }
}
