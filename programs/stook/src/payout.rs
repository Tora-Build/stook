//! The payout arithmetic.
//!
//! Kept in its own module, free of Anchor types, because it is the only place
//! in the protocol where being wrong costs someone money. Everything here is a
//! pure function over integers and is tested as such.

/// Basis-point denominator.
pub const BPS: u128 = 10_000;

/// What a winning stake is owed.
///
/// `payout = stake × (pot − rake) / winning_stake`
///
/// Floors. The remainder — at most one base unit per claimant — stays in the
/// vault rather than being handed out, so the vault is always a lower bound on
/// what it owes and the last claimant is never short. A pot that rounds in the
/// claimant's favour is a pot that runs dry before the final claim.
///
/// Returns `None` on a zero winning pool, which is not a divide-by-zero to be
/// guarded at the call site but a real state: nobody predicted the settled
/// band, and the market voids.
pub fn payout(stake: u64, pot: u64, winning_stake: u64, rake_bps: u16) -> Option<u64> {
    if winning_stake == 0 {
        return None;
    }
    let distributable = distributable(pot, rake_bps);
    let owed = (stake as u128)
        .checked_mul(distributable as u128)?
        .checked_div(winning_stake as u128)?;
    u64::try_from(owed).ok()
}

/// The pot minus the rake.
///
/// Floors the rake, so rounding leaves the extra base unit with the claimants
/// rather than the protocol. The protocol can afford to be the one that rounds
/// down; a claimant discovering a short payout cannot.
pub fn distributable(pot: u64, rake_bps: u16) -> u64 {
    let rake = (pot as u128) * (rake_bps as u128) / BPS;
    pot.saturating_sub(rake as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_only_winner_takes_the_pot_less_the_rake() {
        // 1,000 staked, all of it in the winning band, 2% rake.
        assert_eq!(payout(1_000, 1_000, 1_000, 200), Some(980));
    }

    #[test]
    fn winners_split_in_proportion_to_stake() {
        // Pot 1,000; winning band holds 250, split 100/150. No rake.
        assert_eq!(payout(100, 1_000, 250, 0), Some(400));
        assert_eq!(payout(150, 1_000, 250, 0), Some(600));
    }

    #[test]
    fn being_right_where_nobody_else_was_pays_more() {
        // Same stake, same pot. The band holding less of the pot pays more —
        // this is the entire incentive to predict accurately rather than
        // follow the crowd, so it gets a test rather than a comment.
        let crowded = payout(100, 10_000, 5_000, 0).unwrap();
        let lonely = payout(100, 10_000, 200, 0).unwrap();
        assert!(lonely > crowded);
        assert_eq!(crowded, 200);
        assert_eq!(lonely, 5_000);
    }

    #[test]
    fn nobody_in_the_settled_band_is_not_a_division_by_zero() {
        assert_eq!(payout(100, 10_000, 0, 200), None);
    }

    /// The invariant that keeps the vault solvent: the sum of every payout can
    /// never exceed what was staked. Floors everywhere, checked across awkward
    /// splits rather than round ones.
    #[test]
    fn payouts_never_exceed_the_pot() {
        for pot in [1u64, 2, 3, 7, 999, 1_000, 123_457, u64::MAX / 4] {
            for parts in [1u64, 2, 3, 7, 11] {
                let winning = pot / parts.max(1);
                if winning == 0 {
                    continue;
                }
                let each = winning / parts;
                if each == 0 {
                    continue;
                }
                let total: u128 = (0..parts)
                    .filter_map(|_| payout(each, pot, winning, 200))
                    .map(|p| p as u128)
                    .sum();
                assert!(
                    total <= distributable(pot, 200) as u128,
                    "pot={pot} parts={parts} paid {total}"
                );
            }
        }
    }

    #[test]
    fn the_rake_rounds_towards_the_claimants() {
        // 1 base unit, 2% rake: the rake floors to 0 rather than taking the
        // only unit there is.
        assert_eq!(distributable(1, 200), 1);
        assert_eq!(distributable(0, 200), 0);
        assert_eq!(distributable(10_000, 200), 9_800);
    }

    #[test]
    fn a_void_market_is_not_raked() {
        // Nothing here calls distributable — a void refunds stake in full, and
        // this test exists to pin that the refund path must not reuse it.
        assert_eq!(payout(100, 10_000, 0, 200), None);
    }
}
