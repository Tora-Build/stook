// The price picture: the round as a chart you pick on. Each row is one band
// of the ladder (a "floor"), its price on the axis. Across the left part runs
// today's price, from the open to now; the shaded part on its right is the
// time left to the bell. The crowd's chance for each floor is a bar on the
// right. A call is a gold band across the chart: tap a row to call it, drag
// the gold tabs to change it. The two thin tails fold into one rooftop and
// one basement row, each a row you can call.
//
// Rows are real elements in a panel that scrolls on its own (pan-y, so a
// swipe scrolls and only a tap picks). Tabs are the only thing a finger
// drags, and a drag near the panel's edge scrolls it.
import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import type { stook } from "@sooth/sdk-solana";
import { between, callChance, callWords, clamp, fx, height, level as callLevel, MAX_S, nearAt, nudgeCall, pctText, rowWords, same, span, WIDEST_MSG, type Call, type Grid, type Role } from "../lib/call";
import type { Desk } from "../hooks/useDesk";
import { nyWhen } from "../lib/time";

export type Phase = "seeding" | "late" | "open" | "locked" | "settling" | "settled" | "void";

export interface HeldMark { key: string; shape: stook.Shape; label: string; sel: boolean }

/** What the call on the chart pays: a buy quoted from the amount box, or (`held`) a call you hold, from its own shares. */
export interface TowerWin { toWin: bigint | null; mult: number | null; at: (lv: number) => bigint; stale: boolean; held?: boolean }

interface Props {
  grid: Grid;
  desk: Desk;
  phase: Phase;
  live: number | null;
  /** [unix seconds, price] points of today's price. */
  history?: [number, number][];
  now: number;
  opened: boolean;
  opensAt: number;
  locksAt: number;
  settlesAt: number;
  settledBin: number | null;
  win: TowerWin;
  /** An amount said in full ("$9.29" or "2.9M SSt.") and short ("$9.29" or "2.9M"). */
  money: (u: bigint) => string;
  short: (u: bigint) => string;
  symbol: string;
  held: HeldMark[];
  onHeld: (key: string) => void;
  /** Settled: what your calls collect, said on the closing row. */
  wonText: string | null;
  /** The readout when the round is not taking calls. */
  headline: ReactNode;
  all: boolean;
  onPicked: () => void;
  /** Kept for callers that still pass them; the page draws its own head now. */
  sign?: RoofSign;
  ticker?: TickerItem[];
  status?: string;
  /** Something for the right end of the readout line (the page's view switch). */
  aside?: ReactNode;
  /** A drawing for the How page: a few rows tall, nothing sent. */
  demo?: { floors: number; legend?: boolean };
}

export interface RoofSign {
  symbol: string; name: string;
  logo?: string;
  coin?: { symbol: string; logo: string };
  paidIn: string;
  date: string; closes: string;
  plaque?: { short: string; full: string } | null;
  plaqueNode?: ReactNode;
  onHelp?: (() => void) | null;
}
export interface TickerItem { k: string; v: string; d?: string; tone?: "up" | "down" }

// ── metrics: the columns of a row, set from the chart's width ───────────────
interface Metrics {
  W: number; small: boolean; coarse: boolean;
  /** chart area, price axis and crowd column widths */
  cw: number; axW: number; crW: number; barMax: number;
  fh: number; th: number; tabW: number;
}
function metrics(W: number, coarse: boolean, all: boolean, chars: number): Metrics {
  const small = W < 600;
  const fh = coarse || small ? 36 : all ? 22 : 28;
  const axW = small ? Math.max(52, Math.ceil(chars * 6.6 + 12)) : Math.max(76, Math.ceil(chars * 7.6 + 24));
  const crW = small ? 76 : Math.round(clamp(W * 0.2, 150, 220));
  const cw = Math.max(80, W - axW - crW);
  const pcW = small ? 34 : 44;
  const tabW = small ? Math.max(64, Math.ceil(chars * 7 + 24)) : Math.max(88, Math.ceil(chars * 7.8 + 30));
  return { W, small, coarse, cw, axW, crW, barMax: Math.max(16, crW - pcW - 16), fh, th: small ? 24 : 26, tabW };
}

const clock = (t: number) => nyWhen(t, { hour: "numeric", minute: "2-digit" });

// ── one row ─────────────────────────────────────────────────────────────────
interface FloorProps {
  a: number; b: number;
  top: number; cls: string; fill: number; label: string; group: "roof" | "base" | null; groupWords: string;
  bar: number; barTone: "" | "in" | "best"; pct: string; pctLo: boolean;
  tag: string | null; won: string | null;
}
const Floor = memo(function Floor(p: FloorProps) {
  return (
    <div className={p.cls} style={{ top: p.top }} data-a={p.a} data-b={p.b}>
      {p.fill > 0 && <div className="tc-fill" style={{ opacity: p.fill }} />}
      {p.group && <span className="tc-group"><b>{p.group === "roof" ? "Rooftop" : "Basement"}</b> {p.groupWords}</span>}
      {p.label && <span className="tc-px">{p.label}</span>}
      <span className="tc-crowd"><i className={`tc-bar ${p.barTone}`} style={{ width: p.bar }} /><span className={`tc-pc${p.pctLo ? " lo" : ""}`}>{p.pct}</span></span>
      {p.tag && <span className="tc-win">{p.tag}</span>}
      {p.won && <span className="tc-win tc-won">{p.won}</span>}
    </div>
  );
});

/** Memoised: the page ticks every second, the chart redraws only when what it shows changes. */
export const Tower = memo(TowerView);

