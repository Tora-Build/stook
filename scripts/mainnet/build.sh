#!/bin/sh
# The mainnet program, built as small as it goes: rent is per byte (about
# 6.96 SOL per MB), so size is the deploy's cost.
#
#   mainnet        mainnet constants (INITIALIZER, Full-only oracle updates)
#   no-listing     coin listing left out; the street's own coins only
#   no-idl, no-log-ix-name   Anchor's IDL instruction and name logs left out
#   opt-level z    smallest code; about 30-45% more compute than opt-level 3,
#                  inside every budget the keeper and the app set (measured)
#
# Out: target/mainnet/sooth_core.so (about 654 KB, about 4.55 SOL of rent).
set -e
cd "$(dirname "$0")/../.."
CARGO_PROFILE_RELEASE_OPT_LEVEL=z CARGO_TARGET_DIR=target/mainnet-build \
  cargo build-sbf --manifest-path packages/programs-core/programs/sooth-core/Cargo.toml \
  --features "mainnet no-listing no-idl no-log-ix-name" --sbf-out-dir target/mainnet
ls -l target/mainnet/sooth_core.so | awk '{printf "%s bytes, about %.2f SOL of rent\n", $5, ($5 + 45 + 128) * 6960 / 1e9}'
shasum -a 256 target/mainnet/sooth_core.so
