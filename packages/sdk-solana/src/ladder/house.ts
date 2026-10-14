// The house: one standing pool per series that funds its rounds one after
// another (program: `state/house.rs`, `instructions/house.rs`). Addresses,
// instruction builders, decoders and the share price, exact to the unit.

import { PublicKey, SystemProgram, TransactionInstruction, type AccountMeta, type GetProgramAccountsFilter } from "@solana/web3.js";
import { SOOTH_CORE_PROGRAM_ID } from "../program.js";
import type { LadderAccount } from "./accounts.js";
import { base58 } from "./crank.js";
import { deriveLadderAuthority, deriveLadderTranche, deriveLadderVault, deriveMintApproval } from "./instructions.js";

const enc = new TextEncoder();
const find = (seeds: Uint8Array[], programId: PublicKey) => PublicKey.findProgramAddressSync(seeds, programId)[0];
const u32 = (v: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v, true); return b; };
const u64 = (v: bigint) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, v, true); return b; };
const u128 = (v: bigint) => { const b = new Uint8Array(16); const d = new DataView(b.buffer); d.setBigUint64(0, v & ((1n << 64n) - 1n), true); d.setBigUint64(8, v >> 64n, true); return b; };
// Anchor's discriminators: sha256("global:<ix>") and sha256("account:<Type>"), first 8 bytes.
const DISC = {
  house_create: [42, 41, 31, 150, 223, 180, 245, 25],
  house_deposit: [31, 50, 167, 151, 6, 219, 85, 113],
  house_withdraw: [91, 80, 134, 212, 232, 189, 132, 39],
  house_cancel_deposit: [244, 10, 239, 16, 115, 71, 53, 172],
  house_claim: [198, 167, 235, 176, 215, 100, 49, 163],
  house_join: [94, 71, 219, 56, 111, 177, 127, 72],
  house_collect: [221, 204, 176, 83, 187, 233, 34, 250],
} as const;
const ACCOUNT_DISC = {
  House: [21, 145, 94, 109, 254, 199, 210, 151],
  HouseStake: [152, 143, 13, 235, 147, 179, 222, 104],
  HouseEpoch: [224, 64, 43, 248, 73, 135, 188, 216],
} as const;
const accountDisc = (name: keyof typeof ACCOUNT_DISC) => ACCOUNT_DISC[name];
const data = (name: keyof typeof DISC, ...parts: Uint8Array[]) => Buffer.concat([Uint8Array.from(DISC[name]), ...parts]);

const ro = (pubkey: PublicKey): AccountMeta => ({ pubkey, isSigner: false, isWritable: false });
const rw = (pubkey: PublicKey): AccountMeta => ({ pubkey, isSigner: false, isWritable: true });
const signer = (pubkey: PublicKey, isWritable = true): AccountMeta => ({ pubkey, isSigner: true, isWritable });
const config = (programId: PublicKey) => find([enc.encode("protocol_config")], programId);

// ── addresses ────────────────────────────────────────────────────────────────

export const deriveHouse = (series: PublicKey, programId = SOOTH_CORE_PROGRAM_ID) => find([enc.encode("house"), series.toBytes()], programId);
export const deriveHouseVault = (house: PublicKey, programId = SOOTH_CORE_PROGRAM_ID) => find([enc.encode("house_vault"), house.toBytes()], programId);
export const deriveHouseStake = (house: PublicKey, owner: PublicKey, programId = SOOTH_CORE_PROGRAM_ID) =>
  find([enc.encode("house_stake"), house.toBytes(), owner.toBytes()], programId);
export const deriveHouseEpoch = (house: PublicKey, epoch: number, programId = SOOTH_CORE_PROGRAM_ID) =>
  find([enc.encode("house_epoch"), house.toBytes(), u32(epoch)], programId);

// ── share price (mirrors `state::house`) ─────────────────────────────────────

export const VIRTUAL_SHARES = 1_000_000n;
/** Shares `amount` buys at `(assets, shares)`. Floors. */
export const sharesFor = (amount: bigint, assets: bigint, shares: bigint) => (amount * (shares + VIRTUAL_SHARES)) / (assets + 1n);
/** Capital `n` shares redeem for at `(assets, shares)`. Floors, at most `assets`. */
export const assetsFor = (n: bigint, assets: bigint, shares: bigint) => {
  const v = (n * (assets + 1n)) / (shares + VIRTUAL_SHARES);
  return v < assets ? v : assets;
};

// ── decoders ─────────────────────────────────────────────────────────────────

