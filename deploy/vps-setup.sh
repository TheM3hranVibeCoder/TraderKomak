#!/usr/bin/env bash
# =============================================================================
# TraderKomak — one-shot VPS setup (Ubuntu 22.04 / 24.04, run as root)
#
# Installs Node 20 + pm2 + Caddy, clones the repo, builds the market server,
# and runs it as a service with automatic HTTPS for edge.traderkomak.ir.
#
# Usage:  bash vps-setup.sh
# Re-run safe: it skips completed steps.
# =============================================================================
set -euo pipefail

DOMAIN="edge.traderkomak.ir"           # the hostname browsers connect to
APP_DIR="/opt/traderkomak/app"
REPO_BASE="https://github.com/TheM3hranVibeCoder/TraderKomak.git"
PORT=8080

# The repo is PRIVATE — pass a GitHub token (classic, "repo" scope) as the
# first argument so the script can download it:
#   bash vps-setup.sh ghp_xxxxxxxxxxxx
GH_TOKEN="${1:-}"
REPO_URL="$REPO_BASE"
if [ -n "$GH_TOKEN" ]; then
  REPO_URL="https://x-access-token:${GH_TOKEN}@github.com/TheM3hranVibeCoder/TraderKomak.git"
fi

echo "==> 1/7 Base packages"
apt-get update -qq
apt-get install -y -qq curl git ca-certificates >/dev/null

echo "==> 2/7 Node.js 20 + pm2"
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
fi
node -v
command -v pm2 >/dev/null 2>&1 || npm install -g --silent pm2

echo "==> 3/7 Code"
if [ -d "$APP_DIR/.git" ]; then
  cd "$APP_DIR" && git pull --ff-only
else
  git clone "$REPO_URL" "$APP_DIR" && cd "$APP_DIR"
  # keep the token in the remote so future re-runs can pull updates
  git remote set-url origin "$REPO_URL"
fi
npm ci --silent
npm run build:shared --silent
npm run build --silent -w @traderkomak/market-server

echo "==> 4/7 Environment (.env)"
if [ ! -f "$APP_DIR/.env" ]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  echo "  Created $APP_DIR/.env — EDIT IT NOW and fill in the real values"
  echo "  (copy them from your Render dashboard → Environment):"
  echo "    PORT=8080  HOST=0.0.0.0"
  echo "    OANDA_API_URL / OANDA_STREAM_URL / OANDA_ACCESS_TOKEN / OANDA_ACCOUNT_ID"
  echo "    BINANCE_API_URL / BINANCE_STREAM_URL"
  echo "    CHAT_ADMIN_KEY=<your key>  CHAT_OWNER_NICK=MrM3hran"
  echo "    CORS_ORIGIN=https://traderkomak.ir,https://www.traderkomak.ir"
  echo "    UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN"
  echo "    PERSISTENT_AGGREGATIONS=EUR_USD:5s"
  echo "    DATA_DIR=/opt/traderkomak/data"
  echo "  Then re-run this script to (re)start the service."
fi
mkdir -p /opt/traderkomak/data

echo "==> 5/7 Start under pm2"
cd "$APP_DIR/apps/market-server"
# pm2's global bin can land outside sudo's secure PATH — resolve it
PM2_BIN="$(command -v pm2 || true)"
if [ -z "$PM2_BIN" ] && command -v npm >/dev/null 2>&1; then
  PM2_BIN="$(npm prefix -g 2>/dev/null)/bin/pm2"
fi
if [ -z "$PM2_BIN" ] || [ ! -x "$PM2_BIN" ]; then
  npm install -g --no-silent pm2 || npm install -g pm2
  PM2_BIN="$(command -v pm2 || echo "$(npm prefix -g)/bin/pm2")"
fi
echo "pm2: $PM2_BIN"
if "$PM2_BIN" describe traderkomak-server >/dev/null 2>&1; then
  "$PM2_BIN" restart traderkomak-server --update-env
else
  "$PM2_BIN" start dist/index.js --name traderkomak-server --time
fi
"$PM2_BIN" save
"$PM2_BIN" startup systemd -u root --hp /root >/dev/null 2>&1 || true

echo "==> 6/7 Caddy (automatic HTTPS for $DOMAIN)"
apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https >/dev/null
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>/dev/null || true
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
apt-get update -qq && apt-get install -y -qq caddy
cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
    reverse_proxy 127.0.0.1:$PORT
}
EOF
systemctl reload caddy 2>/dev/null || systemctl restart caddy

echo "==> 7/7 Health check"
sleep 2
curl -fsS "http://127.0.0.1:$PORT/health" && echo " <- server OK (local)"
echo ""
echo "DONE. Now make sure DNS points $DOMAIN at THIS server's IP"
echo "(Cloudflare DNS → A record $DOMAIN → your VPS IP → set to DNS ONLY,"
echo " the GREY cloud — so visitors connect directly, no Cloudflare in the"
echo " middle). Caddy will obtain the HTTPS certificate automatically."
echo "Logs: pm2 logs traderkomak-server"
