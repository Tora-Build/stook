// TypeScript port of `sooth_core`'s `math/ladder.rs` and the pricing half of
// `instructions/ladder.rs`.
//
// A quote here must be the number the program charges, to the base unit: the
// UI shows it, the user signs a limit derived from it, and a port that was off
// by one would either fail trades at the limit or leave the limit loose enough
// to be worth front-running. `tests/ladder-e2e.test.ts` holds it to that — every
// trade in the test is quoted here first and the balance change compared.

import { expWad, lnWad, wadDiv, wadMul, WAD, LmsrMathError } from "../math/lmsr.js";

export const BINS = 64;
export const MAX_HEIGHT = 8;
export const W_MAX = 1_000_000_000n * WAD;
/** Floor on a weight: one in 1e18 of the cap (see the program's `MIN_W`). */
export const MIN_W = WAD / 1_000_000_000n;
export const MAX_TRADE_EXPONENT = 20n * WAD;
export const MAX_WAD_DIVISOR = 1n << 96n;
export const B_HAIRCUT_NUM = 9_999n;
export const B_HAIRCUT_DEN = 10_000n;
export const FEE_ACC_SCALE = 1_000_000_000_000_000_000n;

/** Log-spaced bin widths, in basis points, by tier. */
export const STEP_BPS = [25, 50, 100, 200, 400, 800] as const;

const I128_MAX = (1n << 127n) - 1n;
const U64_MAX = (1n << 64n) - 1n;

const fail = (why: string): never => {
  throw new LmsrMathError(why);
};

// The Rust `wad_div` refuses what it cannot divide exactly; mirror the
// refusals so a quote fails where the trade would.
function div(a: bigint, b: bigint): bigint {
  const bu = b < 0n ? -b : b;
  if (bu === 0n || bu > MAX_WAD_DIVISOR) fail("wad_div: divisor out of range");
  const q = wadDiv(a, b);
  if (q > I128_MAX || q < -I128_MAX) fail("wad_div: overflow");
  return q;
}

function mul(a: bigint, b: bigint): bigint {
  const q = wadMul(a, b);
  if (q > I128_MAX || q < -I128_MAX) fail("wad_mul: overflow");
  return q;
}

// ── shapes ───────────────────────────────────────────────────────────────────

/**
 * What a trader buys: `h = 1` is a flat band over `lo..=hi`; `h > 1` is a tent
 * that pays `h` at its centre and one less per bin outward. Bounds are virtual —
 * a tent near an edge keeps its full taper and simply has bins off the ladder.
 */
export interface Shape {
  lo: number;
  hi: number;
  h: number;
}

export const band = (lo: number, hi: number): Shape => ({ lo, hi, h: 1 });

export const tent = (center: number, h: number): Shape => {
  const reach = Math.max(h - 1, 0);
  return { lo: center - reach, hi: center + reach, h };
};

export function validateShape(s: Shape): void {
  const last = BINS - 1;
  const ok =
    Number.isInteger(s.lo) &&
    Number.isInteger(s.hi) &&
    Number.isInteger(s.h) &&
    s.lo <= s.hi &&
    s.h >= 1 &&
    s.h <= MAX_HEIGHT &&
    s.hi >= 0 &&
    s.lo <= last &&
    s.lo >= -MAX_HEIGHT &&
    s.hi <= last + MAX_HEIGHT;
  if (!ok) fail(`not a shape: ${JSON.stringify(s)}`);
}

/** The real bins a shape touches, inclusive. */
export function shapeBins(s: Shape): [number, number] {
  return [Math.max(s.lo, 0), Math.min(s.hi, BINS - 1)];
}

/** What one share of `s` pays if bin `i` settles. */
export function level(s: Shape, i: number): number {
  if (i < s.lo || i > s.hi) return 0;
  return Math.min(s.h, i - s.lo + 1, s.hi - i + 1);
}

// ── the curve ────────────────────────────────────────────────────────────────

