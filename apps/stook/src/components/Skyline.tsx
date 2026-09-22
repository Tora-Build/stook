// The street: drawn by the same module stooks.xyz uses (loaded from there), so
// the two pages show one skyline. `hero` is the tall version with the
// exchange, the bull and the traffic; the default is the strip every page carries.
import { useEffect, useRef } from "react";
import { useTheme } from "./Theme";

const SRC = "/city.js";
type City = { mount: (c: HTMLCanvasElement, o: { hero?: boolean; t: () => number; ticker?: () => string }) => () => void };
let loading: Promise<City> | null = null;
const load = () => (loading ??= new Promise<City>((res, rej) => {
  const w = window as unknown as { StookCity?: City };
  if (w.StookCity) return res(w.StookCity);
  const s = document.createElement("script"); s.src = SRC; s.onload = () => res((window as unknown as { StookCity: City }).StookCity); s.onerror = rej; document.head.appendChild(s);
}));

export function Skyline({ hero = false, ticker }: { hero?: boolean; ticker?: () => string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { t } = useTheme();
  const tRef = useRef(t); tRef.current = t;
  const tickRef = useRef(ticker); tickRef.current = ticker;
  useEffect(() => {
    let un: (() => void) | undefined, dead = false;
    load().then((city) => { if (!dead && ref.current) un = city.mount(ref.current, { hero, t: () => tRef.current, ticker: () => tickRef.current?.() ?? "STOOK STREET" }); }).catch(() => {});
    return () => { dead = true; un?.(); };
  }, [hero]);
  return <canvas ref={ref} className={hero ? "skyline skyline-hero" : "skyline"} aria-hidden="true" />;
}
