import { useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Link } from "react-router-dom";
import { stook } from "@sooth/sdk-solana";
import { fmtCompact, parseAmount } from "../lib/format";
import { ataOf, ensureAta } from "../lib/chain";
import { useBalance, useSend, useTranches } from "../hooks/useChain";
import { fmtUsd, fromUsd, toUsd } from "../lib/usd";
import { Book } from "./Book";
import { Notice } from "./Notice";

interface Props { refs: stook.LadderRefs; ladder: stook.LadderAccount; quoteSymbol: string; now: number; transferFee?: stook.TransferFee; bare?: boolean; usd?: number | null }

export function LpPanel(p: Props) {
  const { publicKey } = useWallet();
  const rate = p.usd ?? null;
  // Dollars first when the coin has a price, as on the call side.
  const [unitPicked, setInUsd] = useState<boolean | null>(null);
  const inUsd = unitPicked ?? rate !== null;
  const [typed, setText] = useState<string | null>(null);
  const text = typed ?? (inUsd ? "20" : "100");
  // Amounts lead in dollars when there is a rate, the coin beneath.
  const money = (v: bigint) => rate !== null ? <>{fmtUsd(toUsd(v, dec, rate))}<small>{fmtCompact(v, dec)} {p.quoteSymbol}</small></> : <>{fmtCompact(v, dec)} {p.quoteSymbol}</>;
  const big = (v: bigint) => rate !== null ? fmtUsd(toUsd(v, dec, rate)) : `${fmtCompact(v, dec)} ${p.quoteSymbol}`;
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

  // Your share of the house now and after this deposit: by depth once the
  // round is open (it shares fees), by deposit before (depth is set at open).
  const share = (() => {
    const mineIn = rows.reduce((a, r) => a + r.t.deposit, 0n);
    if (seeding) {
      const tot = Number(l.depositTotal);
      return { now: tot > 0 ? (Number(mineIn) / tot) * 100 : 0, after: deposit ? ((Number(mineIn) + Number(deposit)) / (tot + Number(deposit))) * 100 : 0 };
    }
    const myDepth = (mine.data ?? []).reduce((a, r) => a + stook.trancheTerms(l, r.tranche).b, 0n), add = depth && !seeding ? depth : 0n;
    return { now: l.b > 0n ? (Number(myDepth) / Number(l.b)) * 100 : 0, after: (Number(myDepth + add) / Number(l.b + add)) * 100 };
  })();

  const pctOf = (v: number) => (v > 0 && v < 0.1 ? "under 0.1%" : `${v.toFixed(1)}%`);

  const Wrap = p.bare ? "div" : "section";
  return (
    <Wrap className={p.bare ? "" : "panel"}>
      {!p.bare && <h3>Provide liquidity</h3>}
      {/* Your deposits, as one stake. On chain each deposit is its own
          tranche (it joined at that moment's odds and earns fees from then),
          so they cannot merge; here they add up, entry by entry inside. */}
      {rows.length > 0 && (
        <Book kind="house" title="Your stake" count={rows.length} open={final}
          total={<>{big(sum.in)} in</>}
          extra={sum.worth !== null ? <>{big(sum.worth)} to claim</> : sum.fees > 0n ? <>+{big(sum.fees)} fees</> : undefined}
          rows={rows.map((r) => ({ key: String(r.t.index), label: `deposit #${r.t.index}`, sub: <>fees {big(r.fees)}{r.worth !== null && <> · worth {big(r.worth)}</>}</>, amount: money(r.t.deposit) }))}
          footer={final && publicKey ? <button className="primary" disabled={claim.isPending} onClick={() => void claimAll()}>{claim.isPending ? "Claiming…" : `Claim ${sum.worth !== null ? big(sum.worth) : ""}`.trim()}</button> : undefined} />
      )}
      {joinable && (
        <>
          <div className="field">
            <div className="amount-head">
              <span>Deposit</span>
              <div className="seg seg-sm" role="group" aria-label="Enter the deposit in">
                {rate !== null && <button className={inUsd ? "on" : ""} onClick={() => { setInUsd(true); setText(null); }}>USD</button>}
                <button className={!inUsd ? "on" : ""} onClick={() => { setInUsd(false); setText(null); }}>{p.quoteSymbol}</button>
              </div>
            </div>
            <div className={`amount-input ${inUsd ? "amount-usd" : ""}`}>
              {inUsd && <span className="amount-sign">$</span>}
              <input value={text} onChange={(e) => setText(e.target.value)} inputMode="decimal" aria-label={inUsd ? "Deposit in dollars" : `Deposit in ${p.quoteSymbol}`} />
              {!inUsd && <span className="amount-unit">{p.quoteSymbol}</span>}
            </div>
            <span className="hint">balance {balance.data !== undefined ? <>{fmtCompact(balance.data, dec)} {p.quoteSymbol}</> : "…"}</span>
          </div>
          {depth && deposit && gross !== null && (
            <div className="ticket-paper" role="group" aria-label="Your deposit">
              <div className="tp-head"><span>Your deposit</span><b className="mono">the {p.quoteSymbol} house, this round</b></div>
              <div className="tp-row"><span>You pay</span><i /><b className="mono">{big(gross)}</b></div>
              <div className="tp-row tp-small"><span>{fmtCompact(gross, dec)} {p.quoteSymbol}{p.transferFee && gross !== deposit ? `, with the coin's ${(p.transferFee.bps / 100).toFixed(0)}% transfer fee` : ""}</span></div>
              <div className="tp-win">
                <div className="tp-win-top"><span>Your share</span>{share.now > 0 && <em className="mono">was {pctOf(share.now)}</em>}</div>
                <b className="mono">{pctOf(share.after)}</b>
                <div className="tp-note">of the house: 90% of every fee, split by share</div>
              </div>
            </div>
          )}
          {short && <Notice tone="stop" title={`Not enough ${p.quoteSymbol}`}>You hold {fmtCompact(balance.data!, dec)}; this needs {fmtCompact(gross!, dec)}. On devnet, get <b>test coins</b> in the header.</Notice>}
          <button className="primary" disabled={!depth || join.isPending || !publicKey || short} onClick={submit}>
            {!publicKey ? "Connect a wallet" : join.isPending ? "Sending…" : `Deposit ${deposit ? fmtCompact(deposit, dec) : 0} ${p.quoteSymbol}${deposit && rate !== null ? ` · ${fmtUsd(toUsd(deposit, dec, rate))}` : ""}`}
          </button>
        </>
      )}
      {joinable && <p className="house-fine">Winners are paid from the pool: you can lose up to what you deposit. <Link to="/how?step=house">How the house works ›</Link></p>}
      {!joinable && <p className="house-how"><Link to="/how?step=house">How the house works ›</Link></p>}
    </Wrap>
  );
}
