// A series: one coin's rounds, one per day. Mirrors `state/series.rs`,
// `math/calendar.rs` and the band-width rule in `math/ladder.rs`, so an app
// can derive every day's round address and show a round's exact terms (when
// it opens and locks, how wide its bands are, the odds it opens with) before
// anyone has funded it.

import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { SOOTH_CORE_PROGRAM_ID } from "../program.js";
import { expWad, WAD } from "../math/lmsr.js";
import { BINS, fresh, roundTimes, type Curve } from "./math.js";

const enc = new TextEncoder();
const SEED_SERIES = enc.encode("series");
const SEED_CONFIG = enc.encode("protocol_config");

export const SERIES_DISCRIMINATOR = Uint8Array.from([240, 97, 8, 183, 139, 77, 250, 162]);
const DISC = {
  create: [180, 125, 141, 219, 152, 55, 229, 81],
  set: [31, 44, 93, 106, 192, 123, 3, 29],
} as const;

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
export const MAX_LEAD_SECS = 48n * 3_600n;

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

/** `Series::has_round`: a weekday series has no round on Saturday or Sunday. */
export const hasRound = (s: Pick<SeriesAccount, "periodSecs" | "clock">, index: number) =>
  s.periodSecs > 0 || s.clock !== CLOCK_NEW_YORK_WEEKDAYS || ![0, 6].includes(weekday(index));

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

/** Exactly what `ladder_create` would write for `index` if funded at `now`. */
export function roundTerms(s: SeriesAccount, index: number, now: bigint): RoundTerms {
  const settlesAt = closeOf(s, index);
  const { opensAt, locksAt } = roundTimes(now, settlesAt);
  const fundable = s.active && hasRound(s, index) && now + 900n <= settlesAt && settlesAt <= now + MAX_LEAD_SECS;
  // A day that has passed (or is too close) has no window to size bands for:
  // say so rather than throw, since a calendar asks about every day.
  if (settlesAt <= opensAt) return { settlesAt, opensAt, locksAt, stepBps: 0, varBands: 0n, curve: fresh(), fundable: false, fundableFrom: settlesAt - MAX_LEAD_SECS };
  const { stepBps, varBands } = bandWidth(s.varWad, settlesAt - opensAt);
  return { settlesAt, opensAt, locksAt, stepBps, varBands, curve: prior(varBands), fundable, fundableFrom: settlesAt - MAX_LEAD_SECS };
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
  /** Variance of daily log returns, WAD: (σ_day)² · 10¹⁸. */
  varWad: bigint;
  programId?: PublicKey;
}

export function createSeriesIx(a: CreateSeriesArgs): TransactionInstruction {
  const programId = a.programId ?? SOOTH_CORE_PROGRAM_ID;
  const period = a.periodSecs ?? 0;
  return new TransactionInstruction({
    programId,
    data: Buffer.concat([Uint8Array.from(DISC.create), a.feedId, u32(period), u32(a.closeSecs), Uint8Array.of(a.clock), i128(a.varWad)]),
    keys: [
      { pubkey: a.authority, isSigner: true, isWritable: true },
      { pubkey: find([SEED_CONFIG], programId), isSigner: false, isWritable: false },
      { pubkey: a.quoteMint, isSigner: false, isWritable: false },
      { pubkey: deriveSeries(a.feedId, a.quoteMint, period, programId), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
  });
}

export function setSeriesIx(authority: PublicKey, series: PublicKey, p: { active?: boolean; varWad?: bigint }, programId = SOOTH_CORE_PROGRAM_ID): TransactionInstruction {
  const opt = (v: Uint8Array | null) => (v ? Buffer.concat([Uint8Array.of(1), v]) : Uint8Array.of(0));
  return new TransactionInstruction({
    programId,
    data: Buffer.concat([Uint8Array.from(DISC.set), opt(p.active === undefined ? null : Uint8Array.of(p.active ? 1 : 0)), opt(p.varWad === undefined ? null : i128(p.varWad))]),
    keys: [
      { pubkey: authority, isSigner: true, isWritable: false },
      { pubkey: find([SEED_CONFIG], programId), isSigner: false, isWritable: false },
      { pubkey: series, isSigner: false, isWritable: true },
    ],
  });
}

/** σ_day as a fraction → the series' variance, WAD. */
export const varFromSigma = (sigmaDay: number): bigint => BigInt(Math.round(sigmaDay * sigmaDay * 1e18));
