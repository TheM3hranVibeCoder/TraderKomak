/**
 * CandleFeed — owns aggregation sessions.
 *
 * One session exists per (instrument, timeframe) pair. Each session holds
 * a pure CandleAggregator plus a bounded in-memory ring buffer of recent
 * candles so late-joining clients get an instant snapshot. This is also
 * what makes `1s` history possible: OANDA has no native 1-second candles,
 * so the only source is the buffer accumulated by this service (see README
 * limitations).
 *
 * Sessions are reference-counted; entries configured through
 * PERSISTENT_AGGREGATIONS are flagged `persistent` and survive even when
 * their subscriber count drops to zero.
 */
import { EventEmitter } from "node:events";
import {
  NATIVE_HISTORY_GRANULARITY,
  TIMEFRAME_SECONDS,
  bucketStart,
  isInstrument,
  isTimeframe,
  type Candle,
  type MarketTick,
  type Timeframe,
} from "@traderkomak/shared";
import { CandleAggregator, aggregateCandles } from "./aggregator.js";
import type { Log } from "../logger.js";

/**
 * Provider-agnostic history source. Both the OANDA and Binance REST clients
 * satisfy this structurally; CandleFeed never knows which provider backs a
 * symbol.
 */
export interface HistorySource {
  getNativeCandles(
    instrument: string,
    timeframe: Timeframe,
    count: number,
    toIso?: string
  ): Promise<Candle[]>;
}

export interface CandleEvent {
  instrument: string;
  timeframe: Timeframe;
  candle: Candle;
  closed: boolean;
}

interface FeedEvents {
  candle: (event: CandleEvent) => void;
}

const BUFFER_CAPACITY = 5000;
/** Native candles fetched to prime the active bucket on session start. */
const PRIME_COUNT = 2;
/** Safety cap for ticks queued while a session is still priming. */
const MAX_PENDING_TICKS = 10_000;

interface Session {
  instrument: string;
  timeframe: Timeframe;
  aggregator: CandleAggregator;
  buffer: Candle[];
  subscribers: number;
  /** Ticks captured while the historical prime request is in flight. */
  pendingTicks: MarketTick[];
  primingSettled: boolean;
  persistent: boolean;
}

export class CandleFeed extends EventEmitter {
  private readonly sessions = new Map<string, Session>();

  constructor(
    private readonly rest: HistorySource | null,
    private readonly log: Log
  ) {
    super();
  }

  /** Ensures a session exists and registers one subscriber. */
  addSubscriber(instrument: string, timeframe: Timeframe): void {
    const key = sessionKey(instrument, timeframe);
    const existing = this.sessions.get(key);
    if (existing) {
      existing.subscribers++;
      return;
    }
    const session = this.createSession(instrument, timeframe);
    this.sessions.set(key, session);
    this.log.info({ instrument, timeframe }, "aggregation session created");
  }

  removeSubscriber(instrument: string, timeframe: Timeframe): void {
    const key = sessionKey(instrument, timeframe);
    const session = this.sessions.get(key);
    if (!session) return;
    session.subscribers--;
    if (session.subscribers <= 0 && !session.persistent) {
      this.sessions.delete(key);
      this.log.info({ instrument, timeframe }, "aggregation session released");
    }
  }

  /**
   * Starts configured persistent sessions (e.g. EUR_USD:1s). Invalid
   * entries are skipped loudly — config mistakes must be visible.
   */
  startPersistent(pairs: ReadonlyArray<{ instrument: string; timeframe: string }>): void {
    for (const pair of pairs) {
      const { instrument, timeframe } = pair;
      if (!isInstrument(instrument) || !isTimeframe(timeframe)) {
        this.log.warn({ pair }, "invalid PERSISTENT_AGGREGATIONS entry skipped");
        continue;
      }
      const key = sessionKey(instrument, timeframe);
      if (this.sessions.has(key)) {
        this.markPersistent(key);
        continue;
      }
      const session = this.createSession(instrument, timeframe);
      session.persistent = true;
      // Persistent sessions exist for buffering, not for subscribers.
      session.subscribers = 0;
      this.sessions.set(key, session);
      this.log.info(
        { instrument, timeframe },
        "persistent aggregation session started"
      );
    }
  }

  /**
   * Recent buffered candles (closed + active), oldest first. Used both for
   * WebSocket snapshots and the /api/candles route when no native history
   * source exists (`1s`).
   */
  bufferSnapshot(instrument: string, timeframe: Timeframe, count?: number): Candle[] {
    const session = this.sessions.get(sessionKey(instrument, timeframe));
    if (!session) return [];
    const slice = count ? session.buffer.slice(-count) : [...session.buffer];
    return slice.map((c) => ({ ...c }));
  }

