/**
 * Supported trading instruments across providers.
 *
 * Two providers in Phase-B:
 *   • OANDA  — forex/metals/indices, canonical form uses "_"  (EUR_USD)
 *   • Binance — crypto spot,        canonical form concatenated (BTCUSDT)
 *
 * `providerOf()` decides routing everywhere (history, stream, labels);
 * nothing else in the codebase hard-codes a provider.
 */
export const SUPPORTED_INSTRUMENTS = [
  "EUR_USD",
  "GBP_USD",
  "USD_JPY",
  "USD_CHF",
  "AUD_USD",
  "USD_CAD",
  "NZD_USD",
  "EUR_GBP",
  "XAU_USD",
  "XAG_USD",
  "GBP_JPY",
  "EUR_JPY",
  "AUD_JPY",
  "BCO_USD",
  "SPX500_USD",
  "NAS100_USD",
  "BTC_USD",
  "ETH_USD",
] as const;

/** Binance spot symbols (canonical = concatenated, e.g. BTCUSDT). */
export const SUPPORTED_BINANCE = [
  "BTCUSDT",
  "ETHUSDT",
  "BNBUSDT",
  "SOLUSDT",
  "XRPUSDT",
  "ADAUSDT",
  "DOGEUSDT",
] as const;

/** Every symbol the app accepts, any provider. */
export const SEARCHABLE_INSTRUMENTS: readonly string[] = [
  ...SUPPORTED_INSTRUMENTS,
  ...SUPPORTED_BINANCE,
];

export type Instrument = (typeof SUPPORTED_INSTRUMENTS)[number];
export type BinanceSymbol = (typeof SUPPORTED_BINANCE)[number];
export type AnyInstrument = Instrument | BinanceSymbol;

/** Default instrument used on first load. Configuration, not hard-coding. */
export const DEFAULT_INSTRUMENT: Instrument = "EUR_USD";

export type ProviderId = "oanda" | "binance";

const BINANCE_SET: ReadonlySet<string> = new Set(SUPPORTED_BINANCE);

/** Which provider owns a canonical instrument. Unknown → oanda. */
export function providerOf(instrument: string): ProviderId {
  return BINANCE_SET.has(normalizeInstrument(instrument)) ? "binance" : "oanda";
}

const JPY_QUOTE = new Set(["USD_JPY", "EUR_JPY", "GBP_JPY", "AUD_JPY"]);
const METAL = new Set(["XAU_USD", "XAG_USD"]);
const CRYPTO_MAJOR = new Set(["BTCUSDT", "ETHUSDT", "BNBUSDT"]);
const CRYPTO_MINOR = new Set(["SOLUSDT", "XRPUSDT", "ADAUSDT", "DOGEUSDT"]);
/** Explicit display precision for OANDA crypto pairs (user-facing request):
 *  BTC 1 decimal, ETH 2 decimals. */
const OANDA_CRYPTO_PRECISION: Record<string, number> = {
  BTC_USD: 1,
  ETH_USD: 2,
};

/** Human-friendly display: EUR_USD → "EUR/USD", BTCUSDT → "BTC/USDT". */
export function displayInstrument(instrument: string): string {
  const norm = normalizeInstrument(instrument);
  if (!norm.includes("_")) {
    // Crypto: split a known quote suffix off the base
    const quotes = ["USDT", "USDC", "FDUSD", "TUSD"];
    for (const q of quotes) {
      if (norm.endsWith(q) && norm.length > q.length) {
        return `${norm.slice(0, -q.length)}/${q}`;
      }
    }
    return norm;
  }
  return norm.replace("_", "/");
}

/**
 * Price-display precision:
 * - OANDA crypto pairs: BTC 1 · ETH 2 (explicit overrides)
 * - JPY quotes: 3 · metals: 2 · crypto majors (BTC/ETH/BNB on Binance): 2
 * - smaller caps (SOL/XRP/ADA/DOGE): 4 · everything else: 5
 */
export function instrumentPrecision(instrument: string): number {
  const norm = normalizeInstrument(instrument);
  const override = OANDA_CRYPTO_PRECISION[norm];
  if (override !== undefined) return override;
  if (JPY_QUOTE.has(norm)) return 3;
  if (METAL.has(norm)) return 2;
  if (CRYPTO_MAJOR.has(norm)) return 2;
  if (CRYPTO_MINOR.has(norm)) return 4;
  return 5;
}

function isFinitePricePrecisionJpy(instrument: string): boolean {
  return JPY_QUOTE.has(normalizeInstrument(instrument));
}

/**
 * Price distance of one "pip" for the instrument (OANDA-style):
 *   forex 0.0001 · JPY quotes 0.01 · metals 0.01.
 * Crypto / indices / energy have no pip convention — 1.0 (whole point).
 */
export function instrumentPipSize(instrument: string): number {
  const norm = normalizeInstrument(instrument);
  if (JPY_QUOTE.has(norm)) return 0.01;
  if (METAL.has(norm)) return 0.01;
  if (norm === "BTC_USD" || norm === "ETH_USD" || CRYPTO_MAJOR.has(norm) || CRYPTO_MINOR.has(norm)) return 1;
  if (norm === "SPX500_USD" || norm === "NAS100_USD" || norm === "BCO_USD") return 1;
  return 0.0001;
}

/**
 * Normalizes user/provider input to canonical form:
 *   "eur/usd" → EUR_USD      "xauusd" → XAU_USD
 *   "btcusdt" / "btc_usdt" / "BTC-USDT" → BTCUSDT
 *
 * Binance symbols are matched FIRST (concatenated) so they never get an
 * underscore injected; unknown 6-letter codes fall back to the OANDA split.
 */
export function normalizeInstrument(raw: string): string {
  const s = raw
    .trim()
    .toUpperCase()
    .replace(/[/\-.]/g, "_")
    .replace(/\s+/g, "");

  // Direct hit on a Binance symbol
  if (BINANCE_SET.has(s)) return s;

  // Underscored variant of a Binance symbol (BTC_USDT → BTCUSDT)
  if (s.includes("_")) {
    const flat = s.replace(/_/g, "");
    if (BINANCE_SET.has(flat)) return flat;
    return s;
  }

  // Legacy OANDA-style 6-char split (EURUSD → EUR_USD)
  if (s.length === 6) return `${s.slice(0, 3)}_${s.slice(3)}`;
  return s;
}

export { isFinitePricePrecisionJpy };
