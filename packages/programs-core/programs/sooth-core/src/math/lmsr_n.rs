//! LMSR over N outcomes.
//!
//! Stook asks "where will this land", not "will this happen". The answer is a
//! price band, so the market has as many outcomes as it has bands and the
//! binary cost function in `lmsr.rs` is a special case of what is here.
//!
//! The maths is the same scoring rule:
//!
//! ```text
//!   C(q) = b · ln( Σ exp(qᵢ/b) )
//!   pᵢ   = exp(qᵢ/b) / Σ exp(qⱼ/b)
//! ```
//!
//! with `Σ pᵢ = 1` by construction. That identity is what makes the band
//! prices a probability distribution a front end can draw directly, and it is
//! why one shared `b` funds the whole grid rather than one subsidy per band —
//! a strip of independent binary markets would fragment the same liquidity
//! into N thin pools and let its prices sum to anything at all.
//!
//! Everything is WAD (1e18) scaled and every intermediate is checked.

use super::lmsr::{exp_wad, ln_wad};
use super::wad::{wad_div, wad_mul, MathError};

/// Cap on outcomes.
///
/// Bounded because the state carrying `q` is a fixed-length account and every
/// instruction that loads it pays for the largest case. 64 puts a 1% band on a
/// ±30% move, finer than anyone draws a line by hand.
pub const MAX_OUTCOMES: usize = 64;

/// `C(q) = b · ln( Σ exp(qᵢ/b) )`, log-sum-exp shifted.
///
/// The shift is not an optimisation. `exp(qᵢ/b)` overflows WAD well before
/// `qᵢ/b` reaches interesting sizes, so subtracting the maximum before
/// exponentiating is what keeps a large-but-legitimate position from failing
/// arithmetic instead of failing a balance check.
pub fn lmsr_cost_n(q: &[i128], b: i128) -> Result<i128, MathError> {
    if q.is_empty() || q.len() > MAX_OUTCOMES {
        return Err(MathError::Overflow);
    }
    if b <= 0 {
        return Err(MathError::Overflow);
    }

    let mut scaled = [0i128; MAX_OUTCOMES];
    let mut m = i128::MIN;
    for (i, &qi) in q.iter().enumerate() {
        let s = wad_div(qi, b)?;
        scaled[i] = s;
        if s > m {
            m = s;
        }
    }

    let mut sum = 0i128;
    for &s in scaled.iter().take(q.len()) {
        let e = exp_wad(s - m)?;
        sum = sum.checked_add(e).ok_or(MathError::Overflow)?;
    }

    let ln_sum = ln_wad(sum)?;
    let inner = m.checked_add(ln_sum).ok_or(MathError::Overflow)?;
    wad_mul(b, inner)
}

/// Signed cost of moving the market from `q` to `q + d`.
///
/// Positive = the trader pays. Negative = sell proceeds. Identical in shape to
/// the binary `cost_delta`, and identical in meaning: the scoring rule's cost
/// difference IS the price, so nothing else needs to agree with it.
pub fn cost_delta_n(q: &[i128], b: i128, d: &[i128]) -> Result<i128, MathError> {
    if q.len() != d.len() {
        return Err(MathError::Overflow);
    }
    let before = lmsr_cost_n(q, b)?;

    let mut after_q = [0i128; MAX_OUTCOMES];
    for i in 0..q.len() {
        after_q[i] = q[i].checked_add(d[i]).ok_or(MathError::Overflow)?;
    }
    let after = lmsr_cost_n(&after_q[..q.len()], b)?;
    after.checked_sub(before).ok_or(MathError::Overflow)
}

