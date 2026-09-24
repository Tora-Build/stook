// One coin's post: the anchor's price over the last day, and the round slots,
// one per day, settling at the New York close, up to 31 days ahead. A slot
// nobody has funded is empty; whoever seeds it first starts the round and is
// its first LP; everyone after adds liquidity to the same round.
import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { useState } from "react";
import { StartRound } from "../components/StartRound";
import { WallCalendar } from "../components/WallCalendar";
import { Address } from "../components/Address";
import { useQuery } from "@tanstack/react-query";
import { stook } from "@sooth/sdk-solana";
import { COINS, anchorOf, mintOf, seriesOf } from "../lib/coins";
import { useSeries } from "../hooks/useChain";
import { useNow } from "../hooks/useNow";
import { firstOpenableDay, nyWhen } from "../lib/time";

const DATA = "";
/** A slot can be started until this long before it settles: the program's
 *  fifteen minutes, plus time to sign and for the cluster clock to differ. */
const MIN_LEAD_SECS = 15 * 60 + 90;

export function Coin() {
  const { symbol } = useParams();
  const coin = COINS.find((c) => c.symbol === symbol?.toUpperCase());
  const now = useNow();
  const [starting, setStarting] = useState<number | null>(null);
  const seriesKey = useMemo(() => (coin ? seriesOf(coin) : null), [coin]);
  const series = useSeries(seriesKey);
  const chart = useQuery({ queryKey: ["chart", coin?.symbol], queryFn: async () => (await fetch(`${DATA}/chart?coin=${coin!.symbol}`)).json() as Promise<{ points: [number, number][] }>, enabled: !!coin, refetchInterval: 300_000 });
  const quote = useQuery({ queryKey: ["quote", coin?.symbol], queryFn: async () => (await fetch(`${DATA}/prices`)).json(), enabled: !!coin, refetchInterval: 60_000 });

  const anchor = coin ? anchorOf(coin) : null;

  if (!coin || !anchor) return <p className="page muted">No such coin on the street.</p>;
  const q = quote.data?.[coin.symbol] as { price: number; change24h: number | null } | undefined;
  const mint = mintOf(coin);
  const firstOpen = series.data ? firstOpenableDay(series.data) : null;

  return (
    <div className="page">
      <header className="market-head">
        <div className="coin-head-row">
          <div className="logos logos-big"><img src={coin.logo} alt={coin.symbol} className="logo-coin" /><img src={coin.anchor.logo} alt={coin.anchor.symbol} className="logo-anchor" /></div>
          <div>
          <span className="sign">${coin.symbol} · {coin.name.toUpperCase()}</span>
          <h1>{coin.anchor.name} <span className="sym">{coin.anchor.symbol}</span></h1>
          <p className="live-row">
            {q ? <><span className="mono">${q.price.toLocaleString("en-US", { minimumFractionDigits: coin.anchor.dp, maximumFractionDigits: coin.anchor.dp })}</span>{typeof q.change24h === "number" && <span className={`mono ${q.change24h >= 0 ? "up" : "down"}`}> {q.change24h >= 0 ? "+" : ""}{q.change24h.toFixed(2)}% 24h</span>}</> : <span className="muted">price…</span>}
          </p>
          <p className="muted">one round a day on {coin.anchor.name} ({coin.anchor.symbol}), settling at the New York close, paid in ${coin.symbol} · the coin takes {coin.feeBps / 100}% on each transfer</p>
          <p className="addrs"><Address label={`${coin.anchor.symbol} token`} value={coin.anchor.mint} /><Address label={`$${coin.symbol}`} value={coin.mint} dim /></p>
          </div>
        </div>
      </header>


      <section className="slots">
        <p className="explain">One round a day. Funded a day or more ahead, it trades from 4 PM New York the day before until 3 PM, and the bell rings at the 4 PM close; funded later, it opens a minute after funding. It must open within five minutes or it is void and refunds. Its bands are set when it opens, as wide as {coin.anchor.name} is moving then, so you can fund any day up to 31 days ahead. Click a day to trade it, or to fund it. <Link to="/how">How it works</Link></p>
        {series.data && !stook.warmedUp(series.data) && <p className="hint">Still learning how the price moves from Pyth closes ({series.data.observations} of {stook.WARMUP_OBSERVATIONS}). {firstOpen !== null ? <>The first day that can open is {nyWhen(stook.closeOf(series.data, firstOpen), { weekday: "short", month: "short", day: "numeric" })}; earlier days are greyed out. Later days can be funded now and get their bands when they open.</> : <>Funding is open, and rounds get their bands when they open.</>}</p>}
        {series.data && seriesKey ? <WallCalendar seriesKey={seriesKey} series={series.data} now={now} minLeadSecs={MIN_LEAD_SECS} dp={anchor.dp} coinSymbol={coin.symbol} canStart={!!mint && series.data.active} onStart={setStarting} />
          : <p className="muted">{series.isLoading ? "Reading the calendar…" : "This coin's rounds have not been opened on this network yet."}</p>}
      </section>
      <h3 className="chart24-h">{coin.anchor.symbol} over the last day (New York time)</h3>
      <Chart24 points={chart.data?.points ?? []} dp={coin.anchor.dp} />
      {starting !== null && series.data && seriesKey && <StartRound coin={coin} seriesKey={seriesKey} series={series.data} index={starting} onClose={() => setStarting(null)} />}
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
        {ticks.map((i) => <text key={i} x={x(i)} y={H - 6} className="lbl" textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}>{new Date(points[i]![0] * 1000).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "America/New_York" })}</text>)}
      </svg>
    </div>
  );
}
