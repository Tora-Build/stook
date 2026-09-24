// A pocket watch on New York's time: an ordinary twelve-hour face with hour,
// minute and second hands. Given the round's lock and bell, a thin ring round
// the edge colours the hours coming up (a twelve-hour face can only honestly
// show twelve): green until trading stops, amber for the locked stretch, a
// bell mark at the close. Given a fixed time instead of now, it shows that
// time and nothing else.
import type { ReactNode } from "react";

const NY = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23" });

/** Hours past New York midnight, fractional, at unix second `t`. */
export function nyHours(t: number): number {
  const p = Object.fromEntries(NY.formatToParts(new Date(t * 1000)).map((x) => [x.type, x.value]));
  return (Number(p.hour) % 24) + Number(p.minute) / 60 + Number(p.second) / 3600;
}

const CX = 100, CY = 120;                        // dial centre in a 200 x 220 box
const R_CASE = 90, R_DIAL = 78, R_RING = 72;
const COL = { outline: "#15110c", case: "#e9e4d4", caseShade: "#bdb5a1", dial: "#fdfaf0", ink: "#2a2419", faint: "#c9c1ad", trade: "#1f9d5c", lock: "#f0a83a", second: "#c0392b", hand: "#101a2e" };

const pt = (deg: number, r: number) => [CX + r * Math.sin((deg * Math.PI) / 180), CY - r * Math.cos((deg * Math.PI) / 180)] as const;
/** Degrees on a twelve-hour face for an hour of the day. */
const onFace = (h: number) => ((h % 12) / 12) * 360;
/** A clockwise arc on the face from `d0` to `d1` degrees. */
function arc(d0: number, d1: number, r: number) {
  const span = Math.max(0.01, d1 - d0);
  const [x0, y0] = pt(d0, r), [x1, y1] = pt(d0 + Math.min(span, 359.99), r);
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${span > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

export function PocketWatch({ now, at, locksAt, settlesAt, size = 150, title }: {
  /** Live: the hands follow this instant, second by second. */
  now?: number;
  /** Still: the hands show this instant, no second hand. */
  at?: number;
  /** With `now`, colour the coming hours up to the bell. */
  locksAt?: number; settlesAt?: number;
  size?: number; title?: string;
}) {
  const t = now ?? at ?? 0, h = nyHours(t);
  const live = now !== undefined;
  const hand = (deg: number, len: number, w: number, color: string, tail = 10) => {
    const [x1, y1] = pt(deg, len), [x0, y0] = pt(deg + 180, tail);
    return <line x1={x0} y1={y0} x2={x1} y2={y1} stroke={color} strokeWidth={w} strokeLinecap="round" />;
  };
  // The coming hours, now to the bell or twelve hours on, whichever is first.
  let ring: ReactNode = null;
  if (live && locksAt !== undefined && settlesAt !== undefined && settlesAt > t) {
    const d = (s: number) => Math.min(s - t, 12 * 3600) / 3600 * 30;  // degrees ahead of now
    const d0 = onFace(h), dLock = d(locksAt), dBell = d(settlesAt);
    ring = <>
      {dLock > 0 && <path d={arc(d0, d0 + dLock, R_RING)} fill="none" stroke={COL.trade} strokeWidth={6} strokeLinecap="butt"><title>Trading until trading stops</title></path>}
      {dBell > Math.max(dLock, 0) && <path d={arc(d0 + Math.max(dLock, 0), d0 + dBell, R_RING)} fill="none" stroke={COL.lock} strokeWidth={6}><title>Locked until the bell</title></path>}
      {settlesAt - t <= 12 * 3600 && (() => { const [x, y] = pt(d0 + dBell, R_RING); return <g transform={`translate(${x - 7} ${y - 7}) scale(.7)`}><title>The bell</title><path d="M9 1 h2 v2 h3 v2 h2 v7 h2 v3 h-18 v-3 h2 v-7 h2 v-2 h3 z" fill="#f0a83a" stroke={COL.outline} strokeWidth={2} /><rect x={8} y={16} width={4} height={3} fill="#7d2f22" /></g>; })()}
    </>;
  }
  return (
    <svg className="pocket-watch" viewBox="0 0 200 220" width={size} height={size * 1.1} role="img" aria-label={title ?? `${live ? "Now" : "At"} ${new Date(t * 1000).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" })} New York`}>
      {/* bow and crown */}
      <circle cx={CX} cy={15} r={10} fill="none" stroke={COL.outline} strokeWidth={7} />
      <circle cx={CX} cy={15} r={10} fill="none" stroke={COL.case} strokeWidth={3} />
      <rect x={CX - 9} y={22} width={18} height={11} rx={2} fill={COL.caseShade} stroke={COL.outline} strokeWidth={3} />
      {/* case and dial */}
      <circle cx={CX + 4} cy={CY + 5} r={R_CASE} fill="#7d2f22" opacity={.9} />
      <circle cx={CX} cy={CY} r={R_CASE} fill={COL.case} stroke={COL.outline} strokeWidth={4} />
      <path d={arc(135, 300, R_CASE - 5)} fill="none" stroke={COL.caseShade} strokeWidth={5} />
      <circle cx={CX} cy={CY} r={R_DIAL} fill={COL.dial} stroke={COL.outline} strokeWidth={3} />
      {ring}
      {/* minute ticks, heavier at the hours */}
      {Array.from({ length: 60 }, (_, m) => { const hr = m % 5 === 0; const [x0, y0] = pt(m * 6, R_DIAL - 12), [x1, y1] = pt(m * 6, R_DIAL - (hr ? 21 : 16)); return <line key={m} x1={x0} y1={y0} x2={x1} y2={y1} stroke={COL.ink} strokeWidth={hr ? 2.6 : 1} opacity={hr ? 1 : .55} />; })}
      {[12, 3, 6, 9].map((n) => { const [x, y] = pt((n % 12) * 30, R_DIAL - 32); return <text key={n} x={x} y={y + 5} textAnchor="middle" className="pw-num">{n}</text>; })}
      {/* hands */}
      {hand(onFace(h), 36, 6, COL.hand)}
      {hand((h % 1) * 360, 54, 3.5, COL.hand, 12)}
      {live && hand(((t % 60) / 60) * 360, 60, 1.6, COL.second, 16)}
      <circle cx={CX} cy={CY} r={5} fill={live ? COL.second : COL.hand} stroke={COL.outline} strokeWidth={2} />
    </svg>
  );
}
