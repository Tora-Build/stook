// The round page's first-visit guide: four short steps, each one dimming the
// page around the thing it names and waiting for the player to use it. And,
// after the bell, a one-time note on a round where the wallet held calls.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

// ── the guide's memory ──────────────────────────────────────────────────────
// The same key as the old three-step coach: whoever finished or skipped that does not see this one.
const GUIDE_KEY = "stook.tower-coach.v1";
export const guideDone = () => { try { return localStorage.getItem(GUIDE_KEY) === "done"; } catch { return true; } };
export const markGuideDone = () => { try { localStorage.setItem(GUIDE_KEY, "done"); } catch { /* private mode: it offers again next time */ } };

const BELL_KEY = "stook.after-bell.v1";
const bellSeen = (): string[] => { try { const v = JSON.parse(localStorage.getItem(BELL_KEY) ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; } };
const markBellSeen = (id: string) => { try { localStorage.setItem(BELL_KEY, JSON.stringify([id, ...bellSeen().filter((x) => x !== id)].slice(0, 60))); } catch { /* private mode: it may show again */ } };

// ── geometry ────────────────────────────────────────────────────────────────
interface Box { x: number; y: number; w: number; h: number }
interface Found { el: Element; box: Box }
const PAD = 6, GAP = 12, EDGE = 12;
const boxOf = (el: Element): Box => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
const visible = (el: Element | null): el is HTMLElement => !!el && (el as HTMLElement).getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
/** The box around `els`, cut to `clip`'s box. */
function around(els: Element[], clip?: Element | null): Box | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const e of els) { const r = e.getBoundingClientRect(); if (!r.width && !r.height) continue; x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom); }
  if (clip) { const c = clip.getBoundingClientRect(); x0 = Math.max(x0, c.left); y0 = Math.max(y0, c.top); x1 = Math.min(x1, c.right); y1 = Math.min(y1, c.bottom); }
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}
const one = (sel: string): Found | null => { const el = [...document.querySelectorAll(sel)].find(visible); return el ? { el, box: boxOf(el) } : null; };
const reduced = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Where a card of size `c` goes beside the hole `t`, never over it if there is room anywhere. */
type Side = "below" | "above" | "right" | "left";
function placeCard(t: Box, c: { w: number; h: number }, vw: number, vh: number, docked: boolean, prefer?: Side[]): { x: number; y: number } {
  const midX = Math.min(Math.max(t.x + t.w / 2 - c.w / 2, EDGE), vw - c.w - EDGE);
  const sideY = Math.min(Math.max(t.y, EDGE), vh - c.h - EDGE);
  const at = {
    below: { x: midX, y: t.y + t.h + GAP, ok: t.y + t.h + GAP + c.h <= vh - EDGE },
    above: { x: midX, y: t.y - GAP - c.h, ok: t.y - GAP - c.h >= EDGE },
    right: { x: t.x + t.w + GAP, y: sideY, ok: t.x + t.w + GAP + c.w <= vw - EDGE },
    left: { x: t.x - GAP - c.w, y: sideY, ok: t.x - GAP - c.w >= EDGE },
  };
  // Phones: the side away from the target first. A target in the bottom bar has the card above it.
  const phone = vw < 700, low = t.y + t.h / 2 > vh / 2;
  const order: Side[] = docked ? ["above", "below"] : prefer ?? (phone ? (low ? ["above", "below", "right", "left"] : ["below", "above", "right", "left"]) : ["right", "left", "below", "above"]);
  const k = order.find((o) => at[o].ok);
  if (k) return at[k];
  // No room anywhere: the larger gap, kept on screen.
  const up = t.y, down = vh - (t.y + t.h);
  return { x: midX, y: up > down ? Math.max(EDGE, t.y - GAP - c.h) : Math.min(vh - c.h - EDGE, t.y + t.h + GAP) };
}

interface Geo { hole: Box | null; card: { x: number; y: number } }

