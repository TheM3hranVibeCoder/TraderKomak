/**
 * Pine Script errors — every failure carries the 1-based source line so the
 * editor can scroll to it and underline it.
 */

export class PineError extends Error {
  constructor(
    message: string,
    public readonly line: number
  ) {
    super(message);
    this.name = "PineError";
  }
}

/** Runtime failure (per-bar execution) — also carries the line. */
export class PineRuntimeError extends PineError {}
