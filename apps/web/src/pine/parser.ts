/**
 * Pine Script v5 parser (subset) — token stream → AST.
 *
 * Supports: indicator()/strategy() headers, var/varip declarations (with
 * optional type prefixes), tuple destructuring `[a, b] = ...`, compound
 * assignment ops, user functions `f(x) => ...`, if/else statements AND
 * if-expressions (Pine's block-value form), bounded for loops, ternaries,
 * history indexing `x[3]`, calls with named args, and dotted names
 * (ta.sma / math.abs / plot.style_line / color.new …).
 *
 * Every history-capable expression node gets a stable `id` — the runtime
 * keys its per-bar value buffers by it (this is what makes `expr[k]` and
 * stateful builtins work, including inside user functions).
 */
import { PineError } from "./errors";
import { tokenize, type Token } from "./lexer";

let nodeIdSeq = 0;
export function nextNodeId(): number {
  return ++nodeIdSeq;
}

export type Expr =
  | { kind: "num"; value: number; id: number; line: number }
  | { kind: "str"; value: string; id: number; line: number }
  | { kind: "colorLit"; value: string; id: number; line: number }
  | { kind: "bool"; value: boolean; id: number; line: number }
  | { kind: "na"; id: number; line: number }
  | { kind: "ident"; name: string; id: number; line: number }
  | { kind: "call"; callee: string; args: Arg[]; id: number; line: number }
  | { kind: "bin"; op: string; left: Expr; right: Expr; id: number; line: number }
  | { kind: "un"; op: string; operand: Expr; id: number; line: number }
  | { kind: "ternary"; cond: Expr; then: Expr; else: Expr; id: number; line: number }
  | { kind: "index"; target: Expr; k: Expr; id: number; line: number }
  | { kind: "ifExpr"; branches: { cond: Expr; body: Stmt[] }[]; elseBody: Stmt[]; id: number; line: number };

export interface Arg {
  name: string | null;
  expr: Expr;
}

export type Stmt =
  | { kind: "varDecl"; name: string; expr: Expr; isVar: boolean; typeAnn: string | null; line: number }
  | { kind: "assign"; name: string; op: string; expr: Expr; line: number }
  | { kind: "tupleDecl"; names: string[]; expr: Expr; line: number }
  | { kind: "ifStmt"; branches: { cond: Expr; body: Stmt[] }[]; elseBody: Stmt[]; line: number }
  | { kind: "forStmt"; varName: string; from: Expr; to: Expr; by: Expr | null; body: Stmt[]; line: number }
  | { kind: "forInStmt"; varName: string; iter: Expr; body: Stmt[]; line: number }
  | { kind: "whileStmt"; cond: Expr; body: Stmt[]; line: number }
  | { kind: "funcDecl"; name: string; params: string[]; body: Stmt[]; line: number }
  | { kind: "methodDecl"; name: string; typeName: string; params: string[]; body: Stmt[]; line: number }
  | { kind: "typeDecl"; name: string; fields: string[]; line: number }
  | { kind: "exprStmt"; expr: Expr; line: number }
  | { kind: "break"; line: number }
  | { kind: "continue"; line: number }
  | { kind: "indicator"; title: string; overlay: boolean; precision: number | null; line: number }
  | { kind: "strategyDecl"; line: number };

export interface Program {
  header: { title: string; overlay: boolean; precision: number | null; line: number } | null;
  body: Stmt[];
}

const TYPE_KEYWORDS = new Set(["float", "int", "bool", "color", "string", "simple", "series", "const"]);
const UNSUPPORTED = new Set(["import", "export", "strategy", "request", "matrix", "map", "class", "enum", "alert"]);

