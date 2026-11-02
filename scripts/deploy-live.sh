#!/usr/bin/env bash
# Deploys the game to its CloudPanel Node.js site, from this PC (Git Bash):
#   bash scripts/deploy-live.sh
# One Node server serves the game's pages and runs the multiplayer rooms (/ws) on the same domain.
#
# Reads cloudpanel-live.json (not in git; the repo is public):
#   { "domain": "mahjong.schuahsolutions.com", "user": "<site SSH user>", "host": "<VM address>", "sshPort": 4444,
#     "appPort": 3500 }
#
# Builds the game (out/) and the one-file server, uploads both, and swaps the game's files in at once (nobody
# loads a half-updated game). The server only restarts when its own code changed, so rooms in progress
# survive a website-only update; a server change closes every open room (rooms live in memory).
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f cloudpanel-live.json ] || { echo "FAILED: cloudpanel-live.json is missing (see docs/MULTIPLAYER.md)." >&2; exit 1; }
cfg() { node -e "const c=require('./cloudpanel-live.json'); const v=c['$1']; process.stdout.write(v===undefined?'$2':String(v))"; }
DOMAIN="$(cfg domain '')"; USER_="$(cfg user '')"; HOST="$(cfg host 192.168.100.44)"; SSHPORT="$(cfg sshPort 4444)"; APPPORT="$(cfg appPort 3500)"
[ -n "$DOMAIN" ] && [ -n "$USER_" ] || { echo "FAILED: cloudpanel-live.json needs domain and user." >&2; exit 1; }
APP="/home/$USER_/htdocs/$DOMAIN"
SSH=(ssh -o BatchMode=yes -p "$SSHPORT" "$USER_@$HOST")

if [ -n "$(git status --porcelain -- src public scripts package.json)" ]; then
  echo "Note: there are uncommitted changes; deploying the files as they are now (commit $(git rev-parse --short HEAD) + changes)."
fi
echo "Building the game and the server..."
npm run build --silent >/dev/null
npm run build:server --silent >/dev/null
AI_FILE="$(node -e "process.stdout.write(require('./src/ai/web-model.json').file)")"
cat > server-dist/ecosystem.config.cjs <<EOF
// pm2 settings for the game's server (written by scripts/deploy-live.sh).
module.exports = { apps: [{
  name: 'mahjong', script: 'server.mjs', cwd: __dirname,
  env: { PORT: '$APPPORT', STATIC_DIR: __dirname + '/site', ALLOWED_ORIGINS: 'https://$DOMAIN', AI_MODEL: __dirname + '/site/ai/$AI_FILE', NODE_ENV: 'production' },
  max_memory_restart: '400M',
}] };
EOF
LOCAL_SUM="$(sha256sum server-dist/server.mjs | cut -d' ' -f1)"

echo "Uploading to $DOMAIN..."
# Server files beside the site (server.mjs, ecosystem), and the game into site.new, swapped in below.
rm -rf deploy-stage && mkdir -p deploy-stage/server
cp server-dist/server.mjs server-dist/ecosystem.config.cjs deploy-stage/server/
cp -r out deploy-stage/site.new
tar -czf - -C deploy-stage . | "${SSH[@]}" "mkdir -p '$APP/incoming' && rm -rf '$APP/incoming'/* && tar -xmzf - -C '$APP/incoming'"
rm -rf deploy-stage

echo "Switching over..."
"${SSH[@]}" bash -s <<EOF
set -euo pipefail
cd '$APP'
REMOTE_SUM="\$(sha256sum server.mjs 2>/dev/null | cut -d' ' -f1 || true)"
# The game's files: swap the whole folder at once.
rm -rf site.old
[ -d site ] && mv site site.old
mv incoming/site.new site
cp incoming/server/server.mjs incoming/server/ecosystem.config.cjs .
rm -rf incoming site.old

NODE_BIN="\$(ls -d "\$HOME"/.nvm/versions/node/v*/bin 2>/dev/null | sort -V | tail -1)"
[ -n "\$NODE_BIN" ] || { echo "FAILED: no Node.js for this site user (create the site as a Node.js site in CloudPanel)." >&2; exit 1; }
export PATH="\$NODE_BIN:\$PATH"
command -v pm2 >/dev/null || npm i -g pm2 --no-audit --no-fund >/dev/null
if ! pm2 describe mahjong >/dev/null 2>&1; then
  pm2 start ecosystem.config.cjs >/dev/null; echo "server started"
elif [ "\$REMOTE_SUM" != "$LOCAL_SUM" ]; then
  pm2 reload ecosystem.config.cjs --update-env >/dev/null; echo "server code changed: restarted (open rooms were closed)"
else
  echo "server unchanged: not restarted (open rooms carry on)"
fi
pm2 save >/dev/null
CRON="@reboot PATH=\$NODE_BIN:/usr/bin:/bin pm2 resurrect"
{ crontab -l 2>/dev/null | grep -v "pm2 resurrect" || true; echo "\$CRON"; } | crontab -
sleep 1
echo "on the server: \$(curl -s --max-time 5 http://127.0.0.1:$APPPORT/health)"
EOF

echo "Checking from the internet..."
echo "  game page: HTTP $(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://$DOMAIN/")"
echo "  server:    $(curl -s --max-time 15 "https://$DOMAIN/health")"
echo "Deployed https://$DOMAIN/"
