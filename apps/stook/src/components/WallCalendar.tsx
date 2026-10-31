// The coin's calendar: one page per month. Each day is one round of the coin's series; its address
// is derived from the series and the day, so the calendar reads exactly the
// month's rounds instead of scanning for them. A day can be funded up to 31
// days before its close, unless the coin has a house, which opens every day
// itself; past days keep what landed.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { PublicKey } from "@solana/web3.js";
import { stook } from "@sooth/sdk-solana";
import { useWallet } from "@solana/wallet-adapter-react";
import { useQuery } from "@tanstack/react-query";
import { useHoldings, useSeriesRounds } from "../hooks/useChain";
import { coinText } from "../lib/usd";
import { coinBySymbol, keyOf } from "../lib/coins";
import { fmtCompact, fmtPrice, untilText } from "../lib/format";
import { firstOpenableDay, nyDate, nyWhen } from "../lib/time";

interface LedgerDay { index: number; ladder: string; status: "settled" | "void"; bin: number | null; p0: string | null; expo: number | null; stepBps: number | null; closed: boolean }

interface Props {
  seriesKey: PublicKey;
  series: stook.SeriesAccount;
  now: number;
  minLeadSecs: number;
  dp: number;
  coinSymbol: string;
  canStart: boolean;
  onStart: (index: number) => void;
  /** The coin has a house: it opens every day, so no day is funded by hand.
   *  `null` while the house is still being read: no day offers funding yet. */
  house: boolean | null;
}