export class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)]!;
  }
  private at(type: Token["type"], value?: string): boolean {
    const t = this.peek();
    return t.type === type && (value === undefined || t.value === value);
  }
  private next(): Token {
    return this.tokens[this.pos++]!;
  }
  private expect(type: Token["type"], value?: string): Token {
    const t = this.peek();
    if (t.type !== type || (value !== undefined && t.value !== value)) {
      throw new PineError(`Expected ${value ?? type}, got "${t.value || t.type}"`, t.line);
    }
    return this.next();
  }
  private skipNewlines(): void {
    while (this.at("newline")) this.next();
  }

  parseProgram(): Program {
    const body: Stmt[] = [];
    let header: Program["header"] = null;
    this.skipNewlines();
    while (!this.at("eof")) {
      const stmt = this.parseStatement();
      if (!stmt) continue; // blank/comment-only line
      // indicator()/strategy() header must be the first meaningful statement
      if (stmt.kind === "indicator") {
        if (header || body.length > 0) throw new PineError("indicator() must be the first statement", stmt.line);
        header = { title: stmt.title, overlay: stmt.overlay, precision: stmt.precision, line: stmt.line };
        this.skipNewlines();
        continue;
      }
      if (stmt.kind === "strategyDecl") {
        throw new PineError("Strategies are not supported — write an indicator() script", stmt.line);
      }
      body.push(stmt);
      this.skipNewlines();
    }
    return { header, body };
  }

  /** One logical statement (consumes its trailing newline). */
  private parseStatement(): Stmt | null {
    if (this.at("newline")) {
      this.next();
      return null;
    }
    if (this.at("indent") || this.at("dedent")) {
      this.next();
      return null;
    }

    const t = this.peek();

    if (t.type === "ident") {
      // Unsupported constructs → explicit, friendly errors
      if (UNSUPPORTED.has(t.value)) {
        const what = t.value;
        throw new PineError(
          `"${what}" is not supported in this Pine subset` +
            (what === "strategy" ? " — write an indicator() script" : ""),
          t.line
        );
      }
      // var / varip declaration (optional type annotation)
      if (t.value === "var" || t.value === "varip") {
        const isVar = t.value === "var" || t.value === "varip";
        this.next();
        const line = this.peek().line;
        const { name, typeAnn } = this.parseDeclHead();
        this.expect("op", "=");
        const expr = this.parseExpr();
        this.consumeEos();
        return { kind: "varDecl", name, expr, isVar, typeAnn, line };
      }
      // Typed declaration: float x = / series float x = / int x =
      if (TYPE_KEYWORDS.has(t.value) && this.peek(1).type === "ident" && this.peek(2).type === "op" && this.peek(2).value === "=") {
        const typeAnn = t.value;
        this.next();
        const line = this.peek().line;
        const name = this.expect("ident").value;
        this.expect("op", "=");
        const expr = this.parseExpr();
        this.consumeEos();
        return { kind: "varDecl", name, expr, isVar: false, typeAnn, line };
      }
      if (t.value === "if") return this.parseIfStatement();
      if (t.value === "for") return this.parseForStatement();
      if (t.value === "type") return this.parseTypeDecl();
      if (t.value === "method") return this.parseMethodDecl();
      if (t.value === "while") return this.parseWhileStatement();
      // Generic type declaration: array<SessionInfo> infos = …
      if (this.peek(1).type === "op" && this.peek(1).value === "<") {
        const declEnd = this.findGenericDeclEnd();
        if (declEnd >= 0) return this.parseGenericDecl();
      }
      if (t.value === "break" && this.peek(1).type === "newline") {
        this.next();
        this.consumeEos();
        return { kind: "break", line: t.line };
      }
      if (t.value === "continue" && this.peek(1).type === "newline") {
        this.next();
        this.consumeEos();
        return { kind: "continue", line: t.line };
      }
      // User function: name(params) =>
      if (
        this.peek(1).type === "op" &&
        this.peek(1).value === "(" &&
        this.findMatchingParen(1) >= 0 &&
        this.tokens[this.findMatchingParen(1) + 1]?.type === "op" &&
        this.tokens[this.findMatchingParen(1) + 1]!.value === "=>"
      ) {
        return this.parseFuncDecl();
      }
    }

    // Tuple destructuring: [a, b] = expr
    if (t.type === "op" && t.value === "[") {
      const save = this.pos;
      this.next();
      const names: string[] = [];
      for (;;) {
        if (this.at("ident")) names.push(this.next().value);
        else if (this.at("op", "_")) names.push(this.next().value);
        else throw new PineError("Tuple destructuring expects names", this.peek().line);
        if (this.at("op", ",")) {
          this.next();
          continue;
        }
        break;
      }
      this.expect("op", "]");
      const eq = this.peek();
      if (eq.type === "op" && eq.value === "=") {
        this.next();
        const line = eq.line;
        const expr = this.parseExpr();
        this.consumeEos();
        return { kind: "tupleDecl", names, expr, line };
      }
      // Not a destructuring after all — rewind and parse as expression
      this.pos = save;
    }

    // Dotted assignment: this.active := value / obj.count += value
    if (t.type === "ident") {
      let i = this.pos;
      let sawDot = false;
      while (i < this.tokens.length) {
        const tk = this.tokens[i]!;
        if (tk.type === "ident") { i++; continue; }
        if (tk.type === "op" && tk.value === "." && !sawDot) { sawDot = true; i++; continue; }
        if (tk.type === "op" && [":=", "=", "+=", "-=", "*=", "/=", "%="].includes(tk.value) && sawDot) {
          const nameEnd = i;
          const nameParts: string[] = [this.tokens[this.pos]!.value];
          for (let j = this.pos + 1; j < nameEnd; j++) {
            if (this.tokens[j]!.value === "." ) continue;
            nameParts.push(this.tokens[j]!.value);
          }
          this.pos = nameEnd + 1;
          const expr = this.parseExpr();
          this.consumeEos();
          const op = this.tokens[nameEnd]!.value;
          const dottedName = nameParts.join(".");
          if (expr.kind === "ifExpr") {
            return this.desugarIfAssign(dottedName, expr, op, t.line);
          }
          if (op === "=") return { kind: "varDecl", name: dottedName, expr, isVar: false, typeAnn: null, line: t.line };
          return { kind: "assign", name: dottedName, op, expr, line: t.line };
        }
        break;
      }
    }

    // Assignment (incl. compound ops) vs expression statement: parse an
    // expression; if it is a bare identifier followed by an assignment op,
    // it is an assignment.
    if (
      t.type === "ident" &&
      this.peek(1).type === "op" &&
      [":=", "=", "+=", "-=", "*=", "/=", "%="].includes(this.peek(1).value)
    ) {
      const name = this.next().value;
      const opTok = this.next();
      const expr = this.parseExpr();
      this.consumeEos();
      const isIfBlock = expr.kind === "ifExpr";
      if (isIfBlock) {
        // x = if … block-value form — desugar into an ifStmt that assigns
        return this.desugarIfAssign(name, expr, opTok.value === "=" ? "=" : opTok.value, t.line);
      }
      if (opTok.value === "=") {
        return { kind: "varDecl", name, expr, isVar: false, typeAnn: null, line: t.line };
      }
      return { kind: "assign", name, op: opTok.value, expr, line: t.line };
    }

    // Expression statement (plot/hline/etc.)
    const expr = this.parseExpr();
    this.consumeEos();
    // indicator()/strategy() headers arrive as plain calls — classify them.
    if (expr.kind === "call" && expr.callee === "indicator") {
      const titleArg = expr.args.find((a) => a.name === null && a.expr.kind === "str");
      const overlayArg = expr.args.find((a) => a.name === "overlay");
      const precisionArg = expr.args.find((a) => a.name === "precision");
      return {
        kind: "indicator",
        title: titleArg && titleArg.expr.kind === "str" ? titleArg.expr.value : "Untitled",
        overlay: overlayArg?.expr.kind === "bool" ? overlayArg.expr.value : false,
        precision: precisionArg?.expr.kind === "num" ? precisionArg.expr.value : null,
        line: expr.line,
      };
    }
    if (expr.kind === "call" && (expr.callee === "strategy" || expr.callee.startsWith("strategy."))) {
      return { kind: "strategyDecl", line: expr.line };
    }
    return { kind: "exprStmt", expr, line: expr.line };
  }

  private desugarIfAssign(name: string, expr: Expr & { kind: "ifExpr" }, op: string, line: number): Stmt {
    const toStmt = (body: Stmt[]): Stmt[] => {
      if (body.length === 0) return [];
      const last = body[body.length - 1]!;
      const out = body.slice(0, -1);
      out.push(
        op === "="
          ? { kind: "varDecl", name, expr: last.kind === "exprStmt" ? last.expr : { kind: "na", id: nextNodeId(), line }, isVar: false, typeAnn: null, line }
          : { kind: "assign", name, op, expr: last.kind === "exprStmt" ? last.expr : { kind: "na", id: nextNodeId(), line }, line }
      );
      return out;
    };
    return {
      kind: "ifStmt",
      branches: expr.branches.map((b) => ({ cond: b.cond, body: toStmt(b.body) })),
      elseBody: toStmt(expr.elseBody),
      line,
    };
  }

  private parseDeclHead(): { name: string; typeAnn: string | null } {
    // Scan to the '=' at angle/paren depth 0 on this line; the declared name
    // is the LAST identifier before it (covers `var array<T> x = …` and
    // `float x = …` — the type annotation tokens are skipped wholesale).
    let eq = -1;
    let depth = 0;
    for (let i = this.pos; i < this.tokens.length; i++) {
      const t = this.tokens[i]!;
      if (t.type === "op") {
        if (t.value === "<" || t.value === "(" || t.value === "[") depth++;
        else if (t.value === ">" || t.value === ")" || t.value === "]") depth--;
        else if (t.value === "=" && depth === 0) {
          eq = i;
          break;
        }
      } else if (t.type === "newline") break;
    }
    if (eq <= 0 || this.tokens[eq - 1]!.type !== "ident") {
      throw new PineError("Expected a variable name before '='", this.peek().line);
    }
    const name = this.tokens[eq - 1]!.value;
    this.pos = eq;
    return { name, typeAnn: null };
  }

  private parseFuncDecl(): Stmt {
    const name = this.expect("ident").value;
    this.expect("op", "(");
    const params: string[] = [];
    this.skipNewlines();
    while (!this.at("op", ")")) {
      params.push(this.expect("ident").value);
      if (this.at("op", ",")) this.next();
      else break;
    }
    this.expect("op", ")");
    this.expect("op", "=>");
    const line = this.peek().line;
    // Single-expression body or an indented block
    if (this.at("newline")) {
      this.next();
      this.expect("indent");
      const body = this.parseBlock();
      this.consumeEos();
      return { kind: "funcDecl", name, params, body, line };
    }
    const expr = this.parseExpr();
    this.consumeEos();
    return { kind: "funcDecl", name, params, body: [{ kind: "exprStmt", expr, line }], line };
  }

  private parseIfStatement(): Stmt {
    const line = this.expect("ident", "if").line;
    const branches: { cond: Expr; body: Stmt[] }[] = [];
    const cond = this.parseExpr();
    this.consumeEos();
    this.expect("indent");
    branches.push({ cond, body: this.parseBlock() });
    let elseBody: Stmt[] = [];
    // else / else if chains — may appear after a dedent
    for (;;) {
      const save = this.pos;
      this.skipNewlines();
      if (this.at("ident", "else")) {
        this.next();
        if (this.at("ident", "if")) {
          this.next();
          const c2 = this.parseExpr();
          this.consumeEos();
          this.expect("indent");
          branches.push({ cond: c2, body: this.parseBlock() });
          continue;
        }
        this.consumeEos();
        this.expect("indent");
        elseBody = this.parseBlock();
        break;
      }
      this.pos = save;
      break;
    }
    return { kind: "ifStmt", branches, elseBody, line };
  }

  private parseForStatement(): Stmt {
    const line = this.expect("ident", "for").line;
    const varName = this.expect("ident").value;
    // for x in collection  (arrays / iterables)
    if (this.at("ident", "in")) {
      this.next();
      const iter = this.parseExpr();
      this.consumeEos();
      this.expect("indent");
      const body = this.parseBlock();
      return { kind: "forInStmt", varName, iter, body, line };
    }
    this.expect("op", "=");
    const from = this.parseExpr();
    this.expect("ident", "to");
    const to = this.parseExpr();
    let by: Expr | null = null;
    if (this.at("ident", "by")) {
      this.next();
      by = this.parseExpr();
    }
    this.consumeEos();
    this.expect("indent");
    const body = this.parseBlock();
    return { kind: "forStmt", varName, from, to, by, body, line };
  }

  /** Detects `Ident<T…> name =` — returns the index of the `=` or -1. */
  private findGenericDeclEnd(): number {
    let depth = 0;
    for (let i = this.pos + 1; i < this.tokens.length; i++) {
      const tk = this.tokens[i]!;
      if (tk.type === "op" && tk.value === "<") depth++;
      else if (tk.type === "op" && tk.value === ">") {
        depth--;
        if (depth === 0) {
          // `> ident =` → a generic declaration
          if (
            this.tokens[i + 1]!.type === "ident" &&
            this.tokens[i + 2]!.type === "op" &&
            this.tokens[i + 2]!.value === "="
          ) {
            return i + 2;
          }
          return -1;
        }
      } else if (tk.type === "newline") return -1;
    }
    return -1;
  }

  /** Parses `Ident<T> name = expr` — skips the generic params, binds name. */
  private parseGenericDecl(): Stmt {
    const line = this.peek().line;
    // skip through the matching '>'
    let depth = 0;
    while (!this.at("eof")) {
      if (this.at("op", "<")) depth++;
      else if (this.at("op", ">")) {
        depth--;
        if (depth === 0) { this.next(); break; }
      }
      this.next();
    }
    const name = this.expect("ident").value;
    this.expect("op", "=");
    const expr = this.parseExpr();
    this.consumeEos();
    return { kind: "varDecl", name, expr, isVar: false, typeAnn: null, line };
  }

  /** UDT declaration: `type Name` + indented field lines. */
  private parseTypeDecl(): Stmt {
    const line = this.expect("ident", "type").line;
    const name = this.expect("ident").value;
    this.consumeEos();
    this.expect("indent");
    const fields: string[] = [];
    this.skipNewlines();
    while (!this.at("dedent") && !this.at("eof")) {
      // [typeAnnotation] fieldName (= default)?  — one field per line
      const toks: Token[] = [];
      while (!this.at("newline") && !this.at("dedent") && !this.at("eof")) {
        toks.push(this.next());
      }
      const idents = toks.filter((t) => t.type === "ident").map((t) => t.value);
      if (idents.length === 1) fields.push(idents[0]!);
      else if (idents.length >= 2) fields.push(idents[idents.length - 1]!);
      this.consumeEos();
      this.skipNewlines();
    }
    if (this.at("dedent")) this.next();
    this.consumeEos();
    return { kind: "typeDecl", name, fields, line };
  }

  /** `method name(Type this, params…) => body` — a function bound to a UDT. */
  private parseMethodDecl(): Stmt {
    const line = this.expect("ident", "method").line;
    const name = this.expect("ident").value;
    this.expect("op", "(");
    const params: string[] = [];
    let typeName = "";
    this.skipNewlines();
    while (!this.at("op", ")")) {
      // first param carries the bound type: `SessionDisplay this`
      const ptoks: Token[] = [this.next()];
      while (!this.at("op", ",") && !this.at("op", ")")) {
        const t = this.next();
        if (t.type === "ident") ptoks.push(t);
      }
      const pid = ptoks.filter((t) => t.type === "ident").map((t) => t.value);
      if (params.length === 0) {
        typeName = pid.length >= 2 ? pid[0]! : "";
        params.push(pid[pid.length - 1]!);
      } else {
        params.push(pid[pid.length - 1]!);
      }
      if (this.at("op", ",")) this.next();
      else break;
    }
    this.expect("op", ")");
    this.expect("op", "=>");
    if (this.at("newline")) {
      this.next();
      this.expect("indent");
      const body = this.parseBlock();
      this.consumeEos();
      return { kind: "methodDecl", name, typeName, params: ["this", ...params.slice(1)], body, line };
    }
    const expr = this.parseExpr();
    this.consumeEos();
    return {
      kind: "methodDecl",
      name,
      typeName,
      params: ["this", ...params.slice(1)],
      body: [{ kind: "exprStmt", expr, line }],
      line,
    };
  }

  private parseWhileStatement(): Stmt {
    const line = this.expect("ident", "while").line;
    const cond = this.parseExpr();
    this.consumeEos();
    this.expect("indent");
    const body = this.parseBlock();
    return { kind: "whileStmt", cond, body, line };
  }

  /** Statements until the matching DEDENT (or eof). */
  private parseBlock(): Stmt[] {
    const out: Stmt[] = [];
    this.skipNewlines();
    while (!this.at("dedent") && !this.at("eof")) {
      const s = this.parseStatement();
      if (s) out.push(s);
      this.skipNewlines();
    }
    if (this.at("dedent")) this.next();
    return out;
  }

  private consumeEos(): void {
    if (this.at("newline")) this.next();
  }

  /** Index of the ')' matching the '(' at `openOffset` from the cursor. */
  private findMatchingParen(openOffset: number): number {
    let depth = 0;
    for (let i = this.pos + openOffset; i < this.tokens.length; i++) {
      const t = this.tokens[i]!;
      if (t.type !== "op") continue;
      if (t.value === "(") depth++;
      else if (t.value === ")") {
        depth--;
        if (depth === 0) return i;
      }
    }
    return -1;
  }

  // ── expressions ──────────────────────────────────────────────────────────

  parseExpr(): Expr {
    return this.parseTernary();
  }

  private parseTernary(): Expr {
    const cond = this.parseOr();
    if (this.at("op", "?")) {
      const line = this.next().line;
      const then = this.parseTernary();
      this.expect("op", ":");
      const els = this.parseTernary();
      return { kind: "ternary", cond, then, else: els, id: nextNodeId(), line };
    }
    // Pine's block if-expression:  x = if cond … else …
    if (this.at("ident", "if")) {
      const line = this.next().line;
      const branches: { cond: Expr; body: Stmt[] }[] = [];
      const c = this.parseExpr();
      this.consumeEos();
      this.expect("indent");
      branches.push({ cond: c, body: this.parseBlock() });
      let elseBody: Stmt[] = [];
      for (;;) {
        const save = this.pos;
        this.skipNewlines();
        if (this.at("ident", "else")) {
          this.next();
          if (this.at("ident", "if")) {
            this.next();
            const c2 = this.parseExpr();
            this.consumeEos();
            this.expect("indent");
            branches.push({ cond: c2, body: this.parseBlock() });
            continue;
          }
          this.consumeEos();
          this.expect("indent");
          elseBody = this.parseBlock();
          break;
        }
        this.pos = save;
        break;
      }
      return { kind: "ifExpr", branches, elseBody, id: nextNodeId(), line };
    }
    return cond;
  }

  private parseOr(): Expr {
    let left = this.parseAnd();
    while (this.at("ident", "or")) {
      const line = this.next().line;
      const right = this.parseAnd();
      left = { kind: "bin", op: "or", left, right, id: nextNodeId(), line };
    }
    return left;
  }

  private parseAnd(): Expr {
    let left = this.parseNot();
    while (this.at("ident", "and")) {
      const line = this.next().line;
      const right = this.parseNot();
      left = { kind: "bin", op: "and", left, right, id: nextNodeId(), line };
    }
    return left;
  }

  private parseNot(): Expr {
    if (this.at("ident", "not")) {
      const line = this.next().line;
      const operand = this.parseNot();
      return { kind: "un", op: "not", operand, id: nextNodeId(), line };
    }
    return this.parseComparison();
  }

  private parseComparison(): Expr {
    const left = this.parseAdd();
    const t = this.peek();
    if (t.type === "op" && ["==", "!=", "<", "<=", ">", ">="].includes(t.value)) {
      this.next();
      const right = this.parseAdd();
      return { kind: "bin", op: t.value, left, right, id: nextNodeId(), line: t.line };
    }
    return left;
  }

  private parseAdd(): Expr {
    let left = this.parseMul();
    for (;;) {
      const t = this.peek();
      if (t.type === "op" && (t.value === "+" || t.value === "-")) {
        this.next();
        const right = this.parseMul();
        left = { kind: "bin", op: t.value, left, right, id: nextNodeId(), line: t.line };
      } else break;
    }
    return left;
  }

  private parseMul(): Expr {
    let left = this.parseUnary();
    for (;;) {
      const t = this.peek();
      if (t.type === "op" && (t.value === "*" || t.value === "/" || t.value === "%")) {
        this.next();
        const right = this.parseUnary();
        left = { kind: "bin", op: t.value, left, right, id: nextNodeId(), line: t.line };
      } else break;
    }
    return left;
  }

  private parseUnary(): Expr {
    const t = this.peek();
    if (t.type === "op" && (t.value === "-" || t.value === "+")) {
      this.next();
      const operand = this.parseUnary();
      return { kind: "un", op: t.value, operand, id: nextNodeId(), line: t.line };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): Expr {
    let node = this.parsePrimary();
    for (;;) {
      if (this.at("op", "[")) {
        const line = this.next().line;
        const k = this.parseExpr();
        this.expect("op", "]");
        node = { kind: "index", target: node, k, id: nextNodeId(), line };
      } else break;
    }
    return node;
  }

  private parsePrimary(): Expr {
    const t = this.peek();
    const line = t.line;
    if (t.type === "number") {
      this.next();
      return { kind: "num", value: Number(t.value), id: nextNodeId(), line };
    }
    if (t.type === "string") {
      this.next();
      return { kind: "str", value: t.value, id: nextNodeId(), line };
    }
    if (t.type === "color") {
      this.next();
      return { kind: "colorLit", value: t.value, id: nextNodeId(), line };
    }
    if (t.type === "ident") {
      if (t.value === "true" || t.value === "false") {
        this.next();
        return { kind: "bool", value: t.value === "true", id: nextNodeId(), line };
      }
      // na() with arguments = the nz-style function; bare na = the literal
      if (t.value === "na" && this.peek(1).type === "op" && this.peek(1).value === "(") {
        this.next();
        return this.parseCall("na", line);
      }
      if (t.value === "na") {
        this.next();
        return { kind: "na", id: nextNodeId(), line };
      }
      // Dotted name: ta.sma, math.abs, plot.style_line, color.new …
      let name = t.value;
      this.next();
      while (this.at("op", ".") && this.peek(1).type === "ident") {
        this.next();
        name += "." + this.next().value;
      }
      // Generic type parameters: array.new<string>(…) / array<T> — skip when
      // a matching '>' is directly followed by '(' (a call).
      if (this.at("op", "<")) {
        const save = this.pos;
        this.next();
        let depth = 1;
        let genericCall = false;
        while (!this.at("eof") && depth > 0) {
          const gt = this.next();
          if (gt.type === "op" && gt.value === "<") depth++;
          else if (gt.type === "op" && gt.value === ">") {
            depth--;
            if (depth === 0) {
              genericCall = this.at("op", "(");
              break;
            }
          }
        }
        if (!genericCall) this.pos = save;
        else if (this.at("op", "(")) {
          return this.parseCall(name, line);
        } else {
          return { kind: "ident", name, id: nextNodeId(), line };
        }
      }
      if (this.at("op", "(")) {
        return this.parseCall(name, line);
      }
      return { kind: "ident", name, id: nextNodeId(), line };
    }
    if (t.type === "op" && t.value === "(") {
      this.next();
      const e = this.parseExpr();
      this.expect("op", ")");
      return e;
    }
    throw new PineError(`Unexpected "${t.value || t.type}"`, line);
  }

  private parseCall(callee: string, line: number): Expr {
    this.expect("op", "(");
    const args: Arg[] = [];
    this.skipNewlines();
    while (!this.at("op", ")")) {
      // Named arg: ident '=' expr
      if (
        this.peek().type === "ident" &&
        this.peek(1).type === "op" &&
        this.peek(1).value === "=" &&
        !["and", "or", "not", "to", "by", "if", "else", "for"].includes(this.peek().value)
      ) {
        const name = this.next().value;
        this.next();
        args.push({ name, expr: this.parseExpr() });
      } else {
        args.push({ name: null, expr: this.parseExpr() });
      }
      this.skipNewlines();
      if (this.at("op", ",")) {
        this.next();
        this.skipNewlines();
        continue;
      }
      break;
    }
    this.expect("op", ")");
    return { kind: "call", callee, args, id: nextNodeId(), line };
  }
}

