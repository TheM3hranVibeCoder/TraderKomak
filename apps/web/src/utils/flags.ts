/**
 * Symbol icon resolution — returns an image URL for any asset code:
 *   fiat      → country flag   → /icons/flags/<cc>.png
 *   crypto    → colored coin   → /icons/coins/<id>.svg | <id>.png
 *   metals    → inline SVG coin (gold / silver / platinum / palladium)
 *
 * The files are VENDORED into the deployment (see scripts/fetch-icons.mjs):
 * the upstream flagcdn / jsDelivr / CoinCap CDNs are reset on many Iranian
 * connections, which made icons randomly fail to appear until a refresh hit
 * the browser cache. Same-origin icons always load, everywhere the site does.
 * Returns null when nothing suitable exists; callers fall back to emoji.
 */
import { displayInstrument } from "@traderkomak/shared";

/** The two label halves of any instrument, provider-agnostic:
 *  EUR_USD → ["EUR","USD"] · BTCUSDT → ["BTC","USDT"] · XAU_USD → ["XAU","USD"] */
export function symbolParts(instrument: string): string[] {
  return displayInstrument(instrument).split("/");
}

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
  // Vendored flag (own origin) — the flagcdn CDN is reset on many ISPs.
  if (flag) return `/icons/flags/${flag}.png`;

  // Crypto → colored coin logos. Two sources, verified per-coin:
  //   • spothq/cryptocurrency-icons (SVG, consistent circle style) — repo
  //     stopped updating ~2022, so newer coins aren't there
  //   • CoinCap assets (PNG @2x) for everything newer
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
    UNI: "uni",
    TRX: "trx",
    ATOM: "atom",
    XLM: "xlm",
    FIL: "fil",
    ICP: "icp",
    ETC: "etc",
    ALGO: "algo",
    VET: "vet",
    AAVE: "aave",
    GRT: "grt",
    SAND: "sand",
    MANA: "mana",
    CHZ: "chz",
    STX: "stx",
    CRV: "crv",
    NEO: "neo",
    // Stablecoin quotes (Binance pairs)
    USDT: "usdt",
    USDC: "usdc",
    TUSD: "tusd",
  };
  const id = crypto[currency];
  if (id) {
    return `/icons/coins/${id}.svg`;
  }
  // Coins the spothq repo predates — CoinCap carries them all (verified).
  const coincap: Record<string, string> = {
    SHIB: "shib",
    PEPE: "pepe",
    NEAR: "near",
    APT: "apt",
    ARB: "arb",
    OP: "op",
    INJ: "inj",
    SUI: "sui",
    SEI: "sei",
    TIA: "tia",
    HBAR: "hbar",
    AXS: "axs",
    GALA: "gala",
    ENA: "ena",
    WIF: "wif",
    BONK: "bonk",
    FLOKI: "floki",
    JUP: "jup",
    PYTH: "pyth",
    WLD: "wld",
    RUNE: "rune",
    FET: "fet",
    LDO: "ldo",
    TON: "ton",
    CAKE: "cake",
    IMX: "imx",
    FLOW: "flow",
    POL: "pol",
    EGLD: "egld",
    // Stablecoins the SVG set predates or never had (vendored from CoinCap).
    BUSD: "busd",
    FDUSD: "fdusd",
  };
  if (coincap[currency]) {
    return `/icons/coins/${coincap[currency]}.png`;
  }

  // Precious metals → inline SVG coins
  const metal = METAL_COINS[currency];
  if (metal) return svgDataUri(metal);

  return null;
}

const COIN_PALETTE = ["#F59E0B", "#38BDF8", "#A78BFA", "#34D399", "#F472B6", "#FB923C", "#60A5FA", "#4ADE80", "#E879F9", "#FACC15"];

/** Any unmapped asset code (a newly added symbol without a known logo)
 *  still gets a proper-looking coin: deterministic color from the code,
 *  ticker text inside. Adding symbols "someday" needs zero icon work. */
export function generatedCoinIcon(code: string): string | null {
  if (!/^[A-Z]{2,10}$/.test(code)) return null;
  let hash = 0;
  for (let i = 0; i < code.length; i++) hash = (hash * 31 + code.charCodeAt(i)) >>> 0;
  const fill = COIN_PALETTE[hash % COIN_PALETTE.length]!;
  const label = code.length <= 4 ? code : code.slice(0, 4);
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>` +
    `<circle cx='16' cy='16' r='16' fill='${fill}'/>` +
    `<text x='16' y='20.5' font-family='Arial,Helvetica,sans-serif' font-size='${label.length > 3 ? 9 : 11}' ` +
    `font-weight='bold' fill='#1e1b4b' text-anchor='middle'>${label}</text>` +
    `</svg>`;
  return svgDataUri(svg);
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
