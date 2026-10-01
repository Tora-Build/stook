// The call, on the tower: $STOOK plays the S&P 500. Each floor is a price band
// (~0.5% wide, like the app), lit windows the crowd's chance, and the price
// line is the real last day of SPYx (src/data/spx.json). A tap picks a floor;
// then "How sure?" — Sure, Pretty sure, Not sure — narrows or widens the call
// (the gold edges move, the coin stacks reshape, the payout multiple changes).
// Wins are paid in more $STOOK, the coin you trade with.
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, MONO, PX, Rise, SANS, Shout, useLay } from "./Ad";
import SPX from "./data/spx.json";

const N = 11, MID = 5, STEP = 1.005;
const pts0 = SPX.points as [number, number][];
const last = pts0[pts0.length - 1]![1];
// band edges: the middle floor holds the last price; floor 0 is the top
const lo = (k: number) => last / Math.sqrt(STEP) * STEP ** (MID - k); // bottom edge of floor k (k=0 top)
const PRICES = Array.from({ length: N }, (_, k) => lo(k));
const fmt = (v: number) => v.toFixed(2);
// the crowd's chance per floor, peaked on the price
const PCT = Array.from({ length: N }, (_, k) => { const d = Math.abs(k - MID); return [24, 18, 11, 6, 2.5, 0.8][Math.min(5, d)]!; });
const PICK = MID - 1; // the call: one floor above the price
// how sure: reach in floors, and the illustrative payout multiple at that reach
export const SURE = [{ name: "Sure", reach: 1, stack: 8, x: "4.1×", win: "WIN 7.66M $STOOK" }, { name: "Pretty sure", reach: 2, stack: 6, x: "2.3×", win: "WIN 3.12M $STOOK" }, { name: "Not sure", reach: 4, stack: 4, x: "1.4×", win: "WIN 1.90M $STOOK" }] as const;
const level = (r: number, reach: number) => Math.max(0, reach + 1 - Math.abs(r - PICK));

