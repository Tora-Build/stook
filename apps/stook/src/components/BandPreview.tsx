// What a band width means in money: the live price with the grid it would
// sit in drawn around it. The 64 bands run ±(32 × width) around wherever the
// price is when the round opens; here they are drawn around the price now.

export function BandPreview({ price, stepBps, dp }: { price: number | null; stepBps: number; dp: number }) {
  if (!price) return <div className="band-preview muted">Waiting for a live price to draw the bands on…</div>;
  const step = stepBps / 10_000;
  const SHOW = 9; // bands drawn either side of the one the price is in
  const W = 960, H = 120, bw = W / (2 * SHOW + 1);
  const edge = (k: number) => price * Math.exp(k * step);              // lower edge of band k (relative)
  const fmt = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
  const width = edge(1) - edge(0);
  const cover = (Math.exp(32 * step) - 1) * 100;
  return (
    <div className="band-preview">
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Band width around the current price">
        {Array.from({ length: 2 * SHOW + 1 }, (_, i) => {
          const k = i - SHOW;
          return <rect key={i} x={i * bw + 1} y={20} width={bw - 2} height={60} className={k === 0 ? "bar-in" : "bar"} />;
        })}
        <line x1={SHOW * bw + bw / 2} x2={SHOW * bw + bw / 2} y1={12} y2={88} className="line-live" />
        <text x={SHOW * bw + bw / 2} y={10} textAnchor="middle" className="lbl lbl-live">now {fmt(price)}</text>
        {[-SHOW, -Math.floor(SHOW / 2), 0, Math.ceil(SHOW / 2), SHOW + 1].map((k) => (
          <text key={k} x={(k + SHOW) * bw} y={104} textAnchor={k === -SHOW ? "start" : k === SHOW + 1 ? "end" : "middle"} className="lbl">{fmt(edge(k))}</text>
        ))}
      </svg>
      <p className="hint">Each band is <b>${fmt(width)}</b> wide here ({stepBps / 100}%). The whole grid covers about ±{cover.toFixed(0)}% around the opening price — a landing outside it pays the edge band.</p>
    </div>
  );
}
