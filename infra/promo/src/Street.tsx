// The street cut: Stook Street in a minute, told the way pump.fun tells it.
// A story in a phone (a chat at night: "where's polymarket closing today?"),
// the real site as footage inside the phone and full-bleed behind the words,
// one shot every bar or two, every cut and every word on a beat of the
// track, heavy type slamming in with a colour split, a glitch on the cuts.
// Then the mechanics in the site's own tower (the call, how sure, the bell,
// how it pays: the How page's drawings, filmed), the house, listing a coin,
// the chat's payoff and the door. The track is a trap beat (public/street.mp3,
// grid in beats-street.json): a quiet intro under the chat, the drop on the
// first slam, a bar of silence before the bell, which rings as the beat returns.
import { AbsoluteFill, Easing, Img, Sequence, interpolate, random, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { C, Cut, EndCard, Grain, INTER, MONO, PX, Sound, useLay, type AdProps } from "./Ad";
import { Skyline } from "./Skyline";
import { BRAND } from "./brand";
import { ST } from "./config";

const BG = "#05070d";

// ── footage of the live site (scripts/capture.mjs → public/footage/<shot>/0001.jpg…) ──
/** Frames each shot has: seconds × 30, as capture.mjs makes them. */
const LEN: Record<string, number> = { city: 270, cityDawn: 210, floorWide: 210, houseWide: 180, home: 270, dawn: 210, floor: 240, house: 210, houseDesk: 150, list: 180, listSeed: 150, board: 150, howTower: 300, howCall: 240, howBell: 420, howHouse: 180 };
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
      <div style={{ position: "absolute", inset: -p.w * 0.03, borderRadius: r + p.w * 0.03, background: "#0c0f16", boxShadow: "0 0 0 3px #2a2f3a, 0 40px 90px rgba(0,0,0,.7), 0 0 80px rgba(240,168,58,.12)" }} />
      <div style={{ position: "absolute", inset: 0, borderRadius: r, overflow: "hidden", background: "#000" }}>
        <Img src={frameOf(p.shot, f + (p.from ?? 0))} style={{ width: "100%", height: "100%", display: "block" }} />
        <div style={{ position: "absolute", left: "50%", top: p.w * 0.025, width: p.w * 0.3, height: p.w * 0.075, borderRadius: 999, background: "#000", transform: "translateX(-50%)" }} />
      </div>
    </div>
  );
}

