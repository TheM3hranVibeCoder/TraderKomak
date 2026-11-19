# cTrader (US30) setup guide

US30 (Dow Jones) comes from the **cTrader Open API** — cTrader has no
anonymous access like Binance, so a one-time app registration + OAuth token
is required. Everything below is free and takes ~10 minutes.

## How the data flows (why the site stays fast)

```
Visitor's browser ──(wss, JSON)──► demo.ctraderapi.com:5036   ← candles + live ticks
        │                        (visitor's OWN internet — zero Render/Vercel
        │                         bandwidth, same model as OANDA/Binance)
        └──(HTTPS, ~200 B)──► market server /api/ctrader-session
                                 (serves the auto-refreshed access token ONLY —
                                  no candle data ever passes through here)
```

The market server also keeps a cTrader session for the watchlist row price
(coalesced, tiny) and as a chart-history fallback. OAuth access tokens
expire after ~30 days — the server refreshes them automatically with the
refresh token, so you never touch it again after setup.

## Step 1 — Register an Open API application

1. Sign in / create a **cTrader ID** at <https://openapi.ctrader.com>
   (same login as cTrader apps).
2. Open **Open API → Add new app**:
   - Name: e.g. `TraderKomak market data`
   - Redirect URI: `https://traderkomak.ir` (needed once in step 3)
3. Save → copy **Client ID** and **Secret**.

## Step 2 — Make sure you have a DEMO account with US30

- Any cTrader broker demo account works (your existing one is fine).
- US30 must exist on that broker (nearly all offer it as `US30`, sometimes
  `US30.cash` / `USA30` / `DJI30` — the server auto-detects these names; a
  mismatch can be forced with `CTRADER_US30_SYMBOL`).

## Step 3 — Generate the OAuth tokens (access + refresh)

1. Open this URL in a browser (fill in your Client ID):

   ```
   https://openapi.ctrader.com/apps/auth?client_id=YOUR_CLIENT_ID&redirect_uri=https%3A%2F%2Ftraderkomak.ir&scope=trading
   ```

2. Sign in with the cTrader ID that owns the demo account and approve the
   app. You land back on `https://traderkomak.ir/?code=XXXXXXXX` —
   **copy the `code` value** from the address bar (it is single-use).
3. Exchange it for tokens (fill in code + client id + secret):

   ```
   https://openapi.ctrader.com/apps/token?grant_type=authorization_code&code=THE_CODE&redirect_uri=https%3A%2F%2Ftraderkomak.ir&client_id=YOUR_CLIENT_ID&client_secret=YOUR_SECRET
   ```

4. The page shows JSON like:

   ```json
   {
     "accessToken": "..." ,
     "expiresIn": "2592000",
     "refreshToken": "...",
     "tokenType": "bearer"
   }
   ```

   Copy **accessToken** and **refreshToken**.

## Step 4 — Configure the market server (Render env vars)

```
CTRADER_CLIENT_ID=<client id>
CTRADER_CLIENT_SECRET=<secret>
CTRADER_ACCESS_TOKEN=<accessToken>
CTRADER_REFRESH_TOKEN=<refreshToken>
```

Restart the service. In the boot log you should see:

```
cTrader account id discovered from token — copy CTRADER_ACCOUNT_ID into the env for browser-direct
cTrader US30 resolved { name: "US30", symbolId: …, digits: … }
cTrader account session ready
```

- The **numeric account id** is discovered automatically — copy it from
  the log (or `DATA_DIR/ctrader-token.json`) into the web env in step 5
  (and optionally into `CTRADER_ACCOUNT_ID` to skip discovery next boot).
- Tokens rotate automatically afterwards; the current pair lives in
  `DATA_DIR/ctrader-token.json`.

## Step 5 — Enable browser-direct on the web app (Vercel env vars)

```
VITE_CTRADER_CLIENT_ID=<same client id>
VITE_CTRADER_CLIENT_SECRET=<same secret>
VITE_CTRADER_ACCOUNT_ID=<numeric id from the boot log>
```

Redeploy the web app. Done — US30 now streams from the visitor's own
connection; the server only serves the ~200-byte session config and the
watchlist row price.

## Verify

- Watchlist: US30 row shows `CTRADER` and a live price with 2 decimals.
- Chart: US30 at 5s … 1M; price axis shows 2 decimals (e.g. `27500.25`).
- DevTools → Network → WS: a `wss://demo.ctraderapi.com:5036` connection
  (browser-direct path active).

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| OAuth page / probe says `OA client is not in active state` | The app is awaiting Spotware's KYC review (officially ≤3 business days, community reports up to ~7). Nothing is wrong with the credentials — re-run step 3 once the app shows **Active** in the portal. Probe anytime with `cd apps/market-server && npx tsx scripts/ctrader-probe.mts` (tests TLS + framing + app credentials without a token). |
| Log says `CH_ACCESS_TOKEN_INVALID` | The OAuth token was revoked/expired before the server could refresh — re-run step 3 and update the env. |
| `no US30-like symbol on this broker` | Your broker names it differently — set `CTRADER_US30_SYMBOL` to the exact name and restart. |
| Chart shows the server-relay path (no wss connection in DevTools) | `VITE_CTRADER_*` missing on the web build, or cTrader's WS is blocked for this visitor — the server fallback keeps the chart working. |
| Everything is `—` in the watchlist US30 row | Neither path has credentials: check server env (step 4) first — it also feeds the watchlist price. |
| Weekend | US index CFDs close Fri ~21:00 UTC → Sun ~22:00 UTC; empty sub-minute history right after reopen is normal. |

## Security notes

- The **refresh token stays server-side** (Render env / token file) — it is
  the only credential that can mint new tokens, and rotation is
  single-flight on the server so visitors can't invalidate each other.
- The browser holds the demo **app credentials + the current access
  token** (served by `/api/ctrader-session`). This is required by cTrader's
  per-connection handshake and matches the trust model of the OANDA
  practice-token pool the web bundle already carries. The token is
  market-data scope for a demo account — no trading, no funds.
- If you ever want the client secret off the browser bundle, a
  Cloudflare-Worker WS relay (like `oanda-proxy`) can inject the
  handshake — the app already isolates that decision behind
  `ctraderDirectConfigured()`.
