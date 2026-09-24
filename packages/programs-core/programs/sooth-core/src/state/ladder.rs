//! A Stook market: one price ladder per day (or period) of a series.
//!
//! # Lifecycle
//!
//! ```text
//!   Seeding ──open──▶ Open ──(locks_at)──▶ locked ──settle──▶ Settled
//!      │                                                  └──▶ Void
//!      └── nobody can trade yet, so every tranche joins at the opening prior
//! ```
//!
//! Liquidity may join at any time before lock, as a TRANCHE (`math::ladder`):
//! its own layer under the same prices, valued at settlement from the prices it
//! joined at. There is no withdrawal before the market is final, so liquidity
//! cannot arrive for one trade's fee and leave.
//!
//! What the blind review measured is that a deposit priced at the instant it
//! lands can be sandwiched — push a bin, let the LP join at the distorted
//! prices, trade back: +2,802 taken from a 2,500 deposit. So a join names the
//! `curve_seq` the LP saw, and lands only if no trade has happened since. The
//! LP joins at exactly the prices they looked at or not at all; a trade placed
//! in front of the join makes it fail, which costs the LP a retry and the
//! attacker a fee.
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
pub const LADDER_TRANCHE_SEED: &[u8] = b"ladder_tranche";
pub const MINT_APPROVAL_SEED: &[u8] = b"mint_approval";

/// Fixed-point scale of the per-unit-`b` fee accumulator.
pub const FEE_ACC_SCALE: u128 = 1_000_000_000_000_000_000;

/// A round that opened voids only on proof that it cannot settle: the one
/// Pyth update for its close, failing the settlement rule (`ladder_void`).
/// Without that proof it waits this long, for a close whose update can no
/// longer be posted (a retired Wormhole guardian set) or a feed that never
/// printed again. Until then settling is always possible and voiding is not,
/// so a losing trader cannot race a late settle.
pub const VOID_FALLBACK_SECS: i64 = 7 * 24 * 60 * 60;

/// How long after `opens_at` a round may be opened. The opening price is the
/// Pyth update at `opens_at`, fixed whoever opens; this bounds how stale it
/// may be when trading starts, so a late opener cannot trade against a grid
/// centred on a price the market has since left. A round not opened by then
/// never will be, and voids.
pub const OPEN_WINDOW_SECS: i64 = 5 * 60;

/// The latest the settlement update may be published after `settles_at`.
pub const SETTLE_MAX_GAP_SECS: i64 = 30;

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
    /// Sum of tranche deposits.
    pub deposit_total: u64,
    /// Bumped by every trade. A join must name the value it was priced against.
    pub curve_seq: u64,

    pub fees_lp: u64,
    pub fees_creator: u64,
    pub fees_protocol: u64,

    /// Sum of every position's `net_paid`. What a void would have to refund.
    pub basis_total: u64,
    /// Fixed at settlement: pool cash left after the winning bin's payouts are
    /// reserved. Tranche principal is paid from here and it only decreases, so
    /// a rounding surplus can never become an over-withdrawal.
    pub lp_pool: u64,
    /// Fixed at void: the vault split into two pots. Depositors come first
    /// (`void_lp_pot = min(vault, deposit_total)`), shared by deposit; open
    /// positions share the rest by what they paid. `deposit_total` and
    /// `basis_total` do not move after a void, so they are the denominators.
    ///
    /// Depositors first because they are the only party that cannot leave: a
    /// trader can sell at any time before the lock, a deposit is locked until
    /// the market is final. So money that left with sellers before a void is
    /// worn by the traders who stayed in, and a void, however foreseeable,
    /// cannot be used to take the house's deposit.
    pub void_lp_pot: u64,
    pub void_trader_pot: u64,

    /// `payout[i]`: quote base units owed in total if bin `i` settles. Kept so
    /// solvency is a comparison, not a belief about the scoring rule.
    pub payout: [u64; BINS],

    pub p0_expo: i32,
    /// Band width, basis points of log price. Set at open from the
    /// series' volatility (`math::ladder::band_width`).
    pub step_bps: u16,
    pub fee_bps: u16,

    /// Which day (or period) of its series this round is.
    pub index: u32,
    /// Positions and tranches not yet paid out and closed. A finished round
    /// can be closed (`ladder_close`) once both are zero.
    pub open_positions: u32,
    pub open_tranches: u32,
    pub _pad2: u32,

    /// The Pyth feed this market committed to. Settlement accepts no other.
    pub feed_id: [u8; 32],
    pub quote_mint: Pubkey,
    pub vault: Pubkey,
    pub creator: Pubkey,
    /// Who the market is presented as funded by. Defaults to the creator; a
    /// community sponsoring a market on its own asset sets it to itself. Purely
    /// attribution — it grants no authority.
    pub sponsor: Pubkey,
    /// The series this round belongs to; its address seeds the round's.
    pub series: Pubkey,

    /// Total LMSR liquidity `B = Σ bⱼ` over active tranches, WAD, LE i128.
    pub b: [u8; 16],
    /// LP fees accrued per unit of `b`, scaled by `FEE_ACC_SCALE`, LE u128. A
    /// tranche earns the growth in this since it joined — so fees follow the
    /// volume a tranche was actually present for.
    pub acc_fee: [u8; 16],
    /// Exact sum of `weights`, WAD, little-endian i128.
    pub sum: [u8; 16],
    /// `wᵢ = exp(qᵢ/b)`, WAD, little-endian i128 each.
    pub weights: [[u8; 16]; BINS],

    pub status: u8,
    pub settled_bin: u8,
    pub _pad1: u8,
    pub quote_decimals: u8,
    pub bump: u8,
    pub authority_bump: u8,
    pub vault_bump: u8,
    pub _pad: u8,

    /// The opening bell's width, in 1e-9 bands², fixed at open with the band
    /// width. Deposits made before open recompute their depth and the odds
    /// they joined at from it. Zero before open, and on rounds whose bands
    /// were set when they were funded (the earlier rule).
    pub var_bands_e9: u64,
}

