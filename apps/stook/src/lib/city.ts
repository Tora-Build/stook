// The street: one fixed pixel skyline, lit for night or day. Shared by the
// site (stooks.xyz) and the app; the layout comes from a seed so it is the
// same street everywhere. `t` is 0 at night and 1 by day, and any value in
// between is a moment of the sunrise/sunset the theme toggle plays.

interface Layout { gw: number; gh: number; ground: number; stars: [number, number, boolean][]; far: { x: number; w: number; h: number; win: [number, number][] }[]; near: { x: number; w: number; h: number; d: string; l: string; cap: boolean; win: [number, number, boolean][]; sign: number | null }[]; clouds: [number, number, number][] }

export function layout(gw: number, gh: number): Layout {
  let seed = 20260922; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const ground = gh - 8, stars: Layout["stars"] = [], far: Layout["far"] = [], near: Layout["near"] = [], clouds: Layout["clouds"] = [];
  for (let i = 0; i < (gw * gh) / 900; i++) stars.push([Math.floor(rnd() * gw), Math.floor(rnd() * gh * 0.55), rnd() > 0.8]);
  for (let x = 0; x < gw;) { const w = 6 + Math.floor(rnd() * 10), h = Math.floor(gh * (0.18 + rnd() * 0.28)); const win: [number, number][] = []; for (let wy = ground - h + 2; wy < ground - 2; wy += 3) for (let wx = x + 1; wx < x + w - 1; wx += 2) if (rnd() > 0.55) win.push([wx, wy]); far.push({ x, w, h, win }); x += w + Math.floor(rnd() * 3); }
  const pal = [["#7d2f22", "#a8412f"], ["#5a4a3a", "#8a7256"], ["#243a5e", "#2f4d7c"]] as const;
  for (let x = -2; x < gw;) { const w = 10 + Math.floor(rnd() * 16), h = Math.floor(gh * (0.28 + rnd() * 0.34)), p = pal[Math.floor(rnd() * pal.length)]!, cap = rnd() > 0.6; const win: [number, number, boolean][] = []; for (let wy = ground - h + 3; wy < ground - 3; wy += 4) for (let wx = x + 2; wx < x + w - 2; wx += 3) win.push([wx, wy, rnd() > 0.45]); const sign = w > 18 && rnd() > 0.5 ? ground - h + Math.floor(h * 0.35) : null; near.push({ x, w, h, d: p[0], l: p[1], cap, win, sign }); x += w + 1 + Math.floor(rnd() * 3); }
  for (let i = 0; i < Math.max(3, gw / 60); i++) clouds.push([Math.floor(rnd() * gw), 4 + Math.floor(rnd() * gh * 0.22), 8 + Math.floor(rnd() * 14)]);
  return { gw, gh, ground, stars, far, near, clouds };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const hex = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)] as const;
export const mix = (a: string, b: string, t: number) => { const A = hex(a), B = hex(b); return `rgb(${Math.round(lerp(A[0], B[0], t))},${Math.round(lerp(A[1], B[1], t))},${Math.round(lerp(A[2], B[2], t))})`; };

