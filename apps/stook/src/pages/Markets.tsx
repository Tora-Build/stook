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
        <div className="tiles">
          <div className="tile"><div className="n">01 · DRAW A LINE</div><p>Click where the price will land. The closer you are, the more it pays.</p></div>
          <div className="tile"><div className="n">02 · THE BELL</div><p>At the close, Pyth's price picks the winning band. Nobody else does.</p></div>
          <div className="tile"><div className="n">03 · OR BE THE HOUSE</div><p>Fund a round's pool and earn 80% of its fees.</p></div>
        </div>
        <p className="muted small" style={{ marginTop: "1rem" }}><Link to="/how">The walk through the exchange →</Link></p>
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