/** Follows the target every frame (scroll, resize, a layout change) and places the card beside it. */
function useFollow(find: () => Found | null, card: React.RefObject<HTMLElement>, opts: { hideWhileDragging: boolean; pad: number; prefer?: Side[] }) {
  const [geo, setGeo] = useState<Geo | null>(null);
  const f = useRef(find); f.current = find;
  useLayoutEffect(() => {
    let raf = 0, last = "";
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const vw = window.innerWidth, vh = window.innerHeight;
      const dragging = opts.hideWhileDragging && !!document.querySelector(".tw-dragging");
      const found = dragging ? null : f.current();
      let hole: Box | null = null, docked = false;
      if (found) {
        // The phone's call bar sits over the page: a target behind it is cut off where the bar starts.
        const bar = document.querySelector(".tw-mbar"), inBar = !!bar && bar.contains(found.el);
        docked = inBar;
        const floor = bar && !inBar && visible(bar) ? bar.getBoundingClientRect().top : vh;
        const b = found.box, p = opts.pad;
        const x0 = Math.max(0, b.x - p), y0 = Math.max(0, b.y - p), x1 = Math.min(vw, b.x + b.w + p), y1 = Math.min(floor, b.y + b.h + p);
        if (x1 > x0 && y1 > y0) hole = { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) };
      }
      const el = card.current, c = { w: el?.offsetWidth ?? 320, h: el?.offsetHeight ?? 120 };
      const pos = hole ? placeCard(hole, c, vw, vh, docked, opts.prefer) : { x: Math.round((vw - c.w) / 2), y: vh - c.h - EDGE - 70 };
      const next: Geo = { hole, card: { x: Math.round(pos.x), y: Math.round(pos.y) } };
      const key = JSON.stringify([next, dragging]);
      if (key !== last) { last = key; setGeo(dragging ? null : next); }
    };
    frame();
    return () => cancelAnimationFrame(raf);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return geo;
}

/** Brings a target into view once, if it is not already. */
function showTarget(found: Found | null) {
  if (!found) return;
  const bar = document.querySelector(".tw-mbar"), inBar = !!bar && bar.contains(found.el);
  if (inBar) return;
  const floor = bar && visible(bar) ? bar.getBoundingClientRect().top : window.innerHeight;
  const b = found.box;
  if (b.y >= EDGE && b.y + b.h <= floor - EDGE) return;
  found.el.scrollIntoView({ block: b.h > floor * 0.7 ? "start" : "center", behavior: reduced() ? "auto" : "smooth" });
}

// ── the spotlight ───────────────────────────────────────────────────────────
/** Dims everything but the target. Taps outside it do nothing; the card's buttons and Escape still work. */
function Spotlight(p: { find: () => Found | null; stepKey: string; label: string; children: ReactNode; onEscape: () => void }) {
  const card = useRef<HTMLDivElement>(null);
  const geo = useFollow(p.find, card, { hideWhileDragging: true, pad: PAD });
  // Each new step: its target into view, and focus on the card so the words are read out.
  useEffect(() => {
    const t = setTimeout(() => { showTarget(p.find()); card.current?.focus({ preventScroll: true }); }, 60);
    return () => clearTimeout(t);
  }, [p.stepKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector(".wallet-adapter-modal")) p.onEscape(); };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [p.onEscape]); // eslint-disable-line react-hooks/exhaustive-deps
  const vw = typeof window !== "undefined" ? window.innerWidth : 0, vh = typeof window !== "undefined" ? window.innerHeight : 0;
  const h = geo?.hole;
  const eat = (e: React.SyntheticEvent) => { e.preventDefault(); e.stopPropagation(); };
  const dims = !geo ? [] : h
    ? [{ left: 0, top: 0, width: vw, height: h.y }, { left: 0, top: h.y + h.h, width: vw, height: Math.max(0, vh - h.y - h.h) }, { left: 0, top: h.y, width: h.x, height: h.h }, { left: h.x + h.w, top: h.y, width: Math.max(0, vw - h.x - h.w), height: h.h }]
    : [{ left: 0, top: 0, width: vw, height: vh }];
  return <>
    {dims.map((s, k) => <div key={k} className="sl-dim" style={s} aria-hidden="true" onPointerDown={eat} onClick={eat} />)}
    {h && <div className="sl-ring" style={{ left: h.x, top: h.y, width: h.w, height: h.h }} aria-hidden="true" />}
    <div ref={card} className="sl-card" role="dialog" aria-modal="false" aria-label={p.label} tabIndex={-1}
      style={geo ? { left: geo.card.x, top: geo.card.y } : { left: 0, top: 0, visibility: "hidden" }}>
      {p.children}
    </div>
  </>;
}

// ── the guide ───────────────────────────────────────────────────────────────
export type WalletState = "none" | "empty" | "ready";
export const GUIDE_STEPS = 4;

