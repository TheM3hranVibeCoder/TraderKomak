/* ── Indicator math (pure, no reactive/DOM coupling) ──────────────────────
 * Extracted from ChartPane.vue so the 8k-line component stays smaller and the
 * math can be unit-tested in isolation. These take a close-price series and a
 * length and return one value per input (null where undefined). */

/** Wilder's RSI over the close series. */
export function computeRsi(closes: number[], length: number): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length <= length) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= length; i++) {
    const d = closes[i]! - closes[i - 1]!;
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= length;
  loss /= length;
  out[length] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = length + 1; i < closes.length; i++) {
    const d = closes[i]! - closes[i - 1]!;
    gain = (gain * (length - 1) + Math.max(d, 0)) / length;
    loss = (loss * (length - 1) + Math.max(-d, 0)) / length;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

/** Simple moving average over `length` closes. */
export function computeSma(closes: number[], length: number): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length < length || length < 1) return out;
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i]!;
    if (i >= length) sum -= closes[i - length]!;
    if (i >= length - 1) out[i] = sum / length;
  }
  return out;
}

/** Exponential moving average — seeded with an SMA of the first `length`. */
export function computeEma(closes: number[], length: number): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length < length || length < 1) return out;
  const k = 2 / (length + 1);
  let sum = 0;
  let prev = 0;
  for (let i = 0; i < closes.length; i++) {
    if (i < length) {
      sum += closes[i]!;
      if (i === length - 1) {
        prev = sum / length;
        out[i] = prev;
      }
      continue;
    }
    prev = closes[i]! * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}
