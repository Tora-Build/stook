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

#[cfg(test)]
mod tests {
    use super::*;

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
