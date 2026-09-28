// TraderKomak — OANDA proxy (Cloudflare Worker, free plan)
//
//   GET /candles?instrument=&granularity=&count=&to=
//        → https://api-fxpractice.oanda.com/v3/instruments/<inst>/candles
//          (mid-price candles, stateless `to`-cursor pagination)
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
// Deploy:
//   cd cloudflare-worker/oanda
//   npx wrangler secret put OANDA_API_TOKEN
//   npx wrangler secret put OANDA_ACCOUNT_ID
//   npx wrangler deploy

var CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Accept",
  "Access-Control-Max-Age": "86400"
};

// OANDA instrument names: EUR_USD, XAU_USD, SPX500_USD, BCO_USD, DE30_EUR …
var INSTRUMENT_RE = /^[A-Z0-9]{2,8}(_[A-Z0-9]{2,8}){0,2}$/;
var GRANULARITY_RE = /^(S5|S10|S15|S30|M1|M2|M3|M4|M5|M10|M15|M30|H1|H2|H3|H4|H6|H8|H12|D|W|M)$/;
var MAX_CANDLES = 5000;          // OANDA hard limit per request
var MAX_STREAM_INSTRUMENTS = 20; // OANDA pricing-stream limit

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status,
    headers: Object.assign({ "Content-Type": "application/json", "Cache-Control": "no-store" }, CORS_HEADERS)
  });
}

function validInstrument(value) {
  return typeof value === "string" && value.length <= 25 && INSTRUMENT_RE.test(value);
}

async function handleCandles(url, env) {
  var instrument = url.searchParams.get("instrument") || "";
  var granularity = url.searchParams.get("granularity") || "M1";
  var count = parseInt(url.searchParams.get("count") || "500", 10);
  var to = url.searchParams.get("to");

  if (!validInstrument(instrument)) return json({ error: { code: "INVALID_INSTRUMENT", message: "Bad instrument" } }, 400);
  if (!GRANULARITY_RE.test(granularity)) return json({ error: { code: "INVALID_TIMEFRAME", message: "Bad granularity" } }, 400);
  if (!Number.isFinite(count) || count < 1) count = 500;
  if (count > MAX_CANDLES) count = MAX_CANDLES;

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

  // Pass the OANDA body through untouched (the client parses the same
  // shape as the market server did) — status included so 4xx/5xx map over.
  return new Response(upstream.body, {
    status: upstream.status,
    headers: Object.assign(
      { "Content-Type": upstream.headers.get("Content-Type") || "application/json", "Cache-Control": "no-store" },
      CORS_HEADERS
    )
  });
}

async function handleStream(url, env) {
  var raw = url.searchParams.get("instruments") || "";
  var list = raw.split(",").map(function (s) { return s.trim().toUpperCase(); }).filter(validInstrument);
  if (list.length === 0) return json({ error: { code: "INVALID_INSTRUMENT", message: "Bad instruments" } }, 400);
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
    return json({ error: { code: "UPSTREAM_ERROR", message: detail || "Upstream error (HTTP " + upstream.status + ")" } }, upstream.status === 401 || upstream.status === 403 ? 502 : upstream.status);
  }

  // Chunked pass-through: OANDA emits one JSON object per line; the
  // browser reads the stream incrementally. Headers discourage any
  // intermediate buffering (proxies/CDNs).
  return new Response(upstream.body, {
    status: 200,
    headers: Object.assign(
      {
        "Content-Type": "application/json",
        "Cache-Control": "no-store, no-transform",
        "X-Accel-Buffering": "no"
      },
      CORS_HEADERS
    )
  });
}

// ── Forex Factory calendar (/news) ────────────────────────────────────────
//
// The FF feed rate-limits aggressive IPs, so ONE Cloudflare egress IP must
// fetch it for everyone: the parsed feed is edge-cached — a fresh copy for
// ~10 minutes plus a 24-hour backup, so an upstream hiccup never blanks
// the panel (stale copy is served instantly while a background refresh
// runs — same policy as the market server's disk-backed cache used to be).

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

async function handleNews(url, ctx) {
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
    return json(body, 200);
  }

  // Expired but a backup exists → serve it NOW (stale:true) and refresh in
  // the background. A slow/blocked upstream must never blank the panel.
  var backup = await cache.match(keyBackup);
  if (backup) {
    fetchFfCalendar().then(store).catch(function () {});
    var stale = await backup.json();
    stale.serverNow = Date.now();
    stale.stale = true;
    return json(stale, 200);
  }

  // Cold cache (first hit after deploy) → one visitor waits one round-trip.
  try {
    var feed = await fetchFfCalendar();
    store(feed);
    return json(Object.assign({}, feed, { serverNow: Date.now(), stale: false }), 200);
  } catch (err) {
    return json({ fetchedAt: 0, items: [], stale: true, error: "news feed unavailable" }, 502);
  }
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method !== "GET") {
      return json({ error: { code: "METHOD_NOT_ALLOWED", message: "GET only" } }, 405);
    }

    var url = new URL(request.url);
    try {
      if (url.pathname === "/news") return await handleNews(url, ctx);

      // Only the OANDA routes need secrets.
      if (!env || !env.OANDA_API_TOKEN || !env.OANDA_ACCOUNT_ID) {
        return json({ error: { code: "NOT_CONFIGURED", message: "Worker is missing OANDA secrets" } }, 500);
      }
      if (url.pathname === "/candles") return await handleCandles(url, env);
      if (url.pathname === "/stream") return await handleStream(url, env);
      return json({ error: { code: "NOT_FOUND", message: "Not found" } }, 404);
    } catch (err) {
      return json({ error: { code: "NETWORK_ERROR", message: "Upstream request failed" } }, 502);
    }
  }
};