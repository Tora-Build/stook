// The home page below the hero: how a round works in three steps, one card
// per street coin, the coins communities listed, the last bells, and the
// street's own coin beside the house.
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { stook } from "@sooth/sdk-solana";
import { coinPath, keyOf } from "../../lib/coins";
import { fmtUsd, useCoinQuotes } from "../../lib/usd";
import { nyWhen } from "../../lib/time";
import type { ListedCoin } from "../../lib/listed";
import { clock } from "./Hero";
import { fmtAnchor, fmtChange, phaseOf, useFeedQuote, type Bell, type Phase, type StreetRound } from "./useStreet";

const hm = (t: number | bigint) => nyWhen(t, { hour: "numeric", minute: "2-digit" });

export function Steps({ coin, bell }: { coin: string; bell: string }) {
  return (
    <ol className="home-steps">
      <li className="card home-step">
        <span className="home-ico home-ico-now" aria-hidden="true">
          <svg width="36" height="36" viewBox="0 0 16 16" shapeRendering="crispEdges"><rect x="2" y="2" width="12" height="2" fill="#62d0ff" /><rect x="2" y="7" width="12" height="2" fill="#ffc629" /><rect x="2" y="12" width="12" height="2" fill="#62d0ff" /><rect x="0" y="6" width="2" height="4" fill="#ffc629" /></svg>
        </span>
        <div><span className="kicker">01</span><h3>Pick a price</h3></div>
      </li>
      <li className="card home-step">
        <span className="home-ico home-ico-taxi" aria-hidden="true"><img src="/stook-coin.svg" alt="" width="40" height="40" /></span>
        <div><span className="kicker">02</span><h3>Put in ${coin}</h3></div>
      </li>
      <li className="card home-step">
        <span className="home-ico home-ico-up" aria-hidden="true">
          <svg width="36" height="36" viewBox="0 0 16 16" shapeRendering="crispEdges" fill="#3ddc84"><rect x="7" y="0" width="2" height="2" /><rect x="5" y="2" width="6" height="2" /><rect x="4" y="4" width="8" height="6" /><rect x="2" y="10" width="12" height="2" /><rect x="7" y="13" width="2" height="2" /></svg>
        </span>
        <div><span className="kicker">03</span><h3>Win at the {bell} bell</h3></div>
      </li>
    </ol>
  );
}

export function StateTag({ r, phase, now }: { r: StreetRound; phase: Phase; now: number }) {
  const l = r.round?.ladder;
  switch (phase) {
    case "live": return <span className="tag2 live home-tag-time">Live <b className="num">{clock(Number(l!.locksAt) - now)}</b></span>;
    case "locked": return <span className="tag2 home-tag-time">Bell <b className="num">{hm(l!.settlesAt)}</b></span>;
    case "opening": return <span className="tag2 home-tag-time">Opens <b className="num">{hm(l!.opensAt)}</b></span>;
    case "settled": return <span className="tag2">Settled</span>;
    case "void": return <span className="tag2">Void</span>;
    case "none": return <span className="tag2">No round yet</span>;
    default: return <span className="tag2">Not here yet</span>;
  }
}

export function Tables({ rounds, now }: { rounds: StreetRound[]; now: number }) {
  return <div className="home-tables">{rounds.map((r) => <Table key={r.coin.symbol} r={r} now={now} />)}</div>;
}

/** One street coin. The big number is the price the round settles on: on a
 *  test build that is the stand-in feed, the same one the hero shows. */
function Table({ r, now }: { r: StreetRound; now: number }) {
  const q = useFeedQuote(r);
  const cq = useCoinQuotes().data?.[r.coin.symbol];
  const c = r.coin, a = c.anchor, phase = phaseOf(r, now);
  const roundTo = r.round ? `/m/${r.round.pubkey.toBase58()}` : null;
  return (
    <article className="card home-table">
      <header className="home-table-head">
        <Link to={coinPath(c)} className="home-logos" title={`${c.name} · rounds on ${a.name}`}>
          <img src={a.logo} alt="" className="home-logo-a" /><img src={c.logo} alt="" className="home-logo-c" />
        </Link>
        <div className="home-table-id">
          <Link to={coinPath(c)} className="home-table-name">${c.symbol}</Link>
          <span className="label">plays {a.name}</span>
        </div>
      </header>
      <div className="home-table-px">
        <div className="home-table-k"><span className="label">{r.anchor.symbol}</span><StateTag r={r} phase={phase} now={now} /></div>
        <b className="num-l">{q ? fmtAnchor(q.price, r.anchor.dp) : "…"}</b>
        {typeof q?.change24h === "number" && <span className={`home-chg ${q.change24h >= 0 ? "up" : "down"}`}>{fmtChange(q.change24h)}</span>}
      </div>
      <div className="home-table-coin">
        <span className="label">${c.symbol}</span>
        <span className="num">{cq?.usd ? fmtUsd(cq.usd) : "…"}</span>
        {typeof cq?.change24h === "number" && <span className={`home-chg ${cq.change24h >= 0 ? "up" : "down"}`}>{fmtChange(cq.change24h, 1)}</span>}
      </div>
      {r.standIn && <p className="home-note">Test rounds settle on {r.anchor.symbol}</p>}
      <footer className="home-table-foot">
        {roundTo && (phase === "live"
          ? <Link className="btn btn-sm" to={roundTo}>Make a call</Link>
          : <Link className="btn btn-sm btn-ghost" to={roundTo}>{phase === "locked" ? "Watch the bell" : phase === "opening" ? "See the round" : "See where it landed"}</Link>)}
        <Link className="home-more" to={coinPath(c)}>Coin page <span aria-hidden="true">→</span></Link>
      </footer>
    </article>
  );
}

