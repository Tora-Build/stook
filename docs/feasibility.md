# Feasibility — measured, not estimated

Every claim below was tested against the real toolchain (Anchor 0.30.1,
solana-cli 3.1.8, `cargo build-sbf`, LiteSVM 1.3) or the live devnet on
2026-09-21. Where a number is a projection it says so.

## Verdict

Buildable on Solana in the current stack, with **one design correction** the
measurements forced: liquidity depth cannot vary per tick inside the pricing
rule. Everything else — compute, state, Token-2022, oracle consumption,
settlement timing — fits with room.

## 1. Compute — the N-tick curve fits, incrementally

A probe program (`tools/cu-probe`) ran the actual `lmsr_n` code on SBF.
Compute units per operation, measured between `sol_log_compute_units` marks:

| N  | reprice all ticks | buy, full recompute | buy, cached Σexp |
| -- | ----------------: | ------------------: | ---------------: |
| 8  |            95,262 |             194,942 |       **36,406** |
| 16 |           203,941 |             388,869 |       **36,814** |
| 32 |           420,820 |             785,947 |       **37,703** |
| 64 |           875,643 |   exceeds 1.4M cap  |       **38,638** |

The 128-bit fixed-point `exp` costs ~13K CU, so anything touching every tick
scales at ~13K × N. A trade that keeps `Σ exp(qᵢ/b − m)` cached in state
recomputes **one** exp and is flat in N. That is the design.

Against the shipped binary `trade_positions`, measured the same way:
**86,787 CU** first buy, **96,586 CU** warm — of which the LMSR math is ~30K
and the rest is account deserialisation, two token CPIs, the LP mint and the
event. An N-tick trade is therefore projected at **~100K CU**, indistinguishable
from today.

Cache maintenance: the shift `m = max(qᵢ/b)` moves when a tick becomes the new
maximum. Every cached term is then multiplied by one scalar `exp(m − m′)` —
N multiplications, not N exponentials (~26K at N = 32). `exp_wad` saturates
the negative tail below −64·WAD to zero, so a tick far below the max is
simply 0 in the cache. A full recompute stays available as a crank and fits at
N = 32 (421K) with headroom; **N is capped at 32** for that reason, not 64.

## 2. Pricing — per-tick depth is not a scoring rule

The intended model gave each tick its own depth `bᵢ`, priced as
`pᵢ ∝ exp(qᵢ/bᵢ)`. Tested for path independence: buy 200 on tick A then 200
on tick B, versus the reverse.

| depth layout                     | A→B     | B→A     | difference |
| -------------------------------- | ------: | ------: | ---------: |
| uniform b = 500                  | 109.930 | 109.930 |   +0.0000  |
| tick B at 4× depth               | 104.268 | 108.481 |   −4.2136  |
| tick A at 4× depth               | 108.481 | 104.268 |   +4.2136  |
| uniform b, per-tick prior weight | 150.531 | 150.531 |   −0.0003  |

The mixed partials `∂pᵢ/∂qⱼ = −pᵢpⱼ/bⱼ` and `∂pⱼ/∂qᵢ = −pᵢpⱼ/bᵢ` are unequal
unless `bᵢ = bⱼ`, so the price field is not conservative and the cost of a
position depends on the order it was built in. A trader who buys in the cheap
order and unwinds in the dear order extracts ~4.2 per round trip from the LPs,
indefinitely. **Per-tick `b` is out.**

What survives: **one global `b`**, with LP ranges as an *attribution* layer —
who earns a tick's fees and who bears a tick's settlement loss — rather than a
pricing layer. Per-tick prior weights `wᵢ` remain available and are
conservative, but they express a belief, not depth.

## 3. LP attribution — solvent and exact

Scheme: the creator's seed sets `b` and is the residual backstop. Range LPs
stake on ticks; each earns that tick's premium pro-rata to stake and bears that
tick's settlement loss pro-rata, **capped at their stake**; anything above the
cap falls to the seed.

Simulated (N = 16, b = 2000, 600 trades around the outcome):

```
vault 5,660  payout 297  solvent ✓
Σ LP net −181.8 = AMM total −181.8   attribution exact ✓
no LP below zero ✓
```

