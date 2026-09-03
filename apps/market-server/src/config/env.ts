import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * Minimal .env loader (zero dependencies). Loads `<repo-root>/.env` if it
 * exists, without overriding variables already present in the environment.
 * This keeps behavior identical in local dev, tsx watch, compiled runs and
 * container deployments.
 */
function loadDotEnv(): void {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // Walk up from this file looking for .env (covers both src/ and dist/ layouts)
  // and also check common cwd locations.
  const candidates: string[] = [];
  let dir = here;
  for (let i = 0; i < 6; i++) {
    candidates.push(path.resolve(dir, ".env"));
    dir = path.resolve(dir, "..");
  }
  // Also try cwd-based locations (when running from repo root or traderkomak/)
  candidates.push(path.resolve(process.cwd(), ".env"));
  candidates.push(path.resolve(process.cwd(), "traderkomak/.env"));
  // Deduplicate while preserving order
  const seen = new Set<string>();
  const uniq: string[] = [];
  for (const c of candidates) {
    if (!seen.has(c)) {
      seen.add(c);
      uniq.push(c);
    }
  }
  for (const file of uniq) {
    try {
      const contents = readFileSync(file, "utf8");
      for (const line of contents.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq <= 0) continue;
        const key = trimmed.slice(0, eq).trim();
        let value = trimmed.slice(eq + 1).trim();
        if (
          value.length >= 2 &&
          ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'")))
        ) {
          value = value.slice(1, -1);
        }
        if (!(key in process.env)) process.env[key] = value;
      }
      return; // first existing file wins
    } catch {
      // file missing — try next candidate
    }
  }
}

export interface AppConfig {
  port: number;
  host: string;
  corsOrigin: string[];
  logLevel: string;
  /** Directory for disk-persisted candle history (buffer-fed timeframes). */
  dataDir: string;
  oanda: {
    /** Never exposed anywhere — only used inside Authorization headers. */
    apiToken: string;
    accountId: string;
    apiUrl: string;
    streamUrl: string;
  };
  /** Binance public endpoints — no API key needed for market data. */
  binance: {
    apiUrl: string;
    streamUrl: string;
  };
  /** instrument:timeframe pairs aggregated even with no subscribers. */
  persistentAggregations: Array<{ instrument: string; timeframe: string }>;
}

export class ConfigError extends Error {}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new ConfigError(
      `Missing required environment variable ${name}. ` +
        `Copy .env.example to .env and fill in real values.`
    );
  }
  return value.trim();
}

function optionalEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : fallback;
}

function splitOrigins(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function loadConfig(): AppConfig {
  loadDotEnv();

  const token = requireEnv("OANDA_API_TOKEN");
  const accountId = requireEnv("OANDA_ACCOUNT_ID");

  const persistentAggregations = optionalEnv("PERSISTENT_AGGREGATIONS", "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.includes(":"))
    .map((entry) => {
      const [instrument, timeframe] = entry.split(":");
      return { instrument: instrument!.trim(), timeframe: timeframe!.trim() };
    });

  return {
    port: Number.parseInt(optionalEnv("PORT", "8080"), 10),
    host: optionalEnv("HOST", "0.0.0.0"),
    corsOrigin: splitOrigins(optionalEnv("CORS_ORIGIN", "*")),
    logLevel: optionalEnv("LOG_LEVEL", "info"),
    dataDir: optionalEnv("DATA_DIR", path.resolve(process.cwd(), ".data")),
    oanda: {
      // The raw token lives here and is used ONLY to build Authorization
      // headers inside the OANDA clients. It is never logged.
      apiToken: token,
      accountId,
      apiUrl: optionalEnv("OANDA_API_URL", "https://api-fxpractice.oanda.com").replace(/\/$/, ""),
      streamUrl: optionalEnv("OANDA_STREAM_URL", "https://stream-fxpractice.oanda.com").replace(/\/$/, ""),
    },
    binance: {
      apiUrl: optionalEnv("BINANCE_API_URL", "https://api.binance.com").replace(/\/$/, ""),
      streamUrl: optionalEnv("BINANCE_STREAM_URL", "wss://stream.binance.com:9443").replace(/\/$/, ""),
    },
    persistentAggregations,
  };
}
