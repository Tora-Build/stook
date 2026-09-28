// The treasury never sends more than the day's allowance.
import { test } from "node:test";
import assert from "node:assert/strict";
import { planTopUps, SolBudget, utcDay } from "../src/budget.mjs";

const SOL = 1_000_000_000n;

test("spend is capped per UTC day and survives a restart", () => {
  const day1 = Date.UTC(2026, 8, 28, 10), day2 = Date.UTC(2026, 8, 29, 0, 1);
  let saved = null;
  const b = new SolBudget(9 * 1e9, {}, (s) => { saved = JSON.parse(JSON.stringify(s)); });
  assert.equal(b.spend(5n * SOL, day1), true);
  assert.equal(b.spend(4n * SOL, day1), true);
  assert.equal(b.spend(1n, day1), false);
  assert.equal(b.remaining(day1), 0n);
  const again = new SolBudget(9 * 1e9, saved);
  assert.equal(again.spend(1n, day1), false);
  assert.equal(again.remaining(day2), 9n * SOL);
  assert.equal(utcDay(day2), "2026-09-29");
});

test("top-ups go poorest first and stop at the allowance", () => {
  const min = 15_000_000n, target = 50_000_000n;
  const balances = [0n, 60_000_000n, 10_000_000n, 14_999_999n, 0n];
  const all = planTopUps(balances, { min, target, remaining: 10n * SOL });
  assert.deepEqual(all.map((x) => x.index), [0, 4, 2, 3]);
  assert.equal(all[0].lamports, target);
  assert.equal(all[2].lamports, 40_000_000n);
  // Room for two full top-ups and the fee, not three.
  const some = planTopUps(balances, { min, target, remaining: 2n * target + 10_000n });
  assert.equal(some.length, 2);
  const total = some.reduce((a, x) => a + x.lamports, 0n);
  assert.ok(total + 10_000n <= 2n * target + 10_000n);
  assert.deepEqual(planTopUps(balances, { min, target, remaining: 0n }), []);
  // 200 empty wallets on a 9 SOL day: 179 funded (0.05 each plus fees), the rest tomorrow.
  const fleet = planTopUps(Array(200).fill(0n), { min, target, remaining: 9n * SOL });
  assert.equal(fleet.length, 179);
});

test("a top-up is booked before it goes and given back only on its own day", () => {
  const day1 = Date.UTC(2026, 8, 28, 10), day2 = Date.UTC(2026, 8, 29, 0, 1);
  const b = new SolBudget(1e9, {});
  const r = b.reserve(600_000_000n, day1);
  assert.ok(r);
  assert.equal(b.reserve(500_000_000n, day1), null);
  b.release(r, 590_000_000n, day1);
  assert.equal(b.spent(day1), 10_000_000n);
  // A receipt from yesterday gives nothing back today.
  const r2 = b.reserve(100_000_000n, day1);
  b.reserve(200_000_000n, day2);
  b.release(r2, r2.lamports, day2);
  assert.equal(b.spent(day2), 200_000_000n);
});
