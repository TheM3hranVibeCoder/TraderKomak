import io

p = "pine/runtime.ts"
s = io.open(p, encoding="utf-8").read()

# B1. VM registries: UDT types, drawing objects, chart info
old = """  private userFns = new Map<string, { params: string[]; body: Stmt[] }>();
  private plots: PlotChannel[] = [];
  private hlines: PineHline[] = [];"""
new = """  private userFns = new Map<string, { params: string[]; body: Stmt[] }>();
  /** UDT registry: typeDecl declares fields, methodDecl binds methods. */
  private types = new Map<string, { fields: string[]; methods: Map<string, { params: string[]; body: Stmt[] }> }>();
  /** Drawing objects (box/label/line/linefill) — references mutated by the
   *  script, rendered by the chart overlay. */
  private drawings = new Map<number, PineObject>();
  private nextDrawId = 0;
  /** Chart info for syminfo.* / timeframe.* builtins. */
  private chartInfo = { timeframe: "5", mintick: 0.01, precisionDigits: 2, ticker: "" };
  private plots: PlotChannel[] = [];
  private hlines: PineHline[] = [];"""
assert old in s, "B1 registries"
s = s.replace(old, new)

# B2. setChartInfo + reset clears drawings + drawingObjects()
old = """  setInputValues(values: Record<string, number | boolean | string>): void {
    this.inputValues = { ...values };
  }

  reset(): void {
    this.vars.clear();
    this.nodeBufs.clear();
    this.callNs.clear();
    this.builtinState.clear();
    for (const p of this.plots) p.data = [];
    this.committed = 0;
    this.lastTime = 0;
  }"""
new = """  setInputValues(values: Record<string, number | boolean | string>): void {
    this.inputValues = { ...values };
  }

  /** Chart context for syminfo.* / timeframe.* builtins. */
  setChartInfo(info: { timeframe: string; mintick: number; precisionDigits: number; ticker: string }): void {
    this.chartInfo = info;
  }

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
  }"""
assert old in s, "B2 reset"
s = s.replace(old, new)

# B3. eval ident: dotted field chains on objects (this.sessionBox etc.)
old = """      case "ident": {
        const bi = this.builtinSeries(expr.name);
        if (bi !== undefined) return bi;
        const pal = paletteColor(expr.name);
        if (pal) return pal;
        const stl = styleConst(expr.name);
        if (stl !== undefined) return stl;
        return this.readVar(scope, expr.name);
      }"""
new = """      case "ident": {
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
      }"""
assert old in s, "B3 ident"
s = s.replace(old, new)

# B4. evalCall: dotted method dispatch (UDT methods + drawing object methods)
old = """    if (node.callee === "plot") return this.runPlot(node, scope ?? null, nsId);
    if (node.callee === "hline" || node.callee === "alertcondition") return NA;

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
  }"""
new = """    if (node.callee === "plot") return this.runPlot(node, scope ?? null, nsId);
    if (node.callee === "hline" || node.callee === "alertcondition") return NA;

    // Dotted callees: obj.method(…) — UDT methods and drawing-object methods.
    if (node.callee.includes(".")) {
      const segs = node.callee.split(".");
      const last = segs[segs.length - 1]!;
      const root = this.readVar(scope, segs[0]!);
      if (isObjectV(root)) {
        // walk middle segments as fields
        let target: PineObject = root;
        for (let i = 1; i < segs.length - 1; i++) {
          const f = target.fields?.[segs[i]!] ?? target.props?.[segs[i]!];
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
        const v = positional[i] ? this.eval(positional[i]!.expr, ns!.vars, nsId) : NA;
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

    // drawing-object methods
    const dm = DRAWING_METHODS[target.__kind]?.[method];
    if (!dm) throw new PineRuntimeError(`Unknown method "${method}()" for ${target.__kind}`, node.line);
    const v = dm({
      vm: this,
      node,
      scope,
      nsId,
      pos: (i) => node.args.filter((a) => a.name === null)[i]?.expr ?? null,
      named: (name) => node.args.find((a) => a.name === name)?.expr ?? null,
      numArg: (i, fallback) => {
        const e = node.args.filter((a) => a.name === null)[i]?.expr;
        if (!e) return fallback;
        return num(this.eval(e, scope, nsId));
      },
      hist: (e) => seriesHistOf(this, e, scope),
      state: (key) => this.stateArray(node.id + ":" + key),
      obj: target,
    });
    buf.cur = v;
    return v;
  }

  /** Field-chain resolution for dotted identifiers on objects. */
  private resolvePath(segs: string[], scope: Map<string, SeriesState> | null, nsId: number | null, line: number): V {
    let v = this.readVar(scope, segs[0]!);
    for (let i = 1; i < segs.length; i++) {
      if (!isObjectV(v)) {
        throw new PineRuntimeError(`"${segs.slice(0, i).join(".")}" is not an object`, line);
      }
      v = v.fields?.[segs[i]!] ?? v.props?.[segs[i]!] ?? NA;
    }
    return v;
  }

  /** Assign through a dotted path: this.field := value. */
  private assignPath(segs: string[], value: V, scope: Map<string, SeriesState> | null, line: number): void {
    let target = this.readVar(scope, segs[0]!);
    if (!isObjectV(target)) throw new PineRuntimeError(`"${segs[0]}" is not an object`, line);
    for (let i = 1; i < segs.length - 1; i++) {
      const next = target.fields?.[segs[i]!];
      if (!isObjectV(next)) throw new PineRuntimeError(`"${segs.slice(0, i + 1).join(".")}" is not an object`, line);
      target = next;
    }
    target.fields![segs[segs.length - 1]!] = value;
  }

  /** Creates a drawing object and registers it for the overlay renderer. */
  private newDrawing(kind: "box" | "label" | "line" | "linefill", props: Record<string, V>): PineObject {
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
  }"""
assert old in s, "B4 evalCall"
s = s.replace(old, new)

io.open(p, "w", encoding="utf-8", newline="\n").write(s)
print("B ok")
