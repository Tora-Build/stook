// Around the chart: the kind of call and how sure, the exact-prices
// steppers, and the phone's call bar.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { stook } from "@sooth/sdk-solana";
import { aboutMultiple, clamp, fx, MAX_S, nearAt, nudgeCall, SURE, toShape, type Grid, type Role } from "../lib/call";
import type { Desk } from "../hooks/useDesk";
import type { CallOrder } from "../hooks/useCallOrder";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";

/** A small picture of the kind: a peak for "near a price" (most in the
 *  middle), a flat bar for "between two prices". */
export function KindIcon({ kind, scale = 1 }: { kind: "near" | "between"; scale?: number }) {
  const hs = kind === "near" ? [2, 4, 8, 4, 2] : [5, 5, 5, 5, 5];
  return <svg className="kind-ico" width={22 * scale} height={10 * scale} viewBox="0 0 22 10" aria-hidden="true">{hs.map((h, i) => <rect key={i} x={i * 4.5} y={10 - h} width="3.5" height={h} rx="1" fill="currentColor" />)}</svg>;
}

/** How sure, in the order card's words. Each maps one to one to a width:
 *  Tight is Sure (±1 row), Medium is Pretty sure (±3), Wide is Not sure (±6). */
export const SURE_WORDS: Record<number, string> = { 1: "Tight", 3: "Medium", 6: "Wide" };
const sureLabel = (name: string, s: number, mult?: string) => `${name}: pays over ${s} row${s > 1 ? "s" : ""} each side${mult ? `, wins up to ${mult} your spend` : ""}`;
const sures = (on: number): [string, number][] => [...SURE.map(([n, s]) => [SURE_WORDS[s] ?? n, s] as [string, number]), ...(SURE.some(([, s]) => s === on) ? [] : [["Custom", on] as [string, number]])];

/** Near a price or between two, then how sure: the call's shape, in plain words. */
/** With `order`, each multiple is quoted at the spend in the box. Without
 *  (the How page's demo), an estimate from the curve, marked with "~". */
export function CallKind(p: { desk: Desk; grid: Grid; order?: CallOrder; curve?: stook.Curve; feeBps?: number; at: number; coarse: boolean; onSure: () => void }) {
  const { desk, grid: g, order: o } = p;
  const L = desk.call?.kind === "near" ? desk.call.c : p.at;
  const on = desk.call?.kind === "near" ? desk.call.s : desk.lastS;
  // Each chip's multiple is quoted at the spend in the box, the same way the
  // order is, so the picked chip, the chart tag and the win card agree.
  const list = sures(on);
  const key = list.map(([, s]) => s).join(",");
  const mults = useMemo(() => new Map(list.map(([, s]) => { const c = nearAt(g, L, s);
      if (o) { const m = o.multOf(toShape(c)); return [s, m !== null && m > 0 ? fx(m) : ""] as const; }
      const m = p.curve ? aboutMultiple(p.curve, c, p.feeBps ?? 0) : 0;
      return [s, m > 0 ? `~${fx(m)}` : ""] as const; })),
    [key, L, g, o?.budget, o?.feeBps, o?.q, p.curve, p.feeBps]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section className="tk-kind" aria-label="Kind of call">
      <div className="seg2 tk-seg" role="group" aria-label="Kind of call">
        {(["near", "between"] as const).map((k) => (
          <button key={k} className={desk.kind === k ? "on" : ""} aria-pressed={desk.kind === k} onClick={() => desk.switchKind(k)}>
            <KindIcon kind={k} />{k === "near" ? "Near a price" : "Between two prices"}
          </button>
        ))}
      </div>
      {/* How sure is a choice only near a price; a range is drawn on the chart, and the range box below says what to do. */}
      {desk.kind === "near" && <div className="chips tk-sure" role="group" aria-label="How sure are you" data-coach="sure">
        {list.map(([name, s]) => {
          const mult = mults.get(s) ?? "";
          return (
            <button key={s} className={`chip${on === s ? " on" : ""}`} aria-pressed={on === s} aria-label={sureLabel(name, s, mult)} title={sureLabel(name, s, mult)}
              onMouseEnter={() => desk.setPeek(s)} onMouseLeave={() => desk.setPeek(null)} onFocus={() => desk.setPeek(s)} onBlur={() => desk.setPeek(null)}
              onClick={() => { desk.setSure(s, p.at); p.onSure(); }}>
              {name}<small>{name === "Custom" ? `±${s}${mult ? " · " : ""}` : ""}{mult || "\u00a0"}</small>
            </button>
          );
        })}
      </div>}
    </section>
  );
}

