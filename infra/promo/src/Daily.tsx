// The daily videos for Telegram: the closing bell and the morning question, in
// the street cut's language (heavy slams, the living city, the site's tower on a
// phone, cuts on the trap beat) with today's real numbers as props. The box
// renders them (scripts/daily.mjs) from a bundle of public-daily/.
import { AbsoluteFill, Audio, Easing, Img, OffthreadVideo, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { C, INTER, MONO, PX } from "./Ad";
import { Glitch, Slam } from "./Street";
import { FPS } from "./config";
import GRID from "./beats-daily.json";

export type DailyProps = { kind: "bell" | "morning"; date: string; price: number; chg: number | null; points: [number, number][]; secsToBell: number; muted?: boolean };

// Each video has its own track (Mixkit, public-daily/<kind>.mp3) and grid; beat 8 is the drop.
/** Frame of beat `n`, counted from the ad's first frame. */
const beatOf = (k: DailyProps["kind"], n: number) => Math.round((GRID[k].beatTimes[n]! - GRID[k].beatTimes[0]!) * FPS);
export const dailyTotal = (k: DailyProps["kind"]) => beatOf(k, 44) + 30;
const money = (v: number) => "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const GOOD = "#5ef0a0", BAD = "#ff6b5e", GOLD = "#ffc629";

export const DAILY_SAMPLE: DailyProps = { kind: "bell", date: "TUE, NOV 3", price: 133.12, chg: -3.03, secsToBell: 22500, points: Array.from({ length: 96 }, (_, i) => [i, 136 - i * 0.03 + Math.sin(i / 7) * 0.9] as [number, number]) };

/** Fine grain, scanlines and a vignette: cheap enough for the box. */
function Finish() {
  const f = useCurrentFrame();
  return <>
    <AbsoluteFill style={{ pointerEvents: "none", background: "repeating-linear-gradient(0deg, rgba(0,0,0,.10) 0 2px, transparent 2px 4px)" }} />
    <AbsoluteFill style={{ pointerEvents: "none", opacity: 0.06, backgroundImage: `url(${staticFile("noise.png")})`, backgroundPosition: `${(f * 137) % 540}px ${(f * 71) % 960}px`, mixBlendMode: "screen" }} />
    <AbsoluteFill style={{ pointerEvents: "none", background: "radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0) 60%, rgba(0,0,0,.35) 100%)" }} />
  </>;
}

/** The track and the effects. Below the drop the music waits, so the hit lands. */
function Mix({ k, total, drop, hits }: { k: DailyProps["kind"]; total: number; drop: number; hits: [string, number, number?][] }) {
  return <>
    <Audio src={staticFile(`${k}.mp3`)} trimBefore={Math.round(GRID[k].beatTimes[0]! * FPS)} volume={(fr) => interpolate(fr, [0, 8, drop - 1, drop, total - 36, total], [0, 0.34, 0.42, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })} />
    {hits.map(([n, fr, v], i) => <Sequence key={i} from={fr}><Audio src={staticFile(`sfx/${n}.mp3`)} volume={v ?? 0.5} /></Sequence>)}
  </>;
}

/** The picture jumps on the track's kicks. */
function Pulse({ k, children }: { k: DailyProps["kind"]; children: React.ReactNode }) {
  const f = useCurrentFrame(), t0 = GRID[k].beatTimes[0]!;
  const since = Math.min(...GRID[k].kicks.map((s) => Math.round((s - t0) * FPS)).map((x) => (f >= x ? f - x : 99)));
  const z = since < 8 ? 1 + (8 - since) * 0.0035 : 1, y = since < 5 ? (5 - since) * 1.6 : 0;
  return <AbsoluteFill style={{ transform: `scale(${z}) translateY(${y}px)` }}>{children}</AbsoluteFill>;
}

/** The living city, full height, the camera creeping in. */
function City(p: { dawn?: boolean; dim?: number; from?: number; zoom?: [number, number]; x?: [number, number] }) {
  const f = useCurrentFrame(), { durationInFrames: D, width: W, height: H } = useVideoConfig();
  const z = interpolate(f, [0, D], p.zoom ?? [1.07, 1.16]), s = H * z, u = interpolate(f, [0, D], p.x ?? [0.3, 0.42]);
  return <AbsoluteFill style={{ background: C.ink, overflow: "hidden" }}>
    <OffthreadVideo muted src={staticFile(`v/${p.dawn ? "cityDawn" : "city"}.mp4`)} trimBefore={p.from ?? 0} style={{ position: "absolute", width: s, height: s, left: (W - s) * u, top: (H - s) * 0.72, maxWidth: "none" }} />
    <AbsoluteFill style={{ background: `rgba(5,8,16,${p.dim ?? 0.55})` }} />
  </AbsoluteFill>;
}

/** Light off the bell: a white flash, then rings running out from `y`. */
function Strike({ at, y }: { at: number; y: number }) {
  const t = useCurrentFrame() - at;
  if (t < 0 || t > 50) return null;
  return <AbsoluteFill style={{ pointerEvents: "none" }}>
    {t < 8 && <AbsoluteFill style={{ background: "#fff5d6", opacity: interpolate(t, [0, 8], [0.95, 0]) }} />}
    {[0, 7, 15].map((d) => { const u = t - d; if (u < 0 || u > 34) return null; const r = interpolate(u, [0, 34], [80, 1250], { easing: Easing.out(Easing.quad) });
      return <div key={d} style={{ position: "absolute", left: 540 - r, top: y - r, width: r * 2, height: r * 2, borderRadius: "50%", border: `${interpolate(u, [0, 34], [20, 1])}px solid ${GOLD}`, opacity: interpolate(u, [0, 34], [0.85, 0]), boxShadow: `0 0 60px ${GOLD}` }} />; })}
  </AbsoluteFill>;
}

// The site's pixel bell (Tower.tsx), 16 wide.
const RUNS: [string, [number, number, number][]][] = [
  ["#b47416", [[0, 7, 8]]],
  ["#f0a83a", [[1, 5, 10], [2, 4, 11], [3, 3, 12], [4, 3, 12], [5, 3, 12], [6, 3, 12], [7, 3, 12], [8, 3, 12], [9, 2, 13], [10, 2, 13], [11, 1, 14], [12, 0, 15]]],
  ["#c97f1c", [[2, 10, 11], [3, 11, 12], [4, 11, 12], [5, 11, 12], [6, 11, 12], [7, 11, 12], [8, 11, 12], [9, 12, 13], [10, 12, 13], [11, 13, 14]]],
  ["#fff1c4", [[2, 5, 6], [3, 4, 5], [4, 4, 4], [5, 4, 4], [6, 4, 4], [7, 4, 4]]],
  ["#9a5c10", [[12, 0, 15]]],
  ["#7a4a0c", [[13, 6, 9], [14, 7, 8]]],
];
function Bell({ at, size }: { at: number; size: number }) {
  const t = useCurrentFrame() - at, u = size / 16;
  const swing = t >= 0 ? Math.sin(t * 0.42) * Math.exp(-t * 0.045) * 22 : 0, drop = interpolate(t, [-6, 0], [-260, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.in(Easing.cubic) });
  return <div style={{ width: size, height: u * 15, position: "relative", transform: `translateY(${drop}px) rotate(${swing}deg)`, transformOrigin: "50% 0", filter: `drop-shadow(0 0 40px rgba(255,198,41,.75))` }}>
    {RUNS.flatMap(([c, rs], k) => rs.map(([y, a, b], i) => <div key={`${k}${i}`} style={{ position: "absolute", left: a * u, top: y * u, width: (b - a + 1) * u + 0.5, height: u + 0.5, background: c }} />))}
  </div>;
}

/** The day's real prices, drawn from left to right, the last one pulsing. */
function Chart({ points, at, frames, w, h }: { points: [number, number][]; at: number; frames: number; w: number; h: number }) {
  const f = useCurrentFrame();
  if (points.length < 2) return null;
  const ps = points.map((x) => x[1]), lo = Math.min(...ps), hi = Math.max(...ps), span = hi - lo || 1;
  const X = (i: number) => (i / (ps.length - 1)) * (w - 24), Y = (p: number) => 24 + (1 - (p - lo) / span) * (h - 48);
  const n = Math.max(2, Math.ceil(interpolate(f, [at, at + frames], [2, ps.length], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) })));
  const d = ps.slice(0, n).map((p, i) => `${X(i).toFixed(1)},${Y(p).toFixed(1)}`).join(" "), up = ps[ps.length - 1]! >= ps[0]!, col = up ? GOOD : BAD;
  const glow = 10 + Math.sin(f / 4) * 5;
  return <svg width={w} height={h} style={{ overflow: "visible" }}>
    <defs><linearGradient id="fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={col} stopOpacity=".32" /><stop offset="1" stopColor={col} stopOpacity="0" /></linearGradient></defs>
    {[0.25, 0.5, 0.75].map((g) => <line key={g} x1={0} x2={w} y1={h * g} y2={h * g} stroke="rgba(244,233,200,.1)" strokeWidth={2} />)}
    <polygon points={`0,${h} ${d} ${X(n - 1).toFixed(1)},${h}`} fill="url(#fill)" />
    <polyline points={d} fill="none" stroke={col} strokeWidth={7} strokeLinejoin="round" style={{ filter: `drop-shadow(0 0 12px ${col})` }} />
    <circle cx={X(n - 1)} cy={Y(ps[n - 1]!)} r={14} fill={col} style={{ filter: `drop-shadow(0 0 ${glow}px ${col})` }} />
    <text x={w} y={22} textAnchor="end" fill="#c9bfa4" fontFamily={MONO} fontWeight={600} fontSize={30}>24H HIGH {money(hi)}</text>
    <text x={w} y={h - 2} textAnchor="end" fill="#c9bfa4" fontFamily={MONO} fontWeight={600} fontSize={30}>24H LOW {money(lo)}</text>
  </svg>;
}

