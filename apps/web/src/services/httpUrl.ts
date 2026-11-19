/**
 * Market-server HTTP base URL — shared by every service that talks to the
 * server's REST surface (candles history, chat images, the cTrader session
 * config). Kept in its own module so provider services can import it
 * without circular imports (api.ts routes some providers to those services).
 */
export function httpBase(): string {
  // VITE_API_HTTP_URL: "" (same origin, proxied) or explicit market-server URL.
  const raw = (import.meta.env.VITE_API_HTTP_URL as string | undefined)?.trim();
  if (raw) return raw.replace(/\/$/, "");
  // Production serves the SPA from Vercel with NO /api proxy, so relative
  // REST URLs would hit the SPA rewrite and return HTML. Derive the
  // absolute market-server origin from the WS URL instead:
  //   wss://edge.traderkomak.ir/ws → https://edge.traderkomak.ir
  const ws = (import.meta.env.VITE_MARKET_WS_URL as string | undefined)?.trim();
  if (ws) {
    const m = /^wss?:\/\/([^/]+)/i.exec(ws);
    if (m) return `${/^wss/i.test(ws) ? "https" : "http"}://${m[1]!}`;
  }
  return "";
}
