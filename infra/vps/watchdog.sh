#!/bin/bash
# Restart a Stook service that is up but stuck, and tell Telegram (alert.sh).
# Run by the watchdog timers.
#   watchdog.sh keeper   no pass (heartbeat) for 5 minutes: restart; rounds failing
#                        (health) for 15: alert, and restart once an hour at most;
#                        keeper wallet under 0.5 SOL: alert
#   watchdog.sh tape     no coin updated for 45 minutes: restart, alert
#   watchdog.sh resolver Soo's resolver not answering /health: alert
#   watchdog.sh ledger   no successful poll of the chain for 10 minutes (or no
#                        answer on /health): restart, alert
up() { local ts; ts=$(systemctl show -p ActiveEnterTimestampMonotonic --value "$1"); echo $(( ($(cut -d. -f1 /proc/uptime) * 1000000 - ts) / 1000000 )); }
ALERT=/home/zak/stook/infra/vps/alert.sh
now() { date +%s; }
case "$1" in
  keeper)
    BEAT=/home/zak/ladder-crank.beat
    AGE=$(( $(now) - $(stat -c %Y "$BEAT" 2>/dev/null || echo 0) ))
    if [ "$AGE" -gt 300 ] && [ "$(up stook-keeper)" -gt 300 ]; then
      echo "$(date -u +%FT%TZ) watchdog: no pass for ${AGE}s, restarting" >> /home/zak/ladder-crank.log
      "$ALERT" keeper-dead "Keeper can't read the chain: no pass for $((AGE / 60)) min. Restarting it. Rounds may miss their open or settle. Log: ~/ladder-crank.log"
      systemctl restart stook-keeper
      exit 0
    fi
    [ "$AGE" -le 300 ] && "$ALERT" --ok keeper-dead "Keeper is passing again."
    # Alive, but rounds failing: say so; restart at most once an hour, since a
    # round the program keeps refusing stays refused.
    SICK=$(( $(now) - $(stat -c %Y /home/zak/ladder-crank.health 2>/dev/null || echo 0) ))
    if [ "$SICK" -gt 900 ] && [ "$(up stook-keeper)" -gt 900 ]; then
      WHY=$(grep -E "failing|failed" /home/zak/ladder-crank.log | tail -1 | cut -c1-200)
      "$ALERT" keeper-sick "Keeper is up but rounds are failing for $((SICK / 60)) min. Last: ${WHY:-see ~/ladder-crank.log}"
      LAST=$(stat -c %Y /home/zak/.stook-keeper-sick-restart 2>/dev/null || echo 0)
      if [ $(( $(now) - LAST )) -gt 3600 ]; then
        echo "$(date -u +%FT%TZ) watchdog: rounds failing for ${SICK}s, restarting (once an hour at most)" >> /home/zak/ladder-crank.log
        touch /home/zak/.stook-keeper-sick-restart
        systemctl restart stook-keeper
      else
        echo "$(date -u +%FT%TZ) watchdog: rounds failing for ${SICK}s" >> /home/zak/ladder-crank.log
      fi
    elif [ "$SICK" -le 900 ]; then
      "$ALERT" --ok keeper-sick "Keeper rounds are going through again."
    fi
    # The keeper's wallet pays every open, settle and price post: every 30 minutes.
    if [ $(( $(now) / 60 % 30 )) -eq 0 ]; then
      SOL=$(cd /home/zak/stook/infra/ladder-crank && set -a && . /home/zak/stook.env && set +a && timeout 30 /usr/bin/node -e '
        const w = require("@solana/web3.js"), fs = require("fs");
        const k = w.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(process.env.KEYPAIR, "utf8"))));
        new w.Connection(process.env.RPC_URL).getBalance(k.publicKey).then((b) => console.log((b / 1e9).toFixed(3)));' 2>/dev/null)
      if [ -n "$SOL" ] && awk "BEGIN{exit !($SOL < 0.5)}"; then
        "$ALERT" keeper-sol "Keeper wallet is low: ${SOL} SOL. Top it up on devnet before it stops opening and settling rounds."
      elif [ -n "$SOL" ]; then
        "$ALERT" --ok keeper-sol "Keeper wallet topped up: ${SOL} SOL."
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
    AGE=$(curl -s -m 5 localhost:8792/health | python3 -c "import sys,json; a=json.load(sys.stdin).get('pollAge'); print(a if a is not None else 999999)" 2>/dev/null || echo 999999)
    if [ "${AGE:-999999}" -gt 600 ] && [ "$(up stook-ledger)" -gt 600 ]; then
      echo "$(date -u +%FT%TZ) watchdog: ledger poll ${AGE}s old, restarting" >> /home/zak/ledger.log
      "$ALERT" ledger "Ledger is stale: no read of the chain for $((AGE / 60)) min (or no answer on /health). Restarting it. History on Yours stops at that point until it is back. Log: ~/ledger.log"
      systemctl restart stook-ledger
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
    "$ALERT" "x-$2" "Today's X ${2} post failed. Log: ~/stook-x.log. Post by hand: sudo systemctl start stook-x@${2}" ;;
esac
