import io

p = "pine/runtime.ts"
s = io.open(p, encoding="utf-8").read()

# 1. Constructor dispatch before the dotted method dispatch
old = """    // Dotted callees: obj.method(…) — UDT methods and drawing-object methods.
    if (node.callee.includes(".")) {
      const segs = node.callee.split(".");
      const last = segs[segs.length - 1]!;
      const root = this.readVar(scope ?? null, segs[0]!);"""
new = """    // Dotted callees: obj.method(…) — UDT methods and drawing-object methods.
    if (node.callee.includes(".")) {
      const segs = node.callee.split(".");
      const last = segs[segs.length - 1]!;
      // UDT constructor: SessionInfo.new(…)
      if (segs.length === 2 && segs[1] === "new" && this.types.has(segs[0]!)) {
        const obj = this.constructUdt(segs[0]!, node, scope ?? null, nsId, node.line);
        buf.cur = obj;
        return obj;
      }
      const root = this.readVar(scope ?? null, segs[0]!);"""
assert old in s, "ctor dispatch"
s = s.replace(old, new)

# 2. BUILTINS: array namespace + drawing constructors + time + timeframe.change + str.* + runtime.error
old = """  // ── graceful no-ops (no visual in this subset) ──
  "alertcondition": () => NA,"""
new = """  // ── arrays ──
  "array.new": (ctx) => {
    const sizeE = ctx.pos(0);
    const initE = ctx.pos(1);
    const items: V[] = [];
    const size = sizeE ? Math.max(0, Math.round(num(ctx.vm.evalPublic(sizeE, ctx.scope)))) : 0;
    const fill = initE ? ctx.vm.evalPublic(initE, ctx.scope) : NA;
    for (let i = 0; i < size; i++) items.push(fill);
    return { __kind: "array", items } as V;
  },
  "array.push": (ctx) => {
    const a = ctx.arr(0);
    a.items.push(ctx.arg(1));
    return NA;
  },
  "array.pop": (ctx) => {
    const a = ctx.arr(0);
    return a.items.length ? (a.items.pop() ?? NA) : NA;
  },
  "array.shift": (ctx) => {
    const a = ctx.arr(0);
    return a.items.length ? (a.items.shift() ?? NA) : NA;
  },
  "array.get": (ctx) => {
    const a = ctx.arr(0);
    const i = Math.round(ctx.numArg(1, 0));
    return a.items[i] ?? NA;
  },
  "array.set": (ctx) => {
    const a = ctx.arr(0);
    const i = Math.round(ctx.numArg(1, 0));
    if (i >= 0 && i < a.items.length) a.items[i] = ctx.arg(2);
    return NA;
  },
  "array.size": (ctx) => ctx.arr(0).items.length,
  "array.remove": (ctx) => {
    const a = ctx.arr(0);
    const i = Math.round(ctx.numArg(1, 0));
    return i >= 0 && i < a.items.length ? (a.items.splice(i, 1)[0] ?? NA) : NA;
  },
  "array.first": (ctx) => {
    const a = ctx.arr(0);
    return a.items.length ? (a.items[0] ?? NA) : NA;
  },
  "array.last": (ctx) => {
    const a = ctx.arr(0);
    return a.items.length ? (a.items[a.items.length - 1]! ?? NA) : NA;
  },
  "array.includes": (ctx) => {
    const a = ctx.arr(0);
    const v = ctx.arg(1);
    return a.items.some((x) => eqVal(x, v));
  },
  "array.indexof": (ctx) => {
    const a = ctx.arr(0);
    const v = ctx.arg(1);
    return a.items.findIndex((x) => eqVal(x, v));
  },
  "array.clear": (ctx) => {
    ctx.arr(0).items.length = 0;
    return NA;
  },
  "array.from": (ctx) => {
    const items: V[] = [];
    for (let i = 0; i < ctx.node.args.length; i++) items.push(ctx.arg(i));
    return { __kind: "array", items } as V;
  },
  "array.join": (ctx) => {
    const a = ctx.arr(0);
    const sep = ctx.pos(1) ? String(ctx.vm.evalPublic(ctx.pos(1)!, ctx.scope) ?? "") : ",";
    return a.items.map((v) => (v === null || v === undefined ? "na" : String(typeof v === "object" && "css" in v ? (v as PineColor).css : v))).join(sep);
  },
  "array.sum": (ctx) => {
    const a = ctx.arr(0);
    let sum = 0;
    for (const v of a.items) sum += num(v);
    return sum;
  },

  // ── drawing object constructors ──
  "box.new": (ctx) => {
    const props: Record<string, V> = {
      left: ctx.numArg(0, 0),
      top: ctx.numArg(1, 0),
      right: ctx.numArg(2, 0),
      bottom: ctx.numArg(3, 0),
      bgcolor: toCss(ctx.named("bgcolor") ? ctx.vm.evalPublic(ctx.named("bgcolor")!, ctx.scope) : null) ?? "rgba(0,0,0,0)",
      border_color: toCss(ctx.named("border_color") ? ctx.vm.evalPublic(ctx.named("border_color")!, ctx.scope) : null) ?? "transparent",
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
    };
    return ctx.vm.newDrawing("line", props);
  },
  "linefill.new": (ctx) => {
    const a = ctx.vm.evalPublic(ctx.pos(0)!, ctx.scope);
    const b = ctx.vm.evalPublic(ctx.pos(1)!, ctx.scope);
    const color = toCss(ctx.vm.evalPublic(ctx.pos(2)!, ctx.scope)) ?? "transparent";
    return {
      __kind: "linefill",
      props: { a: isObjectV(a) ? a : null, b: isObjectV(b) ? b : null, color },
      deleted: false,
    } as V;
  },

  // ── session/time detection ──
  "time": (ctx) => {
    // time(timeframe, session, timezone) → bar time when in session
    const sessionE = ctx.pos(1);
    if (!sessionE) return NA;
    const sessionStr = String(ctx.vm.evalPublic(sessionE, ctx.scope) ?? "");
    if (!sessionStr) return NA;
    const m = sessionStr.match(/^(\\d{4})-(\\d{4})(?::([0-7]+))?$/);
    if (!m) return NA;
    const start = Number(m[1]!.slice(0, 2)) * 60 + Number(m[1]!.slice(2));
    const end = Number(m[2]!.slice(0, 2)) * 60 + Number(m[2]!.slice(2));
    const days = m[3] ? m[3]!.split("").map(Number) : [1, 2, 3, 4, 5, 6, 7];
    const tz = ctx.pos(2) ? String(ctx.vm.evalPublic(ctx.pos(2)!, ctx.scope) ?? "Exchange") : "Exchange";
    const timeMs = num(ctx.vm.candleAt(ctx.vm.currentBar, "time"));
    const localMin = tzMinutesUTC(tz === "Exchange" ? "UTC" : tz, timeMs);
    // Pine day digits: 1 = Sunday … 7 = Saturday
    const dow = (() => {
      const d = new Date(timeMs);
      const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz === "Exchange" ? "UTC" : tz, weekday: "short" });
      const map: Record<string, number> = { Sun: 1, Mon: 2, Tue: 3, Wed: 4, Thu: 5, Fri: 6, Sat: 7 };
      return map[fmt.formatToParts(new Date(timeMs)).find((p) => p.type === "weekday")?.value ?? "Sun"] ?? 1;
    })();
    void d;
    if (!days.includes(dow)) return NA;
    const inS = start <= end ? localMin >= start && localMin < end : localMin >= start || localMin < end;
    return inS ? timeMs : NA;
  },

  "timeframe.change": (ctx) => {
    const tf = ctx.pos(0) ? String(ctx.vm.evalPublic(ctx.pos(0)!, ctx.scope) ?? "") : "D";
    const sec = tfSecondsOf(tf === "" ? ctx.vm.chartInfo.timeframe : tf);
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
    if (fmt === "mintick") return (num(v) as number).toFixed(ctx.vm.chartInfo.precisionDigits);
    if (isNa(v)) return "na";
    if (typeof v === "boolean") return v ? "true" : "false";
    return String(v);
  },
  "str.tonumber": (ctx) => num(ctx.vm.evalPublic(ctx.pos(0)!, ctx.scope)),
  "runtime.error": (ctx) => {
    const msg = ctx.vm.evalPublic(ctx.pos(0)!, ctx.scope);
    throw new PineRuntimeError(String(msg ?? "runtime.error"), ctx.node.line);
  },

  // ── graceful no-ops (no visual in this subset) ──
  "alertcondition": () => NA,"""
