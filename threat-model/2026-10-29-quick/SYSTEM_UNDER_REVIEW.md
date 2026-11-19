# SYSTEM_UNDER_REVIEW

Bundle: traderkomak, revision `a21edd3b3ba184775a44c2c513d7ff04064abe85`; working tree **not_checked** (Git LFS clean/process filters are configured, so per the runbook working-tree `status`/`diff`/`blame` were skipped).
Run: mode `quick` (caller named no mode, architecture, or method). Library root label `grim-prompter` (jmanico/grim-prompter clone; runbook last_reviewed 2026-10-28). Project root label `traderkomak`.
Purpose: first-pass threat model of the TraderKomak trading/charting platform to identify design-level threats and prioritized mitigations before agreeing on code fixes.
Primary architecture: selected in `selection.json`/`selection.md` (see Step 3 output).

## Scope

In scope: the monorepo at revision above — `apps/web` (Vue 3 SPA), `apps/market-server` (Fastify + WebSocket hub + community chat), `packages/shared` (protocol/validation), `supabase/` (schema + RLS SQL), `cloudflare-worker/` (binance-proxy, oanda-proxy, edge-proxy, warmup), `netlify/functions/candles.ts`, deployment configs (`vercel.json`, `netlify.toml`, `render.yaml`, `deploy/vps-setup.sh`, wrangler.toml files), and the frontend↔backend↔provider data flows.
Out of scope: runtime/live verification of any deployed host (read-only run, no network), dependency vulnerability scanning (would require network), `node_modules`, build output (`dist/`, `web-tmp/`), runtime data/log files (`server-dev.log`, `web-dev.log`, `preview.log`, `apps/market-server/.data/*`, `*.json` data dumps at repo root — classified as generated artifacts; contents not read), and any `.env` file (runbook secret boundary; only `.env.example` was read).

## Evidence

E1 — configuration observation
Locator: apps/market-server/src/app.ts:37-203. Fastify `trustProxy: true` (trusts all proxies; `request.ip` = leftmost X-Forwarded-For entry), CORS GET-only from `CORS_ORIGIN` (reflect-all when it contains `*`), WS `maxPayload` 1 MiB, body limit 64 KiB, permessage-deflate on, routes: /health, /api/candles, /api/news, /binance relay, /ws hub, /chat.

E2 — configuration observation
Locator: apps/market-server/src/config/env.ts:116-170. Defaults: `CORS_ORIGIN` → `*` if unset; `CHAT_ADMIN_KEY` → empty (no chat admins); `CHAT_OWNER_NICK` → `mehran`; `BINANCE_RELAY_SECRET` → empty (relay disabled); `HOST` → `0.0.0.0`.

E3 — implementation observation
Locator: apps/market-server/src/routes/candles.ts:29-159. `GET /api/candles` validates instrument/timeframe against shared whitelists, clamps count ≤ 20000, per-IP in-memory fixed-window limiter (240 req/min keyed by `request.ip`), 300-entry history cache, stale-cache fallback on rate-limit/upstream failure. Error mapping never echoes upstream auth failures beyond a stable code.

E4 — implementation observation
Locator: apps/market-server/src/routes/news.ts:72-109,136-153. Server-side ForexFactory calendar proxy, 60 s upstream attempt gate, disk-backed cache, items copied from upstream JSON without further validation (title/country/etc. `String()`-cast).

E5 — implementation observation
Locator: apps/market-server/src/routes/binance-relay.ts:26-101. Binance relay gated by a secret **path segment** (`/binance/:secret/api/*`), comparison `s === secret` (not constant-time, unlike the chat admin key), path regex-validated, GET-only REST + WS pipe to data-api/data-stream.binance.vision, 64 KiB frame cap, disabled when secret empty.

