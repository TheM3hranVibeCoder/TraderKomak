/**
 * Pine Script v5 runtime (subset) — a bar-by-bar interpreter.
 *
 * Model (mirrors Pine's execution semantics for indicator scripts):
 *   • every value behaves as a SERIES — a variable/call keeps a committed
 *     history array plus this bar's "current" slot; a plain read carries the
 *     previous bar's value forward when the variable wasn't assigned yet;
 *   • `x[k]` reads variable/call history; call results are recorded EVERY
 *     bar in source order (pre-pass), so `ta.sma(close,14)[3]` and stateful
 *     builtins (ta.ema/ta.rsi/…) work even inside ternary branches;
 *   • OUTPUT calls (plot/hline) run in statement order so their arguments
 *     see this-bar values;
 *   • INCREMENTAL: run() re-runs only what changed — a fresh last bar runs
 *     one bar; a changed last bar (live tick) rolls back to a length
 *     snapshot and re-executes it; anything else resets. Per-tick cost is
 *     one bar, not the whole history;
 *   • no eval, no globals — the interpreter walks our own AST inside an ops
 *     budget, so user code cannot touch the page.
 */
import { PineError, PineRuntimeError } from "./errors";
import type { Expr, FuncParam, Program, Stmt } from "./parser";
import type { Candle } from "@traderkomak/shared";

// ── values ──────────────────────────────────────────────────────────────────

/** A Pine object: UDT instances, drawing objects (box/label/line/linefill/
 *  table) and arrays. REFERENCES — mutations persist across bars. */
export interface PineObject {
  __kind: "udt" | "box" | "label" | "line" | "linefill" | "table" | "array";
  /** UDT type name (kind === "udt"). */
  type?: string;
  fields?: Record<string, V>;
  /** Array items (kind === "array"). */
  items?: V[];
  /** Drawing-object id (kind !== "udt"/"array"). */
  id?: number;
  props?: Record<string, V>;
  deleted?: boolean;
}

/** na for numbers is NaN (arithmetic propagates it naturally); other types
 *  use null. Tuples (multi-return builtins) are transient JS arrays. */
export type V = number | boolean | string | PineColor | PineObject | null;
export interface PineColor {
  css: string;
}

const NA: null = null;

function isNa(v: V): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "number") return Number.isNaN(v);
  return false;
}

function num(v: V): number {
  return typeof v === "number" ? v : NaN;
}

function truthy(v: V): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return !Number.isNaN(v) && v !== 0;
  if (v === null || v === undefined) return false;
  return true;
}

function isObjectV(v: V): v is PineObject {
  return !!v && typeof v === "object" && "__kind" in v;
}

function isArrV(v: V): v is PineObject & { items: V[] } {
  return isObjectV(v) && v.__kind === "array" && Array.isArray(v.items);
}

// ── Pine color constants (TradingView v5 palette) ───────────────────────────

const TV_COLORS: Record<string, string> = {
  "color.aqua": "#00BCD4",
  "color.black": "#363A45",
  "color.blue": "#2196F3",
  "color.fuchsia": "#E040FB",
  "color.gray": "#787B86",
  "color.green": "#4CAF50",
  "color.lime": "#00E676",
  "color.maroon": "#880E4F",
  "color.navy": "#311B92",
  "color.olive": "#808A00",
  "color.orange": "#FF9800",
  "color.purple": "#9C27B0",
  "color.red": "#F23645",
  "color.silver": "#B2B5BE",
  "color.teal": "#00897B",
  "color.white": "#FFFFFF",
  "color.yellow": "#FFEB3B",
};

const STYLE_CONSTS: Record<string, string> = {
  "plot.style_line": "line",
  "plot.style_linebr": "line",
  "plot.style_histogram": "histogram",
  "plot.style_area": "area",
  "plot.style_stepline": "stepline",
  "plot.style_columns": "histogram",
  "plot.style_circles": "line",
  "hline.style_solid": "solid",
  "hline.style_dashed": "dashed",
  "hline.style_dotted": "dotted",
  "line.style_solid": "solid",
  "line.style_dashed": "dashed",
  "line.style_dotted": "dotted",
  "line.style_arrow_left": "solid",
  "line.style_arrow_right": "solid",
  "line.style_arrow_both": "solid",
  "label.style_label_up": "label_up",
  "label.style_label_down": "label_down",
  "label.style_label_left": "label_left",
  "label.style_label_right": "label_right",
  "label.style_label_upper_left": "label_left",
  "label.style_label_upper_right": "label_right",
  "label.style_label_lower_left": "label_left",
  "label.style_label_lower_right": "label_right",
  "label.style_none": "label_left",
  "label.style_circle": "label_left",
  "size.normal": "normal",
  "size.small": "small",
  "size.tiny": "tiny",
  "text.align_left": "left",
  "text.align_center": "center",
  "text.align_right": "right",
  "format.mintick": "mintick",
  "format.volume": "volume",
  "format.price": "price",
  "display.none": "none",
  "display.all": "all",
};

/** Pine timeframe string → seconds (D/W/M/month-number forms). */
function tfSecondsOf(tf: string): number {
  const t = tf.trim().toUpperCase();
  if (t === "D" || t === "1D") return 86400;
  if (t === "W" || t === "1W") return 604800;
  if (t === "M" || t === "1M") return 2592000;
  const m = t.match(/^(\d+)$/);
  if (m) return Number(m[1]) * 60;
  return 60;
}

function paletteColor(name: string): PineColor | undefined {
  const hex = TV_COLORS[name];
  return hex ? hexToColor(hex) : undefined;
}

function styleConst(name: string): string | undefined {
  return STYLE_CONSTS[name];
}

const hexColorCache = new Map<string, PineColor>();
function hexToColor(hex: string, transp = 0): PineColor {
  const key = hex + "@" + transp;
  const cached = hexColorCache.get(key);
  if (cached) return cached;
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length === 6) h += "FF";
  const r = Number.parseInt(h.slice(0, 2), 16);
  const g = Number.parseInt(h.slice(2, 4), 16);
  const b = Number.parseInt(h.slice(4, 6), 16);
  const a = Number.parseInt(h.slice(6, 8), 16) / 255;
  const alpha = Math.max(0, Math.min(1, a * (1 - transp / 100)));
  const out: PineColor = { css: `rgba(${r},${g},${b},${alpha.toFixed(3)})` };
  hexColorCache.set(key, out);
  return out;
}

function toCss(v: V): string | null {
  if (v && typeof v === "object" && "css" in v) return (v as PineColor).css;
  if (typeof v === "string" && /^#[0-9A-Fa-f]{6,8}$/.test(v)) return v;
  return null;
}

function recolorWithTransp(css: string, transp: number): PineColor {
  const m = css.match(/rgba?\(([^)]+)\)/);
  if (!m) return { css };
  const parts = m[1]!.split(",").map((s) => Number.parseFloat(s.trim()));
  const r = parts[0] ?? 0;
  const g = parts[1] ?? 0;
  const b = parts[2] ?? 0;
  const a = Math.max(0, Math.min(1, (parts[3] ?? 1) * (1 - transp / 100)));
  return { css: `rgba(${r},${g},${b},${a.toFixed(3)})` };
}

// ── output shapes ───────────────────────────────────────────────────────────

export interface PinePlot {
  id: number;
  title: string;
  style: "line" | "histogram" | "area" | "stepline";
  color: string;
  /** Per-bar colors (histogram plots only). */
  colors?: (string | null)[];
  lineWidth: number;
  /** `value` undefined = whitespace point (breaks the drawn line). */
  data: Array<{ time: number; value?: number; color?: string }>;
}

export interface PineHline {
  price: number;
  title: string;
  color: string;
  style: "solid" | "dashed" | "dotted";
}

export interface PineInputDecl {
  nodeId: number;
  title: string;
  type: "int" | "float" | "bool" | "color" | "source" | "string";
  def: number | boolean | string;
  options?: string[];
}

export interface PineResult {
  title: string;
  overlay: boolean;
  precision: number | null;
  plots: PinePlot[];
  hlines: PineHline[];
  inputs: PineInputDecl[];
  barsRun: number;
}

interface SeriesState {
  hist: V[];
  cur: V | undefined;
}

interface CallSiteNs {
  id: number;
  vars: Map<string, SeriesState>;
  /** Per-call-site buffers for call nodes inside the function body. */
  bufs: Map<number, SeriesState>;
}

interface PlotChannel {
  nodeId: number;
  title: string;
  style: "line" | "histogram" | "area" | "stepline";
  color: string;
  lineWidth: number;
  display: boolean;
  data: Array<{ time: number; value?: number; color?: string }>;
}

interface Snapshot {
  states: Map<SeriesState, number>;
  plotLens: Array<{ ch: PlotChannel; len: number }>;
}

const MAX_OPS = 40_000_000;
const MAX_LOOP_ITER = 20_000;
const MAX_HISTORY = 30_000;

// ── the VM ──────────────────────────────────────────────────────────────────

export class PineVM {
  private program: Program;
  private callNodes: Extract<Expr, { kind: "call" }>[] = [];
  private inputDecls: PineInputDecl[] = [];
  private inputByNode = new Map<number, PineInputDecl>();

  private vars = new Map<string, SeriesState>();
  private nodeBufs = new Map<number, SeriesState>();
  private callNs = new Map<number, CallSiteNs>();
  private builtinState = new Map<string, V[]>();
  private userFns = new Map<string, { params: FuncParam[]; body: Stmt[] }>();
  /** UDT registry: typeDecl declares fields, methodDecl binds methods. */
  private types = new Map<string, { fields: string[]; methods: Map<string, { params: string[]; body: Stmt[] }> }>();
  /** Drawing objects (box/label/line/linefill) — references mutated by the
   *  script, rendered by the chart overlay. */
  private drawings = new Map<number, PineObject>();
  private nextDrawId = 0;
  /** Chart info for syminfo.* / timeframe.* builtins. */
  private chartInfo = { timeframe: "5", mintick: 0.01, precisionDigits: 2, ticker: "" };
  private plots: PlotChannel[] = [];
  private hlines: PineHline[] = [];

  private committed = 0;
  private lastTime = 0;
  private candles: Candle[] = [];
  private inputValues: Record<string, number | boolean | string> = {};
  private ops = 0;
  private curBar = 0;
  private barCount = 0;

  constructor(program: Program) {
    this.program = program;
    if (!program.header) {
      throw new PineError("Script must start with indicator(…)", 1);
    }
    const plots: Extract<Expr, { kind: "call" }>[] = [];
    const hlines: Extract<Expr, { kind: "call" }>[] = [];
    collectNodes(program.body, this.callNodes, plots, hlines, this.inputDecls);
    for (const d of this.inputDecls) this.inputByNode.set(d.nodeId, d);
    this.plots = plots.map((node) => {
      const titleArg = node.args.find((a) => a.name === "title");
      const colorArg = node.args.find((a) => a.name === "color");
      const styleArg = node.args.find((a) => a.name === "style");
      const lwArg = node.args.find((a) => a.name === "linewidth");
      // Positional form: plot(series, title, color, linewidth, style, …)
      const pos = node.args.filter((a) => a.name === null);
      const posTitle = pos[1]?.expr;
      const posColor = pos[2]?.expr;
      const posLw = pos[3]?.expr;
      const posStyle = pos[4]?.expr;
      const styleExpr = styleArg?.expr ?? (posStyle?.kind === "ident" ? posStyle : undefined);
      const colorExpr = colorArg?.expr ?? posColor;
      return {
        nodeId: node.id,
        title: (titleArg?.expr.kind === "str" ? titleArg.expr.value : undefined) ?? (posTitle?.kind === "str" ? posTitle.value : undefined) ?? "Plot",
        style: (styleExpr && styleExpr.kind === "ident" ? styleConst(styleExpr.name) : undefined) as PlotChannel["style"] | undefined ?? "line",
        color: colorExpr
          ? colorExpr.kind === "colorLit"
            ? hexToColor(colorExpr.value).css
            : colorExpr.kind === "ident" && paletteColor(colorExpr.name)
              ? paletteColor(colorExpr.name)!.css
              : "#2196F3" // dynamic color — runPlot evaluates it per bar
          : "#2196F3",
        lineWidth: lwArg && lwArg.expr.kind === "num" ? Math.max(1, Math.min(6, lwArg.expr.value)) : posLw && posLw.kind === "num" ? Math.max(1, Math.min(6, posLw.value)) : 2,
        display: true,
        data: [],
      };
    });
    this.hlines = hlines.map((node) => {
      const priceArg = node.args.filter((a) => a.name === null)[0];
      const titleArg = node.args.find((a) => a.name === "title");
      const colorArg = node.args.find((a) => a.name === "color");
      const lsArg = node.args.find((a) => a.name === "linestyle");
      return {
        price: priceArg && priceArg.expr.kind === "num" ? priceArg.expr.value : NaN,
        title: titleArg && titleArg.expr.kind === "str" ? titleArg.expr.value : "",
        color: colorArg
          ? colorArg.expr.kind === "colorLit"
            ? hexToColor(colorArg.expr.value).css
            : colorArg.expr.kind === "ident" && paletteColor(colorArg.expr.name)
              ? paletteColor(colorArg.expr.name)!.css
              : "#787B86"
          : "#787B86",
        style: (lsArg && lsArg.expr.kind === "ident" ? styleConst(lsArg.expr.name) : undefined) as PineHline["style"] | undefined ?? "dashed",
      };
    });
  }

  get header(): NonNullable<Program["header"]> {
    return this.program.header!;
  }

  setInputValues(values: Record<string, number | boolean | string>): void {
    this.inputValues = { ...values };
  }

  /** Chart context for syminfo.* / timeframe.* builtins. */
  setChartInfo(info: { timeframe: string; mintick: number; precisionDigits: number; ticker: string }): void {
    this.chartInfo = info;
  }

  get chartInfoTimeframe(): string { return this.chartInfo.timeframe; }
  get chartInfoPrecision(): number { return this.chartInfo.precisionDigits; }
  get globalVars(): Map<string, SeriesState> { return this.vars; }

  /** Live drawing objects for the overlay renderer. */
  drawingObjects(): PineObject[] {
    return [...this.drawings.values()].filter((o) => !o.deleted);
  }

  reset(): void {
    this.vars.clear();
    this.nodeBufs.clear();
    this.callNs.clear();
    this.builtinState.clear();
    this.drawings.clear();
    for (const p of this.plots) p.data = [];
    this.committed = 0;
    this.lastTime = 0;
  }

