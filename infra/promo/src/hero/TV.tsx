// The cold open: a 1970s TV set in a wood cabinet switches on to a broadcast,
// "STOOK STREET — LIVE FROM THE FLOOR", ticker tape running across the bottom
// of the screen and a paper tape streaming past in front; then the camera
// dives through the glass into the night street.
import { AbsoluteFill, Easing, interpolate, random, useCurrentFrame, useVideoConfig } from "remotion";
import { C, Explainer, MONO, PX, useLay } from "../Ad";
import { Skyline } from "../Skyline";

const TAPE = "$STOOK ▲ S&P 500   $ZCAT ▼ ZCASH   $KNOTS ▲ STONK   $GP ▲ GOLD   BELL 4:00 PM NEW YORK   WHERE WILL IT LAND?   ";

// the lower third, one line a bar, building up to the drop
const LOWER = ["LIVE FROM THE FLOOR", "ONE QUESTION A DAY", "WHERE DOES IT CLOSE?", "BELL AT 4 PM NEW YORK"];

export function TV(p: { bars?: number[] }) {
  const f = useCurrentFrame(), { durationInFrames: D } = useVideoConfig(), { W, H, tall } = useLay();
  // geometry: the screen sits left with knobs right (square), or above the knobs (tall)
  const scrW = tall ? 880 : 700, scrH = tall ? 900 : 520, cabPad = 46;
  const cabW = tall ? scrW + cabPad * 2 : scrW + cabPad * 2 + 170, cabH = tall ? scrH + cabPad * 2 + 200 : scrH + cabPad * 2;
  const cabX = (W - cabW) / 2, cabY = (H - cabH) / 2 - (tall ? 60 : 30), scrX = cabX + cabPad, scrY = cabY + cabPad;
  // the dive: the last 30 frames push into the screen's centre
  const diveLen = Math.min(30, Math.round(D * 0.3)), diveFrom = D - diveLen, dive = interpolate(f, [diveFrom, D], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.in(Easing.cubic) });
  // a long open creeps toward the set, then dives through the glass on the drop
  const creep = interpolate(f, [0, diveFrom], [1, D > 120 ? 1.12 : 1], { extrapolateRight: "clamp" });
  const zoom = creep * (1 + dive * 9), ox = scrX + scrW / 2, oy = scrY + scrH / 2;
  const line = LOWER[Math.min(LOWER.length - 1, (p.bars ?? []).filter((b) => f >= b).length)]!;
  const lineAt = Math.max(0, ...(p.bars ?? []).filter((b) => f >= b)), lineIn = interpolate(f - lineAt, [0, 6], [0, 1], { extrapolateRight: "clamp" });
  // switching on: a bright line opens into the picture
  const on = 1; // on from the first frame: it is the thumbnail
  const flicker = 0.93 + random(`fl${f}`) * 0.07;
  const live = Math.floor(f / 8) % 2 === 0;
  const title = 1;
  const tapeX = -((f * 9) % 1400);
  return (
    <AbsoluteFill style={{ background: "#120c08", overflow: "hidden" }}>
      {/* the den: wallpaper stripes, a floor */}
      <AbsoluteFill style={{ background: "repeating-linear-gradient(90deg, #2a1a10 0 34px, #23160d 34px 68px)" }} />
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: H * 0.22, background: "repeating-linear-gradient(90deg, #3b2414 0 120px, #34200f 120px 240px)", borderTop: "8px solid #1a0f08" }} />
      <AbsoluteFill style={{ transform: `scale(${zoom})`, transformOrigin: `${ox}px ${oy}px` }}>
        {/* the cabinet */}
        <div style={{ position: "absolute", left: cabX, top: cabY, width: cabW, height: cabH, borderRadius: 34, background: "repeating-linear-gradient(90deg, #6b4425 0 14px, #61391d 14px 22px, #6e4728 22px 40px)", boxShadow: "inset 0 0 0 8px #3a2414, 14px 14px 0 #0a0604" }} />
        {/* legs */}
        {[0.12, 0.88].map((u) => <div key={u} style={{ position: "absolute", left: cabX + cabW * u - 14, top: cabY + cabH - 4, width: 28, height: 70, background: "#3a2414" }} />)}
        {/* knobs and the speaker grille */}
        <div style={{ position: "absolute", left: tall ? cabX + cabPad : cabX + cabW - 170 + 20, top: tall ? scrY + scrH + 40 : scrY + 10, width: tall ? scrW : 120, display: "flex", flexDirection: tall ? "row" : "column", alignItems: "center", gap: tall ? 60 : 34, justifyContent: "center" }}>
          {[0, 1].map((k) => <div key={k} style={{ width: 86, height: 86, borderRadius: "50%", background: "radial-gradient(circle at 35% 35%, #d9c08a, #8a6824 70%)", boxShadow: "0 0 0 6px #2a1a10", transform: `rotate(${k ? 40 : -20}deg)`, display: "flex", justifyContent: "center" }}><div style={{ width: 8, height: 34, background: "#2a1a10" }} /></div>)}
          <div style={{ width: tall ? 300 : 110, height: tall ? 90 : 180, background: "repeating-linear-gradient(0deg, #2a1a10 0 6px, #4b2f19 6px 12px)", borderRadius: 10 }} />
        </div>
        {/* the screen */}
        <div style={{ position: "absolute", left: scrX, top: scrY, width: scrW, height: scrH, borderRadius: 60, overflow: "hidden", background: "#05070d", boxShadow: "0 0 0 10px #1c120b, inset 0 0 60px rgba(0,0,0,.8)" }}>
          <div style={{ position: "absolute", inset: 0, transform: `scaleY(${Math.max(0.004, on)})`, opacity: flicker }}>
            <Skyline width={scrW} height={scrH} scale={4} lit={1} style={{ opacity: 0.85 }} />
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(5,7,13,.75) 0%, rgba(5,7,13,.1) 55%)" }} />
            {/* the broadcast */}
            <div style={{ position: "absolute", left: 30, top: 26, display: "flex", alignItems: "center", gap: 12, fontFamily: PX, fontSize: 18, color: C.cream }}>
              <div style={{ width: 18, height: 18, borderRadius: "50%", background: live ? "#e0302a" : "#5a1512", boxShadow: live ? "0 0 12px #e0302a" : "none" }} />LIVE
            </div>
            <div style={{ position: "absolute", right: 34, top: 26, fontFamily: PX, fontSize: 18, color: C.taxi }}>CH 4</div>
            <div style={{ position: "absolute", left: 0, right: 0, top: scrH * 0.2, textAlign: "center", opacity: title, transform: `scale(${interpolate(title, [0, 1], [1.3, 1])})` }}>
              <div style={{ fontFamily: PX, fontSize: tall ? 66 : 54, color: C.cream, textShadow: `-3px 0 rgba(255,40,40,.65), 3px 0 rgba(40,220,255,.55), 5px 5px 0 ${C.brick2}` }}>STOOK<br />STREET</div>
              <div style={{ marginTop: 20, display: "inline-block", fontFamily: PX, fontSize: tall ? 26 : 20, color: C.ink, background: C.taxi, padding: "8px 14px", textShadow: "-2px 0 rgba(255,40,40,.4)", transform: `scaleX(${lineIn})` }}>{line}</div>
            </div>
            {/* the ticker along the bottom of the picture */}
            <div style={{ position: "absolute", left: 0, right: 0, bottom: 22, height: 44, background: "#050608", borderTop: "3px solid #3a2622", borderBottom: "3px solid #3a2622", overflow: "hidden", whiteSpace: "nowrap" }}>
              <div style={{ transform: `translateX(${-((f * 7) % 1600)}px)`, fontFamily: MONO, fontWeight: 600, fontSize: 24, lineHeight: "38px", color: "#ffb13b", textShadow: "0 0 6px rgba(255,160,40,.6)" }}>{TAPE + TAPE + TAPE}</div>
            </div>
            {/* glass: scanlines, a curve of light, the vignette */}
            <div style={{ position: "absolute", inset: 0, background: "repeating-linear-gradient(0deg, rgba(0,0,0,.28) 0 2px, transparent 2px 4px)" }} />
            <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at 30% 20%, rgba(255,255,255,.12) 0%, rgba(255,255,255,0) 40%), radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0) 55%, rgba(0,0,0,.6) 100%)" }} />
          </div>
          {on < 1 && <div style={{ position: "absolute", left: 0, right: 0, top: scrH / 2 - 2, height: 4, background: "#fff", boxShadow: "0 0 30px #fff", opacity: 1 - on }} />}
        </div>
      </AbsoluteFill>
      {f < diveFrom + 6 && <div style={{ opacity: 1 - dive * 3 }}><Explainer top={tall ? 1640 : 56} size={tall ? 46 : 34} /></div>}
      {/* paper ticker tape streaming past in front of the set */}
      <div style={{ position: "absolute", left: -100, right: -100, top: tall ? H * 0.8 : H * 0.84, height: 58, transform: `rotate(-4deg) scale(${1 + dive * 2})`, transformOrigin: "50% 50%", background: "#efe6cc", boxShadow: "0 6px 0 rgba(0,0,0,.35)", overflow: "hidden", whiteSpace: "nowrap", opacity: 1 - dive }}>
        <div style={{ transform: `translateX(${tapeX}px)`, fontFamily: MONO, fontWeight: 700, fontSize: 28, lineHeight: "58px", color: "#2a1a10", letterSpacing: "0.04em" }}>{TAPE + TAPE + TAPE}</div>
        <div style={{ position: "absolute", left: 0, right: 0, top: 4, height: 4, background: "repeating-linear-gradient(90deg, #b8ab84 0 6px, transparent 6px 16px)" }} />
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 4, height: 4, background: "repeating-linear-gradient(90deg, #b8ab84 0 6px, transparent 6px 16px)" }} />
      </div>
    </AbsoluteFill>
  );
}
