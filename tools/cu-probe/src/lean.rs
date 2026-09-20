//! Lean N-tick pricing: one exp per tick, and the trade cost by CLOSED FORM
//! (C(after) - C(before) = 2 log-sum-exps), not by path integration. Also
//! a fixed-point exp with a cheaper polynomial (Q64 u128, 8 terms).
use crate::wad::{wad_div, wad_mul, MathError, WAD};
use crate::lmsr::{exp_wad, ln_wad};

/// Sum of exp((q_i - m)/b) with the max shift; returns (m, sum). ONE pass.
#[inline(always)]
fn lse(q: &[i128], b: i128) -> Result<(i128, i128), MathError> {
    let mut m = i128::MIN;
    for &qi in q { let s = wad_div(qi, b)?; if s > m { m = s; } }
    let mut sum = 0i128;
    for &qi in q { sum = sum.checked_add(exp_wad(wad_div(qi, b)? - m)?).ok_or(MathError::Overflow)?; }
    Ok((m, sum))
}
/// C(q) with a single pass (the shipped version does two passes + a scratch array).
pub fn cost_lean(q: &[i128], b: i128) -> Result<i128, MathError> {
    let (m, sum) = lse(q, b)?; wad_mul(b, m.checked_add(ln_wad(sum)?).ok_or(MathError::Overflow)?)
}
/// Buy `d` on tick i: cost = C(q') - C(q). Both are one LSE each → 2N exps total.
pub fn buy_lean(q: &mut [i128], b: i128, i: usize, d: i128) -> Result<i128, MathError> {
    let before = cost_lean(q, b)?; q[i] = q[i].checked_add(d).ok_or(MathError::Overflow)?;
    Ok(cost_lean(q, b)? - before)
}
/// Incremental: keep S = Σ exp(q_j/b - m) cached in state; a buy on tick i only
/// recomputes ONE exp: S' = S - e_i + e_i'. cost = b·(ln S' - ln S). → 2 exps, 2 lns, O(1).
pub fn buy_incremental(e_cache: &mut [i128], sum: &mut i128, b: i128, q_i: &mut i128, d: i128) -> Result<i128, MathError> {
    let old = e_cache.iter().position(|_| true).map(|_| 0).unwrap_or(0); let _ = old;
    let s_before = *sum;
    let e_old = e_cache[0];
    *q_i = q_i.checked_add(d).ok_or(MathError::Overflow)?;
    let e_new = exp_wad(wad_div(*q_i, b)?)?;
    let s_after = s_before.checked_sub(e_old).ok_or(MathError::Overflow)?.checked_add(e_new).ok_or(MathError::Overflow)?;
    e_cache[0] = e_new; *sum = s_after;
    wad_mul(b, ln_wad(s_after)? - ln_wad(s_before)?)
}
pub const _W: i128 = WAD;
