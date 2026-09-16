# TraderKomak — agent guide

## Layout (npm workspaces)
- `packages/shared` — protocol types, instruments/timeframes, validation. **Build first**: `npm run build:shared`.
- `apps/market-server` — Fastify + WebSocket hub, OANDA/Binance/Dukascopy providers, chat. Unit tests in `apps/market-server/test` (vitest, node env).
- `apps/web` — Vue 3 + Pinia + Lightweight Charts v5 SPA. No tests yet.
- `supabase/schema.sql` — tables + RLS (profiles, user_emails, user_settings, admin_settings).
- `cloudflare-worker/` — Iran-access relay for the market server.

## Commands
- `npm run dev:server` / `npm run dev:web`
- `npm run typecheck` (chains shared → server → web) — run before every commit.
- `npm run test` (vitest, market-server), `npm run lint` (ESLint 9 flat config).
- Full build: `npm run build` (shared → server → web).

## Hard rules
- The chart engine (`apps/web`) never talks to OANDA directly — everything flows through the market-server WS/REST (`packages/shared` protocol).
- Protocol types live in `packages/shared`; changing them requires rebuilding shared (`npm run build:shared`) before other packages typecheck, and a market-server redeploy on Render.
- Both `apps/web` and `apps/market-server` depend on the WS protocol — keep client and server message handling in sync in the same commit.
- localStorage is an offline cache, never the source of truth; every save path must be quota-safe (try/catch).
