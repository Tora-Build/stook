# pm-AMM for Stook: study and decision

Date: 2026-11-15. Deadline: 2026-12-05.

Tags: **[M]** means measured, or checked in code, on chain, or by a script. **[E]** means estimated or inferred.

## 1. Short answer

- **Do not replace the 64-band LMSR with a pm-AMM.** pm-AMM exists only for binary markets. No multi-outcome version exists. The newest paper (AFT 2026) lists multi-outcome as future work.
- **Our ladder already has pm-AMM's main property.** Under the same Gaussian model, its LVR is the same share of value at every price. The Fisher-information argument in §3 shows this. Against LMSR, pm-AMM gives about 1% better execution [M, script].
- **Take the one new idea: liquidity that falls with time.** Make `b` fall toward the lock (option C). In our simulation with no fees, mean house loss to informed flow falls from 16.6% to 8.2% of the deposit per round. The worst case does not change [M, sim].
- **Build C only for house rounds.** Start with crypto coins, which trade 24/7. Run the simulation again with the fee ramp before we ship it. If it is not ready by about 11-28, ship it after the hackathon and use it in the pitch as a design result.
- **The $1k PREDICTSpark bounty asks for "the $PREDICT pm-AMM".** That is one deployed program (GV1F…). An "Up or Down" market on GV1F (option D1) is the only option that could qualify. Do it only if the organizers confirm it counts and real users exist to send to it. Main-track traction comes first.

## 2. How the pm-AMM works

### 2.1 The model (Paradigm, Nov 2024)

- A hidden score moves as a random walk: `dZ_t = σ dB_t`. YES pays $1 if `Z_T ≥ 0`.
- The fair price is `P_t = Φ(Z_t / (σ√(T−t)))`. Φ is the normal CDF and φ is the normal density.
- The price moves as `dP_t = φ(Φ⁻¹(P_t)) / √(T−t) · dB_t`.
  - The price moves most near P = 0.5.
  - The price moves faster as the close comes near, at a rate of `1/√(T−t)`.
- Every AMM loses value to arbitrageurs who know the true price. This loss is **LVR** (loss-versus-rebalancing). Itô's lemma gives:
  `LVR_t = −½ · φ(Φ⁻¹P)² / (T−t) · V″(P)`. Here V(P) is the pool value at price P.

### 2.2 Why "uniform LVR"

- A design goal: the LP's loss rate should be the same fraction of pool value at every price. Then the LP is not hit harder when a market is near 0 or 1.
- AFT 2026, Theorem 10: a uniform pool minimizes the worst-case relative LVR across prices. This gives a real reason to prefer it [M, read].
- The fraction cannot be constant in time, because LVR has a `1/(T−t)` term. So the design sets `LVR = β·V/(T−t)`. This gives `φ(Φ⁻¹P)² V″ + 2βV = 0`.
- Solve it with `u = Φ⁻¹(P)`. With β = ½ the solution is `V = L·φ(u)`.

### 2.3 The static pm-AMM

- **Reserves:** `y = L(uP + φ(u))` (NO side) and `x = y − L·u` (YES side).
- **Invariant:** `(y−x)Φ((y−x)/L) + Lφ((y−x)/L) − y = 0`.
- **Results:**
  - `LVR_t = V_t / (2(T−t))`.
  - `E[V_t] = V₀·√((T−t)/T)`.
  - The LP loses the full pool value by the close. LVR is uniform in price but rises in time.

### 2.4 The dynamic pm-AMM

- **Schedule:** liquidity shrinks as `L_t = L₀·√(T−t)`. At a fixed price the reserves scale with L. The removed part goes to LPs as YES + NO tokens. Those tokens still depend on the outcome. They are not free cash.
- **Results:**
  - `E[LVR_t] = V₀/(2T)`, which is constant in time.
  - `E[V_t] = V₀·(T−t)/T`.
  - The LP's expected wealth at the end is **W₀/2** with zero fee.
- **AFT 2026 Theorem 14:** you can pick any target loss curve D(t) and derive the liquidity schedule for it. A front-loaded curve is allowed.

### 2.5 Worked example (static, L = 1000) [M, script `pm.py`]

