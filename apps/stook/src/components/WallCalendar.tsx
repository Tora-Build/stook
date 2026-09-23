// A wall calendar, the kind that hangs by the door of an office on the
// street: rings at the top, the month in large type, one page per month, and
// a page that turns. Each day is a round. The current month opens by
// default; the next month can be started early; past months keep what
// landed.
import { useState } from "react";
import { Link } from "react-router-dom";
import { stook } from "@sooth/sdk-solana";
import type { LadderRow } from "../lib/chain";
import { fmtAmount, fmtPrice } from "../lib/format";

interface Props {
  rounds: LadderRow[];
  now: number;
  /** Unix seconds of the settlement for a New York calendar day (y, m0, d). */
  settleOf: (y: number, m0: number, d: number) => number;
  minLeadSecs: number;
  dp: number;
  coinSymbol: string;
  canStart: boolean;
  onStart: (settlesAt: number) => void;
}

const nyDate = (t: number) => new Date(t * 1000).toLocaleDateString("en-CA", { timeZone: "America/New_York" });

export function WallCalendar(p: Props) {
  const nyNow = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const [offset, setOffset] = useState(0);            // months from the current one; −∞..+1
  const [flip, setFlip] = useState<"next" | "prev" | null>(null);
  const m0 = new Date(nyNow.getFullYear(), nyNow.getMonth() + offset, 1);
  const turn = (dir: 1 | -1) => { if (offset + dir > 1) return; setFlip(dir > 0 ? "next" : "prev"); setTimeout(() => { setOffset((o) => o + dir); setFlip(null); }, 380); };

  const byDay = new Map<string, LadderRow>();
  for (const r of p.rounds) byDay.set(nyDate(Number(r.ladder.settlesAt)), r);
  const todayKey = nyDate(p.now);
  const daysIn = new Date(m0.getFullYear(), m0.getMonth() + 1, 0).getDate();
  const cells: (number | null)[] = Array(new Date(m0.getFullYear(), m0.getMonth(), 1).getDay()).fill(null);
  for (let d = 1; d <= daysIn; d++) cells.push(d);
  while (cells.length % 7) cells.push(null);

  return (
    <div className={`wallcal ${flip ? `flip-${flip}` : ""}`}>
      <div className="wc-rings" aria-hidden="true">{Array.from({ length: 9 }, (_, i) => <span key={i} />)}</div>
      <header className="wc-head">
        <button className="wc-arrow" onClick={() => turn(-1)} aria-label="Previous month">‹</button>
        <div className="wc-month"><span className="wc-mname">{m0.toLocaleDateString("en-US", { month: "long" })}</span><span className="wc-year">{m0.getFullYear()}</span></div>
        <button className="wc-arrow" onClick={() => turn(1)} disabled={offset >= 1} aria-label="Next month">›</button>
      </header>
      <div className="wc-grid">
        {["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].map((w) => <div key={w} className="wc-dow">{w}</div>)}
        {cells.map((d, i) => {
          if (!d) return <div key={"b" + i} className="wc-cell wc-blank" />;
          const key = `${m0.getFullYear()}-${String(m0.getMonth() + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
          const r = byDay.get(key), at = p.settleOf(m0.getFullYear(), m0.getMonth(), d);
          const past = at - p.now < p.minLeadSecs && !r, isToday = key === todayKey;
          const l = r?.ladder;
          const state = !l ? (past ? "" : "start") : l.status === "open" ? (p.now < Number(l.locksAt) ? "trading" : "locked") : l.status === "seeding" ? "opening" : l.status;
          const landed = l && l.status === "settled" && l.settledBin !== null ? stook.binBounds(l.settledBin, l.p0, l.stepBps) : null;
          const body = (
            <>
              <div className="wc-top"><span className="wc-num">{d}</span>{state && <span className={`wc-state wc-state-${state}`}>{state}</span>}</div>
              {l && landed && <div className="wc-info"><span className="mono">{fmtPrice(landed[0], l.p0Expo, p.dp)}</span><span className="wc-sub">landed</span></div>}
              {l && !landed && <div className="wc-info"><span className="mono">{fmtAmount(l.depositTotal, l.decimals, 0)} {p.coinSymbol}</span><span className="wc-sub">{l.curveSeq.toString()} trades</span></div>}
              {!l && !past && <div className="wc-info wc-empty">nobody yet</div>}
            </>
          );
          const cls = `wc-cell ${isToday ? "wc-today" : ""} ${l ? `wc-${l.status}` : past ? "wc-past" : "wc-open-slot"}`;
          if (r) return <Link key={key} to={`/m/${r.pubkey.toBase58()}`} className={cls}>{body}</Link>;
          if (past) return <div key={key} className={cls}>{body}</div>;
          return <button key={key} className={cls} onClick={() => p.onStart(at)} disabled={!p.canStart}>{body}</button>;
        })}
      </div>
    </div>
  );
}
