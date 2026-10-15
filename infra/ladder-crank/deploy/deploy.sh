#!/bin/bash
# Push the repo to the box (ssh alias `tora`) and restart the Stook services.
#   infra/ladder-crank/deploy/deploy.sh
# The box runs them under systemd (infra/vps/): stook-keeper, stook-tape,
# stook-ledger, stook-tgbot, stook-sim and their watchdog timers. ~/stook.env
# on the box holds the secrets (written by hand, never by this script).
#
# Each service runs from one bundled file built here (infra/vps/bundle.sh), so
# the box keeps no node_modules: no workspace install, no pnpm store. The X
# poster's one module, playwright-core, is installed beside it at the version
# whose browser the box has.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
bash "$ROOT/infra/vps/bundle.sh" >/dev/null
rsync -az --delete \
  --exclude node_modules --exclude target --exclude .git --exclude dist \
  --exclude '.env*' --exclude test-ledger --exclude .anchor --exclude .claude --exclude .agents \
  "$ROOT/" tora:stook/
ssh tora bash <<'REMOTE'
set -e
cd ~/stook/infra/x-poster
PW=1.63.0
if [ "$(node -p "require('./node_modules/playwright-core/package.json').version" 2>/dev/null)" != "$PW" ]; then
  rm -rf node_modules && npm install --no-save --no-package-lock --omit=dev --no-audit --no-fund "playwright-core@$PW" >/dev/null
fi
cd ~/stook
bash infra/vps/install.sh stook >/dev/null
sudo systemctl restart stook-keeper stook-tape stook-ledger stook-tgbot
sudo systemctl try-restart stook-sim
sleep 5
systemctl is-active stook-keeper stook-tape stook-ledger stook-tgbot
tail -3 ~/ladder-crank.log; tail -3 ~/stook-tape.log
REMOTE
