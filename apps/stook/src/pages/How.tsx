// The walk through the exchange: one stop at a time, a scene on the left you
// can poke at, the words on the right. Everything a trader or a depositor
// needs to know is here and nothing that isn't.

import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Link } from "react-router-dom";
import { COINS } from "../lib/coins";
import { Notice } from "../components/Notice";
import { Slider } from "../components/Slider";
import { Bell as PixelBell } from "../components/Bell";

const STOPS = ["The tables", "The calendar", "The call", "The bell", "The house", "Your statement", "The fine print"] as const;

export function How() {
  // ?step=house (or tables, calendar, line, bell, fine-print) opens that stop
  const [params] = useSearchParams();
  const [i, setI] = useState(() => Math.max(0, ["tables", "calendar", "line", "bell", "house", "statement", "fine-print"].indexOf(params.get("step") ?? "")));
  const go = (n: number) => setI(Math.max(0, Math.min(STOPS.length - 1, n)));
  return (
    <div className="page tour-page">
      <span className="sign">A WALK THROUGH THE EXCHANGE</span>
      <h1>How the street works</h1>

      <div className="tour-stops">
        {STOPS.map((s, n) => <button key={s} className={`tour-stop ${n === i ? "on" : ""} ${n < i ? "done" : ""}`} onClick={() => go(n)}><span className="tour-n">{n + 1}</span><span className="tour-name">{s}</span></button>)}
      </div>

      <div className="placard" key={i}>
        <div className="placard-scene">{[<Tables />, <Calendar />, <Line />, <Bell />, <House />, <Statement />, <FinePrint />][i]}</div>
        <div className="placard-text">
          {i === 0 && <>
            <h2>The tables</h2>
            <p>Every coin has a table and follows one asset, its <b>anchor</b>. Everything at the table is paid in that coin.</p>
            <p className="try">Pick a table.</p>
          </>}
          {i === 1 && <>
            <h2>The calendar</h2>
            <p>One round a day, and any day up to 31 days out can be funded. Funded a day or more ahead, it trades for the 24 hours before the <b>4:00 PM New York</b> close and stops an hour before it; funded later, it opens a minute after funding and stops shortly before the close. Whoever funds a day first starts it; everyone after joins that round. A round that does not open within five minutes of its opening time is <b>void</b>, and deposits come back.</p>
            <p className="try">Fund a day.</p>
          </>}
          {i === 2 && <>
            <h2>The call</h2>
            <p>The price is split into 64 <b>bands</b>, each a quarter of an ordinary day's move for the anchor, learned on chain. Click the band you expect at the close: that is a <b>target</b>. It pays most there and less on each band away, out to its <b>reach</b>. A <b>range</b> pays the same anywhere inside.</p>
            <p>Enter what you spend in dollars or the coin. The <b>bars</b> show what each landing pays against the line for what you pay; the <b>ticket</b> sums it up before you sign. Sell any time before the lock.</p>
            <p className="try">Click a band. Change the reach.</p>
          </>}
          {i === 3 && <>
            <h2>The bell</h2>
            <p>At the close, the first <b>Pyth price</b> published at or after 4:00 PM New York lands in a band, if it came within 30 seconds. That band pays; the rest pay nothing. If that price came late or unsure, the round is <b>void</b>; if there is no price to show at all, it can be voided a week after the close. Nobody can void a round that could settle. In a void, deposits come back first and open calls share the rest.</p>
            <p className="try">Ring it.</p>
          </>}
          {i === 4 && <>
            <h2>The house</h2>
            <p>The pool takes the other side of every call; anyone can add to it until the lock. Trades pay a <b>2% fee</b>, rising to <b>5%</b> over the last six hours, when the close is nearly known: 90% to the pool by depth, 5% to whoever rings the bell, 5% to the protocol. At the close the pool pays the winning band and keeps the rest. A close far from the open can cost the pool its whole deposit; an ordinary one costs it little.</p>
            <p className="try">Move the deposit.</p>
          </>}
          {i === 5 && <>
            <h2>Your statement</h2>
            <p>Everything you hold, by day, one line per round: what went in, what it is worth now, and the result. Open a line for the detail.</p>
            <p>Finished rounds gather on the <b>payout slip</b>: unfold a round to see each call and deposit, and <b>Collect all</b> in one go. On a round's own page, your calls and deposits fold into the same kind of book.</p>
            <p className="try">Unfold a round.</p>
          </>}
          {i === 6 && <>
            <h2>The fine print</h2>
            <p>Read once; it rarely comes up.</p>
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
  const [band, setBand] = useState<number | null>(7);
  const [reach, setReach] = useState(3);
  const probs = [1, 2, 3, 5, 8, 11, 14, 16, 14, 11, 8, 5, 3, 2, 1]; // a crowd, in %
  const level = (i: number) => (band === null ? 0 : Math.max(0, reach - Math.abs(i - band)));
  const cost = band === null ? 0 : probs.reduce((a, p, i) => a + (p / 100) * level(i), 0);
  // $10 spent, as the ticket works it: the same ladder and paper as a round.
  const spend = 10, perLevel = cost > 0 ? spend / cost : 0;
  const rows = Array.from({ length: reach }, (_, n) => reach - n);
  const stakeAt = Math.min(100, (spend / (perLevel * reach)) * 100);
  return (
    <div className="scene">
      <svg viewBox="0 0 150 70" className="scene-svg" shapeRendering="crispEdges">
        {probs.map((p, i) => <rect key={i} x={i * 10 + 1} y={60 - p * 3} width={8} height={p * 3} className={level(i) ? "bar-in" : "bar"} onClick={() => setBand(i)} style={{ cursor: "pointer" }} />)}
        {band !== null && probs.map((_, i) => level(i) ? <rect key={"l" + i} x={i * 10 + 1} y={60 - (level(i) / reach) * 55} width={8} height={2} fill="#f0a83a" /> : null)}
        <text x={2} y={68} className="lbl lbl-xs">← lower</text><text x={148} y={68} className="lbl lbl-xs" textAnchor="end">higher →</text>
      </svg>
      <div className="scene-row"><label className="height">reach <Slider min={1} max={6} value={reach} onChange={setReach} width={110} /><span className="mono">{reach}</span></label></div>
      {band !== null && <>
        <div className="payl">
          <div className="payl-head"><span>If it lands</span><span className="payl-scale">bar: what it pays<i className="payl-tag" style={{ left: `${stakeAt}%` }}>you pay ${spend}</i></span><span /></div>
          {rows.map((lv) => { const back = perLevel * lv, win = back >= spend; return (
            <div key={lv} className={`payl-row ${win ? "payl-win" : "payl-soft"}`}>
              <span className="payl-k">{lv === reach ? "on your band" : `${reach - lv} off`}</span>
              <span className="payl-track"><span className="payl-fill" style={{ width: `${(lv / reach) * 100}%` }} /><span className="payl-stake" style={{ left: `${stakeAt}%` }} /></span>
              <span className="payl-v mono">${back.toFixed(2)}<em>{(back / spend).toFixed(2)}×</em></span>
            </div>); })}
        </div>
        <div className="ticket-paper scene-paper">
          <div className="tp-head"><span>Your call</span><b className="mono">target, reach {reach}</b></div>
          <div className="tp-row"><span>You pay</span><i /><b className="mono">${spend.toFixed(2)}</b></div>
          <div className="tp-win"><div className="tp-win-top"><span>To win</span><em className="mono">{(reach / cost).toFixed(1)}×</em></div><b className="mono">${(perLevel * reach).toFixed(2)}</b></div>
        </div>
      </>}
      <div className="scene-caption muted">A model: fees left out.</div>
    </div>
  );
}

function Bell() {
  const [rung, setRung] = useState(false);
  const probs = [3, 6, 11, 16, 14, 9, 5, 3];
  const hit = 4;
  return (
    <div className="scene">
      <div className="scene-bell"><PixelBell scale={4} ringing={rung} rung={rung} /></div>
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
  const others = 3000, fees = 400; // dollars: a day's fees at the table, for the demo
  const share = dep / (dep + others);
  return (
    <div className="scene">
      <div className="scene-row"><label className="height">deposit <Slider min={100} max={5000} step={100} value={dep} onChange={setDep} width={160} /><span className="mono">${dep.toLocaleString()}</span></label></div>
      <div className="ticket-paper scene-paper">
        <div className="tp-head"><span>Your deposit</span><b className="mono">the house, today</b></div>
        <div className="tp-row"><span>You pay</span><i /><b className="mono">${dep.toLocaleString()}</b></div>
        <div className="tp-row tp-small"><span>others hold ${others.toLocaleString()}; ${fees} in fees today</span></div>
        <div className="tp-win">
          <div className="tp-win-top"><span>Your share</span><em className="mono">${(fees * 0.9 * share).toFixed(0)} of fees</em></div>
          <b className="mono">{(share * 100).toFixed(0)}%</b>
          <div className="tp-note">of the house: 90% of every fee, split by share</div>
        </div>
      </div>
      <div className="scene-caption muted">A model.</div>
    </div>
  );
}

function Statement() {
  const [open, setOpen] = useState<number | null>(0);
  const days = [
    { name: "S&P 500 in $STOOK · Thu", total: 42.1, lines: [["call: target, reach 4 · paid $10", 31.6], ["house deposit · put in $20", 10.5]] as [string, number][] },
    { name: "Gold in $GP · Thu", total: 0, lines: [["call: range · paid $5", 0]] as [string, number][] },
  ];
  return (
    <div className="scene">
      <div className="ticket-paper scene-paper">
        <div className="tp-head"><span>Payout slip</span><b className="mono">2 finished rounds</b></div>
        {days.map((d, n) => (
          <div key={n} className={`tp-line ${open === n ? "tp-line-open" : ""}`}>
            <button className="tp-row tp-row-btn" onClick={() => setOpen(open === n ? null : n)} aria-expanded={open === n}>
              <span><span className="tp-caret" aria-hidden="true">{open === n ? "▾" : "▸"}</span>{d.name}</span><i />
              <b className="mono">{d.total ? `$${d.total.toFixed(2)}` : <span className="tp-dim">nothing won</span>}</b>
            </button>
            <div className="tp-fold tp-fold-sub"><div className="tp-fold-in">
              {d.lines.map(([k, v]) => <div key={k} className="tp-row tp-sub"><span>{k}</span><i /><span className="mono">{v ? `$${v.toFixed(2)}` : "0"}</span></div>)}
            </div></div>
          </div>
        ))}
        <div className="tp-win"><div className="tp-win-top"><span>Total to collect</span></div><b className="mono">$42.10</b></div>
        <button className="primary" disabled>Collect all $42.10</button>
      </div>
      <div className="scene-caption muted">A model.</div>
    </div>
  );
}

function FinePrint() {
  return (
    <div className="scene scene-notes">
      <Notice tone="info" title="Transfer fees">Some coins take a fee on every move. The app shows what your wallet sends and what the round books.</Notice>
      <Notice tone="info" title="Settled by Pyth">Rounds settle on the anchor's Pyth feed; on devnet a crypto stand-in, named on the round. The table's live price is for display only.</Notice>
      <Notice tone="warn" title="30 days">Collect whenever you like. After 30 days anyone can send what a round owes you to your wallet, so it can close.</Notice>
      <Notice tone="info" title="Exact quotes">Every quote is the program's own maths, to the unit.</Notice>
    </div>
  );
}
