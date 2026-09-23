# Audit round 3: series, volatility bands, sweep and close (2026-09-23)

Six blind lenses over commit 710128a, every finding attacked by two skeptics. 45 agents, none failed, none of the verified findings refuted.

## Closing memo

**Bottom line.** Most of the new code works and pays out correctly. One bug breaks settlement on the BTC and ETH series, and it must be fixed first. No path lets a stranger move funds or brick a series.

**Does it work and pay correctly.** Yes, with one exception.
- **Calendar and timing are right.** This covers close times, New York DST, the 15 min to 48 h funding window and round timing.
- **The SDK matches the program bit for bit.** Evidence: 60 LiteSVM rounds, 60,000 close times and 3,000 band vectors.
- **The open counters are exact.** Sweep only closes positions that are owed nothing. Close waits until every winner, tranche and fee share has been collected.
- **Accounts and authority hold up.** The Token-2022 harvest is correct, and the checks on all six new or changed instructions hold.

**The exception.** Series::observe (packages/programs-core/programs/sooth-core/src/state/series.rs) divides by last_price times 1e18. That overflows for any raw price above about 7.9e10. On BTC and ETH (devnet STOOK and ZCAT), every settle after the first reverts. Those rounds void after 24 h, and the keeper keeps paying fees to retry. Refunds still work, so no principal is lost, but the core product is broken on those coins. Tests missed it because the e2e settles only once per series at a small price, and the SDK's wadDiv lacks the program's 2^96 guard.

**Is the band rule sound.** Yes, for crypto. An independent replay reproduces results.txt exactly and uses no future data. The rule's real value is robustness, not a better average. The 0.76 pp average gain comes only from ZEC and GLD. The worst-5% gain (+5.9 pp) and the gain after volatility spikes are the significant results. The validation overstates in three places:
- Weekends and Mondays are never tested, even though the stock anchors settle every day.
- "No flow is worse" is false: a fat-tailed trader takes about 1.1 pp more.
- The stock lock price is really 30 minutes early.

None of these changes the rule ranking.

**Must fix, in order.**
1. In observe, use wad_div(price, last_price), and make a failed observation skip instead of reverting ladder_settle. Add a BTC-scale test with two settles in a row. Add the 2^96 guard to the SDK's wadDiv. Redeploy devnet and reset STOOK and ZCAT.
2. The settlement conf ceiling (step/2, 5 bps minimum) will likely void many SPYx/GLDx rounds. Raise the minimum to 15 to 25 bps, and measure those feeds' conf at 16:00 New York before listing them.
3. Stock series need a weekdays-only flag, or the backtest must be rerun on a 7-day calendar.
4. Update the stale ladderFilters test (packages/sdk-solana/tests/ladder-math.test.ts:146) so the SDK suite passes.

**Nice to have.**
- In void_pots, give the pot to LPs when no trader still holds basis. Today close sends it to the treasury as "dust".
- Allow payout by anyone after a grace period, so one unclaimed winner or tranche cannot block ladder_close forever.
- Refuse ladder_close before settles_at, so a voided day cannot be created again with different terms.
- Add an expected step_bps bound to ladder_create. This also fixes StartRound's band width going stale before signing.
- Tie the creator's 10% fee share to the seed size, so a 1-token funder cannot snipe it.
- Set a minimum on var_bands so the opening odds stay peaked at very low volatility.
- Fix the reach label in apps/stook/src/components/StartRound.tsx and scripts/devnet/series.mjs. It should show separate up and down figures, +(e^(31s)-1) and -(1-e^(-31s)), not one symmetric number.
- Correct the claims in scripts/backtest/README.md, and stop the keeper re-scanning stuck rounds.

**Not checked.** Devnet state and your running shell were out of scope for this audit, so I can't say whether the shell is still working. The untracked zz_scratch files and the `#[cfg(test)] mod zz_scratch_vol;` line in lib.rs were left by audit agents. Remove them before committing.

## What was done about it (next commit)

- **Critical, fixed and redeployed before the next devnet settle:** `Series::observe` divided `price·10¹⁸` by `last_price·10¹⁸`, overflowing the 2^96 divisor limit for raw prices above ~7.9e10 (BTC, ETH), so every settle after a series' first reverted. It now divides the raw prices, and a failed observation is skipped instead of reverting the settle. Regression test at BTC scale; the SDK's `wadDiv` now refuses the same divisors the program does.
- **Confidence ceiling:** `MIN_STEP_BPS` 10 → 20, so the settlement rule (conf ≤ half a band) is not tighter than equity-token feeds' quiet confidence.
- **Stock anchors:** `CLOCK_NEW_YORK_WEEKDAYS`, a New York series with no rounds on Saturday or Sunday (`Series::has_round`), matching the backtest's weekday calendar.
- **First-funder fee:** the 10% creator share is gone (depositors 90%, protocol 10% of which half pays the settler). It could be taken with a one-token seed on every round.
- **Void with no open positions:** everything goes to depositors, not to the treasury as dust.
- **Re-creating a day:** `ladder_close` refuses before the round's close time, so a voided day keeps its address and cannot be started again on different terms.
- **Bell at tiny variance:** held at a minimum of half a band (σ), so it stays peaked instead of flooring to flat.
- **App:** the grid's reach shown as its real, asymmetric range; the stale filter test updated.
- **Backtest README:** claims corrected (not the literal worst counterparty; significance of the average vs the tail; stock lock alignment).
- **Not done, recorded in docs/architecture.md:** payout by anyone after a grace period (so an unclaimed winner or tranche cannot block `ladder_close`; only rent and dust are held), an expected-terms bound on `ladder_create`, the keeper's re-scan of stuck rounds.

## Verified findings

### A round that never opened can be voided, closed and created again for the same (series, index)

*series-calendar · methodology · reviewer low, verifiers low, info · hour*

The design says 'one round per day', but that only holds while the ladder account exists. A round that is still SEEDING can be voided once now >= locks_at, and locks_at is only 2 min to 1 h before settles_at. After ladder_close the PDA is free, and ladder_create accepts the same index while now + 15 min <= settles_at. The new round has different terms: opens_at is now + 60, and its window is about 1 h instead of 24 h, so the band width comes out different (10 bps here against 50 bps). A settled round cannot be re-created, because settles_at is already in the past.

> **Verifier.** The claim is accurate. After a SEEDING round is voided at locks_at, claim_lp and ladder_close can free the (series, index) PDA before settles_at, and ladder_create then succeeds again with a shorter window and a different step. The terms change exactly as stated: opens = now + 60, lock gap = window/24 clamped to [120, 3600], step clamped at 10 bps.

This is only reachable after a round failed to open by its lock, and only when that round's lock gap is at least 15 min, i.e. its window was at least 6 h. No funds are at risk. The impact is that the "one lifecycle per ladder address" assumption breaks for off-chain consumers. The simplest fix is to require `now >= settles_at` in ladder_close, or to document that re-creation is allowed.