export interface Curve {
  /** `exp(qᵢ/B)`, WAD. */
  w: bigint[];
  /** `Σ wᵢ`, WAD. */
  sum: bigint;
}

/** Every bin equally likely. Tests use it; a real round starts from `prior`. */
export const fresh = (): Curve => ({ w: Array<bigint>(BINS).fill(WAD), sum: WAD * BigInt(BINS) });

export const ROUND_SECS = 86_400n;
export const LOCK_GAP_MIN_SECS = 120n;
export const LOCK_GAP_MAX_SECS = 3_600n;
export const OPEN_DELAY_SECS = 60n;
export const MIN_ROUND_SECS = 900n;

/** When a round started at `now` for `settlesAt` opens and locks (`round_times`). */
export function roundTimes(now: bigint, settlesAt: bigint): { opensAt: bigint; locksAt: bigint } {
  const early = settlesAt - ROUND_SECS, soon = now + OPEN_DELAY_SECS;
  const opensAt = soon > early ? soon : early;
  let gap = (settlesAt - opensAt) / 24n;
  if (gap < LOCK_GAP_MIN_SECS) gap = LOCK_GAP_MIN_SECS;
  if (gap > LOCK_GAP_MAX_SECS) gap = LOCK_GAP_MAX_SECS;
  return { opensAt, locksAt: settlesAt - gap };
}

/** A void's two pots: depositors up to what they put in, open lines the rest. */
export function voidPots(vault: bigint, depositTotal: bigint, basisTotal: bigint): { lp: bigint; traders: bigint } {
  const lp = basisTotal === 0n || vault < depositTotal ? vault : depositTotal;
  return { lp, traders: vault - lp };
}

/** One claim's cut of a pot, floored, as `void_share`. */
export const voidShare = (claim: bigint, pot: bigint, claims: bigint): bigint => (claims > 0n ? (claim * pot) / claims : 0n);

/**
 * Price a trade of `delta` WAD shares of `shape` against depth `b`. Returns the
 * curve after it and the WAD cost (negative for a sell). Does not mutate.
 */
export function applyTrade(curve: Curve, b: bigint, shape: Shape, delta: bigint): { curve: Curve; cost: bigint } {
  validateShape(shape);
  if (b <= 0n || delta === 0n) fail("apply_trade: bad size or depth");

  const x = div(delta, b);
  const reach = (x < 0n ? -x : x) * BigInt(shape.h);
  if (reach > MAX_TRADE_EXPONENT) fail("apply_trade: trade too large for this depth");

  const powers: bigint[] = [WAD, expWad(x)];
  for (let m = 2; m <= shape.h; m++) powers.push(mul(powers[m - 1]!, powers[1]!));

  // As the program does: price on the curve as it stands; if that would carry
  // a weight past the cap, shift the whole curve down until the new peak sits
  // at or under half of it and price again. Prices are ratios, so the trader
  // pays the same.
  const [first, last] = shapeBins(shape);
  let w = curve.w.slice();
  let before = curve.sum;
  let shift = 0n;
  let after: bigint;
  const next: bigint[] = [];
  for (;;) {
    after = before;
    let peak = 0n;
    for (let i = first; i <= last; i++) {
      let n = mul(w[i]!, powers[level(shape, i)]!);
      if (n < MIN_W) n = MIN_W;
      if (n > peak) peak = n;
      after += n - w[i]!;
      next[i] = n;
    }
    if (peak <= W_MAX) break;
    if (shift > 0n) fail("apply_trade: weight cap");
    while (peak >> shift > W_MAX / 2n) shift++;
    w = w.map((v) => v >> shift);
    before = w.reduce((a, v) => a + v, 0n);
  }
  for (let i = first; i <= last; i++) w[i] = next[i]!;
  const cost = mul(b, lnWad(div(after, before)));
  if (shift === 0n) return { curve: { w, sum: after }, cost };
  // A bin more than 1e18 under the peak is lifted back to the floor.
  let total = 0n;
  for (let i = 0; i < w.length; i++) { if (w[i]! < MIN_W) w[i] = MIN_W; total += w[i]!; }
  return { curve: { w, sum: total }, cost };
}

