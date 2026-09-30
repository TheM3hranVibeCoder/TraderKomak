/**
 * Warm-up cron — keeps the market server AWAKE.
 *
 * Render's free plan spins a web service down after ~15 minutes without
 * traffic; the next visitor pays a 30-60s cold start (reported as "the chart
 * took 1-2 minutes to load"). A Cloudflare cron trigger hits GET /health every
 * 5 minutes: Workers themselves never sleep, and the free plan's 100k
 * requests/day dwarf the ~290 pings this uses per month.
 *
 * Setup (once):
 *   1) set MARKET_SERVER_URL in wrangler.toml [vars] (your Render/Railway URL)
 *   2) npx wrangler deploy
 *   3) open the deployed worker URL in a browser — it prints the ping result
 *
 * /health is used on purpose: it never touches OANDA/Binance and costs the
 * market server nothing (see apps/market-server/src/routes/health.ts).
 */

async function ping(env) {
  const base = String(env.MARKET_SERVER_URL || "").replace(/\/+$/, "");
  if (!base) return "MARKET_SERVER_URL is not set (see wrangler.toml [vars])";
  const started = Date.now();
  try {
    const res = await fetch(base + "/health", { cf: { cacheTtl: 0 } });
    return `${new Date().toISOString()}  ${base}/health -> ${res.status} (${Date.now() - started}ms)`;
  } catch (err) {
    return `${new Date().toISOString()}  ${base}/health -> ERROR ${err}`;
  }
}

export default {
  /** The keep-alive itself — runs on the cron trigger below. */
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(ping(env).then((line) => console.log(line)));
  },
  /** Manual verification: opening the worker URL prints the latest ping. */
  async fetch(_request, env) {
    return new Response((await ping(env)) + "\n", {
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  },
};
