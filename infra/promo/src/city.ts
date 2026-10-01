// The street's skyline, ported from apps/stook/public/city.js so the ad uses
// the site's own art: the same seed, the same buildings, the exchange, the
// flags, the bull, the cars. Deterministic in time (no random strobes), so a
// frame renders the same every time Remotion asks for it.
type Px = (x: number, y: number, w: number, h: number, col: string) => void;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const hex = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a: string, b: string, t: number) => { const A = hex(a), B = hex(b); return `rgb(${Math.round(lerp(A[0]!, B[0]!, t))},${Math.round(lerp(A[1]!, B[1]!, t))},${Math.round(lerp(A[2]!, B[2]!, t))})`; };
const NIGHT = ["#0b1120", "#0e1729", "#101a2e", "#132038", "#182642"], DAY = ["#8fc4ee", "#a6d1f2", "#bfdcf5", "#d6e8f7", "#ecf3f8"];
const FONT: Record<string, string[]> = { S: ["111", "100", "111", "001", "111"], T: ["111", "010", "010", "010", "010"], O: ["111", "101", "101", "101", "111"], K: ["101", "101", "110", "101", "101"], R: ["110", "101", "110", "101", "101"], E: ["111", "100", "110", "100", "111"], X: ["101", "101", "010", "101", "101"], C: ["111", "100", "100", "100", "111"], H: ["101", "101", "111", "101", "101"], A: ["010", "101", "111", "101", "101"], N: ["101", "111", "111", "101", "101"], G: ["111", "100", "101", "101", "111"], " ": ["000", "000", "000", "000", "000"] };

interface Building { x: number; w: number; h: number; d: string; l: string; cap: boolean; win: [number, number, boolean][]; sign: number | null }
export interface City { gw: number; gh: number; ground: number; stars: [number, number, boolean][]; far: { x: number; w: number; h: number; win: [number, number][] }[]; near: Building[]; cars: { x: number; dir: number; v: number; col: string; taxi: boolean }[] }

export function layout(gw: number, gh: number): City {
  let seed = 20260922; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const ground = gh - 8, stars: City["stars"] = [], far: City["far"] = [], near: Building[] = [];
  for (let i = 0; i < (gw * gh) / 900; i++) stars.push([Math.floor(rnd() * gw), Math.floor(rnd() * gh * 0.55), rnd() > 0.8]);
  for (let x = 0; x < gw;) { const w = 6 + Math.floor(rnd() * 10), h = Math.floor(gh * (0.18 + rnd() * 0.28)); const win: [number, number][] = []; for (let wy = ground - h + 2; wy < ground - 2; wy += 3) for (let wx = x + 1; wx < x + w - 1; wx += 2) if (rnd() > 0.55) win.push([wx, wy]); far.push({ x, w, h, win }); x += w + Math.floor(rnd() * 3); }
  const pal = [["#7d2f22", "#a8412f"], ["#5a4a3a", "#8a7256"], ["#243a5e", "#2f4d7c"]];
  for (let x = -2; x < gw;) { const w = 10 + Math.floor(rnd() * 16), h = Math.floor(gh * (0.28 + rnd() * 0.34)), p = pal[Math.floor(rnd() * pal.length)]!, cap = rnd() > 0.6; const win: Building["win"] = []; for (let wy = ground - h + 3; wy < ground - 3; wy += 4) for (let wx = x + 2; wx < x + w - 2; wx += 3) win.push([wx, wy, rnd() > 0.45]); const sign = w > 18 && rnd() > 0.5 ? ground - h + Math.floor(h * 0.35) : null; rnd(); near.push({ x, w, h, d: p[0]!, l: p[1]!, cap, win, sign }); x += w + 1 + Math.floor(rnd() * 3); }
  for (let i = 0; i < Math.max(3, gw / 60); i++) { rnd(); rnd(); rnd(); }
  const cars: City["cars"] = []; for (let i = 0; i < 5; i++) cars.push({ x: rnd() * gw, dir: i % 2 ? 1 : -1, v: 26 + rnd() * 22, col: rnd() > 0.5 ? "#f0a83a" : ["#c9bfa4", "#2f4d7c", "#7d2f22"][Math.floor(rnd() * 3)]!, taxi: rnd() > 0.5 });
  return { gw, gh, ground, stars, far, near, cars };
}

