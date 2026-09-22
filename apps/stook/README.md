# @stook/app

Stook's front end. Vite + React, Wallet Standard adapters, `@sooth/sdk-solana`
for every number and every instruction.

```bash
pnpm -F @sooth/sdk-solana build
cp .env.example .env.local           # or run scripts/devnet/setup.mjs, which writes it
pnpm -F @stook/app dev               # http://127.0.0.1:5180
```

Pages: `/` markets, `/m/:address` a market (chart, trade, liquidity, positions),
`/new` create, `/how` the mechanism in plain words.

Design rules the pages keep to:

- Every quote shown is the program's own number, computed by the SDK's
  bit-exact port and sent as the trade's limit. Nothing is estimated.
- The chart is the market: bars are the crowd's odds per band, a click draws a
  line, a drag draws a range, and the payout the shape makes at every band is
  drawn over the bars.
- Live prices come from Pyth's on-chain push-oracle account over plain RPC, so
  the browser never holds an API key.
- The devnet faucet's mint authority ships in the bundle on purpose — the mock
  token is worthless and handing it out is the faucet's job. Nothing else
  secret is ever built in.