  /**
   * Brings output up to date with `candles`. Returns true when anything was
   * (re)computed — the caller then re-commits plots from result().
   */
  run(candles: Candle[]): boolean {
    this.candles = candles;
    this.barCount = candles.length;
    if (this.barCount === 0) {
      if (this.committed !== 0) {
        this.reset();
        return true;
      }
      return false;
    }
    const lastTime = candles[this.barCount - 1]!.time;

    if (this.committed === this.barCount && lastTime === this.lastTime) {
      return false; // nothing changed
    }
    if (this.committed === this.barCount - 1 && lastTime !== this.lastTime) {
      this.runBar(this.barCount - 1); // one new bar
      this.committed = this.barCount;
      this.lastTime = lastTime;
      return true;
    }
    if (this.committed === this.barCount) {
      // Same last bar updated in place (live tick) — rollback + re-run it.
      const snap = this.snapshot();
      this.rollback(snap);
      this.runBar(this.barCount - 1);
      this.lastTime = lastTime;
      return true;
    }
    // First run / lazy prepend / resync — full recompute.
    this.reset();
    for (let i = 0; i < this.barCount; i++) {
      this.runBar(i);
      this.committed = i + 1;
    }
    this.lastTime = lastTime;
    return true;
  }

  /** Live plot channels WITHOUT copying data arrays — used by the chart
   *  on every push (result() builds a full snapshot with copies). */
  currentPlots(): PinePlot[] {
    return this.plots.filter((p) => p.display).map((p) => ({
      id: p.nodeId,
      title: p.title,
      style: p.style,
      color: p.color,
      colors: p.style === "histogram" && p.data.some((d) => d.color) ? p.data.map((d) => d.color ?? null) : undefined,
      lineWidth: p.lineWidth,
      data: p.data,
    }));
  }

  inputsList(): PineInputDecl[] {
    return this.inputDecls;
  }

  result(): PineResult {
    return {
      title: this.program.header!.title,
      overlay: this.program.header!.overlay,
      precision: this.program.header!.precision,
      plots: this.plots
        .filter((p) => p.display)
        .map((p) => ({
          id: p.nodeId,
          title: p.title,
          style: p.style,
          color: p.color,
          colors: p.style === "histogram" && p.data.some((d) => d.color) ? p.data.map((d) => d.color ?? null) : undefined,
          lineWidth: p.lineWidth,
          data: p.data,
        })),
      hlines: this.hlines.filter((h) => Number.isFinite(h.price)),
      inputs: this.inputDecls,
      barsRun: this.committed,
    };
  }

  // ── bar loop ─────────────────────────────────────────────────────────────

  private runBar(i: number): void {
    this.curBar = i;
    this.ops = 0;
    // Statements in order — call histories stay continuous for anything
    // evaluated every bar (the Pine norm); calls skipped by a ternary/if
    // branch record NA for that bar, exactly like Pine's inconsistent-call
    // warning case.
    this.execBlock(this.program.body, null, null);
    this.commitAll();
  }

  private commitAll(): void {
    for (const st of this.vars.values()) {
      const carry = st.cur !== undefined ? st.cur : st.hist.length > 0 ? st.hist[st.hist.length - 1]! : NA;
      st.hist.push(carry);
      if (st.hist.length > MAX_HISTORY) st.hist.splice(0, st.hist.length - MAX_HISTORY);
      st.cur = undefined;
    }
    // Call buffers are BAR-ALIGNED: a call skipped by a branch records NA
    // for that bar (its internal state also skipped it).
    for (const st of this.nodeBufs.values()) {
      st.hist.push(st.cur !== undefined ? st.cur : NA);
      if (st.hist.length > MAX_HISTORY) st.hist.splice(0, st.hist.length - MAX_HISTORY);
      st.cur = undefined;
    }
    for (const ns of this.callNs.values()) {
      // Function-local vars commit per bar too — this is what makes
      // `var length = 0` inside a user function persist across bars AND
      // survive live-tick rollbacks (hist carries the value, cur is reset).
      for (const st of ns.vars.values()) {
        const carry = st.cur !== undefined ? st.cur : st.hist.length > 0 ? st.hist[st.hist.length - 1]! : NA;
        st.hist.push(carry);
        if (st.hist.length > MAX_HISTORY) st.hist.splice(0, st.hist.length - MAX_HISTORY);
        st.cur = undefined;
      }
      for (const st of ns.bufs.values()) {
        st.hist.push(st.cur !== undefined ? st.cur : NA);
        if (st.hist.length > MAX_HISTORY) st.hist.splice(0, st.hist.length - MAX_HISTORY);
        st.cur = undefined;
      }
    }
  }

  private allVarStates(): SeriesState[] {
    const out: SeriesState[] = [];
    for (const st of this.vars.values()) out.push(st);
    for (const st of this.nodeBufs.values()) out.push(st);
    for (const ns of this.callNs.values()) { for (const st of ns.vars.values()) out.push(st); for (const st of ns.bufs.values()) out.push(st); }
    return out;
  }

  private snapshot(): Snapshot {
    const states = new Map<SeriesState, number>();
    for (const st of this.allVarStates()) states.set(st, st.hist.length);
    const plotLens = this.plots.map((ch) => ({ ch, len: ch.data.length }));
    return { states, plotLens };
  }

  private rollback(snap: Snapshot): void {
    for (const [st, len] of snap.states) {
      st.hist.length = Math.min(len, st.hist.length);
      st.cur = undefined;
    }
    const keep = new Set(snap.plotLens.map((p) => p.ch));
    for (const { ch, len } of snap.plotLens) ch.data.length = Math.min(len, ch.data.length);
    // Channels created during the rolled-back bar are discarded.
    this.plots = this.plots.filter((ch) => keep.has(ch));
  }

  // ── state access ─────────────────────────────────────────────────────────

  varState(scope: Map<string, SeriesState> | null, name: string): SeriesState {
    const map = scope ?? this.vars;
    let st = map.get(name);
    if (!st) {
      st = { hist: [], cur: undefined };
      map.set(name, st);
    }
    return st;
  }

  /** Global buffer (top-level calls) or the enclosing user-function call
   *  site's buffer — ta.* state and [k] histories never leak between sites. */
  bufFor(nsId: number | null, id: number): SeriesState {
    if (nsId === null) return this.nodeBuf(id);
    const ns = this.callNs.get(nsId);
    if (!ns) return this.nodeBuf(id);
    let st = ns.bufs.get(id);
    if (!st) {
      st = { hist: [], cur: undefined };
      ns.bufs.set(id, st);
    }
    return st;
  }

  nodeBuf(id: number): SeriesState {
    let st = this.nodeBufs.get(id);
    if (!st) {
      st = { hist: [], cur: undefined };
      this.nodeBufs.set(id, st);
    }
    return st;
  }

  get currentBar(): number {
    return this.curBar;
  }

  candleAt(idx: number, name: string): V {
    const c = this.candles[Math.max(0, Math.min(idx, this.candles.length - 1))];
    if (!c) return NA;
    switch (name) {
      case "open":
        return c.open;
      case "high":
        return c.high;
      case "low":
        return c.low;
      case "close":
        return c.close;
      case "volume":
        return NA; // candle volume lives in the provider sidecar, not Candle
      case "hl2":
        return (c.high + c.low) / 2;
      case "hlc3":
        return (c.high + c.low + c.close) / 3;
      case "ohlc4":
        return (c.open + c.high + c.low + c.close) / 4;
      case "time":
        return c.time * 1000;
      default:
        return NA;
    }
  }

  builtinSeriesSafe(name: string): V | undefined {
    return this.builtinSeries(name);
  }

  evalPublic(e: Expr, scope: Map<string, SeriesState> | null): V {
    return this.eval(e, scope);
  }

  // ── expression evaluation ────────────────────────────────────────────────

  private eval(expr: Expr, scope: Map<string, SeriesState> | null, nsId: number | null = null): V {
    if (++this.ops > MAX_OPS) {
      throw new PineRuntimeError("Script too heavy — simplify the loops or series", expr.line);
    }
    switch (expr.kind) {
      case "num":
        return expr.value;
      case "str":
        return expr.value;
      case "colorLit":
        return hexToColor(expr.value);
      case "bool":
        return expr.value;
      case "na":
        return NA;
      case "ident": {
        if (expr.name === "__receiver__") return NA; // placeholder — the dispatch passes the actual receiver
        const bi = this.builtinSeries(expr.name);
        if (bi !== undefined) return bi;
        const pal = paletteColor(expr.name);
        if (pal) return pal;
        const stl = styleConst(expr.name);
        if (stl !== undefined) return stl;
        if (expr.name.includes(".")) {
          const v = this.resolvePath(expr.name.split("."), scope, nsId, expr.line);
          return v;
        }
        return this.readVar(scope, expr.name);
      }
      case "bin": {
        if (expr.op === "and") {
          if (!truthy(this.eval(expr.left, scope, nsId))) return false;
          return truthy(this.eval(expr.right, scope, nsId));
        }
        if (expr.op === "or") {
          if (truthy(this.eval(expr.left, scope, nsId))) return true;
          return truthy(this.eval(expr.right, scope, nsId));
        }
        const l = this.eval(expr.left, scope, nsId);
        const r = this.eval(expr.right, scope, nsId);
        return binOp(expr.op, l, r, expr.line);
      }
      case "un": {
        const v = this.eval(expr.operand, scope, nsId);
        if (expr.op === "not") return !truthy(v);
        if (isNa(v)) return NA;
        return expr.op === "-" ? -num(v) : num(v);
      }
      case "ternary": {
        return truthy(this.eval(expr.cond, scope, nsId)) ? this.eval(expr.then, scope, nsId) : this.eval(expr.else, scope, nsId);
      }
      case "index": {
        const k = Math.floor(num(this.eval(expr.k, scope, nsId)));
        if (!Number.isFinite(k) || k < 0) return NA;
        const target = expr.target;
        if (target.kind === "ident") {
          if (this.builtinSeries(target.name) !== undefined && !this.vars.has(target.name)) {
            const idx = this.curBar - k;
            return idx >= 0 ? this.candleAt(idx, target.name) : NA;
          }
          const st = this.varState(scope, target.name);
          return this.histAt(st, k);
        }
        if (target.kind === "call" || target.kind === "index") {
          const st = this.bufFor(nsId, target.id);
          return this.histAt(st, k);
        }
        throw new PineRuntimeError("[] works on variables and function results", expr.line);
      }
      case "call":
        return this.evalCall(expr, scope, nsId);
      case "tupleLit":
        return expr.items.map((it) => this.eval(it, scope, nsId)) as unknown as V;
      case "switchExpr": {
        const subj = expr.subject ? this.eval(expr.subject, scope, nsId) : null;
        for (const c of expr.cases) {
          if (!c.match) return this.evalBlockValue(c.body, scope, nsId);
          const mv = this.eval(c.match, scope, nsId);
          if (expr.subject ? eqVal(subj, mv) : truthy(mv)) return this.evalBlockValue(c.body, scope, nsId);
        }
        return NA;
      }
      case "ifExpr": {
        for (const b of expr.branches) {
          if (truthy(this.eval(b.cond, scope, nsId))) {
            return this.evalBlockValue(b.body, scope, nsId);
          }
        }
        return this.evalBlockValue(expr.elseBody, scope, nsId);
      }
      default:
        return NA;
    }
  }

  private histAt(st: SeriesState, k: number): V {
    if (k === 0) return st.cur !== undefined ? st.cur : st.hist.length > 0 ? st.hist[st.hist.length - 1]! : NA;
    const idx = st.hist.length - k;
    return idx >= 0 ? st.hist[idx]! : NA;
  }

  private readVar(scope: Map<string, SeriesState> | null, name: string): V {
    if (scope) {
      const local = scope.get(name);
      if (local) {
        if (local.cur !== undefined) return local.cur;
        if (local.hist.length > 0) return local.hist[local.hist.length - 1]!;
        // Not assigned this bar and no history in local — fall through to global
      }
      const global = this.globalVars.get(name);
      if (global) {
        if (global.cur !== undefined) return global.cur;
        return global.hist.length > 0 ? global.hist[global.hist.length - 1]! : NA;
      }
      return NA;
    }
    const st = this.varState(null, name);
    return st.cur !== undefined ? st.cur : st.hist.length > 0 ? st.hist[st.hist.length - 1]! : NA;
  }

  /** readVar without creating a state — used on dotted-callee roots where a
   *  miss is normal (input.bool → looks up "input" and must not pollute
   *  this.vars with a permanent series). */
  private peekVar(scope: Map<string, SeriesState> | null, name: string): V {
    const st = (scope ?? this.vars).get(name);
    if (st) {
      if (st.cur !== undefined) return st.cur;
      if (st.hist.length > 0) return st.hist[st.hist.length - 1]!;
    }
    if (scope) {
      const global = this.vars.get(name);
      if (global) {
        if (global.cur !== undefined) return global.cur;
        if (global.hist.length > 0) return global.hist[global.hist.length - 1]!;
      }
    }
    return NA;
  }

  private builtinSeries(name: string): V | undefined {
    switch (name) {
      case "open":
      case "high":
      case "low":
      case "close":
      case "volume":
      case "hl2":
      case "hlc3":
      case "ohlc4":
      case "time":
        return this.candleAt(this.curBar, name);
      case "bar_index":
        return this.curBar;
      case "last_bar_index":
        return this.barCount - 1;
      case "syminfo.mintick":
        return this.chartInfo.mintick;
      case "syminfo.ticker":
      case "syminfo.tickerid":
        return this.chartInfo.ticker;
      case "syminfo.description":
        return this.chartInfo.ticker;
      case "syminfo.timezone":
        return "Exchange"; // resolved to UTC by the time() builtin
      case "timeframe.period":
        return this.chartInfo.timeframe;
      case "timeframe.multiplier": {
        const s = tfSecondsOf(this.chartInfo.timeframe);
        return s >= 60 ? s / 60 : s;
      }
      case "timeframe.isdwm":
        return tfSecondsOf(this.chartInfo.timeframe) >= 86400;
      case "timeframe.isintraday":
        return tfSecondsOf(this.chartInfo.timeframe) > 0 && tfSecondsOf(this.chartInfo.timeframe) < 86400;
      case "barstate.islast":
        return this.curBar === this.barCount - 1;
      case "barstate.isfirst":
        return this.curBar === 0;
      case "barstate.isnew":
      case "barstate.isconfirmed":
        return true;
      case "barstate.isrealtime":
        return false;
      case "barstate.ishistory":
        return true;
      case "dayofweek": {
        const t = num(this.candleAt(this.curBar, "time"));
        return t > 0 ? new Date(t).getUTCDay() + 1 : NA;
      }
      case "dayofweek.sunday":
        return 1;
      case "dayofweek.monday":
        return 2;
      case "dayofweek.tuesday":
        return 3;
      case "dayofweek.wednesday":
        return 4;
      case "dayofweek.thursday":
        return 5;
      case "dayofweek.friday":
        return 6;
      case "dayofweek.saturday":
        return 7;
      // display.* are bit flags — `display.all - display.status_line` etc.
      case "display.none":
        return "none";
      case "display.all":
        return 15;
      case "display.pane":
        return 1;
      case "display.price_scale":
        return 2;
      case "display.status_line":
        return 4;
      case "display.data_window":
        return 8;
      case "xloc.bar_index":
        return "bar_index";
      case "xloc.bar_time":
        return "bar_time";
      case "extend.none":
        return "none";
      case "extend.left":
        return "left";
      case "extend.right":
        return "right";
      case "extend.both":
        return "both";
      case "position.top_left":
        return "top_left";
      case "position.top_center":
        return "top_center";
      case "position.top_right":
        return "top_right";
      case "position.middle_left":
        return "middle_left";
      case "position.middle_center":
        return "middle_center";
      case "position.middle_right":
        return "middle_right";
      case "position.bottom_left":
        return "bottom_left";
      case "position.bottom_center":
        return "bottom_center";
      case "position.bottom_right":
        return "bottom_right";
      case "location.absolute":
        return "absolute";
      case "location.abovebar":
        return "abovebar";
      case "location.belowbar":
        return "belowbar";
      case "location.top":
        return "top";
      case "location.bottom":
        return "bottom";
      case "size.auto":
        return "normal";
      case "size.large":
        return "large";
      case "size.huge":
        return "huge";
      case "na":
        return NA;
      default:
        return undefined;
    }
  }

