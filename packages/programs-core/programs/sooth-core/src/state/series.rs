//! A series: one coin's rounds, one a day (or one a period), and what the
//! program knows about how its anchor moves.
//!
//! Every round belongs to a series and is addressed by `(series, index)`, so
//! "one round per day" is the program's rule, not a convention a client
//! keeps, and a calendar can derive every day's address instead of scanning.
//!
//! The series also carries the anchor's volatility, and it learns it from its
//! own settlements: each settled round's price, against the last one, feeds
//! an exponentially weighted variance of daily log returns. That number sets
//! the band width of every round the series starts next, so bands are thin
//! for a quiet anchor and wide for a wild one without anyone choosing.

use anchor_lang::prelude::*;

use crate::math::calendar::{new_york_offset, DAY};
use crate::math::lmsr::ln_wad;
use crate::math::wad::{wad_div, wad_mul, MathError};

pub const SERIES_SEED: &[u8] = b"series";

/// Which wall clock a daily series closes by, and on which days.
pub const CLOCK_UTC: u8 = 0;
pub const CLOCK_NEW_YORK: u8 = 1;
/// New York, Monday to Friday: for anchors that trade on stock-market hours.
/// A weekend day has no round.
pub const CLOCK_NEW_YORK_WEEKDAYS: u8 = 2;

/// Weight kept on yesterday's variance each time a day is observed: a memory
/// of about two weeks (half-life 11 days). The backtest found a week (0.90)
/// and a month (0.97) within noise of this.
pub const VAR_KEEP_NUM: i128 = 94;
pub const VAR_KEEP_DEN: i128 = 100;

/// Closes a series must learn from before it takes its first round. Until
/// then its volatility is a plain average of what it has seen; after, the
/// weighted average below. Twenty is about a month of trading days.
pub const WARMUP_OBSERVATIONS: u32 = 20;

/// A daily σ between 0.1% and 30%, as variance (WAD). Outside that is a bad
/// print or a broken feed, not an asset.
pub const VAR_MIN: i128 = 1_000_000_000_000;
pub const VAR_MAX: i128 = 90_000_000_000_000_000;

#[account]
#[derive(Debug)]
pub struct Series {
    pub feed_id: [u8; 32],
    pub quote_mint: Pubkey,
    /// 0: one round per calendar day of `clock`, closing `close_secs` after
    /// local midnight. Otherwise one round every `period_secs`, closing
    /// `close_secs` into the period (for testing on a fast clock).
    pub period_secs: u32,
    pub close_secs: u32,
    pub clock: u8,
    /// New rounds may start only while active. Running rounds are untouched.
    pub active: bool,
    pub bump: u8,
    /// Variance of daily log returns, WAD. Learned only from Pyth closing
    /// prices, checked on chain (`observe`): nobody supplies it, nobody can
    /// reset it. Zero until the first return is seen.
    pub var_wad: i128,
    /// The last settlement observed: price, its exponent, and when.
    pub last_price: i64,
    pub last_expo: i32,
    pub last_at: i64,
    pub observations: u32,
}

impl Series {
    pub const SPACE: usize = 8 + 32 + 32 + 4 + 4 + 1 + 1 + 1 + 16 + 8 + 4 + 8 + 4;

    /// The second round `index` settles. For a daily series `index` is the
    /// day number (days since 1970-01-01) of the local calendar date.
    pub fn close_of(&self, index: u32) -> i64 {
        let index = index as i64;
        if self.period_secs > 0 {
            return index * self.period_secs as i64 + self.close_secs as i64;
        }
        let local = index * DAY + self.close_secs as i64;
        match self.clock {
            CLOCK_NEW_YORK | CLOCK_NEW_YORK_WEEKDAYS => local - new_york_offset(index),
            _ => local,
        }
    }

    /// Does day (or period) `index` have a round at all?
    pub fn has_round(&self, index: u32) -> bool {
        self.period_secs > 0
            || self.clock != CLOCK_NEW_YORK_WEEKDAYS
            || !matches!(crate::math::calendar::weekday(index as i64), 0 | 6)
    }