export function draw(ctx: CanvasRenderingContext2D, city: Layout, t: number, opts: { exchange?: boolean; taxi?: boolean } = {}) {
  const { gw, gh, ground, stars, far, near, clouds } = city;
  const px = (x: number, y: number, w: number, h: number, col: string) => { ctx.fillStyle = col; ctx.fillRect(x, y, w, h); };
  const night = ["#0b1120", "#0e1729", "#101a2e", "#132038", "#182642"], day = ["#8fc4ee", "#a6d1f2", "#bfdcf5", "#d6e8f7", "#ecf3f8"];
  for (let i = 0; i < 5; i++) px(0, Math.floor((gh * i) / 5), gw, Math.ceil(gh / 5) + 1, mix(night[i]!, day[i]!, t));
  ctx.globalAlpha = Math.max(0, 1 - t * 1.6); for (const [x, y, a] of stars) px(x, y, 1, 1, a ? "#f0a83a" : "#f4e9c8"); ctx.globalAlpha = 1;
  const moonY = Math.floor(lerp(10, gh * 0.62, t)), sunY = Math.floor(lerp(gh * 0.62, 8, t));
  px(gw - 28, moonY, 7, 7, "#f4e9c8"); px(gw - 27, moonY - 1, 5, 9, "#f4e9c8"); px(gw - 29, moonY + 1, 9, 5, "#f4e9c8"); px(gw - 25, moonY + 2, 3, 3, "#c9bfa4");
  px(gw - 30, sunY, 10, 10, "#f0a83a"); px(gw - 29, sunY - 1, 8, 12, "#f0a83a"); px(gw - 31, sunY + 1, 12, 8, "#f0a83a"); px(gw - 27, sunY + 2, 4, 4, "#f7c96e");
  for (const [dx, dy] of [[-3, 13], [12, 13], [4, -2], [4, 12], [-2, 3], [11, 3], [-2, 9], [11, 9]]) px(gw - 25 + dx!, sunY + dy!, 1, 1, "#f0a83a");
  ctx.globalAlpha = Math.max(0, (t - 0.4) * 1.6); for (const [x, y, w] of clouds) { px(x, y, w, 3, "#ffffff"); px(x + 2, y - 2, w - 4, 2, "#ffffff"); px(x + 1, y + 3, w - 2, 1, "#e6eef7"); } ctx.globalAlpha = 1;
  for (const b of far) { px(b.x, ground - b.h, b.w, b.h, mix("#1b2a47", "#6f86ad", t)); for (const [wx, wy] of b.win) px(wx, wy, 1, 1, "#3a4f7a"); }
  for (const b of near) {
    px(b.x, ground - b.h, b.w, b.h, b.d); px(b.x, ground - b.h, b.w, 1, b.l); px(b.x, ground - b.h, 1, b.h, b.l);
    if (b.cap) { px(b.x + 2, ground - b.h - 4, b.w - 4, 4, b.d); px(b.x + 2, ground - b.h - 4, b.w - 4, 1, b.l); }
    for (const [wx, wy, lit] of b.win) px(wx, wy, 2, 2, lit ? mix("#f0a83a", "#0b1120", t) : mix("#0b1120", "#3a4f7a", t));
    if (b.sign !== null) { px(b.x + 3, b.sign, b.w - 6, 5, "#0f7a4d"); px(b.x + 4, b.sign + 1, b.w - 8, 3, "#35c4c4"); }
  }
  if (opts.exchange !== false) {
    const ex = Math.floor(gw * 0.42), ew = Math.min(60, Math.floor(gw * 0.16)), eh = Math.floor(gh * 0.3);
    px(ex, ground - eh, ew, eh, "#c9bfa4"); px(ex - 2, ground - eh - 3, ew + 4, 4, "#f4e9c8"); px(ex + ew / 2 - 8, ground - eh - 9, 16, 6, "#f4e9c8");
    for (let cx = ex + 3; cx < ex + ew - 3; cx += 6) px(cx, ground - eh + 5, 3, eh - 8, "#8a8f99");
    px(ex + Math.floor(ew / 2) - 6, ground - eh + eh * 0.5, 12, 4, "#0f7a4d");
  }
  px(0, ground, gw, 8, "#2a2a30"); for (let x = 2; x < gw; x += 10) px(x, ground + 4, 5, 1, "#f0a83a");
  if (opts.taxi !== false) { const tx = Math.floor(gw * 0.2); px(tx, ground - 4, 10, 4, "#f0a83a"); px(tx + 2, ground - 6, 6, 2, "#f0a83a"); px(tx + 3, ground - 5, 4, 1, "#0b1120"); px(tx + 1, ground, 2, 2, "#0b1120"); px(tx + 7, ground, 2, 2, "#0b1120"); }
  const sx = Math.floor(gw * 0.72); px(sx, ground - 22, 1, 22, "#8a8f99"); px(sx - 9, ground - 27, 20, 6, "#f4e9c8"); px(sx - 8, ground - 26, 18, 4, "#0f7a4d");
}