  // ── calls ────────────────────────────────────────────────────────────────

  private evalCall(node: Extract<Expr, { kind: "call" }>, scope?: Map<string, SeriesState> | null, nsId: number | null = null): V {
    if (++this.ops > MAX_OPS) {
      throw new PineRuntimeError("Script too heavy", node.line);
    }
    const buf = this.bufFor(nsId, node.id);

    if (node.callee === "plot") return this.runPlot(node, scope ?? null, nsId);
    if (node.callee === "hline" || node.callee === "alertcondition") return NA;

    // Dotted callees: obj.method(…) — UDT constructors, UDT methods,
    // array methods, and drawing-object methods.
    if (node.callee.includes(".")) {
      let segs = this.calleeSegs.get(node.callee);
      if (!segs) {
        segs = node.callee.split(".");
        this.calleeSegs.set(node.callee, segs);
      }
      const last = segs[segs.length - 1]!;

      // UDT constructor: TypeName.new(…)
      if (segs.length === 2 && segs[1] === "new" && this.types.has(segs[0]!)) {
        const obj = this.constructUdt(segs[0]!, node, scope ?? null, nsId, node.line);
        buf.cur = obj;
        return obj;
      }

      const root = this.peekVar(scope ?? null, segs[0]!);
      if (isObjectV(root)) {
        // Array methods: infos.push(…) → array.push(arr, …)
        if (root.__kind === "array") {
          const fullCallee = "array." + last;
          const arrFn = BUILTINS[fullCallee];
          if (!arrFn) throw new PineRuntimeError(`Unknown method "${last}()" for array`, node.line);
          const items = root.items ?? [];
          const sc = scope ?? null;
          const nid = nsId ?? null;
          const result = arrFn({
            vm: this,
            node,
            scope: sc,
            nsId: nid,
            pos: (i: number) => {
              if (i === 0) return { kind: "ident", name: "__receiver__", id: -1, line: node.line };
              return node.args.filter((a) => a.name === null)[i - 1]?.expr ?? null;
            },
            named: (name: string) => node.args.find((a) => a.name === name)?.expr ?? null,
            numArg: (i: number, fallback: number) => {
              if (i === 0) return items.length;
              const e = node.args.filter((a) => a.name === null)[i - 1]?.expr;
              if (!e) return fallback;
              return num(this.eval(e, sc, nid));
            },
            arg: (i: number) => {
              if (i === 0) return root;
              const e = node.args.filter((a) => a.name === null)[i - 1]?.expr;
              return e ? this.eval(e, sc, nid) : NA;
            },
            arr: () => root as PineObject & { items: V[] },
            hist: (e: Expr) => seriesHistOf(this, e, sc),
            state: (key: string) => this.stateArray(node.id + ":" + key),
          });
          const out: V = result === undefined ? NA : result;
          buf.cur = out;
          return out;
        }
        // walk middle segments as fields
        let target: PineObject = root;
        for (let i = 1; i < segs.length - 1; i++) {
          const f = (target.fields?.[segs[i]!] ?? target.props?.[segs[i]!] ?? NA) as V;
          if (!isObjectV(f)) {
            throw new PineRuntimeError(`"${segs.slice(0, i + 1).join(".")}" is not an object`, node.line);
          }
          target = f;
        }
        const mv = this.dispatchObjectMethod(target, last, node, scope ?? null, nsId);
        buf.cur = mv;
        return mv;
      }
    }

    const userFn = this.userFns.get(node.callee);
    if (userFn) {
      const v = this.callUserFn(node, userFn, nsId);
      buf.cur = v;
      return v;
    }

    const builtin = BUILTINS[node.callee];
    if (!builtin) {
      throw new PineRuntimeError(`Unknown function "${node.callee}()"`, node.line);
    }
    const result = builtin(this.makeCtx(node, scope ?? null, nsId));
    buf.cur = result;
    return result;
  }

  /** UDT method + drawing-object method dispatch. */
  private dispatchObjectMethod(target: PineObject, method: string, node: Extract<Expr, { kind: "call" }>, scope: Map<string, SeriesState> | null, nsId: number | null): V {
    if (++this.ops > MAX_OPS) {
      throw new PineRuntimeError("Script too heavy", node.line);
    }
    const buf = this.bufFor(nsId, node.id);

    if (target.__kind === "udt") {
      if (process.env.TK_DEBUG) console.log(`[dispatch] udt method: ${target.type}.${method}()`);
      const typeReg = this.types.get(target.type ?? "");
      const m = typeReg?.methods.get(method);
      if (!m) throw new PineRuntimeError(`Unknown method "${method}()" for type "${target.type}"`, node.line);
      let ns = this.callNs.get(node.id);
      if (!ns) {
        ns = { id: node.id, vars: new Map(), bufs: new Map() };
        this.callNs.set(node.id, ns);
      }
      // bind `this` + declared params (first declared param is `this`)
      this.varState(ns.vars, "this").cur = target;
      const positional = node.args.filter((a) => a.name === null);
      m.params.slice(1).forEach((p, i) => {
        const src = positional[i]?.expr;
        const v = src ? this.eval(src, ns!.vars, nsId) : NA;
        this.varState(ns!.vars, p).cur = v;
      });
      try {
        const v = this.evalBlockValue(m.body, ns.vars, nsId);
        buf.cur = v;
        return v;
      } catch (err) {
        if (err instanceof LoopSignal) throw new PineRuntimeError("break/continue outside a loop", node.line);
        throw err;
      }
    }

    // Array methods: sessionInfos.push(…) → array.push(arr, …)
    if (target.__kind === "array") {
      if (process.env.TK_DEBUG) console.log(`[dispatch] array method: array.${method}()`);
      const fullCallee = "array." + method;
      const fn = BUILTINS[fullCallee];
      if (!fn) throw new PineRuntimeError(`Unknown method "${method}()" for array`, node.line);
      const items = target.items ?? [];
      // Build a ctx where pos(0) resolves to the array itself
      const result = fn({
        vm: this,
        node,
        scope,
        nsId,
        pos: (i: number) => {
          if (i === 0) return { kind: "ident", name: "__receiver__", id: -1, line: node.line };
          return node.args.filter((a) => a.name === null)[i - 1]?.expr ?? null;
        },
        named: (name: string) => node.args.find((a) => a.name === name)?.expr ?? null,
        numArg: (i: number, fallback: number) => {
          if (i === 0) return items.length;
          const e = node.args.filter((a) => a.name === null)[i - 1]?.expr;
          if (!e) return fallback;
          return num(this.eval(e, scope, nsId));
        },
        arg: (i: number) => {
          if (i === 0) return target;
          const e = node.args.filter((a) => a.name === null)[i - 1]?.expr;
          return e ? this.eval(e, scope, nsId) : NA;
        },
        arr: () => target as PineObject & { items: V[] },
        hist: (e: Expr) => seriesHistOf(this, e, scope),
        state: (key: string) => this.stateArray(node.id + ":" + key),
      });
      const out: V = result === undefined ? NA : result;
      buf.cur = out;
      return out;
    }

    // drawing-object methods
    const dm = DRAWING_METHODS[target.__kind]?.[method];
    if (!dm) throw new PineRuntimeError(`Unknown method "${method}()" for ${target.__kind}`, node.line);
    const result = dm({
      vm: this,
      node,
      scope,
      nsId,
      obj: target,
      pos: (i: number) => node.args.filter((a) => a.name === null)[i]?.expr ?? null,
      named: (name: string) => node.args.find((a) => a.name === name)?.expr ?? null,
      numArg: (i: number, fallback: number) => {
        const e = node.args.filter((a) => a.name === null)[i]?.expr;
        if (!e) return fallback;
        return num(this.eval(e, scope, nsId));
      },
      hist: (e: Expr) => seriesHistOf(this, e, scope),
      state: (key: string) => this.stateArray(node.id + ":" + key),
      arg: (i: number) => {
        const e = node.args.filter((a) => a.name === null)[i]?.expr;
        return e ? this.eval(e, scope, nsId) : NA;
      },
      arr: (i: number) => {
        const e = node.args.filter((a) => a.name === null)[i]?.expr;
        const v = e ? this.eval(e, scope, nsId) : NA;
        if (!isArrV(v)) throw new PineRuntimeError("Expected an array argument", node.line);
        return v;
      },
    });
    const out: V = result === undefined ? NA : result;
    buf.cur = out;
    return out;
  }

  /** Field-chain resolution for dotted identifiers on objects. */

  /** Field-chain resolution for dotted identifiers on objects. */
  private resolvePath(segs: string[], scope: Map<string, SeriesState> | null, nsId: number | null, line: number): V {
    let v = this.readVar(scope, segs[0]!);
    for (let i = 1; i < segs.length; i++) {
      if (!isObjectV(v)) {
        throw new PineRuntimeError(`"${segs.slice(0, i).join(".")}" is not an object`, line);
      }
      v = (v.fields?.[segs[i]!] ?? v.props?.[segs[i]!] ?? NA) as V;
    }
    return v;
  }

  /** Assign through a dotted path: this.field := value. */
  private assignPath(segs: string[], value: V, scope: Map<string, SeriesState> | null, line: number): void {
    let target = this.readVar(scope, segs[0]!);
    if (!isObjectV(target)) throw new PineRuntimeError(`"${segs[0]}" is not an object`, line);
    for (let i = 1; i < segs.length - 1; i++) {
      const next = (target.fields?.[segs[i]!] ?? NA) as V;
      if (!isObjectV(next)) throw new PineRuntimeError(`"${segs.slice(0, i + 1).join(".")}" is not an object`, line);
      target = next;
    }
    target.fields![segs[segs.length - 1]!] = value;
  }

  /** Creates a drawing object and registers it for the overlay renderer. */
  newDrawing(kind: "box" | "label" | "line" | "linefill" | "table", props: Record<string, V>): PineObject {
    const id = ++this.nextDrawId;
    const obj: PineObject = { __kind: kind, id, props, deleted: false };
    this.drawings.set(id, obj);
    return obj;
  }

  /** UDT constructor: TypeName.new(positional/named fields). */
  private constructUdt(typeName: string, node: Extract<Expr, { kind: "call" }>, scope: Map<string, SeriesState> | null, nsId: number | null, line: number): PineObject {
    const reg = this.types.get(typeName);
    if (!reg) throw new PineRuntimeError(`Unknown type "${typeName}"`, line);
    const fields: Record<string, V> = {};
    reg.fields.forEach((fname, i) => {
      const positional = node.args.filter((a) => a.name === null)[i];
      const named = node.args.find((a) => a.name === fname);
      const src = named?.expr ?? positional?.expr;
      fields[fname] = src ? this.eval(src, scope, nsId) : NA;
    });
    return { __kind: "udt", type: typeName, fields, deleted: false };
  }

  /** Builtin ctx cache — a call node always executes with the same scope
   *  identity (global or its own function's ns), so one ctx per node. */
  private ctxCache = new Map<number, BuiltinCtx>();
  private calleeSegs = new Map<string, string[]>();

  private makeCtx(node: Extract<Expr, { kind: "call" }>, scope: Map<string, SeriesState> | null, nsId: number | null): BuiltinCtx {
    // Cache ONLY top-level calls: the same node inside a user function runs
    // under a different scope per call site, so caching by node id would leak
    // one site's locals into another.
    if (nsId !== null) return this.buildCtx(node, scope, nsId);
    const cached = this.ctxCache.get(node.id);
    if (cached) return cached;
    const ctx = this.buildCtx(node, scope, nsId);
    this.ctxCache.set(node.id, ctx);
    return ctx;
  }

  private buildCtx(node: Extract<Expr, { kind: "call" }>, scope: Map<string, SeriesState> | null, nsId: number | null): BuiltinCtx {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- the ctx object hands builtins the VM itself
    const vm = this;
    // positional args indexed once — hot path for high-frequency builtins
    const positional = node.args.filter((a) => a.name === null);
    const at = (i: number): Expr | null => positional[i]?.expr ?? null;
    return {
      vm,
      node,
      scope,
      nsId,
      pos: at,
      named: (name) => node.args.find((a) => a.name === name)?.expr ?? null,
      numArg: (i, fallback) => {
        const e = at(i);
        if (!e) return fallback;
        return num(vm.evalPublic(e, scope));
      },
      arg: (i) => {
        const e = at(i);
        return e ? vm.evalPublic(e, scope) : NA;
      },
      arr: (i) => {
        const e = at(i);
        const v = e ? vm.eval(e, scope, nsId) : NA;
        if (!isArrV(v)) throw new PineRuntimeError("Expected an array argument", node.line);
        return v;
      },
      hist: (e) => seriesHistOf(vm, e, scope),
      state: (key) => vm.stateArray((nsId ?? 0) + ":" + node.id + ":" + key),
    };
  }

  private stateArray(key: string): V[] {
    let arr = this.builtinState.get(key);
    if (!arr) {
      arr = [];
      this.builtinState.set(key, arr);
    }
    return arr;
  }

  // ── user functions ───────────────────────────────────────────────────────

