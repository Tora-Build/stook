//! The price ladder: one LMSR over 64 log-spaced price bins, traded in shapes.
//!
//! This is the mechanism four independent designs converged on and four
//! adversarial audits could not break (`docs/design-review`). Nothing in it is
//! novel, which is the point: it is `lmsr_n.rs` — the textbook scoring rule —
//! reorganised so a trade costs one `exp` and one `ln` however many bins it
//! touches, because that is the difference between 37K and 800K compute units
//! on chain (`docs/feasibility.md` §1).
//!
//! # State
//!
//! Instead of the outstanding quantities `qᵢ`, the market stores the weights
//!
//! ```text
//!   wᵢ = exp(qᵢ / b)        S = Σ wᵢ        pᵢ = wᵢ / S
//! ```
//!
//! # A trade
//!
//! A position is a *shape*: `delta` shares scaled by a per-bin level `mᵢ`.
//! Buying it multiplies each touched weight by `g^mᵢ` where `g = exp(delta/b)`,
//! and costs `b · ln(S′/S)`. `g²…g^h` come from multiplication, so the whole
//! trade is one exponential.
//!
//! Two shapes exist. A **band** is flat (`h = 1`): it pays `delta` if the price
//! settles anywhere inside. A **tent** tapers from its centre: at height 4 the
//! exact bin pays `4·delta`, one bin off pays `3·delta`, and so on to zero.
//! That taper is how "closer pays more" is expressed without leaving the
//! scoring rule — a tent is just a stack of nested bands.

use super::lmsr::{exp_wad, ln_wad};
use super::wad::{wad_div, wad_mul, MathError, WAD};

/// Bins per market. The outer two are open-ended tails, so every finite price
/// lands somewhere and a market can always settle.
pub const BINS: usize = 64;

/// Tallest tent. Each level is one extra multiplication per touched bin.
pub const MAX_HEIGHT: u8 = 8;

/// Ceiling on a single weight: `q/b ≤ ln(1e9) ≈ 20.7`.
///
/// Set by arithmetic, not taste. `wad_div` is exact only for divisors up to
/// 2^96 (`wad::MAX_WAD_DIVISOR`), and the divisor here is `S ≤ 64 · W_MAX`.
/// 64 × 1e9 × 1e18 = 6.4e28 < 2^96 ≈ 7.9e28. At 1e10 it would not fit, and the
/// division would return a wrong number rather than an error.
///
/// A bin at the cap is priced within 1e-9 of certainty; refusing to push it
/// further costs nothing a trader would notice.
pub const W_MAX: i128 = 1_000_000_000 * WAD;

/// Largest `|delta/b| · h` a single trade may carry. Keeps `g^h` inside
/// `exp_wad`'s domain with room to spare; a larger move is two trades.
pub const MAX_TRADE_EXPONENT: i128 = 20 * WAD;

/// What a position covers and how it tapers. `lo..=hi` inclusive.
///
/// The bounds are *virtual*: a tent centred near the edge of the ladder keeps
/// the bounds it would have had on an infinite one, and only the bins that
/// exist are traded. Clipping the bounds themselves looks equivalent and is
/// not — levels are measured from the bounds, so a tent centred on the last
/// bin would peak at 1 instead of `h`, paying its holder least exactly where
/// they were most right.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Shape {
    pub lo: i16,
    pub hi: i16,
    pub h: u8,
}

impl Shape {
    /// A flat band: pays `delta` anywhere in `lo..=hi`.
    pub fn band(lo: u8, hi: u8) -> Self {
        Shape { lo: lo as i16, hi: hi as i16, h: 1 }
    }

    /// A tent of height `h` centred on `center`.
    pub fn tent(center: u8, h: u8) -> Self {
        let reach = h.saturating_sub(1) as i16;
        Shape { lo: center as i16 - reach, hi: center as i16 + reach, h }
    }

    pub fn validate(&self) -> Result<(), MathError> {
        let last = BINS as i16 - 1;
        let reach = MAX_HEIGHT as i16;
        let ok = self.lo <= self.hi
            && self.h >= 1
            && self.h <= MAX_HEIGHT
            // at least one real bin, and no further off the ladder than a
            // tent's own reach — anything beyond is not a shape anyone drew
            && self.hi >= 0
            && self.lo <= last
            && self.lo >= -reach
            && self.hi <= last + reach;
        if ok { Ok(()) } else { Err(MathError::Overflow) }
    }

    /// The bins that actually exist inside the shape.
    pub fn bins(&self) -> core::ops::RangeInclusive<usize> {
        let first = self.lo.max(0) as usize;
        let last = self.hi.min(BINS as i16 - 1) as usize;
        first..=last
    }