export interface HouseAccount {
  series: PublicKey; quoteMint: PublicKey; vault: PublicKey;
  /** The round the house's money is in; `null` while idle. */
  round: PublicKey | null;
  rentPayer: PublicKey;
  assets: bigint; inRound: bigint; pendingDeposits: bigint; claimable: bigint;
  totalShares: bigint; pendingWithdrawShares: bigint;
  epoch: number; generation: number; lastIndex: number;
}
export interface HouseStakeAccount {
  house: PublicKey; owner: PublicKey;
  shares: bigint; pendingWithdraw: bigint; pendingDeposit: bigint; claimable: bigint;
  pendingEpoch: number; generation: number;
}
export interface HouseEpochAccount { house: PublicKey; epoch: number; assets: bigint; shares: bigint; wiped: boolean; generation: number }

class Reader {
  o = 8;
  constructor(private d: Uint8Array, name: keyof typeof ACCOUNT_DISC) {
    const want = accountDisc(name);
    if (d.length < 8 || want.some((b, i) => d[i] !== b)) throw new Error(`not a ${name} account`);
  }
  private view = () => new DataView(this.d.buffer, this.d.byteOffset, this.d.byteLength);
  key() { const k = new PublicKey(this.d.subarray(this.o, this.o + 32)); this.o += 32; return k; }
  u64() { const v = this.view().getBigUint64(this.o, true); this.o += 8; return v; }
  u128() { const v = this.u64(); return v + (this.u64() << 64n); }
  u32() { const v = this.view().getUint32(this.o, true); this.o += 4; return v; }
  bool() { return this.d[this.o++] !== 0; }
}

export function decodeHouse(d: Uint8Array): HouseAccount {
  const r = new Reader(d, "House");
  const series = r.key(), quoteMint = r.key(), vault = r.key(), round = r.key(), rentPayer = r.key();
  return {
    series, quoteMint, vault, round: round.equals(PublicKey.default) ? null : round, rentPayer,
    assets: r.u64(), inRound: r.u64(), pendingDeposits: r.u64(), claimable: r.u64(),
    totalShares: r.u128(), pendingWithdrawShares: r.u128(),
    epoch: r.u32(), generation: r.u32(), lastIndex: r.u32(),
  };
}
export function decodeHouseStake(d: Uint8Array): HouseStakeAccount {
  const r = new Reader(d, "HouseStake");
  return {
    house: r.key(), owner: r.key(), shares: r.u128(), pendingWithdraw: r.u128(), pendingDeposit: r.u64(), claimable: r.u64(),
    pendingEpoch: r.u32(), generation: r.u32(),
  };
}
export function decodeHouseEpoch(d: Uint8Array): HouseEpochAccount {
  const r = new Reader(d, "HouseEpoch");
  return { house: r.key(), epoch: r.u32(), assets: r.u64(), shares: r.u128(), wiped: r.bool(), generation: r.u32() };
}

/** What a stake is worth now, booked as the program would book it. The
 *  queued part is valued at the share price of the moment, not yet final. */
export function stakeValue(h: HouseAccount, s: HouseStakeAccount) {
  const shares = s.generation === h.generation ? s.shares : 0n;
  return { shares, value: assetsFor(shares, h.assets, h.totalShares), queuedDeposit: s.pendingDeposit, queuedShares: s.pendingWithdraw, claimable: s.claimable };
}

/** The epoch record a stake's next call must bring, or `undefined`. */
export function epochFor(house: PublicKey, h: HouseAccount, s: HouseStakeAccount | null, programId = SOOTH_CORE_PROGRAM_ID) {
  if (!s || (s.pendingDeposit === 0n && s.pendingWithdraw === 0n) || s.pendingEpoch >= h.epoch) return undefined;
  return deriveHouseEpoch(house, s.pendingEpoch, programId);
}

// ── builders ─────────────────────────────────────────────────────────────────

export interface HouseRefs {
  house: PublicKey;
  quoteMint: PublicKey;
  tokenProgram: PublicKey;
  programId?: PublicKey;
}
const pid = (r: { programId?: PublicKey }) => r.programId ?? SOOTH_CORE_PROGRAM_ID;
const ix = (r: { programId?: PublicKey }, d: Buffer, keys: AccountMeta[]) => new TransactionInstruction({ programId: pid(r), data: d, keys });
/** Anchor reads the program's own id as "this optional account is absent". */
const opt = (r: { programId?: PublicKey }, k?: PublicKey) => ro(k ?? pid(r));

export function createHouseIx(a: { payer: PublicKey; series: PublicKey; quoteMint: PublicKey; tokenProgram: PublicKey; issuerTrusted?: boolean; programId?: PublicKey }) {
  const programId = pid(a), house = deriveHouse(a.series, programId);
  return ix(a, data("house_create"), [
    signer(a.payer), ro(config(programId)), ro(a.series), rw(house), ro(a.quoteMint), rw(deriveHouseVault(house, programId)),
    opt(a, a.issuerTrusted ? deriveMintApproval(a.quoteMint, programId) : undefined), ro(a.tokenProgram), ro(SystemProgram.programId),
  ]);
}