> **Verifier.** A round that never opened, once voided, fully refunded and closed within the last hour before its close, frees its (series, index) PDA. The same day can then be started again as a late round, with the short window and narrow band that a first-time late start would also get. No funds are at risk and the keeper is unaffected. Only an off-chain indexer that assumes one lifecycle per ladder address could be confused. If that invariant is wanted, the clean fix is to require now >= settles_at in ladder_close. Otherwise document the retry.

**Proposed fix.** If one lifecycle per address is meant to be the invariant, have ladder_create require the day to be past-free, for example refuse when settles_at - now < LOCK_GAP_MAX_SECS + MIN_ROUND_SECS. The cleaner option is to only allow ladder_close once now >= settles_at, so a closed PDA can never be re-initialised. If re-creation is intended, record it in docs/architecture.md and make sure indexers and the keeper do not assume one lifecycle per ladder address.

### The opening prior turns flat, not peaked, when the bell is narrower than about 0.15 bands (low variance and a short window)

*series-calendar · economics · reviewer low, verifiers info, low · hour*

prior(var_bands) sets w_i = exp(7 - d^2/(8 var_bands)) with a floor of WAD, and the centre bins sit at d = ±1. When step_bps is clamped to MIN_STEP_BPS (10) and sigma_window is only a few bps, var_bands gets very small. The centre bins' exponent then drops below the floor and every bin is WAD. A round the model expects to land in the centre two bins almost surely opens at 1/64 odds per bin. That is exactly the flat-start LP loss the backtest was built to avoid. The window can be short because of the round_times/MIN_ROUND_SECS path: a first funding late in the day, or the re-creation path above.

> **Verifier.** prior() goes fully flat (1/64 per bin) whenever var_bands ≤ 1/56. With the 10 bps step clamp, that means σ_window < ~1.34 bps: σ_day < ~0.136% at the 840 s minimum window, and never at windows of 1 h or more, since the threshold falls below VAR_MIN. Between roughly 0.14% and 0.3% daily σ on short windows, the prior is under-peaked (59–89% on the centre two bins against ~100% true). This affects only a series the authority configures with a near-VAR_MIN variance (series_create/series_set), or one whose feed prints nearly flat for months. It does not affect any configured anchor (all σ_day ≥ ~0.7%). Latent economics edge case, informational.

> **Verifier.** The prior goes flat, or loses most of its peak, only when step clamps to 10 bps and sigma_window is under about 3 bps. That means a daily sigma at or below about 0.2 to 0.25%, reached only by admin seeding near VAR_MIN or by a stablecoin or dead feed. None of the configured anchors come near this, so it is a real but latent edge case. The (d^2-1) fix is correct. Raising VAR_MIN is a simpler guard.

**Proposed fix.** Normalise the bell's peak at the centre bins rather than at d = 0: use (d^2 - 1) in place of d^2 in the exponent. Alternatively, floor var_bands, for example at SIGMA_BANDS^2/64 or about 0.25 bands^2, so a narrow bell puts nearly all its weight on bins 31 and 32. Port the same change to sdk series.ts prior().

### Series::observe returns an overflow error for BTC/ETH-scale prices, so every settle after the first on those series reverts and the rounds void

*volatility · bug · reviewer critical, verifiers critical, critical · hour*

observe computes `ln_wad(wad_div(price*WAD, last_price*WAD))`. wad_div refuses any divisor above 2^96 (MAX_WAD_DIVISOR), and here the divisor is last_price*1e18, so any feed whose raw Pyth price is above 79,228,162,514 fails. At expo -8 that is anything priced above $792.28 (BTC, ETH, BNB; ZEC if it goes past ~$792). The first settle on a series only anchors and succeeds. Every settle after it fails with MathOverflow through the `math(...)?` call at settle_handler ladder.rs:859, so each later round voids once the 24 h grace runs out and the series never learns. series_set cannot clear last_price, and a daily series for the same feed and mint cannot be created again, so only a program upgrade fixes it. On devnet, scripts/devnet/series.mjs runs STOOK on the BTC feed and ZCAT on the ETH feed, so both are affected.

> **Verifier.** Accurate as stated. More precisely: the cutoff applies to the stored last_price, not to the new price. A series fails permanently once the previous close it anchored on is above 79,228,162,514 raw units. From that point every settle reverts with MathOverflow (6000), and those rounds can only be voided. The series can be used again only through a program upgrade, or if a later settle anchors on a price below the cutoff. That can't happen, because every settle reverts before it can store a new last_price.

> **Verifier.** The claim holds as stated. The only nuance is that affected rounds void (refund path) instead of losing funds. The failure is still permanent without an upgrade for any expo -8 feed whose price is above about $792.28, which on devnet means STOOK (BTC) and ZCAT (ETH).

**Proposed fix.** Take the ratio of the raw prices: `let r = ln_wad(wad_div(price as i128, self.last_price as i128)?)?;` (the divisor is at most i64::MAX < 2^96, and the numerator price*WAD fits in i128). Make the learner unable to block settlement: in settle_handler, skip the observation when observe returns Err (optionally emit an event) instead of reverting. Add Rust and LiteSVM tests with a BTC-scale price (~1e13, expo -8) and two consecutive settles. Before any mainnet use, redeploy devnet and reset the STOOK and ZCAT series.

### The settlement confidence ceiling (step/2) now follows volatility and will likely void a large share of equity-anchor rounds

*volatility · economics · reviewer medium, verifiers medium, medium · day*

The rule check_settlement_instant requires conf <= price*step/20000, and step is now σ_window/4 clamped at a 10 bps minimum. For the crypto stand-ins this is harmless. For the app's mainnet equity anchors (SPYx, GLDx), the ceiling drops to about 7-12 bps on a normal daily round and to 5 bps on a round funded late, which the program allows down to 15 minutes before close. Those levels are close to the confidence the equity feeds actually report, so many of those rounds will void.

> **Verifier.** After 710128a the settlement conf ceiling is step_bps/2 and follows volatility. It has a hard low of 5 bps, which binds for any late-funded round (window under about 1 h for the equity anchors, and about 14 minutes when funded at the 15-minute minimum). A normal daily round gets about 9 bps for SPYx and 12 bps for GLDx. The old fixed tiers never went below 12.5 bps. The mainnet anchors are the Crypto.SPYX/USD and Crypto.GLDX/USD xStock token feeds, whose conf has not been measured, so the void rate cannot be stated yet. It could be high, and the Equity.US NVDA sample does not calibrate these feeds. Voids refund depositors and do not systematically bias the variance estimate downward, because the next settle captures the multi-day move scaled by elapsed time. Measure SPYX/GLDX conf at 16:00 New York before listing them, or decouple the ceiling with a floor such as max(step/2, 15-25 bps).

> **Verifier.** After this change the settlement conf ceiling (step/2, now as low as 5-12 bps for SPYx/GLDx) sits well below the old 50 bps. A round whose single allowed settlement update is wider than that voids after 24 h and skips its variance update. The equity numbers in the claim come from an Equity.US NVDA sample, which is not the anchor feed. The real anchors (Crypto.SPYX/USD, Crypto.GLDX/USD) showed 2.8 bps conf at a weekday 16:00 New York close, which passes. But GLDX showed 63 bps on a Saturday, and daily series run every calendar day. So voids concentrate on weekend and holiday rounds of the xStock anchors, not on 29% of normal daily rounds. They are predictable, which enables the known pump-into-void LP haircut. Fix: floor the ceiling at a fixed level, e.g. max(step/2, 25-50 bps) or the existing 100 bps OPEN_MAX_CONF_BPS, and/or skip non-trading days for equity anchors on the Series. Measure conf at the weekday and weekend closes before listing.

