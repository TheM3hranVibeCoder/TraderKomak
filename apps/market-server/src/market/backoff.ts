/**
 * Reconnect backoff schedule (pure function — unit tested).
 *
 * Exponential growth with ±20% jitter, hard-capped. Attempt numbering
 * starts at 1; callers reset the attempt counter after any successful
 * connection.
 */
export function backoffDelayMs(
  attempt: number,
  baseMs = 1000,
  capMs = 30_000
): number {
  const n = Math.max(1, Math.floor(attempt));
  const exponential = Math.min(capMs, baseMs * 2 ** (n - 1));
  const jitter = (Math.random() * 2 - 1) * 0.2 * exponential;
  return Math.max(baseMs, Math.min(capMs, Math.floor(exponential + jitter)));
}
