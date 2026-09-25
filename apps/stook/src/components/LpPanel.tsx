import { useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { stook } from "@sooth/sdk-solana";
import { fmtAmount, parseAmount } from "../lib/format";
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

  // Each of your deposits, valued: fees so far, and what it is worth once
  // the round is final (settled: principal and fees; void: its refund).
  const rows = (mine.data ?? []).map(({ tranche: t }) => {
    const tt = stook.trancheTerms(l, t), k = l.settledBin;
    const fees = stook.trancheFees(tt.b, dec, l.accFee, t.feeSnap);
    const worth = l.status === "settled" && k !== null
      ? stook.tranchePrincipal(t.deposit, stook.tranchePnl(tt.b, tt.join.w[k]!, tt.join.sum, l.curve.w[k]!, l.curve.sum), dec) + fees
      : l.status === "void" ? stook.voidShare(t.deposit, l.voidLpPot, l.depositTotal) : null;
    return { t, fees, worth };
  });
  const sum = rows.reduce((a, r) => ({ in: a.in + r.t.deposit, fees: a.fees + r.fees, worth: a.worth === null || r.worth === null ? null : a.worth + r.worth }), { in: 0n, fees: 0n, worth: final ? 0n as bigint | null : null });
  // One claim for every deposit, packed into as few transactions as fit.
  const claimAll = async () => {
    if (!publicKey) return;
    const ata = ataOf(l.quoteMint, publicKey, p.refs.tokenProgram);
    const chunks = stook.packByCompute(rows.map((r) => ({ ix: stook.claimLpIx(p.refs, publicKey, ata, r.t.index), units: stook.claimComputeUnits(l, r.t) })));
    try { for (let n = 0; n < chunks.length; n++) await claim.mutateAsync({ computeUnits: chunks[n]!.units, ixs: [...(n === 0 ? [ensureAta(l.quoteMint, publicKey, p.refs.tokenProgram)] : []), ...chunks[n]!.ixs] }); } catch { /* the toast says why */ }
  };

  const Wrap = p.bare ? "div" : "section";
  return (
    <Wrap className={p.bare ? "" : "panel"}>
      {!p.bare && <h3>Provide liquidity</h3>}
      {/* This round's house, live: what it holds, what it has earned, and
          what traders have riding on it. The rules are on the How page. */}
      <div className="slip2-cells house-cells" aria-label="The house, this round">
        <div className="slip2-cell"><span className="slip2-k">Pool</span><b className="mono">{fmtAmount(l.depositTotal, dec, 0)}</b><em className="mono">{rate !== null ? fmtUsd(toUsd(l.depositTotal, dec, rate)) : p.quoteSymbol}</em></div>
        <div className="slip2-cell slip2-win"><span className="slip2-k">Fees earned</span><b className="mono">{fmtAmount(l.feesLp, dec, 2)}</b><em className="mono">{rate !== null ? fmtUsd(toUsd(l.feesLp, dec, rate)) : p.quoteSymbol}</em></div>
        <div className="slip2-cell" title="What traders have paid for lines still open in this round"><span className="slip2-k">Traders in</span><b className="mono">{fmtAmount(l.basisTotal, dec, 0)}</b><em className="mono">{rate !== null ? fmtUsd(toUsd(l.basisTotal, dec, rate)) : p.quoteSymbol}</em></div>
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
      {joinable && <p className="house-fine">Winners are paid from the pool: you can lose up to what you deposit. <a href="/how">How the house works ›</a></p>}
      {!joinable && <p className="house-how"><a href="/how">How the house works ›</a></p>}
      {/* Your deposits, as one stake. On chain each deposit is its own
          tranche (it joined at that moment's odds and earns fees from then),
          so they cannot merge; here they add up, with the detail on request. */}
      {rows.length > 0 && (
        <div className="stake">
          <div className="stake-head"><span className="slip2-k">Your stake</span><span className="stake-n">{rows.length === 1 ? "1 deposit" : `${rows.length} deposits`}</span></div>
          <div className="stake-nums">
            <div><span>in</span><b className="mono">{fmtAmount(sum.in, dec)}</b><Usd units={sum.in} decimals={dec} rate={rate} /></div>
            <div><span>fees earned</span><b className="mono up">{fmtAmount(sum.fees, dec)}</b><Usd units={sum.fees} decimals={dec} rate={rate} /></div>
            {sum.worth !== null && <div><span>worth now</span><b className="mono">{fmtAmount(sum.worth, dec)}</b><Usd units={sum.worth} decimals={dec} rate={rate} /></div>}
          </div>
          {rows.length > 1 && <details className="slip2-more"><summary>Each deposit</summary>
            <ul className="rows">{rows.map((r) => <li key={r.t.index}><span>#{r.t.index}</span><span className="mono">{fmtAmount(r.t.deposit, dec)} in · fees {fmtAmount(r.fees, dec)}{r.worth !== null && <> · worth {fmtAmount(r.worth, dec)}</>}</span></li>)}</ul>
          </details>}
          {final && publicKey && <button className="primary" disabled={claim.isPending} onClick={() => void claimAll()}>{claim.isPending ? "Claiming…" : `Claim ${sum.worth !== null ? fmtAmount(sum.worth, dec) : ""} ${p.quoteSymbol}`.replace("  ", " ")}</button>}
        </div>
      )}
    </Wrap>
  );
}