| P | YES reserve x | NO reserve y | Pool value V |
|---|---|---|---|
| 0.50 | 398.94 | 398.94 | 398.94 |
| 0.90 | 47.3 | 1,329 | 175.5 |
| 0.99 | 3.39 | 2,329.7 | 26.65 |

At P = 0.5:

| Trade | Result | Average price | New P |
|---|---|---|---|
| Buy with $100 | 186.21 YES | 0.537 | 0.574 |
| Buy with $300 | 501.7 YES | 0.598 | 0.692 |
| Sell 100 YES | $48.01 | 0.480 | 0.460 |

The same trades on an LMSR with the same maximum loss (b = 575.55):

| Trade | LMSR | pm-AMM | Difference |
|---|---|---|---|
| $100 at P = 0.5 | 185.17 shares | 186.21 shares | pm-AMM 0.6% better |
| $300 at P = 0.9 | 325.4 shares | 324.4 shares | pm-AMM 0.3% worse |

Relative LVR, multiplied by (T−t):

| P | pm-AMM | LMSR | CPMM |
|---|---|---|---|
| 0.5 | 0.500 | 0.459 | 0.318 |
| 0.99 | 0.500 | 0.641 | 0.906 |
| 0.999 | 0.500 | 0.718 | 1.42 |

LMSR is already near uniform. CPMM is not.

Dynamic schedule over a 24 h round, with L = 1000 at open:

| Time left | L | E[V]/V₀ dynamic | E[V]/V₀ static | Average price for $100 at P = 0.5 |
|---|---|---|---|---|
| 24 h | 1000 | 1.00 | 1.00 | 0.537 |
| 6 h | 500 | 0.25 | 0.50 | 0.569 |
| 1 h | 204 | 0.042 | 0.20 | 0.645 |
| 15 min | 102 | 0.010 | 0.10 | 0.733 |

The UX cost is clear: late bets get much worse prices.

### 2.6 How a trade is solved

| Trade | Closed form? |
|---|---|
| Sell YES for USDC | Yes: `u′ = u − q/L`, payout `y − y(u′)` |
| Buy a fixed number of shares D | Yes: `u′ = u + D/L`, cost `L·(g(u′) − g(u))` with `g(u) = uΦ(u) + φ(u)` [M, residual 1e-13] |
| Buy with an exact USDC amount | No. Needs a root solve (bisection + Newton) |
| YES to NO swap | No. Needs a root solve |

### 2.7 Mapping to "close above K"

- `P = Φ(ln(S/K) / (σ√τ))`. Here τ is the variance-time still to come.
- Example: S = 600, K = 603, σ = 1% per session.

| Time left | z | P |
|---|---|---|
| 6.5 h | −0.50 | 0.309 |
| 1 h | −1.27 | 0.102 |
| 15 min | −2.54 | 0.0055 |

## 3. How Stook works today

### 3.1 The ladder

- **One LMSR per round over 64 bands** (`math/ladder.rs:36`). The state is `w_i = exp(q_i/b)` and their sum S. A band's price is `w_i/S`.
- **A trade costs one `exp` and one `ln`,** whatever the width (`math/ladder.rs:243-341`). `lmsr_n.rs` is now only a test reference.
- **Shapes:** a flat band (`Between`) or a tent (`Near`). Max height is 8. One shape per transaction.
- **Limits:** `MAX_TRADE_EXPONENT` = 20 (`math/ladder.rs:61`). The program rescales the curve when a weight passes `W_MAX`.
- **Band width** is σ/4 (`SIGMA_BANDS` = 4, `math/ladder.rs:133`), clamped to 20..2000 bps. σ is an on-chain EWMA of Pyth closes.
- **Opening prior:** a Gaussian bell with peak/tail ratio e^7 (`PRIOR_PEAK_LN`, `math/ladder.rs:140`). Centre band ≈ 9.9%. Smallest band ≈ 9.07e-5 [M].

### 3.2 Liquidity and loss