/// Marginal prices, WAD-scaled, summing to WAD.
///
/// This is what a front end draws as the fan: each band's height is the
/// crowd's probability that the answer lands there.
pub fn prices_n(q: &[i128], b: i128, out: &mut [i128]) -> Result<(), MathError> {
    if q.is_empty() || q.len() > MAX_OUTCOMES || out.len() != q.len() || b <= 0 {
        return Err(MathError::Overflow);
    }

    let mut e = [0i128; MAX_OUTCOMES];
    let mut m = i128::MIN;
    let mut scaled = [0i128; MAX_OUTCOMES];
    for (i, &qi) in q.iter().enumerate() {
        let s = wad_div(qi, b)?;
        scaled[i] = s;
        if s > m {
            m = s;
        }
    }
    let mut sum = 0i128;
    for i in 0..q.len() {
        e[i] = exp_wad(scaled[i] - m)?;
        sum = sum.checked_add(e[i]).ok_or(MathError::Overflow)?;
    }
    if sum <= 0 {
        return Err(MathError::Overflow);
    }

    // Divide, then hand the rounding residue to the largest band. Without this
    // the prices sum to slightly under 1 and a front end drawing them as a
    // distribution shows a gap that is an artefact, not a belief.
    let mut total = 0i128;
    let mut largest = 0usize;
    for i in 0..q.len() {
        out[i] = wad_div(e[i], sum)?;
        total = total.checked_add(out[i]).ok_or(MathError::Overflow)?;
        if e[i] > e[largest] {
            largest = i;
        }
    }
    let residue = super::wad::WAD - total;
    out[largest] = out[largest]
        .checked_add(residue)
        .ok_or(MathError::Overflow)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::math::lmsr::{cost_delta, lmsr_cost};
    use crate::math::wad::WAD;

    fn close(a: i128, b: i128, eps: i128) -> bool {
        (a - b).abs() <= eps
    }

    /// The generalisation has to BE the binary rule, not merely resemble it.
    /// If these ever diverge, one of the two is wrong and the binary one has
    /// years of trades behind it.
    #[test]
    fn two_outcomes_agree_with_the_binary_cost_function() {
        let b = 5_000 * WAD;
        for (qy, qn) in [
            (0i128, 0i128),
            (WAD, 0),
            (0, WAD),
            (100 * WAD, 37 * WAD),
            (-40 * WAD, 9 * WAD),
        ] {
            let binary = lmsr_cost(qy, qn, b).unwrap();
            let general = lmsr_cost_n(&[qy, qn], b).unwrap();
            assert!(
                close(binary, general, 1_000_000),
                "q=({qy},{qn}) binary={binary} general={general}"
            );
        }
    }

    #[test]
    fn two_outcome_deltas_agree_with_the_binary_delta() {
        let b = 5_000 * WAD;
        let (qy, qn) = (12 * WAD, 8 * WAD);
        let binary = cost_delta(qy, qn, b, 3 * WAD, 0).unwrap();
        let general = cost_delta_n(&[qy, qn], b, &[3 * WAD, 0]).unwrap();
        assert!(close(binary, general, 1_000_000), "{binary} vs {general}");
    }

    #[test]
    fn prices_sum_to_one() {
        let b = 2_000 * WAD;
        for q in [
            vec![0i128; 8],
            vec![WAD, 2 * WAD, 0, -WAD, 5 * WAD, 0, 0, 0],
            vec![100 * WAD, 0, 0, 0],
            (0..64).map(|i| (i as i128) * WAD / 3).collect::<Vec<_>>(),
        ] {
            let mut out = vec![0i128; q.len()];
            prices_n(&q, b, &mut out).unwrap();
            let total: i128 = out.iter().sum();
            assert_eq!(total, WAD, "n={} summed to {total}", q.len());
            assert!(out.iter().all(|&p| p >= 0), "a band priced below zero");
        }
    }

    #[test]
    fn an_even_market_prices_every_band_the_same() {
        let b = 1_000 * WAD;
        let q = vec![0i128; 4];
        let mut out = vec![0i128; 4];
        prices_n(&q, b, &mut out).unwrap();
        for p in &out {
            assert!(close(*p, WAD / 4, 4), "expected 0.25, got {p}");
        }
    }

    #[test]
    fn buying_a_band_raises_its_price_and_lowers_the_others() {
        let b = 1_000 * WAD;
        let q = vec![0i128; 5];
        let mut before = vec![0i128; 5];
        prices_n(&q, b, &mut before).unwrap();

        let mut q2 = q.clone();
        q2[2] += 200 * WAD;
        let mut after = vec![0i128; 5];
        prices_n(&q2, b, &mut after).unwrap();

        assert!(after[2] > before[2], "the bought band did not get dearer");
        for i in [0usize, 1, 3, 4] {
            assert!(after[i] < before[i], "band {i} did not get cheaper");
        }
    }

    #[test]
    fn buying_costs_money_and_selling_it_back_returns_less() {
        let b = 1_000 * WAD;
        let q = vec![0i128; 6];
        let mut d = vec![0i128; 6];
        d[1] = 10 * WAD;

        let paid = cost_delta_n(&q, b, &d).unwrap();
        assert!(paid > 0, "buying should cost");

        // Sell it straight back from the new state.
        let q2: Vec<i128> = q.iter().zip(&d).map(|(a, b)| a + b).collect();
        let neg: Vec<i128> = d.iter().map(|x| -x).collect();
        let refund = cost_delta_n(&q2, b, &neg).unwrap();
        assert!(refund < 0, "selling should pay out");
        assert!(
            paid + refund >= -1_000_000,
            "a round trip must not mint value: paid={paid} refund={refund}"
        );
    }

    /// The bound that keeps the vault solvent: an LMSR's worst-case loss to
    /// traders is `b · ln(N)`, so the subsidy funds the grid no matter which
    /// band wins. A grid that could pay out more than its subsidy covers is a
    /// grid whose LPs are underwater by construction.
    #[test]
    fn the_worst_case_loss_stays_within_b_ln_n() {
        let b = 1_000 * WAD;
        for n in [2usize, 4, 8, 64] {
            let q = vec![0i128; n];
            let start = lmsr_cost_n(&q, b).unwrap();

            // Drive one band far up: the limit of C is b·(q_max/b) = q_max.
            let mut q2 = vec![0i128; n];
            q2[0] = 10_000 * WAD;
            let end = lmsr_cost_n(&q2, b).unwrap();

            // Payout to the winner is q_max; the AMM took (end - start).
            let subsidy_used = q2[0] - (end - start);
            let bound = wad_mul(b, ln_wad(WAD * n as i128).unwrap()).unwrap();
            assert!(
                subsidy_used <= bound + 1_000_000,
                "n={n} used {subsidy_used} against bound {bound}"
            );
        }
    }

    #[test]
    fn a_degenerate_market_is_refused_rather_than_mispriced() {
        assert!(lmsr_cost_n(&[], 1_000 * WAD).is_err());
        assert!(lmsr_cost_n(&[0, 0], 0).is_err());
        assert!(lmsr_cost_n(&[0, 0], -1).is_err());
        assert!(cost_delta_n(&[0, 0], WAD, &[0]).is_err());
    }
}
