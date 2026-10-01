// "Or be the house": a wall calendar tears off a page on each beat until it
// lands on a day, which gets a FUNDED stamp; beside it, fees from the floor's
// traders flow as coins into the house, and 90% of every fee is theirs.
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, MONO, PX, Rise, SANS, Shout, useLay } from "../Ad";
import { Pixel } from "../pixel";

const DOW = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const COIN = ["..aaa..", ".abbba.", "abcbbba", "abbbbba", "abbbbba", ".abbba.", "..aaa.."];
const COINPAL = { a: "#8a5a12", b: "#f0a83a", c: "#ffe28a" };
// the house, in pixels: a pediment, columns, a door
const HOUSE = ["......pppp......", "....pppppppp....", "..pppppppppppp..", "pppppppppppppppp", "ssssssssssssssss", ".c.c.c.cc.c.c.c.", ".c.c.c.cc.c.c.c.", ".c.c.c.cc.c.c.c.", ".c.c.cddddc.c.c.", ".c.c.cddddc.c.c.", ".c.c.cddddc.c.c.", "ssssssssssssssss", "gggggggggggggggg"];
const HOUSEPAL = { p: "#f4e9c8", s: "#c9bfa4", c: "#8a8f99", d: "#0e7449", g: "#5a4a3a" };

function Page(p: { day: number; w: number; h: number; tear?: number; stamp?: number }) {
  const t = p.tear ?? 0;
  return (
    <div style={{ position: "absolute", inset: 0, transformOrigin: "50% 0%", transform: `perspective(1400px) rotateX(${t * 105}deg) translateY(${t * 30}px)`, opacity: t > 0.85 ? 0 : 1 }}>
      <div style={{ position: "absolute", inset: 0, background: "#f4e9c8", border: "6px solid #0b1120", boxShadow: "inset 0 -10px 0 #e2d6b0", display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ width: "100%", height: p.h * 0.2, background: C.brick, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: PX, fontSize: p.h * 0.08, color: C.cream, borderBottom: "6px solid #0b1120" }}>OCT</div>
        <div style={{ fontFamily: PX, fontSize: p.h * 0.36, color: "#0b1120", marginTop: p.h * 0.1, lineHeight: 1 }}>{p.day}</div>
        <div style={{ fontFamily: PX, fontSize: p.h * 0.065, color: "#5b5446", marginTop: p.h * 0.06 }}>{DOW[(p.day + 2) % 7]}</div>
      </div>
      {p.stamp !== undefined && p.stamp > 0 && <div style={{ position: "absolute", left: "50%", top: "55%", transform: `translate(-50%, -50%) rotate(-12deg) scale(${interpolate(p.stamp, [0, 1], [2.4, 1])})`, opacity: Math.min(1, p.stamp * 2), border: `8px double ${C.green}`, color: C.green, background: "rgba(244,233,200,.85)", fontFamily: PX, fontSize: p.h * 0.1, padding: "10px 18px" }}>FUNDED</div>}
    </div>
  );
}