export function Listed({ coins, ready }: { coins: ListedCoin[]; ready: boolean }) {
  if (!coins.length) return (
    <div className="home-open">
      <div className="home-open-table" aria-hidden="true"><span className="pix">+</span></div>
      <div className="home-open-copy">
        <span className="kicker taxi">AN EMPTY TABLE</span>
        <h3>Your coin could be here</h3>
        <p className="dim">{ready ? "Lock some of your coin as its house. Its holders get a daily round." : "Reading the chain…"}</p>
      </div>
      <Link className="btn btn-sm" to="/list">List a coin <span aria-hidden="true">→</span></Link>
    </div>
  );
  return (
    <div className="home-listed">
      {coins.map((c) => (
        <Link key={c.mint} to={`/c/${c.symbol}`} className="card home-chip" title={c.mint}>
          <img src={c.logo} alt="" />
          <span className="home-chip-id"><b>${c.symbol}</b><span className="label">on {c.anchor.symbol}</span></span>
          {c.listing.state === "pending" && <span className="tag2">Live {nyWhen(Number(c.listing.opensAfter), { weekday: "short", hour: "numeric" })}</span>}
        </Link>
      ))}
    </div>
  );
}

interface LedgerDay { index: number; status: "settled" | "void"; bin: number | null; p0: string | null; expo: number | null; stepBps: number | null }

/** The featured coin's last bells: settled rounds still on chain, plus the
 *  ledger's (/days) for rounds already closed. Nothing shows without either. */