**Proposed fix.** Decouple the ceiling from the band width, for example conf <= price*max(step/2, CONF_FLOOR_BPS) with a floor around 15-25 bps, or give Series a max_conf_bps. Alternatively use a straddle rule that pays the bins a conf interval spans pro rata instead of voiding. Before listing SPYx/GLDx, measure their conf at 16:00 New York.

### The opening bell degenerates toward flat when var_bands is tiny (the MIN_STEP clamp binds on a very quiet anchor over a short window)

*volatility · methodology · reviewer low, verifiers low, low · hour*

When step clamps at 10 bps and σ_window is well under 10 bps, var_bands falls below about 0.1. Then k = 1/(8·var_bands) exceeds PRIOR_PEAK_LN for every bin, even the two centre ones, and the prior flattens even though the close almost surely lands in bins 31/32. That is the 'flat loses 74%' regime the commit exists to remove. VAR_MIN (σ_day 0.1%) admits it, and so does a series_set reset to VAR_MIN.

> **Verifier.** The claim holds with one correction. When the 10 bps MIN_STEP clamp binds and var_bands falls below about 0.3, prior() samples point density at bin centres and floors it, so the opening bell under-prices the centre pair. At var_bands below about 0.018 (for example VAR_MIN with the 840 s minimum window) the prior is fully flat and the centre pair is priced at 3.1% against about 100%. Reproduced figures: 62.6% at VAR_MIN/3540 s, 58.7% at 0.2%/840 s, 89.4% at 0.3%/840 s. The correction: at VAR_MIN the gap is still 4.3 pp at a 4 h window and is about 1 pp or less only from about 8 h, so "any window of 4 h or more gives 1.6 pp or less" is overstated. This is reachable only through series_create or series_set at a very low var_wad, or through about 39 or more days of flat prices; none of the listed anchors gets there.

> **Verifier.** The claim is correct as stated. To scope it: it only happens when the MIN_STEP clamp binds and var_bands falls below about 0.3. That needs σ_window under about 5.5 bps, which in practice means a series with σ_day of about 0.5% or less and a round started late, so the window is near its 840 s minimum. A VAR_MIN series with a 24 h window is still calibrated. The simplest fix is to floor var_bands at about 0.25 WAD in band_width and mirror it in the SDK. That is better than raising VAR_MIN.

**Proposed fix.** Raise VAR_MIN to about (0.3%)², or floor var_bands at about 0.25 WAD in band_width, or build the prior from bin CDF mass rather than point density so a narrow bell puts its mass in the centre pair.

### The backtest's 'op for op' observe port could not reproduce the program's failure: the SDK wadDiv has no 2^96 divisor guard

*volatility · methodology · reviewer low, verifiers low, low · hour*

validate.mjs claims to update the variance 'exactly as Series::observe does it', and it feeds prices scaled by 1e6, so BTC is about 1.1e11, already over the threshold. The SDK wadDiv is plain `(a*WAD)/b` with no MAX_WAD_DIVISOR refusal, so the replay succeeded exactly where the program errors. That is how the critical bug above got through validation. The SDK also has no port of observe, so no SDK test covers it.

> **Verifier.** The SDK wadDiv has no 2^96 divisor guard, and validate.mjs's observe port therefore returns values where the program's Series::observe returns Overflow. At validate's 1e-6 price scale that happens only once the previous BTC close is above $79,228 (63.7% of cached BTC rows). The larger gap is the scale: the program divides raw Pyth prices (exponent -8) times 1e18, so on chain it fails for any asset priced above about $0.00079. The replay therefore did not model the program's integer domain for any coin. Adding the guard is necessary but not sufficient: an SDK observe port and validate.mjs must also feed Pyth-scale integers and be cross-tested against Rust.

> **Verifier.** Accurate as stated, with one addition: at the backtest's 1e-6 scale the replay only crosses 2^96 for BTC (in about 64% of hours). At Pyth's expo -8, the scale the program actually gets, it fails for all BTC and ETH prices and for ZEC above about $792. The backtest's numeric results are still valid because BigInt is exact. The simplest fix is to drop the redundant `* WAD` in Series::observe and in validate.mjs, which gives identical ratios with a tiny divisor. The SDK wadDiv guard and an observe port with a cross-test are good extra parity and regression guards.

**Proposed fix.** Add the `b > 2n**96n` refusal to the SDK wadDiv so it behaves like the program (the trade paths never reach it because of W_MAX). Port observe to the SDK and cross-test it against Rust at BTC-scale prices. Rerun validate.mjs after the program fix.

### One unredeemed winning line blocks ladder_close forever; a griefer can do it for 3 base units

*close · economics · reviewer low, verifiers low, low · day*

ladder_close requires open_positions == 0, and ladder_sweep refuses any position owed > 0. So a round with even one winner who never redeems can never close, and the creator's ladder and vault rent (~0.0164 SOL) plus the dust stay locked. An adversary can force this on any round: buy 1 share of band(0,63), which always wins at level 1, and never redeem. This costs 3 quote base units, and the 0.00166 SOL of position rent stays theirs to recover whenever they like. Honest winners who forget to redeem (lost wallets, 1-unit wins) do the same thing by accident, so in practice busy rounds will rarely close. The keeper's clearUp then re-scans every such round with getProgramAccounts every 10 passes, forever.

> **Verifier.** Holds as stated, with one correction: the griefer's locked position rent is 1,656,480 lamports (110-byte account). The 1,661,480 figure includes a 5,000-lamport transaction fee, which is spent rather than locked. The creator's stuck rent, 16,404,720 lamports (Ladder 14,365,440 + vault 2,039,280), is exact. No user funds are lost. The cost is the creator's rent and dust, plus the keeper re-scanning each stuck round with getProgramAccounts every 10 passes.

> **Verifier.** The claim holds. Any position owed > 0 that is never redeemed, or any tranche never claimed, stops ladder_close for good, and anyone can force this for about 2 base units net. The only thing lost is the round funder's ~0.016 SOL of ladder and vault rent plus a few base units of dust. No trader, LP or protocol funds are at risk, and it is not a regression: before this commit, rounds could never close at all. The keeper's cost is a getProgramAccounts call per stuck round every 10 passes, which grows but does not fail. "Busy rounds will rarely close" is not evidenced. Fix: a permissionless push to the owner's canonical ATA for both positions and tranches. The cheapest first step is to have the keeper skip rounds whose openPositions has not changed since the last scan found them all owed.

