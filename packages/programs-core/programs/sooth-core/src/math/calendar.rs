//! Wall-clock closes, computed on chain. A series settles at the same local
//! time every day ("4 PM New York"), and the program, not the caller, turns a
//! day number into the second a round settles. So one day has one round, and
//! two people in different timezones fund the same one.
//!
//! Civil-date arithmetic is Howard Hinnant's `days_from_civil`; US daylight
//! saving is the 2007 rule (second Sunday of March to first Sunday of
//! November). A close before 3 AM local would sit on the switch itself, so
//! a series close is required to be at or after 3 AM.

pub const DAY: i64 = 86_400;

/// Days since 1970-01-01 of the proleptic Gregorian date (y, m 1..=12, d).
pub fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// (y, m, d) of a day number.
pub fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (yoe + era * 400 + if m <= 2 { 1 } else { 0 }, m, d)
}

/// 0 = Sunday.
pub fn weekday(day: i64) -> i64 {
    (day + 4).rem_euclid(7)
}

/// The day number of the `n`th (1-based) Sunday of month `m` in year `y`.
fn nth_sunday(y: i64, m: i64, n: i64) -> i64 {
    let first = days_from_civil(y, m, 1);
    first + (7 - weekday(first)) % 7 + 7 * (n - 1)
}

/// Is New York on daylight time for (the afternoon of) this day?
pub fn new_york_dst(day: i64) -> bool {
    let (y, _, _) = civil_from_days(day);
    day >= nth_sunday(y, 3, 2) && day < nth_sunday(y, 11, 1)
}

/// Seconds east of UTC in New York on this day: −4 h in summer, −5 h in winter.
pub fn new_york_offset(day: i64) -> i64 {
    if new_york_dst(day) { -4 * 3600 } else { -5 * 3600 }
}

/// The day number of the `n`th (1-based) `wd` (0 = Sunday) of month `m`.
fn nth_weekday(y: i64, m: i64, wd: i64, n: i64) -> i64 {
    let first = days_from_civil(y, m, 1);
    first + (wd - weekday(first)).rem_euclid(7) + 7 * (n - 1)
}

/// The last `wd` of month `m`.
fn last_weekday(y: i64, m: i64, wd: i64) -> i64 {
    let last = days_from_civil(y, m + 1, 1) - 1; // m + 1 = 13 is January next year
    last - (weekday(last) - wd).rem_euclid(7)
}

/// Easter Sunday (Gregorian), by the anonymous Meeus/Jones/Butcher rule.
fn easter(y: i64) -> i64 {
    let (a, b, c) = (y % 19, y / 100, y % 100);
    let (d, e) = (b / 4, b % 4);
    let g = (8 * b + 13) / 25;
    let h = (19 * a + b - d - g + 15) % 30;
    let (i, k) = (c / 4, c % 4);
    let l = (32 + 2 * e + 2 * i - h - k) % 7;
    let m = (a + 11 * h + 22 * l) / 451;
    let month = (h + l - 7 * m + 114) / 31;
    let day = (h + l - 7 * m + 114) % 31 + 1;
    days_from_civil(y, month, day)
}

/// The weekday a fixed-date holiday is observed on: Saturday's on the Friday
/// before, Sunday's on the Monday after.
fn observed(day: i64) -> i64 {
    match weekday(day) {
        6 => day - 1,
        0 => day + 1,
        _ => day,
    }
}

