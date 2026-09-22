// One coin's post: the anchor's price over the last day, and the round slots
// — one per hour, today and tomorrow. A slot that nobody has funded is empty;
// whoever seeds it first opens it and is its first LP.
import { useMemo } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { COINS, coinByMint, feedHexToBytes, mintOf } from "../lib/coins";
import { useLadders } from "../hooks/useChain";
import { useNow } from "../hooks/useNow";
import { fmtAmount, untilText } from "../lib/format";
import type { LadderRow } from "../lib/chain";

const DATA = "https://stooks.xyz";
const SLOT_SECS = 3600;
/** A slot can be funded until this long before it settles: trading needs time to happen. */
const MIN_LEAD_SECS = 15 * 60;

export function Coin() {
  const { symbol } = useParams();
  const coin = COINS.find((c) => c.symbol === symbol?.toUpperCase());
  const nav = useNavigate();
  const now = useNow();
  const ladders = useLadders();
  const chart = useQuery({ queryKey: ["chart", coin?.symbol], queryFn: async () => (await fetch(`${DATA}/chart?coin=${coin!.symbol}`)).json() as Promise<{ points: [number, number][] }>, enabled: !!coin, refetchInterval: 300_000 });
  const quote = useQuery({ queryKey: ["quote", coin?.symbol], queryFn: async () => (await fetch(`${DATA}/prices`)).json(), enabled: !!coin, refetchInterval: 60_000 });

  const mine = useMemo(() => {
    if (!coin) return [];
    const feed = feedHexToBytes(coin.anchor.feedId);
    return (ladders.data ?? []).filter((r) => coinByMint(r.ladder.quoteMint)?.symbol === coin.symbol && r.ladder.feedId.every((b, i) => b === feed[i]));
  }, [ladders.data, coin]);

  if (!coin) return <p className="page muted">No such coin on the street.</p>;
  const q = quote.data?.[coin.symbol] as { price: number; change24h: number | null } | undefined;
  const mint = mintOf(coin);

  // Slots: every hour on the hour from the next one, through the end of tomorrow (local time).
  const slots: { at: number; round?: LadderRow }[] = [];
  const firstSlot = Math.ceil((now + MIN_LEAD_SECS) / SLOT_SECS) * SLOT_SECS;
  const endOfTomorrow = new Date(); endOfTomorrow.setDate(endOfTomorrow.getDate() + 2); endOfTomorrow.setHours(0, 0, 0, 0);
  for (let t = firstSlot; t < endOfTomorrow.getTime() / 1000; t += SLOT_SECS) slots.push({ at: t, round: mine.find((r) => Number(r.ladder.settlesAt) === t) });
  const past = mine.filter((r) => Number(r.ladder.settlesAt) < firstSlot).sort((a, b) => Number(b.ladder.settlesAt - a.ladder.settlesAt));

  const activate = (at: number) => nav(`/new?coin=${coin.symbol}&settles=${at}`);
  const byDay = new Map<string, typeof slots>();
  for (const s of slots) { const d = new Date(s.at * 1000).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }); byDay.set(d, [...(byDay.get(d) ?? []), s]); }

  return (
    <div className="page">
      <header className="market-head">
        <div>
          <span className="sign">${coin.symbol} · {coin.name.toUpperCase()}</span>
          <h1>{coin.anchor.name} <span className="sym">{coin.anchor.symbol}</span></h1>
          <p className="live-row">
            {q ? <><span className="mono">{q.price.toLocaleString("en-US", { minimumFractionDigits: coin.anchor.dp, maximumFractionDigits: coin.anchor.dp })}</span>{q.change24h != null && <span className={`mono ${q.change24h >= 0 ? "up" : "down"}`}> {q.change24h >= 0 ? "+" : ""}{q.change24h.toFixed(2)}% 24h</span>}</> : <span className="muted">price…</span>}
          </p>
          <p className="muted">rounds on {coin.anchor.name}, paid in ${coin.symbol} · {coin.anchor.hours === "24/7" ? "every hour, around the clock" : `settling inside ${coin.anchor.hours}`} · the coin takes {coin.feeBps / 100}% on each transfer</p>
        </div>
      </header>

      <Chart24 points={chart.data?.points ?? []} dp={coin.anchor.dp} />

      <section className="slots">
        <h3>Rounds</h3>
        <p className="explain">One round per hour. An empty hour is a round nobody has funded yet: seed it and you are its first liquidity — the pool at even odds, earning fees on every trade from the first one. <Link to="/how">How it works</Link></p>
        {[...byDay.entries()].map(([day, list]) => (
          <div key={day} className="day">
            <div className="day-head">{day}</div>
            <ul className="slot-list">
              {list.map((s) => {
                const hh = new Date(s.at * 1000).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
                const r = s.round;
                return (
                  <li key={s.at} className={`slot ${r ? `slot-${r.ladder.status}` : "slot-empty"}`}>
                    <span className="mono slot-time">{hh}</span>
                    {r ? (
                      <Link to={`/m/${r.pubkey.toBase58()}`} className="slot-link">
                        <span className={`pill pill-${r.ladder.status}`}>{r.ladder.status === "open" ? (now < Number(r.ladder.locksAt) ? "trading" : "locked") : r.ladder.status}</span>
                        <span className="mono muted">pool {fmtAmount(r.ladder.depositTotal, r.ladder.decimals, 0)} · {r.ladder.curveSeq.toString()} trades</span>
                        <span className="muted">{r.ladder.status === "open" ? `locks in ${untilText(r.ladder.locksAt, now)}` : ""}</span>
                      </Link>
                    ) : (
                      <button className="small" onClick={() => activate(s.at)} disabled={!mint}>Activate — be the first LP</button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        {past.length > 0 && (
          <div className="day">
            <div className="day-head">Earlier</div>
            <ul className="slot-list">
              {past.map((r) => (
                <li key={r.pubkey.toBase58()} className={`slot slot-${r.ladder.status}`}>
                  <span className="mono slot-time">{new Date(Number(r.ladder.settlesAt) * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                  <Link to={`/m/${r.pubkey.toBase58()}`} className="slot-link"><span className={`pill pill-${r.ladder.status}`}>{r.ladder.status}</span><span className="mono muted">pool {fmtAmount(r.ladder.depositTotal, r.ladder.decimals, 0)}</span></Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
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
