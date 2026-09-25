// A part of a paper ticket folded back under a crease: a line to open it,
// and the flap swinging down on the crease when it does (styles.css, .tp-fold).
import { useState, type ReactNode } from "react";

export function PaperFold({ label, children }: { label: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`tp-line tp-more-fold ${open ? "tp-line-open" : ""}`}>
      <button className="tp-row tp-row-btn" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span><span className="tp-caret" aria-hidden="true">{open ? "▾" : "▸"}</span>{label}</span>
      </button>
      <div className="tp-fold tp-fold-sub"><div className="tp-fold-in">{children}</div></div>
    </div>
  );
}
