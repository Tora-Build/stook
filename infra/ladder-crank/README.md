# ladder-crank

Opens, settles and voids Stook ladders. Permissionless: the program decides
which price settles a market (`prev_publish_time < T <= publish_time`, the first
Pyth update at or after the settlement time), so it does not matter who runs
this or how many copies run.

```bash
pnpm install && pnpm -F @sooth/sdk-solana build
PYTH_API_KEY=… node src/index.mjs --plan    # what is each market waiting for?
PYTH_API_KEY=… node src/index.mjs --watch   # every CRANK_INTERVAL_SECS (default 5)
```

The decisions — which step a market needs, whether an update will be accepted —
live in the SDK (`src/ladder/crank.ts`) and are unit-tested. This file is the
I/O: read ladders, ask Hermes, post through the Pyth receiver, consume in the
same transaction.

First run on devnet, 2026-09-22: opened market `8TExAHio…` from a Hermes update
and settled it seven minutes later from the update at its settlement instant
(SOL, $117.395 → band 31). The winner redeemed and the LP claimed exactly what
the SDK predicted.

Two things learned on that run, both fixed:

- **Opening asks Hermes for the update 15 s ago, not `latest`.** Hermes stamps
  ahead of a lagging clock and the program refuses a price from the future.
- **`@pythnetwork/pyth-solana-receiver` is loaded through `require`.** Its ESM
  build imports `jito-ts` without a file extension, which Node refuses. The
  root `package.json` also pins one `@solana/web3.js` across the workspace,
  because the receiver's own copy pulled a second `rpc-websockets` that broke
  under pnpm's hoisting.
