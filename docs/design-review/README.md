# Blind design review — 2026-09-21

Four designers, each given only the product brief and the measured Solana constraints — none of the
earlier design history — proposed a mechanism independently. Each proposal was then attacked by an
auditor who wrote and ran a simulation of it against one fixed battery. A judge, also blind, ranked
them on the auditors' measurements. Raw output: `blind-run-2026-09-21.json`.

## What four independent designs agreed on

- **All four chose one LMSR-family cost function over a fixed log-price grid.** None chose isolated
  per-line markets. Four blind arrivals at the same place is the strongest evidence in this document.
- **All four gave up arbitrary strikes** — a line snaps to the grid.
- **Three tried to let LPs choose where on the axis; all three measured as not working.** Range LPs added
  0.0% depth to a trade (Range-Tree), tail zones strictly dominated near-the-money zones (Rings), zone LPs
  earned 0–5 fee units on 416–832 deposits (NLS).
- **In all four, the LP pool is a subsidy, not a yield.** Under informed flow LPs lost 13–47% net of fees;
  fees covered 3–40% of inventory loss. The loss is bounded and the bound held in every run.
- **All four had an exploitable void path and an add-liquidity sandwich** as first specified.

## Ranking

**1. Stook Ladder: one 64-bin LMSR per (feed, T) with single-exp shaped trades**

Cheapest to ship and the only design with a native tent payoff under the 200K CU target.

- Build: the auditor's estimate is 15 days against the designer's 14. The other three were re-estimated at 22, 27 and 45 days.
- Compute: 71-146K CU per trade from operation counts. Every other design exceeds 200K on common trades.
- UX: the tent (up to 8 levels, 1 exp + 1 ln) is what the draw-a-line UI needs. It reuses exp_wad/ln_wad/wad_mul and the oracle-anchored P0.
- Measured correctness: 3 orderings cost the same to the base unit. None of 11,269 round trips was positive. Best static-arbitrage edge was 0 over 4,000 portfolios. Shortfall was 0 over 36,000 fuzzed ops, across all 64 bins and Void.
- Three holes, all in side paths with known small fixes:
  - The add_liquidity sandwich nets +2,802 risk-free on a 5,000 add.
  - Void at marginal prices drains 77-98% of LP capital.
  - The repo's wad_div truncates once the divisor exceeds 2^96.
- LP economics fail: the early LP lost 13-29%, and 92% once late sharp flow arrived. All four designs fail the same way, so this does not separate them.

**2. Stook Rings — bullseye market on a 64-bucket price axis, one prior-weighted LMSR, zone-tranched LPs**

Same pricing core as the Ladder, and the best-audited one.

- Measured correctness: it was the only design tested end to end with an integer engine under the spec's rounding rules. Shortfall was 0 even at b=8 and through forced 2^120 rescales. Round trips cost the trader 2-3 base units and never paid.
- No sandwich surface: constant b plus a pre-open Seeding window removes the LP-add attack that was measured in the other three designs.
- Consumer framing: the dartboard is the strongest pitch of the four.
- Why second:
  - The auditor estimates 22 days.
  - It needs U256 arithmetic, not the claimed u128. A wide trade costs 227-244K CU as specified.
  - The zone tranche is strictly dominated. The near LP netted -41% to -47% while the tail LP netted 0.00 with the same profit share.
  - A dust LP earned 721%.
  - A stale prior gifts 7.5% of F per round at 1-sigma drift.
  - The Void rule is exploitable for 15-51% of F.
- Its good parts transplant onto the Ladder.

**3. Stook Range-Tree: nested-LMSR over a dyadic price grid with range-concentrated LP positions**

The maths is clean, but the headline feature does not work.

- Measured correctness: solvency held at 4.5e-13 relative over 23,697 steps, including LP removal. A linear program over all 2,079 bands found no arbitrage.
- Concentrated liquidity does not concentrate:
  - A 50-unit 2-bin LP changed a 20-unit trade by 0.0%.
  - Moving a 4,000-unit LP's own range by 10pp cost 29 units.
  - Fees per unit of collateral fall with concentration: 3.8% for full range, 0.16% for 2 bins.
