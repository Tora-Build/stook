# Who else built this? (as of 2026-09-24)

Sources: Colosseum Copilot (5,400+ Solana hackathon submissions, winners and
accelerator filters, research archive) and a web sweep across chains. Figures
from web sources are as reported, not independently verified; unverified
claims are marked.

## Verdict

Nothing found combines what Stook does: one LMSR over ~64 volatility-sized
price bands, tapered "line" payouts beside flat ranges, a house of per-round
LP tranches with loss capped at the deposit, a daily Pyth close at 4 PM New
York on stocks, and quoting in stock-anchored memecoins. Each piece has a
precedent; the combination does not, as far as the corpus and a web search
can tell.

## Closest, in order

1. **Signals** (signals.wtf). Solana **Breakout (Apr 2025), no prize**:
   "interval-based predictions on Bitcoin price ranges" (`signals`,
   github.com/swimmiee/signals-breakout). The same team (same @signalswtf)
   later built a "CLMSR", a continuous LMSR over BTC price ticks with one
   pool, on **Citrea** (a Bitcoin rollup), testnet in 2025, mainnet
   announced around Jan 2026; domain unreachable when checked, traction and
   LP design unverified. Closest mechanism. Differs: BTC only, no tapered
   lines, no daily stock close, no per-round bounded LP tranches, no memecoin
   quoting.
2. **Kalshi S&P 500 / Nasdaq-100 "range at 4pm" markets**. The same
   question at the same close, as fixed binary buckets on a regulated order
   book with market makers; tokenized onto Solana through DFlow/Jupiter
   since late 2025. Differs: no AMM, no LP house, no taper, USD.
3. **Paradigm "Distribution Markets"** (Dave White, Dec 2024; archive:
   paradigm_research). Trade a whole distribution; the first LP backs the
   pool with collateral and loss is bounded. Research only; a community
   Solidity repo; one Solana attempt: **Oracle's Edge**, Cypherpunk
   (Sep 2025), no prize (`oracle's-edge:-solana-based-distribution-prediction-market`).
   Differs: continuous parametric shapes (normal/lognormal) under an
   L2-norm AMM; Stook discretizes into bands under LMSR, so any shape trades
   and loss is exactly b·ln(1/p_min) ≤ deposit.
4. **Thales ranged and speed markets (now Overtime)**. IN/OUT ranges and
   up/down on crypto, Pyth-settled, an LP pool as counterparty with per-round
   P&L. Priced by Black-Scholes, not a scoring rule, so LP loss had no hard
   cap; the team pivoted to sports (rebrand Apr 2025). No LP return data found.
5. **Azuro, Divvy.bet (LP as the house, sports)**. Same "be the house"
   economics; pooled across events, not one bounded tranche per round. Azuro
   (DefiLlama): about $1.4M TVL and −$232k 30-day fee result, i.e. bettors
   won; its docs say LPs held under a week are usually negative. The honest
   precedent for Stook's own house economics.

## Solana hackathons: prediction and price-game projects

- Placed:
  - **TapGuru**: tap a price-path grid, Pyth-style price settlement,
    exponential payout. **Breakout, Honorable Mention DeFi ($5k)** (`tapguru`).
    The nearest winning project in spirit; no pool mechanism.
  - **Riverboat**: multi-outcome AMM with decentralized LP pools.
    **Breakout, Honorable Mention Consumer ($5k)** (`riverboat`). Cited in
    Stook's own architecture doc as the only pool-based prediction project
    near a prize.
  - **Melee Markets**: pump.fun-style speculation on prediction markets.
    **Breakout, 2nd Consumer ($20k)** (`melee-markets`).
  - **BananaZone**: perps plus prediction markets, arcade style. **Breakout,
    4th DeFi ($10k)** (`bananazone`).
  - **Capitola** (prediction market aggregator), **Cypherpunk 1st Consumer
    ($25k)**, accelerator; **Trepa** (sentiment staking), **Breakout 1st
    Consumer ($25k)**, accelerator; **Fora**, **Cypherpunk 3rd Consumer**.
    Not price markets.
- LMSR on Solana, no prize: **Mood Ring** (Cypherpunk, `mood-ring-or-permissionless-prediction-markets`),
  **tap2bet** (Breakout, `tap2bet`).
- Price or memecoin prediction, no prize: **Grail Market** (Radar; forex,
  crypto, equities), **The Meme Arena** (Radar; 24h memecoin parimutuel),
  **Bet on Pump**, **Pumply.Market**, **Parity** (Pyth-settled peg
  deviations), **Bull or Bear** (30-second BTC), **Guess Up or Down**
  (Renaissance; Nasdaq close up or down), **Prediksi.lol** (Breakout; stock
  futures for Indonesia).
- Pattern: prediction markets place in **Consumer** when they are social or
  viral, and in **DeFi** only when they add a trading or liquidity primitive
  (TapGuru's grid, Riverboat's LP architecture). Pure "bet on price" games
  without a mechanism did not place.

## Live products worth knowing

- **Hyperliquid HIP-4** (May 2026): fully collateralized binaries on an
  order book; ~$46M in 30 days (loris.tools/hip4).
- **Limitless** (Base): hourly and daily above/below on crypto and stocks,
  CLOB; $10M seed + $4M; ~$1B monthly volume reported.
- **Polymarket** "Bitcoin price on <date>" multi-outcome markets (CLOB).
- **Jupiter Forecast** (Jun 2026): Solana-native prediction market with
  competing market makers.
- **Gensyn Delphi** (Apr 2026): production on-chain LMSR, non-price markets.
- Dormant or unclear: Augur, Gnosis/Omen LMSR, Drift BET, Hedgehog, Hxro,
  Buffer Finance (unverified status for several).
- **StonkFun / xStocks**: no prediction product found on either; 63% of
  xStocks volume trades outside US hours (solana.com case study).

## What this means for Stook

- The mechanism has lineage a judge will recognise: Hanson's LMSR, Paradigm's
  distribution markets, Kalshi's 4pm range markets. Stook is the on-chain,
  LP-backed, memecoin-quoted version of Kalshi's S&P range market, with
  distribution-market ideas made computable on Solana.
- The strongest differentiators to lead with: volatility-sized bands learned
  on chain from Pyth, loss per LP capped by construction, tapered lines, and
  a market for stock-anchored memecoins that nobody else serves.
- The weakest point, shared by every LP-house design (Azuro's numbers,
  Thales' pivot): the house loses to informed flow unless volume is high.
  Stook's own backtest says the same; the rising fee and the sponsor framing
  are the answers to have ready.
