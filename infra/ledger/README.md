# @stook/ledger: every round a wallet played

The Yours page lists the accounts a wallet holds. Collecting a round closes
them (the rent comes back), so a finished round leaves no trace there. The
ledger keeps the trace: it reads every sooth_core transaction once, turns it
into rows per wallet, and serves each wallet's rounds, with what went in, what
came back and how the round ended, to the History tab.

Read only. It holds no key and sends nothing.

    node --experimental-sqlite src/index.mjs      # the service (infra/vps/stook-ledger.service)
    node --experimental-sqlite --test test/*.test.mjs
    node test/record.mjs <name>=<signature> ...    # record a transaction as a test fixture

## What it reads

- `getSignaturesForAddress(program)`: a backfill newest first down to the
  program's first transaction, then a poll every `LEDGER_POLL_MS` (15 s) with
  `until` the newest signature it has taken. Finalized only, so nothing it
  records can be rolled back. Failed transactions are skipped.
- `getTransaction(sig, jsonParsed, maxSupportedTransactionVersion 0)` for each.
- `getMultipleAccounts`, rarely: a round whose events it never saw (a log cut
  short) is filled in from its account once the backfill is done.

All under one token bucket (`LEDGER_RPS`, 3) with exponential back-off on 429
and 5xx (honouring Retry-After). `/health` counts calls per method.

## How a transaction becomes rows (`src/decode.mjs`)

Events come from the "Program data:" logs (Anchor's `emit!`): the first 8 bytes
are `sha256("event:<Name>")`, the rest the struct in borsh, as in
`programs/sooth-core/src/events.rs` and `instructions/{ladder,series}.rs`.
Each event is tied to the top-level instruction that logged it. Instructions
are told apart by `sha256("global:<name>")[..8]` and read by account position.

| instruction | row | wallet | amount |
|---|---|---|---|
| `ladder_create` | start | creator | the seed (first house deposit) |
| `ladder_trade`, shares > 0 | buy (call, or add when it held that call) | user | paid |
| `ladder_trade`, shares < 0 | sell | user | received |
| `ladder_lp_join` | deposit | lp | paid |
| `ladder_redeem` | collect (refund on a void) | the position's owner | received |
| `ladder_claim_lp` | claim | the tranche's owner | received |
| `ladder_collect_fees` | fees | the creator's token account owner | received |
| `ladder_sweep` | sweep (closed, paid nothing) | the position's owner | 0 |

Redeem emits no event: its amount is what reached the owner's token account.
An amount is the wallet's token balance change when only one of our
instructions in the transaction moves that account, so a coin's transfer fee
is counted as the wallet saw it; otherwise it is what the program moved
(event fields, or the inner transfer). A redeem, claim or sweep signed by
someone else (a keeper, 30 days after the close) belongs to the owner, with
the signer in `by`.

Open, settle, void and close write round facts (grid, settled floor and price,
void, close), and `SeriesCreated` the series' feed and mint. Each field comes
from one kind of event, so they merge the same in any order.

## What it serves (`src/history.mjs`)

`GET /history?wallet=<address>&limit=20&before=<cursor>&coin=<SYMBOL|mint>&result=<won|missed|refunded|open|unclaimed>`

    { wallet,
      totals: { rounds, results: {won, missed, …}, coins: [{ mint, coin, decimals, rounds, paid, got, net, owed }] },
      matching, next,                       // next: the cursor for the following page, or null
      rounds: [{ ladder, coin, quoteMint, decimals, feed, index, settlesAt, status,
                 settled: { price, bin, band }, result, paid, got, net, owed, claimable,
                 calls: ["Near 65,000 ±3", …], house,
                 actions: [{ sig, time, kind, name, shape, shares, amountIn, amountOut, fee, by }] }],
      indexed: { through, complete } }

Amounts are base units of each round's coin, as strings. Totals are per coin;
the app adds them up in dollars. `coin` narrows the rounds and the totals;
`result` narrows only the rounds.

Results: `open` (not settled or voided yet), `unclaimed` (finished, and a
paying call, a refund or a house deposit is still to collect), `refunded`,
`won` (a call paid; a house-only round: got back more than it put in),
`missed`.

`GET /health`: the poll's age, the backfill's progress, row counts, RPC calls.

## Storage

`LEDGER_DIR` (`~/ledger`): `ledger.db` with node:sqlite (Node 22.5+, behind
`--experimental-sqlite` before 22.13), else `ledger.jsonl`, append only,
replayed into memory on start, plus `cursor.json`. Every write is idempotent:
reading a transaction twice changes nothing.

## Settings

`LEDGER_RPC_URL` (https://api.devnet.solana.com), `LEDGER_RPS` (3),
`LEDGER_DIR`, `LEDGER_PORT` (8792), `LEDGER_HOST` (127.0.0.1),
`LEDGER_POLL_MS` (15000), `LEDGER_STORE` (auto, sqlite, jsonl),
`LEDGER_BACKFILL_MAX` (stop the backfill after that many signatures; for a
local sample), `LEDGER_MINTS` or `DEVNET_MINTS` ({symbol: mint}; else the
`DEVNET_MINTS` line of `~/sim/sim.env`).

How it runs on the box: `infra/vps/README.md`, "Ledger".