export function TowerScene(p: { coinsAt: number; winAt: number; fast?: boolean }) {
  const f = useCurrentFrame(), { fps, durationInFrames: D } = useVideoConfig(), { tall } = useLay();
  const fast = !!p.fast;
  const g = tall
    ? { rowH: 84, TW: 980, labW: 170, ww: 20, wg: 6, coinW: 170, stack: 16, pcW: 120, font: 28, small: 24 }
    : { rowH: 50, TW: 700, labW: 124, ww: 14, wg: 5, coinW: 128, stack: 11, pcW: 88, font: 20, small: 18 };
  const winN = 9, winW = winN * g.ww + (winN - 1) * g.wg + 20, paneW = g.TW - 12 - g.labW - winW - g.coinW - g.pcW, rowH = g.rowH, HT = rowH * N;
  const rise = spring({ frame: f, fps, config: { damping: 15, stiffness: 120 } });
  const draw = interpolate(f, fast ? [0, 16] : [6, 50], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const pickAt = fast ? 18 : 54, picked = f >= pickAt, pickS = spring({ frame: f - pickAt, fps, config: { damping: 12, stiffness: 200 } });
  // how sure: Pretty sure at the pick, then Not sure, then Sure, then back to Pretty sure
  const taps = fast ? [] : [p.winAt + 40, p.winAt + 80, p.winAt + 120];
  const seq = [1, 2, 0, 1], step = taps.filter((t) => f >= t).length, sure = SURE[seq[step]!]!, reach = sure.reach;
  const lastTap = step ? taps[step - 1]! : p.winAt;
  const win = spring({ frame: f - lastTap, fps, config: { damping: 10, stiffness: 220 } });
  const push = interpolate(f, [0, D], [1, 1.04]);

  // the real day, drawn on the glass: log price → y, band k spans [lo(k), lo(k)·STEP)
  const t0 = pts0[0]![0], t1 = pts0[pts0.length - 1]![0];
  const yOf = (v: number) => (MID + 0.5 - Math.log(v / last) / Math.log(STEP)) * rowH;
  const pts = pts0.map(([t, v]) => [((t - t0) / (t1 - t0)) * (paneW - 10), yOf(v)] as const);
  const path = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const segs = pts.slice(1).map(([x, y], i) => Math.hypot(x - pts[i]![0], y - pts[i]![1])), total = segs.reduce((a, b) => a + b, 0);
  let tip: readonly [number, number] = pts[0]!;
  for (let i = 0, run = 0, want = draw * total; i < segs.length; run += segs[i]!, i++) if (run + segs[i]! >= want) { const k = (want - run) / segs[i]!, [x0, y0] = pts[i]!, [x1, y1] = pts[i + 1]!; tip = [x0 + (x1 - x0) * k, y0 + (y1 - y0) * k]; break; }

  const tower = (
    <div style={{ width: g.TW, border: `6px solid ${C.cream}`, background: C.sky, boxShadow: `14px 14px 0 ${C.brick2}`, position: "relative" }}>
      <div style={{ height: tall ? 48 : 36, background: "#050608", borderBottom: "4px solid #c9bfa4", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 14px" }}>
        <span style={{ fontFamily: MONO, fontWeight: 600, fontSize: g.small, color: "#ffb13b", textShadow: "0 0 6px rgba(255,160,40,.6)" }}>S&amp;P 500 · BELL 4:00 PM</span>
        <span style={{ fontFamily: MONO, fontWeight: 600, fontSize: g.small - 2, color: C.cream2 }}>PAID IN $STOOK</span>
      </div>
      <div style={{ position: "relative", height: HT }}>
        {PRICES.map((pr, r) => {
          const lv = picked ? level(r, reach) : 0, lit = Math.round((PCT[r]! / 24) * winN);
          const lightUp = interpolate(f, fast ? [0, 8] : [4 + r * 2, 14 + r * 2], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          const d = Math.abs(r - PICK) * (fast ? 2 : 4);
          const grow = interpolate(f, [p.coinsAt + d, p.coinsAt + d + (fast ? 10 : 18)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: (t) => 1 - (1 - t) ** 3 });
          const coins = Math.round((lv / (reach + 1)) * sure.stack * grow);
          return (
            <div key={r} style={{ position: "absolute", left: 0, right: 0, top: r * rowH, height: rowH, display: "flex", boxShadow: "inset 0 -3px 0 #5c2219" }}>
              <div style={{ width: g.labW, background: "#3a2622", borderRight: "3px solid #5c2219", display: "flex", alignItems: "center", paddingLeft: 12, fontFamily: MONO, fontWeight: 600, fontSize: g.font, color: lv ? C.taxi : C.cream2 }}>{fmt(pr)}</div>
              <div style={{ width: paneW, background: r === PICK && picked ? "#1b2b4a" : "#121c33", boxShadow: "inset 0 -1px 0 #1d2944" }} />
              <div style={{ width: winW, background: "#7a2f22", display: "flex", alignItems: "center", gap: g.wg, padding: "0 10px" }}>
                {Array.from({ length: winN }, (_, k) => <div key={k} style={{ width: g.ww, height: rowH - 16, background: k < lit * lightUp ? "#efe6cc" : "#15213a", boxShadow: k < lit * lightUp ? "inset 0 -4px 0 #d6c9a4, 0 0 10px rgba(244,233,200,.25)" : "inset 0 0 0 2px #0a1020" }} />)}
              </div>
              <div style={{ width: g.coinW, background: lv ? "#8d3a28" : "#7a2f22", display: "flex", alignItems: "center", gap: 3, padding: "0 8px" }}>
                {Array.from({ length: coins }, (_, k) => <div key={k} style={{ width: g.stack, height: rowH - 14, background: "repeating-linear-gradient(180deg, #ffe28a 0 2px, #f0a83a 2px 6px, #8a5a12 6px 8px)", boxShadow: "inset 2px 0 0 rgba(255,255,255,.18)" }} />)}
              </div>
              <div style={{ width: g.pcW, background: "#3a2622", borderLeft: "3px solid #5c2219", display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: 10, fontFamily: MONO, fontWeight: 600, fontSize: g.font - 2, color: PCT[r]! < 2 ? "#a39c85" : C.cream }}>{PCT[r]! < 1 ? "<1" : PCT[r]}%</div>
            </div>
          );
        })}
        <svg width={paneW} height={HT} style={{ position: "absolute", left: g.labW, top: 0 }}>
          <path d={path} fill="none" stroke={C.cream} strokeWidth={4} strokeLinejoin="miter" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - draw} />
          {draw > 0.02 && <rect x={tip[0] - 8} y={tip[1] - 8} width={16} height={16} fill={C.ink} stroke={C.cream} strokeWidth={4} />}
        </svg>
        {picked && <>
          <div style={{ position: "absolute", left: g.labW + paneW, right: 0, top: (PICK - reach) * rowH - 3, height: 6, background: C.taxi, transform: `scaleX(${pickS})`, transformOrigin: "left" }} />
          <div style={{ position: "absolute", left: g.labW + paneW, right: 0, top: (PICK + reach + 1) * rowH - 3, height: 6, background: C.taxi, transform: `scaleX(${pickS})`, transformOrigin: "left" }} />
          <div style={{ position: "absolute", left: 0, width: g.labW, top: PICK * rowH + 4, height: rowH - 8, background: C.cream, color: C.ink, display: "flex", alignItems: "center", paddingLeft: 8, fontFamily: MONO, fontWeight: 600, fontSize: g.font, border: `3px solid ${C.ink}`, transform: `scale(${pickS})` }}>◆ {fmt(PRICES[PICK]!)}</div>
          {f < pickAt + 20 && <div style={{ position: "absolute", left: g.labW + paneW + winW / 2 - 36, top: PICK * rowH + rowH / 2 - 36, width: 72, height: 72, borderRadius: "50%", border: `6px solid ${C.cream}`, opacity: interpolate(f, [pickAt, pickAt + 18], [1, 0]), transform: `scale(${interpolate(f, [pickAt, pickAt + 18], [0.3, 1.8])})` }} />}
        </>}
        {f >= p.winAt && <div style={{ position: "absolute", right: g.pcW - 30, top: (PICK + reach + 1) * rowH + 8, transform: `scale(${win})`, transformOrigin: "right top", background: C.cream, color: C.ink, border: `4px solid ${C.ink}`, boxShadow: `5px 5px 0 #b47416`, padding: "6px 12px", fontFamily: MONO, fontWeight: 700, fontSize: tall ? 28 : 21, whiteSpace: "nowrap", zIndex: 3 }}>{sure.win} · {sure.x}</div>}
      </div>
    </div>
  );

  // the "How sure?" plate: three brass coins, the lit one is the call's width
  const sureW = tall ? 980 : 230;
  const plate = (
    <Rise at={fast ? 2 : 20} style={{ width: sureW }}>
      <div style={{ background: "linear-gradient(180deg, #c9a24a, #8a6824)", border: "5px solid #3a2a10", boxShadow: `10px 10px 0 ${C.brick2}`, padding: tall ? "20px 24px" : "16px 14px" }}>
        <div style={{ fontFamily: PX, fontSize: tall ? 26 : 16, color: "#2a1a10", textAlign: "center", marginBottom: tall ? 18 : 14 }}>HOW SURE?</div>
        <div style={{ display: "flex", flexDirection: tall ? "row" : "column", gap: tall ? 20 : 14, justifyContent: "center" }}>
          {SURE.map((s, i) => {
            const on = s === sure && f >= p.winAt, tapped = on && f - lastTap < 8 && step > 0;
            return (
              <div key={s.name} style={{ flex: 1, display: "flex", flexDirection: tall ? "column" : "row", alignItems: "center", gap: tall ? 10 : 12, padding: tall ? "14px 8px" : "10px 10px", background: on ? "#0b1120" : "rgba(42,26,16,.35)", border: `4px solid ${on ? C.taxi : "#3a2a10"}`, transform: `scale(${tapped ? 0.93 : 1})` }}>
                <div style={{ width: tall ? 70 : 46, height: tall ? 70 : 46, borderRadius: "50%", background: on ? "radial-gradient(circle at 35% 35%, #ffe28a, #f0a83a 60%, #8a5a12)" : "radial-gradient(circle at 35% 35%, #d9c08a, #8a6824 70%)", border: "4px solid #2a1a10", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: MONO, fontWeight: 700, fontSize: tall ? 22 : 15, color: "#2a1a10" }}>±{s.reach}</div>
                <div style={{ textAlign: tall ? "center" : "left" }}>
                  <div style={{ fontFamily: SANS, fontWeight: 700, fontSize: tall ? 28 : 19, color: on ? C.cream : "#2a1a10" }}>{s.name}</div>
                  <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: tall ? 24 : 16, color: on ? C.taxi : "#3a2a10" }}>≈{s.x}</div>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ fontFamily: SANS, fontWeight: 600, fontSize: tall ? 26 : 15, color: "#2a1a10", textAlign: "center", marginTop: tall ? 16 : 12 }}>Sure pays more. Not sure pays wider.</div>
      </div>
    </Rise>
  );

  const head = (
    <Rise at={0} style={{ textAlign: "center" }}>
      <Shout size={tall ? 56 : 42}>CALL WHERE<br />IT <span style={{ color: C.taxi }}>CLOSES</span></Shout>
      <div style={{ fontFamily: SANS, fontWeight: 600, fontSize: tall ? 36 : 26, color: C.cream2, marginTop: tall ? 16 : 6 }}>$STOOK plays the S&amp;P 500. Pick a floor for 4 PM New York.</div>
    </Rise>
  );
  const towerBox = <div style={{ transform: `translateY(${(1 - rise) * 160}px) scale(${push})`, opacity: Math.min(1, rise * 1.4) }}>{tower}</div>;

  return (
    <AbsoluteFill style={{ background: C.ink, overflow: "hidden" }}>
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at 50% 40%, #182642 0%, #0b1120 70%)" }} />
      {tall ? (
        <AbsoluteFill style={{ alignItems: "center", paddingTop: 100, gap: 40 }}>
          {head}
          {towerBox}
          {plate}
        </AbsoluteFill>
      ) : (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 24 }}>
          {head}
          <div style={{ display: "flex", alignItems: "center", gap: 26 }}>
            {towerBox}
            {plate}
          </div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
}
