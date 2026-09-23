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

## One market, N bands, one subsidy — and why the subsidy is global

The question is "where will this land", so the outcome is a price band and a
market has as many outcomes as it has bands. The scoring rule generalises
directly:

```
C(q) = b · ln( Σ exp(qᵢ/b) )
pᵢ   = exp(qᵢ/b) / Σ exp(qⱼ/b)          Σ pᵢ = 1
```

`math/lmsr_n.rs` implements this and `math/lmsr.rs` remains the two-outcome
case. A test asserts the two agree.

The design first proposed a per-band depth `bᵢ`, so that LPs could make some
bands harder to move than others — concentrated liquidity along the outcome
axis. **That was measured and rejected**: with unequal `bᵢ` the price field is
not conservative (`∂pᵢ/∂qⱼ ≠ ∂pⱼ/∂qᵢ`), so the cost of a position depends on the
order it was built in, and a round trip extracts money from the LPs forever.
`docs/feasibility.md` §2 has the numbers.

So `b` is one number for the whole grid. What an LP chooses is not depth but
**attribution**: which bands' fees they earn and which bands' settlement loss
they bear, capped at their stake, with the creator's seed as the residual
backstop. The economics are stated plainly in the feasibility doc — ranges are
risk selection plus fee share, and a range containing the outcome pays out.

A trade does not reprice every band. The market keeps `Σ exp(qᵢ/b − m)` cached,
so a buy recomputes one exponential and costs the same at 32 bands as at 8.
There are 64 bands.

## Liquidity joins at any time, as tranches

A market that only takes liquidity before it opens cannot grow with its own
volume, so anyone may add liquidity until lock. The difficulty is pricing a
deposit into a curve that has already moved, and the blind design review
measured what goes wrong when that is done naively: +2,802 extracted from a
2,500 deposit by a sandwich.

Each deposit is a **tranche** — its own LMSR layer under the shared prices.

- It buys `b = 0.9999 · deposit / ln(1/p_min)` at the prices of the moment it
  joins: the most depth whose worst case that deposit covers alone. A late
  tranche never leans on earlier LPs' money.
- Market depth is `B = Σ bⱼ`. A trade is priced once against `B`; no tranche is
  touched.
- The tranche stores the 64 weights it joined at. At settlement in bin `k` its
  result is `bⱼ · ln(pₖ(join) / pₖ(final))`, computed from that snapshot and the
  final curve. A unit test checks that for every possible outcome the tranches'
  results sum to the pool's.
- LP fees accrue per unit of `b`, so a tranche earns only on volume it was
  present for.
- There is no withdrawal before the market is final, so liquidity cannot arrive
  for one trade's fee and leave.

**The sandwich.** A join names the `curve_seq` (a per-trade counter) the LP
read. It lands at exactly those prices or fails. A trade placed in front of a
join costs the LP a retry and the attacker a fee; the end-to-end test sends
push → join → unwind as one transaction and asserts it is refused. What is left
is an attacker holding a distortion long enough for an LP to *read* it as the
price, which means holding it against every arbitrageur — and the UI shows the
Pyth price beside the curve's.

An escrow-then-activate design was considered and dropped: if anyone may
activate, the attacker wraps the activation atomically; if only the owner may,
the delay adds nothing over a guarded join.

An LP's expected trading result is `−b · KL(final ‖ join)`: never positive. LPs
are paid by fees, or are sponsors paying for a market to exist. That is the
honest shape of an LMSR and the pitch does not hide it.

## Who finishes a market

Nobody is obliged to run a keeper, so a market pays for its own ending:
whoever settles it takes half the protocol's fee share. A void pays nothing,
so a losing trader never prefers voiding to settling. Which price settles is
fixed by the oracle rule, not by who posts it, so the bounty buys liveness
without buying discretion. See `docs/design-review/svm-review-2026-09-22.md`
for the reviews that led here.

