/**
 * Symbol icon resolution — returns an image URL for any asset code:
 *   fiat      → country flag (flagcdn)
 *   crypto    → colored coin logo (cryptocurrency-icons via jsDelivr)
 *   metals    → inline SVG coin (gold / silver / platinum / palladium)
 * Returns null when nothing suitable exists; callers fall back to emoji.
 */
export function currencyFlagUrl(currency: string): string | null {
  // Fiat → country flags
  const flags: Record<string, string> = {
    EUR: "eu",
    USD: "us",
    GBP: "gb",
    JPY: "jp",
    CHF: "ch",
    AUD: "au",
    CAD: "ca",
    NZD: "nz",
    // US indices carry the US flag
    SPX500: "us",
    NAS100: "us",
    US30: "us",
    DE30: "de",
    UK100: "gb",
    JP225: "jp",
  };
  const flag = flags[currency];
  if (flag) return `https://flagcdn.com/w20/${flag}.png`;

  // Crypto → colored coin logos
  const crypto: Record<string, string> = {
    BTC: "btc",
    ETH: "eth",
    LTC: "ltc",
    XRP: "xrp",
    BCH: "bch",
    ADA: "ada",
    SOL: "sol",
    DOGE: "doge",
    BNB: "bnb",
    DOT: "dot",
    LINK: "link",
    AVAX: "avax",
    // Stablecoin quotes (Binance pairs)
    USDT: "usdt",
    USDC: "usdc",
    BUSD: "busd",
    TUSD: "tusd",
    FDUSD: "first-digital-usd",
  };
  const id = crypto[currency];
  if (id) {
    return `https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/svg/color/${id}.svg`;
  }

  // Precious metals → inline SVG coins
  const metal = METAL_COINS[currency];
  if (metal) return svgDataUri(metal);

  return null;
}

function svgDataUri(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function metalCoin(symbol: string, outer: string, inner: string, textFill: string): string {
  return (
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>` +
    `<circle cx='16' cy='16' r='16' fill='${outer}'/>` +
    `<circle cx='16' cy='16' r='12.5' fill='${inner}'/>` +
    `<text x='16' y='20.5' font-family='Arial,Helvetica,sans-serif' font-size='11' ` +
    `font-weight='bold' fill='${textFill}' text-anchor='middle'>${symbol}</text>` +
    `</svg>`
  );
}

const METAL_COINS: Record<string, string> = {
  XAU: metalCoin("Au", "#B8860B", "#F5C542", "#7A5800"),
  XAG: metalCoin("Ag", "#8C9BAB", "#D7DFE8", "#4E5A66"),
  XPT: metalCoin("Pt", "#7B8794", "#C6CFD8", "#3E4750"),
  XPD: metalCoin("Pd", "#6E6E6E", "#B5B5B5", "#3A3A3A"),
};

/** Emoji fallback for codes without a proper icon (oil, etc.). */
export function commodityIcon(currency: string): string | null {
  const map: Record<string, string> = {
    BCO: "🛢️",
    WTICO: "🛢️",
    NATGAS: "🔥",
    CORN: "🌽",
    WHEAT: "🌾",
    SUGAR: "🍬",
  };
  return map[currency] ?? null;
}

export function instrumentFlags(instrument: string): { base: string | null; quote: string | null; baseUrl: string | null; quoteUrl: string | null } {
  const [base, quote] = instrument.split("_");
  return {
    base: base ?? null,
    quote: quote ?? null,
    baseUrl: base ? currencyFlagUrl(base) : null,
    quoteUrl: quote ? currencyFlagUrl(quote) : null,
  };
}
