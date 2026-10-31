// The podium: the period's top three callers on pixel steps under an LED
// board, the winner in the middle with both arms up. The same dark floor as
// the home page's trading floor, in both themes.
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { fmtUsd, toUsd } from "../../lib/usd";
import { abs, coinAmt, signOf, shortAddr, tone, type Player } from "./data";
import { GhostTrader, Trader } from "./Trader";

/** Steps left to right: second, first, third. */
const ORDER = [2, 1, 3] as const;

export function Stage({ left, mid, right, children }: { left: ReactNode; mid: ReactNode; right: ReactNode; children: ReactNode }) {
  return (
    <section className="board-stage" aria-label="The podium">
      <div className="board-led" role="presentation">
        <span className="board-led-cell">{left}</span>
        <span className="board-led-mid">{mid}</span>
        <span className="board-led-cell board-led-r">{right}</span>
      </div>
      {children}
    </section>
  );
}

export function Podium({ top, sym, dec, rate, me }: { top: Player[]; sym: string; dec: number; rate: number | null; me?: string }) {
  return (
    <div className="board-podium">
      <div className="board-spot" aria-hidden="true" />
      <Sparks />
      <ol className="board-steps">
        {ORDER.map((place) => {
          const p = top[place - 1];
          return (
            <li key={place} className={`board-place board-place-${place}`} style={{ order: place === 1 ? 2 : place === 2 ? 1 : 3 }} aria-label={p ? `Place ${place}` : `Place ${place}, open`}>
              {p ? <Winner p={p} place={place} sym={sym} dec={dec} rate={rate} me={me} /> : <Open />}
              <div className="board-block"><span className="pix">{place}</span></div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Winner({ p, place, sym, dec, rate, me }: { p: Player; place: 1 | 2 | 3; sym: string; dec: number; rate: number | null; me?: string }) {
  const net = BigInt(p.net);
  const mine = p.wallet === me;
  return (
    <Link to={`/yours?account=${p.wallet}&tab=history`} className={`board-winner ${mine ? "board-mine" : ""}`} title={`${p.wallet}\nSee their rounds`}>
      <span className={`board-w-net num ${tone(net)}`}>{coinAmt(net, dec, true)}<small> ${sym}</small></span>
      {rate !== null && <span className="board-w-usd">≈ {signOf(net)}{fmtUsd(toUsd(abs(net), dec, rate))}</span>}
      <span className="board-w-who">
        {mine && <b className="board-you">YOU</b>}
        <span className="board-w-addr">{shortAddr(p.wallet)}</span>
      </span>
      <span className="board-w-rec" title={`${p.won} won, ${p.missed} missed`}>{Math.round(p.hit * 100)}% hit · {p.rounds} {p.rounds === 1 ? "round" : "rounds"}</span>
      {p.bot && <span className="board-w-bot" title="A wallet the devnet sim runs">bot · {p.bot}</span>}
      <Trader wallet={p.wallet} place={place} size={place === 1 ? 6 : 5} className="board-w-trader" />
    </Link>
  );
}

function Open() {
  return (
    <div className="board-winner board-open">
      <span className="board-w-open">This spot is open</span>
      <GhostTrader size={5} />
    </div>
  );
}

/** Gold specks that blink over the winner. */
function Sparks() {
  const at = [[-150, 30, 0], [-110, 96, .7], [-60, 8, 1.4], [70, 20, .35], [120, 80, 1.1], [160, 40, 1.8], [-180, 130, 2.2], [190, 140, .9]];
  return <div className="board-sparks" aria-hidden="true">{at.map(([x, y, d], i) => <i key={i} style={{ transform: `translate(${x}px, ${y}px)`, animationDelay: `${d}s` }} />)}</div>;
}

/** The podium's shape while the ledger is read: grey steps, no names. */
export function PodiumSkeleton() {
  return (
    <div className="board-podium" aria-busy="true" aria-label="Reading the ledger">
      <ol className="board-steps">
        {ORDER.map((place) => (
          <li key={place} className={`board-place board-place-${place}`} style={{ order: place === 1 ? 2 : place === 2 ? 1 : 3 }}>
            <div className="board-winner"><span className="board-sk board-sk-l" /><span className="board-sk board-sk-s" /><span className="board-sk board-sk-man" /></div>
            <div className="board-block board-block-sk" />
          </li>
        ))}
      </ol>
    </div>
  );
}