- Other failures:
  - 91% of bands exceed 200K CU (mean 297K). A 3-tier line costs 0.66-0.85M.
  - lp_floor_value can be cut 83% atomically for 2.93 in fees.
  - Spot sits on the root split by default.
- Build: the auditor estimates 27 working days each for two developers. That is over budget for no UX gain.

**4. Stook NLS - Nested Log-Scoring Range Market (two-level LMSR over a 16x16 log-price grid, zone-local LP tranches, time-decaying liquidity)**

The most novel design and the least shippable. The auditor re-estimated the build at 45 working days, three times the budget.

- The real-number theory held: static arbitrage was +5.7e-13 (float noise), trader shortfall was 0, and max LP loss was 0.97 of deposit.
- The fixed-point update as specified is wrong. Conditional prices summed to 0.37, and a harvester locked in about +144.
- Void is insolvent. Two colluding wallets took +2,724 and the LP received 0.
- The LP-entry sandwich nets +83 to +1,075.
- Decaying liquidity breaks "exit before T":
  - A position marked at 383 recovers 2.62 at close.
  - 1,740 of 2,000 shares were stuck behind the guards.
  - The closing price can be moved 10pp for 1.6 units.
- Zone LPs earned 0-5 fee units on deposits of 416-832.
- The hackathon evidence says novelty does not win, so the extra mechanism buys nothing.

## Recommendation

Build the Ladder core with Rings' liquidity lifecycle. There is one 64-bin log-price LMSR per (Pyth feed, T, quote mint, step tier), priced by one exp and one ln per trade. Settlement is by oracle only.

**Grid**
- N = 64 bins, step s from the preset table {0.25%, 0.5%, 1%, 2%, 4%, 8%}.
- bin(P) = clamp(32 + floor(ln(P/P0)/s), 0, 63). Bins 0 and 63 are open tails.
- P0 is read from Pyth inside open_trading, not at create. A rolling Seeding window then cannot go stale (Rings measured a 7.5% of F gift per 1-sigma drift).
- The tier goes in the PDA seeds, and the UI shows one whitelisted tier per asset class. Default to at least 2% for memecoins: at tiers up to 1%, a +60% move collapses into bin 63 and the LP loses 98%.

**State**
- w_i = exp(q_i/b) in WAD, starting at 1. Cap w_i at about 1e10 (q/b <= 23) so that S stays below 2^96 and the repo's wad_div stays exact. Add a property test against a big-integer reference.
- S is the exact integer sum of the w_i.
- b = floor(0.9999*F/ln 64), fixed at open. Require b >= b_min.
- V is pool cash excluding fees. Q_i is the payout owed if bin i wins.

**Position shape (lo, hi, h)**
- 1 <= h <= 8, and level m_i = min(h, i-lo+1, hi-i+1).
- A band is h = 1. A drawn line at bin c is a tent with lo = c-h+1, hi = c+h-1 and default h = 4.
- Payout is delta * m_s at settled bin s.

**Trade**
- x = delta*WAD/b, with |x|*h <= 23 WAD.
- g = exp_wad(x), and the powers g^2..g^h come from wad_mul.
- w_i' = w_i * g^{m_i}, floored at WAD. S' = S + sum of (w_i' - w_i). c = b*ln_wad(S'/S).
- A buy pays ceil(c) + fee. A sell receives floor(-c) - fee.
- fee = min(amount, max(1, ceil(phi(t)*amount))), so dust positions can still be sold.
- Q_i += delta*m_i, and require V >= max Q_i.
- Every trade takes a slippage limit. Every transaction prepends the 256 KB heap-frame request and an explicit CU limit.

**Fees**
- phi(t) ramps from 1% to 3% between T_open and T_lock.
- Split: 80% to LPs through acc_fee_per_share, 10% to the creator, 10% to the protocol.

