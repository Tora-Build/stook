#!/bin/bash
# Install or refresh the units on the box. Run there: bash ~/stook/infra/vps/install.sh [stook|soo|all]
set -euo pipefail
D=$(cd "$(dirname "$0")" && pwd); WHAT=${1:-all}
chmod +x "$D/watchdog.sh"
units=()
[[ $WHAT == stook || $WHAT == all ]] && units+=(stook-keeper.service stook-tape.service stook-keeper-watchdog.service stook-keeper-watchdog.timer stook-tape-watchdog.service stook-tape-watchdog.timer stook-x@.service stook-x-morning.timer stook-x-bell.timer)
[[ $WHAT == soo || $WHAT == all ]] && units+=(soo-resolver.service soo-resolver-pass.service soo-resolver-pass.timer)
for u in "${units[@]}"; do sudo install -m 644 "$D/$u" /etc/systemd/system/; done
sudo systemctl daemon-reload
for u in "${units[@]}"; do case $u in *.timer|stook-keeper.service|stook-tape.service|soo-resolver.service) sudo systemctl enable --now "$u";; esac; done
systemctl --no-pager --plain list-units 'stook-*' 'soo-*' | head -20
