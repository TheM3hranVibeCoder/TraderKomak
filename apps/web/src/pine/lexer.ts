/**
 * Pine Script v5 lexer (subset) — Python-style INDENT/DEDENT for block
 * bodies, newline as statement terminator (suppressed inside parentheses
 * and brackets, which is Pine's own line-continuation rule), comments `//`,
 * hex color literals `#RRGGBB[AA]`, strings, and the operator set.
 */
import { PineError } from "./errors";

export type TokenType =
  | "ident"
  | "number"
  | "string"
  | "color"
  | "op"
  | "newline"
  | "indent"
  | "dedent"
  | "eof";

export interface Token {
  type: TokenType;
  value: string;
  line: number;
}

const KEYWORDS = new Set([
  "if",
  "else",
  "for",
  "to",
  "by",
  "var",
  "varip",
  "and",
  "or",
  "not",
  "true",
  "false",
  "na",
  "break",
  "continue",
]);

const OPERATORS = [
  ":=",
  "==",
  "!=",
  "<=",
  ">=",
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
  "?",
  ":",
  "<",
  ">",
  "+",
  "-",
  "*",
  "/",
  "%",
  "=",
  "(",
  ")",
  "[",
  "]",
  ",",
  "=>",
  ".",
];

const OPS_SORTED = [...OPERATORS].sort((a, b) => b.length - a.length);

export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const indents: number[] = [0];
  let parenDepth = 0;

  for (let lineNo = 1; lineNo <= lines.length; lineNo++) {
    const raw = lines[lineNo - 1]!;

    // Line comments can appear anywhere; strip them first (no string-aware
    // subtlety needed — Pine comments run to end of line and # colors never
    // contain //).
    const hashIdx = findCommentStart(raw);
    const line = hashIdx >= 0 ? raw.slice(0, hashIdx) : raw;
    const stripped = line.trimEnd();

    if (stripped.trim().length === 0) {
      if (parenDepth === 0) continue; // blank line — no indent bookkeeping
      continue; // inside a continuation: skip entirely
    }

    const indent = leadingWhitespace(line);
    if (parenDepth === 0) {
      if (indent > indents[indents.length - 1]!) {
        indents.push(indent);
        tokens.push({ type: "indent", value: "", line: lineNo });
      } else {
        while (indent < indents[indents.length - 1]!) {
          indents.pop();
          tokens.push({ type: "dedent", value: "", line: lineNo });
        }
        if (indent !== indents[indents.length - 1]!) {
          throw new PineError("Inconsistent indentation", lineNo);
        }
      }
    }

    // Tokenize the line body
    let i = 0;
    const body = stripped;
    while (i < body.length) {
      const ch = body[i]!;
      if (ch === " " || ch === "\t") {
        i++;
        continue;
      }
      const rest = body.slice(i);

      // String literal
      if (ch === '"' || ch === "'") {
        const quote = ch;
        let j = i + 1;
        let out = "";
        while (j < body.length && body[j] !== quote) {
          if (body[j] === "\\") {
            const next = body[j + 1];
            if (next === "n") out += "\n";
            else if (next === "t") out += "\t";
            else if (next) out += next;
            j += 2;
          } else {
            out += body[j]!;
            j++;
          }
        }
        if (j >= body.length) throw new PineError("Unterminated string", lineNo);
        tokens.push({ type: "string", value: out, line: lineNo });
        i = j + 1;
        continue;
      }

      // Hex color literal (#RGB, #RRGGBB, #RRGGBBAA)
      if (ch === "#" && /^#[0-9a-fA-F]{3,8}\b/.test(rest)) {
        const m = rest.match(/^#[0-9a-fA-F]+/)!;
        tokens.push({ type: "color", value: m[0].toUpperCase(), line: lineNo });
        i += m[0].length;
        continue;
      }

      // Number (int, float, exponent)
      if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(body[i + 1] ?? ""))) {
        const m = rest.match(/^[0-9]*\.?[0-9]+([eE][+-]?[0-9]+)?/);
        if (!m) throw new PineError(`Invalid number near "${rest.slice(0, 6)}"`, lineNo);
        tokens.push({ type: "number", value: m[0], line: lineNo });
        i += m[0].length;
        continue;
      }

      // Identifier (a.b handled via '.' operator; unicode letters allowed)
      if (/[A-Za-z_\u0600-\u06FF]/.test(ch)) {
        const m = rest.match(/^[A-Za-z_\u0600-\u06FF][A-Za-z0-9_\u0600-\u06FF]*/)!;
        tokens.push({ type: "ident", value: m[0], line: lineNo });
        i += m[0].length;
        continue;
      }

      // Operators
      const op = OPS_SORTED.find((o) => rest.startsWith(o));
      if (op) {
        if (op === "(" || op === "[") parenDepth++;
        if (op === ")" || op === "]") parenDepth = Math.max(0, parenDepth - 1);
        tokens.push({ type: "op", value: op, line: lineNo });
        i += op.length;
        continue;
      }

      throw new PineError(`Unexpected character "${ch}"`, lineNo);
    }

    if (parenDepth === 0) {
      tokens.push({ type: "newline", value: "", line: lineNo });
    }
  }

  // Close any open blocks
  while (indents.length > 1) {
    indents.pop();
    tokens.push({ type: "dedent", value: "", line: lines.length });
  }
  tokens.push({ type: "eof", value: "", line: lines.length });
  return tokens;
}

/** `//` starts a comment (unless inside a string — handled by the caller's
 *  simple slice: find the first `//` not preceded by an unclosed quote). */
function findCommentStart(line: string): number {
  let inStr: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inStr) {
      if (ch === "\\") i++;
      else if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'") inStr = ch;
    else if (ch === "/" && line[i + 1] === "/") return i;
  }
  return -1;
}

function leadingWhitespace(line: string): number {
  let n = 0;
  for (const ch of line) {
    if (ch === "\t") n += 4;
    else if (ch === " ") n += 1;
    else break;
  }
  return n;
}

export function isKeyword(tok: Token): boolean {
  return tok.type === "ident" && KEYWORDS.has(tok.value);
}
