/**
 * cTrader Open API session — TLS TCP transport shared by the REST (trendbar
 * history) and stream (spot quotes) clients.
 *
 * Wire protocol (help.ctrader.com/open-api/message-serialization):
 *   every message = 4-byte little-endian Int32 header holding the TOTAL
 *   size (protobuf body + the 4 header bytes), then the protobuf body.
 *
 * Lifecycle: connect → ProtoOAApplicationAuthReq(clientId/secret) →
 * ProtoOAAccountAuthReq(accountId/accessToken) → "ready". A ProtoHeartbeatEvent
 * is sent every 10s (docs: required to keep the connection open longer than
 * 30s without other traffic); a silence watchdog recycles dead connections.
 * Historical requests are serialized with a 5 req/s pacer (the documented
 * per-connection cap for historical data).
 *
 * Access tokens expire (~30 days). When the server rejects the token the
 * session uses the stored refresh token against
 * https://openapi.ctrader.com/apps/token, persists the rotated pair to disk
 * (data dir — never logs, never a VITE var) and reconnects.
 */
import { EventEmitter } from "node:events";
import * as tls from "node:tls";
import * as fs from "node:fs";
import * as path from "node:path";
import { PT, M, decodeEnvelope, encodeEnvelope, encodeFrame, toNum } from "./proto.js";
import { backoffDelayMs } from "../market/backoff.js";
import type { Long } from "protobufjs";
import type { Log } from "../logger.js";

export type CtraderStatus = "connected" | "reconnecting" | "offline";

interface SessionEvents {
  ready: () => void;
  status: (status: CtraderStatus) => void;
  /** Decoded envelope with a payload (spot events, disconnects, errors). */
  payload: (payloadType: number, body: Uint8Array) => void;
}

export interface CtraderConfig {
  host: string;
  port: number;
  clientId: string;
  clientSecret: string;
  /** ctidTraderAccountId — numeric string. */
  accountId: string;
  accessToken: string;
  refreshToken: string;
  /** Where rotated tokens persist (dataDir). Empty = no persistence. */
  tokenStorePath: string;
}

interface PendingRequest {
  resolve: (value: { body: Uint8Array; payloadType: number }) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

const HEARTBEAT_INTERVAL_MS = 10_000;
const SILENCE_WATCHDOG_MS = 60_000;
const REQUEST_TIMEOUT_MS = 20_000;
/** Historical requests: documented cap of 5/s — pace to 4/s to be safe. */
const HISTORICAL_PACING_MS = 250;
const BASE_BACKOFF_MS = 1_000;
const CAP_BACKOFF_MS = 30_000;

const TOKEN_ENDPOINT = "https://openapi.ctrader.com/apps/token";

/** Error codes that mean "the access token is dead — refresh and retry". */
const TOKEN_ERROR_CODES = new Set([
  "CH_ACCESS_TOKEN_INVALID",
  "CTRADER_ACCOUNT_UNAUTHORIZED",
  "TRADING_ACCESS_TOKEN_EXPIRED",
  "TOKEN_REFRESH_FAILED",
]);

/**
 * Narrows the EventEmitter surface for consumers; the class's own public
 * members (isReady, sessionInfo, onReady, request, requestHistorical)
 * merge in automatically.
 */
export interface CtraderClient {
  on<K extends keyof SessionEvents>(event: K, listener: SessionEvents[K]): this;
  off<K extends keyof SessionEvents>(event: K, listener: SessionEvents[K]): this;
  emit<K extends keyof SessionEvents>(event: K, ...args: Parameters<SessionEvents[K]>): boolean;
}

export class CtraderClient extends EventEmitter {
  private socket: tls.TLSSocket | null = null;
  private buffer: Buffer = Buffer.alloc(0);
  private running = false;
  private stopped = true;
  private connected = false;
  private ready = false;
  private attempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private watchdogTimer: NodeJS.Timeout | null = null;
  private lastMessageAt = 0;
  private msgSeq = 0;
  private pending = new Map<string, PendingRequest>();
  private readyWaiters: Array<() => void> = [];
  /** Serializes historical requests (trendbars/tickdata) to ≤4/s. */
  private historyChain: Promise<void> = Promise.resolve();
  /** Set while a token refresh is in flight (single-flight). */
  private refreshing: Promise<boolean> | null = null;

