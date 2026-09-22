#!/bin/bash
# Keep the keeper running. systemd-logind reaps user processes on logout, so
# "started it once" is not a guarantee; cron runs this every minute.
ROOT=/home/zak_torabuild/stook
LOG=/home/zak_torabuild/ladder-crank.log
# Match on the absolute path we launch with; a relative match would miss it
# and cron would start a new keeper every minute.
pgrep -f "$ROOT/infra/ladder-crank/src/index.mjs --watch" >/dev/null && exit 0
cd "$ROOT/infra/ladder-crank" || exit 1
set -a; . /home/zak_torabuild/stook.env; set +a
setsid /usr/bin/node "$ROOT/infra/ladder-crank/src/index.mjs" --watch >> "$LOG" 2>&1 < /dev/null &
