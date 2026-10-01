// The call, on the tower: each floor a price, lit windows the crowd's chance,
// the price line running across the glass. A tap picks a floor; gold coins
// stack where the call pays; the WIN tag pops. An illustration of the
// mechanic, labelled so, not a real round.
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, MONO, PX, Rise, SANS, Shout, useLay } from "./Ad";

const PRICES = ["85,179", "84,771", "84,365", "83,961", "83,559", "83,159", "82,761", "82,365", "81,970", "81,578", "81,187"];
const PCT = [0.4, 1.3, 4.2, 9.8, 16, 21, 17, 12, 7, 3, 1];
const PICK = 5, REACH = 2; // the call: near 83,159, two floors either side
const level = (r: number) => (Math.abs(r - PICK) <= REACH ? 8 - Math.abs(r - PICK) * 2 : 0);

export function TowerScene() {
  const f = useCurrentFrame(), { fps } = useVideoConfig(), { tall } = useLay();
  const rowH = tall ? 80 : 52, TW = tall ? 980 : 900, labW = tall ? 180 : 150, winN = 9, ww = tall ? 22 : 18, wg = 6, winW = winN * ww + (winN - 1) * wg + 20, coinW = tall ? 170 : 150, pcW = tall ? 130 : 110;
  const paneW = TW - 12 - labW - winW - coinW - pcW, HT = rowH * PRICES.length;
  const rise = spring({ frame: f, fps, config: { damping: 15, stiffness: 120 } });
  const draw = interpolate(f, [6, 56], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const picked = f >= 62, pickS = spring({ frame: f - 62, fps, config: { damping: 12, stiffness: 200 } });
  const win = spring({ frame: f - 92, fps, config: { damping: 10, stiffness: 220 } });
  const push = interpolate(f, [0, 120], [1, 1.06]);

  // the day's price: a walk that ends on the picked floor
  // a day's walk: a slow swing, a little noise, settling onto the picked floor (stepped, like the site's line)
  const pts = Array.from({ length: 40 }, (_, i) => { const u = i / 39; const y = (PICK + 0.5 + (Math.sin(u * 5.2 + 0.6) * 1.4 + Math.sin(i * 1.7) * 0.18) * (1 - u * 0.85) + (1 - u) * 1.2) * rowH; return [u * (paneW - 8), y] as const; });
  const path = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  // the marker rides the line's drawn end: the point at `draw` of its length
  const segs = pts.slice(1).map(([x, y], i) => Math.hypot(x - pts[i]![0], y - pts[i]![1])), total = segs.reduce((a, b) => a + b, 0);
  let tip: readonly [number, number] = pts[0]!;
  for (let i = 0, run = 0, want = draw * total; i < segs.length; run += segs[i]!, i++) if (run + segs[i]! >= want) { const k = (want - run) / segs[i]!, [x0, y0] = pts[i]!, [x1, y1] = pts[i + 1]!; tip = [x0 + (x1 - x0) * k, y0 + (y1 - y0) * k]; break; }

  const tower = (
    <div style={{ width: TW, border: `6px solid ${C.cream}`, background: C.sky, boxShadow: `14px 14px 0 ${C.brick2}`, position: "relative" }}>
      {/* the roof's ledge, with the illustration note */}
      <div style={{ height: tall ? 46 : 38, background: "#050608", borderBottom: "4px solid #c9bfa4", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px" }}>
        <span style={{ fontFamily: MONO, fontWeight: 600, fontSize: tall ? 22 : 18, color: "#ffb13b", textShadow: "0 0 6px rgba(255,160,40,.6)" }}>BTC · TODAY · BELL 4:00 PM</span>
        <span style={{ fontFamily: PX, fontSize: tall ? 14 : 12, color: C.ink, background: C.cream2, padding: "5px 8px" }}>ILLUSTRATION</span>
      </div>
      <div style={{ position: "relative", height: HT }}>
        {PRICES.map((p, r) => {
          const inCall = picked && level(r) > 0, lit = Math.round((PCT[r]! / 21) * winN);
          const lightUp = interpolate(f, [4 + r * 2, 14 + r * 2], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          const coins = Math.round(level(r) * interpolate(f, [66 + Math.abs(r - PICK) * 4, 84 + Math.abs(r - PICK) * 4], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: (t) => 1 - (1 - t) ** 3 }));
          return (
            <div key={r} style={{ position: "absolute", left: 0, right: 0, top: r * rowH, height: rowH, display: "flex", boxShadow: "inset 0 -3px 0 #5c2219" }}>
              <div style={{ width: labW, background: "#3a2622", borderRight: "3px solid #5c2219", display: "flex", alignItems: "center", paddingLeft: 14, fontFamily: MONO, fontWeight: 600, fontSize: tall ? 28 : 22, color: inCall ? C.taxi : C.cream2 }}>{p}</div>
              <div style={{ width: paneW, background: r === PICK && picked ? "#1b2b4a" : "#121c33", boxShadow: "inset 0 -1px 0 #1d2944" }} />
              <div style={{ width: winW, background: "#7a2f22", display: "flex", alignItems: "center", gap: wg, padding: "0 10px" }}>
                {Array.from({ length: winN }, (_, k) => <div key={k} style={{ width: ww, height: rowH - 16, background: k < lit * lightUp ? "#efe6cc" : "#15213a", boxShadow: k < lit * lightUp ? "inset 0 -4px 0 #d6c9a4, 0 0 10px rgba(244,233,200,.25)" : "inset 0 0 0 2px #0a1020" }} />)}
              </div>
              <div style={{ width: coinW, background: inCall ? "#8d3a28" : "#7a2f22", display: "flex", alignItems: "center", gap: 3, padding: "0 8px", transition: "none" }}>
                {Array.from({ length: coins }, (_, k) => <div key={k} style={{ width: tall ? 17 : 14, height: rowH - 14, background: "repeating-linear-gradient(180deg, #ffe28a 0 2px, #f0a83a 2px 6px, #8a5a12 6px 8px)", boxShadow: "inset 2px 0 0 rgba(255,255,255,.18)" }} />)}
              </div>
              <div style={{ width: pcW, background: "#3a2622", borderLeft: "3px solid #5c2219", display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: 12, fontFamily: MONO, fontWeight: 600, fontSize: tall ? 26 : 21, color: PCT[r]! < 2 ? "#a39c85" : C.cream }}>{PCT[r]! < 1 ? "<1" : PCT[r]}%</div>
            </div>
          );
        })}
        {/* the price line across the glass */}
        <svg width={paneW} height={HT} style={{ position: "absolute", left: labW, top: 0 }}>
          <path d={path} fill="none" stroke={C.cream} strokeWidth={tall ? 5 : 4} strokeLinejoin="miter" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - draw} />
          {draw > 0.02 && <rect x={tip[0] - 9} y={tip[1] - 9} width={18} height={18} fill={C.ink} stroke={C.cream} strokeWidth={4} />}
        </svg>
        {/* the call's edges and the tap */}
        {picked && <>
          <div style={{ position: "absolute", left: labW + paneW, right: 0, top: (PICK - REACH) * rowH - 3, height: 6, background: C.taxi, transform: `scaleX(${pickS})`, transformOrigin: "left" }} />
          <div style={{ position: "absolute", left: labW + paneW, right: 0, top: (PICK + REACH + 1) * rowH - 3, height: 6, background: C.taxi, transform: `scaleX(${pickS})`, transformOrigin: "left" }} />
          <div style={{ position: "absolute", left: 0, width: labW, top: PICK * rowH + 4, height: rowH - 8, background: C.cream, color: C.ink, display: "flex", alignItems: "center", paddingLeft: 10, fontFamily: MONO, fontWeight: 600, fontSize: tall ? 26 : 21, border: `3px solid ${C.ink}`, transform: `scale(${pickS})` }}>◆ {PRICES[PICK]}</div>
          {f < 82 && <div style={{ position: "absolute", left: labW + paneW + winW / 2 - 40, top: PICK * rowH + rowH / 2 - 40, width: 80, height: 80, borderRadius: "50%", border: `6px solid ${C.cream}`, opacity: interpolate(f, [62, 80], [1, 0]), transform: `scale(${interpolate(f, [62, 80], [0.3, 1.8])})` }} />}
        </>}
        {f >= 92 && <div style={{ position: "absolute", left: labW + paneW + winW + coinW * 0.15, top: PICK * rowH + rowH / 2 - (tall ? 34 : 28), transform: `scale(${win})`, transformOrigin: "left center", background: C.cream, color: C.ink, border: `4px solid ${C.ink}`, boxShadow: `5px 5px 0 #b47416`, padding: tall ? "8px 14px" : "6px 12px", fontFamily: MONO, fontWeight: 700, fontSize: tall ? 30 : 25, whiteSpace: "nowrap" }}>WIN 3.12M · 2.3×</div>}
      </div>
    </div>
  );

  return (
    <AbsoluteFill style={{ background: C.ink, overflow: "hidden" }}>
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at 50% 40%, #182642 0%, #0b1120 70%)" }} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: tall ? 60 : 30 }}>
        <Rise at={0} style={{ textAlign: "center" }}>
          <Shout size={tall ? 56 : 46}>CALL WHERE<br />IT <span style={{ color: C.taxi }}>CLOSES</span></Shout>
          <div style={{ fontFamily: SANS, fontWeight: 600, fontSize: tall ? 38 : 30, color: C.cream2, marginTop: tall ? 18 : 10 }}>Pick a floor. 4 PM New York.</div>
        </Rise>
        <div style={{ transform: `translateY(${(1 - rise) * 160}px) scale(${push})`, opacity: Math.min(1, rise * 1.4) }}>{tower}</div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
