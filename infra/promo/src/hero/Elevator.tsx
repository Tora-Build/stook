// The elevator ride: the camera rides the tower's glass elevator up past the
// floors (each a price, lit windows the crowd's chance), the brass dial
// sweeps and the counter ticks, it stops at the picked floor, the doors open,
// gold coins pour out, "WIN 2.3×" (an illustration, and labelled so).
import { AbsoluteFill, Easing, interpolate, random, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, MONO, PX, Rise, SANS, Shout, useLay } from "../Ad";
import { Pixel } from "../pixel";

const NF = 34, START = 3, TARGET = 20;
// S&P 500 floors, as on the tower beat: the called floor 770.43, each floor ~0.5% (src/data/spx.json's level).
const price = (i: number) => 770.43 * Math.pow(1.005, i - TARGET);
const fmt = (v: number) => v.toFixed(2);
const GOLD = ["...aaa...", ".abbbba..", "abcbbbba.", "abcbbbbba", "abbbbbbba", "abbbbbbba", ".abbbbba.", "..aaaaa.."];
const GOLDPAL = { a: "#8a5a12", b: "#f0a83a", c: "#ffe28a" };

export function Elevator(p: { stopAt: number; coinsAt: number; winAt: number }) {
  const f = useCurrentFrame(), { fps } = useVideoConfig(), { W, H, tall } = useLay();
  const rowH = tall ? 176 : 150, cy = tall ? H * 0.5 : H * 0.53;
  // the ride: slow start, fast middle, a settle onto the floor
  const pos = interpolate(f, [4, p.stopAt], [START, TARGET], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.55, 0, 0.25, 1) });
  const vel = Math.abs(interpolate(f + 1, [4, p.stopAt], [START, TARGET], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.55, 0, 0.25, 1) }) - pos) * rowH;
  const doors = interpolate(f, [p.stopAt + 4, p.stopAt + 16], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const push = interpolate(f, [p.stopAt, p.stopAt + 22], [1, tall ? 1.35 : 1.45], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) });
  const win = spring({ frame: f - p.winAt, fps, config: { damping: 10, stiffness: 220 } });
  const shaftW = 210, cx = W / 2, winBlock = 220, priceW = 190;
  const left = cx - shaftW / 2, right = cx + shaftW / 2;
  const floors = [];
  for (let i = 0; i < NF; i++) {
    const y = cy - (i - pos) * rowH - rowH / 2; if (y < -rowH || y > H + rowH) continue;
    const near = Math.exp(-(((i - TARGET) / 4.5) ** 2)), at = i === TARGET && f >= p.stopAt;
    floors.push(
      <div key={i} style={{ position: "absolute", left: 0, right: 0, top: y, height: rowH, boxShadow: "inset 0 -6px 0 #5c2219" }}>
        <div style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, background: "#7a2f22" }} />
        <div style={{ position: "absolute", left: left - winBlock - priceW, width: priceW, top: 0, bottom: 0, opacity: 1 - (push - 1) * 3, background: "#3a2622", borderRight: "4px solid #5c2219", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: MONO, fontWeight: 700, fontSize: tall ? 34 : 30, color: at ? C.taxi : C.cream2 }}>{fmt(price(i))}</div>
        {[left - winBlock, right].map((x, side) => (
          <div key={side} style={{ position: "absolute", left: x, width: winBlock, top: 18, bottom: 26, display: "flex", gap: 10, justifyContent: "center" }}>
            {Array.from({ length: 5 }, (_, k) => { const lit = random(`w${i}-${side}-${k}`) < near * 0.95 + 0.05; return <div key={k} style={{ width: 34, background: lit ? "#efe6cc" : "#15213a", boxShadow: lit ? "inset 0 -6px 0 #d6c9a4, 0 0 14px rgba(244,233,200,.3)" : "inset 0 0 0 3px #0a1020" }} />; })}
          </div>
        ))}
        {at && <div style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, boxShadow: `inset 0 6px 0 ${C.taxi}, inset 0 -6px 0 ${C.taxi}` }} />}
      </div>,
    );
  }
  const carW = shaftW - 26, carH = rowH - 22;
  const coinsT = f - p.coinsAt;
  return (
    <AbsoluteFill style={{ background: "#7a2f22", overflow: "hidden" }}>
      <AbsoluteFill style={{ transform: `scale(${push})`, transformOrigin: `${cx}px ${cy}px` }}>
        {floors}
        {/* the shaft: dark glass, rails */}
        <div style={{ position: "absolute", left, width: shaftW, top: 0, bottom: 0, background: "rgba(10,16,32,.92)", borderLeft: "6px solid #3a3f4c", borderRight: "6px solid #3a3f4c" }}>
          <div style={{ position: "absolute", left: shaftW / 2 - 2, top: 0, bottom: 0, width: 4, background: `repeating-linear-gradient(180deg, #8a8f99 0 12px, transparent 12px 24px)`, transform: `translateY(${(pos * rowH) % 24}px)` }} />
        </div>
        {/* the car */}
        <div style={{ position: "absolute", left: cx - carW / 2, top: cy - carH / 2, width: carW, height: carH, background: "linear-gradient(180deg, #ffe7a8, #f0a83a)", border: `8px solid ${C.cream}`, boxShadow: "0 0 0 4px #0b1120, 0 0 40px rgba(255,214,102,.35)", overflow: "hidden" }}>
          <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${50 - doors * 46}%`, background: "repeating-linear-gradient(90deg, #b8923a 0 10px, #a8822e 10px 20px)", borderRight: "3px solid #5a4012" }} />
          <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: `${50 - doors * 46}%`, background: "repeating-linear-gradient(90deg, #b8923a 0 10px, #a8822e 10px 20px)", borderLeft: "3px solid #5a4012" }} />
        </div>
        {/* speed streaks */}
        {vel > 6 && Array.from({ length: 14 }, (_, k) => <div key={k} style={{ position: "absolute", left: random(`sx${k}`) * W, top: ((random(`sy${k}`) * H + f * vel * 1.4) % (H + 300)) - 300, width: 4, height: Math.min(260, vel * 6), background: "rgba(244,233,200,.35)" }} />)}
      </AbsoluteFill>
      {/* coins pour out of the open doors */}
      {coinsT >= 0 && Array.from({ length: tall ? 34 : 28 }, (_, i) => {
        const t = coinsT - random(`cd${i}`) * 10; if (t < 0) return null;
        const vx = (random(`cv${i}`) - 0.5) * 22, vy = -10 - random(`cu${i}`) * 12, x = cx + vx * t, y = cy + 20 + vy * t + 0.9 * t * t;
        if (y > H + 40) return null;
        return <div key={i} style={{ position: "absolute", left: x - 27, top: y, transform: `scaleX(${Math.max(0.2, Math.abs(Math.cos(t * 0.4 + i)))})` }}><Pixel map={GOLD} pal={GOLDPAL} s={6} /></div>;
      })}
      {/* the dial and the counter */}
      <div style={{ position: "absolute", left: cx - 190, top: tall ? 120 : 30, width: 380, display: "flex", flexDirection: "column", alignItems: "center" }}>
        <svg width={380} height={200} viewBox="0 0 380 200">
          <path d="M 20 190 A 170 170 0 0 1 360 190 Z" fill="#2a1a10" stroke="#c9a24a" strokeWidth={10} />
          {Array.from({ length: 11 }, (_, k) => { const a = Math.PI - (k / 10) * Math.PI; return <line key={k} x1={190 + Math.cos(a) * 150} y1={190 - Math.sin(a) * 150} x2={190 + Math.cos(a) * 128} y2={190 - Math.sin(a) * 128} stroke={k === 10 ? C.taxi : "#e8d9a8"} strokeWidth={6} />; })}
          {(() => { const a = Math.PI - ((pos - START) / (TARGET - START)) * Math.PI; return <line x1={190} y1={190} x2={190 + Math.cos(a) * 140} y2={190 - Math.sin(a) * 140} stroke={C.cream} strokeWidth={10} strokeLinecap="square" />; })()}
          <circle cx={190} cy={190} r={18} fill="#c9a24a" />
        </svg>
        <div style={{ marginTop: 8, background: "#050608", border: "4px solid #c9a24a", padding: "8px 18px", fontFamily: MONO, fontWeight: 700, fontSize: tall ? 40 : 34, color: "#ffb13b", textShadow: "0 0 8px rgba(255,160,40,.6)" }}>FLOOR {fmt(price(Math.round(pos)))}</div>
      </div>
      {/* the win */}
      {f >= p.winAt && <div style={{ position: "absolute", left: 0, right: 0, top: cy + (tall ? 210 : 150), display: "flex", flexDirection: "column", alignItems: "center", gap: 12, transform: `scale(${win})` }}>
        <div style={{ background: C.cream, color: C.ink, border: `6px solid ${C.ink}`, boxShadow: `8px 8px 0 #b47416`, padding: "10px 26px", fontFamily: PX, fontSize: tall ? 64 : 54 }}>WIN 2.3×</div>
        <div style={{ fontFamily: PX, fontSize: tall ? 22 : 18, color: C.ink, background: C.taxi, padding: "8px 12px" }}>PAID IN $STOOK</div>
      </div>}
      {/* the line */}
      {f < p.stopAt + 6 && <Rise at={6} style={{ position: "absolute", left: 0, right: 0, bottom: tall ? 170 : 60, textAlign: "center" }}>
        <div style={{ display: "inline-block", background: "rgba(11,17,32,.88)", border: `5px solid ${C.cream}`, boxShadow: `8px 8px 0 ${C.brick2}`, padding: tall ? "24px 32px" : "16px 24px" }}>
          <Shout size={tall ? 46 : 36}>RIDE TO <span style={{ color: C.taxi }}>YOUR FLOOR</span></Shout>
          <div style={{ fontFamily: SANS, fontWeight: 600, fontSize: tall ? 30 : 24, color: C.cream2, marginTop: 10 }}>Every floor is a price. Lit windows: the crowd's chance.</div>
        </div>
      </Rise>}
    </AbsoluteFill>
  );
}