/** The phone's one-row version of the kind and how sure, for the call bar. */
export function CallKindBar(p: { desk: Desk; grid: Grid; at: number; onSure: () => void }) {
  const { desk } = p;
  const on = desk.call?.kind === "near" ? desk.call.s : desk.lastS;
  return (
    <div className="tk-kbar">
      <div className="seg2" role="group" aria-label="Kind of call">
        {(["near", "between"] as const).map((k) => (
          <button key={k} className={desk.kind === k ? "on" : ""} aria-pressed={desk.kind === k} aria-label={k === "near" ? "Near a price" : "Between two prices"} onClick={() => desk.switchKind(k)}>
            {k === "near" ? "Near" : "Between"}
          </button>
        ))}
      </div>
      {desk.kind === "near" && <div className="seg2" role="group" aria-label="How sure are you" data-coach="sure-m">
        {sures(on).map(([name, s]) => (
          <button key={s} className={on === s ? "on" : ""} aria-pressed={on === s} aria-label={sureLabel(name, s)} onClick={() => { desk.setSure(s, p.at); p.onSure(); }}>{name === "Custom" ? `±${s}` : name}</button>
        ))}
      </div>}
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
    setNote(`Snapped to ${i === 0 ? `below ${g.fmt(g.edge(1))}` : i === 63 ? `above ${g.fmt(g.edge(63))}` : `${g.fmt(g.edge(i))} to ${g.fmt(g.edge(i + 1))}`}.${off && !p.all ? " Every row is showing now, so you can see it." : ""}`);
  };
  const row = (label: string, value: string, role: Role, edit: boolean, lo: boolean, hi: boolean) => (
    <div className="tk-step">
      <span className="k">{label}</span>
      <button onPointerDown={hold(role, -1)} onClick={(e) => { if (e.detail === 0) step(role, -1); }} disabled={lo} aria-label={`${label} down one row`}>▼</button>
      {edit ? <PriceField value={value} label={`${label} price`} onCommit={(t) => snap(role, t)} /> : <span className="val">{value}</span>}
      <button onPointerDown={hold(role, 1)} onClick={(e) => { if (e.detail === 0) step(role, 1); }} disabled={hi} aria-label={`${label} up one row`}>▲</button>
    </div>
  );
  let body: ReactNode;
  if (!c) body = <p className="tk-note">Pick a price on the chart first.</p>;
  else if (c.kind === "between") body = <>
    {row("Top", c.hi === 63 ? "no limit" : g.fmt(g.edge(c.hi + 1)), "hi", c.hi !== 63, false, c.hi === 63)}
    {row("Bottom", c.lo === 0 ? "no limit" : g.fmt(g.edge(c.lo)), "lo", c.lo !== 0, c.lo === 0, false)}
    <p className="tk-note">{c.hi - c.lo + 1} row{c.hi > c.lo ? "s" : ""}, each {(g.stepBps / 100).toFixed(2).replace(/\.?0+$/, "")}% of the price.</p>
  </>;
  else body = <>
    {row("Best price", g.fmt(g.edge(clamp(c.c, 1, 63))), "c", true, c.c <= g.flo, c.c >= g.fhi)}
    {row("Spread", `±${c.s} row${c.s > 1 ? "s" : ""}`, "w", false, c.s <= 1, c.s >= MAX_S)}
    <p className="tk-note">Full pay from {g.fmt(g.edge(clamp(c.c, 1, 63)))} to {g.fmt(g.edge(clamp(c.c + 1, 1, 63)))}. Less on each row away, nothing below {g.fmt(g.edge(Math.max(1, c.c - c.s)))} or above {g.fmt(g.edge(Math.min(63, c.c + c.s + 1)))}.</p>
  </>;
  return <>
    {body}
    {note && <p className="tk-note" role="status">{note}</p>}
    <label className="tk-all"><input type="checkbox" checked={p.all} onChange={(e) => p.setAll(e.target.checked)} /> Show every row (all 64)</label>
  </>;
}

