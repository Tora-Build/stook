//! A house: one standing pool of liquidity per series that funds the series'
//! rounds one after another, so depositors stay in from day to day without
//! joining each round by hand.
//!
//! # Lifecycle
//!
//! ```text
//!   idle ──house_join──▶ in a round ──(round settles or voids)──house_collect──▶ idle
//!    ▲                                                                            │
//!    └────────────────────────────────────────────────────────────────────────────┘
//! ```
//!
//! The house is a depositor like any other: it joins a round as one tranche
//! (`LadderTranche`, owned by the house's address) and is paid by the round's
//! own rules. Depositors hold SHARES of the house. While the house is idle a
//! deposit mints and a withdrawal pays at once, at the share price of the
//! moment. While its money is in a round nobody knows that price, so deposits
//! and withdrawals queue and are all processed at one price, the price after
//! the round's result, when the house collects (`HouseEpoch`). Each depositor's
//! entry is booked lazily, on their next call, from that epoch's record.
//!
//! The house never chooses anything: it joins only a round nobody has traded
//! yet (its odds are the opening prior), takes everything it holds into it,
//! and is collected from by anyone once the round is final.

use anchor_lang::prelude::*;

pub const HOUSE_SEED: &[u8] = b"house";
pub const HOUSE_VAULT_SEED: &[u8] = b"house_vault";
pub const HOUSE_STAKE_SEED: &[u8] = b"house_stake";
pub const HOUSE_EPOCH_SEED: &[u8] = b"house_epoch";

/// Shares a fresh house mints per quote base unit, and the virtual shares
/// against the first-depositor inflation attack: the price is
/// `(assets + 1) / (shares + VIRTUAL_SHARES)`, so a donation straight to the
/// vault cannot make one share worth more than a deposit can buy.
pub const VIRTUAL_SHARES: u128 = 1_000_000;

#[account]
#[derive(Debug)]
pub struct House {
    pub series: Pubkey,
    pub quote_mint: Pubkey,
    /// The house's token account, owned by the house's address.
    pub vault: Pubkey,
    /// The round the house's money is in; the default key while idle.
    pub round: Pubkey,
    /// Who paid the rent of the house's tranche in `round`; gets it back.
    pub rent_payer: Pubkey,

    /// Capital that belongs to the shares and is in the vault now. Excludes
    /// queued deposits and processed withdrawals waiting to be claimed.
    pub assets: u64,
    /// What the house took into `round`.
    pub in_round: u64,
    /// Queued deposits, in the vault, minted at the next collect.
    pub pending_deposits: u64,
    /// Processed withdrawals not yet claimed, in the vault.
    pub claimable: u64,

    pub total_shares: u128,
    /// Shares queued to be withdrawn at the next collect. Still counted in
    /// `total_shares`, so they bear the round's result.
    pub pending_withdraw_shares: u128,

    /// Rounds collected so far. A queued entry belongs to the epoch in force
    /// when it was queued and is processed when that epoch ends.
    pub epoch: u32,
    /// Bumped when a round leaves the shares worth nothing: the old shares
    /// stay void and new capital starts a fresh generation.
    pub generation: u32,
    /// Index of the last round the house joined.
    pub last_index: u32,

    pub bump: u8,
    pub vault_bump: u8,
    pub _reserved: [u8; 32],
}

impl House {
    pub const SPACE: usize = 8 + 32 * 5 + 8 * 4 + 16 * 2 + 4 * 3 + 1 + 1 + 32;

    pub fn idle(&self) -> bool {
        self.round == Pubkey::default()
    }
}

/// One depositor's stake in one house.
#[account]
#[derive(Debug)]
pub struct HouseStake {
    pub house: Pubkey,
    pub owner: Pubkey,
    pub shares: u128,
    /// Shares queued to be withdrawn at the end of `pending_epoch`.
    pub pending_withdraw: u128,
    /// A deposit queued to be minted at the end of `pending_epoch`.
    pub pending_deposit: u64,
    /// Booked withdrawals, ready to be claimed.
    pub claimable: u64,
    pub pending_epoch: u32,
    /// The house generation `shares` belong to.
    pub generation: u32,
    pub bump: u8,
    pub _reserved: [u8; 16],
}