  private callUserFn(node: Extract<Expr, { kind: "call" }>, fn: { params: FuncParam[]; body: Stmt[] }, outerNsId: number | null): V {
    let ns = this.callNs.get(node.id);
    if (!ns) {
      ns = { id: node.id, vars: new Map(), bufs: new Map() };
      this.callNs.set(node.id, ns);
    }
    // Argument expressions live in the CALLER's scope (nested user-fn calls
    // pass their own params along); defaults evaluate in the callee scope.
    const callerScope = outerNsId !== null ? this.callNs.get(outerNsId)?.vars ?? null : null;
    const positional = node.args.filter((a) => a.name === null);
    fn.params.forEach((p, i) => {
      const namedE = node.args.find((a) => a.name === p.name)?.expr ?? null;
      const posE = positional[i]?.expr ?? null;
      const src = posE ?? namedE ?? p.def;
      const v = src ? this.eval(src, posE || namedE ? callerScope : ns.vars, posE || namedE ? outerNsId : node.id) : NA;
      this.varState(ns!.vars, p.name).cur = v;
    });
    try {
      return this.evalBlockValue(fn.body, ns.vars, node.id);
    } catch (err) {
      if (err instanceof LoopSignal) throw new PineRuntimeError("break/continue outside a loop", node.line);
      throw err;
    }
  }

  // ── statements ───────────────────────────────────────────────────────────

  private execBlock(body: Stmt[], scope: Map<string, SeriesState> | null, nsId: number | null = null): void {
    for (const stmt of body) {
      this.execStmt(stmt, scope, nsId);
    }
  }

  private execStmt(stmt: Stmt, scope: Map<string, SeriesState> | null, nsId: number | null = null): void {
    if (++this.ops > MAX_OPS) {
      throw new PineRuntimeError("Script too heavy", (stmt as { line?: number }).line ?? 1);
    }
    switch (stmt.kind) {
      case "varDecl": {
        const st = this.varState(scope, stmt.name);
        if (stmt.isVar) {
          if (st.hist.length === 0 && st.cur === undefined) {
            st.cur = this.eval(stmt.expr, scope, nsId);
          }
        } else {
          st.cur = this.eval(stmt.expr, scope, nsId);
        }
        return;
      }
      case "assign": {
        const value = this.eval(stmt.expr, scope, nsId);
        if (stmt.name.includes(".")) {
          // field assignment through an object path: this.count := …
          this.assignPath(stmt.name.split("."), value, scope, stmt.line);
          return;
        }
        const st = this.varState(scope, stmt.name);
        if (stmt.op === ":=") {
          st.cur = value;
          return;
        }
        const prev = this.readVar(scope, stmt.name);
        st.cur = binOp(stmt.op.slice(0, -1), prev, value, stmt.line);
        return;
      }
      case "tupleDecl": {
        const v = this.eval(stmt.expr, scope, nsId);
        if (!Array.isArray(v)) {
          throw new PineRuntimeError("The right side does not return multiple values — [a, b] works with ta.macd/ta.bb/ta.supertrend/ta.dmi", stmt.line);
        }
        stmt.names.forEach((name, i) => {
          this.varState(scope, name).cur = (v[i] ?? NA) as V;
        });
        return;
      }
      case "ifStmt": {
        for (const b of stmt.branches) {
          if (truthy(this.eval(b.cond, scope, nsId))) {
            this.execBlock(b.body, scope, nsId);
            return;
          }
        }
        this.execBlock(stmt.elseBody, scope, nsId);
        return;
      }
      case "forStmt": {
        const from = num(this.eval(stmt.from, scope, nsId));
        const to = num(this.eval(stmt.to, scope, nsId));
        const by = stmt.by ? num(this.eval(stmt.by, scope, nsId)) : from <= to ? 1 : -1;
        if (!Number.isFinite(from) || !Number.isFinite(to) || !Number.isFinite(by) || by === 0) return;
        let iter = 0;
        if (by > 0) {
          for (let i = from; i <= to; i += by) {
            if (++iter > MAX_LOOP_ITER) throw new PineRuntimeError("Loop exceeded 20,000 iterations", stmt.line);
            this.varState(scope, stmt.varName).cur = i;
            try {
              this.execBlock(stmt.body, scope, nsId);
            } catch (err) {
              if (err instanceof LoopSignal) {
                if (err.kind === "break") return;
                continue;
              }
              throw err;
            }
          }
        } else {
          for (let i = from; i >= to; i += by) {
            if (++iter > MAX_LOOP_ITER) throw new PineRuntimeError("Loop exceeded 20,000 iterations", stmt.line);
            this.varState(scope, stmt.varName).cur = i;
            try {
              this.execBlock(stmt.body, scope, nsId);
            } catch (err) {
              if (err instanceof LoopSignal) {
                if (err.kind === "break") return;
                continue;
              }
              throw err;
            }
          }
        }
        return;
      }
      case "funcDecl":
        this.userFns.set(stmt.name, { params: stmt.params, body: stmt.body });
        return;
      case "methodDecl": {
        const reg = this.types.get(stmt.typeName);
        if (!reg) throw new PineRuntimeError(`method declared for unknown type "${stmt.typeName}"`, stmt.line);
        reg.methods.set(stmt.name, { params: stmt.params, body: stmt.body });
        return;
      }
      case "typeDecl": {
        if (!this.types.has(stmt.name)) {
          this.types.set(stmt.name, { fields: stmt.fields, methods: new Map() });
        }
        return;
      }
      case "forInStmt": {
        const iter = this.eval(stmt.iter, scope, nsId);
        if (!isArrV(iter)) throw new PineRuntimeError("for…in expects an array", stmt.line);
        let n = 0;
        for (const item of [...iter.items]) {
          if (++n > MAX_LOOP_ITER) throw new PineRuntimeError("Loop exceeded 20,000 iterations", stmt.line);
          this.varState(scope, stmt.varName).cur = item;
          try {
            this.execBlock(stmt.body, scope, nsId);
          } catch (err) {
            if (err instanceof LoopSignal) {
              if (err.kind === "break") break;
              continue;
            }
            throw err;
          }
        }
        return;
      }
      case "whileStmt": {
        let n = 0;
        for (;;) {
          if (!truthy(this.eval(stmt.cond, scope, nsId))) break;
          if (++n > MAX_LOOP_ITER) throw new PineRuntimeError("while loop exceeded 20,000 iterations", stmt.line);
          try {
            this.execBlock(stmt.body, scope, nsId);
          } catch (err) {
            if (err instanceof LoopSignal) {
              if (err.kind === "break") break;
              continue;
            }
            throw err;
          }
        }
        return;
      }
      case "exprStmt":
        this.eval(stmt.expr, scope, nsId);
        return;
      case "break":
      case "continue":
        throw new LoopSignal(stmt.kind);
      case "indicator":
        return;
      case "strategyDecl":
        throw new PineRuntimeError("Strategies are not supported", stmt.line);
      default:
        return;
    }
  }

  private evalBlockValue(body: Stmt[], scope: Map<string, SeriesState> | null, nsId: number | null = null): V {
    let last: V = NA;
    for (const stmt of body) {
      if (stmt.kind === "exprStmt") {
        last = this.eval(stmt.expr, scope, nsId);
      } else {
        this.execStmt(stmt, scope, nsId);
      }
    }
    return last;
  }

  // ── outputs ──────────────────────────────────────────────────────────────

  private runPlot(node: Extract<Expr, { kind: "call" }>, scope: Map<string, SeriesState> | null, nsId: number | null): V {
    const ch = this.plots.find((p) => p.nodeId === node.id);
    if (!ch) return NA;
    const value = this.argAt(node, 0, scope);
    const styleArg = this.namedArg(node, "style");
    if (styleArg) {
      const sv = this.eval(styleArg, scope);
      if (typeof sv === "string" && ["line", "histogram", "area", "stepline"].includes(sv)) {
        ch.style = sv as PlotChannel["style"];
      }
    }
    void styleConst;
    // Positional fallbacks: plot(series, title, color, linewidth, style, …)
    const pos = node.args.filter((a) => a.name === null);
    const lwArg = this.namedArg(node, "linewidth") ?? (pos[3]?.expr.kind === "num" ? pos[3]!.expr : null);
    if (lwArg) ch.lineWidth = Math.max(1, Math.min(6, Math.round(num(this.eval(lwArg, scope)))));
    const displayArg = this.namedArg(node, "display");
    if (displayArg) {
      const dv = this.eval(displayArg, scope);
      ch.display = !(typeof dv === "string" && dv === "none");
    }
    const titleArg = this.namedArg(node, "title");
    if (titleArg) {
      const tv = this.eval(titleArg, scope);
      if (typeof tv === "string" && tv) ch.title = tv;
    }
    const colorArg = this.namedArg(node, "color") ?? pos[2]?.expr ?? null;
    const css = colorArg ? toCss(this.eval(colorArg, scope)) : null;
    if (css) ch.color = css;
    const candle = this.candles[this.curBar];
    if (candle) {
      const numeric = !isNa(value) && !Array.isArray(value) && typeof value !== "boolean" && typeof value !== "string";
      if (numeric) {
        ch.data.push({ time: candle.time, value: num(value), color: css ?? undefined });
      } else {
        // na → whitespace point: Lightweight Charts BREAKS the line there,
        // so consecutive zones never connect with a stray segment.
        ch.data.push({ time: candle.time });
      }
    }
    return NA;
  }

  private namedArg(node: Extract<Expr, { kind: "call" }>, name: string): Expr | null {
    return node.args.find((a) => a.name === name)?.expr ?? null;
  }

  private argAt(node: Extract<Expr, { kind: "call" }>, i: number, scope: Map<string, SeriesState> | null): V {
    const a = node.args.filter((a2) => a2.name === null)[i];
    return a ? this.eval(a.expr, scope) : NA;
  }

  // ── accessors for the builtin layer ──────────────────────────────────────

  hasVar(scope: Map<string, SeriesState> | null, name: string): boolean {
    return (scope ?? this.vars).has(name);
  }

  inputDeclFor(nodeId: number): PineInputDecl | undefined {
    return this.inputByNode.get(nodeId);
  }

  get inputValuesPublic(): Record<string, number | boolean | string> {
    return this.inputValues;
  }
}

class LoopSignal extends Error {
  constructor(public readonly kind: "break" | "continue") {
    super(kind);
  }
}

function binOp(op: string, l: V, r: V, line: number): V {
  if (Array.isArray(l) || Array.isArray(r)) {
    throw new PineRuntimeError("Tuples cannot be used in arithmetic", line);
  }
  const ln = num(l);
  const rn = num(r);
  switch (op) {
    case "+":
      if (typeof l === "string" && typeof r === "string") return l + r;
      return ln + rn;
    case "-":
      return ln - rn;
    case "*":
      return ln * rn;
    case "/":
      return rn === 0 ? NaN : ln / rn;
    case "%":
      return rn === 0 ? NaN : ln % rn;
    case "==":
      return eqVal(l, r);
    case "!=":
      return !eqVal(l, r);
    case "<":
      return ln < rn;
    case "<=":
      return ln <= rn;
    case ">":
      return ln > rn;
    case ">=":
      return ln >= rn;
    default:
      throw new PineRuntimeError(`Unknown operator "${op}"`, line);
  }
}

function eqVal(l: V, r: V): boolean {
  if (isNa(l) && isNa(r)) return true;
  if (isNa(l) || isNa(r)) return false;
  if (l && typeof l === "object" && "css" in l) return toCss(l) === toCss(r);
  return l === r;
}

// ── compile-time collection ─────────────────────────────────────────────────

function collectNodes(
  body: Stmt[],
  calls: Extract<Expr, { kind: "call" }>[],
  plots: Extract<Expr, { kind: "call" }>[],
  hlines: Extract<Expr, { kind: "call" }>[],
  inputs: PineInputDecl[]
): void {
  const walkExpr = (e: Expr): void => {
    if (e.kind === "call") {
      if (e.callee === "strategy" || e.callee.startsWith("strategy.")) {
        throw new PineError("Strategies are not supported — write an indicator() script", e.line);
      }
      if (e.callee.startsWith("request.")) {
        throw new PineError("request.* is not supported in this Pine subset", e.line);
      }
      calls.push(e);
      if (e.callee === "plot") plots.push(e);
      if (e.callee === "hline") hlines.push(e);
      if (e.callee === "input" || e.callee.startsWith("input.")) {
        inputs.push({
          nodeId: e.id,
          title: inputTitle(e),
          type: inputType(e),
          def: inputDefault(e),
          options: inputOptions(e),
        });
      }
    }
    for (const child of exprChildren(e)) walkExpr(child);
  };
  const walkStmt = (s: Stmt): void => {
    switch (s.kind) {
      case "varDecl":
      case "assign":
        walkExpr(s.expr);
        return;
      case "tupleDecl":
        walkExpr(s.expr);
        return;
      case "ifStmt":
        for (const b of s.branches) {
          walkExpr(b.cond);
          for (const st of b.body) walkStmt(st);
        }
        for (const st of s.elseBody) walkStmt(st);
        return;
      case "forStmt":
        walkExpr(s.from);
        walkExpr(s.to);
        if (s.by) walkExpr(s.by);
        for (const st of s.body) walkStmt(st);
        return;
      case "forInStmt":
        walkExpr(s.iter);
        for (const st of s.body) walkStmt(st);
        return;
      case "whileStmt":
        walkExpr(s.cond);
        for (const st of s.body) walkStmt(st);
        return;
      case "funcDecl":
        for (const p of s.params) if (p.def) walkExpr(p.def);
        for (const st of s.body) walkStmt(st);
        return;
      case "methodDecl":
        for (const st of s.body) walkStmt(st);
        return;
      case "exprStmt":
        walkExpr(s.expr);
        return;
      default:
        return;
    }
  };
  for (const s of body) walkStmt(s);
}

function inputTitle(e: Extract<Expr, { kind: "call" }>): string {
  const named = e.args.find((a) => a.name === "title");
  if (named && named.expr.kind === "str") return named.expr.value;
  // positional: input.bool(defval, title, …)
  const positional = e.args.filter((a) => a.name === null);
  if (positional.length >= 2 && positional[1]!.expr.kind === "str") return positional[1]!.expr.value;
  return `Input ${e.line}`;
}

