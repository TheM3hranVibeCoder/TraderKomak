/**
 * Supported trading instruments across providers.
 *
 * Providers:
 *   • OANDA   — forex/metals/indices, canonical form uses "_"  (EUR_USD)
 *   • Binance — crypto spot,          canonical form concatenated (BTCUSDT)
 *   • cTrader — index CFDs not covered by OANDA, plain symbol name (US30)
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
  "US30_USD",
  "BTC_USD",
  "ETH_USD",
  // Added user-requested symbols for watchlist search
  "AUD_CHF",
  "EUR_AUD",
  "EUR_CAD",
  "GBP_AUD",
  "GBP_CAD",
  "GBP_NZD",
  "NZD_CAD",
  "NZD_JPY",
  "CHF_JPY",
  "CAD_JPY",
] as const;

/** Binance spot symbols (canonical = concatenated, e.g. BTCUSDT).
 *  Adding a symbol here is all it takes: the watchlist search offers it,
 *  the Binance provider streams it on demand, and the icon layer falls
 *  back to a generated coin mark when no logo is mapped in the web app. */
export const SUPPORTED_BINANCE = [
  // majors
  "BTCUSDT",
  "ETHUSDT",
  "BNBUSDT",
  "SOLUSDT",
  "XRPUSDT",
  "ADAUSDT",
  "DOGEUSDT",
  "UNIUSDT",
  // large caps
  "TRXUSDT",
  "LINKUSDT",
  "AVAXUSDT",
  "DOTUSDT",
  "LTCUSDT",
  "BCHUSDT",
  "ATOMUSDT",
  "XLMUSDT",
  "NEARUSDT",
  "APTUSDT",
  "ARBUSDT",
  "OPUSDT",
  "INJUSDT",
  "SUIUSDT",
  "SEIUSDT",
  "TIAUSDT",
  "FILUSDT",
  "ICPUSDT",
  "ETCUSDT",
  "ALGOUSDT",
  "VETUSDT",
  "HBARUSDT",
  "AAVEUSDT",
  "GRTUSDT",
  "SANDUSDT",
  "MANAUSDT",
  "AXSUSDT",
  "GALAUSDT",
  "CHZUSDT",
  "ENAUSDT",
  "WIFUSDT",
  "BONKUSDT",
  "FLOKIUSDT",
  "JUPUSDT",
  "PYTHUSDT",
  "WLDUSDT",
  "RUNEUSDT",
  "FETUSDT",
  "LDOUSDT",
  "STXUSDT",
  "TONUSDT",
  "CAKEUSDT",
  "IMXUSDT",
  "FLOWUSDT",
  "POLUSDT",
  "EGLDUSDT",
  "CRVUSDT",
  "NEOUSDT",
] as const;

/** Dukascopy bank datafeed symbols (free public data, UTC-based).
 *  Canonical form prefixed "D_" over the OANDA-style pair, e.g. D_XAU_USD
 *  — display strips the prefix, so D_XAU_USD renders as "XAU/USD". */
export const SUPPORTED_DUKASCOPY = [
  "D_EUR_USD",
  "D_GBP_USD",
  "D_USD_JPY",
  "D_XAU_USD",
  "D_XAG_USD",
  "D_BTC_USD",
] as const;

/** cTrader Open API symbols — index CFDs served by the market server
 *  (binary protobuf over TCP + OAuth, so no anonymous browser access).
 *  US30 (Dow Jones) is ALSO available from OANDA as US30_USD, which is the
 *  canonical row the app adds; this cTrader form stays for brokers/accounts
 *  where the OANDA index feed is unavailable. */
export const SUPPORTED_CTRADER = [
  "US30",
] as const;

/** Fiat and metal codes OANDA quotes against each other. Any well-formed
 *  pair of these is a valid instrument (AUD_CAD, EUR_CHF, GBP_CHF, \u2026),
 *  which is what lets search accept minor pairs without a code change. */
export const OANDA_CURRENCIES = [
  "USD", "EUR", "GBP", "JPY", "CHF", "AUD", "CAD", "NZD",
  "SGD", "HKD", "CNH", "MXN", "NOK", "SEK", "DKK", "PLN",
  "CZK", "HUF", "TRY", "ZAR", "THB", "INR", "RUB", "BRL",
  "ILS", "SAR", "AED",
  "XAU", "XAG", "XPT", "XPD",
] as const;