**Liquidity**
- add_liquidity and withdrawal are allowed only during Seeding, gated on t < T_open. They are not gated on the open_trading crank.
- After open, b is constant and LP shares are locked until settlement.
- This removes the add-liquidity sandwich, the per-LP inventory vector and the late-LP free-rider.
- Recurring markets seed round N+1 while round N trades. That is the TVL story.
- A non-uniform prior is not program code. The seeder shapes prices with their own trades in the same transaction as the open.

**Lock**
- T_lock = T - max(5 min, 10% of duration).
- The reason is measured: 60 late sharp traders took the early LP from -26% to -92%.

**Settlement**
- Accept a Pyth update with prev_publish_time < T <= publish_time and full verification level.
- Reject the update if conf/price exceeds half a step.
- Apply a deterministic tie-break for updates sharing a publish_time.

**Void**
- Refund each position its cost basis from a net_paid field on the Position account. LPs receive the residual, which equals F plus fees exactly.
- Allow only 24/7 feeds, or reject any T that falls outside a feed's publishing hours.

**Settlement payouts**
- Traders redeem delta*m_s. LPs split V - Q_s pro rata, plus fees.
- Positions and LP stakes are PDAs seeded by (market, nonce), not by owner, so they stay transferable.

**Optional, week 3 only: \"choose where\" as fee-only zones**
- Each LP tags a contiguous zone.
- Fees are attributed per bin by m_k and paid as feeB[k]/Cov[k], with a minimum Cov[k] per bin.
- Losses stay strictly pro rata. There is no first-loss waterfall, so no zone is dominated and fee yield per unit of capital equalises across zones.
- It does not concentrate depth, and the UI should say so.

**LP framing**
- Present LP capital as a bounded-loss sponsor pool, not as yield. Protocol-seed the featured markets.

## Grafts from the non-winners

- From Rings: constant b with a pre-open Seeding window and rolling rounds. It removes the add-liquidity sandwich, which was measured at +2,802 on the Ladder, +83 to +1,075 on NLS and +39 on Range-Tree.
- From Rings: a fee ramp from 1% to 3% toward lock.
- From Rings: the ring and dartboard visual language for the tent shape. A tent of height h is exactly h nested rings.
- From Rings: re-centre the grid on the Pyth price at open_trading, so a drift during Seeding cannot be harvested at open.
- From the Rings and Ladder auditors: refund cost basis on Void through a net_paid field on the Position account. All four designs had an exploitable Void path.
- From Rings: per-bucket fee attribution for fee-only zones (attributed by m_k, about 136K CU). Drop the first-loss waterfall, and add a minimum Cov per bucket to stop the 721% dust-LP snipe.
- From Rings: the rounding discipline. Round exp and the weights up, add or subtract 1 unit on cost, and keep S as the exact integer sum. Round trips measured -2 to -3 base units and were never positive.
- From the Rings auditor: exempt sells from any price-floor assert, so holders can always exit.
- From the Rings auditor: seed Position PDAs by a nonce, not the owner, so transfers do not break Anchor seeds constraints.
- From the Range-Tree auditor: show realised multiples in the UI, not nominal ones. On thin markets a 20-unit ticket pays 3.4x against a 64x nominal.
- From the Range-Tree auditor: enforce a minimum seed of about 25-100x the typical stake in the front end.
- From the Range-Tree and NLS auditors: a deterministic Pyth tie-break (prev_publish_time < T <= publish_time) and a confidence check against the bin width.
- From NLS: a whitelisted step preset per feed volatility class, with the tier, fee and gamma-like parameters in the PDA seeds or presets so the first creator cannot squat them.
- From NLS: the framing that a trader's profit equals their log-score improvement. It is true of any LMSR and makes a good line for the pitch.
- From Range-Tree: never expose on-chain marks (lp_floor_value or band quotes) as collateral prices without a TWAP. The auditor cut a mark 83% for 2.93 in fees.

