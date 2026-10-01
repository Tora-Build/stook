// The Tower: the round as a building. Each floor is one band of the ladder,
// its price on the left. Across the glass wing runs today's price, from the
// open to now; the elevator in the shaft is the price right now. Lit windows
// are the crowd's chance for the floor, gold coins what your call wins there.
// Tap a floor to call it; drag the gold tabs to change a call. The two thin
// tails fold into a rooftop and a basement, each one floor you can call.
//
// Floors are real elements in a panel that scrolls on its own (pan-y, so a
// swipe scrolls and only a tap picks). Tabs are the only thing a finger
// drags, and a drag near the panel's edge scrolls it.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import type { stook } from "@sooth/sdk-solana";
import { between, callChance, callWords, clamp, fx, height, level as callLevel, MAX_S, nearAt, nudgeCall, pctText, rowWords, same, span, WIDEST_MSG, type Call, type Grid, type Role } from "../lib/call";
import type { Desk } from "../hooks/useDesk";
import { nyWhen } from "../lib/time";
import { useNow } from "../hooks/useNow";

export type Phase = "seeding" | "late" | "open" | "locked" | "settling" | "settled" | "void";

export interface HeldMark { key: string; shape: stook.Shape; label: string; sel: boolean }

/** What the call on the tower pays: a buy quoted from the spend box, or (`held`) a call you hold, from its own shares. */
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
  /** A coin amount in full ("232 STOOK") and short ("232"). */
  money: (u: bigint) => string;
  short: (u: bigint) => string;
  symbol: string;
  held: HeldMark[];
  onHeld: (key: string) => void;
  /** Settled: what your calls collect, said on the winning floor. */
  wonText: string | null;
  /** The readout when the round is not taking calls. */
  headline: ReactNode;
  all: boolean;
  onPicked: () => void;
  /** The round on the roof: the billboard's lettering and the LED ticker. */
  sign: RoofSign;
  ticker: TickerItem[];
  /** Under the bell while trading: "locks in 1 h 23 min". */
  status: string;
  /** A drawing for the How page: no roof, a few floors tall, nothing sent. */
  demo?: { floors: number; legend?: boolean };
}

export interface RoofSign {
  /** What the round is on: "BTC", "Bitcoin". */
  symbol: string; name: string;
  /** The anchor's logo, or none (a devnet stand-in shows its ticker instead). */
  logo?: string;
  /** The coin it is paid in. */
  coin?: { symbol: string; logo: string };
  paidIn: string;
  date: string; closes: string;
  /** A small plaque under the billboard: short words, and the full note on tap or hover. */
  plaque?: { short: string; full: string } | null;
  /** Something the plaque carries instead, like the anchor's mint. */
  plaqueNode?: ReactNode;
  onHelp?: (() => void) | null;
}
export interface TickerItem { k: string; v: string; d?: string; tone?: "up" | "down" }

// ── pixel art ─────────────────────────────────────────────────────────────────
function pix(map: string[], pal: Record<string, string>, s = 2, ox = 0, oy = 0) {
  let o = "";
  map.forEach((row, y) => { for (let x = 0; x < row.length; x++) { const c = pal[row[x]!]; if (c) o += `<rect x="${ox + x * s}" y="${oy + y * s}" width="${s}" height="${s}" fill="${c}"/>`; } });
  return o;
}
const BELL = ["....aa....", "...abba...", "..abccba..", "..abccbb..", ".abcccbba.", ".abccbbba.", ".abcbbbba.", "abcbbbbbba", "aaaaaaaaaa", "....dd....", "....dd...."];
const BELLPAL = { a: "#b47416", b: "#f0a83a", c: "#ffe28a", d: "#f4e9c8" };
const TAXI = ["...aaaaaaa......", "..abbbabbba.....", "aaaaaaaaaaaaaaa.", "aacaaaaaaaaaaaac", "aaaaaaaaaaaaaaaa", ".dd.......dd....", ".dd.......dd...."];
const TAXIPAL = { a: "#f0a83a", b: "#1f3050", c: "#f4e9c8", d: "#0b1120" };
const CAR = ["cccccccc", "cabbbbac", "cabddbac", "cabddbac", "cabbbbac", "cabbbbac", "cccccccc"];
const CARPAL = { c: "#f4e9c8", a: "#1f3050", b: "#0b1120", d: "#f4e9c8" };
const ROPE = ["a..........a", "ab........ba", "abrr....rrba", "a..rrrrrr..a", "a..........a", "a..........a", "aa........aa"];
// the bell's finish flag: a pole and a checkered flag, 10×15
const FLAG = `<rect x="0" y="0" width="1" height="15" fill="#c9bfa4"/>` + Array.from({ length: 4 * 9 }, (_, k) => { const cx = k % 9, cy = Math.floor(k / 9); return `<rect x="${1 + cx}" y="${1 + cy}" width="1" height="1" fill="${(cx + cy) % 2 ? "#0b1120" : "#f4e9c8"}"/>`; }).join("");
const ROPEPAL = { a: "#f0a83a", b: "#ffe28a", r: "#c0392b" };

// ── metrics: the columns of a floor, set from the tower's width ─────────────
interface Metrics {
  W: number; small: boolean; coarse: boolean;
  plw: number; pw: number; shw: number; slots: number; ww: number; wg: number; wp: number; wa: number; pcw: number;
  cw: number; ct: number; pitch: number; tagW: number; th: number; fh: number; cps: number; peak: number; nowX: number;
}
function metrics(W: number, coarse: boolean, all: boolean, chars: number): Metrics {
  const small = W < 600;
  const b = small
    ? { shw: 6, slots: 5, ww: 5, wg: 1, wp: 2, pcw: 30, cw: 4, ct: 3, pitch: 6, tagW: 62, th: 26, minStacks: 1 }
    : { shw: 12, slots: 10, ww: 12, wg: 3, wp: 6, pcw: 56, cw: 12, ct: 4, pitch: 14, tagW: 156, th: coarse ? 28 : 22, minStacks: 8 };
  const fh = coarse || small ? 36 : all ? 24 : 28;
  const cps = Math.max(2, Math.floor((fh - 8) / b.ct));
  const wa = b.slots * b.ww + (b.slots - 1) * b.wg + 2 * b.wp;
  // The price column fits the longest price and the tab that covers it.
  const plw = small ? Math.max(44, Math.ceil((chars + 1) * 5.6 + 8)) : Math.max(84, Math.ceil((chars + 2) * 7.3 + 14));
  const fixed = plw + b.shw + wa + b.pcw;
  const coinNeed = b.tagW + b.minStacks * b.pitch + (small ? 40 : 58) + 8;
  // Phones give the glass, and today's price on it, nearly half the tower.
  const pw = Math.round(small ? clamp(W - fixed - coinNeed, W * 0.34, W * 0.47) : clamp(W - fixed - coinNeed, 180, W * 0.42));
  const coinW = W - fixed - pw;
  // Room on the best floor for the WIN tag and a YOURS tag beside it.
  const heldW = small ? 40 : 58;
  const stacks = Math.max(1, Math.floor((coinW - b.tagW - heldW - 8) / b.pitch));
  return { W, small, coarse, ...b, fh, cps, wa, plw, pw, peak: stacks * cps, nowX: plw + pw + b.shw / 2 };
}

