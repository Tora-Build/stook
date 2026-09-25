// What a keeper needs to decide, kept pure so it can be tested without a chain
// or a price service: which instruction a market is waiting for, and whether a
// given Pyth update is one the program will accept for it.
//
// The second matters because a rejected settle costs a posted price account and
// a transaction. The checks here mirror `oracle::check_settlement_instant` and
// `oracle::check_policy`; the program remains the authority.

import type { GetProgramAccountsFilter, PublicKey } from "@solana/web3.js";
import { LADDER_DISCRIMINATOR, LADDER_SIZE, POSITION_DISCRIMINATOR, TRANCHE_DISCRIMINATOR, type LadderAccount, type LadderStatus } from "./accounts.js";
import { level, type Shape } from "./math.js";

/** An opened round with no proof it cannot settle voids only this long after its close (`VOID_FALLBACK_SECS`). */
export const VOID_FALLBACK_SECS = 7n * 86_400n;
/** Opened within this long of `opens_at`, a round opens on THE update at `opens_at` (`OPEN_ON_TIME_SECS`). */
export const OPEN_ON_TIME_SECS = 300n;
/** A round may be opened this long after `opens_at` (`OPEN_WINDOW_SECS`): late, on a live price, and it starts then. After that it voids. */
export const OPEN_WINDOW_SECS = 3_600n;
/** How far a Pyth update may be stamped ahead of the cluster clock (`CLOCK_SKEW_SECS`). */
export const CLOCK_SKEW_SECS = 10n;
/** After this long past a close, anyone may pay out a round’s positions and deposits, to their owners. */
export const CLAIM_GRACE_SECS = 30n * 86_400n;
export const SETTLE_MAX_GAP_SECS = 30n;
/** Confidence bar at open, as a settlement step: under 1% of the price. */
export const OPEN_CONF_STEP_BPS = 200;

export type CrankStep = "open" | "settle" | "void";

/** The one instruction this market is waiting for at `now`, if any. */
export function nextStep(l: Pick<LadderAccount, "status" | "opensAt" | "locksAt" | "settlesAt">, now: bigint): CrankStep | null {
  if (l.status === "seeding") {
    if (now >= l.opensAt + OPEN_WINDOW_SECS || now >= l.locksAt) return "void"; // never opened in its window
    return now >= l.opensAt ? "open" : null;
  }
  if (l.status === "open") {
    // After the close: settle, or, if the close's one update cannot settle
    // it, void with that update as proof (the keeper decides which). With no
    // update to show, a void waits for the fallback.
    if (now >= l.settlesAt + VOID_FALLBACK_SECS) return "void";
    return now >= l.settlesAt ? "settle" : null;
  }
  return null;
}

/** One entry of Hermes' `parsed` array. */
export interface HermesPrice {
  id: string;
  price: { price: string; conf: string; expo: number; publish_time: number };
  metadata?: { prev_publish_time?: number };
}

const hex = (b: Uint8Array) => Array.from(b, (v) => v.toString(16).padStart(2, "0")).join("");

/**
 * Why the program would refuse `u` as this market's settlement price, or null.
 *
 * The rule is `prev_publish_time < T <= publish_time`: the first update at or
 * after T. Exactly one update satisfies it, so which price settles a market
 * does not depend on who cranks it. Hermes' `/v2/updates/price/{T}` returns it.
 */
export function settlementProblem(u: HermesPrice, l: Pick<LadderAccount, "feedId" | "settlesAt" | "stepBps" | "p0Expo">): string | null {
  if (u.id.replace(/^0x/, "").toLowerCase() !== hex(l.feedId)) return "wrong feed";
  const prev = u.metadata?.prev_publish_time;
  if (prev === undefined) return "update carries no prev_publish_time";
  const t = l.settlesAt, pub = BigInt(u.price.publish_time);
  if (!(BigInt(prev) < t && t <= pub)) return "not the first update at or after the settlement time";
  if (pub - t > SETTLE_MAX_GAP_SECS) return `feed was silent for ${pub - t}s across the settlement time`;
  const price = BigInt(u.price.price), conf = BigInt(u.price.conf);
  if (price <= 0n) return "non-positive price";
  if (conf * 20_000n > price * BigInt(l.stepBps)) return "confidence interval wider than half a bin";
  if (u.price.expo !== l.p0Expo) return "feed exponent changed since open";
  return null;
}