/** Probability of bin `i`, WAD. */
export const price = (c: Curve, i: number): bigint => div(c.w[i]!, c.sum);

/** Marginal price of one share of `shape`, WAD per unit of payout level. */
export function marginalPrice(c: Curve, shape: Shape): bigint {
  validateShape(shape);
  const [first, last] = shapeBins(shape);
  let weighted = 0n;
  for (let i = first; i <= last; i++) weighted += c.w[i]! * BigInt(level(shape, i));
  return div(weighted, c.sum);
}

/** Which bin a price lands in. `price` and `p0` share the feed's exponent. */
export function binFor(priceRaw: bigint, p0: bigint, stepBps: number): number {
  if (priceRaw <= 0n || p0 <= 0n || stepBps <= 0) fail("bin_for: bad input");
  const last = BINS - 1;
  const tail = priceRaw < p0 ? 0 : last;
  let ln: bigint;
  try {
    const ratio = div(priceRaw, p0);
    if (ratio <= 0n) return 0;
    ln = lnWad(ratio);
  } catch {
    return tail;
  }
  const step = BigInt(stepBps) * (WAD / 10_000n);
  // floor toward −∞, as `div_euclid` does for a positive divisor
  let q = ln / step;
  if (ln % step < 0n) q -= 1n;
  const idx = BigInt(BINS / 2) + q;
  return Number(idx < 0n ? 0n : idx > BigInt(last) ? BigInt(last) : idx);
}

/** The price range of bin `i`, in the feed's raw units, as `[lo, hi)`. */
export function binBounds(i: number, p0: bigint, stepBps: number): [number, number] {
  const step = stepBps / 10_000;
  const k = i - BINS / 2;
  const lo = i === 0 ? 0 : Number(p0) * Math.exp(k * step);
  const hi = i === BINS - 1 ? Infinity : Number(p0) * Math.exp((k + 1) * step);
  return [lo, hi];
}

// ── money ────────────────────────────────────────────────────────────────────

export const scalarFor = (decimals: number): bigint => 10n ** BigInt(Math.max(18 - decimals, 0));

const toU64 = (v: bigint): bigint => (v < 0n || v > U64_MAX ? fail("amount does not fit u64") : v);

export const wadToAmountCeil = (wad: bigint, decimals: number): bigint => {
  const s = scalarFor(decimals);
  return toU64((wad + s - 1n) / s);
};
export const wadToAmountFloor = (wad: bigint, decimals: number): bigint => toU64(wad / scalarFor(decimals));

export const LADDER_FEE_BPS = 200;
export const FEE_PEAK_BPS = 500;
export const FEE_RAMP_START_SECS = 6n * 3600n;
export const FEE_RAMP_END_SECS = 3600n;

/**
 * The fee rate for a trade at `now` (`fee_bps_at`): the round's base (2%)
 * until six hours before the close, rising in a straight line to 5% one hour
 * before, and no higher. Quote with this, at the clock the trade will land at.
 */
export function feeBpsAt(base: number, now: bigint, settlesAt: bigint): number {
  const left = settlesAt - now;
  const peak = BigInt(Math.max(FEE_PEAK_BPS, base));
  if (left >= FEE_RAMP_START_SECS) return base;
  if (left <= FEE_RAMP_END_SECS) return Number(peak);
  const b = BigInt(base);
  return Number(b + ((peak - b) * (FEE_RAMP_START_SECS - left)) / (FEE_RAMP_START_SECS - FEE_RAMP_END_SECS));
}

/** Never zero on a non-zero amount, never more than the amount. */
export function feeOn(amount: bigint, feeBps: number): bigint {
  const raw = (amount * BigInt(feeBps) + 9_999n) / 10_000n;
  const atLeastOne = raw > 1n ? raw : 1n;
  return atLeastOne < amount ? atLeastOne : amount;
}

