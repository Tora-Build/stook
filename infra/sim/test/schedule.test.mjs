// The fleet's clock: busy when New York trades, quiet overnight, lower on
// weekends, and never on the chain around the bell or a round of ours.
import { test } from "node:test";
import assert from "node:assert/strict";
import { intensity, nextArrival, nyClock, pauseReason, ratePerMin } from "../src/schedule.mjs";
import { rngFrom } from "../src/personas.mjs";
import { cfgFor } from "./helpers.mjs";

// A Tuesday in daylight time (UTC-4) and one in standard time (UTC-5).
const at = (y, m, d, hNy, min, offset = 4) => Date.UTC(y, m - 1, d, hNy + offset, min);

test("New York clock follows daylight saving", () => {
  assert.equal(nyClock(at(2026, 9, 29, 15, 50)).minute, 15 * 60 + 50);
  assert.equal(nyClock(at(2026, 12, 1, 15, 50, 5)).minute, 15 * 60 + 50);
  assert.equal(nyClock(at(2026, 9, 27, 12, 0)).weekday, 0);
});

test("busiest in the hour before the lock, quiet overnight, weekends lower but not silent", () => {
  const close = intensity(at(2026, 9, 29, 14, 20));
  // From 15:00 the rounds closing at 4 are locked: little to do.
  assert.ok(intensity(at(2026, 9, 29, 15, 20)) <= 0.3);
  const open = intensity(at(2026, 9, 29, 9, 45));
  const night = intensity(at(2026, 9, 29, 3, 0));
  const noon = intensity(at(2026, 9, 29, 12, 30));
  assert.equal(close, 1);
  assert.ok(open > noon && noon > night);
  assert.ok(night > 0 && night < 0.1);
  const sat = intensity(at(2026, 10, 3, 14, 20));
  assert.ok(sat > 0 && sat < close);
});

test("hard pause from 15:50 to 16:15 New York, in both seasons", () => {
  for (const off of [4, 5]) {
    const [y, m, d] = off === 4 ? [2026, 9, 29] : [2026, 12, 1];
    assert.equal(pauseReason(at(y, m, d, 15, 49, off)), null);
    assert.match(pauseReason(at(y, m, d, 15, 50, off)), /bell/);
    assert.match(pauseReason(at(y, m, d, 16, 14, off)), /bell/);
    assert.equal(pauseReason(at(y, m, d, 16, 15, off)), null);
  }
});

test("pauses around a round of ours opening or settling", () => {
  const t = at(2026, 9, 29, 11, 0);
  const s = BigInt(t / 1000);
  assert.match(pauseReason(t, [{ status: "seeding", opensAt: s + 30n, settlesAt: s + 90_000n }]), /opens/);
  assert.match(pauseReason(t, [{ status: "seeding", opensAt: s - 200n, settlesAt: s + 90_000n }]), /opens/);
  assert.equal(pauseReason(t, [{ status: "seeding", opensAt: s - 400n, settlesAt: s + 90_000n }]), null);
  assert.match(pauseReason(t, [{ status: "open", opensAt: s - 90_000n, settlesAt: s + 20n }]), /settles/);
  assert.equal(pauseReason(t, [{ status: "open", opensAt: s - 90_000n, settlesAt: s + 7200n }]), null);
  assert.equal(pauseReason(t, [{ status: "settled", opensAt: s, settlesAt: s }]), null);
});

test("arrivals follow the hour's rate and move forward", () => {
  const cfg = cfgFor();
  const rng = rngFrom("arrivals");
  // Count arrivals over the busiest hour and over a quiet one, many times over.
  const count = (from, mins) => { let n = 0, t = from; for (;;) { t = nextArrival(t, rng, cfg); if (t >= from + mins * 60_000) return n; n++; } };
  let busy = 0, quiet = 0;
  for (let k = 0; k < 40; k++) { busy += count(at(2026, 9, 29, 14, 0), 50); quiet += count(at(2026, 9, 29, 2, 0), 50); }
  const expectBusy = ratePerMin(at(2026, 9, 29, 14, 20), cfg) * 50 * 40;
  assert.ok(Math.abs(busy - expectBusy) / expectBusy < 0.15, `busy ${busy} vs ${expectBusy}`);
  assert.ok(quiet < busy / 5, `quiet ${quiet} busy ${busy}`);
  const t0 = at(2026, 9, 29, 11, 0);
  assert.ok(nextArrival(t0, rng, cfg) > t0);
  assert.ok(nextArrival(t0, rng, { ...cfg, txPerMin: 0 }) > t0);
});
