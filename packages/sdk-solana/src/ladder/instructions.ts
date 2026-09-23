// Instruction builders for the ladder. Hand-encoded rather than routed through
// the Anchor IDL client: the argument layouts are small and fixed, and this
// keeps the ladder usable from a bundle that never loads the IDL.
//
// Every transaction that reaches `sooth_core` must request a 256 KB heap frame
// first — `withHeap` does it. The program's allocator assumes it.

import {
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  type AccountMeta,
} from "@solana/web3.js";
import { SOOTH_CORE_PROGRAM_ID } from "../program.js";
import { BINS, type Shape } from "./math.js";

const enc = new TextEncoder();
const SEED_LADDER = enc.encode("ladder");
const SEED_AUTHORITY = enc.encode("ladder_auth");
const SEED_VAULT = enc.encode("ladder_vault");
const SEED_POSITION = enc.encode("ladder_pos");
const SEED_TRANCHE = enc.encode("ladder_tranche");
const SEED_CONFIG = enc.encode("protocol_config");
const SEED_MINT_APPROVAL = enc.encode("mint_approval");

const DISC = {
  create: [165, 10, 127, 30, 41, 17, 252, 67],
  open: [88, 129, 233, 84, 136, 27, 112, 248],
  trade: [162, 88, 142, 115, 117, 138, 37, 209],
  lpJoin: [232, 117, 195, 166, 157, 89, 197, 128],
  settle: [124, 60, 106, 236, 76, 223, 153, 206],
  void: [210, 181, 54, 242, 164, 19, 68, 196],
  redeem: [202, 8, 83, 149, 73, 199, 152, 198],
  claimLp: [173, 17, 30, 112, 208, 75, 43, 242],
  collectFees: [255, 191, 4, 129, 247, 197, 29, 170],
  sweep: [85, 148, 67, 229, 10, 130, 205, 62],
  close: [20, 102, 63, 170, 152, 236, 112, 5],
  approveQuoteMint: [178, 133, 192, 90, 211, 247, 157, 214],
  revokeQuoteMint: [198, 235, 87, 238, 190, 187, 101, 33],
} as const;

// ── little-endian packing ────────────────────────────────────────────────────

const le = (bytes: number, write: (v: DataView) => void) => {
  const b = new Uint8Array(bytes);
  write(new DataView(b.buffer));
  return b;
};
const u8 = (v: number) => Uint8Array.of(v);
const i16 = (v: number) => le(2, (d) => d.setInt16(0, v, true));
const u32 = (v: number) => le(4, (d) => d.setUint32(0, v, true));
const u64 = (v: bigint) => le(8, (d) => d.setBigUint64(0, v, true));
const i64 = (v: bigint) => le(8, (d) => d.setBigInt64(0, v, true));

function pack(disc: readonly number[], ...parts: Uint8Array[]): Buffer {
  return Buffer.concat([Uint8Array.from(disc), ...parts]);
}

const ro = (pubkey: PublicKey): AccountMeta => ({ pubkey, isSigner: false, isWritable: false });
const rw = (pubkey: PublicKey): AccountMeta => ({ pubkey, isSigner: false, isWritable: true });
const signer = (pubkey: PublicKey, isWritable = true): AccountMeta => ({ pubkey, isSigner: true, isWritable });

// ── addresses ────────────────────────────────────────────────────────────────

const find = (seeds: Uint8Array[], programId: PublicKey) => PublicKey.findProgramAddressSync(seeds, programId)[0];

export interface LadderKey {
  series: PublicKey;
  /** Which day (period) of the series: for a daily series, the day number. */
  index: number;
}

/** One round per day of a series. */
export function deriveLadderPda(k: LadderKey, programId = SOOTH_CORE_PROGRAM_ID): PublicKey {
  return find([SEED_LADDER, k.series.toBytes(), u32(k.index)], programId);
}
export const deriveLadderAuthority = (ladder: PublicKey, programId = SOOTH_CORE_PROGRAM_ID) =>
  find([SEED_AUTHORITY, ladder.toBytes()], programId);
