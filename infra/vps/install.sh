#!/bin/bash
# Install or refresh the units on the box. Run there: bash ~/stook/infra/vps/install.sh [stook|soo|all]
set -euo pipefail
D=$(cd "$(dirname "$0")" && pwd); WHAT=${1:-all}
chmod +x "$D/watchdog.sh" "$D/alert.sh"
units=()
[[ $WHAT == stook || $WHAT == all ]] && units+=(stook-keeper-mainnet.service stook-ledger-mainnet.service stook-tape.service stook-keeper-mainnet-watchdog.service stook-keeper-mainnet-watchdog.timer stook-ledger-watchdog.service stook-ledger-watchdog.timer stook-tape-watchdog.service stook-tape-watchdog.timer stook-resolver-watchdog.service stook-resolver-watchdog.timer stook-health.service stook-health.timer stook-monitor.service stook-monitor.timer stook-bot.service stook-x@.service stook-x-alert@.service stook-x-bell.timer stook-x-morning.timer)
[[ $WHAT == soo || $WHAT == all ]] && units+=(soo-resolver.service soo-resolver-pass.service soo-resolver-pass.timer)
for u in "${units[@]}"; do sudo install -m 644 "$D/$u" /etc/systemd/system/; done
sudo systemctl daemon-reload
for u in "${units[@]}"; do case $u in *.timer|stook-keeper-mainnet.service|stook-ledger-mainnet.service|stook-tape.service|stook-bot.service|soo-resolver.service) sudo systemctl enable --now "$u";; esac; done
systemctl --no-pager --plain list-units 'stook-*' 'soo-*' | head -20
