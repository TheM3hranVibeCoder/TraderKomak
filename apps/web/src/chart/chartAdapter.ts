/**
 * Lightweight Charts adapter.
 *
 * Encapsulates all direct interaction with `lightweight-charts` so the Vue
 * layer never touches the charting library directly. This keeps the store
 * and components provider-agnostic and makes it trivial to swap the charting
 * engine later without rewriting app logic.
 */
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type Time,
  ColorType,
  CrosshairMode,
} from "lightweight-charts";
import type { Candle } from "@traderkomak/shared";
import { instrumentPrecision } from "@traderkomak/shared";

export interface ChartAdapter {
  setData(candles: Candle[]): void;
  updateCandle(candle: Candle): void;
  fitContent(): void;
  /** Scroll so the newest candle sits at the right edge with the standard
   *  free margin — used by replay mode on start / play / exit. */
  focusLast(back?: number): void;
  /** Freeze / unfreeze the right price scale (replay mode keeps it fixed
   *  so stepping or playing never moves the chart). */
  setPriceAutoScale(on: boolean): void;
  /** Show / hide the series' own last-value label on the price scale
   *  (replay mode hides it and shows the replay price tag instead). */
  setLastValueVisible(on: boolean): void;
  resize(width: number, height: number): void;
  destroy(): void;
  setTheme(isDark: boolean): void;
  setInstrument(instrument: string): void;
  getLogicalRange(): { from: number; to: number } | null;
  setLogicalRange(range: { from: number; to: number } | null): void;
  getPriceY(price: number): number | null;
  /** Height of an axis price label, derived from the chart's font size. */
  getPriceLabelHeight(): number;
  /** Converts a UNIX timestamp (seconds) to an x-pixel on the chart. */
  timeToX(time: number): number | null;
  /** Converts a logical bar index to an x-pixel (works in the margins too). */
  logicalToX(logical: number): number | null;
  /** Converts an x-pixel on the chart back to a UNIX timestamp (seconds). */
  xToTime(x: number): number | null;
  /** Converts a y-pixel on the chart back to a price. */
  yToPrice(y: number): number | null;
  subscribeVisibleRange(cb: (range: { from: number; to: number } | null) => void): void;
  unsubscribeVisibleRange(cb: (range: { from: number; to: number } | null) => void): void;
  /** Fires whenever the series data changes (live ticks, corrections) —
   *  callers re-project price-anchored overlays (drawings) after this. */
  subscribeDataChanged(cb: () => void): void;
  unsubscribeDataChanged(cb: () => void): void;
}

function toLW(c: Candle): CandlestickData<Time> {
  return {
    time: c.time as Time,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  };
}

/**
 * Display-continuity: open := prevClose with high/low clamped so the body
 * still contains it (high/low/close keep their real values). Mirrors the
 * server's chainContinuity so LIVE candles and refreshed history render
 * identically — a transient open/close mismatch between consecutive streamed
 * candles (reconcile pacing, flat-guard divergences) never shows as a gap
 * between bodies, and a corrected candle re-chains its neighbour instantly
 * instead of after 2-3 more candles.
 */
function chainTo(prevClose: number, candle: Candle): Candle {
  const open = prevClose;
  return {
    ...candle,
    open,
    high: Math.max(candle.high, open),
    low: Math.min(candle.low, open),
  };
}

/** Empty bars of right margin so the future candle has space. */
const RIGHT_MARGIN_BARS = 15;

function themeColors(isDark: boolean) {
  if (isDark) {
    // Colorful dark gradient: deep indigo → midnight blue with violet tint
    return {
      bg: "#0f172a",
      bgTop: "#1e1b4b",
      bgBottom: "#0f172a",
      text: "#d1d4dc",
      grid: "rgba(255,255,255,0.03)",
      border: "#2a2e6a",
    };
  }
  // Colorful light gradient: soft lavender → peach, not plain white
  return {
    bg: "#f8fafc",
    bgTop: "#e0e7ff",
    bgBottom: "#fef3f8",
    text: "#1e1b4b",
    grid: "rgba(99,102,241,0.04)",
    border: "#c7d2fe",
  };
}

