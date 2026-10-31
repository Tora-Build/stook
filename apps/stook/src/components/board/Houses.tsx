// The houses, read from chain: each coin's house, what it holds, how many
// rounds it has rolled, and what a share has made since it opened. Framed for
// a holder who wants their coin to work: what a deposit gets you, how it
// earns, how it comes back out, then each house's numbers.
import { Link } from "react-router-dom";
import { useConnection } from "@solana/wallet-adapter-react";
import { useQuery } from "@tanstack/react-query";
import { stook } from "@sooth/sdk-solana";
import { COINS, anchorOf, coinPath, mintOf, seriesOf } from "../../lib/coins";
import { fmtCompact } from "../../lib/format";
import { fmtUsd, toUsd } from "../../lib/usd";

export function Houses({ rates }: { rates: Record<string, number> }) {
  const { connection } = useConnection();
  const coins = COINS.map((c) => ({ c, series: seriesOf(c), mint: mintOf(c) })).filter((x) => x.series && x.mint);
  const q = useQuery({
    queryKey: ["houses", coins.map((x) => x.series!.toBase58()).join()],
    queryFn: async () => {
      const keys = coins.map((x) => stook.deriveHouse(x.series!));
      const [houses, mints] = await Promise.all([connection.getMultipleAccountsInfo(keys), connection.getMultipleAccountsInfo(coins.map((x) => x.mint!))]);
      return coins.map((x, n) => ({ ...x, h: houses[n] ? stook.decodeHouse(houses[n]!.data) : null, decimals: mints[n]?.data[44] ?? x.c.decimals }));
    },
    refetchInterval: 60_000,
  });
  const rows = q.data ?? [];
  return (
    <section className="board-houses" aria-label="The houses">
      <div className="board-houses-head">
        <Vault />
        <div>
          <span className="kicker board-gold">PUT YOUR COIN TO WORK</span>
          <h2>Back a house, earn the fees</h2>
          <p className="dim">Each coin has one house. Every call in that coin trades against it. Put your coin in and you own a share of it: a share of <b className="board-gold">90% of every trading fee</b>, and of every win and loss.</p>
        </div>
      </div>
      <ol className="board-how" aria-label="How backing a house works">
        <li><StepArt k="in" /><span className="board-how-n pix">1</span><div><b>Deposit your coin</b><p>You get a share of the house, sized by what you put in.</p></div></li>
        <li><StepArt k="work" /><span className="board-how-n pix">2</span><div><b>The house takes the other side</b><p>It keeps 90% of the fees on every trade. It wins what callers miss and pays what they hit, once a day at the 4 PM New York bell.</p></div></li>
        <li><StepArt k="out" /><span className="board-how-n pix">3</span><div><b>Withdraw when you like</b><p>Take out your share, fees and all. While a round is open, it leaves at the bell, at the price the round ends on.</p></div></li>
      </ol>
      <div className="board-house-grid">
        {q.isLoading ? coins.map((x) => <div key={x.c.symbol} className="board-house board-house-sk"><span className="board-sk board-sk-s" /><span className="board-sk board-sk-l" /><span className="board-sk board-sk-s" /></div>)
          : q.isError ? <p className="board-house-err dim">The houses are out of reach right now. <button className="board-link" onClick={() => void q.refetch()}>Try again</button></p>
          : rows.map(({ c, h, decimals }) => {
            const rate = rates[c.symbol];
            if (!h) return (
              <Link key={c.symbol} to={`${coinPath(c)}#house`} className="board-house board-house-none">
                <span className="board-house-coin"><img src={c.logo} alt="" /><b>${c.symbol}</b></span>
                <span className="board-house-big dimmer">No house yet</span>
                <span className="dim">The first deposit opens it.</span>
                <span className="board-house-go">Open the house <span aria-hidden="true">→</span></span>
              </Link>
            );
            const capital = stook.houseCapital(h);
            // A share's worth, (capital + 1) / (shares + V), against the 1 / V a share started at.
            const change = (Number(capital + 1n) * Number(stook.VIRTUAL_SHARES)) / Number(h.totalShares + stook.VIRTUAL_SHARES) - 1;
            const cls = change > 0.0005 ? "up" : change < -0.0005 ? "down" : "";
            return (
              <Link key={c.symbol} to={`${coinPath(c)}#house`} className="board-house">
                <span className="board-house-coin"><img src={c.logo} alt="" /><b>${c.symbol}</b><span className="dimmer">plays {anchorOf(c).symbol}</span></span>
                <span className="label">Holds</span>
                <span className="board-house-big num">{fmtCompact(capital, decimals)}<small> ${c.symbol}</small></span>
                <span className="board-house-usd dim">{rate !== undefined ? `≈ ${fmtUsd(toUsd(capital, decimals, rate))}` : " "}</span>
                <span className="board-house-facts">
                  <span><span className="label">Rounds rolled</span><b className="num">{h.epoch}</b></span>
                  <span title="What one house share is worth now, against what it was worth when the house opened. Fees push it up; calls that pay push it down."><span className="label">A share, since day one</span><b className={`num ${cls}`}>{change > 0 ? "+" : change < 0 ? "−" : ""}{Math.abs(change * 100).toFixed(1)}%</b></span>
                </span>
                <span className="board-house-go">Back the house <span aria-hidden="true">→</span></span>
              </Link>
            );
          })}
      </div>
      <p className="board-fine"><b>A share, since day one</b> is how much one share of the house has gained or lost since the house opened, in its own coin. Fees push it up every round; a close far from the open, where callers hit big, pushes it down. A share can go down as well as up: the most you can lose is what you put in. <Link to="/how?step=house">How the house works</Link></p>
    </section>
  );
}