const coinCache = new Map<string, string>();
/** `n` coins, stacked from the windows outward, `cps` to a stack. */
function coins(n: number, M: Metrics): string {
  const k = `${n}|${M.cps}|${M.cw}|${M.ct}|${M.pitch}`;
  const hit = coinCache.get(k); if (hit) return hit;
  const st = Math.ceil(n / M.cps), t = M.ct, W = st * M.pitch - (M.pitch - M.cw) + 4, base = M.cps * t + 1, H = base + 3;
  let o = "";
  for (let s = 0; s < st; s++) {
    const cnt = Math.min(M.cps, n - s * M.cps), x = 2 + s * M.pitch;
    for (let j = 0; j < cnt; j++) {
      const y = base - (j + 1) * t;
      o += `<rect x="${x}" y="${y + t - 1}" width="${M.cw}" height="1" fill="#8a5a12"/><rect x="${x}" y="${y + 1}" width="${M.cw}" height="${Math.max(1, t - 2)}" fill="#f0a83a"/><rect x="${x + 1}" y="${y}" width="${Math.max(1, M.cw - 2)}" height="1" fill="#ffe28a"/>`;
      if (M.cw >= 6) o += `<rect x="${x + 2}" y="${y + 1}" width="${Math.max(1, Math.round(M.cw / 6))}" height="${Math.max(1, t - 2)}" fill="#ffd166"/>`;
    }
  }
  o += `<rect x="0" y="${base}" width="${W}" height="3" fill="#8d8670"/><rect x="0" y="${base}" width="${W}" height="1" fill="#c9bfa4"/>`;
  const svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" shape-rendering="crispEdges" aria-hidden="true">${o}</svg>`;
  coinCache.set(k, svg);
  return svg;
}

const hms = (t: number) => { t = Math.max(0, Math.floor(t)); const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60; return (h ? `${h}:${String(m).padStart(2, "0")}` : `${m}`) + ":" + String(s).padStart(2, "0"); };
const clock = (t: number) => nyWhen(t, { hour: "numeric", minute: "2-digit" });

// ── one floor ───────────────────────────────────────────────────────────────
interface FloorProps {
  a: number; b: number;
  top: number; cls: string; label: string; labDim: boolean; group: "roof" | "base" | null; groupWords: string;
  lit: number; half: boolean; slots: number; coinsHtml: string; part: boolean; tag: string | null; tagTwo: boolean;
  pct: string; pctLo: boolean; heldKey: string | null; heldLabel: string; heldSel: boolean; heldN: number; won: string | null; onHeld: (k: string) => void;
}
const Floor = memo(function Floor(p: FloorProps) {
  const w: ReactNode[] = [];
  for (let k = 0; k < p.slots; k++) w.push(<i key={k} className={`tw-w${k < p.lit ? " on" : k === p.lit && p.half ? " half" : ""}`} />);
  return (
    <div className={p.cls} style={{ top: p.top }} data-a={p.a} data-b={p.b}>
      <div className="tw-pl">{p.labDim ? <span className="tw-dimw">{p.label}</span> : p.label}</div>
      {p.group ? <div className="tw-pa tw-sg"><span className="k">{p.group === "roof" ? "ROOFTOP" : "BASEMENT"}</span><span className="v">{p.groupWords}</span></div> : <div className="tw-pa" />}
      <div className="tw-sh" />
      <div className="tw-wn">{w}</div>
      <div className={`tw-co${p.part ? " part" : ""}`}>
        {p.coinsHtml && <span className="tw-coins" dangerouslySetInnerHTML={{ __html: p.coinsHtml }} />}
        {p.tag && (p.tagTwo ? <span className="tw-tag two">{p.tag.split("\n").map((t, i) => <span key={i}>{t}</span>)}</span> : <span className="tw-tag">{p.tag}</span>)}
        {p.won && <span className={`tw-tag tw-won-tag${p.tagTwo ? " two" : ""}`}>{p.tagTwo ? p.won.split(" · ").map((t, i) => <span key={i}>{t}</span>) : p.won.replace(" · ", " ")}</span>}
        {p.heldKey && <button className={`tw-held-tag${p.heldSel ? " sel" : ""}`} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); p.onHeld(p.heldKey!); }} aria-label={p.heldN > 1 ? `${p.heldN} of your calls start on this floor. Open ${p.heldLabel}` : `Your call, ${p.heldLabel}. Open it to add or sell`}>{p.heldSel && p.heldN === 1 ? "OPEN" : "YOURS"}{p.heldN > 1 ? ` ×${p.heldN}` : ""}</button>}
      </div>
      <div className={`tw-pc${p.pctLo ? " lo" : ""}`}>{p.pct}</div>
    </div>
  );
});