/// Is the New York Stock Exchange closed all day for a holiday? Its rule
/// (NYSE Rule 7.2), computed, so it never runs out: New Year's Day, Martin
/// Luther King Jr. Day, Washington's Birthday, Good Friday, Memorial Day,
/// Juneteenth (from 2022), Independence Day, Labor Day, Thanksgiving and
/// Christmas, a Saturday holiday observed on the Friday before and a Sunday
/// one on the Monday after, except that New Year's Day on a Saturday is not
/// observed at all. Early closes (1 PM) are trading days. Unscheduled
/// closures (a national day of mourning) cannot be known ahead; a round on
/// one voids.
pub fn nyse_holiday(day: i64) -> bool {
    let (y, _, _) = civil_from_days(day);
    let new_year = days_from_civil(y, 1, 1);
    (weekday(new_year) != 6 && day == observed(new_year))
        || day == nth_weekday(y, 1, 1, 3)
        || day == nth_weekday(y, 2, 1, 3)
        || day == easter(y) - 2
        || day == last_weekday(y, 5, 1)
        || (y >= 2022 && day == observed(days_from_civil(y, 6, 19)))
        || day == observed(days_from_civil(y, 7, 4))
        || day == nth_weekday(y, 9, 1, 1)
        || day == nth_weekday(y, 11, 4, 4)
        || day == observed(days_from_civil(y, 12, 25))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nyse_holidays_match_the_exchange_calendar() {
        let d = |y, m, dd| days_from_civil(y, m, dd);
        // The NYSE's published 2026 and 2027 holidays.
        let listed = [
            d(2026, 1, 1), d(2026, 1, 19), d(2026, 2, 16), d(2026, 4, 3), d(2026, 5, 25), d(2026, 6, 19),
            d(2026, 7, 3), d(2026, 9, 7), d(2026, 11, 26), d(2026, 12, 25),
            d(2027, 1, 1), d(2027, 1, 18), d(2027, 2, 15), d(2027, 3, 26), d(2027, 5, 31), d(2027, 6, 18),
            d(2027, 7, 5), d(2027, 9, 6), d(2027, 11, 25), d(2027, 12, 24),
        ];
        for day in d(2026, 1, 1)..d(2028, 1, 1) {
            let weekend = matches!(weekday(day), 0 | 6);
            assert_eq!(nyse_holiday(day) && !weekend, listed.contains(&day), "{:?}", civil_from_days(day));
        }
        // New Year's Day 2028 is a Saturday: the exchange stays open on Friday 31 December 2027.
        assert!(!nyse_holiday(d(2027, 12, 31)));
        // Juneteenth only from 2022; Good Friday 2025 was 18 April; Thanksgiving 2025 the 27th.
        assert!(!nyse_holiday(d(2021, 6, 18)));
        assert!(nyse_holiday(d(2025, 4, 18)));
        assert!(nyse_holiday(d(2025, 11, 27)));
        // Early closes are trading days.
        assert!(!nyse_holiday(d(2026, 11, 27)));
        assert!(!nyse_holiday(d(2026, 12, 24)));
    }

    #[test]
    fn civil_dates_round_trip_and_known_days_land_right() {
        for z in -800_000..800_000i64 {
            if z % 997 != 0 { continue; }
            let (y, m, d) = civil_from_days(z);
            assert_eq!(days_from_civil(y, m, d), z);
        }
        assert_eq!(days_from_civil(1970, 1, 1), 0);
        assert_eq!(weekday(0), 4, "a Thursday");
        assert_eq!(days_from_civil(2026, 9, 23), 20_719);
        assert_eq!(weekday(20_719), 3, "2026-09-23 is a Wednesday");
    }

    #[test]
    fn new_york_switches_on_the_second_sunday_of_march_and_the_first_of_november() {
        // 2026: 8 March and 1 November. 2027: 14 March and 7 November.
        let d = |y, m, dd| days_from_civil(y, m, dd);
        assert!(!new_york_dst(d(2026, 3, 7)));
        assert!(new_york_dst(d(2026, 3, 8)));
        assert!(new_york_dst(d(2026, 10, 31)));
        assert!(!new_york_dst(d(2026, 11, 1)));
        assert!(!new_york_dst(d(2027, 3, 13)));
        assert!(new_york_dst(d(2027, 3, 14)));
        assert!(new_york_dst(d(2027, 11, 6)));
        assert!(!new_york_dst(d(2027, 11, 7)));
        // 4 PM New York on 2026-09-30 is 20:00 UTC; on 2026-11-02, 21:00 UTC.
        let close = |day: i64| day * DAY + 16 * 3600 - new_york_offset(day);
        assert_eq!(close(d(2026, 9, 30)), 1_790_798_400);
        assert_eq!(close(d(2026, 11, 2)), 1_793_653_200);
    }
}