/** A price counting up to the real one, shaking a little while it runs. */
function Price({ at, to, size }: { at: number; to: number; size: number }) {
  const t = useCurrentFrame() - at;
  if (t < 0) return null;
  const u = interpolate(t, [0, 22], [0, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) }), v = to * (0.82 + 0.18 * u), run = t < 22;
  return <div style={{ fontFamily: INTER, fontWeight: 900, fontSize: size, lineHeight: 0.95, letterSpacing: "-0.04em", color: GOLD, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", textShadow: run ? "-8px 0 rgba(255,40,60,.75), 8px 0 rgba(40,230,255,.75)" : "0 0 50px rgba(255,198,41,.45)" }}>{money(v)}</div>;
}

const Move = ({ at, chg }: { at: number; chg: number | null }) => {
  const f = useCurrentFrame(), { fps } = useVideoConfig();
  if (chg == null) return null;
  const s = spring({ frame: f - at, fps, config: { damping: 11, stiffness: 170 } }), up = chg >= 0;
  return <div style={{ display: "inline-block", marginTop: 22, padding: "12px 28px", borderRadius: 18, fontFamily: INTER, fontWeight: 900, fontSize: 64, color: "#071018", background: up ? GOOD : BAD, transform: `scale(${s})` }}>{up ? "▲" : "▼"} {Math.abs(chg).toFixed(2)}%</div>;
};

/** The site's tower on a phone, bleeding off the bottom of the picture. */
function Phone({ shot, at }: { shot: string; at: number }) {
  const f = useCurrentFrame(), { fps } = useVideoConfig();
  const s = spring({ frame: f - at, fps, config: { damping: 15, stiffness: 110 } }), w = 760;
  return <div style={{ position: "absolute", left: 160, top: 770 + (1 - s) * 900, width: w, height: w * 1.78, transform: `rotate(${-3 + Math.sin(f / 24)}deg)` }}>
    <div style={{ position: "absolute", inset: -22, borderRadius: 108, background: "#0c0f16", boxShadow: `0 0 0 3px #2a2f3a, 0 40px 90px rgba(0,0,0,.7), 0 0 90px rgba(255,198,41,.28)` }} />
    <div style={{ position: "absolute", inset: 0, borderRadius: 86, overflow: "hidden", background: "#000" }}>
      <OffthreadVideo muted src={staticFile(`v/${shot}.mp4`)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
    </div>
  </div>;
}

const Center = ({ y, children }: { y: number; children: React.ReactNode }) => <div style={{ position: "absolute", left: 0, right: 0, top: y, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>{children}</div>;
const Tag = ({ children, color }: { children: React.ReactNode; color?: string }) => <div style={{ fontFamily: PX, fontSize: 34, color: color ?? C.cream2, letterSpacing: "0.02em" }}>{children}</div>;

/** New York's clock running up to the bell. */
function Clock({ end }: { end: number }) {
  const f = useCurrentFrame(), left = Math.max(0, Math.ceil((end - f) / FPS));
  const txt = left === 0 ? "4:00:00" : `3:59:${String(60 - left).padStart(2, "0")}`, beat2 = f % FPS < 4;
  return <div style={{ fontFamily: PX, fontSize: 104, color: left <= 1 ? GOLD : "#5ef0a0", textShadow: `0 0 ${beat2 ? 44 : 18}px currentColor`, padding: "30px 44px", background: "rgba(5,10,8,.86)", border: "6px solid #1d3a2b", borderRadius: 26 }}>{txt}</div>;
}

function Closing({ points, at, frames, tag, price, chg, extra }: { points: [number, number][]; at: number; frames: number; tag: string; price: number; chg: number | null; extra?: React.ReactNode }) {
  return <>
    <Center y={170}>
      <div style={{ display: "flex", alignItems: "center", gap: 22, marginBottom: 28 }}><Img src={staticFile("logos/polymarket.png")} style={{ width: 92, height: 92, borderRadius: "50%" }} /><Tag color={C.cream}>POLYMARKET</Tag></div>
      <Tag>{tag}</Tag>
      <div style={{ height: 34 }} />
      <Price at={at + 6} to={price} size={196} />
      <Move at={at + 26} chg={chg} />
    </Center>
    <div style={{ position: "absolute", left: 66, top: 860 }}><Chart points={points} at={at + 4} frames={frames} w={948} h={620} /></div>
    {extra}
  </>;
}

function EndCard({ line, at }: { line: string; at: number }) {
  const f = useCurrentFrame(), { fps } = useVideoConfig();
  const c = spring({ frame: f - at - 2, fps, config: { damping: 9, stiffness: 140 } }), pulse = 1 + Math.max(0, Math.sin((f - at) / 6)) * 0.035;
  return <>
    <Center y={250}>
      <Img src={staticFile("logos/stook.png")} style={{ width: 340, height: 340, transform: `scale(${c}) rotate(${(1 - c) * -30}deg)`, filter: "drop-shadow(0 0 60px rgba(255,198,41,.55))" }} />
    </Center>
    <div style={{ position: "absolute", left: 0, right: 0, top: 660 }}><Slam at={at + 8} size={118} style={{ textAlign: "center" }}>{line}</Slam></div>
    <Center y={1150}>
      <div style={{ opacity: interpolate(f, [at + 24, at + 30], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
        <div style={{ fontFamily: INTER, fontWeight: 900, fontSize: 92, color: GOLD, letterSpacing: "-0.03em" }}>stookstreet.xyz</div>
        <div style={{ marginTop: 46, display: "inline-block", transform: `scale(${pulse})`, fontFamily: PX, fontSize: 40, color: "#14100a", background: GOLD, padding: "32px 48px", borderRadius: 20, boxShadow: "0 12px 0 #a8741a" }}>MAKE YOUR CALL ▸</div>
      </div>
    </Center>
  </>;
}

export function Daily(p: DailyProps) {
  const k = p.kind, beat = (n: number) => beatOf(k, n), total = dailyTotal(k);
  const f = useCurrentFrame(), bell = k === "bell", D = beat(8);
  const [s1, s2, s3, s4] = [beat(16), beat(28), beat(36), beat(44) + 30];
  const left = Math.max(0, p.secsToBell - Math.floor(f / FPS));
  const clock = [left / 3600, (left % 3600) / 60, left % 60].map((n, i) => String(Math.floor(n)).padStart(i ? 2 : 1, "0")).join(":");
  const hits: [string, number, number?][] = bell
    ? [["d-crowd", 0, 0.34], ["d-tick", 0, 0.8], ["d-riser", D - 108, 0.5], ["d-deep", D - 62, 0.55], ["d-bell", D, 1], ["d-impact", D, 0.8], ["d-glitch", D, 0.35],
       ["d-whoosh", s1 - 8, 0.55], ["d-metal", s1, 0.42], ["d-coins", s1 + 26, 0.75], ["d-whoosh", s2 - 8, 0.55], ["d-glitch", s2, 0.3], ["d-whoosh", s3 - 8, 0.55], ["d-bag", s3, 0.8], ["d-bell", s3, 0.42]]
    : [["d-crowd", 0, 0.34], ["d-riser", D - 108, 0.5], ["d-deep", D - 62, 0.55], ["d-impact", D, 0.85], ["d-metal", D, 0.5], ["d-glitch", D, 0.35],
       ["d-whoosh", s1 - 8, 0.55], ["d-tick", s1 + 34, 0.55], ["d-coins", s1 + 26, 0.7], ["d-whoosh", s2 - 8, 0.55], ["d-glitch", s2, 0.3], ["d-whoosh", s3 - 8, 0.55], ["d-bag", s3, 0.8], ["d-bell", s3, 0.5]];
  const shake = f >= D && f < D + 16 ? (D + 16 - f) * 1.5 * (f % 2 ? 1 : -1) : 0;
  return (
    <AbsoluteFill style={{ background: C.ink, overflow: "hidden" }}>
      {!p.muted && <Mix k={k} total={total} drop={D} hits={hits} />}
      <AbsoluteFill style={{ transform: `translate(${shake}px, ${-shake * 0.6}px)` }}>
        <Pulse k={k}>
          <Sequence durationInFrames={D}>
            <City dawn={!bell} dim={0.4} />
            {bell
              ? <><Center y={330}><Clock end={D} /></Center><div style={{ position: "absolute", left: 0, right: 0, top: 640 }}><Slam at={beat(0) + 6} hold={beat(4) - 8} size={132} style={{ textAlign: "center" }}>{"CALLS\nARE LOCKED."}</Slam><Slam at={beat(4)} size={132} style={{ textAlign: "center" }}>{"FOUR PM.\nNEW YORK."}</Slam></div></>
              : <div style={{ position: "absolute", left: 0, right: 0, top: 520 }}><Slam at={beat(0) + 6} hold={beat(4) - 8} size={158} style={{ textAlign: "center" }}>{"ONE PRICE.\nONE BELL."}</Slam><Slam at={beat(4)} size={158} style={{ textAlign: "center" }}>{"TODAY'S\nQUESTION."}</Slam></div>}
          </Sequence>
          <Sequence from={D} durationInFrames={s1 - D}>
            <City dawn={!bell} dim={0.62} from={40} zoom={[1.2, 1.1]} />
            {bell
              ? <><Center y={260}><Bell at={0} size={430} /></Center><div style={{ position: "absolute", left: 0, right: 0, top: 800 }}><Slam at={0} size={232} color={GOLD} stagger={3} style={{ textAlign: "center" }}>{"THE\nBELL."}</Slam></div><Center y={1370}><Tag>NEW YORK</Tag></Center></>
              : <div style={{ position: "absolute", left: 0, right: 0, top: 520 }}><Slam at={0} size={136} stagger={4} style={{ textAlign: "center" }}>{"WHERE WILL\nPOLYMARKET\nCLOSE?"}</Slam></div>}
          </Sequence>
          <Sequence from={s1} durationInFrames={s2 - s1}>
            <City dawn={!bell} dim={0.82} from={70} zoom={[1.1, 1.18]} />
            <Closing points={p.points} at={0} frames={s2 - s1 - 40} tag={`${p.date} ${bell ? "CLOSE" : "NOW"}`} price={p.price} chg={p.chg} extra={!bell ? <Center y={1560}><Tag>BELL IN</Tag><div style={{ fontFamily: PX, fontSize: 76, color: GOOD, marginTop: 18, textShadow: "0 0 26px rgba(94,240,160,.7)" }}>{clock}</div></Center> : undefined} />
          </Sequence>
          <Sequence from={s2} durationInFrames={s3 - s2}>
            <City dawn={!bell} dim={0.7} from={100} zoom={[1.15, 1.05]} x={[0.5, 0.4]} />
            <div style={{ position: "absolute", left: 0, right: 0, top: 150 }}>
              <Slam at={0} hold={beat(32) - s2 - 4} size={bell ? 126 : 104} color={GOLD} style={{ textAlign: "center" }}>{bell ? "CLOSER CALL.\nBIGGER WIN." : "TIGHT WINS BIGGER.\nWIDE WINS EASIER."}</Slam>
              <Slam at={beat(32) - s2} size={126} style={{ textAlign: "center" }}>{bell ? "PAID IN\nYOUR COIN." : "CALLS CLOSE\nAT 3 PM."}</Slam>
            </div>
            <Phone shot={bell ? "howTower" : "howCall"} at={4} />
          </Sequence>
          <Sequence from={s3} durationInFrames={s4 - s3}>
            <City dawn={!bell} dim={0.68} from={130} zoom={[1.02, 1.1]} />
            <EndCard line={bell ? "TOMORROW'S\nROUND IS OPEN." : "CALL THE\n4 PM CLOSE."} at={0} />
          </Sequence>
        </Pulse>
      </AbsoluteFill>
      {bell && <Strike at={D} y={480} />}
      {bell && <Strike at={s3} y={420} />}
      {!bell && <Strike at={D} y={900} />}
      {[D, s1, s2, s3].map((c) => <Glitch key={c} at={c} />)}
      <Finish />
    </AbsoluteFill>
  );
}
