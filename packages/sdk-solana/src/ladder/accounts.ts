// Decoders for the three ladder accounts. `Ladder` and `LadderTranche` are
// zero-copy on chain, so these read fixed offsets; the offsets are asserted
// against the Rust layout by the size test in `state/ladder.rs` and against a
// live account by `tests/ladder-e2e.test.ts`.

import { PublicKey } from "@solana/web3.js";
import { BINS, type Curve, type Shape } from "./math.js";

export const LADDER_SIZE = 8 + 1880;
export const TRANCHE_SIZE = 8 + 1152;

export const LADDER_DISCRIMINATOR = Uint8Array.from([125, 146, 35, 254, 42, 7, 204, 222]);
export const POSITION_DISCRIMINATOR = Uint8Array.from([59, 184, 232, 14, 183, 181, 106, 108]);
export const TRANCHE_DISCRIMINATOR = Uint8Array.from([28, 202, 6, 118, 165, 136, 143, 240]);

export type LadderStatus = "seeding" | "open" | "settled" | "void";
const STATUS: LadderStatus[] = ["seeding", "open", "settled", "void"];
const NO_BIN = 255;

export interface LadderAccount {
  opensAt: bigint;
  locksAt: bigint;
  settlesAt: bigint;
  /** Oracle price the grid is centred on, in the feed's raw units. 0 until open. */
  p0: bigint;
  p0Expo: number;
  cash: bigint;
  depositTotal: bigint;
  /** Bumped by every trade. `ladder_lp_join` must name it. */
  curveSeq: bigint;
  feesLp: bigint;
  feesCreator: bigint;
  feesProtocol: bigint;
  basisTotal: bigint;
  lpPool: bigint;
  voidVault: bigint;
  voidBasis: bigint;
  /** What the pool owes if each bin settles, base units. */
  payout: bigint[];
  stepBps: number;
  feeBps: number;
  feedId: Uint8Array;
  quoteMint: PublicKey;
  vault: PublicKey;
  creator: PublicKey;
  sponsor: PublicKey;
  /** Total depth `B = Σ bⱼ`, WAD. */
  b: bigint;
  accFee: bigint;
  curve: Curve;
  status: LadderStatus;
  settledBin: number | null;
  tier: number;
  decimals: number;
}

class Reader {
  private readonly view: DataView;
  constructor(private readonly data: Uint8Array, public at = 8) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }
  u8() { return this.view.getUint8(this.at++); }
  u16() { const v = this.view.getUint16(this.at, true); this.at += 2; return v; }
  i16() { const v = this.view.getInt16(this.at, true); this.at += 2; return v; }
  i32() { const v = this.view.getInt32(this.at, true); this.at += 4; return v; }
  u64() { const v = this.view.getBigUint64(this.at, true); this.at += 8; return v; }
  i64() { const v = this.view.getBigInt64(this.at, true); this.at += 8; return v; }
  u128() { const lo = this.u64(); return lo | (this.u64() << 64n); }
  i128() { const lo = this.u64(); return lo | (this.i64() << 64n); }
  bytes(n: number) { const v = this.data.slice(this.at, this.at + n); this.at += n; return v; }
  key() { return new PublicKey(this.bytes(32)); }
}

function expect(data: Uint8Array, disc: Uint8Array, size: number, what: string) {
  if (data.length < size) throw new Error(`${what}: ${data.length} bytes, expected ${size}`);
  for (let i = 0; i < 8; i++) if (data[i] !== disc[i]) throw new Error(`not a ${what} account`);
}

export function decodeLadder(data: Uint8Array): LadderAccount {
  expect(data, LADDER_DISCRIMINATOR, LADDER_SIZE, "Ladder");
  const r = new Reader(data);
  const opensAt = r.i64(), locksAt = r.i64(), settlesAt = r.i64(), p0 = r.i64();
  const cash = r.u64(), depositTotal = r.u64(), curveSeq = r.u64();
  const feesLp = r.u64(), feesCreator = r.u64(), feesProtocol = r.u64();
  const basisTotal = r.u64(), lpPool = r.u64(), voidVault = r.u64(), voidBasis = r.u64();
  const payout = Array.from({ length: BINS }, () => r.u64());
  const p0Expo = r.i32(), stepBps = r.u16(), feeBps = r.u16();
  const feedId = r.bytes(32);
  const quoteMint = r.key(), vault = r.key(), creator = r.key(), sponsor = r.key();
  const b = r.i128(), accFee = r.u128(), sum = r.i128();
  const w = Array.from({ length: BINS }, () => r.i128());
  const status = r.u8(), settledBin = r.u8(), tier = r.u8(), decimals = r.u8();
  return {
    opensAt, locksAt, settlesAt, p0, p0Expo, cash, depositTotal, curveSeq,
    feesLp, feesCreator, feesProtocol, basisTotal, lpPool, voidVault, voidBasis,
    payout, stepBps, feeBps, feedId, quoteMint, vault, creator, sponsor,
    b, accFee, curve: { w, sum },
    status: STATUS[status] ?? "void",
    settledBin: settledBin === NO_BIN ? null : settledBin,
    tier, decimals,
  };
}

export interface LadderPositionAccount {
  ladder: PublicKey;
  owner: PublicKey;
  shape: Shape;
  shares: bigint;
  /** Everything paid for the shares still held, fee included. A void refunds this. */
  netPaid: bigint;
}

export function decodeLadderPosition(data: Uint8Array): LadderPositionAccount {
  expect(data, POSITION_DISCRIMINATOR, 8 + 32 + 32 + 2 + 2 + 1 + 8 + 8, "LadderPosition");
  const r = new Reader(data);
  const ladder = r.key(), owner = r.key();
  const lo = r.i16(), hi = r.i16(), h = r.u8();
  return { ladder, owner, shape: { lo, hi, h }, shares: r.u64(), netPaid: r.u64() };
}

export interface LadderTrancheAccount {
  deposit: bigint;
  ladder: PublicKey;
  owner: PublicKey;
  /** Depth this tranche contributes, WAD. */
  b: bigint;
  feeSnap: bigint;
  /** The curve it joined at — the whole of its accounting. */
  join: Curve;
  index: number;
}

export function decodeLadderTranche(data: Uint8Array): LadderTrancheAccount {
  expect(data, TRANCHE_DISCRIMINATOR, TRANCHE_SIZE, "LadderTranche");
  const r = new Reader(data);
  const deposit = r.u64(), ladder = r.key(), owner = r.key();
  const b = r.i128(), feeSnap = r.u128(), sum = r.i128();
  const w = Array.from({ length: BINS }, () => r.i128());
  return { deposit, ladder, owner, b, feeSnap, join: { w, sum }, index: r.u8() };
}
