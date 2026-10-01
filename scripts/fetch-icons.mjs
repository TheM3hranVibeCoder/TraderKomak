#!/usr/bin/env node
/**
 * Vendor the symbol icons into the app so they load SAME-ORIGIN.
 *
 * Why: fiat flags (flagcdn), crypto logos (jsDelivr) and newer coins
 * (CoinCap) are third-party CDNs that Iranian ISPs (and flaky links) often
 * reset — the icons then randomly fail to appear until a refresh hits the
 * browser cache. Copying them into apps/web/public/icons makes them part of
 * our own deployment: fast, cacheable, and reachable wherever the site is.
 *
 * Usage (from the traderkomak/ root, network required once):
 *   node scripts/fetch-icons.mjs
 *
 * Adding a symbol to apps/web/src/utils/flags.ts means adding it here too and
 * re-running this script — the maps below must stay in sync with flags.ts.
 * Anything missing simply falls back to the generated coin icon at runtime.
 */
import { mkdirSync, writeFileSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "apps", "web", "public", "icons");

/** Fiat country flags (flagcdn w20 PNG). */
const FLAGS = ["eu", "us", "gb", "jp", "ch", "au", "ca", "nz", "de"];

/** Crypto with a color SVG in spothq/cryptocurrency-icons. */
const SPOTHQ = [
  "btc", "eth", "ltc", "xrp", "bch", "ada", "sol", "doge", "bnb", "dot", "link", "avax",
  "uni", "trx", "atom", "xlm", "fil", "icp", "etc", "algo", "vet", "aave", "grt", "sand",
  "mana", "chz", "stx", "crv", "neo", "usdt", "usdc", "tusd",
];

/** Newer coins + the two stablecoins spothq never had (CoinCap PNG @2x). */
const COINCAP = [
  "shib", "pepe", "near", "apt", "arb", "op", "inj", "sui", "sei", "tia", "hbar", "axs",
  "gala", "ena", "wif", "bonk", "floki", "jup", "pyth", "wld", "rune", "fet", "ldo", "ton",
  "cake", "imx", "flow", "pol", "egld", "busd", "fdusd",
];

const jobs = [
  ...FLAGS.map((id) => ({ file: join(ROOT, "flags", id + ".png"), url: `https://flagcdn.com/w20/${id}.png` })),
  ...SPOTHQ.map((id) => ({
    file: join(ROOT, "coins", id + ".svg"),
    url: `https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/svg/color/${id}.svg`,
  })),
  ...COINCAP.map((id) => ({
    file: join(ROOT, "coins", id + ".png"),
    url: `https://assets.coincap.io/assets/icons/${id}@2x.png`,
  })),
];

mkdirSync(join(ROOT, "flags"), { recursive: true });
mkdirSync(join(ROOT, "coins"), { recursive: true });

let fetched = 0;
let cached = 0;
const failed = [];

async function grab(job) {
  if (existsSync(job.file) && statSync(job.file).size > 0) {
    cached++;
    return;
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(job.url, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength < 40) throw new Error(`suspiciously small (${buf.byteLength}B)`);
      writeFileSync(job.file, buf);
      fetched++;
      return;
    } catch (err) {
      if (attempt === 3) failed.push(`${job.file.split(/[\\/]/).pop()} -> ${err.message}`);
      else await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
}

let next = 0;
await Promise.all(
  Array.from({ length: 6 }, async () => {
    while (next < jobs.length) await grab(jobs[next++]);
  })
);

console.log(`icons: ${jobs.length} total | ${fetched} fetched | ${cached} already present | ${failed.length} failed`);
for (const f of failed) console.log("  FAIL " + f);