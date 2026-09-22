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
  time before lock, and earns fees on the volume they were present for. Each
  deposit buys exactly the depth it can cover alone, so a market cannot pay out
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
apps/stook/               the front end
infra/ladder-crank/       opens, settles and voids markets from Pyth
scripts/devnet/           protocol init, mock USDC, market create/open from the CLI
infra/rpc-proxy/          Worker that keeps the RPC key out of the browser
docs/architecture.md      the design, and the decisions behind it
docs/feasibility.md       the measurements the design rests on
docs/design-review/       four blind designs of the mechanism, and the judging
```

The program's frame — the Anchor project, the 256 KB allocator, the protocol
config — was inherited from Sooth's `sooth_core`, and the name stayed. The
market engine is Stook's own; Sooth's binary AMM, order book and adjudication
stack were removed once the ladder could stand without them.

## Status

Deployed on devnet (`55kGEMHJyNbD3qcdonCD8UPTqzM85yg2kr6M5UF5P353`). The
program and SDK are tested end to end on LiteSVM, including a market quoted in
a real xStock, and the first devnet market has been created, opened from Pyth,
traded and joined from both the CLI and the app. Settlement needs the keeper
running with a Hermes key.

```bash
pnpm install && pnpm -F @sooth/sdk-solana build
cp apps/stook/.env.example apps/stook/.env.local   # or run scripts/devnet/setup.mjs
pnpm -F @stook/app dev                              # http://127.0.0.1:5180
```

## Licence

Apache-2.0
