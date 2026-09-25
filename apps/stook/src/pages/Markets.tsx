import { Link, Navigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { COINS } from "../lib/coins";
import { Skyline } from "../components/Skyline";
import { Floor } from "../components/Floor";
import { fmtUsd, useCoinQuotes } from "../lib/usd";

const STOOK_MINT = COINS.find((c) => c.symbol === "STOOK")?.mint ?? "";


export function Markets() {
  const [params] = useSearchParams();
  const stookQ = useCoinQuotes().data?.STOOK;
  const wanted = params.get("coin");
  const quotes = useQuery({ queryKey: ["quotes"], queryFn: async () => (await fetch("/prices")).json() as Promise<Record<string, { price: number; change24h: number | null }>>, refetchInterval: 60_000 });
  if (wanted && COINS.some((c) => c.symbol === wanted.toUpperCase())) return <Navigate to={`/c/${wanted.toUpperCase()}`} replace />;
  const ticker = () => COINS.map((c) => { const q = quotes.data?.[c.symbol]; return q ? `${c.symbol} ${q.price.toLocaleString("en-US", { maximumFractionDigits: c.anchor.dp })} ${typeof q.change24h !== "number" ? "" : (q.change24h >= 0 ? "+" : "") + q.change24h.toFixed(1) + "%"}` : ""; }).filter(Boolean).join("   ") || "STOOK STREET";
  return (
    <div className="street">
      <div className="hero-city">
        <Skyline hero ticker={ticker} />
        <div className="hero-copy">
          <h1>Where will it land?</h1>
          <p className="lede">Memecoins anchored to stocks. Call where the stock closes, in your coin. The closer you are, the more it pays.</p>
          <div><Link className="cta" to="/#floor">Walk onto the floor</Link><Link className="cta alt" to="/how">How it works</Link></div>
        </div>
      </div>
      <div id="floor"><Floor /></div>

      <section className="doors page">
        <h2 className="px-h2 center">Two ways in</h2>
        <div className="door-row">
          <Link to="/#floor" className="door">
            <div className="door-frame">
              <svg viewBox="0 0 24 16" shapeRendering="crispEdges" aria-hidden="true">
                <g fill="#2f5d92"><rect x="0" y="12" width="2" height="4"/><rect x="3" y="10" width="2" height="6"/><rect x="6" y="7" width="2" height="9"/><rect x="9" y="3" width="2" height="13"/><rect x="12" y="5" width="2" height="11"/><rect x="15" y="9" width="2" height="7"/><rect x="18" y="12" width="2" height="4"/><rect x="21" y="14" width="2" height="2"/></g>
                <g fill="#f0a83a"><rect x="6" y="9" width="2" height="1"/><rect x="9" y="1" width="2" height="1"/><rect x="12" y="3" width="2" height="1"/><rect x="15" y="7" width="2" height="1"/></g>
                <rect x="9.5" y="0" width="1" height="2" fill="#f4e9c8"/>
              </svg>
            </div>
            <div className="door-sign">TRADER</div>
            <p>Click where the price will close today. The closer you are, the more you're paid.</p>
            <span className="door-go">Pick a table ›</span>
          </Link>
          <Link to="/c/STOOK" className="door">
            <div className="door-frame">
              <svg viewBox="0 0 24 16" shapeRendering="crispEdges" aria-hidden="true">
                <g fill="#0f7a4d"><rect x="2" y="8" width="20" height="7"/></g><rect x="2" y="7" width="20" height="1" fill="#f4e9c8"/>
                <g fill="#f0a83a"><rect x="5" y="3" width="3" height="4"/><rect x="10" y="1" width="3" height="6"/><rect x="15" y="4" width="3" height="3"/></g>
                <g fill="#f4e9c8"><rect x="6" y="4" width="1" height="1"/><rect x="11" y="2" width="1" height="1"/><rect x="16" y="5" width="1" height="1"/></g>
                <rect x="9" y="10" width="6" height="3" fill="#f4e9c8"/><rect x="11" y="11" width="2" height="1" fill="#0f7a4d"/>
              </svg>
            </div>
            <div className="door-sign">THE HOUSE</div>
            <p>Fund a day's pool and share 90% of everything traders pay in fees.</p>
            <span className="door-go">Fund a day ›</span>
          </Link>
        </div>
        <p className="center small"><Link to="/how">Or take the walk through the exchange →</Link></p>
      </section>

      <section id="stook" className="strip page">
        <div className="in">
          <div className="logos logos-big"><img src="/logos/stook.png" alt="$STOOK" className="logo-coin" /><img src="/logos/spyx.png" alt="SPYx" className="logo-anchor" /></div>
          <dl>
            <div><dt>coin</dt><dd>$STOOK · Stook Street · the street's own</dd></div>
            <div><dt>follows</dt><dd>S&amp;P 500 · SPYx · <span className="mono">XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W</span></dd></div>
            {/* the mint comes from the build's environment, not the repo */}
            {STOOK_MINT && <div><dt>mint</dt><dd className="mono"><a href={`https://jup.ag/swap/SOL-${STOOK_MINT}`} target="_blank" rel="noopener noreferrer" title="Swap for $STOOK on Jupiter">{STOOK_MINT} ↗</a> <a className="jup-buy" href={`https://jup.ag/swap/SOL-${STOOK_MINT}`} target="_blank" rel="noopener noreferrer">Buy on Jupiter</a></dd></div>}
            {stookQ?.usd ? <div><dt>price</dt><dd className="mono">{fmtUsd(stookQ.usd)}{typeof stookQ.change24h === "number" && <span className={stookQ.change24h >= 0 ? "up" : "down"}> {stookQ.change24h >= 0 ? "+" : ""}{stookQ.change24h.toFixed(1)}% 24h</span>}</dd></div> : null}
            <div><dt>on</dt><dd>StonkFun, Solana</dd></div>
          </dl>
        </div>
      </section>
    </div>
  );
}