export const deriveLadderVault = (ladder: PublicKey, programId = SOOTH_CORE_PROGRAM_ID) =>
  find([SEED_VAULT, ladder.toBytes()], programId);
export const deriveLadderPosition = (ladder: PublicKey, owner: PublicKey, s: Shape, programId = SOOTH_CORE_PROGRAM_ID) =>
  find([SEED_POSITION, ladder.toBytes(), owner.toBytes(), i16(s.lo), i16(s.hi), u8(s.h)], programId);
/** A wallet's `index`-th tranche. The creator's seed is index 0. */
export const deriveLadderTranche = (ladder: PublicKey, owner: PublicKey, index = 0, programId = SOOTH_CORE_PROGRAM_ID) =>
  find([SEED_TRANCHE, ladder.toBytes(), owner.toBytes(), u8(index)], programId);
/** Where the protocol authority's acceptance of a mint's issuer lives. */
export const deriveMintApproval = (mint: PublicKey, programId = SOOTH_CORE_PROGRAM_ID) =>
  find([SEED_MINT_APPROVAL, mint.toBytes()], programId);
const deriveConfig = (programId: PublicKey) => find([SEED_CONFIG], programId);

// ── builders ─────────────────────────────────────────────────────────────────

/** What every builder needs to know about the market it addresses. */
export interface LadderRefs {
  ladder: PublicKey;
  quoteMint: PublicKey;
  /** `TOKEN_PROGRAM_ID` or `TOKEN_2022_PROGRAM_ID` — whichever owns the mint. */
  tokenProgram: PublicKey;
  programId?: PublicKey;
}

const pid = (r: { programId?: PublicKey }) => r.programId ?? SOOTH_CORE_PROGRAM_ID;
const ix = (r: { programId?: PublicKey }, data: Buffer, keys: AccountMeta[]) =>
  new TransactionInstruction({ programId: pid(r), data, keys });

/**
 * The heap request every `sooth_core` transaction must carry, then `ixs`.
 * 120K CU covers the widest trade (measured 81K) with room; a lower request
 * also raises how many trades a block can hold on one market.
 */
export function withHeap(ixs: TransactionInstruction[], computeUnits = 120_000, priorityMicroLamports = 0): TransactionInstruction[] {
  return [
    ComputeBudgetProgram.requestHeapFrame({ bytes: 256 * 1024 }),
    ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }),
    ...(priorityMicroLamports > 0 ? [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityMicroLamports })] : []),
    ...ixs,
  ];
}

/**
 * Compute to request for a trade of `shape`, with room for an idempotent
 * create-ATA and a Token-2022 transfer in the same transaction. Per-bin cost
 * is ~1.2K normally and ~2.4K once a bin's weight passes ~340 (the 256-bit
 * multiply); measured worst case 188.6K for a 64-bin h=8 shape on a fully
 * grown Token-2022 market. Requesting more than is used costs nothing but
 * priority fee, so this errs generous.
 */
export function tradeComputeUnits(shape: Shape): number {
  const bins = Math.min(shape.hi, BINS - 1) - Math.max(shape.lo, 0) + 1;
  return 50_000 + bins * 2_600 + (shape.h > 1 ? 5_000 : 0);
}

export interface CreateLadderArgs extends LadderKey {
  quoteMint: PublicKey;
  creator: PublicKey;
  creatorToken: PublicKey;
  tokenProgram: PublicKey;
  /** The starter's deposit — tranche 0. At least one whole quote token. */
  seed: bigint;
  /** Who the market is presented as funded by. Defaults to the creator. */
  sponsor?: PublicKey;
  /**
   * Set for a mint whose issuer holds powers over holders — every xStock. The
   * protocol authority must have approved it (`approveQuoteMintIx`); the
   * program refuses the market otherwise.
   */
  issuerTrusted?: boolean;
  programId?: PublicKey;
}

