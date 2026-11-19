# Architecture Selection — traderkomak (2026-10-29, quick mode)

Machine-readable report: `selection.json`.

## Primary architecture: `web`

The decision the caller is making — which security findings to fix first — is dominated by the browser-to-origin boundary: the Vue SPA, its session authority (Supabase JWT in localStorage + cookie mirror), the CSP-protected rendered page, and the public market-data flows. Evidence E-01, E-05, E-07, E-08 (bundle E1, E11, E13, E20).

## Bounded secondaries

1. **collaboration-realtime** — bounded to the `/chat` WebSocket room: nickname identity, admin-key moderation, roster/PII (E-03). The identity-spoofing and moderation boundaries are distinct from the web lens.
2. **serverless** — bounded to the Cloudflare Workers (edge/oanda/binance) and the Netlify candles function (E-06, E-07): open relays and client-XFF forwarding are boundaries the origin does not own.

`identity-federation` and `multi-tenant-saas` were considered and excluded: Supabase Auth is a single-tenant Google OAuth with RLS, already covered inside the web boundary; no distinct boundary evidence.

## Availability

- `web`: prompt body fully inspected this run — available (observed scope of this library clone).
- `collaboration-realtime`, `serverless`: filenames verified in the `quick/` listing; bodies not read — identity known, fidelity unverified.
- Library registry not available; identities matched to inspected files, not a registry. Method identities unverified (none selected).

## Effort

Quick baseline: one pass over the already-collected bundle (E1–E27), followed by the quick analysis in `quick-report.json`. A deep run (six staged prompts per architecture) is the bounded deeper follow-up if the caller wants challenge and treatment planning per stage; its prompt availability is unverified.

## Next smallest useful evidence item

Confirm from the live Supabase project that the `profiles` column-level UPDATE grant is applied (bundle G1), and confirm which frontend host (Vercel or Netlify) and which `CORS_ORIGIN` are live (bundle G2) — both change the severity of two candidate scenarios.
