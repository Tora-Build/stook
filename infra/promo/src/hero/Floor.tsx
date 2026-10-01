// The floor: the four tables with their traders standing round the rims,
// talking in the site's cream speech bubbles. The camera pans along the row
// (square) or pushes into the grid (tall).
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, MONO, PX, Rise, SANS, Shout, TABLES, Table, useLay } from "../Ad";
import { Pixel } from "../pixel";
import { COPY } from "../copy";

// a trader, seen from the front: hair, face, suit, tie, shoes
const TRADER = ["..hhhh..", ".hhhhhh.", ".hffffh.", ".ffeffef", "..ffff..", "..ffff..", ".ssttss.", "sssttsss", "ssstssss", "ssssssss", ".ss..ss.", ".dd..dd."];
const LOOKS = [
  { h: "#3b2414", f: "#e0b48a", e: "#0b1120", s: "#2f4d7c", t: "#a8412f", d: "#0b1120" },
  { h: "#c9a24a", f: "#f0c8a0", e: "#0b1120", s: "#5a4a3a", t: "#35c4c4", d: "#0b1120" },
  { h: "#111111", f: "#a87452", e: "#0b1120", s: "#7d2f22", t: "#f4e9c8", d: "#0b1120" },
  { h: "#8a8f99", f: "#e8c09a", e: "#0b1120", s: "#243a5e", t: "#f0a83a", d: "#0b1120" },
  { h: "#6b3a1e", f: "#c88d64", e: "#0b1120", s: "#3a3f4c", t: "#5ec48f", d: "#0b1120" },
];
// one line a table, in the order the camera passes them; each up for 26 frames
const COIN = ["..aaa..", ".abbba.", "abcbbba", "abbbbba", "abbbbba", ".abbba.", "..aaa.."];
const COINPAL = { a: "#8a5a12", b: "#f0a83a", c: "#ffe28a" };
const LINES = ["Bell's at four.", "Where's it closing?", "Sure pays more.", "I'm the house today."];

function Bubble(p: { text: string; at: number; x: number; y: number; size: number }) {
  const f = useCurrentFrame(), { fps } = useVideoConfig(), t = f - p.at;
  if (t < 0 || t > 26) return null;
  const s = spring({ frame: t, fps, config: { damping: 11, stiffness: 240 } }), out = interpolate(t, [21, 26], [1, 0], { extrapolateLeft: "clamp" });
  return (
    <div style={{ position: "absolute", left: p.x, top: p.y, transform: `translate(-50%, -100%) scale(${s * out})`, transformOrigin: "50% 100%", zIndex: 5 }}>
      <div style={{ background: "#f4e9c8", color: "#0b1120", border: "4px solid #0b1120", boxShadow: "4px 4px 0 #0b1120", padding: "10px 14px", fontFamily: PX, fontSize: p.size, lineHeight: 1.5, whiteSpace: "nowrap" }}>{p.text}</div>
      <div style={{ width: 14, height: 14, background: "#f4e9c8", borderRight: "4px solid #0b1120", borderBottom: "4px solid #0b1120", transform: "rotate(45deg)", margin: "-9px auto 0" }} />
    </div>
  );
}

/** `rewardsAt` (full-length cut only): from then the reward-coin caption shows and the
 *  $ZCAT, $KNOTS and $GP tables glow with coins ticking in; $STOOK never does. */
