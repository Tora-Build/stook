// The bell: the tower's street as the round's ride. The taxi drives from the
// open to the checkered flag, the road behind it lit gold; at the flag the
// bell rings and the screen shakes.
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, MONO, Rise, Shout, useLay } from "./Ad";
import { Skyline } from "./Skyline";
import { BELL, BELLPAL, FLAG, FLAGPAL, Pixel, TAXI, TAXIPAL } from "./pixel";

export function BellScene() {
  const f = useCurrentFrame(), { fps } = useVideoConfig(), { W, H, tall } = useLay();
  const ARRIVE = 44;
  const ride = interpolate(f, [2, ARRIVE], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) });
  const ring = f - ARRIVE, swing = ring >= 0 ? Math.sin(ring * 0.55) * 26 * Math.exp(-ring / 22) : 0;
  const shake = ring >= 0 && ring < 10 ? Math.round(Math.sin(ring * 3.1) * (10 - ring) * 1.8) : 0;
  const bellIn = spring({ frame: f, fps, config: { damping: 14, stiffness: 140 } });
  const streetH = tall ? 300 : 230, taxiS = tall ? 9 : 8, taxiW = 16 * taxiS, r0 = 60, r1 = W - 150, tx = r0 + ride * (r1 - r0 - taxiW);
  const bellS = tall ? 22 : 17;
  return (
    <AbsoluteFill style={{ background: C.ink, overflow: "hidden", transform: `translate(${shake}px, ${-shake / 2}px)` }}>
      <Skyline width={W} height={H - streetH + 40} scale={6} style={{ opacity: 0.5 }} exchange={false} />
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(11,17,32,.85) 0%, rgba(11,17,32,.35) 100%)" }} />
      {/* the bell */}
      <AbsoluteFill style={{ alignItems: "center", paddingTop: tall ? 260 : 70 }}>
        <div style={{ transform: `scale(${bellIn}) rotate(${swing}deg)`, transformOrigin: "50% 0%", filter: ring >= 0 ? `drop-shadow(0 0 ${Math.max(0, 40 - ring)}px rgba(255,226,138,.8))` : "none" }}>
          <Pixel map={BELL} pal={BELLPAL} s={bellS} />
        </div>
        {ring >= 0 && ring < 30 && [0, 8].map((d) => <div key={d} style={{ position: "absolute", top: (tall ? 260 : 70) + 5 * bellS - 60, width: 120, height: 120, borderRadius: "50%", border: `8px solid ${C.taxi}`, opacity: interpolate(ring - d, [0, 22], [0.9, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }), transform: `scale(${interpolate(ring - d, [0, 22], [0.5, 4.5], { extrapolateLeft: "clamp" })})` }} />)}
        <Rise at={ARRIVE + 2} style={{ textAlign: "center", marginTop: tall ? 120 : 46 }}>
          <Shout size={tall ? 54 : 44}>THE CLOSER<br />YOU ARE,<br /><span style={{ color: C.taxi }}>THE MORE<br />IT PAYS</span></Shout>
        </Rise>
      </AbsoluteFill>
      {/* the street: open on the left, the bell's flag on the right */}
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: streetH, background: "linear-gradient(180deg, #46506a 0 14px, #1b2336 14px 100%)" }}>
        <div style={{ position: "absolute", left: 0, right: 0, top: streetH * 0.62, height: 6, background: "repeating-linear-gradient(90deg, rgba(163,156,133,.6) 0 36px, transparent 36px 72px)" }} />
        <div style={{ position: "absolute", left: r0, top: streetH * 0.62 - 3, height: 12, width: Math.max(0, tx + taxiW / 2 - r0), background: C.taxi, boxShadow: "0 0 18px rgba(240,168,58,.7)" }} />
        <div style={{ position: "absolute", left: r0, top: 34, fontFamily: MONO, fontWeight: 600, fontSize: tall ? 34 : 28, color: C.cream2 }}>OPEN</div>
        <div style={{ position: "absolute", right: 40 + (tall ? 100 : 80) + 24, top: 34, fontFamily: MONO, fontWeight: 700, fontSize: tall ? 34 : 28, color: C.taxi }}>BELL 4:00 PM</div>
        <div style={{ position: "absolute", right: 40, top: 20 }}><Pixel map={FLAG} pal={FLAGPAL} s={tall ? 10 : 8} /></div>
        <div style={{ position: "absolute", left: r1 - 30, top: streetH * 0.62 - 40, width: 12, height: 64, background: "repeating-linear-gradient(180deg, #c0392b 0 12px, #f4e9c8 12px 24px)", boxShadow: "3px 3px 0 #000" }} />
        <div style={{ position: "absolute", left: tx, top: streetH * 0.62 - 7 * taxiS + 14, transform: `translateY(${f % 6 < 3 && ride < 1 ? -3 : 0}px)` }}><Pixel map={TAXI} pal={TAXIPAL} s={taxiS} /></div>
      </div>
    </AbsoluteFill>
  );
}
