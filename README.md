# Stook

Price prediction on Solana. You draw a line where you think an asset lands, and
you trade against a curve that prices every band at once.

A Stook market is not "will X happen" — it is "where will X be". The answer is
a distribution across price bands, and the market's job is to price all of them
together so they always sum to one. Draw your line, buy the band it falls in,
and sell out any time before settlement.

## How it works

- **One market, many bands.** A market on an asset and a settlement time is
  divided into price bands. A single LMSR prices all of them from one shared
  liquidity subsidy, so the bands cannot drift apart and the crowd's belief is
  readable straight off the curve.
- **Liquidity is provided, not assumed.** Anyone can deepen a market at any
  time before lock, and earns 90% of the fees on the volume they were present
  for: 2% a trade, rising over a round's last six hours to 5% an hour before
  the close. Each deposit buys exactly the depth it can cover alone, so a market cannot pay out
  more than someone chose to underwrite, and no LP ever leans on another.
- **Any token as the quote.** A market is denominated in whatever it names —
  a stablecoin, a tokenized equity, or a stock-paired token launched against
  one. Token-2022 mints are vetted by what their extensions actually do.
- **Settlement is a number with a source.** Pyth publishes the price, the rule
  picks the one update that is the price at settlement time, and it lands in a
  band. No vote, no committee, no dispute window.

## What is in the repo

```
packages/programs-core/   the Anchor program (sooth_core)
packages/sdk-solana/      quotes exact to the base unit, decoders, builders, keeper logic
apps/stook/               the app, served at stooks.xyz
infra/ladder-crank/       the keeper: learns closes, opens, settles, voids and clears up rounds
infra/tape/               live pool prices for the tables and charts (display only)
infra/rpc-proxy/          Worker that keeps the RPC key out of the browser
site/                     the stooks.xyz Worker (serves the app, /prices, /chart) and launch kit
scripts/devnet/           protocol init, devnet coins, series, rounds from the CLI
scripts/backtest/         the replay behind band width, opening odds and the fee
docs/architecture.md      the design, and the decisions behind it
docs/feasibility.md       the measurements the design rests on
docs/design-review/       blind designs of the mechanism, and the dated audits
docs/research/            who else built this, and how
```
The program's frame — the Anchor project, the 256 KB allocator, the protocol
config — was inherited from Sooth's `sooth_core`, and the name stayed. The
market engine is Stook's own; Sooth's binary AMM, order book and adjudication
stack were removed once the ladder could stand without them.

## Status

Deployed on devnet (`55kGEMHJyNbD3qcdonCD8UPTqzM85yg2kr6M5UF5P353`). Each
coin has one series with a round every day, closing at 4 PM New York. On
devnet the series run on crypto stand-in feeds (BTC, ETH, SOL and DOGE for
SPYx, ZEC, STONK and GLDx) until the Pyth key is entitled to the anchors'
feeds. A series learns its volatility from Pyth closes and opens rounds once
it has 20 daily returns; funding a day never waits for that. The keeper is
hosted: it learns each close, opens, settles and voids rounds, and pays out
and closes finished ones. The program and SDK are tested end to end on
LiteSVM, including a round quoted in a real xStock and one in $STOOK's
fee-bearing mint.

```bash
pnpm install && pnpm -F @sooth/sdk-solana build
cp apps/stook/.env.example apps/stook/.env.local   # or run scripts/devnet/setup.mjs
pnpm -F @stook/app dev                              # http://127.0.0.1:5180
```

## Licence

Apache-2.0