/** Memoised: the page ticks every second, the tower redraws only when what it shows changes. */
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

  // ── floors ──
  const rowLevel = useCallback((c: Call, r: number) => { const R = g.rows[r]!; let mx = 0, mn = 1e9; for (let i = R.a; i <= R.b; i++) { const l = callLevel(c, i); mx = Math.max(mx, l); mn = Math.min(mn, l); } return { l: mx, part: mx > 0 && mn !== mx }; }, [g]);
  const peakRow = (c: Call) => (c.kind === "near" ? g.rowOf[clamp(c.c, 0, 63)]! : Math.round((g.rowOf[c.lo]! + g.rowOf[c.hi]!) / 2));
  const heldRows = useMemo(() => p.held.map((h) => {
    const rs: number[] = [];
    for (let r = 0; r < NR; r++) { const R = g.rows[r]!; for (let i = R.a; i <= R.b; i++) if (i >= h.shape.lo && i <= h.shape.hi) { rs.push(r); break; } }
    return { ...h, rs, top: rs.length ? Math.max(...rs) : -1 };
  }), [p.held, g, NR]);
  const winTag = p.win.toWin !== null && p.win.mult !== null ? (M.small ? `WIN ${p.short(p.win.toWin)}\n${fx(p.win.mult)}` : `WIN ${p.short(p.win.toWin)} · ${fx(p.win.mult)}`) : null;
  const floors = useMemo(() => {
    const h = call ? height(call) : 1, pk = call ? peakRow(call) : -1;
    const out: Omit<FloorProps, "onHeld">[] = [];
    for (let r = NR - 1; r >= 0; r--) {
      const R = g.rows[r]!;
      const { l, part } = call ? rowLevel(call, r) : { l: 0, part: false };
      const cls = ["tw-fl"];
      if (l) cls.push("in");
      if (r === pendRow) cls.push("pend");
      if (R.g) cls.push(`tw-${R.g}-g`);
      const hr = heldRows.filter((x) => x.rs.includes(r));
      if (hr.length) cls.push(hr.some((x) => x.sel) ? "heldsel" : "held");
      if (r === settledRow) cls.push("won");
      // Calls whose top floor this is share one tag; a press opens the next of them.
      const owners = heldRows.filter((x) => x.top === r), si = owners.findIndex((x) => x.sel);
      // A phone floor holds one tag: where the WIN tag is, the dashed outline marks your call.
      const crowded = M.small && r === pk && l > 0 && !!winTag;
      const tagOwner = owners.length && !crowded ? owners[owners.length > 1 && si >= 0 ? (si + 1) % owners.length : Math.max(0, si)] : undefined;
      const x = (R.p / g.pmax) * M.slots, lit = Math.floor(x + 1e-9);
      // The call's best floor fills the coin space; every other floor is its share of that.
      const n = l ? Math.max(1, Math.round((M.peak * l) / h)) : 0;
      out.push({
        a: R.a, b: R.b, top: yTop(r), cls: cls.join(" "), label: R.g === "base" ? "below" : R.a === 0 ? "below" : g.fmt(g.edge(R.a)), labDim: R.g === "base",
        group: R.g ?? null, groupWords: R.g ? rowWords(g, r) : "", lit, half: x - lit >= 0.3, slots: M.slots,
        coinsHtml: n ? coins(n, M) : "", part, tag: r === pk && l ? (p.win.stale ? null : winTag) : null, tagTwo: M.small,
        pct: pctText(R.p), pctLo: R.p < 0.01, heldKey: tagOwner?.key ?? null, heldLabel: tagOwner?.label ?? "", heldSel: si >= 0, heldN: owners.length,
        won: r === settledRow ? (p.wonText ?? "CLOSED · HERE") : null,
      });
    }
    return out;
  }, [call, g, NR, M, pendRow, heldRows, settledRow, winTag, p.win.stale, p.wonText, rowLevel, yTop]); // eslint-disable-line react-hooks/exhaustive-deps
  // One stable handler for every floor, so a new callback never redraws them.
  const heldFn = useRef(p.onHeld); heldFn.current = p.onHeld;
  const onHeld = useCallback((k: string) => heldFn.current(k), []);

  // ── today's price over the glass ──
  const final = p.phase === "settled" || p.phase === "void";
  const t1 = final ? p.settlesAt : Math.min(p.now, p.settlesAt);
  const path = useMemo(() => {
    const pts = (p.history ?? []).filter((q) => q[1] > 0 && q[0] <= t1 && q[0] >= t1 - 86_400 * 2).sort((a, b) => a[0] - b[0]);
    const t0 = p.opened ? p.opensAt : pts.length ? Math.max(pts[0]![0], t1 - 86_400) : t1 - 86_400;
    const out = pts.filter((q) => q[0] >= t0);
    if (p.opened && g.p0 > 0 && (!out.length || out[0]![0] > t0)) out.unshift([t0, g.p0]);
    if (!final && p.live !== null) out.push([t1, p.live]);
    return { t0, pts: out };
  }, [p.history, p.opened, p.opensAt, p.live, t1, final, g.p0]);
  const chartW = M.pw + Math.round(M.shw / 2), HT = NR * M.fh;
  const chartSvg = useMemo(() => {
    const { t0, pts } = path, span_ = Math.max(1, t1 - t0);
    const X = (t: number) => Math.round(clamp((t - t0) / span_, 0, 1) * (chartW - 1)), Y = (v: number) => Math.round(yOfPrice(v));
    let o = "";
    if (p.opened && g.p0 > 0) { const yo = Y(g.p0); for (let x = 0; x < chartW; x += 6) o += `<rect x="${x}" y="${yo}" width="3" height="1" class="to"/>`; }
    let sh = "", ln = "", fill = "";
    for (let k = 0; k < pts.length - 1; k++) {
      const x0 = X(pts[k]![0]), x1 = X(pts[k + 1]![0]), y0 = Y(pts[k]![1]), y1 = Y(pts[k + 1]![1]);
      ln += `<rect x="${x0}" y="${y0 - 1}" width="${Math.max(1, x1 - x0 + 1)}" height="2" class="tl"/>`;
      if (y1 !== y0) ln += `<rect x="${x1 - 1}" y="${Math.min(y0, y1) - 1}" width="2" height="${Math.abs(y1 - y0) + 2}" class="tl"/>`;
      sh += `<rect x="${x0 + 1}" y="${y0 + 1}" width="${Math.max(1, x1 - x0 + 1)}" height="1" class="ts"/>`;
      if (x1 > x0) fill += `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${Math.max(0, HT - y0)}" class="tf"/>`;
    }
    return fill + o + sh + ln;
  }, [path, t1, chartW, HT, yOfPrice, p.opened, g.p0]);
  const carS = M.small ? 2 : 3, carW = 8 * carS, carH = 7 * carS;
  const tipPrice = final ? (path.pts.length ? path.pts[path.pts.length - 1]![1] : null) : p.live;
  const carY = p.phase === "void" ? null : p.phase === "settled" && settledRow !== null && (tipPrice === null || g.rowOf[g.binOf(tipPrice)] !== settledRow) ? yTop(settledRow) + M.fh / 2 : tipPrice !== null ? yOfPrice(tipPrice) : null;
  const carHtml = useMemo(() => pix(CAR, CARPAL, carS), [carS]);
  // The car's tag names a price only when it is the price the car stands on.
  const tagPrice = tipPrice !== null && (!final || (p.phase === "settled" && g.rowOf[g.binOf(tipPrice)] === settledRow)) ? tipPrice : null;

  // ── latest values for pointer and key handlers ──
  const cur = useRef({ g, desk, M, interactive, yTop, onPicked: p.onPicked });
  cur.current = { g, desk, M, interactive, yTop, onPicked: p.onPicked };
  const rowAtY = (cy: number) => { const t = inner.current!.getBoundingClientRect().top; return clamp(NR - 1 - Math.floor((cy - t) / cur.current.M.fh), 0, NR - 1); };

  const scrollToRow = useCallback((r: number, center = true) => {
    const el = sc.current; if (!el) return;
    const top = yTop(r), h = el.clientHeight;
    if (center) el.scrollTop = top - h / 2 + M.fh / 2;
    else if (top < el.scrollTop + M.fh) el.scrollTop = top - M.fh;
    else if (top + M.fh > el.scrollTop + h - M.fh) el.scrollTop = top + 2 * M.fh - h;
  }, [yTop, M.fh]);
  const keepInView = (role: Role, c: Call) => {
    const i = role === "hi" && c.kind === "between" ? c.hi : role === "lo" && c.kind === "between" ? c.lo : c.kind === "near" ? (role === "w" ? c.c + c.s : c.c) : Math.round((c.lo + c.hi) / 2);
    scrollToRow(g.rowOf[clamp(i, 0, 63)]!, false);
  };

  // The tower opens once on the price right now (or the landing floor, or the
  // call), and again only if the floors change height or all 64 are asked for.
  const placed = useRef<string>("");
  const anchor = useRef<{ y: number; key: string } | null>(null);
  useLayoutEffect(() => {
    const el = sc.current;
    if (!W || !el) return;
    const key = `${M.fh}|${p.all}`, y = yTop(g.rowOf[32]!);
    if (placed.current !== key) {
      placed.current = key;
      const c = desk.call;
      scrollToRow(settledRow ?? (c ? g.rowOf[clamp(Math.round((span(c)[0] + span(c)[1]) / 2), 0, 63)]! : liveRow));
    } else if (anchor.current?.key === key && anchor.current.y !== y) {
      // Floors were added above: keep what is on screen (and a tab being dragged) where it was.
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
      if (R.g) { const roof = R.g === "roof"; desk.set(between(R.a, R.b), { undoable: true, msg: `The ${roof ? "rooftop" : "basement"} is a between call: same pay on every price ${roof ? "above" : "below"} ${g.fmt(g.edge(roof ? R.a : R.b + 1))}.` }); picked(); return; }
      // The floor already called: nothing changes, but it still counts as a pick (the guide waits on one).
      if (desk.call?.kind === "near" && desk.call.c === R.a && !desk.pending) { desk.setMsg(""); picked(); return; }
      desk.set(nearAt(g, R.a, desk.lastS), { undoable: true }); picked(); return;
    }
    if (desk.pending) { const q = desk.pending; desk.set(between(Math.min(q.a, R.a), Math.max(q.b, R.b)), { msg: q.a === R.a ? "One floor. Tap another floor to widen it." : "" }); picked(); return; }
    const c = desk.call;
    if (c?.kind === "between") {
      if (shift) { const nearLo = Math.abs(R.a - c.lo) <= Math.abs(R.b - c.hi); desk.set(nearLo ? between(R.a, c.hi) : between(c.lo, R.b)); return; }
      if (R.a >= c.lo && R.b <= c.hi) { desk.setMsg(""); return; }
    }
    if (R.g) { desk.set(between(R.a, R.b), { undoable: true, msg: `Drag the ${R.g === "roof" ? "▼" : "▲"} tab to stretch it.` }); picked(); return; }
    desk.startPending(R.a, R.b);
  };

  // ── pointer on the floors ──
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
    if (!interactive || e.button > 0 || (e.target as HTMLElement).closest(".tw-hdl,.tw-held-tag")) return;
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
    const d = Math.round((h.y0 - (y - inner.current!.getBoundingClientRect().top)) / M.fh); // floors moved, up is positive
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
    wrap.current?.classList.add("tw-dragging");
    startAuto(handleTo);
  };
  const tabMove = (e: RPointerEvent<HTMLDivElement>) => { if (!hd.current) return; lastY.current = e.clientY; handleTo(e.clientY); };
  const tabUp = () => { if (hd.current) { hd.current = null; stopAuto(); wrap.current?.classList.remove("tw-dragging"); } };

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

  // ── keyboard on the floors ──
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

  let say: ReactNode, xBtn: ReactNode = null;
  if (!interactive) say = p.headline;
  else if (desk.pending) { say = <>Now {verb.toLowerCase()} the other end.</>; xBtn = <button className="tw-x" onClick={desk.cancelPending} aria-label="Cancel this range" title="Cancel this range">✕</button>; }
  else if (!desk.call) say = desk.kind === "near" ? <>{verb} the floor where you think the price stops at {clock(p.settlesAt)}.</> : <>{verb} the floor at one end, then the other end.</>;
  else {
    const c = desk.call, pr = callChance(g, c);
    say = p.win.toWin !== null && p.win.mult !== null
      ? (p.win.held
        ? <>Your call: if it closes {callWords(g, c)}, it pays <b>{p.money(p.win.toWin)}</b> ({fx(p.win.mult)} what you paid). The crowd gives that {pctText(pr)}.</>
        : <>If it closes {callWords(g, c)}, you win <b>{p.money(p.win.toWin)}</b> ({fx(p.win.mult)}). The crowd gives that {pctText(pr)}.</>)
      : <>If it closes {callWords(g, c)}, the crowd gives that {pctText(pr)}. Type what you spend to see what it wins.</>;
    xBtn = <button className="tw-x" onClick={desk.clear} aria-label="Clear your call" title="Clear your call">✕</button>;
  }
  // On a round the roof's notice board speaks instead of the sentence above:
  // what to do next, or what the floor under the pointer pays. What the call
  // wins is the ticket's job, so it is not repeated here.
  let tag = "", note: ReactNode = null;
  if (!interactive) { tag = "THE ROUND"; note = p.headline; }
  else if (desk.pending) { tag = "RANGE"; note = say; }
  else if (!desk.call) { tag = "START"; note = say; }
  else {
    tag = "YOUR CALL"; const c = desk.call;
    note = c.kind === "near"
      ? <>Best {callWords(g, c)} · pays from {g.fmt(g.edge(Math.max(1, c.c - c.s)))} to {g.fmt(g.edge(Math.min(63, c.c + c.s + 1)))}</>
      : <>Same pay {callWords(g, c)}{M.coarse ? "" : " · drag ▲ ▼ to resize"}</>;
  }
  const aimRow = cursor ?? hover;
  let aim: ReactNode = null, floorSay = "";
  if (interactive && (desk.msg || (desk.undo && aimRow === null))) aim = <>{desk.msg}{desk.msg && " "}{desk.undo && !desk.pending && <button className="tw-undo" onClick={desk.undoIt}>Undo</button>}</>;
  else if (interactive && desk.pending) aim = `Started at ${rowWords(g, pendRow!)}. Scroll if you need to; it waits.`;
  else if (aimRow !== null && aimRow < NR) {
    const R = g.rows[aimRow]!, name = R.g ? `${R.g === "roof" ? "Rooftop" : "Basement"}, ${rowWords(g, aimRow)}` : `Floor ${rowWords(g, aimRow)}`;
    let tail = "";
    if (call && interactive) { const { l } = rowLevel(call, aimRow); tail = l ? (p.win.toWin !== null ? ` ${p.win.held ? "Your call pays" : "You win"} ${p.money(p.win.at(l))} here.` : "") : " Your call wins nothing here."; }
    const words = `${name}: the crowd gives it ${pctText(R.p)}.${tail}`;
    aim = words;
    if (aimRow === cursor) floorSay = words;
  } else if (interactive && call && !M.small && p.demo) {
    aim = call.kind === "near" ? `Nearby floors pay less. Nothing pays below ${g.fmt(g.edge(Math.max(1, call.c - call.s)))} or above ${g.fmt(g.edge(Math.min(63, call.c + call.s + 1)))}.` : "Every floor inside pays the same. Drag the ▲ ▼ tabs to change it.";
  }

  // Screen readers hear the floor the keys move to, else the call (politely, after a beat).
  const [announced, setAnnounced] = useState("");
  const toSay = floorSay || liveText;
  useEffect(() => { const t = setTimeout(() => setAnnounced(toSay), 400); return () => clearTimeout(t); }, [toSay]);

  // ── tabs, where the price label of their line sits ──
  const th = M.th;
  const tabs: ReactNode[] = [];
  const edges: number[] = [];
  const summary = call ? liveText : "";
  if (call && interactive) {
    const aria = (now: number, min: number, max: number, txt: string) => ({ role: "slider", "aria-valuenow": now, "aria-valuemin": min, "aria-valuemax": max, "aria-valuetext": `${txt}. ${summary}` });
    const common = (role: Role, down = false) => ({ onPointerDown: tabDown(role, down), onPointerMove: tabMove, onPointerUp: tabUp, onPointerCancel: tabUp, onKeyDown: tabKey(role), tabIndex: down ? -1 : 0 });
    if (call.kind === "between") {
      const rh = g.rowOf[call.hi]!, rl = g.rowOf[call.lo]!, t = yTop(rh), b = yTop(rl) + M.fh;
      // One floor: the ▲ tab sits above it and the ▼ tab below it, so both can be grabbed.
      const one = rh === rl;
      const hiTop = rh < NR - 1 ? t - th : t + 1, loTop = one && (hiTop > t || rl === 0) ? (rl > 0 ? b + 1 : b - th - 1) : b - th - 1;
      tabs.push(<div key="hi" className="tw-hdl" style={{ top: one && rh === NR - 1 && rl === 0 ? t - th : hiTop }} {...common("hi")} {...aria(rh, rl, NR - 1, `Top ${call.hi === 63 ? "no limit" : g.fmt(g.edge(call.hi + 1))}`)} aria-label="Top of your range">▲ {call.hi === 63 ? "top" : g.fmt(g.edge(call.hi + 1))}</div>);
      tabs.push(<div key="lo" className="tw-hdl" style={{ top: loTop }} {...common("lo")} {...aria(rl, 0, rh, `Bottom ${call.lo === 0 ? "no limit" : g.fmt(g.edge(call.lo))}`)} aria-label="Bottom of your range">▼ {call.lo === 0 ? "bottom" : g.fmt(g.edge(call.lo))}</div>);
      if (rh - rl >= 2 && !M.small) { const mr = Math.round((rh + rl) / 2) - 1; tabs.push(<div key="body" className="tw-hdl body" style={{ top: yTop(mr) + (M.fh - th) / 2 }} {...common("body")} {...aria(rl, 0, NR - 1 - (rh - rl), `Range ${callWords(g, call)}`)} aria-label="Move your whole range" title="Drag to move your whole range">≡</div>); }
      edges.push(t - 1, b - 2);
    } else {
      const rc = g.rowOf[clamp(call.c, 0, 63)]!, up = call.c + call.s, dn = call.c - call.s;
      tabs.push(<div key="c" className="tw-hdl cen" style={{ top: yTop(rc) + M.fh - th - 1 }} {...common("c")} {...aria(call.c, 0, 63, `Your floor ${g.fmt(g.edge(clamp(call.c, 1, 63)))}`)} aria-label="Your floor" title="Drag to move your call">◆ {rowWords(g, rc).replace("below ", "<").replace("above ", ">")}</div>);
      const wAria = aria(call.s, 1, MAX_S, `Pays over plus or minus ${call.s} floors, from ${g.fmt(g.edge(Math.max(1, dn)))} to ${g.fmt(g.edge(Math.min(63, up + 1)))}`);
      if (up < 63) { const r = g.rowOf[up]!, t = yTop(r); tabs.push(<div key="up" className="tw-hdl" style={{ top: r < NR - 1 ? t - th : t + 1 }} {...common("w")} {...wAria} aria-label="How far it pays" title="Drag to pay over more or fewer floors">▲ {g.fmt(g.edge(up + 1))}</div>); }
      if (dn > 0) { const b = yTop(g.rowOf[dn]!) + M.fh; tabs.push(<div key="dn" className="tw-hdl" style={{ top: b - th - 1 }} {...common("w", true)} aria-hidden="true" title="Drag to pay over more or fewer floors">▼ {g.fmt(g.edge(dn))}</div>); }
      edges.push(yTop(g.rowOf[clamp(up, 0, 63)]!) - 1, yTop(g.rowOf[clamp(dn, 0, 63)]!) + M.fh - 2);
    }
  }

  // ── roof, street, sign ──
  const shut = p.phase === "locked" || p.phase === "settling" || p.phase === "void" || p.phase === "late";
  const plate = p.phase === "locked" ? { big: "CLOSED", small: `BELL AT ${clock(p.settlesAt).toUpperCase()}`, tone: "" }
    : p.phase === "settling" ? { big: "CLOSED", small: "THE BELL IS RINGING", tone: "" }
    : p.phase === "void" ? { big: "VOID", small: "MONEY COMES BACK", tone: "" }
    : p.phase === "late" ? { big: "NOT OPEN", small: "DEPOSITS COME BACK", tone: "" }
    : p.phase === "seeding" ? { big: "SOON", small: `OPENS ${clock(p.opensAt).toUpperCase()}`, tone: "soon" } : null;
  const bellTower = useMemo(() => {
    const w = 44, h = 70, base = h;
    let s = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges">`;
    const bx = 4;
    s += `<rect x="${bx}" y="${base - 48}" width="36" height="48" fill="#3a2622"/><rect x="${bx - 4}" y="${base - 52}" width="44" height="5" fill="#c9bfa4"/><rect x="${bx + 3}" y="${base - 60}" width="30" height="8" fill="#8d8670"/><rect x="${bx + 16}" y="${base - 66}" width="4" height="6" fill="#f0a83a"/>`;
    s += `<rect x="${bx}" y="${base - 48}" width="3" height="48" fill="#5c2219"/><rect x="${bx + 33}" y="${base - 48}" width="3" height="48" fill="#5c2219"/><rect x="${bx + 17}" y="${base - 47}" width="2" height="4" fill="#8d8670"/>`;
    return s + `<g class="tw-bellg">${pix(BELL, BELLPAL, 2, bx + 8, base - 43)}</g></svg>`;
  }, []);
  const roofH = 0; // the roof is laid out in the page's flow; chips read the floors' own offset

  // The street is the round's ride: from the open (left) to the bell's flag
  // (right). The taxi is now, the road behind it lit gold; the striped post is
  // the lock; after the bell the taxi waits at the flag.
  const dayLen = Math.max(1, p.settlesAt - p.opensAt), ride = (t: number) => clamp((t - p.opensAt) / dayLen, 0, 1);
  const r0 = M.plw, r1 = Math.max(r0 + 40, M.W - 30), run = r1 - r0 - 32;
  const tx = Math.round(r0 + (final ? 1 : ride(p.now)) * run), lockX = Math.round(r0 + ride(p.locksAt) * run + 30);
  const rx = Math.round(M.small ? M.plw + M.pw + M.shw + M.wa + 8 : M.plw + M.pw + M.shw + M.wa / 2 - 12), rs = M.small ? 2 : 3;
  // Phones leave room for the header, the sentence, the roof and the call bar.
  const scH = p.demo ? Math.min(HT, p.demo.floors * M.fh) : Math.min(HT, M.small ? clamp(vh - 470, 280, 540) : Math.max(360, Math.min(vh - 300, 760)));
  const vars = { "--tw-plw": `${M.plw}px`, "--tw-pw": `${M.pw}px`, "--tw-shw": `${M.shw}px`, "--tw-ww": `${M.ww}px`, "--tw-wg": `${M.wg}px`, "--tw-wp": `${M.wp}px`, "--tw-wa": `${M.wa}px`, "--tw-pcw": `${M.pcw}px`, "--tw-th": `${M.th}px`, "--tw-fh": `${M.fh}px` } as CSSProperties;

  // Off-screen marks: where the rest of the call, and the price now, are.
  const marks = useMemo(() => {
    const out: { y: number; label: string; now?: boolean; row: number }[] = [];
    const c = desk.pending ? null : desk.call;
    if (c && interactive) {
      if (c.kind === "between") { out.push({ y: yTop(g.rowOf[c.hi]!) + M.fh / 2, label: `top ${c.hi === 63 ? "no limit" : g.fmt(g.edge(c.hi + 1))}`, row: g.rowOf[c.hi]! }); out.push({ y: yTop(g.rowOf[c.lo]!) + M.fh / 2, label: `bottom ${c.lo === 0 ? "no limit" : g.fmt(g.edge(c.lo))}`, row: g.rowOf[c.lo]! }); }
      else out.push({ y: yTop(g.rowOf[clamp(c.c, 0, 63)]!) + M.fh / 2, label: "your floor", row: g.rowOf[clamp(c.c, 0, 63)]! });
    }
    if (desk.pending && pendRow !== null) out.push({ y: yTop(pendRow) + M.fh / 2, label: "start", row: pendRow });
    if (settledRow !== null) out.push({ y: yTop(settledRow) + M.fh / 2, label: "closed here", row: settledRow });
    if (carY !== null && !final) out.push({ y: carY, label: "NOW", now: true, row: liveRow });
    return out;
  }, [desk.call, desk.pending, interactive, g, yTop, M.fh, pendRow, settledRow, carY, final, liveRow]);

  // A "how sure" being hovered: where that width would pay, as dashed lines with
  // its two prices, over the call's own; the call itself is unchanged.
  const peekSpan = (() => {
    const c = desk.call, s = desk.peek;
    if (!interactive || desk.pending || s === null || c?.kind !== "near" || s === c.s) return null;
    const up = Math.min(63, c.c + s), dn = Math.max(0, c.c - s);
    return { t: yTop(g.rowOf[up]!) - 1, b: yTop(g.rowOf[dn]!) + M.fh - 2, hi: up >= 63 ? "top" : g.fmt(g.edge(up + 1)), lo: dn <= 0 ? "bottom" : g.fmt(g.edge(dn)) };
  })();
  const cls = ["tw-wrap", shut ? "tw-shut" : "", p.phase === "seeding" ? "tw-soon" : "", p.phase === "settled" ? "tw-done" : "", interactive ? "" : "tw-still", M.small ? "tw-small" : ""].join(" ");

  return (
    <div className={`tw-box${p.demo ? " tw-demo" : ""}`}>
      {p.demo && <div className="tw-readout" aria-live="off">
        <div className="tw-txt"><div className="tw-say">{say}</div>{aim && <div className="tw-aim">{aim}</div>}</div>
        {xBtn}
      </div>}
      <div ref={wrap} className={cls} style={vars}>
        {!p.demo && <div className="tw-roof">
          <div className="tw-deck">
            <Billboard sign={p.sign} />
            {(note || aim) && <div className="tw-board" aria-live="off">
              <div className="tw-board-h"><span>{aimRow !== null && aimRow < NR ? "FLOOR" : tag}</span>{xBtn}</div>
              <div className="tw-board-t">{aimRow !== null && aimRow < NR ? aim : <>{note}{aim && <span className="tw-board-aim"> {aim}</span>}</>}</div>
            </div>}
            <BellSign phase={p.phase} opensAt={p.opensAt} settlesAt={p.settlesAt} plate={plate} status={p.status} />
            <div className="tw-belltower" aria-hidden="true" dangerouslySetInnerHTML={{ __html: bellTower }} />
          </div>
          <Ticker items={p.ticker} />
          <div className="tw-parapet" aria-hidden="true" />
        </div>}
        <div ref={sc} className="tw-sc" style={{ height: scH }} tabIndex={0} role="group" aria-label="The tower. Each floor is a price. Arrow keys move between floors, Enter picks one." aria-disabled={!interactive}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { ptr.current = null; stopAuto(); }}
          onPointerLeave={(e) => { if (!ptr.current && e.pointerType === "mouse") setHover(null); }} onKeyDown={onKey}>
          <div ref={inner} className="tw-inner" style={{ height: HT }}>
            {floors.map((f, k) => <Floor key={NR - 1 - k} {...f} cls={f.cls + (NR - 1 - k === cursor ? " cur" : NR - 1 - k === hover ? " hov" : "")} onHeld={onHeld} />)}
            <svg className="tw-chart" width={chartW} height={HT} viewBox={`0 0 ${chartW} ${HT}`} aria-hidden="true" shapeRendering="crispEdges" dangerouslySetInnerHTML={{ __html: chartSvg }} />
            {p.opened && g.p0 > 0 && <span className="tw-opentag" aria-hidden="true" style={{ left: M.plw + 3, top: Math.round(yOfPrice(g.p0)) + 2 }}>open</span>}
            {carY !== null && <>
              <svg className="tw-car" width={carW} height={carH} aria-hidden="true" shapeRendering="crispEdges" style={{ left: Math.round(M.nowX - carW / 2), top: Math.round(carY - carH / 2) }} dangerouslySetInnerHTML={{ __html: carHtml }} />
              {tagPrice !== null && <span className="tw-nowtag" aria-hidden="true" style={{ left: Math.round(M.nowX - carW / 2 - 2), top: Math.round(carY - carH / 2 - (M.small ? 20 : 22)) }}><b>{final ? "CLOSE" : "NOW"}</b>{g.fmt(tagPrice)}</span>}
            </>}
            {edges.map((y, k) => <div key={k} className="tw-edge" style={{ top: y }} />)}
            {peekSpan && <>
              <div className="tw-edge tw-peek" style={{ top: peekSpan.t }}><span>▲ {peekSpan.hi}</span></div>
              <div className="tw-edge tw-peek" style={{ top: peekSpan.b }}><span>▼ {peekSpan.lo}</span></div>
            </>}
            {tabs}
          </div>
        </div>
        <div className="tw-street" aria-hidden="true">
          <div className="lane" />
          <div className="tw-road" style={{ left: r0, width: Math.max(0, tx + 16 - r0) }} />
          <span className="t" style={{ left: r0 }}>OPEN {clock(p.opensAt)}</span>
          <span className="t tw-bell-t" style={{ right: 30 }}><b>{final ? "RANG" : "BELL"} {clock(p.settlesAt)}</b></span>
          <i className="tw-lockpost" style={{ left: lockX }} title={`Trading stops at ${clock(p.locksAt)}`} />
          <svg className="tw-flag" width={20} height={30} viewBox="0 0 10 15" style={{ right: 6, top: 8 }} shapeRendering="crispEdges" dangerouslySetInnerHTML={{ __html: FLAG }} />
          <svg className={`tw-taxi${final || p.phase === "seeding" ? "" : " go"}`} width={32} height={14} style={{ left: tx, top: 30 }} shapeRendering="crispEdges" dangerouslySetInnerHTML={{ __html: `<title>${final ? "At the bell" : `Now, ${clock(p.now)}`}</title>` + pix(TAXI, TAXIPAL, 2) }} />
          {(p.phase === "locked" || p.phase === "settling") && <svg className="tw-rope" width={12 * rs} height={7 * rs} style={{ left: rx, top: M.small ? 14 : 10 }} shapeRendering="crispEdges" dangerouslySetInnerHTML={{ __html: pix(ROPE, ROPEPAL, rs) }} />}
        </div>
        <OffChips sc={sc} marks={marks} fh={M.fh} top={roofH} pcw={M.pcw} onGo={(r) => scrollToRow(r)} />
      </div>
      <div className="tw-below">
      {(p.phase === "locked" || p.phase === "settling") && <p className="tw-closedline" role="status"><b>CLOSED</b>Trading closed at {clock(p.locksAt)}. Bell at {clock(p.settlesAt)} New York. The next round opens right after.</p>}
      {(!p.demo || p.demo.legend) && <div className="tw-legend">
        <span><svg width="22" height="12" shapeRendering="crispEdges" aria-hidden="true"><rect width="22" height="12" fill="#121c33" /><path d="M1 9h4v-3h4v-2h4v3h4v-4h4" stroke="#f4e9c8" strokeWidth="2" fill="none" /></svg><b>Line:</b> the price today</span>
        <span><svg width="12" height="16" shapeRendering="crispEdges" aria-hidden="true"><rect width="12" height="16" fill="#15213a" /><rect x="2" y="2" width="8" height="12" fill="#efe6cc" /><rect x="2" y="11" width="8" height="3" fill="#d6c9a4" /></svg><b>Lit windows:</b> the crowd's chance</span>
        <span><svg width="14" height="12" shapeRendering="crispEdges" aria-hidden="true"><rect x="2" y="9" width="10" height="1" fill="#8a5a12" /><rect x="2" y="8" width="10" height="1" fill="#f0a83a" /><rect x="3" y="7" width="8" height="1" fill="#ffe28a" /><rect x="2" y="6" width="10" height="1" fill="#8a5a12" /><rect x="2" y="5" width="10" height="1" fill="#f0a83a" /><rect x="3" y="4" width="8" height="1" fill="#ffe28a" /><rect x="2" y="3" width="10" height="1" fill="#8a5a12" /><rect x="2" y="2" width="10" height="1" fill="#f0a83a" /><rect x="3" y="1" width="8" height="1" fill="#ffe28a" /><rect x="1" y="10" width="12" height="2" fill="#8d8670" /></svg><b>Gold coins:</b> what your call wins, tallest on its best floor</span>
        {p.held.length > 0 && <span><svg width="14" height="12" aria-hidden="true"><rect x="1" y="1" width="12" height="10" fill="none" stroke="#f0a83a" strokeWidth="2" strokeDasharray="3 2" /></svg><b>Dashed:</b> a call you hold</span>}
      </div>}
      <div className="sr" aria-live="polite">{announced}</div>
      </div>
    </div>
  );
}

