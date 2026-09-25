// What you already hold in this round, as a folder on the desk: a tab with
// the kind (calls or house), the total on the fold, the entries inside.
// The same look for both tabs, so earlier trades never read like the order
// ticket you are filling in now.
import { useState, type ReactNode } from "react";

export interface BookRow { key: string; label: ReactNode; amount: ReactNode; sub?: ReactNode; on?: boolean; onClick?: () => void }

export function Book(p: { kind: "call" | "house"; title: string; count: number; total: ReactNode; extra?: ReactNode; rows: BookRow[]; open?: boolean; footer?: ReactNode; onFold?: () => void }) {
  const [open, setOpen] = useState(false);
  const shown = open || !!p.open;
  return (
    <div className={`book book-${p.kind}`}>
      {/* Folding the book puts back whatever was picked from it. */}
      <button className="book-head" onClick={() => { if (shown) p.onFold?.(); setOpen(!shown); }} aria-expanded={shown}>
        <span className="book-tab">{p.title}<i>{p.count}</i></span>
        <span className="book-total mono">{p.total}</span>
        {p.extra && <span className="book-extra mono">{p.extra}</span>}
        <span className="book-caret" aria-hidden="true">{shown ? "▾" : "▸"}</span>
      </button>
      {shown && <ul className="book-rows">
        {p.rows.map((r) => {
          const body = <><span className="book-label">{r.label}{r.sub && <em>{r.sub}</em>}</span><span className="book-amt mono">{r.amount}</span></>;
          return <li key={r.key}>{r.onClick ? <button className={r.on ? "on" : ""} onClick={r.onClick}>{body}</button> : <div>{body}</div>}</li>;
        })}
      </ul>}
      {p.footer && <div className="book-foot">{p.footer}</div>}
    </div>
  );
}
