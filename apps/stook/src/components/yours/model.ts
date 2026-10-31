// The desk's arithmetic: what each holding is worth, read only from the chain.
// Amounts stay in each round's own coin; dollars are only ever an estimate
// at today's price, used to add coins up.
import { stook } from "@sooth/sdk-solana";
import type { Holding } from "../../lib/chain";
import { ladderCallName } from "../../lib/call";
import { COINS, coinByMint, type Coin } from "../../lib/coins";
import { toUsd } from "../../lib/usd";

export type Stage = "funded" | "opening" | "void soon" | "trading" | "locked" | "settling" | "settled" | "void";

export const stageOf = (l: stook.LadderAccount, now: number): Stage =>
  l.status === "settled" ? "settled" : l.status === "void" ? "void"
    : l.status === "seeding" ? (now < Number(l.opensAt) ? "funded" : now < Number(l.opensAt) + Number(stook.OPEN_WINDOW_SECS) && now < Number(l.locksAt) ? "opening" : "void soon")
    : now < Number(l.locksAt) ? "trading" : now < Number(l.settlesAt) ? "locked" : "settling";

/** How a stage reads to a player. */
export const STAGE_TEXT: Record<Stage, string> = {
  funded: "Funded", opening: "Opening", "void soon": "Void soon", trading: "Live", locked: "Locked", settling: "Settling", settled: "Settled", void: "Void",
};

export interface Line { key: string; what: string; size: bigint; cost: bigint; value: bigint | null; kind: "line" | "house"; note?: string; fees?: bigint; shape?: stook.Shape }
export interface Valued { lines: Line[]; ready: bigint; atWork: bigint; inHouse: bigint }

/** What each thing in a round is worth: paid out if final, sold now if trading. */
export function value(h: Holding, now: number, dp: number): Valued {
  const l = h.ladder, final = l.status === "settled" || l.status === "void";
  const feeBps = stook.feeBpsAt(l.feeBps, BigInt(now), l.settlesAt);
  const lines: Line[] = [];
  let ready = 0n, atWork = 0n, inHouse = 0n;
  for (const r of h.positions) {
    const p = r.position;
    if (!final && p.shares === 0n) continue;
    const s = p.shape;
    const what = ladderCallName(l, dp, s);
    let v: bigint | null = null;
    if (final) { v = stook.owedTo(l, p); ready += v > 0n ? v : 0n; }
    else if (l.status === "open" && now < Number(l.locksAt) && p.shares > 0n) {
      try { v = stook.quoteTrade({ curve: l.curve, b: l.b, feeBps, decimals: l.decimals }, s, -p.shares).total; } catch { v = null; }
    }
    if (!final) atWork += p.netPaid;
    lines.push({ key: r.pubkey.toBase58(), kind: "line", what, size: p.shares, cost: p.netPaid, value: v, shape: s, note: final ? undefined : v === null ? "held to the bell" : "if sold now" });
  }
  for (const r of h.tranches) {
    const t = r.tranche;
    let v: bigint | null = null, fees: bigint | undefined;
    if (l.status === "settled" && l.settledBin !== null) {
      const k = l.settledBin, tt = stook.trancheTerms(l, t);
      v = stook.tranchePrincipal(t.deposit, stook.tranchePnl(tt.b, tt.join.w[k]!, tt.join.sum, l.curve.w[k]!, l.curve.sum), l.decimals) + stook.trancheFees(tt.b, l.decimals, l.accFee, t.feeSnap);
      ready += v;
    } else if (l.status === "void") {
      v = stook.voidShare(t.deposit, l.voidLpPot, l.depositTotal); ready += v;
    } else {
      inHouse += t.deposit;
      const tt = stook.trancheTerms(l, t);
      fees = tt.b > 0n ? stook.trancheFees(tt.b, l.decimals, l.accFee, t.feeSnap) : 0n;
    }
    lines.push({ key: r.pubkey.toBase58(), kind: "house", what: `house deposit #${t.index}`, size: t.deposit, cost: t.deposit, value: v, fees });
  }
  return { lines, ready, atWork, inHouse };
}

/** Amounts by coin symbol, each with its decimals. */
export type Pot = Map<string, { dec: number; v: bigint }>;
export const addTo = (m: Pot, sym: string, dec: number, v: bigint) => {
  if (v === 0n) return;
  const t = m.get(sym);
  m.set(sym, { dec, v: (t?.v ?? 0n) + v });
};
/** Dollars across a pot, or null when no coin in it has a price. */
export const potUsd = (m: Pot, rates: Record<string, number>): number | null => {
  let any = false, usd = 0;
  for (const [s, x] of m) if (rates[s] !== undefined) { any = true; usd += toUsd(x.v, x.dec, rates[s]!); }
  return any ? usd : null;
};
export const coinOfSym = (s: string): Coin | undefined => COINS.find((c) => c.symbol === s);
export const symOf = (h: Holding) => coinByMint(h.ladder.quoteMint)?.symbol ?? "tokens";

/** The desk says "floors" everywhere: a call's name reads the same as its strip. */
export const floorWords = (t: string) => t.replace(/\b([Rr])ows?\b/g, (w, r) => `${r === "R" ? "F" : "f"}loor${w.length > 3 ? "s" : ""}`);
