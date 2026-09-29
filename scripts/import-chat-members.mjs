#!/usr/bin/env node
/**
 * One-time import: pull every Supabase profile username into the chat
 * server's known-members file (`chat-known.json`) so the admin panel lists
 * ALL registered users — online or offline — not just the ones that have
 * connected since the current server instance started.
 *
 * Why: the chat server's roster only grows when someone opens a chat
 * connection. A fresh local machine starts with an empty roster, so the
 * admin panel shows just you. This script backfills it from Supabase.
 *
 * Usage:
 *   npm run chat:import-members        (from the traderkomak/ root)
 *   node scripts/import-chat-members.mjs [--data-dir <path>]
 *
 * Requires (from .env): VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
 * (profiles are world-readable per RLS; a SUPABASE_SERVICE_ROLE_KEY is
 * used instead when present).
 *
 * IMPORTANT: stop the market server before running — it rewrites
 * chat-known.json on its own persist timer and would clobber the import.
 *
 * Merging: existing roster entries win (they carry the real lastSeen/IP
 * history); imported users only fill the gaps. Imported lastSeen = the
 * account's created_at, so "last seen" ordering is honest, not fabricated.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/* ── .env loader (same candidate order as the server's own loader) ── */
function loadDotEnv() {
  const candidates = [];
  let dir = here;
  for (let i = 0; i < 4; i++) {
    candidates.push(resolve(dir, ".env"));
    dir = resolve(dir, "..");
  }
  candidates.push(resolve(process.cwd(), ".env"));
  candidates.push(resolve(process.cwd(), "traderkomak/.env"));
  const seen = new Set();
  for (const file of candidates) {
    if (seen.has(file)) continue;
    seen.add(file);
    try {
      for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq <= 0) continue;
        const key = trimmed.slice(0, eq).trim();
        let value = trimmed.slice(eq + 1).trim();
        if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
          value = value.slice(1, -1);
        }
        if (!(key in process.env)) process.env[key] = value;
      }
    } catch { /* missing file — next candidate */ }
  }
}
loadDotEnv();

const supabaseUrl = (process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
const anonKey = (process.env.VITE_SUPABASE_ANON_KEY ?? "").trim();
const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
const apiKey = serviceKey || anonKey;

if (!supabaseUrl || !apiKey) {
  console.error("✗ Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in .env (repo root).");
  process.exit(1);
}

/* ── Data dir: --data-dir flag wins, then DATA_DIR, then the server's default ── */
const flagIdx = process.argv.indexOf("--data-dir");
const dataDir =
  flagIdx >= 0 && process.argv[flagIdx + 1]
    ? resolve(process.argv[flagIdx + 1])
    : process.env.DATA_DIR
      ? resolve(process.env.DATA_DIR)
      : resolve(here, "..", "apps", "market-server", ".data");

const KNOWN_FILE = "chat-known.json";
const target = join(dataDir, KNOWN_FILE);
const PAGE = 1000;

async function fetchProfiles() {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/profiles?select=username,created_at&order=created_at.asc.nullslast`,
      {
        headers: {
          apikey: apiKey,
          Authorization: `Bearer ${apiKey}`,
          Range: `${from}-${from + PAGE - 1}`,
          "Range-Unit": "items",
        },
      }
    );
    if (!res.ok) {
      throw new Error(`Supabase REST ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const rows = await res.json();
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

const existing = (() => {
  try {
    const raw = JSON.parse(readFileSync(target, "utf8"));
    return Array.isArray(raw)
      ? raw.filter((k) => typeof k?.nick === "string" && typeof k?.lastSeen === "number")
      : [];
  } catch {
    return [];
  }
})();

const byNick = new Map(existing.map((k) => [k.nick.toLowerCase(), k]));

let imported = 0;
let skipped = 0;
const profiles = await fetchProfiles();
for (const p of profiles) {
  const nick = String(p.username ?? "").trim().toLowerCase();
  if (!nick) { skipped++; continue; }
  if (byNick.has(nick)) continue; // existing entry wins — keep its real history
  const lastSeen = p.created_at ? Math.floor(new Date(p.created_at).getTime() / 1000) : 0;
  byNick.set(nick, { nick, lastSeen });
  imported++;
}

console.log(`Supabase profiles fetched: ${profiles.length}`);
console.log(`  new roster entries : ${imported}`);
console.log(`  already known      : ${profiles.length - imported - skipped}`);
if (skipped) console.log(`  skipped (no name)  : ${skipped}`);
console.log(`  roster total       : ${byNick.size}`);

if (byNick.size === existing.length) {
  console.log("Nothing new to import — chat-known.json left untouched.");
  process.exit(0);
}

if (existsSync(target)) {
  console.log(`⚠ Overwriting ${target} (merged) — make sure the market server is STOPPED.`);
}
writeFileSync(target, JSON.stringify([...byNick.values()]));
console.log(`✓ Wrote ${byNick.size} members → ${target}`);
console.log("  Start the server and open the admin panel — all users now appear (offline ones marked by their last-seen date).");