    /// Payout multiple at bin `i`: `min(h, i−lo+1, hi−i+1)`, zero outside.
    ///
    /// For a band (`h = 1`) this is 1 inside and 0 outside. For a full tent it
    /// is the taper. For a wide shape with `h > 1` it is a plateau with sloped
    /// shoulders — all three are the same formula.
    pub fn level(&self, i: usize) -> u8 {
        let i = i as i16;
        if i < self.lo || i > self.hi {
            return 0;
        }
        let from_lo = (i - self.lo + 1).min(u8::MAX as i16) as u8;
        let from_hi = (self.hi - i + 1).min(u8::MAX as i16) as u8;
        self.h.min(from_lo).min(from_hi)
    }
}

/// Every bin equally likely. Tests and the maths reference use it; a real
/// round starts from `prior`.
pub fn fresh() -> ([i128; BINS], i128) {
    ([WAD; BINS], WAD * BINS as i128)
}

/// Spread of the opening odds: variance in bins² per day of trading. The app
/// picks each anchor's tier so an ordinary day moves about four bins, which
/// makes one number right for every anchor.
pub const PRIOR_VAR_BINS_PER_DAY: i128 = 16;

/// How much likelier the centre is than the tails at open, as a log:
/// e^7 ≈ 1,100 to one. Tails are floored there, not driven to zero, so every
/// bin stays tradeable and a deposit's worst case stays finite.
pub const PRIOR_PEAK_LN: i128 = 7 * WAD;

const DAY_SECS: i128 = 86_400;

/// The odds a round opens with: a bell centred on the opening price (the
/// boundary between bins 31 and 32), as wide as `window_secs` of ordinary
/// movement, with floored tails.
///
/// Why not flat: a flat 64-bin ladder prices every bin at 1/64, so the first
/// trader who knows where an ordinary day ends buys the middle for a fraction
/// of its worth, and the last one before the lock buys the answer. On a daily
/// 1% round that handed the seed's whole deposit to whoever traded last. A
/// prior close to the truth leaves only the genuinely unknown for traders to
/// win, which is what the depositor is paid fees to insure.
///
/// Integer maths only, ported op for op to the SDK: the exponent is
/// `L − (2i−63)²·DAY / (8·V·window)` (`= L − d²/2σ²` with `d = i − 31.5`,
/// `σ² = V·window/DAY`), floored at zero, then `exp_wad`.
pub fn prior(window_secs: i64) -> Result<([i128; BINS], i128), MathError> {
    if window_secs <= 0 {
        return Err(MathError::Overflow);
    }
    let denom = 8 * PRIOR_VAR_BINS_PER_DAY * window_secs as i128;
    let mut w = [WAD; BINS];
    // Symmetric about the centre, so each exponential serves two bins.
    for i in 0..BINS / 2 {
        let d2 = (2 * i as i128 - (BINS as i128 - 1)).pow(2);
        let e = PRIOR_PEAK_LN - d2 * DAY_SECS * WAD / denom;
        if e > 0 {
            let v = exp_wad(e)?;
            w[i] = v;
            w[BINS - 1 - i] = v;
        }
    }
    let sum = w.iter().sum();
    Ok((w, sum))
}

