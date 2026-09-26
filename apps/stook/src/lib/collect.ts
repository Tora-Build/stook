// Collecting a finished round: every line redeemed and every house deposit
// claimed, packed into as few transactions as compute allows. The statement's
// per-round button and its "Collect all" build from the same place, so both
// send exactly the same claims.
import type { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { stook } from "@sooth/sdk-solana";
import { ataOf, ensureAta, type Holding } from "./chain";

/** A round is finished, and pays or refunds, once settled or void. */
export const isFinished = (l: stook.LadderAccount) => l.status === "settled" || l.status === "void";

/** The rounds one "Collect all" collects: every finished round the wallet
 *  holds anything in, taken from the holdings themselves (never from what the
 *  page happens to show), in the order given. */
export const collectPlan = (holdings: Holding[]): Holding[] =>
  holdings.filter((h) => isFinished(h.ladder) && h.positions.length + h.tranches.length > 0);

export interface CollectTx { ixs: TransactionInstruction[]; computeUnits: number }

/** The transactions that collect one round for `owner`: lines redeemed, then
 *  deposits claimed, the first one also making the wallet's token account. */
export function collectTxs(h: Holding, owner: PublicKey, tokenProgram: PublicKey): CollectTx[] {
  const l = h.ladder;
  const refs = { ladder: h.pubkey, quoteMint: l.quoteMint, tokenProgram };
  const ata = ataOf(l.quoteMint, owner, tokenProgram);
  const chunks = stook.packByCompute([
    ...h.positions.map((r) => ({ ix: stook.redeemLadderIx(refs, owner, ata, r.position.shape), units: stook.REDEEM_COMPUTE_UNITS })),
    ...h.tranches.map((t) => ({ ix: stook.claimLpIx(refs, owner, ata, t.tranche.index), units: stook.claimComputeUnits(l, t.tranche) })),
  ]);
  return chunks.map((c, n) => ({ computeUnits: c.units, ixs: [...(n === 0 ? [ensureAta(l.quoteMint, owner, tokenProgram)] : []), ...c.ixs] }));
}
