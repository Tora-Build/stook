// The street, drawn on a low-resolution canvas and scaled by a whole number,
// so every pixel of the art is a crisp square in the video.
import { useLayoutEffect, useMemo, useRef } from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { draw, layout } from "./city";

export function Skyline(p: { width: number; height: number; scale: number; lit?: number; exchange?: boolean; style?: React.CSSProperties }) {
  const frame = useCurrentFrame(), { fps } = useVideoConfig();
  const gw = Math.ceil(p.width / p.scale), gh = Math.ceil(p.height / p.scale);
  const city = useMemo(() => layout(gw, gh), [gw, gh]);
  const a = useRef<HTMLCanvasElement>(null), b = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const ctx = a.current!.getContext("2d")!, fine = b.current!.getContext("2d")!;
    draw(ctx, fine, city, frame / fps, { lit: p.lit, exchange: p.exchange });
  }, [frame, fps, city, p.lit, p.exchange]);
  const css: React.CSSProperties = { position: "absolute", left: 0, top: 0, width: gw * p.scale, height: gh * p.scale, imageRendering: "pixelated" };
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: gw * p.scale, height: gh * p.scale, ...p.style }}>
      <canvas ref={a} width={gw} height={gh} style={css} />
      <canvas ref={b} width={gw * 2} height={gh * 2} style={css} />
    </div>
  );
}