/** The bell's sign on the roof: the only part of the tower that ticks every
 *  second. When the round takes no calls it is a hanging plate instead
 *  (CLOSED, SOON, VOID), in the same place, so it never covers the billboard. */
function BellSign(p: { phase: Phase; opensAt: number; settlesAt: number; plate: { big: string; small: string; tone: string } | null; status: string }) {
  const now = useNow();
  if (p.plate) {
    const cd = p.phase === "locked" ? `IN ${hms(p.settlesAt - now)}` : p.phase === "seeding" ? (p.opensAt > now ? `IN ${hms(p.opensAt - now)}` : "ANY MOMENT") : "";
    return (
      <div className={`tw-bellside tw-sign ${p.plate.tone}`}>
        <div className="chains" aria-hidden="true"><i style={{ left: "22%" }} /><i style={{ right: "22%" }} /></div>
        <div className="plate"><span className="big">{p.plate.big}</span><span className="small">{p.plate.small}</span>{cd && <span className="small cd">{cd}</span>}</div>
      </div>
    );
  }
  const bell = p.phase === "open" ? { h: `BELL ${clock(p.settlesAt)}`, cd: `in ${hms(p.settlesAt - now)}` }
    : p.phase === "settled" ? { h: `RANG ${clock(p.settlesAt)}`, cd: "settled" }
    : { h: `BELL ${clock(p.settlesAt)}`, cd: "" };
  return <div className="tw-bellside"><div className="tw-bellsign"><b>{bell.h}</b><span className="cd">{bell.cd}</span>{p.phase === "open" && p.status && <span className="st">{p.status}</span>}</div></div>;
}

