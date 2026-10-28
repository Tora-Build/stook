#!/usr/bin/env bash
# The mainnet build's setup for $SSt. on Polymarket's pool, on a local
# validator: the program from scripts/mainnet/build.sh, the pool and its
# observation account cloned from mainnet, a Token-2022 test coin in place
# of SSt. (no one can mint SSt.). Runs scripts/mainnet/setup.mjs step by
# step, then one keeper pass, which should start the house's next round.
#
#   bash infra/ladder-crank/dryrun/pool-dryrun.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
OUT="${OUT:-${TMPDIR:-/tmp}/stook-pool-dryrun}"
mkdir -p "$OUT"
SO="$ROOT/target/mainnet/sooth_core.so"
[[ -f "$SO" ]] || sh "$ROOT/scripts/mainnet/build.sh"
KEY="${KEYPAIR:-$HOME/.config/solana/id.json}"

solana-test-validator --reset --quiet --ledger "$OUT/ledger" --url https://api.mainnet-beta.solana.com \
  --bpf-program 55kGEMHJyNbD3qcdonCD8UPTqzM85yg2kr6M5UF5P353 "$SO" \
  --clone 5fdWxxkv63NdU7t2CspjyCQrvmMvfe3mQwSgYpHam1Gs --clone AcPAWXqHfqLDujqkG6BNEFJPijHxMHxdz5tz4KcR4t7z >"$OUT/validator.log" 2>&1 &
VALIDATOR=$!
trap 'kill $VALIDATOR 2>/dev/null || true' EXIT
for _ in $(seq 1 90); do solana -u localhost cluster-version >/dev/null 2>&1 && break; sleep 1; done
solana -u localhost airdrop 100 "$(solana-keygen pubkey "$KEY")" >/dev/null

MINT=$(cd "$ROOT/scripts/mainnet" && KEY="$KEY" node --input-type=module -e '
import { readFileSync } from "node:fs";
import { Connection, Keypair } from "@solana/web3.js";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
const c = new Connection("http://127.0.0.1:8899", "confirmed");
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.KEY, "utf8"))));
const mint = await createMint(c, payer, payer.publicKey, null, 6, undefined, undefined, TOKEN_2022_PROGRAM_ID);
const ata = await getOrCreateAssociatedTokenAccount(c, payer, mint, payer.publicKey, false, undefined, undefined, TOKEN_2022_PROGRAM_ID);
await mintTo(c, payer, mint, ata.address, payer, 10n ** 15n, [], undefined, TOKEN_2022_PROGRAM_ID);
console.log(mint.toBase58());')
echo "test coin $MINT"
export RPC_URL=http://127.0.0.1:8899 STOOK_MINT="$MINT" KEYPAIR="$KEY"
for step in init series seed house "deposit 1000000"; do
  echo "── $step"; node "$ROOT/scripts/mainnet/setup.mjs" $step | grep -v "^program "
done
echo "── keeper pass"
cd "$ROOT/infra/ladder-crank"
RPC_URL=http://127.0.0.1:8899 SCAN_RPC_URL=http://127.0.0.1:8899 WS_URL=ws://127.0.0.1:8900 ORACLE_SOURCE=push node src/index.mjs 2>&1 | grep -vE "punycode|trace-deprecation" | tail -8
node "$ROOT/scripts/mainnet/setup.mjs" | tail -2
