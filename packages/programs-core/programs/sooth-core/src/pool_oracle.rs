//! A price from a Raydium concentrated-liquidity pool, for an anchor Pyth
//! does not carry (Polymarket's PreStocks token: no Pyth feed, and our own
//! signed price would ask players to trust our key).
//!
//! The price is the pool's time-weighted average over `POOL_TWAP_SECS`
//! ending at the instant, read from the pool's own observation account:
//! Raydium keeps there, at every swap at least 15 s after the last entry,
//! the running sum of the pool's tick over time (`tick_cumulative`). The sum
//! at any instant between two entries is the straight line between them, so
//! the average over a window is two interpolations and a division, and the
//! price is `1.0001^tick` scaled by the mints' decimals.
//!
//! Both ends of the window must lie between two entries; the pool's current
//! tick is never used. That is what keeps one transaction from settling on
//! a price it moved itself: a swap in the same transaction as the settle
//! writes no entry for an instant already past (the next entry it writes is
//! dated now), and to move the average an attacker must hold the pool off
//! its price until the next entry, against every arbitrageur, for a share of
//! the window. Over ten minutes, one 15-second entry is 2.5% of the average.
//!
//! The pool's address is the feed id: a series or round that names a pool
//! settles only on that pool. Ownership by the Raydium program is what makes
//! the bytes trustworthy; both accounts are checked against each other, and
//! by exact size, so a Raydium layout change refuses rather than misreads.

use anchor_lang::prelude::*;

use crate::error::SoothCoreError;
use crate::math::lmsr::exp_wad;
use crate::math::wad::WAD;
use crate::oracle::{is_push_feed, read_price_update, OraclePrice, Verification};

/// Raydium's concentrated-liquidity (CLMM) program. Same address on mainnet
/// and devnet.
pub const RAYDIUM_CLMM: Pubkey = pubkey!("CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK");

/// The averaging window, ending at the instant.
pub const POOL_TWAP_SECS: i64 = 10 * 60;

/// How old the latest entry may be for a round opened late on it: a quiet
/// pool writes one entry per swap, minutes apart.
pub const POOL_LIVE_MAX_AGE_SECS: i64 = 15 * 60;

/// Pool prices are given on this exponent (Pyth's for most USD feeds).
pub const POOL_EXPONENT: i32 = -8;

/// `sha256("account:PoolState")[..8]`, `sha256("account:ObservationState")[..8]`.
const POOL_DISC: [u8; 8] = [247, 237, 227, 245, 215, 195, 222, 70];
const OBS_DISC: [u8; 8] = [122, 174, 197, 53, 129, 9, 165, 132];
const POOL_LEN: usize = 1544;
const OBS_LEN: usize = 4483;
/// PoolState: discriminator, bump, then amm_config, owner, token_mint_0,
/// token_mint_1, token_vault_0, token_vault_1, observation_key, then
/// mint_decimals_0, mint_decimals_1.
const POOL_OBSERVATION_KEY: usize = 8 + 1 + 32 * 6;
const POOL_DECIMALS: usize = 8 + 1 + 32 * 7;
/// ObservationState (packed): discriminator, initialized u8, recent_epoch
/// u64, observation_index u16, pool_id, then 100 × { block_timestamp u32,
/// tick_cumulative i64, padding [u64; 4] }.
const OBS_POOL_ID: usize = 8 + 1 + 8 + 2;
const OBS_ENTRIES: usize = OBS_POOL_ID + 32;
const OBS_ENTRY_LEN: usize = 4 + 8 + 32;
const OBS_COUNT: usize = 100;

/// `ln(1.0001)`, WAD: a tick is a 0.01% step in price.
const LN_TICK_WAD: i128 = 99_995_000_333_308;
/// `ln(10)`, WAD.
const LN_10_WAD: i128 = 2_302_585_092_994_045_684;
/// Raydium's tick range.
const MAX_TICK: i128 = 443_636;