E6 — implementation observation
Locator: apps/market-server/src/websocket/hub.ts:76-244 + packages/shared/src/validation.ts:38-108. `/ws` is unauthenticated; every frame parsed/validated by shared `parseClientMessage` (instrument whitelist, timeframe whitelist, watch ≤ 20 instruments); one chart subscription per connection; malformed input → error frame, no crash.

E7 — implementation observation
Locator: apps/market-server/src/chat/chatRoom.ts. Community chat on `/chat`, unauthenticated. Identity = self-chosen nickname (2–20 chars); only the owner nick is reserved (constant-time admin-key join required to claim it). Admin powers gated by `CHAT_ADMIN_KEY` sent in the `join` frame (constant-time compare). Per-connection 15 s message cooldown (admins exempt); reactions flood guard 150 ms. IP bans + nick bans; mute/ban state and chat history persist to disk (`.data/chat-*.json`) and optionally Upstash Redis; roster (`known`) stores nickname → last-seen + IP and is served to admin connections (capped 1000). Server-side geo lookup sends chatter IPs to `https://ipwho.is` (HTTPS, cached 24 h). Admin DM delivered to the **first** connection matching the target nick; DM read receipts verified against recipient nick. Chat images: data-URL only, regex `^data:image/(png|jpe?g|webp);base64,...` ≤ 280 000 chars, stored server-side in `imgStore` (~200 × 280 KB worst case), served via unauthenticated rate-limited `GET /api/chat-img/:id` with nosniff + immutable cache. Member roster backfilled hourly from Supabase `profiles` using the public anon key. History frames: observer joins get `toWire` (image id only), member joins get raw history including inline image data URLs (chatRoom.ts:414 vs :444).

E8 — configuration observation
Locator: supabase/schema.sql. Tables: `profiles` (RLS: select public, insert own, update own), `drawings`/`user_settings` (own-all), `user_emails` (insert/update own row; select only for `is_admin` profiles), `admin_settings` (select only for `is_admin` profiles). schema.sql:42-43 revokes table-level UPDATE from `authenticated` and re-grants only `(username, username_lower, avatar_url)` — closing self-promotion of `is_admin`.

