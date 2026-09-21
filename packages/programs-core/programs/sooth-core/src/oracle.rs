//! Reading a Pyth price, without the Pyth crate.
//!
//! `pyth-solana-receiver-sdk` does not compile against Anchor 0.30.1: its
//! `>= 0.28` bound resolves a second `anchor-lang`, and `borsh-derive` breaks
//! on current `syn`. Pinning did not rescue it (`docs/feasibility.md` §6). The
//! part of that crate this program needs is one account layout and one
//! staleness rule, so both are reproduced here and checked against an account
//! taken from devnet rather than against the crate's own tests.
//!
//! The account is written by the Pyth receiver program after it has verified a
//! Wormhole-signed update. Ownership by that program is what makes the bytes
//! trustworthy; everything below is only parsing.

use anchor_lang::prelude::*;

use crate::error::SoothCoreError;

/// The Pyth receiver program. Same address on mainnet and devnet.
pub const PYTH_RECEIVER: Pubkey = pubkey!("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");

/// `sha256("account:PriceUpdateV2")[..8]`.
const DISCRIMINATOR: [u8; 8] = [34, 241, 35, 99, 157, 126, 244, 205];

/// How thoroughly the receiver checked the update's guardian signatures.
///
/// Devnet posts are `Partial` without exception — 29,406 SOL/USD accounts and
/// 48 NVDA/USD accounts observed, zero `Full` — because a full 13-signature
/// verification does not fit the posting transaction there. Mainnet posts are
/// `Full`. So the floor is configuration, not a constant: requiring `Full`
/// everywhere would make every devnet market unsettleable.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Verification {
    Partial { signatures: u8 },
    Full,
}

impl Verification {
    /// Whether this meets a floor of `min_signatures`. `Full` always does.
    pub fn meets(&self, min_signatures: u8) -> bool {
        match self {
            Verification::Full => true,
            Verification::Partial { signatures } => *signatures >= min_signatures,
        }
    }
}

/// A price as Pyth publishes it: `price × 10^exponent`, with a confidence
/// interval in the same units.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct OraclePrice {
    pub feed_id: [u8; 32],
    pub price: i64,
    pub conf: u64,
    pub exponent: i32,
    pub publish_time: i64,
    /// Publish time of the update before this one. Settlement uses it to pick
    /// exactly one update out of the several Pyth emits each second.
    pub prev_publish_time: i64,
    pub verification: Verification,
}

/// Parse a `PriceUpdateV2` account's data.
///
/// Layout, after the 8-byte discriminator:
///
/// ```text
///   write_authority     Pubkey   32
///   verification_level  enum     1 (Full) or 2 (Partial + num_signatures)
///   feed_id             [u8;32]  32
///   price               i64       8
///   conf                u64       8
///   exponent            i32       4
///   publish_time        i64       8
///   prev_publish_time   i64       8
///   ema_price           i64       8
///   ema_conf            u64       8
///   posted_slot         u64       8
/// ```
///
/// The enum is variable-width, which is why this is parsed by hand rather than
/// cast: every field after it sits at one of two offsets.
pub fn parse_price_update(data: &[u8]) -> Result<OraclePrice> {
    let bad = || error!(SoothCoreError::OracleAccountMalformed);

    if data.len() < 8 + 32 + 1 || data[..8] != DISCRIMINATOR {
        return Err(bad());
    }
    let mut o = 8 + 32;

    let verification = match data[o] {
        0 => {
            let signatures = *data.get(o + 1).ok_or_else(bad)?;
            o += 2;
            Verification::Partial { signatures }
        }
        1 => {
            o += 1;
            Verification::Full
        }
        _ => return Err(bad()),
    };

    // feed_id + price + conf + exponent + publish_time + prev_publish_time
    if data.len() < o + 32 + 8 + 8 + 4 + 8 + 8 {
        return Err(bad());
    }
    let mut feed_id = [0u8; 32];
    feed_id.copy_from_slice(&data[o..o + 32]);
    o += 32;

    let price = i64::from_le_bytes(data[o..o + 8].try_into().map_err(|_| bad())?);
    o += 8;
    let conf = u64::from_le_bytes(data[o..o + 8].try_into().map_err(|_| bad())?);
    o += 8;
    let exponent = i32::from_le_bytes(data[o..o + 4].try_into().map_err(|_| bad())?);
    o += 4;
    let publish_time = i64::from_le_bytes(data[o..o + 8].try_into().map_err(|_| bad())?);
    o += 8;
    let prev_publish_time = i64::from_le_bytes(data[o..o + 8].try_into().map_err(|_| bad())?);

    Ok(OraclePrice { feed_id, price, conf, exponent, publish_time, prev_publish_time, verification })
}

/// The rules a price must pass before it can settle a market.
#[derive(Clone, Copy, Debug)]
pub struct OraclePolicy {
    /// The feed the market committed to at creation. A settle call cannot
    /// substitute a different asset's price, however fresh and well-signed.
    pub feed_id: [u8; 32],
    /// Oldest acceptable `publish_time`, in seconds before `now`.
    pub max_age_secs: i64,
    /// Guardian-signature floor. See `Verification`.
    pub min_signatures: u8,
    /// Widest acceptable confidence interval, in basis points of the price.
    ///
    /// Pyth widens `conf` when its publishers disagree — a halted stock, a
    /// thin weekend book, a venue outage. Settling inside that is settling on
    /// a number Pyth itself is saying it does not trust.
    pub max_conf_bps: u16,
}