**Proposed fix.** Make paying out permissionless. Let ladder_sweep (or a new ladder_push) pay `owed` to the owner's canonical ATA for the quote mint (derived and checked on chain) and then close the position, and do the same for tranches. Or, after a long grace period (e.g. 30-90 days past final), let close move the unpaid obligations into a small claim record or the treasury with an event. Either way, the keeper should stop re-scanning rounds whose remaining positions are all owed > 0.

### In a void with no trader still holding basis, close sends all fees (including the LPs' 80%) to the treasury as 'dust'

*close · economics · reviewer low, verifiers low, low · hour*

void_handler folds fees_lp, fees_creator and fees_protocol, plus the pool's round-trip gains, into void_trader_pot, and splits it by basis_total. When every trader sold out before the lock, basis_total == 0: void_share returns 0 for everyone, LPs get exactly their deposit, and the whole trader pot is unclaimable. Before this commit it sat in the vault forever. Now ladder_close sends it to the treasury, while the code comment and docs call this 'rounding dust (a few base units)'. So in this case the LPs lose the fees they earned, which the settled path would have paid them. The reverse edge (pre-existing design) is that a trader holding a 1-3 unit position into a foreseeable void captures the whole pot.

> **Verifier.** When a round is voided after every trader has sold out (basis_total == 0), void_trader_pot is not zero: it holds the round-trip fees (LP, creator and protocol) plus LMSR rounding, and nobody can claim it. ladder_close, added in 710128a, sends the whole vault balance to the treasury as "dust" with no bound. In this edge case that is a real amount, not a few base units, and it goes to the protocol treasury rather than to the depositors. It does not take anything the LPs would have kept in a void, because by design every void returns fees_lp to the trader pot. Fix: in void_pots, give the remainder to lp_pot when basis_total == 0, or bound or label close's sweep, and correct the "dust" wording in the close_handler comment and docs/architecture.md:174.

> **Verifier.** A void where no open position holds basis (basis_total == 0) leaves a trader pot nobody can claim. It is made of the round-trip fees and any net pool gains. It used to sit in the vault forever; now ladder_close sends it to the treasury and calls it 'dust'. LPs get exactly their deposit. They get no fees in any void by design, but in this case nobody else has a claim either, so the leftover should go to the tranches. This only happens with a never_settled void (oracle missing for 24h past settles_at) where every trader had exited. The simplest fix is in void_handler: if basis_total == 0, set lp_pot = vault, and mirror the change in the SDK voidPots.

**Proposed fix.** In void_pots, when basis_total == 0, give the whole vault to depositors (lp_pot = vault), or at least return the folded-back fees_lp to the tranches pro rata. Also bound close's 'dust' (e.g. require vault.amount <= open-count-derived rounding bound, or emit it distinctly) so a non-dust sweep to the treasury is not silent.

### Anyone can snipe creator status (10% of all fees) on every round with a one-token seed

*security · economics · reviewer medium, verifiers low, low · hour*

ladder_create is permissionless, first caller wins the (series,index) PDA, and becomes l.creator, which receives 10% of every trade fee (split_fee) via collect_fees, plus the ladder+vault rent at close. The only floor is one whole quote token. A bot creating each round at the first second it is creatable (settles_at - MAX_LEAD_SECS) captures 0.1% of the round's whole volume for 1 token of LP risk, and the keeper or a real sponsor can then only lp_join.

> **Verifier.** A permissionless first caller of ladder_create for (series, index) becomes ladder.creator with a 1-token seed. It can do this at exactly close_of(index) - 48h and then receives 10% of the fee, i.e. 0.1% of the round's volume at the fixed 100 bps fee, while risking at most its 1-token seed tranche. The ladder and vault rent it receives at close is only a refund of what it paid, not profit. The issue predates 710128a and is already recorded, unfixed, in docs/design-review/audit-round-2-2026-09-23.md:221. The commit narrows creation to the 48h lead window and makes rent reclaimable, but does not change the creator-cut economics. Only the split between creator and sponsor/keeper changes, and no trader or LP funds are at risk.

> **Verifier.** Anyone can take the creator slot on any series round with a one-token seed at exactly close_of(index) - 48h. That wins them the 10% creator share, 0.1% of the round's volume, which would otherwise go to a real starter. This was already reported in audit round 2 and is still open. 710128a makes it slightly cheaper, because ladder_close now refunds the creator's rent. LPs, traders and the protocol lose nothing: the split is fixed, voids put the creator fees back into the refund pot, and the app promises seeders only the 80% LP share. The simplest fix is to fold the creator share into the LP fee accumulator in split_fee.

**Proposed fix.** Tie the creator share to the seed (pay it pro rata to tranche depth, i.e. fold it into the LP share), or require a meaningful minimum seed, or let only the series authority or keeper create rounds during the first N hours of the lead window.

### A stranger's unclaimed 1-token tranche blocks ladder_close forever (funder's rent and dust stranded)

*security · bug · reviewer low, verifiers low, low · day*

ladder_close requires open_tranches == 0, and only a tranche's owner can claim it: claim_lp needs the owner's signature, and ladder_sweep handles positions only. Anyone can lp_join 1 token and never claim, so the round can never be closed. The creator's rent (ladder about 0.0144 SOL plus the vault) and the treasury's dust stay locked, and the keeper's clearUp skips the round on every pass forever. The same holds for the creator's own tranche and for any winning position whose owner never redeems.

> **Verifier.** The claim holds as stated. A 1-token lp_join that is never claimed, or any winning or void-refundable position that is never redeemed, keeps open_tranches or open_positions above zero, so ladder_close fails with LadderNotClosable indefinitely. Only the owner can claim a tranche, only positions owed zero can be swept, and there is no time-based escape. The stranded amount is the creator's rent (about 0.01437 SOL for the ladder plus 0.00204 SOL for the vault) and the dust. No user funds are at risk, and the new feature simply falls back to the old behavior for that round. A deliberate griefer must lock about 0.009 SOL of tranche rent plus 1 token of their own, so the realistic trigger is abandonment rather than attack.

> **Verifier.** Correct as stated, with one more point. The root cause is that claim_lp and redeem still require the owner's signature, which the round-2 audit's specified fix explicitly said to remove. So besides a griefer's 1-token tranche, any forgetful LP or unredeemed winner leaves the round unclosable. Only the creator's roughly 0.016 SOL of rent and a few base units of dust are stranded. No user funds are at risk, and the grief costs the attacker about as much as it costs the victim. The simplest fix is permissionless claim_lp and redeem that pay only to the owner's ATA, with no grace period.

**Proposed fix.** Add a permissionless tranche sweep after a grace period (e.g. 30 days after settle or void) that pays the tranche's claim to its owner's ATA (or escrows it to the treasury) and closes it, the same way ladder_sweep does for zero positions. Optionally allow close after a long grace, with the remaining claims moved to the treasury.

### The first funder at the 48h edge decides whether the latest close's return enters the band width

*security · methodology · reviewer low, verifiers low, info · hour*

