// The house: one standing pool per series that funds its rounds one after
// another (program: `state/house.rs`, `instructions/house.rs`). Addresses,
// instruction builders, decoders and the share price, exact to the unit.

import { PublicKey, SystemProgram, TransactionInstruction, type AccountMeta, type GetProgramAccountsFilter } from "@solana/web3.js";
import { SOOTH_CORE_PROGRAM_ID } from "../program.js";
import type { LadderAccount } from "./accounts.js";
import { closeOf, hasRound, indexAtOrBefore, type SeriesAccount } from "./series.js";
import { base58 } from "./crank.js";
import { deriveLadderPda, deriveLadderTranche, deriveMintApproval } from "./instructions.js";

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
  house_start: [56, 166, 149, 86, 33, 147, 38, 66],
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
  /** The house's fee income per settled round, averaged; 0 before its first. Sizes each round (`commitFor`). */
  feeEma: bigint;
  /** A listed coin's house: when it may go live (unix seconds); `HOUSE_REJECTED` if turned down; 0 otherwise. */
  opensAfter: bigint;
}
export interface HouseStakeAccount {
  house: PublicKey; owner: PublicKey;
  shares: bigint; pendingWithdraw: bigint; pendingDeposit: bigint; claimable: bigint;
  pendingEpoch: number; generation: number;
  /** No withdrawal before this (unix seconds): a listed coin's seed. 0 otherwise. */
  lockedUntil: bigint;
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
  i64() { const v = this.view().getBigInt64(this.o, true); this.o += 8; return v; }
  u128() { const v = this.u64(); return v + (this.u64() << 64n); }
  u32() { const v = this.view().getUint32(this.o, true); this.o += 4; return v; }
  bool() { return this.d[this.o++] !== 0; }
  skip(n: number) { this.o += n; }
}

export function decodeHouse(d: Uint8Array): HouseAccount {
  const r = new Reader(d, "House");
  const series = r.key(), quoteMint = r.key(), vault = r.key(), round = r.key(), rentPayer = r.key();
  return {
    series, quoteMint, vault, round: round.equals(PublicKey.default) ? null : round, rentPayer,
    assets: r.u64(), inRound: r.u64(), pendingDeposits: r.u64(), claimable: r.u64(),
    totalShares: r.u128(), pendingWithdrawShares: r.u128(),
    epoch: r.u32(), generation: r.u32(), lastIndex: r.u32(),
    feeEma: (r.skip(2), r.u64()),
    opensAfter: r.i64(),
  };
}
export function decodeHouseStake(d: Uint8Array): HouseStakeAccount {
  const r = new Reader(d, "HouseStake");
  return {
    house: r.key(), owner: r.key(), shares: r.u128(), pendingWithdraw: r.u128(), pendingDeposit: r.u64(), claimable: r.u64(),
    pendingEpoch: r.u32(), generation: r.u32(),
    lockedUntil: (r.skip(1), r.i64()),
  };
}
export function decodeHouseEpoch(d: Uint8Array): HouseEpochAccount {
  const r = new Reader(d, "HouseEpoch");
  return { house: r.key(), epoch: r.u32(), assets: r.u64(), shares: r.u128(), wiped: r.bool(), generation: r.u32() };
}

/** Constants of the program's round sizing (state/house.rs). */
export const HOUSE_FEE_MULTIPLE = 15n;
export const HOUSE_MIN_COMMIT_DIV = 10n;

/** What the house takes into its next round out of `assets` (the program's `commit_for`). */
export function commitFor(assets: bigint, feeEma: bigint): bigint {
  if (feeEma === 0n) return assets;
  const floor = assets / HOUSE_MIN_COMMIT_DIV;
  let c = feeEma * HOUSE_FEE_MULTIPLE;
  if (c < floor) c = floor;
  return c > assets ? assets : c;
}

/** Everything behind the shares: in the vault and in the round, at what went in. */
export const houseCapital = (h: Pick<HouseAccount, "assets" | "inRound">) => h.assets + h.inRound;

/** What a stake is worth now, booked as the program would book it. While the
 *  house is in a round, the part in it counts at what went in; the queued part
 *  is valued at the share price of the moment, not yet final. */
export function stakeValue(h: HouseAccount, s: HouseStakeAccount) {
  const shares = s.generation === h.generation ? s.shares : 0n;
  return { shares, value: assetsFor(shares, houseCapital(h), h.totalShares), queuedDeposit: s.pendingDeposit, queuedShares: s.pendingWithdraw, claimable: s.claimable };
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

/** `amount` is what the house is credited; `maxGross` (default `amount`)
 *  the most that may leave the wallet, a coin's transfer fee included. */
export function houseDepositIx(r: HouseRefs, lp: PublicKey, lpToken: PublicKey, amount: bigint, epoch?: PublicKey, maxGross = amount) {
  const programId = pid(r);
  return ix(r, data("house_deposit", u64(amount), u64(maxGross)), [
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

/** Start round `index` of the house's series with as much as its trading
 *  can carry (`commitFor`), its money kept in the house's vault. Anyone. */
export function houseStartIx(r: HouseRefs & { series: PublicKey }, cranker: PublicKey, index: number) {
  const programId = pid(r);
  const ladder = deriveLadderPda({ series: r.series, index }, programId);
  return ix(r, data("house_start", u32(index)), [
    signer(cranker), ro(config(programId)), rw(r.house), ro(r.series), rw(ladder), ro(r.quoteMint),
    rw(deriveLadderTranche(ladder, r.house, 0, programId)), ro(SystemProgram.programId),
  ]);
}

/** Book the house home from its finished round and process the queue. Anyone. */
export function houseCollectIx(r: HouseRefs, cranker: PublicKey, h: Pick<HouseAccount, "round" | "rentPayer" | "epoch">) {
  const programId = pid(r);
  if (!h.round) throw new Error("the house is not in a round");
  return ix(r, data("house_collect"), [
    signer(cranker), rw(r.house), rw(h.round), rw(deriveLadderTranche(h.round, r.house, 0, programId)), rw(h.rentPayer),
    rw(deriveHouseEpoch(r.house, h.epoch, programId)), ro(SystemProgram.programId),
  ]);
}

// ── the keeper's part ────────────────────────────────────────────────────────

/** `getProgramAccounts` filters for every house. */
export const houseFilters = (): GetProgramAccountsFilter[] => [{ memcmp: { offset: 0, bytes: base58(Uint8Array.from(ACCOUNT_DISC.House)) } }];

/** What a house needs next: book it home from a finished round, start the
 *  next one, or nothing. `round` is its round's state, when it is in one. */
export function houseStep(h: HouseAccount, round: Pick<LadderAccount, "status"> | null, decimals: number): "collect" | "start" | null {
  if (h.round) return round && (round.status === "settled" || round.status === "void") ? "collect" : null;
  return h.assets >= 10n ** BigInt(decimals) ? "start" : null;
}

/** The round an idle house starts: the first of its series that closes at
 *  least `leadSecs` from now (the program's fifteen minutes, plus room). */
export function houseStartIndex(s: Pick<SeriesAccount, "periodSecs" | "closeSecs" | "clock">, now: bigint, leadSecs = 15n * 60n + 90n): number {
  let i = indexAtOrBefore(s, now) + 1;
  for (let n = 0; n < 14 && (!hasRound(s, i) || closeOf(s, i) < now + leadSecs); n++) i++;
  return i;
}