function inputType(e: Extract<Expr, { kind: "call" }>): PineInputDecl["type"] {
  switch (e.callee) {
    case "input.int":
      return "int";
    case "input.float":
      return "float";
    case "input.bool":
      return "bool";
    case "input.color":
      return "color";
    case "input.source":
      return "source";
    case "input.string":
    case "input.session":
      return "string";
    default: {
      const first = e.args.find((a) => a.name === null);
      if (first) {
        if (first.expr.kind === "bool") return "bool";
        if (first.expr.kind === "colorLit") return "color";
        if (first.expr.kind === "str") return "string";
        if (first.expr.kind === "ident" && isSourceName(first.expr.name)) return "source";
        if (first.expr.kind === "num") return Number.isInteger(first.expr.value) ? "int" : "float";
      }
      return "float";
    }
  }
}

function isSourceName(name: string): boolean {
  return ["close", "open", "high", "low", "hl2", "hlc3", "ohlc4", "volume"].includes(name);
}

function inputDefault(e: Extract<Expr, { kind: "call" }>): number | boolean | string {
  const named = e.args.find((a) => a.name === "defval");
  const first = e.args.find((a) => a.name === null);
  const src = named?.expr ?? first?.expr;
  if (!src) return 0;
  switch (src.kind) {
    case "num":
      return src.value;
    case "bool":
      return src.value;
    case "str":
      return src.value;
    case "colorLit":
      return src.value;
    case "ident":
      return src.name;
    default:
      return 0;
  }
}

function inputOptions(e: Extract<Expr, { kind: "call" }>): string[] | undefined {
  const named = e.args.find((a) => a.name === "options");
  if (!named) return undefined;
  if (named.expr.kind === "call" && named.expr.callee === "array.from") {
    return named.expr.args.map((a) => (a.expr.kind === "str" ? a.expr.value : String((a.expr as { value?: unknown }).value ?? "")));
  }
  // Tuple literal form: options = ["A", "B", "C"]
  if (named.expr.kind === "tupleLit") {
    return named.expr.items.map((it) => (it.kind === "str" ? it.value : it.kind === "ident" ? it.name : String((it as { value?: unknown }).value ?? "")));
  }
  return undefined;
}

function exprChildren(e: Expr): Expr[] {
  switch (e.kind) {
    case "bin":
      return [e.left, e.right];
    case "un":
      return [e.operand];
    case "ternary":
      return [e.cond, e.then, e.else];
    case "index":
      return [e.target, e.k];
    case "call":
      return e.args.map((a) => a.expr);
    case "tupleLit":
      return [...e.items];
    case "switchExpr":
      return [...(e.subject ? [e.subject] : []), ...e.cases.flatMap((c) => (c.match ? [c.match, ...stmtExprs(c.body)] : stmtExprs(c.body)))];
    case "ifExpr":
      return [...e.branches.flatMap((b) => [b.cond, ...stmtExprs(b.body)]), ...stmtExprs(e.elseBody)];
    default:
      return [];
  }
}

function stmtExprs(body: Stmt[]): Expr[] {
  const out: Expr[] = [];
  const visit = (s: Stmt): void => {
    switch (s.kind) {
      case "varDecl":
      case "assign":
        out.push(s.expr);
        return;
      case "tupleDecl":
        out.push(s.expr);
        return;
      case "ifStmt":
        for (const b of s.branches) {
          out.push(b.cond);
          for (const st of b.body) visit(st);
        }
        for (const st of s.elseBody) visit(st);
        return;
      case "forStmt":
        out.push(s.from, s.to);
        if (s.by) out.push(s.by);
        for (const st of s.body) visit(st);
        return;
      case "forInStmt":
        out.push(s.iter);
        for (const st of s.body) visit(st);
        return;
      case "whileStmt":
        out.push(s.cond);
        for (const st of s.body) visit(st);
        return;
      case "funcDecl":
        for (const p of s.params) if (p.def) out.push(p.def);
        for (const st of s.body) visit(st);
        return;
      case "methodDecl":
        for (const st of s.body) visit(st);
        return;
      case "exprStmt":
        out.push(s.expr);
        return;
      default:
        return;
    }
  };
  for (const s of body) visit(s);
  return out;
}

// ── builtins ────────────────────────────────────────────────────────────────

interface BuiltinCtx {
  vm: PineVM;
  node: Extract<Expr, { kind: "call" }>;
  scope: Map<string, SeriesState> | null;
  nsId: number | null;
  /** The receiving object for drawing-object methods. */
  obj?: PineObject;
  pos(i: number): Expr | null;
  named(name: string): Expr | null;
  numArg(i: number, fallback: number): number;
  /** Positional argument value. */
  arg(i: number): V;
  /** The array argument at the given positional index. */
  arr(i: number): PineObject & { items: V[] };
  hist(e: Expr): { at: (back: number) => V; len: number };
  state(key: string): V[];
}

function seriesHistOf(vm: PineVM, e: Expr, scope: Map<string, SeriesState> | null): { at: (back: number) => V; len: number } {
  if (e.kind === "ident") {
    if (vm.builtinSeriesSafe(e.name) !== undefined && !vm.hasVar(scope, e.name)) {
      return {
        at: (back) => (vm.currentBar - back >= 0 ? vm.candleAt(vm.currentBar - back, e.name) : NA),
        len: vm.currentBar + 1,
      };
    }
    // Local scope first, then global fallback (function → global variable)
    const local = scope?.get(e.name);
    const st = local ?? vm.globalVars.get(e.name);
    if (!st) {
      // Global-only variable accessed from a function body
      const g = vm.globalVars.get(e.name);
      if (g) {
        return {
          at: (back) => (back === 0 ? (g.cur !== undefined ? g.cur : g.hist.length ? g.hist[g.hist.length - 1]! : NA) : g.hist.length - back >= 0 ? g.hist[g.hist.length - back]! : NA),
          len: g.hist.length,
        };
      }
      return { at: () => NA, len: 0 };
    }
    return {
      at: (back) => (back === 0 ? (st.cur !== undefined ? st.cur : st.hist.length ? st.hist[st.hist.length - 1]! : NA) : st.hist.length - back >= 0 ? st.hist[st.hist.length - back]! : NA),
      len: st.hist.length,
    };
  }
  if (e.kind === "call") {
    const st = vm.nodeBuf(e.id);
    return {
      at: (back) => (back === 0 ? (st.cur !== undefined ? st.cur : st.hist.length ? st.hist[st.hist.length - 1]! : NA) : st.hist.length - back >= 0 ? st.hist[st.hist.length - back]! : NA),
      len: st.hist.length,
    };
  }
  throw new PineError("Built-in functions need a series argument (close, a variable, or a call)", 0);
}

function rolling(fn: (vals: V[], ctx: BuiltinCtx) => V, ctx: BuiltinCtx, lenArgIdx: number | null, defaultLen: number): V {
  const srcE = ctx.pos(0);
  if (!srcE) throw new PineError("Missing series argument", ctx.node.line);
  const lenE = lenArgIdx !== null ? ctx.pos(lenArgIdx) : null;
  let len = lenE ? Math.round(num(ctx.vm.evalPublic(lenE, ctx.scope))) : defaultLen;
  if (!Number.isFinite(len) || len < 1) len = defaultLen;
  const h = ctx.hist(srcE);
  if (h.len < len) return NA;
  const vals: V[] = [];
  for (let k = 0; k < len; k++) vals.push(h.at(k));
  return fn(vals, ctx);
}

function crossImpl(ctx: BuiltinCtx, mode: "up" | "down" | "any"): boolean {
  const aE = ctx.pos(0);
  const bE = ctx.pos(1);
  if (!aE || !bE) return false;
  const a0 = num(ctx.hist(aE).at(0));
  const b0 = num(ctx.hist(bE).at(0));
  const a1 = num(ctx.hist(aE).at(1));
  const b1 = num(ctx.hist(bE).at(1));
  if ([a0, b0, a1, b1].some((n) => Number.isNaN(n))) return false;
  const up = a1 <= b1 && a0 > b0;
  const down = a1 >= b1 && a0 < b0;
  if (mode === "up") return up;
  if (mode === "down") return down;
  return up || down;
}

function inputImpl(ctx: BuiltinCtx): V {
  const decl = ctx.vm.inputDeclFor(ctx.node.id);
  const title = decl?.title ?? "";
  const provided = ctx.vm.inputValuesPublic[title];
  if (provided !== undefined) {
    if (decl?.type === "source") {
      const bi = ctx.vm.builtinSeriesSafe(String(provided));
      return bi !== undefined ? bi : NA;
    }
    if (decl?.type === "color") return hexToColor(String(provided));
    if (typeof provided === "number") return provided;
    if (typeof provided === "boolean") return provided;
    return provided;
  }
  const defE = ctx.named("defval") ?? ctx.pos(0);
  if (defE) {
    const v = ctx.vm.evalPublic(defE, ctx.scope);
    if (decl?.type === "source" && typeof v === "string") {
      const bi = ctx.vm.builtinSeriesSafe(v);
      return bi !== undefined ? bi : NA;
    }
    return v;
  }
  return NA;
}

/** Fixed UTC offset (minutes) for UTC/GMT±N style zones — null when the zone
 *  needs Intl (real IANA zones with DST). Etc/GMT-3 == UTC+3 (inverted sign). */
const tzOffsetCache = new Map<string, number | null>();
function fixedOffsetMinutes(tz: string): number | null {
  const cached = tzOffsetCache.get(tz);
  if (cached !== undefined) return cached;
  let out: number | null = null;
  const t = tz.trim();
  if (/^(UTC|GMT)$/i.test(t)) out = 0;
  else {
    const m = t.match(/^(?:UTC|GMT)([+-])(\d{1,2})(?::(\d{2}))?$/i);
    if (m) out = (m[1] === "+" ? 1 : -1) * (Number(m[2]) * 60 + Number(m[3] ?? 0));
    else {
      const e = t.match(/^Etc\/GMT([+-])(\d{1,2})$/i);
      if (e) out = (e[1] === "+" ? -1 : 1) * (Number(e[2]) * 60);
    }
  }
  tzOffsetCache.set(tz, out);
  return out;
}

/** Local minutes-of-day in `tz` for a UTC epoch-ms instant (DST-aware when
 *  the zone is a real IANA name; arithmetic for fixed UTC±N offsets). */
const tzFmtCache = new Map<string, Intl.DateTimeFormat>();
function tzMinutesUTC(tz: string, timeMs: number): number {
  const fixed = fixedOffsetMinutes(tz);
  if (fixed !== null) {
    const d = new Date(timeMs);
    return (((d.getUTCHours() * 60 + d.getUTCMinutes() + fixed) % 1440) + 1440) % 1440;
  }
  let fmt = tzFmtCache.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "numeric", hourCycle: "h23" });
    tzFmtCache.set(tz, fmt);
  }
  const parts = fmt.formatToParts(new Date(timeMs));
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

/** Weekday (Pine numbering: Sun=1…Sat=7) in `tz`. */
const tzWeekCache = new Map<string, Intl.DateTimeFormat>();
const TZ_DOW: Record<string, number> = { Sun: 1, Mon: 2, Tue: 3, Wed: 4, Thu: 5, Fri: 6, Sat: 7 };
function tzDayOfWeek(tz: string, timeMs: number): number {
  const fixed = fixedOffsetMinutes(tz);
  if (fixed !== null) return new Date(timeMs + fixed * 60000).getUTCDay() + 1;
  let fmt = tzWeekCache.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" });
    tzWeekCache.set(tz, fmt);
  }
  return TZ_DOW[fmt.formatToParts(new Date(timeMs)).find((p) => p.type === "weekday")?.value ?? "Sun"] ?? 1;
}

/** Pine offsets ("UTC+2", "GMT-5", "UTC+0") → IANA zone names for Intl.
 *  Etc/GMT uses an INVERTED sign: Etc/GMT-3 == UTC+3. */
function normalizeTz(tz: string): string {
  const t = tz.trim();
  if (/^(UTC|GMT)$/i.test(t) || /^(UTC|GMT)\+?0$/i.test(t)) return "UTC";
  const m = t.match(/^(?:UTC|GMT)([+-])(\d{1,2})$/i);
  if (m) {
    const sign = m[1] === "+" ? "-" : "+";
    return `Etc/GMT${sign}${Number(m[2])}`;
  }
  return t;
}

/** 1234567 → "1.23M" (format.volume). */
function formatVolume(n: number): string {
  if (!Number.isFinite(n)) return "na";
  const abs = Math.abs(n);
  if (abs >= 1e9) return trimZeros((n / 1e9).toFixed(2)) + "B";
  if (abs >= 1e6) return trimZeros((n / 1e6).toFixed(2)) + "M";
  if (abs >= 1e3) return trimZeros((n / 1e3).toFixed(2)) + "K";
  return String(Math.round(n));
}

