import type { ReactNode } from "react";

// The anchor over the last day: a stepped line with its area, the last, high
// and low prices on the right, and New York hours underneath, placed by time.
export function Chart24({ points, dp, title, state, note }: { points: [number, number][]; dp: number; title: string; state: "loading" | "none" | "ready"; note?: string | null }) {
  const W = 520, H = 216, P = { l: 0, r: 64, t: 12, b: 24 };
  const fmt = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
  const head = (extra?: ReactNode) => <><div className="house-chart-head"><span className="label">{title}</span>{extra}</div>{note && <p className="house-chart-note">{note}</p>}</>;
  if (points.length < 2) {
    return <div className="house-chart">{head()}<div className="house-chart-empty dimmer">{state === "none" ? "No price chart for this coin yet." : "Loading the last 24 hours"}</div></div>;
  }
  const ys = points.map((p) => p[1]), lo = Math.min(...ys), hi = Math.max(...ys), span = hi - lo || 1;
  const t0 = points[0]![0], t1 = points[points.length - 1]![0], tspan = t1 - t0 || 1;
  const xt = (t: number) => P.l + ((t - t0) / tspan) * (W - P.l - P.r);
  const x = (i: number) => xt(points[i]![0]);
  const y = (v: number) => P.t + (1 - (v - lo) / span) * (H - P.t - P.b);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[1]).toFixed(1)}`).join(" ");
  const last = points[points.length - 1]!, first = points[0]!;
  const up = last[1] >= first[1];
  const change = first[1] ? ((last[1] - first[1]) / first[1]) * 100 : 0;
  // Every sixth New York hour inside the range, kept clear of the edges.
  const nyHour = (t: number) => Number(new Date(t * 1000).toLocaleString("en-US", { hour: "numeric", hourCycle: "h23", timeZone: "America/New_York" }));
  const ticks: number[] = [];
  for (let t = Math.ceil(t0 / 3600) * 3600; t <= t1; t += 3600) if (nyHour(t) % 6 === 0 && xt(t) > 28 && xt(t) < W - P.r - 28) ticks.push(t);
  // keep the three right-hand labels from sitting on each other
  const ly = (v: number) => y(v) + 4;
  const labels = [{ v: hi, c: "" }, { v: lo, c: "" }, { v: last[1], c: "live" }].filter((a, _i, all) => a.c === "live" || Math.abs(ly(a.v) - ly(all[2]!.v)) > 14);
  return (
    <div className="house-chart">
      {head(<b className={`num ${up ? "up" : "down"}`}>{up ? "+" : "−"}{Math.abs(change).toFixed(2)}%</b>)}
      <svg viewBox={`0 0 ${W} ${H}`} className="house-chart-svg" role="img" aria-label={`${title}: from ${fmt(first[1])} to ${fmt(last[1])}`}>
        <defs>
          <linearGradient id="house-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={up ? "#3ddc84" : "#ff6b5e"} stopOpacity=".22" />
            <stop offset="1" stopColor={up ? "#3ddc84" : "#ff6b5e"} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[hi, lo].map((v, i) => <line key={i} x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} className="house-chart-grid" />)}
        <path d={`${d} L${x(points.length - 1)},${H - P.b} L${x(0)},${H - P.b} Z`} fill="url(#house-area)" />
        <path d={d} className={`house-chart-line ${up ? "up" : "down"}`} />
        <circle cx={x(points.length - 1)} cy={y(last[1])} r="4" className={`house-chart-dot ${up ? "up" : "down"}`} />
        {labels.map((a, i) => <text key={i} x={W - P.r + 10} y={ly(a.v)} className={`house-chart-lbl ${a.c}`}>{fmt(a.v)}</text>)}
        {ticks.map((t) => <g key={t}>
          <line x1={xt(t)} x2={xt(t)} y1={H - P.b} y2={H - P.b + 4} className="house-chart-grid" />
          <text x={xt(t)} y={H - 4} className="house-chart-lbl" textAnchor="middle">{new Date(t * 1000).toLocaleTimeString("en-US", { hour: "numeric", timeZone: "America/New_York" })}</text>
        </g>)}
      </svg>
    </div>
  );
}