export function WallCalendar(p: Props) {
  // Days you hold something in wear a tab, as your calls and deposits do on
  // the round page: how many calls and how many house deposits.
  const { publicKey } = useWallet();
  const held = useHoldings(publicKey ?? null);
  const mine = useMemo(() => new Map((held.data ?? []).map((h) => [h.pubkey.toBase58(), { calls: h.positions.length, house: h.tranches.length }])), [held.data]);
  const [ty, tm, td] = nyDate(p.now).split("-").map(Number) as [number, number, number];
  const [offset, setOffset] = useState(0);            // months from the current one; back without end, ahead up to 2 (31 days ahead can reach two pages on)
  const m0 = new Date(Date.UTC(ty, tm - 1 + offset, 1));
  const year = m0.getUTCFullYear(), month = m0.getUTCMonth() + 1;
  const turn = (dir: 1 | -1) => setOffset((o) => Math.min(2, o + dir));

  const daysIn = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const first = stook.daysFromCivil(year, month, 1);
  const indices = useMemo(() => Array.from({ length: daysIn }, (_, i) => first + i), [first, daysIn]);
  const rounds = useSeriesRounds(p.seriesKey, indices);
  // A finished round is closed once nothing in it is owed, and its account is
  // gone; the ledger still has where it landed (infra/ledger, /days).
  const ledger = useQuery({
    queryKey: ["days", p.coinSymbol, first, first + daysIn - 1],
    queryFn: async () => { const r = await fetch(`/days?${new URLSearchParams({ coin: keyOf(coinBySymbol(p.coinSymbol) ?? { symbol: p.coinSymbol }), from: String(first), to: String(first + daysIn - 1) })}`); if (!r.ok) throw new Error(`days ${r.status}`); return new Map(((await r.json()).days as LedgerDay[]).map((d) => [d.index, d])); },
    staleTime: 5 * 60_000,
  });
  const today = stook.daysFromCivil(ty, tm, td);
  const cells: (number | null)[] = Array((first + 4) % 7).fill(null);
  for (let d = 1; d <= daysIn; d++) cells.push(d);
  while (cells.length % 7) cells.push(null);
  const now = BigInt(p.now);
  // A series part way through learning cannot open a day that locks before it has learned enough.
  const firstOpen = firstOpenableDay(p.series);
  // With a house, the next day it will open says so; the days after it wait their turn.
  const houseNext = p.house === true ? indices.find((i) => !rounds.data?.get(i) && stook.hasRound(p.series, i) && Number(stook.closeOf(p.series, i)) - p.now >= p.minLeadSecs) : undefined;

  return (
    <div className="house-cal">
      <header className="house-cal-head">
        <h3>{m0.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" })} <span className="dimmer">{year}</span></h3>
        <div className="house-cal-nav">
          {offset !== 0 && <button className="btn btn-sm btn-ghost" onClick={() => setOffset(0)}>Today</button>}
          <button className="btn btn-sm btn-ghost house-cal-arrow" onClick={() => turn(-1)} aria-label="Previous month">‹</button>
          <button className="btn btn-sm btn-ghost house-cal-arrow" onClick={() => turn(1)} disabled={offset >= 2} aria-label="Next month">›</button>
        </div>
      </header>
      <div className="house-cal-grid">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((w) => <div key={w} className="house-cal-dow">{w}</div>)}
        {cells.map((d, i) => {
          if (!d) return <div key={"b" + i} className="hc-cell hc-blank" aria-hidden="true" />;
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
          const gone = !r ? ledger.data?.get(index) : undefined;
          const state = !l ? "" : l.status === "open" ? (p.now < Number(l.locksAt) ? "trading" : "locked") : l.status === "seeding" ? (p.now < Number(l.opensAt) ? "funded" : p.now < Number(l.opensAt) + Number(stook.OPEN_WINDOW_SECS) && p.now < Number(l.locksAt) ? "opening" : "void soon") : l.status;
          const closesIn = offset === 0 && at > p.now && (!l || l.status === "open" || l.status === "seeding") && !early && !learning && !paused ? untilText(BigInt(at), p.now) : null;
          // Finished days are stamped, as a clerk would: settled, void, or
          // passed with no round; closed for a market holiday. Today and the
          // days ahead carry their facts instead.
          const stamped = l ? (l.status === "settled" ? "settled" : l.status === "void" ? "void" : null) : gone ? gone.status : past ? (noRound ? "closed" : "passed") : null;
          const landed = l && l.status === "settled" && l.settledBin !== null ? stook.binBounds(l.settledBin, l.p0, l.stepBps) : null;
          const goneLanded = gone && gone.status === "settled" && gone.bin !== null && gone.p0 && gone.stepBps ? stook.binBounds(gone.bin, BigInt(gone.p0), gone.stepBps) : null;
          const tagged = stamped && stamped !== "passed" ? stamped : state && !stamped ? state : "";
          // "closed" is kept for market holidays; a round past its trading is locked,
          // and once its bell has rung it is landing.
          const tagText = tagged === "locked" ? (p.now >= at ? "landing" : "locked") : tagged;
          const tagTone = tagged === "trading" ? "up" : tagged === "locked" || tagged === "opening" || tagged === "funded" ? "taxi" : tagged === "void" || tagged === "void soon" ? "down" : "";
          const held = r ? mine.get(r.pubkey.toBase58()) : undefined;
          const heldText = held ? [held.calls && `${held.calls} ${held.calls === 1 ? "call" : "calls"}`, held.house && `${held.house} ${held.house === 1 ? "deposit" : "deposits"}`].filter(Boolean).join(" · ") : "";
          const body = (
            <>
              <div className="hc-top"><span className="hc-num">{d}</span>{tagText && <span className={`hc-tag ${tagTone}`}>{tagText}</span>}</div>
              <div className="hc-mid">
                {stamped === "passed" && <span className="hc-sub hc-none">no round</span>}
                {goneLanded && <><b className="num">{fmtPrice(goneLanded[0], gone!.expo ?? -8, p.dp)}</b><span className="hc-sub">landed</span></>}
                {l && landed && <><b className="num">{fmtPrice(landed[0], l.p0Expo, p.dp)}</b><span className="hc-sub">landed</span></>}
                {l && !landed && <><b className="num" title={coinText(l.depositTotal, l.decimals, p.coinSymbol)}>{fmtCompact(l.depositTotal, l.decimals)}</b><span className="hc-sub">{l.curveSeq.toString()} trades</span></>}
                {!l && !past && !early && !learning && !paused && (p.house === false ? <span className="hc-fund">+ Fund it</span> : p.house && index === houseNext && <span className="hc-sub">the house opens it next</span>)}
                {early && p.house === false && <span className="hc-sub" title="A day can be funded up to 31 days ahead.">funding opens {nyWhen(terms.fundableFrom, { month: "short", day: "numeric" })}</span>}
                {learning && <span className="hc-sub" title="The coin is still learning how its price moves. This day locks before it has learned enough, so its round could not open.">too soon to open</span>}
                {paused && <span className="hc-sub">paused</span>}
              </div>
              {(closesIn || heldText) && <div className="hc-foot">
                {closesIn && <span className="hc-left">closes in {closesIn.replace(/ (d|h|min)\b/g, "$1")}</span>}
                {heldText && <span className="hc-mine" title={`You hold ${heldText} in this round`}>you: {heldText}</span>}
              </div>}
            </>
          );
          const cls = `hc-cell ${isToday ? "hc-today" : ""} ${l ? `hc-${l.status}` : gone ? `hc-${gone.status}` : past || early || learning || paused || p.house !== false ? "hc-quiet" : "hc-slot"}`;
          const key = `${year}-${month}-${d}`;
          if (r) return <Link key={key} to={`/m/${r.pubkey.toBase58()}`} className={cls}>{body}</Link>;
          if (past || early || learning || paused || p.house !== false) return <div key={key} className={cls}>{body}</div>;
          return <button key={key} className={cls} onClick={() => p.onStart(index)} disabled={!p.canStart}>{body}</button>;
        })}
      </div>
    </div>
  );
}
