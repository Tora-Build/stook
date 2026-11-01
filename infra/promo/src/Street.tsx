// The street cut: Stook Street in a minute, told the way pump.fun tells it.
// A story in a phone (an iMessage thread at night: "where u think polymarket
// closes today?"), the real site as footage inside the phone and full-bleed
// behind the words, one shot every bar or two, every cut and every word on a
// beat of the track, heavy type slamming in word by word with a colour split,
// a glitch on the cuts. Then the mechanics in the site's own tower (the call,
// how sure, the bell, how it pays: the How page's drawings, filmed), the house,
// listing a coin, the chat's payoff and the door. The track is a trap beat
// (public/street.mp3, grid in beats-street.json): a quiet intro under the chat,
// the drop on the first slam, a bar of silence before the bell, which rings as
// the beat returns. The picture pulses on the track's own kicks.
import { AbsoluteFill, Easing, Img, Sequence, interpolate, random, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { C, Cut, EndCard, Grain, INTER, MONO, PX, Sound, useLay, type AdProps } from "./Ad";
import { BRAND } from "./brand";
import { FPS, ST } from "./config";
import STREET from "./beats-street.json";

const BG = "#05070d";

// ── footage of the live site (scripts/capture.mjs → public/footage/<shot>/0001.jpg…) ──
/** Frames each shot has: seconds × 30, as capture.mjs makes them. */
const LEN: Record<string, number> = { city: 270, cityDawn: 210, floorWide: 210, houseWide: 180, home: 270, dawn: 210, floor: 240, house: 210, houseDesk: 150, list: 180, listSeed: 150, board: 150, howTower: 300, howCall: 240, howBell: 540, howHouse: 180 };
/** Frame of the howBell shot on which the bell is rung (scripts/capture.mjs). */
const BELL_RUNG = 265;
const frameOf = (shot: string, f: number) => staticFile(`footage/${shot}/${String((Math.max(0, f) % LEN[shot]!) + 1).padStart(4, "0")}.jpg`);

/** A desktop shot (3600×1800, the hero only) filling the frame's height, the camera panning from x0 to x1 (0 left … 1 right) and pushing in by `zoom`. */
function Wide(p: { shot: string; x?: [number, number]; zoom?: [number, number]; from?: number; style?: React.CSSProperties }) {
  const f = useCurrentFrame(), { durationInFrames: D } = useVideoConfig(), { W, H } = useLay();
  const z = interpolate(f, [0, D], p.zoom ?? [1, 1.06]), s = (H / 1800) * z, w = 3600 * s, h = 1800 * s;
  const u = interpolate(f, [0, D], p.x ?? [0.5, 0.5], { easing: Easing.inOut(Easing.quad) });
  return <Img src={frameOf(p.shot, f + (p.from ?? 0))} style={{ position: "absolute", left: (W - w) * u, top: (H - h) / 2, width: w, height: h, ...p.style }} />;
}

/** The site on a phone: a dark bezel round a 1080×1920 shot, tilted a little, springing in. */
function Phone(p: { shot: string; w: number; at?: number; tilt?: number; from?: number; x?: number; y?: number; style?: React.CSSProperties }) {
  const f = useCurrentFrame(), { fps } = useVideoConfig();
  const s = spring({ frame: f - (p.at ?? 0), fps, config: { damping: 14, stiffness: 120 } });
  const h = (p.w * 1920) / 1080, r = p.w * 0.11;
  return (
    <div style={{ position: "absolute", left: p.x ?? 0, top: p.y ?? 0, width: p.w, height: h, opacity: Math.min(1, s * 1.6), transform: `perspective(2400px) rotateY(${p.tilt ?? -7}deg) translateY(${(1 - s) * 120}px) scale(${0.9 + s * 0.1})`, transformOrigin: "50% 60%", ...p.style }}>
      <div style={{ position: "absolute", inset: -p.w * 0.03, borderRadius: r + p.w * 0.03, background: "#0c0f16", boxShadow: "0 0 0 3px #2a2f3a, 0 40px 90px rgba(0,0,0,.7), 0 0 120px rgba(240,168,58,.18)" }} />
      <div style={{ position: "absolute", inset: 0, borderRadius: r, overflow: "hidden", background: "#000" }}>
        <Img src={frameOf(p.shot, f + (p.from ?? 0))} style={{ width: "100%", height: "100%", display: "block" }} />
        <div style={{ position: "absolute", left: "50%", top: p.w * 0.025, width: p.w * 0.3, height: p.w * 0.075, borderRadius: 999, background: "#000", transform: "translateX(-50%)" }} />
      </div>
    </div>
  );
}

// ── type that hits ────────────────────────────────────────────────────────────
/** One word of a slam: from 2× down to size in four frames, a red/cyan split while it lands, a small settle. */
function Word(p: { t: number; text: string; last: boolean }) {
  const t = p.t;
  const sc = t < 0 ? 2.1 : interpolate(t, [0, 4], [2.1, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const settle = t >= 4 && t < 12 ? Math.sin((t - 4) * 1.2) * (12 - t) * 0.25 : 0;
  const split = t >= 0 && t < 4 ? 10 - t * 2.5 : 0;
  return <span style={{ display: "inline-block", transform: `scale(${sc}) rotate(${settle}deg)`, opacity: t < 0 ? 0 : Math.min(1, t / 2), textShadow: split ? `-${split}px 0 rgba(255,40,60,.85), ${split}px 0 rgba(40,230,255,.85)` : "0 6px 0 rgba(0,0,0,.6)", marginRight: p.last ? 0 : "0.24em" }}>{p.text}</span>;
}

/** A line (or lines, split on \n) that slams in on a beat, word by word (`stagger` frames apart, 2 by default), and fades out after `hold` frames. */
export function Slam(p: { at: number; children: React.ReactNode; size: number; color?: string; weight?: number; style?: React.CSSProperties; font?: string; hold?: number; stagger?: number; caps?: boolean }) {
  const f = useCurrentFrame(), t = f - p.at;
  if (t < 0 || (p.hold !== undefined && t > p.hold)) return null;
  const out = p.hold !== undefined ? interpolate(t, [p.hold - 4, p.hold], [1, 0], { extrapolateLeft: "clamp" }) : 1;
  const lines = String(p.children).split("\n"), stagger = p.stagger ?? 2;
  let k = 0;
  return (
    <div style={{ fontFamily: p.font ?? INTER, fontWeight: p.weight ?? 900, fontSize: p.size, lineHeight: 1.02, letterSpacing: "-0.03em", color: p.color ?? C.cream, opacity: out, textTransform: p.caps === false ? "none" : "uppercase", ...p.style }}>
      {lines.map((ln, li) => { const words = ln.split(" "); return <div key={li} style={{ whiteSpace: "nowrap" }}>{words.map((w, wi) => <Word key={wi} t={t - (k++) * stagger} text={w} last={wi === words.length - 1} />)}</div>; })}
    </div>
  );
}

/** A number counting up to `to` from `at`, with a colour split while it runs. */
function Count(p: { at: number; to: number; prefix?: string; suffix?: string; size: number; frames?: number; color?: string; style?: React.CSSProperties }) {
  const f = useCurrentFrame(), t = f - p.at;
  if (t < 0) return null;
  const n = p.frames ?? 16, u = interpolate(t, [0, n], [0, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const v = Math.round(p.to * u), running = t < n;
  return <div style={{ fontFamily: INTER, fontWeight: 900, fontSize: p.size, lineHeight: 0.95, letterSpacing: "-0.04em", color: p.color ?? C.taxi, textShadow: running ? "-8px 0 rgba(255,40,60,.8), 8px 0 rgba(40,230,255,.8)" : "0 8px 0 rgba(0,0,0,.55)", fontVariantNumeric: "tabular-nums", ...p.style }}>{p.prefix}{v}{p.suffix}</div>;
}

/** The glitch on a cut: four frames of torn horizontal bands, offset and tinted, over whatever is there. */
export function Glitch({ at }: { at: number }) {
  const f = useCurrentFrame(), { W, H } = useLay(), t = f - at;
  if (t < 0 || t > 3) return null;
  return <AbsoluteFill style={{ pointerEvents: "none" }}>
    {Array.from({ length: 9 }, (_, i) => {
      const y = random(`gy${at}${i}`) * H, h = 6 + random(`gh${at}${i}`) * 60, dx = (random(`gx${at}${i}`) - 0.5) * 120 * (4 - t);
      const col = i % 3 === 0 ? "rgba(255,40,60,.35)" : i % 3 === 1 ? "rgba(40,230,255,.35)" : "rgba(244,233,200,.25)";
      return <div key={i} style={{ position: "absolute", left: dx, top: y, width: W, height: h, background: col, mixBlendMode: "screen" }} />;
    })}
    <AbsoluteFill style={{ background: "repeating-linear-gradient(0deg, rgba(0,0,0,.35) 0 3px, transparent 3px 9px)", opacity: 0.6 }} />
  </AbsoluteFill>;
}

/** A drifting handheld camera: a slow push and a sway on the whole picture. */
function Hand(p: { children: React.ReactNode; push?: number; sway?: number }) {
  const f = useCurrentFrame(), { durationInFrames: D } = useVideoConfig();
  const z = interpolate(f, [0, D], [1, 1 + (p.push ?? 0.05)]), sw = p.sway ?? 6;
  return <AbsoluteFill style={{ transform: `scale(${z}) translate(${Math.sin(f / 23) * sw}px, ${Math.cos(f / 31) * sw * 0.6}px)` }}>{p.children}</AbsoluteFill>;
}

// ── 1. the chat: an iMessage thread, light, on a phone in a dark room ────────
type Msg = { at: number; in?: boolean; text?: string; link?: true; paid?: true; typing?: number };
const IM = { bg: "#ffffff", bar: "#f7f7f8", line: "#d9d9de", inBubble: "#e9e9eb", inText: "#111111", out: "#1b8cff", outText: "#ffffff", grey: "#8e8e93", blue: "#007aff" };

function Typing(p: { w: number }) {
  const f = useCurrentFrame();
  return <div style={{ display: "flex", gap: p.w * 0.012, padding: `${p.w * 0.022}px ${p.w * 0.03}px` }}>
    {[0, 1, 2].map((k) => <div key={k} style={{ width: p.w * 0.022, height: p.w * 0.022, borderRadius: "50%", background: IM.grey, opacity: 0.35 + 0.65 * Math.max(0, Math.sin((f / 4 - k) * 1.1)) }} />)}
  </div>;
}

/** The link's preview, as iMessage draws one: the site's own screen on top, its name and address under. */
function LinkCard(p: { w: number }) {
  const s = p.w;
  return (
    <div style={{ width: s * 0.74, borderRadius: s * 0.04, overflow: "hidden", background: "#f2f2f7", border: `1px solid ${IM.line}` }}>
      <div style={{ position: "relative", height: s * 0.4, overflow: "hidden", background: "#0b1120" }}>
        <Img src={frameOf("home", 40)} style={{ width: "100%", height: s * 0.74 * 1.78, objectFit: "cover", objectPosition: "50% 0%", display: "block" }} />
        <Img src={staticFile("logos/stook.png")} style={{ position: "absolute", left: s * 0.03, bottom: s * 0.03, width: s * 0.12, height: s * 0.12, filter: "drop-shadow(0 2px 6px rgba(0,0,0,.6))" }} />
      </div>
      <div style={{ padding: `${s * 0.022}px ${s * 0.035}px ${s * 0.028}px` }}>
        <div style={{ fontFamily: INTER, fontWeight: 700, fontSize: s * 0.036, color: "#111", letterSpacing: "-0.02em" }}>Stook Street: where will it close?</div>
        <div style={{ fontFamily: INTER, fontWeight: 500, fontSize: s * 0.03, color: IM.grey, marginTop: s * 0.006 }}>{BRAND.site}</div>
      </div>
    </div>
  );
}

/** The site's receipt, shared into the thread: the app's dark card with the coin. */
function PaidCard(p: { w: number }) {
  const s = p.w;
  return (
    <div style={{ width: s * 0.74, borderRadius: s * 0.04, overflow: "hidden", background: C.ink, border: `3px solid ${C.taxi}` }}>
      <div style={{ padding: `${s * 0.03}px ${s * 0.04}px`, display: "flex", alignItems: "center", gap: s * 0.03 }}>
        <Img src={staticFile("logos/stook.png")} style={{ width: s * 0.14, height: s * 0.14 }} />
        <div>
          <div style={{ fontFamily: PX, fontSize: s * 0.028, color: C.taxi }}>PAID · 4:00 PM</div>
          <div style={{ fontFamily: INTER, fontWeight: 900, fontSize: s * 0.075, color: C.cream, letterSpacing: "-0.03em", lineHeight: 1 }}>WIN 2.3×</div>
          <div style={{ fontFamily: MONO, fontWeight: 600, fontSize: s * 0.03, color: "#c9bfa4", marginTop: s * 0.01 }}>3.12M {BRAND.coin} · your floor</div>
        </div>
      </div>
    </div>
  );
}

/** The thread on a phone in a dark room. `dive`: from this frame the camera pushes into the link card. */
function Chat(p: { msgs: Msg[]; name: string; dive?: number; glowAt?: number }) {
  const f = useCurrentFrame(), { fps, durationInFrames: D } = useVideoConfig(), { W, H, tall } = useLay();
  const w = tall ? 860 : 700, h = tall ? 1560 : 1040, x = (W - w) / 2, y = tall ? (H - h) / 2 + 20 : (H - h) / 2;
  const r = w * 0.11, font = w * 0.05;
  const dive = p.dive !== undefined ? interpolate(f, [p.dive, D], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.in(Easing.cubic) }) : 0;
  const zoom = 1 + dive * 5.5;
  const glow = p.glowAt !== undefined ? interpolate(f, [p.glowAt, p.glowAt + 10], [0.45, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 0.6;
  const unread = p.msgs.find((m) => m.in && m.typing !== undefined && f >= m.at - m.typing && f < m.at);
  const shown = p.msgs.filter((m) => f >= m.at), last = shown[shown.length - 1];
  const delivered = last && !last.in && f - last.at > 10;
  return (
    <AbsoluteFill style={{ background: BG, overflow: "hidden" }}>
      {/* the room: the phone's own white light on a dark wall */}
      <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% ${tall ? 55 : 50}%, rgba(235,240,255,${0.28 * glow}) 0%, rgba(240,168,58,${0.08 * glow}) 35%, rgba(5,7,13,0) 62%)` }} />
      <AbsoluteFill style={{ transform: `scale(${zoom})`, transformOrigin: `${W / 2 - w * 0.1}px ${y + h * (tall ? 0.74 : 0.72)}px` }}>
        <Hand push={0.04} sway={4}>
          <div style={{ position: "absolute", left: x, top: y, width: w, height: h, transform: "perspective(2600px) rotateX(2deg) rotateY(-4deg)" }}>
            <div style={{ position: "absolute", inset: -w * 0.03, borderRadius: r + w * 0.03, background: "#0c0f16", boxShadow: "0 0 0 3px #2a2f3a, 0 50px 120px rgba(0,0,0,.8), 0 0 200px rgba(235,240,255,.18)" }} />
            <div style={{ position: "absolute", inset: 0, borderRadius: r, overflow: "hidden", background: IM.bg, fontFamily: INTER }}>
              {/* the status bar and the top of the thread */}
              <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: w * 0.36, background: IM.bar, borderBottom: `1px solid ${IM.line}` }}>
                <div style={{ position: "absolute", left: w * 0.08, top: w * 0.035, fontWeight: 700, fontSize: w * 0.034, color: "#111" }}>9:41</div>
                <div style={{ position: "absolute", right: w * 0.07, top: w * 0.045, display: "flex", alignItems: "flex-end", gap: w * 0.012 }}>
                  {[0.4, 0.6, 0.8, 1].map((k, i) => <div key={i} style={{ width: w * 0.011, height: w * 0.026 * k, background: "#111", borderRadius: 1 }} />)}
                  <div style={{ width: w * 0.05, height: w * 0.024, border: `2px solid #111`, borderRadius: w * 0.006, marginLeft: w * 0.012, padding: 2 }}><div style={{ width: "80%", height: "100%", background: "#111", borderRadius: 1 }} /></div>
                </div>
                <div style={{ position: "absolute", left: w * 0.05, top: w * 0.13, fontSize: w * 0.06, color: IM.blue, lineHeight: 1 }}>‹</div>
                <div style={{ position: "absolute", left: "50%", top: w * 0.11, transform: "translateX(-50%)", display: "flex", flexDirection: "column", alignItems: "center", gap: w * 0.012 }}>
                  <div style={{ width: w * 0.15, height: w * 0.15, borderRadius: "50%", background: "linear-gradient(180deg, #a7adb8, #858c99)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600, fontSize: w * 0.066, color: "#fff" }}>{p.name[0]}</div>
                  <div style={{ fontWeight: 500, fontSize: w * 0.028, color: "#111" }}>{p.name} <span style={{ color: IM.grey }}>›</span></div>
                </div>
              </div>
              {/* the messages, from the bottom up */}
              <div style={{ position: "absolute", left: w * 0.04, right: w * 0.04, bottom: w * 0.21, display: "flex", flexDirection: "column", gap: w * 0.016 }}>
                {p.msgs.map((m, i) => {
                  const t = f - m.at; if (t < 0) return null;
                  const s = spring({ frame: t, fps, config: { damping: 13, stiffness: 220 } });
                  const incoming = !!m.in;
                  return (
                    <div key={i} style={{ alignSelf: incoming ? "flex-start" : "flex-end", transform: `scale(${s}) translateY(${(1 - s) * 30}px)`, transformOrigin: incoming ? "0% 100%" : "100% 100%", maxWidth: "78%" }}>
                      {m.link ? <LinkCard w={w} /> : m.paid ? <PaidCard w={w} /> : (
                        <div style={{ background: incoming ? IM.inBubble : IM.out, color: incoming ? IM.inText : IM.outText, fontWeight: 400, fontSize: font, lineHeight: 1.25, padding: `${w * 0.02}px ${w * 0.032}px`, borderRadius: w * 0.05, borderBottomLeftRadius: incoming ? w * 0.012 : w * 0.05, borderBottomRightRadius: incoming ? w * 0.05 : w * 0.012, letterSpacing: "-0.01em" }}>{m.text}</div>
                      )}
                    </div>
                  );
                })}
                {unread && <div style={{ alignSelf: "flex-start", background: IM.inBubble, borderRadius: w * 0.05, borderBottomLeftRadius: w * 0.012 }}><Typing w={w} /></div>}
                {delivered && <div style={{ alignSelf: "flex-end", fontSize: w * 0.026, fontWeight: 500, color: IM.grey, marginTop: -w * 0.008, marginRight: w * 0.01 }}>Delivered</div>}
              </div>
              {/* the input bar */}
              <div style={{ position: "absolute", left: w * 0.04, right: w * 0.04, bottom: w * 0.07, height: w * 0.1, display: "flex", alignItems: "center", gap: w * 0.025 }}>
                <div style={{ width: w * 0.08, height: w * 0.08, borderRadius: "50%", background: "#e5e5ea", color: IM.grey, display: "flex", alignItems: "center", justifyContent: "center", fontSize: w * 0.05, fontWeight: 500 }}>+</div>
                <div style={{ flex: 1, height: "100%", borderRadius: 999, border: `1.5px solid ${IM.line}`, background: "#fff", display: "flex", alignItems: "center", padding: `0 ${w * 0.035}px`, fontSize: w * 0.034, color: IM.grey }}>iMessage</div>
              </div>
              <div style={{ position: "absolute", left: 0, right: 0, bottom: w * 0.022, margin: "0 auto", width: w * 0.36, height: w * 0.012, borderRadius: 999, background: "#111" }} />
              <div style={{ position: "absolute", left: "50%", top: w * 0.025, width: w * 0.3, height: w * 0.075, borderRadius: 999, background: "#000", transform: "translateX(-50%)" }} />
            </div>
          </div>
        </Hand>
      </AbsoluteFill>
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0) 45%, rgba(0,0,0,.7) 100%)", pointerEvents: "none" }} />
    </AbsoluteFill>
  );
}

// ── 2. the words over the street ─────────────────────────────────────────────
function SlamStreet(p: { words: { at: number; text: string; color?: string; size?: number }[]; shot: string; x?: [number, number]; zoom?: [number, number]; from?: number; top?: number; align?: "center" | "left" }) {
  const f = useCurrentFrame(), { tall, H } = useLay();
  const first = p.words[0]!.at, shake = f - first >= 0 && f - first < 10 ? Math.round(Math.sin((f - first) * 2.6) * (10 - (f - first)) * 2) : 0;
  return (
    <AbsoluteFill style={{ background: BG, overflow: "hidden", transform: `translate(${shake}px, ${-shake / 2}px)` }}>
      <Wide shot={p.shot} x={p.x} zoom={p.zoom} from={p.from} />
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(5,7,13,.55) 0%, rgba(5,7,13,.1) 40%, rgba(5,7,13,.75) 100%)" }} />
      <AbsoluteFill style={{ alignItems: p.align === "left" ? "flex-start" : "center", justifyContent: "flex-start", paddingTop: p.top ?? (tall ? H * 0.16 : H * 0.12), paddingLeft: p.align === "left" ? 60 : 0, paddingRight: p.align === "left" ? 60 : 0, gap: tall ? 14 : 8 }}>
        {p.words.map((w, i) => <Slam key={i} at={w.at} size={w.size ?? (tall ? 150 : 104)} color={w.color} style={{ textAlign: p.align ?? "center" }}>{w.text}</Slam>)}
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

// ── 3. the floor, in the phone, with the tables named: the coin, its anchor, both with their icons ──
function FloorPhone(p: { at: number; rows: number[] }) {
  const f = useCurrentFrame(), { W, H, tall } = useLay();
  const w = tall ? 660 : 540, x = tall ? (W - w) / 2 + 110 : W - w - 10, y = tall ? H * 0.47 : (H - (w * 1920) / 1080) / 2 + 30;
  const rows: [string | null, string, string | null, string][] = [[BRAND.logo, BRAND.coin, BRAND.anchorLogo, BRAND.anchorName], ["logos/zcat.jpg", "$ZCAT", "logos/zec.svg", "Zcash"], [null, "your coin", null, "its stock"]];
  const ic = tall ? 84 : 40, fs = tall ? 62 : 29;
  return (
    <AbsoluteFill style={{ background: "linear-gradient(165deg, #121d3a 0%, #0a2238 55%, #06111f 100%)", overflow: "hidden" }}>
      <Wide shot="floorWide" x={[0.2, 0.6]} zoom={[1.1, 1.18]} style={{ opacity: 0.5, filter: "blur(2px)" }} />
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(6,10,20,.88) 0%, rgba(6,10,20,.5) 45%, rgba(6,10,20,.2) 100%)" }} />
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at 60% 75%, rgba(240,168,58,.22), rgba(0,0,0,0) 55%)" }} />
      <Phone shot="floor" w={w} x={x} y={y} at={0} tilt={-10} />
      <div style={tall ? { position: "absolute", left: 60, right: 60, top: H * 0.07 } : { position: "absolute", left: 50, width: W - w - 50, top: "50%", transform: "translateY(-50%)" }}>
        <Slam at={p.at} size={tall ? 118 : 64} style={{ textAlign: "left" }}>{"EVERY COIN\nHAS A TABLE."}</Slam>
        <div style={{ marginTop: tall ? 40 : 18, display: "flex", flexDirection: "column", gap: tall ? 22 : 10 }}>
          {rows.map(([cl, c, al, a], i) => {
            const t = f - p.rows[i]!; if (t < 0) return null;
            const sx = interpolate(t, [0, 6], [-80, 0], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
            const ph = !cl;
            const icon = (src: string | null) => src
              ? <Img src={staticFile(src)} style={{ width: ic, height: ic, borderRadius: "50%", objectFit: "cover", boxShadow: "0 0 0 3px rgba(244,233,200,.25), 0 10px 30px rgba(0,0,0,.6)" }} />
              : <div style={{ width: ic, height: ic, borderRadius: "50%", border: "3px dashed rgba(244,233,200,.45)" }} />;
            return <div key={c} style={{ transform: `translateX(${sx}px)`, opacity: Math.min(1, t / 4), display: "flex", alignItems: "center", gap: tall ? 18 : 10, whiteSpace: "nowrap", fontFamily: INTER, fontWeight: 800, fontSize: fs, letterSpacing: "-0.02em", color: ph ? "rgba(244,233,200,.55)" : C.cream, textShadow: "0 4px 0 rgba(0,0,0,.5)" }}>
              {icon(cl)}<span style={{ color: ph ? "rgba(244,233,200,.55)" : C.taxi, borderBottom: ph ? "3px dashed rgba(244,233,200,.35)" : "none" }}>{c}</span>
              <span style={{ color: "#aeb4c0", fontWeight: 500, fontSize: fs * 0.6, margin: `0 ${tall ? 6 : 2}px` }}>plays</span>
              {icon(al)}<span style={{ borderBottom: ph ? "3px dashed rgba(244,233,200,.35)" : "none" }}>{a}</span>
            </div>;
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
}

// ── 4. the tower, the call, the bell: the site's own drawings in the phone ───
/** A phone in the middle of the frame, large, over the lit city, the words above it. */
function BigPhone(p: { shot: string; from?: number; tilt?: number; bg?: string; bgFrom?: number; children: React.ReactNode }) {
  const { W, H, tall } = useLay();
  const w = tall ? 820 : 580, x = tall ? (W - w) / 2 : W - w + 20, y = tall ? H * 0.29 : (H - (w * 1920) / 1080) / 2;
  return (
    <AbsoluteFill style={{ background: "linear-gradient(165deg, #121d3a 0%, #0a2238 55%, #06111f 100%)", overflow: "hidden" }}>
      <Wide shot={p.bg ?? "city"} from={p.bgFrom ?? 0} x={[0.4, 0.6]} zoom={[1.15, 1.25]} style={{ opacity: 0.5, filter: "blur(2px)" }} />
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(6,10,20,.88) 0%, rgba(6,10,20,.45) 40%, rgba(6,10,20,.15) 100%)" }} />
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at 50% 65%, rgba(240,168,58,.24), rgba(0,0,0,0) 55%)" }} />
      <Phone shot={p.shot} from={p.from} w={w} x={x} y={y} at={0} tilt={p.tilt ?? -5} />
      <div style={tall ? { position: "absolute", left: 60, right: 60, top: H * 0.06 } : { position: "absolute", left: 50, width: W - w - 40, top: "50%", transform: "translateY(-50%)" }}>{p.children}</div>
    </AbsoluteFill>
  );
}

/** "CALL WHERE IT CLOSES." over the tower: the chart with its floors, the crowd's odds, a tap moves the gold band. */
function TowerPhone(p: { at: number; words: number[] }) {
  const { tall } = useLay();
  const small = tall ? 58 : 36;
  return (
    <BigPhone shot="howTower" bgFrom={30}>
      <Slam at={p.at} size={tall ? 118 : 70} style={{ textAlign: "left" }}>{"CALL WHERE\nIT CLOSES."}</Slam>
      <div style={{ marginTop: tall ? 26 : 12, display: "flex", flexDirection: "column", gap: tall ? 10 : 4 }}>
        <Slam at={p.words[0]!} size={small} color={C.taxi} style={{ textAlign: "left" }}>TAP A FLOOR.</Slam>
        <Slam at={p.words[1]!} size={small} color={C.taxi} style={{ textAlign: "left" }}>THE CROWD'S ODDS ON THE RIGHT.</Slam>
      </div>
    </BigPhone>
  );
}

/** "HOW SURE?" over the call: tight, medium, wide. Tight wins bigger, wide wins easier. */
function CallPhone(p: { at: number; words: number[] }) {
  const { tall } = useLay();
  const small = tall ? 58 : 36;
  return (
    <BigPhone shot="howCall" from={40} bg="floorWide" tilt={5}>
      <Slam at={p.at} size={tall ? 118 : 70} style={{ textAlign: "left" }}>HOW SURE?</Slam>
      <div style={{ marginTop: tall ? 26 : 12, display: "flex", flexDirection: "column", gap: tall ? 10 : 4 }}>
        <Slam at={p.words[0]!} size={small} color={C.taxi} style={{ textAlign: "left" }}>TIGHT: BIGGER WIN.</Slam>
        <Slam at={p.words[1]!} size={small} color={C.taxi} style={{ textAlign: "left" }}>WIDE: EASIER WIN.</Slam>
      </div>
    </BigPhone>
  );
}

/** The lock, a bar of silence, the bell on the beat's return, then how it paid: all on the How page's bell drawing. */
function BellPhone(p: { at: number; words: number[]; ring: number; pay: number[] }) {
  const f = useCurrentFrame(), { tall, W, H } = useLay();
  const t = f - p.ring, flash = t >= 0 && t < 6 ? 1 - t / 6 : 0;
  const shake = t >= 0 && t < 12 ? Math.round(Math.sin(t * 2.4) * (12 - t) * 1.6) : 0;
  const small = tall ? 58 : 36;
  return (
    <AbsoluteFill style={{ transform: `translate(${shake}px, ${-shake}px)` }}>
      <BigPhone shot="howBell" from={BELL_RUNG - p.ring} bgFrom={150} tilt={-4}>
        <Slam at={p.at} hold={p.ring - p.at} size={tall ? 150 : 90} style={{ textAlign: "left" }}>4:00 PM.</Slam>
        <Slam at={p.words[0]!} hold={p.ring - p.words[0]!} size={tall ? 118 : 70} color={C.taxi} style={{ textAlign: "left" }}>THE BELL.</Slam>
        <Slam at={p.words[1]!} hold={p.ring - p.words[1]!} size={small} color="#c9bfa4" style={{ textAlign: "left", marginTop: tall ? 20 : 10 }}>TRADING CLOSED.</Slam>
        <Slam at={p.ring} size={tall ? 190 : 110} color={C.taxi} stagger={0} style={{ textAlign: "left" }}>RANG.</Slam>
        <div style={{ marginTop: tall ? 20 : 10, display: "flex", flexDirection: "column", gap: tall ? 10 : 4 }}>
          <Slam at={p.pay[0]!} size={tall ? 70 : 42} style={{ textAlign: "left" }}>THE CLOSER YOU ARE,</Slam>
          <Slam at={p.pay[1]!} size={tall ? 70 : 42} color={C.taxi} style={{ textAlign: "left" }}>THE MORE IT PAYS.</Slam>
          <Slam at={p.pay[2]!} size={small} color="#c9bfa4" style={{ textAlign: "left" }}>PAID IN YOUR COIN. ON CHAIN.</Slam>
        </div>
      </BigPhone>
      <AbsoluteFill style={{ background: "#fff7e0", opacity: flash * 0.85, pointerEvents: "none" }} />
      {t >= 0 && t < 40 && <AbsoluteFill style={{ background: `radial-gradient(circle at ${W / 2}px ${H * 0.5}px, rgba(240,168,58,${0.35 * Math.exp(-t / 10)}) 0%, rgba(0,0,0,0) 60%)`, pointerEvents: "none" }} />}
    </AbsoluteFill>
  );
}

// ── 5. the house, the listing: the phone bleeding off one edge, the words filling the other ──
function Lit(p: { shot: string; from?: number; children: React.ReactNode }) {
  return (
    <AbsoluteFill style={{ background: "linear-gradient(165deg, #121d3a 0%, #0a2238 55%, #06111f 100%)", overflow: "hidden" }}>
      <Wide shot={p.shot} from={p.from} x={[0.9, 0.5]} zoom={[1.15, 1.25]} style={{ opacity: 0.5, filter: "blur(2px)" }} />
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(6,10,20,.88) 0%, rgba(6,10,20,.5) 45%, rgba(6,10,20,.2) 100%)" }} />
      {p.children}
    </AbsoluteFill>
  );
}

function HousePhone(p: { at: number; pct: number; words: number }) {
  const { W, H, tall } = useLay();
  const w = tall ? 760 : 600, x = tall ? W - w + 110 : W - w + 90, y = tall ? H * 0.37 : (H - (w * 1920) / 1080) / 2;
  return (
    <Lit shot="houseWide">
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at 75% 70%, rgba(240,168,58,.26), rgba(0,0,0,0) 55%)" }} />
      <Phone shot="howHouse" w={w} x={x} y={y} at={0} tilt={14} />
      <div style={tall ? { position: "absolute", left: 60, top: H * 0.06, width: W - 120 } : { position: "absolute", left: 50, width: W - w + 90 - 70, top: "50%", transform: "translateY(-50%)" }}>
        <Slam at={p.at} size={tall ? 118 : 66} style={{ textAlign: "left" }}>{"OR BE\nTHE HOUSE."}</Slam>
        <div style={{ marginTop: tall ? 18 : 8, display: "flex", alignItems: "flex-end", gap: tall ? 28 : 14 }}>
          <Count at={p.pct} to={90} suffix="%" size={tall ? 250 : 150} />
          <Slam at={p.words} size={tall ? 46 : 26} weight={700} color="#c9bfa4" caps={false} style={{ textAlign: "left", letterSpacing: "0", paddingBottom: tall ? 26 : 10 }}>{"of every fee.\nnever more than\nyou put in."}</Slam>
        </div>
      </div>
    </Lit>
  );
}

function ListPhone(p: { at: number; seed: number }) {
  const { W, H, tall } = useLay();
  const w = tall ? 760 : 600, x = tall ? -110 : -90, y = tall ? H * 0.37 : (H - (w * 1920) / 1080) / 2;
  return (
    <Lit shot="city" from={60}>
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at 25% 70%, rgba(53,196,196,.22), rgba(0,0,0,0) 55%)" }} />
      <Phone shot="list" w={w} x={x} y={y} at={0} tilt={-14} />
      <div style={tall ? { position: "absolute", right: 60, top: H * 0.06, width: W - 120, textAlign: "right" } : { position: "absolute", right: 50, width: W - w + 90 - 70, top: "50%", transform: "translateY(-50%)", textAlign: "right" }}>
        <Slam at={p.at} size={tall ? 118 : 66} style={{ textAlign: "right" }}>{"LIST\nYOUR COIN."}</Slam>
        <div style={{ marginTop: tall ? 18 : 8, display: "flex", justifyContent: "flex-end", alignItems: "flex-end", gap: tall ? 28 : 14 }}>
          <Slam at={p.seed + 2} size={tall ? 46 : 26} weight={700} color="#c9bfa4" caps={false} style={{ textAlign: "right", letterSpacing: "0", paddingBottom: tall ? 26 : 10 }}>{"seeds a table.\nyour community\ncalls it."}</Slam>
          <Count at={p.seed} to={200} prefix="$" size={tall ? 250 : 150} />
        </div>
      </div>
    </Lit>
  );
}

// ── the cut ──────────────────────────────────────────────────────────────────
/** Beats of the track (136 BPM, bar = 4; the drop on 24, the silent bar 88-92, the beat back on 92) each scene sits on. */
const B = {
  chat: 0, slam: 24, dawn: 34, floor: 42, tower: 54, call: 70, bell: 84, ring: 92, house: 110, list: 121, chat2: 130, end: 150,
};
const at = ST.at;
/** Frames of the track's kicks inside the ad: the picture's pulse. */
const KICKS = (STREET.kicks as number[]).map((s) => Math.round((s - ST.start) * FPS)).filter((x) => x >= 0 && x < ST.total);

export function Street(p: AdProps) {
  const cuts = [B.slam, B.dawn, B.floor, B.tower, B.call, B.bell, B.house, B.list, B.chat2, B.end].map(at);
  const [slam, dawn, floor, tower, call, bell, house, list, chat2, end] = cuts as [number, number, number, number, number, number, number, number, number, number];
  const seg = (from: number, to: number) => ({ from, durationInFrames: to - from });
  const ring = at(B.ring);
  return (
    <AbsoluteFill style={{ background: BG }}>
      <Pulse beats={KICKS} from={slam}>
        <Sequence {...seg(0, slam)}>
          <Chat name="Anon" dive={at(20)} glowAt={at(16)} msgs={[
            { at: at(2), in: true, typing: 30, text: "bro where u think polymarket closes today" },
            { at: at(7), text: "no clue lol. 4pm?" },
            { at: at(12), in: true, typing: 34, text: "ya. theres a street for that now" },
            { at: at(16.5), in: true, typing: 28, link: true },
          ]} />
        </Sequence>
        <Sequence {...seg(slam, dawn)}>
          <SlamStreet shot="city" x={[0.62, 0.45]} zoom={[1.02, 1.1]} words={[{ at: 0, text: "WHERE WILL\nIT CLOSE?" }, { at: at(29) - slam, text: "ONE QUESTION.\nEVERY DAY.", size: 92, color: C.taxi }]} />
        </Sequence>
        <Sequence {...seg(dawn, floor)}>
          <SlamStreet shot="cityDawn" x={[0.3, 0.7]} zoom={[1.08, 1.0]} top={1180} words={[{ at: 0, text: "4 PM\nNEW YORK." }, { at: at(38) - dawn, text: "THE BELL.", color: C.taxi }]} />
        </Sequence>
        <Sequence {...seg(floor, tower)}>
          <FloorPhone at={0} rows={[at(46), at(49), at(52)].map((x) => x - floor)} />
        </Sequence>
        <Sequence {...seg(tower, call)}>
          <TowerPhone at={0} words={[at(60) - tower, at(65) - tower]} />
        </Sequence>
        <Sequence {...seg(call, bell)}>
          <CallPhone at={0} words={[at(75) - call, at(80) - call]} />
        </Sequence>
        <Sequence {...seg(bell, house)}>
          <BellPhone at={0} words={[at(86) - bell, at(88) - bell]} ring={ring - bell} pay={[at(96), at(100), at(104)].map((x) => x - bell)} />
        </Sequence>
        <Sequence {...seg(house, list)}>
          <HousePhone at={0} pct={at(114) - house} words={at(116) - house} />
        </Sequence>
        <Sequence {...seg(list, chat2)}>
          <ListPhone at={0} seed={at(125) - list} />
        </Sequence>
        <Sequence {...seg(chat2, end)}>
          <Chat name="Anon" glowAt={0} msgs={[
            { at: at(133) - chat2, paid: true },
            { at: at(136.5) - chat2, in: true, typing: 20, text: "no way" },
            { at: at(140) - chat2, text: "told u. called the floor, bell rang, got paid" },
            { at: at(145) - chat2, in: true, typing: 26, text: "ok im seeding the house tmrw lol" },
            { at: at(149) - chat2, text: "lmao see u at 4" },
          ]} />
        </Sequence>
        <Sequence from={end} durationInFrames={ST.total - end}><EndCard /></Sequence>
      </Pulse>
      {cuts.map((a) => <Cut key={a} at={a} />)}
      {[...cuts, ring].map((a) => <Glitch key={`g${a}`} at={a} />)}
      <Grain />
      <Sound track={p.track} length={ST.total} start={ST.start} fadeOut={ST.fadeOut} music={1} hits={[
        ["ping", at(2), 0.7], ["sent", at(7), 0.5], ["ping", at(12), 0.7], ["ping", at(16.5), 0.7], ["whoosh", at(20), 0.6], ["hit", slam, 0.5],
        ["ding", at(60), 0.35], ["ding", at(65), 0.35], ["whoosh", bell, 0.5], ["bell", ring, 1],
        ["win", at(133), 0.6], ["ping", at(136.5), 0.7], ["sent", at(140), 0.5], ["ping", at(145), 0.7], ["sent", at(149), 0.5], ["whoosh", end, 0.5],
      ]} />
    </AbsoluteFill>
  );
}

/** Small motion hits: the picture bumps on every kick of the track after the drop. */
function Pulse(p: { beats: number[]; from: number; children: React.ReactNode }) {
  const f = useCurrentFrame();
  const last = p.beats.filter((b) => b <= f && b >= p.from).pop();
  const k = last === undefined ? 0 : Math.exp(-(f - last) / 3.5);
  return <AbsoluteFill style={{ transform: `scale(${1 + 0.02 * k})` }}>{p.children}</AbsoluteFill>;
}
