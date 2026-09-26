//! A series: one coin's rounds, one a day (or one a period), and what the
//! program knows about how its anchor moves.
//!
//! Every round belongs to a series and is addressed by `(series, index)`, so
//! "one round per day" is the program's rule, not a convention a client
//! keeps, and a calendar can derive every day's address instead of scanning.
//!
//! The series also carries the anchor's volatility, learned from the Pyth
//! price at every day's close (`series_observe`, and each settlement): each
//! close against the last one feeds an exponentially weighted variance of
//! daily log returns. That number sets a round's band width when the round
//! opens, so bands are thin for a quiet anchor and wide for a wild one
//! without anyone choosing.

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

/// Every close is taken in order, from the one Pyth update that is its price
/// (`series_observe`), so nobody chooses which days a series learns from.
/// The single exception is a close whose update can no longer be posted at
/// all (signed by a Wormhole guardian set since retired): a series past its
/// first close may pass over closes once they are this old. Only a keeper
/// outage this long leaves such a close unsubmitted. A warmed-up series
/// learns on across the gap; one still warming up starts its warm-up again
/// from the close it lands on, by the rule a new series starts by, so a
/// skip moves where warm-up starts and never picks which returns it counts.
pub const SKIP_AFTER_SECS: i64 = 7 * 24 * 60 * 60;

