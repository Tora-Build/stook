// The arbitrageur's sums: fair odds for each band from the live price, the
// crowd's odds from the curve, and the trade that moves a mispriced band back
// toward fair without carrying it past. Pure functions over a decoded round,
// so the tests drive them with the SDK's own quote maths.
//
// Fair odds are a lognormal around the live price: log sd from the series'
// daily variance over the time left to the close (never less than an hour),
// over the round's own band edges, the two tail bands open-ended. The crowd's
// odds are each band's weight over the curve's sum. A band is cheap when the
// crowd prices it under fair by more than the fees and a margin; a held band
// is rich when the crowd prices it over fair by as much.
//
// Sizes come from bisection on `stook.quoteTrade`, so they match the program
// to the base unit: the largest buy (or sale) after which no band it touches
// has crossed its fair odds, that still costs no more than it is worth at fair
// odds (fees and the coin's transfer fee included), inside the budget.

import { stook } from "@sooth/sdk-solana";
import { binOdds, sigmaFor } from "./pricing.mjs";

/** The floor on the time left that the fair odds' spread is taken over, seconds. */
export const MIN_FAIR_SECS = 3600;

/** A live Pyth price in the round's raw units, unrounded. */
export const rawPrice = (live, p0Expo) => Number(live.price) * 10 ** (Number(live.expo) - Number(p0Expo));

/**
 * Fair odds of each band: a lognormal around the live price (no drift), log
 * sd from the daily variance `varWad` over `secsLeft` (floored at an hour).
 */
export function fairOdds(l, live, varWad, secsLeft) {
  const raw = rawPrice(live, l.p0Expo);
  if (!(raw > 0)) return null;
  const sd = sigmaFor(varWad, Math.max(Number(secsLeft), MIN_FAIR_SECS));
  return binOdds(Math.log(raw), sd, l);
}

/** The crowd's odds of each band: its weight over the sum. */
export const crowdOdds = (curve) => {
  const s = Number(curve.sum);
  return curve.w.map((w) => Number(w) / s);
};

/** Trade fee plus the coin's transfer fee, as a fraction: what a round trip costs each way. */
export const feeFrac = (feeBps, transferFee) => (feeBps + (transferFee?.bps ?? 0)) / 10_000;

/** Below this ratio of crowd to fair a band is cheap enough to buy. */
export const buyBelow = (fee, margin) => 1 / (1 + fee + margin);
/** Above this ratio a held band is rich enough to sell. */
export const sellAbove = (fee, margin) => 1 + fee + margin;

const bandsOf = (shape) => { const [a, z] = stook.shapeBins(shape); const out = []; for (let i = a; i <= z; i++) out.push(i); return out; };

/** The largest n in [0, cap] (cap null: unbounded) with ok(n), ok monotone (true then false). */
function largest(ok, start, cap = null) {
  let lo = 0n, hi = start > 0n ? start : 1n;
  if (cap !== null && hi > cap) hi = cap;
  for (let k = 0; k < 80 && ok(hi); k++) {
    lo = hi;
    if (cap !== null && hi >= cap) return hi;
    hi *= 2n;
    if (cap !== null && hi > cap) hi = cap;
  }
  for (let k = 0; k < 128 && hi - lo > 1n; k++) { const mid = (lo + hi) / 2n; if (ok(mid)) lo = mid; else hi = mid; }
  return lo;
}

/**
 * The cheap bands of a round, cheapest first (by ratio of crowd to fair odds):
 * each with its fair and crowd odds and their ratio. Bands under `minFair` fair odds are left alone (a
 * tail priced at nothing is not worth a line).
 */
export function cheapBands(fair, crowd, { fee, margin, minFair }) {
  const thr = buyBelow(fee, margin);
  const out = [];
  for (let i = 0; i < fair.length; i++) {
    if (!(fair[i] >= minFair)) continue;
    const ratio = crowd[i] / fair[i];
    if (ratio < thr) out.push({ i, fair: fair[i], crowd: crowd[i], ratio });
  }
  // Ratios under RATIO_FLOOR count as one (the crowd prices them at next to
  // nothing): among those the band with the most fair odds goes first.
  const key = (x) => Math.max(x.ratio, RATIO_FLOOR);
  return out.sort((a, b) => key(a) - key(b) || b.fair - a.fair);
}

/** Below this crowd-to-fair ratio bands are equally unpriced; the cheap list ranks them by fair odds. */
export const RATIO_FLOOR = 0.01;

/** How far apart (as a factor) two bands' crowd-to-fair ratios may be and still be bought as one range. */
export const RANGE_RATIO = 2;

/**
 * The cheapest band widened to a run of cheap neighbours, the cheaper side
 * first, at most `maxWidth` bands. A range lifts every band it covers by the
 * same factor, so only neighbours about as cheap as the first (within
 * RANGE_RATIO of its ratio) join: the dearest band in a range caps its size.
 */
export function cheapRange(seed, cheap, maxWidth) {
  const by = new Map(cheap.map((x) => [x.i, x]));
  const r0 = Math.max(by.get(seed)?.ratio ?? 0, 1e-9);
  const near = (x) => x && Math.max(x.ratio, 1e-9) <= r0 * RANGE_RATIO && Math.max(x.ratio, 1e-9) >= r0 / RANGE_RATIO;
  let lo = seed, hi = seed;
  while (hi - lo + 1 < maxWidth) {
    const l0 = by.get(lo - 1), r0n = by.get(hi + 1);
    const l = near(l0) ? l0 : null, r = near(r0n) ? r0n : null;
    if (!l && !r) break;
    if (l && (!r || l.ratio <= r.ratio)) lo--; else hi++;
  }
  return stook.band(lo, hi);
}

