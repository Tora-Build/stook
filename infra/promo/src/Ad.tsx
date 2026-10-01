// Stook Street, 15 seconds: the hook, the idea, the call, the bell, the door.
// One component for both formats: it reads the frame's size and lays each
// beat out for a square or a tall screen.
import { AbsoluteFill, Audio, Easing, getStaticFiles, Img, interpolate, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { loadFont as loadPixel } from "@remotion/google-fonts/PressStart2P";
import { loadFont as loadSans } from "@remotion/google-fonts/IBMPlexSans";
import { loadFont as loadMono } from "@remotion/google-fonts/IBMPlexMono";
import { Skyline } from "./Skyline";
import { TowerScene } from "./TowerScene";
import { BellScene } from "./BellScene";

export const PX = loadPixel().fontFamily;
export const SANS = loadSans("normal", { weights: ["500", "600", "700"] }).fontFamily;
export const MONO = loadMono("normal", { weights: ["500", "600"] }).fontFamily;
export const C = { ink: "#0b1120", sky: "#101a2e", sky2: "#182642", taxi: "#f0a83a", cream: "#f4e9c8", cream2: "#c9bfa4", brick: "#a8412f", brick2: "#7d2f22", green: "#0e7449", teal: "#35c4c4", good: "#5ec48f" };

export const useLay = () => { const { width, height } = useVideoConfig(); return { W: width, H: height, tall: height > width }; };
const ease = Easing.bezier(0.2, 0.8, 0.2, 1);

/** Bold pixel lettering with the street's hard shadow. */
export function Shout(p: { children: React.ReactNode; size: number; color?: string; shadow?: string; style?: React.CSSProperties }) {
  return <div style={{ fontFamily: PX, fontSize: p.size, lineHeight: 1.35, color: p.color ?? C.cream, textShadow: `${Math.round(p.size / 12)}px ${Math.round(p.size / 12)}px 0 ${p.shadow ?? C.brick2}`, letterSpacing: "0.02em", ...p.style }}>{p.children}</div>;
}

/** Text that comes up from below and settles: the beat's line. */
export function Rise(p: { at: number; children: React.ReactNode; style?: React.CSSProperties }) {
  const f = useCurrentFrame(), { fps } = useVideoConfig();
  const s = spring({ frame: f - p.at, fps, config: { damping: 14, stiffness: 160 } });
  return <div style={{ opacity: interpolate(f - p.at, [0, 4], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }), transform: `translateY(${(1 - s) * 60}px)`, ...p.style }}>{p.children}</div>;
}

// ── 1. the hook ──────────────────────────────────────────────────────────────
function Hook() {
  const f = useCurrentFrame(), { fps } = useVideoConfig(), { W, H, tall } = useLay();
  const slam = spring({ frame: f - 8, fps, config: { damping: 11, stiffness: 220, mass: 0.8 } });
  const scale = interpolate(slam, [0, 1], [2.6, 1]);
  const land = f - 8 - 7, shake = land >= 0 && land < 8 ? Math.round(Math.sin(land * 2.6) * (8 - land) * 1.6) : 0;
  const push = interpolate(f, [0, 66], [1, 1.07], { easing: ease });
  const size = tall ? 92 : 80;
  return (
    <AbsoluteFill style={{ background: C.ink, overflow: "hidden" }}>
      <AbsoluteFill style={{ transform: `scale(${push})`, transformOrigin: "50% 100%" }}>
        <Skyline width={W} height={H} scale={tall ? 6 : 6} lit={interpolate(f, [0, 40], [0.15, 1], { extrapolateRight: "clamp" })} />
      </AbsoluteFill>
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(11,17,32,.55) 0%, rgba(11,17,32,0) 45%)" }} />
      <AbsoluteFill style={{ alignItems: "center", paddingTop: tall ? 330 : 150 }}>
        <div style={{ transform: `translate(${shake}px, ${-shake / 2}px) scale(${scale})`, opacity: interpolate(f, [8, 11], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }), textAlign: "center" }}>
          <Shout size={size} shadow={C.brick2}>{tall ? <>WHERE<br />WILL IT<br />LAND?</> : <>WHERE WILL<br />IT LAND?</>}</Shout>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

