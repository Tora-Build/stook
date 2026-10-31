// Listing a coin (program: `state/listing.rs`, `instructions/listing.rs`):
// anyone locks 0.5% to 5% of a coin's supply as the seed of its new house,
// on an anchor from the protocol's list, and the coin's daily rounds start a
// day later.

import { PublicKey, SystemProgram, TransactionInstruction, type AccountMeta, type GetProgramAccountsFilter } from "@solana/web3.js";
import { SOOTH_CORE_PROGRAM_ID } from "../program.js";
import { base58 } from "./crank.js";
import { deriveHouse, deriveHouseStake, deriveHouseVault } from "./house.js";
import { deriveMintApproval } from "./instructions.js";
import { deriveSeries } from "./series.js";

const enc = new TextEncoder();
const find = (seeds: Uint8Array[], programId: PublicKey) => PublicKey.findProgramAddressSync(seeds, programId)[0];
const u32 = (v: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v, true); return b; };
const u64 = (v: bigint) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, v, true); return b; };
// Anchor's discriminators: sha256("global:<ix>") and sha256("account:<Type>"), first 8 bytes.
const DISC = {
  list_anchor_set: [172, 176, 132, 19, 173, 241, 106, 81],
  list_fee_set: [118, 171, 8, 4, 128, 245, 164, 27],
  coin_list: [220, 84, 80, 32, 8, 41, 123, 215],
  coin_activate: [5, 78, 20, 125, 70, 252, 31, 55],
  coin_reject: [42, 56, 34, 2, 223, 55, 129, 32],
} as const;
const LIST_ANCHOR_DISC = [202, 159, 27, 104, 227, 239, 0, 162] as const;
const data = (name: keyof typeof DISC, ...parts: Uint8Array[]) => Buffer.concat([Uint8Array.from(DISC[name]), ...parts]);
const ro = (pubkey: PublicKey): AccountMeta => ({ pubkey, isSigner: false, isWritable: false });
const rw = (pubkey: PublicKey): AccountMeta => ({ pubkey, isSigner: false, isWritable: true });
const signer = (pubkey: PublicKey, isWritable = true): AccountMeta => ({ pubkey, isSigner: true, isWritable });
const config = (programId: PublicKey) => find([enc.encode("protocol_config")], programId);

/** The seed: 0.01% to 5% of supply (the app asks for $200 or more), locked a week; live a day after listing. */
export const LIST_MIN_BPS = 1n;
export const LIST_MAX_BPS = 500n;
export const LIST_LOCK_SECS = 7n * 86_400n;
export const LIST_DELAY_SECS = 86_400n;
/** `House.opensAfter` of a listing the protocol turned down. */
export const HOUSE_REJECTED = (1n << 63n) - 1n;

/** The seed bounds for a coin with `supply` base units: `[min, max]` (as `state::listing::seed_bounds`). */
export function seedBounds(supply: bigint): [bigint, bigint] {
  return [(supply * LIST_MIN_BPS + 9_999n) / 10_000n, (supply * LIST_MAX_BPS) / 10_000n];
}

export type ListingState = "pending" | "live" | "rejected" | "curated";
/** Where a house stands as a listing: waiting its day, live, turned down; "curated" for a house no listing made. */
export function listingState(h: { opensAfter: bigint }, series: { active: boolean }): ListingState {
  if (h.opensAfter === HOUSE_REJECTED) return "rejected";
  if (h.opensAfter > 0n) return "pending";
  return series.active ? "live" : "curated";
}

export const deriveListAnchor = (feedId: Uint8Array, programId = SOOTH_CORE_PROGRAM_ID) => find([enc.encode("list_anchor"), feedId], programId);

export interface ListAnchorAccount { feedId: Uint8Array; clock: number; closeSecs: number; active: boolean }
export function decodeListAnchor(d: Uint8Array): ListAnchorAccount {
  if (d.length < 8 + 32 + 1 + 4 + 1 || LIST_ANCHOR_DISC.some((b, i) => d[i] !== b)) throw new Error("not a ListAnchor account");
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  return { feedId: d.slice(8, 40), clock: d[40]!, closeSecs: v.getUint32(41, true), active: d[45] !== 0 };
}
export const listAnchorFilters = (): GetProgramAccountsFilter[] => [{ memcmp: { offset: 0, bytes: base58(Uint8Array.from(LIST_ANCHOR_DISC)) } }];

/** Protocol authority: put an anchor on the list (or take it off, `active` false). */
export function listAnchorSetIx(a: { authority: PublicKey; feedId: Uint8Array; clock: number; closeSecs: number; active: boolean; programId?: PublicKey }) {
  const programId = a.programId ?? SOOTH_CORE_PROGRAM_ID;
  return new TransactionInstruction({
    programId,
    data: data("list_anchor_set", a.feedId, Uint8Array.of(a.clock), u32(a.closeSecs), Uint8Array.of(a.active ? 1 : 0)),
    keys: [signer(a.authority), ro(config(programId)), rw(deriveListAnchor(a.feedId, programId)), ro(SystemProgram.programId)],
  });
}

/** Protocol authority: what listing a coin costs, in lamports. */
export const listFeeSetIx = (authority: PublicKey, lamports: bigint, programId = SOOTH_CORE_PROGRAM_ID) =>
  new TransactionInstruction({ programId, data: data("list_fee_set", u64(lamports)), keys: [signer(authority, false), rw(config(programId))] });

/**
 * List a coin on an anchor: its daily series, its house, and `seed` of the
 * coin from `listerToken` as the lister's stake, locked a week. `treasury`
 * is the protocol config's. `maxGross` (default `seed`) caps what leaves the
 * wallet on a coin with a transfer fee.
 */
export function coinListIx(a: {
  lister: PublicKey; listerToken: PublicKey; feedId: Uint8Array; quoteMint: PublicKey; tokenProgram: PublicKey; treasury: PublicKey;
  seed: bigint; maxGross?: bigint; issuerTrusted?: boolean; programId?: PublicKey;
}) {
  const programId = a.programId ?? SOOTH_CORE_PROGRAM_ID;
  const series = deriveSeries(a.feedId, a.quoteMint, 0, programId);
  const house = deriveHouse(series, programId);
  return new TransactionInstruction({
    programId,
    data: data("coin_list", u64(a.seed), u64(a.maxGross ?? a.seed)),
    keys: [
      signer(a.lister), ro(config(programId)), rw(a.treasury), ro(deriveListAnchor(a.feedId, programId)), ro(a.quoteMint),
      rw(series), rw(house), rw(deriveHouseVault(house, programId)), rw(deriveHouseStake(house, a.lister, programId)), rw(a.listerToken),
      ro(a.issuerTrusted ? deriveMintApproval(a.quoteMint, programId) : programId), ro(a.tokenProgram), ro(SystemProgram.programId),
    ],
  });
}

/** A listing's day has passed: its series goes live. Anyone. */
export const coinActivateIx = (series: PublicKey, programId = SOOTH_CORE_PROGRAM_ID) =>
  new TransactionInstruction({ programId, data: data("coin_activate"), keys: [rw(deriveHouse(series, programId)), rw(series)] });

/** Protocol authority: turn a listing down before it goes live; its seed is freed. */
export const coinRejectIx = (authority: PublicKey, house: PublicKey, programId = SOOTH_CORE_PROGRAM_ID) =>
  new TransactionInstruction({ programId, data: data("coin_reject"), keys: [signer(authority, false), ro(config(programId)), rw(house)] });
