// One coin's post: the anchor's price over the last day, and the round slots
// — one per day, settling at the New York close, for the week ahead. A slot
// nobody has funded is empty; whoever seeds it first starts the round and is
// its first LP; everyone after adds liquidity to the same round.
import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { useState } from "react";
import { StartRound } from "../components/StartRound";
import { WallCalendar } from "../components/WallCalendar";
import { useQuery } from "@tanstack/react-query";
import { COINS, anchorOf, coinByMint, feedHexToBytes, mintOf, standInNote } from "../lib/coins";
import { useLadders } from "../hooks/useChain";
import { useNow } from "../hooks/useNow";

const DATA = "";
/** Rounds settle at 16:00 New York — the close — every day, including weekends for 24/7 anchors. */
const SETTLE_HOUR_NY = 16;
/** A slot can be started until this long before it settles: trading needs time to happen. */
const MIN_LEAD_SECS = 15 * 60;

/** Unix seconds of 16:00 New York on the day `offset` days from today (New York). */
function nyClose(offset: number): number {
  const now = new Date();
  const ny = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const target = new Date(ny); target.setDate(ny.getDate() + offset); target.setHours(SETTLE_HOUR_NY, 0, 0, 0);
  // the offset between this machine's zone and New York, applied back
  return Math.floor((target.getTime() - (ny.getTime() - now.getTime())) / 1000);
}

export function Coin() {
  const { symbol } = useParams();
  const coin = COINS.find((c) => c.symbol === symbol?.toUpperCase());
  const now = useNow();
  const [starting, setStarting] = useState<number | null>(null);
  const ladders = useLadders();
  const chart = useQuery({ queryKey: ["chart", coin?.symbol], queryFn: async () => (await fetch(`${DATA}/chart?coin=${coin!.symbol}`)).json() as Promise<{ points: [number, number][] }>, enabled: !!coin, refetchInterval: 300_000 });
  const quote = useQuery({ queryKey: ["quote", coin?.symbol], queryFn: async () => (await fetch(`${DATA}/prices`)).json(), enabled: !!coin, refetchInterval: 60_000 });

  const anchor = coin ? anchorOf(coin) : null;
  const mine = useMemo(() => {
    if (!coin || !anchor) return [];
    const feed = feedHexToBytes(anchor.feedId);
    return (ladders.data ?? []).filter((r) => coinByMint(r.ladder.quoteMint)?.symbol === coin.symbol && r.ladder.feedId.every((b, i) => b === feed[i]));
  }, [ladders.data, coin, anchor]);

  if (!coin || !anchor) return <p className="page muted">No such coin on the street.</p>;
  const note = standInNote(coin);
  const q = quote.data?.[coin.symbol] as { price: number; change24h: number | null } | undefined;
  const mint = mintOf(coin);

  // Settlement for a New York calendar day: 16:00 that day, New York.
  const nyNow = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const settleOf = (y: number, m0: number, d: number) => nyClose(Math.round((new Date(y, m0, d).getTime() - new Date(nyNow.getFullYear(), nyNow.getMonth(), nyNow.getDate()).getTime()) / 86_400_000));
  return (
    <div className="page">
      <header className="market-head">
        <div>
          <span className="sign">${coin.symbol} · {coin.name.toUpperCase()}</span>
          <h1>{anchor.name} <span className="sym">{anchor.symbol}</span></h1>
          <p className="live-row">
            {q && !note ? <><span className="mono">{q.price.toLocaleString("en-US", { minimumFractionDigits: coin.anchor.dp, maximumFractionDigits: coin.anchor.dp })}</span>{q.change24h != null && <span className={`mono ${q.change24h >= 0 ? "up" : "down"}`}> {q.change24h >= 0 ? "+" : ""}{q.change24h.toFixed(2)}% 24h</span>}</> : note ? <span className="warn">{note}</span> : <span className="muted">price…</span>}
          </p>
          <p className="muted">one round a day on {anchor.name}, settling at the New York close, paid in ${coin.symbol} · the coin takes {coin.feeBps / 100}% on each transfer</p>
        </div>
      </header>

      {!note && <Chart24 points={chart.data?.points ?? []} dp={coin.anchor.dp} />}

      <section className="slots">
        <p className="explain">One round a day, closing 4:00 PM New York. Click a day to trade it — or to start it. <Link to="/how">How it works</Link></p>
        <WallCalendar rounds={mine} now={now} settleOf={settleOf} minLeadSecs={MIN_LEAD_SECS} dp={anchor.dp} coinSymbol={coin.symbol} canStart={!!mint} onStart={setStarting} />
      </section>
      {starting !== null && <StartRound coin={coin} settlesAt={starting} onClose={() => setStarting(null)} />}
    </div>
  );
}

/** The anchor over the last day, as a stepped pixel line. */
function Chart24({ points, dp }: { points: [number, number][]; dp: number }) {
  const W = 960, H = 200, P = { l: 8, r: 64, t: 12, b: 24 };
  if (points.length < 2) return <div className="chart-wrap chart24"><div className="chart-hover"><span className="muted">Loading the last 24 hours…</span></div></div>;
  const ys = points.map((p) => p[1]), lo = Math.min(...ys), hi = Math.max(...ys), span = hi - lo || 1;
  const x = (i: number) => P.l + (i / (points.length - 1)) * (W - P.l - P.r);
  const y = (v: number) => P.t + (1 - (v - lo) / span) * (H - P.t - P.b);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[1]).toFixed(1)}`).join(" ");
  const last = points[points.length - 1]!, first = points[0]!;
  const ticks = [0, Math.floor(points.length / 4), Math.floor(points.length / 2), Math.floor((3 * points.length) / 4), points.length - 1];
  return (
    <div className="chart-wrap chart24">
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Price over the last 24 hours">
        <path d={`${d} L${x(points.length - 1)},${H - P.b} L${x(0)},${H - P.b} Z`} className="area24" />
        <path d={d} className={`line24 ${last[1] >= first[1] ? "up" : "down"}`} />
        <text x={W - P.r + 6} y={y(last[1]) + 4} className="lbl lbl-live">{last[1].toLocaleString("en-US", { maximumFractionDigits: dp })}</text>
        <text x={W - P.r + 6} y={y(hi) + 4} className="lbl">{hi.toLocaleString("en-US", { maximumFractionDigits: dp })}</text>
        <text x={W - P.r + 6} y={y(lo) + 4} className="lbl">{lo.toLocaleString("en-US", { maximumFractionDigits: dp })}</text>
        {ticks.map((i) => <text key={i} x={x(i)} y={H - 6} className="lbl" textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}>{new Date(points[i]![0] * 1000).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}</text>)}
      </svg>
    </div>
  );
}
