// What you already hold in this round, as a rack of small paper slips: the
// same cream paper as the order ticket, a scalloped edge, one slip a call or
// a deposit. A picked slip is pinned up with a gold edge and carries its own
// actions. Long racks fold to their first few, with a slot to show the rest.
import { useState, type ReactNode } from "react";

export interface Slip {
  key: string;
  /** The slip's head line: the call in words, or the deed's number. */
  title: ReactNode;
  /** Label and value pairs, one line each. */
  lines: { k: string; v: ReactNode; tone?: "up" | "down" }[];
  /** A small stamp in the corner: the deed's status. */
  mark?: ReactNode;
  on?: boolean;
  onClick?: () => void;
  /** Shown inside the slip while it is picked. */
  actions?: ReactNode;
}

const FOLDED = 3;

export function Rack(p: { kind: "call" | "house"; title: string; summary: ReactNode; extra?: ReactNode; slips: Slip[]; footer?: ReactNode; tour?: string; label: string }) {
  const [all, setAll] = useState(false);
  const long = p.slips.length > FOLDED + 1;
  // Folded, the rack keeps its first few and the picked slip, wherever it is.
  const shown = !long || all ? p.slips : p.slips.filter((s, i) => i < FOLDED || s.on);
  const hidden = p.slips.length - shown.length;
  return (
    <section className={`rack rack-${p.kind}`} data-tour={p.tour} aria-label={p.label}>
      <div className="rack-head">
        <span className="rack-tag">{p.title}</span>
        <span className="rack-sum mono">{p.summary}</span>
        {p.extra && <span className="rack-extra mono">{p.extra}</span>}
      </div>
      <ul className="rack-list">
        {shown.map((s) => (
          <li key={s.key} className={`slip-li${s.on ? " on" : ""}`}>
            <div className="rk-slip">
              {s.onClick
                ? <button className="slip-main" aria-pressed={!!s.on} onClick={s.onClick}><SlipBody s={s} /></button>
                : <div className="slip-main"><SlipBody s={s} /></div>}
              {s.on && s.actions}
            </div>
          </li>
        ))}
        {long && (
          <li className="slip-li slip-more-li">
            <button className="slip-more" aria-expanded={all} onClick={() => setAll(!all)}>
              {all ? "Show fewer" : <>Show all {p.slips.length}<em>{hidden} more</em></>}
            </button>
          </li>
        )}
      </ul>
      {p.footer && <div className="rack-foot">{p.footer}</div>}
    </section>
  );
}

function SlipBody({ s }: { s: Slip }) {
  return <>
    <span className="slip-title">{s.title}</span>
    {s.lines.map((l) => <span key={l.k} className="slip-line"><span className="k">{l.k}</span><b className={`v mono${l.tone ? ` ${l.tone}` : ""}`}>{l.v}</b></span>)}
    {s.mark && <span className="slip-mark">{s.mark}</span>}
  </>;
}