/** 90% to depositors, the rest to the protocol (half of that to the settler). */
export function splitFee(fee: bigint): { lp: bigint; creator: bigint; protocol: bigint } {
  const lp = (fee * 90n) / 100n;
  return { lp, creator: 0n, protocol: fee - lp };
}

export interface TradeQuote {
  /** Base units between trader and pool, before the fee. */
  amount: bigint;
  fee: bigint;
  /** Buying: what leaves the wallet. Selling: what arrives. */
  total: bigint;
  /** What the position pays if it lands on its best bin. */
  maxPayout: bigint;
  /** The curve after the trade — feed it to the next quote. */
  curve: Curve;
}

/**
 * Exactly what `ladder_trade` will charge or pay for `shares` base units
 * (positive buys, negative sells) — given the market's state as it stands.
 */
export function quoteTrade(
  m: { curve: Curve; b: bigint; feeBps: number; decimals: number },
  shape: Shape,
  shares: bigint,
): TradeQuote {
  if (shares === 0n) fail("zero trade");
  const buying = shares > 0n;
  const size = buying ? shares : -shares;
  const { curve, cost } = applyTrade(m.curve, m.b, shape, shares * scalarFor(m.decimals));

  // One base unit against the trader on top of ceil/floor, as the program does.
  let amount: bigint;
  if (buying) {
    if (cost <= 0n) fail("a buy that costs nothing");
    amount = wadToAmountCeil(cost, m.decimals) + 1n;
  } else {
    if (cost >= 0n) fail("a sell that pays nothing");
    const got = wadToAmountFloor(-cost, m.decimals);
    amount = got > 0n ? got - 1n : 0n;
  }
  const fee = feeOn(amount, m.feeBps);
  return {
    amount,
    fee,
    total: buying ? amount + fee : amount - fee,
    maxPayout: size * BigInt(shape.h),
    curve,
  };
}

// ── liquidity tranches ───────────────────────────────────────────────────────

/** `ln(S / wᵢ)` = `−ln pᵢ`, WAD. */
export function negLnPrice(wI: bigint, sum: bigint): bigint {
  if (wI <= 0n || sum < wI) fail("neg_ln_price: bad weights");
  return lnWad(div(sum, wI));
}

/** Depth a deposit buys at the curve as it stands: `0.9999·D / ln(1/p_min)`. */
export function liquidityForDeposit(c: Curve, deposit: bigint, decimals: number): bigint {
  if (deposit <= 0n) fail("zero deposit");
  const wMin = c.w.reduce((a, v) => (v < a ? v : a));
  const worst = negLnPrice(wMin, c.sum);
  if (worst <= 0n) fail("degenerate curve");
  return div((deposit * scalarFor(decimals) * B_HAIRCUT_NUM) / B_HAIRCUT_DEN, worst);
}

/** A tranche's trading result if bin `k` settles, WAD. Never positive in expectation. */
export function tranchePnl(b: bigint, joinWk: bigint, joinSum: bigint, finalWk: bigint, finalSum: bigint): bigint {
  return mul(b, negLnPrice(finalWk, finalSum) - negLnPrice(joinWk, joinSum));
}

/** What `ladder_claim_lp` pays a tranche's principal after settlement. */
export function tranchePrincipal(deposit: bigint, pnlWad: bigint, decimals: number): bigint {
  if (pnlWad >= 0n) return deposit + wadToAmountFloor(pnlWad, decimals);
  const loss = wadToAmountCeil(-pnlWad, decimals);
  return loss > deposit ? 0n : deposit - loss;
}

/** LP fees a tranche has earned so far. */
export function trancheFees(bWad: bigint, decimals: number, accNow: bigint, accAtJoin: bigint): bigint {
  const bUnits = (bWad > 0n ? bWad : 0n) / scalarFor(decimals);
  return (bUnits * (accNow - accAtJoin)) / FEE_ACC_SCALE;
}

/** What `ladder_settle` pays whoever settles: half the protocol's fee take. */
export const settleBounty = (feesProtocol: bigint): bigint => feesProtocol / 2n;