export function createLadderIx(a: CreateLadderArgs): TransactionInstruction {
  const programId = pid(a);
  const ladder = deriveLadderPda(a, programId);
  return ix(
    a,
    pack(DISC.create, u32(a.index), u64(a.seed), (a.sponsor ?? PublicKey.default).toBytes()),
    [
      signer(a.creator), ro(deriveConfig(programId)), ro(a.series), rw(ladder), ro(deriveLadderAuthority(ladder, programId)),
      ro(a.quoteMint), rw(deriveLadderVault(ladder, programId)), rw(a.creatorToken),
      rw(deriveLadderTranche(ladder, a.creator, 0, programId)), ro(a.tokenProgram), ro(SystemProgram.programId),
      // Anchor reads the program's own id as "this optional account is absent".
      ro(a.issuerTrusted ? deriveMintApproval(a.quoteMint, programId) : programId),
    ],
  );
}

/** Protocol authority: accept a mint's issuer so markets may be quoted in it. */
export function approveQuoteMintIx(authority: PublicKey, mint: PublicKey, programId = SOOTH_CORE_PROGRAM_ID): TransactionInstruction {
  return new TransactionInstruction({
    programId,
    data: pack(DISC.approveQuoteMint),
    keys: [signer(authority), ro(deriveConfig(programId)), ro(mint), rw(deriveMintApproval(mint, programId)), ro(SystemProgram.programId)],
  });
}

/** Protocol authority: stop new markets in a mint. Existing ones run on. */
export function revokeQuoteMintIx(authority: PublicKey, mint: PublicKey, programId = SOOTH_CORE_PROGRAM_ID): TransactionInstruction {
  return new TransactionInstruction({
    programId,
    data: pack(DISC.revokeQuoteMint),
    keys: [signer(authority), ro(deriveConfig(programId)), rw(deriveMintApproval(mint, programId))],
  });
}

/** Centre the grid on the oracle price and start trading. Anyone may call it. */
export const openLadderIx = (r: LadderRefs, cranker: PublicKey, priceUpdate: PublicKey) =>
  ix(r, pack(DISC.open), [signer(cranker, false), rw(r.ladder), ro(priceUpdate)]);

export interface TradeLadderArgs {
  user: PublicKey;
  userToken: PublicKey;
  shape: Shape;
  /** Base units. Positive buys, negative sells. */
  shares: bigint;
  /** Buying: most to pay, fee included. Selling: least to receive, fee deducted. */
  limit: bigint;
}

export function tradeLadderIx(r: LadderRefs, a: TradeLadderArgs): TransactionInstruction {
  const programId = pid(r);
  return ix(
    r,
    pack(DISC.trade, i16(a.shape.lo), i16(a.shape.hi), u8(a.shape.h), i64(a.shares), u64(a.limit)),
    [
      signer(a.user), ro(deriveConfig(programId)), rw(r.ladder), ro(deriveLadderAuthority(r.ladder, programId)),
      ro(r.quoteMint), rw(deriveLadderVault(r.ladder, programId)), rw(a.userToken),
      rw(deriveLadderPosition(r.ladder, a.user, a.shape, programId)), ro(r.tokenProgram), ro(SystemProgram.programId),
    ],
  );
}

export interface JoinLadderArgs {
  lp: PublicKey;
  lpToken: PublicKey;
  /** This wallet's tranche number — unused so far. */
  index: number;
  deposit: bigint;
  /** `LadderAccount.curveSeq` as read. The join lands at those prices or fails. */
  expectedSeq: bigint;
}

export function joinLadderIx(r: LadderRefs, a: JoinLadderArgs): TransactionInstruction {
  const programId = pid(r);
  return ix(
    r,
    pack(DISC.lpJoin, u8(a.index), u64(a.deposit), u64(a.expectedSeq)),
    [
      signer(a.lp), ro(deriveConfig(programId)), rw(r.ladder), ro(r.quoteMint),
      rw(deriveLadderVault(r.ladder, programId)), rw(a.lpToken),
      rw(deriveLadderTranche(r.ladder, a.lp, a.index, programId)), ro(r.tokenProgram), ro(SystemProgram.programId),
    ],
  );
}

