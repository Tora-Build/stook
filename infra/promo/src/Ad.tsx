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
import { FULL, LONG, SHORT } from "./config";
import { HouseScene } from "./hero/House";
import { PayoutScene } from "./hero/Payout";
import { COPY } from "./copy";
import { TV } from "./hero/TV";
import { Flap } from "./hero/Flap";
import { FloorScene } from "./hero/Floor";
import { Elevator } from "./hero/Elevator";

export const PX = loadPixel("normal", { weights: ["400"], subsets: ["latin"] }).fontFamily;
export const SANS = loadSans("normal", { weights: ["500", "600", "700"], subsets: ["latin"] }).fontFamily;
export const MONO = loadMono("normal", { weights: ["500", "600", "700"], subsets: ["latin"] }).fontFamily;
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


/** The one plain line a first-time, muted viewer needs: under the headline from the first frame. */
export function Explainer(p: { top: number; size?: number }) {
  const f = useCurrentFrame(), { tall } = useLay(), size = p.size ?? (tall ? 26 : 24);
  // one line a sentence, as the sign's two rows
  const lines = COPY.explainer.split(/(?<=\.)\s+/);
  const bulbs = (n: number, vertical: boolean) => Array.from({ length: n }, (_, i) => { const on = (i + Math.floor(f / 4)) % 3 !== 0; return <div key={i} style={{ width: 12, height: 12, borderRadius: "50%", background: on ? "#ffe28a" : "#6b5220", boxShadow: on ? "0 0 8px #ffd166" : "none", margin: vertical ? "6px 0" : "0 6px" }} />; });
  return (
    <div style={{ position: "absolute", left: 50, right: 50, top: p.top, display: "flex", justifyContent: "center", zIndex: 20 }}>
      {/* a marquee sign: brass frame with chasing bulbs, green enamel face, pixel letters */}
      <div style={{ position: "relative", background: "linear-gradient(180deg, #d9b45a, #8a6824)", border: "5px solid #2a1a10", boxShadow: `10px 10px 0 rgba(0,0,0,.5)`, padding: 14 }}>
        <div style={{ position: "absolute", left: 6, right: 6, top: 0, height: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>{bulbs(tall ? 30 : 30, false)}</div>
        <div style={{ position: "absolute", left: 6, right: 6, bottom: 0, height: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>{bulbs(tall ? 30 : 30, false)}</div>
        <div style={{ background: C.green, border: `4px solid ${C.cream}`, padding: tall ? "18px 22px" : "14px 20px", textAlign: "center", boxShadow: "inset 0 0 0 4px #0b4a30" }}>
          {lines.map((l, i) => <div key={i} style={{ fontFamily: PX, fontSize: size, lineHeight: 1.6, color: i ? C.taxi : C.cream, textShadow: `3px 3px 0 ${C.ink}`, whiteSpace: "nowrap" }}>{l}</div>)}
        </div>
      </div>
    </div>
  );
}

// ── 1. the hook ──────────────────────────────────────────────────────────────
/** The hook. The words hit full size on `slamAt` (the drop): in from 2.2x over
 *  four frames, then the street shakes. */
function Hook(p: { slamAt?: number }) {
  const f = useCurrentFrame(), { W, H, tall } = useLay(), at = (p.slamAt ?? 8) - 4;
  const scale = interpolate(f, [at, at + 4], [2.2, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.quad) });
  const land = f - at - 4, shake = land >= 0 && land < 10 ? Math.round(Math.sin(land * 2.6) * (10 - land) * 1.8) : 0;
  const push = interpolate(f, [0, 66], [1, 1.07], { easing: ease });
  const size = tall ? 92 : 80;
  return (
    <AbsoluteFill style={{ background: C.ink, overflow: "hidden" }}>
      <AbsoluteFill style={{ transform: `scale(${push})`, transformOrigin: "50% 100%" }}>
        <Skyline width={W} height={H} scale={tall ? 6 : 6} lit={interpolate(f, [0, 40], [0.15, 1], { extrapolateRight: "clamp" })} />
      </AbsoluteFill>
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(11,17,32,.55) 0%, rgba(11,17,32,0) 45%)" }} />
      <AbsoluteFill style={{ alignItems: "center", paddingTop: tall ? 330 : 150 }}>
        <div style={{ transform: `translate(${shake}px, ${-shake / 2}px) scale(${scale})`, opacity: interpolate(f, [at, at + 2], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }), textAlign: "center" }}>
          <Shout size={size} shadow={C.brick2}>{tall ? <>WHERE<br />WILL IT<br />LAND?</> : <>WHERE WILL<br />IT LAND?</>}</Shout>
        </div>
      </AbsoluteFill>
      <Explainer top={tall ? 760 : 400} />
    </AbsoluteFill>
  );
}

// ── 2. the idea: four tables, each a memecoin playing a stock or an asset ────
export const TABLES = [
  { coin: "$STOOK", logo: "logos/stook.png", anchor: "S&P 500", alogo: "logos/spyx.png" },
  { coin: "$ZCAT", logo: "logos/zcat.jpg", anchor: "Zcash", alogo: "logos/zec.svg" },
  { coin: "$KNOTS", logo: "logos/knots.png", anchor: "STONK", alogo: "logos/stonk.png" },
  { coin: "$GP", logo: "logos/gp.jpg", anchor: "Gold", alogo: "logos/gldx.png" },
];
export function Table(p: { t: (typeof TABLES)[number]; d: number; at: number }) {
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
export function EndCard() {
  const f = useCurrentFrame(), { fps } = useVideoConfig(), { W, H, tall } = useLay();
  const coin = spring({ frame: f - 2, fps, config: { damping: 9, stiffness: 140 } });
  const pulse = 1 + Math.max(0, Math.sin((f - 40) / 6)) * 0.04 * (f > 40 ? 1 : 0);
  return (
    <AbsoluteFill style={{ background: C.ink, overflow: "hidden" }}>
      <Skyline width={W} height={H} scale={6} style={{ opacity: 0.55 }} />
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(11,17,32,.9) 0%, rgba(11,17,32,.55) 55%, rgba(11,17,32,.2) 100%)" }} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: tall ? 56 : 34, paddingBottom: tall ? 220 : 120 }}>
        <Img src={staticFile("stook-coin.svg")} style={{ width: tall ? 300 : 210, height: tall ? 300 : 210, imageRendering: "pixelated", transform: `scale(${coin}) rotate(${(1 - coin) * -200}deg)` }} />
        <Rise at={8} style={{ textAlign: "center" }}><Shout size={tall ? 70 : 60}>STOOK STREET</Shout><div style={{ fontFamily: PX, fontSize: tall ? 30 : 24, color: C.cream2, marginTop: tall ? 22 : 14 }}>WHERE WILL IT LAND?</div></Rise>
        <Rise at={14}><div style={{ fontFamily: MONO, fontWeight: 600, fontSize: tall ? 68 : 58, color: C.taxi, letterSpacing: "0.01em" }}>stookstreet.xyz</div></Rise>
        <Rise at={22}>
          <div style={{ transform: `scale(${pulse})`, fontFamily: PX, fontSize: tall ? 36 : 30, color: C.ink, background: C.taxi, padding: tall ? "30px 44px" : "24px 36px", border: `6px solid ${C.ink}`, boxShadow: `10px 10px 0 ${C.brick2}` }}>MAKE YOUR CALL ›</div>
        </Rise>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

// a 3-frame flash at each cut, the street's amber
export function Cut({ at }: { at: number }) {
  const f = useCurrentFrame();
  const o = interpolate(f, [at, at + 1, at + 4], [0, 0.55, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return o > 0 ? <AbsoluteFill style={{ background: C.cream, opacity: o, pointerEvents: "none" }} /> : null;
}

/** Film grain and faint scanlines over the whole picture, a broadcast from 1971. */
export function Grain() {
  const f = useCurrentFrame();
  return <>
    <AbsoluteFill style={{ pointerEvents: "none", background: "repeating-linear-gradient(0deg, rgba(0,0,0,.10) 0 2px, transparent 2px 4px)", mixBlendMode: "multiply" }} />
    <AbsoluteFill style={{ pointerEvents: "none", opacity: 0.07, mixBlendMode: "screen" }}>
      <svg width="100%" height="100%"><filter id={`g${f % 6}`}><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed={f % 6} /></filter><rect width="100%" height="100%" filter={`url(#g${f % 6})`} /></svg>
    </AbsoluteFill>
    <AbsoluteFill style={{ pointerEvents: "none", background: "radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0) 60%, rgba(0,0,0,.35) 100%)" }} />
  </>;
}

/** What plays under the ad: public/music.mp3 from `start` (s) into the track,
 *  a short fade in and `fadeOut` frames out; silent if the file is absent or
 *  `track` is "none". With music on, public/sfx/<name>.(mp3|wav) plays on its hit. */
export type AdProps = { track?: string | null };
export function Sound(p: AdProps & { length: number; start: number; fadeOut: number; hits: [name: string, frame: number][] }) {
  const files = getStaticFiles().map((x) => x.name);
  const track = p.track === "none" ? null : p.track ?? (files.includes("music.mp3") ? "music.mp3" : null);
  if (!track) return null;
  const sfx = (n: string) => ["mp3", "wav"].map((e) => `sfx/${n}.${e}`).find((x) => files.includes(x));
  return <>
    <Audio src={staticFile(track)} trimBefore={Math.round(p.start * 30)} volume={(fr) => interpolate(fr, [0, 9, p.length - p.fadeOut, p.length], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })} />
    {p.hits.map(([n, fr], i) => { const src = sfx(n); return src ? <Sequence key={i} from={fr}><Audio src={staticFile(src)} volume={0.5} /></Sequence> : null; })}
  </>;
}

/** Small motion hits: the picture bumps on every beat after the drop. */
function Pulse(p: { beats: number[]; from: number; children: React.ReactNode }) {
  const f = useCurrentFrame();
  const last = p.beats.filter((b) => b <= f && b >= p.from).pop();
  const k = last === undefined ? 0 : Math.exp(-(f - last) / 3);
  return <AbsoluteFill style={{ transform: `scale(${1 + 0.012 * k})` }}>{p.children}</AbsoluteFill>;
}

/** The full-length ad, as long as the track: an intro on a 1970s TV, then a
 *  scene a phrase (4 bars), every cut on a bar line. */
export function Full(p: AdProps) {
  const [drop, flap, floor, tower, lift, house, bell, pay, end] = FULL.cuts as [number, number, number, number, number, number, number, number, number];
  const bars = [1, 2, 3].map((k) => Math.round(drop * k / 4));
  return (
    <AbsoluteFill style={{ background: C.ink }}>
      <Pulse beats={FULL.beats} from={drop}>
        <Sequence durationInFrames={drop}><TV bars={bars} /></Sequence>
        <Sequence from={drop} durationInFrames={flap - drop}><Hook slamAt={0} /></Sequence>
        <Sequence from={flap} durationInFrames={floor - flap}><Flap rows={FULL.flaps.map((x) => x - flap)} /></Sequence>
        <Sequence from={floor} durationInFrames={tower - floor}><FloorScene pops={FULL.pops.map((x) => x - floor)} rewardsAt={FULL.rewards - floor} /></Sequence>
        <Sequence from={tower} durationInFrames={lift - tower}><TowerScene coinsAt={FULL.coins - tower} winAt={FULL.win - tower} /></Sequence>
        <Sequence from={lift} durationInFrames={house - lift}><Elevator stopAt={FULL.stop - lift} coinsAt={FULL.lift - lift} winAt={FULL.liftWin - lift} /></Sequence>
        <Sequence from={house} durationInFrames={bell - house}><HouseScene pages={FULL.pages.map((x) => x - house)} fundedAt={FULL.funded - house} /></Sequence>
        <Sequence from={bell} durationInFrames={pay - bell}><BellScene ringAt={FULL.bell - bell} clockAt={FULL.four - bell} confetti stamp={false} caption={false} /></Sequence>
        <Sequence from={pay} durationInFrames={end - pay}><PayoutScene at={FULL.payout.map((x) => x - pay)} /></Sequence>
        <Sequence from={end} durationInFrames={FULL.total - end}><EndCard /></Sequence>
      </Pulse>
      {FULL.cuts.map((a) => <Cut key={a} at={a} />)}
      <Grain />
      <Sound track={p.track} length={FULL.total} start={FULL.start} fadeOut={FULL.fadeOut} hits={[...FULL.flaps.map((x) => ["flap", x] as [string, number]), ["coins", FULL.coins], ["stop", FULL.stop], ["coins", FULL.lift], ["bell", FULL.bell]]} />
    </AbsoluteFill>
  );
}

/** The 15 s cut: the TV open, the drop on the hook, the board, the call, the bell, the door. */
export function Ad(p: AdProps) {
  const [drop, flap, call, bell, end] = LONG.cuts as [number, number, number, number, number];
  return (
    <AbsoluteFill style={{ background: C.ink }}>
      <Pulse beats={LONG.beats} from={drop}>
        <Sequence durationInFrames={drop}><TV /></Sequence>
        <Sequence from={drop} durationInFrames={flap - drop}><Hook slamAt={0} /></Sequence>
        <Sequence from={flap} durationInFrames={call - flap}><Flap rows={LONG.flaps.map((x) => x - flap)} /></Sequence>
        <Sequence from={call} durationInFrames={bell - call}><TowerScene coinsAt={LONG.coins - call} winAt={LONG.win - call} /></Sequence>
        <Sequence from={bell} durationInFrames={end - bell}><BellScene ringAt={LONG.bell - bell} /></Sequence>
        <Sequence from={end} durationInFrames={LONG.total - end}><EndCard /></Sequence>
      </Pulse>
      {LONG.cuts.map((a) => <Cut key={a} at={a} />)}
      <Grain />
      <Sound track={p.track} length={LONG.total} start={LONG.start} fadeOut={LONG.fadeOut} hits={[...LONG.flaps.map((x) => ["flap", x] as [string, number]), ["coins", LONG.coins], ["bell", LONG.bell]]} />
    </AbsoluteFill>
  );
}

/** The 6 s cut-down for pre-roll: the hook on the drop, the fastest pick, the door. */
export function Ad6(p: AdProps) {
  const [call, end] = SHORT.cuts as [number, number];
  return (
    <AbsoluteFill style={{ background: C.ink }}>
      <Pulse beats={SHORT.beats} from={SHORT.drop}>
        <Sequence durationInFrames={call}><Hook slamAt={SHORT.drop} /></Sequence>
        <Sequence from={call} durationInFrames={end - call}><TowerScene fast coinsAt={SHORT.coins - call} winAt={SHORT.win - call} /></Sequence>
        <Sequence from={end} durationInFrames={SHORT.total - end}><EndCard /></Sequence>
      </Pulse>
      {[SHORT.drop, ...SHORT.cuts].map((a) => <Cut key={a} at={a} />)}
      <Grain />
      <Sound track={p.track} length={SHORT.total} start={SHORT.start} fadeOut={SHORT.fadeOut} hits={[["coins", SHORT.coins]]} />
    </AbsoluteFill>
  );
}
