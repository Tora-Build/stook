// The market as a picture: 64 bars, one per price band, each as tall as the
// crowd's belief. Draw on it — a click is a line (a tent centred there), a
// drag is a range (a band) — and the shape you would be buying is laid over
// the bars, with the payout it makes at every band.

import { useMemo, useRef, useState, type PointerEvent } from "react";
import { stook } from "@sooth/sdk-solana";
import { fmtPrice, pct } from "../lib/format";

const { BINS } = stook;
const W = 960, H = 320, PAD = { l: 8, r: 8, t: 28, b: 34 };
const plotW = W - PAD.l - PAD.r, plotH = H - PAD.t - PAD.b;
const bw = plotW / BINS;
const xOf = (i: number) => PAD.l + i * bw;

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
  settledBin?: number | null;
  disabled?: boolean;
}

/** Fractional x of a raw price on the log grid. */
function xOfPrice(price: bigint, p0: bigint, stepBps: number): number {
  const k = Math.log(Number(price) / Number(p0)) / (stepBps / 10_000);
  return PAD.l + Math.min(BINS, Math.max(0, BINS / 2 + k)) * bw;
}

export function Chart(p: ChartProps) {
  const svg = useRef<SVGSVGElement>(null);
  const [anchor, setAnchor] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  const probs = useMemo(() => Array.from({ length: BINS }, (_, i) => stook.price(p.curve, i)), [p.curve]);
  const maxProb = useMemo(() => probs.reduce((a, b) => (b > a ? b : a), 0n), [probs]);
  const yOf = (prob: bigint) => PAD.t + plotH - (maxProb > 0n ? (Number(prob) / Number(maxProb)) * plotH : 0);

  const binAt = (e: PointerEvent<SVGSVGElement>): number => {
    const r = svg.current!.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    return Math.min(BINS - 1, Math.max(0, Math.floor((x - PAD.l) / bw)));
  };

  const down = (e: PointerEvent<SVGSVGElement>) => {
    if (p.disabled) return;
    const i = binAt(e);
    svg.current!.setPointerCapture(e.pointerId);
    if (p.mode === "line") { p.onShape(stook.tent(i, p.height)); return; }
    setAnchor(i);
    p.onShape(stook.band(i, i));
  };
  const move = (e: PointerEvent<SVGSVGElement>) => {
    const i = binAt(e);
    setHover(i);
    if (anchor !== null) p.onShape(stook.band(Math.min(anchor, i), Math.max(anchor, i)));
  };
  const up = () => setAnchor(null);

  const s = p.shape;
  const levels = s ? Array.from({ length: BINS }, (_, i) => stook.level(s, i)) : null;
  const inShape = (i: number) => !!levels && levels[i]! > 0;

  // Tick every 8 bins, labelled with the band's lower edge.
  const ticks = [0, 8, 16, 24, 32, 40, 48, 56, 63];
  const label = (i: number) => {
    const [lo] = stook.binBounds(i, p.p0, p.stepBps);
    return i === 0 ? "…" : fmtPrice(lo, p.expo, p.dp);
  };

  const hoverBox = hover !== null ? (() => {
    const [lo, hi] = stook.binBounds(hover, p.p0, p.stepBps);
    const range = hover === 0 ? `below ${fmtPrice(hi, p.expo, p.dp)}` : hover === BINS - 1 ? `above ${fmtPrice(lo, p.expo, p.dp)}` : `${fmtPrice(lo, p.expo, p.dp)} – ${fmtPrice(hi, p.expo, p.dp)}`;
    return { range, prob: pct(probs[hover]!), pays: levels ? levels[hover]! : null };
  })() : null;

  return (
    <div className="chart-wrap">
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        className={`chart ${p.disabled ? "chart-disabled" : `chart-${p.mode}`}`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerLeave={() => { setHover(null); up(); }}
        role="img"
        aria-label="Probability of each price band"
      >
        {/* bars */}
        {probs.map((prob, i) => (
          <rect
            key={i}
            x={xOf(i) + 1}
            y={yOf(prob)}
            width={bw - 2}
            height={PAD.t + plotH - yOf(prob)}
            className={`bar ${inShape(i) ? "bar-in" : ""} ${p.settledBin === i ? "bar-settled" : ""} ${hover === i ? "bar-hover" : ""}`}
          />
        ))}
        {/* the shape's payout profile, as a stepped line over the bars */}
        {levels && s && (
          <path
            className="shape-line"
            d={levels.map((lv, i) => {
              const y = PAD.t + plotH - (lv / p.height) * plotH * 0.9;
              return `${i === 0 ? "M" : "L"}${xOf(i)},${lv ? y : PAD.t + plotH} L${xOf(i + 1)},${lv ? y : PAD.t + plotH}`;
            }).join(" ")}
          />
        )}
        {/* centre and live price */}
        <line x1={xOf(32)} x2={xOf(32)} y1={PAD.t} y2={PAD.t + plotH} className="line-p0" />
        <text x={xOf(32)} y={PAD.t - 10} className="lbl lbl-p0" textAnchor="middle">opened at {fmtPrice(p.p0, p.expo, p.dp)}</text>
        {p.live && (
          <g>
            <line x1={xOfPrice(p.live.price, p.p0, p.stepBps)} x2={xOfPrice(p.live.price, p.p0, p.stepBps)} y1={PAD.t} y2={PAD.t + plotH} className="line-live" />
            <text x={xOfPrice(p.live.price, p.p0, p.stepBps)} y={PAD.t + plotH + 30} className="lbl lbl-live" textAnchor="middle">now {fmtPrice(p.live.price, p.expo, p.dp)}</text>
          </g>
        )}
        {/* axis */}
        {ticks.map((i) => (
          <text key={i} x={xOf(i)} y={PAD.t + plotH + 16} className="lbl" textAnchor={i === 0 ? "start" : i === 63 ? "end" : "middle"}>{label(i)}</text>
        ))}
      </svg>
      <div className="chart-hover">
        {hoverBox ? (
          <>
            <span className="mono">{hoverBox.range}</span>
            <span>{hoverBox.prob} chance</span>
            {hoverBox.pays !== null && <span className="amber">{hoverBox.pays ? `pays ${hoverBox.pays}×` : "pays nothing"}</span>}
          </>
        ) : (
          <span className="muted">{p.disabled ? "Trading is closed." : p.mode === "line" ? "Click where the price will land." : "Drag across the range you expect."}</span>
        )}
      </div>
    </div>
  );
}