    /// Has it seen enough closes to size a round's bands?
    pub fn warmed_up(&self) -> bool {
        self.observations >= WARMUP_OBSERVATIONS && self.var_wad > 0
    }

    /// Fold a closing price into the variance: the squared log return since
    /// the last one, scaled to a day. During warm-up a plain average of the
    /// returns seen; after it, weighted in at 6%. An observation older
    /// than the last one (a round settled late) teaches nothing and is
    /// skipped; so is one on a different exponent, which only re-anchors.
    pub fn observe(&mut self, price: i64, expo: i32, at: i64) -> core::result::Result<(), MathError> {
        if price <= 0 || at == self.last_at {
            return Ok(());
        }
        // Until a series has learned one return, its only close is a starting
        // point: an earlier close may take its place (so a backfill that lost
        // the race to a later close can still start from the beginning).
        // After that, closes are taken in order only.
        if at < self.last_at {
            if self.observations > 0 {
                return Ok(());
            }
            self.last_price = price;
            self.last_expo = expo;
            self.last_at = at;
            return Ok(());
        }
        if self.last_price > 0 && self.last_expo == expo {
            // The ratio of two raw prices on one exponent. Dividing the raw
            // prices directly: scaling both by WAD first overflowed the divisor
            // for any price above ~7.9e10 raw (BTC, ETH), and every settle
            // after the first reverted.
            let r = ln_wad(wad_div(price as i128, self.last_price as i128)?)?;
            let r2_day = wad_mul(r, r)?.checked_mul(DAY as i128).ok_or(MathError::Overflow)? / (at - self.last_at) as i128;
            let r2 = r2_day.min(VAR_MAX);
            let n = self.observations as i128;
            let v = if self.observations < WARMUP_OBSERVATIONS {
                (self.var_wad * n + r2) / (n + 1)
            } else {
                (VAR_KEEP_NUM * self.var_wad + (VAR_KEEP_DEN - VAR_KEEP_NUM) * r2) / VAR_KEEP_DEN
            };
            self.var_wad = v.clamp(VAR_MIN, VAR_MAX);
            self.observations = self.observations.saturating_add(1);
        }
        self.last_price = price;
        self.last_expo = expo;
        self.last_at = at;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::math::calendar::days_from_civil;

    fn daily(clock: u8, close_secs: u32) -> Series {
        Series { feed_id: [0; 32], quote_mint: Pubkey::default(), period_secs: 0, close_secs, clock, active: true, bump: 0, var_wad: 4 * VAR_MIN * 100, last_price: 0, last_expo: 0, last_at: 0, observations: 0 }
    }

    #[test]
    fn a_new_york_series_closes_at_four_pm_new_york_through_daylight_saving() {
        let s = daily(CLOCK_NEW_YORK, 16 * 3600);
        assert_eq!(s.close_of(days_from_civil(2026, 9, 30) as u32), 1_790_798_400);
        assert_eq!(s.close_of(days_from_civil(2026, 11, 2) as u32), 1_793_653_200);
        let u = daily(CLOCK_UTC, 20 * 3600);
        assert_eq!(u.close_of(days_from_civil(2026, 9, 30) as u32), 1_790_798_400);
        let mut p = daily(CLOCK_UTC, 0);
        p.period_secs = 3_600;
        p.close_secs = 0;
        assert_eq!(p.close_of(500_000), 1_800_000_000);
    }

    #[test]
    fn it_learns_from_bitcoin_scale_prices() {
        // BTC at $110,000 with exponent -8 is 1.1e13 raw; the first version
        // overflowed here on the second settlement.
        let mut s = daily(CLOCK_UTC, 0);
        s.var_wad = 625_000_000_000_000; // 2.5%/day
        s.observe(11_000_000_000_000, -8, 1_000).unwrap();
        s.observe(11_550_000_000_000, -8, 1_000 + DAY).unwrap(); // +5%
        s.observe(11_000_000_000_000, -8, 1_000 + 2 * DAY).unwrap();
        assert_eq!(s.observations, 2);
        assert!(!s.warmed_up());
        assert!(s.var_wad > 625_000_000_000_000, "a 5% day raises it");
        // and at the largest raw price an i64 holds
        s.observe(i64::MAX, -8, 1_000 + 3 * DAY).unwrap();
    }

    #[test]
    fn a_new_series_averages_its_first_closes_then_weights_them() {
        let mut s = daily(CLOCK_UTC, 0);
        s.var_wad = 0;
        let mut p = 100_000_000i64;
        s.observe(p, -6, 1_000).unwrap();
        for d in 1..=WARMUP_OBSERVATIONS as i64 {
            p = if d % 2 == 0 { p * 102 / 100 } else { p * 100 / 102 }; // ±2% a day
            s.observe(p, -6, 1_000 + d * DAY).unwrap();
        }
        assert!(s.warmed_up());
        let sigma = ((s.var_wad as f64) / 1e18).sqrt();
        assert!((sigma - 0.0198).abs() < 0.0005, "{sigma}");
    }

    #[test]
    fn a_weekday_series_has_no_weekend_rounds() {
        let s = daily(CLOCK_NEW_YORK_WEEKDAYS, 16 * 3600);
        let fri = days_from_civil(2026, 9, 25) as u32;
        assert!(s.has_round(fri));
        assert!(!s.has_round(fri + 1) && !s.has_round(fri + 2));
        assert!(s.has_round(fri + 3));
        assert_eq!(s.close_of(fri), daily(CLOCK_NEW_YORK, 16 * 3600).close_of(fri));
    }

    #[test]
    fn the_variance_learns_from_settlements_and_skips_what_cannot_teach() {
        let mut s = daily(CLOCK_UTC, 0);
        s.var_wad = 400_000_000_000_000; // 2%/day
        s.observe(100_000, -2, 1_000).unwrap(); // first: anchors only
        assert_eq!(s.var_wad, 400_000_000_000_000);
        // a 10% day: r² ≈ 0.00908, so v = 0.94·0.0004 + 0.06·0.00908
        s.observations = WARMUP_OBSERVATIONS; // past warm-up: the weighted average
        s.observe(110_000, -2, 1_000 + DAY).unwrap();
        let want = (94 * 400_000_000_000_000i128 + 6 * 9_084_000_000_000_000) / 100;
        assert!((s.var_wad - want).abs() < want / 1_000, "{} vs {}", s.var_wad, want);
        let v = s.var_wad;
        s.observe(90_000, -2, 1_000).unwrap(); // older than the last: skipped
        assert_eq!(s.var_wad, v);
        // but a series that has learned nothing yet may start earlier
        let mut fresh = daily(CLOCK_UTC, 0);
        fresh.observe(200, -2, 10 * DAY).unwrap();
        fresh.observe(100, -2, 3 * DAY).unwrap();
        assert_eq!((fresh.last_at, fresh.last_price, fresh.observations), (3 * DAY, 100, 0));
        fresh.observe(101, -2, 4 * DAY).unwrap();
        assert_eq!(fresh.observations, 1);
        // half a day's move counts double per day
        let mut a = daily(CLOCK_UTC, 0);
        a.var_wad = s.var_wad;
        a.observations = WARMUP_OBSERVATIONS;
        a.observe(100_000, -2, 1).unwrap();
        a.observe(101_000, -2, 1 + DAY / 2).unwrap();
        let mut b = daily(CLOCK_UTC, 0);
        b.var_wad = s.var_wad;
        b.observations = WARMUP_OBSERVATIONS;
        b.observe(100_000, -2, 1).unwrap();
        b.observe(101_000, -2, 1 + DAY).unwrap();
        assert!(a.var_wad > b.var_wad);
        // a flat week pulls it toward the floor, never through it
        for d in 2..400 { a.observe(101_000, -2, d * DAY).unwrap(); }
        assert_eq!(a.var_wad, VAR_MIN);
    }
}
