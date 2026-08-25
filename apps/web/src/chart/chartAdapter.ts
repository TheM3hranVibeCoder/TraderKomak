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
  /** Converts an x-pixel on the chart back to a UNIX timestamp (seconds). */
  xToTime(x: number): number | null;
  /** Converts a y-pixel on the chart back to a price. */
  yToPrice(y: number): number | null;
  subscribeVisibleRange(cb: (range: { from: number; to: number } | null) => void): void;
  unsubscribeVisibleRange(cb: (range: { from: number; to: number } | null) => void): void;
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
      background: { type: ColorType.VerticalGradient, topColor: colors.bgTop, bottomColor: colors.bgBottom },
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
  chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
    const r = range as { from: number; to: number } | null;
    for (const cb of rangeCbs) cb(r);
  });

  return {
    setData(candles: Candle[]): void {
      // Capture the user's viewport BEFORE replacing data so it survives
      // candle closes, snapshots and lazy-loads.
      const prevRange = chart.timeScale().getVisibleLogicalRange() as
        | { from: number; to: number }
        | null;
      const prevLen = lastData.length;

      lastData = [...candles].sort((a, b) => a.time - b.time);
      if (lastData.length === 0) {
        series.setData([]);
        return;
      }
      series.setData(lastData.map(toLW));

      if (hadDataOnce && prevRange && prevLen > 0) {
        // Preserve the exact viewport, shifted by however many bars were
        // added/removed at either end (closes, appends, lazy preloads…).
        const delta = lastData.length - prevLen;
        chart.timeScale().setVisibleLogicalRange({
          from: prevRange.from + delta,
          to: prevRange.to + delta,
        });
      } else {
        // Fresh mount / symbol / timeframe switch: reset price auto-scale
        // (vertical drags disable it and would freeze the OLD symbol's
        // price range) and show recent bars with right margin.
        chart.priceScale("right").applyOptions({ autoScale: true });
        const visible = Math.min(150, lastData.length);
        chart.timeScale().setVisibleLogicalRange({
          from: lastData.length - visible,
          to: lastData.length + RIGHT_MARGIN_BARS,
        });
      }
      hadDataOnce = true;
    },

    updateCandle(candle: Candle): void {
      const existing = lastData.find((c) => c.time === candle.time);
      if (existing) {
        Object.assign(existing, candle);
        series.update(toLW(candle));
      } else {
        // New bucket — append WITHOUT touching the viewport. The chart must
        // never move on its own: if the user is at the live edge they can
        // pan right to reveal new bars; if scrolled away, nothing shifts.
        lastData.push({ ...candle });
        lastData.sort((a, b) => a.time - b.time);
        series.update(toLW(candle));
      }
      if (lastData.length > 5000) lastData = lastData.slice(-5000);
    },

    fitContent(): void {
      chart.timeScale().fitContent();
    },

    resize(width: number, height: number): void {
      chart.resize(width, height);
    },

    setTheme(isDark: boolean): void {
      const c = themeColors(isDark);
      chart.applyOptions({
        layout: { background: { type: ColorType.VerticalGradient, topColor: c.bgTop, bottomColor: c.bgBottom }, textColor: c.text },
        grid: { vertLines: { visible: false }, horzLines: { visible: false } },
        rightPriceScale: { borderColor: c.border },
        timeScale: { borderColor: c.border },
      });
    },
    setInstrument(instrument: string): void {
      const prec = instrumentPrecision(instrument);
      const minMove = prec === 3 ? 0.001 : prec === 2 ? 0.01 : 0.00001;
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
      if (range) chart.timeScale().setVisibleLogicalRange(range);
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
        return typeof x === "number" && Number.isFinite(x) ? x : null;
      } catch {
        return null;
      }
    },
    xToTime(x: number): number | null {
      try {
        const t = chart.timeScale().coordinateToTime(x as never);
        if (t === null || t === undefined) return null;
        return typeof t === "number" ? t : null;
      } catch {
        return null;
      }
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

    destroy(): void {
      chart.remove();
    },
  };
}
