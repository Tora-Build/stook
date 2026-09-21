//! A Stook market: one price ladder per (feed, settlement time, quote mint, tier).
//!
//! # Lifecycle
//!
//! ```text
//!   Seeding ──open──▶ Open ──(locks_at)──▶ locked ──settle──▶ Settled
//!      │                                                  └──▶ Void
//!      └── liquidity may only enter here
//! ```
//!
//! Liquidity enters during Seeding and at no other time. Every design in the
//! blind review that allowed deposits after open was sandwiched — an attacker
//! trades the price away from fair, lets the LP join at the distorted price,
//! and trades back; measured at +2,802 on a 2,500 deposit. Fixing `b` at open
//! removes the attack rather than pricing it.
//!
//! The grid is centred on the oracle price read *at open*, not at creation, so
//! a market that sits in Seeding for a day does not open with a stale centre
//! that the first trader harvests.

use anchor_lang::prelude::*;

use crate::math::ladder::BINS;

pub const LADDER_SEED: &[u8] = b"ladder";
pub const LADDER_AUTHORITY_SEED: &[u8] = b"ladder_auth";
pub const LADDER_VAULT_SEED: &[u8] = b"ladder_vault";
pub const LADDER_POSITION_SEED: &[u8] = b"ladder_pos";

/// Log-price step per bin, in basis points, by tier.
///
/// A preset table rather than a free parameter, and part of the market's PDA
/// seeds: the first creator of a (feed, time) slot must not be able to squat it
/// with a useless step. The tier is chosen for the asset's volatility — at 1% a
/// +60% move on a memecoin collapses into the top bin and the market resolves
/// to "above", which is a worse product than a coarser grid that still
/// distinguishes +45% from +75%.
///
/// 64 bins at tier 0 span ±8%; at tier 5, roughly ×0.08 to ×13.
pub const STEP_BPS: [u16; 6] = [25, 50, 100, 200, 400, 800];

pub const STATUS_SEEDING: u8 = 0;
pub const STATUS_OPEN: u8 = 1;
pub const STATUS_SETTLED: u8 = 2;
pub const STATUS_VOID: u8 = 3;

/// No bin has settled yet.
pub const NO_BIN: u8 = u8::MAX;

/// The market. Zero-copy because it is ~1.9 KB and every trade loads it: a
/// Borsh round trip of 64 i128s on each trade would cost more compute than the
/// trade's own arithmetic.
///
/// Field order is alignment order — 8-byte fields, then 4/2, then bytes — with
/// an explicit pad, because `Pod` forbids implicit padding. 128-bit values are
/// stored as `[u8; 16]`: `i128` is 16-byte aligned on the host and not reliably
/// so on SBF, so a native field could pass `cargo test` and mis-read on chain.
#[account(zero_copy)]
#[derive(Debug)]
pub struct Ladder {
    pub opens_at: i64,
    /// Trading stops here. Strictly before `settles_at`, so nobody trades
    /// against a price they can already see forming.
    pub locks_at: i64,
    pub settles_at: i64,

    /// Oracle price the grid is centred on, read at open. `p0 × 10^p0_expo`.
    pub p0: i64,

    /// Pool cash: seed plus net trade costs, EXCLUDING fees. This is what the
    /// solvency check compares against the payout table — counting fees would
    /// let fee income mask a shortfall in the pool that owes the payouts.
    pub cash: u64,
    /// Total seed deposited during Seeding.
    pub seed_total: u64,

    pub fees_lp: u64,
    pub fees_creator: u64,
    pub fees_protocol: u64,

    /// `payout[i]`: quote base units owed in total if bin `i` settles. Kept so
    /// solvency is a comparison, not a belief about the scoring rule.
    pub payout: [u64; BINS],

    pub p0_expo: i32,
    pub step_bps: u16,
    pub fee_bps: u16,

    /// The Pyth feed this market committed to. Settlement accepts no other.
    pub feed_id: [u8; 32],
    pub quote_mint: Pubkey,
    pub vault: Pubkey,
    pub creator: Pubkey,
    /// Who the market is presented as funded by. Defaults to the creator; a
    /// community sponsoring a market on its own asset sets it to itself. Purely
    /// attribution — it grants no authority.
    pub sponsor: Pubkey,

    /// LMSR liquidity, WAD, little-endian i128. Fixed at open.
    pub b: [u8; 16],
    /// Exact sum of `weights`, WAD, little-endian i128.
    pub sum: [u8; 16],
    /// `wᵢ = exp(qᵢ/b)`, WAD, little-endian i128 each.
    pub weights: [[u8; 16]; BINS],