/**
 * Settle from the one Pyth update that is the price at `settlesAt`. Anyone;
 * the settler is paid half the protocol's fee take into `crankerToken`.
 */
export function settleLadderIx(r: LadderRefs, series: PublicKey, cranker: PublicKey, priceUpdate: PublicKey, crankerToken: PublicKey): TransactionInstruction {
  const programId = pid(r);
  return ix(r, pack(DISC.settle), [
    signer(cranker, false), rw(r.ladder), ro(priceUpdate), rw(series), ro(deriveLadderAuthority(r.ladder, programId)),
    ro(r.quoteMint), rw(deriveLadderVault(r.ladder, programId)), rw(crankerToken), ro(r.tokenProgram),
  ]);
}

/** Give up on a market that never opened, or never got its price. Anyone. */
export const voidLadderIx = (r: LadderRefs, cranker: PublicKey) =>
  ix(r, pack(DISC.void), [signer(cranker, false), rw(r.ladder)]);

export function redeemLadderIx(r: LadderRefs, owner: PublicKey, ownerToken: PublicKey, shape: Shape): TransactionInstruction {
  const programId = pid(r);
  return ix(r, pack(DISC.redeem), [
    signer(owner), rw(r.ladder), ro(deriveLadderAuthority(r.ladder, programId)), ro(r.quoteMint),
    rw(deriveLadderVault(r.ladder, programId)), rw(ownerToken),
    rw(deriveLadderPosition(r.ladder, owner, shape, programId)), ro(r.tokenProgram),
  ]);
}

export function claimLpIx(r: LadderRefs, owner: PublicKey, ownerToken: PublicKey, index = 0): TransactionInstruction {
  const programId = pid(r);
  return ix(r, pack(DISC.claimLp), [
    signer(owner), rw(r.ladder), ro(deriveLadderAuthority(r.ladder, programId)), ro(r.quoteMint),
    rw(deriveLadderVault(r.ladder, programId)), rw(ownerToken),
    rw(deriveLadderTranche(r.ladder, owner, index, programId)), ro(r.tokenProgram),
  ]);
}

export function collectLadderFeesIx(r: LadderRefs, cranker: PublicKey, creatorToken: PublicKey, treasuryToken: PublicKey): TransactionInstruction {
  const programId = pid(r);
  return ix(r, pack(DISC.collectFees), [
    signer(cranker, false), ro(deriveConfig(programId)), rw(r.ladder), ro(deriveLadderAuthority(r.ladder, programId)),
    ro(r.quoteMint), rw(deriveLadderVault(r.ladder, programId)), rw(creatorToken), rw(treasuryToken), ro(r.tokenProgram),
  ]);
}

/**
 * Close a finished round's position that is owed nothing (a miss, or one sold
 * to zero); its rent goes back to its owner. Anyone may.
 */
export const sweepPositionIx = (r: LadderRefs, cranker: PublicKey, position: PublicKey, owner: PublicKey) =>
  ix(r, pack(DISC.sweep), [signer(cranker, false), rw(r.ladder), rw(position), rw(owner)]);

/**
 * Close a finished round once every position and deposit is paid and the fee
 * shares are collected: dust to the treasury, rent to the funder. Anyone may.
 */
export function closeLadderIx(r: LadderRefs, cranker: PublicKey, creator: PublicKey, treasuryToken: PublicKey): TransactionInstruction {
  const programId = pid(r);
  return ix(r, pack(DISC.close), [
    signer(cranker, false), ro(deriveConfig(programId)), rw(r.ladder), rw(creator), ro(deriveLadderAuthority(r.ladder, programId)),
    rw(r.quoteMint), rw(deriveLadderVault(r.ladder, programId)), rw(treasuryToken), ro(r.tokenProgram),
  ]);
}
