#!/bin/bash
# Keep the keeper running and working. cron runs this every minute.
#  - not running: start it (systemd-logind reaps user processes on logout).
#  - running but no clean pass for 5 minutes: restart it. A process can stay
#    up with every request failing ("fetch failed"), as on 2026-09-25, when it
#    missed a round's opening and the round was voided.
ROOT=/home/zak_torabuild/stook
LOG=/home/zak_torabuild/ladder-crank.log
BEAT=/home/zak_torabuild/ladder-crank.beat
PROC="$ROOT/infra/ladder-crank/src/index.mjs --watch"
start() {
  cd "$ROOT/infra/ladder-crank" || exit 1
  set -a; . /home/zak_torabuild/stook.env; set +a
  setsid /usr/bin/node "$ROOT/infra/ladder-crank/src/index.mjs" --watch >> "$LOG" 2>&1 < /dev/null &
}
alert() { # optional: a Telegram message if TG_BOT_TOKEN and TG_CHAT_ID are set in stook.env
  set -a; . /home/zak_torabuild/stook.env; set +a
  [ -n "$TG_BOT_TOKEN" ] && [ -n "$TG_CHAT_ID" ] && curl -s -m 10 "https://api.telegram.org/bot$TG_BOT_TOKEN/sendMessage" -d chat_id="$TG_CHAT_ID" --data-urlencode text="$1" >/dev/null
}
if ! pgrep -f "$PROC" >/dev/null; then start; exit 0; fi
# Allow a fresh process 5 minutes to make its first clean pass.
age() { echo $(( $(date +%s) - $(stat -c %Y "$1" 2>/dev/null || echo 0) )); }
if [ "$(age "$BEAT")" -gt 300 ] && [ "$(ps -o etimes= -p "$(pgrep -f "$PROC" | head -1)" | tr -d ' ')" -gt 300 ]; then
  echo "$(date -u +%FT%TZ) watchdog: no clean pass for $(age "$BEAT")s, restarting" >> "$LOG"
  pkill -f "$PROC"; sleep 2; start
  alert "Stook keeper was stuck (no clean pass for $(age "$BEAT")s) and has been restarted."
fi
