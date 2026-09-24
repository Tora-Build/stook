// A series: one coin's rounds, one per day. Mirrors `state/series.rs`,
// `math/calendar.rs` and the band-width rule in `math/ladder.rs`, so an app
// can derive every day's round address and show a round's exact terms (when
// it opens and locks, how wide its bands are, the odds it opens with) before
// anyone has funded it.

import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { SOOTH_CORE_PROGRAM_ID } from "../program.js";
import { expWad, WAD } from "../math/lmsr.js";
import { BINS, fresh, liquidityForDeposit, roundTimes, type Curve } from "./math.js";
import type { LadderAccount, LadderTrancheAccount } from "./accounts.js";

const enc = new TextEncoder();
const SEED_SERIES = enc.encode("series");
const SEED_CONFIG = enc.encode("protocol_config");

export const SERIES_DISCRIMINATOR = Uint8Array.from([240, 97, 8, 183, 139, 77, 250, 162]);
const DISC = {
  create: [180, 125, 141, 219, 152, 55, 229, 81],
  set: [31, 44, 93, 106, 192, 123, 3, 29],
  observe: [22, 211, 65, 155, 60, 45, 214, 115],
} as const;

/** Closes a series learns from before it takes a round (`WARMUP_OBSERVATIONS`). */
export const WARMUP_OBSERVATIONS = 20;
export const warmedUp = (s: Pick<SeriesAccount, "observations" | "varWad">) => s.observations >= WARMUP_OBSERVATIONS && s.varWad > 0n;

export const CLOCK_UTC = 0;
export const CLOCK_NEW_YORK = 1;
/** New York, Monday to Friday: no rounds on weekends. */
export const CLOCK_NEW_YORK_WEEKDAYS = 2;
export const DAY = 86_400;

// ── the band-width rule (math::ladder) ───────────────────────────────────────

export const SIGMA_BANDS = 4n;
export const PRIOR_PEAK_LN = 7n * WAD;
export const MIN_STEP_BPS = 20;
export const MIN_VAR_BANDS = WAD / 4n;
export const MAX_STEP_BPS = 2_000;
/** How far ahead a day can be funded. Its bands are set when it opens. */
export const MAX_LEAD_SECS = 31n * 86_400n;

export function isqrt(n: bigint): bigint {
  if (n < 2n) return n;
  let x = 1n << BigInt(Math.floor((n.toString(2).length + 1) / 2));
  for (;;) {
    const y = (x + n / x) / 2n;
    if (y >= x) return x;
    x = y;
  }
}

/** `band_width`: a round's band width (bps) and its bell's variance in bands² (WAD). */
export function bandWidth(varDay: bigint, windowSecs: bigint): { stepBps: number; varBands: bigint } {
  if (varDay <= 0n || windowSecs <= 0n) throw new Error("bandWidth: bad input");
  const varWindow = (varDay * windowSecs) / BigInt(DAY);
  const sigmaBpsX100 = isqrt((varWindow * 1_000_000_000_000n) / WAD);
  let step = (sigmaBpsX100 + 50n * SIGMA_BANDS) / (100n * SIGMA_BANDS);
  if (step < BigInt(MIN_STEP_BPS)) step = BigInt(MIN_STEP_BPS);
  if (step > BigInt(MAX_STEP_BPS)) step = BigInt(MAX_STEP_BPS);
  const vb = (varWindow * 100_000_000n) / (step * step);
  return { stepBps: Number(step), varBands: vb > MIN_VAR_BANDS ? vb : MIN_VAR_BANDS };
}

/** `prior`: the odds a round opens with, for a bell `varBands` bands² wide. */
export function prior(varBands: bigint): Curve {
  if (varBands <= 0n) throw new Error("prior: bad variance");
  const k = (WAD * WAD) / (8n * varBands);
  const w = Array<bigint>(BINS).fill(WAD);
  for (let i = 0; i < BINS / 2; i++) {
    const d = 2n * BigInt(i) - BigInt(BINS - 1);
    const drop = d * d * k;
    if (drop < PRIOR_PEAK_LN) {
      const v = expWad(PRIOR_PEAK_LN - drop);
      w[i] = v;
      w[BINS - 1 - i] = v;
    }
  }
  return { w, sum: w.reduce((a, b) => a + b, 0n) };
}

