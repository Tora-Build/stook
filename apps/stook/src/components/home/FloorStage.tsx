// The trading floor: one round table per street coin, its traders standing
// round the rim and talking (public/floor-life.js), an LED band turning with
// the coin's own quote, and over them the board with New York's clock and
// the bell. The big number on each table is the price its round settles on.
import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { coinPath } from "../../lib/coins";
import { useCoinQuotes } from "../../lib/usd";
import { LedRing } from "../LedRing";
import { clock, nextBell } from "./Hero";
import { StateTag } from "./Sections";
import { fmtAnchor, fmtChange, phaseOf, useFeedQuote, type StreetRound } from "./useStreet";

type Said = Record<string, { price: number; change24h: number | null; dp: number; anchor: string }>;

export function FloorStage({ rounds, now }: { rounds: StreetRound[]; now: number }) {
  const posts = useRef<HTMLDivElement>(null);
  const said = useRef<Said>({});
  useEffect(() => {
    let unmount: (() => void) | undefined, cancelled = false;
    const go = () => {
      const w = window as unknown as { StookFloor?: { mount: (el: HTMLElement, o: unknown) => () => void } };
      if (cancelled || !w.StookFloor || !posts.current) return;
      unmount = w.StookFloor.mount(posts.current, {
        tables: () => [...posts.current!.querySelectorAll<HTMLElement>("[data-coin]")].map((el) => ({ el, coin: el.dataset.coin })),
        data: () => said.current,
      });
    };
    if ((window as unknown as { StookFloor?: unknown }).StookFloor) go();
    else { const sc = document.createElement("script"); sc.src = "/floor-life.js"; sc.onload = go; document.head.appendChild(sc); }
    return () => { cancelled = true; unmount?.(); };
  }, []);
  const ny = new Date(now * 1000).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false });
  return (
    <section className="hf" id="floor" aria-label="The trading floor">
      <div className="hf-board" role="timer">
        <span className="hf-cell"><i>NY</i><b>{ny}</b></span>
        <span className="hf-mid">STOOK STREET · THE FLOOR</span>
        <span className="hf-cell hf-cell-r"><i>the bell rings in</i><b>{clock(nextBell(now) - now)}</b></span>
      </div>
      <div className="hf-posts" ref={posts}>
        {rounds.map((r) => <FloorTable key={r.coin.symbol} r={r} now={now} said={said} />)}
      </div>
    </section>
  );
}

function FloorTable({ r, now, said }: { r: StreetRound; now: number; said: React.MutableRefObject<Said> }) {
  const q = useFeedQuote(r);
  const cq = useCoinQuotes().data?.[r.coin.symbol];
  const c = r.coin, phase = phaseOf(r, now);
  if (q) said.current[c.symbol] = { price: q.price, change24h: q.change24h ?? null, dp: r.anchor.dp, anchor: r.anchor.name };
  const roundTo = r.round ? `/m/${r.round.pubkey.toBase58()}` : null;
  const to = phase === "live" && roundTo ? roundTo : coinPath(c);
  return (
    <div className={`hf-post ${phase === "live" ? "hf-live" : ""}`}>
      <Link to={to} className="hf-table" title={`${c.name} · rounds on ${r.anchor.name}`}>
        <div className="hf-screen" data-coin={c.symbol}>
          <span className="hf-logos"><img src={c.anchor.logo} alt="" /><img src={c.logo} alt="" /></span>
          <span className="hf-sym">${c.symbol}</span>
          <span className="hf-plays">plays {r.anchor.name}</span>
          <span className="hf-px num">{q ? fmtAnchor(q.price, r.anchor.dp) : "…"}</span>
          <span className={`hf-chg ${typeof q?.change24h === "number" ? (q.change24h >= 0 ? "up" : "down") : ""}`}>{typeof q?.change24h === "number" ? fmtChange(q.change24h) : " "}</span>
        </div>
        <LedRing symbol={c.symbol} usd={cq?.usd} change={cq?.change24h} />
      </Link>
      <div className="hf-foot">
        <StateTag r={r} phase={phase} now={now} />
        {phase === "live" && roundTo
          ? <Link className="btn btn-sm" to={roundTo}>Make a call</Link>
          : <Link className="btn btn-sm btn-ghost" to={roundTo ?? coinPath(c)}>{phase === "locked" ? "Watch the bell" : phase === "settled" ? "Where it landed" : "Coin page"}</Link>}
      </div>
    </div>
  );
}
