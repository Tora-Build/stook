# Architecture

## The reversal this document records

The first commit in this repository built a **parimutuel**: no curve, no LP,
everyone stakes and the winning band splits the pot. This commit replaces it
with an **AMM**. Recording why, because the reasoning is the useful part and a
silent rewrite would lose it.

The parimutuel case was: it is a fifth of the code, it has no cold-start
problem, and it is the mechanic behind a project that won its hackathon
category. The first two are still true. The third was the error — that project
won **Consumer Apps**, and Stook is entering **DeFi**, where the judging asks
different questions.

A parimutuel has no liquidity provision, no TVL, no yield, and no outcome share
that another protocol can hold, lend against or build on. It is also
trivially cloneable. Every one of those is a direct answer to a DeFi criterion,
and the answer is "none". Checked against 5,428 past submissions, no
pool-based prediction project has ever placed; the only prize nearby went to
one pitching *"decentralized liquidity and multi-outcome architecture"*.

So: an AMM, with the liquidity story as a feature rather than an absence.

## One market, N bands, one subsidy

The question is "where will this land", so the outcome is a price band and a
market has as many outcomes as it has bands. The scoring rule generalises
directly:

```
C(q) = b · ln( Σ exp(qᵢ/b) )
pᵢ   = exp(qᵢ/b) / Σ exp(qⱼ/b)          Σ pᵢ = 1
```

`math/lmsr_n.rs` implements this and `math/lmsr.rs` remains the two-outcome
case. A test asserts the two agree, because a generalisation that merely
resembles the original is a second implementation of the same thing, and one of
them will be wrong.

The alternative — a strip of independent binary markets, one per strike —
fragments the same liquidity into N thin pools and lets its prices sum to
anything at all. One shared `b` across the grid is what keeps the bands a
distribution rather than a collection.

The bound that matters: an LMSR's worst-case loss to traders is `b · ln(N)`, so
the subsidy funds the whole grid regardless of which band wins. That is pinned
by a test rather than a comment.

## Continuous UI over banded state

A line is drawn at any price; it buys the band containing it. The band must be
visible before the trade is confirmed — someone must never believe they
committed to a finer price than the market recorded.

Bands are capped at 64. `q` lives in a fixed-length account and every
instruction that loads it pays for the largest case; 64 puts a 1% band on a
±30% move, finer than a hand-drawn line.

## What Stook changed in the inherited engine

**The AMM's mint is per-market.** Sooth pinned `AMM_TOKEN_MINT` as a
compile-time constant, so a deployment served one token pair. Stook stores the
mint on the market, and with it the decimals — because the WAD conversion was
hard-coded to USDC's 6 and a tokenized equity with 8 run through a 6-decimal
scalar misprices by 100x, silently, in the protocol's favour. The scalar now
travels with the market.

**No graduation.** Sooth ran the venues in sequence: bond on the curve, unlock
the book at a fee threshold. Stook opens both when the curve is funded. The
curve exists so a market is tradeable at its first trade; the book exists for
anyone wanting a limit order. Neither is a phase the other leaves.

**No adjudicator.** Sooth carries manual, zkTLS and bonded-optimistic
resolution plus committees, because "did this happen" can be contested. "What
was this number" cannot, so settlement is an oracle read and the resolution
stack is unused weight here.

## Token-2022

The assets worth predicting on Solana — xStocks, and the stock-paired tokens
launched against them — are Token-2022, not classic SPL, and carry 8 decimals.
The inherited program uses `anchor_spl::token` throughout and cannot custody
them. Migrating the vault paths to `token_interface` is required before any of
these can be a market's quote asset, and is the largest single piece of work
outstanding.

Mints carrying the transfer-fee extension must be refused at creation. A vault
whose deposits arrive 3% short cannot pay what the curve believes it holds, and
supporting it properly means fee-aware accounting on every path.

## Open

- The instruction layer still trades the binary form; `trade_positions` and the
  AMM state need the N-band `q`.
- Token-2022 migration.
- LP subsidy top-ups by anyone, not only the creator.
- Oracle wiring for settlement.