/// Is `account` a pool rather than a Pyth price account?
pub fn is_pool(account: &AccountInfo) -> bool {
    *account.owner == RAYDIUM_CLMM
}

/// The pool's price (token 1 per token 0, e.g. USDC per PreStocks token) at
/// `t`: the average over the `POOL_TWAP_SECS` before it. `observation` is
/// the pool's observation account. The result reads as THE update for `t`
/// (`prev_publish_time < t == publish_time`), fully verified and exact.
pub fn pool_price_at(pool: &AccountInfo, observation: &AccountInfo, feed_id: &[u8; 32], t: i64) -> Result<OraclePrice> {
    with_pool(pool, observation, feed_id, |dec0, dec1, entries| price_at(dec0, dec1, entries, feed_id, t))
}

/// The pool's price at its latest entry, for a round opened late: an entry
/// is written by a real swap, so the latest one is the freshest price no
/// transaction can have made up.
pub fn pool_latest_price(pool: &AccountInfo, observation: &AccountInfo, feed_id: &[u8; 32]) -> Result<OraclePrice> {
    with_pool(pool, observation, feed_id, |dec0, dec1, entries| {
        let latest = entries.iter().map(|e| e.0).max().ok_or(error!(SoothCoreError::OracleStale))?;
        price_at(dec0, dec1, entries, feed_id, latest)
    })
}

/// The price `account` gives for the instant `t`, and whether it is Pyth's
/// push feed: a Pyth update as it is (it says itself which instant it is
/// for), or a pool's average to `t`, its observation account the first of
/// `rest`.
pub fn price_for_instant(account: &AccountInfo, rest: &[AccountInfo], feed_id: &[u8; 32], t: i64) -> Result<(OraclePrice, bool)> {
    if is_pool(account) {
        let observation = rest.first().ok_or(error!(SoothCoreError::OracleAccountMalformed))?;
        Ok((pool_price_at(account, observation, feed_id, t)?, false))
    } else {
        Ok((read_price_update(account)?, is_push_feed(account.key, feed_id)))
    }
}

/// The observation entries, read in place (copied out they would not fit
/// the program's stack): (timestamp, tick_cumulative) each.
struct Entries<'a>(&'a [u8]);

impl Entries<'_> {
    fn iter(&self) -> impl Iterator<Item = (i64, i128)> + '_ {
        self.0.chunks_exact(OBS_ENTRY_LEN).take(OBS_COUNT).map(|e| {
            let ts = u32::from_le_bytes([e[0], e[1], e[2], e[3]]);
            let cum = i64::from_le_bytes([e[4], e[5], e[6], e[7], e[8], e[9], e[10], e[11]]);
            (ts as i64, cum as i128)
        })
    }
}

fn with_pool<R>(pool: &AccountInfo, observation: &AccountInfo, feed_id: &[u8; 32], f: impl FnOnce(u8, u8, &Entries) -> Result<R>) -> Result<R> {
    require_keys_eq!(*pool.owner, RAYDIUM_CLMM, SoothCoreError::OracleWrongOwner);
    require_keys_eq!(*observation.owner, RAYDIUM_CLMM, SoothCoreError::OracleWrongOwner);
    require!(pool.key.to_bytes() == *feed_id, SoothCoreError::OracleWrongFeed);
    let p = pool.try_borrow_data()?;
    let o = observation.try_borrow_data()?;
    let (dec0, dec1) = check(&p, &o, pool.key, observation.key).ok_or(error!(SoothCoreError::OracleAccountMalformed))?;
    f(dec0, dec1, &Entries(&o[OBS_ENTRIES..]))
}

/// Both accounts' bytes, checked against each other: the mints' decimals.
fn check(p: &[u8], o: &[u8], pool_key: &Pubkey, observation_key: &Pubkey) -> Option<(u8, u8)> {
    if p.len() != POOL_LEN || o.len() != OBS_LEN || p[..8] != POOL_DISC || o[..8] != OBS_DISC || o[8] != 1 {
        return None;
    }
    if p[POOL_OBSERVATION_KEY..POOL_OBSERVATION_KEY + 32] != observation_key.to_bytes() || o[OBS_POOL_ID..OBS_POOL_ID + 32] != pool_key.to_bytes() {
        return None;
    }
    Some((p[POOL_DECIMALS], p[POOL_DECIMALS + 1]))
}