- **b from the deposit:** `b = 0.9999·D / ln(1/p_min)` (`liquidity_for_deposit`, `math/ladder.rs:436`). With the bell, `ln(1/p_min)` = 9.31, so **b ≈ 0.107·D** [M].
- **The worst case is the full deposit D,** on a tail band. The comment at `math/ladder.rs:433-434` says "ln 64". That comment is out of date.
- **Depth is thin.** Doubling the centre band's price costs only about 1.2% of D [M].
- **Each trade checks solvency:** `cash ≥ max payout`.
- **Uniform LVR in price** [E, derived and checked by script `ladder_lvr.py`]:
  - The ladder is 63 Gaussian-score binaries on one Z.
  - `LVR = ½·b·σ²·I(Z)`, where I is the Fisher information. For bands narrower than σ√τ, `I ≈ 1/(σ²τ)`. So **LVR ≈ b/(2τ) at every price.**
  - This fails near the grid edges, where tails are floored at e^-7. It also weakens at very small τ (0.33 at τ = 0.01, against 0.5).
- **Expected loss with constant b, open to lock:** 1.53·b = 1.53/9.31 ≈ **16.4% of D** [M, script]. The repo backtest gives **16.6%** over 4,493 rounds (`scripts/backtest/README.md`). The two numbers agree.

### 3.3 Fees

- 2% base (`LADDER_FEE_BPS`, `instructions/ladder.rs:24`). It rises in a straight line from 6 h before the close to 5% at 1 h before (`:33-47`). The lock gap is 2 min to 1 h (`:59`).
- 90% goes to LPs and 10% to the protocol. Half of the protocol share goes to whoever settles.
- Break-even needs daily ordinary volume of about 3× depth [M, backtest].

### 3.4 House

- One house per series with a shared vault. `house_start` commits `clamp(15×fee_ema, assets/10, assets)`.
- House rounds refuse outside LP joins (`instructions/ladder.rs:917`). So a house round has one tranche.

### 3.5 Cost numbers

| Item | Value | Tag |
|---|---|---|
| `ladder_trade` on devnet (n = 310) | 44.5K / **58.8K** / 85.6K CU (min / median / max), 598 B | M |
| `ladder_trade` on mainnet (n = 2) | 85.6K, 95.1K CU, 893 B | M |
| Fixed overhead per trade | about 31.6K CU | M, audit |
| Settle / redeem | 13.6K / 9.5K CU | M, LiteSVM |
| Claim of a deposit made before open | about 114K CU | M |
| Heap frame | 256 KB required on every tx. Blocks CPI and Squads callers | M |
| Rent per round | about 0.017 SOL, refunded | M |
| Rent per position | 0.00121 SOL, refunded | M |
| Rent rate on mainnet today | 5.08 SOL per MB (`solana rent`) | M |
| Program, local build | 1,037,304 B ≈ 5.27 SOL | M |
| Program, mainnet build (opt-z) | 678 KB ≈ 3.45 SOL, plus a buffer of the same size that is refunded | M (size), E (rent) |

### 3.6 Record

- Mainnet: **2 trades in 12 rounds.** The house ended +7.9%. With n = 2 this says nothing about the maker. The real finding is no traction.
- Devnet sim bots: houses lost 7-18% over two rolls.
- The mainnet program was closed today. A relaunch very likely needs a **new program id**, because the loader does not reuse a closed id [E, confirm].

## 4. Who built a pm-AMM already

