# TraderKomak — Phase 1: Real-Time Forex Charting Foundation

**Vue 3 + Lightweight Charts on the frontend · persistent Node.js market-data service · OANDA REST + Pricing Stream on the backend.**

This is the first working foundation of TraderKomak. It is intentionally **not** a full TradingView clone — it implements only the market-data and charting core so future phases can add indicators, drawing tools, replay, watchlists, authentication and backtesting without rewriting the engine.

---

## 1. Architecture

```
OANDA Historical REST API
        ↓
  OandaRestClient (server-side only)
        ↓
  OANDA Adapter → toCandles() → normalized Candle[]
        ↓
  GET /api/candles?instrument=EUR_USD&timeframe=5s&count=500
        ↓
  Vue frontend (fetchCandles) → Pinia market store → ChartAdapter → Lightweight Charts

OANDA Pricing Stream (persistent HTTP stream, one connection)
        ↓
  OandaStreamClient (server-side only, auto-reconnect, heartbeat, single-flight)
        ↓
  priceEventToTick() → MarketTick { bid, ask, mid }
        ↓
  CandleFeed → per-(instrument,timeframe) CandleAggregator (pure, timestamp-driven)
        ↓
  MarketHub WebSocket fan-out → JSON frames
        ↓
  Vue MarketWsClient (auto-reconnect) → Pinia market store
        ↓
  ChartPane (incremental update-or-append, no duplicates)
```

**Monorepo layout:**

```
traderkomak/
├── apps/
│   ├── web/                # Vue 3 frontend (Netlify-deployable)
│   └── market-server/      # Persistent market-data service (Railway/Render/Fly.io/VPS)
├── packages/
│   └── shared/             # Provider-agnostic contracts: types, protocol, constants, validation
├── netlify/
│   └── functions/
│       └── candles.ts      # Short-lived HTTP proxy (NEVER streams)
├── .env.example
├── netlify.toml
└── package.json            # npm workspaces
```

**Separation enforced by imports:**

```
OANDA Adapter → Market Data Normalizer → CandleAggregator → Market Data Service → WebSocket Protocol → Vue Market Store → Chart Adapter → Lightweight Charts
```

The chart engine never knows about OANDA. The OANDA adapter never knows about Lightweight Charts. The aggregation engine is a pure module with no framework or clock dependency — it can be replaced by a Rust service speaking the same WebSocket protocol without touching the frontend.

---

## 2. Technology Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | Vue 3 + TypeScript + Vite | Modern, fast, typed |
| Charts | Lightweight Charts 4.x | Fast canvas charting, TradingView look without bloat |
| State | Pinia (only where useful) | Single market store; everything else is local state |
| Backend | Node.js 22 + Fastify + TypeScript | Low overhead, first-class WebSocket, pino logging |
| Protocol | JSON over WebSocket + native fetch | Stable, trivial to replace engine later |
| Shared | npm workspaces (`@traderkomak/shared`) | No duplicated protocol types |
| Testing | Vitest | Fast, ESM-native |
| Deploy | Netlify (frontend) + persistent Node host (market-server) | Stream cannot live inside a Netlify function |

---

## 3. Local Installation

**Prerequisites:** Node.js ≥ 22

```bash
cd traderkomak
npm install
```

---

## 4. Environment Variables

**Never** hard-code OANDA credentials. The real values are supplied via environment variables or the hosting platform's secret store. The file `.env` is git-ignored; only `.env.example` is committed.

```bash
cp .env.example .env
# then fill in the blanks
```

| Variable | Where | Purpose | Example |
|---|---|---|---|
| `OANDA_API_TOKEN` | server only | Bearer token for OANDA REST + stream | *(secret)* |
| `OANDA_ACCOUNT_ID` | server only | `101-001-12588109-002` (placeholder in `.env.example`) | `101-001-12588109-002` |
| `OANDA_API_URL` | server only | Practice `https://api-fxpractice.oanda.com` or live URL | `https://api-fxpractice.oanda.com` |
| `OANDA_STREAM_URL` | server only | Practice `https://stream-fxpractice.oanda.com` | `https://stream-fxpractice.oanda.com` |
| `PORT` / `HOST` | server only | Market-server listen address | `8080` / `0.0.0.0` |
| `CORS_ORIGIN` | server only | Comma-separated allowed origins (`*` for local dev) | `http://localhost:5173` |
| `PERSISTENT_AGGREGATIONS` | server only | Sessions buffered even with zero subscribers | `EUR_USD:1s` |
| `VITE_MARKET_WS_URL` | browser (safe) | WebSocket endpoint of market-server | `ws://localhost:8080/ws` |
| `VITE_API_HTTP_URL` | browser (safe) | HTTP base for candles; empty = same origin (Vite proxy / Netlify function) | `` |
| `MARKET_SERVER_URL` | Netlify function only | Market-server base URL | `https://your-market-server.fly.dev` |

