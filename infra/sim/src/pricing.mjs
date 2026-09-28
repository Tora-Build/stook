// A caller's view of where the price closes, and the line it buys for it.
// Views sit near the live price with a spread from the series' learned
// volatility over the time left; a long shot looks two to three and a half
// sigmas out. Every shape comes back inside what the program accepts, and
// every size from the app's own search: the most shares a budget buys.

import { stook } from "@sooth/sdk-solana";

export function gauss(rng) {
  const u = 1 - rng(), v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Standard normal CDF (Abramowitz and Stegun 7.1.26), plenty for odds. */
export function normCdf(x) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

/** Log-price sigma over the `secsLeft` to the close, from the series' daily variance (WAD). */
export function sigmaFor(varWad, secsLeft) {
  const v = Number(varWad > 0n ? varWad : 0n) / 1e18;
  return Math.sqrt(Math.max(v, 1e-8) * Math.max(Number(secsLeft), 60) / 86_400);
}

/** A live Pyth price as a raw value in the round's exponent, the unit `binFor` takes. */
export function rawIn(live, p0Expo) {
  const value = Number(live.price) * 10 ** Number(live.expo);
  const raw = Math.round(value / 10 ** p0Expo);
  return raw > 0 ? BigInt(raw) : 1n;
}

/** Chance of each bin under a normal view of the log price (mean `mu`, sd `sd`). */
export function binOdds(mu, sd, l) {
  const edge = (i) => Math.log(stook.binBounds(i, l.p0, l.stepBps)[0]);
  const out = [];
  let prev = 0;
  for (let i = 0; i < stook.BINS; i++) {
    const hi = i === stook.BINS - 1 ? 1 : normCdf((edge(i + 1) - mu) / sd);
    out.push(Math.max(0, hi - prev));
    prev = hi;
  }
  return out;
}

export const expectedLevel = (shape, odds) => odds.reduce((a, p, i) => a + p * stook.level(shape, i), 0);

const HEIGHTS = [[2, 15], [3, 20], [4, 30], [5, 15], [6, 10], [7, 5], [8, 5]];
const pickHeight = (rng) => { let x = rng() * 100; for (const [h, w] of HEIGHTS) { if (x < w) return h; x -= w; } return 4; };
const clampBin = (i) => Math.max(0, Math.min(stook.BINS - 1, i));

/**
 * A view and the line for it. `kind` is "near" (a caller) or "far" (a long
 * shot). `live` is the Pyth price; `l` an open round; `sigma` the log sigma
 * to its close. Returns the shape, the view's centre bin and its odds.
 */
export function pickLine(kind, { live, l, sigma, rng }) {
  const ln0 = Math.log(Number(rawIn(live, l.p0Expo)));
  const step = l.stepBps / 10_000;
  let mu, sd;
  if (kind === "far") {
    mu = ln0 + (rng() < 0.5 ? -1 : 1) * sigma * (1.8 + 1.7 * rng());
    sd = sigma * 0.35;
  } else {
    mu = ln0 + gauss(rng) * sigma * (0.3 + 0.7 * rng());
    sd = sigma * (0.4 + 0.6 * rng());
  }
  sd = Math.max(sd, step / 2);
  const centre = clampBin(stook.binFor(BigInt(Math.max(1, Math.round(Math.exp(mu)))), l.p0, l.stepBps));
  let shape;
  if (kind === "far") {
    shape = rng() < 0.6 ? stook.tent(centre, 1 + Math.floor(rng() * 3)) : stook.band(clampBin(centre - 1), clampBin(centre + 1));
  } else if (rng() < 0.65) {
    shape = stook.tent(centre, pickHeight(rng));
  } else {
    const half = Math.max(0, Math.round((sigma / step) * (0.3 + 1.2 * rng())));
    shape = stook.band(clampBin(centre - half), clampBin(centre + half));
  }
  stook.validateShape(shape);
  return { shape, centre, odds: binOdds(mu, sd, l) };
}

/** The most shares `budget` (base units, wallet side) buys of `shape` now, as the app searches it; 0n if none. */
export function sharesFor(l, shape, budget, feeBps, transferFee) {
  if (budget <= 0n) return 0n;
  const cost = (n) => { try { return stook.grossFor(stook.quoteTrade({ curve: l.curve, b: l.b, feeBps, decimals: l.decimals }, shape, n).total, transferFee); } catch { return null; } };
  let lo = 0n, hi = budget;
  for (let k = 0; k < 64; k++) { const c = cost(hi); if (c === null || c > budget) break; lo = hi; hi *= 2n; }
  for (let k = 0; k < 64 && hi - lo > 1n; k++) { const mid = (lo + hi) / 2n, c = cost(mid); if (c !== null && c <= budget) lo = mid; else hi = mid; }
  return lo;
}