export function HouseScene(p: { pages: number[]; fundedAt: number }) {
  const f = useCurrentFrame(), { fps } = useVideoConfig(), { tall } = useLay();
  const w = tall ? 520 : 400, h = tall ? 600 : 460;
  // which page is on top: one tears off on each beat in `pages`
  const torn = p.pages.filter((b) => f >= b).length, day = 2 + torn;
  const last = p.pages[torn - 1], tear = last !== undefined ? interpolate(f - last, [0, 7], [0, 1], { extrapolateRight: "clamp", easing: Easing.in(Easing.quad) }) : 1;
  const stamp = spring({ frame: f - p.fundedAt, fps, config: { damping: 9, stiffness: 260, mass: 0.7 } });
  const calendar = (
    <div style={{ position: "relative", width: w, height: h + 30 }}>
      {/* the binder bar and rings */}
      <div style={{ position: "absolute", left: -10, right: -10, top: 0, height: 34, background: "#3a3f4c", border: "5px solid #0b1120", zIndex: 3 }} />
      {[0.2, 0.4, 0.6, 0.8].map((u) => <div key={u} style={{ position: "absolute", left: w * u - 9, top: -14, width: 18, height: 42, borderRadius: 9, background: "#c9bfa4", border: "4px solid #0b1120", zIndex: 4 }} />)}
      <div style={{ position: "absolute", left: 0, top: 30, width: w, height: h, boxShadow: `14px 14px 0 ${C.brick2}` }}>
        <Page day={day} w={w} h={h} stamp={f >= p.fundedAt ? stamp : undefined} />
        {last !== undefined && tear < 1 && <Page day={day - 1} w={w} h={h} tear={tear} />}
      </div>
    </div>
  );
  // fees: coins hop from the floor into the house, nine in ten land
  const flowW = tall ? 860 : 480, flowH = tall ? 420 : 470;
  const flow = (
    <div style={{ position: "relative", width: flowW, height: flowH }}>
      <div style={{ position: "absolute", left: 0, top: tall ? 130 : 160, fontFamily: PX, fontSize: tall ? 22 : 18, color: C.cream2, lineHeight: 1.6 }}>TRADERS'<br />FEES</div>
      <div style={{ position: "absolute", right: 0, bottom: 0 }}><Pixel map={HOUSE} pal={HOUSEPAL} s={tall ? 16 : 14} /></div>
      {Array.from({ length: 10 }, (_, i) => {
        const t = ((f + i * 9) % 90) / 90, x0 = tall ? 130 : 110, x1 = flowW - (tall ? 140 : 120), y0 = tall ? 160 : 190, y1 = flowH - (tall ? 120 : 110);
        const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t - Math.sin(t * Math.PI) * 120;
        return <div key={i} style={{ position: "absolute", left: x, top: y, opacity: t < 0.08 || t > 0.92 ? 0 : 1 }}><Pixel map={COIN} pal={COINPAL} s={tall ? 7 : 6} /></div>;
      })}
    </div>
  );
  const ninety = spring({ frame: f - (p.pages[2] ?? 30), fps, config: { damping: 10, stiffness: 200 } });
  const share = (
    <div style={{ display: "flex", alignItems: "baseline", gap: 18, transform: `scale(${ninety})`, transformOrigin: "left center" }}>
      <span style={{ fontFamily: PX, fontSize: tall ? 120 : 92, color: C.taxi, textShadow: `8px 8px 0 ${C.brick2}` }}>90%</span>
      <span style={{ fontFamily: SANS, fontWeight: 600, fontSize: tall ? 40 : 32, color: C.cream, lineHeight: 1.25 }}>of every fee<br />goes to the house</span>
    </div>
  );
  return (
    <AbsoluteFill style={{ background: "#0e1729", overflow: "hidden" }}>
      <AbsoluteFill style={{ background: "repeating-linear-gradient(90deg, #101a2e 0 60px, #0e1729 60px 120px)" }} />
      <AbsoluteFill style={{ borderTop: `10px solid ${C.green}`, borderBottom: `10px solid ${C.green}` }} />
      <Rise at={0} style={{ position: "absolute", left: 0, right: 0, top: tall ? 140 : 60, textAlign: "center" }}>
        <Shout size={tall ? 66 : 52}>OR BE THE <span style={{ color: C.good }}>HOUSE</span></Shout>
        <div style={{ fontFamily: SANS, fontWeight: 600, fontSize: tall ? 36 : 28, color: C.cream2, marginTop: 12 }}>Fund a day's pool. Earn from every call on it.</div>
      </Rise>
      {tall ? (
        <div style={{ position: "absolute", left: 0, right: 0, top: 440, display: "flex", flexDirection: "column", alignItems: "center", gap: 60 }}>
          {calendar}
          <div style={{ width: flowW }}>{share}</div>
          {flow}
        </div>
      ) : (
        <div style={{ position: "absolute", left: 60, right: 60, top: 270, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          {calendar}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>{share}{flow}</div>
        </div>
      )}
    </AbsoluteFill>
  );
}