For a daily UTC series, round D+2 becomes creatable at exactly now = close_D, since settles_at - now = 48h = MAX_LEAD_SECS (inclusive). Round D cannot be settled until a Pyth update with publish_time >= close_D is posted, so a funder at that moment locks D+2's step_bps from the variance before D's observation. A funder who waits for settle gets it with D. On a big-move day the difference is large: with 2%/day and a 10% move, var goes from 4.0e-4 to about 9.5e-4, making step about 1.5x wider. ladder_create takes no expected-step or var argument, so an honest funder whose client quoted roundTerms can also land on different terms if a settle lands first.

> **Verifier.** A round's step_bps and prior come from series.var_wad at the moment ladder_create runs. There is one round per index and ladder_create takes no expected-terms bound, so the funder's timing relative to the previous settlement decides whether the latest return is included. At the 48h edge (now == close_D, inclusive), D+2 can be created before D settles. More broadly, D+1 can be created either before or after D settles, over about a day. Example: 2%/day and a 10% move takes var from 4.0e-4 to 9.21e-4, so a 24h round's step goes from 50 to 76 bps (1.52x). Shortening MAX_LEAD_SECS alone does not make terms independent of timing. The real mitigation is an expected step_bps / var bound (slippage-style) on ladder_create, with the client passing its roundTerms quote.

> **Verifier.** One ladder exists per (series, index), and its step_bps is fixed from series.var_wad when it is created, so a round's width includes only the observations settled by then. This is general, not specific to the 48h edge. D+1 created before close_D (up to 47h45m of its 48h window) never includes D's return, while D+2 created between close_D and D's settle transaction (usually seconds) does not either. The effect is at most one EWMA update, and the terms are public before anyone else deposits or trades. The only real consequence is that the creator's client quote can go stale if a settle lands first, which an optional expected-step or bound argument on ladder_create fixes. Shortening MAX_LEAD_SECS to 47h does not make the var state deterministic per index.

**Proposed fix.** Make the lead window strictly shorter than the gap to the next settlement (e.g. MAX_LEAD_SECS = 48h - 1h, or require series.last_at >= close_of(index) - 2*DAY before creating), so every round of a given index is created from the same var state. Add an expected step_bps (or max var) argument to ladder_create.

### A voided never-opened round can be closed and the same (series,index) re-created by anyone, with different terms

*security · integration · reviewer low, verifiers low, low · hour*

A 24h round has locks_at = settles_at - 3600. If it never opened, it voids at locks_at, and once its claims are done ladder_close frees the PDA. Because now + MIN_ROUND_SECS <= settles_at still holds, anyone can call ladder_create on the same index again. The second incarnation gets a 56-minute window, a 147s lock gap, and a much narrower step (25 bps vs 125 in the test). The rule that a day has one round breaks, as does anything keyed by the ladder address (the indexer, calendar and position history see two lifecycles at one address).

> **Verifier.** The claim holds as stated, with one wording correction. "56-minute window" is the trade window, opens_at to locks_at = 3393 s. The whole round, opens_at to settles_at, is 3540 s (59 min). The issue is integration and identity only: no funds are affected, and the second round is a valid self-funded round. It only happens for a round that was funded 15 or more minutes before close and never opened. The keeper's clearUp closes such rounds automatically, which makes a re-create possible on every such day. Possible fixes: refuse ladder_close before settles_at (or before settles_at + grace), or keep a per-series high-water mark of created indices.

> **Verifier.** This holds. A round that voids because it never opened can be closed at locks_at, and ladder_create can then re-create the same (series, index) with a short window and a narrow step. It only happens after the whole open window of about 23h passed with nobody calling the open crank, which anyone can call. That round never traded, and every deposit was refunded in full, so no funds are at risk. The effects are a broken "one round per day" invariant and possible confusion for anything keyed by the ladder address. The simplest fix is to add `require!(now >= settles_at)` in close_handler rather than a high-water mark.

**Proposed fix.** Keep a per-series high-water mark (e.g. the last index closed or created) and refuse ladder_create for an index at or below it, or refuse ladder_close before settles_at, so a closed day cannot be re-created.

### Stock anchors run rounds 7 days a week on chain; the backtest drops weekends and every Monday

*rule-methodology · methodology · reviewer high, verifiers medium, medium · day*

On mainnet, SPYx and GLDx settle on 24/7 xStock feeds, and every series is a daily NY-clock series. Nothing in the program, SDK, app or keeper skips weekends. The backtest drops weekends and, because its open-price lookup allows at most 4h of staleness, every Monday as well: 534 rounds instead of about 697 weekdays. Weekend rounds are therefore never tested. If the weekend feed is quiet, they have a near-certain outcome, and they drag the series variance down, which narrows weekday bands.

> **Verifier.** Nothing in the program, SDK, app or keeper stops a daily NY-clock series on a 24/7 xStock feed from running Saturday and Sunday rounds. The backtest drops weekends and, because of the 4h open-price staleness limit, also every Monday and every day after a market holiday: 534 rounds out of about 759 weekdays. So the published SPY/GLD results cover Tuesday to Friday only. The weekend-loss magnitudes depend on the assumption that the weekend feed is flat, which the reviewer modelled rather than observed.

> **Verifier.** Stock-anchored series (SPYx, GLDx, STONK) can run rounds every calendar day on chain, since no weekend or holiday guard exists anywhere. The backtest tested only Tue to Fri: weekends are skipped explicitly, and all 152 Mondays are dropped by the 4h staleness rule on the open price. STONK is untested. If weekend feeds are quiet, weekend rounds realize the bounded worst-case loss of about 15% of the deposit instead of it being a ceiling, and zero-return weekend observations shrink σ, which slightly narrows the bands on the following weekdays. Losses stay bounded and LPs opt in round by round. The fix: add a weekdays-only flag, or at least a UI and keeper filter, for stock anchors, and correct the backtest to include Mondays and state its coverage.

**Proposed fix.** For stock anchors, add a weekdays-only flag to the series and have ladder_create refuse any index whose close falls on a Saturday or Sunday (and ideally on admin-listed holidays). Let Series::observe count trading days, not calendar days, across the weekend gap. Otherwise, give weekend rounds their own variance multiplier. Then re-run validate.mjs on a 7-day calendar with Monday rounds included, and backtest STONK (the KNOTS anchor), which is not covered at all.

### The 'worst counterparty' is not the worst: its thin-tailed belief hands the house large windfalls

*rule-methodology · methodology · reviewer medium, verifiers low, low · hour*

The README says no flow is worse for the house than the informed-at-lock trader. But that trader believes a Gaussian over the final hour, while real returns from lock to close have kurtosis 10.6. When the close lands in a band the trader priced near zero, the house wins big: 71 rounds show +30% to +272% of deposit. These windfalls pull the headline mean up. A trader with the same information but fat-tailed beliefs does worse for the house.

> **Verifier.** The README's "no flow is worse" and "ceiling on the loss" sentences (scripts/backtest/README.md lines 24 and 58-59) are false. A lock-informed trader with fat-tailed beliefs costs the house about -17.6% to -17.7% per deposit on average, against the published -16.6%, and -36.3% to -36.8% in the worst 5%, against -35.1%. The rule ranking and all shipped parameters are unaffected. math/ladder.rs prior() does not contain the claim, so only the README needs editing. Severity is low: documentation only.

