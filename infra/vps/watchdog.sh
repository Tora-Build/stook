#!/bin/bash
# Restart a Stook service that is up but stuck. Run by the watchdog timers.
#   watchdog.sh keeper   no pass (heartbeat) for 5 minutes: restart; rounds failing
#                        (health) for 15: log, and restart once an hour at most
#   watchdog.sh tape     no coin updated for 45 minutes
up() { local ts; ts=$(systemctl show -p ActiveEnterTimestampMonotonic --value "$1"); echo $(( ($(cut -d. -f1 /proc/uptime) * 1000000 - ts) / 1000000 )); }
case "$1" in
  keeper)
    BEAT=/home/zak/ladder-crank.beat
    AGE=$(( $(date +%s) - $(stat -c %Y "$BEAT" 2>/dev/null || echo 0) ))
    if [ "$AGE" -gt 300 ] && [ "$(up stook-keeper)" -gt 300 ]; then
      echo "$(date -u +%FT%TZ) watchdog: no pass for ${AGE}s, restarting" >> /home/zak/ladder-crank.log
      systemctl restart stook-keeper
      exit 0
    fi
    # Alive, but rounds failing: say so every run; restart at most once an
    # hour, since a round the program keeps refusing stays refused.
    SICK=$(( $(date +%s) - $(stat -c %Y /home/zak/ladder-crank.health 2>/dev/null || echo 0) ))
    if [ "$SICK" -gt 900 ] && [ "$(up stook-keeper)" -gt 900 ]; then
      LAST=$(stat -c %Y /home/zak/.stook-keeper-sick-restart 2>/dev/null || echo 0)
      if [ $(( $(date +%s) - LAST )) -gt 3600 ]; then
        echo "$(date -u +%FT%TZ) watchdog: rounds failing for ${SICK}s, restarting (once an hour at most)" >> /home/zak/ladder-crank.log
        touch /home/zak/.stook-keeper-sick-restart
        systemctl restart stook-keeper
      else
        echo "$(date -u +%FT%TZ) watchdog: rounds failing for ${SICK}s" >> /home/zak/ladder-crank.log
      fi
    fi ;;
  tape)
    NEWEST=$(curl -s -m 5 localhost:8791/prices | python3 -c "import sys,json; print(max((v.get('at',0) for v in json.load(sys.stdin).values() if isinstance(v,dict)), default=0))" 2>/dev/null || echo 0)
    AGE=$(( $(date +%s) - ${NEWEST:-0} ))
    if [ "$AGE" -gt 2700 ] && [ "$(up stook-tape)" -gt 600 ]; then
      echo "$(date -u +%FT%TZ) watchdog: prices ${AGE}s old, restarting" >> /home/zak/stook-tape.log
      systemctl restart stook-tape
    fi ;;
esac
