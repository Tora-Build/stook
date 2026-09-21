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

/// A freshly opened ladder: every bin equally likely.
pub fn fresh() -> ([i128; BINS], i128) {
    ([WAD; BINS], WAD * BINS as i128)
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::math::lmsr_n::cost_delta_n;

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
    fn the_largest_possible_sum_is_inside_the_exact_division_range() {
        let worst = W_MAX as u128 * BINS as u128;
        assert!(worst <= crate::math::wad::MAX_WAD_DIVISOR);
    }
}
