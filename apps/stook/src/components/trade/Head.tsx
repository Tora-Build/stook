// The top of the chart card: what the round asks, the price now and its move
// since the open, and the one clock that matters for the phase it is in.
import { useState, type ReactNode } from "react";
import { useNow } from "../../hooks/useNow";

const hms = (t: number) => { t = Math.max(0, Math.floor(t)); const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60; return (h ? `${h}:${String(m).padStart(2, "0")}` : `${m}`) + ":" + String(s).padStart(2, "0"); };

export interface HeadClock {
  /** Counts down to this unix time; or shows `word` instead. */
  to?: number;
  word?: string;
  label: string;
}

export function TradeHead(p: {
  logo?: string; mono: string; question: ReactNode;
  price: string | null; priceSmall?: boolean; priceLabel?: string; change: { text: string; up: boolean } | null;
  meta: ReactNode; clock: HeadClock;
  note?: { short: string; full: string } | null;
  onHelp?: (() => void) | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <header className="th">
      <div className="th-logo" aria-hidden="true">{p.logo ? <img src={p.logo} alt="" /> : <span>{p.mono.slice(0, 4)}</span>}</div>
      <div className="th-main">
        <h1 className="th-q">{p.question}</h1>
        <div className="th-p">
          {p.priceLabel && <span className="th-pl">{p.priceLabel}</span>}
          <b className={`num${p.priceSmall ? " sm" : ""}`}>{p.price ?? "…"}</b>
          {p.change && <span className={`th-ch ${p.change.up ? "up" : "down"}`}>{p.change.up ? "▲" : "▼"} {p.change.text}</span>}
        </div>
        <div className="th-meta">
          {p.meta}
          {p.note && <button className="th-note" onClick={() => setOpen(!open)} aria-expanded={open} title={p.note.full}><i aria-hidden="true">i</i>{p.note.short}</button>}
          {p.onHelp && <button className="th-help" onClick={p.onHelp} aria-label="How it works, show the guide again" title="How it works">?</button>}
        </div>
        {open && p.note && <p className="th-note-full" role="note">{p.note.full}</p>}
      </div>
      <Clock {...p.clock} />
    </header>
  );
}

/** The only part of the card that ticks every second. */
function Clock(p: HeadClock) {
  const now = useNow();
  const big = p.to !== undefined ? hms(p.to - now) : p.word ?? "";
  return (
    <div className="th-clock" role="timer" aria-live="off">
      <span className="count">{big}</span>
      <span className="th-cl">{p.label}</span>
    </div>
  );
}
