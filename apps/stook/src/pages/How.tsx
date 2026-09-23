// The walk through the exchange: one stop at a time, a scene on the left you
// can poke at, the words on the right. Everything a trader or a depositor
// needs to know is here and nothing that isn't.

import { useState } from "react";
import { Link } from "react-router-dom";
import { COINS } from "../lib/coins";

const STOPS = ["The tables", "The calendar", "The line", "The bell", "The house", "The fine print"] as const;

export function How() {
  const [i, setI] = useState(0);
  const go = (n: number) => setI(Math.max(0, Math.min(STOPS.length - 1, n)));
  return (
    <div className="page tour-page">
      <span className="sign">A WALK THROUGH THE EXCHANGE</span>
      <h1>How the street works</h1>

      <div className="tour-stops">
        {STOPS.map((s, n) => <button key={s} className={`tour-stop ${n === i ? "on" : ""} ${n < i ? "done" : ""}`} onClick={() => go(n)}><span className="tour-n">{n + 1}</span><span className="tour-name">{s}</span></button>)}
      </div>

      <div className="placard" key={i}>
        <div className="placard-scene">{[<Tables />, <Calendar />, <Line />, <Bell />, <House />, <FinePrint />][i]}</div>
        <div className="placard-text">
          {i === 0 && <>
            <h2>The tables</h2>
            <p>Every coin has a table and follows one asset, its <b>anchor</b>. Everything at the table is paid in that coin.</p>
            <p className="try">Pick a table.</p>
          </>}
          {i === 1 && <>
            <h2>The calendar</h2>
            <p>One round a day. It trades for the 24 hours before the <b>4:00 PM New York</b> close and stops an hour before it. Whoever funds a day first starts it; everyone after joins that round.</p>
            <p className="try">Fund a day.</p>
          </>}
          {i === 2 && <>
            <h2>The line</h2>
            <p>64 bands around the opening price, each a quarter of an ordinary day's move for that coin, learned from its own recent closes: thin for a quiet one, wide for a wild one. Click the one you expect at the close: your <b>line</b>. It pays most there, one step less per band it misses by, out to its <b>reach</b>. A <b>range</b> pays the same anywhere inside. Price is the crowd's odds; a round opens with an ordinary day already priced in. Sell any time before the lock.</p>
            <p className="try">Click a band. Change the reach.</p>
          </>}
          {i === 3 && <>
            <h2>The bell</h2>
            <p>At the close, the first <b>Pyth price</b> published at or after 4:00 PM lands in a band, if it came within 30 seconds. That band pays; the rest pay nothing. No such price: a day later the round is <b>void</b>. Deposits come back first, and open lines share the rest.</p>
            <p className="try">Ring it.</p>
          </>}
          {i === 4 && <>
            <h2>The house</h2>
            <p>The pool takes the other side of every line; anyone can add to it until the lock. Trades pay a <b>1% fee</b>: 80% to the pool by depth, 10% to whoever funded the day, 5% to whoever rings the bell, 5% to the protocol. At the close the pool pays the winning band and keeps the rest. A close far from the open can cost the pool its whole deposit; an ordinary one costs it little.</p>
            <p className="try">Move the deposit.</p>
          </>}
          {i === 5 && <>
            <h2>The fine print</h2>
            <p>Some coins take a <b>transfer fee</b> on every move; the app shows what your wallet sends and what the round books.</p>
            <p>Rounds settle on the <b>tokenized</b> asset's feed (SPYx, GLDx), the same price the table shows.</p>
            <p>Every quote is the program's own maths, exact to the unit.</p>
          </>}
          <div className="placard-nav">
            <button className="small" onClick={() => go(i - 1)} disabled={i === 0}>‹ back</button>
            <span className="muted mono">{i + 1} / {STOPS.length}</span>
            {i < STOPS.length - 1 ? <button className="small" onClick={() => go(i + 1)}>next ›</button> : <Link to="/#floor" className="small as-link">to the floor ›</Link>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── the scenes ───────────────────────────────────────────────────────────────

function Tables() {
  const [k, setK] = useState(0);
  const c = COINS[k]!;
  return (
    <div className="scene">
      <div className="scene-tables">{COINS.map((x, n) => <button key={x.symbol} className={`scene-table ${n === k ? "on" : ""}`} onClick={() => setK(n)}><img src={x.logo} alt="" /><span>${x.symbol}</span></button>)}</div>
      <div className="scene-caption"><img src={c.anchor.logo} alt="" className="scene-anchor" /> <b>${c.symbol}</b> → <b>{c.anchor.name}{c.anchor.name !== c.anchor.symbol ? ` (${c.anchor.symbol})` : ""}</b></div>
    </div>
  );
}

function Calendar() {
  const [started, setStarted] = useState<Set<number>>(new Set([2]));
  return (
    <div className="scene">
      <div className="scene-cal">
        {["M", "T", "W", "T", "F", "S", "S"].map((d, n) => <div key={n} className="scene-dow">{d}</div>)}
        {Array.from({ length: 7 }, (_, n) => {
          const on = started.has(n), today = n === 2;
          return <button key={n} className={`scene-day ${on ? "on" : ""} ${today ? "today" : ""}`} onClick={() => setStarted(new Set(started).add(n))}>{on ? (today ? "trading" : "funded") : "fund"}</button>;
        })}
      </div>
      <div className="scene-caption muted">A model.</div>
    </div>
  );
}

function Line() {
  const [band, setBand] = useState<number | null>(null);
  const [reach, setReach] = useState(3);
  const probs = [1, 2, 3, 5, 8, 11, 14, 16, 14, 11, 8, 5, 3, 2, 1]; // a crowd, in %
  const level = (i: number) => (band === null ? 0 : Math.max(0, reach - Math.abs(i - band)));
  const cost = band === null ? 0 : probs.reduce((a, p, i) => a + (p / 100) * level(i), 0);
  return (
    <div className="scene">
      <svg viewBox="0 0 150 70" className="scene-svg" shapeRendering="crispEdges">
        {probs.map((p, i) => <rect key={i} x={i * 10 + 1} y={60 - p * 3} width={8} height={p * 3} className={level(i) ? "bar-in" : "bar"} onClick={() => setBand(i)} style={{ cursor: "pointer" }} />)}
        {band !== null && probs.map((_, i) => level(i) ? <rect key={"l" + i} x={i * 10 + 1} y={60 - (level(i) / reach) * 55} width={8} height={2} fill="#f0a83a" /> : null)}
        <text x={2} y={68} className="lbl lbl-xs">← lower</text><text x={148} y={68} className="lbl lbl-xs" textAnchor="end">higher →</text>
      </svg>
      <div className="scene-row">
        <label className="height">reach <input type="range" min={1} max={6} value={reach} onChange={(e) => setReach(Number(e.target.value))} /><span className="mono">{reach}</span></label>
        {band !== null && <span className="mono">1 share ≈ {cost.toFixed(2)}</span>}
      </div>
      <div className="scene-caption">{band === null ? "Bars are the crowd's odds." : `Pays ${reach} for ${cost.toFixed(2)}: ${(reach / cost).toFixed(1)}× your stake.`}</div>
    </div>
  );
}

function Bell() {
  const [rung, setRung] = useState(false);
  const probs = [3, 6, 11, 16, 14, 9, 5, 3];
  const hit = 4;
  return (
    <div className="scene">
      <svg viewBox="0 0 150 70" className="scene-svg" shapeRendering="crispEdges">
        {probs.map((p, i) => <rect key={i} x={i * 18 + 3} y={60 - p * 3} width={14} height={p * 3} className={rung ? (i === hit ? "bar-settled" : "bar") : "bar"} />)}
        {rung && <><line x1={hit * 18 + 10} x2={hit * 18 + 10} y1={2} y2={62} className="line-live" /><text x={hit * 18 + 14} y={10} className="lbl lbl-live lbl-xs">Pyth: here</text></>}
      </svg>
      <div className="scene-row"><button className="small" onClick={() => setRung(true)} disabled={rung}>ring the bell</button>{rung && <button className="link" onClick={() => setRung(false)}>again</button>}</div>
      <div className="scene-caption muted">{rung ? "That band pays. A model." : "A model."}</div>
    </div>
  );
}

function House() {
  const [dep, setDep] = useState(1000);
  const others = 3000, fees = 400; // a day's fees at the table, for the demo
  const share = dep / (dep + others);
  return (
    <div className="scene">
      <div className="scene-row"><label className="height">deposit <input type="range" min={100} max={5000} step={100} value={dep} onChange={(e) => setDep(Number(e.target.value))} /><span className="mono">{dep.toLocaleString()}</span></label></div>
      <div className="scene-house">
        <div className="scene-bar"><div className="scene-fill" style={{ width: `${share * 100}%` }} /></div>
        <div className="scene-legend"><span>your share of the pool <b className="mono">{(share * 100).toFixed(0)}%</b></span><span>of {fees} in fees today <b className="mono">{(fees * 0.8 * share).toFixed(0)}</b> is yours</span></div>
      </div>
      <div className="scene-caption muted">Others hold {others.toLocaleString()}. A model.</div>
    </div>
  );
}

function FinePrint() {
  return (
    <div className="scene">
      <svg viewBox="0 0 150 70" className="scene-svg" shapeRendering="crispEdges">
        <rect x="10" y="10" width="130" height="50" fill="#f4e9c8" /><rect x="14" y="14" width="122" height="42" fill="#fbf7ea" />
        {[20, 27, 34, 41, 48].map((y, n) => <rect key={y} x="20" y={y} width={n === 4 ? 40 : 110 - n * 8} height="2" fill="#8d8670" />)}
        <rect x="112" y="40" width="18" height="12" fill="#a8412f" /><rect x="115" y="43" width="12" height="6" fill="#f4e9c8" />
      </svg>
      <div className="scene-caption muted">Read once.</div>
    </div>
  );
}