// ── the calendar (math::calendar) ────────────────────────────────────────────

const div = (a: number, b: number) => Math.floor(a / b);

/** Days since 1970-01-01 of (y, m 1..12, d). */
export function daysFromCivil(y: number, m: number, d: number): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = div(yy >= 0 ? yy : yy - 399, 400);
  const yoe = yy - era * 400;
  const mp = (m + 9) % 12;
  const doy = div(153 * mp + 2, 5) + d - 1;
  const doe = yoe * 365 + div(yoe, 4) - div(yoe, 100) + doy;
  return era * 146_097 + doe - 719_468;
}

export function civilFromDays(z0: number): [number, number, number] {
  const z = z0 + 719_468;
  const era = div(z >= 0 ? z : z - 146_096, 146_097);
  const doe = z - era * 146_097;
  const yoe = div(doe - div(doe, 1460) + div(doe, 36_524) - div(doe, 146_096), 365);
  const doy = doe - (365 * yoe + div(yoe, 4) - div(yoe, 100));
  const mp = div(5 * doy + 2, 153);
  const d = doy - div(153 * mp + 2, 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return [yoe + era * 400 + (m <= 2 ? 1 : 0), m, d];
}

const weekday = (day: number) => (((day + 4) % 7) + 7) % 7;
const nthSunday = (y: number, m: number, n: number) => { const f = daysFromCivil(y, m, 1); return f + ((7 - weekday(f)) % 7) + 7 * (n - 1); };
export const newYorkDst = (day: number) => { const [y] = civilFromDays(day); return day >= nthSunday(y, 3, 2) && day < nthSunday(y, 11, 1); };
export const newYorkOffset = (day: number) => (newYorkDst(day) ? -4 * 3600 : -5 * 3600);

const nthWeekday = (y: number, m: number, wd: number, n: number) => { const f = daysFromCivil(y, m, 1); return f + (((wd - weekday(f)) % 7) + 7) % 7 + 7 * (n - 1); };
const lastWeekday = (y: number, m: number, wd: number) => { const l = daysFromCivil(y, m + 1, 1) - 1; return l - (((weekday(l) - wd) % 7) + 7) % 7; };
function easter(y: number): number {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, g = Math.floor((8 * b + 13) / 25);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  return daysFromCivil(y, Math.floor((h + l - 7 * m + 114) / 31), ((h + l - 7 * m + 114) % 31) + 1);
}
const observed = (day: number) => (weekday(day) === 6 ? day - 1 : weekday(day) === 0 ? day + 1 : day);
/** `calendar::nyse_holiday`: the exchange's full-day holidays, by rule. */
export function nyseHoliday(day: number): boolean {
  const [y] = civilFromDays(day);
  const ny = daysFromCivil(y, 1, 1);
  return (weekday(ny) !== 6 && day === observed(ny)) || day === nthWeekday(y, 1, 1, 3) || day === nthWeekday(y, 2, 1, 3) || day === easter(y) - 2
    || day === lastWeekday(y, 5, 1) || (y >= 2022 && day === observed(daysFromCivil(y, 6, 19))) || day === observed(daysFromCivil(y, 7, 4))
    || day === nthWeekday(y, 9, 1, 1) || day === nthWeekday(y, 11, 4, 4) || day === observed(daysFromCivil(y, 12, 25));
}

// ── the account ──────────────────────────────────────────────────────────────

export interface SeriesAccount {
  feedId: Uint8Array;
  quoteMint: PublicKey;
  periodSecs: number;
  closeSecs: number;
  clock: number;
  active: boolean;
  /** Variance of daily log returns, WAD. */
  varWad: bigint;
  lastPrice: bigint;
  lastExpo: number;
  lastAt: bigint;
  observations: number;
}

export const SERIES_SIZE = 8 + 32 + 32 + 4 + 4 + 1 + 1 + 1 + 16 + 8 + 4 + 8 + 4;

export function decodeSeries(data: Uint8Array): SeriesAccount {
  if (data.length < SERIES_SIZE) throw new Error("Series: too short");
  for (let i = 0; i < 8; i++) if (data[i] !== SERIES_DISCRIMINATOR[i]) throw new Error("not a Series account");
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let at = 8;
  const feedId = data.slice(at, at + 32); at += 32;
  const quoteMint = new PublicKey(data.slice(at, at + 32)); at += 32;
  const periodSecs = v.getUint32(at, true); at += 4;
  const closeSecs = v.getUint32(at, true); at += 4;
  const clock = v.getUint8(at++), active = v.getUint8(at++) === 1; at++;
  const lo = v.getBigUint64(at, true), hi = v.getBigInt64(at + 8, true); at += 16;
  const lastPrice = v.getBigInt64(at, true); at += 8;
  const lastExpo = v.getInt32(at, true); at += 4;
  const lastAt = v.getBigInt64(at, true); at += 8;
  const observations = v.getUint32(at, true);
  return { feedId, quoteMint, periodSecs, closeSecs, clock, active, varWad: lo | (hi << 64n), lastPrice, lastExpo, lastAt, observations };
}

/** `Series::close_of`: the second round `index` settles. */
export function closeOf(s: Pick<SeriesAccount, "periodSecs" | "closeSecs" | "clock">, index: number): bigint {
  if (s.periodSecs > 0) return BigInt(index) * BigInt(s.periodSecs) + BigInt(s.closeSecs);
  const local = BigInt(index) * BigInt(DAY) + BigInt(s.closeSecs);
  return s.clock === CLOCK_NEW_YORK || s.clock === CLOCK_NEW_YORK_WEEKDAYS ? local - BigInt(newYorkOffset(index)) : local;
}

/** `Series::has_round`: a weekday series has no round on Saturday, Sunday or an NYSE holiday. */
export const hasRound = (s: Pick<SeriesAccount, "periodSecs" | "clock">, index: number) =>
  s.periodSecs > 0 || s.clock !== CLOCK_NEW_YORK_WEEKDAYS || !([0, 6].includes(weekday(index)) || nyseHoliday(index));

/** A daily series' index for a calendar date: its day number. */
export const dayIndex = (y: number, m1: number, d: number) => daysFromCivil(y, m1, d);

export interface RoundTerms {
  settlesAt: bigint;
  opensAt: bigint;
  locksAt: bigint;
  stepBps: number;
  varBands: bigint;
  /** The odds it would open with. */
  curve: Curve;
  /** Can it be funded now: not too soon, not too far ahead. */
  fundable: boolean;
  /** The earliest it can be funded. */
  fundableFrom: bigint;
}

/**
 * A deposit's depth and the odds it joined at (`tranche_terms`): stored for
 * one made while trading, recomputed for one made before open from its size
 * and the bell the round opened on.
 */
export function trancheTerms(l: Pick<LadderAccount, "varBandsE9" | "decimals">, t: Pick<LadderTrancheAccount, "b" | "deposit" | "join">): { b: bigint; join: Curve } {
  if (t.b !== 0n || l.varBandsE9 === 0n) return { b: t.b, join: t.join };
  const curve = prior(l.varBandsE9 * 1_000_000_000n);
  return { b: liquidityForDeposit(curve, t.deposit, l.decimals), join: curve };
}

/** What `ladder_open` does to the bands and odds (`band_width`, then the
 *  bell truncated to 1e-9 bands², as stored), opening at `openAt`. */
export function openingTerms(varWad: bigint, settlesAt: bigint, openAt: bigint): { stepBps: number; varBandsE9: bigint; curve: Curve } {
  const { stepBps, varBands } = bandWidth(varWad, settlesAt - openAt);
  let e9 = varBands / 1_000_000_000n;
  if (e9 < 1n) e9 = 1n;
  return { stepBps, varBandsE9: e9, curve: prior(e9 * 1_000_000_000n) };
}

/**
 * When a round for `index` funded at `now` would open and lock, whether it
 * can be funded now, and the bands and odds it would open with if the
 * volatility stayed where it is (they are set at open, from the volatility
 * then).
 */
export function roundTerms(s: SeriesAccount, index: number, now: bigint): RoundTerms {
  const settlesAt = closeOf(s, index);
  const { opensAt, locksAt } = roundTimes(now, settlesAt);
  const fundable = s.active && hasRound(s, index) && now + 900n <= settlesAt && settlesAt <= now + MAX_LEAD_SECS;
  // A day that has passed (or is too close) has no window to size bands for:
  // say so rather than throw, since a calendar asks about every day.
  if (settlesAt <= opensAt || s.varWad <= 0n) return { settlesAt, opensAt, locksAt, stepBps: 0, varBands: 0n, curve: fresh(), fundable: false, fundableFrom: settlesAt - MAX_LEAD_SECS };
  const o = openingTerms(s.varWad, settlesAt, opensAt);
  return { settlesAt, opensAt, locksAt, stepBps: o.stepBps, varBands: o.varBandsE9 * 1_000_000_000n, curve: o.curve, fundable, fundableFrom: settlesAt - MAX_LEAD_SECS };
}

// ── addresses and builders ───────────────────────────────────────────────────

const u32 = (v: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v, true); return b; };
const i128 = (v: bigint) => { const b = new Uint8Array(16); const d = new DataView(b.buffer); d.setBigUint64(0, v & ((1n << 64n) - 1n), true); d.setBigInt64(8, v >> 64n, true); return b; };
const find = (seeds: Uint8Array[], programId: PublicKey) => PublicKey.findProgramAddressSync(seeds, programId)[0];

