/**
 * Constant-time string equality.
 *
 * Shared by every secret gate (chat admin key, edge auth marker, Binance
 * relay secret) so no gate relies on a plain `===` that leaks length/prefix
 * information through timing.
 */
import { createHash, timingSafeEqual } from "node:crypto";

export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}
