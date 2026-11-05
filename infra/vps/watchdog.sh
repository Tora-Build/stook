#!/bin/bash
# Restart a Stook service that is up but stuck, and tell Telegram (alert.sh).
# Run by the watchdog timers.
#   watchdog.sh keeper-mainnet  no pass (heartbeat) for 5 minutes: restart; keeper
#                        wallet under 0.15 SOL: alert
#   watchdog.sh tape     no coin updated for 45 minutes: restart, alert
#   watchdog.sh resolver Soo's resolver not answering /health: alert
#   watchdog.sh ledger   no successful poll of the chain for 10 minutes (or no
#                        answer on /health): restart, alert
up() { local ts; ts=$(systemctl show -p ActiveEnterTimestampMonotonic --value "$1"); echo $(( ($(cut -d. -f1 /proc/uptime) * 1000000 - ts) / 1000000 )); }
ALERT=/home/zak/stook/infra/vps/alert.sh
now() { date +%s; }
case "$1" in
  keeper-mainnet)
    # Only once it runs: no pass for 5 minutes, restart.
    if systemctl is-active -q stook-keeper-mainnet; then
      BEAT=/home/zak/ladder-crank-mainnet.beat
      AGE=$(( $(now) - $(stat -c %Y "$BEAT" 2>/dev/null || echo 0) ))
      if [ "$AGE" -gt 300 ] && [ "$(up stook-keeper-mainnet)" -gt 300 ]; then
        echo "$(date -u +%FT%TZ) watchdog: no pass for ${AGE}s, restarting" >> /home/zak/ladder-crank-mainnet.log
        "$ALERT" keeper-mainnet-dead "MAINNET keeper can't read the chain: no pass for $((AGE / 60)) min. Restarting it. Log: ~/ladder-crank-mainnet.log"
        systemctl restart stook-keeper-mainnet
      elif [ "$AGE" -le 300 ]; then
        "$ALERT" --ok keeper-mainnet-dead "MAINNET keeper is passing again."
      fi
    fi
    # Its wallet pays the rent of each open round (back when the round
    # closes) and the fees: every 30 minutes, alert under 0.15 SOL.
    if [ $(( $(now) / 60 % 30 )) -eq 0 ]; then
      SOL=$(set -a && . /home/zak/stook-mainnet.env && set +a && timeout 30 /usr/bin/node /home/zak/stook/infra/vps/sol-balance.mjs 3 2>/dev/null)
      if [ -n "$SOL" ] && awk "BEGIN{exit !($SOL < 0.15)}"; then
        "$ALERT" keeper-mainnet-sol "MAINNET keeper wallet is low: ${SOL} SOL. Send SOL to H1xgYrQwuFHPWz6FiM6XBgVD3EyqsoPfeFqPsu9cWoP4 before it stops opening rounds."
      elif [ -n "$SOL" ]; then
        "$ALERT" --ok keeper-mainnet-sol "MAINNET keeper wallet topped up: ${SOL} SOL."
      fi
    fi ;;
  tape)
    NEWEST=$(curl -s -m 5 localhost:8791/prices | python3 -c "import sys,json; print(max((v.get('at',0) for v in json.load(sys.stdin).values() if isinstance(v,dict)), default=0))" 2>/dev/null || echo 0)
    AGE=$(( $(now) - ${NEWEST:-0} ))
    if [ "$AGE" -gt 2700 ] && [ "$(up stook-tape)" -gt 600 ]; then
      echo "$(date -u +%FT%TZ) watchdog: prices ${AGE}s old, restarting" >> /home/zak/stook-tape.log
      "$ALERT" tape "Price tape is stale: newest price $((AGE / 60)) min old. Restarting it. Site prices are frozen until it's back."
      systemctl restart stook-tape
    elif [ "$AGE" -le 2700 ]; then
      "$ALERT" --ok tape "Price tape is live again."
    fi ;;
  ledger)
    # pollAge: seconds since the ledger last read the chain's newest signatures
    AGE=$(curl -s -m 5 localhost:8793/health | python3 -c "import sys,json; a=json.load(sys.stdin).get('pollAge'); print(a if a is not None else 999999)" 2>/dev/null || echo 999999)
    if [ "${AGE:-999999}" -gt 600 ] && [ "$(up stook-ledger-mainnet)" -gt 600 ]; then
      echo "$(date -u +%FT%TZ) watchdog: ledger poll ${AGE}s old, restarting" >> /home/zak/ledger-mainnet.log
      "$ALERT" ledger "Ledger is stale: no read of the chain for $((AGE / 60)) min (or no answer on /health). Restarting it. History on Yours stops at that point until it is back. Log: ~/ledger-mainnet.log"
      systemctl restart stook-ledger-mainnet
    elif [ "${AGE:-999999}" -le 600 ]; then
      "$ALERT" --ok ledger "Ledger is reading the chain again."
    fi ;;
  resolver)
    if ! curl -s -m 10 localhost:8790/health | grep -q '"ok":true'; then
      "$ALERT" resolver "Soo resolver is not answering /health on the box. Check: systemctl status soo-resolver"
    else
      "$ALERT" --ok resolver "Soo resolver is answering again."
    fi ;;
  x)
    "$ALERT" "x-$2" "Today's Telegram ${2} post failed. Log: ~/stook-x.log. Post by hand: sudo systemctl start stook-x@${2}" ;;
esac
