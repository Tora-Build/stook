// The trading floor: the board, and one table per coin — a round screen seen
// from above, with the traders who work it standing around the rim. Clicking
// a table opens the coin's post.
import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { COINS, anchorOf, isDevnet, type Coin } from "../lib/coins";
import { useNow } from "../hooks/useNow";

const DATA = "https://stooks.xyz";

export function Floor() {
  const quotes = useQuery({ queryKey: ["quotes"], queryFn: async () => (await fetch(`${DATA}/prices`)).json() as Promise<Record<string, { price: number; change24h: number | null }>>, refetchInterval: 60_000 });
  const now = useNow();
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
      <div className="board"><span>STOOK STREET · THE BOARD</span><span className="dim">ROUNDS ON THE ANCHOR · PAID IN THE COIN</span><span className="dim">{new Date(now * 1000).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false })} NY</span></div>
      <div className="posts" ref={posts}>{COINS.map((c) => <Table key={c.symbol} coin={c} q={quotes.data?.[c.symbol]} />)}</div>
      {isDevnet && <p className="hint floor-note">Devnet. Prices on the tables are the real anchors; rounds here run on stand-in feeds until the keeper's Pyth key covers the anchors.</p>}
    </section>
  );
}

function Table({ coin, q }: { coin: Coin; q?: { price: number; change24h: number | null } }) {
  const a = coin.anchor;
  return (
    <Link to={`/c/${coin.symbol}`} className="post" title={`${coin.name} · rounds on ${anchorOf(coin).name}`}>
      <div className="table">
        <div className="screen" data-coin={coin.symbol}>
          <div className="coin">${coin.symbol}</div>
          <div className="anchor">{a.name}</div>
          <div className="price">{q ? q.price.toLocaleString("en-US", { minimumFractionDigits: a.dp, maximumFractionDigits: a.dp }) : "—"}</div>
          <div className={`chg ${q?.change24h != null ? (q.change24h >= 0 ? "up" : "down") : ""}`}>{q?.change24h != null ? `${q.change24h >= 0 ? "+" : ""}${q.change24h.toFixed(2)}% 24h` : ""}</div>
        </div>
      </div>
    </Link>
  );
}

