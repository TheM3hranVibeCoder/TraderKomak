import { defineStore } from "pinia";
import { ref } from "vue";

/**
 * Replay mode (TradingView-style): a vertical line picks a point on the
 * chart; everything to the right of it is hidden, then candles are revealed
 * one-by-one with play/pause, stepping and 1x–10x speed.
 */
export const useReplayStore = defineStore("replay", () => {
  /** A replay session exists (vertical line visible on the chart). */
  const active = ref(false);
  /** Choosing the start point — the line follows the mouse until a click. */
  const picking = ref(false);
  /** UNIX seconds — candles with time > cutoff are hidden. */
  const cutoff = ref<number | null>(null);
  const playing = ref(false);
  const speed = ref<1 | 2 | 5 | 10>(1);

  /** Enter replay: show the line and wait for the user to pick a point. */
  function begin(): void {
    active.value = true;
    picking.value = true;
    cutoff.value = null;
    playing.value = false;
  }

  /** Start playback from the picked point (hides everything after it). */
  function startAt(t: number): void {
    picking.value = false;
    cutoff.value = t;
  }

  /** Move the replay boundary to another candle time. */
  function stepTo(t: number): void {
    cutoff.value = t;
  }

  /** Leave replay and restore the full chart. */
  function exit(): void {
    active.value = false;
    picking.value = false;
    playing.value = false;
    cutoff.value = null;
  }

  return { active, picking, cutoff, playing, speed, begin, startAt, stepTo, exit };
});
