// Views to lines: every shape the program accepts, sizes the app would buy.
import { test } from "node:test";
import assert from "node:assert/strict";
import { stook } from "@sooth/sdk-solana";
import { binOdds, expectedLevel, pickLine, rawIn, sharesFor, sigmaFor } from "../src/pricing.mjs";
import { rngFrom } from "../src/personas.mjs";
import { openRound, series } from "./helpers.mjs";

const settlesAt = 1_790_000_000n;
const l = openRound({ settlesAt });
const s = series();
const live = { price: 6_500_000_000_000n, expo: -8 };

test("a live price lands in the grid's own units", () => {
  assert.equal(rawIn(live, -8), 6_500_000_000_000n);
  assert.equal(rawIn({ price: 65_000n, expo: 0 }, -8), 6_500_000_000_000n);
  assert.equal(stook.binFor(rawIn(live, l.p0Expo), l.p0, l.stepBps), 32);
});

test("odds over the bins sum to one", () => {
  const odds = binOdds(Math.log(Number(l.p0)), 0.02, l);
  assert.equal(odds.length, 64);
  assert.ok(Math.abs(odds.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.ok(odds[32] > odds[20]);
});

test("every sampled line is a valid shape, near or far, at any time left", () => {
  const rng = rngFrom("shapes");
  for (const secs of [300, 3600, 6 * 3600, 20 * 3600]) {
    const sigma = sigmaFor(stook.seriesVariance(s), secs);
    for (let k = 0; k < 400; k++) {
      for (const kind of ["near", "far"]) {
        const p = pickLine(kind, { live, l, sigma, rng });
        assert.doesNotThrow(() => stook.validateShape(p.shape));
        assert.ok(p.shape.lo <= 63 && p.shape.hi >= 0 && p.shape.lo >= -8 && p.shape.hi <= 71 && p.shape.h >= 1 && p.shape.h <= 8);
        assert.ok(p.centre >= 0 && p.centre <= 63);
      }
    }
  }
  // Even a price far off the grid (a crash, a stale p0) stays inside.
  for (const price of [1n, 10n ** 18n]) {
    const p = pickLine("far", { live: { price, expo: -8 }, l, sigma: 0.05, rng });
    assert.doesNotThrow(() => stook.validateShape(p.shape));
  }
});

test("near views sit near the price; far ones well away", () => {
  const rng = rngFrom("where");
  const sigma = sigmaFor(stook.seriesVariance(s), 6 * 3600);
  let near = 0, far = 0;
  for (let k = 0; k < 300; k++) { near += Math.abs(pickLine("near", { live, l, sigma, rng }).centre - 32); far += Math.abs(pickLine("far", { live, l, sigma, rng }).centre - 32); }
  assert.ok(far / 300 > 2 * (near / 300), `near ${near / 300} far ${far / 300}`);
});

test("the budget buys the most shares that fit, as the app searches", () => {
  const fee = { bps: 300, maxFee: 10n ** 15n };
  const shape = stook.tent(32, 4);
  const feeBps = stook.feeBpsAt(l.feeBps, settlesAt - 10n * 3600n, settlesAt);
  for (const budget of [1_000_000n, 25_000_000n, 300_000_000n]) {
    const n = sharesFor(l, shape, budget, feeBps, fee);
    assert.ok(n > 0n);
    const cost = (x) => stook.grossFor(stook.quoteTrade({ curve: l.curve, b: l.b, feeBps, decimals: l.decimals }, shape, x).total, fee);
    assert.ok(cost(n) <= budget);
    assert.ok(cost(n + 1n) > budget);
  }
  assert.equal(sharesFor(l, shape, 0n, feeBps, fee), 0n);
  // Expected payout of a centred tent is positive and under its height.
  const e = expectedLevel(shape, binOdds(Math.log(Number(l.p0)), 0.01, l));
  assert.ok(e > 0 && e < 4);
});
