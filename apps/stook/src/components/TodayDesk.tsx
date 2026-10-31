// The coin page's today card: what today's round is doing, a countdown to its
// next moment (trading stops, then the bell), its pool, and the one thing to
// do about it. What sits beside it (the anchor's last 24 hours) comes in
// `side`; the days ahead are on the calendar below.
import { useMemo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { PublicKey } from "@solana/web3.js";
import { stook } from "@sooth/sdk-solana";
import { useSeriesRounds } from "../hooks/useChain";
import { fmtPrice } from "../lib/format";
import { nyDate, nyWhen } from "../lib/time";
import { approxUsd, coinText, useUsdRates } from "../lib/usd";

interface Props {
  seriesKey: PublicKey;
  series: stook.SeriesAccount;
  now: number;
  minLeadSecs: number;
  dp: number;
  coinSymbol: string;
  anchorName: string;
  canStart: boolean;
  onStart: (index: number) => void;
  /** The coin has a house: it opens every round, nobody funds one by hand.
   *  `null` while the house is still being read. */
  house: boolean | null;
  /** The house read failed (it keeps trying). */
  houseError?: boolean;
  /** What sits beside today's card. */
  side?: ReactNode;
}

/** The last day whose bell has rung, then the next `n` days with a round
 *  whose close is still ahead, from `now`. */
function upcoming(s: stook.SeriesAccount, now: number, n: number): number[] {
  const last = stook.indexAtOrBefore(s, BigInt(now));
  const out: number[] = [last];
  for (let i = last + 1; out.length < n + 1 && i < last + 60; i++) if (stook.hasRound(s, i)) out.push(i);
  return out;
}

/** 7:58:12, or 2d 4h past a day. */
function clock(secs: number): string {
  if (secs <= 0) return "0:00:00";
  if (secs >= 86_400) return `${Math.floor(secs / 86_400)}d ${Math.floor((secs % 86_400) / 3600)}h`;
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const hm = (t: number | bigint) => nyWhen(t, { hour: "numeric", minute: "2-digit" });

export function TodayDesk(p: Props) {
  const days = useMemo(() => upcoming(p.series, p.now - (p.now % 60), 2), [p.series, Math.floor(p.now / 60)]); // eslint-disable-line react-hooks/exhaustive-deps
  const rounds = useSeriesRounds(p.seriesKey, days);
  const rate = useUsdRates().data?.[p.coinSymbol] ?? null;
  // A round past its bell but not settled yet stays on the card until it
  // settles: people waiting for its result come here for it.
  const last = days[0], lr = last !== undefined ? rounds.data?.get(last)?.ladder : undefined;
  const pending = !!lr && lr.status === "open";
  const [today, nextDay] = pending ? days : days.slice(1);
  if (today === undefined) return null;
  const r = rounds.data?.get(today), l = r?.ladder;
  const closes = Number(stook.closeOf(p.series, today));
  const fundable = (i: number) => { const at = stook.closeOf(p.series, i); return p.canStart && at - BigInt(p.now) >= BigInt(p.minLeadSecs) && at <= BigInt(p.now) + stook.MAX_LEAD_SECS; };
  const when = (i: number) => nyWhen(stook.closeOf(p.series, i), { weekday: "short", month: "short", day: "numeric" });
  const go = r ? `/m/${r.pubkey.toBase58()}` : "";

  // What today's round is doing, and the one thing to do about it.
  let tag: string, title: string, line = "", cta: { label: string; to?: string; start?: number } | null, tone = "";
  if (l && l.status === "open" && p.now >= closes) {
    tag = "Landing"; title = "Waiting for the result";
    line = "The bell has rung. Payouts open when it lands.";
    cta = { label: "See the round", to: go };
  } else if (l && l.status === "open" && p.now < Number(l.locksAt)) {
    tag = "Live"; tone = "live"; title = "Trading now";
    cta = { label: "Call today's close", to: go };
  } else if (l && l.status === "open") {
    tag = "Trading closed"; title = "Waiting for the bell";
    cta = { label: "Watch the bell", to: go };
  } else if (l && l.status === "seeding") {
    tag = "Funded"; title = p.now < Number(l.opensAt) ? `Opens ${hm(l.opensAt)} NY` : "Opening";
    line = "Trading starts when it opens.";
    cta = { label: "See the round", to: go };
  } else if (l && l.status === "settled") {
    const b = l.settledBin !== null ? stook.binBounds(l.settledBin, l.p0, l.stepBps) : null;
    tag = "Settled"; title = b ? `Landed at ${fmtPrice(b[0], l.p0Expo, p.dp)}` : "Settled";
    line = nextDay !== undefined ? (p.house ? `The house rolls into ${when(nextDay)}.` : `Next round: ${when(nextDay)}.`) : "";
    cta = { label: "Collect or look back", to: go };
  } else if (l) {
    tag = "Void"; tone = "down"; title = "No round today"; line = "Deposits come back first.";
    cta = { label: "Collect a refund", to: go };
  } else if (!rounds.data || p.house === null) {
    tag = "Today"; title = p.houseError && rounds.data ? "Can't read the house" : "Reading the round";
    line = p.houseError && rounds.data ? "Trying again." : ""; cta = null;
  } else if (p.house) {
    tag = "Today"; title = "The house opens this round soon";
    cta = { label: "Back the house", to: "#house" };
  } else if (fundable(today)) {
    tag = "Open to fund"; title = "Nobody has opened today"; line = "Fund it and it opens a minute later.";
    cta = { label: "Fund today's round", start: today };
  } else {
    tag = "Today"; title = "Too late to start";
    line = nextDay !== undefined ? `Next round: ${when(nextDay)}.` : "";
    cta = nextDay !== undefined && fundable(nextDay) ? { label: `Fund ${when(nextDay)}`, start: nextDay } : null;
  }
  // The next moment: trading stops, then the bell.
  const trading = l && l.status === "open" && p.now < Number(l.locksAt);
  const target = trading ? Number(l!.locksAt) : closes;
  const counting = target > p.now && (!l || l.status === "open" || l.status === "seeding");

  return (
    <section className="card house-today" aria-label="The current round">
      <div className="house-today-main">
        <div className="house-today-top">
          {tag !== "Today" && <span className={`tag2 ${tone === "live" ? "live" : ""} ${tone === "down" ? "house-tag-down" : ""}`}>{tag}</span>}
          <span className="label">{nyDate(closes) === nyDate(p.now) ? "Today · " : ""}{nyWhen(closes, { weekday: "short", month: "short", day: "numeric" })}</span>
        </div>
        <h2 className="house-today-title">{title}</h2>
        {counting && <div className="house-today-count">
          <span className="label">{trading ? "Trading stops in" : "Bell in"}</span>
          <span className="count" aria-live="off">{clock(target - p.now)}</span>
        </div>}
        <div className="house-today-times">
          {l && l.status === "open" && <span><b>{hm(l.locksAt)}</b> trading stops</span>}
          <span><b>{hm(closes)}</b> the bell, NY</span>
        </div>
        {l && <div className="house-today-nums">
          <div><span className="label">Pool</span><b className="num">{rate !== null ? approxUsd(l.depositTotal, l.decimals, rate).replace("≈ ", "") : coinText(l.depositTotal, l.decimals, p.coinSymbol)}</b>{rate !== null && <small className="dimmer">{coinText(l.depositTotal, l.decimals, p.coinSymbol)}</small>}</div>
          <div><span className="label">Trades</span><b className="num">{l.curveSeq.toString()}</b></div>
        </div>}
        {line && <p className="house-today-line">{line}</p>}
        {cta && <div className="house-today-cta">
          {cta.to?.startsWith("#") ? <a className="btn btn-sm btn-ghost" href={cta.to}>{cta.label}</a>
            : cta.to ? <Link className="btn btn-sm" to={cta.to}>{cta.label}</Link>
            : <button className="btn btn-sm" onClick={() => p.onStart(cta!.start!)}>{cta.label}</button>}
        </div>}
      </div>
      {p.side && <div className="house-today-side">{p.side}</div>}
    </section>
  );
}
