// Personas: fixed per wallet, spread by weight, sizes mostly small.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_WEIGHTS, parseWeights, profileOf, rngFrom, spendUsd, tierOf } from "../src/personas.mjs";

test("the same wallet is always the same persona", () => {
  for (let i = 0; i < 50; i++) assert.deepEqual(profileOf(i, DEFAULT_WEIGHTS, "s"), profileOf(i, DEFAULT_WEIGHTS, "s"));
  const a = Array.from({ length: 50 }, (_, i) => profileOf(i, DEFAULT_WEIGHTS, "s").persona).join();
  const b = Array.from({ length: 50 }, (_, i) => profileOf(i, DEFAULT_WEIGHTS, "other").persona).join();
  assert.notEqual(a, b);
});

test("the mix follows the weights", () => {
  const n = 4000, counts = {};
  for (let i = 0; i < n; i++) { const p = profileOf(i, DEFAULT_WEIGHTS, "mix").persona; counts[p] = (counts[p] ?? 0) + 1; }
  const total = Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0);
  for (const [k, w] of Object.entries(DEFAULT_WEIGHTS)) assert.ok(Math.abs(counts[k] / n - w / total) < 0.03, `${k}: ${counts[k]}`);
  const only = parseWeights("caller:0,longshot:0,trader:0,house:0,starter:1,collector:0");
  for (let i = 0; i < 100; i++) assert.equal(profileOf(i, only, "x").persona, "starter");
});

test("weights are checked", () => {
  assert.throws(() => parseWeights("banker:5"), /not a weight/);
  assert.throws(() => parseWeights("caller:-1"), /not a weight/);
  assert.throws(() => parseWeights("caller:0,longshot:0,trader:0,house:0,starter:0,collector:0"), /zero/);
  assert.equal(parseWeights("house:30").house, 30);
});

test("mostly small, a few whales, and spends inside each tier's range", () => {
  const tiers = { small: 0, medium: 0, whale: 0 };
  for (let i = 0; i < 5000; i++) tiers[tierOf(i, "t")]++;
  assert.ok(tiers.small > 3800 && tiers.whale > 60 && tiers.whale < 250, JSON.stringify(tiers));
  const rng = rngFrom("spend");
  for (let k = 0; k < 500; k++) { const s = spendUsd("small", rng); assert.ok(s >= 2 && s <= 15); const w = spendUsd("whale", rng); assert.ok(w >= 80 && w <= 400); }
});
