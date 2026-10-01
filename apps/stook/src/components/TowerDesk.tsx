// Around the tower: the kind of call and how sure, the exact-prices
// steppers, the three-step coach, and the phone's call bar.
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { stook } from "@sooth/sdk-solana";
import { aboutMultiple, clamp, fx, MAX_S, nearAt, nudgeCall, SURE, type Grid, type Role } from "../lib/call";
import type { Desk } from "../hooks/useDesk";
import type { CallOrder } from "../hooks/useCallOrder";

/** Gold coins in stacks, the tower's own coins: a pyramid for "near a price"
 *  (most on the middle floor), a flat row for "between two prices". */
export function KindIcon({ kind, scale = 2 }: { kind: "near" | "between"; scale?: number }) {
  const heights = kind === "near" ? [1, 2, 4, 2, 1] : [2, 2, 2, 2, 2];
  const rects: ReactNode[] = [];
  heights.forEach((n, i) => {
    const x = i * 5;
    for (let k = 0; k < n; k++) {
      const y = 9 - 2 * (k + 1);
      rects.push(<rect key={`${i}b${k}`} x={x} y={y} width="4" height="1" fill="#f0a83a" />, <rect key={`${i}e${k}`} x={x} y={y + 1} width="4" height="1" fill="#8a5a12" />);
    }
    rects.push(<rect key={`${i}h`} x={x + 1} y={9 - 2 * n - 1} width="2" height="1" fill="#ffe28a" />);
  });
  return <svg className="kind-ico" width={24 * scale} height={10 * scale} viewBox="0 0 24 10" shapeRendering="crispEdges" aria-hidden="true">{rects}</svg>;
}

/** Brass screw heads for a plate's corners. */
const Screws = () => <>{["tl", "tr", "bl", "br"].map((k) => <i key={k} className={`screw ${k}`} aria-hidden="true" />)}</>;

const sureLabel = (name: string, s: number, mult?: string) => `${name}: pays over ${s} floor${s > 1 ? "s" : ""} each side${mult ? `, about ${mult} your spend` : ""}`;

/** Near a price or between two, then how sure: the call's shape, in plain
 *  words, on the brass panel of an old elevator. */
