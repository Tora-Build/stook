import { memo, useMemo } from "react";

// A round's day on a pocket watch, in pixels. One lap of the dial is the
// round's window, opening to the bell: twelve o'clock is both the opening and
// the bell, the green arc is trading, the amber arc the locked stretch before
// the bell, and the hand is now. Drawn cell by cell on a small grid (case,
// dial, arc, ticks, hand) so it stays crisp at any whole-number scale.

const W = 40, H = 47;          // grid: the bow and crown sit above the case
const CX = 19.5, CY = 26.5;    // dial centre
const R_CASE = 19.5, R_DIAL = 16.6, R_ARC_OUT = 15.6, R_ARC_IN = 12.6;

const C = {
  outline: "#1a1410", case: "#e9e4d4", caseShade: "#b3ab97", caseShine: "#ffffff",
  dial: "#fbf7ea", tick: "#5b5446", trade: "#2fb36f", lock: "#f0a83a", bell: "#a8412f",
  hand: "#101a2e", pin: "#a8412f", spent: "#9bd8b6",
};

type Cell = [x: number, y: number, fill: string];

/** Clockwise from twelve, as a fraction of a lap, for a cell's centre. */
const lapOf = (x: number, y: number) => { const a = Math.atan2(x + 0.5 - CX, -(y + 0.5 - CY)); return (a < 0 ? a + 2 * Math.PI : a) / (2 * Math.PI); };

function cells(lockAt: number, hand: number | null): Cell[] {
  const out: Cell[] = [];
  const put = (x: number, y: number, f: string) => out.push([x, y, f]);
  // the bow (a ring) and the crown on top of the case
  for (let y = 0; y < 8; y++) for (let x = 0; x < W; x++) {
    const d = Math.hypot(x + 0.5 - CX, y + 0.5 - 4.2);
    if (d <= 4.3 && d >= 2.3) put(x, y, d > 3.6 || d < 2.9 ? C.outline : C.case);
  }
  for (let y = 5; y < 8; y++) for (let x = 17; x < 23; x++) put(x, y, x === 17 || x === 22 || y === 5 ? C.outline : C.caseShade);
  // case, dial, arc, ticks
  for (let y = 6; y < H; y++) for (let x = 0; x < W; x++) {
    const d = Math.hypot(x + 0.5 - CX, y + 0.5 - CY);
    if (d > R_CASE) continue;
    if (d > R_CASE - 1.1) { put(x, y, C.outline); continue; }
    if (d > R_DIAL) { const f = lapOf(x, y); put(x, y, f > 0.55 && f < 0.95 ? C.caseShade : f > 0.05 && f < 0.3 ? C.caseShine : C.case); continue; }
    if (d > R_DIAL - 0.9) { put(x, y, C.outline); continue; }
    const f = lapOf(x, y);
    if (d <= R_ARC_OUT && d >= R_ARC_IN) {
      // the bell at twelve, then trading, then the locked stretch
      put(x, y, f < 0.014 || f > 0.986 ? C.bell : hand !== null && f < hand ? C.spent : f < lockAt ? C.trade : C.lock);
      continue;
    }
    // twelve ticks inside the arc, longer at the quarters
    const t = f * 12, near = Math.abs(t - Math.round(t)) * (2 * Math.PI * d / 12);
    if (near < 0.55 && d < R_ARC_IN - 0.4 && d > (Math.round(t) % 3 === 0 ? 9.2 : 11)) { put(x, y, C.tick); continue; }
    put(x, y, C.dial);
  }
  // the hand: a line of cells from the centre, then the pin on top
  if (hand !== null) {
    const a = hand * 2 * Math.PI;
    for (let s = 0; s <= 11.5; s += 0.35) {
      const x = Math.floor(CX + Math.sin(a) * s), y = Math.floor(CY - Math.cos(a) * s);
      put(x, y, C.hand);
      if (s < 6) put(x + (Math.abs(Math.cos(a)) > 0.7 ? 1 : 0), y + (Math.abs(Math.cos(a)) > 0.7 ? 0 : 1), C.hand);
    }
  }
  for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) put(Math.floor(CX) + dx, Math.floor(CY) + dy, C.pin);
  return out;
}

/** Times in unix seconds. The arc is the round's schedule, always shown; the
 *  part already gone by is paler. No hand before the opening; after the bell
 *  it rests at twelve. */
export const PocketWatch = memo(function PocketWatch({ opensAt, locksAt, settlesAt, now, scale = 3, label }: { opensAt: number; locksAt: number; settlesAt: number; now: number; scale?: number; label?: string }) {
  const lap = Math.max(1, settlesAt - opensAt);
  const lockAt = Math.min(1, Math.max(0, (locksAt - opensAt) / lap));
  // the hand moves in whole minutes, so the drawing changes at most once a minute
  const t = Math.floor(now / 60) * 60;
  const hand = t < opensAt ? null : Math.min(1, (t - opensAt) / lap);
  const px = useMemo(() => cells(lockAt, hand), [lockAt, hand]);
  return (
    <svg className="pocket-watch" viewBox={`0 0 ${W} ${H}`} width={W * scale} height={H * scale} shapeRendering="crispEdges" role="img" aria-label={label ?? "The round's day on a watch"}>
      {px.map(([x, y, f], k) => <rect key={k} x={x} y={y} width={1} height={1} fill={f} />)}
    </svg>
  );
});
