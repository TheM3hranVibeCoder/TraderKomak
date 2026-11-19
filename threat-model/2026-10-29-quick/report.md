# TraderKomak — Quick Web Threat Analysis (2026-10-29)

**This is a quick analysis.** It ran one baseline pass over read-only repository evidence at revision `a21edd3` (grim-prompter, quick mode, architecture `web` with bounded secondaries `collaboration-realtime` and `serverless`). It did **not**: execute any threat-modeling method, run the six-stage deep process, challenge the model, scan dependencies, contact any live system, verify the live Supabase RLS state, or rate any risk (no rubric was supplied — all risks are deliberately unrated). Verification designs below are `not_run` plans, not authorizations.

Artifacts: `SYSTEM_UNDER_REVIEW.md` (evidence bundle) · `selection.json`/`selection.md` (architecture selection) · `quick-report.json` (machine-readable model) · this file.

## Scope

Vue 3 SPA + Fastify market server (unauthenticated market WebSocket `/ws`, community chat `/chat`) + Supabase (Google auth, profiles, user_emails, admin_settings) + Cloudflare Workers (edge / oanda-proxy / binance-proxy / warmup) + Netlify candles function. Out of scope: runtime hosts, dependency audit, CI/CD, `.env` values.

## Assumptions

- The deployed frontend is the Vercel path (CSP lives only there; Netlify has no headers — unconfirmed which is live).
- Production env values match `render.yaml` intent (secrets set in dashboards, `CORS_ORIGIN` explicit).

## Most consequential grounded scenarios

1. **Client-IP authority is attacker-chosen (T-01, evidenced).** Fastify runs `trustProxy: true` and the edge worker forwards client-supplied `X-Forwarded-For` ahead of the real IP. Every per-IP control — the candles rate limiter, chat image limiter, chat IP bans, roster-recorded IPs — binds to an address the attacker picks. Fix direction: trust only the attesting hop; overwrite (not append) XFF at the edge. (`TR-01`, `VF-01`)
2. **Chat identity is whoever claims a nick (T-02, evidenced).** Any visitor can join with a registered user's username (only the owner nick is reserved; roster filtering is display-only). They can speak as the victim and — when the victim is offline — intercept the admin's direct messages addressed to that nick. Fix direction: verifiable proof at join (Supabase-derived token) or server-side reservation of registered usernames. (`TR-02`, `VF-02`)
3. **Possible live admin escalation — one SQL query decides (T-06, hypothesis).** The repo contains the fix for the is_admin self-promotion hole, but whether it was ever run on the live project is unknowable from code. If unapplied, any signed-in user becomes admin (all emails/IPs + moderator key). Action: run the verification query in `supabase/fix-admin-escalation.sql` — 2 minutes, and rotate the moderator key either way (the fix script itself recommends rotation). (`TR-03`, `VF-03`)
4. **Open relays invite quota/token burn (T-04 + T-05, evidenced).** The oanda/binance/edge workers are unauthenticated, rate-limit-free, and their URLs ship in the public CSP allowlist; two OANDA practice tokens ship in the bundle (deliberate, documented — but contradicting AGENTS.md's own invariant; recorded as an unresolved conflict `CF-01`). Harm is availability: burned practice-token rate limits and Cloudflare quotas take the data path down for everyone. Fix direction: caller decision on the pool (`DC-02`), plus worker-side throttling/origin rules. (`TR-04`, `VF-05`)
5. **Chat abuse controls bind to connections, not identities (T-08, evidenced).** The 15s cooldown resets on reconnect, unlimited sockets may share one nick, and with T-01 the attacker also rotates IPs. Compensating bounds exist (history cap, image cap, frame cap). Fix direction: per-nick cooldown + nick uniqueness + per-IP socket cap. (`TR-06`, `VF-07`)

Also recorded: moderator key + session JWT in localStorage with a non-`Secure` cookie mirror (T-03/T-09), self-reported admin-panel data + indefinite IP retention + third-party IP transmission (T-07), reflect-all CORS default (T-10, config-dependent), Binance relay secret in URL path with non-constant-time compare (T-11, config-dependent).

## Protective evidence (controls observed in code)

Strict frame/route validation everywhere (shared WS validator, whitelists on server, Netlify function, worker); constant-time chat-key compare; image data-URL constraints with nosniff; CSP + security headers on the Vercel path; RLS on all tables with the column-level UPDATE grant in the schema; pino redaction; GET-only CORS; GET-only server surface means no classic CSRF state-change path; no user-content HTML sink found (`v-html` is static icons only).

## Proposed outcomes (all proposed, none implemented)

| ID | Threat | Outcome (short) |
|---|---|---|
| TR-01 | T-01 | Attest-hop-only proxy trust; edge overwrites XFF with CF-Connecting-IP |
| TR-02 | T-02 | Verifiable identity proof for registered chat usernames |
| TR-03 | T-03, T-06, T-09 | Rotate moderator key; Secure cookies; key out of localStorage |
| TR-04 | T-04, T-05 | Decide pool-vs-worker posture; harden workers (rate limits/origin rules) |
| TR-05 | T-07 | Label/self-report location data; cap roster IP retention |
| TR-06 | T-08 | Per-nick cooldown, nick uniqueness, per-IP socket cap |
| TR-07 | T-09, T-10, T-11 | Secure cookie; explicit CORS list; relay secret to header + constant-time |

Each has alternatives and tradeoffs in `quick-report.json`, and every open risk is unrated pending a rubric (proposed decision `DC-01`).

## Next verification (cheapest first, none run)

1. Run the RLS verification query on the live project (`VF-03`) — decides T-06 in minutes.
2. Read production values from dashboards: `CORS_ORIGIN`, `BINANCE_RELAY_SECRET`, live frontend host (`G-2`, `VF-04`).
3. Authorized forged-XFF probe (`VF-01`), synthetic chat-impersonation test (`VF-02`), worker/OANDA quota review (`VF-05`).

## Analysis limits

Reading code is implementation evidence, not proof of runtime behavior. Live DB state, deployed headers, production env values and Render's XFF handling remain open gaps (`G-1`…`G-6`). Counts of records here do not measure severity or assurance. A threat model does not certify that the system is secure.
