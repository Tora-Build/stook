// The trading floor: the board, and one table per coin — a round screen seen
// from above, with the traders who work it standing around the rim. Clicking
// a table opens the coin's post.
import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { COINS, type Coin } from "../lib/coins";
import { useNow } from "../hooks/useNow";
import { untilText } from "../lib/format";
import { nyAt, nyDate } from "../lib/time";
import { useCoinQuotes } from "../lib/usd";
import { LedRing } from "./LedRing";

const DATA = "";

export function Floor() {
  const quotes = useQuery({ queryKey: ["quotes"], queryFn: async () => (await fetch(`${DATA}/prices`)).json() as Promise<Record<string, { price: number; change24h: number | null }>>, refetchInterval: 60_000 });
  const now = useNow();
  // The next 4 PM in New York.
  const [y, mo, d] = nyDate(now).split("-").map(Number) as [number, number, number];
  const today = nyAt(y, mo - 1, d, 16), bell = now < today ? today : nyAt(y, mo - 1, d + 1, 16);
  const posts = useRef<HTMLDivElement>(null);
  const latest = useRef(quotes.data); latest.current = quotes.data;
  // The living floor is one script shared with stooks.xyz, loaded from there.
  useEffect(() => {
    let unmount: (() => void) | undefined, cancelled = false;
    const go = () => {
      const w = window as unknown as { StookFloor?: { mount: (el: HTMLElement, o: unknown) => () => void } };
      if (cancelled || !w.StookFloor || !posts.current) return;
      unmount = w.StookFloor.mount(posts.current, {
        tables: () => COINS.map((c) => ({ el: posts.current!.querySelector(`[data-coin="${c.symbol}"]`), coin: c.symbol })).filter((t) => t.el),
        data: () => { const q = latest.current ?? {}; const out: Record<string, unknown> = {}; for (const c of COINS) if (q[c.symbol]) out[c.symbol] = { ...q[c.symbol], dp: c.anchor.dp, anchor: c.anchor.name }; return out; },
      });
    };
    if ((window as unknown as { StookFloor?: unknown }).StookFloor) go();
    else { const sc = document.createElement("script"); sc.src = `${DATA}/floor-life.js`; sc.onload = go; document.head.appendChild(sc); }
    return () => { cancelled = true; unmount?.(); };
  }, []);
  return (
    <section className="floor">
      {/* The board over the floor: only what the tables do not say, the New
          York clock and when the bell rings. Prices are on the tables. */}
      <div className="board crawl">
        <div className="crawl-end"><span className="dim">NY</span><b>{new Date(now * 1000).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false })}</b></div>
        <div className="crawl-mid"><span className="dim">STOOK STREET · THE FLOOR</span></div>
        <div className="crawl-end crawl-bell"><span className="dim">the bell rings in</span><b>{untilText(BigInt(bell), now)}</b></div>
      </div>
      <div className="posts" ref={posts}>{COINS.map((c) => <Table key={c.symbol} coin={c} q={quotes.data?.[c.symbol]} />)}</div>
    </section>
  );
}

function Table({ coin, q }: { coin: Coin; q?: { price: number; change24h: number | null } }) {
  const a = coin.anchor;
  const cq = useCoinQuotes().data?.[coin.symbol];
  return (
    <Link to={`/c/${coin.symbol}`} className="post" title={`${coin.name} · rounds on ${coin.anchor.name}`}>
      <div className="table">
        <div className="screen" data-coin={coin.symbol}>
          <div className="logos logos-anchor-first"><img src={a.logo} alt="" className="logo-coin" /><img src={coin.logo} alt="" className="logo-anchor" /></div>
          {/* The coin is the table's name; what it plays is the anchor, whose
              price is the big number, labelled so it is never read as the
              coin's. The coin's own quote runs round the rim (LedRing). */}
          <div className="coin">${coin.symbol}</div>
          <div className="anchor">plays {a.name}</div>
          <div className="price"><span className="price-k">{a.symbol}</span>{q ? `$${q.price.toLocaleString("en-US", { minimumFractionDigits: a.dp, maximumFractionDigits: a.dp })}` : "…"}</div>
          <div className={`chg ${typeof q?.change24h === "number" ? (q.change24h >= 0 ? "up" : "down") : ""}`}>{typeof q?.change24h === "number" ? `${q.change24h >= 0 ? "+" : ""}${q.change24h.toFixed(2)}% 24h` : ""}</div>
        </div>
        <LedRing symbol={coin.symbol} usd={cq?.usd} change={cq?.change24h} />
      </div>
    </Link>
  );
}