function PriceField(p: { value: string; label: string; onCommit: (t: string) => void }) {
  const [text, setText] = useState<string | null>(null);
  return <input className="val input" value={text ?? p.value} inputMode="decimal" aria-label={p.label}
    onFocus={(e) => e.currentTarget.select()} onChange={(e) => setText(e.target.value)}
    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (text !== null) p.onCommit(text); setText(null); } else if (e.key === "Escape") setText(null); }}
    onBlur={() => { if (text !== null && text !== p.value) p.onCommit(text); setText(null); }} />;
}

// ── phones: the call, what it wins and Place, always on screen ──────────────
export function CallBar(p: { order: CallOrder; symbol: string; money: (u: bigint) => string; state: "open" | "closed"; closedText: string; pending: boolean; hasCall: boolean; held: boolean; controls?: ReactNode }) {
  const o = p.order;
  const modal = useWalletModal();
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
  const opts = o.unit === "usd" ? [1, 5, 10, 25, 50, 100] : [10, 50, 100, 250, 500, 1000];
  const typed = Number(o.text.replace(/,/g, ""));
  const all = opts.includes(typed) || !(typed > 0) ? opts : [...opts, typed].sort((a, b) => a - b);
  const win = p.state === "closed" ? <span className="dim">{p.closedText}</span>
    : o.toWin !== null && o.mult !== null && !o.stale ? <span>{p.money(o.toWin)} · {fx(o.mult)}</span>
    : <span className="dim">{p.pending ? "tap the other end" : p.hasCall ? "type a spend" : "pick a price"}</span>;
  const label = p.state === "closed" ? "Closed" : !o.connected ? "Connect" : o.send.isPending ? "Sending…" : o.short ? "Short" : p.held || o.existing ? "Add" : "Place";
  return (
    <div className="trade-mbar" ref={bar} onClick={() => { if (folded) setFolded(false); }}>
      {p.controls && p.state === "open" && <div className={`trade-mbar-ctl${folded ? " folded" : ""}`}>{p.controls}</div>}
      {p.controls && p.state === "open" && folded && <button className="trade-mbar-unfold" onClick={(e) => { e.stopPropagation(); setFolded(false); }} aria-expanded={false} aria-label="Show near or between and how sure">▴</button>}
      <div className="trade-mbar-row">
        <label className="sp"><span className="label">Spend {o.unit === "usd" ? "$" : p.symbol}</span>
          <select value={typed > 0 ? String(typed) : ""} onChange={(e) => o.setText(e.target.value)} aria-label={`Spend in ${o.unit === "usd" ? "dollars" : p.symbol}`} disabled={p.state === "closed"}>
            {!(typed > 0) && <option value="">…</option>}
            {all.map((v) => <option key={v} value={String(v)}>{v.toLocaleString("en-US")}</option>)}
          </select>
        </label>
        <div className="tw"><span className="label">To win</span>{win}</div>
        <button className="btn btn-sm" data-coach="place-m" disabled={p.state === "closed" || (o.connected && (!o.q || o.stale || o.send.isPending || o.short))} onClick={() => (o.connected ? o.submit() : modal.setVisible(true))}>{label}</button>
      </div>
    </div>
  );
}