/** One series per (feed, quote mint, period); period 0 is the daily calendar. */
export function deriveSeries(feedId: Uint8Array, quoteMint: PublicKey, periodSecs = 0, programId = SOOTH_CORE_PROGRAM_ID): PublicKey {
  if (feedId.length !== 32) throw new Error("feedId must be 32 bytes");
  return find([SEED_SERIES, feedId, quoteMint.toBytes(), u32(periodSecs)], programId);
}

export interface CreateSeriesArgs {
  authority: PublicKey;
  feedId: Uint8Array;
  quoteMint: PublicKey;
  periodSecs?: number;
  closeSecs: number;
  clock: number;
  programId?: PublicKey;
}

export function createSeriesIx(a: CreateSeriesArgs): TransactionInstruction {
  const programId = a.programId ?? SOOTH_CORE_PROGRAM_ID;
  const period = a.periodSecs ?? 0;
  return new TransactionInstruction({
    programId,
    data: Buffer.concat([Uint8Array.from(DISC.create), a.feedId, u32(period), u32(a.closeSecs), Uint8Array.of(a.clock)]),
    keys: [
      { pubkey: a.authority, isSigner: true, isWritable: true },
      { pubkey: find([SEED_CONFIG], programId), isSigner: false, isWritable: false },
      { pubkey: a.quoteMint, isSigner: false, isWritable: false },
      { pubkey: deriveSeries(a.feedId, a.quoteMint, period, programId), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
  });
}

/** Protocol authority: pause or resume a series' new rounds. Nothing sets its volatility. */
export function setSeriesIx(authority: PublicKey, series: PublicKey, active: boolean, programId = SOOTH_CORE_PROGRAM_ID): TransactionInstruction {
  return new TransactionInstruction({
    programId,
    data: Buffer.concat([Uint8Array.from(DISC.set), Uint8Array.of(active ? 1 : 0)]),
    keys: [
      { pubkey: authority, isSigner: true, isWritable: false },
      { pubkey: find([SEED_CONFIG], programId), isSigner: false, isWritable: false },
      { pubkey: series, isSigner: false, isWritable: true },
    ],
  });
}

/**
 * Teach a series the close of day (period) `index`, from the Pyth update
 * that is the price at that close under the settlement rule. Anyone may.
 */
export function observeSeriesIx(series: PublicKey, caller: PublicKey, priceUpdate: PublicKey, index: number, programId = SOOTH_CORE_PROGRAM_ID): TransactionInstruction {
  return new TransactionInstruction({
    programId,
    data: Buffer.concat([Uint8Array.from(DISC.observe), u32(index)]),
    keys: [
      { pubkey: caller, isSigner: true, isWritable: false },
      { pubkey: series, isSigner: false, isWritable: true },
      { pubkey: priceUpdate, isSigner: false, isWritable: false },
    ],
  });
}

/** The index with a round whose close is the latest at or before `t`
 *  (`Series::index_at_or_before`). */
export function indexAtOrBefore(s: Pick<SeriesAccount, "periodSecs" | "closeSecs" | "clock">, t: bigint): number {
  const span = s.periodSecs > 0 ? s.periodSecs : DAY;
  let i = Math.floor(Number(t - BigInt(s.closeSecs)) / span) + 1;
  while (closeOf(s, i) > t || !hasRound(s, i)) i--;
  return i;
}

/**
 * The closes a series has not learned yet, oldest first, up to `max`: every
 * day (period) with a round, after the last one it saw and at least `settle`
 * seconds in the past. A new series starts `backfill` closes back, so it can
 * warm up from Pyth's history at once.
 */
export function pendingObservations(s: SeriesAccount, now: bigint, max = 40, settle = 60n, backfill = WARMUP_OBSERVATIONS + 5): number[] {
  const latest = indexAtOrBefore(s, now - settle);
  const out: number[] = [];
  // The program takes closes strictly in order (`Series::may_observe`). A
  // series that has learned nothing yet backfills from the start, even before
  // a close it has already anchored on (re-anchoring there, then walking
  // forward through every day, its old anchor included); after that, only the
  // days after the last one learned, in order.
  const cold = s.observations === 0;
  let from = !cold ? indexAtOrBefore(s, s.lastAt) + 1 : latest - backfill;
  // A weekday series skips weekends when counting its backfill.
  if (cold) { let n = 0; for (from = latest; from > latest - 3 * backfill && n < backfill; from--) if (hasRound(s, from)) n++; }
  for (let i = from; i <= latest && out.length < max; i++) if (hasRound(s, i) && (cold || closeOf(s, i) > s.lastAt)) out.push(i);
  if (cold && out.length && closeOf(s, out[0]) === s.lastAt) out.shift();
  return out;
}

/** A warmed-up series may pass over closes this old, whose updates may no
 *  longer be postable (`Series::may_observe`); otherwise every close is taken. */
export const SKIP_AFTER_SECS = 7n * 86_400n;
/** How long a daily round waits for its series to learn the close before its opening. */
export const OPEN_LEARN_GRACE_SECS = 30n * 60n;

/**
 * Why `ladder_open` would refuse this round now for its series' sake, or null:
 * the series has not warmed up, or (daily) has not yet taken the latest close
 * at or before now (or the opening) and that close is under half an hour old.
 */
export function openBlocker(s: SeriesAccount, opensAt: bigint, now: bigint): string | null {
  if (!warmedUp(s)) return `series warming up (${s.observations}/${WARMUP_OBSERVATIONS} closes)`;
  if (s.periodSecs === 0) {
    const prev = closeOf(s, indexAtOrBefore(s, opensAt > now ? opensAt : now));
    if (s.lastAt < prev && now < prev + OPEN_LEARN_GRACE_SECS) return "series has not learned the last close yet";
  }
  return null;
}

/** σ_day as a fraction → the series' variance, WAD. */
export const varFromSigma = (sigmaDay: number): bigint => BigInt(Math.round(sigmaDay * sigmaDay * 1e18));
