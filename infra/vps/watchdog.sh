#!/bin/bash
# Restart a Stook service that is up but stuck. Run by the watchdog timers.
#   watchdog.sh keeper   no clean pass (heartbeat) for 5 minutes
#   watchdog.sh tape     no coin updated for 45 minutes
up() { local ts; ts=$(systemctl show -p ActiveEnterTimestampMonotonic --value "$1"); echo $(( ($(cut -d. -f1 /proc/uptime) * 1000000 - ts) / 1000000 )); }
case "$1" in
  keeper)
    BEAT=/home/zak/ladder-crank.beat
    AGE=$(( $(date +%s) - $(stat -c %Y "$BEAT" 2>/dev/null || echo 0) ))
    if [ "$AGE" -gt 300 ] && [ "$(up stook-keeper)" -gt 300 ]; then
      echo "$(date -u +%FT%TZ) watchdog: no clean pass for ${AGE}s, restarting" >> /home/zak/ladder-crank.log
      systemctl restart stook-keeper
    fi ;;
  tape)
    NEWEST=$(curl -s -m 5 localhost:8791/prices | python3 -c "import sys,json; print(max((v.get('at',0) for v in json.load(sys.stdin).values() if isinstance(v,dict)), default=0))" 2>/dev/null || echo 0)
    AGE=$(( $(date +%s) - ${NEWEST:-0} ))
    if [ "$AGE" -gt 2700 ] && [ "$(up stook-tape)" -gt 600 ]; then
      echo "$(date -u +%FT%TZ) watchdog: prices ${AGE}s old, restarting" >> /home/zak/stook-tape.log
      systemctl restart stook-tape
    fi ;;
esac