The creator's and protocol's fee shares can only be swept from a settled
market. While it runs, `fees_protocol` *is* the bounty, and a void folds every
fee back into the refund pot; an early sweep would have starved one or
shorted the other.

**What a void refunds.** Everything the vault holds, cash and every fee, is
split into two pots. Depositors get theirs first, up to what they put in,
shared by deposit; open positions share whatever is left, by what they paid.
That remainder is short of what traders paid by exactly the gains sellers
realised before the void, and long by their realised losses.

It took three tries, and each was broken by an audit:

1. Traders at cost, LPs the remainder. A foreseeable void was a riskless
   drain: buy a bin from wallet A, pump it from wallet B, sell A into B at a
   gain, let the void refund B at cost. The house paid A's gain.
2. Everyone pro rata. B now wore its share, but the pair still netted
   `gain × D / (D + B's cost)`: 34% of the deposit on one bin, 70% across
   eight, reproduced on the binary (`design-review/audit-round-2-2026-09-23.md`).
3. Depositors first. The pair nets zero from the house: B wears A's gain in
   full. The reason it is fair and not only safe: a trader can sell at any
   time before the lock, a deposit cannot leave until the market is final.
   Whoever chose to stay in a market that did not finish shares its losses
   with the others who stayed, not with the party that could not leave.

Solvency after every trade, tranche P&L, fee attribution and the SDK quote
were confirmed on the shipped binary by both audits.

## Series: one round a day, and bands the anchor sets

**A series is one coin's rounds** (`state/series.rs`): a feed, a quote mint,
and a close ("4 PM New York", computed on chain with the US daylight-saving
rule; stock anchors use the weekday clock, which has no Saturday or Sunday
round). A round is addressed by `(series, day number)`, so one day has one
round because the program says so, and a calendar derives each day's address
instead of scanning. The protocol authority opens a series; everything after
is permissionless.

**The series learns its anchor's volatility from its own settlements.** Each
settled round's price, against the previous one, feeds an exponentially
weighted variance of daily log returns (λ = 0.94, a memory of about two
weeks). The starting value is measured once from three months of history.
Nothing here is anyone's opinion: the prices are Pyth's, picked by the
settlement rule.

**Band width follows.** A round's band is a quarter of the anchor's ordinary
move over the round's window (`band_width`), so an ordinary move spans four
bands for every coin and every window: 0.55% for BTC, 0.19% for SPY, 1.5% for
ZEC over a day, narrower for a shorter round. The 64 bands then cover about
±8 ordinary moves, and the round opens on a bell four bands wide
(`prior`), tails floored at 1/1,100 of the peak.

**When a round trades.** At most the 24 hours before its close, locking a
twenty-fourth of that before it (an hour for a daily round). It can be funded
up to two months ahead.

**Bands are set at open, not when a day is funded.** `ladder_open`, which the
keeper calls at the round's opening second with the Pyth price (and anyone
may call), reads the series' volatility at that moment and the time left, and
sets the band width, the opening bell (its width stored as `var_bands_e9`)
and the pool's depth from every deposit made so far. A deposit made before
open records only its size; its own depth and the odds it joined at are
recomputed from its size and the stored bell whenever it is paid
(`tranche_terms`), exactly as `open` computed them. So a day funded weeks
ahead opens as fresh as one funded that morning, and nobody who funds early
can lock in stale bands. Bands are at least 0.2%: the settlement price's
confidence must be under half a band, and equity-token feeds print several
basis points even when quiet.

**Fees.** 2% of every trade, rising in a straight line over the last six
hours to 5% an hour before the close (the lock of a daily round), and no
higher (`fee_bps_at`). The late hours are when the close is mostly known and
trading against the house is sharpest; replayed over a whole day of trading on
4,493 real rounds (`scripts/backtest/house.py`), this schedule broke the
house even at about 3x its deposit in daily volume, where a flat 1% lost 9%
and a flat 2% lost 3%. 90% to the depositors by depth, 10% to the protocol,
half of which pays whoever settles. The first funder gets nothing extra: a bonus for being
first could be taken with a one-token seed on every round.

