/* Test UDT constructor dispatch in isolation. */
import { tokenize } from "./lexer";
import { Parser } from "./parser";
import { PineVM } from "./runtime";

const SRC = [
  'indicator("t", overlay = true)',
  'type SessionInfo',
  '    string session',
  '    string timezone',
  '    float active = na',
  '',
  'var si = SessionInfo.new("0900-1500", "Asia/Tokyo")',
  'plot(si.active)',
].join("\n");

try {
  const tokens = tokenize(SRC);
  const parser = new Parser(tokens);
  const prog = parser.parseProgram();
  console.log("PARSED OK — body statements:", prog.body.length);
  const vm = new PineVM(prog);
  vm.setChartInfo({ timeframe: "5", mintick: 0.01, precisionDigits: 2, ticker: "TEST" });
  const cs = [{ time: Date.UTC(2026, 10, 16, 0, 0) / 1000, open: 100, high: 101, low: 99, close: 100 }];
  vm.run(cs);
  console.log("DONE — no crash");
} catch (err) {
  console.log("ERROR:", (err as Error).message);
}