> **Verifier.** The claim holds, though it is milder than stated. The backtest's informed trader is Gaussian, while lock-to-close returns have kurtosis about 10.6. A fat-tailed trader with the same information costs the house about 1.1 points more per round: -17.7% instead of -16.6%, with the worst 5% at -36.3% instead of -35.1%. The rule ranking does not change. The README's lines "No flow is worse for the house" and "ceiling on the loss" are false in any case, since a trader who knows more does strictly worse for the house. The claim sits only in scripts/backtest/README.md, not in the math/ladder.rs comments. The program and SDK need no change; fixing the documentation is enough.

**Proposed fix.** Report the headline against a fat-tailed trader, or use the expected-loss metric (b·KL(q‖p) with a calibrated q), and quote about -17.7% per round before fees. Drop the 'no flow is worse' sentence from scripts/backtest/README.md and from the comments in math/ladder.rs prior().

### Stock lock price is really 30 minutes before the close, and the last-hour volatility assumption is wrong for stocks

*rule-methodology · methodology · reviewer low, verifiers low, info · hour*

Yahoo's hourly bars for SPY and GLD start at :30. So price_at(T-3600) returns the bar that closes 30 minutes before the close, not 60. The trader's belief also uses var/24 for the last hour. That fits crypto (measured 0.042 to 0.049) but not stocks: SPY's last hour carries 0.077 of daily variance and GLD's 0.020. The published stock numbers are therefore off by several points. The direction depends on the asset, and the vol-vs-fixed ranking does not change.

> **Verifier.** Confirmed. In validate.mjs, the stock "lock" price priceAt(T-3600) is the close of the bar that ends 30 minutes before the 16:00 ET close, because Yahoo's equity hourly bars open at :30. The belief's var/24 is roughly right for crypto (last-hour share 0.038-0.044) but wrong for stocks. Measured over the gap actually replayed, SPY's share is 0.053 and GLD's is 0.013. The backtest also closes crypto at 20:00 UTC, while scripts/devnet/series.mjs creates the daily series at 16:00 NY. The published SPY and GLD figures are off by about a point, and the rule choice and ranking do not change. This affects the backtest methodology only. The program and SDK are unaffected.

> **Verifier.** For SPY and GLD, validate.mjs's lock price is taken 30 minutes before the close, not 60, because Yahoo equity bars are :30-aligned. The informed-trader belief also uses var/24, while the measured share for that (30-minute) bar is 0.077 for SPY and 0.020 for GLD. With the belief calibrated, the published stock losses are bracketed by T-30m and T-90m: SPY -14.2 to -10.6 against -13.1 published, GLD -20.8 to -14.7 against -19.9 published. Vol still beats or ties fixed. For SPY at T-30m calibrated it is a tie (-14.19 vs -14.16), not a win. This affects only the backtest documentation, not the program or its users. The fix is a README note, or an explicit 1800s lock offset for :30-bar assets.

**Proposed fix.** For stocks, interpolate the lock price between the bars that close 30 and 90 minutes before the close, or use 30-minute data. Scale the trader's variance by the measured last-hour share. Generate crypto closes with closeOf on the NY clock, as validate.mjs already does for stocks.

### Series::observe reverts every settlement after the first for any feed whose raw price exceeds about 7.9e10 (BTC and ETH on devnet)

*integration · bug · reviewer critical, verifiers critical, high · hour*

`observe` calls `wad_div(price*WAD, last_price*WAD)`. `wad_div` returns Err for any divisor above 2^96 (wad.rs:147, MAX_WAD_DIVISOR). Here the divisor is last_price*1e18, so it fails once last_price > 79,228,162,514. settle_handler runs `math(series.observe(..))?` (instructions/ladder.rs:859), so the whole settlement reverts with MathOverflow. The first settlement of a series only records the price and succeeds. Every settlement after it fails. BTC (raw ~6.5e12 at expo -8) and ETH (~2.5e11) are the devnet stand-ins for STOOK and ZCAT, so from the second day on their rounds cannot settle and void after 24h. SPYx at expo -8 would hit the same limit near $792. The keeper cannot see this coming: settlementProblem() passes, and each 5-second pass posts a Pyth VAA (paying fees), fails the consume in preflight, then pays again to close the account. That repeats for 24h per stuck round.

> **Verifier.** Holds as stated. The overflow is real: every settlement after the first fails for feeds whose raw price is above 79,228,162,514 (BTC and ETH, which stand in for STOOK and ZCAT). Stuck rounds void and refund, so the damage is a broken core function plus wasted keeper fees, not lost principal. My severity is high rather than critical. The fix is wad_div(price, last_price), and a failed observation should also be made non-fatal.

**Proposed fix.** Use `wad_div(price as i128, self.last_price as i128)`: raw integers give the WAD ratio directly, and the divisor stays at or below i64::MAX, well under 2^96. Also make a failed observation non-fatal (skip it) so volatility learning can never block a settlement. Add a unit test at BTC-scale prices and an e2e case that settles two rounds of one series.

### The SDK test suite fails at HEAD: ladderFilters test still asserts the old layout

*integration · bug · reviewer low, verifiers low, low · hour*

ladderFilters now puts a dataSize filter first and reads status at 8+1912=1920, which matches the Rust layout. The test in the same commit still expects 2 filters, status offset 1872, and 1 filter with no status. `npx vitest run` reports 1 failed, 31 passed.

> **Verifier.** The claim holds. The ladderFilters unit test in ladder-math.test.ts is stale after the new layout (dataSize filter added, status offset moved 1872 to 1920), so the SDK suite has 1 failing test at HEAD. The production code is correct, and this is test hygiene with no effect on users.

**Proposed fix.** Update the test to expect length 3 with f[2].memcmp {offset:1920, bytes:'2'} and f[0] {dataSize:1936}, and ladderFilters() to have length 2.

### The band width shown in StartRound is not bound at signing; ladder_create has no expected-terms argument

*integration · integration · reviewer low, verifiers info, info · hour*

StartRound shows stepBps, trading window and odds from roundTerms(series, index, Date.now()), with the series refetched only every 60s. ladder_create recomputes band_width from series.var_wad and its own clock, and there is no argument to cap or pin the result. When a settlement lands between display and signing, the funder's seed is committed to a different band width. Settlements land at the 4 PM close, the same moment day+2 first becomes fundable. One 3-sigma day moves var by about 1.5x, so a 62 bps band becomes about 76 bps. The seed is the house, so a different width changes the funder's risk from what they were shown. For a same-day round the window also drifts with the clock, but only slightly.

> **Verifier.** ladder_create does recompute step_bps from the live series.var_wad, with no expected-terms argument. A settlement landing between render and signing (most likely at the 4 PM close, when day+2 becomes fundable) changes the band width: a 3-sigma day turns 62 bps into about 75 bps. Because step is sized to sigma/4 and the prior keeps about 16 bands² of variance, the round's risk in sigma units and its opening odds per band are unchanged. Only the displayed % band width and reach go stale. This is a cosmetic UI staleness issue; refetching the series in start() is enough.