/// Apply a trade of `delta` shares (negative sells) in `shape`. Returns the
/// signed WAD cost: positive is what the buyer pays, negative is sell proceeds.
///
/// `sum` is maintained as the exact integer sum of `w` — updated by the same
/// differences that update the weights — so it cannot drift from them however
/// many trades run. The auditors found designs that tracked it incrementally
/// through a separate formula, and those diverged.
///
/// The caller is responsible for the things arithmetic cannot know: that a
/// seller holds what they sell, that the vault covers the largest payout, and
/// the direction of base-unit rounding.
pub fn apply_trade(
    w: &mut [i128; BINS],
    sum: &mut i128,
    b: i128,
    shape: Shape,
    delta: i128,
) -> Result<i128, MathError> {
    shape.validate()?;
    if b <= 0 || delta == 0 {
        return Err(MathError::Overflow);
    }

    let x = wad_div(delta, b)?;
    let reach = x
        .checked_abs()
        .and_then(|a| a.checked_mul(shape.h as i128))
        .ok_or(MathError::Overflow)?;
    if reach > MAX_TRADE_EXPONENT {
        return Err(MathError::Overflow);
    }

    // g, g², … g^h. One exponential; the rest is multiplication.
    let mut powers = [WAD; MAX_HEIGHT as usize + 1];
    powers[1] = exp_wad(x)?;
    for m in 2..=shape.h as usize {
        powers[m] = wad_mul(powers[m - 1], powers[1])?;
    }

    // Two passes: compute every new weight, then commit. A shape spanning
    // several bins can fail on its last one (the weight cap), and a function
    // that has already rewritten the first few would hand back weights that no
    // longer match `sum`. On chain a failed instruction reverts regardless, but
    // the quote path and the tests call this directly.
    let before = *sum;
    let mut after = before;
    let mut next = [0i128; BINS];
    for i in shape.bins() {
        let m = shape.level(i) as usize;
        // A weight below 1.0 would mean more was sold from this bin than was
        // ever bought; the caller forbids that, so the floor only ever absorbs
        // the last unit of multiplication rounding on a full unwind.
        let n = wad_mul(w[i], powers[m])?.max(WAD);
        if n > W_MAX {
            return Err(MathError::Overflow);
        }
        after = after.checked_add(n - w[i]).ok_or(MathError::Overflow)?;
        next[i] = n;
    }
    let ratio = wad_div(after, before)?;
    let cost = wad_mul(b, ln_wad(ratio)?)?;

    for i in shape.bins() {
        w[i] = next[i];
    }
    *sum = after;
    Ok(cost)
}

/// Price of one bin, WAD-scaled.
pub fn price(w: &[i128; BINS], sum: i128, i: usize) -> Result<i128, MathError> {
    wad_div(w[i], sum)
}

/// What one share of `shape` costs at the margin: `Σ mᵢ · pᵢ`. This is the
/// number a front end shows before a trade; the realised cost is higher by the
/// price impact.
pub fn quote(w: &[i128; BINS], sum: i128, shape: Shape) -> Result<i128, MathError> {
    shape.validate()?;
    let mut weighted = 0i128;
    for i in shape.bins() {
        let term = w[i]
            .checked_mul(shape.level(i) as i128)
            .ok_or(MathError::Overflow)?;
        weighted = weighted.checked_add(term).ok_or(MathError::Overflow)?;
    }
    wad_div(weighted, sum)
}

/// The bin a settled price falls in.
///
/// ```text
///   bin = clamp( 32 + floor( ln(price / p0) / step ), 0, 63 )
/// ```
///
/// Bins are equal steps in LOG price, because prices move in percentages: a
/// linear grid over ±40% gives 4.4%-wide bins at the bottom and 1.9% at the
/// top. Bin 32 starts exactly at `p0`, so bins 0..=31 are below the opening
/// price and 32..=63 at or above it. The end bins are open tails.
///
/// `price` and `p0` are raw oracle integers at the SAME exponent; only their
/// ratio is used, so the price scale — 1e-8 or 1e5 — never enters.
///
/// A front end must draw its grid from this exact rule: bin `i` covers
/// `[p0·e^((i−32)·step), p0·e^((i−31)·step))`.
pub fn bin_for(price: i64, p0: i64, step_bps: u16) -> Result<u8, MathError> {
    if price <= 0 || p0 <= 0 || step_bps == 0 {
        return Err(MathError::Overflow);
    }
    let last = BINS as i128 - 1;
    // A ratio beyond ln's domain is far past either tail; place it there
    // rather than failing a settlement over a number we do not need.
    let tail = if price < p0 { 0u8 } else { last as u8 };
    let Ok(ratio) = wad_div(price as i128, p0 as i128) else { return Ok(tail) };
    if ratio <= 0 {
        return Ok(0);
    }
    let Ok(ln) = ln_wad(ratio) else { return Ok(tail) };

    let step_wad = step_bps as i128 * (WAD / 10_000);
    // div_euclid floors toward −∞; plain `/` truncates toward zero and would
    // put a price just below p0 into bin 32 instead of 31.
    let idx = (BINS as i128 / 2) + ln.div_euclid(step_wad);
    Ok(idx.clamp(0, last) as u8)
}

// ── liquidity tranches ───────────────────────────────────────────────────────
//
// Anyone may add liquidity at any time. Each deposit is a TRANCHE: its own LMSR
// layered under the same prices, starting at the prices it joined at. Trades
// split across tranches in proportion to `b`, so every layer keeps identical
// prices and the market is one curve with `B = Σ bⱼ`.
//
// Per unit of `b`, a layer that joined at prices `p(join)` and ends at
// `p(final)` has, if bin `k` settles, made exactly
//
//     ln( p_k(join) / p_k(final) )
//
// — the sum of `ln(S′/S) − x·m_k` over every trade it was present for
// telescopes to that, whatever other tranches joined in between. So a
// tranche's value needs no per-trade bookkeeping at all: snapshot the weights
// at join, read the weights at settlement, take two logarithms. The measured
// alternative — per-bin accumulators updated on every trade — costs compute on
// the hot path to store what the weights already say.