impl Ladder {
    pub const SPACE: usize = 8 + core::mem::size_of::<Ladder>();

    /// The opening bell's width, bands² (WAD), exactly as the curve was built.
    pub fn var_bands(&self) -> i128 {
        self.var_bands_e9 as i128 * 1_000_000_000
    }

    pub fn b_wad(&self) -> i128 {
        i128::from_le_bytes(self.b)
    }
    pub fn set_b_wad(&mut self, v: i128) {
        self.b = v.to_le_bytes();
    }
    pub fn acc_fee(&self) -> u128 {
        u128::from_le_bytes(self.acc_fee)
    }

    /// Credit `fee` to every active tranche, pro rata to `b`. Floors, so the
    /// accumulator never promises more than was collected.
    pub fn accrue_lp_fee(&mut self, fee: u64, b_units: u128) {
        if fee == 0 || b_units == 0 {
            return;
        }
        let add = fee as u128 * FEE_ACC_SCALE / b_units;
        self.acc_fee = self.acc_fee().saturating_add(add).to_le_bytes();
    }

    /// Weights and their sum, decoded for `math::ladder`.
    pub fn weight(&self, i: usize) -> i128 {
        i128::from_le_bytes(self.weights[i])
    }
    pub fn sum_wad(&self) -> i128 {
        i128::from_le_bytes(self.sum)
    }
    /// `b` in quote base units — the unit fees are accrued against.
    pub fn b_units(b_wad: i128, decimals: u8) -> u128 {
        (b_wad.max(0) as u128) / crate::math::scalar_for(decimals)
    }
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

/// One deposit of liquidity. ~1.2 KB because it snapshots the 64 weights it
/// joined at: that snapshot is the whole of its accounting (`tranche_pnl`), so
/// a trade never has to touch a tranche.
#[account(zero_copy)]
#[derive(Debug)]
pub struct LadderTranche {
    pub deposit: u64,

    pub ladder: Pubkey,
    pub owner: Pubkey,

    /// Liquidity this tranche contributes, WAD, LE i128.
    pub b: [u8; 16],
    /// `Ladder::acc_fee` at joining.
    pub fee_snap: [u8; 16],
    /// `S` and `wᵢ` at joining.
    pub join_sum: [u8; 16],
    pub join_w: [[u8; 16]; BINS],

    pub index: u8,
    pub bump: u8,
    pub _pad: [u8; 6],
}

impl LadderTranche {
    pub const SPACE: usize = 8 + core::mem::size_of::<LadderTranche>();

    pub fn b_wad(&self) -> i128 {
        i128::from_le_bytes(self.b)
    }
    pub fn fee_snap(&self) -> u128 {
        u128::from_le_bytes(self.fee_snap)
    }
    pub fn join_sum(&self) -> i128 {
        i128::from_le_bytes(self.join_sum)
    }
    pub fn join_weight(&self, i: usize) -> i128 {
        i128::from_le_bytes(self.join_w[i])
    }

    /// Record the moment of joining: the liquidity bought and the prices it
    /// was bought at.
    pub fn record_join(&mut self, b: i128, w: &[i128; BINS], sum: i128, acc_fee: u128) {
        self.b = b.to_le_bytes();
        self.join_sum = sum.to_le_bytes();
        for (i, v) in w.iter().enumerate() {
            self.join_w[i] = v.to_le_bytes();
        }
        self.fee_snap = acc_fee.to_le_bytes();
    }
}

/// The protocol authority's acceptance of one mint's issuer. See
/// `token_guard`: needed for mints whose issuer can move or stall what a vault
/// holds, which includes every xStock.
#[account]
#[derive(Debug)]
pub struct MintApproval {
    pub mint: Pubkey,
    pub approved_by: Pubkey,
    pub approved_at: i64,
    pub bump: u8,
}

impl MintApproval {
    pub const SPACE: usize = 8 + 32 + 32 + 8 + 1;
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `Pod` would refuse to compile with implicit padding, but it would not
    /// tell us the size changed. Rent is paid on this number.
    #[test]
    fn the_account_has_the_size_the_layout_comment_claims() {
        assert_eq!(core::mem::size_of::<Ladder>(), 1928);
        assert_eq!(core::mem::size_of::<Ladder>() % 8, 0);
        assert_eq!(Ladder::SPACE, 1936);
        assert_eq!(core::mem::size_of::<LadderTranche>(), 1152);
        assert_eq!(core::mem::size_of::<LadderTranche>() % 8, 0);
    }

    #[test]
    fn fees_accrue_per_unit_of_liquidity_and_never_over_promise() {
        let mut l: Ladder = bytemuck::Zeroable::zeroed();
        l.accrue_lp_fee(1_000, 4_000);
        // a tranche holding half the liquidity is owed half, floored
        let owed = 2_000u128 * l.acc_fee() / FEE_ACC_SCALE;
        assert_eq!(owed, 500);
        l.accrue_lp_fee(7, 3); // awkward division
        let total: u128 = [1u128, 1, 1].iter().map(|b| b * l.acc_fee() / FEE_ACC_SCALE).sum();
        assert!(total <= 1_000 * 3 / 4_000 + 7, "promised {total}");
        l.accrue_lp_fee(5, 0); // no liquidity: nothing to credit, no divide by zero
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