/// Read a settlement price from a receiver-owned account, or refuse.
///
/// Every refusal is a distinct error, because the settle crank has to tell
/// "post a fresher update and retry" apart from "this market cannot settle
/// from this feed".
pub fn read_settlement_price(
    account: &AccountInfo,
    policy: &OraclePolicy,
    now: i64,
) -> Result<OraclePrice> {
    require_keys_eq!(*account.owner, PYTH_RECEIVER, SoothCoreError::OracleWrongOwner);

    let data = account.try_borrow_data()?;
    let p = parse_price_update(&data)?;
    check_policy(&p, policy, now)?;
    Ok(p)
}

/// Read a receiver-owned `PriceUpdateV2` without applying any policy.
pub fn read_price_update(account: &AccountInfo) -> Result<OraclePrice> {
    require_keys_eq!(*account.owner, PYTH_RECEIVER, SoothCoreError::OracleWrongOwner);
    let data = account.try_borrow_data()?;
    parse_price_update(&data)
}

/// Is `p` THE price for the instant `t`?
///
/// Settlement cannot use "any update within a minute of `t`". Pyth emits
/// several updates a second and whoever cranks the settle chooses which one to
/// post, so a window is a menu: near a bin boundary the cranker picks the
/// print that pays them. The rule has to admit exactly one update:
///
/// ```text
///   prev_publish_time < t <= publish_time
/// ```
///
/// `publish_time` has one-second granularity, so several updates share the
/// second `t` — but only the first of them has a predecessor from before `t`.
/// Every later one has `prev_publish_time == t` and fails the strict `<`.
///
/// `max_gap_secs` bounds how late that first update may be. If the feed was
/// silent across `t`, the first update after the gap is not a price for `t`,
/// and the market should void rather than settle on it.
///
/// The confidence ceiling is half a bin: wider than that and Pyth itself
/// cannot say which of two bins the price was in.
pub fn check_settlement_instant(
    p: &OraclePrice,
    feed_id: &[u8; 32],
    min_signatures: u8,
    t: i64,
    max_gap_secs: i64,
    step_bps: u16,
) -> Result<()> {
    require!(&p.feed_id == feed_id, SoothCoreError::OracleWrongFeed);
    require!(p.verification.meets(min_signatures), SoothCoreError::OracleUnderVerified);
    require!(
        p.prev_publish_time < t && t <= p.publish_time && p.publish_time - t <= max_gap_secs,
        SoothCoreError::OracleNotTheSettlementInstant
    );
    require!(p.price > 0, SoothCoreError::OracleNonPositive);

    // conf / price <= (step / 2)  ⇔  conf · 20_000 <= price · step_bps
    let lhs = (p.conf as u128).saturating_mul(20_000);
    let rhs = (p.price as u128).saturating_mul(step_bps as u128);
    require!(lhs <= rhs, SoothCoreError::OracleTooUncertain);
    Ok(())
}

