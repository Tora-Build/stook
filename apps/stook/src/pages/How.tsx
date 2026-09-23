// How the street works, told as the tour you'd get walking through the
// exchange: stop by stop, one thing at each, with the one number that
// matters. Minimal on purpose; the full arithmetic is in the last stop.

import { Link } from "react-router-dom";

const Px = ({ rows, pal }: { rows: string[]; pal: Record<string, string> }) => (
  <svg viewBox={`0 0 ${rows[0]!.length} ${rows.length}`} className="stop-art" shapeRendering="crispEdges" aria-hidden="true">
    {rows.flatMap((row, y) => [...row].map((ch, x) => (ch === "." ? null : <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={pal[ch]} />)))}
  </svg>
);
const P = { g: "#0f7a4d", c: "#f4e9c8", a: "#f0a83a", b: "#4f8fd6", d: "#0b1120", r: "#e0605a", s: "#8a8f99", t: "#35c4c4" };

export function How() {
  return (
    <div className="page how">
      <span className="sign">A WALK THROUGH THE EXCHANGE</span>
      <h1>How the street works</h1>
      <p className="lede-plain">Six stops. Each one is a thing you'll see on the floor.</p>

      <ol className="tour">
        <li className="stop">
          <Px pal={P} rows={["............", ".gggggggggg.", ".g.cc.cc.cg.", ".g.cc.cc.cg.", ".gggggggggg.", "............", "....aaaa....", "....aaaa....", "............"]} />
          <div>
            <h2>The tables</h2>
            <p>Each coin on the street has a table. <b>$STOOK</b> follows the S&amp;P 500, <b>$ZCAT</b> Zcash, <b>$KNOTS</b> STONK, <b>$GP</b> gold. The screen on the table shows the anchor's live price. Everything at that table is paid in that coin.</p>
          </div>
        </li>

        <li className="stop">
          <Px pal={P} rows={["c.c.c.c.c.c.c", ".............", "a.....a.....a", "...a.....a...", ".....a.......", "c.c.c.c.c.c.c"]} />
          <div>
            <h2>The calendar by the door</h2>
            <p>One round a day per coin, settling at <b>4:00 PM New York</b>. A day nobody has started is empty. Start it and your deposit is its first liquidity; everyone after you joins the same round. There is no other way to create one — no forms, no custom markets.</p>
          </div>
        </li>

        <li className="stop">
          <Px pal={P} rows={["..........", "...b......", "..bbb.....", ".bbbbb.a..", "bbbbbbbaaa", "bbbbbbbbbb", "dddddddddd"]} />
          <div>
            <h2>The line</h2>
            <p>The round is a price chart with 64 bands drawn across it, each 1% wide, around where the anchor was when the round opened. <b>Click the price you expect at the close</b>: that's your line. It pays most if the price lands on your band, one less for each band it misses by, nothing past your reach. Prefer a plain bet? Drag a range: same payout anywhere inside.</p>
            <p className="stop-num">A share of a reach-4 line pays 4× on the band, 3× one off, 2× two off, 1× three off. Its price is the crowd's odds for that profile — so what a dollar can win doesn't change with reach; where it wins does.</p>
          </div>
        </li>

        <li className="stop">
          <Px pal={P} rows={["...cccc...", "..c....c..", ".c......c.", ".c..aa..c.", ".c..aa..c.", ".c......c.", "..c....c..", "...cccc...", "....ss....", "...ssss..."]} />
          <div>
            <h2>The bell</h2>
            <p>Trading locks two minutes before the close. At the closing second the round reads the anchor's <b>Pyth price</b> — one specific update, picked by a rule (the first at or after the instant), so no one on the floor chooses it. It lands in a band. That band pays. The coin's own price is never part of it.</p>
            <p className="stop-num">If no usable price arrives within 24 hours, the round is void: everyone gets back exactly what they paid.</p>
          </div>
        </li>

        <li className="stop">
          <Px pal={P} rows={["..........", ".gggggggg.", ".g......g.", ".g.cccc.g.", ".g.c..c.g.", ".g.cccc.g.", ".g......g.", ".gggggggg.", ".ss....ss."]} />
          <div>
            <h2>The house</h2>
            <p>Someone takes the other side of every line: the round's pool. Anyone can put coin into it until the lock. You earn <b>80% of every fee</b> from then on, in proportion to the depth you add. You pay when the crowd was right. Each deposit stands on its own: no one's loss ever lands on another depositor.</p>
            <p className="stop-num">Fees are 1% of each trade: 80% to the pool, 10% to whoever started the round, 10% to the protocol — half of which goes to whoever rings the bell.</p>
          </div>
        </li>

        <li className="stop">
          <Px pal={P} rows={["tttttttttt", "t........t", "t.aa..aa.t", "t........t", "t.cccccc.t", "t........t", "tttttttttt"]} />
          <div>
            <h2>The board, with numbers</h2>
            <p>Say the seven bands around the price sit at about 5% each. A range across them costs ~0.35 a share and pays 1: triple your money, 35% of the time. A reach-4 line on the middle band costs ~0.80 a share and pays up to 4. Buy 100 shares for ~80: land on the centre and collect 400; one band off, 300; three off, 100.</p>
            <p className="stop-num">Every number you see on a round page is the program's own — the site quotes with the same maths the chain runs, to the last unit.</p>
          </div>
        </li>
      </ol>

      <p className="cta-row"><Link to="/#floor">Back to the floor</Link></p>
    </div>
  );
}
