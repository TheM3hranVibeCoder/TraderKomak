/**
 * Structured logging policy:
 *
 * - Logs: connection status, OANDA connect/reconnect, subscription changes,
 *   WebSocket client counts, API errors.
 * - NEVER logs: API tokens, Authorization headers or any other credentials.
 *
 * Fastify ships with pino; we use it everywhere for consistency and add a
 * global redact list as defense-in-depth.
 */
import type { LoggerOptions } from "pino";

export const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "*.token",
  "token",
  "apiToken",
  "OANDA_API_TOKEN",
] as const;

export function serverLoggerOptions(level: string): LoggerOptions {
  return {
    level,
    redact: {
      paths: [...REDACT_PATHS],
      censor: "[REDACTED]",
    },
  };
}

/** Child logger factory for non-fastify modules. */
export type Log = {
  info: (obj: object, msg?: string) => void;
  warn: (obj: object, msg?: string) => void;
  error: (obj: object, msg?: string) => void;
  debug: (obj: object, msg?: string) => void;
};