  /** Entry point for every normalized upstream tick. */
  handleTick(tick: MarketTick): void {
    for (const session of this.sessions.values()) {
      if (session.instrument !== tick.instrument) continue;
      this.applyToSession(session, tick);
    }
  }

  get sessionCount(): number {
    return this.sessions.size;
  }

  /** Distinct instruments across all live sessions — drives stream subscriptions. */
  instrumentUnion(): string[] {
    return [...new Set([...this.sessions.values()].map((s) => s.instrument))];
  }

  private createSession(instrument: string, timeframe: Timeframe): Session {
    const session: Session = {
      instrument,
      timeframe,
      aggregator: new CandleAggregator(timeframe),
      buffer: [],
      subscribers: 0,
      pendingTicks: [],
      primingSettled: false,
      persistent: false,
    };

    if (NATIVE_HISTORY_GRANULARITY[timeframe] !== null && this.rest) {
      void this.prime(session).catch((err: unknown) => {
        // prime() never rejects in practice (it catches internally); kept
        // as defense so an async failure can never become unhandled.
        this.log.warn(
          {
            instrument,
            timeframe,
            reason: err instanceof Error ? err.message : "unknown",
          },
          "unexpected session priming failure"
        );
      });
    } else {
      session.primingSettled = true;
    }

    return session;
  }

  /**
   * Seeds the active bucket from native history so a freshly created
   * session does not produce an artificially short first candle. Ticks
   * arriving while the fetch runs are queued and replayed afterwards.
   */
  private async prime(session: Session): Promise<void> {
    try {
      assertRest(this.rest);
      const native = await this.rest.getNativeCandles(
        session.instrument,
        session.timeframe,
        PRIME_COUNT
      );

      let seedSource = native;
      const seconds = TIMEFRAME_SECONDS[session.timeframe];
      if (seconds > TIMEFRAME_SECONDS["5s"] && native.length > 0) {
        seedSource = aggregateCandles(native, seconds);
      }

      const nowBucketSec = bucketStart(Date.now(), seconds) / 1000;
      // Seed the ACTIVE bucket from native history so a freshly created
      // session continues OANDA's in-progress candle instead of building one
      // from zero. `>=` tolerates minor clock skew between us and OANDA.
      const candidate = seedSource.at(-1);
      if (candidate && candidate.time >= nowBucketSec) {
        session.aggregator.seed(candidate);
      }
    } catch (err: unknown) {
      this.log.warn(
        {
          instrument: session.instrument,
          timeframe: session.timeframe,
          reason: err instanceof Error ? err.message : "unknown",
        },
        "session priming failed; starting empty"
      );
    } finally {
      session.primingSettled = true;
      const pending = session.pendingTicks;
      session.pendingTicks = [];
      for (const tick of pending) {
        this.applyToSession(session, tick);
      }
    }
  }

  private applyToSession(session: Session, tick: MarketTick): void {
    if (!session.primingSettled) {
      if (session.pendingTicks.length < MAX_PENDING_TICKS) {
        session.pendingTicks.push(tick);
      }
      return;
    }

    const result = session.aggregator.apply(tick);
    if (!result) return;

    if (result.closed) {
      this.pushBuffer(session, result.closed);
      this.emitCandle(session, result.closed, true);
    }
    this.pushBuffer(session, result.candle);
    this.emitCandle(session, result.candle, false);
  }

  private emitCandle(session: Session, candle: Candle, closed: boolean): void {
    this.emit("candle", {
      instrument: session.instrument,
      timeframe: session.timeframe,
      candle,
      closed,
    } satisfies CandleEvent);
  }

  /** Keeps the buffer capped while always retaining the active candle last. */
  private pushBuffer(session: Session, candle: Candle): void {
    const buf = session.buffer;
    const last = buf.at(-1);
    if (last && last.time === candle.time) {
      buf[buf.length - 1] = { ...candle };
      return;
    }
    buf.push({ ...candle });
    if (buf.length > BUFFER_CAPACITY) {
      buf.splice(0, buf.length - BUFFER_CAPACITY);
    }
  }

  private markPersistent(key: string): void {
    const session = this.sessions.get(key);
    if (session) session.persistent = true;
  }
}

function assertRest(rest: HistorySource | null): asserts rest is HistorySource {
  if (!rest) throw new Error("REST client unavailable");
}

function sessionKey(instrument: string, timeframe: Timeframe): string {
  return `${instrument}|${timeframe}`;
}