assert old in s, "builtins"
s = s.replace(old, new)

# 3. BuiltinCtx gains arr helper — extend the interface + dispatch ctx
old = """  hist(e: Expr): { at: (back: number) => V; len: number };
  state(key: string): V[];
}"""
new = """  hist(e: Expr): { at: (back: number) => V; len: number };
  state(key: string): V[];
  /** The array argument at the given positional index. */
  arr(i: number): PineObject & { items: V[] };
}"""
assert old in s, "ctx arr"
s = s.replace(old, new)

old = """      hist: (e: Expr) => seriesHistOf(this, e, scope),
      state: (key: string) => this.stateArray(node.id + ":" + key),
    });
    const out: V = result === undefined ? NA : result;"""
new = """      hist: (e: Expr) => seriesHistOf(this, e, scope),
      state: (key: string) => this.stateArray(node.id + ":" + key),
      arr: (i: number) => {
        const e = node.args.filter((a) => a.name === null)[i]?.expr;
        const v = e ? this.eval(e, scope, nsId) : NA;
        if (!isArrV(v)) throw new PineRuntimeError("Expected an array argument", node.line);
        return v;
      },
    });
    const out: V = result === undefined ? NA : result;"""
assert old in s, "ctx arr impl"
s = s.replace(old, new)

