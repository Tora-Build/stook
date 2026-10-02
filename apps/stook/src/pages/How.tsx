// The walk through the exchange: one stop at a time, a scene on the left you
// can poke at, the words on the right. The scenes are the round page's own
// Tower, drawn in demo mode on a made-up round: nothing is read or sent.

import { useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { Link } from "react-router-dom";
import { COINS } from "../lib/coins";
import { Slider } from "../components/Slider";
import { Tower, type HeldMark, type Phase, type RoofSign, type TickerItem } from "../components/Tower";
import { CallKind } from "../components/TowerDesk";
import { useDesk } from "../hooks/useDesk";
import { aboutMultiple, callWords, height, makeGrid, nearAt, toShape, type Grid } from "../lib/call";
import { Title } from "../components/Title";
import { WatchButton } from "../components/Watch";

const STOPS = ["The tables", "The tower", "Your call", "The bell", "The house", "Your statement"] as const;
const KEYS = ["tables", "tower", "line", "bell", "house", "statement"];
// Older links name stops that were merged into these.
const ALIAS: Record<string, string> = { calendar: "house", "fine-print": "statement", call: "line" };

/** The rules behind a stop, folded until asked for. */
function Details({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="how-more">
      <button className="how-more-btn" onClick={() => setOpen(!open)} aria-expanded={open}><span className="pb-caret" aria-hidden="true">{open ? "▾" : "▸"}</span> The details</button>
      {open && <div className="how-more-in">{children}</div>}
    </div>
  );
}

export function How() {
  // ?step=tower (or tables, line, bell, house, statement) opens that stop
  const [params] = useSearchParams();
  const [i, setI] = useState(() => { const k = params.get("step") ?? ""; return Math.max(0, KEYS.indexOf(ALIAS[k] ?? k)); });
  const go = (n: number) => setI(Math.max(0, Math.min(STOPS.length - 1, n)));
  return (
    <div className="page tour-page">
      <Title text="How it works" />
      <span className="sign">A WALK THROUGH THE EXCHANGE</span>
      <h1>How the street works</h1>
      <p className="how-watch">Rather watch? <WatchButton className="watch-inline" /></p>

      <div className="tour-stops">
        {STOPS.map((s, n) => <button key={s} className={`tour-stop ${n === i ? "on" : ""} ${n < i ? "done" : ""}`} onClick={() => go(n)}><span className="tour-n">{n + 1}</span><span className="tour-name">{s}</span></button>)}
      </div>

      <div className="placard" key={i}>
        <div className="placard-scene">{[<Tables />, <TowerScene />, <CallScene />, <BellScene />, <House />, <Statement />][i]}</div>
        <div className="placard-text">
          {i === 0 && <>
            <h2>The tables</h2>
            <p>Every coin has a table and follows one stock or asset, its <b>anchor</b>. Each day asks one question: where does the anchor close at <b>4 PM New York</b>? Everything at a table is paid in its coin.</p>
            <p className="try">Pick a table.</p>
          </>}
          {i === 1 && <>
            <h2>The tower</h2>
            <p>Each day is a tower. Every <b>floor</b> is a price, and the close lands on exactly one of them. The <b>line</b> across the glass is the price today; the elevator is the price right now.</p>
            <p><b>Lit windows</b> are the crowd's chance for that floor: more light, more likely. <b>Gold coins</b> are what your call wins if the close lands there.</p>
            <Details>
              <p>The tower has 64 floors, each a set step of the price, sized from how much the anchor usually moves in a day. The thin, unlikely ends fold into a <b>rooftop</b> (anything above) and a <b>basement</b> (anything below); each is one floor you can call.</p>
            </Details>
            <p className="try">Point at a floor, or tap it, to read it.</p>
          </>}
          {i === 2 && <>
            <h2>Your call</h2>
            <p><b>Near a price</b> pays most on your floor and less on each floor away. <b>How sure?</b> sets how many floors it pays on: <b>Sure</b> is one floor each side and pays the most, <b>Pretty sure</b> three, <b>Not sure</b> six.</p>
            <p><b>Between two prices</b> pays the same on every floor from one end to the other. Fewer floors pay more.</p>
            <Details>
              <p>Tap a floor, or drag the gold tabs to change a call. Exact prices lets you type them. You say what you spend, in dollars or the coin; the ticket shows what you pay, the fee and what you win before you sign. Sell any time before the lock.</p>
            </Details>
            <p className="try">Tap a floor. Try each How sure.</p>
          </>}
          {i === 3 && <>
            <h2>The lock and the bell</h2>
            <p>Trading closes a little before the bell: the <b>lock</b>. Your calls ride to 4 PM New York, when the first <b>Pyth price</b> lands on one floor. Calls that pay there win; the rest win nothing. Nobody picks the result.</p>
            <p>Then <b>collect</b>: the round page and Yours show what you won, one button sends it to your wallet.</p>
            <Details>
              <p>The price must come within 30 seconds of the close. If it came late or unsure the round is <b>void</b>: deposits come back first and open calls share the rest. With no price at all, a round can be voided a week after the close. Nobody can void a round that could settle.</p>
            </Details>
            <p className="try">Ring it.</p>
          </>}
          {i === 4 && <>
            <h2>The house</h2>
            <p>Fund a day's pool and take the other side of every call. The house keeps <b>90% of the fees</b>; the most it can lose is what it put in.</p>
            <Details>
              <p>Any day up to 31 days out can be funded from the coin's calendar; whoever funds it first starts it, and anyone can add until the lock. Funded a day ahead, it trades for the 24 hours before the close and stops an hour before it.</p>
              <p>Trades pay 2%, rising to 5% over the last six hours: 90% to the pool, 5% to whoever rings the bell, 5% to the protocol. A close far from the open can cost the pool its deposit; an ordinary one costs it little. A round that cannot open in time is void and deposits come back.</p>
            </Details>
            <p className="try">Move the deposit.</p>
          </>}
          {i === 5 && <>
            <h2>Your statement</h2>
            <p>Everything you hold, one line per round by day. Finished rounds gather on the <b>payout slip</b>: unfold one to see it, and <b>Collect all</b> at once.</p>
            <Details>
              <p>Amounts are in the round's coin, as the chain holds them; ≈ dollars move with today's price. Some coins take a fee on every move, and the app shows it.</p>
              <p>Collect whenever you like. Thirty days after a close anyone may send what a round owes you to your wallet, so it can close. Every quote is the program's own maths, to the unit.</p>
            </Details>
            <p className="try">Unfold a round.</p>
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

// A made-up round for the drawings: price 100.00, 1% floors, a crowd around 100.
const DEMO_NOW = 1_790_000_000;
const NO_SIGN: RoofSign = { symbol: "", name: "", paidIn: "", date: "", closes: "" };
const NO_TICKER: TickerItem[] = [];
function useDemoGrid(): Grid {
  return useMemo(() => {
    const raw = Array.from({ length: 64 }, (_, i) => { const x = i - 32.4; return Math.exp(-(x * x) / (2 * 2.4 * 2.4)) + 0.02 * Math.exp(-Math.abs(x) / 6) + 1e-4; });
    const tot = raw.reduce((a, b) => a + b, 0), w = raw.map((v) => BigInt(Math.round((v / tot) * 1e18)));
    return makeGrid({ curve: { w, sum: w.reduce((a, b) => a + b, 0n) }, p0: 10_000n, expo: -2, stepBps: 100, dp: 2, keep: [32], all: false });
  }, []);
}
const HISTORY: [number, number][] = (() => { let s = 5; const r = () => ((s = (s * 9301 + 49297) % 233280) / 233280 - 0.5); const out: [number, number][] = []; let v = 100; for (let k = 0; k <= 60; k++) { out.push([DEMO_NOW - 3 * 3600 + k * 180, v]); v *= 1 + r() * 0.004; } out.push([DEMO_NOW, 100.6]); return out; })();
const dollars = (u: bigint) => `$${(Number(u) / 100).toFixed(2)}`;

function DemoTower(p: { grid: Grid; desk: ReturnType<typeof useDesk>; phase: Phase; held?: HeldMark[]; settledBin?: number | null; headline?: ReactNode; floors?: number; legend?: boolean; wonText?: string | null; history?: [number, number][] }) {
  const c = p.desk.pending ? null : p.desk.call;
  // What $10 wins, from the crowd's odds and a 2% fee: a sketch, not a quote.
  const mult = c ? aboutMultiple(curveOf(p.grid), c, 200) : null;
  const toWin = c && mult ? BigInt(Math.round(10 * mult * 100)) : null;
  const win = useMemo(() => ({ toWin, mult, stale: false, at: (lv: number) => (toWin && c ? (toWin * BigInt(lv)) / BigInt(height(c)) : 0n) }), [toWin, mult, c]);
  return <Tower grid={p.grid} desk={p.desk} phase={p.phase} live={100.6} history={p.history ?? HISTORY} now={DEMO_NOW} opened opensAt={DEMO_NOW - 3 * 3600} locksAt={DEMO_NOW + 3600} settlesAt={DEMO_NOW + 2 * 3600}
    settledBin={p.settledBin ?? null} win={win} money={dollars} short={(u) => (Number(u) / 100).toFixed(2)} symbol="$" held={p.held ?? []} onHeld={() => {}}
    wonText={p.wonText ?? null} headline={p.headline ?? null} all={false} onPicked={() => {}} sign={NO_SIGN} ticker={NO_TICKER} status="" demo={{ floors: p.floors ?? 9, legend: p.legend }} />;
}
// The demo grid keeps its curve for the sketch of what a call pays.
const curves = new WeakMap<Grid, { w: bigint[]; sum: bigint }>();
function curveOf(g: Grid) {
  let c = curves.get(g);
  if (!c) { const w = g.probs.map((p) => BigInt(Math.round(p * 1e18))); c = { w, sum: w.reduce((a, b) => a + b, 0n) }; curves.set(g, c); }
  return c;
}

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

function TowerScene() {
  const grid = useDemoGrid(), desk = useDesk(grid);
  useMemo(() => desk.load(nearAt(grid, 32, 3)), []); // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="scene scene-tower"><DemoTower grid={grid} desk={desk} phase="open" floors={11} legend /></div>;
}

function CallScene() {
  const grid = useDemoGrid(), desk = useDesk(grid);
  useMemo(() => desk.load(nearAt(grid, 32, 3)), []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="scene scene-tower">
      <CallKind desk={desk} grid={grid} curve={curveOf(grid)} feeBps={200} at={32} coarse={false} onSure={() => {}} />
      <DemoTower grid={grid} desk={desk} phase="open" floors={10} />
      <div className="scene-caption muted">A sketch: $10 on a made-up round.</div>
    </div>
  );
}

function BellScene() {
  const grid = useDemoGrid(), desk = useDesk(grid);
  const [rung, setRung] = useState(false);
  const shape = toShape(nearAt(grid, 33, 3)), held: HeldMark[] = [{ key: "demo", shape, label: callWords(grid, nearAt(grid, 33, 3)), sel: false }];
  // The close lands one floor above the call's own: it pays, a step less than its best.
  const land = 34, pays = Math.max(0, shape.h - Math.abs(land - 33));
  const won = 10 * aboutMultiple(curveOf(grid), nearAt(grid, 33, 3), 200) * (pays / shape.h);
  return (
    <div className="scene scene-tower">
      <DemoTower grid={grid} desk={desk} phase={rung ? "settled" : "locked"} held={held} settledBin={rung ? land : null}
        history={rung ? [...HISTORY, [DEMO_NOW + 3600, 101.4], [DEMO_NOW + 2 * 3600, 102.4]] : undefined}
        headline={rung ? <>Closed on the <b>{grid.fmt(grid.edge(land))}</b> floor, one above your call's own. It still pays: <b>${won.toFixed(2)}</b> on $10.</> : <>Trading closed. Your call rides to the bell.</>}
        wonText={rung ? `YOU WIN · $${won.toFixed(2)}` : null} floors={9} />
      <div className="scene-row"><button className="small" onClick={() => setRung(true)} disabled={rung}>ring the bell</button>{rung && <button className="link" onClick={() => setRung(false)}>again</button>}</div>
      <div className="scene-caption muted">A sketch on a made-up round.</div>
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
    { name: "S&P 500 in $STOOK · Thu", total: 42.1, lines: [["call: Near 5,512.40, ±3 floors · paid $10", 31.6], ["house deposit · put in $20", 10.5]] as [string, number][] },
    { name: "Gold in $GP · Thu", total: 0, lines: [["call: Between 3,310.00 and 3,395.00 · paid $5", 0]] as [string, number][] },
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

