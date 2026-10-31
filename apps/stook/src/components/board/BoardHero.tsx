// The board's header: the live street, the exchange on the right, and one
// tower with its top three floors lit gold, one for each step of the podium.
// The copy sits on a scrim at the left; on a phone the tower steps to the
// right edge so it never runs behind the words.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { City } from "../City";
import type { Coin } from "../../lib/coins";

const PHONE = "(max-width: 640px)";

function usePhone() {
  const [on, setOn] = useState(() => typeof matchMedia !== "undefined" && matchMedia(PHONE).matches);
  useEffect(() => {
    if (typeof matchMedia === "undefined") return;
    const mq = matchMedia(PHONE), f = () => setOn(mq.matches);
    mq.addEventListener("change", f);
    return () => mq.removeEventListener("change", f);
  }, []);
  return on;
}

/** "this week", "in the last 30 days", "so far": how the period reads after a count. */
const when = (days: number) => (days === 7 ? "this week" : days ? `in the last ${days} days` : "so far");

export function BoardHero({ coin, callTo, players, days }: { coin: Coin; callTo: string; players: number | null; days: number }) {
  const phone = usePhone();
  return (
    <header className="board-hero">
      <City className="board-hero-city" fade="both" px={4} place={{ exchange: 0.84, bull: 0.56, cart: 0.95, sign: 0.47 }}
        tower={phone ? { x: 0.84, w: 112, h: 220, floors: 9, band: [0, 2] } : { x: 0.68, w: 170, h: 250, floors: 9, band: [0, 2], sign: "THE BOARD" }} />
      <div className="wrap board-hero-in">
        <div className="kicker board-gold board-kick">THE BOARD</div>
        <h1>The street's sharpest callers</h1>
        <p className="board-hero-line">Every settled round counts. A <b className="up">win</b> when a call paid, a <b className="down">miss</b> when none did. Best net first.</p>
        <div className="board-hero-act">
          <Link className="btn" to={callTo}>Make a call in ${coin.symbol} <span aria-hidden="true">→</span></Link>
          {players !== null && <span className="board-hero-stat"><b className="num">{players}</b> {players === 1 ? "caller" : "callers"} {when(days)}</span>}
        </div>
      </div>
    </header>
  );
}
