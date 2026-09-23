// The market as a picture, the way a trader reads one: price up the side,
// time along the bottom. The last day of the anchor's price runs left to
// right up to now; the settlement moment sits at the right edge. The 64 bands
// are horizontal stripes across it all, and on the right the crowd's odds
// for each band are drawn as bars. Click a price level to draw a line there;
// drag up or down to draw a range. The shape you would buy is laid over the
// bars, at the payout it makes on every band.

import { useMemo, useRef, useState, type PointerEvent } from "react";
import { stook } from "@sooth/sdk-solana";
import { pct } from "../lib/format";

const { BINS } = stook;
const W = 960, H = 440, PAD = { l: 8, r: 70, t: 14, b: 26 };
const SPLIT = 0.66;                                  // share of width for the history
const plotH = H - PAD.t - PAD.b, plotW = W - PAD.l - PAD.r;
const histW = plotW * SPLIT, oddsX = PAD.l + histW + 6, oddsW = plotW - histW - 6;
const VISIBLE = 22;                                  // bands drawn at once

export type DrawMode = "line" | "range";

export interface ChartProps {
  curve: stook.Curve;
  p0: bigint;
  expo: number;
  stepBps: number;
  dp: number;
  shape: stook.Shape | null;
  onShape: (s: stook.Shape | null) => void;
  mode: DrawMode;
  height: number;
  live?: { price: bigint } | null;
  /** [unix seconds, price in display units] over the last day. */
  history?: [number, number][];
  settlesAt: bigint;
  now: number;
  settledBin?: number | null;
  disabled?: boolean;
  /** The viewer's own lines, drawn on the odds panel; clicking one selects it. */
  positions?: { key: string; shape: stook.Shape; shares: bigint; label: string }[];
  selected?: string | null;
  onSelect?: (key: string | null) => void;
}

