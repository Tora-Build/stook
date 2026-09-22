//! Fixed-point maths for `sooth_core`. Everything is WAD (1e18) i128.
//!
//! - `wad`    — multiply, divide, base-unit conversion.
//! - `lmsr`   — `exp_wad`, `ln_wad`, and the two-outcome scoring rule.
//! - `lmsr_n` — the same rule over N outcomes; the ladder's reference
//!              implementation, kept for the test that pins them equal.
//! - `ladder` — the 64-bin ladder as the program runs it: a shaped trade
//!              (band or tent) costs one exp and one ln.

pub mod ladder;
pub mod lmsr;
pub mod lmsr_n;
pub mod wad;

pub use wad::{
    scalar_for, wad_div, wad_mul, wad_to_amount_ceil, wad_to_amount_floor, MathError, LN2_WAD,
    WAD, WAD_U,
};