**Why, measured.** Replayed over 4,493 real daily rounds on seven assets
against a trader who knows the price at the lock (`scripts/backtest/`):
flat 1% bands lost the house 74.5% of its deposit per round; a bell with a
fixed width per coin, 17.3% (41% in the worst 5%); volatility-sized bands,
16.6% (35%). What carries the result is calibration; the bell's exact shape
and its tail floor barely matter per unit of depth. The remaining loss is the
cost of the day's information, which no opening curve removes; fees pay it.

## Clearing up

Thirty days after a round's close, anyone may pay out a position or deposit
its owner never collected (`ladder_redeem` / `ladder_claim_lp` with a caller
who is not the owner): the money goes to the owner's token account and the
rent to the owner, so an absent winner cannot hold a finished round open.
The keeper does it, then closes the round.

Every position and tranche is counted on the round. A round cannot close
before its close time, so a day voided early keeps its address and cannot be
started again on different terms. A position owed nothing
(a miss, a line sold to zero) can be swept by anyone, its rent to its owner
(`ladder_sweep`). Once none are left and the fee shares are collected,
anyone can close the round (`ladder_close`): dust to the treasury, the
round's and the vault's rent (about 0.016 SOL) to whoever funded it. A
Token-2022 vault holds the transfer fees it was charged; the close harvests
them to the mint first, since Token-2022 will not close an account over
them. The keeper does all of this for finished rounds.

## Continuous UI over banded state

A line is drawn at any price; it buys the band containing it. The band must be
visible before the trade is confirmed — someone must never believe they
committed to a finer price than the market recorded.

64 bands, log-spaced; the width per band is the market's tier.

## What Stook changed in the inherited engine

**The AMM's mint is per-market.** Sooth pinned `AMM_TOKEN_MINT` as a
compile-time constant, so a deployment served one token pair. Stook stores the
mint on the market, and with it the decimals — because the WAD conversion was
hard-coded to USDC's 6 and a tokenized equity with 8 run through a 6-decimal
scalar misprices by 100x, silently, in the protocol's favour. The scalar now
travels with the market.

**No order book, no graduation.** Sooth ran two venues in sequence: bond on
the curve, unlock the book at a fee threshold. Stook first opened both at
once, then removed the book altogether: a 64-outcome market has no natural
book, and the inherited one was 1.2 MB of program the ladder never called.
The program went from 1.82 MB to 567 KB.

**No adjudicator.** Sooth carries manual, zkTLS and bonded-optimistic
resolution plus committees, because "did this happen" can be contested. "What
was this number" cannot, so settlement is a Pyth read — the 24/7
`Equity.Index.*` feeds, consumed by a vendored `PriceUpdateV2` layout with no
Pyth crate — and the resolution stack is unused weight here.

## Token-2022, and what an xStock actually is

Every ladder path moves tokens through `token_interface`, so one code path
serves classic SPL (USDC) and Token-2022. What needed care is which Token-2022
mints a vault may hold, and the first version of that answer was wrong.

The first guard refused a mint for *carrying* any of seven extensions. Read
against a real xStock — NVDAx, from mainnet — it refused the entire asset
class: xStocks carry `PermanentDelegate`, `Pausable`, `TransferHook`,
`DefaultAccountState`, `ConfidentialTransferMint`, `ScaledUiAmount` and
metadata. Two things were wrong with refusing by name:

- Several of those are inert as configured. The `TransferHook` names no
  program, so no code runs. `DefaultAccountState` is `Initialized`.
  `ConfidentialTransferMint` cannot reach an account that never opts in, and a
  vault never does. `ScaledUiAmount` changes the displayed amount only — it is
  how a tokenized stock survives a split — so the ladder accounts in raw units
  and a UI applies the multiplier.