/** Is opening at `now` late: past the on-time minutes, so on a live price? */
export const opensLate = (l: Pick<LadderAccount, "opensAt">, now: bigint): boolean => now >= l.opensAt + OPEN_ON_TIME_SECS;

/** Why the program would refuse `u` for opening this market at `now`, or null.
 *  On time, the opening price is the settlement rule at `opens_at` with a 1%
 *  confidence bar; late, any update at most 30 s old (a few seconds of clock
 *  skew allowed) with the same bar. Without `now`, the on-time rule. */
export function openProblem(u: HermesPrice, l: Pick<LadderAccount, "feedId" | "opensAt">, now?: bigint): string | null {
  if (now === undefined || !opensLate(l, now)) return settlementProblem(u, { feedId: l.feedId, settlesAt: l.opensAt, stepBps: OPEN_CONF_STEP_BPS, p0Expo: u.price.expo });
  if (u.id.replace(/^0x/, "").toLowerCase() !== hex(l.feedId)) return "wrong feed";
  const age = now - BigInt(u.price.publish_time);
  if (age > SETTLE_MAX_GAP_SECS) return `update is ${age}s old; a late opening needs one at most ${SETTLE_MAX_GAP_SECS}s old`;
  if (age < -CLOCK_SKEW_SECS) return "update is stamped too far ahead of the clock";
  const price = BigInt(u.price.price), conf = BigInt(u.price.conf);
  if (price <= 0n) return "non-positive price";
  if (conf * 20_000n > price * BigInt(OPEN_CONF_STEP_BPS)) return "confidence interval wider than half a bin";
  return null;
}

/**
 * Is `u` proof that this opened market can never settle? It must be THE
 * update for the close (the first at or after it) and fail the settlement
 * rule anyway: late, too unsure, non-positive or on another exponent. Then
 * `ladder_void` accepts it at once. Anything else (a wrong or missing
 * update) proves nothing: retry, or settle.
 */
export function voidProof(u: HermesPrice, l: Pick<LadderAccount, "feedId" | "settlesAt" | "stepBps" | "p0Expo">): boolean {
  if (u.id.replace(/^0x/, "").toLowerCase() !== hex(l.feedId)) return false;
  const prev = u.metadata?.prev_publish_time;
  if (prev === undefined) return false;
  if (!(BigInt(prev) < l.settlesAt && l.settlesAt <= BigInt(u.price.publish_time))) return false;
  return settlementProblem(u, l) !== null;
}

const STATUS_BYTE: Record<LadderStatus, number> = { seeding: 0, open: 1, settled: 2, void: 3 };
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = "";
  for (; n > 0n; n /= 58n) out = B58[Number(n % 58n)] + out;
  for (const b of bytes) { if (b !== 0) break; out = "1" + out; }
  return out;
}

/** `getProgramAccounts` filters for every ladder in `status`. */
export function ladderFilters(status?: LadderStatus): GetProgramAccountsFilter[] {
  // Exact size: accounts from before the series layout are a different size
  // and are not rounds this program can run.
  const filters: GetProgramAccountsFilter[] = [{ dataSize: LADDER_SIZE }, { memcmp: { offset: 0, bytes: base58(LADDER_DISCRIMINATOR) } }];
  if (status) filters.push({ memcmp: { offset: 8 + 1912, bytes: base58(Uint8Array.of(STATUS_BYTE[status])) } });
  return filters;
}

/** Every position on one round (to sweep the ones owed nothing). */
export function positionFilters(ladder: PublicKey): GetProgramAccountsFilter[] {
  return [
    { memcmp: { offset: 0, bytes: base58(POSITION_DISCRIMINATOR) } },
    { memcmp: { offset: 8, bytes: ladder.toBase58() } },
  ];
}

/** Every deposit on one round (to pay out, after the grace period, the ones never claimed). */
export function trancheFilters(ladder: PublicKey): GetProgramAccountsFilter[] {
  return [
    { memcmp: { offset: 0, bytes: base58(TRANCHE_DISCRIMINATOR) } },
    { memcmp: { offset: 16, bytes: ladder.toBase58() } },
  ];
}

/** What a finished round's position is owed, as `redemption` computes it. */
export function owedTo(l: LadderAccount, p: { shape: Shape; shares: bigint; netPaid: bigint }): bigint {
  if (l.status === "settled" && l.settledBin !== null) return p.shares * BigInt(level(p.shape, l.settledBin));
  if (l.status === "void") return l.basisTotal > 0n ? (p.netPaid * l.voidTraderPot) / l.basisTotal : 0n; // `redemption`
  return -1n;
}
