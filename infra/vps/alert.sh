#!/bin/bash
# Telegram alerts from the box. Keys live in /home/zak/stook-alerts.env
# (TG_BOT_TOKEN, TG_CHAT_ID), written by hand, never in the repo.
#   alert.sh <key> <message>        say something is wrong (once an hour per key)
#   alert.sh --ok <key> <message>   say it recovered (only if it had alerted)
#   alert.sh --report <message>     send as is (the daily report)
#   alert.sh --channel <message>    post to the public channel (TG_CHANNEL)
#   alert.sh --test                 send a test message
ENV=/home/zak/stook-alerts.env
STATE=/home/zak/.stook-alerts
[ -r "$ENV" ] || exit 0
# shellcheck disable=SC1090
. "$ENV"
[ -n "$TG_BOT_TOKEN" ] && [ -n "$TG_CHAT_ID" ] || exit 0
mkdir -p "$STATE"

send() {
  curl -s -m 10 -o /dev/null "https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${TG_CHAT_ID}" --data-urlencode "text=$1" --data-urlencode "disable_web_page_preview=true"
}

case "$1" in
  --report) send "$2" ;;
  --channel) [ -n "$TG_CHANNEL" ] && TG_CHAT_ID=$TG_CHANNEL send "$2" ;;
  --test) send "✅ Stook alerts are set up on $(hostname). You'll hear from me when something breaks." ;;
  --ok)
    [ -f "$STATE/$2" ] || exit 0
    rm -f "$STATE/$2"
    send "✅ ${3}" ;;
  *)
    LAST=$(stat -c %Y "$STATE/$1" 2>/dev/null || echo 0)
    [ $(( $(date +%s) - LAST )) -lt 3600 ] && exit 0
    touch "$STATE/$1"
    send "🚨 ${2}" ;;
esac