function TowerView(p: Props) {
  const { grid: g, desk } = p;
  const NR = g.rows.length;
  const interactive = p.phase === "open";
  const wrap = useRef<HTMLDivElement>(null);
  const sc = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(0);
  const [coarse, setCoarse] = useState(() => typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches);
  const [vh, setVh] = useState(() => (typeof window !== "undefined" ? window.innerHeight : 800));
  const [hover, setHover] = useState<number | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = wrap.current; if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(0, el.clientWidth)));
    ro.observe(el); setW(el.clientWidth);
    const mq = matchMedia("(pointer: coarse)"); const onMq = () => setCoarse(mq.matches); mq.addEventListener("change", onMq);
    const onR = () => setVh(window.innerHeight); window.addEventListener("resize", onR);
    return () => { ro.disconnect(); mq.removeEventListener("change", onMq); window.removeEventListener("resize", onR); };
  }, []);

  const chars = useMemo(() => Math.max(...[g.flo, g.fhi + 1, 1, 63].map((k) => g.fmt(g.edge(k)).length), 4), [g]);
  const M = useMemo(() => metrics(W || 800, coarse, p.all, chars), [W, coarse, p.all, chars]);
  const yTop = useCallback((r: number) => (NR - 1 - r) * M.fh, [NR, M.fh]);
  const liveBin = p.live !== null ? g.binOf(p.live) : null;
  const liveRow = liveBin !== null ? g.rowOf[liveBin]! : g.rowOf[32]!;
  const yOfPrice = useCallback((v: number) => {
    const i = g.binOf(v), r = g.rowOf[i]!, R = g.rows[r]!;
    if (R.g || i === 0 || i === 63) return yTop(r) + M.fh / 2;
    const f = Math.log(v / g.edge(i)) / (g.stepBps / 10_000);
    return yTop(r) + M.fh * (1 - clamp(f, 0, 1));
  }, [g, yTop, M.fh]);

  // A call not yet placed is only drawn while trading is open.
  const call = interactive && !desk.pending ? desk.call : null;
  const pendRow = interactive && desk.pending ? g.rowOf[desk.pending.a]! : null;
  const settledRow = p.settledBin !== null ? g.rowOf[p.settledBin]! : null;

  // ── rows ──
  const rowLevel = useCallback((c: Call, r: number) => { const R = g.rows[r]!; let mx = 0, mn = 1e9; for (let i = R.a; i <= R.b; i++) { const l = callLevel(c, i); mx = Math.max(mx, l); mn = Math.min(mn, l); } return { l: mx, part: mx > 0 && mn !== mx }; }, [g]);
  const peakRow = (c: Call) => (c.kind === "near" ? g.rowOf[clamp(c.c, 0, 63)]! : Math.round((g.rowOf[c.lo]! + g.rowOf[c.hi]!) / 2));
  const heldRows = useMemo(() => p.held.map((h) => {
    const rs: number[] = [];
    for (let r = 0; r < NR; r++) { const R = g.rows[r]!; for (let i = R.a; i <= R.b; i++) if (i >= h.shape.lo && i <= h.shape.hi) { rs.push(r); break; } }
    return { ...h, rs, top: rs.length ? Math.max(...rs) : -1, bot: rs.length ? Math.min(...rs) : -1 };
  }), [p.held, g, NR]);
  const winTag = p.win.toWin !== null && p.win.mult !== null ? `${p.win.held ? "Pays up to" : "Win up to"} ${p.short(p.win.toWin)}${M.small ? "" : ` · ${fx(p.win.mult)}`}` : null;
  const floors = useMemo(() => {
    const h = call ? height(call) : 1, pk = call ? peakRow(call) : -1;
    // The tag sits on the band's top row, like a label on the band.
    let topIn = -1;
    if (call) for (let r = NR - 1; r >= 0; r--) if (rowLevel(call, r).l) { topIn = r; break; }
    const out: FloorProps[] = [];
    for (let r = NR - 1; r >= 0; r--) {
      const R = g.rows[r]!;
      const { l, part } = call ? rowLevel(call, r) : { l: 0, part: false };
      const cls = ["tc-fl"];
      if (l) cls.push("in");
      if (part) cls.push("part");
      if (r === pk && l) cls.push("best");
      if (r === pendRow) cls.push("pend");
      if (R.g) cls.push(`tc-${R.g}-g`);
      if (heldRows.some((x) => x.rs.includes(r))) cls.push("held");
      if (r === settledRow) cls.push("won");
      // Full pay is the strongest gold; each floor away a little less.
      const fill = l ? 0.1 + 0.16 * (l / h) : 0;
      const label = R.g === "base" || R.a === 0 ? "" : g.fmt(g.edge(R.a));
      out.push({
        a: R.a, b: R.b, top: yTop(r), cls: cls.join(" "), fill, label,
        group: R.g ?? null, groupWords: R.g ? rowWords(g, r) : "",
        bar: Math.max(2, Math.round((R.p / g.pmax) * M.barMax)), barTone: r === pk && l ? "best" : l ? "in" : "", pct: pctText(R.p), pctLo: R.p < 0.01,
        tag: r === topIn && !p.win.stale ? winTag : null,
        won: r === settledRow ? (p.wonText ?? "Closed here") : null,
      });
    }
    return out;
  }, [call, g, NR, M, pendRow, heldRows, settledRow, winTag, p.win.stale, p.wonText, rowLevel, yTop]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── today's price, on a clock that runs to the bell ──
  const final = p.phase === "settled" || p.phase === "void";
  const t1 = final ? p.settlesAt : Math.min(p.now, p.settlesAt);
  const path = useMemo(() => {
    const pts = (p.history ?? []).filter((q) => q[1] > 0 && q[0] <= t1 && q[0] >= t1 - 86_400 * 2).sort((a, b) => a[0] - b[0]);
    const t0 = p.opened ? p.opensAt : pts.length ? Math.max(pts[0]![0], t1 - 86_400) : t1 - 86_400;
    const out = pts.filter((q) => q[0] >= t0), real = out.length;
    if (p.opened && g.p0 > 0 && (!out.length || out[0]![0] > t0)) out.unshift([t0, g.p0]);
    if (!final && p.live !== null) out.push([t1, p.live]);
    return { t0, pts: out, real };
  }, [p.history, p.opened, p.opensAt, p.live, t1, final, g.p0]);
  const HT = NR * M.fh;
  const span_ = Math.max(1, p.settlesAt - path.t0);
  const X = useCallback((t: number) => clamp((t - path.t0) / span_, 0, 1) * (M.cw - 2), [path.t0, span_, M.cw]);
  const up = p.live !== null && g.p0 > 0 && p.opened ? p.live >= g.p0 : true;
  const tipPrice = final ? (path.pts.length ? path.pts[path.pts.length - 1]![1] : null) : p.live;
  const chart = useMemo(() => {
    const Y = (v: number) => yOfPrice(v);
    const pts = path.pts.map(([t, v]) => [X(t), Y(v)] as const);
    const d = pts.map(([x, y], k) => `${k ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
    return { d, fill: pts.length > 1 ? `${d}L${pts[pts.length - 1]![0].toFixed(1)},${HT}L${pts[0]![0].toFixed(1)},${HT}Z` : "", end: pts.length ? pts[pts.length - 1]! : null };
  }, [path, X, yOfPrice, HT]);
  const nowX = final ? M.cw - 2 : X(p.now), lockX = X(p.locksAt);
  const carY = p.phase === "void" ? null : p.phase === "settled" && settledRow !== null && (tipPrice === null || g.rowOf[g.binOf(tipPrice)] !== settledRow) ? yTop(settledRow) + M.fh / 2 : tipPrice !== null ? yOfPrice(tipPrice) : null;
  // The axis tag names a price only when it is the price the dot stands on.
  const tagPrice = tipPrice !== null && (!final || (p.phase === "settled" && g.rowOf[g.binOf(tipPrice)] === settledRow)) ? tipPrice : null;

  // ── latest values for pointer and key handlers ──
  const cur = useRef({ g, desk, M, interactive, yTop, onPicked: p.onPicked });
  cur.current = { g, desk, M, interactive, yTop, onPicked: p.onPicked };
  const rowAtY = (cy: number) => { const t = inner.current!.getBoundingClientRect().top; return clamp(NR - 1 - Math.floor((cy - t) / cur.current.M.fh), 0, NR - 1); };

  const scrollToRow = useCallback((r: number, center = true) => {
    const el = sc.current; if (!el) return;
    const top = yTop(r), h = el.clientHeight;
    if (center) el.scrollTop = Math.round((top - h / 2 + M.fh / 2) / M.fh) * M.fh;
    else if (top < el.scrollTop + M.fh) el.scrollTop = top - M.fh;
    else if (top + M.fh > el.scrollTop + h - M.fh) el.scrollTop = top + 2 * M.fh - h;
  }, [yTop, M.fh]);
  const keepInView = (role: Role, c: Call) => {
    const i = role === "hi" && c.kind === "between" ? c.hi : role === "lo" && c.kind === "between" ? c.lo : c.kind === "near" ? (role === "w" ? c.c + c.s : c.c) : Math.round((c.lo + c.hi) / 2);
    scrollToRow(g.rowOf[clamp(i, 0, 63)]!, false);
  };

  // The chart opens once on the price right now (or the closing row, or the
  // call), and again only if the rows change height or all 64 are asked for.
  const placed = useRef<string>("");
  const anchor = useRef<{ y: number; key: string } | null>(null);
  useLayoutEffect(() => {
    const el = sc.current;
    if (!W || !el) return;
    const key = `${M.fh}|${p.all}`, y = yTop(g.rowOf[32]!);
    if (placed.current !== key) {
      // Wait until the rows overflow the panel: a grid read before the live price can be short.
      if (el.scrollHeight <= el.clientHeight + 2 || (settledRow === null && !desk.call && p.live === null && !final)) { anchor.current = { y, key }; return; }
      placed.current = key;
      const c = desk.call;
      scrollToRow(settledRow ?? (c ? g.rowOf[clamp(Math.round((span(c)[0] + span(c)[1]) / 2), 0, 63)]! : liveRow));
    } else if (anchor.current?.key === key && anchor.current.y !== y) {
      // Rows were added above: keep what is on screen (and a tab being dragged) where it was.
      const d = y - anchor.current.y;
      el.scrollTop += d;
      if (hd.current) hd.current.y0 += d;
    }
    anchor.current = { y, key };
  });

  // ── taps ──
  const tap = (r: number, shift: boolean) => {
    const { g, desk } = cur.current;
    if (!cur.current.interactive) return;
    const R = g.rows[r]!;
    setCursor(null); setHover(M.coarse ? null : r);
    const picked = () => cur.current.onPicked();
    if (desk.kind === "near") {
      if (R.g) { const roof = R.g === "roof"; desk.set(between(R.a, R.b), { undoable: true, msg: `The ${roof ? "rooftop" : "basement"} is a between call: the same pay on every price ${roof ? "above" : "below"} ${g.fmt(g.edge(roof ? R.a : R.b + 1))}.` }); picked(); return; }
      // The row already called: nothing changes, but it still counts as a pick (the guide waits on one).
      if (desk.call?.kind === "near" && desk.call.c === R.a && !desk.pending) { desk.setMsg(""); picked(); return; }
      desk.set(nearAt(g, R.a, desk.lastS), { undoable: true }); picked(); return;
    }
    if (desk.pending) { const q = desk.pending; desk.set(between(Math.min(q.a, R.a), Math.max(q.b, R.b)), { msg: q.a === R.a ? "One row. Pick another row to widen it." : "" }); picked(); return; }
    const c = desk.call;
    if (c?.kind === "between") {
      if (shift) { const nearLo = Math.abs(R.a - c.lo) <= Math.abs(R.b - c.hi); desk.set(nearLo ? between(R.a, c.hi) : between(c.lo, R.b)); return; }
      if (R.a >= c.lo && R.b <= c.hi) { desk.setMsg(""); return; }
    }
    if (R.g) { desk.set(between(R.a, R.b), { undoable: true, msg: `Drag the ${R.g === "roof" ? "▼" : "▲"} tab to stretch it.` }); picked(); return; }
    desk.startPending(R.a, R.b);
  };

  // ── pointer on the rows ──
  const ptr = useRef<{ id: number; type: string; x: number; y: number; row: number; st: number; drag: boolean } | null>(null);
  const hd = useRef<{ role: Role; y0: number; c0: Call; down: boolean; last: number | null } | null>(null);
  const sweep = useRef<{ bin: number; prev: number } | null>(null);
  const lastY = useRef(0);
  const auto = useRef<{ on: boolean; fn: ((y: number) => void) | null }>({ on: false, fn: null });
  const tick = () => {
    const a = auto.current, el = sc.current;
    if (!a.on || !el) return;
    const r = el.getBoundingClientRect(), z = 48, y = lastY.current;
    let v = 0;
    if (y < r.top + z) v = -Math.min(r.top + z - y, z); else if (y > r.bottom - z) v = Math.min(y - (r.bottom - z), z);
    if (v) { const before = el.scrollTop; el.scrollTop += Math.sign(v) * (2 + (Math.abs(v) / z) * 12); if (el.scrollTop !== before) a.fn?.(clamp(y, r.top + 2, r.bottom - 2)); }
    requestAnimationFrame(tick);
  };
  const startAuto = (fn: (y: number) => void) => { auto.current.fn = fn; if (!auto.current.on) { auto.current.on = true; requestAnimationFrame(tick); } };
  const stopAuto = () => { auto.current.on = false; auto.current.fn = null; };
  useEffect(() => () => stopAuto(), []);

  const sweepTo = (y: number) => {
    const s = sweep.current; if (!s) return;
    const { g, desk } = cur.current;
    const r = rowAtY(y); if (r === s.prev) return; s.prev = r; setHover(r);
    const A = g.rows[g.rowOf[s.bin]!]!, R = g.rows[r]!;
    if (desk.kind === "between") desk.drag(between(Math.min(A.a, R.a), Math.max(A.b, R.b)));
    else if (!R.g) desk.drag(nearAt(g, R.a, desk.lastS));
  };
  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (!interactive || e.button > 0 || (e.target as HTMLElement).closest(".tc-hdl,.tc-yours")) return;
    sc.current!.focus({ preventScroll: true });
    ptr.current = { id: e.pointerId, type: e.pointerType, x: e.clientX, y: e.clientY, row: rowAtY(e.clientY), st: sc.current!.scrollTop, drag: false };
    lastY.current = e.clientY;
    if (e.pointerType === "mouse") { sc.current!.setPointerCapture(e.pointerId); e.preventDefault(); }
  };
  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    lastY.current = e.clientY;
    const q = ptr.current;
    if (!q) { if (e.pointerType === "mouse" && !hd.current) { const r = rowAtY(e.clientY); setHover((h) => (h === r ? h : r)); } return; }
    if (q.id !== e.pointerId || q.type !== "mouse") return;
    if (!q.drag && Math.hypot(e.clientX - q.x, e.clientY - q.y) > 4) {
      q.drag = true; sweep.current = { bin: cur.current.g.rows[q.row]!.a, prev: -1 };
      startAuto(sweepTo);
    }
    if (q.drag) sweepTo(e.clientY);
  };
  const onUp = (e: RPointerEvent<HTMLDivElement>) => {
    const q = ptr.current;
    if (!q || q.id !== e.pointerId) return;
    ptr.current = null; stopAuto();
    if (q.drag) { sweep.current = null; if (cur.current.desk.call) cur.current.onPicked(); return; }
    if (Math.hypot(e.clientX - q.x, e.clientY - q.y) > 8 || Math.abs(sc.current!.scrollTop - q.st) > 2) return;
    tap(rowAtY(e.clientY), e.shiftKey);
  };

  // ── tabs ──
  const handleTo = (y: number) => {
    const h = hd.current; if (!h) return;
    const { g, desk, M } = cur.current, NRn = g.rows.length;
    const d = Math.round((h.y0 - (y - inner.current!.getBoundingClientRect().top)) / M.fh); // rows moved, up is positive
    if (d === h.last) return; h.last = d;
    const c0 = h.c0; let n: Call | null = null, msg = "";
    if (c0.kind === "between") {
      const rl = g.rowOf[c0.lo]!, rh = g.rowOf[c0.hi]!;
      if (h.role === "hi") { const r = clamp(rh + d, 0, NRn - 1); n = r >= rl ? between(g.rows[rl]!.a, g.rows[r]!.b) : between(g.rows[r]!.a, g.rows[rl]!.b); }
      else if (h.role === "lo") { const r = clamp(rl + d, 0, NRn - 1); n = r <= rh ? between(g.rows[r]!.a, g.rows[rh]!.b) : between(g.rows[rh]!.a, g.rows[r]!.b); }
      else if (h.role === "body") { const w = rh - rl, nl = clamp(rl + d, 0, NRn - 1 - w); n = between(g.rows[nl]!.a, g.rows[nl + w]!.b); }
    } else {
      if (h.role === "c") n = nearAt(g, c0.c + d, c0.s);
      else if (h.role === "w") { const s = c0.s + (h.down ? -d : d); n = nearAt(g, c0.c, s); if (s > MAX_S) msg = WIDEST_MSG; }
    }
    if (n && (!same(n, desk.call) || msg !== desk.msg)) { desk.drag(n, msg); if (!M.coarse) setHover(rowAtY(y)); }
  };
  const tabDown = (role: Role, down = false) => (e: RPointerEvent<HTMLDivElement>) => {
    const c = cur.current.desk.call;
    if (!interactive || !c) return;
    e.stopPropagation(); e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); (e.currentTarget as HTMLElement).focus({ preventScroll: true });
    lastY.current = e.clientY;
    // Moves count from where the tab was grabbed, so grabbing it off-centre never jumps the call.
    hd.current = { role, y0: e.clientY - inner.current!.getBoundingClientRect().top, c0: c, down, last: null };
    wrap.current?.classList.add("tc-dragging");
    startAuto(handleTo);
  };
  const tabMove = (e: RPointerEvent<HTMLDivElement>) => { if (!hd.current) return; lastY.current = e.clientY; handleTo(e.clientY); };
  const tabUp = () => { if (hd.current) { hd.current = null; stopAuto(); wrap.current?.classList.remove("tc-dragging"); } };

  const nudge = (role: Role, d: number) => {
    const c = desk.call; if (!c || !interactive) return;
    const n = nudgeCall(g, c, role, d);
    desk.set(n.call, { msg: n.msg }); keepInView(role, n.call);
  };
  const tabKey = (role: Role) => (e: KeyboardEvent<HTMLDivElement>) => {
    const c = desk.call; if (!c || !interactive) return;
    let d = 0;
    if (e.key === "ArrowUp" || e.key === "ArrowRight") d = 1; else if (e.key === "ArrowDown" || e.key === "ArrowLeft") d = -1;
    else if (e.key === "PageUp") d = 5; else if (e.key === "PageDown") d = -5;
    else if (e.key === "Home" || e.key === "End") {
      e.preventDefault(); const up = e.key === "End"; let n: Call;
      if (c.kind === "between") {
        if (role === "hi") n = between(c.lo, up ? 63 : c.lo); else if (role === "lo") n = between(up ? c.hi : 0, c.hi);
        else { const w = g.rowOf[c.hi]! - g.rowOf[c.lo]!; n = up ? between(g.rows[NR - 1 - w]!.a, 63) : between(0, g.rows[w]!.b); }
      } else n = role === "c" ? nearAt(g, up ? 63 : 0, c.s) : nearAt(g, c.c, up ? MAX_S : 1);
      desk.set(n); keepInView(role, n); return;
    } else if (e.key === "Escape") { desk.clear(); sc.current?.focus(); return; }
    if (!d) return;
    e.preventDefault();
    nudge(e.shiftKey && (role === "hi" || role === "lo") ? "body" : e.shiftKey && role === "w" ? "c" : role, d);
  };

  // ── keyboard on the rows ──
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== sc.current) return;
    const base = cursor ?? hover ?? liveRow;
    let n: number | null = null;
    if (e.key === "ArrowUp") n = base + 1; else if (e.key === "ArrowDown") n = base - 1; else if (e.key === "PageUp") n = base + 5; else if (e.key === "PageDown") n = base - 5; else if (e.key === "Home") n = NR - 1; else if (e.key === "End") n = 0;
    if (n !== null) { e.preventDefault(); const c = clamp(n, 0, NR - 1); setCursor(c); setHover(c); scrollToRow(c, false); return; }
    if (!interactive) return;
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); const c = cursor ?? base; tap(c, e.shiftKey); setCursor(c); }
    else if (e.key === "Escape") { if (desk.pending) desk.cancelPending(); else desk.clear(); }
  };

  // ── words ──
  const verb = M.coarse || M.small ? "Tap" : "Click";
  const liveText = useMemo(() => {
    const c = desk.call;
    if (!interactive) return "";
    if (desk.pending) return `Start set at ${g.fmt(g.edge(Math.max(1, desk.pending.a)))}. Pick the other end.`;
    if (!c) return "No call";
    return `If it closes ${callWords(g, c)}${p.win.toWin !== null && p.win.mult !== null ? `, ${p.win.held ? "your call pays" : "you win"} ${p.money(p.win.toWin)}, ${fx(p.win.mult).replace("×", " times")}` : ""}. The crowd gives that ${pctText(callChance(g, c)).replace("%", " percent")}.`;
  }, [desk.call, desk.pending, interactive, g, p.win.toWin, p.win.mult, p.win.held]); // eslint-disable-line react-hooks/exhaustive-deps

  // The line under the chart: what to do next, what the row under the pointer
  // pays, or (closed) what happened. What the call wins is the order card's job.
  let say: ReactNode, xBtn: ReactNode = null;
  if (!interactive) say = p.headline;
  else if (desk.pending) { say = <>Now {verb.toLowerCase()} the other end.</>; xBtn = <button className="tc-x" onClick={desk.cancelPending} aria-label="Cancel this range" title="Cancel this range">✕</button>; }
  else if (!desk.call) say = desk.kind === "near" ? <>{verb} the price where you think it closes at {clock(p.settlesAt)}.</> : <>{verb} one end of your range, then the other.</>;
  else {
    const c = desk.call;
    say = c.kind === "near"
      ? <>Best at <b>{rowWords(g, g.rowOf[clamp(c.c, 0, 63)]!)}</b>. Pays less further away.{M.coarse ? "" : " Drag the gold tabs to change it."}</>
      : <>Same pay {callWords(g, c)}.{M.coarse ? "" : " Drag the gold tabs to resize."}</>;
    xBtn = <button className="tc-x" onClick={desk.clear} aria-label="Clear your call" title="Clear your call">✕</button>;
  }
  const aimRow = cursor ?? hover;
  let aim: ReactNode = null, floorSay = "";
  if (interactive && (desk.msg || (desk.undo && aimRow === null))) aim = <>{desk.msg}{desk.msg && " "}{desk.undo && !desk.pending && <button className="tc-undo" onClick={desk.undoIt}>Undo</button>}</>;
  else if (interactive && desk.pending) aim = `Started at ${rowWords(g, pendRow!)}. Scroll if you need to; it waits.`;
  else if (aimRow !== null && aimRow < NR) {
    const R = g.rows[aimRow]!, name = R.g ? `${R.g === "roof" ? "Rooftop" : "Basement"}, ${rowWords(g, aimRow)}` : rowWords(g, aimRow);
    let tail = "";
    if (call && interactive) { const { l } = rowLevel(call, aimRow); tail = l ? (p.win.toWin !== null ? ` ${p.win.held ? "Your call pays" : "You win"} ${p.money(p.win.at(l))} here.` : "") : " Your call wins nothing here."; }
    const words = `${name}: the crowd gives it ${pctText(R.p)}.${tail}`;
    aim = words;
    if (aimRow === cursor) floorSay = words;
  }

  // Screen readers hear the row the keys move to, else the call (politely, after a beat).
  const [announced, setAnnounced] = useState("");
  const toSay = floorSay || liveText;
  useEffect(() => { const t = setTimeout(() => setAnnounced(toSay), 400); return () => clearTimeout(t); }, [toSay]);

  // ── tabs, on the band's edges at the chart's right ──
  const th = M.th, tabX = M.cw - M.tabW - 8;
  const tabs: ReactNode[] = [];
  const edges: number[] = [];
  const summary = call ? liveText : "";
  if (call && interactive) {
    const aria = (now: number, min: number, max: number, txt: string) => ({ role: "slider", "aria-valuenow": now, "aria-valuemin": min, "aria-valuemax": max, "aria-valuetext": `${txt}. ${summary}` });
    const common = (role: Role, down = false) => ({ onPointerDown: tabDown(role, down), onPointerMove: tabMove, onPointerUp: tabUp, onPointerCancel: tabUp, onKeyDown: tabKey(role), tabIndex: down ? -1 : 0 });
    const at = (y: number, w = M.tabW, x = tabX): CSSProperties => ({ top: Math.round(clamp(y - th / 2, 1, HT - th - 1)), left: x, width: w });
    if (call.kind === "between") {
      const rh = g.rowOf[call.hi]!, rl = g.rowOf[call.lo]!, t = yTop(rh), b = yTop(rl) + M.fh;
      tabs.push(<div key="hi" className="tc-hdl" style={at(t)} {...common("hi")} {...aria(rh, rl, NR - 1, `Top ${call.hi === 63 ? "no limit" : g.fmt(g.edge(call.hi + 1))}`)} aria-label="Top of your range"><span aria-hidden="true">▲</span>{call.hi === 63 ? "top" : g.fmt(g.edge(call.hi + 1))}</div>);
      tabs.push(<div key="lo" className="tc-hdl" style={at(b)} {...common("lo")} {...aria(rl, 0, rh, `Bottom ${call.lo === 0 ? "no limit" : g.fmt(g.edge(call.lo))}`)} aria-label="Bottom of your range"><span aria-hidden="true">▼</span>{call.lo === 0 ? "bottom" : g.fmt(g.edge(call.lo))}</div>);
      if (rh - rl >= 2 && !M.small) tabs.push(<div key="body" className="tc-hdl tc-body" style={at((t + b) / 2, 36, tabX + M.tabW - 36)} {...common("body")} {...aria(rl, 0, NR - 1 - (rh - rl), `Range ${callWords(g, call)}`)} aria-label="Move your whole range" title="Drag to move your whole range">≡</div>);
      edges.push(t, b);
    } else {
      const rc = g.rowOf[clamp(call.c, 0, 63)]!, upB = call.c + call.s, dn = call.c - call.s;
      const tT = yTop(g.rowOf[clamp(upB, 0, 63)]!), bB = yTop(g.rowOf[clamp(dn, 0, 63)]!) + M.fh;
      tabs.push(<div key="c" className="tc-hdl tc-cen" style={at(yTop(rc) + M.fh / 2)} {...common("c")} {...aria(call.c, 0, 63, `Your price ${g.fmt(g.edge(clamp(call.c, 1, 63)))}`)} aria-label="Your best price" title="Drag to move your call"><span aria-hidden="true">◆</span>{rowWords(g, rc).replace("below ", "<").replace("above ", ">")}</div>);
      const wAria = aria(call.s, 1, MAX_S, `Pays over plus or minus ${call.s} rows, from ${g.fmt(g.edge(Math.max(1, dn)))} to ${g.fmt(g.edge(Math.min(63, upB + 1)))}`);
      if (upB < 63) tabs.push(<div key="up" className="tc-hdl" style={at(tT)} {...common("w")} {...wAria} aria-label="How far it pays" title="Drag to pay over more or fewer rows"><span aria-hidden="true">▲</span>{g.fmt(g.edge(upB + 1))}</div>);
      if (dn > 0) tabs.push(<div key="dn" className="tc-hdl" style={at(bB)} {...common("w", true)} aria-hidden="true" title="Drag to pay over more or fewer rows"><span aria-hidden="true">▼</span>{g.fmt(g.edge(dn))}</div>);
      edges.push(tT, bB);
    }
  }

  // Your calls: one dashed box each over the rows it pays on. Calls whose top
  // row is the same share one tag; a press opens the next of them.
  const heldFn = useRef(p.onHeld); heldFn.current = p.onHeld;
  const heldTags = useMemo(() => {
    const tops = [...new Set(heldRows.filter((h) => h.top >= 0).map((h) => h.top))];
    return tops.map((top) => {
      const owners = heldRows.filter((x) => x.top === top), si = owners.findIndex((x) => x.sel);
      const o = owners[owners.length > 1 && si >= 0 ? (si + 1) % owners.length : Math.max(0, si)]!;
      return { top, key: o.key, label: o.label, n: owners.length, sel: si >= 0 };
    });
  }, [heldRows]);

  // Phones leave room for the header, the head of the card and the call bar.
  // Whole rows only, so the panel never opens on a half row.
  const scH = p.demo ? Math.min(HT, p.demo.floors * M.fh) : Math.min(HT, Math.floor((M.small ? clamp(vh - 420, 300, 520) : clamp(vh - 400, 360, 560)) / M.fh) * M.fh);
  // A finished round whose day has no price points to draw says so, not a blank plot.
  const noHist = final && path.real < 2;
  const vars = { "--tc-cw": `${M.cw}px`, "--tc-axw": `${M.axW}px`, "--tc-crw": `${M.crW}px`, "--tc-fh": `${M.fh}px`, "--tc-th": `${M.th}px` } as CSSProperties;

  // Off-screen marks: where the rest of the call, and the price now, are.
  const marks = useMemo(() => {
    const out: { y: number; label: string; now?: boolean; row: number }[] = [];
    const c = desk.pending ? null : desk.call;
    if (c && interactive) {
      if (c.kind === "between") { out.push({ y: yTop(g.rowOf[c.hi]!) + M.fh / 2, label: `top ${c.hi === 63 ? "no limit" : g.fmt(g.edge(c.hi + 1))}`, row: g.rowOf[c.hi]! }); out.push({ y: yTop(g.rowOf[c.lo]!) + M.fh / 2, label: `bottom ${c.lo === 0 ? "no limit" : g.fmt(g.edge(c.lo))}`, row: g.rowOf[c.lo]! }); }
      else out.push({ y: yTop(g.rowOf[clamp(c.c, 0, 63)]!) + M.fh / 2, label: "your call", row: g.rowOf[clamp(c.c, 0, 63)]! });
    }
    if (desk.pending && pendRow !== null) out.push({ y: yTop(pendRow) + M.fh / 2, label: "start", row: pendRow });
    if (settledRow !== null) out.push({ y: yTop(settledRow) + M.fh / 2, label: "closed here", row: settledRow });
    if (carY !== null && !final) out.push({ y: carY, label: "now", now: true, row: liveRow });
    return out;
  }, [desk.call, desk.pending, interactive, g, yTop, M.fh, pendRow, settledRow, carY, final, liveRow]);

  // A "how sure" being hovered: where that width would pay, as dashed lines with
  // its two prices, over the call's own; the call itself is unchanged.
  const peekSpan = (() => {
    const c = desk.call, s = desk.peek;
    if (!interactive || desk.pending || s === null || c?.kind !== "near" || s === c.s) return null;
    const u = Math.min(63, c.c + s), dn = Math.max(0, c.c - s);
    return { t: yTop(g.rowOf[u]!), b: yTop(g.rowOf[dn]!) + M.fh, hi: u >= 63 ? "top" : g.fmt(g.edge(u + 1)), lo: dn <= 0 ? "bottom" : g.fmt(g.edge(dn)) };
  })();
  const gid = `tcg${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const cls = ["tc", `tc-ph-${p.phase}`, interactive ? "" : "tc-still", M.small ? "tc-small" : "", p.demo ? "tc-demo" : ""].join(" ");
  const bell = clock(p.settlesAt), lockText = p.locksAt < p.settlesAt ? clock(p.locksAt) : null;

  return (
    <div ref={wrap} className={cls} style={vars}>
      <div className="tc-strip" aria-hidden="true">
        <span className="tc-t0">{p.opened ? `Open ${clock(p.opensAt)}` : "Last 24 h"}</span>
        <span className="tc-t1" style={{ right: M.axW + M.crW + 8 }}>{lockText && !final ? <><span className="dim">Calls close {lockText}</span> · </> : null}<b>{final ? "Rang" : "Bell"} {bell}</b></span>
        <span className="tc-t2" style={{ left: M.cw + M.axW }}>Crowd</span>
      </div>
      <div ref={sc} className="tc-sc" style={{ height: scH }} tabIndex={0} role="group" aria-label="The price chart. Each row is a price. Arrow keys move between rows, Enter picks one." aria-disabled={!interactive}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { ptr.current = null; stopAuto(); }}
        onPointerLeave={(e) => { if (!ptr.current && e.pointerType === "mouse") setHover(null); }} onKeyDown={onKey}>
        {noHist && <div className="tc-nohist" aria-hidden="true"><span style={{ left: M.cw / 2, top: Math.round(scH / 4) }}>No price history for this day</span></div>}
        <div ref={inner} className="tc-inner" style={{ height: HT }}>
          {/* the time left to the bell, and the lock */}
          {!final && <div className="tc-left" style={{ left: nowX, width: Math.max(0, M.cw - nowX) }} />}
          {floors.map((f, k) => <Floor key={NR - 1 - k} {...f} cls={f.cls + (NR - 1 - k === cursor ? " cur" : NR - 1 - k === hover ? " hov" : "")} />)}
          <svg className={`tc-chart ${up ? "tc-up" : "tc-down"}`} width={M.cw} height={HT} viewBox={`0 0 ${M.cw} ${HT}`} aria-hidden="true">
            <defs><linearGradient id={gid} x1="0" x2="0" y1="0" y2="1"><stop offset="0" className="tc-g0" /><stop offset="1" className="tc-g1" /></linearGradient></defs>
            {lockText && lockX > 0 && lockX < M.cw - 4 && !final && <line className="tc-lock" x1={lockX} x2={lockX} y1={0} y2={HT} />}
            <line className="tc-bell" x1={M.cw - 1} x2={M.cw - 1} y1={0} y2={HT} />
            {p.opened && g.p0 > 0 && <line className="tc-open" x1={0} x2={M.cw} y1={yOfPrice(g.p0)} y2={yOfPrice(g.p0)} />}
            {chart.fill && <path className="tc-area" d={chart.fill} fill={`url(#${gid})`} />}
            {chart.d && <path className="tc-line" d={chart.d} />}
            {carY !== null && !final && <line className="tc-nowline" x1={nowX} x2={M.cw} y1={carY} y2={carY} />}
            {carY !== null && <><circle className={final ? "tc-dot-h fin" : "tc-dot-h"} cx={final ? M.cw - 2 : nowX} cy={carY} r={12} /><circle className={final ? "tc-dot fin" : "tc-dot"} cx={final ? M.cw - 2 : nowX} cy={carY} r={5} /></>}
          </svg>
          {p.opened && g.p0 > 0 && <span className="tc-opentag" aria-hidden="true" style={{ top: Math.round(yOfPrice(g.p0)) + 3 }}>open</span>}
          {heldRows.map((h) => h.rs.length > 0 && <div key={h.key} className={`tc-heldbox${h.sel ? " sel" : ""}`} style={{ top: yTop(h.top), height: yTop(h.bot) + M.fh - yTop(h.top) }} aria-hidden="true" />)}
          {heldTags.map((t) => <button key={t.top} className={`tc-yours${t.sel ? " sel" : ""}`} style={{ top: yTop(t.top) + 3, left: Math.max(8, tabX - (M.small ? 64 : 84)) }} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); heldFn.current(t.key); }}
            aria-label={t.n > 1 ? `${t.n} of your calls start on this row. Open ${t.label}` : `Your call, ${t.label}. Open it to add or sell`}>{t.sel && t.n === 1 ? "Open" : "Yours"}{t.n > 1 ? ` ×${t.n}` : ""}</button>)}
          {carY !== null && tagPrice !== null && <span className={`tc-nowtag${final ? " fin" : ""}`} title={final ? "The close" : "The price now"} style={{ top: Math.round(carY - 11) }}>{g.fmt(tagPrice)}</span>}
          {edges.map((y, k) => <div key={k} className="tc-edge" style={{ top: y - 1 }} />)}
          {peekSpan && <>
            <div className="tc-edge tc-peek" style={{ top: peekSpan.t - 1 }}><span>▲ {peekSpan.hi}</span></div>
            <div className="tc-edge tc-peek" style={{ top: peekSpan.b - 1 }}><span>▼ {peekSpan.lo}</span></div>
          </>}
          {tabs}
        </div>
      </div>
      <OffChips sc={sc} marks={marks} left={M.cw / 2} onGo={(r) => scrollToRow(r)} />
      <div className="tc-foot">
        <div className="tc-say" aria-live="off">{aimRow !== null && aimRow < NR && aim ? aim : <>{say}{aim && <span className="tc-aim"> {aim}</span>}</>}</div>
        {xBtn}
        {p.aside}
      </div>
      {p.demo?.legend && <div className="tc-legend">
        <span><i className="lg-line" /> the price today</span>
        <span><i className="lg-bar" /> the crowd's chance</span>
        <span><i className="lg-band" /> what your call pays</span>
        {p.held.length > 0 && <span><i className="lg-held" /> a call you hold</span>}
      </div>}
      <div className="sr" aria-live="polite">{announced}</div>
    </div>
  );
}

