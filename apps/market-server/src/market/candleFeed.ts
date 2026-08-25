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
  nativeCandlesNeeded,
  type Candle,
  type MarketTick,
  type Timeframe,
} from "@traderkomak/shared";
import { CandleAggregator, aggregateCandles, fillGaps } from "./aggregator.js";
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

/**
 * How long a tick silence is treated as a "lull" vs a market closure.
 * Within this window we keep synthesizing flat continuation candles
 * (the practice pricing stream is much thinner than the tick database
 * OANDA builds candles from — lulls of 10–60s are normal). Beyond it
 * (weekends, outages) synthesis stops so we never spam dead-market bars.
 */
const SYNTH_WINDOW_MS = 5 * 60_000;

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
  /** Fires at each bucket boundary so candles roll over on time —
   *  even when the tick stream is silent. */
  rollover: NodeJS.Timeout | null;
  /** Timestamp of the last real tick — gates synthetic rollovers. */
  lastTickAt: number;
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
    session.subscribers = 1; // createSession starts at 0 — count this one
    this.sessions.set(key, session);
    this.log.info({ instrument, timeframe }, "aggregation session created");
  }

  removeSubscriber(instrument: string, timeframe: Timeframe): void {
    const key = sessionKey(instrument, timeframe);
    const session = this.sessions.get(key);
    if (!session) return;
    session.subscribers--;
    if (session.subscribers <= 0 && !session.persistent) {
      if (session.rollover) clearTimeout(session.rollover);
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

      const tfSec = TIMEFRAME_SECONDS[session.timeframe];
      const silentMs = session.lastTickAt > 0 ? tick.timestamp - session.lastTickAt : 0;

      // Silence beyond the synthesis window = market closed / outage.
      // The buffer may hold synthetic candles from before — drop them so
      // history and snapshots stay authoritative.
      if (silentMs > SYNTH_WINDOW_MS) {
        if (session.buffer.length > 0) {
          this.log.info(
            { instrument: session.instrument, timeframe: session.timeframe, silentMs },
            "long tick gap — purging stale buffer"
          );
          session.buffer.length = 0;
        }
      }
      session.lastTickAt = tick.timestamp;

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
      rollover: null,
      lastTickAt: 0,
    };

    // Roll candles over exactly at each bucket boundary — independent of
    // tick arrival — so the live chart never shows a delayed/missing bar.
    this.scheduleRollover(session);

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
      // After a very long gap the "closed" candle predates the silence —
      // don't emit/persist it; the fresh bucket is what matters.
      const tfSec = TIMEFRAME_SECONDS[session.timeframe];
      const tickBucket = Math.floor(tick.timestamp / (tfSec * 1000));
      const stale = tickBucket - result.closed.time > 60;
      if (!stale) {
        this.pushBuffer(session, result.closed);
        this.emitCandle(session, result.closed, true);
        // Replace our stream-subset version with OANDA's authoritative candle
        // for that bucket (and backfill any skipped buckets) so closed bars
        // always match the history feed — no close/open seams or gaps.
        this.reconcileClosed(session, result.closed);
      }
    }
    this.pushBuffer(session, result.candle);
    this.emitCandle(session, result.candle, false);
  }

  /** One reconcile in-flight per session — latest closed candle wins. */
  private readonly reconciling = new Set<string>();
  /** Global reconcile pacing — protects the provider rate budget from the
   *  per-second closes of high-frequency (1s) sessions. */
  private lastReconcileAt = 0;
  /** Back-off window after a provider rate-limit rejection. */
  private reconcileCooldownUntil = 0;

  /**
   * Fetches the authoritative candle for a just-closed bucket from the
   * provider and swaps it into the buffer + re-broadcasts. Also backfills
   * buckets that were skipped entirely (no ticks received).
   */
  private reconcileClosed(session: Session, closed: Candle): void {
    if (!this.rest) return;
    if (session.subscribers <= 0) return; // nobody watching — save the budget

    const now = Date.now();
    if (now < this.reconcileCooldownUntil) return; // rate-limited — wait
    if (now - this.lastReconcileAt < 2000) return; // global pacing: ≤1 per 2s

    const key = sessionKey(session.instrument, session.timeframe);
    if (this.reconciling.has(key)) return;
    this.reconciling.add(key);
    this.lastReconcileAt = now;

    void (async () => {
      try {
        const rest = this.rest!;
        const tfSec = TIMEFRAME_SECONDS[session.timeframe];
        // `to` = 1s before the NEXT bucket start → selects exactly the
        // closed bucket (works for native and S5-derived timeframes).
        const toIso = new Date((closed.time + tfSec - 1) * 1000).toISOString();
        const native = await rest.getNativeCandles(
          session.instrument,
          session.timeframe,
          nativeCandlesNeeded(session.timeframe, 1),
          toIso
        );

        let auth: Candle | undefined;
        if (
          NATIVE_HISTORY_GRANULARITY[session.timeframe] === "S5" &&
          tfSec > TIMEFRAME_SECONDS["5s"]
        ) {
          auth = aggregateCandles(native, tfSec).at(-1);
        } else {
          auth = native.at(-1);
        }

        // OANDA sometimes has NO candle for the bucket (zero ticks even in
        // their full feed). Their platform chart carries the previous close
        // forward — do the same when the bucket is contiguous with ours.
        const bufPre = session.buffer;
        const prevBuf = bufPre.length >= 2 ? bufPre[bufPre.length - 2] : bufPre.at(-1);
        if ((!auth || auth.time !== closed.time) && prevBuf) {
          const contiguous =
            closed.time - prevBuf.time === tfSec || prevBuf.time === closed.time;
          if (contiguous && Number.isFinite(prevBuf.close)) {
            auth = {
              time: closed.time,
              open: prevBuf.close,
              high: prevBuf.close,
              low: prevBuf.close,
              close: prevBuf.close,
            };
          }
        }

        if (!auth || auth.time !== closed.time) return;

        // Fill skipped buckets FIRST so clients receive fills → corrected
        // close in natural order.
        await this.backfillGap(session, auth);

        const buf = session.buffer;
        // The closed candle sits BEFORE the new active candle — find it by
        // bucket time rather than assuming position.
        let idx = -1;
        for (let i = buf.length - 1; i >= 0; i--) {
          if (buf[i]!.time === auth.time) {
            idx = i;
            break;
          }
        }
        if (idx === -1) return;
        const existing = buf[idx]!;
        if (
          existing.open === auth.open &&
          existing.high === auth.high &&
          existing.low === auth.low &&
          existing.close === auth.close
        ) {
          return; // already identical — nothing to correct
        }
        buf[idx] = { ...auth };
        this.emitCandle(session, auth, true);
      } catch (err) {
        // Provider pushed back on volume — cool down so the next attempts
        // (and user history requests) succeed instead of compounding.
        const code = (err as { code?: string } | null)?.code;
        if (code === "RATE_LIMITED") {
          this.reconcileCooldownUntil = Date.now() + 15_000;
          this.log.warn(
            { instrument: session.instrument, timeframe: session.timeframe },
            "reconcile rate-limited — cooling down 15s"
          );
        }
        // other transient errors: the next close retries anyway
      } finally {
        this.reconciling.delete(key);
      }
    })();
  }

  /** Fills skipped buckets between the previous closed bar and `justClosed`. */
  private async backfillGap(session: Session, justClosed: Candle): Promise<void> {
    const rest = this.rest;
    if (!rest) return;
    const buf = session.buffer;
    if (buf.length < 2) return;
    const tfSec = TIMEFRAME_SECONDS[session.timeframe];
    const prev = buf[buf.length - 2]!;
    const missing = Math.floor((justClosed.time - prev.time) / tfSec) - 1;
    if (missing <= 0) return; // contiguous
    if (missing > 200) return; // downtime storm — skip, history covers it

    const toIso = new Date((justClosed.time - 1) * 1000).toISOString();
    const native = await rest.getNativeCandles(
      session.instrument,
      session.timeframe,
      nativeCandlesNeeded(session.timeframe, missing),
      toIso
    );
    let fill: Candle[] = native;
    if (
      NATIVE_HISTORY_GRANULARITY[session.timeframe] === "S5" &&
      tfSec > TIMEFRAME_SECONDS["5s"]
    ) {
      fill = aggregateCandles(native, tfSec);
    }
    // OANDA omits zero-tick buckets — forward-fill them like their chart
    fill = fillGaps(fill, tfSec);
    const inserts = fill.filter((c) => c.time > prev.time && c.time < justClosed.time);
    if (inserts.length === 0) return;

    buf.splice(buf.length - 1, 0, ...inserts.map((c) => ({ ...c })));
    for (const c of inserts) {
      this.emitCandle(session, c, true);
    }
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

  /**
   * Schedules the next bucket-boundary rollover (+50ms epsilon so the
   * boundary has definitively passed). Re-arms itself forever while the
   * session lives; cleared on session release.
   */
  private scheduleRollover(session: Session): void {
    if (session.rollover) clearTimeout(session.rollover);
    const tfMs = TIMEFRAME_SECONDS[session.timeframe] * 1000;
    const now = Date.now();
    const nextBoundary = Math.floor(now / tfMs) * tfMs + tfMs;
    const timer = setTimeout(
      () => this.onRollover(session),
      Math.max(50, nextBoundary - now + 50)
    );
    timer.unref?.();
    session.rollover = timer;
  }

  /**
   * Boundary crossed. If ticks already rolled the aggregator forward we have
   * nothing to do; otherwise the stream was silent — force-close the previous
   * candle and open a flat continuation candle seeded with its close so the
   * live chart stays gapless. Reconciliation corrects values right after.
   */
  private onRollover(session: Session): void {
    try {
      const tfSec = TIMEFRAME_SECONDS[session.timeframe];
      const bucketSec = Math.floor(Date.now() / (tfSec * 1000)) * tfSec;
      const active = session.aggregator.active;

      // Only synthesize within the lull window. Beyond it (weekend /
      // outage) we stay silent — real ticks resume the chain naturally.
      const silentMs = session.lastTickAt > 0 ? Date.now() - session.lastTickAt : Infinity;
      if (silentMs > SYNTH_WINDOW_MS) {
        return; // gated — just re-arm
      }

      if (active && active.time < bucketSec) {
        // Previous bucket never got a boundary-crossing tick → close it now
        this.emitCandle(session, active, true);
        this.pushBuffer(session, active);

        // Open the new bucket as a flat continuation of the previous close
        const seed: Candle = {
          time: bucketSec,
          open: active.close,
          high: active.close,
          low: active.close,
          close: active.close,
        };
        session.aggregator.seed(seed);
        this.pushBuffer(session, seed);
        this.emitCandle(session, seed, false);
      }
    } catch {
      /* never let the rollover chain die */
    }
    this.scheduleRollover(session);
  }
}

function assertRest(rest: HistorySource | null): asserts rest is HistorySource {
  if (!rest) throw new Error("REST client unavailable");
}

function sessionKey(instrument: string, timeframe: Timeframe): string {
  return `${instrument}|${timeframe}`;
}
