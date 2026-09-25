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
  RPC for its live line, and the Worker's `/pyth` when that account is stale
  (devnet's often are); the browser never holds an API key. Rounds settle
  on Pyth either way.
- On devnet each coin's rounds run on a crypto stand-in feed
  (`DEVNET_FEEDS` in `src/lib/coins.ts`). Only the round page and the fund
  sheet name the stand-in, with a red note; everywhere else shows the coin's
  real anchor.
- The devnet faucet's key ships in the bundle on purpose: the devnet coins
  and mock token are worthless and handing them out is the faucet's job. It
  only mints: the devnet coins' fee and withheld-withdraw authorities belong
  to the deployer. Nothing else secret is ever built in.
- Every coin amount shows its dollar value, from the coin's Jupiter price
  (the devnet test coins are valued as the real ones).
- $STOOK's mainnet mint is not in the repo: the build reads
  `VITE_STOOK_MINT` from `.env.local`, the Worker a `STOOK_MINT` secret.

Deployed by the `stook-street` Worker (`site/`), which serves `dist/` with
the security headers in `public/_headers`, and these data routes, all cached
at the edge:

| Route | What | Source |
|---|---|---|
| `/prices` | each coin's anchor price and 24h move | the tape's pools, then Yahoo |
| `/chart?coin=` or `?sym=` | the anchor over the last day | the tape, then Yahoo |
| `/usd`, `/coins` | each coin's dollar price (and 24h move) | Jupiter's price API |
| `/supply` | `{"circulatingSupply": n}` for $STOOK | the mint account, less `STOOK_EXCLUDE` token accounts |
| `/pyth?id=` | the latest Pyth price for one of the app's feeds (the round page's live line when Pyth's on-chain account is stale) | Hermes, with the `PYTH_API_KEY` secret |
| `/chatter` | the floor's conversations, new every minute | a template grammar on live numbers, plus hourly lines from Workers AI (Llama 3.3 70B, free allowance) that must quote only real numbers; `POST /chatter/refresh` with the tape token runs the hourly job now |

`wrangler.toml` here is only the `app.stooks.xyz` redirect.