fn price_at(dec0: u8, dec1: u8, entries: &Entries, feed_id: &[u8; 32], t: i64) -> Result<OraclePrice> {
    let c1 = cumulative_at(entries, t).ok_or(error!(SoothCoreError::OracleNotTheSettlementInstant))?;
    let c0 = cumulative_at(entries, t - POOL_TWAP_SECS).ok_or(error!(SoothCoreError::OracleNotTheSettlementInstant))?;
    let tick = (c1 - c0).div_euclid(POOL_TWAP_SECS as i128);
    require!(tick.abs() <= MAX_TICK, SoothCoreError::OracleAccountMalformed);
    let price = tick_price(tick, dec0, dec1).ok_or(error!(SoothCoreError::OracleNonPositive))?;
    Ok(OraclePrice {
        feed_id: *feed_id,
        price,
        conf: 0,
        exponent: POOL_EXPONENT,
        publish_time: t,
        prev_publish_time: t - 1,
        verification: Verification::Full,
    })
}

/// The running tick sum at `x`, on the line between the last entry at or
/// before it and the first at or after it; `None` unless both exist.
fn cumulative_at(entries: &Entries, x: i64) -> Option<i128> {
    let mut before: Option<(i64, i128)> = None;
    let mut after: Option<(i64, i128)> = None;
    for (ts, cum) in entries.iter() {
        if ts == 0 {
            continue;
        }
        if ts <= x && before.map_or(true, |b| ts > b.0) {
            before = Some((ts, cum));
        }
        if ts >= x && after.map_or(true, |a| ts < a.0) {
            after = Some((ts, cum));
        }
    }
    let ((ta, ca), (tb, cb)) = (before?, after?);
    if ta == tb {
        return Some(ca);
    }
    Some(ca + ((cb - ca) * (x - ta) as i128).div_euclid((tb - ta) as i128))
}

/// `1.0001^tick · 10^(dec0 − dec1)` on `POOL_EXPONENT`, as a raw positive i64.
fn tick_price(tick: i128, dec0: u8, dec1: u8) -> Option<i64> {
    let scale = dec0 as i128 - dec1 as i128 - POOL_EXPONENT as i128;
    let ln = tick.checked_mul(LN_TICK_WAD)?.checked_add(scale.checked_mul(LN_10_WAD)?)?;
    let wad = exp_wad(ln).ok()?;
    let raw = (wad + WAD / 2) / WAD;
    if raw <= 0 || raw > i64::MAX as i128 {
        return None;
    }
    Some(raw as i64)
}

#[cfg(test)]
mod tests {
    use super::*;

    const POOL: &[u8] = include_bytes!("../tests-fixtures/polymarket-pool.bin");
    const OBS: &[u8] = include_bytes!("../tests-fixtures/polymarket-observation.bin");
    const POOL_KEY: Pubkey = pubkey!("5fdWxxkv63NdU7t2CspjyCQrvmMvfe3mQwSgYpHam1Gs");
    const OBS_KEY: Pubkey = pubkey!("AcPAWXqHfqLDujqkG6BNEFJPijHxMHxdz5tz4KcR4t7z");

    fn real() -> (u8, u8, Entries<'static>) {
        let (d0, d1) = check(POOL, OBS, &POOL_KEY, &OBS_KEY).expect("the mainnet accounts parse");
        (d0, d1, Entries(&OBS[OBS_ENTRIES..]))
    }

