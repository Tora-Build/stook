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

Things learned on the first runs, all fixed:

- **Opening asks Hermes for the update 15 s ago, not `latest`.** Hermes stamps
  ahead of a lagging clock and the program refuses a price from the future.
- **The consume transaction is ours, not the builder's.** The receiver's builder batches by byte size; once `ladder_settle` grew to eight accounts it no longer fit beside the VAA post and was moved to a transaction of its own — without the heap frame. Now: builder posts, we send `withHeap([settle])`, then close the price account.
- **`@pythnetwork/pyth-solana-receiver` is loaded through `require`.** Its ESM
  build imports `jito-ts` without a file extension, which Node refuses. The
  root `package.json` also pins one `@solana/web3.js` across the workspace,
  because the receiver's own copy pulled a second `rpc-websockets` that broke
  under pnpm's hoisting.

## Hosted

Runs on the `tora` box under cron (`deploy/keepalive.sh` every minute, same
pattern as Soo's resolver), as its own devnet wallet
`AWJiY5es1XWzba2QMQxU3jYEabBR5wxP2QKgJfVYB65r` (needs SOL for fees; ~0.01 SOL
per settle). `deploy/deploy.sh` rsyncs the repo and restarts it. Secrets live
only in `~/stook.env` on the box, written by hand over ssh stdin. Log:
`~/ladder-crank.log`.
