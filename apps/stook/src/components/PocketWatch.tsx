// A round's day on a pocket watch. The dial is a 24-hour New York clock
// (midnight at the top, noon at the bottom), and the round's hours sit on
// it where they fall: green while it trades, amber once it locks, the bell
// at the close, grey outside the round. With `now` it is live, hands on New
// York's time; without, it only shows the day's ranges. Drawn as chunky
// flat shapes with dark outlines, to sit with the street's pixel art.

const NY = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23" });

/** Hours past New York midnight, fractional, at unix second `t`. */
export function nyHours(t: number): number {
  const p = Object.fromEntries(NY.formatToParts(new Date(t * 1000)).map((x) => [x.type, x.value]));
  return (Number(p.hour) % 24) + Number(p.minute) / 60 + Number(p.second) / 3600;
}

const CX = 100, CY = 124;                 // dial centre in a 200 x 226 box
const R_CASE = 92, R_DIAL = 80, R_BAND = 68, BAND = 13;
const COL = { outline: "#15110c", case: "#e9e4d4", caseShade: "#b3ab97", dial: "#fbf7ea", ink: "#2a2419", idle: "#ddd6c2", trade: "#1f9d5c", lock: "#f0a83a", bell: "#a8412f", hand: "#101a2e" };

/** Degrees clockwise from the top for an hour of the day. */
const deg = (h: number) => (h / 24) * 360;
const pt = (a: number, r: number) => [CX + r * Math.sin((a * Math.PI) / 180), CY - r * Math.cos((a * Math.PI) / 180)] as const;

/** An arc of the band from hour `h0` to `h1`, clockwise (wrapping midnight). */
function arc(h0: number, h1: number, r = R_BAND) {
  let span = (h1 - h0 + 24) % 24; if (span === 0) span = 24;
  const a0 = deg(h0), a1 = a0 + deg(span) - 0.01;
  const [x0, y0] = pt(a0, r), [x1, y1] = pt(a1, r);
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${span > 12 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

export interface WatchTimes { opensAt: number; locksAt: number; settlesAt: number }

export function PocketWatch({ opensAt, locksAt, settlesAt, now, size = 170, when }: WatchTimes & { now?: number; size?: number; when: (t: number) => string }) {
  const hOpen = nyHours(opensAt), hLock = nyHours(locksAt), hBell = nyHours(settlesAt);
  const full = settlesAt - opensAt >= 86_400 - 60; // opens a whole day before its close
  const [bx, by] = pt(deg(hBell), R_BAND);
  const [ox, oy] = pt(deg(hOpen), R_BAND);
  const t = now !== undefined ? nyHours(now) : null;
  const hand = (a: number, len: number, w: number, tail = 10) => {
    const [x1, y1] = pt(a, len), [x0, y0] = pt(a + 180, tail);
    return <line x1={x0} y1={y0} x2={x1} y2={y1} stroke={COL.hand} strokeWidth={w} strokeLinecap="square" />;
  };
  const label = `Opens ${when(opensAt)}, trades until ${when(locksAt)}, the bell at ${when(settlesAt)} New York`;
  return (
    <svg className="pocket-watch" viewBox="0 0 200 226" width={size} height={size * 1.13} role="img" aria-label={label}>
      {/* bow and crown */}
      <circle cx={CX} cy={16} r={11} fill="none" stroke={COL.outline} strokeWidth={9} />
      <circle cx={CX} cy={16} r={11} fill="none" stroke={COL.case} strokeWidth={4} />
      <rect x={CX - 11} y={24} width={22} height={14} fill={COL.caseShade} stroke={COL.outline} strokeWidth={4} />
      <path d={`M ${CX - 5} 27 v 8 M ${CX} 27 v 8 M ${CX + 5} 27 v 8`} stroke={COL.outline} strokeWidth={2} />
      {/* case, bezel, dial */}
      <circle cx={CX + 5} cy={CY + 6} r={R_CASE} fill="#7d2f22" />
      <circle cx={CX} cy={CY} r={R_CASE} fill={COL.case} stroke={COL.outline} strokeWidth={5} />
      <path d={arc(9, 21, R_CASE - 6)} fill="none" stroke={COL.caseShade} strokeWidth={7} />
      <circle cx={CX} cy={CY} r={R_DIAL} fill={COL.dial} stroke={COL.outline} strokeWidth={4} />
      {/* the round's hours on the band */}
      <circle cx={CX} cy={CY} r={R_BAND} fill="none" stroke={COL.idle} strokeWidth={BAND} />
      <path d={arc(hOpen, hLock)} fill="none" stroke={COL.trade} strokeWidth={BAND}><title>{`Trading: ${when(opensAt)} to ${when(locksAt)} New York`}</title></path>
      <path d={arc(hLock, hBell)} fill="none" stroke={COL.lock} strokeWidth={BAND}><title>{`Locked: ${when(locksAt)} to the bell`}</title></path>
      {/* the opening, if it is not the previous bell, and the bell */}
      {!full && <rect x={ox - 4} y={oy - 9} width={8} height={18} fill={COL.dial} stroke={COL.outline} strokeWidth={2} transform={`rotate(${deg(hOpen)} ${ox} ${oy})`}><title>{`Opens ${when(opensAt)}`}</title></rect>}
      <g transform={`translate(${bx - 9} ${by - 10})`}><title>{`The bell: ${when(settlesAt)} New York`}</title>
        <path d="M9 1 h2 v2 h3 v2 h2 v7 h2 v3 h-18 v-3 h2 v-7 h2 v-2 h3 z" fill="#f0a83a" stroke={COL.outline} strokeWidth={1.6} />
        <rect x={8} y={16} width={4} height={3} fill={COL.bell} stroke={COL.outline} strokeWidth={1} />
      </g>
      {/* hour ticks and the four numerals */}
      {Array.from({ length: 24 }, (_, h) => { const big = h % 6 === 0; const [x0, y0] = pt(deg(h), R_BAND - BAND / 2 - 2), [x1, y1] = pt(deg(h), R_BAND - BAND / 2 - (big ? 9 : 5)); return <line key={h} x1={x0} y1={y0} x2={x1} y2={y1} stroke={COL.ink} strokeWidth={big ? 3 : 1.6} />; })}
      {[0, 6, 12, 18].map((h) => { const [x, y] = pt(deg(h), R_BAND - 33); return <text key={h} x={x} y={y + 5} textAnchor="middle" className="pw-num">{h}</text>; })}
      <text x={CX} y={CY - 14} textAnchor="middle" className="pw-ny">NY</text>
      {/* live: hour hand on the 24-hour dial, minute hand once an hour */}
      {t !== null && <>
        {hand(deg(t), R_BAND - 30, 6)}
        {hand(((t % 1) * 360), R_BAND - 8, 3.5, 14)}
      </>}
      <circle cx={CX} cy={CY} r={6} fill={COL.bell} stroke={COL.outline} strokeWidth={2.5} />
    </svg>
  );
}