## Founder goals that cannot all hold

Eight of the founder's goals conflict, and the auditors measured each conflict.

1. **LPs choose where on the axis, against coherent no-arbitrage pricing under 200K CU.**
   - A per-location b breaks the single-exp closed form. Independent pools reintroduce static arbitrage.
   - All three attempts failed when measured:
     - Range-Tree range LPs added 0.0% depth, and their fees per unit of collateral fell as they concentrated.
     - Rings tail zones strictly dominated near-the-money zones (0.00 against -41% to -47%).
     - NLS zone LPs earned 0-5 fee units on deposits of 416-832.
   - Only a cosmetic version survives: fee-only zones, or an LP pairing a deposit with its own band trade.

2. **LPs earn yield, against a bounded-loss AMM on a publicly observable oracle price.**
   - LP loss is b*ln(p_final/p_join), and the outcome is revealed continuously.
   - Full-range or pooled LPs lost 13-47% net of fees under moderately informed flow in all four designs. Fees covered 3-40% of inventory loss. With sharp late flow or a tail settle the loss was 60-99%.
   - Informed volume self-limits near 2x TVL. Break-even needs 8-108x TVL in uninformed volume.
   - Yield is positive only when noise flow dominates: Rings LPs made +17.8% when traders were noise. Otherwise the pool needs a subsidy.
   - This conflicts directly with the TVL and yield pitch for the hackathon category.

3. **Permissionless small-capital creation, against a usable market.**
   - Depth is 0.18-0.24 of the seed across 64 bins.
   - In all four designs a 50-unit seed let one 20-unit ticket move a bin from about 1.6% to about 81%. The payout was about 3x against a nominal 64x.

4. **Exit before T, against LP protection.**
   - Every design needs a lockout before T. NLS's decaying liquidity makes late exits effectively impossible (383 marked, 2.62 recovered).
   - A longer lock cuts LP sniping losses but shortens the exit window.

5. **TVL growth mid-market, against path independence.**
   - Any change to b while inventory is outstanding was sandwichable. It was measured in three of the four designs. Guards shrink it but do not remove it.
   - Only liquidity that is constant from open onward is clean.

6. **Anyone can open any line or strike, against no static arbitrage.**
   - Arbitrary strikes need independent pools. Every sound design snaps to a grid fixed at creation.
   - A mis-set grid collapses a +60% move into the edge bin.

7. **Closer pays more, continuously.**
   - This needs N exps per trade, or a parimutuel pool with no exit. The achievable version is a staircase at bin width.

8. **Composable SPL positions, against low-KB state.**
   - There are thousands of payoff shapes per market, so positions are transferable PDAs, not tokens.

## Three-week plan

