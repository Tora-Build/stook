// A call, the way the tower talks about it, and the floors it is drawn on.
//
// Near a price: full pay on floor `c`, one step less on each floor away,
// nothing past c ± s. It is the SDK's tent with h = s + 1 (math.ts `level`:
// a tent pays h at its centre and h − d at d floors away, so it pays on
// d = 0..h − 1, that is ±(h − 1) = ±s). Between: the same pay on every floor
// lo..hi, the SDK's flat band. The two open-ended tails are floors 0 and 63.
import { stook } from "@sooth/sdk-solana";

export type Kind = "near" | "between";
export type Call = { kind: "near"; c: number; s: number } | { kind: "between"; lo: number; hi: number };

const LAST = stook.BINS - 1;
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
/** Widest near call: ±7 floors is h = 8, the program's MAX_HEIGHT. */
export const MAX_S = stook.MAX_HEIGHT - 1;
/** How sure: ±1 is tent(c, 2), ±3 is tent(c, 4), ±6 is tent(c, 7). */
export const SURE: [string, number][] = [["Sure", 1], ["Pretty sure", 3], ["Not sure", 6]];

export const toShape = (c: Call): stook.Shape => (c.kind === "near" ? stook.tent(c.c, c.s + 1) : stook.band(c.lo, c.hi));
export const fromShape = (s: stook.Shape): Call =>
  s.h > 1 ? { kind: "near", c: (s.lo + s.hi) / 2, s: s.h - 1 } : { kind: "between", lo: clamp(s.lo, 0, LAST), hi: clamp(s.hi, 0, LAST) };
export const sameShape = (a: stook.Shape | null, b: stook.Shape | null) => !!a && !!b && a.lo === b.lo && a.hi === b.hi && a.h === b.h;
export const same = (a: Call | null, b: Call | null) => !!a && !!b && sameShape(toShape(a), toShape(b));
export const height = (c: Call) => (c.kind === "near" ? c.s + 1 : 1);
export const level = (c: Call, i: number) => (c.kind === "between" ? (i >= c.lo && i <= c.hi ? 1 : 0) : Math.max(0, c.s + 1 - Math.abs(i - c.c)));
export const span = (c: Call): [number, number] => (c.kind === "between" ? [c.lo, c.hi] : [c.c - c.s, c.c + c.s]);
export const between = (a: number, b: number): Call => ({ kind: "between", lo: clamp(Math.min(a, b), 0, LAST), hi: clamp(Math.max(a, b), 0, LAST) });

/** Tails this unlikely fold into one rooftop or basement floor. */
export const TAIL = 0.005;

export interface Row { a: number; b: number; g?: "roof" | "base"; p: number }

/** The ladder as floors: prices, chances, and the rows the tower draws. */
export interface Grid {
  dp: number;
  stepBps: number;
  /** The price the grid is centred on, in display units. */
  p0: number;
  probs: number[];
  rows: Row[];
  /** Row of each bin. */
  rowOf: number[];
  /** First and last floor drawn one per row. */
  flo: number;
  fhi: number;
  pmax: number;
  edge: (k: number) => number;
  binOf: (v: number) => number;
  fmt: (v: number) => string;
}

export function makeGrid(o: { curve: stook.Curve; p0: bigint; expo: number; stepBps: number; dp: number; keep: number[]; all: boolean }): Grid {
  const step = o.stepBps / 10_000, p0 = Number(o.p0) * 10 ** o.expo;
  const probs = Array.from({ length: stook.BINS }, (_, i) => Number(stook.price(o.curve, i)) / 1e18);
  // The price at the bottom of floor k, from the SDK's own bounds.
  const edge = (k: number) => stook.binBounds(clamp(k, 1, LAST), o.p0, o.stepBps)[0] * 10 ** o.expo;
  const binOf = (v: number) => (v > 0 && p0 > 0 ? clamp(Math.floor(Math.log(v / p0) / step + 1e-12) + stook.BINS / 2, 0, LAST) : stook.BINS / 2);
  const fmt = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: o.dp, maximumFractionDigits: o.dp });
  let lo = 0, hi = LAST;
  if (!o.all) {
    while (lo < LAST && probs[lo]! < TAIL) lo++;
    while (hi > 0 && probs[hi]! < TAIL) hi--;
    for (const k of o.keep) if (k >= 0 && k <= LAST) { lo = Math.min(lo, k); hi = Math.max(hi, k); }
    // At least nine floors, even on a very sure crowd.
    while (hi - lo < 8) { if (lo > 0) lo--; if (hi < LAST) hi++; if (lo === 0 && hi === LAST) break; }
  }
  const rows: Row[] = [];
  if (lo > 0) rows.push({ a: 0, b: lo - 1, g: "base", p: 0 });
  for (let i = lo; i <= hi; i++) rows.push({ a: i, b: i, p: 0 });
  if (hi < LAST) rows.push({ a: hi + 1, b: LAST, g: "roof", p: 0 });
  const rowOf = new Array<number>(stook.BINS).fill(0);
  rows.forEach((r, k) => { for (let i = r.a; i <= r.b; i++) { rowOf[i] = k; r.p += probs[i]!; } });
  return { dp: o.dp, stepBps: o.stepBps, p0, probs, rows, rowOf, flo: lo, fhi: hi, pmax: Math.max(...rows.map((r) => r.p), 1e-9), edge, binOf, fmt };
}

