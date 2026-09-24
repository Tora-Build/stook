import { useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { stook } from "@sooth/sdk-solana";
import { fmtAmount, parseAmount, short as shortKey } from "../lib/format";
import { ataOf, ensureAta } from "../lib/chain";
import { useBalance, useSend, useTranches } from "../hooks/useChain";

interface Props { refs: stook.LadderRefs; ladder: stook.LadderAccount; quoteSymbol: string; now: number; transferFee?: stook.TransferFee; bare?: boolean }

export function LpPanel(p: Props) {
  const { publicKey } = useWallet();
  const [text, setText] = useState("100");
  const join = useSend("Liquidity added");
  const claim = useSend("Claimed");
  const mine = useTranches(p.refs.ladder, true);
  const dec = p.ladder.decimals;
  const l = p.ladder;

  const deposit = parseAmount(text, dec);
  // Before it opens a round has no depth yet: deposits are recorded by size,
  // and the depth they buy is set at open from the day's volatility.
  const seeding = l.status === "seeding" && l.b === 0n;
  const depth = useMemo(() => {
    if (!deposit || deposit <= 0n) return null;
    if (seeding) return 1n;
    try { return stook.liquidityForDeposit(l.curve, deposit, dec); } catch { return null; }
  }, [deposit, l.curve, dec, seeding]);
  const worst = useMemo(() => {
    // the longest shot's odds, which is what sets how much depth a deposit buys
    const min = l.curve.w.reduce((a, v) => (v < a ? v : a));
    return Number(l.curve.sum) / Number(min);
  }, [l.curve]);

  const joinable = (l.status === "seeding" || l.status === "open") && p.now < Number(l.locksAt);
  const balance = useBalance(l.quoteMint, p.refs.tokenProgram);
  const gross = deposit ? stook.grossFor(deposit, p.transferFee) : null;
  const short = balance.data !== undefined && gross !== null && balance.data < gross;
  const final = l.status === "settled" || l.status === "void";
  const nextIndex = (mine.data ?? []).reduce((m, r) => Math.max(m, r.tranche.index + 1), 0);

  const submit = () => {
    if (!deposit || !publicKey) return;
    join.mutate([ensureAta(l.quoteMint, publicKey, p.refs.tokenProgram), stook.joinLadderIx(p.refs, {
      lp: publicKey,
      lpToken: ataOf(l.quoteMint, publicKey, p.refs.tokenProgram),
      index: nextIndex,
      deposit,
      expectedSeq: l.curveSeq,
    })]);
  };

  const Wrap = p.bare ? "div" : "section";
  return (
    <Wrap className={p.bare ? "" : "panel"}>
      {!p.bare && <h3>Provide liquidity</h3>}
      <p className="explain">
        The pool takes the other side of every trade. {seeding ? <><span className="mono">{fmtAmount(l.depositTotal, dec)}</span> {p.quoteSymbol} is in it so far; its depth is set when the round opens.</> : <><span className="mono">{fmtAmount(l.depositTotal, dec)}</span> {p.quoteSymbol} in it gives depth <span className="mono">{fmtAmount(l.b / 10n ** 12n, 6, 0)}</span>.</>}
        Deposit and you are the house: the pool keeps 90% of every trade's fee from now on ({(l.feeBps / 100).toFixed(0)}%, rising to 5% over the last six hours), shared by depth, and pays when traders were right.
      </p>
      {joinable && (
        <>
          <label className="field">
            <span>Deposit</span>
            <input value={text} onChange={(e) => setText(e.target.value)} inputMode="decimal" />
          </label>
          {depth && (
            <dl className="quote">
              {seeding ? <>
                <div><dt>adds depth</dt><dd className="mono">set at open</dd></div>
                <div><dt>your share of the pool</dt><dd className="mono">{(Number(deposit) / (Number(l.depositTotal) + Number(deposit)) * 100).toFixed(1)}%, if nobody else joins</dd></div>
              </> : <>
                <div><dt>adds depth</dt><dd className="mono">{fmtAmount(depth / 10n ** 12n, 6, 1)}</dd></div>
                <div><dt>your share of fees from now</dt><dd className="mono">{(Number(depth) / (Number(l.b) + Number(depth)) * 100).toFixed(1)}%</dd></div>
              </>}
              {p.transferFee && <div><dt>your wallet sends</dt><dd className="mono">{fmtAmount(stook.grossFor(deposit!, p.transferFee), dec)} (incl. the token's {(p.transferFee.bps / 100).toFixed(1)}% transfer fee)</dd></div>}
              {!seeding && <div><dt>longest shot right now</dt><dd className="mono">1 in {worst.toFixed(0)}</dd></div>}
            </dl>
          )}
          {short && <p className="warn">You hold {fmtAmount(balance.data!, dec)} {p.quoteSymbol}; this needs {fmtAmount(gross!, dec)}. On devnet, use <b>test coins</b> in the header.</p>}
          <button className="primary" disabled={!depth || join.isPending || !publicKey || short} onClick={submit}>
            {!publicKey ? "Connect a wallet" : join.isPending ? "Sending…" : `Deposit ${text} ${p.quoteSymbol}`}
          </button>
        </>
      )}
      {(mine.data ?? []).length > 0 && (
        <ul className="rows">
          {mine.data!.map(({ tranche: t }) => {
            const k = l.settledBin;
            // A deposit made before the round opened got its depth at open.
            const tt = stook.trancheTerms(l, t);
            const value = l.status === "settled" && k !== null
              ? stook.tranchePrincipal(t.deposit, stook.tranchePnl(tt.b, tt.join.w[k]!, tt.join.sum, l.curve.w[k]!, l.curve.sum), dec) + stook.trancheFees(tt.b, dec, l.accFee, t.feeSnap)
              : null;
            const fees = stook.trancheFees(tt.b, dec, l.accFee, t.feeSnap);
            return (
              <li key={t.index}>
                <span>tranche #{t.index} · {shortKey(t.owner)}</span>
                <span className="mono">{fmtAmount(t.deposit, dec)} in · fees {fmtAmount(fees, dec)}{value !== null ? ` · worth ${fmtAmount(value, dec)}` : ""}</span>
                {final && publicKey && (
                  <button className="small" disabled={claim.isPending} onClick={() => claim.mutate([ensureAta(l.quoteMint, publicKey, p.refs.tokenProgram), stook.claimLpIx(p.refs, publicKey, ataOf(l.quoteMint, publicKey, p.refs.tokenProgram), t.index)])}>
                    Claim
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Wrap>
  );
}
