#!/bin/bash
# Push the repo to the box (ssh alias `tora`) and restart the Stook services.
#   infra/ladder-crank/deploy/deploy.sh
# The box runs them under systemd (infra/vps/): stook-keeper, stook-tape and
# their watchdog timers. ~/stook.env on the box holds the secrets (written by
# hand, never by this script).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
rsync -az --delete \
  --exclude node_modules --exclude target --exclude .git --exclude dist \
  --exclude '.env*' --exclude test-ledger --exclude .anchor \
  "$ROOT/" tora:stook/
ssh tora bash <<'REMOTE'
set -e
cd ~/stook
pnpm install --frozen-lockfile >/dev/null 2>&1 || pnpm install >/dev/null
pnpm -F @sooth/sdk-solana build >/dev/null
bash infra/vps/install.sh stook >/dev/null
sudo systemctl restart stook-keeper stook-tape
sleep 5
systemctl is-active stook-keeper stook-tape
tail -3 ~/ladder-crank.log; tail -3 ~/stook-tape.log
REMOTE
