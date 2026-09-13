import type { FastifyInstance } from "fastify";
import { decompressBi5, parseMinuteCandles } from "../dukascopy/bi5.js";

/** TEMPORARY diagnostic for the Dukascopy datafeed. Remove after debugging. */
export function registerDukaDebugRoute(app: FastifyInstance): void {
  app.get("/api/duka-debug", async () => {
    const url = "https://datafeed.dukascopy.com/datafeed/XAUUSD/2026/08/11/BID_candles_min_1.bi5";
    const out: Record<string, unknown> = { url };
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      out.status = res.status;
      const buf = Buffer.from(await res.arrayBuffer());
      out.bytes = buf.length;
      if (buf.length > 0) {
        const raw = decompressBi5(buf);
        const candles = parseMinuteCandles(raw);
        out.records = candles.length;
        out.first = candles[0] ?? null;
        out.last = candles.at(-1) ?? null;
      }
    } catch (err) {
      out.error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    }
    return out;
  });
}
