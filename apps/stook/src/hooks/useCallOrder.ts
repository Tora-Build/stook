// One order for the call on the tower: what you spend, the shares it buys,
// what leaves the wallet, the limit signed for, and the send. The ticket, the
// tower's WIN tag and the phone's call bar all read this one quote, so no two
// numbers on the page disagree.
import { useCallback, useDeferredValue, useMemo, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { stook } from "@sooth/sdk-solana";
import { parseAmount } from "../lib/format";
import { ataOf, ensureAta, type PositionRow } from "../lib/chain";
import { fromUsd } from "../lib/usd";
import { sameShape } from "../lib/call";
import { useBalance, useMint, useSend } from "./useChain";

export type Unit = "coin" | "usd";

export function useCallOrder(p: { refs: stook.LadderRefs; ladder: stook.LadderAccount; shape: stook.Shape | null; transferFee?: stook.TransferFee; now: number; usd: number | null; positions: PositionRow[] }) {
  const { publicKey } = useWallet();
  // The amount is what you spend, in dollars or the coin: shares are the
  // program's unit, not the player's. Dollars first when the coin has a price.
  const [unitPicked, setUnitPicked] = useState<Unit | null>(null);
  const unit: Unit = unitPicked ?? (p.usd !== null ? "usd" : "coin");
  const [typed, setText] = useState<string | null>(null);
  const text = typed ?? (unit === "usd" ? "5" : "100");
  const setUnit = (u: Unit) => { setUnitPicked(u); setText(null); };
  const send = useSend("Call placed");
  const l = p.ladder, dec = l.decimals;
  const balance = useBalance(l.quoteMint, p.refs.tokenProgram);
  // Dragging a tab changes the call every frame; the quote follows a beat behind.
  const s = useDeferredValue(p.shape);
  // Stale while the deferred shape has not caught up, including a call that
  // just went away (the first end of a range): never quote the call before.
  const stale = (s === null) !== (p.shape === null) || (!!s && !!p.shape && !sameShape(s, p.shape));
  // The fee rises over the last six hours; quote at the rate this trade lands at.
  const feeBps = stook.feeBpsAt(l.feeBps, BigInt(p.now), l.settlesAt);
  const quote = (n: bigint) => { try { return stook.quoteTrade({ curve: l.curve, b: l.b, feeBps, decimals: dec }, s!, n); } catch { return null; } };
  // A spend becomes the most shares it buys, the coin's transfer fee included.
  const budget = unit === "coin" ? parseAmount(text, dec) : p.usd ? fromUsd(Number(text.replace(/,/g, "")) || 0, dec, p.usd) : null;
  const shares = useMemo(() => {
    if (!s || !budget || budget <= 0n || l.b === 0n) return null;
    const cost = (n: bigint) => { const x = quote(n); return x ? stook.grossFor(x.total, p.transferFee) : null; };
    let lo = 0n, hi = budget > 0n ? budget : 1n;
    for (let k = 0; k < 64; k++) { const c = cost(hi); if (c === null || c > budget) break; lo = hi; hi *= 2n; }
    for (let k = 0; k < 64 && hi - lo > 1n; k++) { const mid = (lo + hi) / 2n, c = cost(mid); if (c !== null && c <= budget) lo = mid; else hi = mid; }
    return lo > 0n ? lo : null;
  }, [unit, text, budget, s, l, dec, feeBps, p.transferFee]); // eslint-disable-line react-hooks/exhaustive-deps
  // A spend larger than the round can take on this line buys only what it can.
  const q = useMemo(() => (s && shares && shares > 0n ? quote(shares) : null), [s, shares, l, dec, feeBps]); // eslint-disable-line react-hooks/exhaustive-deps
  // Wallet numbers, not book numbers: what leaves the wallet includes the
  // coin's transfer fee, and what a payout lands as is net of it again.
  const pays = q ? stook.grossFor(q.total, p.transferFee) : null;
  const lands = (book: bigint) => stook.netOf(book, p.transferFee);
  // What may leave the wallet at most, the coin's transfer fee in force
  // included. A higher fee the issuer has scheduled would take more, so if it
  // starts first the order fails: that is said, not signed for.
  const next = useMint(l.quoteMint).data?.report.nextTransferFee;
  const limit = q ? stook.maxGrossFor(q.total, [p.transferFee]) : null;
  const rising = q ? stook.feeRaises(q.total, p.transferFee, next) : false;
  // Held to what the transaction may take, not the point quote: a balance
  // between the two would pass here and fail on chain.
  const short = limit !== null && balance.data !== undefined && balance.data < limit;
  const existing = s ? p.positions.find((r) => sameShape(r.position.shape, s)) ?? null : null;
  const toWin = q ? lands(q.maxPayout) : null;
  const mult = toWin !== null && pays ? Number(toWin) / Number(pays) : null;
  /** What the call lands as if the close is on a floor where it pays `lv`. */
  const at = useCallback((lv: number) => (shares ? stook.netOf(shares * BigInt(lv), p.transferFee) : 0n), [shares, p.transferFee]);
  const latest = useRef(p.shape); latest.current = p.shape;
  const submit = () => {
    // The quote must be for the call on the tower right now, not one before it.
    if (!q || !s || !shares || !publicKey || limit === null || stale || !sameShape(s, latest.current)) return;
    send.mutate({ computeUnits: stook.tradeComputeUnits(s), ixs: [ensureAta(l.quoteMint, publicKey, p.refs.tokenProgram), stook.tradeLadderIx(p.refs, { user: publicKey, userToken: ataOf(l.quoteMint, publicKey, p.refs.tokenProgram), shape: s, shares, limit })] });
  };
  return { unit, setUnit, text, setText, budget, shape: s, stale, feeBps, shares, q, pays, lands, next, limit, rising, short, existing, toWin, mult, at, submit, send, balance, connected: !!publicKey };
}

export type CallOrder = ReturnType<typeof useCallOrder>;
