#!/usr/bin/env bash
# Deploys the multiplayer server to its CloudPanel Node.js site, from this PC (Git Bash):
#   bash scripts/deploy-live.sh
# Reads cloudpanel-live.json (not in git; the repo is public):
#   { "domain": "<the server's domain>", "user": "<site SSH user>", "host": "<VM address>", "sshPort": 4444,
#     "appPort": 3300, "origins": "https://mahjong.schuahsolutions.com" }
# Builds the one-file server, uploads it with the AI's weights, and (re)starts it with pm2 on the server.
# Rooms live in memory, so a deploy closes every open room: deploy when nobody is playing.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f cloudpanel-live.json ] || { echo "FAILED: cloudpanel-live.json is missing (see docs/MULTIPLAYER.md)." >&2; exit 1; }
cfg() { node -e "const c=require('./cloudpanel-live.json'); const v=c['$1']; process.stdout.write(v===undefined?'$2':String(v))"; }
DOMAIN="$(cfg domain '')"; USER_="$(cfg user '')"; HOST="$(cfg host 192.168.100.44)"; SSHPORT="$(cfg sshPort 4444)"
APPPORT="$(cfg appPort 3300)"; ORIGINS="$(cfg origins https://mahjong.schuahsolutions.com)"
[ -n "$DOMAIN" ] && [ -n "$USER_" ] || { echo "FAILED: cloudpanel-live.json needs domain and user." >&2; exit 1; }
APP="/home/$USER_/htdocs/$DOMAIN"
SSH=(ssh -o BatchMode=yes -p "$SSHPORT" "$USER_@$HOST")

if [ -n "$(git status --porcelain -- src scripts package.json)" ]; then
  echo "Note: there are uncommitted changes; the server is built from the files as they are now."
fi
echo "Building the server..."
npm run build:server --silent
AI_FILE="$(node -e "process.stdout.write(require('./src/ai/web-model.json').file)")"
cat > server-dist/ecosystem.config.cjs <<EOF
// pm2 settings for the multiplayer server (written by scripts/deploy-live.sh).
module.exports = { apps: [{
  name: 'mahjong-live', script: 'server.mjs', cwd: __dirname,
  env: { PORT: '$APPPORT', ALLOWED_ORIGINS: '$ORIGINS', AI_MODEL: __dirname + '/ai/$AI_FILE', NODE_ENV: 'production' },
  max_memory_restart: '400M',
}] };
EOF

echo "Uploading to $DOMAIN..."
tar -czf - -C server-dist . | "${SSH[@]}" "mkdir -p '$APP' && rm -rf '$APP/ai' && tar -xzf - -C '$APP'"

echo "Starting it..."
"${SSH[@]}" bash -s <<EOF
set -euo pipefail
NODE_BIN="\$(ls -d "\$HOME"/.nvm/versions/node/v*/bin 2>/dev/null | sort -V | tail -1)"
[ -n "\$NODE_BIN" ] || { echo "FAILED: no Node.js for this site user (create the site as a Node.js site in CloudPanel)." >&2; exit 1; }
export PATH="\$NODE_BIN:\$PATH"
cd '$APP'
command -v pm2 >/dev/null || npm i -g pm2 --no-audit --no-fund >/dev/null
if pm2 describe mahjong-live >/dev/null 2>&1; then pm2 reload ecosystem.config.cjs --update-env; else pm2 start ecosystem.config.cjs; fi
pm2 save >/dev/null
CRON="@reboot PATH=\$NODE_BIN:/usr/bin:/bin pm2 resurrect"
{ crontab -l 2>/dev/null | grep -v "pm2 resurrect" || true; echo "\$CRON"; } | crontab -
sleep 1
curl -s --max-time 5 http://127.0.0.1:$APPPORT/health
EOF

echo "Checking it from the internet..."
curl -s --max-time 10 "https://$DOMAIN/health" || echo "Not reachable from outside yet (DNS or SSL still to do?)."
echo "Deployed. The game connects to wss://$DOMAIN/ws"