impl HouseStake {
    pub const SPACE: usize = 8 + 32 * 2 + 16 * 2 + 8 * 2 + 4 * 2 + 1 + 16;

    pub fn has_pending(&self) -> bool {
        self.pending_deposit > 0 || self.pending_withdraw > 0
    }
}

/// The one price an epoch's queue was processed at. Written once, at collect.
#[account]
#[derive(Debug)]
pub struct HouseEpoch {
    pub house: Pubkey,
    pub epoch: u32,
    /// The shares' capital and the share count after the round, before the
    /// queue: the price every queued entry of this epoch is booked at.
    pub assets: u64,
    pub shares: u128,
    /// The round left the shares worth nothing: queued withdrawals are paid
    /// nothing and queued deposits start the next generation.
    pub wiped: bool,
    /// The house's generation once this epoch was processed.
    pub generation: u32,
    pub bump: u8,
}

impl HouseEpoch {
    pub const SPACE: usize = 8 + 32 + 4 + 8 + 16 + 1 + 4 + 1;
}

// ── share price, pure and tested below ──────────────────────────────────────

/// Shares `amount` buys at `(assets, shares)`. Floors: the depositor gets no
/// more than they paid for.
pub fn shares_for(amount: u64, assets: u64, shares: u128) -> Option<u128> {
    (amount as u128).checked_mul(shares.checked_add(VIRTUAL_SHARES)?)?.checked_div(assets as u128 + 1)
}

/// Capital `n` shares redeem for at `(assets, shares)`. Floors: the house
/// keeps the rounding.
pub fn assets_for(n: u128, assets: u64, shares: u128) -> Option<u64> {
    let v = n.checked_mul(assets as u128 + 1)?.checked_div(shares.checked_add(VIRTUAL_SHARES)?)?;
    u64::try_from(v).ok().map(|v| v.min(assets))
}

/// What processing one epoch's whole queue does to the house: the price, then
/// withdrawals out, then deposits in. Returns `(paid, minted, wiped)`.
pub fn process_queue(h: &mut House) -> Option<(u64, u128, bool)> {
    // Nothing behind the shares: they are void, and new capital starts over.
    let wiped = h.assets == 0 && h.total_shares > 0;
    if wiped {
        h.generation = h.generation.checked_add(1)?;
        h.total_shares = 0;
        h.pending_withdraw_shares = 0;
    }
    // One price for the whole queue, both ways. The withdrawals floor, so what
    // stays behind is worth at least that price per share, and the deposits
    // minted at it dilute nobody by more than that rounding.
    let paid = assets_for(h.pending_withdraw_shares, h.assets, h.total_shares)?;
    let minted = shares_for(h.pending_deposits, h.assets, h.total_shares)?;
    h.assets = h.assets - paid + h.pending_deposits;
    h.total_shares = h.total_shares - h.pending_withdraw_shares + minted;
    h.claimable = h.claimable.checked_add(paid)?;
    h.pending_deposits = 0;
    h.pending_withdraw_shares = 0;
    Some((paid, minted, wiped))
}

