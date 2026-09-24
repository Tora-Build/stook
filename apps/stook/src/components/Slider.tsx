import type { CSSProperties } from "react";

/** A range input drawn in the street's pixel style. The thumb travels the
 *  whole track, so its ends are the ends: no dead space at either side. The
 *  filled part follows the thumb's centre (`--f`, 0 to 1). */
export function Slider(p: { min: number; max: number; step?: number; value: number; onChange: (v: number) => void; label?: string; width?: number }) {
  const f = p.max > p.min ? (p.value - p.min) / (p.max - p.min) : 0;
  return (
    <input
      type="range" className="px-range" min={p.min} max={p.max} step={p.step ?? 1} value={p.value} aria-label={p.label}
      style={{ "--f": f, width: p.width } as CSSProperties}
      onChange={(e) => p.onChange(Number(e.target.value))}
    />
  );
}
