// A round's day as a bar: it runs across two calendar days (it opens at the
// previous close), which no clock face can show without wrapping, so the
// house ticket draws it flat. Green while it trades, amber once it locks,
// the bell at the end, and a divider where New York's midnight falls.
import { nyWhen } from "../lib/time";
import { nyHours } from "./PocketWatch";
import { Bell } from "./Bell";

export function RoundBar({ opensAt, locksAt, settlesAt }: { opensAt: number; locksAt: number; settlesAt: number }) {
  const span = Math.max(1, settlesAt - opensAt);
  const pct = (t: number) => `${(((t - opensAt) / span) * 100).toFixed(3)}%`;
  // New York midnight inside the round, if any
  const midnight = settlesAt - Math.round(nyHours(settlesAt) * 3600);
  const hasMidnight = midnight > opensAt && midnight < settlesAt;
  const t = (x: number) => nyWhen(x, { weekday: "short", hour: "numeric", minute: "2-digit" });
  return (
    <div className="round-bar">
      <div className="rb-track">
        <span className="rb-trade" style={{ left: 0, width: pct(locksAt) }} title={`Trading: ${t(opensAt)} to ${t(locksAt)} New York`} />
        <span className="rb-lock" style={{ left: pct(locksAt), right: 0 }} title={`Locked: ${t(locksAt)} to the bell`} />
        {hasMidnight && <span className="rb-midnight" style={{ left: pct(midnight) }}><em>{nyWhen(midnight + 60, { weekday: "short" })}</em></span>}
        <span className="rb-bell"><Bell scale={1} /></span>
      </div>
      <div className="rb-labels">
        <span className="rb-l-open"><b>{t(opensAt)}</b>opens, bands set</span>
        <span className="rb-l-lock"><b>{t(locksAt)}</b>trading stops</span>
        <span className="rb-l-bell"><b>{t(settlesAt)}</b>the bell</span>
      </div>
    </div>
  );
}