export function Chart(p: ChartProps) {
  const svg = useRef<SVGSVGElement>(null);
  const [anchor, setAnchor] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  const probs = useMemo(() => Array.from({ length: BINS }, (_, i) => stook.price(p.curve, i)), [p.curve]);
  const maxProb = useMemo(() => probs.reduce((a, b) => (b > a ? b : a), 0n), [probs]);
  const scale = 10 ** p.expo;
  const step = p.stepBps / 10_000;
  const p0 = Number(p.p0) * scale;

  // The window of bands on screen: centred on where the price is now (or the
  // settled band), widened to include the drawn shape.
  const centreBin = p.settledBin ?? (p.live ? stook.binFor(p.live.price, p.p0, p.stepBps) : 32);
  let lo = Math.max(0, centreBin - VISIBLE / 2), hi = Math.min(BINS - 1, lo + VISIBLE - 1);
  if (p.shape) { const [a, z] = stook.shapeBins(p.shape); lo = Math.min(lo, a); hi = Math.max(hi, z); }
  const nVis = hi - lo + 1, bh = plotH / nVis;
  // log-price → y: band i spans [edge(i), edge(i+1)), equal height each
  const edge = (i: number) => p0 * Math.exp((i - BINS / 2) * step);
  const yOfBin = (i: number) => PAD.t + (hi - i) * bh;                       // top of band i
  const yOfPrice = (v: number) => { if (v <= 0 || !p0) return PAD.t + plotH; const k = Math.log(v / p0) / step + BINS / 2; return PAD.t + (hi + 1 - Math.min(hi + 1, Math.max(lo, k))) * bh; };
  const binAtY = (y: number) => Math.min(hi, Math.max(lo, hi - Math.floor((y - PAD.t) / bh)));

  const at = (e: PointerEvent<SVGSVGElement>) => { const r = svg.current!.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H }; };
  const down = (e: PointerEvent<SVGSVGElement>) => {
    const { x, y } = at(e); const i = binAtY(y);
    // On the odds panel, a click on one of your own lines selects it (to sell or collect).
    if (x >= oddsX && p.positions?.length) {
      const hit = p.positions.find((q) => stook.level(q.shape, i) > 0);
      if (hit) { p.onSelect?.(hit.key); p.onShape(null); return; }
    }
    if (p.disabled) return;
    p.onSelect?.(null);
    svg.current!.setPointerCapture(e.pointerId);
    if (p.mode === "line") { p.onShape(stook.tent(i, p.height)); return; }
    setAnchor(i); p.onShape(stook.band(i, i));
  };
  const move = (e: PointerEvent<SVGSVGElement>) => { const i = binAtY(at(e).y); setHover(i); if (anchor !== null) p.onShape(stook.band(Math.min(anchor, i), Math.max(anchor, i))); };
  const up = () => setAnchor(null);

  const s = p.shape;
  const levels = s ? Array.from({ length: BINS }, (_, i) => stook.level(s, i)) : null;

  // History: last day on the left, then the gap to settlement on the right.
  const hist = p.history ?? [];
  const t0 = hist.length ? hist[0]![0] : p.now - 86_400, tEnd = Math.max(Number(p.settlesAt), p.now + 60);
  const xOfT = (t: number) => PAD.l + ((t - t0) / (tEnd - t0)) * histW;
  const path = hist.length > 1 ? hist.map((q, i) => `${i ? "L" : "M"}${xOfT(q[0]).toFixed(1)},${yOfPrice(q[1]).toFixed(1)}`).join(" ") : "";
  const livePrice = p.live ? Number(p.live.price) * scale : hist.length ? hist[hist.length - 1]![1] : null;

  const fmt = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: p.dp, maximumFractionDigits: p.dp });
  const labelEvery = nVis > 16 ? 2 : 1;
  const hoverBox = hover !== null ? { range: hover === 0 ? `below ${fmt(edge(1))}` : hover === BINS - 1 ? `above ${fmt(edge(BINS - 1))}` : `${fmt(edge(hover))} – ${fmt(edge(hover + 1))}`, prob: pct(probs[hover]!), pays: levels ? levels[hover]! : null } : null;

  return (
    <div className="chart-wrap">
      <svg ref={svg} viewBox={`0 0 ${W} ${H}`} className={`chart ${p.disabled ? "chart-disabled" : `chart-${p.mode}`}`}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={() => { setHover(null); up(); }} role="img" aria-label="Price history with the crowd's odds per band">
        {/* band stripes */}
        {Array.from({ length: nVis }, (_, k) => { const i = lo + k; const inS = levels ? levels[i]! > 0 : false; return (
          <g key={i}>
            <rect x={PAD.l} y={yOfBin(i)} width={plotW} height={bh} className={`stripe ${i % 2 ? "stripe-alt" : ""} ${inS ? "stripe-in" : ""} ${p.settledBin === i ? "stripe-settled" : ""} ${hover === i ? "stripe-hover" : ""}`} />
            {(i - lo) % labelEvery === 0 && <text x={W - PAD.r + 6} y={yOfBin(i) + bh + 3} className="lbl">{fmt(edge(i))}</text>}
          </g>); })}
        {/* odds bars, right */}
        {Array.from({ length: nVis }, (_, k) => { const i = lo + k; const w = maxProb > 0n ? (Number(probs[i]!) / Number(maxProb)) * oddsW : 0; return (
          <rect key={"b" + i} x={oddsX} y={yOfBin(i) + 1} width={Math.max(1, w)} height={Math.max(1, bh - 2)} className={`bar ${levels && levels[i]! > 0 ? "bar-in" : ""} ${p.settledBin === i ? "bar-settled" : ""}`} />); })}
        {/* the shape's payout, as amber ticks on the odds panel */}
        {levels && s && Array.from({ length: nVis }, (_, k) => { const i = lo + k, lv = levels[i]!; if (!lv) return null; return (
          <rect key={"s" + i} x={oddsX} y={yOfBin(i) + 1} width={(lv / s.h) * oddsW} height={Math.max(1, bh - 2)} className="shape-bar" />); })}
        {/* your lines, on the odds panel */}
        {p.positions?.map((q) => { const [a, z] = stook.shapeBins(q.shape); if (z < lo || a > hi) return null; const top = Math.max(a, lo), bot = Math.min(z, hi); const sel = q.key === p.selected; return (
          <g key={q.key} className={`pos ${sel ? "pos-sel" : ""}`}>
            <rect x={oddsX} y={yOfBin(bot)} width={oddsW} height={(bot - top + 1) * bh} className="pos-box" />
            {Array.from({ length: bot - top + 1 }, (_, k) => { const i = top + k, lv = stook.level(q.shape, i); return lv ? <rect key={i} x={oddsX + oddsW - (lv / q.shape.h) * oddsW * 0.35} y={yOfBin(i) + 1} width={(lv / q.shape.h) * oddsW * 0.35} height={Math.max(1, bh - 2)} className="pos-lv" /> : null; })}
            <text x={oddsX + oddsW - 4} y={yOfBin(bot) + 12} textAnchor="end" className="lbl pos-lbl">{q.label}</text>
          </g>); })}
        {/* history */}
        <line x1={oddsX - 3} x2={oddsX - 3} y1={PAD.t} y2={PAD.t + plotH} className="line-p0" />
        {path && <path d={path} className="line-hist" />}
        {livePrice !== null && <>
          <line x1={PAD.l} x2={W - PAD.r} y1={yOfPrice(livePrice)} y2={yOfPrice(livePrice)} className="line-live" />
          <text x={PAD.l + 4} y={yOfPrice(livePrice) - 4} className="lbl lbl-live">now {fmt(livePrice)}</text>
        </>}
        {p0 > 0 && <text x={oddsX - 8} y={yOfPrice(p0) + 12} textAnchor="end" className="lbl lbl-p0">opened at {fmt(p0)}</text>}
        {/* time axis */}
        <line x1={xOfT(p.now)} x2={xOfT(p.now)} y1={PAD.t} y2={PAD.t + plotH} className="line-now" />
        <text x={PAD.l} y={H - 8} className="lbl">{new Date(t0 * 1000).toLocaleTimeString("en-US", { hour: "numeric" })}</text>
        <text x={xOfT(p.now)} y={H - 8} className="lbl" textAnchor="middle">now</text>
        <text x={PAD.l + histW} y={H - 8} className="lbl lbl-live" textAnchor="end">settles {new Date(Number(p.settlesAt) * 1000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</text>
        <text x={oddsX + oddsW / 2} y={H - 8} className="lbl" textAnchor="middle">the crowd's odds</text>
      </svg>
      <div className="chart-hover">
        {hoverBox ? (<><span className="mono">{hoverBox.range}</span><span>{hoverBox.prob} chance</span>{hoverBox.pays !== null && <span className="amber">{hoverBox.pays ? `pays ${hoverBox.pays}×` : "pays nothing"}</span>}</>)
          : (<span className="muted">{p.disabled ? "Trading is closed." : p.mode === "line" ? "Click the price you expect at settlement." : "Drag up or down across the range you expect."}</span>)}
      </div>
    </div>
  );
}