export function FloorScene(p: { pops?: number[]; rewardsAt?: number }) {
  const f = useCurrentFrame(), { durationInFrames: D } = useVideoConfig(), { W, tall } = useLay();
  const d = tall ? 440 : 360, gap = tall ? 70 : 150, ts = tall ? 6 : 5;
  // where each table sits on the floor
  const pos = TABLES.map((_, i) => tall ? { x: (i % 2) * (d + gap), y: Math.floor(i / 2) * (d + gap + 40) } : { x: i * (d + gap), y: 0 });
  const floorW = tall ? 2 * d + gap : 4 * d + 3 * gap;
  const pan = tall ? 0 : interpolate(f, [0, D], [70, W - floorW - 70], { easing: Easing.inOut(Easing.quad) });
  const push = tall ? interpolate(f, [0, D], [1, 1.08]) : 1;
  const ox = tall ? (W - floorW) / 2 : pan;
  const rf = f - (p.rewardsAt ?? 1e9), lit = rf >= 0, litIn = interpolate(rf, [0, 8], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }), glow = (Math.sin(rf * 0.25) + 1) / 2;
  return (
    <AbsoluteFill style={{ background: "#141a26", overflow: "hidden" }}>
      <AbsoluteFill style={{ background: "repeating-linear-gradient(90deg, transparent 0 150px, rgba(244,233,200,.05) 150px 160px)" }} />
      <AbsoluteFill style={{ borderTop: `10px solid ${C.taxi}`, borderBottom: `10px solid ${C.taxi}` }} />
      <Rise at={0} style={{ position: "absolute", left: 0, right: 0, top: tall ? 150 : 80, textAlign: "center", zIndex: 6 }}>
        <div style={{ display: "inline-block", fontFamily: PX, fontSize: tall ? 20 : 16, color: C.ink, background: C.taxi, padding: "8px 12px", marginBottom: 18 }}>THE FLOOR</div>
        <Shout size={tall ? 50 : 40}>ONE QUESTION<br />A <span style={{ color: C.taxi }}>DAY</span></Shout>
        <div style={{ fontFamily: SANS, fontWeight: 600, fontSize: tall ? 34 : 28, color: C.cream2, marginTop: 12 }}>Where does it close at 4 PM?</div>
      </Rise>
      <div style={{ position: "absolute", left: ox, top: tall ? 560 : 420, transform: `scale(${push})`, transformOrigin: "50% 30%", width: floorW }}>
        {TABLES.map((t, i) => {
          const { x, y } = pos[i]!;
          return (
            <div key={t.coin} style={{ position: "absolute", left: x, top: y }}>
              <Table t={t} d={d} at={p.pops?.[i] ?? 2 + i * 4} />
              {lit && COPY.rewardTables.includes(i) && <>
                <div style={{ position: "absolute", left: 8, top: 8, width: d - 16, height: d - 16, borderRadius: "50%", border: `8px solid ${C.taxi}`, boxShadow: `0 0 ${30 + glow * 30}px rgba(240,168,58,.8), inset 0 0 30px rgba(240,168,58,.4)`, opacity: litIn, zIndex: 2 }} />
                {[0, 1, 2].map((k) => { const t = ((rf + k * 18 + i * 7) % 54) / 54; return <div key={k} style={{ position: "absolute", left: d / 2 - 21, top: d * 0.62 - t * d * 0.45, opacity: litIn * (t < 0.15 ? t / 0.15 : t > 0.8 ? (1 - t) / 0.2 : 1), zIndex: 4 }}><Pixel map={COIN} pal={COINPAL} s={6} /></div>; })}
              </>}
              {/* traders round the rim, the near ones in front */}
              {[200, 245, 295, 340, 20, 150].map((deg, k) => {
                const a = (deg * Math.PI) / 180, r = d / 2 + 8, look = LOOKS[(i * 3 + k) % LOOKS.length]!;
                const bob = Math.round(Math.sin(f * 0.3 + k * 1.7 + i) * 2);
                return <div key={k} style={{ position: "absolute", left: d / 2 + Math.cos(a) * r - 4 * ts, top: d / 2 + Math.sin(a) * r - 12 * ts + bob, zIndex: Math.sin(a) > 0 ? 3 : 1 }}><Pixel map={TRADER} pal={look} s={ts} /></div>;
              })}
            </div>
          );
        })}
        {LINES.map((text, k) => { const { x, y } = pos[k]!; const slot = Math.floor((p.rewardsAt ?? D) / 4); return <Bubble key={k} text={text} at={k * slot + 6} x={x + d / 2} y={y - 6} size={tall ? 24 : 20} />; })}
      </div>
      {lit && <div style={{ position: "absolute", left: 50, right: 50, top: tall ? 1610 : 830, display: "flex", justifyContent: "center", zIndex: 8, opacity: litIn, transform: `translateY(${(1 - litIn) * 40}px)` }}>
        <div style={{ background: "rgba(11,17,32,.9)", border: `5px solid ${C.taxi}`, boxShadow: `10px 10px 0 ${C.brick2}`, padding: tall ? "24px 30px" : "18px 26px", textAlign: "center", maxWidth: tall ? 960 : 940 }}>
          <div style={{ fontFamily: SANS, fontWeight: 700, fontSize: tall ? 44 : 34, lineHeight: 1.22, color: C.cream, textWrap: "balance" } as React.CSSProperties}>{COPY.rewards}</div>
          <div style={{ fontFamily: MONO, fontWeight: 600, fontSize: tall ? 30 : 24, color: C.taxi, marginTop: 10 }}>{COPY.rewardsSub}</div>
        </div>
      </div>}
    </AbsoluteFill>
  );
}