> **Verifier.** StartRound's displayed band width can be stale by up to 60s. The window right after a daily close is the worst case, because that is when day+2 first becomes fundable and the keeper's settle updates var. The signed ladder_create then writes a different step_bps from the one shown (for example 62 to about 76 bps after a 3-sigma day). The funder's economic risk does not materially change: band_width/prior are scale-invariant (the bell stays about SIGMA_BANDS bands wide, 64 bins, same LMSR loss bound for the seed), and the on-chain value reflects fresher volatility. This is a UI-accuracy issue. Refetching or invalidating the series in start() fixes it; no on-chain expected-terms argument is needed.

**Proposed fix.** Add `max_step_bps`/`min_step_bps` (or an expected `series.observations`) to LadderCreateArgs and require it on chain. At minimum, refetch the series in start() and cancel if stepBps changed.

### StartRound and series.mjs overstate the grid's reach and show it as symmetric

*integration · ux · reviewer low, verifiers low, low · hour*

The finite grid runs from p0·e^(-31·step) to p0·e^(31·step): bin 63 is [p0·e^(31s), ∞) and bin 0 is [0, p0·e^(-31s)), per bin_for and binBounds. The UI shows '±(e^(32·step)-1)'. That uses one band too many and applies the upside figure to the downside. At 60 bps it shows ±21%; the real grid is +20.4% / -17%. At the 2000 bps cap it shows ±60,000% against a real -99.8% downside.

> **Verifier.** This is confirmed as a display-only issue in StartRound.tsx:31/55 and scripts/devnet/series.mjs:57. The last finite band edges are p0·e^(±31·step), because bins 0 and 63 are open tails (bin_for clamp, SDK binBounds). The label should read +(e^(31s)-1)% / -(1-e^(-31s))%. At 60 bps the UI shows ±21% where the real grid is +20.4% / -17.0%. At 2000 bps it shows ±60,085% where the real grid is +49,175% / -99.8%. The main error is the symmetric downside. Using 32 steps instead of 31 is a smaller off-by-one.

> **Verifier.** The claim is accurate (the line is StartRound.tsx:33, not :31). The UI and the devnet script show the reach as ±(e^(32s)-1). The real finite grid is +(e^(31s)-1) / -(1-e^(-31s)). The error is small at realistic band widths (60 bps: ±21% shown against +20.4/-17.0%) but misleading on the downside for volatile series (500 bps: ±395% shown against -78.8%). It has no on-chain or fund impact.

**Proposed fix.** Show `+(e^(31s)-1)` / `-(1-e^(-31s))`.

## Verdict per lens

**series-calendar.** The series and calendar code at 710128a is correct. close_of, days_from_civil and the New York DST handling (including switch days and the 3 AM floor), the 15 min / 48 h funding window, round_times, and series_create/series_set validation all behave as specified. I checked these with a LiteSVM test that created 60 rounds; the SDK's roundTerms matches the program's writes bit for bit. Two real but low-severity issues: (1) 'One round per day' is not strictly enforced. A round that never opens can be voided up to 1 h before its close, then closed and created again for the same (series, index) with different terms. (2) The opening odds turn flat instead of sharply peaked when a coin's variance is near the floor and the round's window is short (for example 0.1% daily volatility with a 15 min window). That brings back the flat start the backtest was meant to prevent. Info: the protocol authority can add a 1-day periodic series whose rounds settle at the same second as the daily series' rounds. My scratch test is deleted. The other zz_scratch files and the lib.rs change now in the tree belong to parallel auditors, not to this one.

**volatility.** One critical bug. Series::observe divides by last_price*1e18, and wad_div refuses that divisor for any feed priced above 7.92e10 raw (about $792 at expo -8). On BTC and ETH series every settle after the first reverts with MathOverflow, and those rounds void after 24 h. A LiteSVM run on the built .so reproduces it, and it hits the devnet STOOK (BTC) and ZCAT (ETH) series. It went uncaught because the e2e test settles at 22,460,000 and the SDK wadDiv lacks the program's 2^96 guard, so the backtest replay passed. The one-line fix is wad_div(price, last_price), and the settle should never revert because the variance learner failed. Beyond that, the volatility state machine is sound: only the round's own series, at Pyth's settlement-instant price, can move the EWMA; voids, stale settles and exponent changes are handled; each step is bounded; there is no overflow at the clamps; and the SDK matches the program bit for bit on 6,000 grid points. Funding a round around a variance update changes the backtested house loss by at most 0.3 pp. There are two secondary issues. The conf <= step/2 settlement check now likely voids many SPYx/GLDx rounds (about 29% of SPY daily rounds at an 8.6 bps conf; that figure comes from a single devnet equity sample, since live conf could not be fetched). The bell also goes flat at VAR_MIN-level variance over short windows. Tree left clean at 710128a. I did not check the running shell or anything on devnet.

**close.** The counter and close logic is sound. Every path that creates or closes a position or tranche keeps open_positions/open_tranches exact: the trade's first touch (only when pos.owner is default; repeated first touches inside one atomic transaction still count once, measured), lp_join and create (open_tranches=1 after join), redeem/sweep/claim_lp (each closes the account it decrements for, so a second decrement in the same or a later ix fails Anchor's owner check). saturating_sub never actually saturates. Sweep cannot take a position that is owed money: it reuses redeem's `redemption` on the same state, is bound to position.ladder == ladder and to position.owner for the rent, and is refused before final. Close requires SETTLED/VOID with both counters zero and fees_creator/fees_protocol collected, which covers every winner, every tranche (principal+fees_lp) and the fee shares. Cash drains to exactly 0 because payout[bin] is maintained per trade. The creator is pinned by address. The Token-2022 harvest ([26,4], mint+vault writable) is correct and is skipped when the vault has no TransferFeeAmount or withheld==0. A treasury ATA that charges a fee only withholds at the destination. Re-creating a closed PDA is possible only for a round voided before it opened, and that round can have no positions and all its tranches were already claimed, so no stale position or tranche can attach to the new ladder (proved). The real problems are economic, not accounting: (1) any single unredeemed winning line, which a griefer can create for 3 base units plus rent they can recover, makes a round permanently unclosable; (2) in a void where no trader still holds basis, close sends the whole trader pot (all fees, including the LPs' 80% share) to the treasury under the label 'dust'. Measured on LiteSVM against the shipped binary; the scratch test was deleted (two untracked zz_scratch_vol files in the tree belong to another session and were left alone).

**security.** Accounts and authority on series_create, series_set, ladder_create, ladder_settle, ladder_sweep and ladder_close hold up. I found no way for a stranger to move funds, substitute accounts, or brick a series. I confirmed this with a scratch LiteSVM test against the HEAD .so (3/3 passed, file deleted afterwards).

