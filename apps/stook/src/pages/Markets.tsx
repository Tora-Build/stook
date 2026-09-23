import { Link, Navigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { COINS } from "../lib/coins";
import { Skyline } from "../components/Skyline";
import { Floor } from "../components/Floor";

export function Markets() {
  const [params] = useSearchParams();
  const wanted = params.get("coin");
  const quotes = useQuery({ queryKey: ["quotes"], queryFn: async () => (await fetch("/prices")).json() as Promise<Record<string, { price: number; change24h: number | null }>>, refetchInterval: 60_000 });
  if (wanted && COINS.some((c) => c.symbol === wanted.toUpperCase())) return <Navigate to={`/c/${wanted.toUpperCase()}`} replace />;
  const ticker = () => COINS.map((c) => { const q = quotes.data?.[c.symbol]; return q ? `${c.symbol} ${q.price.toLocaleString("en-US", { maximumFractionDigits: c.anchor.dp })} ${q.change24h == null ? "" : (q.change24h >= 0 ? "+" : "") + q.change24h.toFixed(1) + "%"}` : ""; }).filter(Boolean).join("   ") || "STOOK STREET";
  return (
    <div className="street">
      <div className="hero-city">
        <Skyline hero ticker={ticker} />
        <div className="hero-copy">
          <h1>Where will it land?</h1>
          <p className="lede">Memecoins anchored to stocks. Your coin follows a stock; here you draw a line where that stock will land, in your coin, and get paid by how close you were.</p>
          <div><Link className="cta" to="/#floor">Walk onto the floor</Link><Link className="cta alt" to="/how">How it works</Link></div>
        </div>
      </div>
      <div id="floor"><Floor /></div>

      <section className="how-tiles page">
        <h2 className="px-h2">How the street works</h2>
        <div className="tiles">
          <div className="tile"><div className="n">01 · DRAW A LINE</div><p>Pick the band you expect the anchor to land in. One share pays <b>most on that band</b>, one less for every band it misses by, nothing past your reach. Prefer a plain bet? Drag a range: same payout anywhere inside.</p></div>
          <div className="tile"><div className="n">02 · SETTLE ON A NUMBER</div><p>At the settlement second the round reads the anchor's <b>Pyth price</b> — one update, chosen by a rule, so nobody picks it. It lands in a band; that band pays. The coin's own price is never part of it.</p></div>
          <div className="tile"><div className="n">03 · OR BE THE HOUSE</div><p>Put your coin into a round's pool any time before it locks. You earn <b>80% of every fee</b> from then on, and you pay when the crowd was right.</p></div>
        </div>
        <p className="muted small" style={{ marginTop: "1rem" }}><Link to="/how">The full rules, with numbers →</Link></p>
      </section>

      <section id="stook" className="strip page">
        <div className="in">
          <div className="logos logos-big"><img src="/logos/stook.png" alt="$STOOK" className="logo-coin" /><img src="/logos/spyx.png" alt="SPYx" className="logo-anchor" /></div>
          <dl>
            <div><dt>coin</dt><dd>$STOOK · Stook Street · the street's own</dd></div>
            <div><dt>follows</dt><dd>SPYx · <span className="mono">XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W</span></dd></div>
            <div><dt>mint</dt><dd className="muted">GWrd84X5QxdRPAiNUFyiBaNoVZs85oHyWHtonJdd4wqu</dd></div>
            <div><dt>on</dt><dd>StonkFun, Solana</dd></div>
            <div><dt>what it does</dt><dd>$STOOK is the money in $STOOK rounds. You buy lines with it, you fund the pool with it, and winners are paid in it.</dd></div>
          </dl>
        </div>
      </section>
    </div>
  );
}
