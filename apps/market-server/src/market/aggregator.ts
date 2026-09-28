/**
 * Re-export shim — the aggregation engine now lives in @traderkomak/shared
 * (packages/shared/src/aggregator.ts) so the browser chart can build candles
 * with the exact same code when it connects directly to Binance/OANDA.
 *
 * All server modules and tests keep importing from this path.
 */
export {
  CandleAggregator,
  aggregateCandles,
  chainContinuity,
  chainFrom,
  fillGaps,
  type ApplyResult,
} from "@traderkomak/shared";

