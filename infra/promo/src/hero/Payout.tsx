// After the bell: how a call pays. On the tower, the called floor's gold stack
// fills in full, a floor off pays less, far off pays nothing; then the close
// drops onto the called floor, the gold bursts, and SETTLES ON PYTH slams on.
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, MONO, PX, Shout, useLay } from "../Ad";
import SPX from "../data/spx.json";

const N = 7, CALL = 3, STEP = 1.005;
const P = SPX.points as [number, number][], last = P[P.length - 1]![1];
const lo = (k: number) => (last / Math.sqrt(STEP)) * STEP ** (CALL - k);
const STACKS = [8, 4, 1, 0]; // by distance from the called floor
const SAY = ["PAYS IN FULL", "PAYS LESS", "PAYS LITTLE", "PAYS NOTHING"];

/** `at`: [full, less, nothing, close, pyth] frames, each on a beat. */
export function PayoutScene(p: { at: number[] }) {
  const f = useCurrentFrame(), { fps } = useVideoConfig(), { tall } = useLay();
  const [aFull, aLess, aNone, aClose, aPyth] = p.at as [number, number, number, number, number];
  const rowH = tall ? 112 : 78, labW = tall ? 200 : 150, stackW = tall ? 330 : 250, sayW = tall ? 340 : 300, TW = labW + stackW + sayW + 12;
  const showAt = (d: number) => (d === 0 ? aFull : d === 1 ? aLess : aNone);
  const close = interpolate(f, [aClose, aClose + 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.in(Easing.quad) });
  const landed = f >= aClose + 10, burst = f - aClose - 10;
  const stamp = spring({ frame: f - aPyth, fps, config: { damping: 9, stiffness: 260, mass: 0.7 } });
  const head = spring({ frame: f, fps, config: { damping: 14, stiffness: 160 } });
  const shake = burst >= 0 && burst < 8 ? Math.round(Math.sin(burst * 3) * (8 - burst) * 1.5) : 0;
  return (
    <AbsoluteFill style={{ background: C.ink, overflow: "hidden", transform: `translate(${shake}px, 0)` }}>
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at 50% 55%, #182642 0%, #0b1120 70%)" }} />
      <div style={{ position: "absolute", left: 0, right: 0, top: tall ? 120 : 40, textAlign: "center", transform: `scale(${head})` }}>
        <Shout size={tall ? 64 : 46}>{tall ? <>THE CLOSER<br />YOU ARE,<br /><span style={{ color: C.taxi }}>THE MORE<br />IT PAYS.</span></> : <>THE CLOSER<br />YOU ARE, <span style={{ color: C.taxi }}>THE MORE<br />IT PAYS.</span></>}</Shout>
      </div>
      <div style={{ position: "absolute", left: "50%", top: tall ? 620 : 280, width: TW, transform: "translateX(-50%)", border: `6px solid ${C.cream}`, background: C.sky, boxShadow: `14px 14px 0 ${C.brick2}` }}>
        <div style={{ height: tall ? 52 : 38, background: "#050608", borderBottom: "4px solid #c9bfa4", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 14px", fontFamily: MONO, fontWeight: 600, fontSize: tall ? 24 : 18 }}>
          <span style={{ color: "#ffb13b" }}>S&amp;P 500 · THE CLOSE</span><span style={{ color: C.cream2 }}>YOUR CALL ◆</span>
        </div>
        <div style={{ position: "relative", height: rowH * N }}>
          {Array.from({ length: N }, (_, k) => {
            const d = Math.min(3, Math.abs(k - CALL)), at = showAt(d), u = interpolate(f, [at, at + 8], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
            const n = Math.round(STACKS[d]! * u), isCall = k === CALL, hit = isCall && landed;
            return (
              <div key={k} style={{ position: "absolute", left: 0, right: 0, top: k * rowH, height: rowH, display: "flex", boxShadow: "inset 0 -3px 0 #5c2219" }}>
                <div style={{ width: labW, background: isCall ? C.cream : "#3a2622", color: isCall ? C.ink : C.cream2, borderRight: "3px solid #5c2219", display: "flex", alignItems: "center", paddingLeft: 12, fontFamily: MONO, fontWeight: 700, fontSize: tall ? 30 : 22 }}>{isCall ? "◆ " : ""}{lo(k).toFixed(2)}</div>
                <div style={{ width: stackW, background: hit ? "#b0582c" : d === 0 ? "#8d3a28" : "#7a2f22", display: "flex", alignItems: "center", gap: 4, padding: "0 10px" }}>
                  {Array.from({ length: n }, (_, j) => <div key={j} style={{ width: tall ? 30 : 22, height: rowH - 18, background: "repeating-linear-gradient(180deg, #ffe28a 0 3px, #f0a83a 3px 8px, #8a5a12 8px 11px)", boxShadow: hit ? "0 0 14px rgba(255,214,102,.9)" : "inset 2px 0 0 rgba(255,255,255,.18)" }} />)}
                </div>
                <div style={{ width: sayW, background: "#3a2622", borderLeft: "3px solid #5c2219", display: "flex", alignItems: "center", paddingLeft: 14, fontFamily: PX, fontSize: tall ? 20 : 15, color: d === 0 ? C.taxi : d === 3 ? "#a39c85" : C.cream }}><span style={{ opacity: isCall && f >= aClose ? 0 : u }}>{SAY[d]}</span></div>
              </div>
            );
          })}
          {/* the close: a marker drops onto the called floor */}
          {f >= aClose && <div style={{ position: "absolute", left: labW + stackW + 14, top: interpolate(close, [0, 1], [-rowH, CALL * rowH + (tall ? 10 : 6)]), zIndex: 4, background: C.ink, border: `4px solid ${C.cream}`, padding: "4px 10px", fontFamily: MONO, fontWeight: 700, fontSize: tall ? 26 : 19, color: C.cream, whiteSpace: "nowrap" }}>CLOSE {(last * 1.0015).toFixed(2)}{landed ? " ✓" : ""}</div>}
          {landed && <div style={{ position: "absolute", left: labW + stackW + 14, top: CALL * rowH + rowH - (tall ? 32 : 22), zIndex: 4, fontFamily: PX, fontSize: tall ? 18 : 12, color: C.taxi }}>PAYS IN FULL</div>}
          {landed && burst < 18 && Array.from({ length: 10 }, (_, i) => { const a = (i / 10) * Math.PI * 2, r = 20 + burst * 12; return <div key={i} style={{ position: "absolute", left: labW + stackW / 2 + Math.cos(a) * r, top: CALL * rowH + rowH / 2 + Math.sin(a) * r * 0.6, width: 14, height: 14, background: i % 2 ? C.cream : C.taxi, opacity: 1 - burst / 18, zIndex: 5 }} />; })}
        </div>
      </div>
      {f >= aPyth && <div style={{ position: "absolute", left: "50%", top: tall ? 1520 : 905, transform: `translateX(-50%) scale(${interpolate(stamp, [0, 1], [2.6, 1])}) rotate(-6deg)`, opacity: Math.min(1, stamp * 2), background: C.cream, border: `8px double ${C.brick}`, padding: tall ? "16px 34px" : "10px 26px", boxShadow: "8px 8px 0 rgba(0,0,0,.45)", textAlign: "center", zIndex: 6 }}>
        <div style={{ fontFamily: PX, fontSize: tall ? 40 : 34, color: C.brick, letterSpacing: "0.04em", whiteSpace: "nowrap" }}>SETTLES ON PYTH</div>
        <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: tall ? 24 : 18, color: C.ink, marginTop: 6, whiteSpace: "nowrap" }}>paid in $STOOK, the coin you called with</div>
      </div>}
    </AbsoluteFill>
  );
}