/// `−ln pᵢ = ln(S / wᵢ)`, WAD. Always ≥ 0, and computed as a ratio ≥ 1 so a
/// one-in-a-billion bin keeps full precision instead of the seven digits
/// `ln(w/S)` would leave it.
pub fn neg_ln_price(w_i: i128, sum: i128) -> Result<i128, MathError> {
    if w_i <= 0 || sum < w_i {
        return Err(MathError::Overflow);
    }
    ln_wad(wad_div(sum, w_i)?)
}

/// Share of a deposit committed to `b`; the rest absorbs integer rounding.
pub const B_HAIRCUT_NUM: i128 = 9_999;
pub const B_HAIRCUT_DEN: i128 = 10_000;

/// The liquidity a deposit buys at the current prices: `b = 0.9999·D / ln(1/p_min)`.
///
/// A layer's worst case is `b · ln(1/p_k(join))` for the bin that ends up
/// certain, so the deposit must cover that for the CHEAPEST bin. At a fresh
/// market that is `ln 64`; once some bin has become a long shot the same
/// deposit buys less depth. That is the honest price of joining late, not a
/// penalty: the cheap bins are exactly what the deposit now has to insure.
pub fn liquidity_for_deposit(
    w: &[i128; BINS],
    sum: i128,
    deposit_wad: i128,
) -> Result<i128, MathError> {
    if deposit_wad <= 0 {
        return Err(MathError::Overflow);
    }
    let w_min = *w.iter().min().ok_or(MathError::Overflow)?;
    let worst = neg_ln_price(w_min, sum)?;
    if worst <= 0 {
        return Err(MathError::Overflow);
    }
    let usable = deposit_wad
        .checked_mul(B_HAIRCUT_NUM)
        .ok_or(MathError::Overflow)?
        / B_HAIRCUT_DEN;
    wad_div(usable, worst)
}

