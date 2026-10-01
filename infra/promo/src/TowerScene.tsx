// The call, on the tower: each floor a price, lit windows the crowd's chance,
// the price line running across the glass. A tap picks a floor; gold coins
// stack where the call pays; the WIN tag pops. The drawn tower is labelled an
// illustration; beside it (square) or under it (vertical) a phone plays real
// footage of the live round page: a floor tapped, then "Not sure", "Sure".
import { AbsoluteFill, interpolate, OffthreadVideo, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { C, MONO, PX, Rise, SANS, Shout, useLay } from "./Ad";

const PRICES = ["85,179", "84,771", "84,365", "83,961", "83,559", "83,159", "82,761", "82,365", "81,970", "81,578", "81,187"];
const PCT = [0.4, 1.3, 4.2, 9.8, 16, 21, 17, 12, 7, 3, 1];
const PICK = 5, REACH = 2; // the call: near 83,159, two floors either side
const level = (r: number) => (Math.abs(r - PICK) <= REACH ? 8 - Math.abs(r - PICK) * 2 : 0);

/** A phone with the live site playing on it. */
export function Phone(p: { width: number; at: number; style?: React.CSSProperties }) {
  const f = useCurrentFrame(), { fps } = useVideoConfig();
  const s = spring({ frame: f - p.at, fps, config: { damping: 14, stiffness: 150 } });
  const scr = p.width - 24, h = Math.round((scr * 844) / 390) + 24;
  return (
    <div style={{ width: p.width, height: h, padding: 12, background: "#05070d", borderRadius: p.width * 0.13, boxShadow: `0 0 0 4px #3a3f4c, 12px 14px 0 ${C.brick2}`, transform: `translateY(${(1 - s) * 140}px) rotate(${(1 - s) * 6 + 2}deg)`, opacity: Math.min(1, s * 1.5), ...p.style }}>
      <div style={{ width: scr, height: h - 24, borderRadius: p.width * 0.09, overflow: "hidden", background: C.ink }}>
        <OffthreadVideo src={staticFile("footage/round-phone.mp4")} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </div>
    </div>
  );
}

export function TowerScene(p: { coinsAt: number; winAt: number; fast?: boolean }) {
  const f = useCurrentFrame(), { fps } = useVideoConfig(), { tall } = useLay();
  const fast = !!p.fast;
  // geometry: a square shares the width with the phone; a tall frame stacks them
  const g = tall
    ? { rowH: 54, TW: 980, labW: 170, ww: 20, wg: 6, coinW: 160, stack: 16, pcW: 120, font: 26, small: 22 }
    : { rowH: 50, TW: 720, labW: 128, ww: 15, wg: 5, coinW: 132, stack: 12, pcW: 92, font: 20, small: 18 };
  const winN = 9, winW = winN * g.ww + (winN - 1) * g.wg + 20, paneW = g.TW - 12 - g.labW - winW - g.coinW - g.pcW, HT = g.rowH * PRICES.length, rowH = g.rowH;
  const rise = spring({ frame: f, fps, config: { damping: 15, stiffness: 120 } });
  const draw = interpolate(f, fast ? [0, 16] : [6, 56], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const pickAt = fast ? 18 : 62, picked = f >= pickAt, pickS = spring({ frame: f - pickAt, fps, config: { damping: 12, stiffness: 200 } });
  const win = spring({ frame: f - p.winAt, fps, config: { damping: 10, stiffness: 220 } });
  const push = interpolate(f, [0, 120], [1, 1.04]);

  // a day's walk: a slow swing, a little noise, settling onto the picked floor
  const pts = Array.from({ length: 40 }, (_, i) => { const u = i / 39; const y = (PICK + 0.5 + (Math.sin(u * 5.2 + 0.6) * 1.4 + Math.sin(i * 1.7) * 0.18) * (1 - u * 0.85) + (1 - u) * 1.2) * rowH; return [u * (paneW - 8), y] as const; });
  const path = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  // the marker rides the line's drawn end: the point at `draw` of its length
  const segs = pts.slice(1).map(([x, y], i) => Math.hypot(x - pts[i]![0], y - pts[i]![1])), total = segs.reduce((a, b) => a + b, 0);
  let tip: readonly [number, number] = pts[0]!;
  for (let i = 0, run = 0, want = draw * total; i < segs.length; run += segs[i]!, i++) if (run + segs[i]! >= want) { const k = (want - run) / segs[i]!, [x0, y0] = pts[i]!, [x1, y1] = pts[i + 1]!; tip = [x0 + (x1 - x0) * k, y0 + (y1 - y0) * k]; break; }

  const tower = (
    <div style={{ width: g.TW, border: `6px solid ${C.cream}`, background: C.sky, boxShadow: `14px 14px 0 ${C.brick2}`, position: "relative" }}>
      <div style={{ height: tall ? 44 : 36, background: "#050608", borderBottom: "4px solid #c9bfa4", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 14px" }}>
        <span style={{ fontFamily: MONO, fontWeight: 600, fontSize: g.small, color: "#ffb13b", textShadow: "0 0 6px rgba(255,160,40,.6)" }}>BTC · BELL 4:00 PM</span>
      </div>
      <div style={{ position: "relative", height: HT }}>
        {PRICES.map((pr, r) => {
          const inCall = picked && level(r) > 0, lit = Math.round((PCT[r]! / 21) * winN);
          const lightUp = interpolate(f, fast ? [0, 8] : [4 + r * 2, 14 + r * 2], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          const d = Math.abs(r - PICK) * (fast ? 2 : 4);
          const coins = Math.round(level(r) * interpolate(f, [p.coinsAt + d, p.coinsAt + d + (fast ? 10 : 18)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: (t) => 1 - (1 - t) ** 3 }));
          return (
            <div key={r} style={{ position: "absolute", left: 0, right: 0, top: r * rowH, height: rowH, display: "flex", boxShadow: "inset 0 -3px 0 #5c2219" }}>
              <div style={{ width: g.labW, background: "#3a2622", borderRight: "3px solid #5c2219", display: "flex", alignItems: "center", paddingLeft: 12, fontFamily: MONO, fontWeight: 600, fontSize: g.font, color: inCall ? C.taxi : C.cream2 }}>{pr}</div>
              <div style={{ width: paneW, background: r === PICK && picked ? "#1b2b4a" : "#121c33", boxShadow: "inset 0 -1px 0 #1d2944" }} />
              <div style={{ width: winW, background: "#7a2f22", display: "flex", alignItems: "center", gap: g.wg, padding: "0 10px" }}>
                {Array.from({ length: winN }, (_, k) => <div key={k} style={{ width: g.ww, height: rowH - 16, background: k < lit * lightUp ? "#efe6cc" : "#15213a", boxShadow: k < lit * lightUp ? "inset 0 -4px 0 #d6c9a4, 0 0 10px rgba(244,233,200,.25)" : "inset 0 0 0 2px #0a1020" }} />)}
              </div>
              <div style={{ width: g.coinW, background: inCall ? "#8d3a28" : "#7a2f22", display: "flex", alignItems: "center", gap: 3, padding: "0 8px" }}>
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
          <div style={{ position: "absolute", left: g.labW + paneW, right: 0, top: (PICK - REACH) * rowH - 3, height: 6, background: C.taxi, transform: `scaleX(${pickS})`, transformOrigin: "left" }} />
          <div style={{ position: "absolute", left: g.labW + paneW, right: 0, top: (PICK + REACH + 1) * rowH - 3, height: 6, background: C.taxi, transform: `scaleX(${pickS})`, transformOrigin: "left" }} />
          <div style={{ position: "absolute", left: 0, width: g.labW, top: PICK * rowH + 4, height: rowH - 8, background: C.cream, color: C.ink, display: "flex", alignItems: "center", paddingLeft: 8, fontFamily: MONO, fontWeight: 600, fontSize: g.font, border: `3px solid ${C.ink}`, transform: `scale(${pickS})` }}>◆ {PRICES[PICK]}</div>
          {f < pickAt + 20 && <div style={{ position: "absolute", left: g.labW + paneW + winW / 2 - 36, top: PICK * rowH + rowH / 2 - 36, width: 72, height: 72, borderRadius: "50%", border: `6px solid ${C.cream}`, opacity: interpolate(f, [pickAt, pickAt + 18], [1, 0]), transform: `scale(${interpolate(f, [pickAt, pickAt + 18], [0.3, 1.8])})` }} />}
        </>}
        {f >= p.winAt && <div style={{ position: "absolute", right: g.pcW - 20, top: PICK * rowH + rowH / 2 - (tall ? 30 : 26), transform: `scale(${win})`, transformOrigin: "right center", background: C.cream, color: C.ink, border: `4px solid ${C.ink}`, boxShadow: `5px 5px 0 #b47416`, padding: "6px 12px", fontFamily: MONO, fontWeight: 700, fontSize: tall ? 28 : 23, whiteSpace: "nowrap", zIndex: 3 }}>WIN 3.12M · 2.3×</div>}
      </div>
    </div>
  );

  const head = (
    <Rise at={0} style={{ textAlign: "center" }}>
      <Shout size={tall ? 56 : 44}>CALL WHERE<br />IT <span style={{ color: C.taxi }}>CLOSES</span></Shout>
      <div style={{ fontFamily: SANS, fontWeight: 600, fontSize: tall ? 36 : 28, color: C.cream2, marginTop: tall ? 16 : 8 }}>Pick a floor. 4 PM New York.</div>
    </Rise>
  );
  const towerBox = <div style={{ transform: `translateY(${(1 - rise) * 160}px) scale(${push})`, opacity: Math.min(1, rise * 1.4) }}>{tower}</div>;

  return (
    <AbsoluteFill style={{ background: C.ink, overflow: "hidden" }}>
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at 50% 40%, #182642 0%, #0b1120 70%)" }} />
      {tall ? (
        <AbsoluteFill style={{ alignItems: "center", paddingTop: 110, gap: 40 }}>
          {head}
          {towerBox}
          {/* under the drawing, the real thing */}
          <div style={{ display: "flex", alignItems: "center", gap: 36, marginTop: 6 }}>
            <Rise at={fast ? 4 : 10} style={{ width: 520 }}>
              <div style={{ fontFamily: PX, fontSize: 18, color: C.ink, background: C.taxi, display: "inline-block", padding: "8px 12px", marginBottom: 22 }}>LIVE ON STOOKSTREET.XYZ</div>
              <Shout size={40}>TAP A FLOOR.<br />PICK HOW<br /><span style={{ color: C.taxi }}>SURE.</span></Shout>
              <div style={{ fontFamily: SANS, fontWeight: 600, fontSize: 30, color: C.cream2, marginTop: 18 }}>Sure pays more. Not sure pays wider.</div>
            </Rise>
            <Phone width={360} at={fast ? 2 : 8} />
          </div>
        </AbsoluteFill>
      ) : (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 26 }}>
          {head}
          <div style={{ display: "flex", alignItems: "flex-start", gap: 24 }}>
            {towerBox}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
              <Phone width={250} at={fast ? 2 : 8} />
              <div style={{ fontFamily: PX, fontSize: 13, color: C.ink, background: C.taxi, padding: "6px 9px" }}>LIVE SITE</div>
            </div>
          </div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
}
