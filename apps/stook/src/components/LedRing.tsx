import { useId } from "react";

// A stadium LED band around a street table's rim: the coin's ticker, its
// dollar price (Jupiter-style, the run of zeros as a small count) and its
// 24h move, twice around, turning slowly. The table's centre keeps one big
// number, the anchor's; this is where the coin's own quote lives.

const R = 116, C = 131; // in a 262 by 262 box, scaled to the table

/** Price text: plain from a tenth of a cent up, else [zero count, digits]. */
function parts(usd: number): string | [number, string] {
  if (usd >= 0.001) return usd.toLocaleString("en-US", { maximumSignificantDigits: 3, maximumFractionDigits: 6 });
  const zeros = Math.floor(-Math.log10(usd));
  return [zeros, Math.round(usd * 10 ** (zeros + 3)).toString().replace(/0+$/, "") || "0"];
}

function Quote({ symbol, usd, change }: { symbol: string; usd: number; change: number | null }) {
  const p = parts(usd);
  return (
    <>
      <tspan className="led-coin">${symbol}</tspan>
      <tspan className="led-sep">{"  "}</tspan>
      {typeof p === "string"
        ? <tspan className="led-px">${p}</tspan>
        : <><tspan className="led-px">$0.0</tspan><tspan className="led-px led-sub" dy="3">{p[0]}</tspan><tspan className="led-px" dy="-3">{p[1]}</tspan></>}
      {change !== null && <><tspan className="led-sep">{"  "}</tspan><tspan className={change >= 0 ? "led-up" : "led-down"}>{change >= 0 ? "▲" : "▼"}{Math.abs(change).toFixed(1)}%</tspan></>}
    </>
  );
}

export function LedRing({ symbol, usd, change }: { symbol: string; usd: number | undefined; change: number | null | undefined }) {
  const id = useId().replace(/:/g, "");
  const r = R - 4;
  // A full circle as one path, starting at the top, clockwise.
  const d = `M ${C} ${C - r} a ${r} ${r} 0 1 1 0 ${2 * r} a ${r} ${r} 0 1 1 0 ${-2 * r}`;
  return (
    <svg className="led-ring" viewBox="0 0 262 262" role="img" aria-label={usd !== undefined ? `$${symbol} at $${usd}` : `$${symbol}`}>
      <circle className="led-band" cx={C} cy={C} r={R} />
      <circle className="led-dots" cx={C} cy={C} r={R} />
      <circle className="led-edge" cx={C} cy={C} r={R + 11} />
      <circle className="led-edge" cx={C} cy={C} r={R - 11} />
      {usd !== undefined && (
        <g className="led-spin">
          <defs><path id={id} d={d} /></defs>
          {/* two copies, half a turn apart */}
          {["0%", "50%"].map((o) => (
            <text key={o}><textPath href={`#${id}`} startOffset={o}><Quote symbol={symbol} usd={usd} change={change ?? null} /></textPath></text>
          ))}
        </g>
      )}
    </svg>
  );
}
