// The treasury never sends more than the day's allowance.
import { test } from "node:test";
import assert from "node:assert/strict";
import { feeFor, planReclaims, planTopUps, runway, SolBudget, utcDay } from "../src/budget.mjs";

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

test("SOL sent back credits the day's allowance, never below zero, and is kept", () => {
  const day1 = Date.UTC(2026, 8, 28, 10);
  let saved = null;
  const b = new SolBudget(2e9, {}, (s) => { saved = JSON.parse(JSON.stringify(s)); });
  assert.equal(b.spend(2n * SOL, day1), true);
  assert.equal(b.remaining(day1), 0n);
  b.credit(500_000_000n, day1);
  assert.equal(b.spent(day1), 1_500_000_000n);
  assert.equal(b.remaining(day1), 500_000_000n);
  assert.equal(saved.spent, "1500000000");
  // More back than went out: the net stops at zero, the allowance at the cap.
  b.credit(5n * SOL, day1);
  assert.equal(b.spent(day1), 0n);
  assert.equal(b.remaining(day1), 2n * SOL);
  // A fee on a send that brings SOL back is booked past the cap.
  b.spend(2n * SOL, day1);
  b.charge(20_000n, day1);
  assert.equal(b.spent(day1), 2n * SOL + 20_000n);
  assert.equal(new SolBudget(2e9, saved).spent(day1), 2n * SOL + 20_000n);
});

test("each day's net goes to the history when the next begins, the last 14 kept", () => {
  const b = new SolBudget(2e9, {});
  const d0 = Date.UTC(2026, 8, 1, 12);
  for (let n = 0; n < 20; n++) b.spend(BigInt(n + 1) * 1_000_000n, d0 + n * 86_400_000);
  const h = b.history(d0 + 20 * 86_400_000);
  assert.equal(h.length, 14);
  assert.equal(h[0].day, "2026-09-07");
  assert.equal(h.at(-1).day, "2026-09-20");
  assert.equal(h.at(-1).net, 20_000_000n);
});

test("reclaims: every wallet over the line returns all above the target, richest first, six to a transaction", () => {
  const reclaim = 60_000_000n, target = 40_000_000n;
  const balances = [
    { index: 3, lamports: 60_000_000n }, // at the line: stays
    { index: 7, lamports: 60_000_001n },
    { index: 1, lamports: 200_000_000n },
    { index: 9, lamports: 10_000_000n },
    ...Array.from({ length: 10 }, (_, n) => ({ index: 20 + n, lamports: 100_000_000n })),
  ];
  const txs = planReclaims(balances, { reclaim, target });
  // Twelve over the line: two full transactions.
  assert.deepEqual(txs.map((t) => t.length), [6, 6]);
  const all = txs.flat();
  assert.equal(all[0].index, 1);
  assert.equal(all[0].lamports, 160_000_000n);
  assert.deepEqual(all.slice(1, 11).map((x) => x.index), [20, 21, 22, 23, 24, 25, 26, 27, 28, 29]);
  assert.equal(all.at(-1).index, 7);
  assert.equal(all.at(-1).lamports, 20_000_001n);
  assert.ok(!all.some((x) => x.index === 3 || x.index === 9));
  assert.ok(txs.every((t) => t.length <= 6));
  assert.deepEqual(planReclaims(balances, { reclaim, target, perTx: 4 }).map((t) => t.length), [4, 4, 4]);
  assert.deepEqual(planReclaims([], { reclaim, target }), []);
});

test("a transaction's fee: 5,000 a signature and the priority on its compute", () => {
  assert.equal(feeFor(1, 5_000, 0), 5_000n);
  assert.equal(feeFor(7, 11_000, 50_000), 35_000n + 550n);
  assert.equal(feeFor(2, 1, 1), 10_001n);
});

test("runway: the treasury over the last seven whole days' mean net", () => {
  const ms = Date.UTC(2026, 8, 28, 15);
  const days = (nets) => nets.map((net, n) => ({ day: utcDay(ms - (nets.length - n) * 86_400_000), net: BigInt(net) }));
  // Seven days at 0.5 SOL: 10 SOL lasts 20 days.
  let r = runway(10n * SOL, { history: days(Array(7).fill(500_000_000n)), ms });
  assert.equal(r.perDayLamports, 500_000_000);
  assert.equal(r.days, 20);
  // Older days are not counted; a day the fleet did not run counts as zero.
  const h = [...days(Array(10).fill(5n * SOL)).slice(0, 3), ...days([SOL, 0n, 0n, 0n, 0n, 0n, SOL])];
  const gap = h.filter((x) => x.net !== 0n);
  r = runway(7n * SOL, { history: gap, ms });
  assert.equal(r.perDayLamports, Math.round((2 * 1e9) / 7));
  assert.ok(Math.abs(r.days - 24.5) < 1e-9);
  // Two days on record: the mean of those two.
  r = runway(3n * SOL, { history: days([SOL, 2n * SOL]), ms });
  assert.equal(r.perDayLamports, 1_500_000_000);
  assert.equal(r.days, 2);
  // Nothing going out: no runway to speak of.
  assert.equal(runway(SOL, { history: days([0n, 0n]), ms }).days, null);
  // No history yet: today's so far, spread over the whole day (15:00 UTC is 5/8 of it).
  r = runway(10n * SOL, { history: [], spentToday: 625_000_000n, ms });
  assert.equal(r.perDayLamports, 1_000_000_000);
  assert.equal(r.days, 10);
});
