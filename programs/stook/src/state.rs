//! Account layouts.
//!
//! Two accounts carry the whole protocol: a `Market` holding the pot and the
//! crowd's distribution, and a `Prediction` per participant. There is no LP
//! position, no AMM state and no order book, because there is no curve and no
//! resting liquidity — see `docs/architecture.md`.

use anchor_lang::prelude::*;

/// How many price bands a market is divided into.
///
/// Fixed rather than configurable: it sets the account's length, and a
/// per-market length means every instruction that loads a market pays for the
/// largest one. 64 puts a 1% band on a ±30% move, which is finer than anyone
/// draws a line by hand.
///
/// The outer two are unbounded — bucket 0 is `< lo` and bucket 63 is `>= hi` —
/// so a settled price is always in range and the band chosen at creation
/// affects granularity, never whether the market can resolve.
pub const BUCKET_COUNT: usize = 64;

#[account]
pub struct Market {
    /// What is being predicted. Identifies the oracle feed, and is not
    /// necessarily a mint — an index has no token.
    pub asset: Pubkey,

    /// What is staked. The vault's mint.
    pub quote_mint: Pubkey,

    /// Holds the pot. A PDA-owned token account, not an ATA: the market
    /// authority may hold several markets in the same quote mint, and an ATA
    /// is one account per (authority, mint) pair, which would merge their pots.
    pub vault: Pubkey,

    /// Authorised to settle this market. Fan's adjudicator layer is absent by
    /// design — the question is always "what was this number", so resolution
    /// is an oracle read, and this key only chooses *which* feed answers it.
    pub settler: Pubkey,

    /// The price band, in the oracle's own fixed-point scale.
    pub lo: i64,
    pub hi: i64,

    /// Staked per band. The crowd's distribution, live, and the only thing a
    /// front end needs to draw the fan.
    pub bucket_stake: [u64; BUCKET_COUNT],

    /// Total staked. Always equals the sum of `bucket_stake`; kept so the
    /// invariant can be asserted rather than assumed.
    pub pot: u64,

    /// The protocol's cut, taken once at settlement and never from a refund.
    pub rake_bps: u16,

    pub opens_at: i64,
    pub closes_at: i64,
    pub settles_at: i64,

    pub status: MarketStatus,

    /// Written exactly once, at settlement.
    pub settled_bucket: u8,

    /// `bucket_stake[settled_bucket]` at settlement, cached so a claim is O(1)
    /// and cannot be changed by anything that happens after.
    pub winning_stake: u64,

    pub bump: u8,
    pub vault_bump: u8,

    /// Forward-compat padding. Adding a field consumes bytes from here instead
    /// of changing the account's length: Solana accounts are fixed-length, and
    /// a struct that outgrows its buffer stops deserializing on every path
    /// that loads it. Shrink this by exactly the new field's size and leave
    /// `SPACE` alone.
    pub _reserved: [u8; 64],
}

impl Market {
    pub const SPACE: usize = 8            // discriminator
        + 32 * 4                          // asset, quote_mint, vault, settler
        + 8 * 2                           // lo, hi
        + 8 * BUCKET_COUNT                // bucket_stake
        + 8                               // pot
        + 2                               // rake_bps
        + 8 * 3                           // opens_at, closes_at, settles_at
        + 1                               // status
        + 1                               // settled_bucket
        + 8                               // winning_stake
        + 1 + 1                           // bump, vault_bump
        + 64; // _reserved

    /// Predictions are accepted in `[opens_at, closes_at)`.
    pub fn accepting(&self, now: i64) -> bool {
        matches!(self.status, MarketStatus::Open) && now >= self.opens_at && now < self.closes_at
    }

    /// The band a price falls in.
    ///
    /// The outer bands are open-ended, so every finite price maps somewhere and
    /// settlement cannot fail for being off the scale.
    pub fn bucket_of(&self, price: i64) -> u8 {
        if price < self.lo {
            return 0;
        }
        if price >= self.hi {
            return (BUCKET_COUNT - 1) as u8;
        }
        // Interior bands split [lo, hi) evenly across the inner slots.
        let span = (self.hi - self.lo) as i128;
        let inner = (BUCKET_COUNT - 2) as i128;
        let offset = (price - self.lo) as i128;
        let idx = 1 + (offset * inner / span);
        idx as u8
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum MarketStatus {
    /// Accepting predictions.
    Open,
    /// Past `closes_at`, waiting for settlement. No new stake, no payouts.
    Closed,
    /// Settled. Winners may claim.
    Settled,
    /// Voided — a stale oracle, or nobody predicted the settled band. Every
    /// stake is refundable in full and the rake is not taken.
    Void,
}

#[account]
pub struct Prediction {
    pub market: Pubkey,
    pub owner: Pubkey,

    /// The band committed to.
    pub bucket: u8,

    /// Quote-token base units staked.
    ///
    /// Staking again adds to this rather than opening a second account, so one
    /// participant holds one account per market. Moving bands is a separate
    /// instruction: silently relocating someone's existing money because they
    /// topped up is a surprise, and surprises in a payout path are bugs.
    pub stake: u64,

    /// Guards the payout path against being walked twice.
    pub claimed: bool,

    pub bump: u8,

    pub _reserved: [u8; 32],
}

impl Prediction {
    pub const SPACE: usize = 8 + 32 * 2 + 1 + 8 + 1 + 1 + 32;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn market(lo: i64, hi: i64) -> Market {
        Market {
            asset: Pubkey::new_unique(),
            quote_mint: Pubkey::new_unique(),
            vault: Pubkey::new_unique(),
            settler: Pubkey::new_unique(),
            lo,
            hi,
            bucket_stake: [0; BUCKET_COUNT],
            pot: 0,
            rake_bps: 200,
            opens_at: 0,
            closes_at: 100,
            settles_at: 100,
            status: MarketStatus::Open,
            settled_bucket: 0,
            winning_stake: 0,
            bump: 255,
            vault_bump: 254,
            _reserved: [0; 64],
        }
    }

    #[test]
    fn every_price_lands_in_a_band() {
        let m = market(100, 200);
        for price in [i64::MIN, -1, 0, 99, 100, 150, 199, 200, 10_000, i64::MAX] {
            let b = m.bucket_of(price);
            assert!((b as usize) < BUCKET_COUNT, "price {price} fell off the scale");
        }
    }

    #[test]
    fn the_outer_bands_are_open_ended() {
        let m = market(100, 200);
        assert_eq!(m.bucket_of(i64::MIN), 0);
        assert_eq!(m.bucket_of(99), 0);
        assert_eq!(m.bucket_of(200), (BUCKET_COUNT - 1) as u8);
        assert_eq!(m.bucket_of(i64::MAX), (BUCKET_COUNT - 1) as u8);
    }

    #[test]
    fn interior_bands_are_ordered_and_cover_the_range() {
        let m = market(100, 200);
        let mut last = m.bucket_of(100);
        assert_eq!(last, 1, "the first interior price belongs to band 1");
        for price in 101..200 {
            let b = m.bucket_of(price);
            assert!(b >= last, "bands must not go backwards at {price}");
            last = b;
        }
        assert_eq!(last, (BUCKET_COUNT - 2) as u8, "the last interior price belongs to the last interior band");
    }

    #[test]
    fn a_market_accepts_predictions_only_in_its_window() {
        let m = market(100, 200);
        assert!(!m.accepting(-1));
        assert!(m.accepting(0));
        assert!(m.accepting(99));
        assert!(!m.accepting(100), "closes_at is exclusive");
        assert!(!m.accepting(101));
    }
}