| Repo | Chain / status | Φ, φ | Trade solve | CU per swap | Quality |
|---|---|---|---|---|---|
| [sparkfun-labs/pm-amm](https://github.com/sparkfun-labs/pm-amm) (program GV1F…, "the $PREDICT pm-AMM") | Mainnet since 2026-06: **134 txs total, 23 swaps**. Devnet: 3,974 txs [M] | 2,049-point f64 Hermite table | 6 bisection + 3 Newton steps; closed-form sell; 2% fee (1% DAO, 1% creator) | Mainnet **462K / 611K / 775K** [M] | Binary only. Admin resolves, no oracle. Internal audit only, one upgrade key. Classic SPL only, no Token-2022. No close-market instruction. 1.55 MB program |
| [Mattdgn/pm-amm](https://github.com/Mattdgn/pm-amm) (upstream of the above) | Devnet `8V87…`, 129 txs | Same table; A&S erf and Acklam Φ⁻¹ on the slow path | Same | Devnet 660K to 1.3M [M] | 52 Rust tests pass [M]. No fees. Monte Carlo LP wealth 0.518 vs 0.5 target |
| [EwanSpark/pmAMM](https://github.com/EwanSpark/pm-amm) (earlier build) | Devnet `EvWE8…`, 1,996 txs, inactive since May | u128 at 1e12 | Newton on the reserve, up to 50 steps | not measured | Binary |
| [Apostlex0/PredictionMarket_AMM](https://github.com/Apostlex0/PredictionMarket_AMM) | Aptos testnet (Move) | Q64.64 | Newton, up to 20 steps | n/a | Binary, has a dynamic module |
| 0xr10t/pm_amm | Solidity port, no deploy found | Q64.64 | Newton | n/a | "Unaudited" |
| Gnome101/Pm-AMM-Hook | Uniswap v4 hook prototype | solstat erfc | 100-step bisection | n/a | Static only |
| Samarth208P/prediction-market-pm-amm | Solidity + React demo | solstat | Newton | n/a | Demo |
| [0xfps/pmamm-js](https://github.com/0xfps/pmamm-js), microprediction `pm_amm.py` | Off chain | float64 | Bisection | n/a | Reference only |

**Apps on GV1F (the bounty rivals).** [LMH-Solutions/strikebook](https://github.com/LMH-Solutions/strikebook) runs ladders of SOL/BTC strike markets seeded at Φ(d2), with a Pyth keeper. It has 163 markets and 635 trades. By its own count, 633 of those trades are from its own wallets. Others: pulse-markets, predictpilot, helm, viber, oraclemarkets.

**Not a pm-AMM:** Sortis-AI/sol-pm is a constant-product AMM. Paradigm "Distribution Markets" is an L2-norm design.

### 4.1 Where the CU goes in GV1F [M, own SBF bench under LiteSVM]

| Step | CU |
|---|---|
| Accrual as shipped (erf, then Φ⁻¹, then reserves) | 273,621 |
| Buy solver at P = 0.5 | 95,864 |
| YES to NO solver at P = 0.0008 | 182,836 |
| Closed-form sell | 12.7K to 13.6K |
| Φ via erf / via f64 table | 46,039 / 4,639 |
| `sqrt_fixed` | 45,701 |

### 4.2 What we learn from the best one

All of these are [E], except where we checked them in Python.

1. **Store `u = (y−x)/L`, not the reserves.** Quote buys as "shares out, max cost". Then buy and sell are both closed form, and the 96K to 183K solver is gone [M, numerically].
2. **Accrual is only a scale factor.** At a fixed u the reserves scale with L [M]. One integer `isqrt` replaces the 274K CU round trip. It also stops u from drifting.
3. **Use an integer Hermite table, not f64.** SBF does floats in software. We estimate about 1K CU per lookup.
4. **Size L₀ from `max(x, y)`,** so the vault covers the winning side. Check `vault ≥ supply` after every swap. GV1F does both.
5. **Avoid their weak points:** Metaplex metadata on every market, no close instruction (rent is lost), admin-only resolution, Σp not enforced across legs, and fees that do not go to LPs.

## 5. Comparison

Options:
- **Today:** 64-band LMSR, constant b.
- **A:** 63 binary "close > K_i" pools on GV1F.
- **B:** one Gaussian-score maker over all bands, with state μ.
- **C:** today's LMSR with `b_eff = b·f(t)`, house rounds only.
- **D1:** C plus one "Up or Down vs open" market per round on GV1F.
- **D2:** C plus our own Up/Down pm-AMM inside sooth-core.

| Row | Today | A | B | C | D1 (adds to C) | D2 (adds to C) |
|---|---|---|---|---|---|---|
| Price consistency | Automatic, Σp = 1 | Not enforced. Band prices can go negative until arbitrage | Perfect, but one degree of freedom | Automatic | Ladder automatic; Up/Down kept in line only by arbitrage | Same as D1 |
| LP risk / LVR near the bell | ≈ b/(2τ), uniform in price, rises in time. 16.6% of D per round [M] | Uniform per pool, 50% expected LP loss (dynamic) [M, model] | No proven bound. Model and fat-tail risk | Uniform in price and lower in time: 8.2% (√) or 5.0% (linear) with no fee [M, sim]. Gain on top of the fee ramp not measured | Ladder as C. Up/Down LP expects W₀/2 [M, model] | Same as D1 |
| Max loss | D (tail band) | Seed of each pool | Unbounded by design [E] | Same as today: ≤ b₀·ln(1/p_k(open)) [M, proof checked] | Plus the Up/Down seed | Plus the Up/Down seed |
| Depth | b ≈ 0.107·D, constant | 1/63 of capital per pool | Unclear | Same at open. 5× (√) to 24× (linear) thinner at the lock, unless floored | Ladder as C | Ladder as C |
| UX | 1 tap per shape | Band = 2 legs, tent not possible | Same clicks, but a tail bet moves the whole bell | Same clicks. Late bets slip more | Plus an Up/Down card, USDC or classic-SPL coin, extra ATAs | Plus an Up/Down card in "your coin" |
| CU per buy | 44.5K / 58.8K / 85.6K [M] | 462K to 775K per leg [M] | 64 Φ calls: 64K to 300K [E] | +1K to 3K [E] | Up/Down swap 462K to 775K [M] | 60K to 90K [E] |
| Txs per action | 1 | 2 per band | 1 | 1 | 1 | 1 |
| Rent per round | ≈ 0.017 SOL, refunded | 2.2 to 3.2 SOL per coin per day, not refunded [M per market, E total] | ≈ today | Same as today | +0.035 to 0.05 SOL per coin per day, not refunded (reported at the old rent rate) | Small, refunded [E] |
| Rent per position | 0.00121 SOL, refunded | 2 ATAs per pool | ≈ today | Same | +2 ATAs (YES, NO), refunded | ≈ today |
| Program size / deploy SOL | 678 KB, ≈ 3.45 SOL [M size] | 0 extra (GV1F exists) | +40 to 80 KB, 0.2 to 0.4 SOL [E] | +2 to 8 KB, ≤ 0.04 SOL [E] | 0 extra | +60 to 120 KB, 0.3 to 0.6 SOL [E] |
| Keeper work | Open, observe, settle | Create and resolve 63 markets per coin per day | Same as today | None extra | +2 txs per coin per day and a hot resolve key (a new trust point) | None extra; resolves from Pyth |
| Build days | 0 | 15 to 20 | 15 to 25 | 4 to 6 (with a sim that includes fees) | +4 to 6 | +8 to 12 |
| Risk | Audited in 4 rounds | Unaudited program, inconsistent prices | New, unpublished mechanism | Low. Touches audited trade and collect code | GV1F unaudited, one upgrade key, admin resolve | New math to audit |
| Bounty fit | No | Yes | No | No | Yes, if organizers accept a side market as "core" [E] | Probably no [E] |
| Main-track fit | Base | Worse | Worse | Better: lower house loss and a strong technical story | Neutral to slight plus | Slight plus, high cost |

### Where the design and critic notes disagree, and what I decided

1. **"√ schedule gives 2× depth for the same loss."** The critic is right. The deposit is sized by the worst case, and b(t) does not lower the worst case. Same morning depth, thinner at the lock. We must not claim "2× depth".
2. **"No program change needed."** The critic is right. b is read at `instructions/ladder.rs:707` (trade), `:745` (fee split) and `:1392` (`tranche_pnl` at collect). This needs a program upgrade.
3. **The 64-bin accumulator per tranche.** The critic is right. House rounds have one tranche (`:917`). Book their P&L as `cash − payout[k]` and limit b(t) to `shared_vault()` rounds. The accumulator is not needed.
4. **Clock time vs variance time.** The critic is right. `ROUND_SECS` is 24 h for every asset. For SPY about 70% of that time is closed-market time. We have no session calendar on chain. Decision: crypto coins first, clock time. For stocks, use a simple step-down in the last session hours later.
5. **Bounty (design: do D1; critic: skip).** I partly agree with each. D1 costs little, but it scores only on real traction, and the rule says pm-AMM must be "core, not a side feature". An Up/Down card next to the ladder may read as a side feature. Decision: ask the organizers first. Build D1 only if they say yes and we have real users by about 11-25. Never use self-volume.
6. **Stook's trade CU.** The live `ladder_trade` is 58.8K median, not 87-97K (that figure is the old binary design). So pm-AMM swaps are about 8× to 20× more costly than our trades.

## 6. Advantages and disadvantages of switching to pm-AMM

### Advantages

- A known, published theory, with uniform LVR and a dynamic schedule with a loss bound.
- Brand value for the PREDICTSpark bounty, but only on GV1F.
- The dynamic schedule targets our main loss: informed flow late in the round.
- A closed-form sell, and a closed-form fixed-share buy if we store u.

### Disadvantages

- **No multi-outcome form.** 63 pools lose Σp = 1 and monotonicity. A tent touches up to 16 pools.
- **About 63× the capital** for the same depth. 126 mints per coin per day. 2.2 to 3.2 SOL per coin per day of rent that we cannot get back on GV1F.
- **About 1% better execution than LMSR.** The ladder already has uniform LVR in price.
- **8× to 20× more CU per buy** on GV1F [M]. A band bet needs 2 txs.
- **The dynamic LP expects to lose half its wealth** at zero fee. On GV1F the fee goes to the DAO and the creator, not to LPs.
- **The model breaks where we lose money:** overnight and weekend gaps, earnings and CPI jumps, fat tails (kurtosis 10.6), a single Pyth print at settle, fees, and arbitrage costs.
- **GV1F conflicts with the product:**
  - Classic SPL only, but Stook's coins can be Token-2022.
  - Resolution is admin-only, but Stook settles from Pyth with no permission.
  - Unaudited, with one upgrade key.
- **Time:** 15 to 20 days for a full switch. That is all the time left, and it reopens four rounds of audited math.

## 7. Recommendation and plan

**Do not switch. Build C for house rounds. Treat D1 as optional and conditional. Spend most time on mainnet traction.**

C details:
- `b_eff = b·f(t)`, with `f = max(f_min, √(τ/T))`, `f_min` ≈ 0.25, and τ measured to the lock.
- Pass `b_eff` at `:707` and `:745`.
- At collect, book house-round P&L as `cash − payout[k]`. Do not use `tranche_pnl` for these rounds.
- Use the existing `isqrt` (`math/ladder.rs:155`).
- Lower the peak of the fee ramp only after the fee sim shows it is safe.

| Date | Step |
|---|---|
| 11-16 | Send the questions in §8 to the Spark / $PREDICT organizers. Check whether each target coin is classic SPL or Token-2022. Confirm that the closed mainnet program id cannot be reused. |
| 11-16 to 11-18 | Add the fee ramp to `sim/sim.py`. Run constant, √ with a 0.25 floor, and linear with a floor, with fees on. Also measure late retail volume and fee income. **Go/no-go for C.** |
| 11-18 to 11-21 | If go: implement C in sooth-core for house rounds only. Add a property test that loss ≤ b₀·ln(1/p_k(open)). Measure CU in `tools/cu-probe`. Rerun `scripts/backtest`. Deploy to devnet. |
| 11-21 to 11-23 | Mainnet relaunch with a new program id: about 3.45 SOL plus a refunded buffer [E]. Crypto coins first. |
| 11-22 to 11-25 | **Only if the organizers say yes:** build D1. Keeper jobs `pmamm_open` (strike p0, expiry at the lock, L₀ from `suggest_l_zero_for_max_reserve`) and `pmamm_resolve` (log the Pyth price reference). Add an Up/Down card with `@pm-amm/sdk` 0.2.0. Test end to end on devnet with the faucet. Seed small, about 50 to 100 USDC per market [E]. |
| 11-25 to 12-03 | Traction: daily rounds, outside users, the existing ad, and a public stats page (volume, users, fees). If D1 is live, show GV1F volume by market. No self-volume. |
| 11-28 | If C is not stable on devnet, stop. Keep constant b on mainnet. Pitch C as a design result. |
| 12-03 to 12-05 | Submit. The pitch: our 64-band LMSR has uniform LVR across price (Fisher-information argument). We added a pm-AMM time schedule (AFT Theorem 14). We include the CU and cost table. If D1 is live, Up/Down runs on the $PREDICT pm-AMM. |

## 8. Questions for the organizers

1. Does a native pm-AMM built inside our own program count, or only volume on GV1F?
2. Does an "Up or Down" market on GV1F next to our ladder count as "core", or as a side feature?
3. Is a GV1F market that our keeper resolves, with published Pyth evidence, acceptable? Is oracle resolution planned?
4. Will GV1F accept Token-2022 mints as collateral?
5. Which traction counts: mainnet only, or devnet too? Volume, unique wallets, or fees? How do you treat the team's own trades?
6. Is the deadline 2026-12-05 for the bounty too? One third-party tracker says 9 Oct.
7. What are the terms of the $1k investment and the Backable raise?
8. Is a close-market instruction planned, so that market rent can be recovered?
9. Is there a third-party audit of GV1F, or a plan for the upgrade key?

## 9. Sources

### External

- Paradigm, pm-AMM: https://www.paradigm.xyz/2024/11/pm-amm
- Moallemi, Robinson, Zhu, "Uniform-Loss AMM for Prediction Markets", AFT 2026: https://drops.dagstuhl.de/storage/00lipics/lipics-vol395-aft2026/LIPIcs.AFT.2026.14/LIPIcs.AFT.2026.14.pdf and https://arxiv.org/abs/2607.17428
- Critique of static vs dynamic claims: https://github.com/microprediction/mechanisms/issues/15
- Hackathon and bounty page: https://hackathons.solana.com/hackathons/perps-and-prediction-markets
- Out-of-date deadline tracker: https://github.com/Blockchains/hackathons/issues/1
- GV1F site: https://predict-pm-amm.dev
- Spark proposal: https://justspark.notion.site/Decentralizing-Decision-Markets-on-Idea-Coins-v1-Proposal-35741bf35b7780c98954ca7dd8d3e832
- Implementations: https://github.com/sparkfun-labs/pm-amm, https://github.com/Mattdgn/pm-amm, https://github.com/EwanSpark/pm-amm, https://github.com/Apostlex0/PredictionMarket_AMM, https://github.com/0xfps/pmamm-js, https://mechanisms.microprediction.org/implementations.html
- GV1F apps: https://github.com/LMH-Solutions/strikebook, https://github.com/LMH-Solutions/strikeblink, https://github.com/akhilexx/helm, https://github.com/azovskaya/viber
- Not pm-AMM: https://github.com/Sortis-AI/sol-pm, https://github.com/z-fi/pm, https://paradigm.xyz/2024/12/distribution-markets
- Other designs: https://arxiv.org/abs/2102.07308, https://arxiv.org/abs/2510.12952, https://docs.polymarket.com/concepts/negative-risk

### Repo refs

Paths are under `/Users/mohammadzakerirad/Sooth/stook/packages/programs-core/programs/sooth-core/src`. All line numbers checked today.
- `instructions/ladder.rs:24` fee 2%. `:33-47` fee ramp. `:59` minimum lock gap. `:707` b on the trade path. `:745` b in the fee split. `:917` house rounds refuse LP joins. `:1392` `tranche_pnl` at collect.
- `math/ladder.rs:36` BINS. `:61` MAX_TRADE_EXPONENT. `:133` SIGMA_BANDS. `:140` PRIOR_PEAK_LN. `:155` isqrt. `:433-434` stale "ln 64" comment. `:436` liquidity_for_deposit. `:459` tranche_pnl.
- `/Users/mohammadzakerirad/Sooth/stook/docs/feasibility.md`
- `/Users/mohammadzakerirad/Sooth/stook/docs/architecture.md`
- `/Users/mohammadzakerirad/Sooth/stook/docs/design-review/audit-round-2-2026-09-23.md`
- `/Users/mohammadzakerirad/Sooth/stook/scripts/backtest/README.md`

### Scripts and clones

- `/private/tmp/claude-501/-Users-mohammadzakerirad-Sooth-stook--agents-stook-main/4330767b-f5f3-4eec-b9a5-7e45c2bd8826/scratchpad/scripts/pm.py`
- `/private/tmp/claude-501/-Users-mohammadzakerirad-Sooth-stook--agents-stook-main/4330767b-f5f3-4eec-b9a5-7e45c2bd8826/scratchpad/scripts/ladder_lvr.py`
- `/private/tmp/claude-501/-Users-mohammadzakerirad-Sooth-stook--agents-stook-main/4330767b-f5f3-4eec-b9a5-7e45c2bd8826/scratchpad/sim/sim.py`
- `/private/tmp/claude-501/-Users-mohammadzakerirad-Sooth-stook--agents-stook-main/4330767b-f5f3-4eec-b9a5-7e45c2bd8826/scratchpad/bench/src/lib.rs`
- `/private/tmp/claude-501/-Users-mohammadzakerirad-Sooth-stook--agents-stook-main/4330767b-f5f3-4eec-b9a5-7e45c2bd8826/scratchpad/clones/`