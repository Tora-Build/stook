#!/bin/bash
# Bundle each Stook service into one file beside its source, so the box runs
# plain `node <file>.bundle.mjs` with no node_modules at all (deploy.sh).
#   bash infra/vps/bundle.sh
# The SDK is built first: the services import its dist. Optional native
# speedups of ws and web3.js stay out; both fall back to plain JavaScript.
# The X poster is not bundled: its one dependency, playwright-core, drives a
# browser it ships beside itself, so deploy.sh installs just that module.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
pnpm -F @sooth/sdk-solana build >/dev/null
ESBUILD="npx --yes esbuild@0.24.0"
bundle() { # entry, extra flags
  local entry=$1; shift
  $ESBUILD "$entry" --bundle --platform=node --format=esm --target=node22 --log-level=warning \
    --external:bufferutil --external:utf-8-validate --external:playwright-core "$@" \
    --banner:js="import { createRequire as __cr } from 'node:module'; import { fileURLToPath as __fu } from 'node:url'; import { dirname as __dn } from 'node:path'; const require = __cr(import.meta.url); const __filename = __fu(import.meta.url); const __dirname = __dn(__filename);" \
    --outfile="${entry%.mjs}.bundle.mjs"
}
bundle infra/ladder-crank/src/index.mjs
bundle infra/ledger/src/index.mjs
bundle infra/sim/src/index.mjs
bundle infra/sim/src/bot.mjs
bundle infra/tape/src/index.mjs
ls -la infra/*/src/*.bundle.mjs | awk '{print $5, $9}'