/// A tranche's profit or loss, WAD, if bin `k` settles:
/// `b · ( ln(S_f/w_f[k]) − ln(S_j/w_j[k]) )`. Negative when the settled bin
/// became likelier after the tranche joined — the layer sold it too cheaply.
pub fn tranche_pnl(
    b: i128,
    join_w_k: i128,
    join_sum: i128,
    final_w_k: i128,
    final_sum: i128,
) -> Result<i128, MathError> {
    let at_join = neg_ln_price(join_w_k, join_sum)?;
    let at_end = neg_ln_price(final_w_k, final_sum)?;
    wad_mul(b, at_end - at_join)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::math::lmsr_n::cost_delta_n;

    #[test]
    fn the_prior_is_a_symmetric_bell_with_floored_tails() {
        let (w, sum) = prior(86_400).unwrap();
        assert_eq!(sum, w.iter().sum::<i128>());
        for i in 0..BINS {
            assert_eq!(w[i], w[BINS - 1 - i], "symmetric about the opening price");
            assert!(w[i] >= WAD && w[i] <= W_MAX);
        }
        assert!(w[31] > w[30] && w[30] > w[28]);
        assert_eq!(w[0], WAD, "tails floored, never zero");
        // centre bins together near a fifth of the mass for a day's round
        let p = |w: &[i128; BINS], sum: i128, i: usize| w[i] as f64 / sum as f64;
        let centre = p(&w, sum, 31) + p(&w, sum, 32);
        assert!(centre > 0.17 && centre < 0.23, "{centre}");
        // a shorter round is more certain of its centre
        let (s, t) = prior(3_600).unwrap();
        assert!(p(&s, t, 31) + p(&s, t, 32) > 2.0 * centre);
    }

    #[test]
    fn a_seed_under_the_prior_loses_far_less_to_a_trader_who_knows_the_close() {
        // The whole seed is at stake on a flat ladder when the close is known
        // at the lock; under the prior an ordinary close costs a fraction.
        let deposit = 1_000 * WAD;
        let lose = |w: [i128; BINS], sum: i128, k: usize| {
            let b = liquidity_for_deposit(&w, sum, deposit).unwrap();
            // the most anyone can take on bin k: push it to the weight cap
            let pushed = W_MAX;
            let fin = sum - w[k] + pushed;
            -tranche_pnl(b, w[k], sum, pushed, fin).unwrap()
        };
        let (fw, fs) = fresh();
        let (pw, ps) = prior(86_400).unwrap();
        let flat = lose(fw, fs, 33);
        let bell = lose(pw, ps, 33);
        assert!(flat > 99 * deposit / 100, "flat: the seed is gone");
        assert!(bell < 45 * deposit / 100, "prior, one band from centre: {}", bell / WAD);
        // a tail close still costs the whole seed: that is the insured risk
        assert!(lose(pw, ps, 5) > 99 * deposit / 100);
    }

    fn close(a: i128, b: i128, eps: i128) -> bool {
        (a - b).abs() <= eps
    }

    // Relative 1e-12: the two implementations round in different places.
    const EPS: i128 = 1_000_000;

    #[test]
    fn the_tent_tapers_from_its_centre() {
        let t = Shape::tent(30, 4);
        assert_eq!((t.lo, t.hi), (27, 33));
        let levels: Vec<u8> = (26..=34).map(|i| t.level(i)).collect();
        assert_eq!(levels, vec![0, 1, 2, 3, 4, 3, 2, 1, 0]);
    }

    #[test]
    fn a_band_is_flat_and_a_wide_tall_shape_is_a_plateau() {
        let band = Shape::band(10, 14);
        assert!((10..=14).all(|i| band.level(i) == 1));
        assert_eq!(band.level(9), 0);
        assert_eq!(band.level(15), 0);

        let plateau = Shape { lo: 10, hi: 20, h: 3 };
        let levels: Vec<u8> = (10..=20).map(|i| plateau.level(i)).collect();
        assert_eq!(levels, vec![1, 2, 3, 3, 3, 3, 3, 3, 3, 2, 1]);
    }

    /// The regression this type exists for: a line drawn on the last bin must
    /// peak there. Clipping the bounds made it peak at 1.
    #[test]
    fn a_tent_at_the_edge_still_peaks_at_its_centre() {
        let t = Shape::tent(63, 4);
        t.validate().unwrap();
        assert_eq!(t.bins(), 60..=63);
        let levels: Vec<u8> = (60..=63).map(|i| t.level(i)).collect();
        assert_eq!(levels, vec![1, 2, 3, 4]);

        let t = Shape::tent(0, 4);
        assert_eq!(t.bins(), 0..=3);
        assert_eq!((0..=3).map(|i| t.level(i)).collect::<Vec<_>>(), vec![4, 3, 2, 1]);
    }

    /// The single-exp form has to BE the scoring rule, not resemble it. The
    /// reference recomputes 64 exponentials per evaluation; this computes one.
    /// Same cost, to rounding.
    #[test]
    fn it_agrees_with_the_n_outcome_reference() {
        let b = 2_000 * WAD;
        let (mut w, mut sum) = fresh();
        let mut q = [0i128; BINS];

        let trades = [
            (Shape::band(20, 24), 150 * WAD),
            (Shape::tent(31, 4), 80 * WAD),
            (Shape::tent(33, 8), 25 * WAD),
            (Shape::band(0, 5), 300 * WAD),
            (Shape::tent(31, 4), -40 * WAD),
        ];
        for (shape, delta) in trades {
            let mut d = [0i128; BINS];
            for i in 0..BINS {
                d[i] = delta * shape.level(i) as i128;
            }
            let reference = cost_delta_n(&q, b, &d).unwrap();
            let fast = apply_trade(&mut w, &mut sum, b, shape, delta).unwrap();
            assert!(
                close(reference, fast, EPS.max(reference.abs() / 1_000_000_000_000)),
                "shape {shape:?} delta {delta}: reference {reference} fast {fast}"
            );
            for i in 0..BINS {
                q[i] += d[i];
            }
        }
    }

    #[test]
    fn the_sum_is_exactly_the_sum_of_the_weights() {
        let b = 500 * WAD;
        let (mut w, mut sum) = fresh();
        for k in 0..200u32 {
            let c = (k * 7 % 60 + 2) as u8;
            let h = (k % 8 + 1) as u8;
            let delta = ((k % 9) as i128 + 1) * WAD;
            let _ = apply_trade(&mut w, &mut sum, b, Shape::tent(c, h), delta);
            assert_eq!(sum, w.iter().sum::<i128>(), "drifted at trade {k}");
        }
    }

    #[test]
    fn the_order_of_trades_does_not_change_what_they_cost() {
        let b = 1_000 * WAD;
        let a = (Shape::tent(28, 4), 60 * WAD);
        let c = (Shape::band(25, 35), 90 * WAD);
        let d = (Shape::tent(40, 6), 30 * WAD);

        let run = |order: [(Shape, i128); 3]| {
            let (mut w, mut sum) = fresh();
            let total: i128 = order
                .iter()
                .map(|(s, dl)| apply_trade(&mut w, &mut sum, b, *s, *dl).unwrap())
                .sum();
            (total, sum)
        };
        let (t1, s1) = run([a, c, d]);
        let (t2, s2) = run([d, a, c]);
        let (t3, s3) = run([c, d, a]);
        assert!(close(t1, t2, EPS) && close(t2, t3, EPS), "{t1} {t2} {t3}");
        assert!(close(s1, s2, EPS) && close(s2, s3, EPS));
    }

    /// Buy then sell the same thing: the trader must never come out ahead.
    /// Rounding may cost them dust; it must not pay them any.
    #[test]
    fn a_round_trip_never_pays() {
        let b = 800 * WAD;
        for (shape, delta) in [
            (Shape::tent(30, 4), 100 * WAD),
            (Shape::band(10, 50), 400 * WAD),
            (Shape::tent(5, 8), 7 * WAD),
            (Shape::band(31, 31), WAD / 1000),
        ] {
            let (mut w, mut sum) = fresh();
            // someone else trades first, so this is not the symmetric start
            apply_trade(&mut w, &mut sum, b, Shape::band(20, 40), 50 * WAD).unwrap();
            let paid = apply_trade(&mut w, &mut sum, b, shape, delta).unwrap();
            let back = apply_trade(&mut w, &mut sum, b, shape, -delta).unwrap();
            assert!(paid > 0 && back < 0);
            assert!(paid + back >= -EPS, "round trip paid {}: {shape:?}", -(paid + back));
        }
    }

    #[test]
    fn prices_stay_a_distribution_and_the_quote_matches_small_trades() {
        let b = 1_000 * WAD;
        let (mut w, mut sum) = fresh();
        apply_trade(&mut w, &mut sum, b, Shape::tent(30, 4), 120 * WAD).unwrap();
        apply_trade(&mut w, &mut sum, b, Shape::band(40, 50), 60 * WAD).unwrap();

        let total: i128 = (0..BINS).map(|i| price(&w, sum, i).unwrap()).sum();
        assert!(close(total, WAD, 64), "prices summed to {total}");

        // A tiny trade costs its marginal quote.
        let shape = Shape::tent(30, 4);
        let q = quote(&w, sum, shape).unwrap();
        let tiny = WAD / 1_000;
        let cost = apply_trade(&mut w, &mut sum, b, shape, tiny).unwrap();
        let per_share = wad_div(cost, tiny).unwrap();
        assert!(close(per_share, q, WAD / 100_000), "quote {q} vs realised {per_share}");
    }

    #[test]
    fn closer_pays_more_per_unit_staked() {
        // Two tents, same height and stake, one centred on the outcome and one
        // two bins off. The nearer one sits on a higher level at settlement.
        let settled = 30usize;
        let near = Shape::tent(30, 4);
        let off = Shape::tent(32, 4);
        assert_eq!(near.level(settled), 4);
        assert_eq!(off.level(settled), 2);
        assert_eq!(Shape::tent(34, 4).level(settled), 0, "a miss pays nothing");
    }

    #[test]
    fn what_cannot_be_priced_exactly_is_refused() {
        let (mut w, mut sum) = fresh();
        let b = 100 * WAD;
        // over the per-trade exponent
        assert!(apply_trade(&mut w, &mut sum, b, Shape::tent(30, 8), 300 * WAD).is_err());
        // malformed shapes
        assert!(apply_trade(&mut w, &mut sum, b, Shape { lo: 5, hi: 4, h: 1 }, WAD).is_err());
        assert!(apply_trade(&mut w, &mut sum, b, Shape { lo: 0, hi: 80, h: 1 }, WAD).is_err());
        assert!(apply_trade(&mut w, &mut sum, b, Shape { lo: 70, hi: 75, h: 1 }, WAD).is_err());
        assert!(apply_trade(&mut w, &mut sum, b, Shape { lo: 0, hi: 3, h: 9 }, WAD).is_err());
        // zero size, zero liquidity
        assert!(apply_trade(&mut w, &mut sum, b, Shape::band(1, 2), 0).is_err());
        assert!(apply_trade(&mut w, &mut sum, 0, Shape::band(1, 2), WAD).is_err());

        // pushing one bin to the weight cap stops with an error, not a wrong number
        let (mut w, mut sum) = fresh();
        let mut hit_cap = false;
        for _ in 0..4 {
            if apply_trade(&mut w, &mut sum, b, Shape::band(7, 7), 1_000 * WAD).is_err() {
                hit_cap = true;
                break;
            }
        }
        assert!(hit_cap, "the weight cap never engaged");
        assert!(w[7] <= W_MAX);
        assert_eq!(sum, w.iter().sum::<i128>());
    }

    #[test]
    fn a_trade_that_fails_changes_nothing() {
        let b = 100 * WAD;
        let (mut w, mut sum) = fresh();
        // Load the LAST bin of a wide band close to the cap, so the band fails
        // only after its earlier bins have been computed.
        for _ in 0..2 {
            apply_trade(&mut w, &mut sum, b, Shape::band(20, 20), 1_000 * WAD).unwrap();
        }
        let (w0, s0) = (w, sum);
        assert!(apply_trade(&mut w, &mut sum, b, Shape::band(10, 20), 200 * WAD).is_err());
        assert_eq!(w, w0, "a failed trade rewrote weights");
        assert_eq!(sum, s0);
    }

    #[test]
    fn the_opening_price_starts_bin_32_and_a_hair_below_is_bin_31() {
        let p0 = 22_019_000; // $220.19 at exponent −5
        assert_eq!(bin_for(p0, p0, 100).unwrap(), 32);
        assert_eq!(bin_for(p0 - 1, p0, 100).unwrap(), 31, "floor, not truncate");
        assert_eq!(bin_for(p0 + 1, p0, 100).unwrap(), 32);
    }

    #[test]
    fn bins_are_equal_steps_in_log_price() {
        let p0 = 100_000_000i64;
        // e^0.01 = 1.010050…, e^0.02 = 1.020201…, e^-0.01 = 0.990049…
        assert_eq!(bin_for(101_004_000, p0, 100).unwrap(), 32, "just under one step up");
        assert_eq!(bin_for(101_006_000, p0, 100).unwrap(), 33, "just over one step up");
        assert_eq!(bin_for(102_021_000, p0, 100).unwrap(), 34);
        assert_eq!(bin_for(99_006_000, p0, 100).unwrap(), 31, "just inside one step down");
        assert_eq!(bin_for(99_004_000, p0, 100).unwrap(), 30, "just past one step down");
        // the same move is more bins on a finer grid
        assert_eq!(bin_for(102_021_000, p0, 25).unwrap(), 40);
    }

    #[test]
    fn every_price_lands_somewhere_and_the_tails_are_open() {
        let p0 = 22_019_000i64;
        assert_eq!(bin_for(1, p0, 100).unwrap(), 0);
        assert_eq!(bin_for(i64::MAX, p0, 100).unwrap(), 63);
        assert_eq!(bin_for(p0 * 3, p0, 100).unwrap(), 63, "+200% on a 1% grid is the top tail");
        assert_eq!(bin_for(p0 / 3, p0, 100).unwrap(), 0);
        // …and the reason tiers exist: on an 8% grid a +60% move is an interior bin.
        let b = bin_for(p0 / 10 * 16, p0, 800).unwrap();
        assert!(b > 32 && b < 63, "bin {b}");
        assert!(bin_for(0, p0, 100).is_err());
        assert!(bin_for(p0, 0, 100).is_err());
    }

    #[test]
    fn the_price_scale_never_matters() {
        // Same +2.5% move at three exponents.
        for p0 in [12_340i64, 22_019_000, 9_876_543_210_000] {
            let up = p0 + p0 / 40;
            assert_eq!(bin_for(up, p0, 100).unwrap(), 34, "p0 {p0}");
        }
    }

    // ── tranches ─────────────────────────────────────────────────────────────

    #[test]
    fn at_a_fresh_market_a_deposit_buys_b_over_ln_64() {
        let (w, sum) = fresh();
        let b = liquidity_for_deposit(&w, sum, 5_000 * WAD).unwrap();
        let worst = wad_mul(b, LN2_WAD_X6).unwrap();
        assert!(worst <= 5_000 * WAD && worst > 4_999 * WAD, "worst case {worst}");
    }
    const LN2_WAD_X6: i128 = 693_147_180_559_945_309 * 6;

    #[test]
    fn joining_after_a_bin_became_a_long_shot_buys_less_depth() {
        let (mut w, mut sum) = fresh();
        let early = liquidity_for_deposit(&w, sum, 1_000 * WAD).unwrap();
        apply_trade(&mut w, &mut sum, 500 * WAD, Shape::band(30, 34), 1_500 * WAD).unwrap();
        let late = liquidity_for_deposit(&w, sum, 1_000 * WAD).unwrap();
        assert!(late < early, "early {early} late {late}");
        // and whatever it buys, its worst case is still inside the deposit
        let w_min = *w.iter().min().unwrap();
        let worst = wad_mul(late, neg_ln_price(w_min, sum).unwrap()).unwrap();
        assert!(worst <= 1_000 * WAD);
    }

    /// The identity the whole design rests on. Two tranches, one joining
    /// mid-market; trades priced at B = b₁ + b₂. For EVERY possible outcome,
    /// the tranches' P&L must add up to what the pool actually made —
    /// everything traders paid in, minus what that outcome pays out.
    #[test]
    fn tranche_pnl_adds_up_to_the_pools_pnl_for_every_outcome() {
        let (mut w, mut sum) = fresh();
        let b1 = liquidity_for_deposit(&w, sum, 5_000 * WAD).unwrap();
        let (w1, s1) = (w, sum);
        let mut paid = 0i128;
        let mut owed = [0i128; BINS];
        fn go(w: &mut [i128; BINS], sum: &mut i128, owed: &mut [i128; BINS], b: i128, sh: Shape, d: i128) -> i128 {
            let c = apply_trade(w, sum, b, sh, d).unwrap();
            for i in sh.bins() { owed[i] += d * sh.level(i) as i128; }
            c
        }
        paid += go(&mut w, &mut sum, &mut owed, b1, Shape::tent(30, 4), 200 * WAD);
        paid += go(&mut w, &mut sum, &mut owed, b1, Shape::band(20, 40), 300 * WAD);

        let b2 = liquidity_for_deposit(&w, sum, 2_500 * WAD).unwrap();
        let (w2, s2) = (w, sum);
        let paid_before_2 = paid;
        let owed_before_2 = owed;
        let big_b = b1 + b2;
        paid += go(&mut w, &mut sum, &mut owed, big_b, Shape::tent(33, 4), 150 * WAD);
        paid += go(&mut w, &mut sum, &mut owed, big_b, Shape::tent(30, 4), -80 * WAD);
        paid += go(&mut w, &mut sum, &mut owed, big_b, Shape::band(45, 50), 400 * WAD);

        for k in 0..BINS {
            let pool = paid - owed[k];
            let t1 = tranche_pnl(b1, w1[k], s1, w[k], sum).unwrap();
            let t2 = tranche_pnl(b2, w2[k], s2, w[k], sum).unwrap();
            assert!(close(t1 + t2, pool, WAD / 1_000_000), "bin {k}: tranches {} pool {pool}", t1 + t2);
            // the late tranche is only exposed to what happened after it joined
            let after = (paid - paid_before_2) - (owed[k] - owed_before_2[k]);
            let share = wad_mul(after, wad_div(b2, big_b).unwrap()).unwrap();
            assert!(close(t2, share, WAD / 1_000_000), "bin {k}: late {t2} vs its share {share}");
        }
    }

    #[test]
    fn no_tranche_can_lose_more_than_its_deposit() {
        let (mut w, mut sum) = fresh();
        let b0 = liquidity_for_deposit(&w, sum, 1_000 * WAD).unwrap();
        apply_trade(&mut w, &mut sum, b0, Shape::band(10, 12), 300 * WAD).unwrap();
        let deposit = 700 * WAD;
        let b = liquidity_for_deposit(&w, sum, deposit).unwrap();
        let (wj, sj) = (w, sum);
        // drive the CHEAPEST bin at join to near certainty — the worst case
        let k = (0..BINS).min_by_key(|&i| wj[i]).unwrap();
        for _ in 0..6 {
            let _ = apply_trade(&mut w, &mut sum, b0 + b, Shape::band(k as u8, k as u8), 3_000 * WAD);
        }
        let pnl = tranche_pnl(b, wj[k], sj, w[k], sum).unwrap();
        assert!(pnl < 0);
        assert!(-pnl <= deposit, "lost {} of a {deposit} deposit", -pnl);
    }

    #[test]
    fn a_one_in_a_billion_bin_keeps_its_precision() {
        let sum = 64 * W_MAX;
        // ln(6.4e10) = ln 6.4 + 10·ln 10 = 1.8562980 + 23.0258509 = 24.8821489…
        let l = neg_ln_price(WAD, sum).unwrap();
        assert!(close(l, 24_882_148_920_306_083_000, 1_000_000_000), "{l}");
    }

    #[test]
    fn the_largest_possible_sum_is_inside_the_exact_division_range() {
        let worst = W_MAX as u128 * BINS as u128;
        assert!(worst <= crate::math::wad::MAX_WAD_DIVISOR);
    }
}
