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
          <div className="tile tile-icon">
            <svg viewBox="0 0 24 16" shapeRendering="crispEdges" aria-hidden="true">
              <g fill="#2f5d92"><rect x="0" y="12" width="2" height="4"/><rect x="3" y="10" width="2" height="6"/><rect x="6" y="7" width="2" height="9"/><rect x="9" y="3" width="2" height="13"/><rect x="12" y="5" width="2" height="11"/><rect x="15" y="9" width="2" height="7"/><rect x="18" y="12" width="2" height="4"/><rect x="21" y="14" width="2" height="2"/></g>
              <g fill="#f0a83a"><rect x="6" y="9" width="2" height="1"/><rect x="9" y="1" width="2" height="1"/><rect x="12" y="3" width="2" height="1"/><rect x="15" y="7" width="2" height="1"/></g>
              <rect x="9.5" y="0" width="1" height="2" fill="#f4e9c8"/>
            </svg>
            <div className="n">DRAW A LINE</div><p>Click where the price will land. Closer pays more.</p>
          </div>
          <div className="tile tile-icon">
            <svg viewBox="0 0 24 16" shapeRendering="crispEdges" aria-hidden="true">
              <g fill="#f4e9c8"><rect x="9" y="1" width="6" height="1"/><rect x="8" y="2" width="8" height="1"/><rect x="7" y="3" width="10" height="6"/><rect x="6" y="9" width="12" height="2"/><rect x="11" y="11" width="2" height="2"/></g>
              <rect x="11" y="0" width="2" height="1" fill="#8a8f99"/><rect x="10" y="12" width="4" height="1" fill="#8a8f99"/>
              <g fill="#5ef0a0"><rect x="1" y="6" width="3" height="1"/><rect x="20" y="6" width="3" height="1"/><rect x="2" y="9" width="2" height="1"/><rect x="20" y="9" width="2" height="1"/></g>
            </svg>
            <div className="n">THE BELL</div><p>At the close, Pyth's price picks the winning band.</p>
          </div>
          <div className="tile tile-icon">
            <svg viewBox="0 0 24 16" shapeRendering="crispEdges" aria-hidden="true">
              <g fill="#0f7a4d"><rect x="2" y="8" width="20" height="7"/></g><rect x="2" y="7" width="20" height="1" fill="#f4e9c8"/>
              <g fill="#f0a83a"><rect x="5" y="3" width="3" height="4"/><rect x="10" y="1" width="3" height="6"/><rect x="15" y="4" width="3" height="3"/></g>
              <g fill="#f4e9c8"><rect x="6" y="4" width="1" height="1"/><rect x="11" y="2" width="1" height="1"/><rect x="16" y="5" width="1" height="1"/></g>
              <rect x="9" y="10" width="6" height="3" fill="#f4e9c8"/><rect x="11" y="11" width="2" height="1" fill="#0f7a4d"/>
            </svg>
            <div className="n">BE THE HOUSE</div><p>Fund a round's pool, earn 80% of its fees.</p>
          </div>
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
