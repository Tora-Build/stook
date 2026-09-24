// A wall calendar, the kind that hangs by the door of an office on the
// street: rings at the top, the month in large type, one page per month, and
// a page that turns. Each day is one round of the coin's series; its address
// is derived from the series and the day, so the calendar reads exactly the
// month's rounds instead of scanning for them. A day can be funded up to 31
// days before its close; past days keep what landed.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { PublicKey } from "@solana/web3.js";
import { stook } from "@sooth/sdk-solana";
import { useSeriesRounds } from "../hooks/useChain";
import { fmtAmount, fmtPrice, untilText } from "../lib/format";
import { firstOpenableDay, nyDate, nyWhen } from "../lib/time";

interface Props {
  seriesKey: PublicKey;
  series: stook.SeriesAccount;
  now: number;
  minLeadSecs: number;
  dp: number;
  coinSymbol: string;
  canStart: boolean;
  onStart: (index: number) => void;
}

export function WallCalendar(p: Props) {
  const [ty, tm, td] = nyDate(p.now).split("-").map(Number) as [number, number, number];
  const [offset, setOffset] = useState(0);            // months from the current one; −∞..+2 (31 days ahead can reach two pages on)
  const [turning, setTurning] = useState<{ dir: 1 | -1; phase: "out" | "in" } | null>(null);
  const m0 = new Date(Date.UTC(ty, tm - 1 + offset, 1));
  const year = m0.getUTCFullYear(), month = m0.getUTCMonth() + 1;
  // A wall calendar's page lifts up over the rings and folds away; the new
  // page is underneath and settles as the old one clears.
  const turn = (dir: 1 | -1) => {
    if (turning || offset + dir > 2) return;
    setTurning({ dir, phase: "out" });
    setTimeout(() => { setOffset((o) => o + dir); setTurning({ dir, phase: "in" }); setTimeout(() => setTurning(null), 320); }, 300);
  };

  const daysIn = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const first = stook.daysFromCivil(year, month, 1);
  const indices = useMemo(() => Array.from({ length: daysIn }, (_, i) => first + i), [first, daysIn]);
  const rounds = useSeriesRounds(p.seriesKey, indices);
  const today = stook.daysFromCivil(ty, tm, td);
  const cells: (number | null)[] = Array((first + 4) % 7).fill(null);
  for (let d = 1; d <= daysIn; d++) cells.push(d);
  while (cells.length % 7) cells.push(null);
  const now = BigInt(p.now);
  // A series part way through learning cannot open a day that locks before it has learned enough.
  const firstOpen = firstOpenableDay(p.series);

  return (
    <div className={`wallcal ${turning ? `turn-${turning.phase}-${turning.dir > 0 ? "fwd" : "back"}` : ""}`}>
      <div className="wc-rings" aria-hidden="true">{Array.from({ length: 9 }, (_, i) => <span key={i} />)}</div>
      <header className="wc-head">
        <button className="wc-arrow" onClick={() => turn(-1)} aria-label="Previous month">‹</button>
        <div className="wc-month"><span className="wc-mname">{m0.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" })}</span><span className="wc-year">{year}</span></div>
        <button className="wc-arrow" onClick={() => turn(1)} disabled={offset >= 2} aria-label="Next month">›</button>
      </header>
      <div className="wc-grid">
        {["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].map((w) => <div key={w} className="wc-dow">{w}</div>)}
        {cells.map((d, i) => {
          if (!d) return <div key={"b" + i} className="wc-cell wc-blank" />;
          const index = first + d - 1;
          const r = rounds.data?.get(index);
          // Dates only: the opening curve is worked out when a day is picked.
          const settlesAt = stook.closeOf(p.series, index);
          const terms = { fundable: p.series.active && stook.hasRound(p.series, index) && now + 900n <= settlesAt && settlesAt <= now + stook.MAX_LEAD_SECS, fundableFrom: settlesAt - stook.MAX_LEAD_SECS };
          const at = Number(settlesAt);
          const noRound = !stook.hasRound(p.series, index);
          const past = (at - p.now < p.minLeadSecs || noRound) && !r, isToday = index === today;
          const learning = !r && !past && firstOpen !== null && index < firstOpen;
          const paused = !r && !past && !learning && !p.series.active;
          const early = !r && !past && !learning && !paused && !terms.fundable;
          const l = r?.ladder;
          const state = !l ? "" : l.status === "open" ? (p.now < Number(l.locksAt) ? "trading" : "locked") : l.status === "seeding" ? (p.now < Number(l.opensAt) ? "funded" : p.now < Number(l.opensAt) + Number(stook.OPEN_WINDOW_SECS) && p.now < Number(l.locksAt) ? "opening" : "void soon") : l.status;
          const closesIn = offset === 0 && at > p.now && (!l || l.status === "open" || l.status === "seeding") && !early && !learning && !paused ? untilText(BigInt(at), p.now) : null;
          const landed = l && l.status === "settled" && l.settledBin !== null ? stook.binBounds(l.settledBin, l.p0, l.stepBps) : null;
          const body = (
            <>
              <div className="wc-top"><span className="wc-num">{d}</span>{state && <span className={`wc-state wc-state-${state === "void soon" ? "void" : state}`}>{state}</span>}</div>
              {l && landed && <div className="wc-info"><span className="mono">{fmtPrice(landed[0], l.p0Expo, p.dp)}</span><span className="wc-sub">landed</span></div>}
              {l && !landed && <div className="wc-info"><span className="mono">{fmtAmount(l.depositTotal, l.decimals, 0)} {p.coinSymbol}</span><span className="wc-sub">{l.curveSeq.toString()} trades</span></div>}
              {!l && !past && !early && !learning && !paused && <div className="wc-info wc-empty">Fund it</div>}
              {early && <div className="wc-info wc-sub" title="A day can be funded up to 31 days ahead.">funding opens {nyWhen(terms.fundableFrom, { weekday: "short", month: "short", day: "numeric" })}</div>}
              {learning && <div className="wc-info wc-sub" title="The coin is still learning how its price moves. This day locks before it has learned enough, so its round could not open.">too soon to open</div>}
              {paused && <div className="wc-info wc-sub">paused</div>}
              {past && !l && <span className="wc-stamp">{noRound ? "closed" : "passed"}</span>}
              {closesIn && <div className="wc-left">closes in {closesIn.replace(/ (d|h|min)\b/g, "$1")}</div>}
            </>
          );
          const cls = `wc-cell ${isToday ? "wc-today" : ""} ${l ? `wc-${l.status}` : past || early || learning || paused ? "wc-past" : "wc-open-slot"}`;
          const key = `${year}-${month}-${d}`;
          if (r) return <Link key={key} to={`/m/${r.pubkey.toBase58()}`} className={cls}>{body}</Link>;
          if (past || early || learning || paused) return <div key={key} className={cls}>{body}</div>;
          return <button key={key} className={cls} onClick={() => p.onStart(index)} disabled={!p.canStart}>{body}</button>;
        })}
      </div>
    </div>
  );
}
