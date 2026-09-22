#!/bin/bash
# Keep the tape running; cron runs this every minute.
ROOT=/home/zak_torabuild/stook
LOG=/home/zak_torabuild/stook-tape.log
pgrep -f "$ROOT/infra/tape/src/index.mjs" >/dev/null && exit 0
cd "$ROOT/infra/tape" || exit 1
set -a; . /home/zak_torabuild/stook.env; set +a
setsid /usr/bin/node "$ROOT/infra/tape/src/index.mjs" >> "$LOG" 2>&1 < /dev/null &