What is correct, with evidence:
- **Series creation is authority-only.** series_create and series_set both require `config.authority == authority`, and a stranger's call is refused in the test. So nobody can front-run a series_create, and a fake Series is impossible: `Account<Series>` checks the owner and discriminator, and only series_create can create one.
- **ladder_create binds the mint.** It requires `series.quote_mint == quote_mint`: using another mint's series was refused with LadderWrongAccount. The feed is copied from the series, and the ladder PDA is seeded with the series key, so a ladder's `series` field cannot point anywhere else.
- **ladder_settle binds the series.** It requires `series == ladder.series`: settling with a different series of the same feed and mint was refused with LadderWrongAccount.
- **Series cannot be closed.** No instruction closes one, so settle can never be bricked by a missing series.
- **Sweep is safe.** It binds the position to the ladder and the rent receiver to `position.owner`, and only closes a position owed nothing. The keeper's `owedTo` matches the program's `redemption` / `void_share`.
- **The open counters are exact.** They go up only on init (trade first touch, create, lp_join) and down only in handlers that close that same account (redeem, sweep, claim_lp, each bound to the ladder). A position cannot be revived, and the counters cannot reach zero while an account still exists.
- **The harvest CPI is correct.**
  - `program_id` comes from an `Interface<TokenInterface>`, so only SPL Token or Token-2022.
  - The data is `[26, 4]` (TransferFeeExtension, HarvestWithheldTokensToMint).
  - The account order is mint (writable), then the source.
  - The TLV parse starts at 166 with the account type at 165. A classic 165-byte account returns 0, so the harvest never runs on SPL Token.
  - ladder-stook.test.ts exercises the path with a non-zero withheld balance.
- **SDK account order matches the program** for create, settle, sweep and close.

Real issues, none critical:
1. **Creator status can be sniped.** Whoever funds a round first becomes `creator`, earns 10% of every fee, and gets the rent back. The minimum seed is one token, so a bot can take every round at the 48h edge for nearly nothing.
2. **One tiny unclaimed tranche blocks close forever.** A stranger's 1-token tranche stops the round from ever closing: the funder's rent and the dust are stuck.
3. **The first funder chooses whether the latest close counts.** The 48h edge is exactly the previous-but-one round's close, before its settle can land. So they decide whether that day's return goes into the band width. With 2%/day volatility and a 10% move day, that is a 1.5x difference in step size.
4. **A voided round can be re-created on the same day.** A round that never opened voids at `locks_at` (1h before close), can then be closed, and the same `(series, index)` created again by a stranger. The re-run in the test had a 56-minute window and 25 bps bands instead of 125, which breaks "one round per day".
5. **Info: rounds from before the layout change are stranded.** They are 1888 bytes against the new 1936 and no longer load, so any funds left in them on devnet are stuck. I did not check devnet (out of bounds).

A stranger cannot use init races or timing to get a different band window at the 48h edge. The window is always a full 24h whenever the lead time is at least 24h plus 60s.

**rule-methodology.** For the crypto anchors, the band rule (step = σ/4 from an on-chain EWMA with λ=0.94, and a Gaussian bell floored at e^7) is sound, and the backtest has no lookahead. I rebuilt the replay independently in floating point (scratchpad/bt/sim.py) and it matches results.txt exactly. Checks that passed: - The variance only ever uses closes from before the round. - The opening price is the price at close minus 24h. - LMSR is path-independent, so measuring the house's P&L from the final state is valid. - Fees need about 190 times the depth in volume to break even, which is consistent with the 1% fee and the 80% LP share. The -16.6% vs -17.3% difference is statistically real. It is +0.76pp, with a 95% interval of [+0.45, +1.08] from a paired bootstrap that resamples whole days (the same with 10- or 30-day blocks). But it comes entirely from ZEC (+2.8pp) and GLD (+1.3pp). For BTC, ETH, SOL, DOGE and SPY the interval includes zero. The worst-5% improvement is larger and significant: +5.9pp, interval [+2.3, +7.8]. After volatility spikes the rule wins by +1.3pp on average, interval [+0.8, +1.8], and in the worst 5% of rounds it loses 31% against 45%. So the rule's value is robustness when volatility shifts, not a better average. None of the alternatives I tried does materially better on the average. Bands per move from 2 to 6 stay within 0.3pp. A Student-t bell changes cost per unit of depth by less than 0.05 nats. Centring on recent drift is worse, and hourly realised variance is worse. λ of 0.90 or 0.97 makes no difference. A variance that is up to two settlements old (possible because rounds can be funded 48h ahead) costs about 0.2pp. The weak points are the validation's scope and its honesty claims: 1. **Weekend rounds are never tested.** The mainnet stock anchors (SPYx and GLDx) settle every day at 16:00 New York time, weekends included. The backtest drops weekends and all Mondays. 2. **The test trader is not the worst case.** The README says no flow is worse for the house, but a trader who allows for fat tails takes about 1.1pp more. 3. **Stock lock timing is misaligned.** Hourly bars start on the half hour, so the "lock price" is really 30 minutes before the close, and the model's volatility assumption for the final hour is wrong for stocks. This moves the stock numbers by several points but does not change which rule ranks first.

**integration.** One critical integration defect: the volatility learner makes settlement revert. Series::observe divides by last_price*1e18 through wad_div, which refuses divisors above 2^96. So from the second round of any series whose raw Pyth price is above ~7.9e10, every settlement reverts. That covers BTC and ETH, the devnet stand-ins for STOOK and ZCAT. Those rounds void after 24h, and the keeper spends fees posting and closing a VAA every 5 seconds meanwhile. I confirmed this with a scratch unit test, since deleted. The existing e2e never settles twice on one series, so it misses this.

Checked and correct:
- The SDK port is bit-exact with the program. 3,000 random (var, window) vectors produced identical bandWidth, varBands and prior (sum, w0, w31). 60,000 closeOf values matched across both clocks.
- The Ladder layout matches the decoders: decodeLadder, decodeSeries, the status offset 8+1912, dataSize 1936, and positionFilters offset 8.
- Instruction account orders match Rust for create (series 3rd), settle (series after price_update, writable), sweep and close.
- owedTo matches redemption/void_share exactly.
- WallCalendar's NY date, month and day index are correct in every viewer timezone. It uses Intl with America/New_York for today and civil day numbers for the cells. Its 'fundable' test equals ladder_create's except for a deliberate 90s lower margin.
- The keeper passes ladder.series to settle.
- clearUp never sweeps an owed position, never closes before fees are collected, and handles Token-2022 ATAs. Its only repeat cost is idempotent ATA transactions.
- series.mjs seeds with the same EWMA (λ=0.94, squared daily log return) that Series::observe applies.

Lesser issues:
- At HEAD the SDK suite has 1 failing test: ladder-math.test.ts:146-149 still asserts the old filter layout.
- StartRound's band width is not bound at signing.
- The reach display is off by one band and shown as symmetric when it is not.
- clearUp repeats gPA scans on stuck rounds.
- The calendar gives misleading labels on a paused series.

Checks run:
- `pnpm -F @stook/app typecheck` passes.
- `npx vitest run` gives 31 passed, 1 failed.

Tree note: my scratch files are removed. While restoring lib.rs I removed another concurrent agent's `mod zz_scratch_vol;` line, then re-added it as `#[cfg(test)] mod zz_scratch_vol;`. The remaining untracked zz_scratch_vol.rs, zz_scratch_close.test.ts and zz_scratch_vol.test.ts files belong to other agents.