/** A floor clamped to the ones drawn one per row. */
export const nearAt = (g: Grid, i: number, s: number): Call => ({ kind: "near", c: clamp(i, g.flo, g.fhi), s: clamp(s, 1, MAX_S) });

export function rowWords(g: Grid, r: number): string {
  const R = g.rows[r]!;
  if (R.g === "roof" || (!R.g && R.a === LAST)) return `above ${g.fmt(g.edge(R.a))}`;
  if (R.g === "base" || (!R.g && R.a === 0)) return `below ${g.fmt(g.edge(R.b + 1))}`;
  return g.fmt(g.edge(R.a));
}

/** "between A and B", "above A", "on the A floor": how a readout says a call. */
export function callWords(g: Grid, c: Call): string {
  if (c.kind === "between") {
    if (c.lo === 0 && c.hi === LAST) return "anywhere";
    if (c.lo === 0) return `below ${g.fmt(g.edge(c.hi + 1))}`;
    if (c.hi === LAST) return `above ${g.fmt(g.edge(c.lo))}`;
    return `between ${g.fmt(g.edge(c.lo))} and ${g.fmt(g.edge(c.hi + 1))}`;
  }
  return c.c >= LAST ? `above ${g.fmt(g.edge(LAST))}` : c.c <= 0 ? `below ${g.fmt(g.edge(1))}` : `on the ${g.fmt(g.edge(c.c))} floor`;
}

/** A held call by name, for lists: "Near 773.90, ±3 floors", "Between 761.50 and 812.51". */
export function callName(g: Grid, s: stook.Shape): string {
  const c = fromShape(s);
  if (c.kind === "near") {
    const at = c.c >= LAST ? `above ${g.fmt(g.edge(LAST))}` : c.c <= 0 ? `below ${g.fmt(g.edge(1))}` : g.fmt(g.edge(c.c));
    return `Near ${at}, ±${c.s} floor${c.s > 1 ? "s" : ""}`;
  }
  const w = callWords(g, c);
  return w[0]!.toUpperCase() + w.slice(1);
}

/** A held call by name, short, for the rack's slips: "Near 65,000 ±3", "Between 64,321 and 65,457", "Above 67,080". */
export function callShort(g: Grid, s: stook.Shape): string {
  const c = fromShape(s);
  if (c.kind !== "near") return callName(g, s);
  const at = c.c >= LAST ? `above ${g.fmt(g.edge(LAST))}` : c.c <= 0 ? `below ${g.fmt(g.edge(1))}` : g.fmt(g.edge(c.c));
  return `Near ${at} ±${c.s}`;
}

/** The crowd's chance for a call: every floor it pays on (between), or its own floor (near). */
export const callChance = (g: Grid, c: Call) => (c.kind === "between" ? g.probs.slice(c.lo, c.hi + 1).reduce((a, b) => a + b, 0) : g.probs[clamp(c.c, 0, LAST)]!);

/** "14%", "7.8%", "<0.1%". */
export const pctText = (v: number) => (v < 0.001 ? "<0.1%" : `${v < 0.095 ? (v * 100).toFixed(1) : Math.round(v * 100)}%`);
/** "2.32×", "14.8×". */
export const fx = (v: number) => `${(v >= 10 ? v.toFixed(1) : v.toFixed(2)).replace(/\.0$/, "")}×`;

/** About what a call pays for what it costs, from the curve's marginal price
 *  and the fee: exact for a small spend, a little high for a large one. */
export function aboutMultiple(curve: stook.Curve, c: Call, feeBps: number): number {
  try {
    const s = toShape(c), m = Number(stook.marginalPrice(curve, s)) / 1e18;
    return m > 0 ? s.h / m / (1 + feeBps / 10_000) : 0;
  } catch { return 0; }
}

export type Role = "hi" | "lo" | "body" | "c" | "w";
const WIDEST = "That is as wide as a near call goes. Use Between for more floors.";
/** One step of a tab or a stepper: `d` floors (rows) up or down. */
export function nudgeCall(g: Grid, c: Call, role: Role, d: number): { call: Call; msg: string } {
  const NR = g.rows.length;
  if (c.kind === "between") {
    const rl = g.rowOf[c.lo]!, rh = g.rowOf[c.hi]!;
    if (role === "hi") return { call: between(c.lo, g.rows[clamp(rh + d, rl, NR - 1)]!.b), msg: "" };
    if (role === "lo") return { call: between(g.rows[clamp(rl + d, 0, rh)]!.a, c.hi), msg: "" };
    const w = rh - rl, nl = clamp(rl + d, 0, NR - 1 - w);
    return { call: between(g.rows[nl]!.a, g.rows[nl + w]!.b), msg: "" };
  }
  if (role === "c" || role === "body") return { call: nearAt(g, c.c + d, c.s), msg: "" };
  const s = c.s + d;
  return { call: nearAt(g, c.c, s), msg: s > MAX_S ? WIDEST : s < 1 ? "Narrowest near call. For one floor only, use Between." : "" };
}
export const WIDEST_MSG = WIDEST;

/** A call's name from the round alone (pages without a tower, like Yours). */
export function ladderCallName(l: stook.LadderAccount, dp: number, s: stook.Shape): string {
  if (l.p0 <= 0n) return s.h > 1 ? `Near floor ${(s.lo + s.hi) / 2}, ±${s.h - 1} floors` : `Floors ${s.lo} to ${s.hi}`;
  return callName(makeGrid({ curve: l.curve, p0: l.p0, expo: l.p0Expo, stepBps: l.stepBps || 100, dp, keep: [], all: true }), s);
}
