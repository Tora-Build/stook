import { useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { stook } from "@sooth/sdk-solana";
import { fmtAmount, parseAmount, short } from "../lib/format";
import { ataOf } from "../lib/chain";
import { useSend, useTranches } from "../hooks/useChain";

interface Props { refs: stook.LadderRefs; ladder: stook.LadderAccount; quoteSymbol: string; now: number }

export function LpPanel(p: Props) {
  const { publicKey } = useWallet();
  const [text, setText] = useState("100");
  const join = useSend("Liquidity added");
  const claim = useSend("Claimed");
  const mine = useTranches(p.refs.ladder, true);
  const dec = p.ladder.decimals;
  const l = p.ladder;

  const deposit = parseAmount(text, dec);
  const depth = useMemo(() => {
    if (!deposit || deposit <= 0n) return null;
    try { return stook.liquidityForDeposit(l.curve, deposit, dec); } catch { return null; }
  }, [deposit, l.curve, dec]);
  const worst = useMemo(() => {
    // the longest shot's odds, which is what sets how much depth a deposit buys
    const min = l.curve.w.reduce((a, v) => (v < a ? v : a));
    return Number(l.curve.sum) / Number(min);
  }, [l.curve]);

  const joinable = (l.status === "seeding" || l.status === "open") && p.now < Number(l.locksAt);
  const final = l.status === "settled" || l.status === "void";
  const nextIndex = (mine.data ?? []).reduce((m, r) => Math.max(m, r.tranche.index + 1), 0);

  const submit = () => {
    if (!deposit || !publicKey) return;
    join.mutate([stook.joinLadderIx(p.refs, {
      lp: publicKey,
      lpToken: ataOf(l.quoteMint, publicKey, p.refs.tokenProgram),
      index: nextIndex,
      deposit,
      expectedSeq: l.curveSeq,
    })]);
  };

  return (
    <section className="panel">
      <h3>Liquidity</h3>
      <p className="explain">
        Depth <span className="mono">{fmtAmount(l.b / 10n ** 12n, 6, 0)}</span> from <span className="mono">{fmtAmount(l.depositTotal, dec)}</span> {p.quoteSymbol} deposited.
        Your deposit joins at today's prices as its own layer: it earns fees on every trade from now on, and at settlement it is worth its deposit plus what the curve moved in its favour — never less than zero.
      </p>
      {joinable && (
        <>
          <label className="field">
            <span>Deposit</span>
            <input value={text} onChange={(e) => setText(e.target.value)} inputMode="decimal" />
          </label>
          {depth && (
            <dl className="quote">
              <div><dt>buys depth</dt><dd className="mono">{fmtAmount(depth / 10n ** 12n, 6, 1)}</dd></div>
              <div><dt>longest shot today</dt><dd className="mono">1 in {worst.toFixed(0)}</dd></div>
              <div><dt>worst case</dt><dd className="mono">−{fmtAmount(deposit!, dec)} (all of it)</dd></div>
            </dl>
          )}
          <button className="primary" disabled={!depth || join.isPending || !publicKey} onClick={submit}>
            {!publicKey ? "Connect a wallet" : join.isPending ? "Sending…" : "Add liquidity"}
          </button>
        </>
      )}
      {(mine.data ?? []).length > 0 && (
        <ul className="rows">
          {mine.data!.map(({ tranche: t }) => {
            const k = l.settledBin;
            const value = l.status === "settled" && k !== null
              ? stook.tranchePrincipal(t.deposit, stook.tranchePnl(t.b, t.join.w[k]!, t.join.sum, l.curve.w[k]!, l.curve.sum), dec) + stook.trancheFees(t.b, dec, l.accFee, t.feeSnap)
              : null;
            const fees = stook.trancheFees(t.b, dec, l.accFee, t.feeSnap);
            return (
              <li key={t.index}>
                <span>tranche #{t.index} · {short(t.owner)}</span>
                <span className="mono">{fmtAmount(t.deposit, dec)} in · fees {fmtAmount(fees, dec)}{value !== null ? ` · worth ${fmtAmount(value, dec)}` : ""}</span>
                {final && publicKey && (
                  <button className="small" disabled={claim.isPending} onClick={() => claim.mutate([stook.claimLpIx(p.refs, publicKey, ataOf(l.quoteMint, publicKey, p.refs.tokenProgram), t.index)])}>
                    Claim
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