/// Book a stake's queued entry at its epoch's price, the same arithmetic as
/// `process_queue` per entry. Each entry floors, so the stakes of an epoch
/// together never take more than the house set aside for them.
pub fn book_from_epoch(s: &mut HouseStake, e: &HouseEpoch) -> Option<()> {
    let (paid, minted) = if e.wiped {
        // Shares were void: the withdrawal is worth nothing, the deposit
        // mints at a fresh house's price.
        s.shares = 0;
        (0, shares_for(s.pending_deposit, 0, 0)?)
    } else {
        (
            assets_for(s.pending_withdraw, e.assets, e.shares)?,
            shares_for(s.pending_deposit, e.assets, e.shares)?,
        )
    };
    s.shares = s.shares.checked_sub(if e.wiped { 0 } else { s.pending_withdraw })?.checked_add(minted)?;
    s.claimable = s.claimable.checked_add(paid)?;
    s.pending_deposit = 0;
    s.pending_withdraw = 0;
    s.generation = e.generation;
    Some(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn house() -> House {
        House {
            series: Pubkey::default(),
            quote_mint: Pubkey::default(),
            vault: Pubkey::default(),
            round: Pubkey::default(),
            rent_payer: Pubkey::default(),
            assets: 0,
            in_round: 0,
            pending_deposits: 0,
            claimable: 0,
            total_shares: 0,
            pending_withdraw_shares: 0,
            epoch: 0,
            generation: 0,
            last_index: 0,
            bump: 0,
            vault_bump: 0,
            _reserved: [0; 32],
        }
    }

    #[test]
    fn a_fresh_house_mints_a_million_shares_per_unit_and_redeems_them_whole() {
        let s = shares_for(1_000_000, 0, 0).unwrap();
        assert_eq!(s, 1_000_000 * VIRTUAL_SHARES);
        assert_eq!(assets_for(s, 1_000_000, s).unwrap(), 1_000_000);
    }

    #[test]
    fn a_donation_cannot_price_the_next_depositor_out() {
        // The attacker deposits one unit, then sends a million straight to the
        // vault (the books would not even see it; here we grant it anyway).
        let sh = shares_for(1, 0, 0).unwrap();
        let minted = shares_for(1_000_000, 1_000_001, sh).unwrap();
        assert!(minted > 0, "the victim got no shares");
        let back = assets_for(minted, 2_000_001, sh + minted).unwrap();
        assert!(back >= 999_000, "victim lost {} to the donation", 1_000_000 - back);
    }

    #[test]
    fn the_queue_is_processed_at_the_price_after_the_round() {
        let mut h = house();
        h.assets = 1_000;
        h.total_shares = shares_for(1_000, 0, 0).unwrap();
        // The round lost 10%. Half the shares asked out; 500 queued in.
        h.assets = 900;
        h.pending_withdraw_shares = h.total_shares / 2;
        h.pending_deposits = 500;
        let (paid, minted, wiped) = process_queue(&mut h).unwrap();
        assert!(!wiped);
        assert!((449..=450).contains(&paid), "paid {paid}");
        assert_eq!(h.assets, 900 - paid + 500);
        assert_eq!(h.claimable, paid);
        // The newcomer's shares are worth what they paid, to the unit.
        let worth = assets_for(minted, h.assets, h.total_shares).unwrap();
        assert!((499..=500).contains(&worth), "worth {worth}");
    }

    #[test]
    fn stakes_booked_one_by_one_never_take_more_than_the_house_set_aside() {
        let mut h = house();
        let a = shares_for(333, 0, 0).unwrap();
        let b = shares_for(667, 333, a).unwrap();
        h.assets = 1_000;
        h.total_shares = a + b;
        h.assets = 1_237; // the round won
        h.pending_withdraw_shares = a + b;
        h.pending_deposits = 0;
        let e_assets = h.assets;
        let e_shares = h.total_shares;
        let (paid, _, _) = process_queue(&mut h).unwrap();
        let e = HouseEpoch { house: Pubkey::default(), epoch: 0, assets: e_assets, shares: e_shares, wiped: false, generation: 0, bump: 0 };
        let mut sa = HouseStake { house: Pubkey::default(), owner: Pubkey::default(), shares: a, pending_withdraw: a, pending_deposit: 0, claimable: 0, pending_epoch: 0, generation: 0, bump: 0, _reserved: [0; 16] };
        let mut sb = HouseStake { shares: b, pending_withdraw: b, ..sa.clone() };
        book_from_epoch(&mut sa, &e).unwrap();
        book_from_epoch(&mut sb, &e).unwrap();
        assert!(sa.claimable + sb.claimable <= paid);
        assert!(paid - (sa.claimable + sb.claimable) <= 2, "dust {}", paid - sa.claimable - sb.claimable);
        assert_eq!(sa.shares + sb.shares, 0);
    }

    #[test]
    fn a_round_that_leaves_nothing_voids_the_shares_and_starts_over() {
        let mut h = house();
        h.total_shares = shares_for(1_000, 0, 0).unwrap();
        h.assets = 0;
        h.pending_withdraw_shares = h.total_shares;
        h.pending_deposits = 50;
        let (paid, minted, wiped) = process_queue(&mut h).unwrap();
        assert!(wiped);
        assert_eq!(paid, 0);
        assert_eq!(h.generation, 1);
        assert_eq!(h.total_shares, minted);
        assert_eq!(assets_for(minted, h.assets, h.total_shares).unwrap(), 50);
    }
}
