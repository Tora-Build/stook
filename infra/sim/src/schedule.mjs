// When the fleet acts. Arrivals are a Poisson process whose rate follows New
// York's trading day: quiet overnight, a lift at the 9:30 open, busiest in
// the last hour of trading (2 to 3 PM: a round closing at 4 locks an hour
// before, as `roundTimes` sets it, and the fee ramps up to its top), then
// quiet while rounds are locked, and lower but not silent on weekends.
// It never acts from 15:50 to 16:15 New York, when every round settles and
// the next day's open, nor near any round of ours opening or settling:
// those minutes belong to the keeper and its RPC.

const NY = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", hourCycle: "h23", weekday: "short",
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
});
const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** New York's calendar and clock at `ms`: date (YYYY-MM-DD), weekday (0 Sunday), minute of the day. */
export function nyClock(ms) {
  const p = Object.fromEntries(NY.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const hour = Number(p.hour) % 24;
  return { date: `${p.year}-${p.month}-${p.day}`, weekday: WEEKDAYS[p.weekday], minute: hour * 60 + Number(p.minute), hour };
}

// Busyness by New York hour on a weekday, 1 at the busiest.
const HOURLY = [
  0.06, 0.05, 0.04, 0.04, 0.05, 0.07, 0.12, 0.2, 0.3, 0.55, 0.75, 0.6,
  0.45, 0.45, 0.85, 0.3, 0.5, 0.45, 0.4, 0.35, 0.3, 0.25, 0.15, 0.1,
];
export const OPEN_PEAK = [570, 630]; // 9:30 to 10:30
export const CLOSE_PEAK = [840, 900]; // 14:00 to 15:00, the hour before the lock
export const BELL_PAUSE = [950, 975]; // 15:50 to 16:15

/** Relative busyness at `ms`, 0 to 1, before any pause. */
export function intensity(ms, { weekend = 0.35 } = {}) {
  const c = nyClock(ms);
  let v = HOURLY[c.hour];
  if (c.minute >= OPEN_PEAK[0] && c.minute < OPEN_PEAK[1]) v = 0.9;
  if (c.minute >= CLOSE_PEAK[0] && c.minute < CLOSE_PEAK[1]) v = 1;
  if (c.weekday === 0 || c.weekday === 6) v *= weekend;
  return v;
}

// Around a round's open and close the keeper posts prices and cranks; the
// fleet keeps off the chain from a minute before until it has had time.
export const QUIET_BEFORE_SECS = 60;
export const QUIET_AFTER_OPEN_SECS = 300;
export const QUIET_AFTER_SETTLE_SECS = 180;

/**
 * Why the fleet must not act at `ms`, or null. `rounds` are the rounds of
 * ours it knows of (decoded, with `status`, `opensAt`, `settlesAt`).
 */
export function pauseReason(ms, rounds = []) {
  const c = nyClock(ms);
  if (c.minute >= BELL_PAUSE[0] && c.minute < BELL_PAUSE[1]) return "bell (15:50 to 16:15 New York)";
  const t = BigInt(Math.floor(ms / 1000));
  for (const l of rounds) {
    if (!l) continue;
    const near = (at, after) => t >= at - BigInt(QUIET_BEFORE_SECS) && t < at + BigInt(after);
    if (l.status === "seeding" && near(l.opensAt, QUIET_AFTER_OPEN_SECS)) return `a round opens at ${new Date(Number(l.opensAt) * 1000).toISOString()}`;
    if (l.status === "open" && near(l.settlesAt, QUIET_AFTER_SETTLE_SECS)) return `a round settles at ${new Date(Number(l.settlesAt) * 1000).toISOString()}`;
  }
  return null;
}

/** Arrivals per minute at `ms`: the cap, times how busy the fleet is meant to be, times the hour's busyness. */
export function ratePerMin(ms, cfg) {
  return cfg.txPerMin * cfg.activity * intensity(ms, cfg);
}

/**
 * The next arrival after `ms`, by thinning: candidates at the peak rate,
 * each kept with the hour's share of it. Pauses are not skipped here; an
 * arrival that falls in one is dropped when it comes, since a pause can
 * appear (a round funded late) after the arrival was drawn.
 */
export function nextArrival(ms, rng, cfg) {
  const peak = cfg.txPerMin * cfg.activity;
  if (!(peak > 0)) return ms + 3_600_000;
  let t = ms;
  for (let n = 0; n < 100_000; n++) {
    t += (-Math.log(1 - rng()) / peak) * 60_000;
    if (rng() < intensity(t, cfg)) return t;
  }
  return t;
}
