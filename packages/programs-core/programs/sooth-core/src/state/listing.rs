//! Listing a coin: anyone may give a coin its own daily rounds by locking
//! some of it as the seed of the coin's house (`instructions::listing`).
//!
//! The protocol keeps the list of anchors a listed coin may follow
//! (`ListAnchor`): feeds whose price is free to read on chain and that settle
//! rounds well, each with the clock its rounds close by. A listing takes:
//!
//! - an anchor from that list, and the coin (its mint passes `token_guard`);
//! - a seed between `LIST_MIN_BPS` and `LIST_MAX_BPS` of the coin's supply,
//!   deposited in the coin's new house and locked for `LIST_LOCK_SECS`;
//! - the listing fee (`ProtocolConfig::list_fee_lamports`) to the treasury.
//!
//! The coin's series is created paused and goes live `LIST_DELAY_SECS`
//! later (`coin_activate`, anyone), unless the protocol turns it down first
//! (`coin_reject`), which also frees the seed. In that day the keeper teaches
//! the series its past closes from chain history, so it opens warmed up.

use anchor_lang::prelude::*;

pub const LIST_ANCHOR_SEED: &[u8] = b"list_anchor";

/// The seed: at least 0.5% of the coin's supply, at most 5%. The floor makes
/// a listing mean something to whoever lists; the cap keeps the house no
/// deeper than its trading can carry on day one.
pub const LIST_MIN_BPS: u64 = 50;
pub const LIST_MAX_BPS: u64 = 500;

/// The seed stays in the house a week.
pub const LIST_LOCK_SECS: i64 = 7 * 24 * 60 * 60;

/// A listed coin's rounds start a day after the listing.
pub const LIST_DELAY_SECS: i64 = 24 * 60 * 60;

/// `House::opens_after` of a listing the protocol turned down.
pub const HOUSE_REJECTED: i64 = i64::MAX;

/// An anchor a listed coin may follow, and the clock its rounds close by
/// (as `Series::clock` and `Series::close_secs`, one round a day).
#[account]
#[derive(Debug)]
pub struct ListAnchor {
    pub feed_id: [u8; 32],
    pub clock: u8,
    pub close_secs: u32,
    pub active: bool,
    pub bump: u8,
    pub _reserved: [u8; 16],
}

impl ListAnchor {
    pub const SPACE: usize = 8 + 32 + 1 + 4 + 1 + 1 + 16;
}

/// The seed bounds for a coin with `supply` base units: `[min, max]`.
pub fn seed_bounds(supply: u64) -> (u64, u64) {
    let s = supply as u128;
    let min = (s * LIST_MIN_BPS as u128).div_ceil(10_000);
    let max = s * LIST_MAX_BPS as u128 / 10_000;
    (min as u64, max as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_seed_is_half_a_percent_to_five_percent_of_supply() {
        assert_eq!(seed_bounds(1_000_000_000), (5_000_000, 50_000_000));
        assert_eq!(seed_bounds(999), (5, 49), "the floor rounds up, the cap down");
        assert_eq!(seed_bounds(u64::MAX).1, (u64::MAX as u128 * 500 / 10_000) as u64, "no overflow at the largest supply");
        assert_eq!(seed_bounds(0), (0, 0));
    }
}
