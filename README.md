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
- **Liquidity is provided, not assumed.** Anyone can deepen a market by adding
  to its subsidy and earns a share of the fees it collects. The worst an LMSR
  can lose to traders is bounded by that subsidy, so a market cannot pay out
  more than someone chose to underwrite.
- **Any token as the quote.** The AMM is denominated in whatever the market
  names — a stablecoin, a tokenized equity, or a stock-paired token launched
  against one. The order book stays in USDC.
- **Settlement is a number with a source.** An oracle reads the price and it
  lands in a band. No vote, no committee, no dispute window.

## What it is built on

The engine — the LMSR, the on-chain order book, LP and fee flows — is inherited
from the Sooth protocol, where the Anchor program is called `sooth_core`. Stook
changes the venue model rather than the maths: the AMM's mint became a property
of each market, both venues open together instead of one graduating into the
other, and the scoring rule generalised from two outcomes to N price bands.

## Layout

```
packages/programs-core/   the Anchor program (sooth_core)
packages/sdk-solana/      instruction builders, readers, quote maths
apps/demo/                the front end
docs/architecture.md      what changed from Sooth, and why
```

## Status

Pre-alpha. The N-band scoring rule and the per-market quote token are in; the
instruction layer still trades the binary form. Nothing is deployed.

## Licence

Apache-2.0
