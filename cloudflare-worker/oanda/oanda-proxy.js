// TraderKomak — OANDA proxy (Cloudflare Worker, free plan)
//
//   GET /candles?instrument=&granularity=&count=&to=
//        → https://api-fxpractice.oanda.com/v3/instruments/<inst>/candles
//          (mid-price candles, stateless `to`-cursor pagination, edge-cached)
//   GET /stream?instruments=A,B
//        → https://stream-fxpractice.oanda.com/v3/accounts/<acct>/pricing/stream
//          (chunked JSON-lines pricing, passed straight through)
//   GET /news
//        → https://nfs.faireconomy.media/ff_calendar_thisweek.json
//          (ForexFactory weekly calendar — med/high impact + holidays,
//          edge-cached; needs NO secrets)
//
// The OANDA token NEVER reaches the browser — it lives in this worker's
// secrets. Responses carry CORS headers so the SPA (traderkomak.ir) can
// call this worker directly; workers.dev is blocked in Iran, so bind the
// route to the main domain (see wrangler.toml).
//
// THIS RELAY IS A FALLBACK (the browser normally talks to OANDA directly with
// a public practice token — apps/web/src/services/oandaDirect.ts). Workers
// Free allows 100,000 requests per DAY per ACCOUNT, shared by every Worker on
// the account, and answers the rest with Cloudflare error 1027 until 00:00
// UTC. So this file is deliberately unfriendly to abuse:
//   - CORS is restricted to the app's own origins (a random page cannot use
//     this Worker as a free OANDA relay from a browser)
//   - a per-IP rate limiter (RATE_LIMITER binding, see wrangler.toml) rejects
//     request storms
//   - /candles answers are edge-cached, so a scraper replaying the SAME query
//     costs one OANDA subrequest instead of thousands
//
// Deploy:
//   cd cloudflare-worker/oanda
//   npx wrangler secret put OANDA_API_TOKEN
//   npx wrangler secret put OANDA_ACCOUNT_ID
//   npx wrangler deploy

// Only the app itself may call this relay from a browser. Requests without an
// Origin header (curl, servers, health checks) are let through — CORS cannot
// stop those, and they are covered by the rate limiter instead.
var ALLOWED_ORIGIN_RE = /^https:\/\/(www\.)?traderkomak\.ir$/;
var LOCAL_ORIGIN_RE = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;

function originAllowed(origin) {
  if (!origin) return true;
  return ALLOWED_ORIGIN_RE.test(origin) || LOCAL_ORIGIN_RE.test(origin);
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Accept",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };
}

// OANDA instrument names: EUR_USD, XAU_USD, SPX500_USD, BCO_USD, DE30_EUR …
var INSTRUMENT_RE = /^[A-Z0-9]{2,8}(_[A-Z0-9]{2,8}){0,2}$/;
var GRANULARITY_RE = /^(S5|S10|S15|S30|M1|M2|M3|M4|M5|M10|M15|M30|H1|H2|H3|H4|H6|H8|H12|D|W|M)$/;
var MAX_CANDLES = 5000;          // OANDA hard limit per request
var MAX_STREAM_INSTRUMENTS = 20; // OANDA pricing-stream limit

/** Edge TTLs for /candles. `to`-anchored batches are immutable history, so
 *  they keep for minutes; the open-ended "latest window" changes with every
 *  tick and only needs to absorb duplicate requests. */
var CANDLES_HISTORY_TTL = 600;
var CANDLES_LATEST_TTL = 20;

function json(body, status, cors) {
  return new Response(JSON.stringify(body), {
    status: status,
    headers: Object.assign(
      { "Content-Type": "application/json", "Cache-Control": "no-store" },
      cors || corsHeaders("")
    )
  });
}

/** Plain 403 for foreign origins — no CORS headers, so a browser cannot read
 *  the body either (this is not a secret, just not a public service). */
function forbidden() {
  return new Response(
    JSON.stringify({ error: { code: "FORBIDDEN_ORIGIN", message: "Origin not allowed" } }),
    { status: 403, headers: { "Content-Type": "application/json" } }
  );
}

function validInstrument(value) {
  return typeof value === "string" && value.length <= 25 && INSTRUMENT_RE.test(value);
}