const CURRENCY_SET: ReadonlySet<string> = new Set(OANDA_CURRENCIES);
const METAL_CODES: ReadonlySet<string> = new Set(["XAU", "XAG", "XPT", "XPD"]);
const FIAT_SET: ReadonlySet<string> = new Set(
  OANDA_CURRENCIES.filter((c) => !METAL_CODES.has(c))
);
const OANDA_PAIR_RE = /^[A-Z]{3}_[A-Z]{3}$/;
/** Quote assets that make a concatenated code a Binance spot symbol. */
const BINANCE_QUOTES = ["USDT", "USDC", "FDUSD", "TUSD", "BTC", "ETH", "BNB", "EUR", "TRY", "BRL"] as const;

/** Every symbol the app accepts, any provider. */
export const SEARCHABLE_INSTRUMENTS: readonly string[] = [
  ...SUPPORTED_INSTRUMENTS,
  ...SUPPORTED_BINANCE,
  ...SUPPORTED_DUKASCOPY,
  ...SUPPORTED_CTRADER,
];

const SEARCHABLE_SET: ReadonlySet<string> = new Set(SEARCHABLE_INSTRUMENTS);

/** True for any OANDA pair of quoted currencies: AUD_CAD, EUR_CHF, XAU_EUR \u2026 */
export function isOandaPair(raw: string): boolean {
  const norm = normalizeInstrument(raw);
  return (
    OANDA_PAIR_RE.test(norm) &&
    CURRENCY_SET.has(norm.slice(0, 3)) &&
    CURRENCY_SET.has(norm.slice(4))
  );
}

/** True for a Binance spot symbol (SUIUSDT, PEPEUSDT, \u2026). */
export function isBinancePair(raw: string): boolean {
  const norm = normalizeInstrument(raw);
  if (norm.includes("_") || !/^[A-Z0-9]{4,24}$/.test(norm)) return false;
  return BINANCE_QUOTES.some((q) => norm.length > q.length && norm.endsWith(q));
}

/** Catalogue symbol, or any valid OANDA pair / Binance symbol the providers
 *  can quote on demand. This is the single gate for adding and validating. */
export function isSearchableInstrument(raw: string): boolean {
  const norm = normalizeInstrument(raw);
  return SEARCHABLE_SET.has(norm) || isOandaPair(norm) || isBinancePair(norm);
}

export type Instrument = (typeof SUPPORTED_INSTRUMENTS)[number];
export type BinanceSymbol = (typeof SUPPORTED_BINANCE)[number];
export type AnyInstrument = Instrument | BinanceSymbol;

/** Default instrument used on first load. Configuration, not hard-coding. */
export const DEFAULT_INSTRUMENT: Instrument = "XAU_USD";

export type ProviderId = "oanda" | "binance" | "dukascopy" | "ctrader";

const BINANCE_SET: ReadonlySet<string> = new Set(SUPPORTED_BINANCE);
const DUKASCOPY_SET: ReadonlySet<string> = new Set(SUPPORTED_DUKASCOPY);
const CTRADER_SET: ReadonlySet<string> = new Set(SUPPORTED_CTRADER);

/** Which provider owns a canonical instrument. Unknown → oanda. */
export function providerOf(instrument: string): ProviderId {
  const norm = normalizeInstrument(instrument);
  if (BINANCE_SET.has(norm)) return "binance";
  if (DUKASCOPY_SET.has(norm)) return "dukascopy";
  if (CTRADER_SET.has(norm)) return "ctrader";
  if (isBinancePair(norm)) return "binance";
  return "oanda";
}

/** D_XAU_USD → "XAUUSD" (the datafeed's concatenated symbol). */
export function dukasSymbolOf(instrument: string): string {
  return normalizeInstrument(instrument).replace(/^D_/, "").replace(/_/g, "");
}

const JPY_QUOTE = new Set(["USD_JPY", "EUR_JPY", "GBP_JPY", "AUD_JPY"]);
const METAL = new Set(["XAU_USD", "XAG_USD"]);
/** Stock-index CFDs display 2 decimals everywhere (watchlist rows, chart
 *  price axis, OHLC readout) — 7000.25 / 27500.20, per user request. */
const INDEX = new Set(["SPX500_USD", "NAS100_USD", "US30_USD", "US30"]);
const CRYPTO_MAJOR = new Set(["BTCUSDT", "ETHUSDT", "BNBUSDT"]);
const CRYPTO_MINOR: ReadonlySet<string> = new Set(SUPPORTED_BINANCE.filter((s) => !CRYPTO_MAJOR.has(s)));
/** Sub-cent coins — 4 decimals renders 0.0000; these need 8. */
const CRYPTO_MICRO = new Set(["PEPEUSDT", "SHIBUSDT", "BONKUSDT", "FLOKIUSDT"]);
/** Explicit display precision for OANDA crypto pairs (user-facing request):
 *  BTC 1 decimal, ETH 2 decimals. */