/// The policy checks, split out so they are testable without an `AccountInfo`.
pub fn check_policy(p: &OraclePrice, policy: &OraclePolicy, now: i64) -> Result<()> {
    require!(p.feed_id == policy.feed_id, SoothCoreError::OracleWrongFeed);
    require!(
        p.verification.meets(policy.min_signatures),
        SoothCoreError::OracleUnderVerified
    );

    // A publish_time in the future is a clock disagreement, not freshness.
    let age = now.saturating_sub(p.publish_time);
    require!(age >= 0 && age <= policy.max_age_secs, SoothCoreError::OracleStale);

    require!(p.price > 0, SoothCoreError::OracleNonPositive);

    // conf / price <= max_conf_bps / 10_000, without dividing.
    let lhs = (p.conf as u128).saturating_mul(10_000);
    let rhs = (p.price as u128).saturating_mul(policy.max_conf_bps as u128);
    require!(lhs <= rhs, SoothCoreError::OracleTooUncertain);

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A real `PriceUpdateV2` for Equity.US.NVDA/USD, read from devnet account
    /// `ics9ecaPVixxtFoyWGuAcGYU8vrBjRfJ7G761pHjza9` on 2026-09-21. Testing
    /// against bytes the receiver actually wrote is the point: a layout that
    /// only round-trips through its own serializer proves nothing.
    const NVDA_DEVNET: &str = "22f123639d7ef4cdcdb3d4c2acc447184398ad317cede5f7846a07336c7d228ebe664729eb8ae2f20005b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593b8fb4f0100000000384a000000000000fbfffffff4c5216a00000000f4c5216a0000000018384e0100000000b13f0000000000001e2dd81b00000000";
    const NVDA_FEED: &str = "b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593";

    fn unhex(s: &str) -> Vec<u8> {
        (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
    }
    fn feed(s: &str) -> [u8; 32] {
        let mut f = [0u8; 32];
        f.copy_from_slice(&unhex(s));
        f
    }
    fn policy() -> OraclePolicy {
        OraclePolicy { feed_id: feed(NVDA_FEED), max_age_secs: 60, min_signatures: 5, max_conf_bps: 50 }
    }

    #[test]
    fn a_real_devnet_account_parses_to_the_price_pyth_published() {
        let p = parse_price_update(&unhex(NVDA_DEVNET)).unwrap();
        assert_eq!(p.feed_id, feed(NVDA_FEED));
        assert_eq!(p.exponent, -5);
        assert_eq!(p.price, 22_019_000); // $220.19
        assert_eq!(p.conf, 19_000); // ±$0.19
        assert_eq!(p.verification, Verification::Partial { signatures: 5 });
        assert_eq!(p.publish_time, 1_780_598_260);
        assert_eq!(p.prev_publish_time, 1_780_598_260, "a later update within its second");
    }

    #[test]
    fn a_fresh_well_signed_price_settles() {
        let p = parse_price_update(&unhex(NVDA_DEVNET)).unwrap();
        check_policy(&p, &policy(), p.publish_time + 10).unwrap();
    }

    #[test]
    fn a_stale_price_is_refused() {
        let p = parse_price_update(&unhex(NVDA_DEVNET)).unwrap();
        assert!(check_policy(&p, &policy(), p.publish_time + 61).is_err());
        // and so is one from the future
        assert!(check_policy(&p, &policy(), p.publish_time - 1).is_err());
    }

    #[test]
    fn another_assets_price_cannot_settle_this_market() {
        let p = parse_price_update(&unhex(NVDA_DEVNET)).unwrap();
        let mut pol = policy();
        pol.feed_id[0] ^= 0xff;
        assert!(check_policy(&p, &pol, p.publish_time).is_err());
    }

    #[test]
    fn the_signature_floor_is_a_floor() {
        let p = parse_price_update(&unhex(NVDA_DEVNET)).unwrap();
        let mut pol = policy();
        pol.min_signatures = 6; // the account carries 5
        assert!(check_policy(&p, &pol, p.publish_time).is_err());
        assert!(Verification::Full.meets(13));
    }

    #[test]
    fn a_price_pyth_itself_is_unsure_of_is_refused() {
        let mut p = parse_price_update(&unhex(NVDA_DEVNET)).unwrap();
        check_policy(&p, &policy(), p.publish_time).unwrap(); // 19_000/22_019_000 ≈ 8.6 bps
        p.conf = 200_000; // ≈ 91 bps, over the 50 bps ceiling
        assert!(check_policy(&p, &policy(), p.publish_time).is_err());
    }

    #[test]
    fn exactly_one_update_is_the_price_for_an_instant() {
        let base = parse_price_update(&unhex(NVDA_DEVNET)).unwrap();
        let feed = feed(NVDA_FEED);
        let t = 1_000_000i64;
        let at = |publish, prev| OraclePrice { publish_time: publish, prev_publish_time: prev, ..base };
        let ok = |p: &OraclePrice| check_settlement_instant(p, &feed, 5, t, 30, 100).is_ok();

        assert!(ok(&at(t, t - 1)), "the first update of second t");
        assert!(!ok(&at(t, t)), "a later update in the same second: its predecessor is not before t");
        assert!(!ok(&at(t - 1, t - 2)), "an update from before t");
        assert!(ok(&at(t + 3, t - 1)), "the feed skipped a few seconds; first update after t");
        assert!(!ok(&at(t + 31, t - 1)), "the feed was silent across t for too long");
        assert!(!ok(&at(t + 1, t)), "t already had its update; this is the next second's");
    }

    #[test]
    fn a_settlement_price_pyth_cannot_place_in_one_bin_is_refused() {
        let base = parse_price_update(&unhex(NVDA_DEVNET)).unwrap();
        let feed = feed(NVDA_FEED);
        let p = OraclePrice { publish_time: 500, prev_publish_time: 499, ..base };
        // conf 19_000 on 22_019_000 ≈ 8.6 bps. Half of a 25 bps step is 12.5 — fine.
        check_settlement_instant(&p, &feed, 5, 500, 30, 25).unwrap();
        let wide = OraclePrice { conf: 40_000, ..p }; // ≈ 18 bps > 12.5
        assert!(check_settlement_instant(&wide, &feed, 5, 500, 30, 25).is_err());
        check_settlement_instant(&wide, &feed, 5, 500, 30, 100).unwrap(); // but fine on a 1% grid
    }

    #[test]
    fn garbage_is_malformed_not_a_panic() {
        assert!(parse_price_update(&[]).is_err());
        assert!(parse_price_update(&[0u8; 134]).is_err()); // wrong discriminator
        let mut d = unhex(NVDA_DEVNET);
        d[40] = 7; // no such verification variant
        assert!(parse_price_update(&d).is_err());
        let full = unhex(NVDA_DEVNET);
        assert!(parse_price_update(&full[..60]).is_err()); // truncated mid-feed
    }
}