export function createChartAdapter(container: HTMLElement): ChartAdapter {
  const isDarkInitial = document.documentElement.getAttribute("data-theme") !== "light";
  const colors = themeColors(isDarkInitial);

  const chart: IChartApi = createChart(container, {
    layout: {
      // The pane gradient is painted in CSS (behind the canvas) so the
      // drawing layer can render between the background and the candles.
      background: { type: ColorType.Solid, color: "transparent" },
      textColor: colors.text,
    },
    grid: {
      vertLines: { visible: false },
      horzLines: { visible: false },
    },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: "#758696", width: 1, style: 1, labelBackgroundColor: "#2962ff" },
      horzLine: { color: "#758696", width: 1, style: 1, labelBackgroundColor: "#2962ff" },
    },
    rightPriceScale: {
      visible: true,
      borderColor: colors.border,
      scaleMargins: { top: 0.12, bottom: 0.12 },
      entireTextOnly: false,
      ticksVisible: true,
      borderVisible: true,
    },
    timeScale: {
      borderColor: colors.border,
      timeVisible: true,
      secondsVisible: true,
      rightOffset: 15,
      barSpacing: 5,
      minBarSpacing: 0.1, // deep zoom-out — all 5000 bars fit on screen
      fixLeftEdge: false,
      fixRightEdge: false,
      // Never let the library yank the viewport to the live edge on a new
      // bar — the user's scrolled position must survive candle closes.
      shiftVisibleRangeOnNewBar: false,
      lockVisibleTimeRangeOnResize: true,
    },
    handleScroll: {
      mouseWheel: true,
      pressedMouseMove: true,
      horzTouchDrag: true,
      vertTouchDrag: false,
    },
    handleScale: {
      axisPressedMouseMove: true,
      mouseWheel: true,
      pinch: true,
    },
  });

  const series: ISeriesApi<"Candlestick"> = chart.addCandlestickSeries({
    upColor: "#26a69a",
    downColor: "#ef5350",
    wickUpColor: "#26a69a",
    wickDownColor: "#ef5350",
    borderVisible: false,
    wickVisible: true,
    priceFormat: { type: "price", precision: 5, minMove: 0.00001 },
    priceLineVisible: true,
    lastValueVisible: true, // LWC's native blue price label at normal size
    priceLineWidth: 1,
    priceLineColor: "#2962ff",
  });

  let lastData: Candle[] = [];
  /** Flips true after the first non-empty dataset — enables view preservation. */
  let hadDataOnce = false;
  const rangeCbs = new Set<(range: { from: number; to: number } | null) => void>();
  const dataCbs = new Set<() => void>();
  const notifyDataChanged = () => {
    for (const cb of dataCbs) cb();
  };
  chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
    const r = range as { from: number; to: number } | null;
    for (const cb of rangeCbs) cb(r);
  });

  /** Seconds per bar, inferred from the data grid (time-grid charts). */
  function barSeconds(): number {
    if (lastData.length >= 2) {
      const d = lastData[lastData.length - 1]!.time - lastData[lastData.length - 2]!.time;
      if (d > 0) return d;
    }
    return 5;
  }

  /**
   * Linear x↔bar-index grid, calibrated on two integer bars inside the
   * visible range where LWC's `logicalToCoordinate` is exact (and uniform).
   *
   * Conversions MUST happen in index space rather than raw time: the data has
   * weekend/session gaps, so time is not linear in x across the dataset.
   * LWC's own reverse conversion (`coordinateToLogical`/`coordinateToTime`) is
   * only reliable ON data bars — in the right margin / over the price axis it
   * returns indices hundreds of bars off, which used to corrupt drawings
   * resized past the last candle. Everything off the data range therefore
   * extrapolates along this grid instead.
   */
  function barGrid(): { xRef: number; iRef: number; pxPerBar: number; barSec: number } | null {
    const n = lastData.length;
    if (n < 2) return null;
    let range: { from: number; to: number } | null = null;
    try {
      range = chart.timeScale().getVisibleLogicalRange() as { from: number; to: number } | null;
    } catch {
      return null;
    }
    if (!range) return null;
    const iFrom = Math.ceil(range.from);
    const iTo = Math.floor(range.to);
    if (iTo - iFrom < 1) return null; // degenerate viewport
    let xFrom: number | null = null;
    let xTo: number | null = null;
    try {
      xFrom = chart.timeScale().logicalToCoordinate(iFrom as never);
      xTo = chart.timeScale().logicalToCoordinate(iTo as never);
    } catch {
      return null;
    }
    if (xFrom === null || xTo === null || xTo === xFrom) return null;
    const barSec = barSeconds();
    if (barSec <= 0) return null;
    return { xRef: xFrom, iRef: iFrom, pxPerBar: (xTo - xFrom) / (iTo - iFrom), barSec };
  }

  /** Bar index → time: exact bar times inside the data, uniform seconds-per-bar
   *  extrapolation beyond either end (margins / over the axis / off-pane). */
  function indexToTime(i: number): number | null {
    const n = lastData.length;
    if (n === 0) return null;
    const idx = Math.round(i);
    if (idx >= n) return lastData[n - 1]!.time + (idx - (n - 1)) * barSeconds();
    if (idx < 0) return lastData[0]!.time + idx * barSeconds();
    return lastData[idx]!.time;
  }

  return {
    setData(candles: Candle[]): void {
      // Capture the user's viewport BEFORE replacing data so it survives
      // candle closes, snapshots and lazy-loads.
      const prevRange = chart.timeScale().getVisibleLogicalRange() as
        | { from: number; to: number }
        | null;
      const prevLen = lastData.length;
      const prevFirstTime = lastData.length ? lastData[0]!.time : null;

      lastData = [...candles].sort((a, b) => a.time - b.time);
      // Display-continuity pass (see chainTo)
      for (let i = 1; i < lastData.length; i++) {
        lastData[i] = chainTo(lastData[i - 1]!.close, lastData[i]!);
      }
      if (lastData.length === 0) {
        series.setData([]);
        notifyDataChanged();
        return;
      }
      series.setData(lastData.map(toLW));

      if (hadDataOnce && prevRange && prevLen > 0) {
        // Logical indices only shift when bars were added/removed at the
        // FRONT (lazy-load preloads). Appends at the END (candle closes,
        // snapshot catch-up) do NOT move existing indices — correcting by
        // the length delta there dragged the viewport toward the live edge
        // on every snapshot that landed at a candle close.
        const newFirstTime = lastData[0]!.time;
        let indexShift = 0;
        if (prevFirstTime !== null && newFirstTime !== prevFirstTime) {
          const barSec =
            lastData.length >= 2
              ? lastData[lastData.length - 1]!.time - lastData[lastData.length - 2]!.time
              : 60;
          if (barSec > 0) {
            indexShift = Math.round((prevFirstTime - newFirstTime) / barSec);
          }
        }
        if (indexShift !== 0) {
          chart.timeScale().setVisibleLogicalRange({
            from: prevRange.from + indexShift,
            to: prevRange.to + indexShift,
          });
        }
      } else {
        // Fresh mount / symbol / timeframe switch: reset price auto-scale
        // (vertical drags disable it and would freeze the OLD symbol's
        // price range) and open at the SAME default zoom on every timeframe:
        // the last ~150 bars plus the standard right margin. A freshly
        // (re)populating 1s buffer simply grows into the window.
        chart.priceScale("right").applyOptions({ autoScale: true });
        chart.timeScale().setVisibleLogicalRange({
          from: lastData.length - 150,
          to: lastData.length + RIGHT_MARGIN_BARS,
        });
      }
      hadDataOnce = true;
      notifyDataChanged();
    },

    updateCandle(candle: Candle): void {
      const idx = lastData.findIndex((c) => c.time === candle.time);
      if (idx >= 0) {
        // Update in place, re-chained to the predecessor (the server's
        // reconcile may correct any candle after the fact).
        lastData[idx] = chainTo(idx > 0 ? lastData[idx - 1]!.close : candle.open, candle);
        series.update(toLW(lastData[idx]));
      } else {
        // New bucket — insert WITHOUT touching the viewport. The chart must
        // never move on its own: if the user is at the live edge they can
        // pan right to reveal new bars; if scrolled away, nothing shifts.
        lastData.push({ ...candle });
        lastData.sort((a, b) => a.time - b.time);
        const at = lastData.findIndex((c) => c.time === candle.time);
        lastData[at] = chainTo(at > 0 ? lastData[at - 1]!.close : candle.open, lastData[at]!);
        series.update(toLW(lastData[at]));
      }
      // The updated/corrected candle changes the close its successor was
      // chained to — re-chain the neighbour so bodies never detach.
      const nextIdx = lastData.findIndex((c) => c.time === candle.time) + 1;
      const next = lastData[nextIdx];
      if (next && next.open !== lastData[nextIdx - 1]!.close) {
        lastData[nextIdx] = chainTo(lastData[nextIdx - 1]!.close, next);
        series.update(toLW(lastData[nextIdx]));
      }
      if (lastData.length > 5000) lastData = lastData.slice(-5000);
      notifyDataChanged();
    },

    fitContent(): void {
      chart.timeScale().fitContent();
    },

    focusLast(back = 150): void {
      if (!lastData.length) return;
      const last = lastData.length - 1;
      chart.timeScale().setVisibleLogicalRange({
        from: last - (back - 1),
        to: last + RIGHT_MARGIN_BARS,
      });
    },

    setPriceAutoScale(on: boolean): void {
      chart.priceScale("right").applyOptions({ autoScale: on });
    },

    setLastValueVisible(on: boolean): void {
      series.applyOptions({ lastValueVisible: on });
    },

    resize(width: number, height: number): void {
      chart.resize(width, height);
    },

    setTheme(isDark: boolean): void {
      const c = themeColors(isDark);
      chart.applyOptions({
        layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: c.text },
        grid: { vertLines: { visible: false }, horzLines: { visible: false } },
        rightPriceScale: { borderColor: c.border },
        timeScale: { borderColor: c.border },
      });
    },
    setInstrument(instrument: string): void {
      const prec = instrumentPrecision(instrument);
      // Smallest displayable increment always matches the precision
      const minMove = Math.pow(10, -prec);
      series.applyOptions({
        priceFormat: { type: "price", precision: prec, minMove },
      });
      // New symbol → always re-fit the price axis to ITS range
      chart.priceScale("right").applyOptions({ autoScale: true });
    },
    getLogicalRange(): { from: number; to: number } | null {
      return chart.timeScale().getVisibleLogicalRange() as { from: number; to: number } | null;
    },
    setLogicalRange(range: { from: number; to: number } | null): void {
      if (!range) return;
      // The rightOffset OPTION would otherwise re-assert itself and snap the
      // viewport back (visible as a 1-bar drift on replay backward steps) —
      // keep it in sync with the requested range.
      chart.timeScale().applyOptions({
        rightOffset: Math.max(0, range.to - (lastData.length - 1)),
      });
      chart.timeScale().setVisibleLogicalRange(range);
    },
    getPriceY(price: number): number | null {
      try {
        const y = series.priceToCoordinate(price as never);
        return typeof y === "number" && Number.isFinite(y) ? y : null;
      } catch {
        return null;
      }
    },
    getPriceLabelHeight(): number {
      // Lightweight Charts sizes axis labels from layout.fontSize
      // (~1.55× tall incl. padding). Read it instead of hardcoding.
      const opts = chart.options() as { layout?: { fontSize?: number } };
      const fs = opts.layout?.fontSize ?? 12;
      return Math.max(16, Math.round(fs * 1.55));
    },
    timeToX(time: number): number | null {
      try {
        const x = chart.timeScale().timeToCoordinate(time as never);
        if (typeof x === "number" && Number.isFinite(x)) return x;
      } catch {
        /* fall through to bar-grid extrapolation */
      }
      // timeToCoordinate returns null for times off the current bar grid —
      // both outside the data range (margins) and for in-data times that
      // aren't on a bucket boundary (e.g. a 1s-anchored rectangle edge
      // viewed on the 5s chart). Project along the calibrated bar grid:
      // outside the data extrapolate; inside it, locate the surrounding
      // bars and interpolate (index space — session gaps make time
      // non-linear in x, see barGrid).
      const grid = barGrid();
      if (!grid) return null;
      const n = lastData.length;
      const lastT = lastData[n - 1]!.time;
      const firstT = lastData[0]!.time;
      let logical: number;
      if (time >= lastT) {
        logical = n - 1 + (time - lastT) / grid.barSec;
      } else if (time <= firstT) {
        logical = (time - firstT) / grid.barSec;
      } else {
        let lo = 0;
        let hi = n - 1;
        let i = 0;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if (lastData[mid]!.time <= time) {
            i = mid;
            lo = mid + 1;
          } else {
            hi = mid - 1;
          }
        }
        const t0 = lastData[i]!.time;
        const t1 = i + 1 < n ? lastData[i + 1]!.time : t0 + grid.barSec;
        const frac = t1 > t0 ? (time - t0) / (t1 - t0) : 0;
        logical = i + frac;
      }
      return grid.xRef + (logical - grid.iRef) * grid.pxPerBar;
    },
    logicalToX(logical: number): number | null {
      try {
        const x = chart.timeScale().logicalToCoordinate(logical as never);
        return typeof x === "number" && Number.isFinite(x) ? x : null;
      } catch {
        return null;
      }
    },
    xToTime(x: number): number | null {
      // Pure bar-grid conversion: in the margins / over the price axis LWC's
      // coordinateToTime returns null (or worse, off-by-hundreds-of-bars
      // indices), so always convert via the calibrated index grid. The result
      // is always an exact bar time (grid-aligned), so timeToX renders it
      // exactly — full round-trip fidelity for drawing handles.
      const grid = barGrid();
      if (!grid) return null;
      const logical = grid.iRef + (x - grid.xRef) / grid.pxPerBar;
      if (!Number.isFinite(logical)) return null;
      return indexToTime(logical);
    },
    yToPrice(y: number): number | null {
      try {
        const p = series.coordinateToPrice(y as never);
        return typeof p === "number" && Number.isFinite(p) ? p : null;
      } catch {
        return null;
      }
    },
    subscribeVisibleRange(cb: (range: { from: number; to: number } | null) => void): void {
      rangeCbs.add(cb);
    },
    unsubscribeVisibleRange(cb: (range: { from: number; to: number } | null) => void): void {
      rangeCbs.delete(cb);
    },

    subscribeDataChanged(cb: () => void): void {
      dataCbs.add(cb);
    },
    unsubscribeDataChanged(cb: () => void): void {
      dataCbs.delete(cb);
    },

    destroy(): void {
      chart.remove();
    },
  };
}
