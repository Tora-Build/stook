// Pool-fed anchors (program: `pool_oracle`). A series or round whose feed id
// is a Raydium CLMM pool's address settles on the pool's ten-minute average
// to the instant, read from the pool's observation account. Every
// instruction that reads a price (open, settle, observe) then takes the pool
// in the price slot and its observation account as the first remaining
// account (`withObservation`).
//
// `poolPriceAt` is the program's arithmetic, for the keeper to know whether a
// close can be settled yet (an observation must exist at or after it) and
// what it will settle on.

import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { SOOTH_CORE_PROGRAM_ID } from "../program.js";

export const RAYDIUM_CLMM = new PublicKey("CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK");
/** The averaging window, ending at the instant (`POOL_TWAP_SECS`). */
export const POOL_TWAP_SECS = 600;
/** How old the latest entry may be for a round opened late (`POOL_LIVE_MAX_AGE_SECS`). */
export const POOL_LIVE_MAX_AGE_SECS = 900;
export const POOL_EXPONENT = -8;

const POOL_LEN = 1544, OBS_LEN = 4483;
const POOL_OBSERVATION_KEY = 8 + 1 + 32 * 6, POOL_DECIMALS = 8 + 1 + 32 * 7;
const OBS_POOL_ID = 8 + 1 + 8 + 2, OBS_ENTRIES = OBS_POOL_ID + 32, OBS_ENTRY_LEN = 44, OBS_COUNT = 100;

export interface PoolAccount { mint0: PublicKey; mint1: PublicKey; observation: PublicKey; decimals0: number; decimals1: number }
export interface Observation { at: number; cumulative: bigint }

export function decodePool(d: Uint8Array): PoolAccount {
  if (d.length !== POOL_LEN) throw new Error(`not a Raydium CLMM pool (${d.length} bytes)`);
  const key = (o: number) => new PublicKey(d.subarray(o, o + 32));
  return { mint0: key(8 + 1 + 32 * 2), mint1: key(8 + 1 + 32 * 3), observation: key(POOL_OBSERVATION_KEY), decimals0: d[POOL_DECIMALS]!, decimals1: d[POOL_DECIMALS + 1]! };
}

/** The observation account's entries, oldest first. */
export function decodeObservations(d: Uint8Array): Observation[] {
  if (d.length !== OBS_LEN) throw new Error(`not a Raydium CLMM observation account (${d.length} bytes)`);
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength), out: Observation[] = [];
  for (let i = 0; i < OBS_COUNT; i++) {
    const o = OBS_ENTRIES + i * OBS_ENTRY_LEN, at = v.getUint32(o, true);
    if (at) out.push({ at, cumulative: v.getBigInt64(o + 4, true) });
  }
  return out.sort((a, b) => a.at - b.at);
}

const floorDiv = (a: bigint, b: bigint) => (a % b === 0n || (a < 0n) === (b < 0n) ? a / b : a / b - 1n);
function cumulativeAt(obs: Observation[], x: number): bigint | null {
  let before: Observation | undefined, after: Observation | undefined;
  for (const o of obs) { if (o.at <= x) before = o; if (o.at >= x && !after) after = o; }
  if (!before || !after) return null;
  if (before.at === after.at) return before.cumulative;
  return before.cumulative + floorDiv((after.cumulative - before.cumulative) * BigInt(x - before.at), BigInt(after.at - before.at));
}

/** The program's price at `t` (raw, exponent -8), or null if the entries do not cover the window yet. */
export function poolPriceAt(pool: Pick<PoolAccount, "decimals0" | "decimals1">, obs: Observation[], t: number): { price: bigint; tick: number } | null {
  const c1 = cumulativeAt(obs, t), c0 = cumulativeAt(obs, t - POOL_TWAP_SECS);
  if (c1 === null || c0 === null) return null;
  const tick = Number(floorDiv(c1 - c0, BigInt(POOL_TWAP_SECS)));
  const price = Math.exp(tick * Math.log(1.0001)) * 10 ** (pool.decimals0 - pool.decimals1 - POOL_EXPONENT);
  return { price: BigInt(Math.round(price)), tick };
}

/** The latest entry's time: the newest close the pool can price yet is at or before it. */
export const latestObservation = (obs: Observation[]) => obs[obs.length - 1]?.at ?? 0;

/** Is this feed id a pool's address (owned by Raydium CLMM)? Needs the account's owner. */
export const isPoolOwner = (owner: PublicKey) => owner.equals(RAYDIUM_CLMM);

/** Append the pool's observation account, the remaining account every price-reading instruction takes for a pool. */
export function withObservation(ix: TransactionInstruction, observation: PublicKey): TransactionInstruction {
  ix.keys.push({ pubkey: observation, isSigner: false, isWritable: false });
  return ix;
}

/** `sha256("global:series_seed")[..8]`. */
const SEED_DISC = [244, 198, 142, 15, 5, 19, 97, 66];
const SEED_CONFIG = new TextEncoder().encode("protocol_config");

/**
 * Start a pool-fed series warm (`series_seed`): its variance, once, before it
 * is warmed up, and the latest close at the pool's price for it (the pool's
 * entries must cover that close). Protocol authority. `varWad` is the
 * variance of daily log returns in WAD (a 3% daily move: 0.03² · 1e18 = 9e14).
 */
export function seriesSeedIx(authority: PublicKey, series: PublicKey, pool: PublicKey, observation: PublicKey, varWad: bigint, programId = SOOTH_CORE_PROGRAM_ID): TransactionInstruction {
  const data = new Uint8Array(8 + 16);
  data.set(SEED_DISC, 0);
  const v = new DataView(data.buffer);
  const u = BigInt.asUintN(128, varWad);
  v.setBigUint64(8, u & 0xffffffffffffffffn, true);
  v.setBigUint64(16, u >> 64n, true);
  return new TransactionInstruction({
    programId,
    data: Buffer.from(data),
    keys: [
      { pubkey: authority, isSigner: true, isWritable: false },
      { pubkey: PublicKey.findProgramAddressSync([SEED_CONFIG], programId)[0], isSigner: false, isWritable: false },
      { pubkey: series, isSigner: false, isWritable: true },
      { pubkey: pool, isSigner: false, isWritable: false },
      { pubkey: observation, isSigner: false, isWritable: false },
    ],
  });
}

/** A daily variance in WAD from past daily closes (oldest first): the mean squared log return. */
export function varianceFromCloses(closes: number[]): bigint {
  const r = closes.slice(1).map((c, i) => Math.log(c / closes[i]!));
  if (!r.length) throw new Error("need two closes or more");
  const v = r.reduce((s, x) => s + x * x, 0) / r.length;
  return BigInt(Math.round(v * 1e18));
}
