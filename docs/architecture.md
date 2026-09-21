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
Bands are capped at 32, which keeps the occasional full recompute inside a
transaction.

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

## Continuous UI over banded state

A line is drawn at any price; it buys the band containing it. The band must be
visible before the trade is confirmed — someone must never believe they
committed to a finer price than the market recorded.

Bands are capped at 32 — see the compute measurements in `docs/feasibility.md`.

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

StonkFun's launchpad tokens carry a 1–3% transfer fee and stay refused: a vault
whose deposits arrive short cannot pay what the curve believes it holds.

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

- Token-2022 is proven on LiteSVM against a real xStock mint's bytes, not yet
  on devnet or against mainnet's Token-2022 build.
- The inherited `create_market` still uses the strict (`Open`-only) bar.
- The inherited SDK adapter was never updated for `create_market`'s
  `amm_mint_raw` account, so the inherited engine's SDK tests (adjudicator,
  zk, order book) fail at market creation. The ladder shares none of that path.
- The settle crank: fetch the one qualifying update from Hermes (API key
  required since 2026-08-26), post it through the Pyth receiver, call
  `ladder_settle`.
- The inherited binary engine, order book and adjudication stack are still in
  the program. Stook uses none of them; removing them shrinks the audit surface.
- Rounding dust (a few base units per market) stays in the vault after all
  claims; nothing sweeps it.
- On a market busy enough to trade every slot, a sequence-guarded join has to
  retry. A tolerance band would fix that and is not built.
- Fee ramp toward lock; fee-only LP zones.