export function CallKind(p: { desk: Desk; grid: Grid; curve: stook.Curve; feeBps: number; at: number; coarse: boolean; onSure: () => void }) {
  const { desk, grid: g } = p;
  const L = desk.call?.kind === "near" ? desk.call.c : p.at;
  const on = desk.call?.kind === "near" ? desk.call.s : desk.lastS;
  return (
    <section className="tw-ctl" aria-label="Kind of call">
      <div className="brass switch-plate" role="group" aria-label="Kind of call">
        <Screws />
        {(["near", "between"] as const).map((k) => (
          <button key={k} className="sw-side" aria-pressed={desk.kind === k} onClick={() => desk.switchKind(k)}>
            <span className="sw-lamp" aria-hidden="true" />
            <KindIcon kind={k} />
            <span className="t">{k === "near" ? "Near a price" : "Between two prices"}</span>
          </button>
        ))}
      </div>
      {/* How sure is a choice only near a price; a range is drawn on the tower, so there is nothing to pick here. */}
      {desk.kind === "near" && <div className="brass floor-plate" data-coach="sure">
        <Screws />
        <span className="plate-lbl">HOW SURE?</span>
        {desk.kind === "near" ? (
          <div className="floors" role="group" aria-label="How sure are you">
            {SURE.map(([name, s]) => {
              const mult = fx(aboutMultiple(p.curve, nearAt(g, L, s), p.feeBps));
              return (
                <button key={s} className="floor-btn" aria-pressed={on === s} aria-label={sureLabel(name, s, mult)} title={sureLabel(name, s, mult)}
                  onClick={() => { desk.setSure(s, p.at); p.onSure(); }}>
                  <span className="bezel" aria-hidden="true"><span className="lens">±{s}</span></span>
                  <span className="fl-name">{name}</span>
                  <span className="fl-mult mono">≈{mult}</span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>}
    </section>
  );
}

/** The phone's one-row version of the kind and how sure, for the call bar. */
export function CallKindBar(p: { desk: Desk; grid: Grid; at: number; onSure: () => void }) {
  const { desk } = p;
  const on = desk.call?.kind === "near" ? desk.call.s : desk.lastS;
  return (
    <div className="tw-kbar">
      <div className="brass switch-plate sw-mini" role="group" aria-label="Kind of call">
        {(["near", "between"] as const).map((k) => (
          <button key={k} className="sw-side" aria-pressed={desk.kind === k} aria-label={k === "near" ? "Near a price" : "Between two prices"} onClick={() => desk.switchKind(k)}>
            <KindIcon kind={k} scale={1} />
            <span className="t">{k === "near" ? "Near" : "Between"}</span>
          </button>
        ))}
      </div>
      {desk.kind === "near"
        ? <div className="brass floor-plate fp-mini" role="group" aria-label="How sure are you" data-coach="sure-m">
            {SURE.map(([name, s]) => (
              <button key={s} className="floor-btn" aria-pressed={on === s} aria-label={sureLabel(name, s)} onClick={() => { desk.setSure(s, p.at); p.onSure(); }}>
                <span className="bezel" aria-hidden="true"><span className="lens">±{s}</span></span>
                <span className="fl-name">{name}</span>
              </button>
            ))}
          </div>
        : null}
    </div>
  );
}

/** Steppers for the ends (or the floor and its reach), each with a price field that snaps to its band. */
export function ExactPrices(p: { desk: Desk; grid: Grid; all: boolean; setAll: (v: boolean) => void }) {
  const { desk, grid: g } = p;
  const c = desk.pending ? null : desk.call;
  const [note, setNote] = useState("");
  useEffect(() => setNote(""), [c?.kind]);
  const rep = useRef<{ t1?: number; t2?: number }>({});
  const stop = () => { clearTimeout(rep.current.t1); clearInterval(rep.current.t2); };
  useEffect(() => { window.addEventListener("pointerup", stop); window.addEventListener("pointercancel", stop); return () => { stop(); window.removeEventListener("pointerup", stop); window.removeEventListener("pointercancel", stop); }; }, []);
  // The ticket re-renders on every step, so the repeat reads the desk through a ref.
  const live = useRef(desk); live.current = desk;
  const step = (role: Role, d: number) => { const cc = live.current.call; if (!cc) return; const n = nudgeCall(g, cc, role, d); live.current.set(n.call, { msg: n.msg }); };
  const hold = (role: Role, d: number) => (e: React.PointerEvent) => { e.preventDefault(); stop(); step(role, d); rep.current.t1 = window.setTimeout(() => { rep.current.t2 = window.setInterval(() => step(role, d), 90); }, 450); };
  const snap = (role: Role, text: string) => {
    const v = Number(text.replace(/[,$\s]/g, ""));
    if (!(v > 0) || !c) { setNote(`Type a price, like ${g.fmt(g.p0 || 100)}.`); return; }
    const i = g.binOf(v);
    // A price past the floors drawn one by one shows every floor, so the call lands exactly where the note says.
    const off = i < g.flo || i > g.fhi;
    if (off && !p.all) p.setAll(true);
    const n = c.kind === "between"
      ? (role === "hi" ? { kind: "between" as const, lo: Math.min(c.lo, i), hi: Math.max(c.lo, i) } : { kind: "between" as const, lo: Math.min(i, c.hi), hi: Math.max(i, c.hi) })
      : off ? { kind: "near" as const, c: i, s: c.s } : nearAt(g, i, c.s);
    desk.set(n, { undoable: true });
    setNote(`Snapped to ${i === 0 ? `below ${g.fmt(g.edge(1))}` : i === 63 ? `above ${g.fmt(g.edge(63))}` : `${g.fmt(g.edge(i))} to ${g.fmt(g.edge(i + 1))}`}.${off && !p.all ? " Every floor is showing now, so you can see it." : ""}`);
  };
  const row = (label: string, value: string, role: Role, edit: boolean, lo: boolean, hi: boolean) => (
    <div className="tw-ed">
      <span className="k">{label}</span>
      <button onPointerDown={hold(role, -1)} onClick={(e) => { if (e.detail === 0) step(role, -1); }} disabled={lo} aria-label={`${label} down one floor`}>▼</button>
      {edit ? <PriceField value={value} label={`${label} price`} onCommit={(t) => snap(role, t)} /> : <span className="val">{value}</span>}
      <button onPointerDown={hold(role, 1)} onClick={(e) => { if (e.detail === 0) step(role, 1); }} disabled={hi} aria-label={`${label} up one floor`}>▲</button>
    </div>
  );
  let body: ReactNode;
  if (!c) body = <p className="tw-note">Pick a floor first.</p>;
  else if (c.kind === "between") body = <>
    {row("TOP", c.hi === 63 ? "no limit" : g.fmt(g.edge(c.hi + 1)), "hi", c.hi !== 63, false, c.hi === 63)}
    {row("BOTTOM", c.lo === 0 ? "no limit" : g.fmt(g.edge(c.lo)), "lo", c.lo !== 0, c.lo === 0, false)}
    <p className="tw-note">{c.hi - c.lo + 1} floor{c.hi > c.lo ? "s" : ""}, each {(g.stepBps / 100).toFixed(2).replace(/\.?0+$/, "")}% of the price tall.</p>
  </>;
  else body = <>
    {row("FLOOR", g.fmt(g.edge(clamp(c.c, 1, 63))), "c", true, c.c <= g.flo, c.c >= g.fhi)}
    {row("SPREAD", `±${c.s} floor${c.s > 1 ? "s" : ""}`, "w", false, c.s <= 1, c.s >= MAX_S)}
    <p className="tw-note">Full pay from {g.fmt(g.edge(clamp(c.c, 1, 63)))} to {g.fmt(g.edge(clamp(c.c + 1, 1, 63)))}. Less on each floor away, nothing below {g.fmt(g.edge(Math.max(1, c.c - c.s)))} or above {g.fmt(g.edge(Math.min(63, c.c + c.s + 1)))}.</p>
  </>;
  return <>
    {body}
    {note && <p className="tw-note" role="status">{note}</p>}
    <label className="tw-allf"><input type="checkbox" checked={p.all} onChange={(e) => p.setAll(e.target.checked)} /> Show every floor (all 64)</label>
  </>;
}

function PriceField(p: { value: string; label: string; onCommit: (t: string) => void }) {
  const [text, setText] = useState<string | null>(null);
  return <input className="val" value={text ?? p.value} inputMode="decimal" aria-label={p.label}
    onFocus={(e) => e.currentTarget.select()} onChange={(e) => setText(e.target.value)}
    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (text !== null) p.onCommit(text); setText(null); } else if (e.key === "Escape") setText(null); }}
    onBlur={() => { if (text !== null && text !== p.value) p.onCommit(text); setText(null); }} />;
}

// ── the coach: three steps on a first visit ─────────────────────────────────
const COACH_KEY = "stook.tower-coach.v1";
export const coachDone = () => { try { return localStorage.getItem(COACH_KEY) === "done"; } catch { return true; } };
export const markCoachDone = () => { try { localStorage.setItem(COACH_KEY, "done"); } catch { /* private mode: it offers again next time */ } };

export function Coach(p: { step: number; kind: "near" | "between"; narrow: boolean; bell: string; go: (n: number) => void }) {
  const texts = [
    `Pick the floor where the price stops at ${p.bell}.`,
    p.kind === "near" ? "Choose how sure you are. Sure pays more." : "Drag the ▲ ▼ tabs. Fewer floors pays more.",
    `Place your call${p.narrow ? " with the gold button at the bottom." : "."}`,
  ];
  const target = p.step === 1 ? "tower" : p.step === 2 ? (p.kind === "near" ? (p.narrow ? "sure-m" : "sure") : "tower") : p.narrow ? "place-m" : "place";
  useEffect(() => {
    if (!p.step) return;
    const el = document.querySelector(`[data-coach="${target}"]`);
    el?.classList.add("tw-hl");
    return () => el?.classList.remove("tw-hl");
  }, [p.step, target]);
  if (!p.step) return null;
  return (
    // Floats over the page (above the phone's call bar), so it never pushes the tower down.
    <div className="tw-coach tw-coach-float" role="region" aria-label="How to play" aria-live="polite">
      <span className="n">{p.step} OF 3</span>
      <p>{texts[p.step - 1]}</p>
      <button onClick={() => p.go(p.step >= 3 ? 0 : p.step + 1)}>{p.step === 3 ? "Got it" : "Next"}</button>
      <button className="sk" onClick={() => p.go(0)}>Skip</button>
    </div>
  );
}

// ── phones: the call, what it wins and Place, always on screen ──────────────
export function CallBar(p: { order: CallOrder; symbol: string; money: (u: bigint) => string; state: "open" | "closed"; closedText: string; pending: boolean; hasCall: boolean; held: boolean; controls?: ReactNode }) {
  const o = p.order;
  // The kind-and-how-sure row folds away while you scroll down the page and
  // comes back on the way up, or on a tap on the bar.
  const [folded, setFolded] = useState(false);
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let last = window.scrollY;
    const on = () => { const y = window.scrollY, d = y - last; if (Math.abs(d) < 8) return; setFolded(d > 0 && y > 40); last = y; };
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  // The coach floats just above the bar, whatever its height.
  useEffect(() => {
    const el = bar.current; if (!el) return;
    const set = () => document.documentElement.style.setProperty("--tw-mbar-h", `${el.offsetHeight}px`);
    const ro = new ResizeObserver(set); ro.observe(el); set();
    return () => { ro.disconnect(); document.documentElement.style.removeProperty("--tw-mbar-h"); };
  }, []);
  const opts = o.unit === "usd" ? [1, 5, 10, 25, 50, 100] : [10, 50, 100, 250, 500, 1000];
  const typed = Number(o.text.replace(/,/g, ""));
  const all = opts.includes(typed) || !(typed > 0) ? opts : [...opts, typed].sort((a, b) => a - b);
  const win = p.state === "closed" ? <span className="dim">{p.closedText}</span>
    : o.toWin !== null && o.mult !== null && !o.stale ? <span>{p.money(o.toWin)} · {fx(o.mult)}</span>
    : <span className="dim">{p.pending ? "tap the other end" : p.hasCall ? "type a spend" : "pick a floor"}</span>;
  const label = p.state === "closed" ? "Closed" : !o.connected ? "Connect" : o.send.isPending ? "Sending…" : o.short ? "Short" : p.held || o.existing ? "Add" : "Place";
  return (
    <div className="tw-mbar" ref={bar} onClick={() => { if (folded) setFolded(false); }}>
      {p.controls && p.state === "open" && <div className={`tw-mbar-ctl${folded ? " folded" : ""}`}>{p.controls}</div>}
      {p.controls && p.state === "open" && folded && <button className="tw-mbar-unfold" onClick={(e) => { e.stopPropagation(); setFolded(false); }} aria-expanded={false} aria-label="Show near or between and how sure">▴</button>}
      <div className="tw-mbar-row">
      <label className="sp"><span className="lb">SPEND {o.unit === "usd" ? "$" : p.symbol}</span>
        <select value={typed > 0 ? String(typed) : ""} onChange={(e) => o.setText(e.target.value)} aria-label={`Spend in ${o.unit === "usd" ? "dollars" : p.symbol}`} disabled={p.state === "closed"}>
          {!(typed > 0) && <option value="">…</option>}
          {all.map((v) => <option key={v} value={String(v)}>{v.toLocaleString("en-US")}</option>)}
        </select>
      </label>
      <div className="tw"><span className="lb">TO WIN</span>{win}</div>
      <button data-coach="place-m" disabled={p.state === "closed" || !o.q || o.stale || o.send.isPending || !o.connected || o.short} onClick={o.submit}>{label}</button>
      </div>
    </div>
  );
}
