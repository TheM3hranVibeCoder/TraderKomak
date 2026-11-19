# Security checklist — actions that need YOUR dashboards

Code fixes alone can't complete the threat-model findings below. Work through
these in order; each is 1–5 minutes. (Source: `threat-model/2026-10-29-quick/`.)

## 1. Verify the admin-escalation fix is live (closes T-06) — do this first

Open **Supabase → SQL Editor** and run:

```sql
select grantee, privilege_type, column_name
from information_schema.column_privileges
where table_name = 'profiles' and privilege_type = 'UPDATE';
```

- **Expected:** UPDATE appears only on `username`, `username_lower`, `avatar_url`
  — and **never** on `is_admin`.
- If `is_admin` (or all columns via table-level grant) shows up, run the whole
  `supabase/fix-admin-escalation.sql` script immediately, then re-run the check.
- While you're there: rotate the chat moderator key (step 2) — the fix script
  itself recommends it.

## 2. Rotate the chat moderator key (closes T-03's old-key exposure)

Use a long random value (e.g. `openssl rand -hex 32` or a password manager).
The SAME value must go to all three places:

1. **Render** → your market-server service → Environment → `CHAT_ADMIN_KEY`
2. **Supabase → SQL Editor**:
   ```sql
   update public.admin_settings set admin_key = '<new-key>' where id = 1;
   ```
3. **Redeploy** the market server after saving the Render env var (Render
   redeploys on save if auto-deploy is on; otherwise deploy manually).

Admins re-login on the site afterward and the new key reaches them
automatically from `admin_settings`. Note: `VITE_…` values are unrelated here —
do NOT put the key in any `VITE_*` variable.

## 3. Confirm production values (closes G-2 / T-10 / T-11 conditions)

- **Render** → `CORS_ORIGIN`: must be an explicit list, e.g.
  `https://traderkomak.ir,https://www.traderkomak.ir` — never `*`.
- Decide whether the Binance relay is used by another server:
  - No → leave `BINANCE_RELAY_SECRET` empty (relay disabled — its default).
  - Yes → keep it set; the comparison is now constant-time. The secret still
    travels in the URL path (accepted; public market data only).
- Confirm which frontend host is live (Vercel sends CSP; Netlify currently
  defines no security headers). If Netlify ever becomes the live host, port
  the `headers` block from `vercel.json` first.

## 4. Optional hardening: edge-worker attested IP (upgrades the new IP rules)

The server now derives visitor IPs structurally (forge-proof against ordinary
header spoofing). To also close the "attacker runs their own Cloudflare Worker"
spoof:

1. Generate a long random secret.
2. **Cloudflare** → `cd cloudflare-worker/edge && npx wrangler secret put EDGE_SHARED_SECRET`
   then `npx wrangler deploy`.
3. **Render** → add `EDGE_SHARED_SECRET` with the same value → redeploy.

The order doesn't matter — every partial state is safe (the server falls back
to its structural rules). Omitting this entirely is also fine.

## 5. Deploy order for this code change

Any order works, no coordination needed:

1. **Market server (Render/VPS)** — new client-IP resolution + chat fixes.
   Old web bundles keep working: joins without a token from a registered name
   get a clear "sign in with Google" error, and `versionCheck` auto-reloads
   visitors onto the new bundle.
2. **Web frontend (Vercel)** — sends the Supabase token with chat joins;
   session cookie mirror becomes `Secure`.
3. **Edge worker** (if you use it) — overwrites XFF instead of appending.

## What changed in code (summary)

| Fix | Files |
|---|---|
| Visitor IP no longer spoofable via `X-Forwarded-For` | `apps/market-server/src/util/clientIp.ts` (new), `src/app.ts`, `src/routes/candles.ts`, `src/chat/chatRoom.ts`, `cloudflare-worker/edge/edge-proxy.js` |
| Chat: registered usernames require ownership proof | `src/chat/chatRoom.ts` (server verification vs Supabase), `apps/web/src/services/chatClient.ts`, `apps/web/src/stores/chat.ts` (token in join frame) |
| Chat: 15s cooldown now per-nick (reconnect can't reset it) | `src/chat/chatRoom.ts` |
| Admin DMs prefer verified connections | `src/chat/chatRoom.ts` |
| Cookies: `Secure` attribute in production | `apps/web/src/services/supabase.ts`, `apps/web/src/stores/auth.ts` |
| Binance relay secret compared constant-time | `src/routes/binance-relay.ts`, `src/util/secure.ts` (new) |

Verified: `npm run typecheck` ✓ · `npm run test` (75/75) ✓ · `npm run lint`
(0 errors) ✓ · `npm run build` ✓

## Known residuals (accepted for now)

- OANDA practice-token pool in the browser bundle — kept by decision (demo
  accounts); rotation + worker fallback already mitigate.
- Guests can still collide on unregistered nicknames (no identity exists for
  them); registered-name impersonation is now blocked server-side.
- Chat roster keeps IPs indefinitely; `RECORD_LOCATION = false` in
  `apps/web/src/services/location.ts` is the off switch for self-reported IPs.
- Dependency audit not run (needs network) — worth one `npm audit` pass.