/** The round's billboard on the roof: what it is on, what it is paid in, when it closes. */
function Billboard({ sign }: { sign: RoofSign }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="tw-bill">
      <div className="tw-bill-face">
        <div className="l1">
          {sign.logo && <span className="logo" aria-hidden="true"><img src={sign.logo} alt="" /></span>}
          <span className="sym">{sign.symbol}</span>
          <span className="nm">{sign.name}</span>
          {sign.onHelp && <button className="tw-bill-help" onClick={sign.onHelp} aria-label="How it works, show the guide again" title="How it works">?</button>}
        </div>
        <div className="l2">{sign.coin && <img src={sign.coin.logo} alt="" />}{sign.paidIn}</div>
        <div className="l3">{sign.date} · New York</div>
      </div>
      <div className="tw-bill-posts">
        {sign.plaque && <button className="tw-plaque" onClick={() => setOpen(!open)} aria-expanded={open} title={sign.plaque.full}><span aria-hidden="true">i</span><span className="tw-plaque-t">{sign.plaque.short}</span></button>}
        {sign.plaqueNode && <span className="tw-plaque tw-plaque-node">{sign.plaqueNode}</span>}
        {open && sign.plaque && <p className="tw-plaque-full" role="note">{sign.plaque.full}</p>}
      </div>
    </div>
  );
}