// ── type that hits ────────────────────────────────────────────────────────────
/** A line that slams in on a beat: from 2× down to size in four frames, a red/cyan split while it lands, a small settle. */
export function Slam(p: { at: number; children: React.ReactNode; size: number; color?: string; weight?: number; style?: React.CSSProperties; font?: string; hold?: number }) {
  const f = useCurrentFrame(), t = f - p.at;
  if (t < 0 || (p.hold !== undefined && t > p.hold)) return null;
  const sc = interpolate(t, [0, 4], [2.1, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const settle = t >= 4 && t < 12 ? Math.sin((t - 4) * 1.2) * (12 - t) * 0.25 : 0;
  const split = t < 4 ? 10 - t * 2.5 : 0;
  const out = p.hold !== undefined ? interpolate(t, [p.hold - 4, p.hold], [1, 0], { extrapolateLeft: "clamp" }) : 1;
  return (
    <div style={{ fontFamily: p.font ?? INTER, fontWeight: p.weight ?? 900, fontSize: p.size, lineHeight: 0.98, letterSpacing: "-0.03em", color: p.color ?? C.cream, transform: `scale(${sc}) rotate(${settle}deg)`, opacity: Math.min(1, t / 2) * out, textShadow: split ? `-${split}px 0 rgba(255,40,60,.85), ${split}px 0 rgba(40,230,255,.85)` : "0 6px 0 rgba(0,0,0,.6)", textTransform: "uppercase", whiteSpace: "pre-line", ...p.style }}>{p.children}</div>
  );
}

/** A number counting up to `to` from `at`, with a colour split while it runs. */
function Count(p: { at: number; to: number; prefix?: string; suffix?: string; size: number; frames?: number; color?: string }) {
  const f = useCurrentFrame(), t = f - p.at;
  if (t < 0) return null;
  const n = p.frames ?? 14, u = interpolate(t, [0, n], [0, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const v = Math.round(p.to * u), running = t < n;
  return <div style={{ fontFamily: INTER, fontWeight: 900, fontSize: p.size, lineHeight: 0.95, letterSpacing: "-0.04em", color: p.color ?? C.taxi, textShadow: running ? "-8px 0 rgba(255,40,60,.8), 8px 0 rgba(40,230,255,.8)" : "0 8px 0 rgba(0,0,0,.55)", fontVariantNumeric: "tabular-nums" }}>{p.prefix}{v}{p.suffix}</div>;
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

// ── 1. the chat ──────────────────────────────────────────────────────────────
type Msg = { at: number; in?: boolean; text?: string; link?: true; paid?: true; typing?: number };

function Typing(p: { w: number }) {
  const f = useCurrentFrame();
  return <div style={{ display: "flex", gap: p.w * 0.012, padding: `${p.w * 0.02}px ${p.w * 0.03}px` }}>
    {[0, 1, 2].map((k) => <div key={k} style={{ width: p.w * 0.022, height: p.w * 0.022, borderRadius: "50%", background: "#8a8f99", opacity: 0.4 + 0.6 * Math.max(0, Math.sin((f / 4 - k) * 1.1)) }} />)}
  </div>;
}

function LinkCard(p: { w: number }) {
  const s = p.w;
  return (
    <div style={{ width: s * 0.74, borderRadius: s * 0.03, overflow: "hidden", background: C.ink, border: "2px solid #2a2f3a" }}>
      <div style={{ position: "relative", height: s * 0.36, overflow: "hidden", background: C.ink }}>
        <Skyline width={s * 0.74} height={s * 0.36} scale={3} lit={1} />
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(11,17,32,.1), rgba(11,17,32,.75))" }} />
        <Img src={staticFile("stook-coin.svg")} style={{ position: "absolute", left: s * 0.03, bottom: s * 0.03, width: s * 0.12, height: s * 0.12, imageRendering: "pixelated" }} />
        <div style={{ position: "absolute", left: s * 0.17, bottom: s * 0.045, fontFamily: PX, fontSize: s * 0.028, color: C.cream, textShadow: `2px 2px 0 ${C.ink}` }}>STOOK STREET</div>
      </div>
      <div style={{ padding: `${s * 0.025}px ${s * 0.035}px` }}>
        <div style={{ fontFamily: INTER, fontWeight: 800, fontSize: s * 0.04, color: C.cream, letterSpacing: "-0.02em" }}>Where will it close at 4 PM?</div>
        <div style={{ fontFamily: MONO, fontWeight: 600, fontSize: s * 0.03, color: "#8a8f99", marginTop: s * 0.01 }}>{BRAND.site}</div>
      </div>
    </div>
  );
}

function PaidCard(p: { w: number }) {
  const s = p.w;
  return (
    <div style={{ width: s * 0.74, borderRadius: s * 0.03, overflow: "hidden", background: C.ink, border: `3px solid ${C.taxi}` }}>
      <div style={{ padding: `${s * 0.03}px ${s * 0.04}px`, display: "flex", alignItems: "center", gap: s * 0.03 }}>
        <Img src={staticFile("stook-coin.svg")} style={{ width: s * 0.13, height: s * 0.13, imageRendering: "pixelated" }} />
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
  const w = tall ? 860 : 620, h = tall ? 1560 : 940, x = (W - w) / 2, y = tall ? (H - h) / 2 + 20 : (H - h) / 2;
  const r = w * 0.11, font = w * 0.052;
  const dive = p.dive !== undefined ? interpolate(f, [p.dive, D], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.in(Easing.cubic) }) : 0;
  const zoom = 1 + dive * 5.5;
  const glow = p.glowAt !== undefined ? interpolate(f, [p.glowAt, p.glowAt + 10], [0.35, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 0.5;
  const unread = p.msgs.find((m) => m.in && m.typing !== undefined && f >= m.at - m.typing && f < m.at);
  return (
    <AbsoluteFill style={{ background: BG, overflow: "hidden" }}>
      {/* the room: the phone's own light on a dark wall */}
      <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% ${tall ? 55 : 50}%, rgba(240,168,58,${0.34 * glow}) 0%, rgba(53,196,196,${0.08 * glow}) 30%, rgba(5,7,13,0) 62%)` }} />
      <AbsoluteFill style={{ transform: `scale(${zoom})`, transformOrigin: `${W / 2 - w * 0.1}px ${y + h * (tall ? 0.74 : 0.72)}px` }}>
        <Hand push={0.04} sway={4}>
          <div style={{ position: "absolute", left: x, top: y, width: w, height: h, transform: "perspective(2600px) rotateX(2deg) rotateY(-4deg)" }}>
            <div style={{ position: "absolute", inset: -w * 0.03, borderRadius: r + w * 0.03, background: "#0c0f16", boxShadow: "0 0 0 3px #2a2f3a, 0 50px 120px rgba(0,0,0,.8), 0 0 200px rgba(240,168,58,.22)" }} />
            <div style={{ position: "absolute", inset: 0, borderRadius: r, overflow: "hidden", background: "#12161f", boxShadow: "inset 0 0 120px rgba(240,168,58,.08)" }}>
              {/* the top of the thread */}
              <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: w * 0.26, background: "linear-gradient(180deg, #11151d, rgba(17,21,29,.9))", borderBottom: "1px solid #1f2430", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", paddingBottom: w * 0.025, gap: w * 0.012 }}>
                <div style={{ width: w * 0.11, height: w * 0.11, borderRadius: "50%", background: "radial-gradient(circle at 35% 35%, #e0b48a, #a87452)", border: "3px solid #2a2f3a", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: INTER, fontWeight: 800, fontSize: w * 0.05, color: C.ink }}>{p.name[0]}</div>
                <div style={{ fontFamily: INTER, fontWeight: 700, fontSize: w * 0.03, color: C.cream }}>{p.name}</div>
              </div>
              <div style={{ position: "absolute", left: 0, right: 0, top: w * 0.07, textAlign: "center", fontFamily: INTER, fontWeight: 700, fontSize: w * 0.026, color: "#c9bfa4" }}>{tall ? "3:41 PM" : "3:41"}</div>
              {/* the messages, from the bottom up */}
              <div style={{ position: "absolute", left: w * 0.04, right: w * 0.04, bottom: w * 0.2, display: "flex", flexDirection: "column", gap: w * 0.02 }}>
                {p.msgs.map((m, i) => {
                  const t = f - m.at; if (t < 0) return null;
                  const s = spring({ frame: t, fps, config: { damping: 13, stiffness: 220 } });
                  const incoming = !!m.in;
                  return (
                    <div key={i} style={{ alignSelf: incoming ? "flex-start" : "flex-end", transform: `scale(${s}) translateY(${(1 - s) * 30}px)`, transformOrigin: incoming ? "0% 100%" : "100% 100%", maxWidth: "82%" }}>
                      {m.link ? <LinkCard w={w} /> : m.paid ? <PaidCard w={w} /> : (
                        <div style={{ background: incoming ? "#30364a" : C.taxi, color: incoming ? C.cream : C.ink, fontFamily: INTER, fontWeight: 500, fontSize: font, lineHeight: 1.25, padding: `${w * 0.022}px ${w * 0.034}px`, borderRadius: w * 0.045, borderBottomLeftRadius: incoming ? w * 0.012 : w * 0.045, borderBottomRightRadius: incoming ? w * 0.045 : w * 0.012, letterSpacing: "-0.01em" }}>{m.text}</div>
                      )}
                    </div>
                  );
                })}
                {unread && <div style={{ alignSelf: "flex-start", background: "#30364a", borderRadius: w * 0.045, borderBottomLeftRadius: w * 0.012 }}><Typing w={w} /></div>}
              </div>
              {/* the keyboard bar */}
              <div style={{ position: "absolute", left: w * 0.04, right: w * 0.04, bottom: w * 0.05, height: w * 0.1, borderRadius: 999, background: "#161b25", border: "1px solid #2a2f3a", display: "flex", alignItems: "center", padding: `0 ${w * 0.04}px`, fontFamily: INTER, fontWeight: 500, fontSize: w * 0.034, color: "#5b6170" }}>Message</div>
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
      <AbsoluteFill style={{ alignItems: p.align === "left" ? "flex-start" : "center", justifyContent: "flex-start", paddingTop: p.top ?? (tall ? H * 0.16 : H * 0.12), paddingLeft: p.align === "left" ? 60 : 0, paddingRight: p.align === "left" ? 60 : 0, gap: tall ? 10 : 6 }}>
        {p.words.map((w, i) => <Slam key={i} at={w.at} size={w.size ?? (tall ? 150 : 104)} color={w.color} style={{ textAlign: p.align ?? "center" }}>{w.text}</Slam>)}
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

// ── 3. the floor, in the phone, with the tables named ────────────────────────
function FloorPhone(p: { at: number; names: number[] }) {
  const f = useCurrentFrame(), { W, H, tall } = useLay();
  const w = tall ? 700 : 400, x = tall ? (W - w) / 2 + 120 : W - w - 60, y = tall ? H * 0.5 : H * 0.12;
  const coins = [[BRAND.coin, BRAND.anchorName], ["$ZCAT", "Zcash"], ["$KNOTS", "STONK"], ["$GP", "Gold"]];
  return (
    <AbsoluteFill style={{ background: BG, overflow: "hidden" }}>
      <Wide shot="floorWide" x={[0.2, 0.6]} zoom={[1.1, 1.18]} style={{ opacity: 0.35, filter: "blur(2px)" }} />
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(5,7,13,.92) 0%, rgba(5,7,13,.6) 50%, rgba(5,7,13,.2) 100%)" }} />
      <Phone shot="floor" w={w} x={x} y={y} at={0} tilt={-10} />
      <div style={{ position: "absolute", left: tall ? 60 : 50, right: tall ? 60 : 50, top: tall ? H * 0.08 : H * 0.07 }}>
        <Slam at={p.at} size={tall ? 118 : 70} style={{ textAlign: "left" }}>{"EVERY COIN\nHAS A TABLE."}</Slam>
        <div style={{ marginTop: tall ? 44 : 22, display: "grid", gridTemplateColumns: tall ? "1fr 1fr" : "1fr", gap: tall ? "18px 30px" : "8px" }}>
          {coins.map(([c, a], i) => {
            const t = f - p.names[i]!; if (t < 0) return null;
            const sx = interpolate(t, [0, 5], [-60, 0], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
            return <div key={c} style={{ transform: `translateX(${sx}px)`, opacity: Math.min(1, t / 3), display: "flex", alignItems: "baseline", gap: tall ? 14 : 8, fontFamily: INTER, fontWeight: 800, fontSize: tall ? 46 : 30, letterSpacing: "-0.02em", color: C.cream, whiteSpace: "nowrap" }}>
              <span style={{ color: C.taxi, fontFamily: PX, fontSize: tall ? 28 : 18 }}>{c}</span><span style={{ color: "#8a8f99", fontWeight: 500, fontSize: tall ? 28 : 18 }}>plays</span><span>{a}</span>
            </div>;
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
}

// ── 4. the tower, the call, the bell: the site's own drawings in the phone ───
/** A phone in the middle of the frame, large, over a blurred shot of the city, the words above it. */
function BigPhone(p: { shot: string; from?: number; tilt?: number; bg?: string; bgFrom?: number; children: React.ReactNode }) {
  const { W, H, tall } = useLay();
  const w = tall ? 780 : 430, x = tall ? (W - w) / 2 : W - w - 40, y = tall ? H * 0.3 : H * 0.1;
  return (
    <AbsoluteFill style={{ background: BG, overflow: "hidden" }}>
      <Wide shot={p.bg ?? "city"} from={p.bgFrom ?? 0} x={[0.4, 0.6]} zoom={[1.15, 1.25]} style={{ opacity: 0.3, filter: "blur(3px)" }} />
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(5,7,13,.95) 0%, rgba(5,7,13,.6) 45%, rgba(5,7,13,.3) 100%)" }} />
      <Phone shot={p.shot} from={p.from} w={w} x={x} y={y} at={0} tilt={p.tilt ?? -5} />
      <div style={{ position: "absolute", left: tall ? 60 : 50, right: tall ? 60 : 50, top: tall ? H * 0.07 : H * 0.07 }}>{p.children}</div>
    </AbsoluteFill>
  );
}

/** "CALL WHERE IT CLOSES." over the tower: the chart with its floors, the crowd's odds, a tap moves the gold band. */
function TowerPhone(p: { at: number; words: number[] }) {
  const { tall } = useLay();
  const small = tall ? 54 : 34;
  return (
    <BigPhone shot="howTower" bgFrom={30}>
      <Slam at={p.at} size={tall ? 118 : 70} style={{ textAlign: "left" }}>{"CALL WHERE\nIT CLOSES."}</Slam>
      <div style={{ marginTop: tall ? 24 : 12, display: "flex", flexDirection: "column", gap: tall ? 8 : 4 }}>
        <Slam at={p.words[0]!} size={small} color={C.taxi} style={{ textAlign: "left" }}>TAP A FLOOR.</Slam>
        <Slam at={p.words[1]!} size={small} color={C.taxi} style={{ textAlign: "left" }}>THE CROWD'S ODDS ON THE RIGHT.</Slam>
      </div>
    </BigPhone>
  );
}

/** "HOW SURE?" over the call: tight, medium, wide, and what each wins. */
function CallPhone(p: { at: number; words: number[] }) {
  const { tall } = useLay();
  const small = tall ? 54 : 34;
  return (
    <BigPhone shot="howCall" from={40} bg="floorWide" tilt={5}>
      <Slam at={p.at} size={tall ? 118 : 70} style={{ textAlign: "left" }}>HOW SURE?</Slam>
      <div style={{ marginTop: tall ? 24 : 12, display: "flex", flexDirection: "column", gap: tall ? 8 : 4 }}>
        <Slam at={p.words[0]!} size={small} color={C.taxi} style={{ textAlign: "left" }}>TIGHT: UP TO 3.2×.</Slam>
        <Slam at={p.words[1]!} size={small} color={C.taxi} style={{ textAlign: "left" }}>WIDE: SAFER, PAYS LESS.</Slam>
      </div>
    </BigPhone>
  );
}

/** The lock, a bar of silence, the bell on the beat's return, then how it paid: all on the How page's bell drawing. */
function BellPhone(p: { at: number; words: number[]; ring: number; pay: number[] }) {
  const f = useCurrentFrame(), { tall, W, H } = useLay();
  const t = f - p.ring, flash = t >= 0 && t < 6 ? 1 - t / 6 : 0;
  const shake = t >= 0 && t < 12 ? Math.round(Math.sin(t * 2.4) * (12 - t) * 1.6) : 0;
  const small = tall ? 54 : 34;
  return (
    <AbsoluteFill style={{ transform: `translate(${shake}px, ${-shake}px)` }}>
      <BigPhone shot="howBell" from={BELL_RUNG - p.ring} bgFrom={150} tilt={-4}>
        <Slam at={p.at} hold={p.ring} size={tall ? 150 : 90} style={{ textAlign: "left" }}>4:00 PM.</Slam>
        <Slam at={p.words[0]!} hold={p.ring - p.words[0]!} size={tall ? 118 : 70} color={C.taxi} style={{ textAlign: "left" }}>THE BELL.</Slam>
        <Slam at={p.words[1]!} hold={p.ring - p.words[1]!} size={small} color="#c9bfa4" style={{ textAlign: "left", marginTop: tall ? 20 : 10 }}>TRADING CLOSED. YOUR CALL RIDES.</Slam>
        <Slam at={p.ring} size={tall ? 190 : 110} color={C.taxi} style={{ textAlign: "left" }}>RANG.</Slam>
        <div style={{ marginTop: tall ? 20 : 10, display: "flex", flexDirection: "column", gap: tall ? 8 : 4 }}>
          <Slam at={p.pay[0]!} size={tall ? 66 : 40} style={{ textAlign: "left" }}>THE CLOSER YOU ARE,</Slam>
          <Slam at={p.pay[1]!} size={tall ? 66 : 40} color={C.taxi} style={{ textAlign: "left" }}>THE MORE IT PAYS.</Slam>
          <Slam at={p.pay[2]!} size={small} color="#c9bfa4" style={{ textAlign: "left" }}>{`PAID IN ${BRAND.coin.toUpperCase()}. ON CHAIN.`}</Slam>
        </div>
      </BigPhone>
      <AbsoluteFill style={{ background: "#fff7e0", opacity: flash * 0.85, pointerEvents: "none" }} />
      {t >= 0 && t < 40 && <AbsoluteFill style={{ background: `radial-gradient(circle at ${W / 2}px ${H * 0.5}px, rgba(240,168,58,${0.35 * Math.exp(-t / 10)}) 0%, rgba(0,0,0,0) 60%)`, pointerEvents: "none" }} />}
    </AbsoluteFill>
  );
}

// ── 5. the house, the listing ────────────────────────────────────────────────
function HousePhone(p: { at: number; pct: number; words: number }) {
  const { W, H, tall } = useLay();
  const w = tall ? 660 : 380, x = tall ? (W - w) / 2 - 150 : 50, y = tall ? H * 0.52 : H * 0.12;
  return (
    <AbsoluteFill style={{ background: BG, overflow: "hidden" }}>
      <Wide shot="houseWide" x={[0.9, 0.5]} zoom={[1.15, 1.25]} style={{ opacity: 0.4, filter: "blur(2px)" }} />
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(5,7,13,.92) 0%, rgba(5,7,13,.6) 50%, rgba(5,7,13,.2) 100%)" }} />
      <Phone shot="howHouse" w={w} x={x} y={y} at={0} tilt={12} />
      <div style={{ position: "absolute", left: tall ? 60 : 50, right: tall ? 60 : 50, top: tall ? H * 0.08 : H * 0.07, textAlign: "right" }}>
        <Slam at={p.at} size={tall ? 118 : 70} style={{ textAlign: "right" }}>{"OR BE\nTHE HOUSE."}</Slam>
        <div style={{ marginTop: tall ? 30 : 16, display: "flex", justifyContent: "flex-end", alignItems: "baseline", gap: tall ? 24 : 14 }}>
          <Slam at={p.words} size={tall ? 44 : 28} weight={700} color="#c9bfa4" style={{ textAlign: "right", letterSpacing: "0", textTransform: "none" }}>{"of every fee.\nnever more than you put in."}</Slam>
          <Count at={p.pct} to={90} suffix="%" size={tall ? 190 : 110} />
        </div>
      </div>
    </AbsoluteFill>
  );
}

function ListPhone(p: { at: number; seed: number }) {
  const { W, H, tall } = useLay();
  const w = tall ? 660 : 380, x = tall ? (W - w) / 2 + 150 : W - w - 50, y = tall ? H * 0.52 : H * 0.12;
  return (
    <AbsoluteFill style={{ background: BG, overflow: "hidden" }}>
      <Wide shot="city" x={[0.3, 0.1]} zoom={[1.2, 1.3]} from={60} style={{ opacity: 0.35, filter: "blur(2px)" }} />
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(5,7,13,.92) 0%, rgba(5,7,13,.6) 50%, rgba(5,7,13,.2) 100%)" }} />
      <Phone shot="list" w={w} x={x} y={y} at={0} tilt={-12} />
      <div style={{ position: "absolute", left: tall ? 60 : 50, right: tall ? 60 : 50, top: tall ? H * 0.08 : H * 0.07 }}>
        <Slam at={p.at} size={tall ? 118 : 70} style={{ textAlign: "left" }}>{"LIST\nYOUR COIN."}</Slam>
        <div style={{ marginTop: tall ? 30 : 16, display: "flex", flexDirection: "column", gap: tall ? 10 : 6 }}>
          <Count at={p.seed} to={200} prefix="$" size={tall ? 190 : 110} />
          <Slam at={p.seed + 2} size={tall ? 46 : 28} weight={700} color="#c9bfa4" style={{ letterSpacing: "0", textTransform: "none" }}>{"seeds a table. your community calls it."}</Slam>
        </div>
      </div>
    </AbsoluteFill>
  );
}

// ── the cut ──────────────────────────────────────────────────────────────────
/** Beats of the track (136 BPM, bar = 4; the drop on 24, the silent bar 88-92, the beat back on 92) each scene sits on. */
const B = {
  chat: 0, slam: 24, dawn: 32, floor: 40, tower: 48, call: 64, bell: 72, ring: 92, house: 100, list: 110, chat2: 118, end: 134,
};
const at = ST.at;

export function Street(p: AdProps) {
  const cuts = [B.slam, B.dawn, B.floor, B.tower, B.call, B.bell, B.house, B.list, B.chat2, B.end].map(at);
  const [slam, dawn, floor, tower, call, bell, house, list, chat2, end] = cuts as [number, number, number, number, number, number, number, number, number, number];
  const seg = (from: number, to: number) => ({ from, durationInFrames: to - from });
  const ring = at(B.ring);
  return (
    <AbsoluteFill style={{ background: BG }}>
      <Pulse beats={ST.beats} from={slam}>
        <Sequence {...seg(0, slam)}>
          <Chat name="Jay" dive={at(20)} glowAt={at(16)} msgs={[
            { at: at(2), in: true, typing: 30, text: "bro where's polymarket closing today" },
            { at: at(7), text: "no idea. 4pm?" },
            { at: at(12), in: true, typing: 34, text: "yeah. there's a street for that now" },
            { at: at(16.5), in: true, typing: 28, link: true },
          ]} />
        </Sequence>
        <Sequence {...seg(slam, dawn)}>
          <SlamStreet shot="city" x={[0.62, 0.45]} zoom={[1.02, 1.1]} words={[{ at: 0, text: "WHERE WILL\nIT CLOSE?" }, { at: at(28) - slam, text: "ONE QUESTION.", size: 92, color: C.taxi }, { at: at(30) - slam, text: "EVERY DAY.", size: 92, color: C.taxi }]} />
        </Sequence>
        <Sequence {...seg(dawn, floor)}>
          <SlamStreet shot="cityDawn" x={[0.3, 0.7]} zoom={[1.08, 1.0]} top={1180} words={[{ at: 0, text: "4 PM" }, { at: at(34) - dawn, text: "NEW YORK." }, { at: at(36) - dawn, text: "THE BELL.", color: C.taxi }]} />
        </Sequence>
        <Sequence {...seg(floor, tower)}>
          <FloorPhone at={0} names={[at(42), at(43.5), at(45), at(46.5)].map((x) => x - floor)} />
        </Sequence>
        <Sequence {...seg(tower, call)}>
          <TowerPhone at={0} words={[at(54) - tower, at(58) - tower]} />
        </Sequence>
        <Sequence {...seg(call, bell)}>
          <CallPhone at={0} words={[at(66) - call, at(69) - call]} />
        </Sequence>
        <Sequence {...seg(bell, house)}>
          <BellPhone at={0} words={[at(76) - bell, at(84) - bell]} ring={ring - bell} pay={[at(94), at(96), at(98)].map((x) => x - bell)} />
        </Sequence>
        <Sequence {...seg(house, list)}>
          <HousePhone at={0} pct={at(103) - house} words={at(105) - house} />
        </Sequence>
        <Sequence {...seg(list, chat2)}>
          <ListPhone at={0} seed={at(113) - list} />
        </Sequence>
        <Sequence {...seg(chat2, end)}>
          <Chat name="Jay" glowAt={0} msgs={[
            { at: at(119) - chat2, paid: true },
            { at: at(122) - chat2, in: true, typing: 20, text: "no way" },
            { at: at(125) - chat2, text: "called the floor. bell rang." },
            { at: at(128.5) - chat2, in: true, typing: 24, text: "ok im the house tomorrow" },
            { at: at(132) - chat2, text: "90% of the fees. see you at 4." },
          ]} />
        </Sequence>
        <Sequence from={end} durationInFrames={ST.total - end}><EndCard /></Sequence>
      </Pulse>
      {cuts.map((a) => <Cut key={a} at={a} />)}
      {[...cuts, ring].map((a) => <Glitch key={`g${a}`} at={a} />)}
      <Grain />
      <Sound track={p.track} length={ST.total} start={ST.start} fadeOut={ST.fadeOut} hits={[
        ["ping", at(2)], ["ping", at(12)], ["ping", at(16.5)], ["whoosh", at(20)], ["hit", slam],
        ["ding", at(54)], ["ding", at(58)], ["whoosh", bell], ["bell", ring],
        ["win", at(119)], ["ping", at(122)], ["ping", at(128.5)], ["whoosh", end],
      ]} />
    </AbsoluteFill>
  );
}

/** Small motion hits: the picture bumps on every beat after the drop. */
function Pulse(p: { beats: number[]; from: number; children: React.ReactNode }) {
  const f = useCurrentFrame();
  const last = p.beats.filter((b) => b <= f && b >= p.from).pop();
  const k = last === undefined ? 0 : Math.exp(-(f - last) / 3);
  return <AbsoluteFill style={{ transform: `scale(${1 + 0.014 * k})` }}>{p.children}</AbsoluteFill>;
}
