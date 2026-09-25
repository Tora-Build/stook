import { useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { stook } from "@sooth/sdk-solana";
import { fmtAmount, parseAmount, short as shortKey } from "../lib/format";
import { ataOf, ensureAta } from "../lib/chain";
import { useBalance, useSend, useTranches } from "../hooks/useChain";
import { Usd, fmtUsd, fromUsd, toUsd } from "../lib/usd";

interface Props { refs: stook.LadderRefs; ladder: stook.LadderAccount; quoteSymbol: string; now: number; transferFee?: stook.TransferFee; bare?: boolean; usd?: number | null }

export function LpPanel(p: Props) {
  const { publicKey } = useWallet();
  const [text, setText] = useState("100");
  const [inUsd, setInUsd] = useState(false);
  const rate = p.usd ?? null;
  const join = useSend("Liquidity added");
  const claim = useSend("Claimed");
  const mine = useTranches(p.refs.ladder, true);
  const dec = p.ladder.decimals;
  const l = p.ladder;

  const deposit = inUsd && rate ? fromUsd(Number(text.replace(/,/g, "")) || 0, dec, rate) : parseAmount(text, dec);
  // Before it opens a round has no depth yet: deposits are recorded by size,
  // and the depth they buy is set at open from the day's volatility.
  const seeding = l.status === "seeding" && l.b === 0n;
  const depth = useMemo(() => {
    if (!deposit || deposit <= 0n) return null;
    if (seeding) return 1n;
    try { return stook.liquidityForDeposit(l.curve, deposit, dec); } catch { return null; }
  }, [deposit, l.curve, dec, seeding]);

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
      <div className="house-facts">
        <div><b>Pool</b><span className="mono">{fmtAmount(l.depositTotal, dec, 0)} {p.quoteSymbol}</span><Usd units={l.depositTotal} decimals={dec} rate={rate} /></div>
        <div><b>Earn</b><span>90% of every fee</span><em>{(l.feeBps / 100).toFixed(0)}% now, 5% near the close</em></div>
        <div><b>Risk</b><span>up to your deposit</span><em>if traders call the close</em></div>
      </div>
      {joinable && (
        <>
          <div className="field">
            <div className="amount-head">
              <span>Deposit</span>
              <div className="seg seg-sm" role="group" aria-label="Enter the deposit in">
                <button className={!inUsd ? "on" : ""} onClick={() => setInUsd(false)}>{p.quoteSymbol}</button>
                {rate !== null && <button className={inUsd ? "on" : ""} onClick={() => setInUsd(true)}>USD</button>}
              </div>
            </div>
            <div className={`amount-input ${inUsd ? "amount-usd" : ""}`}>
              {inUsd && <span className="amount-sign">$</span>}
              <input value={text} onChange={(e) => setText(e.target.value)} inputMode="decimal" aria-label={inUsd ? "Deposit in dollars" : `Deposit in ${p.quoteSymbol}`} />
              {!inUsd && <span className="amount-unit">{p.quoteSymbol}</span>}
            </div>
            <span className="hint">{inUsd && deposit ? <>{fmtAmount(deposit, dec)} {p.quoteSymbol} · </> : !inUsd && deposit && rate !== null ? <>{fmtUsd(toUsd(deposit, dec, rate))} · </> : null}balance {balance.data !== undefined ? <>{fmtAmount(balance.data, dec)} {p.quoteSymbol}</> : "…"}</span>
          </div>
          {depth && (
            <dl className="quote">
              {seeding ? <>
                <div><dt>your share of the pool</dt><dd className="mono">{(Number(deposit) / (Number(l.depositTotal) + Number(deposit)) * 100).toFixed(1)}%, if nobody else joins</dd></div>
              </> : <>
                <div><dt>your share of fees from now</dt><dd className="mono">{(Number(depth) / (Number(l.b) + Number(depth)) * 100).toFixed(1)}%</dd></div>
              </>}
              {p.transferFee && <div><dt>your wallet sends</dt><dd className="mono">{fmtAmount(stook.grossFor(deposit!, p.transferFee), dec)} <Usd units={stook.grossFor(deposit!, p.transferFee)} decimals={dec} rate={rate} /> (incl. the token's {(p.transferFee.bps / 100).toFixed(1)}% transfer fee)</dd></div>}
            </dl>
          )}
          {short && <p className="warn">You hold {fmtAmount(balance.data!, dec)} {p.quoteSymbol}; this needs {fmtAmount(gross!, dec)}. On devnet, use <b>test coins</b> in the header.</p>}
          <button className="primary" disabled={!depth || join.isPending || !publicKey || short} onClick={submit}>
            {!publicKey ? "Connect a wallet" : join.isPending ? "Sending…" : `Deposit ${deposit ? fmtAmount(deposit, dec) : 0} ${p.quoteSymbol}${deposit && rate !== null ? ` · ${fmtUsd(toUsd(deposit, dec, rate))}` : ""}`}
          </button>
        </>
      )}
      <p className="house-how"><a href="/how">How the house works ›</a></p>
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
                <span className="mono">{fmtAmount(t.deposit, dec)} in <Usd units={t.deposit} decimals={dec} rate={rate} /> · fees {fmtAmount(fees, dec)} <Usd units={fees} decimals={dec} rate={rate} />{value !== null && <> · worth {fmtAmount(value, dec)} <Usd units={value} decimals={dec} rate={rate} /></>}</span>
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
