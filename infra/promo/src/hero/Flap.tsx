// The departures board of the exchange: a split-flap (Solari) board flips in
// the four tables, each a memecoin and what it plays. Each row starts on its
// beat (a flap sound slot, if a sound is dropped in), letters riffle, land.
import { AbsoluteFill, Img, interpolate, random, staticFile, useCurrentFrame } from "remotion";
import { C, PX, Rise, Shout, TABLES, useLay } from "../Ad";
import { Skyline } from "../Skyline";

const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789$&";
const N = 20; // cells a row: "$STOOK PLAYS S&P 500"

function Cell(p: { ch: string; start: number; i: number; w: number; h: number }) {
  const f = useCurrentFrame(), t = f - p.start, flips = 5 + Math.floor(random(`n${p.i}`) * 4);
  const settled = p.ch === " " || t >= flips * 2;
  const shown = t < 0 ? " " : settled ? p.ch : CHARS[Math.floor(random(`c${p.i}-${Math.floor(t / 2)}`) * CHARS.length)]!;
  const squash = !settled && t >= 0 && t % 2 === 0 ? 0.55 : 1;
  return (
    <div style={{ width: p.w, height: p.h, position: "relative", background: "#1b1c22", borderRadius: 4, boxShadow: "inset 0 0 0 2px #0c0d10, 0 3px 0 #000", overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: PX, fontSize: p.h * 0.5, color: shown === "$" || /\d/.test(shown) ? C.taxi : "#f1ead2", transform: `scaleY(${squash})` }}>{shown}</div>
      <div style={{ position: "absolute", left: 0, right: 0, top: "50%", height: 2, background: "#0c0d10", boxShadow: "0 1px 0 rgba(255,255,255,.06)" }} />
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: "50%", background: "rgba(0,0,0,.18)" }} />
    </div>
  );
}

export function Flap(p: { rows: number[] }) {
  const f = useCurrentFrame(), { W, H, tall } = useLay();
  // a tall board gives each table two rows (the coin, what it plays) in bigger cells
  const n = tall ? 13 : N, cw = tall ? 62 : 38, ch = tall ? 92 : 58, gap = tall ? 5 : 4, logo = tall ? 92 : 58;
  const text = TABLES.map((t) => tall ? [t.coin.padEnd(n), `PLAYS ${t.anchor.toUpperCase()}`.padEnd(n)] : [`${t.coin.padEnd(7)}PLAYS ${t.anchor.toUpperCase()}`.padEnd(n).slice(0, n)]);
  const push = interpolate(f, [0, 100], [1, 1.05]);
  return (
    <AbsoluteFill style={{ background: C.ink, overflow: "hidden" }}>
      <Skyline width={W} height={H} scale={6} style={{ opacity: 0.35 }} />
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at 50% 45%, rgba(11,17,32,.4) 0%, rgba(11,17,32,.92) 75%)" }} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: tall ? 70 : 40, transform: `scale(${push})` }}>
        <Rise at={0} style={{ textAlign: "center" }}><Shout size={tall ? 54 : 42}>TODAY'S<span style={{ color: C.taxi }}> TABLES</span></Shout></Rise>
        {/* the board in its brass frame */}
        <div style={{ padding: tall ? "30px 26px" : "24px 22px", background: "#0c0d10", border: "8px solid #8a6824", boxShadow: "inset 0 0 0 4px #3a2a10, 14px 14px 0 rgba(0,0,0,.6)", display: "flex", flexDirection: "column", gap: tall ? 18 : 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontFamily: PX, fontSize: tall ? 16 : 14, color: "#b8a070", padding: "0 4px 4px" }}><span>STOOK STREET EXCHANGE</span><span>BELL 4:00 PM</span></div>
          {text.map((lines, r) => lines.map((row, l) => (
            <div key={`${r}-${l}`} style={{ display: "flex", alignItems: "center", gap: 12, marginTop: tall && l === 0 && r > 0 ? 18 : 0 }}>
              <div style={{ width: logo, height: logo, position: "relative", opacity: l ? 0 : interpolate(f, [p.rows[r]! - 2, p.rows[r]! + 6], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
                <Img src={staticFile(TABLES[r]!.logo)} style={{ width: "100%", height: "100%", borderRadius: 6, border: `3px solid ${C.cream}`, objectFit: "cover", background: C.ink }} />
              </div>
              <div style={{ display: "flex", gap }}>
                {[...row].map((c, i) => <Cell key={i} ch={c} start={(p.rows[r] ?? 0) + (l * n + i) * 0.6} i={r * 100 + l * 50 + i} w={cw} h={ch} />)}
              </div>
            </div>
          )))}
        </div>
        <Rise at={(p.rows[3] ?? 30) + 14} style={{ textAlign: "center" }}>
          <div style={{ fontFamily: PX, fontSize: tall ? 30 : 24, color: C.cream2 }}>MEMECOINS ANCHORED TO STOCKS</div>
        </Rise>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