function trimZeros(s: string): string {
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

/** Methods on drawing objects — mutate/read their props in place. */
const DRAWING_METHODS: Record<string, Record<string, (ctx: BuiltinCtx) => V | void>> = {
  box: {
    "get_left": (c) => num((c.obj!.props!["left"] ?? NaN) as V),
    "get_top": (c) => num((c.obj!.props!["top"] ?? NaN) as V),
    "get_right": (c) => num((c.obj!.props!["right"] ?? NaN) as V),
    "get_bottom": (c) => num((c.obj!.props!["bottom"] ?? NaN) as V),
    "set_left": (c) => void (c.obj!.props!["left"] = num(c.vm.evalPublic(c.pos(0)!, c.scope))),
    "set_top": (c) => void (c.obj!.props!["top"] = num(c.vm.evalPublic(c.pos(0)!, c.scope))),
    "set_right": (c) => void (c.obj!.props!["right"] = num(c.vm.evalPublic(c.pos(0)!, c.scope))),
    "set_bottom": (c) => void (c.obj!.props!["bottom"] = num(c.vm.evalPublic(c.pos(0)!, c.scope))),
    "set_rightbottom": (c) => {
      c.obj!.props!["right"] = num(c.vm.evalPublic(c.pos(0)!, c.scope));
      void (c.obj!.props!["bottom"] = num(c.vm.evalPublic(c.pos(1)!, c.scope)));
    },
    "set_bgcolor": (c) => void (c.obj!.props!["bgcolor"] = toCss(c.vm.evalPublic(c.pos(0)!, c.scope)) ?? "transparent"),
    "set_border_color": (c) => void (c.obj!.props!["border_color"] = toCss(c.vm.evalPublic(c.pos(0)!, c.scope)) ?? "transparent"),
    "delete": (c) => void (c.obj!.deleted = true),
  },
  label: {
    "get_x": (c) => num((c.obj!.props!["idx"] ?? NaN) as V),
    "get_y": (c) => num((c.obj!.props!["y"] ?? NaN) as V),
    "get_text": (c) => ((c.obj!.props!["text"] as V) ?? ""),
    "set_x": (c) => void (c.obj!.props!["idx"] = num(c.vm.evalPublic(c.pos(0)!, c.scope))),
    "set_y": (c) => void (c.obj!.props!["y"] = num(c.vm.evalPublic(c.pos(0)!, c.scope))),
    "set_xy": (c) => {
      c.obj!.props!["idx"] = num(c.vm.evalPublic(c.pos(0)!, c.scope));
      void (c.obj!.props!["y"] = num(c.vm.evalPublic(c.pos(1)!, c.scope)));
    },
    "set_text": (c) => void (c.obj!.props!["text"] = String(c.vm.evalPublic(c.pos(0)!, c.scope) ?? "") as V),
    "set_textcolor": (c) => void (c.obj!.props!["textcolor"] = toCss(c.vm.evalPublic(c.pos(0)!, c.scope)) ?? "transparent"),
    "set_color": (c) => void (c.obj!.props!["color"] = toCss(c.vm.evalPublic(c.pos(0)!, c.scope)) ?? "transparent"),
    "set_style": (c) => void (c.obj!.props!["style"] = String(c.vm.evalPublic(c.pos(0)!, c.scope) ?? "") as V),
    "set_size": (c) => void (c.obj!.props!["size"] = String(c.vm.evalPublic(c.pos(0)!, c.scope) ?? "") as V),
    "set_xloc": (c) => void (c.obj!.props!["xloc"] = String(c.vm.evalPublic(c.pos(0)!, c.scope) ?? "") as V),
    "delete": (c) => void (c.obj!.deleted = true),
  },
  line: {
    "get_x1": (c) => num((c.obj!.props!["x1"] ?? NaN) as V),
    "get_y1": (c) => num((c.obj!.props!["y1"] ?? NaN) as V),
    "get_x2": (c) => num((c.obj!.props!["x2"] ?? NaN) as V),
    "get_y2": (c) => num((c.obj!.props!["y2"] ?? NaN) as V),
    "set_x1": (c) => void (c.obj!.props!["x1"] = num(c.vm.evalPublic(c.pos(0)!, c.scope))),
    "set_y1": (c) => void (c.obj!.props!["y1"] = num(c.vm.evalPublic(c.pos(0)!, c.scope))),
    "set_x2": (c) => void (c.obj!.props!["x2"] = num(c.vm.evalPublic(c.pos(0)!, c.scope))),
    "set_y2": (c) => void (c.obj!.props!["y2"] = num(c.vm.evalPublic(c.pos(0)!, c.scope))),
    "set_xy1": (c) => {
      c.obj!.props!["x1"] = num(c.vm.evalPublic(c.pos(0)!, c.scope));
      void (c.obj!.props!["y1"] = num(c.vm.evalPublic(c.pos(1)!, c.scope)));
    },
    "set_xy2": (c) => {
      c.obj!.props!["x2"] = num(c.vm.evalPublic(c.pos(0)!, c.scope));
      void (c.obj!.props!["y2"] = num(c.vm.evalPublic(c.pos(1)!, c.scope)));
    },
    "set_color": (c) => void (c.obj!.props!["color"] = toCss(c.vm.evalPublic(c.pos(0)!, c.scope)) ?? "transparent"),
    "set_width": (c) => void (c.obj!.props!["width"] = num(c.vm.evalPublic(c.pos(0)!, c.scope))),
    "set_extend": (c) => void (c.obj!.props!["extend"] = String(c.vm.evalPublic(c.pos(0)!, c.scope) ?? "") as V),
    "set_style": (c) => void (c.obj!.props!["style"] = String(c.vm.evalPublic(c.pos(0)!, c.scope) ?? "") as V),
    "delete": (c) => void (c.obj!.deleted = true),
  },
  linefill: {
    "get_color": (c) => ((c.obj!.props!["color"] as V) ?? null),
    "set_color": (c) => void (c.obj!.props!["color"] = toCss(c.vm.evalPublic(c.pos(0)!, c.scope)) ?? "transparent"),
    "delete": (c) => void (c.obj!.deleted = true),
  },
  table: {
    // table.cell(tableId, column, row, text, text_color=…, text_size=…,
    // text_halign=…, bgcolor=…) — cells keyed "row:col" for the renderer.
    "cell": (c) => {
      const col = Math.round(c.numArg(0, 0));
      const row = Math.round(c.numArg(1, 0));
      const text = c.pos(2) ? String(c.vm.evalPublic(c.pos(2)!, c.scope) ?? "") : "";
      const tc = c.named("text_color");
      const bg = c.named("bgcolor");
      const cells = (c.obj!.props!["cells"] as unknown as Record<string, { text: string; color: string; bg: string; align: string; size: string }>) ?? {};
      cells[`${row}:${col}`] = {
        text,
        color: tc ? toCss(c.vm.evalPublic(tc, c.scope)) ?? "#e8eaf2" : "#e8eaf2",
        bg: bg ? toCss(c.vm.evalPublic(bg, c.scope)) ?? "transparent" : "transparent",
        align: c.named("text_halign") ? String(c.vm.evalPublic(c.named("text_halign")!, c.scope) ?? "") || "center" : "center",
        size: c.named("text_size") ? String(c.vm.evalPublic(c.named("text_size")!, c.scope) ?? "") || "normal" : "normal",
      };
      c.obj!.props!["cells"] = cells as unknown as V;
      return NA;
    },
    "merge_cells": () => NA,
    "clear": (c) => {
      c.obj!.props!["cells"] = {} as V;
      return NA;
    },
    "delete": (c) => void (c.obj!.deleted = true),
  },
};

const BUILTINS: Record<string, (ctx: BuiltinCtx) => V> = {
  // ── moving averages ──
  "ta.sma": (ctx) =>
    rolling((vals) => {
      let sum = 0;
      for (const v of vals) sum += num(v);
      return sum / vals.length;
    }, ctx, 1, 9),
  "ta.ema": (ctx) => {
    const srcE = ctx.pos(0);
    if (!srcE) throw new PineError("ta.ema needs a source", ctx.node.line);
    const len = Math.max(1, Math.round(ctx.numArg(1, 9)));
    const alpha = 2 / (len + 1);
    const cur = num(ctx.vm.evalPublic(srcE, ctx.scope));
    const st = ctx.state("ema");
    if (st.length < len) {
      const prev = st.length ? num(st[st.length - 1]!) : 0;
      const v = (prev * st.length + cur) / (st.length + 1);
      st.push(v);
      return st.length < len ? NA : v;
    }
    const prev = num(st[st.length - 1]!);
    const v = alpha * cur + (1 - alpha) * prev;
    st.push(v);
    return v;
  },
  "ta.rma": (ctx) => {
    const srcE = ctx.pos(0);
    if (!srcE) throw new PineError("ta.rma needs a source", ctx.node.line);
    const len = Math.max(1, Math.round(ctx.numArg(1, 14)));
    const alpha = 1 / len;
    const cur = num(ctx.vm.evalPublic(srcE, ctx.scope));
    const st = ctx.state("rma");
    if (st.length < len) {
      const prev = st.length ? num(st[st.length - 1]!) : 0;
      const v = (prev * st.length + cur) / (st.length + 1);
      st.push(v);
      return st.length < len ? NA : v;
    }
    const prev = num(st[st.length - 1]!);
    st.push(alpha * cur + (1 - alpha) * prev);
    return st[st.length - 1]!;
  },
  "ta.wma": (ctx) =>
    rolling((vals) => {
      let sum = 0;
      let wsum = 0;
      for (let i = 0; i < vals.length; i++) {
        const w = i + 1;
        sum += num(vals[i]!) * w;
        wsum += w;
      }
      return wsum === 0 ? NaN : sum / wsum;
    }, ctx, 1, 9),
  "ta.hma": (ctx) => {
    // Hull MA: WMA over √n of (2·WMA(n/2) − WMA(n)); the inner diff is
    // streamed into state so the outer WMA has per-bar values.
    const srcE = ctx.pos(0);
    if (!srcE) throw new PineError("ta.hma needs a source", ctx.node.line);
    const n = Math.max(2, Math.round(ctx.numArg(1, 9)));
    const h = ctx.hist(srcE);
    if (h.len < n) return NA;
    const wmaOf = (l: number, offset: number): number => {
      let sum = 0;
      let wsum = 0;
      for (let i = 0; i < l; i++) {
        const v = num(h.at(offset + (l - 1 - i)));
        const w = i + 1;
        sum += v * w;
        wsum += w;
      }
      return wsum === 0 ? NaN : sum / wsum;
    };
    const half = Math.max(1, Math.round(n / 2));
    const diff = 2 * wmaOf(half, 0) - wmaOf(n, 0);
    const diffs = ctx.state("hma_d") as unknown as number[];
    diffs.push(diff);
    const outLen = Math.max(1, Math.round(Math.sqrt(n)));
    if (diffs.length < outLen) return NA;
    let sum = 0;
    let wsum = 0;
    for (let i = 0; i < outLen; i++) {
      const w = i + 1;
      sum += diffs[diffs.length - outLen + i]! * w;
      wsum += w;
    }
    return wsum === 0 ? NaN : sum / wsum;
  },
  "ta.vwma": (ctx) =>
    rolling((vals) => {
      const n = vals.length;
      let sum = 0;
      let vol = 0;
      for (let k = 0; k < n; k++) {
        const w = num(ctx.vm.candleAt(ctx.vm.currentBar - k, "volume"));
        sum += num(vals[n - 1 - k]!) * w;
        vol += w;
      }
      return vol === 0 ? NaN : sum / vol;
    }, ctx, 1, 9),

  // ── oscillators ──
  "ta.rsi": (ctx) => {
    const srcE = ctx.pos(0);
    if (!srcE) throw new PineError("ta.rsi needs a source", ctx.node.line);
    const len = Math.max(2, Math.round(ctx.numArg(1, 14)));
    const h = ctx.hist(srcE);
    if (h.len < len + 1) return NA;
    let gains = 0;
    let losses = 0;
    for (let k = 0; k < len; k++) {
      const d = num(h.at(k)) - num(h.at(k + 1));
      if (d > 0) gains += d;
      else losses -= d;
    }
    const gArr = ctx.state("rsi_g") as unknown as number[];
    const lArr = ctx.state("rsi_l") as unknown as number[];
    let avgGain: number;
    let avgLoss: number;
    if (gArr.length === 0) {
      avgGain = gains / len;
      avgLoss = losses / len;
    } else {
      const pg = gArr[gArr.length - 1]!;
      const pl = lArr[lArr.length - 1]!;
      avgGain = (pg * (len - 1) + gains) / len;
      avgLoss = (pl * (len - 1) + losses) / len;
    }
    gArr.push(avgGain);
    lArr.push(avgLoss);
    if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  },
  "ta.stdev": (ctx) =>
    rolling((vals) => {
      const n = vals.length;
      if (n < 2) return NaN;
      let mean = 0;
      for (const v of vals) mean += num(v);
      mean /= n;
      let acc = 0;
      for (const v of vals) acc += (num(v) - mean) ** 2;
      return Math.sqrt(acc / n);
    }, ctx, 1, 20),
  "ta.variance": (ctx) =>
    rolling((vals) => {
      const n = vals.length;
      if (n < 2) return NaN;
      let mean = 0;
      for (const v of vals) mean += num(v);
      mean /= n;
      let acc = 0;
      for (const v of vals) acc += (num(v) - mean) ** 2;
      return acc / n;
    }, ctx, 1, 20),
  "ta.cci": (ctx) => {
    const len = Math.max(2, Math.round(ctx.numArg(0, 20)));
    if (ctx.vm.currentBar + 1 < len) return NA;
    let tpSum = 0;
    const tps: number[] = [];
    for (let k = 0; k < len; k++) {
      const tp = num(ctx.vm.candleAt(ctx.vm.currentBar - k, "hlc3"));
      tps.push(tp);
      tpSum += tp;
    }
    const tpMa = tpSum / len;
    let dev = 0;
    for (const tp of tps) dev += Math.abs(tp - tpMa);
    const md = dev / len;
    return md === 0 ? 0 : (tps[0]! - tpMa) / (0.015 * md);
  },
  "ta.mfi": (ctx) => {
    const len = Math.max(2, Math.round(ctx.numArg(0, 14)));
    if (ctx.vm.currentBar + 1 < len + 1) return NA;
    let pos = 0;
    let neg = 0;
    for (let k = 0; k < len; k++) {
      const tpCur = num(ctx.vm.candleAt(ctx.vm.currentBar - k, "hlc3"));
      const tpPrev = num(ctx.vm.candleAt(ctx.vm.currentBar - k - 1, "hlc3"));
      const flow = tpCur * num(ctx.vm.candleAt(ctx.vm.currentBar - k, "volume"));
      if (tpCur > tpPrev) pos += flow;
      else if (tpCur < tpPrev) neg += flow;
    }
    if (neg === 0) return 100;
    return 100 - 100 / (1 + pos / neg);
  },
  "ta.tr": (ctx) => {
    if (ctx.vm.currentBar === 0) return num(ctx.vm.candleAt(0, "high")) - num(ctx.vm.candleAt(0, "low"));
    const h = num(ctx.vm.candleAt(ctx.vm.currentBar, "high"));
    const l = num(ctx.vm.candleAt(ctx.vm.currentBar, "low"));
    const pc = num(ctx.vm.candleAt(ctx.vm.currentBar - 1, "close"));
    return Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  },
  "ta.atr": (ctx) => {
    const trNow = num(BUILTINS["ta.tr"]!(ctx));
    const len = Math.max(1, Math.round(ctx.numArg(0, 14)));
    const st = ctx.state("atr") as unknown as number[];
    const alpha = 1 / len;
    if (st.length < len) {
      const prev = st.length ? st[st.length - 1]! : 0;
      const v = (prev * st.length + trNow) / (st.length + 1);
      st.push(v);
      return st.length < len ? NA : v;
    }
    const prev = st[st.length - 1]!;
    const v = alpha * trNow + (1 - alpha) * prev;
    st.push(v);
    return v;
  },

  // ── extremes / changes ──
  "ta.highest": (ctx) =>
    rolling((vals) => {
      let m = NaN;
      for (const v of vals) {
        const n = num(v);
        if (!Number.isNaN(n) && (Number.isNaN(m) || n > m)) m = n;
      }
      return m;
    }, ctx, 1, 20),
  "ta.lowest": (ctx) =>
    rolling((vals) => {
      let m = NaN;
      for (const v of vals) {
        const n = num(v);
        if (!Number.isNaN(n) && (Number.isNaN(m) || n < m)) m = n;
      }
      return m;
    }, ctx, 1, 20),
  "ta.change": (ctx) => {
    const srcE = ctx.pos(0);
    if (!srcE) return NA;
    const back = Math.max(1, Math.round(ctx.numArg(1, 1)));
    const h = ctx.hist(srcE);
    if (h.len <= back) return NA;
    return num(h.at(0)) - num(h.at(back));
  },
  "ta.mom": (ctx) => BUILTINS["ta.change"]!(ctx),
  "ta.cross": (ctx) => crossImpl(ctx, "any"),
  "ta.crossover": (ctx) => crossImpl(ctx, "up"),
  "ta.crossunder": (ctx) => crossImpl(ctx, "down"),

  // ── multi-return ──
  "ta.macd": (ctx) => {
    const srcE = ctx.pos(0);
    if (!srcE) throw new PineError("ta.macd needs a source", ctx.node.line);
    const fast = Math.max(1, Math.round(ctx.numArg(1, 12)));
    const slow = Math.max(2, Math.round(ctx.numArg(2, 26)));
    const signal = Math.max(1, Math.round(ctx.numArg(3, 9)));
    const cur = num(ctx.vm.evalPublic(srcE, ctx.scope));
    const emaStep = (key: string, l: number, minBars: number): number => {
      const st = ctx.state(key) as unknown as number[];
      const alpha = 2 / (l + 1);
      if (st.length < minBars) {
        const prev = st.length ? st[st.length - 1]! : cur;
        const v = (prev * st.length + cur) / (st.length + 1);
        st.push(v);
        return v;
      }
      const prev = st[st.length - 1]!;
      const v = alpha * cur + (1 - alpha) * prev;
      st.push(v);
      return v;
    };
    const fastEma = emaStep("fast", fast, slow);
    const slowEma = emaStep("slow", slow, slow);
    const macdLine = fastEma - slowEma;
    const sigSt = ctx.state("sig") as unknown as number[];
    let sig: number;
    if (sigSt.length < slow) {
      sig = macdLine;
    } else {
      const alphaS = 2 / (signal + 1);
      sig = alphaS * macdLine + (1 - alphaS) * sigSt[sigSt.length - 1]!;
    }
    sigSt.push(sig);
    return [macdLine, sig, macdLine - sig] as unknown as V;
  },
  "ta.bb": (ctx) => {
    const basis = num(BUILTINS["ta.sma"]!(ctx));
    const dev = num(BUILTINS["ta.stdev"]!(ctx));
    const mult = ctx.numArg(2, 2);
    return [basis, basis + mult * dev, basis - mult * dev] as unknown as V;
  },
  "ta.stoch": (ctx) => {
    const srcE = ctx.pos(0);
    const highE = ctx.pos(1);
    const lowE = ctx.pos(2);
    if (!srcE || !highE || !lowE) throw new PineError("ta.stoch(source, high, low, length)", ctx.node.line);
    const len = Math.max(1, Math.round(ctx.numArg(3, 14)));
    const c = num(ctx.vm.evalPublic(srcE, ctx.scope));
    let hh = NaN;
    let ll = NaN;
    for (let k = 0; k < len; k++) {
      const h = num(ctx.hist(highE).at(k));
      const l = num(ctx.hist(lowE).at(k));
      if (Number.isNaN(hh) || h > hh) hh = h;
      if (Number.isNaN(ll) || l < ll) ll = l;
    }
    if (Number.isNaN(hh) || Number.isNaN(ll) || hh === ll) return 50;
    return ((c - ll) / (hh - ll)) * 100;
  },
  "ta.supertrend": (ctx) => {
    const factor = ctx.numArg(0, 3);
    const atr = num(BUILTINS["ta.atr"]!(ctx)); // consumes the ATR-length arg
    const src = num(ctx.vm.candleAt(ctx.vm.currentBar, "hlc3"));
    const upArr = ctx.state("st_upper") as unknown as number[];
    const lowArr = ctx.state("st_lower") as unknown as number[];
    const dirArr = ctx.state("st_dir") as unknown as number[];
    const supArr = ctx.state("st_sup") as unknown as number[];
    const basicUpper = src + factor * atr;
    const basicLower = src - factor * atr;
    let upper = basicUpper;
    let lower = basicLower;
    if (upArr.length) {
      const prevUpper = upArr[upArr.length - 1]!;
      const prevLower = lowArr[lowArr.length - 1]!;
      const prevClose = num(ctx.vm.candleAt(ctx.vm.currentBar - 1, "close"));
      upper = basicUpper < prevUpper || prevClose > prevUpper ? basicUpper : prevUpper;
      lower = basicLower > prevLower || prevClose < prevLower ? basicLower : prevLower;
    }
    let dir = dirArr.length ? dirArr[dirArr.length - 1]! : 1;
    if (supArr.length) {
      const prevSup = supArr[supArr.length - 1]!;
      if (prevSup === upper) dir = -1;
      else if (prevSup === lower) dir = 1;
    } else {
      dir = 1;
    }
    const sup = dir === 1 ? lower : upper;
    upArr.push(upper);
    lowArr.push(lower);
    dirArr.push(dir);
    supArr.push(sup);
    return [sup, dir] as unknown as V;
  },
  "ta.dmi": (ctx) => {
    const diLen = Math.max(1, Math.round(ctx.numArg(0, 14)));
    const adxLen = Math.max(1, Math.round(ctx.numArg(1, 14)));
    const h = num(ctx.vm.candleAt(ctx.vm.currentBar, "high"));
    const l = num(ctx.vm.candleAt(ctx.vm.currentBar, "low"));
    const c = num(ctx.vm.candleAt(ctx.vm.currentBar, "close"));
    const upArr = ctx.state("dmi_up") as unknown as number[];
    const dnArr = ctx.state("dmi_dn") as unknown as number[];
    const trArr = ctx.state("dmi_tr") as unknown as number[];
    const adxArr = ctx.state("dmi_adx") as unknown as number[];
    if (ctx.vm.currentBar === 0) {
      upArr.push(h - l);
      dnArr.push(0);
      trArr.push(h - l);
      adxArr.push(NaN);
      return [0, 0, 0] as unknown as V;
    }
    const prevH = num(ctx.vm.candleAt(ctx.vm.currentBar - 1, "high"));
    const prevL = num(ctx.vm.candleAt(ctx.vm.currentBar - 1, "low"));
    const prevC = num(ctx.vm.candleAt(ctx.vm.currentBar - 1, "close"));
    const upMove = h - prevH;
    const downMove = prevL - l;
    let plusDM = 0;
    let minusDM = 0;
    if (upMove > downMove && upMove > 0) plusDM = upMove;
    if (downMove > upMove && downMove > 0) minusDM = downMove;
    const tr = Math.max(h - l, Math.abs(h - prevC), Math.abs(l - prevC));
    const alpha = 1 / diLen;
    const rmaStep = (arr: number[], v: number): number => {
      if (arr.length < diLen) {
        const prev = arr.length ? arr[arr.length - 1]! : v;
        const out = (prev * arr.length + v) / (arr.length + 1);
        arr.push(out);
        return out;
      }
      const prev = arr[arr.length - 1]!;
      const out = alpha * v + (1 - alpha) * prev;
      arr.push(out);
      return out;
    };
    const trRma = rmaStep(trArr, tr);
    const plusRma = rmaStep(upArr, plusDM);
    const minusRma = rmaStep(dnArr, minusDM);
    const plusDI = trRma === 0 ? 0 : (100 * plusRma) / trRma;
    const minusDI = trRma === 0 ? 0 : (100 * minusRma) / trRma;
    const denom = plusDI + minusDI;
    const dx = denom === 0 ? 0 : (100 * Math.abs(plusDI - minusDI)) / denom;
    const prevAdx = adxArr.length ? adxArr[adxArr.length - 1]! : NaN;
    const adx = Number.isNaN(prevAdx) ? dx : (1 / adxLen) * dx + (1 - 1 / adxLen) * prevAdx;
    adxArr.push(adx);
    void c;
    return [plusDI, minusDI, adx] as unknown as V;
  },

  // ── misc ──
  "ta.barssince": (ctx) => {
    const condE = ctx.pos(0);
    if (!condE) return NA;
    const cur = truthy(ctx.vm.evalPublic(condE, ctx.scope));
    const st = ctx.vm.nodeBuf(condE.id);
    st.cur = cur;
    for (let k = 0; k <= st.hist.length; k++) {
      const v = k === 0 ? (st.cur as V) : st.hist[st.hist.length - k]!;
      if (truthy(v)) return k;
    }
    return NA;
  },
  "ta.cum": (ctx) => {
    const v = num(ctx.vm.evalPublic(ctx.pos(0)!, ctx.scope));
    const st = ctx.state("cum") as unknown as number[];
    const prev = st.length ? st[st.length - 1]! : 0;
    const out = Number.isNaN(v) ? prev : prev + v;
    st.push(out);
    return out;
  },
  "ta.sum": (ctx) =>
    rolling((vals) => {
      let s = 0;
      for (const v of vals) s += num(v);
      return s;
    }, ctx, 1, 20),
  "ta.median": (ctx) =>
    rolling((vals) => {
      const nums = vals.map(num).filter((n) => !Number.isNaN(n)).sort((a, b) => a - b);
      if (nums.length === 0) return NaN;
      const mid = Math.floor(nums.length / 2);
      return nums.length % 2 ? nums[mid]! : (nums[mid - 1]! + nums[mid]!) / 2;
    }, ctx, 1, 20),
  "ta.linreg": (ctx) => {
    const offset = ctx.numArg(2, 0);
    return rolling((vals) => {
      const n = vals.length;
      if (n < 2) return NaN;
      let sx = 0;
      let sy = 0;
      let sxy = 0;
      let sxx = 0;
      for (let i = 0; i < n; i++) {
        const y = num(vals[n - 1 - i]!);
        sx += i;
        sy += y;
        sxy += i * y;
        sxx += i * i;
      }
      const denom = n * sxx - sx * sx;
      if (denom === 0) return NaN;
      const slope = (n * sxy - sx * sy) / denom;
      const intercept = (sy - slope * sx) / n;
      return intercept + slope * (n - 1 - offset);
    }, ctx, 1, 20);
  },
  "ta.vwap": (ctx) => {
    const day = Math.floor(num(ctx.vm.candleAt(ctx.vm.currentBar, "time")) / 86400000);
    const st = ctx.state("vwap");
    const dayArr = ctx.state("vwap_day") as unknown as number[];
    const pvArr = ctx.state("vwap_pv") as unknown as number[];
    const vArr = ctx.state("vwap_v") as unknown as number[];
    const prevDay = dayArr.length ? dayArr[dayArr.length - 1]! : -1;
    const pv = num(ctx.vm.candleAt(ctx.vm.currentBar, "hlc3")) * num(ctx.vm.candleAt(ctx.vm.currentBar, "volume"));
    const vol = num(ctx.vm.candleAt(ctx.vm.currentBar, "volume"));
    let pvSum: number;
    let vSum: number;
    if (day !== prevDay) {
      pvSum = pv;
      vSum = vol;
    } else {
      pvSum = (pvArr.length ? pvArr[pvArr.length - 1]! : 0) + pv;
      vSum = (vArr.length ? vArr[vArr.length - 1]! : 0) + vol;
    }
    pvArr.push(pvSum);
    vArr.push(vSum);
    dayArr.push(day);
    const out: V = vSum === 0 ? NA : pvSum / vSum;
    st.push(out);
    return out;
  },

  // ── math ──
  "math.abs": (ctx) => Math.abs(num(ctx.vm.evalPublic(ctx.pos(0)!, ctx.scope))),
  "math.max": (ctx) => {
    let m = NaN;
    for (let i = 0; i < ctx.node.args.length; i++) {
      const n = num(ctx.vm.evalPublic(ctx.pos(i)!, ctx.scope));
      if (!Number.isNaN(n) && (Number.isNaN(m) || n > m)) m = n;
    }
    return m;
  },
  "math.min": (ctx) => {
    let m = NaN;
    for (let i = 0; i < ctx.node.args.length; i++) {
      const n = num(ctx.vm.evalPublic(ctx.pos(i)!, ctx.scope));
      if (!Number.isNaN(n) && (Number.isNaN(m) || n < m)) m = n;
    }
    return m;
  },
  "math.pow": (ctx) => Math.pow(num(ctx.vm.evalPublic(ctx.pos(0)!, ctx.scope)), num(ctx.vm.evalPublic(ctx.pos(1)!, ctx.scope))),
  "math.sqrt": (ctx) => {
    const v = num(ctx.vm.evalPublic(ctx.pos(0)!, ctx.scope));
    return v < 0 ? NaN : Math.sqrt(v);
  },
  "math.round": (ctx) => {
    const x = num(ctx.vm.evalPublic(ctx.pos(0)!, ctx.scope));
    const pE = ctx.named("precision");
    const p = pE ? num(ctx.vm.evalPublic(pE, ctx.scope)) : 0;
    if (p === 0) return Math.round(x);
    const f = 10 ** p;
    return Math.round(x * f) / f;
  },
  "math.floor": (ctx) => Math.floor(num(ctx.vm.evalPublic(ctx.pos(0)!, ctx.scope))),
  "math.ceil": (ctx) => Math.ceil(num(ctx.vm.evalPublic(ctx.pos(0)!, ctx.scope))),
  "math.avg": (ctx) => {
    let sum = 0;
    let n = 0;
    for (let i = 0; i < ctx.node.args.length; i++) {
      const v = num(ctx.vm.evalPublic(ctx.pos(i)!, ctx.scope));
      if (!Number.isNaN(v)) {
        sum += v;
        n++;
      }
    }
    return n === 0 ? NaN : sum / n;
  },
  "math.log": (ctx) => Math.log(num(ctx.vm.evalPublic(ctx.pos(0)!, ctx.scope))),
  "math.log10": (ctx) => Math.log10(num(ctx.vm.evalPublic(ctx.pos(0)!, ctx.scope))),
  "math.exp": (ctx) => Math.exp(num(ctx.vm.evalPublic(ctx.pos(0)!, ctx.scope))),
  "math.sign": (ctx) => Math.sign(num(ctx.vm.evalPublic(ctx.pos(0)!, ctx.scope))),
  "math.todegrees": (ctx) => (num(ctx.vm.evalPublic(ctx.pos(0)!, ctx.scope)) * 180) / Math.PI,
  "math.toradians": (ctx) => (num(ctx.vm.evalPublic(ctx.pos(0)!, ctx.scope)) * Math.PI) / 180,
  "math.e": () => Math.E,
  "math.pi": () => Math.PI,

  // ── na helpers ──
  "na": (ctx) => isNa(ctx.vm.evalPublic(ctx.pos(0)!, ctx.scope)),
  "nz": (ctx) => {
    const v = ctx.vm.evalPublic(ctx.pos(0)!, ctx.scope);
    if (!isNa(v)) return v;
    const rE = ctx.pos(1);
    return rE ? ctx.vm.evalPublic(rE, ctx.scope) : 0;
  },
  "fixnan": (ctx) => {
    const srcE = ctx.pos(0);
    if (!srcE) return NA;
    const st = ctx.state("fixnan");
    const v = ctx.vm.evalPublic(srcE, ctx.scope);
    if (!isNa(v)) st.push(v);
    return st.length ? st[st.length - 1]! : NA;
  },

  // ── colors ──
  "color": (ctx) => {
    const v = ctx.vm.evalPublic(ctx.pos(0)!, ctx.scope);
    if (isNa(v)) return NA;
    return toCss(v) ?? v;
  },
  "color.new": (ctx) => {
    const base = ctx.vm.evalPublic(ctx.pos(0)!, ctx.scope);
    const transp = num(ctx.vm.evalPublic(ctx.pos(1)!, ctx.scope));
    const css = toCss(base);
    if (!css) return base;
    return recolorWithTransp(css, transp);
  },
  "color.rgb": (ctx) => {
    const r = Math.round(num(ctx.vm.evalPublic(ctx.pos(0)!, ctx.scope)));
    const g = Math.round(num(ctx.vm.evalPublic(ctx.pos(1)!, ctx.scope)));
    const b = Math.round(num(ctx.vm.evalPublic(ctx.pos(2)!, ctx.scope)));
    const transp = ctx.node.args.filter((a) => a.name === null).length > 3 ? num(ctx.vm.evalPublic(ctx.pos(3)!, ctx.scope)) : 0;
    const a = Math.max(0, Math.min(1, 1 - transp / 100));
    return { css: `rgba(${r},${g},${b},${a.toFixed(3)})` };
  },

  // ── inputs (declaration recorded at compile; value injected) ──
  "input": inputImpl,
  "input.int": inputImpl,
  "input.float": inputImpl,
  "input.bool": inputImpl,
  "input.color": inputImpl,
  "input.source": inputImpl,
  "input.string": inputImpl,
  "input.session": inputImpl,

  // ── arrays ──
  "array.new": (ctx) => {
    const sizeE = ctx.pos(0);
    const initE = ctx.pos(1);
    const items: V[] = [];
    const size = sizeE ? Math.max(0, Math.round(num(ctx.vm.evalPublic(sizeE, ctx.scope)))) : 0;
    const fill = initE ? ctx.vm.evalPublic(initE, ctx.scope) : NA;
    for (let i = 0; i < size; i++) items.push(fill);
    return { __kind: "array", items } as V;
  },
  "array.push": (ctx) => { ctx.arr(0).items.push(ctx.arg(1)); return NA; },
  "array.pop": (ctx) => { const a = ctx.arr(0); return a.items.length ? (a.items.pop() ?? NA) : NA; },
  "array.shift": (ctx) => { const a = ctx.arr(0); return a.items.length ? (a.items.shift() ?? NA) : NA; },
  "array.get": (ctx) => { const a = ctx.arr(0); const i = Math.round(ctx.numArg(1, 0)); return a.items[i] ?? NA; },
  "array.set": (ctx) => { const a = ctx.arr(0); const i = Math.round(ctx.numArg(1, 0)); if (i >= 0 && i < a.items.length) a.items[i] = ctx.arg(2); return NA; },
  "array.size": (ctx) => ctx.arr(0).items.length,
  "array.remove": (ctx) => { const a = ctx.arr(0); const i = Math.round(ctx.numArg(1, 0)); return i >= 0 && i < a.items.length ? (a.items.splice(i, 1)[0] ?? NA) : NA; },
  "array.first": (ctx) => { const a = ctx.arr(0); return a.items.length ? (a.items[0] ?? NA) : NA; },
  "array.last": (ctx) => { const a = ctx.arr(0); return a.items.length ? (a.items[a.items.length - 1]! ?? NA) : NA; },
  "array.includes": (ctx) => { const a = ctx.arr(0); const v = ctx.arg(1); return a.items.some((x) => eqVal(x, v)); },
  "array.indexof": (ctx) => { const a = ctx.arr(0); const v = ctx.arg(1); return a.items.findIndex((x) => eqVal(x, v)); },
  "array.clear": (ctx) => { ctx.arr(0).items.length = 0; return NA; },
  "array.from": (ctx) => { const items: V[] = []; for (let i = 0; i < ctx.node.args.length; i++) items.push(ctx.arg(i)); return { __kind: "array", items } as V; },
  "array.join": (ctx) => { const a = ctx.arr(0); const sep = ctx.pos(1) ? String(ctx.vm.evalPublic(ctx.pos(1)!, ctx.scope) ?? "") : ","; return a.items.map((v) => (v === null || v === undefined ? "na" : String(typeof v === "object" && "css" in v ? (v as PineColor).css : v))).join(sep); },
  "array.sum": (ctx) => { const a = ctx.arr(0); let sum = 0; for (const v of a.items) sum += num(v); return sum; },

  // ── drawing object constructors ──
  "box.new": (ctx) => {
    const props: Record<string, V> = {
      left: ctx.numArg(0, 0),
      top: ctx.numArg(1, 0),
      right: ctx.numArg(2, 0),
      bottom: ctx.numArg(3, 0),
      bgcolor: toCss(ctx.named("bgcolor") ? ctx.vm.evalPublic(ctx.named("bgcolor")!, ctx.scope) : null) ?? "rgba(0,0,0,0)",
      border_color: toCss(ctx.named("border_color") ? ctx.vm.evalPublic(ctx.named("border_color")!, ctx.scope) : null) ?? "transparent",
      border_style: ctx.named("border_style") ? String(ctx.vm.evalPublic(ctx.named("border_style")!, ctx.scope) ?? "") : "solid",
      border_width: ctx.named("border_width") ? num(ctx.vm.evalPublic(ctx.named("border_width")!, ctx.scope)) : 1,
    };
    return ctx.vm.newDrawing("box", props);
  },
  "label.new": (ctx) => {
    const props: Record<string, V> = {
      idx: ctx.numArg(0, 0),
      y: ctx.numArg(1, 0),
      text: ctx.pos(2) ? String(ctx.vm.evalPublic(ctx.pos(2)!, ctx.scope) ?? "") : "",
      style: ctx.named("style") ? String(ctx.vm.evalPublic(ctx.named("style")!, ctx.scope) ?? "") : "label_down",
      textcolor: toCss(ctx.named("textcolor") ? ctx.vm.evalPublic(ctx.named("textcolor")!, ctx.scope) : null) ?? "#e8eaf2",
      color: toCss(ctx.named("color") ? ctx.vm.evalPublic(ctx.named("color")!, ctx.scope) : null) ?? "transparent",
      textalign: ctx.named("textalign") ? String(ctx.vm.evalPublic(ctx.named("textalign")!, ctx.scope) ?? "") : "center",
      xloc: ctx.named("xloc") ? String(ctx.vm.evalPublic(ctx.named("xloc")!, ctx.scope) ?? "") : "bar_index",
      size: ctx.named("size") ? String(ctx.vm.evalPublic(ctx.named("size")!, ctx.scope) ?? "") : "normal",
    };
    return ctx.vm.newDrawing("label", props);
  },
  "line.new": (ctx) => {
    const props: Record<string, V> = {
      x1: ctx.numArg(0, 0),
      y1: ctx.numArg(1, 0),
      x2: ctx.numArg(2, 0),
      y2: ctx.numArg(3, 0),
      color: toCss(ctx.named("color") ? ctx.vm.evalPublic(ctx.named("color")!, ctx.scope) : null) ?? "#2196F3",
      style: ctx.named("style") ? String(ctx.vm.evalPublic(ctx.named("style")!, ctx.scope) ?? "") : "solid",
      width: ctx.named("width") ? num(ctx.vm.evalPublic(ctx.named("width")!, ctx.scope)) : 1,
      extend: ctx.named("extend") ? String(ctx.vm.evalPublic(ctx.named("extend")!, ctx.scope) ?? "") : "none",
      xloc: ctx.named("xloc") ? String(ctx.vm.evalPublic(ctx.named("xloc")!, ctx.scope) ?? "") : "bar_index",
    };
    return ctx.vm.newDrawing("line", props);
  },
  // Dashboard tables: cells are stored on the object; the chart overlay
  // renders the final grid in the requested corner.
  "table.new": (ctx) => {
    const posV = ctx.pos(0) ? ctx.vm.evalPublic(ctx.pos(0)!, ctx.scope) : "top_right";
    const props: Record<string, V> = {
      position: typeof posV === "string" ? posV : "top_right",
      columns: ctx.numArg(1, 2),
      rows: ctx.numArg(2, 2),
      bgcolor: toCss(ctx.named("bgcolor") ? ctx.vm.evalPublic(ctx.named("bgcolor")!, ctx.scope) : null) ?? "transparent",
      frame_color: toCss(ctx.named("frame_color") ? ctx.vm.evalPublic(ctx.named("frame_color")!, ctx.scope) : null) ?? "transparent",
      cells: {} as V,
    };
    return ctx.vm.newDrawing("table", props);
  },
  "linefill.new": (ctx) => {
    const a = ctx.vm.evalPublic(ctx.pos(0)!, ctx.scope);
    const b = ctx.vm.evalPublic(ctx.pos(1)!, ctx.scope);
    const color = toCss(ctx.vm.evalPublic(ctx.pos(2)!, ctx.scope)) ?? "transparent";
    return { __kind: "linefill", props: { a: isObjectV(a) ? a : null, b: isObjectV(b) ? b : null, color }, deleted: false } as V;
  },

  // ── session/time detection ──
  "time": (ctx) => {
    const sessionE = ctx.pos(1);
    if (!sessionE) return NA;
    const sessionStr = String(ctx.vm.evalPublic(sessionE, ctx.scope) ?? "");
    if (!sessionStr) return NA;
    const m = sessionStr.match(/^(\d{4})-(\d{4})(?::([0-7]+))?$/);
    if (!m) return NA;
    const start = Number(m[1]!.slice(0, 2)) * 60 + Number(m[1]!.slice(2));
    const end = Number(m[2]!.slice(0, 2)) * 60 + Number(m[2]!.slice(2));
    const days = m[3] ? m[3]!.split("").map(Number) : [1, 2, 3, 4, 5, 6, 7];
    const tz = ctx.pos(2) ? String(ctx.vm.evalPublic(ctx.pos(2)!, ctx.scope) ?? "Exchange") : "Exchange";
    const timeMs = num(ctx.vm.candleAt(ctx.vm.currentBar, "time"));
    const tzReal = tz === "Exchange" ? "UTC" : normalizeTz(tz);
    const localMin = tzMinutesUTC(tzReal, timeMs);
    const dow = tzDayOfWeek(tzReal, timeMs);
    if (!days.includes(dow)) return NA;
    const inS = start <= end ? localMin >= start && localMin < end : localMin >= start || localMin < end;
    return inS ? timeMs : NA;
  },

  "timeframe.change": (ctx) => {
    const tf = ctx.pos(0) ? String(ctx.vm.evalPublic(ctx.pos(0)!, ctx.scope) ?? "") : "D";
    const sec = tfSecondsOf(tf === "" ? ctx.vm.chartInfoTimeframe : tf);
    if (sec <= 0) return NA;
    const cur = ctx.vm.currentBar;
    if (cur === 0) return true;
    const bucket = (i: number): number => {
      if (sec === 2592000) {
        const d = new Date(num(ctx.vm.candleAt(i, "time")));
        return d.getUTCFullYear() * 12 + d.getUTCMonth();
      }
      return Math.floor(num(ctx.vm.candleAt(i, "time")) / (sec * 1000));
    };
    return bucket(cur) !== bucket(cur - 1);
  },

  // ── strings / errors ──
  "str.tostring": (ctx) => {
    const v = ctx.vm.evalPublic(ctx.pos(0)!, ctx.scope);
    const fmtE = ctx.pos(1);
    const fmt = fmtE ? String(ctx.vm.evalPublic(fmtE, ctx.scope) ?? "") : "";
    if (fmt === "mintick") return (num(v) as number).toFixed(ctx.vm.chartInfoPrecision);
    if (fmt === "volume") return formatVolume(num(v));
    const hash = fmt.match(/^#*(\.#+)?$/);
    if (hash) {
      const n = num(v);
      if (Number.isNaN(n)) return isNa(v) ? "na" : String(v);
      const dec = fmt.split(".")[1]?.length ?? 0;
      return dec > 0 ? trimZeros(n.toFixed(dec)) : String(Math.round(n));
    }
    if (isNa(v)) return "na";
    if (typeof v === "boolean") return v ? "true" : "false";
    return String(v);
  },
  "str.tonumber": (ctx) => num(ctx.vm.evalPublic(ctx.pos(0)!, ctx.scope)),
  "str.format": (ctx) => {
    const fmtE = ctx.pos(0);
    if (!fmtE) return "";
    const fmt = String(ctx.vm.evalPublic(fmtE, ctx.scope) ?? "");
    return fmt.replace(/\{(\d+)(?::[^}]*)?\}/g, (_m, idx: string) => {
      const e = ctx.pos(Number(idx) + 1);
      if (!e) return "";
      const v = ctx.vm.evalPublic(e, ctx.scope);
      if (isNa(v)) return "na";
      if (typeof v === "boolean") return v ? "true" : "false";
      if (typeof v === "number") {
        if (Number.isInteger(v)) return String(v);
        return String(Number(v.toFixed(8)));
      }
      if (v && typeof v === "object" && "css" in v) return (v as PineColor).css;
      return String(v);
    });
  },
  // type casts
  "int": (ctx) => Math.trunc(num(ctx.vm.evalPublic(ctx.pos(0)!, ctx.scope))),
  "float": (ctx) => num(ctx.vm.evalPublic(ctx.pos(0)!, ctx.scope)),
  "bool": (ctx) => truthy(ctx.vm.evalPublic(ctx.pos(0)!, ctx.scope)),
  "runtime.error": (ctx) => {
    const msg = ctx.vm.evalPublic(ctx.pos(0)!, ctx.scope);
    throw new PineRuntimeError(String(msg ?? "runtime.error"), ctx.node.line);
  },

  // ── graceful no-ops (no visual in this subset) ──
  "alertcondition": () => NA,
  "plotshape": () => NA,
  "plotchar": () => NA,
  "plotarrow": () => NA,
  "plotcandle": () => NA,
  "barcolor": () => NA,
  "bgcolor": () => NA,
  "fill": () => NA,
};
