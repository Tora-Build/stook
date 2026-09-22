// Stook Street, the skyline. One fixed layout from a seed — the same street
// on every page, every visit — lit for night or day and alive in the small
// ways a street is: windows flicker on and off at night, taxis and cars pass
// on the avenue, steam rises from a manhole, a ticker crawls across one
// tower, flags hang on the exchange. Drawn on a low-resolution canvas so a
// pixel is a pixel. `t` runs 0 (night) → 1 (day); the theme toggle tweens it.
//
//   StookCity.mount(canvas, { hero: true, t: () => 0..1 })  → unmount fn
(function () {
  const lerp = (a, b, t) => a + (b - a) * t;
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const mix = (a, b, t) => { const A = hex(a), B = hex(b); return `rgb(${Math.round(lerp(A[0], B[0], t))},${Math.round(lerp(A[1], B[1], t))},${Math.round(lerp(A[2], B[2], t))})`; };
  const NIGHT = ["#0b1120", "#0e1729", "#101a2e", "#132038", "#182642"], DAY = ["#8fc4ee", "#a6d1f2", "#bfdcf5", "#d6e8f7", "#ecf3f8"];
  // 3×5 pixel capitals for the signs
  const FONT = { S: ["111", "100", "111", "001", "111"], T: ["111", "010", "010", "010", "010"], O: ["111", "101", "101", "101", "111"], K: ["101", "101", "110", "101", "101"], R: ["110", "101", "110", "101", "101"], E: ["111", "100", "110", "100", "111"], X: ["101", "101", "010", "101", "101"], C: ["111", "100", "100", "100", "111"], H: ["101", "101", "111", "101", "101"], A: ["010", "101", "111", "101", "101"], N: ["101", "111", "111", "101", "101"], G: ["111", "100", "101", "101", "111"], W: ["101", "101", "111", "111", "101"], L: ["100", "100", "100", "100", "111"], " ": ["000", "000", "000", "000", "000"], "$": ["111", "100", "111", "001", "111"], ".": ["000", "000", "000", "000", "010"], 0: ["111", "101", "101", "101", "111"], 1: ["010", "110", "010", "010", "111"], 2: ["111", "001", "111", "100", "111"], 3: ["111", "001", "111", "001", "111"], 4: ["101", "101", "111", "001", "001"], 5: ["111", "100", "111", "001", "111"], 6: ["111", "100", "111", "101", "111"], 7: ["111", "001", "001", "001", "001"], 8: ["111", "101", "111", "101", "111"], 9: ["111", "101", "111", "001", "111"], "+": ["000", "010", "111", "010", "000"], "-": ["000", "000", "111", "000", "000"], "%": ["101", "001", "010", "100", "101"] };
  function text(px, x, y, str, col) { let cx = x; for (const ch of str.toUpperCase()) { const g = FONT[ch] || FONT[" "]; for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) if (g[r][c] === "1") px(cx + c, y + r, 1, 1, col); cx += 4; } return cx - x; }

  function layout(gw, gh, hero) {
    let seed = 20260922; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const ground = gh - 8, stars = [], far = [], near = [], clouds = [];
    for (let i = 0; i < (gw * gh) / 900; i++) stars.push([Math.floor(rnd() * gw), Math.floor(rnd() * gh * 0.55), rnd() > 0.8]);
    for (let x = 0; x < gw;) { const w = 6 + Math.floor(rnd() * 10), h = Math.floor(gh * (0.18 + rnd() * 0.28)); const win = []; for (let wy = ground - h + 2; wy < ground - 2; wy += 3) for (let wx = x + 1; wx < x + w - 1; wx += 2) if (rnd() > 0.55) win.push([wx, wy]); far.push({ x, w, h, win }); x += w + Math.floor(rnd() * 3); }
    const pal = [["#7d2f22", "#a8412f"], ["#5a4a3a", "#8a7256"], ["#243a5e", "#2f4d7c"]];
    let tickerDone = false;
    for (let x = -2; x < gw;) { const w = 10 + Math.floor(rnd() * 16), h = Math.floor(gh * (0.28 + rnd() * 0.34)), p = pal[Math.floor(rnd() * pal.length)], cap = rnd() > 0.6; const win = []; for (let wy = ground - h + 3; wy < ground - 3; wy += 4) for (let wx = x + 2; wx < x + w - 2; wx += 3) win.push([wx, wy, rnd() > 0.45]); const sign = w > 18 && rnd() > 0.5 ? ground - h + Math.floor(h * 0.35) : null; const ticker = !tickerDone && hero && w > 20 && x > gw * 0.55 && rnd() > 0.4; if (ticker) tickerDone = true; near.push({ x, w, h, d: p[0], l: p[1], cap, win, sign, ticker }); x += w + 1 + Math.floor(rnd() * 3); }
    for (let i = 0; i < Math.max(3, gw / 60); i++) clouds.push([Math.floor(rnd() * gw), 4 + Math.floor(rnd() * gh * 0.22), 8 + Math.floor(rnd() * 14)]);
    const cars = []; for (let i = 0; i < (hero ? 4 : 2); i++) cars.push({ x: rnd() * gw, dir: i % 2 ? 1 : -1, v: 14 + rnd() * 12, col: rnd() > 0.5 ? "#f0a83a" : ["#c9bfa4", "#2f4d7c", "#7d2f22"][Math.floor(rnd() * 3)], taxi: rnd() > 0.5 });
    return { gw, gh, ground, stars, far, near, clouds, cars, flicker: new Map(), steam: [], tick: 0 };
  }

  function draw(ctx, c, t, hero, ticker, now) {
    const { gw, gh, ground, stars, far, near, clouds, cars } = c;
    const px = (x, y, w, h, col) => { ctx.fillStyle = col; ctx.fillRect(Math.round(x), Math.round(y), w, h); };
    for (let i = 0; i < 5; i++) px(0, Math.floor((gh * i) / 5), gw, Math.ceil(gh / 5) + 1, mix(NIGHT[i], DAY[i], t));
    ctx.globalAlpha = Math.max(0, 1 - t * 1.6); for (const [x, y, a] of stars) { if (a && Math.floor(now / 700 + x) % 5 === 0) continue; px(x, y, 1, 1, a ? "#f0a83a" : "#f4e9c8"); } ctx.globalAlpha = 1; // stars twinkle
    const moonY = Math.floor(lerp(10, gh * 0.62, t)), sunY = Math.floor(lerp(gh * 0.62, 8, t));
    px(gw - 28, moonY, 7, 7, "#f4e9c8"); px(gw - 27, moonY - 1, 5, 9, "#f4e9c8"); px(gw - 29, moonY + 1, 9, 5, "#f4e9c8"); px(gw - 25, moonY + 2, 3, 3, "#c9bfa4");
    px(gw - 30, sunY, 10, 10, "#f0a83a"); px(gw - 29, sunY - 1, 8, 12, "#f0a83a"); px(gw - 31, sunY + 1, 12, 8, "#f0a83a"); px(gw - 27, sunY + 2, 4, 4, "#f7c96e");
    for (const [dx, dy] of [[-3, 13], [12, 13], [4, -2], [4, 12], [-2, 3], [11, 3], [-2, 9], [11, 9]]) px(gw - 25 + dx, sunY + dy, 1, 1, "#f0a83a");
    ctx.globalAlpha = Math.max(0, (t - 0.4) * 1.6); for (const cl of clouds) { const x = Math.round(cl[0] + (now / 900) % gw) % (gw + 30) - 15; px(x, cl[1], cl[2], 3, "#ffffff"); px(x + 2, cl[1] - 2, cl[2] - 4, 2, "#ffffff"); px(x + 1, cl[1] + 3, cl[2] - 2, 1, "#e6eef7"); } ctx.globalAlpha = 1; // clouds drift
    for (const b of far) { px(b.x, ground - b.h, b.w, b.h, mix("#1b2a47", "#6f86ad", t)); for (const [wx, wy] of b.win) px(wx, wy, 1, 1, "#3a4f7a"); }
    for (const b of near) {
      px(b.x, ground - b.h, b.w, b.h, b.d); px(b.x, ground - b.h, b.w, 1, b.l); px(b.x, ground - b.h, 1, b.h, b.l);
      if (b.cap) { px(b.x + 2, ground - b.h - 4, b.w - 4, 4, b.d); px(b.x + 2, ground - b.h - 4, b.w - 4, 1, b.l); }
      for (const w of b.win) { let lit = w[2]; const k = w[0] * 1000 + w[1]; const f = c.flicker.get(k); if (f !== undefined) lit = f; px(w[0], w[1], 2, 2, lit ? mix("#f0a83a", "#0b1120", t) : mix("#0b1120", "#3a4f7a", t)); }
      if (b.sign !== null) { px(b.x + 3, b.sign, b.w - 6, 5, "#0f7a4d"); px(b.x + 4, b.sign + 1, b.w - 8, 3, "#35c4c4"); }
      if (b.ticker) { // an LED band crawling with the anchors
        const y = ground - b.h + 8, w = b.w - 4; px(b.x + 2, y - 1, w, 7, "#07110a");
        ctx.save(); ctx.beginPath(); ctx.rect(b.x + 2, y, w, 5); ctx.clip();
        const msg = ticker(); const len = msg.length * 4 + w; const off = Math.floor((now / 90) % len);
        text(px, b.x + 2 + w - off, y, msg, "#5ef0a0"); text(px, b.x + 2 + w - off + len, y, msg, "#5ef0a0"); ctx.restore();
      }
    }
    if (hero) { // the exchange: columns, a name over the door, flags
      const ex = Math.floor(gw * 0.42), ew = Math.min(60, Math.floor(gw * 0.16)), eh = Math.floor(gh * 0.3);
      px(ex, ground - eh, ew, eh, "#c9bfa4"); px(ex - 2, ground - eh - 3, ew + 4, 4, "#f4e9c8"); px(ex + ew / 2 - 8, ground - eh - 9, 16, 6, "#f4e9c8");
      for (let cx = ex + 3; cx < ex + ew - 3; cx += 6) px(cx, ground - eh + 5, 3, eh - 8, "#8a8f99");
      const name = "STOOK ST EXCHANGE", nw = name.length * 4 - 1; if (nw < ew - 4) { px(ex + Math.floor((ew - nw) / 2) - 1, ground - eh + eh * 0.45 - 1, nw + 2, 7, "#0f7a4d"); text(px, ex + Math.floor((ew - nw) / 2), ground - eh + eh * 0.45, name, "#f4e9c8"); }
      else { px(ex + Math.floor(ew / 2) - 11, ground - eh + eh * 0.45 - 1, 22, 7, "#0f7a4d"); text(px, ex + Math.floor(ew / 2) - 10, ground - eh + eh * 0.45, "STOOK", "#f4e9c8"); }
      for (let i = 0; i < 3; i++) { const fx = ex + 6 + i * Math.floor((ew - 12) / 2), wave = Math.round(Math.sin(now / 300 + i) * 1); px(fx, ground - eh - 12, 1, 10, "#8a8f99"); px(fx + 1, ground - eh - 12 + wave, 5, 3, i === 1 ? "#f0a83a" : "#0f7a4d"); }
      // the bull, at the corner
      const bx = Math.floor(gw * 0.3), by = ground; px(bx, by - 5, 9, 4, "#3a3f4c"); px(bx + 8, by - 7, 4, 4, "#3a3f4c"); px(bx + 11, by - 8, 1, 1, "#3a3f4c"); px(bx + 12, by - 8, 1, 1, "#3a3f4c"); px(bx + 1, by - 1, 1, 1, "#3a3f4c"); px(bx + 3, by - 1, 1, 1, "#3a3f4c"); px(bx + 6, by - 1, 1, 1, "#3a3f4c"); px(bx + 8, by - 1, 1, 1, "#3a3f4c"); px(bx - 1, by - 6, 1, 2, "#3a3f4c");
      // a hot-dog cart
      const hx = Math.floor(gw * 0.6); px(hx, ground - 4, 6, 3, "#f4e9c8"); px(hx - 1, ground - 6, 8, 2, "#a8412f"); px(hx + 1, ground - 1, 1, 1, "#0b1120"); px(hx + 4, ground - 1, 1, 1, "#0b1120");
    }
    px(0, ground, gw, 8, "#2a2a30"); for (let x = 2; x < gw; x += 10) px(x, ground + 4, 5, 1, "#f0a83a");
    for (const s of c.steam) px(s.x + Math.round(Math.sin(s.age * 3) * 1), ground - s.age * 3, 2, 2, `rgba(244,233,200,${Math.max(0, 0.5 - s.age * 0.12)})`);
    for (const car of cars) { const x = Math.round(car.x), y = ground + (car.dir > 0 ? 1 : 5); px(x, y - 2, 10, 3, car.col); px(x + 2, y - 4, 6, 2, car.col); px(x + 3, y - 3, 4, 1, "#0b1120"); px(x + 1, y + 1, 2, 1, "#0b1120"); px(x + 7, y + 1, 2, 1, "#0b1120"); if (t < 0.5) px(car.dir > 0 ? x + 9 : x, y - 1, 1, 1, "#fff6c9"); if (car.taxi) px(x + 4, y - 5, 2, 1, "#f0a83a"); }
    const sx = Math.floor(gw * 0.72); px(sx, ground - 22, 1, 22, "#8a8f99");
    if (hero) { px(sx - 15, ground - 30, 32, 9, "#f4e9c8"); px(sx - 14, ground - 29, 30, 7, "#0f7a4d"); text(px, sx - 13, ground - 28, "STOOK ST", "#f4e9c8"); }
    else { px(sx - 9, ground - 27, 20, 6, "#f4e9c8"); px(sx - 8, ground - 26, 18, 4, "#0f7a4d"); }
  }

  function mount(canvas, opts) {
    const ctx = canvas.getContext("2d"); let city = null, raf = 0, last = 0, visible = true;
    const hero = !!opts.hero, reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ticker = opts.ticker || (() => "STOOK STREET");
    function size() { const W = canvas.clientWidth, H = canvas.clientHeight, P = hero ? Math.max(3, Math.round(W / 260)) : 3; const gw = Math.ceil(W / P), gh = hero ? Math.ceil(H / P) : 22; if (!city || city.gw !== gw || city.gh !== gh) { city = layout(gw, gh, hero); canvas.width = gw; canvas.height = gh; } }
    function frame(now) {
      raf = requestAnimationFrame(frame);
      if (!visible || now - last < 80) return;                   // ~12 fps is plenty for pixels
      const dt = Math.min(0.2, (now - last) / 1000); last = now; size();
      const t = opts.t ? opts.t() : 0;
      if (!reduce) {
        for (const car of city.cars) { car.x += car.dir * car.v * dt; if (car.x > city.gw + 12) car.x = -12; if (car.x < -12) car.x = city.gw + 12; }
        if (t < 0.5 && Math.random() < dt * 6) { const b = city.near[Math.floor(Math.random() * city.near.length)]; if (b.win.length) { const w = b.win[Math.floor(Math.random() * b.win.length)]; const k = w[0] * 1000 + w[1]; city.flicker.set(k, !(city.flicker.get(k) ?? w[2])); } } // a window somewhere goes on or off
        if (city.flicker.size > 60) city.flicker.delete(city.flicker.keys().next().value);
        if (Math.random() < dt * 1.5) city.steam.push({ x: Math.floor(city.gw * 0.52), age: 0 });
        for (const s of city.steam) s.age += dt; city.steam = city.steam.filter((s) => s.age < 4);
      }
      draw(ctx, city, t, hero, ticker, reduce ? 0 : now);
    }
    const io = new IntersectionObserver((es) => { visible = es[0].isIntersecting && !document.hidden; }); io.observe(canvas);
    const onVis = () => { visible = !document.hidden; }; document.addEventListener("visibilitychange", onVis);
    const ro = new ResizeObserver(() => { size(); draw(ctx, city, opts.t ? opts.t() : 0, hero, ticker, 0); }); ro.observe(canvas);
    size(); raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); io.disconnect(); ro.disconnect(); document.removeEventListener("visibilitychange", onVis); };
  }
  window.StookCity = { mount };
})();