// ── 2. the idea: four tables, each a memecoin playing a stock or an asset ────
const TABLES = [
  { coin: "$STOOK", logo: "logos/stook.png", anchor: "S&P 500", alogo: "logos/spyx.png" },
  { coin: "$ZCAT", logo: "logos/zcat.jpg", anchor: "Zcash", alogo: "logos/zec.svg" },
  { coin: "$KNOTS", logo: "logos/knots.png", anchor: "STONK", alogo: "logos/stonk.png" },
  { coin: "$GP", logo: "logos/gp.jpg", anchor: "Gold", alogo: "logos/gldx.png" },
];
function Table(p: { t: (typeof TABLES)[number]; d: number; at: number }) {
  const f = useCurrentFrame(), { fps } = useVideoConfig();
  const s = spring({ frame: f - p.at, fps, config: { damping: 12, stiffness: 180 } });
  const spin = (f / fps) * 40;
  const r = p.d / 2, dots = 36;
  return (
    <div style={{ width: p.d, height: p.d, position: "relative", transform: `scale(${s})`, opacity: Math.min(1, s * 1.5) }}>
      {/* the LED rim */}
      <svg width={p.d} height={p.d} style={{ position: "absolute", inset: 0, transform: `rotate(${spin}deg)` }}>
        <circle cx={r} cy={r} r={r - 6} fill="none" stroke="#04070d" strokeWidth={18} />
        {Array.from({ length: dots }, (_, i) => { const a = (i / dots) * Math.PI * 2, on = (i + Math.floor(f / 3)) % 6 < 3; return <rect key={i} x={r + Math.cos(a) * (r - 6) - 3} y={r + Math.sin(a) * (r - 6) - 3} width={6} height={6} fill={on ? (i % 9 === 0 ? C.taxi : "#5ef0a0") : "#123322"} />; })}
      </svg>
      <div style={{ position: "absolute", inset: 18, borderRadius: "50%", background: "radial-gradient(circle at 35% 30%, #1c2436, #0b1120 70%)", border: "6px solid #3a3f4c", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: p.d * 0.04 }}>
        <div style={{ position: "relative", width: p.d * 0.26, height: p.d * 0.26 }}>
          <Img src={staticFile(p.t.alogo)} style={{ width: "100%", height: "100%", borderRadius: "50%", border: `3px solid ${C.cream}`, background: "#fff", objectFit: "cover" }} />
          <Img src={staticFile(p.t.logo)} style={{ position: "absolute", right: -p.d * 0.05, bottom: -p.d * 0.05, width: p.d * 0.13, height: p.d * 0.13, borderRadius: "50%", border: `2px solid ${C.cream}`, background: C.ink, objectFit: "cover" }} />
        </div>
        <div style={{ fontFamily: PX, fontSize: p.d * 0.085, color: C.taxi }}>{p.t.coin}</div>
        <div style={{ fontFamily: SANS, fontWeight: 600, fontSize: p.d * 0.07, color: C.cream2 }}>plays <span style={{ color: C.cream }}>{p.t.anchor}</span></div>
      </div>
    </div>
  );
}
function Idea() {
  const f = useCurrentFrame(), { tall } = useLay();
  const d = tall ? 420 : 330, gap = tall ? 40 : 34;
  const push = interpolate(f, [0, 84], [1, 1.05]);
  return (
    <AbsoluteFill style={{ background: "#141a26", overflow: "hidden" }}>
      <AbsoluteFill style={{ background: "repeating-linear-gradient(90deg, transparent 0 150px, rgba(244,233,200,.05) 150px 160px)" }} />
      <AbsoluteFill style={{ borderTop: `10px solid ${C.taxi}`, borderBottom: `10px solid ${C.taxi}` }} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: tall ? 70 : 34, transform: `scale(${push})` }}>
        <Rise at={2} style={{ textAlign: "center" }}>
          <Shout size={tall ? 58 : 44}>{tall ? <>MEMECOINS<br />ANCHORED<br />TO <span style={{ color: C.taxi }}>STOCKS</span></> : <>MEMECOINS ANCHORED<br />TO <span style={{ color: C.taxi }}>STOCKS</span></>}</Shout>
        </Rise>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap }}>
          {TABLES.map((t, i) => <Table key={t.coin} t={t} d={d} at={10 + i * 6} />)}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

