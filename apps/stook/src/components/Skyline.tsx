// The street under the header. `hero` draws it tall with the exchange and the
// taxi; the default is the thin strip every page carries.
import { useEffect, useRef } from "react";
import { draw, layout } from "../lib/city";
import { useTheme } from "./Theme";

export function Skyline({ hero = false }: { hero?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { t } = useTheme();
  const city = useRef<ReturnType<typeof layout> | null>(null);
  useEffect(() => {
    const c = ref.current!; const ctx = c.getContext("2d")!;
    const paint = () => {
      const W = c.clientWidth, H = c.clientHeight, P = hero ? Math.max(3, Math.round(W / 260)) : 3;
      const gw = Math.ceil(W / P), gh = hero ? Math.ceil(H / P) : 22;
      if (!city.current || city.current.gw !== gw || city.current.gh !== gh) city.current = layout(gw, gh);
      c.width = gw; c.height = gh; draw(ctx, city.current, t, hero ? {} : { exchange: false, taxi: false });
    };
    paint(); const ro = new ResizeObserver(paint); ro.observe(c); return () => ro.disconnect();
  }, [t, hero]);
  return <canvas ref={ref} className={hero ? "skyline skyline-hero" : "skyline"} aria-hidden="true" />;
}
