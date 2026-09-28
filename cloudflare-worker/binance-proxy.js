// TraderKomak - Binance public data proxy (Cloudflare Worker, free plan)
//
// GET /api/v3/*   -> https://api.binance.com/api/v3/*        (REST)
// WS  /ws/<path>  -> wss://stream.binance.com:9443/ws/<path>  (WebSocket)
//
// After deploy set in market-server .env:
//   BINANCE_API_URL=https://<this-worker>.workers.dev
//   BINANCE_STREAM_URL=wss://<this-worker>.workers.dev
//
// Browser direct-mode fallback: the SPA (apps/web binanceDirect.ts) also
// calls this worker when Binance geo-blocks the visitor — responses
// therefore carry permissive CORS headers.

// NOTE: Binance's main origins (api.binance.com, stream.binance.com) sit
// behind CloudFront and BLOCK datacenter IPs — a Cloudflare Worker fetch gets
// 403. The public data mirrors (data-api.binance.vision / data-stream.
// binance.vision) serve the same public market data and tolerate datacenter
// traffic, so the proxy relays those instead.
var REST_ORIGIN = "https://data-api.binance.vision";
var WS_ORIGIN = "wss://data-stream.binance.vision";
var CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Accept",
  "Access-Control-Max-Age": "86400"
};

function closeBoth(a, b) {
  try { a.close(); } catch (e) {}
  try { b.close(); } catch (e) {}
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    var url = new URL(request.url);

    // ---- WebSocket passthrough ------------------------------------
    var upgrade = request.headers.get("Upgrade") || "";
    if (upgrade.toLowerCase() === "websocket") {
      var target = WS_ORIGIN + url.pathname + url.search;

      var pair = new WebSocketPair();
      var client = pair[0];
      var server = pair[1];
      server.accept();

      var upstream = new WebSocket(target);
      upstream.accept();

      upstream.addEventListener("message", function (ev) {
        try { server.send(ev.data); } catch (e) {}
      });
      server.addEventListener("message", function (ev) {
        try { upstream.send(ev.data); } catch (e) {}
      });
      upstream.addEventListener("close", function () { closeBoth(server, upstream); });
      upstream.addEventListener("error", function () { closeBoth(server, upstream); });
      server.addEventListener("close", function () { closeBoth(server, upstream); });
      server.addEventListener("error", function () { closeBoth(server, upstream); });

      return new Response(null, { status: 101, webSocket: client });
    }

    // ---- REST passthrough ------------------------------------------
    if (request.method !== "GET" || url.pathname.indexOf("/api/") !== 0) {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: Object.assign({ "Content-Type": "application/json" }, CORS_HEADERS)
      });
    }

    var targetRest = REST_ORIGIN + url.pathname + url.search;
    var res = await fetch(targetRest, {
      headers: { Accept: "application/json" },
      cf: { cacheTtl: 0, cacheEverything: false }
    });

    return new Response(res.body, {
      status: res.status,
      headers: Object.assign(
        {
          "Content-Type": res.headers.get("Content-Type") || "application/json",
          "Cache-Control": "no-store"
        },
        CORS_HEADERS
      )
    });
  }
};