// ── 5. the door ──────────────────────────────────────────────────────────────
function EndCard() {
  const f = useCurrentFrame(), { fps } = useVideoConfig(), { W, H, tall } = useLay();
  const coin = spring({ frame: f - 2, fps, config: { damping: 9, stiffness: 140 } });
  const pulse = 1 + Math.max(0, Math.sin((f - 40) / 6)) * 0.04 * (f > 40 ? 1 : 0);
  return (
    <AbsoluteFill style={{ background: C.ink, overflow: "hidden" }}>
      <Skyline width={W} height={H} scale={6} style={{ opacity: 0.55 }} />
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(11,17,32,.9) 0%, rgba(11,17,32,.55) 55%, rgba(11,17,32,.2) 100%)" }} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: tall ? 56 : 34, paddingBottom: tall ? 220 : 120 }}>
        <Img src={staticFile("stook-coin.svg")} style={{ width: tall ? 300 : 210, height: tall ? 300 : 210, imageRendering: "pixelated", transform: `scale(${coin}) rotate(${(1 - coin) * -200}deg)` }} />
        <Rise at={8}><Shout size={tall ? 70 : 60}>STOOK STREET</Shout></Rise>
        <Rise at={14}><div style={{ fontFamily: MONO, fontWeight: 600, fontSize: tall ? 68 : 58, color: C.taxi, letterSpacing: "0.01em" }}>stookstreet.xyz</div></Rise>
        <Rise at={22}>
          <div style={{ transform: `scale(${pulse})`, fontFamily: PX, fontSize: tall ? 36 : 30, color: C.ink, background: C.taxi, padding: tall ? "30px 44px" : "24px 36px", border: `6px solid ${C.ink}`, boxShadow: `10px 10px 0 ${C.brick2}` }}>MAKE YOUR CALL ›</div>
        </Rise>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

// a 3-frame flash at each cut, the street's amber
function Cut({ at }: { at: number }) {
  const f = useCurrentFrame();
  const o = interpolate(f, [at, at + 1, at + 4], [0, 0.55, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return o > 0 ? <AbsoluteFill style={{ background: C.cream, opacity: o, pointerEvents: "none" }} /> : null;
}

export const BEATS = { hook: [0, 66], idea: [66, 84], call: [150, 120], bell: [270, 90], end: [360, 90] } as const;

export function Ad() {
  const music = getStaticFiles().some((f) => f.name === "music.mp3");
  return (
    <AbsoluteFill style={{ background: C.ink }}>
      <Sequence from={BEATS.hook[0]} durationInFrames={BEATS.hook[1]}><Hook /></Sequence>
      <Sequence from={BEATS.idea[0]} durationInFrames={BEATS.idea[1]}><Idea /></Sequence>
      <Sequence from={BEATS.call[0]} durationInFrames={BEATS.call[1]}><TowerScene /></Sequence>
      <Sequence from={BEATS.bell[0]} durationInFrames={BEATS.bell[1]}><BellScene /></Sequence>
      <Sequence from={BEATS.end[0]} durationInFrames={BEATS.end[1]}><EndCard /></Sequence>
      {[BEATS.idea[0], BEATS.call[0], BEATS.bell[0], BEATS.end[0]].map((a) => <Cut key={a} at={a} />)}
      {music && <Audio src={staticFile("music.mp3")} volume={(fr) => interpolate(fr, [0, 10, 420, 450], [0, 1, 1, 0], { extrapolateRight: "clamp" })} />}
    </AbsoluteFill>
  );
}
