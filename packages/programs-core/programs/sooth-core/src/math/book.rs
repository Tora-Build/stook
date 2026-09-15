//! Book math — the WAD↔base-unit conversion the AMM's settlement paths share.

use anchor_lang::prelude::*;

use crate::error::SoothCoreError;

/// One USDC base unit (6 decimals) expressed in WAD (1e18).
pub const BASE_UNIT_WAD: u128 = 1_000_000_000_000;

/// Truncate a WAD quantity to whole USDC base units. Floors, so a conversion
/// never hands out a unit the WAD amount did not cover.
pub fn wad_to_base(wad: u128) -> Result<u64> {
    wad_to_base_dec(wad, 6)
}

/// `wad_to_base` for a mint of arbitrary decimals.
///
/// AMM settlement paths pass `market.amm_decimals`; the book keeps the
/// 6-decimal wrapper, because `BOOK_TOKEN_MINT` is USDC by construction and
/// nothing about Fan's per-market mint changes that.
pub fn wad_to_base_dec(wad: u128, decimals: u8) -> Result<u64> {
    (wad / crate::math::wad::scalar_for(decimals))
        .try_into()
        .map_err(|_| error!(SoothCoreError::MathOverflow))
}