/** Small pixel scenes for the three steps: a coin going in, the house at work, coins coming back. */
function StepArt({ k }: { k: "in" | "work" | "out" }) {
  return (
    <svg className="board-how-art" viewBox="0 0 32 24" shapeRendering="crispEdges" aria-hidden="true">
      <rect x="0" y="22" width="32" height="2" fill="#0a1020" />
      <rect x="6" y="10" width="20" height="12" fill="#127a4a" /><rect x="6" y="10" width="20" height="1" fill="#3ddc84" />
      <rect x="5" y="8" width="22" height="2" fill="#f5eedb" /><rect x="13" y="14" width="6" height="8" fill="#0a1020" />
      {k === "in" && <g className="board-how-drop"><rect x="14" y="1" width="4" height="1" fill="#fff1b8" /><rect x="13" y="2" width="6" height="3" fill="#ffc629" /><rect x="14" y="5" width="4" height="1" fill="#c88a14" /></g>}
      {k === "work" && <>
        <rect x="1" y="4" width="2" height="2" fill="#3ddc84" /><rect x="0" y="6" width="4" height="1" fill="#3ddc84" />
        <rect x="28" y="6" width="4" height="1" fill="#ff6b5e" /><rect x="29" y="7" width="2" height="2" fill="#ff6b5e" />
        <g className="board-how-blink"><rect x="10" y="12" width="2" height="2" fill="#ffc629" /><rect x="20" y="12" width="2" height="2" fill="#ffc629" /></g>
        <rect x="14" y="2" width="4" height="4" fill="#ffc629" /><rect x="15" y="3" width="2" height="2" fill="#1b1505" />
      </>}
      {k === "out" && <g className="board-how-rise">{[[1, 18], [26, 16], [28, 20]].map(([x, y]) => <g key={x}><rect x={x} y={y} width="4" height="1" fill="#ffc629" /><rect x={x} y={y! + 1} width="4" height="1" fill="#c88a14" /></g>)}<rect x="15" y="1" width="2" height="5" fill="#3ddc84" /><rect x="13" y="3" width="6" height="1" fill="#3ddc84" /><rect x="14" y="2" width="4" height="1" fill="#3ddc84" /></g>}
    </svg>
  );
}

function Vault() {
  return (
    <svg className="board-vault" viewBox="0 0 64 44" shapeRendering="crispEdges" aria-hidden="true">
      <rect x="4" y="40" width="56" height="4" fill="#0a1020" />
      <rect x="8" y="14" width="48" height="26" fill="#127a4a" /><rect x="8" y="14" width="48" height="2" fill="#3ddc84" />
      <rect x="6" y="10" width="52" height="4" fill="#f5eedb" /><rect x="24" y="2" width="16" height="8" fill="#f5eedb" /><rect x="26" y="4" width="12" height="4" fill="#127a4a" />
      <g fill="#0d5c38">{[12, 20, 40, 48].map((x) => <rect key={x} x={x} y="18" width="4" height="20" />)}</g>
      <rect x="27" y="22" width="10" height="18" fill="#0a1020" /><rect x="29" y="24" width="6" height="16" fill="#1d2d50" /><rect x="33" y="31" width="1" height="2" fill="#ffc629" />
      <g className="board-vault-coins">{[[4, 34], [10, 36], [52, 34], [58, 36]].map(([x, y]) => <g key={x}><rect x={x! - 3} y={y} width="6" height="2" fill="#ffc629" /><rect x={x! - 3} y={y! - 2} width="6" height="2" fill="#c88a14" /><rect x={x! - 3} y={y! - 4} width="6" height="2" fill="#ffc629" /></g>)}</g>
    </svg>
  );
}
