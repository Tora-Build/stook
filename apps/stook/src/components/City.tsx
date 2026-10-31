// The street behind page headers: the live skyline (public/city.js, the
// same engine as the strip on stookstreet.xyz), night or day with the theme,
// with cars, steam, flickering windows, the exchange and the bull. A page can
// stand one tall tower in it whose floors are prices: the floors of a call
// burn gold. `onLayout` says where the tower landed, for tags beside it.
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { useTheme } from "./Theme";

export interface CityTower {
  /** Left edge as a share of the width (0 to 1). */
  x: number;
  /** Width and height in CSS px. */
  w: number;
  h: number;
  floors: number;
  /** First and last lit floor, counted from the top (0 is the top floor). */
  band?: [number, number] | null;
  /** A lit plate across the tower, e.g. "THE HOUSE". */
  sign?: string;
}

/** Where things landed, in CSS px from the box's top left, for overlays. */
export interface CityLayout {
  scale: number;
  width: number;
  height: number;
  /** The street line. */
  ground: number;
  tower?: { left: number; top: number; width: number; height: number; floorH: number; floorTop: (f: number) => number };
}

/** Where the street's furniture stands, as shares of the width. */
export interface CityPlace { exchange?: number; bull?: number; cart?: number; sign?: number }

export interface CityProps {
  tower?: CityTower | null;
  place?: CityPlace;
  /** The LED band on one building: what it crawls. */
  ticker?: () => { text: string; down?: boolean }[] | string;
  /** CSS px per city pixel (default: the street's own, about width / 260). */
  px?: number;
  /** A fade from the page colour at the left (for copy on top) and at the bottom. */
  fade?: "left" | "bottom" | "both" | "none";
  height?: number | string;
  className?: string;
  style?: CSSProperties;
  onLayout?: (l: CityLayout) => void;
  children?: ReactNode;
}

type Engine = { mount: (c: HTMLCanvasElement, o: Record<string, unknown>) => () => void };
let loading: Promise<Engine> | null = null;
const load = () => (loading ??= new Promise<Engine>((res, rej) => {
  const w = window as unknown as { StookCity?: Engine };
  if (w.StookCity) return res(w.StookCity);
  const s = document.createElement("script"); s.src = "/city.js";
  s.onload = () => res((window as unknown as { StookCity: Engine }).StookCity); s.onerror = rej; document.head.appendChild(s);
}));

export function City(props: CityProps) {
  const cv = useRef<HTMLCanvasElement>(null);
  const { t } = useTheme();
  const live = useRef({ props, t }); live.current = { props, t };
  // The tower's shape remounts the street; its band only changes what it lights.
  const shape = JSON.stringify([props.tower && { ...props.tower, band: undefined }, props.place, props.px]);
  useEffect(() => {
    let un: (() => void) | undefined, dead = false;
    const T = live.current.props.tower;
    load().then((city) => {
      if (dead || !cv.current) return;
      un = city.mount(cv.current, {
        hero: true,
        px: live.current.props.px,
        t: () => live.current.t,
        ticker: () => live.current.props.ticker?.() ?? "STOOK STREET",
        place: live.current.props.place,
        tower: T ? { ...T, band: () => live.current.props.tower?.band ?? null } : undefined,
        onLayout: (l: CityLayout) => live.current.props.onLayout?.(l),
      });
    }).catch(() => {});
    return () => { dead = true; un?.(); };
  }, [shape]);
  const fade = props.fade ?? "none";
  return (
    <div className={`city ${fade !== "none" ? `city-fade-${fade}` : ""} ${props.className ?? ""}`} style={props.height !== undefined ? { height: props.height, ...props.style } : props.style}>
      <canvas ref={cv} aria-hidden="true" />
      {props.children}
    </div>
  );
}
