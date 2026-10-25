#!/usr/bin/env bash
# A dry run of the MAINNET build, with no paid service: a local validator that
# holds the program built with --features mainnet and Pyth's receiver, push
# oracle and Wormhole programs cloned from mainnet, and prices only from
# mainnet's chain history (src/history.mjs). Then mainnet-dryrun.mjs runs the
# keeper's own code against it.
#
#   bash infra/ladder-crank/dryrun/mainnet-dryrun.sh [learn|round|all]
#
# ENV: HISTORY_RPC_URL (default the public mainnet endpoint), KEYPAIR (the
# deploy key, ~/.config/solana/id.json: the mainnet build lets only it
# initialise), SO (default: build it into $OUT).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
OUT="${OUT:-${TMPDIR:-/tmp}/stook-mainnet-dryrun}"
mkdir -p "$OUT"
MAINNET="${HISTORY_RPC_URL:-https://api.mainnet-beta.solana.com}"
PROGRAM=55kGEMHJyNbD3qcdonCD8UPTqzM85yg2kr6M5UF5P353

if [[ -z "${SO:-}" ]]; then
  cargo build-sbf --manifest-path "$ROOT/packages/programs-core/programs/sooth-core/Cargo.toml" --features mainnet --sbf-out-dir "$OUT/so" >/dev/null
  SO="$OUT/so/sooth_core.so"
fi

RECEIVER=rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ
PUSH=pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT
WORMHOLE=HDwcJBJXjL9FpJ7UBsYBtaDjsBUhuLCUYoz3zr8SWWaQ
# The receiver's config, Wormhole's guardian sets, the receiver's treasury
# PDAs (it pays a fee into one picked at random), the ZEC/USD push feed.
ACCOUNTS=$(cd "$ROOT/infra/ladder-crank" && node --input-type=module -e '
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);
const p = require("@pythnetwork/pyth-solana-receiver");
import { PublicKey } from "@solana/web3.js";
const out = [p.getConfigPda(p.DEFAULT_RECEIVER_PROGRAM_ID).toBase58()];
for (let i = 0; i < 8; i++) { const b = Buffer.alloc(4); b.writeUInt32BE(i); out.push(PublicKey.findProgramAddressSync([Buffer.from("GuardianSet"), b], p.DEFAULT_WORMHOLE_PROGRAM_ID)[0].toBase58()); }
for (let i = 0; i < 256; i++) out.push(PublicKey.findProgramAddressSync([Buffer.from("treasury"), Buffer.from([i])], p.DEFAULT_RECEIVER_PROGRAM_ID)[0].toBase58());
out.push(PublicKey.findProgramAddressSync([Buffer.from([0, 0]), Buffer.from("be9b59d178f0d6a97ab4c343bff2aa69caa1eaae3e9048a65788c529b125bb24", "hex")], new PublicKey("pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT"))[0].toBase58());
console.log(out.join(" "));')

ARGS=(--reset --quiet --ledger "$OUT/ledger" --url "$MAINNET"
  --bpf-program "$PROGRAM" "$SO"
  --clone-upgradeable-program "$RECEIVER" --clone-upgradeable-program "$PUSH" --clone-upgradeable-program "$WORMHOLE")
for a in $ACCOUNTS; do ARGS+=(--maybe-clone "$a"); done

solana-test-validator "${ARGS[@]}" >"$OUT/validator.log" 2>&1 &
VALIDATOR=$!
trap 'kill $VALIDATOR 2>/dev/null || true' EXIT
for _ in $(seq 1 90); do solana -u localhost cluster-version >/dev/null 2>&1 && break; sleep 1; done
solana -u localhost airdrop 500 "$(solana-keygen pubkey "${KEYPAIR:-$HOME/.config/solana/id.json}")" >/dev/null

cd "$ROOT/infra/ladder-crank"
HISTORY_RPC_URL="$MAINNET" node dryrun/mainnet-dryrun.mjs "${1:-all}"