/** Draws the street at `sec` seconds. `fine` is a 2× canvas for lettering. */
export function draw(ctx: CanvasRenderingContext2D, fine: CanvasRenderingContext2D | null, c: City, sec: number, opts: { exchange?: boolean; lit?: number } = {}) {
  const { gw, gh, ground, stars, far, near, cars } = c, t = 0, now = sec * 1000, lit = opts.lit ?? 1;
  const px: Px = (x, y, w, h, col) => { ctx.fillStyle = col; ctx.fillRect(Math.round(x), Math.round(y), w, h); };
  const ftext = (x: number, y: number, str: string, col: string) => { if (!fine) return 0; let cx = x * 2; for (const ch of str.toUpperCase()) { const g = FONT[ch] ?? FONT[" "]!; for (let r = 0; r < 5; r++) for (let cc = 0; cc < 3; cc++) if (g[r]![cc] === "1") { fine.fillStyle = col; fine.fillRect(cx + cc, y * 2 + r, 1, 1); } cx += 4; } return (cx - x * 2) / 2; };
  if (fine) fine.clearRect(0, 0, fine.canvas.width, fine.canvas.height);
  for (let i = 0; i < 5; i++) px(0, Math.floor((gh * i) / 5), gw, Math.ceil(gh / 5) + 1, mix(NIGHT[i]!, DAY[i]!, t));
  for (const [x, y, a] of stars) { if (a && Math.floor(now / 700 + x) % 5 === 0) continue; if (!a && Math.floor(now / 450 + x * 7) % 11 === 0) continue; px(x, y, 1, 1, a ? "#f0a83a" : "#f4e9c8"); }
  const moonY = 10; px(gw - 28, moonY, 7, 7, "#f4e9c8"); px(gw - 27, moonY - 1, 5, 9, "#f4e9c8"); px(gw - 29, moonY + 1, 9, 5, "#f4e9c8"); px(gw - 25, moonY + 2, 3, 3, "#c9bfa4");
  for (const b of far) { px(b.x, ground - b.h, b.w, b.h, "#1b2a47"); for (const [wx, wy] of b.win) px(wx, wy, 1, 1, "#3a4f7a"); }
  for (const b of near) {
    px(b.x, ground - b.h, b.w, b.h, b.d); px(b.x, ground - b.h, b.w, 1, b.l); px(b.x, ground - b.h, 1, b.h, b.l);
    if (b.cap) { px(b.x + 2, ground - b.h - 4, b.w - 4, 4, b.d); px(b.x + 2, ground - b.h - 4, b.w - 4, 1, b.l); }
    // windows light up from the street upward as `lit` runs 0 → 1
    for (const w of b.win) { const on = w[2] && (ground - w[1]) / gh < lit * 0.9; px(w[0], w[1], 2, 2, on ? "#f0a83a" : "#0b1120"); }
    if (b.sign !== null) { px(b.x + 3, b.sign, b.w - 6, 5, "#0e7449"); px(b.x + 4, b.sign + 1, b.w - 8, 3, "#35c4c4"); }
  }
  if (opts.exchange !== false) {
    const ex = Math.floor(gw * 0.42), ew = Math.min(60, Math.floor(gw * 0.16)), eh = Math.floor(gh * 0.3);
    px(ex, ground - eh, ew, eh, "#c9bfa4"); px(ex - 2, ground - eh - 3, ew + 4, 4, "#f4e9c8"); px(ex + ew / 2 - 8, ground - eh - 9, 16, 6, "#f4e9c8");
    for (let cx = ex + 3; cx < ex + ew - 3; cx += 6) px(cx, ground - eh + 5, 3, eh - 8, "#8a8f99");
    const name = "STOOK ST EXCHANGE", nw = (name.length * 4 - 1) / 2, ny = ground - eh + 1;
    px(ex + Math.floor((ew - nw) / 2) - 1, ny - 1, Math.ceil(nw) + 2, 4, "#5a4a3a"); ftext(ex + Math.floor((ew - nw) / 2), ny, name, "#f4e9c8");
    for (let i = 0; i < 3; i++) {
      const fx = ex + 6 + i * Math.floor((ew - 12) / 2); px(fx, ground - eh - 12, 1, 10, "#8a8f99");
      for (let cc = 0; cc < 7; cc++) { const lift = Math.round(Math.sin(now / 120 - cc * 0.9 + i) * (cc / 7) * 1.4); const x = fx + 1 + cc, y = ground - eh - 12 + lift; for (let r = 0; r < 4; r++) px(x, y + r, 1, 1, cc < 3 && r < 2 ? ((cc + r) % 2 ? "#f4e9c8" : "#2f4d7c") : r % 2 ? "#f4e9c8" : "#a8412f"); }
    }
    const bx = Math.floor(gw * 0.3), by = ground, bc = "#3a3f4c";
    px(bx, by - 5, 9, 4, bc); px(bx + 8, by - 7, 4, 4, bc); px(bx + 11, by - 8, 1, 1, bc); px(bx + 12, by - 8, 1, 1, bc); px(bx + 1, by - 1, 1, 1, bc); px(bx + 3, by - 1, 1, 1, bc); px(bx + 6, by - 1, 1, 1, bc); px(bx + 8, by - 1, 1, 1, bc); px(bx - 1, by - 6, 1, 2, bc); px(bx + 9, by - 6, 1, 1, "#0b1120");
    const hx = Math.floor(gw * 0.6); px(hx, ground - 4, 6, 3, "#f4e9c8"); px(hx - 1, ground - 6, 8, 2, "#a8412f"); px(hx + 1, ground - 1, 1, 1, "#0b1120"); px(hx + 4, ground - 1, 1, 1, "#0b1120");
  }
  px(0, ground, gw, 8, "#2a2a30"); for (let x = 2; x < gw; x += 10) px(x, ground + 4, 5, 1, "#f0a83a");
  // steam from the manhole: a puff every 0.6 s, each rising for 3 s
  const mx = Math.floor(gw * 0.52);
  for (let k = 0; k < 5; k++) { const age = ((sec + k * 0.6) % 3); px(mx + Math.round(Math.sin(age * 3)), ground - age * 3, 2, 2, `rgba(244,233,200,${Math.max(0, 0.5 - age * 0.16)})`); }
  // cars: the far lane first, so a nearer car passes in front
  for (const car of [...cars].sort((a, b) => b.dir - a.dir)) {
    const span = gw + 24, x = Math.round((((car.x + car.dir * car.v * sec) % span) + span) % span) - 12, y = ground + (car.dir > 0 ? 1 : 5);
    px(x, y - 2, 10, 3, car.col); px(x + 2, y - 4, 6, 2, car.col); px(x + 3, y - 3, 4, 1, "#0b1120"); px(x + 1, y + 1, 2, 1, "#0b1120"); px(x + 7, y + 1, 2, 1, "#0b1120"); px(car.dir > 0 ? x + 9 : x, y - 1, 1, 1, "#fff6c9"); if (car.taxi) px(x + 4, y - 5, 2, 1, "#f0a83a");
  }
  const sx = Math.floor(gw * 0.72); px(sx, ground - 11, 1, 11, "#8a8f99");
  px(sx - 8, ground - 15, 17, 5, "#f4e9c8"); px(sx - 7, ground - 14, 15, 3, "#0e7449");
  const w = ftext(sx - 6.5, ground - 14, "STOOK", "#f4e9c8"); ftext(sx - 6.5 + w + 0.5, ground - 13, "ST", "#f4e9c8");
}
