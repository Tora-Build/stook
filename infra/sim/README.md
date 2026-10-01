# @stook/sim: simulated users on devnet

A fleet of wallets that use Stook the way people do in the app: buy lines and
ranges, sell them, deposit as the house, fund rounds, collect after the close.
A few (the "arb" persona, 7 in 100) are arbitrageurs: they price each band
from a lognormal around the live price and buy the bands the crowd prices
under fair (or sell held ones it prices over), never past fair, so the
round's odds stay smooth.
Every transaction is built as the app builds it (`apps/stook`: Ticket,
LpPanel, StartRound, lib/collect, Faucet) through `@sooth/sdk-solana`, heap
frame first.

    pnpm -F @sooth/sdk-solana build      # the sim imports the SDK's dist
    node src/index.mjs --plan 20         # read the chain, print what it would do; no send, no file
    node src/index.mjs --once 3          # three turns now, then exit
    node src/index.mjs --watch           # the service (infra/vps/stook-sim.service)
    node --test test/*.test.mjs

How it runs on the box, its files and its settings: `infra/vps/README.md`,
"Simulated users". The modules:

- `schedule.mjs`: New York hours, the arrival process, the pauses
- `rate.mjs`: the per-minute send cap and the RPC bucket (429 back-off)
- `personas.mjs`: who each wallet is, from its index and the seed
- `pricing.mjs`: a view of the close, the line for it, the size a budget buys
- `arb.mjs`: fair and crowd odds per band, the arbitrageur's buy and sale and their sizes
- `actions.mjs`: deciding and building one turn
- `chain.mjs`: batched reads and the one guarded sender
- `budget.mjs`: the treasury's daily allowance and top-ups
- `classify.mjs`, `store.mjs`: failure classes, the action log, the issue book
- `sim.mjs`: the loop, funding, alerts, the daily report
