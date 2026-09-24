# @stook/app

Stook's front end. Vite + React, Wallet Standard adapters, `@sooth/sdk-solana`
for every number and every instruction.

```bash
pnpm -F @sooth/sdk-solana build
cp .env.example .env.local           # or run scripts/devnet/setup.mjs, which writes it
pnpm -F @stook/app dev               # http://127.0.0.1:5180
```

Pages: `/` the street, `/c/:symbol` a coin's calendar (fund a day),
`/m/:id` a round (chart, trade, liquidity), `/yours` your rounds, `/how` the
walk-through.

Design rules the pages keep to:

- Every quote shown is the program's own number, computed by the SDK's
  bit-exact port and sent as the trade's limit. Nothing is estimated.
- The chart is the market: bars are the crowd's odds per band, a click draws a
  line, a drag draws a range, and the payout the shape makes at every band is
  drawn over the bars.
- The street and coin pages show the live price from the Worker's `/prices`
  (the tape's pool prices, with Yahoo and the pool itself as the fallback;
  display only). A round's page reads the Pyth push-oracle account over plain
  RPC for its live line, so the browser never holds an API key. Rounds settle
  on Pyth either way.
- On devnet each coin's rounds run on a crypto stand-in feed
  (`DEVNET_FEEDS` in `src/lib/coins.ts`). Only the round page and the fund
  sheet name the stand-in, with a red note; everywhere else shows the coin's
  real anchor.
- The devnet faucet's key ships in the bundle on purpose: the devnet coins
  and mock token are worthless and handing them out is the faucet's job. The
  same key is also the transfer-fee and withheld-withdraw authority of the
  devnet coins (`scripts/devnet/coins.mjs`); those two should move to a
  private key. Nothing else secret is ever built in.

Deployed by the `stook-street` Worker (`site/`), which serves `dist/` with
the security headers in `public/_headers`. `wrangler.toml` here is only the
`app.stooks.xyz` redirect.
