// TraderKomak — edge proxy (Cloudflare Worker, free plan)
//
// Exposes the Render market server at https://edge.traderkomak.ir so Iran
// IPs never touch *.onrender.com directly (filtered). Forwards everything —
// REST (/api/*), images, and WebSocket (/ws) — to the Render origin.
//
// Why a Worker and not an orange-cloud CNAME?
//   An orange-cloud CNAME edge -> xxx.onrender.com returns Cloudflare
//   Error 1000 (DNS points to prohibited IP) because Render itself already
//   sits behind Cloudflare. A Worker on a custom domain avoids that entirely.
//
// Deploy:
//   cd cloudflare-worker/edge
//   npx wrangler deploy

var UPSTREAM_FALLBACK = "https://traderkomak-market-server-t63h.onrender.com";

function upstreamBase(env) {
  var base = (env && env.UPSTREAM) || UPSTREAM_FALLBACK;
  return base.replace(/\/+$/, "");
}

export default {
  async fetch(request, env) {
    var url = new URL(request.url);
    var base = upstreamBase(env);
    var upstreamHost = new URL(base).host;

    // Real client IP (Cloudflare sets this on every incoming request).
    // Fastify runs with trustProxy:true, so it reads X-Forwarded-For —
    // without this every chatter looks like the same Cloudflare IP and
    // IP bans / mutes / location lookup all break.
    var clientIp =
      request.headers.get("CF-Connecting-IP") ||
      request.headers.get("X-Forwarded-For") ||
      "";

    var target = base + url.pathname + url.search;
    var headers = new Headers(request.headers);
    headers.set("Host", upstreamHost);
    headers.set("X-Forwarded-Host", url.host);
    if (clientIp) {
      var prior = request.headers.get("X-Forwarded-For");
      headers.set(
        "X-Forwarded-For",
        prior ? prior + ", " + clientIp : clientIp
      );
      headers.set("CF-Connecting-IP", clientIp);
      headers.set("X-Real-IP", clientIp);
    }

    // ---- WebSocket (/ws) ------------------------------------------------
    // Proxy the upgrade handshake with fetch() so ALL headers (including
    // the client-IP headers above) reach Render. (A WebSocketPair bridge
    // would open a fresh handshake without them, hiding every user's IP.)
    var upgrade = request.headers.get("Upgrade") || "";
    if (upgrade.toLowerCase() === "websocket") {
      return fetch(target, { method: request.method, headers: headers });
    }

    // ---- Plain HTTP passthrough ---------------------------------------

    var res = await fetch(target, {
      method: request.method,
      headers: headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      redirect: "manual",
    });

    // Pass the upstream response through untouched (CORS comes from Render).
    return new Response(res.body, { status: res.status, headers: res.headers });
  }
};
