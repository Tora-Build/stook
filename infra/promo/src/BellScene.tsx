// The bell, as the payoff: the taxi crosses the checkered flag, the bell
// swings hard with motion lines and shockwaves, gold coins rain, a PAID stamp
// slams on (an illustration, as its label says). The line stays on screen
// the whole beat, on its own plate.
import { AbsoluteFill, Easing, interpolate, random, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, MONO, PX, Shout, useLay } from "./Ad";
import { Skyline } from "./Skyline";
import { BELL, BELLPAL, FLAG, FLAGPAL, Pixel, TAXI, TAXIPAL } from "./pixel";

const GOLD = ["...aaa...", ".abbbba..", "abcbbbba.", "abcbbbbba", "abbbbbbba", "abbbbbbba", ".abbbbba.", "..aaaaa..", "........."];
const GOLDPAL = { a: "#8a5a12", b: "#f0a83a", c: "#ffe28a" };

function CoinRain(p: { at: number; n: number }) {
  const f = useCurrentFrame(), { W, H } = useLay(), t = f - p.at;
  if (t < 0) return null;
  return <>{Array.from({ length: p.n }, (_, i) => {
    const d = random(`d${i}`) * 14, tt = t - d; if (tt < 0) return null;
    const x = random(`x${i}`) * (W - 60), vx = (random(`v${i}`) - 0.5) * 4, y = -80 + tt * (9 + random(`s${i}`) * 5) + 0.35 * tt * tt;
    if (y > H) return null;
    const flip = Math.abs(Math.cos(tt * 0.35 + i)), s = 5 + Math.floor(random(`z${i}`) * 3);
    return <div key={i} style={{ position: "absolute", left: x + vx * tt, top: y, transform: `scaleX(${Math.max(0.15, flip)})` }}><Pixel map={GOLD} pal={GOLDPAL} s={s} /></div>;
  })}</>;
}

// ticker-tape confetti: paper strips that flutter down after the bell
function Confetti(p: { at: number; n: number }) {
  const f = useCurrentFrame(), { W, H } = useLay(), t = f - p.at;
  if (t < 0) return null;
  const cols = ["#efe6cc", "#f0a83a", "#35c4c4", "#f4e9c8", "#e0605a"];
  return <>{Array.from({ length: p.n }, (_, i) => {
    const d = random(`cd${i}`) * 18, tt = t - d; if (tt < 0) return null;
    const x = random(`cx${i}`) * W + Math.sin(tt * 0.12 + i) * 40, y = -60 + tt * (7 + random(`cs${i}`) * 5);
    if (y > H) return null;
    return <div key={i} style={{ position: "absolute", left: x, top: y, width: 12, height: 44 + random(`ch${i}`) * 30, background: cols[i % cols.length], transform: `rotate(${Math.sin(tt * 0.2 + i) * 60}deg) scaleX(${0.4 + Math.abs(Math.cos(tt * 0.25 + i)) * 0.6})`, boxShadow: "2px 2px 0 rgba(0,0,0,.35)" }} />;
  })}</>;
}

// the exchange clock: brass rim, cream face, hands sweeping to four
function Clock(p: { size: number; at: number }) {
  const f = useCurrentFrame(), u = interpolate(f, [0, p.at], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) });
  const r = p.size / 2, minute = u * 360 * 3, hour = 90 + u * 30, hit = f >= p.at && f < p.at + 8;
  const hand = (deg: number, len: number, w: number, col: string) => { const a = ((deg - 90) * Math.PI) / 180; return <line x1={r} y1={r} x2={r + Math.cos(a) * len} y2={r + Math.sin(a) * len} stroke={col} strokeWidth={w} strokeLinecap="square" />; };
  return (
    <svg width={p.size} height={p.size} viewBox={`0 0 ${p.size} ${p.size}`} style={{ filter: hit ? "drop-shadow(0 0 30px rgba(255,214,102,.9))" : "none" }}>
      <circle cx={r} cy={r} r={r - 8} fill="#f4e9c8" stroke="#c9a24a" strokeWidth={16} />
      {Array.from({ length: 12 }, (_, k) => { const a = (k / 12) * Math.PI * 2; return <rect key={k} x={r + Math.cos(a) * (r - 40) - 6} y={r + Math.sin(a) * (r - 40) - 6} width={12} height={12} fill={k % 3 === 0 ? "#a8412f" : "#0b1120"} />; })}
      {hand(hour, r * 0.45, 14, "#0b1120")}
      {hand(minute, r * 0.7, 9, "#0b1120")}
      <circle cx={r} cy={r} r={12} fill="#a8412f" />
    </svg>
  );
}