/// How far back a series that has learned nothing may start learning from.
pub const BACKFILL_WINDOW_SECS: i64 = 45 * 24 * 60 * 60;

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

    /// The index whose close is exactly `at`, if any.
    pub fn index_of(&self, at: i64) -> Option<u32> {
        let span = if self.period_secs > 0 { self.period_secs as i64 } else { DAY };
        let guess = (at - self.close_secs as i64).div_euclid(span);
        for i in [guess, guess + 1, guess - 1] {
            if i >= 0 && i <= u32::MAX as i64 && self.close_of(i as u32) == at {
                return Some(i as u32);
            }
        }
        None
    }

    /// The latest index with a round whose close is at or before `t`.
    pub fn index_at_or_before(&self, t: i64) -> u32 {
        let span = if self.period_secs > 0 { self.period_secs as i64 } else { DAY };
        let mut i = ((t - self.close_secs as i64).div_euclid(span) + 1).clamp(0, u32::MAX as i64) as u32;
        let mut guard = 0;
        while i > 0 && guard < 16 && (self.close_of(i) > t || !self.has_round(i)) {
            i -= 1;
            guard += 1;
        }
        i
    }

    /// The next index after `index` that has a round.
    pub fn next_round(&self, index: u32) -> u32 {
        let mut i = index.saturating_add(1);
        while !self.has_round(i) {
            i = i.saturating_add(1);
        }
        i
    }

    /// May the close of `index` be taken now? Strictly in order: after the
    /// first close, only the next day with a round (see `SKIP_AFTER_SECS` for
    /// the one exception). A series starts from a close at least
    /// `WARMUP_OBSERVATIONS` rounds back and inside `BACKFILL_WINDOW_SECS`, so
    /// it warms up from Pyth's history rather than waiting a month, and
    /// nobody can start it late to delay that. Until its first return it may
    /// start again from an earlier close.
    pub fn may_observe(&self, index: u32, now: i64) -> bool {
        if !self.has_round(index) {
            return false;
        }
        let at = self.close_of(index);
        if at > now {
            return false;
        }
        let may_start = || at >= now - BACKFILL_WINDOW_SECS && index <= self.rounds_back(self.index_at_or_before(now), WARMUP_OBSERVATIONS);
        let Some(last) = (self.last_at > 0).then(|| self.index_of(self.last_at)).flatten() else {
            return may_start();
        };
        if index == last {
            return false;
        }
        if index < last {
            return self.observations == 0 && may_start();
        }
        let next = self.next_round(last);
        if index == next {
            return true;
        }
        // A jump, only over closes so old that their updates may no longer be
        // postable. A series still warming up starts again where it lands
        // (`restarts_at`), so only where a new series may start: otherwise
        // one unpostable close would leave it cold for good, and a jump
        // could not be used to start it late.
        let mut prev = index - 1;
        while prev > last && !self.has_round(prev) {
            prev -= 1;
        }
        self.close_of(prev) <= now - SKIP_AFTER_SECS && (self.warmed_up() || may_start())
    }

    /// Is the close at `at` a jump by a series still warming up, past the
    /// next close it was due? Then it learns no return across the gap: its
    /// warm-up starts again from `at`, as a new series's would.
    fn restarts_at(&self, at: i64) -> bool {
        if self.warmed_up() || self.last_at <= 0 || at <= self.last_at {
            return false;
        }
        match (self.index_of(self.last_at), self.index_of(at)) {
            (Some(last), Some(i)) => i != self.next_round(last),
            _ => false,
        }
    }

    /// Forget what warm-up has learned and start again from the close at `at`.
    fn restart(&mut self, price: i64, expo: i32, at: i64) {
        self.observations = 0;
        self.var_wad = 0;
        self.last_price = price;
        self.last_expo = expo;
        self.last_at = at;
    }

    /// The index `n` rounds before `index` (skipping days without one).
    pub fn rounds_back(&self, index: u32, n: u32) -> u32 {
        let (mut i, mut left) = (index, n);
        while left > 0 && i > 0 {
            i -= 1;
            if self.has_round(i) {
                left -= 1;
            }
        }
        i
    }

    /// Move to the close at `at` without learning a return: its price is
    /// known but not good enough to measure a move with (Pyth was late or
    /// unsure at the close). The next return runs from here.
    pub fn rebase(&mut self, price: i64, expo: i32, at: i64) {
        if price > 0 && self.restarts_at(at) {
            self.restart(price, expo, at);
        } else if price > 0 && (at > self.last_at || self.observations == 0) {
            self.last_price = price;
            self.last_expo = expo;
            self.last_at = at;
        }
    }

    /// Seconds the return since the last close stands for. Calendar time,
    /// except on a weekday clock, where a weekend is not two quiet days: the
    /// return is scaled by trading days, as a stock's volatility is.
    fn span_secs(&self, at: i64) -> i64 {
        if self.period_secs == 0 && self.clock == CLOCK_NEW_YORK_WEEKDAYS {
            if let (Some(a), Some(b)) = (self.index_of(self.last_at), self.index_of(at)) {
                let days = (a + 1..=b).take(400).filter(|&d| self.has_round(d)).count() as i64;
                return days.max(1) * DAY;
            }
        }
        at - self.last_at
    }

    /// Does day (or period) `index` have a round at all?
    pub fn has_round(&self, index: u32) -> bool {
        self.period_secs > 0
            || self.clock != CLOCK_NEW_YORK_WEEKDAYS
            || !(matches!(crate::math::calendar::weekday(index as i64), 0 | 6) || crate::math::calendar::nyse_holiday(index as i64))
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
    /// One that jumps past a missed close while warming up starts warm-up
    /// again from here (`restarts_at`).
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
        if self.restarts_at(at) {
            self.restart(price, expo, at);
            return Ok(());
        }
        if self.last_price > 0 && self.last_expo == expo {
            // The ratio of two raw prices on one exponent. Dividing the raw
            // prices directly: scaling both by WAD first overflowed the divisor
            // for any price above ~7.9e10 raw (BTC, ETH), and every settle
            // after the first reverted.
            let r = ln_wad(wad_div(price as i128, self.last_price as i128)?)?;
            let r2_day = wad_mul(r, r)?.checked_mul(DAY as i128).ok_or(MathError::Overflow)? / self.span_secs(at) as i128;
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
    fn closes_are_learned_in_order() {
        let mut s = daily(CLOCK_UTC, 20 * 3600);
        let d = days_from_civil(2026, 9, 1) as u32;
        let now = s.close_of(d + 40) + 60;
        // cold: only from far enough back that it warms from history, and
        // not so far back that the history is gone
        assert!(!s.may_observe(d + 35, now), "too recent to start from: it would delay warm-up");
        assert!(s.may_observe(d + 20, now));
        assert!(s.may_observe(d, now));
        assert!(!s.may_observe(d - 10, now), "outside the backfill window");
        assert!(!s.may_observe(d + 41, now), "not closed yet");
        s.observe(100, 0, s.close_of(d + 10)).unwrap();
        assert!(s.may_observe(d + 5, now), "start again earlier while cold");
        s.observe(100, 0, s.close_of(d + 5)).unwrap();
        s.observe(101, 0, s.close_of(d + 6)).unwrap();
        assert_eq!(s.observations, 1);
        // then every day, in order: never back, and no jump over a close
        // that is still timely
        assert!(!s.may_observe(d + 5, now));
        assert!(!s.may_observe(d + 6, now));
        assert!(s.may_observe(d + 7, now));
        assert!(!s.may_observe(d + 9, s.close_of(d + 9) + 60), "a still-cold series never skips a timely close");
        // a close Pyth was unsure about moves the series on without a return
        s.rebase(150, 0, s.close_of(d + 7));
        assert_eq!((s.observations, s.last_price), (1, 150));
        assert!(s.may_observe(d + 8, now));
        // a warmed-up series may pass closes a week old (updates no longer postable)
        s.observations = WARMUP_OBSERVATIONS;
        assert!(!s.may_observe(d + 9, s.close_of(d + 8) + 6 * DAY));
        assert!(s.may_observe(d + 9, s.close_of(d + 8) + 7 * DAY));
        assert_eq!(s.index_of(s.close_of(d + 7)), Some(d + 7));
        assert_eq!(s.index_at_or_before(s.close_of(d + 7) + 5), d + 7);
        assert_eq!(s.index_at_or_before(s.close_of(d + 7) - 5), d + 6);
        assert_eq!(s.rounds_back(d + 40, 20), d + 20);
    }

    /// A series one return in, whose next close can never be posted. Once
    /// that close is a week old it may be passed, but only onto a close a new
    /// series could start from, and warm-up starts again there: a skip moves
    /// where warm-up starts and never picks which returns it counts.
    #[test]
    fn a_cold_series_past_an_unpostable_close_starts_its_warm_up_again() {
        let mut s = daily(CLOCK_UTC, 0);
        let d = days_from_civil(2026, 9, 1) as u32;
        s.observe(100_000, -2, s.close_of(d)).unwrap();
        s.observe(101_000, -2, s.close_of(d + 1)).unwrap();
        assert_eq!(s.observations, 1);
        assert!(!s.warmed_up());
        // d + 2 cannot be posted. d + 3 waits while d + 2 is under a week old,
        // and then while it is too recent to warm up from history.
        let gone = s.close_of(d + 2);
        assert!(!s.may_observe(d + 3, s.close_of(d + 3) + 60), "the day after: still timely");
        assert!(!s.may_observe(d + 3, gone + SKIP_AFTER_SECS + 60), "a week on: too recent to start from");
        let later = s.close_of(d + 23) + 60;
        assert!(s.may_observe(d + 3, later), "twenty rounds on");
        for days in [60, 365] {
            let now = gone + days * DAY;
            assert!(!s.may_observe(d + 3, now), "{days} days on: outside the backfill window");
            let start = s.rounds_back(s.index_at_or_before(now), WARMUP_OBSERVATIONS);
            assert!(s.may_observe(start, now), "{days} days on: from where a new series starts");
        }
        // Never a close still timely, and never one too recent to warm from.
        assert!(!s.may_observe(d + 4, later), "only as far as a new series may start");
        assert!(!s.may_observe(d + 22, later), "too recent to start from");
        // Landing there teaches no return over the gap: warm-up starts again.
        s.observe(150_000, -2, s.close_of(d + 3)).unwrap();
        assert_eq!((s.observations, s.var_wad, s.last_at), (0, 0, s.close_of(d + 3)));
        s.observe(151_000, -2, s.close_of(d + 4)).unwrap();
        assert_eq!(s.observations, 1);
        // A close Pyth was unsure about starts it again the same way.
        let mut r = daily(CLOCK_UTC, 0);
        r.observe(100_000, -2, r.close_of(d)).unwrap();
        r.observe(101_000, -2, r.close_of(d + 1)).unwrap();
        r.rebase(150_000, -2, r.close_of(d + 3));
        assert_eq!((r.observations, r.last_at), (0, r.close_of(d + 3)));

        // A warmed-up series: passes a week-old close and learns on across it.
        let mut w = daily(CLOCK_UTC, 0);
        w.observe(100_000, -2, w.close_of(d)).unwrap();
        w.observations = WARMUP_OBSERVATIONS;
        assert!(w.warmed_up());
        assert!(!w.may_observe(d + 2, w.close_of(d + 1) + SKIP_AFTER_SECS - 1));
        assert!(w.may_observe(d + 2, w.close_of(d + 1) + SKIP_AFTER_SECS));
        assert!(w.may_observe(d + 1, w.close_of(d + 1) + 60));
        w.observe(101_000, -2, w.close_of(d + 2)).unwrap();
        assert_eq!(w.observations, WARMUP_OBSERVATIONS + 1);
    }

    #[test]
    fn a_weekday_series_scales_monday_by_one_trading_day() {
        let mut s = daily(CLOCK_NEW_YORK_WEEKDAYS, 16 * 3600);
        s.var_wad = 400_000_000_000_000; // 2%/day
        let fri = days_from_civil(2026, 9, 18) as u32;
        let (mon, now) = (fri + 3, s.close_of(fri + 3) + 60);
        assert!(!s.has_round(fri + 1));
        s.observe(1_000_000, 0, s.close_of(fri)).unwrap();
        assert!(s.may_observe(mon, now), "the weekend is not skipped, it has no rounds");
        let mut t = s.clone();
        t.observe(1_020_000, 0, s.close_of(mon)).unwrap(); // +2% over the weekend
        // a 2% move on a 2%/day series leaves it where it was, not a third of it
        let r = t.var_wad as f64 / 400_000_000_000_000f64;
        assert!(r > 0.97 && r < 1.03, "{r}");
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
