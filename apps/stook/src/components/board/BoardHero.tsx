// The board's header: the live street, the exchange on the right, and one
// tower with its top three floors lit gold, one for each step of the podium.
// The copy sits on a scrim at the left; on a phone the tower steps to the
// right edge so it never runs behind the words.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { City } from "../City";

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

/**
 * `sym` is the coin's ticker, or null for the all-coins board; `when` is how
 * the period reads after a count ("this week", "so far").
 */
export function BoardHero({ sym, callTo, players, when }: { sym: string | null; callTo: string; players: number | null; when: string }) {
  const phone = usePhone();
  return (
    <header className="board-hero">
      <City className="board-hero-city" fade="both" px={4} place={{ exchange: 0.84, bull: 0.56, cart: 0.95, sign: 0.47 }}
        tower={phone ? { x: 0.84, w: 112, h: 220, floors: 9, band: [0, 2] } : { x: 0.68, w: 170, h: 250, floors: 9, band: [0, 2], sign: "THE BOARD" }} />
      <div className="wrap board-hero-in">
        <div className="kicker board-gold board-kick">THE BOARD</div>
        <h1>The street's sharpest callers</h1>
        {sym
          ? <p className="board-hero-line">Every settled round counts. A <b className="up">win</b> when a call paid, a <b className="down">miss</b> when none did. Best net first.</p>
          : <p className="board-hero-line">Every coin, one race. Each settled round earns <b>10 points</b>, <b className="up">30 more</b> when a call paid, and up to <b className="up">60 more</b> for what it returned. The top three at each Friday bell win the week.</p>}
        <div className="board-hero-act">
          <Link className="btn" to={callTo}>{sym ? <>Make a call in ${sym}</> : "Make a call"} <span aria-hidden="true">→</span></Link>
          {players !== null && <span className="board-hero-stat"><b className="num">{players}</b> {players === 1 ? "caller" : "callers"} {when}</span>}
        </div>
      </div>
    </header>
  );
}