export function BellScene(p: { ringAt: number; clockAt?: number; confetti?: boolean; stamp?: boolean }) {
  const f = useCurrentFrame(), { fps } = useVideoConfig(), { W, H, tall } = useLay();
  const ARRIVE = p.ringAt, ring = f - ARRIVE;
  const swing = ring >= 0 ? Math.sin(ring * 0.5) * 34 * Math.exp(-ring / 26) : Math.sin(f * 0.25) * 4;
  const vel = ring >= 0 ? Math.abs(Math.cos(ring * 0.5)) * Math.exp(-ring / 26) : 0;
  const shake = ring >= 0 && ring < 12 ? Math.round(Math.sin(ring * 3.1) * (12 - ring) * 2) : 0;
  const clock = p.clockAt !== undefined, bellFrom = clock ? p.clockAt! + 4 : 0;
  const bellIn = spring({ frame: f - bellFrom, fps, config: { damping: 12, stiffness: 160 } });
  const stamp = spring({ frame: ring - 6, fps, config: { damping: 9, stiffness: 260, mass: 0.7 } });
  const glow = ring >= 0 ? interpolate(ring, [0, 6, 40], [0, 1, 0.55], { extrapolateRight: "clamp" }) : 0;
  const streetH = tall ? 300 : 210, taxiS = tall ? 9 : 7, taxiW = 16 * taxiS, flagX = W - 150;
  // the taxi's nose reaches the flag on the ring, then it drives on out of frame
  const xA = flagX + 24 - taxiW, tx = f <= ARRIVE ? interpolate(f, [0, ARRIVE], [40, xA], { easing: Easing.in(Easing.quad) }) : xA + (f - ARRIVE) * 5;
  const bellS = tall ? 26 : 19, bellTop = tall ? 150 : 34, bellW = 10 * bellS, bellH = 11 * bellS, cx = W / 2, cy = bellTop + bellH * 0.45;
  return (
    <AbsoluteFill style={{ background: C.ink, overflow: "hidden", transform: `translate(${shake}px, ${-shake / 2}px)` }}>
      <Skyline width={W} height={H - streetH + 40} scale={6} style={{ opacity: 0.75 }} exchange={false} />
      <AbsoluteFill style={{ background: `radial-gradient(circle at 50% ${(cy / H) * 100}%, rgba(255,214,102,${0.45 * glow}) 0%, rgba(11,17,32,0) ${tall ? 38 : 48}%), linear-gradient(180deg, rgba(11,17,32,.6) 0%, rgba(11,17,32,.15) 100%)` }} />
      {/* shockwaves */}
      {ring >= 0 && [0, 6, 12].map((d) => { const u = ring - d; if (u < 0 || u > 26) return null; return <div key={d} style={{ position: "absolute", left: cx - 80, top: cy - 80, width: 160, height: 160, borderRadius: "50%", border: `${12 - u * 0.35}px solid ${d % 12 ? C.cream : C.taxi}`, opacity: interpolate(u, [0, 26], [0.9, 0]), transform: `scale(${interpolate(u, [0, 26], [0.6, tall ? 7 : 6])})` }} />; })}
      {p.confetti ? <Confetti at={ARRIVE + 1} n={tall ? 60 : 46} /> : <CoinRain at={ARRIVE + 2} n={tall ? 34 : 26} />}
      {/* the clock sweeps to four, then steps aside for the bell */}
      {clock && (() => {
        const size = tall ? 420 : 300, move = interpolate(f, [p.clockAt! + 2, p.clockAt! + 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) });
        const s = interpolate(move, [0, 1], [1, 0.42]), x = interpolate(move, [0, 1], [cx - size / 2, 40]), y = interpolate(move, [0, 1], [cy - size / 2 + (tall ? 40 : 30), tall ? 60 : 26]);
        return <div style={{ position: "absolute", left: x, top: y, transform: `scale(${s})`, transformOrigin: "0 0", zIndex: 4 }}>
          <Clock size={size} at={p.clockAt!} />
          {f >= p.clockAt! && <div style={{ textAlign: "center", marginTop: 10, fontFamily: PX, fontSize: tall ? 44 : 34, color: C.taxi, textShadow: `4px 4px 0 ${C.brick2}` }}>4:00 PM</div>}
        </div>;
      })()}
      {/* the bell, swinging, with motion lines either side */}
      <div style={{ position: "absolute", left: cx - bellW / 2, top: bellTop, transform: `scale(${bellIn}) rotate(${swing}deg)`, transformOrigin: "50% 0%", filter: glow ? `drop-shadow(0 0 ${30 * glow}px rgba(255,226,138,.9))` : "none" }}>
        <Pixel map={BELL} pal={BELLPAL} s={bellS} />
      </div>
      {vel > 0.05 && [-1, 1].map((side) => (
        <svg key={side} width={bellW} height={bellH} style={{ position: "absolute", left: cx - bellW / 2 + side * bellW * 0.72, top: bellTop + bellH * 0.1, opacity: vel, transform: side < 0 ? "scaleX(-1)" : "none" }}>
          {[0, 1, 2].map((k) => <path key={k} d={`M ${bellW * 0.15 + k * 18} ${bellH * 0.2} Q ${bellW * 0.42 + k * 18} ${bellH * 0.5} ${bellW * 0.15 + k * 18} ${bellH * 0.8}`} fill="none" stroke={C.cream} strokeWidth={8} strokeLinecap="square" />)}
        </svg>
      ))}
      {/* the line, on its own plate so it reads over coins and glow */}
      <div style={{ position: "absolute", left: 0, right: 0, top: tall ? 560 : 300, display: "flex", justifyContent: "center", opacity: interpolate(f, [bellFrom, bellFrom + 4], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
        <div style={{ background: "rgba(11,17,32,.88)", border: `5px solid ${C.cream}`, boxShadow: `10px 10px 0 ${C.brick2}`, padding: tall ? "34px 40px" : "24px 30px", textAlign: "center" }}>
          <Shout size={tall ? 54 : 42}>THE CLOSER<br />YOU ARE,<br /><span style={{ color: C.taxi }}>THE MORE<br />IT PAYS.</span></Shout>
        </div>
      </div>
      {/* the stamp */}
      {p.stamp !== false && ring >= 6 && <div style={{ position: "absolute", left: tall ? W / 2 - 230 : W - 420, top: tall ? 1150 : 604, transform: `scale(${interpolate(stamp, [0, 1], [2.6, 1])}) rotate(-9deg)`, opacity: Math.min(1, stamp * 2), textAlign: "center", background: C.cream, border: `8px double ${C.brick}`, padding: tall ? "18px 40px 14px" : "12px 30px 10px", boxShadow: `8px 8px 0 rgba(0,0,0,.45)` }}>
        <div style={{ fontFamily: PX, fontSize: tall ? 88 : 66, color: C.brick, lineHeight: 1.1, letterSpacing: "0.06em" }}>PAID</div>
        <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: tall ? 30 : 22, color: C.ink, marginTop: 6 }}>2.3×</div>
      </div>}
      {/* the street: the taxi crosses the flag as the bell rings */}
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: streetH, background: "linear-gradient(180deg, #46506a 0 14px, #1b2336 14px 100%)" }}>
        <div style={{ position: "absolute", left: 0, right: 0, top: streetH * 0.62, height: 6, background: "repeating-linear-gradient(90deg, rgba(163,156,133,.6) 0 36px, transparent 36px 72px)" }} />
        <div style={{ position: "absolute", left: 40, top: streetH * 0.62 - 3, height: 12, width: Math.max(0, Math.min(tx + taxiW / 2, flagX) - 40), background: C.taxi, boxShadow: "0 0 18px rgba(240,168,58,.7)" }} />
        <div style={{ position: "absolute", left: 40, top: 30, fontFamily: MONO, fontWeight: 600, fontSize: tall ? 34 : 26, color: C.cream2 }}>OPEN</div>
        <div style={{ position: "absolute", right: W - flagX + 24, top: 30, fontFamily: MONO, fontWeight: 700, fontSize: tall ? 34 : 26, color: C.taxi }}>{ring >= 0 ? "RANG" : "BELL"} 4:00 PM</div>
        <div style={{ position: "absolute", left: flagX, top: 16, transform: `skewY(${ring >= 0 ? Math.sin(ring * 0.8) * 6 : 0}deg)` }}><Pixel map={FLAG} pal={FLAGPAL} s={tall ? 10 : 8} /></div>
        <div style={{ position: "absolute", left: tx, top: streetH * 0.62 - 7 * taxiS + 14, transform: `translateY(${f % 6 < 3 ? -3 : 0}px)` }}><Pixel map={TAXI} pal={TAXIPAL} s={taxiS} /></div>
        {ring >= 0 && ring < 16 && Array.from({ length: 8 }, (_, i) => { const a = (i / 8) * Math.PI * 2, r = 20 + ring * 9; return <div key={i} style={{ position: "absolute", left: flagX + 10 + Math.cos(a) * r, top: 40 + Math.sin(a) * r * 0.6, width: 12, height: 12, background: i % 2 ? C.cream : C.taxi, opacity: 1 - ring / 16 }} />; })}
      </div>
    </AbsoluteFill>
  );
}