- Week 1, days 1-2 (Dev A, program): add a stook module to sooth_core. Add the Market account (w[64], S, b, V, Q[64], fee accumulators, about 2 KB, zero-copy), the Position and LpPosition PDAs seeded by nonce, and create_market with presets in the seeds (feed, T on the hour, tier, mint). Add the Seeding-phase add_liquidity and remove_liquidity, gated on t < T_open.
- Week 1, days 1-2 (Dev B, SDK): write a big-integer reference model in TypeScript, mirroring the auditor's integer Python model in the session scratchpad under stook-attack-3/core.py. It is the bit-exact quote oracle for both the SDK and the property tests.
- Week 1, days 3-5 (Dev A): write the trade instruction, with the shape (lo, hi, h), one exp_wad and one ln_wad. Reuse exp_wad and ln_wad from packages/programs-core/programs/sooth-core/src/math/lmsr.rs and wad_mul from packages/programs-core/programs/sooth-core/src/math/wad.rs.
- Week 1, days 3-5 (Dev A), trade safeguards: cap w at 1e10 so that S stays below 2^96 and wad_div stays exact, since the auditor found it truncating by S of about 2^99. Add the require(V >= max Q) check, slippage limits, and fee = min(fee, refund). Keep large arrays off the 4 KB SBF stack.
- Week 1, days 3-5 (Dev B): write the litesvm property tests. They check that reordering a trade sequence costs the same, that a round trip never returns more than was paid, that shortfall is 0 across all 64 bins, and that wad_div matches the big-integer reference over the whole reachable S range.
- End of week 1, gate: measure real CU for a single bin, a tent with h=8 and a full-width band. If the tent is over 200K, cut h to 4 or cap the band width.
- Week 2, days 6-7 (Dev A): write open_trading. It reads the Pyth pull feed, sets P0 and fixes b. Write settle, which requires prev_publish_time < T <= publish_time and full verification, rejects an update if conf exceeds half a step, and applies a deterministic tie-break.
- Week 2, days 6-7 (Dev A, oracle path): the Pyth pull-oracle path is new work, because the existing scaffolding settles through an adjudicator. Allow only 24/7 feeds.
- Week 2, days 8-9 (Dev A): write redeem, claim_lp and claim_fees. Write the Void path with cost-basis refunds from net_paid. Add a permissionless close for worthless positions after settlement, and the 1% to 3% fee ramp.
- Week 2 (Dev B): add SDK instruction builders and readers, and a quote function matched bit-exactly against the reference. Add the heap-frame and CU-limit prepends on every path.
- Week 2 (Dev B, continued): start the /stook surface inside apps/demo, not a new frontend. It is a price chart on which the user draws a line (tent) or drags a band, and it shows a live quote of the realised multiple, not the nominal one.
- Week 2, day 10: port the auditors' attack scripts as regression tests. They are the add-around-open sandwich (it must be impossible, because adds are closed), the Void pump (it must net no more than minus the fees), the dust sell, the 0-decimal mint with b=0, and the +60% path at each tier.
- Week 3, days 11-13 (Dev B): finish the consumer loop, which is what wins. One-tap markets for SOL 24h and one memecoin, draw, stake, watch the position mark, exit before the lock, and a settle-and-claim animation. Add a rolling-rounds view in which the next round seeds while the current one trades, and a position share card.
- Week 3, days 11-13 (Dev A): deploy to devnet, write a crank script for open_trading and settle, and protocol-seed the featured markets at no less than 100x the typical stake.
- Week 3, days 11-13 (Dev A, stretch): fee-only LP zones, attributed by m_k, with a minimum Cov per bin and pro-rata loss. Build them only if the CU gate passed with headroom.
- Week 3, days 14-15: run Playwright e2e on devnet, run the solana-vulnerability-scanner over the new instructions, and record the demo video. Freeze.
- Cut order if the schedule slips: LP zones first, then tents above h=4, then the creator fee share, then the multi-tier presets (ship two tiers). Never cut the cost-basis Void refund, the w cap and division test, or the Seeding-only liquidity gate.

## Biggest risk

**Economic risk, not mechanical.**
- In every audited design the LP pool was a pure subsidy on a publicly observable price.
  - Fees covered 3-40% of inventory loss.
  - Seed LPs lost 13-47% per market under ordinary informed flow.
  - They lost 60-99% when sharp late flow arrived or the price settled in a tail bin.
- The recommended build does not change this. It only bounds the loss and keeps it honest.
- Without a protocol subsidy or sponsor budget for b, or without strongly noise-dominated retail flow, nobody rational seeds a market. "Permissionless lines with LP yield" then becomes empty markets, in which a 20-unit bet moves a bin from 1.6% to 81%.
- The hackathon pitch should lead with the draw-a-line consumer experience and protocol-seeded featured markets. It should present LPing as a bounded-loss sponsor pool, not as yield.

**Technical risk.**
- The fixed-point path is the second risk. The repo's wad_div silently truncates once the divisor exceeds 2^96.
- All CU figures come from operation counts; nothing was measured on-chain.
- Pyth pull settlement is new code. The existing program settles through an adjudicator.
- The week-1 CU and division gate exists to surface these before the UI work depends on them.
