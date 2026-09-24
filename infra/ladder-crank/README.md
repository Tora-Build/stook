# ladder-crank

Teaches each series its closes, opens, settles and voids rounds, sweeps
positions owed nothing, pays out positions and deposits left uncollected 30
days after the close, collects the fee shares and closes finished rounds.
Permissionless: the program decides which Pyth update counts for an instant
(`prev_publish_time < T <= publish_time`, the first update at or after it),
so it does not matter who runs this or how many copies run.

```bash
pnpm install && pnpm -F @sooth/sdk-solana build
PYTH_API_KEY=… node src/index.mjs --plan    # what is each market waiting for?
PYTH_API_KEY=… node src/index.mjs --watch   # every CRANK_INTERVAL_SECS (default 5)
PYTH_API_KEY=… node src/index.mjs --learn --clear-up   # one pass of everything
```

The decisions (which step a market needs, whether an update will be
accepted, whether it proves a void, which closes a series still needs) live
in the SDK (`src/ladder/crank.ts`, `src/ladder/series.ts`) and are
unit-tested. This file is the I/O: read ladders and series, ask Hermes for
the update at the instant, post it through the Pyth receiver, then consume it
in a transaction of our own with the heap frame, and close the posted
account for its rent.

What a pass does:

- **Learn.** Every close a series has not taken, oldest first, from the
  update at that second (`/v2/updates/price/{close}`). The program takes them
  strictly in order and decides whether each teaches a return or only moves
  the series on. A close that can never be posted (a retired Wormhole
  guardian set) is skipped for good only once the program allows it: a
  warmed-up series, a week after that close. Learning runs first, so a round
  opening at yesterday's close finds it counted.
- **Open.** A round's opening price is THE update at `opens_at`, and the open
  must land within five minutes of it. The keeper waits while the series is
  still warming up or has not learned the last close (`openBlocker`), since
  the program would refuse the open.
- **Settle, or void with proof.** After the close it fetches the close's
  update. If that update cannot settle the round (late, unsure, another
  exponent) it is the proof `ladder_void` needs, and the keeper voids at
  once. A round that never opened is voided without proof after its window,
  and one with no postable update a week after its close.
- **Clear up.** Sweeps positions owed nothing, pays out what is still owed 30
  days after the close to owners who have a token account for the coin (it
  never creates one for someone else: the owner could close it and keep the
  rent), collects the fee shares, and closes the round.

Things learned on the first runs, all fixed:

- **The consume transaction is ours, not the builder's.** The receiver's
  builder batches by byte size; once `ladder_settle` grew to eight accounts it
  no longer fit beside the VAA post and was moved to a transaction of its
  own, without the heap frame. Now: the builder posts, we send
  `withHeap([ix])`, then close the price account.
- **`@pythnetwork/pyth-solana-receiver` is loaded through `require`.** Its ESM
  build imports `jito-ts` without a file extension, which Node refuses. The
  root `package.json` also pins one `@solana/web3.js` across the workspace,
  because the receiver's own copy pulled a second `rpc-websockets` that broke
  under pnpm's hoisting.

ENV: `RPC_URL` (sends and reads), `WS_URL` (confirmations), `SCAN_RPC_URL`
(`getProgramAccounts`, which keyed free tiers refuse), `KEYPAIR`,
`PYTH_API_KEY`, `HERMES_URL`, `PRIORITY_MICROLAMPORTS`, and
`FULL_VERIFICATION=1` on mainnet, where the program accepts only fully
verified updates.

## Hosted

Runs on the `tora` box under cron (`deploy/keepalive.sh` every minute, same
pattern as Soo's resolver), as its own devnet wallet
`AWJiY5es1XWzba2QMQxU3jYEabBR5wxP2QKgJfVYB65r` (needs SOL for fees; ~0.01 SOL
per settle). `deploy/deploy.sh` rsyncs the repo and restarts it (and the
tape). Secrets live only in `~/stook.env` on the box, written by hand over
ssh stdin. Log: `~/ladder-crank.log`.