/**
 * Shares of `shape` to buy: the most after which every band it touches is
 * still at or under its fair odds, whose cost (wallet side) fits `budget` and
 * is no more than the line is worth at fair odds. 0n if none.
 */
export function buySize(l, shape, { fair, feeBps, transferFee, budget }) {
  if (budget <= 0n) return { shares: 0n };
  const m = { curve: l.curve, b: l.b, feeBps, decimals: l.decimals };
  const bands = bandsOf(shape);
  const fairLevel = bands.reduce((a, i) => a + fair[i] * stook.level(shape, i), 0);
  const at = (n) => {
    let q;
    try { q = stook.quoteTrade(m, shape, n); } catch { return null; }
    const pays = stook.grossFor(q.total, transferFee);
    if (pays > budget) return null;
    const after = crowdOdds(q.curve);
    if (bands.some((i) => after[i] > fair[i])) return null;
    const worth = stook.netOf(BigInt(Math.floor(fairLevel * Number(n))), transferFee);
    if (worth < pays) return null;
    return { q, pays, after, worth };
  };
  const shares = largest((n) => at(n) !== null, budget);
  if (shares <= 0n) return { shares: 0n };
  return { shares, ...at(shares) };
}

/**
 * The buy that most repairs a round: the cheapest band (widened over cheap
 * neighbours) whose line `allow(shape)` permits, sized by `buySize`. Null
 * when no band is cheap or none can be bought.
 */
export function planArbBuy(l, fair, { feeBps, transferFee, budget, margin, minFair = 0.005, maxWidth = 3, allow = () => true }) {
  const crowd = crowdOdds(l.curve);
  const fee = feeFrac(feeBps, transferFee);
  const cheap = cheapBands(fair, crowd, { fee, margin, minFair });
  for (const c of cheap) {
    for (const shape of [cheapRange(c.i, cheap, maxWidth), stook.band(c.i, c.i)]) {
      if (!allow(shape)) continue;
      const s = buySize(l, shape, { fair, feeBps, transferFee, budget });
      if (s.shares > 0n) return { side: "buy", shape, band: c.i, ratio: c.ratio, crowd, ...s };
    }
  }
  return null;
}

/** How rich a held shape is: the lowest crowd-to-fair ratio over its bands (every band must be over fair to sell it). */
export function richness(shape, fair, crowd) {
  let r = Infinity;
  for (const i of bandsOf(shape)) r = Math.min(r, fair[i] > 0 ? crowd[i] / fair[i] : Infinity);
  return r;
}

/**
 * Shares of a held `shape` to sell: the most (up to `held`) after which every
 * band it touches is still at or over its fair odds, and what the sale pays
 * (after the coin's transfer fee) is at least what they are worth at fair.
 */
export function sellSize(l, shape, { fair, feeBps, transferFee, held }) {
  if (held <= 0n) return { shares: 0n };
  const m = { curve: l.curve, b: l.b, feeBps, decimals: l.decimals };
  const bands = bandsOf(shape);
  const fairLevel = bands.reduce((a, i) => a + fair[i] * stook.level(shape, i), 0);
  const at = (n) => {
    let q;
    try { q = stook.quoteTrade(m, shape, -n); } catch { return null; }
    const gets = stook.netOf(q.total, transferFee);
    const after = crowdOdds(q.curve);
    if (bands.some((i) => after[i] < fair[i])) return null;
    const worth = stook.netOf(BigInt(Math.ceil(fairLevel * Number(n))), transferFee);
    if (gets < worth) return null;
    return { q, gets, after, worth };
  };
  const shares = largest((n) => at(n) !== null, held, held);
  if (shares <= 0n) return { shares: 0n };
  return { shares, ...at(shares) };
}

/**
 * The sale that most repairs a round from a wallet's held lines: the richest
 * (each band over fair by the fees and a margin), sized by `sellSize`.
 * `held` is `[{ shape, shares }]`. Null when none is rich.
 */
export function planArbSell(l, fair, { feeBps, transferFee, held, margin }) {
  const crowd = crowdOdds(l.curve);
  const thr = sellAbove(feeFrac(feeBps, transferFee), margin);
  const rich = held.map((h) => ({ ...h, ratio: richness(h.shape, fair, crowd) })).filter((h) => h.ratio > thr && h.shares > 0n).sort((a, b) => b.ratio - a.ratio);
  for (const h of rich) {
    const s = sellSize(l, h.shape, { fair, feeBps, transferFee, held: h.shares });
    if (s.shares > 0n) return { side: "sell", shape: h.shape, ratio: h.ratio, crowd, held: h.shares, ...s };
  }
  return null;
}

/** How spiky a round is: its top band's odds and how many bands hold 1% or more. */
export function spikiness(curve) {
  const p = crowdOdds(curve);
  let top = 0, at = 0;
  p.forEach((x, i) => { if (x > top) { top = x; at = i; } });
  return { maxProb: top, maxBand: at, bandsOver1pct: p.filter((x) => x >= 0.01).length };
}