    /// Entries from (timestamp, cumulative) pairs, the rest empty.
    fn entries(list: &[(u32, i64)]) -> Vec<u8> {
        let mut v = vec![0u8; OBS_COUNT * OBS_ENTRY_LEN];
        for (i, (ts, cum)) in list.iter().enumerate() {
            v[i * OBS_ENTRY_LEN..i * OBS_ENTRY_LEN + 4].copy_from_slice(&ts.to_le_bytes());
            v[i * OBS_ENTRY_LEN + 4..i * OBS_ENTRY_LEN + 12].copy_from_slice(&cum.to_le_bytes());
        }
        v
    }

    #[test]
    fn reads_the_mainnet_polymarket_pool() {
        let (d0, d1, e) = real();
        assert_eq!((d0, d1), (9, 6));
        assert_eq!(e.iter().filter(|x| x.0 > 0).count(), 100);
        // The ten minutes to the newest entry ran at tick -19,500 (the last
        // two entries are 1,639 s apart): $142.29, USDC per PreStocks token.
        let p = price_at(d0, d1, &e, &POOL_KEY.to_bytes(), 1_793_223_578).unwrap();
        assert!((p.price - 14_228_794_306).abs() <= 2, "{}", p.price);
        assert_eq!((p.exponent, p.publish_time, p.prev_publish_time, p.conf), (-8, 1_793_223_578, 1_793_223_577, 0));
    }

    #[test]
    fn needs_an_entry_after_the_instant() {
        let (d0, d1, e) = real();
        // After the newest entry: the pool's current tick is never used.
        assert!(price_at(d0, d1, &e, &POOL_KEY.to_bytes(), 1_793_223_579).is_err());
        // Before the oldest entry plus the window: no start.
        assert!(price_at(d0, d1, &e, &POOL_KEY.to_bytes(), 1_793_134_072 + POOL_TWAP_SECS - 1).is_err());
        assert!(price_at(d0, d1, &e, &POOL_KEY.to_bytes(), 1_793_134_072 + POOL_TWAP_SECS).is_ok());
    }

    #[test]
    fn interpolates_between_entries() {
        // Tick 100 from t=1000 to 2000, then tick 300 to 3000.
        let v = entries(&[(1_000, 0), (2_000, 100_000), (3_000, 400_000)]);
        let e = Entries(&v);
        assert_eq!(cumulative_at(&e, 1_500), Some(50_000));
        assert_eq!(cumulative_at(&e, 2_000), Some(100_000));
        assert_eq!(cumulative_at(&e, 2_600), Some(280_000));
        assert_eq!(cumulative_at(&e, 3_001), None);
        assert_eq!(cumulative_at(&e, 999), None);
        // The 600 s to 2,600 all ran at tick 300.
        let avg = (cumulative_at(&e, 2_600).unwrap() - cumulative_at(&e, 2_000).unwrap()) / 600;
        assert_eq!(avg, 300);
    }

    #[test]
    fn a_tick_is_a_hundredth_of_a_percent() {
        // Same decimals: tick 0 is 1.0 (1e8 raw), tick 10,000 is 1.0001^10000 = e^0.99995 = 2.71815.
        assert_eq!(tick_price(0, 6, 6), Some(100_000_000));
        let p = tick_price(10_000, 6, 6).unwrap();
        assert!((p - 271_814_593).abs() <= 2, "{}", p);
        // Negative ticks and decimals: -19,500 with 9 and 6 is 1000 · 1.0001^-19500.
        let q = tick_price(-19_500, 9, 6).unwrap();
        assert!((q - 14_228_794_306).abs() <= 2, "{}", q);
    }

    #[test]
    fn refuses_mismatched_accounts() {
        assert!(check(POOL, OBS, &OBS_KEY, &OBS_KEY).is_none());
        assert!(check(POOL, OBS, &POOL_KEY, &POOL_KEY).is_none());
        assert!(check(&POOL[..POOL.len() - 1], OBS, &POOL_KEY, &OBS_KEY).is_none());
        let mut o = OBS.to_vec();
        o[0] ^= 1;
        assert!(check(POOL, &o, &POOL_KEY, &OBS_KEY).is_none());
    }
}
