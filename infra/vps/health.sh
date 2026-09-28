#!/bin/bash
# The daily health report, to Telegram through alert.sh. Run by stook-health.timer;
# by hand: bash ~/stook/infra/vps/health.sh [--print: to the terminal instead]
H=/home/zak
ago() { local t s; t=$(stat -c %Y "$1" 2>/dev/null) || { echo "never"; return; }; s=$(( $(date +%s) - t )); [ $s -lt 120 ] && echo "${s}s ago" || echo "$((s / 60)) min ago"; }
svc() { [ "$(systemctl is-active "$1")" = active ] && echo "✅ $2" || echo "❌ $2: $(systemctl is-active "$1")"; }

# Round notes the keeper wrote in the last 24 hours (~/stook-events.log).
SINCE=$(date -u -d '24 hours ago' +%FT%T)
recent() { awk -v s="$SINCE" '$1 >= s' "$H/stook-events.log" 2>/dev/null | grep -c "$1"; }
OPENS=$(recent 🟢); SETTLES=$(recent 🔔); VOIDS=$(recent ⚪)

SOL=$(cd $H/stook/infra/ladder-crank && set -a && . $H/stook.env && set +a && timeout 30 /usr/bin/node -e '
  const w = require("@solana/web3.js"), fs = require("fs");
  const k = w.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(process.env.KEYPAIR, "utf8"))));
  new w.Connection(process.env.RPC_URL).getBalance(k.publicKey).then((b) => console.log((b / 1e9).toFixed(2)));' 2>/dev/null)
PRICES=$(curl -s -m 5 localhost:8791/prices | python3 -c "
import sys, json, time
d = json.load(sys.stdin); n = time.time()
print('\n'.join(f\"  {k} {v['price']:,.6g} ({int((n - v['at']) / 60)} min old)\" for k, v in d.items() if isinstance(v, dict) and 'price' in v))" 2>/dev/null)
RES=$(curl -s -m 10 localhost:8790/health | grep -q '"ok":true' && echo "answering" || echo "NOT answering")
XLINE=$(grep '"posted"' "$H/stook-x.log" 2>/dev/null | tail -1)
XWHEN=${XLINE:0:10}; XID=$(echo "$XLINE" | grep -o '"posted":"[0-9]*"' | cut -d'"' -f4)

MSG="📊 Stook daily check, $(TZ=America/New_York date '+%a %b %-d, %-I:%M %p') New York

$(svc stook-keeper Keeper): last pass $(ago $H/ladder-crank.beat), all rounds OK $(ago $H/ladder-crank.health)
$(svc stook-tape 'Price tape')
$(svc soo-resolver 'Soo resolver'), $RES
Keeper wallet: ${SOL:-?} SOL

Last 24h: ${OPENS} opened, ${SETTLES} settled, ${VOIDS} voided
Prices:
${PRICES:-  tape not answering}
Last X post: ${XWHEN:-none}${XID:+ x.com/StookStreet/status/$XID}

Box: load $(cut -d' ' -f1-3 /proc/loadavg), memory $(free -m | awk '/Mem:/ {printf "%d%%", ($2-$7)*100/$2}'), disk $(df -h / | awk 'NR==2 {print $5}')"
[ "$1" = --print ] && { echo "$MSG"; exit 0; }
exec "$H/stook/infra/vps/alert.sh" --report "$MSG"
