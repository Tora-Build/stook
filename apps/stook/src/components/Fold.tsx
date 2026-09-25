// Anything that opens and closes folds like the paper tickets do: while shut
// it shows a folded edge; opening, it swings down on that edge and lies flat,
// leaving no crease (styles.css, .fold). The contents stay mounted, so the
// motion has something to show.
import type { ReactNode } from "react";

export function Fold({ open, children }: { open: boolean; children: ReactNode }) {
  return <div className={`fold ${open ? "fold-open" : ""}`} aria-hidden={!open}><div className="fold-in">{children}</div></div>;
}