E9 — documentation claim
Locator: supabase/fix-admin-escalation.sql:1-20. Standalone fix script documenting that the previous "update own profile" policy let any signed-in user set `is_admin = true` on their own row (read every user's email + the chat moderator key). Script must be run manually in the Supabase SQL editor; the repository cannot show whether the live project has it applied.

E10 — configuration observation
Locator: supabase/add-user-location.sql:18-21. `user_emails` gains `last_ip`, `last_country`, `last_country_code`, `last_seen_at`; no new RLS (own-write/admin-read inherited).

E11 — implementation observation
Locator: apps/web/src/services/supabase.ts:20-66. Supabase session JWT mirrored into a first-party cookie `tk-sb-session` via `document.cookie` — `SameSite=Lax`, **no `Secure` attribute**, not HttpOnly (by design, JS-written), 180-day Max-Age, skipped silently if the JSON exceeds 3500 chars.

E12 — implementation observation
Locator: apps/web/src/stores/auth.ts:152-246. Admin determination is client-fetched `profiles.is_admin`; admins additionally fetch the chat moderator key from `admin_settings` and store it via the chat store. Sliding 7-day re-auth window. Profile cache is keyed by `userId` (older bug where a next sign-in inherited a stranger's `isAdmin` is fixed by the keying).

E13 — implementation observation
Locator: apps/web/src/services/oandaAccounts.ts:25-28. **Two OANDA practice-account API tokens are hardcoded in the frontend bundle** (values redacted here: `[REDACTED:oanda-token-1]`, `[REDACTED:oanda-token-2]` with account ids `101-001-40494694-001`, `101-001-40494533-001`). The file documents this as deliberate ("PRACTICE ACCOUNTS ONLY. A live-account token must never be placed here") — every visitor fetches OANDA data directly with these tokens; browser rotation retires rate-limited accounts per session.

E14 — implementation observation
Locator: apps/web/src/services/oandaDirect.ts:1-75. Browser calls OANDA practice REST/stream directly with the bundle tokens; falls back to the `oanda-proxy` Cloudflare Worker when `VITE_OANDA_PROXY_URL` is set.

E15 — implementation observation
Locator: apps/web/src/services/location.ts:65-112. Each signed-in visitor fetches its own public IP/country from third-party echo services (`ipwho.is`, `get.geojs.io`, `api.ipify.org`) and upserts it into its own `user_emails` row — the value is **self-reported and unverified**; admin panel (`fetchAllLocations`) reads all rows. Gated by a `RECORD_LOCATION = true` constant; throttled 30 min per session.

E16 — implementation observation
Locator: apps/web/src/stores/chat.ts:7-19,174-183,389-408 + apps/web/src/services/chatClient.ts:288-298. Chat moderator key persisted in `localStorage["tk-chat-admin"]`, sent plaintext in the WS `join` frame; nickname persisted in `localStorage["tk-chat-nick"]`; ban state in localStorage. Nick is set client-side (setNick) without server-side proof of Supabase identity; the roster only *filters display* by known Supabase usernames.

E17 — configuration observation
Locator: cloudflare-worker/oanda/oanda-proxy.js:25-30,220-243. OANDA token lives in Worker secrets (good); responses carry `Access-Control-Allow-Origin: *`; no authentication or rate limiting on `/candles`, `/stream`, `/news` — any party with the worker URL can relay OANDA traffic on the project's token(s). `/stream` caps 20 instruments, `/candles` caps 5000.

E18 — configuration observation
Locator: cloudflare-worker/binance-proxy.js:19-26 + cloudflare-worker/edge/edge-proxy.js:16-72. binance-proxy: open CORS-`*` relay to binance.vision REST+WS, no limits. edge-proxy: open passthrough of **all** methods/paths to the Render origin (`traderkomak-market-server-t63h.onrender.com`, hardcoded fallback), sets `X-Forwarded-For` to `prior-incoming-XFF + CF-Connecting-IP` — combined with E1 (`trustProxy: true`) a client-supplied first XFF entry becomes the server-visible `request.ip`.

E19 — configuration observation
Locator: netlify/functions/candles.ts:46-162. Function forwards GET /api/candles to `MARKET_SERVER_URL` with strict instrument/timeframe/count whitelists; no secrets; 9 s timeout, one retry.

E20 — configuration observation
Locator: vercel.json:19-27. Vercel deploy sends CSP (`default-src 'self'`, script-src self + two hashes, `style-src 'unsafe-inline'`, img-src self/data/blob + allowlist, connect-src allowlist including OANDA practice endpoints, Supabase project, binance.vision, `oanda.traderkomak.ir`, edge/Render hosts, ipwho.is/geojs/ipify), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` disabling camera/mic/geolocation. Netlify (`netlify.toml`) defines **no** security headers — CSP exists only on the Vercel deploy path.

E21 — configuration observation
Locator: render.yaml:16-47. Render blueprint: secrets `sync: false` (dashboard-set) — OANDA token/account, CORS_ORIGIN, CHAT_ADMIN_KEY; `CHAT_OWNER_NICK=mehran`; `PERSISTENT_AGGREGATIONS=""` (lean mode: Render serves chat/admin/health and rare REST fallbacks only).

E22 — documentation claim
Locator: deploy/vps-setup.sh:13-46. VPS bootstrap runs as root; accepts a GitHub token as `argv[1]` and stores it in the git remote URL (plaintext in `.git/config`); Caddy terminates TLS for edge.traderkomak.ir.

E23 — implementation observation
Locator: apps/market-server/src/logger.ts:13-20. Pino global redact list covers `req.headers.authorization`, `req.headers.cookie`, `*.token`, `token`, `apiToken`, `OANDA_API_TOKEN`.

E24 — implementation observation
Locator: apps/market-server/src/market/candlePersist.ts:28-80. Candle files named `<instrument>-<timeframe>.jsonl` under `DATA_DIR`; instrument/timeframe come from validated whitelists upstream (no path traversal sink found).

E25 — implementation observation
Locator: apps/web/src (grep). `v-html` used only with static local icon constants (DrawingToolbar.vue); `innerHTML` in chartAdapter.ts builds a static SVG watermark. Chat/DM images render as `data:` URLs into `<img>` (CSP img-src allows data:). No user-string HTML sink found.

E26 — documentation claim
Locator: AGENTS.md:17 + README.md:13. Stated hard rule: "OANDA credentials must never reach the browser — server `.env` or Worker secrets only, never a `VITE_*` var." This conflicts with the shipped frontend token pool (E13) — the tokens do reach the browser, though not via a `VITE_*` var and marked practice-only.

E27 — caller claim
Locator: (session) The user asked for a first security pass with grim-prompter and wants to review findings before any code changes.

## Gaps (unknowns the evidence does not settle)

G1 — Unknown: whether `fix-admin-escalation.sql` (E9) was actually executed against the live Supabase project. Runtime DB state is not inspectable in a read-only run. Would be settled by querying `information_schema.column_privileges` on the live project.
G2 — Unknown: effective production values of `CORS_ORIGIN`, `CHAT_ADMIN_KEY` strength, `BINANCE_RELAY_SECRET`, and whether the Netlify or Vercel path is the live frontend (headers/CSP differ, E20).
G3 — Unknown: dependency vulnerabilities (`package-lock.json` not audited; `npm audit` requires network/execution, which this run did not do).
G4 — Unknown: whether Render's ingress (direct `*.onrender.com` access, no edge worker) appends or overwrites client-supplied `X-Forwarded-For`; the spoofing scenario (E18) is certain through the edge worker path, probable direct.
G5 — Unknown: admin panel / chat panel runtime rendering of admin-supplied strings beyond the grep in E25; full manual DOM audit not performed.
G6 — Unknown: Supabase Auth email-verification/OTP settings on the live project (client code only shows Google OAuth).

## Inspection log

Read (full): runbook.md, architecture-selector.md (library); README.md, AGENTS.md, .env.example, netlify.toml, vercel.json, render.yaml, supabase/*.sql, netlify/functions/candles.ts, cloudflare-worker/{binance-proxy.js, oanda/oanda-proxy.js, edge/edge-proxy.js, warmup/warmup.js}, apps/market-server/src/{app.ts, config/env.ts, index.ts, logger.ts, routes/*.ts, websocket/hub.ts, chat/chatRoom.ts, market/candlePersist.ts (partial)}, apps/web/src/{services/supabase.ts, stores/auth.ts, stores/chat.ts, services/chatClient.ts, services/location.ts, services/oandaAccounts.ts, services/oandaDirect.ts (partial), services/versionCheck.ts}, apps/web/vite.config.ts.
Partial/none: packages/shared (validation.ts full; aggregator/types skimmed via usage), remaining Vue components (ChatPanel/AdminPanel via targeted grep only), packages/shared aggregator internals, deploy/wrangler.toml files, test files.
Skipped: `.env` (secret boundary), runtime data/logs (`.data/*`, `*dev.log`, `preview.log`, root `*.json` dumps), `node_modules`, `dist`/build output, `package-lock.json` (dependency audit out of scope), `.git` objects (LFS filter rule), `.freebuff`, `.claude/.agents` skill caches.
No project code was executed; no network requests were made to project systems; JSON validation of this run's own artifacts is done with local file tools only.

## Redactions

- `[REDACTED:oanda-token-1]`, `[REDACTED:oanda-token-2]` — OANDA practice API tokens read at apps/web/src/services/oandaAccounts.ts:26-27; values deliberately excluded from this bundle (they ship in the public web bundle regardless — see E13).
- No other secret values were encountered in the files read (secrets are env/worker-secret injected). `.env` was not opened.
