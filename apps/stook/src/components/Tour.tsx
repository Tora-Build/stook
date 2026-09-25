import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

// The floor guide: a first walk through the trading page, one element at a
// time. Each stop names an element by its `data-tour` attribute; a stop whose
// element is not on the page (the reach slider in Range mode, the trade form
// on a finished round) is passed over, so the same list serves every round.

export interface TourStop {
  /** `data-tour` value of the element to light up; none for a centred note. */
  target?: string;
  title: string;
  body: ReactNode;
}

const SEEN = "stook.floor-guide.v1";
export const tourSeen = () => { try { return localStorage.getItem(SEEN) === "1"; } catch { return true; } };
const markSeen = () => { try { localStorage.setItem(SEEN, "1"); } catch { /* private mode: it will offer again */ } };

const PAD = 8;
const find = (t?: string) => (t ? document.querySelector<HTMLElement>(`[data-tour="${t}"]`) : null);

export function Tour({ stops, open, onClose }: { stops: TourStop[]; open: boolean; onClose: () => void }) {
  // The stops that are on the page right now, in order.
  const [live, setLive] = useState<TourStop[]>([]);
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const [cardH, setCardH] = useState(0);

  useEffect(() => { if (open) { setLive(stops.filter((s) => !s.target || find(s.target))); setI(0); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const stop = live[i];

  const measure = useCallback(() => {
    const el = find(stop?.target);
    setRect(el ? el.getBoundingClientRect() : null);
    if (card.current) setCardH(card.current.offsetHeight);
  }, [stop]);

  // Bring the element into view, then light it.
  useLayoutEffect(() => {
    if (!open || !stop) return;
    const el = find(stop.target);
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (el && window.innerWidth < 640) {
      // Phones: the note sits at the bottom, so bring the element to the top.
      window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top - 72, behavior: smooth ? "smooth" : "auto" });
    } else el?.scrollIntoView({ block: "center", behavior: smooth ? "smooth" : "auto" });
    measure();
    const t = window.setTimeout(measure, smooth ? 380 : 0);
    next.current?.focus({ preventScroll: true });
    return () => window.clearTimeout(t);
  }, [open, stop, measure]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => { window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); };
  }, [open, measure]);

  // Room under the page's last element, so it can scroll clear of the note.
  useEffect(() => {
    if (!open) return;
    const was = document.body.style.paddingBottom;
    document.body.style.paddingBottom = `${Math.max(cardH + 48, 280)}px`;
    return () => { document.body.style.paddingBottom = was; };
  }, [open, cardH]);

  const close = useCallback(() => { markSeen(); onClose(); }, [onClose]);
  const go = useCallback((d: number) => { if (i + d >= live.length) close(); else setI(Math.max(0, i + d)); }, [i, live.length, close]);

  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [open, go, close]);

  if (!open || !stop) return null;

  // Where the card goes: under the element if it fits, else over it, else
  // pinned to the bottom of the screen (phones, tall elements).
  const vw = window.innerWidth, vh = window.innerHeight, narrow = vw < 640;
  const cw = Math.min(360, vw - 32);
  let top: number | undefined, left: number | undefined, arrow: "up" | "down" | null = null, pinned = false;
  if (rect && !narrow) {
    left = Math.min(Math.max(16, rect.left + rect.width / 2 - cw / 2), vw - cw - 16);
    if (rect.bottom + PAD + 16 + cardH < vh) { top = rect.bottom + PAD + 14; arrow = "up"; }
    else if (rect.top - PAD - 16 - cardH > 0) { top = rect.top - PAD - 14 - cardH; arrow = "down"; }
    else pinned = true;
  } else if (rect) pinned = true;
  const arrowX = rect && left !== undefined ? Math.min(Math.max(18, rect.left + rect.width / 2 - left), cw - 18) : 0;

  return createPortal(
    <div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      {rect
        ? <div className="tour-spot" style={{ top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }} aria-hidden="true" />
        : <div className="tour-dim" aria-hidden="true" />}
      <div
        ref={card}
        className={`tour-card ${!rect ? "tour-card-centre" : pinned ? "tour-card-pinned" : ""} ${arrow ? `tour-arrow-${arrow}` : ""}`}
        style={rect && !pinned ? { top, left, width: cw, ["--ax" as string]: `${arrowX}px` } : { width: cw }}
      >
        <div className="tour-head">
          <span className="tour-sign">Floor guide</span>
          <span className="tour-count mono">{String(i + 1).padStart(2, "0")}/{String(live.length).padStart(2, "0")}</span>
        </div>
        <div className="tour-body" aria-live="polite">
          <h4 id="tour-title">{stop.title}</h4>
          <div>{stop.body}</div>
        </div>
        <div className="tour-foot">
          <div className="tour-pips" aria-hidden="true">{live.map((_, k) => <span key={k} className={k === i ? "on" : k < i ? "past" : ""} />)}</div>
          {i < live.length - 1 && <button className="link tour-skip" onClick={close}>Skip tour</button>}
          {i > 0 && <button className="tour-back" onClick={() => go(-1)}>Back</button>}
          <button ref={next} className="tour-next" onClick={() => go(1)}>{i === live.length - 1 ? "Place a call" : i === 0 ? "Show the tour" : "Next"}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