    pub status: u8,
    pub settled_bin: u8,
    pub tier: u8,
    pub quote_decimals: u8,
    pub bump: u8,
    pub authority_bump: u8,
    pub vault_bump: u8,
    pub _pad: u8,

    pub _reserved: [u8; 64],
}

impl Ladder {
    pub const SPACE: usize = 8 + core::mem::size_of::<Ladder>();

    pub fn b_wad(&self) -> i128 {
        i128::from_le_bytes(self.b)
    }
    pub fn set_b_wad(&mut self, v: i128) {
        self.b = v.to_le_bytes();
    }

    /// Weights and their sum, decoded for `math::ladder`.
    pub fn load_curve(&self) -> ([i128; BINS], i128) {
        let mut w = [0i128; BINS];
        for (i, raw) in self.weights.iter().enumerate() {
            w[i] = i128::from_le_bytes(*raw);
        }
        (w, i128::from_le_bytes(self.sum))
    }

    pub fn store_curve(&mut self, w: &[i128; BINS], sum: i128) {
        for (i, v) in w.iter().enumerate() {
            self.weights[i] = v.to_le_bytes();
        }
        self.sum = sum.to_le_bytes();
    }

    /// The most the pool could owe: the largest entry in the payout table.
    pub fn max_payout(&self) -> u64 {
        self.payout.iter().copied().max().unwrap_or(0)
    }

    /// Open, and before the lock.
    pub fn tradeable(&self, now: i64) -> bool {
        self.status == STATUS_OPEN && now >= self.opens_at && now < self.locks_at
    }
}

/// One holder's stake in one shape on one market.
///
/// Seeded by the shape, so the same wallet buying the same line twice tops up
/// one account, and two different lines are two accounts.
#[account]
#[derive(Debug)]
pub struct LadderPosition {
    pub ladder: Pubkey,
    pub owner: Pubkey,
    pub lo: i16,
    pub hi: i16,
    pub h: u8,
    /// Shares held, in quote base units: each pays `level × 1` base unit.
    pub shares: u64,
    /// What this position has cost net of sales, fees included. If the market
    /// voids, this is what is refunded — NOT the position marked at the last
    /// price. Every design in the review that refunded at the frozen marginal
    /// price let the last buyer extract LP capital; one auditor took +765 from
    /// a 1,000 seed with a single late buy.
    pub net_paid: u64,
    pub bump: u8,
    pub _reserved: [u8; 16],
}

impl LadderPosition {
    pub const SPACE: usize = 8 + 32 + 32 + 2 + 2 + 1 + 8 + 8 + 1 + 16;
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `Pod` would refuse to compile with implicit padding, but it would not
    /// tell us the size changed. Rent is paid on this number.
    #[test]
    fn the_account_has_the_size_the_layout_comment_claims() {
        assert_eq!(core::mem::size_of::<Ladder>(), 1880);
        assert_eq!(core::mem::size_of::<Ladder>() % 8, 0);
        assert_eq!(Ladder::SPACE, 1888);
    }

    #[test]
    fn the_curve_round_trips_through_the_byte_fields() {
        let mut l: Ladder = bytemuck::Zeroable::zeroed();
        let (w, sum) = crate::math::ladder::fresh();
        l.store_curve(&w, sum);
        l.set_b_wad(1234 * crate::math::WAD);
        let (w2, sum2) = l.load_curve();
        assert_eq!(w, w2);
        assert_eq!(sum, sum2);
        assert_eq!(l.b_wad(), 1234 * crate::math::WAD);
    }

    #[test]
    fn a_market_trades_only_while_open_and_before_the_lock() {
        let mut l: Ladder = bytemuck::Zeroable::zeroed();
        l.opens_at = 100;
        l.locks_at = 200;
        l.status = STATUS_SEEDING;
        assert!(!l.tradeable(150));
        l.status = STATUS_OPEN;
        assert!(!l.tradeable(99));
        assert!(l.tradeable(100));
        assert!(l.tradeable(199));
        assert!(!l.tradeable(200), "the lock is exclusive");
        l.status = STATUS_SETTLED;
        assert!(!l.tradeable(150));
    }

    #[test]
    fn the_largest_obligation_is_what_solvency_is_checked_against() {
        let mut l: Ladder = bytemuck::Zeroable::zeroed();
        assert_eq!(l.max_payout(), 0);
        l.payout[3] = 40;
        l.payout[40] = 900;
        l.payout[63] = 12;
        assert_eq!(l.max_payout(), 900);
    }
}
