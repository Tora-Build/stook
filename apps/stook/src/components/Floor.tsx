// The trading floor: the board, and one table per coin — a round screen seen
// from above, with the traders who work it standing around the rim. Clicking
// a table opens the coin's post.
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { COINS, anchorOf, isDevnet, type Coin } from "../lib/coins";
import { useNow } from "../hooks/useNow";

const DATA = "https://stooks.xyz";

export function Floor() {
  const quotes = useQuery({ queryKey: ["quotes"], queryFn: async () => (await fetch(`${DATA}/prices`)).json() as Promise<Record<string, { price: number; change24h: number | null }>>, refetchInterval: 60_000 });
  const now = useNow();
  return (
    <section className="floor">
      <div className="board"><span>STOOK STREET · THE BOARD</span><span className="dim">ROUNDS ON THE ANCHOR · PAID IN THE COIN</span><span className="dim">{new Date(now * 1000).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false })} NY</span></div>
      <div className="posts">{COINS.map((c) => <Table key={c.symbol} coin={c} q={quotes.data?.[c.symbol]} />)}</div>
      {isDevnet && <p className="hint floor-note">Devnet. Prices on the tables are the real anchors; rounds here run on stand-in feeds until the keeper's Pyth key covers the anchors.</p>}
    </section>
  );
}

function Table({ coin, q }: { coin: Coin; q?: { price: number; change24h: number | null } }) {
  const rim = useMemo(() => crowd(coin.symbol), [coin.symbol]);
  const a = coin.anchor;
  return (
    <Link to={`/c/${coin.symbol}`} className="post" title={`${coin.name} · rounds on ${anchorOf(coin).name}`}>
      <div className="table">
        <svg className="rim" viewBox="0 0 100 100" shapeRendering="crispEdges" aria-hidden="true" dangerouslySetInnerHTML={{ __html: rim }} />
        <div className="screen">
          <div className="coin">${coin.symbol}</div>
          <div className="anchor">{a.name}</div>
          <div className="price">{q ? q.price.toLocaleString("en-US", { minimumFractionDigits: a.dp, maximumFractionDigits: a.dp }) : "—"}</div>
          <div className={`chg ${q?.change24h != null ? (q.change24h >= 0 ? "up" : "down") : ""}`}>{q?.change24h != null ? `${q.change24h >= 0 ? "+" : ""}${q.change24h.toFixed(2)}% 24h` : ""}</div>
        </div>
      </div>
    </Link>
  );
}

/** Traders around a table, seen from above. Seeded per coin so each table keeps its own crowd. */
function crowd(seedText: string): string {
  let seed = 7; for (const ch of seedText) seed = (seed * 31 + ch.charCodeAt(0)) & 0x7fffffff;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const suits = ["#1b2a47", "#3b2a22", "#7d2f22", "#2f4d7c", "#3a3f4c"], skins = ["#f1c9a5", "#d9a173", "#a86f45", "#6b4a2e"], hairs = ["#0b1120", "#5a3a1a", "#c9bfa4", "#a8412f"];
  let g = ""; const n = 6 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2 + rnd() * 0.3, x = Math.round(50 + Math.cos(ang) * 44) - 3, y = Math.round(50 + Math.sin(ang) * 44) - 3;
    const suit = suits[Math.floor(rnd() * 5)], skin = skins[Math.floor(rnd() * 4)], hair = hairs[Math.floor(rnd() * 4)];
    g += `<rect x="${x - 2}" y="${y + 1}" width="10" height="5" fill="${suit}"/><rect x="${x}" y="${y - 1}" width="6" height="6" fill="${skin}"/><rect x="${x}" y="${y - 2}" width="6" height="3" fill="${hair}"/>`;
    if (rnd() > 0.6) g += `<rect x="${x + 7}" y="${y + 2}" width="2" height="3" fill="#f4e9c8"/>`;
  }
  return g;
}