The honest economics under a single `b`: a range LP whose span contains the
outcome bears the loss and gets no depth benefit for being there. Ranges are
**risk selection plus fee share** — "provide where you think it will not land,
earn fees where flow is" — and nothing more. Fees do concentrate on the ticks
nearest the outcome, so "closer earns more" is true of fees and false of
inventory. Both facts go in the product copy.

## 4. State

`AmmState` gains `q[32]`, `e_cache[32]`, `sum`, `m` → ~1.2 KB, Borsh, `Box`ed,
under the program's existing 256 KB bump allocator. One `Position` PDA per
`(market, user, tick)`, seeds extended with the tick; rent ~0.0018 SOL each,
reclaimable. No instruction exceeds the account or transaction-size limits.

## 5. Token-2022

`anchor_spl::token_interface` (`InterfaceAccount`, `Interface<TokenInterface>`)
is present in anchor-spl 0.30.1. The extension guard already ships
(`token_guard.rs`). Vault paths migrate mechanically; ~75 sites across 20
files.

## 6. Oracle — Pyth, consumed without the Pyth crate

`pyth-solana-receiver-sdk` fails to compile against Anchor 0.30.1 (18 errors:
its `>= 0.28` bound pulls a second `anchor-lang`, and `borsh-derive` breaks on
current `syn`). Pinning did not resolve it. Instead the `PriceUpdateV2` layout
is **vendored** (~40 lines, `#[account]` with an `owner = receiver` constraint)
and compiles clean with zero Pyth dependencies.

Validated against live devnet accounts under the receiver program
`rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ`:

| feed     | accounts | discriminator | verification     | decoded  |
| -------- | -------: | ------------- | ---------------- | -------- |
| SOL/USD  |   29,406 | ✓             | Partial, 3 sigs  | $98.58   |
| NVDA/USD |       48 | ✓             | Partial, 5 sigs  | $205.47  |

Every devnet post is `Partial`; there are **zero** `Full`-verified accounts.
Settle must accept `Partial { num_signatures ≥ min }` with `min` in protocol
config — 5 on devnet, `Full` on mainnet.

The push oracle (`pythWSn…`) does not exist on devnet (program absent, 0
accounts), so the settle crank posts the update itself via the receiver, then
settles. Devnet's existing partial-signature posts prove that path works.

## 7. Oracle — off-chain

Hermes moved behind an API key on 2026-08-26 (`hermes.pyth.network`,
`pyth.dourolabs.app/hermes`, and Benchmarks all return 401). A **free trial**
key from Pyth Terminal is required for the crank; `@pythnetwork/hermes-client`
3.1.0 takes it as a Bearer header via `HermesClientConfig.headers`.
`@pythnetwork/pyth-solana-receiver` 0.16.0 wants `@coral-xyz/anchor ^0.29`
against the repo's `^0.30.1`; under pnpm this nests cleanly, and the raw
instruction is the fallback.

The historical route `/v2/updates/price/{timestamp}` exists (401, not 404),
so a deterministic "price as of the deadline" is available if needed.

## 8. Settlement timing

`Equity.Index.*` feeds are **24/7** — confirmed by Pyth's 2026-06-10 launch
(NVDA sourced from extended-hours venues; Coinbase, Kraken and dYdX settle
perps on them). The metadata `schedule` field shows NYSE hours on both feed
families and is boilerplate; the description is authoritative. Thirty names
exist (NVDA, TSLA, AAPL, MSFT, US500, US100, …).

So a market on `Equity.Index.NVDA/USD` settles at any hour with a plain
staleness check (`now − publish_time ≤ max_age`). Markets on `Equity.US.*`
would need the historical route. Stook quotes the Index feeds.

## 9. Prior art

Oracle's Edge (Cypherpunk 2025) pitched this exact design. Its repo's
`QUICK_FIX.md` is about the program ID still being a placeholder — it was
never built. The pitch exists; the product does not.

## Open

- Migrate the instruction layer: `AmmState` arrays, cached-Σexp trade path,
  `seed_range`, per-tick `Position`, settle.
- Token-2022 vault paths.
- Obtain the Pyth Terminal trial key; wire the crank.