- The rest are not defects to handle but **issuer powers**: a permanent
  delegate can empty any account of that mint, a pause authority can stall
  every transfer. No program can defend against either. That is what a
  regulated issuer's clawback looks like on chain, and holding the token at all
  means accepting it.

So `token_guard` now reads each extension's contents and returns one of three
verdicts:

| verdict | meaning | who may create a market |
|---|---|---|
| `Open` | nothing breaks the accounting, nobody holds power over the vault | anyone |
| `IssuerTrusted` | custodiable, but the issuer can move or stall vault funds | anyone, **once the protocol authority has approved the mint** (`approve_quote_mint`) |
| `Refused` | transfer fee, non-transferable, a hook that names a program, frozen-by-default, interest-bearing, or anything unrecognised | nobody |

The approval is per mint, made once, and says exactly one thing: *we accept
this issuer's powers*. It cannot lower the bar for a `Refused` mint. Revoking
it stops new markets and leaves existing ones to finish.

**Transfer fees.** StonkFun sets a 1% transfer fee on every launch, $STOOK
included, so refusing fee-bearing mints would refuse Stook's own coin. Every
deposit — the creator's seed, a buy, an LP join — now goes through one
`pull`: the program reads the mint's fee schedule for the current epoch,
sends the gross that lands at least the net, then reloads the vault and
credits only what arrived. A shortfall of any size reverts. Payouts send
exactly what the pool owes and the receiver gets the mint's fee less; the
app shows both numbers. The fee authority can change the rate, so such a
mint is `IssuerTrusted` and needs the one-time approval. Proven on LiteSVM
against $STOOK's real bytes with Token-2022 taking its 1% on every transfer
(`tests/ladder-stook.test.ts`).

Two things about the toolchain, both found by running the real mint:

- The `spl-token-2022` crate Anchor 0.30.1 pins (3.0.5) predates
  `ScaledUiAmount` and `Pausable`, and errors on a mint carrying an extension
  it has no name for. The guard therefore walks the TLV region by type number.
- For the same reason Anchor's `init` could not size a vault for an xStock.
  The vendored `anchor-syn` fork now sizes token accounts by the same walk
  (a 175-byte account for NVDAx: base, type byte, `TransferHookAccount`,
  `PausableAccount`).

`tests/ladder-token2022.test.ts` runs a whole market on NVDAx's real bytes:
refused unapproved, approval refused from a non-authority, then create → trade
(SDK quotes exact at 8 decimals) → late LP → settle → redeem → claim, supply
conserved. That is LiteSVM's Token-2022, not mainnet's; a devnet run with a
mint carrying the same extensions is still owed.

## Open

Ranked by the second and third audits (`design-review/audit-round-*`):

- **The band width is read when a day is funded, not bound by the funder.**
  An expected-terms argument on `ladder_create` would let the app refuse a
  round whose width moved between display and signature.

- **Mainnet prerequisites.** Build with `--features mainnet` (Full-verified
  Pyth updates only) and run the keeper with `FULL_VERIFICATION=1`.
  `initialize_protocol` is first-come: initialise in the same breath as the
  deploy, or bind it to the upgrade authority.
- **LP joins are exact-sequence.** A busy round, or a bot trading dust every
  slot, makes a join retry indefinitely. A bound on depth received
  (`min_b`) would keep the sandwich refused without the retry.
- **The freeze authority is not read.** A classic mint whose issuer can
  freeze the vault is classed Open while an equivalent Pausable mint needs
  approval. Harmless for the devnet mock; USDC on mainnet has one.
- **Opener discretion.** Any update up to 60 s old opens a round, so the
  opener picks the centre from a minute of prints. Now that `opens_at` is
  fixed by the round, open should use the settlement rule
  (`prev < opens_at ≤ publish`).