/** One combined error listing every unsupported feature and its first line. */
function unsupportedScanError(tokens: Token[]): PineError | null {
  const first: Array<{ feature: string; line: number }> = [];
  const seen = new Set<string>();
  for (const t of tokens) {
    if (t.type !== "ident" || !UNSUPPORTED.has(t.value)) continue;
    if (!seen.has(t.value)) {
      seen.add(t.value);
      first.push({ feature: t.value, line: t.line });
    }
  }
  if (first.length === 0) return null;
  const list = first.map((f) => `"${f.feature}" (line ${f.line})`).join(", ");
  return new PineError(
    `This script needs Pine features this editor doesn't support: ${list}. ` +
      `Scripts with data feeds (request.*) or strategies can't run here.`,
    first[0]!.line
  );
}

/** input.session used through a dotted call — detected in the token scan. */
function inputSessionLine(tokens: Token[]): number | null {
  for (let i = 0; i < tokens.length - 2; i++) {
    if (
      tokens[i]!.type === "ident" &&
      tokens[i]!.value === "input" &&
      tokens[i + 1]!.type === "op" &&
      tokens[i + 1]!.value === "." &&
      tokens[i + 2]!.type === "ident" &&
      tokens[i + 2]!.value === "session"
    ) {
      return tokens[i]!.line;
    }
  }
  return null;
}

export function parse(src: string): Program {
  const tokens = tokenize(src);
  // Friendly combined error for scripts beyond the subset (list EVERY
  // unsupported feature with its line — one-at-a-time errors are useless).
  const scanErr = unsupportedScanError(tokens);
  if (scanErr) throw scanErr;
  const parser = new Parser(tokens);
  return parser.parseProgram();
}
