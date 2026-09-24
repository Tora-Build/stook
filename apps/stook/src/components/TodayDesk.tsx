// The coin page's desk: today's round up front, with the one thing to do
// about it, and the next few days on a strip beside it. Only one round
// trades at a time, so that is what a visitor sees first; the month's
// calendar is for planning and sits below.
import { useMemo } from "react";
import { Link } from "react-router-dom";
import type { PublicKey } from "@solana/web3.js";
import { stook } from "@sooth/sdk-solana";
import { useSeriesRounds } from "../hooks/useChain";
import { fmtAmount, fmtPrice, untilText } from "../lib/format";
import { nyWhen } from "../lib/time";
import { Usd, useUsdRates } from "../lib/usd";
import { PocketWatch } from "./PocketWatch";

interface Props {
  seriesKey: PublicKey;
  series: stook.SeriesAccount;
  now: number;
  minLeadSecs: number;
  dp: number;
  coinSymbol: string;
  anchorName: string;
  canStart: boolean;
  onStart: (index: number) => void;
}

/** The next `n` days with a round whose close is still ahead, from `now`. */
function upcoming(s: stook.SeriesAccount, now: number, n: number): number[] {
  const out: number[] = [];
  for (let i = stook.indexAtOrBefore(s, BigInt(now)) + 1; out.length < n && out.length < 60; i++) if (stook.hasRound(s, i)) out.push(i);
  return out;
}

export function TodayDesk(p: Props) {
  const days = useMemo(() => upcoming(p.series, p.now - (p.now % 60), 6), [p.series, Math.floor(p.now / 60)]); // eslint-disable-line react-hooks/exhaustive-deps
  const rounds = useSeriesRounds(p.seriesKey, days);
  const rate = useUsdRates().data?.[p.coinSymbol] ?? null;
  const [today, ...next] = days;
  if (today === undefined) return null;
  const r = rounds.data?.get(today), l = r?.ladder;
  const closes = Number(stook.closeOf(p.series, today));
  const fundable = (i: number) => { const at = stook.closeOf(p.series, i); return p.canStart && at - BigInt(p.now) >= BigInt(p.minLeadSecs) && at <= BigInt(p.now) + stook.MAX_LEAD_SECS; };
  const when = (i: number) => nyWhen(stook.closeOf(p.series, i), { weekday: "short", month: "short", day: "numeric" });

  // What today's round is doing, and the one thing to do about it.
  let kicker: string, title: string, line: string, cta: { label: string; to?: string; start?: number } | null;
  if (l && l.status === "open" && p.now < Number(l.locksAt)) {
    kicker = "On the floor now"; title = "Trading";
    line = `Draw where ${p.anchorName} closes at 4 PM New York. Trading stops in ${untilText(l.locksAt, p.now)}.`;
    cta = { label: "Trade today's round", to: `/m/${r!.pubkey.toBase58()}` };
  } else if (l && l.status === "open") {
    kicker = "Locked"; title = "Waiting for the bell";
    line = "No more trades today. The first Pyth price at 4 PM New York settles it.";
    cta = { label: "Watch the bell", to: `/m/${r!.pubkey.toBase58()}` };
  } else if (l && l.status === "seeding") {
    kicker = "Funded"; title = p.now < Number(l.opensAt) ? `Opens ${nyWhen(l.opensAt, { hour: "numeric", minute: "2-digit" })} NY` : "Opening";
    line = "The house is in. Trading starts when it opens; deposits are open now.";
    cta = { label: "See the round", to: `/m/${r!.pubkey.toBase58()}` };
  } else if (l && l.status === "settled") {
    const b = l.settledBin !== null ? stook.binBounds(l.settledBin, l.p0, l.stepBps) : null;
    kicker = "The bell has rung"; title = b ? `Landed at ${fmtPrice(b[0], l.p0Expo, p.dp)}` : "Settled";
    line = next[0] !== undefined ? `Next round closes ${when(next[0])}.` : "";
    cta = { label: "Collect or look back", to: `/m/${r!.pubkey.toBase58()}` };
  } else if (l) {
    kicker = "Void"; title = "No round today"; line = "It could not finish; deposits come back first."; cta = { label: "Collect a refund", to: `/m/${r!.pubkey.toBase58()}` };
  } else if (fundable(today)) {
    kicker = "Nobody's opened today"; title = "Be the house";
    line = `Fund today's round and it opens a minute later. The house keeps 90% of every fee.`;
    cta = { label: "Fund today's round", start: today };
  } else {
    kicker = "Today"; title = "Too late to start";
    line = next[0] !== undefined ? `The next round closes ${when(next[0])}.` : "";
    cta = next[0] !== undefined && fundable(next[0]) ? { label: `Fund ${when(next[0])}`, start: next[0] } : null;
  }
  const live = l && l.status === "open";

  return (
    <section className="desk">
      <div className={`desk-today ${live ? "desk-live" : ""}`}>
        {/* New York's time, live, with today's round on the dial */}
        <div className="desk-watch">
          <PocketWatch now={p.now} locksAt={l && l.status === "open" ? Number(l.locksAt) : undefined} settlesAt={l && l.status === "open" ? closes : undefined} size={132} title="New York time; the ring is the hours ahead: green trading, amber locked, then the bell" />
          <div className="desk-clock mono">{nyWhen(p.now, { hour: "numeric", minute: "2-digit" })} <span>New York</span></div>
        </div>
        <div className="desk-main">
        <div className="desk-kicker"><span>{kicker}</span></div>
        <div className="desk-title">{title}</div>
        <div className="desk-when">closes {nyWhen(stook.closeOf(p.series, today), { weekday: "long", hour: "numeric", minute: "2-digit" })} New York · rings in {untilText(BigInt(closes), p.now)}</div>
        {l && <div className="desk-nums">
          <div><span className="desk-k">pool</span><span className="mono">{fmtAmount(l.depositTotal, l.decimals, 0)} {p.coinSymbol}</span><Usd units={l.depositTotal} decimals={l.decimals} rate={rate} /></div>
          <div><span className="desk-k">trades</span><span className="mono">{l.curveSeq.toString()}</span></div>
        </div>}
        {line && <p className="desk-line">{line}</p>}
        {cta && (cta.to ? <Link className="desk-cta" to={cta.to}>{cta.label} ›</Link> : <button className="desk-cta" onClick={() => p.onStart(cta!.start!)}>{cta.label} ›</button>)}
        </div>
      </div>

      <div className="desk-next">
        <div className="desk-next-h">Up next</div>
        <ol>
          {next.map((i) => {
            const nr = rounds.data?.get(i), nl = nr?.ladder;
            const body = <>
              <span className="dn-day">{when(i)}</span>
              {nl ? <span className="dn-state"><span className="mono">{fmtAmount(nl.depositTotal, nl.decimals, 0)}</span> {p.coinSymbol} in the house</span> : fundable(i) ? <span className="dn-state dn-open">open to fund</span> : <span className="dn-state muted">funding opens later</span>}
            </>;
            return <li key={i}>{nr ? <Link to={`/m/${nr.pubkey.toBase58()}`}>{body}<span className="dn-go">›</span></Link> : fundable(i) ? <button onClick={() => p.onStart(i)}>{body}<span className="dn-go">+</span></button> : <div>{body}</div>}</li>;
          })}
        </ol>
      </div>
    </section>
  );
}
