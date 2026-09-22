#!/bin/bash
# Keep the keeper running. systemd-logind reaps user processes on logout, so
# "started it once" is not a guarantee; cron runs this every minute.
ROOT=/home/zak_torabuild/stook
LOG=/home/zak_torabuild/ladder-crank.log
pgrep -f "ladder-crank/src/index.mjs --watch" >/dev/null && exit 0
cd "$ROOT/infra/ladder-crank" || exit 1
set -a; . /home/zak_torabuild/stook.env; set +a
setsid /usr/bin/node src/index.mjs --watch >> "$LOG" 2>&1 < /dev/null &
