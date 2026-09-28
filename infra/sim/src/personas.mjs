// Who each wallet is. A wallet's persona, size and habits follow from its
// index and the fleet's seed alone, so a restart (or a plan) sees the same
// fleet, and the mix is set by weights.

import { createHash } from "node:crypto";

export const PERSONAS = ["caller", "longshot", "trader", "house", "starter", "collector"];
export const DEFAULT_WEIGHTS = { caller: 45, longshot: 10, trader: 20, house: 10, starter: 5, collector: 10 };

/** "caller:50,house:20": weights over the defaults; unknown names are refused. */
export function parseWeights(text) {
  const w = { ...DEFAULT_WEIGHTS };
  if (!text) return w;
  for (const part of text.split(",").map((s) => s.trim()).filter(Boolean)) {
    const [k, v] = part.split(":");
    if (!PERSONAS.includes(k) || !(Number(v) >= 0)) throw new Error(`SIM_PERSONAS: not a weight: ${part}`);
    w[k] = Number(v);
  }
  if (!Object.values(w).some((v) => v > 0)) throw new Error("SIM_PERSONAS: every weight is zero");
  return w;
}

/** A number in [0, 1) from `parts`, the same every time. */
export function unit(...parts) {
  const h = createHash("sha256").update(parts.join(":")).digest();
  return h.readUInt32BE(0) / 2 ** 32;
}

/** A seeded generator (mulberry32) for the fleet's own draws. */
export function rngFrom(seedText) {
  let a = createHash("sha256").update(String(seedText)).digest().readUInt32BE(0);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pickWeighted(weights, u) {
  const entries = Object.entries(weights).filter(([, v]) => v > 0);
  const total = entries.reduce((a, [, v]) => a + v, 0);
  let x = u * total;
  for (const [k, v] of entries) { if (x < v) return k; x -= v; }
  return entries[entries.length - 1][0];
}

/** Mostly small, some medium, a few whales. */
export function tierOf(index, seed) {
  const u = unit(seed, "tier", index);
  return u < 0.03 ? "whale" : u < 0.2 ? "medium" : "small";
}

// Dollars per action by tier, log-uniform inside each range.
const SPEND = { small: [2, 15], medium: [15, 80], whale: [80, 400] };
const DEPOSIT = { small: [20, 80], medium: [80, 300], whale: [300, 1_500] };
const SEED = { small: [50, 120], medium: [120, 300], whale: [300, 800] };
const logUniform = (rng, [lo, hi]) => Math.exp(Math.log(lo) + rng() * (Math.log(hi) - Math.log(lo)));
export const spendUsd = (tier, rng) => logUniform(rng, SPEND[tier]);
export const depositUsd = (tier, rng) => logUniform(rng, DEPOSIT[tier]);
export const seedUsd = (tier, rng) => logUniform(rng, SEED[tier]);

// How long after a round finishes each persona gets round to collecting, seconds.
const COLLECT_DELAY = {
  caller: [5 * 60, 45 * 60], longshot: [5 * 60, 3 * 3600], trader: [10 * 60, 60 * 60],
  house: [15 * 60, 2 * 3600], starter: [15 * 60, 2 * 3600], collector: [2 * 3600, 3 * 86_400],
};

/** Everything fixed about wallet `index`. */
export function profileOf(index, weights, seed) {
  const persona = pickWeighted(weights, unit(seed, "persona", index));
  const tier = tierOf(index, seed);
  const [dlo, dhi] = COLLECT_DELAY[persona];
  return {
    index,
    persona,
    tier,
    /** How often this wallet is the one that acts, relative to the others. */
    activity: 0.3 + 1.7 * unit(seed, "activity", index),
    /** Seconds after a round finishes before this wallet collects it. */
    collectDelay: Math.round(dlo + unit(seed, "delay", index) * (dhi - dlo)),
    /** A trader's hold before selling, seconds. */
    holdSecs: Math.round(3600 * (1 + 5 * unit(seed, "hold", index))),
    /** The coin this wallet likes best, by position in COINS. */
    favourite: Math.floor(unit(seed, "coin", index) * 4),
  };
}