export function LastBells({ r }: { r: StreetRound }) {
  const s = r.series;
  const to = r.index !== null ? r.index - 1 : 0;
  const ledger = useQuery({
    queryKey: ["days", r.coin.symbol, to - 9, to],
    enabled: !!s && r.index !== null,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async () => {
      const res = await fetch(`/days?${new URLSearchParams({ coin: keyOf(r.coin), from: String(to - 9), to: String(to) })}`);
      if (!res.ok || !res.headers.get("content-type")?.includes("json")) return [] as LedgerDay[];
      return ((await res.json()).days ?? []) as LedgerDay[];
    },
  });
  const byIndex = new Map<number, Bell>();
  for (const d of ledger.data ?? []) {
    if (!s || d.status !== "settled" || d.bin === null || !d.p0 || d.expo === null || !d.stepBps) continue;
    const [lo, hi] = stook.binBounds(d.bin, BigInt(d.p0), d.stepBps), sc = 10 ** d.expo;
    byIndex.set(d.index, { index: d.index, settlesAt: Number(stook.closeOf(s, d.index)), lo: lo * sc, hi: hi * sc });
  }
  for (const b of r.bells) byIndex.set(b.index, b);
  const bells = [...byIndex.values()].sort((x, y) => y.index - x.index).slice(0, 5);
  if (!bells.length) return null;
  const dp = r.anchor.dp;
  return (
    <section>
      <div className="sec"><h2>Last bells <span className="home-sec-sub">${r.coin.symbol} on {r.anchor.symbol}</span></h2><Link to={coinPath(r.coin)}>All rounds <span aria-hidden="true">→</span></Link></div>
      <div className="home-stubs">
        {bells.map((b, i) => (
          <div key={b.index} className={`home-stub ${i === 0 ? "home-stub-last" : ""}`}>
            <svg className="home-stub-bell" width="28" height="28" viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden="true"><g fill="#ffc629"><rect x="7" y="0" width="2" height="2" /><rect x="5" y="2" width="6" height="2" /><rect x="4" y="4" width="8" height="6" /><rect x="2" y="10" width="12" height="2" /></g><rect x="7" y="13" width="2" height="2" fill="#f5eedb" /><rect x="5" y="5" width="1" height="4" fill="#fff4c4" /></svg>
            <span className="home-stub-day">{nyWhen(b.settlesAt, { weekday: "short", month: "short", day: "numeric" })} · 4 PM</span>
            <span className="home-stub-k">LANDED</span>
            <b className="home-stub-px num">{b.lo > 0 ? fmtAnchor(b.lo, dp) : "below"}</b>
            <span className="home-bell-to">{!Number.isFinite(b.hi) ? "and up" : b.lo > 0 ? `to ${fmtAnchor(b.hi, dp)}` : fmtAnchor(b.hi, dp)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

const JUP = (mint: string) => `https://jup.ag/swap?buy=${mint}&sell=So11111111111111111111111111111111111111112`;

export function StreetCoin({ coin }: { coin: StreetRound["coin"] }) {
  const cq = useCoinQuotes().data?.[coin.symbol];
  const a = coin.anchor;
  return (
    <div className="card home-sst" id="stook">
      <div className="home-sst-head">
        <span className="home-logos home-logos-big"><img src={coin.logo} alt="" className="home-logo-a" /><img src={a.logo} alt="" className="home-logo-c" /></span>
        <div>
          <h3>${coin.symbol}</h3>
          <span className="label">{coin.name} · the street's own coin</span>
        </div>
        {cq?.usd ? (
          <div className="home-sst-px">
            <b className="num-m">{fmtUsd(cq.usd)}</b>
            {typeof cq.change24h === "number" && <span className={`home-chg ${cq.change24h >= 0 ? "up" : "down"}`}>{fmtChange(cq.change24h, 1)}</span>}
          </div>
        ) : null}
      </div>
      <dl className="home-facts">
        <div><dt>Follows</dt><dd>{a.name} PreStocks <span className="home-mint" title={a.mint}>{a.mint.slice(0, 4)}…{a.mint.slice(-4)}</span></dd></div>
        <div><dt>On</dt><dd>StonkFun, Solana</dd></div>
        {/* the mint comes from the build's environment, not the repo */}
        {coin.mint && <div><dt>Mint</dt><dd><a className="home-mint" href={JUP(coin.mint)} target="_blank" rel="noopener noreferrer" title={coin.mint}>{coin.mint.slice(0, 4)}…{coin.mint.slice(-4)} ↗</a></dd></div>}
      </dl>
      {coin.mint && <a className="btn btn-sm home-sst-buy" href={JUP(coin.mint)} target="_blank" rel="noopener noreferrer">Buy on Jupiter</a>}
    </div>
  );
}

export function HouseCard() {
  return (
    <div className="card home-house">
      <svg className="home-vault" viewBox="0 0 64 44" shapeRendering="crispEdges" aria-hidden="true">
        <rect x="4" y="40" width="56" height="4" fill="#0a1020" />
        <rect x="8" y="14" width="48" height="26" fill="#127a4a" /><rect x="8" y="14" width="48" height="2" fill="#3ddc84" />
        <rect x="6" y="10" width="52" height="4" fill="#f5eedb" /><rect x="24" y="2" width="16" height="8" fill="#f5eedb" /><rect x="26" y="4" width="12" height="4" fill="#127a4a" />
        <g fill="#0d5c38">{[12, 20, 40, 48].map((x) => <rect key={x} x={x} y="18" width="4" height="20" />)}</g>
        <rect x="27" y="22" width="10" height="18" fill="#0a1020" /><rect x="29" y="24" width="6" height="16" fill="#1d2d50" /><rect x="33" y="31" width="1" height="2" fill="#ffc629" />
        <g className="home-vault-coins">{[[4, 34], [10, 36], [52, 34], [58, 36]].map(([x, y]) => <g key={x}><rect x={x - 3} y={y} width="6" height="2" fill="#ffc629" /><rect x={x - 3} y={y - 2} width="6" height="2" fill="#c88a14" /><rect x={x - 3} y={y - 4} width="6" height="2" fill="#ffc629" /></g>)}</g>
      </svg>
      <div className="home-house-copy">
        <span className="kicker taxi">THE HOUSE</span>
        <h3>Be the house</h3>
        <p className="dim">It takes the other side of every call and keeps <b>90% of the fees</b>.</p>
        <Link className="btn btn-sm" to="/c/STOOK#house">Back the house <span aria-hidden="true">→</span></Link>
      </div>
    </div>
  );
}
