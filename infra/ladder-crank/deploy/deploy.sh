#!/bin/bash
# Push the repo to the tora box and (re)start the keeper there.
#   infra/ladder-crank/deploy/deploy.sh
# Assumes: ssh alias `tora`, ~/stook.env on the box holding PYTH_API_KEY,
# KEYPAIR, RPC_URL (written once by hand, never by this script).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
rsync -az --delete \
  --exclude node_modules --exclude target --exclude .git --exclude dist \
  --exclude '.env*' --exclude test-ledger --exclude .anchor \
  "$ROOT/" tora:stook/
ssh tora bash <<'REMOTE'
cd ~/stook
pnpm install --prefer-offline >/dev/null 2>&1 || pnpm install >/dev/null
pnpm -F @sooth/sdk-solana build >/dev/null
install -m 755 infra/ladder-crank/deploy/keepalive.sh ~/ladder-crank-keepalive.sh
( crontab -l 2>/dev/null | grep -v ladder-crank-keepalive; echo "* * * * * /home/zak_torabuild/ladder-crank-keepalive.sh" ) | crontab -
pkill -f "index.mjs --watch" || true
~/ladder-crank-keepalive.sh
sleep 3
echo "keepers running: $(pgrep -fc "index.mjs --watch")"
tail -3 ~/ladder-crank.log 2>/dev/null
REMOTE