/** Chips pinned to the chart's top and bottom edge for marks scrolled out of view. */
function OffChips(p: { sc: React.RefObject<HTMLDivElement>; marks: { y: number; label: string; now?: boolean; row: number }[]; left: number; onGo: (r: number) => void }) {
  const [view, setView] = useState<[number, number]>([0, 0]);
  useEffect(() => {
    const el = p.sc.current; if (!el) return;
    let raf = 0;
    const read = () => { raf = 0; setView([el.scrollTop, el.scrollTop + el.clientHeight]); };
    const on = () => { if (!raf) raf = requestAnimationFrame(read); };
    read(); el.addEventListener("scroll", on, { passive: true });
    const ro = new ResizeObserver(on); ro.observe(el);
    return () => { el.removeEventListener("scroll", on); ro.disconnect(); if (raf) cancelAnimationFrame(raf); };
  }, [p.sc]);
  const up = p.marks.filter((m) => m.y < view[0] + 4).slice(0, 2), dn = p.marks.filter((m) => m.y > view[1] - 4).slice(0, 2);
  const h = view[1] - view[0], top = p.sc.current?.offsetTop ?? 0;
  return <>
    {up.length > 0 && <div className="tc-off" style={{ top: top + 8, left: p.left }}>{up.map((m) => <button key={m.label} className={m.now ? "now" : ""} onClick={() => p.onGo(m.row)}>▲ {m.label}</button>)}</div>}
    {dn.length > 0 && <div className="tc-off" style={{ top: top + h - 40, left: p.left }}>{dn.map((m) => <button key={m.label} className={m.now ? "now" : ""} onClick={() => p.onGo(m.row)}>▼ {m.label}</button>)}</div>}
  </>;
}
