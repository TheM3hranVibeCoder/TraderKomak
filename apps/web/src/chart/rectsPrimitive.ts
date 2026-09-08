/**
 * Rectangle drawing primitive — paints rectangles INSIDE Lightweight Charts'
 * own canvas render pass via the series-primitives API (v4.1+).
 *
 * Why: the rectangles used to be DOM divs re-projected on every chart
 * movement. That update lands at least one frame AFTER the chart canvas
 * painted, so on slow (no-GPU) machines the drawings visibly trail the
 * candles during fast pan/zoom. A primitive draws in the SAME render pass as
 * the candles — frame-locked by construction, on any hardware.
 *
 * The projection functions are injected (the chart adapter's margin-aware
 * timeToX / getPriceY) and are called at DRAW time, so every frame reads the
 * chart state that is being rendered right now — no staleness is possible.
 *
 * Interaction is NOT handled here: hit-testing, drag/resize, selection and
 * the edit panel stay on the existing DOM hit layer, which is invisible and
 * behaves exactly as before.
 */
import type {
  ISeriesPrimitive,
  ISeriesPrimitivePaneRenderer,
  ISeriesPrimitivePaneView,
  SeriesAttachedParameter,
  SeriesPrimitivePaneViewZOrder,
  Time,
} from "lightweight-charts";
import type { CanvasRenderingTarget2D } from "fancy-canvas";

/** A rectangle in TIME/PRICE space (the stored drawing), not pixels. */
export interface CanvasRect {
  time1: number;
  price1: number;
  time2: number;
  price2: number;
  color: string;
  opacity: number;
  filled: boolean;
  selected: boolean;
}

export interface RectsPrimitiveOptions {
  /** Current rectangle set (called once per frame at draw time). */
  getRects: () => readonly CanvasRect[];
  /** Time (seconds) → x in CSS pixels, or null when unprojectable. */
  timeToX: (time: number) => number | null;
  /** Price → y in CSS pixels, or null. */
  priceToY: (price: number) => number | null;
}

class RectsPaneRenderer implements ISeriesPrimitivePaneRenderer {
  constructor(
    private readonly rects: readonly CanvasRect[],
    private readonly opt: RectsPrimitiveOptions
  ) {}

  draw(target: CanvasRenderingTarget2D): void {
    const { getRects, timeToX, priceToY } = this.opt;
    const rects = getRects();
    if (rects.length === 0) return;
    target.useBitmapCoordinateSpace((scope) => {
      const { context: ctx, horizontalPixelRatio: hx, verticalPixelRatio: vy } = scope;
      for (const rect of rects) {
        const x1 = timeToX(rect.time1);
        const y1 = priceToY(rect.price1);
        const x2 = timeToX(rect.time2);
        const y2 = priceToY(rect.price2);
        if (x1 === null || y1 === null || x2 === null || y2 === null) continue;
        const left = Math.min(x1, x2) * hx;
        const top = Math.min(y1, y2) * vy;
        const width = Math.max(1, Math.abs(x2 - x1)) * hx;
        const height = Math.max(1, Math.abs(y2 - y1)) * vy;

        ctx.save();
        if (rect.filled) {
          ctx.globalAlpha = rect.opacity;
          ctx.fillStyle = rect.color;
          ctx.fillRect(left, top, width, height);
        }
        // Border always drawn at full opacity (matches the old DOM look,
        // where opacity applied to the fill/background only).
        ctx.globalAlpha = 1;
        ctx.strokeStyle = rect.color;
        ctx.lineWidth = (rect.selected ? 2.5 : 1.5) * hx;
        if (rect.selected) {
          ctx.shadowColor = rect.color;
          ctx.shadowBlur = 6 * hx;
        }
        ctx.strokeRect(left, top, width, height);
        ctx.restore();
      }
    });
  }
}

class RectsPaneView implements ISeriesPrimitivePaneView {
  constructor(private readonly opt: RectsPrimitiveOptions) {}

  /** Rectangles render behind the candles, exactly like the old DOM layer. */
  zOrder(): SeriesPrimitivePaneViewZOrder {
    return "bottom";
  }

  renderer(): ISeriesPrimitivePaneRenderer | null {
    if (this.opt.getRects().length === 0) return null;
    return new RectsPaneRenderer(this.opt.getRects(), this.opt);
  }
}

export type RectsPrimitive = ISeriesPrimitive<Time> & { requestUpdate(): void };

/**
 * Create the primitive. Attach with `series.attachPrimitive(...)`.
 * LWC calls the pane view's renderer during every render pass; because the
 * renderer pulls the rectangle set and projects it fresh at draw time, no
 * explicit invalidation bookkeeping is needed here — the caller only has to
 * ask LWC for a repaint when a drawing changes while nothing else moves
 * (see the adapter's `redrawDrawings`).
 */
export function createRectsPrimitive(opt: RectsPrimitiveOptions): RectsPrimitive {
  const view = new RectsPaneView(opt);
  let attached: SeriesAttachedParameter<Time> | null = null;
  return {
    paneViews: () => [view],
    attached(param: SeriesAttachedParameter<Time>): void {
      attached = param;
    },
    detached(): void {
      attached = null;
    },
    /** Exposed so the host can trigger a repaint after a drawing-only change. */
    requestUpdate(): void {
      attached?.requestUpdate();
    },
  };
}