async function handleCandles(url, env, ctx, cors) {
  var instrument = url.searchParams.get("instrument") || "";
  var granularity = url.searchParams.get("granularity") || "M1";
  var count = parseInt(url.searchParams.get("count") || "500", 10);
  var to = url.searchParams.get("to");

  if (!validInstrument(instrument)) return json({ error: { code: "INVALID_INSTRUMENT", message: "Bad instrument" } }, 400, cors);
  if (!GRANULARITY_RE.test(granularity)) return json({ error: { code: "INVALID_TIMEFRAME", message: "Bad granularity" } }, 400, cors);
  if (!Number.isFinite(count) || count < 1) count = 500;
  if (count > MAX_CANDLES) count = MAX_CANDLES;

  // Cache key = the exact query on OUR OWN hostname (the Cache API is scoped to
  // the zone, and it only accepts keys from that zone) with no cookies or
  // headers involved, so it is safe to share between visitors.
  var cacheKey = new Request(
    url.origin + "/__relay-candles?instrument=" + encodeURIComponent(instrument) +
      "&granularity=" + granularity + "&count=" + count + (to ? "&to=" + encodeURIComponent(to) : ""),
    { method: "GET" }
  );
  var cache = caches.default;
  var hit = await cache.match(cacheKey);
  if (hit) {
    return new Response(hit.body, {
      status: 200,
      headers: Object.assign(
        { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Relay-Cache": "hit" },
        cors
      )
    });
  }

  var target = (env.OANDA_API_URL || "https://api-fxpractice.oanda.com").replace(/\/+$/, "") +
    "/v3/instruments/" + encodeURIComponent(instrument) + "/candles" +
    "?granularity=" + granularity + "&price=M&count=" + count;
  if (to) target += "&to=" + encodeURIComponent(to);

  var upstream = await fetch(target, {
    headers: {
      Authorization: "Bearer " + env.OANDA_API_TOKEN,
      "Accept-Datetime-Format": "RFC3339",
      Accept: "application/json"
    },
    cf: { cacheTtl: 0, cacheEverything: false }
  });

  if (!upstream.ok) {
    // Errors pass through untouched (the client reads OANDA's JSON message).
    return new Response(upstream.body, {
      status: upstream.status,
      headers: Object.assign(
        { "Content-Type": upstream.headers.get("Content-Type") || "application/json", "Cache-Control": "no-store" },
        cors
      )
    });
  }

  var body = await upstream.text();
  ctx.waitUntil(
    cache.put(
      cacheKey,
      new Response(body, {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=" + (to ? CANDLES_HISTORY_TTL : CANDLES_LATEST_TTL)
        }
      })
    )
  );
  return new Response(body, {
    status: 200,
    headers: Object.assign(
      { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Relay-Cache": "miss" },
      cors
    )
  });
}

async function handleStream(url, env, cors) {
  var raw = url.searchParams.get("instruments") || "";
  var list = raw.split(",").map(function (s) { return s.trim().toUpperCase(); }).filter(validInstrument);
  if (list.length === 0) return json({ error: { code: "INVALID_INSTRUMENT", message: "Bad instruments" } }, 400, cors);
  if (list.length > MAX_STREAM_INSTRUMENTS) list = list.slice(0, MAX_STREAM_INSTRUMENTS);

  var accountId = env.OANDA_ACCOUNT_ID;
  var streamBase = (env.OANDA_STREAM_URL || "https://stream-fxpractice.oanda.com").replace(/\/+$/, "");
  var target = streamBase + "/v3/accounts/" + encodeURIComponent(accountId) +
    "/pricing/stream?instruments=" + list.join(",");

  var upstream = await fetch(target, {
    headers: {
      Authorization: "Bearer " + env.OANDA_API_TOKEN,
      "Accept-Datetime-Format": "RFC3339",
      Accept: "application/json"
    }
  });

  if (!upstream.ok || !upstream.body) {
    // Consume the error body so it can be surfaced as JSON.
    var detail = "";
    try { detail = await upstream.text(); } catch (e) {}
    return json({ error: { code: "UPSTREAM_ERROR", message: detail || "Upstream error (HTTP " + upstream.status + ")" } }, upstream.status === 401 || upstream.status === 403 ? 502 : upstream.status, cors);
  }

  // Chunked pass-through: OANDA emits one JSON object per line; the browser
  // reads the stream incrementally. Headers discourage any intermediate
  // buffering (proxies/CDNs).
  return new Response(upstream.body, {
    status: 200,
    headers: Object.assign(
      {
        "Content-Type": "application/json",
        "Cache-Control": "no-store, no-transform",
        "X-Accel-Buffering": "no"
      },
      cors
    )
  });
}

// ── Forex Factory calendar (/news) ────────────────────────────────────────
//
// The FF feed rate-limits aggressive IPs, so ONE Cloudflare egress IP must
// fetch it for everyone: the parsed feed is edge-cached — a fresh copy for
// ~10 minutes plus a 24-hour backup, so an upstream hiccup never blanks the
// panel (stale copy is served instantly while a background refresh runs).

var FF_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
var NEWS_FRESH_TTL = 600;    // 10 min — fresh answers come from the cache
var NEWS_BACKUP_TTL = 86400; // 24 h  — stale-but-usable emergency copy

async function fetchFfCalendar() {
  var upstream = await fetch(FF_URL, {
    headers: {
      "User-Agent": "TraderKomak/1.0 (trading site calendar widget)",
      Accept: "application/json"
    },
    cf: { cacheTtl: 0, cacheEverything: false }
  });
  if (!upstream.ok) throw new Error("FF feed HTTP " + upstream.status);
  var raw = await upstream.json();
  if (!Array.isArray(raw) || raw.length === 0) throw new Error("FF feed empty");

  // Medium + High + bank holidays only — Low is noise for traders (same
  // filter the market server applied). `date` stays an ISO string; the SPA
  // parses it with Date.parse.
  var items = [];
  for (var i = 0; i < raw.length; i++) {
    var it = raw[i];
    var impact = String(it.impact != null ? it.impact : "");
    if (impact !== "High" && impact !== "Medium" && impact !== "Holiday") continue;
    var date = String(it.date != null ? it.date : "");
    if (!it.title || !date) continue;
    items.push({
      title: String(it.title),
      country: String(it.country != null ? it.country : ""),
      date: date,
      impact: impact,
      forecast: it.forecast ? String(it.forecast) : null,
      previous: it.previous ? String(it.previous) : null,
      actual: it.actual ? String(it.actual) : null
    });
  }
  items.sort(function (a, b) { return Date.parse(a.date) - Date.parse(b.date); });
  return { fetchedAt: Date.now(), items: items };
}

async function handleNews(url, ctx, cors) {
  var cache = caches.default;
  var keyFresh = new Request(FF_URL);
  var keyBackup = new Request(FF_URL + "?backup=1");

  function store(feed) {
    var payload = JSON.stringify(feed);
    ctx.waitUntil(cache.put(keyFresh, new Response(payload, {
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=" + NEWS_FRESH_TTL }
    })));
    ctx.waitUntil(cache.put(keyBackup, new Response(payload, {
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=" + NEWS_BACKUP_TTL }
    })));
  }

  // Fresh copy → answer instantly.
  var fresh = await cache.match(keyFresh);
  if (fresh) {
    var body = await fresh.json();
    body.serverNow = Date.now();
    body.stale = false;
    return json(body, 200, cors);
  }

  // Expired but a backup exists → serve it NOW (stale:true) and refresh in the
  // background. A slow/blocked upstream must never blank the panel.
  var backup = await cache.match(keyBackup);
  if (backup) {
    fetchFfCalendar().then(store).catch(function () {});
    var stale = await backup.json();
    stale.serverNow = Date.now();
    stale.stale = true;
    return json(stale, 200, cors);
  }

  // Cold cache (first hit after deploy) → one visitor waits one round-trip.
  try {
    var feed = await fetchFfCalendar();
    store(feed);
    return json(Object.assign({}, feed, { serverNow: Date.now(), stale: false }), 200, cors);
  } catch (err) {
    return json({ fetchedAt: 0, items: [], stale: true, error: "news feed unavailable" }, 502, cors);
  }
}

export default {
  async fetch(request, env, ctx) {
    var origin = request.headers.get("Origin") || "";
    if (!originAllowed(origin)) return forbidden();
    var cors = corsHeaders(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== "GET") {
      return json({ error: { code: "METHOD_NOT_ALLOWED", message: "GET only" } }, 405, cors);
    }

    // Per-IP throttle (binding configured in wrangler.toml). A single visitor
    // legitimately opens one stream plus a few history requests; a burst far
    // above that is a scraper, and every request here is metered.
    if (env && env.RATE_LIMITER) {
      var ip = request.headers.get("CF-Connecting-IP") || "unknown";
      try {
        var verdict = await env.RATE_LIMITER.limit({ key: ip });
        if (!verdict || !verdict.success) {
          return new Response(
            JSON.stringify({ error: { code: "RATE_LIMITED", message: "Too many requests" } }),
            { status: 429, headers: Object.assign({ "Content-Type": "application/json", "Retry-After": "60" }, cors) }
          );
        }
      } catch (e) {
        // A limiter hiccup must never break market data.
      }
    }

    var url = new URL(request.url);
    try {
      if (url.pathname === "/news") return await handleNews(url, ctx, cors);

      // Only the OANDA routes need secrets.
      if (!env || !env.OANDA_API_TOKEN || !env.OANDA_ACCOUNT_ID) {
        return json({ error: { code: "NOT_CONFIGURED", message: "Worker is missing OANDA secrets" } }, 500, cors);
      }
      if (url.pathname === "/candles") return await handleCandles(url, env, ctx, cors);
      if (url.pathname === "/stream") return await handleStream(url, env, cors);
      return json({ error: { code: "NOT_FOUND", message: "Not found" } }, 404, cors);
    } catch (err) {
      return json({ error: { code: "NETWORK_ERROR", message: "Upstream request failed" } }, 502, cors);
    }
  }
};