  constructor(
    private readonly cfg: CtraderConfig,
    private readonly log: Log
  ) {
    super();
  }

  get isReady(): boolean {
    return this.ready;
  }

  /**
   * Current session snapshot (accessToken reflects any rotation from a
   * refresh). Served to browsers by /api/ctrader-session so the direct
   * path always holds a live token — WITHOUT the refresh secret, which
   * never leaves the server.
   */
  sessionInfo(): CtraderConfig {
    return { ...this.cfg };
  }

  /** Resolves once the app+account handshake completes (immediately when
   *  already ready — including on every later reconnect). */
  onReady(): Promise<void> {
    if (this.ready) return Promise.resolve();
    return new Promise((resolve) => {
      this.readyWaiters.push(resolve);
    });
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.stopped = false;
    this.dial();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.running = false;
    this.clearTimers();
    this.teardownSocket();
    this.rejectAllPending("cTrader session stopped");
    this.ready = false;
    this.setStatus("offline");
  }

  /** Session-level telemetry timers (heartbeat + watchdog). Never touches
   *  the reconnect timer — that one belongs to the lifecycle below. */
  private stopSessionTimers(): void {
    this.stopWatchdog();
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Sends one request and resolves with its response payload. Responses are
   * correlated by clientMsgId; an error response for this id rejects.
   */
  request(payloadType: number, body: Uint8Array, timeoutMs = REQUEST_TIMEOUT_MS): Promise<{ body: Uint8Array; payloadType: number }> {
    if (!this.connected || !this.socket) {
      return Promise.reject(new Error("cTrader session is not connected"));
    }
    const id = String(++this.msgSeq);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`cTrader request ${payloadType} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        const frame = encodeEnvelope({ payloadType, payload: body, clientMsgId: id });
        this.socket!.write(encodeFrame(frame));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error("cTrader write failed"));
      }
    });
  }

  /**
   * Sends a historical-data request, serialized to respect the documented
   * 5 req/s cap. Each call joins a promise chain; requests never reorder.
   */
  requestHistorical(payloadType: number, body: Uint8Array): Promise<{ body: Uint8Array; payloadType: number }> {
    const run = async (): Promise<{ body: Uint8Array; payloadType: number }> => {
      await this.historyChain.catch(() => {});
      await new Promise((r) => setTimeout(r, HISTORICAL_PACING_MS));
      return this.request(payloadType, body, 30_000);
    };
    const next = run().finally(() => {});
    // Keep the chain alive even when a request rejects.
    this.historyChain = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  // ── token refresh ───────────────────────────────────────────────────────

  private async refreshAccessToken(): Promise<boolean> {
    if (!this.cfg.refreshToken) return false;
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      try {
        const url = new URL(TOKEN_ENDPOINT);
        url.searchParams.set("grant_type", "refresh_token");
        url.searchParams.set("refresh_token", this.cfg.refreshToken);
        url.searchParams.set("client_id", this.cfg.clientId);
        url.searchParams.set("client_secret", this.cfg.clientSecret);
        const res = await fetch(url, { method: "POST" });
        if (!res.ok) {
          this.log.warn({ status: res.status }, "cTrader token refresh rejected");
          return false;
        }
        const data = (await res.json()) as {
          accessToken?: string;
          refreshToken?: string;
          expiresIn?: string | number;
          error?: string;
        };
        if (!data.accessToken) {
          this.log.warn({ error: data.error ?? "no accessToken" }, "cTrader token refresh failed");
          return false;
        }
        this.cfg.accessToken = data.accessToken;
        if (data.refreshToken) this.cfg.refreshToken = data.refreshToken;
        this.persistTokens(data.expiresIn);
        this.log.info({}, "cTrader access token refreshed");
        return true;
      } catch (err) {
        this.log.warn(
          { reason: err instanceof Error ? err.message : "unknown" },
          "cTrader token refresh errored"
        );
        return false;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  /** Rotated tokens land in the data dir with owner-only permissions. */
  private persistTokens(expiresIn?: string | number): void {
    if (!this.cfg.tokenStorePath) return;
    try {
      const expSec = Number.parseInt(String(expiresIn ?? ""), 10);
      const payload = {
        accessToken: this.cfg.accessToken,
        refreshToken: this.cfg.refreshToken,
        // Discovered at runtime when the env left it empty — the log and
        // this file are where the operator copies it from for browser-direct.
        accountId: this.cfg.accountId,
        expiresAt: Number.isFinite(expSec) ? Date.now() + expSec * 1000 : 0,
      };
      fs.mkdirSync(path.dirname(this.cfg.tokenStorePath), { recursive: true });
      fs.writeFileSync(this.cfg.tokenStorePath, JSON.stringify(payload), { mode: 0o600 });
    } catch {
      // persistence is best-effort — the env values remain the fallback
    }
  }

  // ── connection lifecycle ────────────────────────────────────────────────

  private dial(): void {
    if (this.stopped || this.socket) return;
    // The UpstreamStatus union has no "connecting" — report as reconnecting
    // until the account handshake completes ("connected").
    this.setStatus("reconnecting");
    let socket: tls.TLSSocket;
    try {
      socket = tls.connect({
        host: this.cfg.host,
        port: this.cfg.port,
        servername: this.cfg.host,
      });
    } catch (err) {
      this.scheduleReconnect(err);
      return;
    }
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.connected = false;
    this.ready = false;

    socket.on("secureConnect", () => {
      this.connected = true;
      this.attempt = 0;
      this.lastMessageAt = Date.now();
      this.startTimers();
      this.log.info({ host: this.cfg.host, port: this.cfg.port }, "cTrader TLS connected — authenticating");
      this.authenticate();
    });
    socket.on("data", (chunk: Buffer) => this.onData(chunk));
    socket.on("error", (err: Error) => {
      this.log.warn({ reason: err.message }, "cTrader socket error");
      this.teardown();
    });
    socket.on("close", () => {
      const hadConnection = this.connected;
      this.teardown();
      if (hadConnection || (!this.stopped && this.running)) this.scheduleReconnect();
    });
    // Belt & suspenders alongside the silence watchdog: TLS-level idle
    // detection for connections the app-layer watchdog would notice later.
    socket.setTimeout(SILENCE_WATCHDOG_MS * 2, () => {
      this.log.warn({}, "cTrader socket idle timeout");
      try {
        socket.destroy();
      } catch {}
    });
  }

  private authenticate(): void {
    const appReq = M.ProtoOAApplicationAuthReq.encode(
      M.ProtoOAApplicationAuthReq.fromObject({
        payloadType: PT.APP_AUTH_REQ,
        clientId: this.cfg.clientId,
        clientSecret: this.cfg.clientSecret,
      })
    ).finish();
    void this.request(PT.APP_AUTH_REQ, appReq as Uint8Array)
      .then(async () => {
        // Started with only a refresh token: mint the first access token
        // BEFORE burning a doomed account-auth round trip.
        if (!this.cfg.accessToken && this.cfg.refreshToken) {
          await this.refreshAccessToken();
        }
        // Account id not configured: discover it from the token (the Open
        // API portal never shows the numeric ctidTraderAccountId — every
        // deployment starts this way).
        if (!this.cfg.accountId) {
          await this.discoverAccount();
        }
        this.authAccount();
      })
      .catch((err: unknown) => {
        // Timeout / socket death during handshake — the close handler owns
        // reconnection; nothing else to do here.
        this.log.warn(
          { reason: err instanceof Error ? err.message : "unknown" },
          "cTrader application auth failed"
        );
      });
  }

  /** Resolves ctidTraderAccountId from the access token and persists it. */
  private async discoverAccount(): Promise<void> {
    const req = M.ProtoOAGetAccountListByAccessTokenReq.encode(
      M.ProtoOAGetAccountListByAccessTokenReq.fromObject({
        payloadType: PT.GET_ACCOUNTS_BY_ACCESS_TOKEN_REQ,
        accessToken: this.cfg.accessToken,
      })
    ).finish();
    const res = await this.request(PT.GET_ACCOUNTS_BY_ACCESS_TOKEN_REQ, req as Uint8Array);
    const dec = M.ProtoOAGetAccountListByAccessTokenRes.toObject(
      M.ProtoOAGetAccountListByAccessTokenRes.decode(res.body),
      { defaults: false }
    ) as { ctidTraderAccount?: Array<{ ctidTraderAccountId?: Long; isLive?: boolean; brokerTitleShort?: string }> };
    const accounts = dec.ctidTraderAccount ?? [];
    if (accounts.length === 0) {
      throw new Error("cTrader token grants no trading accounts");
    }
    // Demo accounts first (isLive false) — this integration is data-only.
    const chosen = accounts.find((a) => a.isLive !== true) ?? accounts[0]!;
    const id = toNum(chosen.ctidTraderAccountId);
    this.cfg.accountId = String(id);
    this.log.info(
      { ctidTraderAccountId: id, broker: chosen.brokerTitleShort ?? "unknown", isLive: chosen.isLive === true },
      "cTrader account id discovered from token — copy CTRADER_ACCOUNT_ID into the env for browser-direct"
    );
    this.persistTokens();
  }

  private authAccount(): void {
    const acctReq = M.ProtoOAAccountAuthReq.encode(
      M.ProtoOAAccountAuthReq.fromObject({
        payloadType: PT.ACCOUNT_AUTH_REQ,
        ctidTraderAccountId: this.cfg.accountId,
        accessToken: this.cfg.accessToken,
      })
    ).finish();
    void this.request(PT.ACCOUNT_AUTH_REQ, acctReq as Uint8Array)
      .then(() => {
        this.ready = true;
        this.setStatus("connected");
        this.log.info({}, "cTrader account session ready");
        for (const w of this.readyWaiters.splice(0)) w();
        this.emit("ready");
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "unknown";
        this.log.warn({ reason: message }, "cTrader account auth failed");
        if (/token/i.test(message) && this.cfg.refreshToken) {
          void this.refreshAccessToken().then((ok) => {
            if (ok && this.connected) this.authAccount();
          });
        }
      });
  }

  /** Inbound frames. The header is the BODY size only, big-endian (see
   *  encodeFrame in proto.ts). */
  private onData(chunk: Buffer): void {
    this.lastMessageAt = Date.now();
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    for (;;) {
      if (this.buffer.length < 4) return;
      const total = this.buffer.readUInt32BE(0);
      if (total < 1 || total > 32 * 1024 * 1024) {
        this.log.warn({ total }, "cTrader frame length out of range — dropping connection");
        try {
          this.socket?.destroy();
        } catch {}
        return;
      }
      if (this.buffer.length < total + 4) return;
      const body = this.buffer.subarray(4, total + 4);
      this.buffer = this.buffer.subarray(total + 4);
      this.handleFrame(body);
    }
  }

  private handleFrame(body: Buffer): void {
    let env: ReturnType<typeof decodeEnvelope>;
    try {
      env = decodeEnvelope(body);
    } catch {
      this.log.warn({}, "undecodable cTrader frame — ignored");
      return;
    }
    const { payloadType, payload, clientMsgId } = env;

    if (clientMsgId) {
      const p = this.pending.get(clientMsgId);
      if (p) {
        clearTimeout(p.timer);
        this.pending.delete(clientMsgId);
        if (payloadType === PT.OA_ERROR_RES || payloadType === PT.ERROR_RES) {
          const err = decodeError(payloadType, payload);
          p.reject(err);
        } else {
          p.resolve({ body: payload ?? new Uint8Array(), payloadType });
        }
        return;
      }
    }

    switch (payloadType) {
      case PT.HEARTBEAT_EVENT:
        return;
      case PT.APP_AUTH_RES:
        return; // correlation path handled it; a stray one is harmless
      case PT.ACCOUNT_AUTH_RES:
        return;
      case PT.OA_ERROR_RES:
      case PT.ERROR_RES: {
        const err = decodeError(payloadType, payload);
        this.log.warn({ code: err.code, message: err.message }, "cTrader error response");
        if (TOKEN_ERROR_CODES.has(err.code) || /token/i.test(err.code)) {
          void this.refreshAccessToken().then((ok) => {
            if (ok) {
              // A fresh token invalidates the session server-side — dial anew.
              try {
                this.socket?.destroy();
              } catch {}
            }
          });
        }
        return;
      }
      case PT.CLIENT_DISCONNECT_EVENT:
      case PT.TOKEN_INVALIDATED_EVENT: {
        let reason = "";
        try {
          const dec = M.ProtoOAClientDisconnectEvent.toObject(
            M.ProtoOAClientDisconnectEvent.decode(payload ?? new Uint8Array()),
            { defaults: false }
          ) as { reason?: string };
          reason = dec.reason ?? "";
        } catch {}
        this.log.warn({ reason }, "cTrader server disconnect event");
        try {
          this.socket?.destroy();
        } catch {}
        return;
      }
      default:
        if (payload) this.emit("payload", payloadType, payload);
        return;
    }
  }

  // ── timers ──────────────────────────────────────────────────────────────

  private startTimers(): void {
    this.startHeartbeat();
    this.startWatchdog();
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      if (!this.socket) return;
      try {
        const hb = M.ProtoHeartbeatEvent.encode(
          M.ProtoHeartbeatEvent.fromObject({ payloadType: PT.HEARTBEAT_EVENT })
        ).finish();
        this.socket.write(encodeFrame(encodeEnvelope({ payloadType: PT.HEARTBEAT_EVENT, payload: hb as Uint8Array })));
      } catch {}
    }, HEARTBEAT_INTERVAL_MS);
    this.heartbeatTimer.unref?.();
  }

  private startWatchdog(): void {
    this.stopWatchdog();
    this.watchdogTimer = setInterval(() => {
      if (this.connected && Date.now() - this.lastMessageAt > SILENCE_WATCHDOG_MS) {
        this.log.warn({}, "cTrader silence watchdog fired — recycling connection");
        try {
          this.socket?.destroy();
        } catch {}
      }
    }, 15_000);
    this.watchdogTimer.unref?.();
  }

  private stopWatchdog(): void {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  private clearTimers(): void {
    this.stopWatchdog();
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // ── teardown / reconnect ────────────────────────────────────────────────

  private teardown(): void {
    this.connected = false;
    this.ready = false;
    this.stopSessionTimers();
    this.teardownSocket();
    this.rejectAllPending("cTrader connection lost");
  }

  private teardownSocket(): void {
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      try {
        socket.destroy();
      } catch {}
    }
  }

  private rejectAllPending(message: string): void {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error(message));
      this.pending.delete(id);
    }
  }

  private scheduleReconnect(err?: unknown): void {
    if (this.stopped || !this.running) {
      this.setStatus("offline");
      return;
    }
    if (this.reconnectTimer) return;
    this.ready = false;
    this.setStatus("reconnecting");
    this.attempt++;
    const delay = backoffDelayMs(this.attempt, BASE_BACKOFF_MS, CAP_BACKOFF_MS);
    this.log.info(
      { attempt: this.attempt, delayMs: delay, reason: err instanceof Error ? err.message : undefined },
      "cTrader reconnect scheduled"
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.stopped && this.running) this.dial();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private setStatus(status: CtraderStatus): void {
    this.emit("status", status);
  }
}

/** Error carrying the cTrader errorCode string for upstream mapping. */
export class CtraderError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "CtraderError";
  }
}

function decodeError(payloadType: number, payload?: Uint8Array): CtraderError {
  let code = "UNKNOWN";
  let description = "";
  try {
    if (payloadType === PT.OA_ERROR_RES) {
      const dec = M.ProtoOAErrorRes.toObject(M.ProtoOAErrorRes.decode(payload ?? new Uint8Array()), {
        defaults: false,
      }) as { errorCode?: string; description?: string };
      code = dec.errorCode ?? code;
      description = dec.description ?? "";
    } else {
      const dec = M.ProtoErrorRes.toObject(M.ProtoErrorRes.decode(payload ?? new Uint8Array()), {
        defaults: false,
      }) as { errorCode?: string; description?: string };
      code = dec.errorCode ?? code;
      description = dec.description ?? "";
    }
  } catch {}
  return new CtraderError(code, description || code);
}

/** Convenience: accountId string → numeric (protobufjs int64 field input). */
export function accountIdNumber(accountId: string): number {
  const n = Number(accountId);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid ctidTraderAccountId: ${accountId}`);
  return n;
}
