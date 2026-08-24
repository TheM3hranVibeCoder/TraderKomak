// TraderKomak - Binance public data proxy (Cloudflare Worker, free plan)
//
// GET /api/v3/*   -> https://api.binance.com/api/v3/*        (REST)
// WS  /ws/<path>  -> wss://stream.binance.com:9443/ws/<path>  (WebSocket)
//
// After deploy set in market-server .env:
//   BINANCE_API_URL=https://<this-worker>.workers.dev
//   BINANCE_STREAM_URL=wss://<this-worker>.workers.dev

var REST_ORIGIN = "https://api.binance.com";
var WS_ORIGIN = "wss://stream.binance.com:9443";

function closeBoth(a, b) {
  try { a.close(); } catch (e) {}
  try { b.close(); } catch (e) {}
}

export default {
  async fetch(request) {
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
        headers: { "Content-Type": "application/json" }
      });
    }

    var targetRest = REST_ORIGIN + url.pathname + url.search;
    var res = await fetch(targetRest, {
      headers: { Accept: "application/json" },
      cf: { cacheTtl: 0, cacheEverything: false }
    });

    return new Response(res.body, {
      status: res.status,
      headers: {
        "Content-Type": res.headers.get("Content-Type") || "application/json",
        "Cache-Control": "no-store"
      }
    });
  }
};