export function houseDepositIx(r: HouseRefs, lp: PublicKey, lpToken: PublicKey, amount: bigint, epoch?: PublicKey) {
  const programId = pid(r);
  return ix(r, data("house_deposit", u64(amount)), [
    signer(lp), ro(config(programId)), rw(r.house), ro(r.quoteMint), rw(deriveHouseVault(r.house, programId)), rw(lpToken),
    rw(deriveHouseStake(r.house, lp, programId)), opt(r, epoch), ro(r.tokenProgram), ro(SystemProgram.programId),
  ]);
}

const lpKeys = (r: HouseRefs, lp: PublicKey, lpToken: PublicKey, epoch?: PublicKey) => {
  const programId = pid(r);
  return [
    signer(lp, false), rw(r.house), rw(deriveHouseStake(r.house, lp, programId)), opt(r, epoch), ro(r.quoteMint),
    rw(deriveHouseVault(r.house, programId)), rw(lpToken), ro(r.tokenProgram),
  ];
};
export const houseWithdrawIx = (r: HouseRefs, lp: PublicKey, lpToken: PublicKey, shares: bigint, epoch?: PublicKey) =>
  ix(r, data("house_withdraw", u128(shares)), lpKeys(r, lp, lpToken, epoch));
export const houseCancelDepositIx = (r: HouseRefs, lp: PublicKey, lpToken: PublicKey) =>
  ix(r, data("house_cancel_deposit"), lpKeys(r, lp, lpToken));
export const houseClaimIx = (r: HouseRefs, lp: PublicKey, lpToken: PublicKey, epoch?: PublicKey) =>
  ix(r, data("house_claim"), lpKeys(r, lp, lpToken, epoch));

/** Put the whole house into an untraded round of its series. Anyone. */
export function houseJoinIx(r: HouseRefs, cranker: PublicKey, ladder: PublicKey) {
  const programId = pid(r);
  return ix(r, data("house_join"), [
    signer(cranker), ro(config(programId)), rw(r.house), rw(ladder), ro(r.quoteMint), rw(deriveLadderVault(ladder, programId)),
    rw(deriveHouseVault(r.house, programId)), rw(deriveLadderTranche(ladder, r.house, 0, programId)), ro(r.tokenProgram), ro(SystemProgram.programId),
  ]);
}

/** Bring the house home from its finished round and process the queue. Anyone. */
export function houseCollectIx(r: HouseRefs, cranker: PublicKey, h: Pick<HouseAccount, "round" | "rentPayer" | "epoch">) {
  const programId = pid(r);
  if (!h.round) throw new Error("the house is not in a round");
  return ix(r, data("house_collect"), [
    signer(cranker), rw(r.house), rw(h.round), ro(deriveLadderAuthority(h.round, programId)), ro(r.quoteMint),
    rw(deriveLadderVault(h.round, programId)), rw(deriveHouseVault(r.house, programId)),
    rw(deriveLadderTranche(h.round, r.house, 0, programId)), rw(h.rentPayer), rw(deriveHouseEpoch(r.house, h.epoch, programId)),
    ro(r.tokenProgram), ro(SystemProgram.programId),
  ]);
}

// ── the keeper's part ────────────────────────────────────────────────────────

/** `getProgramAccounts` filters for every house. */
export const houseFilters = (): GetProgramAccountsFilter[] => [{ memcmp: { offset: 0, bytes: base58(Uint8Array.from(ACCOUNT_DISC.House)) } }];

/** What a house needs next: bring it home from a finished round, put it into
 *  the next one, or nothing. `round` is its round's state, when it is in one. */
export function houseStep(h: HouseAccount, round: Pick<LadderAccount, "status"> | null, decimals: number): "collect" | "join" | null {
  if (h.round) return round && (round.status === "settled" || round.status === "void") ? "collect" : null;
  return h.assets >= 10n ** BigInt(decimals) ? "join" : null;
}

/** The round an idle house joins: of its series, untraded (still seeding, or
 *  open with no trade yet), not locked; the soonest to close. */
export function houseJoinTarget<T extends { pubkey: PublicKey; ladder: Pick<LadderAccount, "series" | "status" | "curveSeq" | "locksAt" | "settlesAt"> }>(
  h: Pick<HouseAccount, "series">, rounds: T[], now: bigint,
): T | undefined {
  return rounds
    .filter(({ ladder: l }) => l.series.equals(h.series) && now < l.locksAt && (l.status === "seeding" || (l.status === "open" && l.curveSeq === 0n)))
    .sort((a, b) => (a.ladder.settlesAt < b.ladder.settlesAt ? -1 : a.ladder.settlesAt > b.ladder.settlesAt ? 1 : 0))[0];
}
