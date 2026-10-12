/* ── Pure formatting / color helpers (no reactive or DOM coupling) ─────────
 * Extracted from ChartPane.vue so the giant component stays smaller and these
 * can be unit-tested in isolation. */

/** Minutes-of-day (0..1439) → "HH:MM" (wraps across midnight). */
export function toTimeStr(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
}

/** CSS class for a signed PnL value. */
export function pnlClass(v: number | undefined): string {
  return (v ?? 0) >= 0 ? "pos" : "neg";
}

/** Signed money with a leading sign and 2 decimals, e.g. "$1,234.56" / "-$9.00". */
export function fmtMoney(v: number): string {
  return (v >= 0 ? "$" : "-$") + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Relative luminance 0–1 of a #rrggbb color (perceptual weights). */
export function relLuma(hex: string): number {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return 0;
  const n = parseInt(m[1]!, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/** Midpoint blend of two 6-digit hex colors (for gradient backgrounds). */
export function mixHex(a: string, b: string): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  if (pa.some(Number.isNaN) || pb.some(Number.isNaN)) return a;
  const m = pa.map((v, i) => Math.round((v + pb[i]!) / 2));
  return `#${m.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