const OANDA_CRYPTO_PRECISION: Record<string, number> = {
  BTC_USD: 1,
  ETH_USD: 2,
};

/** Stock indices display under their bare name — SPX500_USD → "SPX500",
 *  NAS100_USD → "NAS100", US30_USD → "US30" (no quote-currency suffix;
 *  TradingView-style). */
const BARE_NAME_DISPLAY = new Set(["SPX500_USD", "NAS100_USD", "US30_USD"]);

/** Human-friendly display: EUR_USD → "EUR/USD", BTCUSDT → "BTC/USDT". */
export function displayInstrument(instrument: string): string {
  const norm = normalizeInstrument(instrument).replace(/^D_/, "");
  if (BARE_NAME_DISPLAY.has(norm)) return norm.split("_")[0]!;
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
 * - JPY quotes: 3 · metals: 2 · stock indices: 2 (7000.25 / 27500.20)
 * - crypto majors (BTC/ETH/BNB on Binance): 2
 * - smaller caps (SOL/XRP/ADA/DOGE): 4 · everything else: 5
 */
export function instrumentPrecision(instrument: string): number {
  const norm = normalizeInstrument(instrument).replace(/^D_/, "");
  const override = OANDA_CRYPTO_PRECISION[norm];
  if (override !== undefined) return override;
  if (JPY_QUOTE.has(norm) || norm.endsWith("_JPY")) return 3;
  if (METAL.has(norm) || norm.startsWith("XAU_") || norm.startsWith("XAG_")) return 2;
  if (INDEX.has(norm)) return 2;
  if (CRYPTO_MAJOR.has(norm)) return 2;
  if (CRYPTO_MICRO.has(norm)) return 8;
  if (CRYPTO_MINOR.has(norm)) return 4;
  if (isBinancePair(norm)) return 4;
  return 5;
}

function isFinitePricePrecisionJpy(instrument: string): boolean {
  const norm = normalizeInstrument(instrument);
  return JPY_QUOTE.has(norm) || norm.endsWith("_JPY");
}

/**
 * Price distance of one "pip" for the instrument (OANDA-style):
 *   forex 0.0001 · JPY quotes 0.01 · metals 0.01.
 * Crypto / indices / energy have no pip convention — 1.0 (whole point).
 */
export function instrumentPipSize(instrument: string): number {
  const norm = normalizeInstrument(instrument).replace(/^D_/, "");
  if (JPY_QUOTE.has(norm) || norm.endsWith("_JPY")) return 0.01;
  if (METAL.has(norm)) return 0.01;
  if (norm === "BTC_USD" || norm === "ETH_USD" || CRYPTO_MAJOR.has(norm) || CRYPTO_MINOR.has(norm) || CRYPTO_MICRO.has(norm)) return 1;
  if (INDEX.has(norm) || norm === "BCO_USD") return 1;
  if (isBinancePair(norm)) return 1;
  return 0.0001;
}

/** Instruments with a real pip convention (forex pairs only). Gold, silver,
 *  crypto and indices quote in price points — a measure tool on them must
 *  show the raw price difference, not a (huge, meaningless) pip count. */
/** Two fiat currencies against each other (any pair, not a fixed list). */
function isFiatPair(norm: string): boolean {
  return (
    OANDA_PAIR_RE.test(norm) &&
    FIAT_SET.has(norm.slice(0, 3)) &&
    FIAT_SET.has(norm.slice(4))
  );
}

export function usesPips(instrument: string): boolean {
  return isFiatPair(normalizeInstrument(instrument).replace(/^D_/, ""));
}

/** MT5-style pip unit for measurement readouts: forex uses the classic pip
 *  (0.0001; 0.01 for JPY quotes), gold 0.1, silver 0.01, crypto/indices
 *  count whole points (1.0). Distinct from instrumentPipSize, which keeps
 *  the raw instrument precision (gold 0.01) for trading math. */
export function instrumentPipUnit(instrument: string): number {
  const norm = normalizeInstrument(instrument).replace(/^D_/, "");
  if (isFiatPair(norm)) return instrumentPipSize(norm);
  if (norm === "XAU_USD") return 0.1;
  if (norm === "XAG_USD") return 0.01;
  return 1;
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
