/**
 * Pine Script engine — public API for the editor and the chart.
 *
 *   compile(code)          → { ok, script } | { ok:false, error:{line,message} }
 *   script.run(candles)    → PineResult (plots/hlines/inputs) — incremental;
 *                            call repeatedly as candles stream in.
 *
 * Scripts are sandboxed: the interpreter walks our own AST with an ops
 * budget, no eval, no access to page globals.
 */
import { PineError } from "./errors";
import { parse } from "./parser";
import { PineVM, type PineInputDecl } from "./runtime";

export interface CompiledScript {
  vm: PineVM;
  title: string;
  overlay: boolean;
  precision: number | null;
  inputs: PineInputDecl[];
}

export interface PineCompileError {
  line: number;
  message: string;
}

export type CompileOutcome = { ok: true; script: CompiledScript } | { ok: false; error: PineCompileError };

export function compile(code: string): CompileOutcome {
  try {
    const program = parse(code);
    const vm = new PineVM(program);
    const header = vm.header;
    return {
      ok: true,
      script: {
        vm,
        title: header.title,
        overlay: header.overlay,
        precision: header.precision,
        inputs: vm.result().inputs,
      },
    };
  } catch (err) {
    if (err instanceof PineError) {
      return { ok: false, error: { line: err.line, message: err.message } };
    }
    return { ok: false, error: { line: 1, message: err instanceof Error ? err.message : "Compile failed" } };
  }
}

export type { PineResult, PinePlot, PineHline, PineInputDecl } from "./runtime";
export { PineVM } from "./runtime";
export { PineError } from "./errors";
