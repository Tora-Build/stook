#!/bin/bash
# Keep the tape running and fresh. cron runs this every minute.
#  - not running: start it.
#  - running but no coin updated for 45 minutes: restart it (its sockets can
#    go quiet while the process lives on, as on 2026-09-25).
ROOT=/home/zak_torabuild/stook
LOG=/home/zak_torabuild/stook-tape.log
PROC="$ROOT/infra/tape/src/index.mjs"
start() {
  cd "$ROOT/infra/tape" || exit 1
  set -a; . /home/zak_torabuild/stook.env; set +a
  setsid /usr/bin/node "$ROOT/infra/tape/src/index.mjs" >> "$LOG" 2>&1 < /dev/null &
}
if ! pgrep -f "$PROC" >/dev/null; then start; exit 0; fi
NEWEST=$(curl -s -m 5 localhost:${PORT:-8791}/prices | python3 -c "import sys,json; print(max((v.get('at',0) for v in json.load(sys.stdin).values() if isinstance(v,dict)), default=0))" 2>/dev/null || echo 0)
UP=$(ps -o etimes= -p "$(pgrep -f "$PROC" | head -1)" | tr -d ' ')
if [ "$(( $(date +%s) - ${NEWEST:-0} ))" -gt 2700 ] && [ "${UP:-0}" -gt 600 ]; then
  echo "$(date -u +%FT%TZ) watchdog: prices $(( $(date +%s) - ${NEWEST:-0} ))s old, restarting" >> "$LOG"
  pkill -f "$PROC"; sleep 2; start
fi