# 4. the drawing-method dispatch ctx also gains arr (uniform)
old = """      hist: (e: Expr) => seriesHistOf(this, e, scope),
      state: (key: string) => this.stateArray(node.id + ":" + key),
      obj: target,
    });
    buf.cur = v;
    return v;
  }"""
new = """      hist: (e: Expr) => seriesHistOf(this, e, scope),
      state: (key: string) => this.stateArray(node.id + ":" + key),
      arr: (i: number) => {
        const e = node.args.filter((a) => a.name === null)[i]?.expr;
        const v = e ? this.eval(e, scope, nsId) : NA;
        if (!isArrV(v)) throw new PineRuntimeError("Expected an array argument", node.line);
        return v;
      },
      obj: target,
    });
    buf.cur = v;
    return v;
  }"""
assert old in s, "drawing ctx arr"
s = s.replace(old, new)

# 5. chartInfo setChartInfo already exists ✓; tzMinutesUTC helper
old = """/** Methods on drawing objects — mutate/read their props in place. */"""
new = """/** Local minutes-of-day in `tz` for a UTC epoch-ms instant (DST-aware). */
const tzFmtCache = new Map<string, Intl.DateTimeFormat>();
function tzMinutesUTC(tz: string, timeMs: number): number {
  let fmt = tzFmtCache.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "numeric", hourCycle: "h23" });
    tzFmtCache.set(tz, fmt);
  }
  const parts = fmt.formatToParts(new Date(timeMs));
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m - 720 + 720;
}

/** Methods on drawing objects — mutate/read their props in place. */"""
assert old in s, "tz helper"
s = s.replace(old, new)

io.open(p, "w", encoding="utf-8", newline="\n").write(s)
print("E ok")
