//! Math utilities for `sooth_core`.
//!
//! - `book`  — WAD↔base-unit conversion shared by the AMM settlement paths.
//! - `lmsr`  — the binary LMSR cost function (exp_wad, ln_wad, cost_delta).
//! - `lmsr_n` — the same scoring rule over N price bands, which is what a
//!             "where will it land" market actually needs. The binary form is
//!             its two-outcome case, and a test pins that they agree.
//! - `wad`   — WAD (1e18) fixed-point primitives.

pub mod book;
pub mod lmsr;
pub mod lmsr_n;
pub mod wad;

pub use book::{wad_to_base, wad_to_base_dec, BASE_UNIT_WAD};
pub use lmsr::{cost_delta, lmsr_cost};
pub use lmsr_n::{cost_delta_n, lmsr_cost_n, prices_n, MAX_OUTCOMES};
pub use wad::{
    wad_div, wad_mul, wad_to_usdc_ceil, wad_to_usdc_floor, MathError, LN2_WAD, WAD,
    scalar_for, wad_to_amount_ceil, wad_to_amount_floor, WAD_TO_USDC_SCALAR, WAD_U,
};
