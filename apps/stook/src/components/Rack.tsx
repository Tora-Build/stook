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

/** The rack is one line until opened: its tag, how many, what is in. Opened, the
 *  slips unfold under it in a box of their own that scrolls, so a long rack
 *  never pushes the ticket off the screen. A picked slip keeps it open; a
 *  finished round opens it, since that is when the slips carry what to claim.
 *  The footer (a claim button) stays outside the fold. */
export function Rack(p: { kind: "call" | "house"; title: string; summary: ReactNode; extra?: ReactNode; slips: Slip[]; footer?: ReactNode; tour?: string; label: string; startOpen?: boolean; more?: ReactNode }) {
  const [want, setWant] = useState(!!p.startOpen);
  const open = want || p.slips.some((s) => s.on);
  return (
    <section className={`rack rack-${p.kind}${open ? " rack-open" : ""}`} data-tour={p.tour} aria-label={p.label}>
      <button className="rack-head" aria-expanded={open} onClick={() => setWant(!open)}>
        <span className="rack-tag">{p.title}</span>
        <span className="rack-sum mono">{p.summary}</span>
        {p.extra && <span className="rack-extra mono">{p.extra}</span>}
        <span className="rack-caret" aria-hidden="true">{open ? "▾" : "▸"}</span>
      </button>
      <div className={`fold${open ? " fold-open" : ""}`}>
        <div className="fold-in">
          <ul className="rack-list">
            {p.slips.map((s) => (
              <li key={s.key} className={`slip-li${s.on ? " on" : ""}`}>
                <div className="rk-slip">
                  {s.onClick
                    ? <button className="slip-main" aria-pressed={!!s.on} onClick={s.onClick}><SlipBody s={s} /></button>
                    : <div className="slip-main"><SlipBody s={s} /></div>}
                  {s.on && s.actions}
                </div>
              </li>
            ))}
          </ul>
          {p.more && <div className="rack-more">{p.more}</div>}
        </div>
      </div>
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