/** The four steps. 1 and 3 also move on when the player does the thing; every step has Next; 4 follows the wallet. */
export function TowerGuide(p: { step: number; go: (n: number) => void; bell: string; narrow: boolean; floorBin: number | null; wallet: WalletState }) {
  if (!p.step) return null;
  const done = () => p.go(0);
  const how = <Link className="sl-how" to="/how" onClick={done}>How it works ›</Link>;
  let find: () => Found | null, text: string, foot: ReactNode, key = String(p.step);
  const skip = <button className="sl-skip" onClick={done}>Skip</button>;
  if (p.step === 1) {
    find = () => one(".tw-sc");
    text = `Each floor is where the price could stop at ${p.bell}. Tap one.`;
    foot = <><button className="sl-go" onClick={() => p.go(2)}>Next</button>{skip}</>;
  } else if (p.step === 2) {
    find = () => {
      const sc = document.querySelector(".tw-sc"); if (!sc) return null;
      const fls = [...sc.querySelectorAll<HTMLElement>(".tw-fl")];
      const b = p.floorBin;
      const rows = b !== null ? fls.filter((f) => Number(f.dataset.a) <= b && b <= Number(f.dataset.b)) : fls.filter((f) => f.classList.contains("in"));
      const box = around(rows.flatMap((f) => [...f.querySelectorAll(".tw-wn, .tw-co, .tw-pc")]), sc);
      return rows[0] && box ? { el: rows[0], box } : null;
    };
    text = "Lit windows: the crowd's odds. Gold coins: what you'd win.";
    foot = <><button className="sl-go" onClick={() => p.go(3)}>Next</button>{skip}</>;
  } else if (p.step === 3) {
    find = () => {
      if (p.narrow) { document.querySelector<HTMLButtonElement>(".tw-mbar-unfold")?.click(); return one('[data-coach="sure-m"]'); }
      return one('[data-coach="sure"]');
    };
    text = "Sure pays more, but has to land closer. Try one.";
    foot = <><button className="sl-go" onClick={() => p.go(4)}>Next</button>{skip}</>;
  } else {
    key = `4${p.wallet}`;
    if (p.wallet === "none") {
      find = () => one(".top .wallet-adapter-button");
      text = "Connect a wallet, then grab free test coins.";
      foot = <><button className="sl-go" onClick={done}>Got it</button>{how}</>;
    } else if (p.wallet === "empty") {
      find = () => one(".top .faucet-btn");
      text = "Grab free test coins.";
      foot = <><button className="sl-go" onClick={done}>Got it</button>{how}</>;
    } else {
      find = () => one(p.narrow ? '[data-coach="place-m"]' : '[data-coach="place"]');
      text = `Place your call. The first price at ${p.bell} settles it.`;
      foot = <><button className="sl-go" onClick={done}>Got it</button>{how}</>;
    }
  }
  return (
    <Spotlight find={find} stepKey={key} label="How to play" onEscape={done}>
      <span className="sl-n">{p.step} OF {GUIDE_STEPS}</span>
      <p aria-live="polite">{text}</p>
      <div className="sl-row">{foot}</div>
    </Spotlight>
  );
}

// ── after the bell ──────────────────────────────────────────────────────────
/** Once per round: whether the wallet's calls landed, beside the round's notice board. */
export function AfterBell(p: { id: string; landed: boolean; onCollect: () => void }) {
  const [open, setOpen] = useState(() => !bellSeen().includes(p.id));
  useEffect(() => { if (open) markBellSeen(p.id); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open) return null;
  return <BellNote landed={p.landed} onCollect={() => { setOpen(false); p.onCollect(); }} close={() => setOpen(false)} />;
}

function BellNote(p: { landed: boolean; onCollect: () => void; close: () => void }) {
  const card = useRef<HTMLDivElement>(null);
  const geo = useFollow(() => one(".tw-board") ?? one(".tw-sc"), card, { hideWhileDragging: false, pad: 2, prefer: ["below", "above", "right", "left"] });
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === "Escape") p.close(); };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div ref={card} className={`sl-card sl-note${p.landed ? " won" : ""}`} role="status" aria-live="polite"
      style={geo?.hole ? { left: geo.card.x, top: geo.card.y } : { left: 0, top: 0, visibility: "hidden" }}>
      <p>{p.landed ? <>Your call landed. <button className="sl-inline" onClick={p.onCollect}>Collect here.</button></> : "Your call missed this time."}</p>
      <button className="sl-x" onClick={p.close} aria-label="Close">✕</button>
    </div>
  );
}
