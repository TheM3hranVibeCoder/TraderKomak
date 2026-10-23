# TraderKomak — agent guide

## Layout (npm workspaces)
- `packages/shared` — protocol types, instruments/timeframes, validation. **Build first**: `npm run build:shared`.
- `apps/market-server` — Fastify + WebSocket hub, OANDA/Binance/Dukascopy providers, chat. Unit tests in `apps/market-server/test` (vitest, node env).
- `apps/web` — Vue 3 + Pinia + Lightweight Charts v5 SPA. No tests yet.
- `supabase/schema.sql` — tables + RLS (profiles, user_emails, user_settings, admin_settings).
- `cloudflare-worker/` — Iran-access relays: `binance-proxy.js` (+ `wrangler.toml`, Binance public data), `oanda/` (`oanda-proxy.js` + its own `wrangler.toml`; holds the OANDA token in Worker secrets) and `warmup/` (cron Worker pinging the market server's `/health` every 5 min so a free-tier instance never spins down).

## Commands
- `npm run dev:server` / `npm run dev:web`
- `npm run typecheck` (chains shared → server → web) — run before every commit.
- `npm run test` (vitest, market-server), `npm run lint` (ESLint 9 flat config).
- Full build: `npm run build` (shared → server → web).

## Hard rules
- Candle delivery avoids the market server where possible: the browser fetches Binance data directly (`apps/web/src/services/binanceDirect.ts`, public endpoints; on geo-block the client falls back to the market server, since Binance blocks datacenter IPs and a Cloudflare-Worker relay is not viable) and OANDA data through the `oanda-proxy` Cloudflare Worker. OANDA credentials must never reach the browser — server `.env` or Worker secrets only, never a `VITE_*` var. Aggregation parity is guaranteed by the shared engine in `packages/shared` (`CandleAggregator` + provider-aligned bucket starts run identically in `apps/web` and `apps/market-server`).
- Protocol types live in `packages/shared`; changing them requires rebuilding shared (`npm run build:shared`) before other packages typecheck, and a market-server redeploy on Render.
- Both `apps/web` and `apps/market-server` depend on the WS protocol — keep client and server message handling in sync in the same commit.
- localStorage is an offline cache, never the source of truth; every save path must be quota-safe (try/catch).

## Design QA (Impeccable)
- UI changes in `apps/web` get checked with [impeccable](https://github.com/pbakaus/impeccable): `cd apps/web && npx impeccable detect src` (regex pass), and with the dev server running `npx impeccable detect http://localhost:PORT` (full element pass: contrast, tiny text, gradient halos). Fix every finding, or scope-ignore it with a reason in `apps/web/.impeccable/config.json` — never blanket-ignore a rule.
- Core floor: no gradient text (exception: the TraderKomak brand logotype in TopToolbar — user-approved), no colored side-tab borders on cards, no glow halos/accent glows, AA contrast, no text under 11px, theme tokens only (no per-component hardcoded colors), keep the global `prefers-reduced-motion` kill switch intact. The other sanctioned scope-ignores are the chart drawing-tool stroke widths (ChartPane) and the chat quote/reply bars (ChatPanel, softened via color-mix) — see `.claude/skills/impeccable/SKILL.md`.
- Full skill (24 `/impeccable` commands): `npx impeccable install` from repo root on a network that can reach GitHub.
