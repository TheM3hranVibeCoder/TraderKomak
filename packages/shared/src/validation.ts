import {
  SEARCHABLE_INSTRUMENTS,
  normalizeInstrument,
} from "./constants/instruments.js";
import { TIMEFRAMES, type Timeframe } from "./constants/timeframes.js";
import type {
  ClientMessage,
  SubscribeMessage,
  UnsubscribeMessage,
  PingMessage,
  WatchMessage,
} from "./types/protocol.js";

const INSTRUMENT_SET: ReadonlySet<string> = new Set(
  SEARCHABLE_INSTRUMENTS.map(normalizeInstrument)
);

/** True when `raw` (any common notation) maps to a supported instrument. */
export function isInstrument(raw: unknown): raw is string {
  return typeof raw === "string" && INSTRUMENT_SET.has(normalizeInstrument(raw));
}

export function isTimeframe(value: unknown): value is Timeframe {
  return typeof value === "string" && (TIMEFRAMES as readonly string[]).includes(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parses and validates an incoming WebSocket text frame into a
 * ClientMessage. Returns `{ ok: false, error }` for anything malformed so
 * callers can reply with a safe error instead of crashing.
 */
export function parseClientMessage(
  raw: string
): { ok: true; message: ClientMessage } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "Message is not valid JSON" };
  }

  if (!isPlainObject(parsed) || typeof parsed.type !== "string") {
    return { ok: false, error: 'Message must be an object with a "type" field' };
  }

  switch (parsed.type) {
    case "subscribe":
      return parseSubscribe(parsed);
    case "unsubscribe":
      return ok({ type: "unsubscribe" } satisfies UnsubscribeMessage);
    case "watch":
      return parseWatch(parsed);
    case "ping":
      return ok({ type: "ping" } satisfies PingMessage);
    default:
      return { ok: false, error: `Unknown message type "${String(parsed.type)}"` };
  }
}

function parseSubscribe(
  parsed: Record<string, unknown>
): { ok: true; message: ClientMessage } | { ok: false; error: string } {
  if (!isInstrument(parsed.instrument)) {
    return { ok: false, error: "Unknown or unsupported instrument" };
  }
  if (!isTimeframe(parsed.timeframe)) {
    return { ok: false, error: "Unknown or unsupported timeframe" };
  }
  return ok({
    type: "subscribe",
    instrument: normalizeInstrument(parsed.instrument),
    timeframe: parsed.timeframe,
  });
}

function parseWatch(
  parsed: Record<string, unknown>
): { ok: true; message: ClientMessage } | { ok: false; error: string } {
  const raw = parsed.instruments;
  if (!Array.isArray(raw)) {
    return { ok: false, error: "watch requires instruments array" };
  }
  if (raw.length > 20) {
    return { ok: false, error: "too many instruments (max 20)" };
  }
  const instruments: string[] = [];
  for (const v of raw) {
    if (!isInstrument(v)) {
      return { ok: false, error: `Unknown instrument: ${String(v)}` };
    }
    instruments.push(normalizeInstrument(String(v)));
  }
  return ok({ type: "watch", instruments } satisfies WatchMessage);
}

function ok<T extends ClientMessage>(message: T): { ok: true; message: ClientMessage } {
  return { ok: true, message };
}
