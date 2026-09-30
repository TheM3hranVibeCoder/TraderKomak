#!/usr/bin/env node
/**
 * Recompute the sha256 hashes of every INLINE script in apps/web/index.html
 * and check them against the Content-Security-Policy in vercel.json.
 *
 * Why: the site's CSP pins inline scripts by hash. Editing such a script (even
 * whitespace) invalidates its hash and the browser silently BLOCKS it — this
 * is exactly how the pre-paint theme script went missing once.
 *
 * Usage (from the traderkomak/ root):
 *   npm run csp:hash        — report hashes and warn on mismatches
 *   npm run csp:hash --fix  — rewrite the stale hashes in vercel.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const HTML = "apps/web/index.html";
const VERCEL = "vercel.json";

const html = readFileSync(HTML, "utf8");
const inline = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
const hashes = [];
let m;
while ((m = inline.exec(html)) !== null) {
  hashes.push({
    hash: "sha256-" + createHash("sha256").update(m[1], "utf8").digest("base64"),
    head: m[1].replace(/\s+/g, " ").trim().slice(0, 60),
  });
}

const vercel = readFileSync(VERCEL, "utf8");
const cspMatch = vercel.match(/script-src([^;]*);/);
if (!cspMatch) {
  console.error("✗ No script-src directive found in vercel.json");
  process.exit(1);
}
const present = (h) => cspMatch[1].includes(h);
const fix = process.argv.includes("--fix");

let stale = 0;
for (const { hash, head } of hashes) {
  const ok = present(hash);
  console.log(`${ok ? "✓" : "✗ MISSING"}  ${hash}  (${head}…)`);
  if (!ok) stale++;
}

if (stale === 0) {
  console.log("CSP is in sync — every inline script hash is listed.");
  process.exit(0);
}

if (!fix) {
  console.log(`\n${stale} hash(es) missing from the CSP. Re-run with --fix to rewrite vercel.json.`);
  process.exit(2);
}

// Pull the matching hash out of the OLD directive and swap in the current one.
// The stale hash is the one that is NOT present after removing all current ones.
const listed = [...cspMatch[1].matchAll(/'(sha256-[^']+)'/g)].map((x) => x[1]);
const current = hashes.map((h) => h.hash);
const staleOnes = listed.filter((h) => !current.includes(h));
if (staleOnes.length !== stale) {
  console.error("✗ Cannot map stale hashes 1:1 — fix vercel.json by hand.", { listed, current, stale });
  process.exit(1);
}
let next = vercel;
for (let i = 0; i < stale; i++) {
  next = next.replace(`'${staleOnes[i]}'`, `'${current.find((c) => !listed.includes(c))}'`);
}
writeFileSync(VERCEL, next);
console.log(`✓ Updated ${stale} hash(es) in vercel.json — commit and redeploy.`);
