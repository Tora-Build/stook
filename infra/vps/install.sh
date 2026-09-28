#!/bin/bash
# Install or refresh the units on the box. Run there: bash ~/stook/infra/vps/install.sh [stook|soo|all]
# stook-sim.service is installed but never enabled or started here: it is
# started by hand, after review (see README, "Simulated users").
set -euo pipefail
D=$(cd "$(dirname "$0")" && pwd); WHAT=${1:-all}
chmod +x "$D/watchdog.sh" "$D/alert.sh" "$D/health.sh"
units=()
[[ $WHAT == stook || $WHAT == all ]] && units+=(stook-keeper.service stook-tape.service stook-keeper-watchdog.service stook-keeper-watchdog.timer stook-tape-watchdog.service stook-tape-watchdog.timer stook-x@.service stook-x-alert@.service stook-x-morning.timer stook-x-bell.timer stook-resolver-watchdog.service stook-resolver-watchdog.timer stook-health.service stook-health.timer stook-sim.service stook-sim-failed.service)
[[ $WHAT == soo || $WHAT == all ]] && units+=(soo-resolver.service soo-resolver-pass.service soo-resolver-pass.timer)
for u in "${units[@]}"; do sudo install -m 644 "$D/$u" /etc/systemd/system/; done
sudo systemctl daemon-reload
for u in "${units[@]}"; do case $u in *.timer|stook-keeper.service|stook-tape.service|soo-resolver.service) sudo systemctl enable --now "$u";; esac; done
systemctl --no-pager --plain list-units 'stook-*' 'soo-*' | head -20