`VITE_*` variables are the **only** values that reach the browser. There is no `VITE_OANDA_API_TOKEN`. The token lives exclusively in `Authorization` headers built inside `OandaRestClient` and `OandaStreamClient` and is redacted from all logs.

---

## 5. OANDA Setup

1. Create / log in to an [OANDA](https://www.oanda.com) account and generate a **practice** API token (My Account → API Access).
2. Note the **account ID** (format `XXX-XXX-XXXXXXX-XXX`) and the **environment URLs**:
   - Practice: `https://api-fxpractice.oanda.com`, `https://stream-fxpractice.oanda.com`
   - Live: `https://api-fxtrade.oanda.com`, `https://stream-fxtrade.oanda.com`
3. Put them into `.env` (local) and into the secret store of your hosting platform (Railway / Render / Fly.io / Netlify env for the function — `MARKET_SERVER_URL` only).

---

## 6. How to Run the Frontend

```bash
cd traderkomak
npm run dev:web          # Vite on http://localhost:5173
# or, from the workspace root:
npm run dev -w @traderkomak/web
```

The dev server proxies `/api/*` and `/health` to `http://localhost:8080` (override with `VITE_API_PROXY_TARGET`). For a production preview:

```bash
npm run build:web
npm run preview -w @traderkomak/web
```

---

## 7. How to Run the Market Server

```bash
cd traderkomak
cp .env.example .env   # fill in real OANDA values
npm run build:shared
npm run dev:server     # tsx watch on http://localhost:8080
# production:
npm run build:server
npm run start:server
```

Health check: `GET http://localhost:8080/health` → `{ "status": "ok" }`

Graceful shutdown: `SIGINT` / `SIGTERM` closes WebSocket clients, aborts the stream, and shuts Fastify.

---

## 8. How the Historical-Data Pipeline Works

```
Vue mount → market store loadHistory()
            → fetchCandles(instrument, timeframe, 500)
            → GET /api/candles?instrument=EUR_USD&timeframe=5s&count=500
            → Fastify route validates instrument/timeframe/count
            → resolveHistory():
                1s  → bufferSnapshot() only (no native source)
                5s  → OANDA S5
                10s → OANDA S5 then aggregateCandles(..., 10)
                30s → OANDA S5 then aggregateCandles(..., 30)
                1m  → OANDA M1
            → OandaRestClient.getNativeCandles() fetches M-priced candles
            → toCandles() normalizes de-duplicates and sorts ascending
            → 10s/30s bucket aggregation uses the same engine as live
            → { instrument, timeframe, candles } (normalized Candle[])
            → Pinia candles[] → ChartPane setData() → fitContent()
```

`GET /api/candles` is a short-lived request; it never holds a stream open. Error mapping is stable and never echoes the token or upstream internals.

---

## 9. How the Live-Data Pipeline Works

```
Market-server start:
  CandleFeed.startPersistent(PERSISTENT_AGGREGATIONS)   # e.g. EUR_USD:1s is always buffered
  → OandaStreamClient.setInstruments(sessionUnion)
  → stream.start() dials GET /v3/accounts/{id}/pricing/stream?instruments=...

For every stream line:
  "HEARTBEAT" → ignored (watchdog already reset on any line)
  "PRICE"     → priceEventToTick() → MarketTick { bid, ask, mid = (bid+ask)/2 }
              → CandleFeed.handleTick() fans out to matching sessions
              → CandleAggregator.apply(tick):
                  price = resolveCandlePrice(tick)   # mid preferred
                  bucket = floor(timestamp / tfSeconds) * tfSeconds
                  if bucket > current → emit closed + new active
                  else if bucket == current → update high/low/close
                  else → stale, ignored
              → MarketHub.onCandleEvent() fans out to WS subscribers
              → JSON frame { type="candle", instrument, timeframe, data, closed }

Watchdog: any 60 s of stream silence forces a reconnect.
Reconnect: exponential backoff with jitter, capped at 30 s; attempt counter resets on success; only one dial at a time; instrument-set changes trigger an immediate redial.
```

**Persistence note:** `1s` has no native history — its only source is this live buffer. `PERSISTENT_AGGREGATIONS=EUR_USD:1s` keeps the `1s` session alive even with no subscribers so history accumulates.

---

## 10. WebSocket Protocol

Transport: single endpoint `GET /ws` (Fastify `@fastify/websocket`). Framing: one JSON text frame per message. Shared types live in `packages/shared/src/types/protocol.ts`.

**Client → Server**

```json
{ "type": "subscribe", "instrument": "EUR_USD", "timeframe": "5s" }
{ "type": "unsubscribe" }
{ "type": "ping" }
```

**Server → Client**

```json
{ "type": "snapshot", "instrument": "EUR_USD", "timeframe": "5s", "candles": [ { "time": 1750000000, "open": 1.17, "high": 1.17, "low": 1.17, "close": 1.17 } ] }
{ "type": "candle", "instrument": "EUR_USD", "timeframe": "5s", "data": { "time": 1750000000, "open": 1.17, "high": 1.17, "low": 1.17, "close": 1.17 }, "closed": false }
{ "type": "candle", "instrument": "EUR_USD", "timeframe": "5s", "data": { "time": 1750000000, "open": 1.17, "high": 1.17, "low": 1.17, "close": 1.17 }, "closed": true }
{ "type": "status", "status": "connected" }
{ "type": "status", "status": "reconnecting" }
{ "type": "status", "status": "offline" }
{ "type": "pong" }
{ "type": "error", "message": "Unknown or unsupported instrument" }
```

`subscribe` is **atomic replacement**: one active subscription per connection; sending a new `subscribe` drops the previous one and drives the upstream instrument union. `closed: true` marks the candle that just finalized — the next `candle` with `closed: false` opens the following bucket.

Frontend data flow to avoid races: historical `GET` resolves → `setData()` → `subscribe` on the already-open WebSocket. Snapshots from the live buffer are merged (not blindly replaced) so a late-joining client never flashes empty.

---

## 11. Deployment to Netlify (Frontend)

`netlify.toml` at `traderkomak/netlify.toml`:

- **Build**: `npm run build:shared && npm run build:web` → `apps/web/dist`
- **Functions**: `netlify/functions` (short-lived `candles.ts` proxy)
- **Redirect** `/api/candles` → `/.netlify/functions/candles` (never the stream)
- **Fallback** `/*` → `/index.html` (SPA)

**Netlify environment:**

- Build: `NODE_VERSION=22`
- Function: `MARKET_SERVER_URL=https://your-market-server.fly.dev` (no token)
- Frontend `VITE_MARKET_WS_URL=wss://your-market-server.fly.dev/ws` (safe)
- Leave `VITE_API_HTTP_URL` empty to use the proxied `/api/candles`; or set it to the market-server URL if you prefer direct calls.

The `OANDA_API_TOKEN` must **never** be set as a `VITE_*` variable.

---

## 12. Deployment of the Market Server

The service is provider-agnostic (Railway, Render, Fly.io, VPS). It needs only:

```bash
PORT=8080
HOST=0.0.0.0
CORS_ORIGIN=https://your-site.netlify.app
OANDA_API_TOKEN=***    # secret
OANDA_ACCOUNT_ID=101-001-xxxxxxx-xxx
OANDA_API_URL=https://api-fxpractice.oanda.com
OANDA_STREAM_URL=https://stream-fxpractice.oanda.com
PERSISTENT_AGGREGATIONS=EUR_USD:1s
```

Example `Dockerfile` pattern or direct `npm run build && npm run start:server`. The process must be **persistent** — the stream is a long-lived HTTP response, not a cron/job.

---

## 13. Security Considerations

- Credentials are read only via `OANDA_API_TOKEN` / `OANDA_ACCOUNT_ID` server-side env vars. They never appear in Vue code, Vite bundles, GitHub, public files, source maps, API responses, console logs or error messages.
- Fastify logger has a global `redact` list (`authorization`, `*.token`, `apiToken`, etc.) with censor `[REDACTED]`.
- The OANDA adapter and clients deliberately drop `Authorization` from error mapping/logs.
- CORS is explicit (`CORS_ORIGIN`), not `*` in production.
- Input validation: instrument and timeframe whitelists; count clamped to `1..2000`; WebSocket frames validated before any state change.
- `.env` is git-ignored; only `.env.example` is committed and contains a placeholder account ID.

---

## 14. Known Limitations of the OANDA Pricing Stream

- OANDA's pricing stream is **not guaranteed** to contain every underlying market price event. Generated candles represent the events **received** via the stream, not every global Forex tick. This is documented in the UI footer, in `CandleAggregator`, and in this README — no candle should be presented as a complete market record.
- The stream is a single persistent HTTP response; buffering, proxy, and network issues can delay or coalesce events. Timestamps — not local timers — are always the source of truth for bucket boundaries.
- `1s` has **no native historical source** on OANDA. Its only history is the in-memory ring buffer accumulated by this service. On a fresh deploy, `1s` history is empty until live ticks arrive. `PERSISTENT_AGGREGATIONS` mitigates this by keeping the session warm.
- OANDA practice credentials are rate-limited; `429` is mapped to a stable `RATE_LIMITED` error with `Retry-After` passthrough.

---

## 15. Future Architecture

The most important Phase-1 decision is the **stable WebSocket protocol**. Future phases can:

- Replace the Node.js aggregation engine with a **Rust** service without changing the frontend or the protocol.
- Swap OANDA for Binance / FXCM / Dukascopy or a proprietary engine — only the adapter + rest/stream clients change.
- Add **Supabase** for auth, user profiles, watchlists, chart layouts, drawings, alerts, journal, saved strategies and settings. Phase 1 deliberately stores **no** ticks or candles in Supabase; the abstraction layer is ready for it.
- Keep the chart engine unaware of the data source. `CandleFeed`, `MarketHub`, and the shared types are the seams.

Intentionally **out of scope** for Phase 1: login / registration / Supabase Auth, watchlists, indicators (RSI/MACD), drawing tools, replay / backtesting, trading execution, portfolio, social, subscriptions, payments, ads, AI, mobile app, advanced chart layouts.

---

## Development Commands

```bash
# from traderkomak/
npm install
npm run build              # shared → server → web
npm run typecheck
npm run test               # vitest run (54 tests)
npm run lint

npm run dev:server         # market server on :8080 (requires .env)
npm run dev:web            # vite on :5173, proxies /api to :8080
npm run start:server       # run built server

# local env
cp .env.example .env       # fill in OANDA values
```

---

## Definition of Done — Phase 1 Checklist

- [x] Vue application starts and Netlify production build succeeds
- [x] Market server starts with env-gated OANDA auth
- [x] Historical EUR_USD candles load (5s/10s/30s via S5 aggregation, 1m via M1, 1s via live buffer)
- [x] Live OANDA pricing stream works with auto-reconnect, heartbeat, and single-flight dial
- [x] Current candle updates in real time; new candles append automatically; no duplicate candles
- [x] All timeframes 1s/5s/10s/30s/1m work via the same aggregation engine
- [x] Symbol and timeframe switching are atomic (unsubscribe → load history → resubscribe → snapshot merge)
- [x] WebSocket reconnect works (exponential backoff with jitter)
- [x] Connection status (LIVE / CONNECTING / RECONNECTING / OFFLINE) reflects the upstream stream
- [x] Invalid credentials / instruments / timeframes handled safely without crashing the chart
- [x] Secrets never reach the browser; `.env` is git-ignored
- [x] No market data stored in Supabase in Phase 1; architecture left open for it
- [x] Aggregation unit tests pass (OHLC, boundaries, stale-tick drop, deduplication)
- [x] README and `.env.example` are complete

---

## License

Private — TraderKomak Phase 1.