/** The stock-ticker strip along the roof's ledge. It scrolls, or holds still for reduced motion. */
function Ticker({ items }: { items: TickerItem[] }) {
  const one = (dup: boolean) => items.map((t, n) => (
    <span key={`${dup ? "b" : "a"}${n}`} className={`it${dup ? " dup" : ""}`}><b>{t.k}</b> {t.v}{t.d && <em className={t.tone ?? ""}> {t.d}</em>}</span>
  ));
  return (
    <div className="tw-led">
      <div className="tw-led-run" aria-hidden="true" style={{ animationDuration: `${Math.max(20, items.length * 7)}s` }}>{one(false)}{one(true)}</div>
      <ul className="sr">{items.map((t, n) => <li key={n}>{t.k}: {t.v}{t.d ? `, ${t.d}` : ""}</li>)}</ul>
    </div>
  );
}

/** Chips pinned to the tower's top and bottom edge for marks scrolled out of view. */
function OffChips(p: { sc: React.RefObject<HTMLDivElement>; marks: { y: number; label: string; now?: boolean; row: number }[]; fh: number; top: number; pcw: number; onGo: (r: number) => void }) {
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
  const h = view[1] - view[0], top = p.top + (p.sc.current?.offsetTop ?? 0);
  return <>
    {up.length > 0 && <div className="tw-off" style={{ top: top + 6, right: p.pcw + 8 }}>{up.map((m) => <button key={m.label} className={m.now ? "now" : ""} onClick={() => p.onGo(m.row)}>▲ {m.label}</button>)}</div>}
    {dn.length > 0 && <div className="tw-off" style={{ top: top + h - 40, right: p.pcw + 8 }}>{dn.map((m) => <button key={m.label} className={m.now ? "now" : ""} onClick={() => p.onGo(m.row)}>▼ {m.label}</button>)}</div>}
  </>;
}
