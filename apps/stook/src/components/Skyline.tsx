// The street under the header: a pixel skyline strip, drawn once per width,
// the same one every visit. Purely decorative.
import { useEffect, useRef } from "react";

export function Skyline() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!; const ctx = c.getContext("2d")!;
    const draw = () => {
      let seed = 20260922; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
      const W = c.clientWidth, P = 3, gw = Math.ceil(W / P), gh = 22; c.width = gw; c.height = gh;
      const px = (x: number, y: number, w: number, h: number, col: string) => { ctx.fillStyle = col; ctx.fillRect(x, y, w, h); };
      px(0, 0, gw, gh, "#101a2e");
      for (let i = 0; i < gw / 30; i++) px(Math.floor(rnd() * gw), Math.floor(rnd() * 8), 1, 1, "#f4e9c8");
      const pal = [["#7d2f22", "#a8412f"], ["#5a4a3a", "#8a7256"], ["#243a5e", "#2f4d7c"], ["#1b2a47", "#2a3d63"]];
      for (let x = -1; x < gw;) {
        const w = 5 + Math.floor(rnd() * 9), h = 6 + Math.floor(rnd() * 13), [d, l] = pal[Math.floor(rnd() * pal.length)]!;
        px(x, gh - 2 - h, w, h, d!); px(x, gh - 2 - h, w, 1, l!);
        for (let wy = gh - h; wy < gh - 3; wy += 3) for (let wx = x + 1; wx < x + w - 1; wx += 2) if (rnd() > 0.5) px(wx, wy, 1, 1, "#f0a83a");
        if (w > 9 && rnd() > 0.6) px(x + 2, gh - 2 - h + 3, w - 4, 2, "#0f7a4d");
        x += w + 1;
      }
      px(0, gh - 2, gw, 2, "#2a2a30"); for (let x = 1; x < gw; x += 8) px(x, gh - 1, 4, 1, "#f0a83a");
    };
    draw(); const ro = new ResizeObserver(draw); ro.observe(c); return () => ro.disconnect();
  }, []);
  return <canvas ref={ref} className="skyline" aria-hidden="true" />;
}
