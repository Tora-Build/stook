// One open call, as a card: the round it is in, the call drawn as a strip of
// floors with the price now marked, and what it cost, is worth and pays.
import { Link } from "react-router-dom";
import { stook } from "@sooth/sdk-solana";
import type { Holding } from "../../lib/chain";
import { anchorOf, coinByMint } from "../../lib/coins";
import { feedByHex, feedHex } from "../../lib/feeds";
import { useLivePrice } from "../../hooks/useChain";
import { coinText, fmtUsd, toUsd } from "../../lib/usd";
import { nyWhen } from "../../lib/time";
import { clock } from "../home/Hero";
import { STAGE_TEXT, floorWords, stageOf, type Line } from "./model";

const fmtPx = (v: number, dp: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
const LAST = stook.BINS - 1;

export function CallCard({ h, line, now, rate }: { h: Holding; line: Line; now: number; rate: number | null }) {
  const l = h.ladder, coin = coinByMint(l.quoteMint), feed = feedByHex(feedHex(l.feedId));
  const dp = coin ? anchorOf(coin).dp : feed.dp;
  const stage = stageOf(l, now);
  const live = useLivePrice(l.p0 > 0n ? l.feedId : null).data;
  const sym = coin ? `$${coin.symbol}` : "";
  const dec = l.decimals;
  const shape = line.shape!;
  const best = line.size * BigInt(shape.h);
  const gain = line.value !== null ? line.value - line.cost : null;
  const money = (u: bigint) => (rate !== null ? fmtUsd(toUsd(u, dec, rate)) : coinText(u, dec, sym));
  const sub = (u: bigint) => (rate !== null ? coinText(u, dec, sym) : null);

  // The floor the price is on now, from the round's own grid.
  let nowBin: number | null = null, nowPx: number | null = null;
  if (live && l.p0 > 0n) {
    nowPx = Number(live.price) * 10 ** live.expo;
    try { nowBin = stook.binFor(BigInt(Math.round(nowPx / 10 ** l.p0Expo)), l.p0, l.stepBps); } catch { nowBin = null; }
  }
  const lo = Math.max(0, shape.lo), hi = Math.min(LAST, shape.hi);
  const inside = nowBin !== null && nowBin >= lo && nowBin <= hi;
  const away = nowBin === null ? null : nowBin < lo ? lo - nowBin : nowBin > hi ? nowBin - hi : 0;
  const where = nowBin === null ? null
    : inside ? (shape.h > 1 ? (nowBin === (shape.lo + shape.hi) / 2 ? "Right on your floor" : "Inside your range") : "Inside your range")
    : `${away} ${away === 1 ? "floor" : "floors"} ${nowBin! < lo ? "below" : "above"} your range`;

  const [until, what] = stage === "trading" ? [Number(l.locksAt), "left to sell"] : stage === "locked" ? [Number(l.settlesAt), "to the bell"] : [null, stage === "settling" ? "settling now" : ""];
  const to = `/m/${h.pubkey.toBase58()}`;

  return (
    <article className={`card yours-call ${inside ? "yours-call-in" : ""}`}>
      <header className="yours-call-head">
        {coin && <span className="yours-logos" aria-hidden="true"><img className="yours-logo-a" src={coin.anchor.logo} alt="" /><img className="yours-logo-c" src={coin.logo} alt="" /></span>}
        <div className="yours-call-id">
          <b>{coin ? anchorOf(coin).name : feed.name} <span className="dimmer">in {sym}</span></b>
          <span className="dimmer"><span className="yours-hide-sm">{nyWhen(l.settlesAt, { weekday: "short" })}, </span>{nyWhen(l.settlesAt, { month: "short", day: "numeric" })} · bell {nyWhen(l.settlesAt, { hour: "numeric", minute: "2-digit" })}<span className="yours-hide-sm"> New York</span></span>
        </div>
        <span className={`yours-stage yours-stage-${stage.replace(" ", "-")}`}>{STAGE_TEXT[stage]}</span>
      </header>

      <div className="yours-call-name">{floorWords(line.what)}</div>

      {l.p0 > 0n && <Strip shape={shape} nowBin={nowBin} lo={lo} hi={hi} p0={l.p0} expo={l.p0Expo} stepBps={l.stepBps} dp={dp} nowPx={nowPx} landed={l.settledBin} />}
      {where !== null ? <div className={`yours-call-where ${inside ? "up" : ""}`}>{where}</div>
        : l.p0 > 0n && <div className="yours-call-where" aria-busy="true" aria-label="Reading the price"><i className="yours-skel-line" /></div>}

      <dl className="yours-call-nums">
        <div><dt>Paid</dt><dd>{money(line.cost)}</dd>{sub(line.cost) && <small>{sub(line.cost)}</small>}</div>
        <div><dt>Worth now</dt>{line.value !== null
          ? <><dd className={gain! >= 0n ? "up" : "down"}>{money(line.value)}</dd><small className={gain! >= 0n ? "up" : "down"}>{gain! >= 0n ? "+" : "−"}{money(gain! >= 0n ? gain! : -gain!)}</small></>
          : <><dd className="dimmer">Held</dd><small>to the bell</small></>}</div>
        <div><dt>If it lands</dt><dd className="taxi">{money(best)}</dd><small>{shape.h > 1 ? "on your floor, less away from it" : "anywhere in the range"}</small></div>
      </dl>

      <footer className="yours-call-foot">
        {until !== null ? <span className="yours-clock"><span className="count">{clock(until - now)}</span><span className="dimmer">{what}</span></span> : <span className="dimmer yours-clock-word">{what}</span>}
        <Link className={stage === "trading" ? "btn btn-sm" : "btn btn-sm btn-ghost"} to={to}>{stage === "trading" ? "Sell or add" : "Open the round"} <span aria-hidden="true">→</span></Link>
      </footer>
    </article>
  );
}

/** The call as a little street of floors, low prices on the left: the floors
 *  it pays on stand tall and gold (a "near" call tallest at its centre), and
 *  a thin blue line marks the floor the price is on now. */
function Strip({ shape, nowBin, lo, hi, p0, expo, stepBps, dp, nowPx, landed }: {
  shape: stook.Shape; nowBin: number | null; lo: number; hi: number; p0: bigint; expo: number; stepBps: number; dp: number; nowPx: number | null; landed: number | null;
}) {
  // The window: the call with two floors either side, stretched to take in
  // the price now while that stays readable.
  let a = lo - 2, b = hi + 2;
  if (nowBin !== null) { if (nowBin < a && b - nowBin <= 26) a = nowBin - 1; if (nowBin > b && nowBin - a <= 26) b = nowBin + 1; }
  a = Math.max(0, a); b = Math.min(LAST, b);
  const n = b - a + 1, W = 8, H = 36;
  const lvl = (i: number) => Math.max(0, shape.h - (shape.h > 1 ? Math.abs(i - (shape.lo + shape.hi) / 2) : 0));
  const off = nowBin === null ? null : nowBin < a ? "left" : nowBin > b ? "right" : null;
  const edge = (i: number, side: 0 | 1) => stook.binBounds(i, p0, stepBps)[side] * 10 ** expo;
  const nowX = nowBin !== null && !off ? ((nowBin - a + 0.5) / n) * 100 : null;
  return (
    <div className="yours-strip">
      {nowX !== null && nowPx !== null && <span className="yours-strip-now" style={{ left: `${Math.min(88, Math.max(12, nowX))}%` }}>Now {fmtPx(nowPx, dp)}</span>}
      <svg viewBox={`0 0 ${n * W} ${H}`} preserveAspectRatio="none" shapeRendering="crispEdges" aria-hidden="true">
        {Array.from({ length: n }, (_, k) => {
          const i = a + k, x = k * W, on = i >= lo && i <= hi, v = on ? lvl(i) : 0;
          const tall = on ? 12 + Math.round((v / shape.h) * 20) : 6;
          const isLanded = i === landed;
          return (
            <g key={i}>
              <rect x={x + 1} y={H - tall} width={W - 2} height={tall} className={on ? "yours-strip-on" : "yours-strip-off"} />
              {on && Array.from({ length: Math.floor((tall - 4) / 4) }, (_, r) => <rect key={r} x={x + 3} y={H - tall + 2 + r * 4} width={2} height={2} className="yours-strip-win" />)}
              {isLanded && <rect x={x} y={0} width={W} height={H} className="yours-strip-land" />}
            </g>
          );
        })}
        {nowBin !== null && !off && <g className="yours-strip-pin">
          <line x1={(nowBin - a) * W + W / 2} x2={(nowBin - a) * W + W / 2} y1={2} y2={H} vectorEffect="non-scaling-stroke" />
          <rect x={(nowBin - a) * W + 1} y={0} width={W - 2} height={2} />
        </g>}
      </svg>
      <div className="yours-strip-axis">
        <span>{off === "left" ? "◂ now lower" : fmtPx(edge(Math.max(a, 1), 0), dp)}</span>
        <span className="taxi">{fmtPx(edge(Math.max(lo, 1), 0), dp)} to {hi >= LAST ? "up" : fmtPx(edge(hi, 1), dp)}</span>
        <span>{off === "right" ? "now higher ▸" : b >= LAST ? "" : fmtPx(edge(b, 1), dp)}</span>
      </div>
    </div>
  );
}
