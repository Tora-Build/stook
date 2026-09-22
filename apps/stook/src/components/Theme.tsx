// Night by default; day on request. `t` is what the skyline draws with — it
// tweens between the two over 1.4 s so the sun sets as the moon rises.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

interface Theme { name: "night" | "day"; t: number; toggle: () => void }
const Ctx = createContext<Theme>({ name: "night", t: 0, toggle: () => {} });
export const useTheme = () => useContext(Ctx);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [name, setName] = useState<"night" | "day">(() => { try { return (localStorage.getItem("stook-theme") as "night" | "day") || "night"; } catch { return "night"; } });
  const [t, setT] = useState(name === "day" ? 1 : 0);
  const anim = useRef(0);
  useEffect(() => { document.documentElement.dataset.theme = name; }, [name]);
  const toggle = useCallback(() => {
    const next = name === "day" ? "night" : "day", target = next === "day" ? 1 : 0, from = t;
    setName(next); try { localStorage.setItem("stook-theme", next); } catch {}
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { setT(target); return; }
    const start = performance.now(), dur = 1400; cancelAnimationFrame(anim.current);
    const step = (now: number) => { const u = Math.min(1, (now - start) / dur), e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2; setT(from + (target - from) * e); if (u < 1) anim.current = requestAnimationFrame(step); };
    anim.current = requestAnimationFrame(step);
  }, [name, t]);
  return <Ctx.Provider value={{ name, t, toggle }}>{children}</Ctx.Provider>;
}

export function ThemeToggle() {
  const { name, toggle } = useTheme();
  return <button className="theme-btn" onClick={toggle} aria-label="Switch between night and day">{name === "day" ? "☀ DAY" : "☾ NIGHT"}</button>;
}
