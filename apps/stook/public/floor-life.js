// The trading floor, alive. Traders stand around their tables; now and then
// one walks over to another — at the same table or across the floor — and
// they talk. What they say is built from the live numbers (the anchors'
// prices and moves) and a large bag of phrasings, so the chatter is new each
// time. Drawn on one low-resolution canvas laid over the tables, with the
// bubbles as DOM text so they stay crisp. Pauses when off-screen or hidden.
//
//   StookFloor.mount(container, { tables: () => [{el, coin, anchor}], data: () => quotes })
//     quotes: { [coin]: { price, change24h, dp, anchor } }
(function () {
  const P = 3;                                   // canvas pixel size
  const SUITS = ["#1b2a47", "#3b2a22", "#7d2f22", "#2f4d7c", "#3a3f4c", "#4a3b6b"];
  const SKINS = ["#f1c9a5", "#d9a173", "#a86f45", "#6b4a2e", "#c68642"];
  const HAIRS = ["#0b1120", "#5a3a1a", "#c9bfa4", "#a8412f", "#8a8f99"];
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (xs) => xs[Math.floor(Math.random() * xs.length)];
  const fmt = (v, dp) => (v == null ? "—" : v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp }));
  const pctf = (v) => (v == null ? "flat" : (v >= 0 ? "+" : "") + v.toFixed(2) + "%");

  // ── what they say ──────────────────────────────────────────────────────
  // {coin} {anchor} {price} {chg} {up} {level} {near} {far} are filled from data.
  const OPENERS = [
    "Fuck me, {anchor} at {price}.", "Who the hell drew a line at {far}?", "{coin} pool's thin as shit. Fund it or shut up.", "Reach 8? Grow a pair, reach 2 and pick a band.", "Where's {anchor} closing? Don't say {near}, everyone says {near}.",
    "Bullshit. {anchor} never closes at {level}.", "My line's at {level}. Yours?", "The odds on {anchor} are wrong and I'm gonna get paid.", "Start the {coin} round or I will. Then you pay me fees.", "You still holding that {coin} range? Christ.",
    "Bell's in a few hours. Lines in, mouths shut.", "{anchor} {chg} and you're still on the fence?", "I've got 2,000 {coin} on {level}. Say something.", "Whoever's the house on {coin} today owes me a drink.", "Somebody's sitting on the {coin} pool like a hen.",
    "{anchor} moved {abs}% today. That's {bands} bands.", "A band on {anchor} is about {band} wide right now.", "{anchor} needs {abs}% to get back where it started.", "If {anchor} holds {price} into the close, my line pays.",
    "{coin} pool's paying fees. Somebody's trading.", "{anchor} at {price} — that's the middle band, nobody wins big there.", "Two bands up on {anchor} is {far}. I'd take it.", "{anchor} {chg} and the crowd hasn't moved. Odd.",
    "Sold my {coin} line, buying it back lower.", "Is the {coin} round started yet?", "Whoever seeded {coin} today is up on fees already.", "Range on {anchor}: {near} to {far}. Sleep easy.",
    "{anchor} at {price}.", "{anchor}'s {chg} today.", "Seen {anchor}? {price}.", "{coin} crowd's quiet.", "Who's starting {coin}'s round?",
    "{anchor} {up} — you in?", "I've got a line at {level}.", "Anyone above {far}? Madness.", "{near} by the close, I'd say.", "Bands are tight on {coin}.",
    "The pool on {coin} is thin.", "{anchor} hasn't moved since lunch.", "Coffee? Then {coin}.", "Odds on {anchor} look wrong to me.", "Where does {anchor} land? {level}?",
    "I'm the house on {coin} today.", "{anchor} {chg}. Line's holding.", "Sold out of {coin} at the top.", "{price} on {anchor}, printed a minute ago.", "Reach 8 on {coin}. Don't tell anyone.",
    "Pyth says {price}.", "{anchor}: {chg}. Boring. Good.", "Close is at four. Get your line in.", "Whoever starts Friday's {coin} round eats the fees.", "Range {near}–{far}? Coward's bet.",
  ];
  const REPLIES = [
    "Bullshit.", "You're out of your fucking mind.", "That's what you said about {anchor} last week.", "Fine, {level}. Now shut up.", "Then fund the damn pool.", "I'll take that bet. All of it.", "Eat shit. {far} by Friday.",
    "Sure. And I'm the Fed.", "Draw the line, stop talking about it.", "{chg}? That's noise.", "Nobody cares about your line.", "The crowd's got it at {near}, genius.", "Move your ass, bell's soon.", "Wider band, smaller mouth.",
    "Ha! {price}. Pay up.", "My grandmother could draw that line.", "Don't be greedy. Range it.", "If you're so sure, be the house.",
    "{bands} bands? The tent won't cover that.", "Then draw the line at {near}.", "The house made {abs}% just sitting there.", "Start it yourself, it's one click.", "{band} a band. Fine. Reach 2.",
    "{anchor}'s never closed there.", "I'll seed it if you trade it.", "Wider reach. Costs more, pays wider.", "Your line's four bands out. Good luck.", "The odds already say {near}.",
    "No way. {level}, easy.", "I'm long the close.", "Not with my {coin}.", "Line's in. {level}.", "Pool's fine, you fund it then.", "{chg}? That's nothing.", "Told you. {price}.",
    "Range for me. Sleep well.", "I'll take the other side.", "Crowd's got it at {near}.", "Give it an hour.", "Fees pay either way.", "Reach 4, centre {level}.", "That's a {far} print by Friday.",
    "Wider bands, more chance.", "You said that yesterday.", "Fine. Ten shares.", "The house always eats.", "Below {near}? I doubt it.", "Show me the odds.", "Sure. After the close.",
  ];
  const CLOSERS = ["Deal.", "We'll see.", "Ha.", "Fine.", "Back to it.", "Watch the tape.", "Later.", "Mm.", "Nope.", "Coffee.", "Fuck off.", "Don't be a hero.", "Buy the dip, idiot.", "Size down.", "Get fucked, then.", "Your funeral.", "Tape doesn't lie.", "Shut up and trade.", "Bell's at four.", "Wake me at the close."];
  // The floor has moods. What the anchor did today picks the pool of lines.
  const HOT = [ // up hard
    "{anchor} ripping. {chg}. Holy shit.", "Told you {anchor} was going. {price}, and it's not fucking done.", "Whoever shorted {coin} today is getting their face ripped off.", "{chg} on {anchor}! Ring the goddamn bell already.", "Bands can't keep up with {anchor}. Every line's out of range.",
    "Buy {level}. No — buy {far}. Fuck it, buy both.", "Pool on {coin} is getting drained, someone drew the right line.", "{anchor} at {price}. I've been long since breakfast, kiss my ass.", "Reach 8 on {coin} and I'm still not wide enough.",
  ];
  const COLD = [ // down hard
    "{anchor}'s getting fucking murdered. {chg}.", "Who drew a line at {far}? Jesus. It's {price}.", "Every long on {coin} is toast. Every single one.", "{anchor} {chg}. The pool's eating well today.", "Stop the bleeding on {anchor}. Sell, then think.",
    "I said range, you said line. {chg}. Enjoy.", "Don't catch that knife. {anchor}'s at {price} and dropping.", "The house on {coin} just bought a boat.", "Fuck this tape. Coffee.",
  ];
  const FLAT = [ // nothing happening
    "{anchor} hasn't moved a fucking inch. {price}.", "Dead tape. {coin} pool's just collecting fees.", "{anchor} {chg}. My grandma trades with more range.", "Somebody wake {anchor} up.", "Middle band all day on {coin}. Boring. Profitable.",
    "I could draw a line blindfolded on {anchor} today.", "Is the {coin} round even open? Feels closed.", "Nobody's started tomorrow's {coin} round. Cowards.", "{price}. Same as an hour ago. Same as yesterday.",
  ];
  const mood = (chg) => (chg == null ? FLAT : chg > 2.5 ? HOT : chg < -2.5 ? COLD : Math.random() < 0.5 ? FLAT : null);

  const GENERIC = ["Coffee?", "Long day.", "Close is at four.", "Watch the tape.", "Who's on the board today?", "Nothing moves before lunch.", "You seen the new post?", "Same as yesterday.", "Lines in?", "I'll be at the $STOOK table."];
  function line(tpl, k, q) {
    if (!q || q.price == null) return pick(GENERIC);       // no number to talk about: small talk
    const dp = q.dp ?? 2, p = q.price, chg = q.change24h;
    const lvl = (m) => fmt(p * (1 + m), dp);
    const abs = chg == null ? "0.0" : Math.abs(chg).toFixed(1);
    return tpl.replace("{coin}", "$" + k).replace("{anchor}", q.anchor || k).replace("{price}", fmt(p, dp)).replace("{chg}", pctf(chg)).replace("{abs}", abs)
      .replace("{bands}", chg == null ? "0" : String(Math.max(1, Math.round(Math.abs(chg)))))
      .replace("{band}", fmt(p * 0.01, dp)).replace("{up}", chg == null ? "flat" : chg >= 0 ? "up" : "down")
      .replace("{level}", lvl(rnd(-0.02, 0.02))).replace("{near}", lvl(rnd(-0.01, 0.01))).replace("{far}", lvl(rnd(0.05, 0.12)));
  }

  function mount(container, opts) {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return () => {};
    const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d");
    canvas.className = "floor-life"; Object.assign(canvas.style, { position: "absolute", inset: 0, width: "100%", height: "100%", imageRendering: "pixelated", pointerEvents: "none", zIndex: 2 });
    const bubbles = document.createElement("div"); Object.assign(bubbles.style, { position: "absolute", inset: 0, pointerEvents: "none", zIndex: 3 });
    container.style.position = container.style.position || "relative";
    container.appendChild(canvas); container.appendChild(bubbles);

    let W = 0, H = 0, tables = [], agents = [], convos = [], visible = true, last = 0, raf = 0;
    const box = () => container.getBoundingClientRect();

    function layout() {
      const b = box(); W = Math.ceil(b.width / P); H = Math.ceil(b.height / P); canvas.width = W; canvas.height = H;
      const prev = agents;
      tables = opts.tables().map((t) => { const r = t.el.getBoundingClientRect(); return { coin: t.coin, cx: (r.left - b.left + r.width / 2) / P, cy: (r.top - b.top + r.height / 2) / P, r: r.width / 2 / P + 4 }; });
      agents = [];
      tables.forEach((t, ti) => {
        const n = 6 + Math.floor(Math.random() * 3);
        for (let i = 0; i < n; i++) {
          const ang = (i / n) * Math.PI * 2 + rnd(-0.2, 0.2);
          const old = prev.find((a) => a.table === ti && a.slot === i);
          agents.push({ table: ti, slot: i, ang, hx: t.cx + Math.cos(ang) * t.r, hy: t.cy + Math.sin(ang) * t.r, x: 0, y: 0, state: "home", suit: old?.suit ?? pick(SUITS), skin: old?.skin ?? pick(SKINS), hair: old?.hair ?? pick(HAIRS), paper: old?.paper ?? Math.random() > 0.6, t: 0, bob: 0, face: 1 });
        }
      });
      for (const a of agents) { a.x = a.hx; a.y = a.hy; }
    }

    // ── planning: someone decides to go and talk ───────────────────────────
    function plan() {
      const walking = agents.filter((a) => a.state !== "home").length;
      if (walking >= 5 || agents.length < 2) return;
      const a = pick(agents.filter((x) => x.state === "home"));
      if (!a) return;
      // mostly a neighbour at the same table; sometimes across the floor
      const sameTable = Math.random() < 0.65;
      const pool = agents.filter((x) => x !== a && x.state === "home" && (sameTable ? x.table === a.table : x.table !== a.table));
      const b = pick(pool); if (!b) return;
      // Where to stand: beside b on the rim of b's table (a neighbour), or a
      // step outside the rim (a visitor). Never on the table.
      const t = tables[b.table], bang = Math.atan2(b.hy - t.cy, b.hx - t.cx);
      if (sameTable) { const side = Math.random() < 0.5 ? 1 : -1, ang = bang + side * (11 / t.r); a.tx = t.cx + Math.cos(ang) * t.r; a.ty = t.cy + Math.sin(ang) * t.r; }
      else { a.tx = t.cx + Math.cos(bang) * (t.r + 9); a.ty = t.cy + Math.sin(bang) * (t.r + 9); }
      a.state = "walk"; a.partner = b; b.state = "wait"; b.partner = a;
    }

    // ── the conversation, two or three lines ───────────────────────────────
    function talk(a, b) {
      const q = opts.data() || {};
      const tk = tables[b.table]?.coin || tables[a.table]?.coin;
      const withData = Object.keys(q).filter((c) => q[c] && q[c].price != null);
      const k = Math.random() < 0.7 && q[tk] ? tk : withData.length ? pick(withData) : tk;
      const pool = mood(q[k]?.change24h);
      const opener = pool && Math.random() < 0.6 ? pick(pool) : pick(OPENERS);
      const lines = [[a, line(opener, k, q[k])], [b, line(pick(REPLIES), k, q[k])]];
      const r = Math.random();
      if (r < 0.35) lines.push([a, line(pick(pool || OPENERS), k, q[k])], [b, pick(CLOSERS)]);       // a longer argument
      else if (r < 0.75) lines.push([Math.random() < 0.5 ? a : b, pick(CLOSERS)]);
      convos.push({ lines, i: 0, until: 0, a, b });
    }

    function bubble(agent, text) {
      const el = document.createElement("div"); el.className = "floor-bubble"; el.textContent = text;
      // above the head, unless that would leave the floor — then below it
      const above = agent.y * P > 70;
      Object.assign(el.style, { position: "absolute", left: agent.x * P + "px", top: (above ? agent.y - 14 : agent.y + 8) * P + "px", transform: above ? "translate(-50%, -100%)" : "translate(-50%, 0)", whiteSpace: "normal", width: "max-content", maxWidth: "150px", textAlign: "center" });
      el.classList.add(above ? "above" : "below");
      bubbles.appendChild(el); return el;
    }

    function step(now) {
      raf = requestAnimationFrame(step);
      if (!visible || now - last < 33) return; // ~30 fps
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      if (Math.random() < dt / 2.5) plan();      // a new trip every ~2.5 s on average

      for (const a of agents) {
        if (a.state === "walk" || a.state === "back") {
          a.t = (a.t || 0) + dt;
          if (a.t > 8) { // could not get there: give up, everyone goes home
            if (a.partner) { a.partner.state = "home"; a.partner.partner = null; }
            a.state = "home"; a.partner = null; a.x = a.hx; a.y = a.hy; a.t = 0; continue;
          }
          const tx = a.state === "walk" ? a.tx : a.hx, ty = a.state === "walk" ? a.ty : a.hy;
          const dx = tx - a.x, dy = ty - a.y, d = Math.hypot(dx, dy);
          const sp = 70 * dt;
          if (d < sp) { a.x = tx; a.y = ty; a.t = 0; if (a.state === "walk") { a.state = "talk"; a.partner.state = "talk"; talk(a, a.partner); } else { a.state = "home"; a.partner = null; } }
          else {
            a.x += (dx / d) * sp; a.y += (dy / d) * sp;
            // Tables are furniture: nobody walks across one. If the step
            // lands inside a table, push back to its rim and slide along it
            // toward the target instead.
            for (const t of tables) {
              const ex = a.x - t.cx, ey = a.y - t.cy, ed = Math.hypot(ex, ey);
              if (ed >= t.r - 1) continue;
              const ang = Math.atan2(ey, ex), tang = Math.atan2(ty - t.cy, tx - t.cx);
              let da = tang - ang; da = Math.atan2(Math.sin(da), Math.cos(da));
              const na = ang + Math.sign(da) * Math.min(Math.abs(da), sp / t.r);
              a.x = t.cx + Math.cos(na) * t.r; a.y = t.cy + Math.sin(na) * t.r;
            }
          }
        }
      }
      for (const c of convos.slice()) {
        if (now < c.until) continue;
        if (c.el) { c.el.remove(); c.el = null; }
        if (c.i >= c.lines.length) {
          convos.splice(convos.indexOf(c), 1);
          const walker = c.a.partner === c.b ? c.a : c.b; // the one who came
          c.a.state = c.a === walker ? "back" : "home"; c.b.state = c.b === walker ? "back" : "home";
          if (c.a.state === "home") c.a.partner = null; if (c.b.state === "home") c.b.partner = null;
          continue;
        }
        const [who, text] = c.lines[c.i++]; c.el = bubble(who, text); c.until = now + 1800 + text.length * 45;
      }
      draw();
    }

    function draw() {
      ctx.clearRect(0, 0, W, H);
      const px = (x, y, w, h, col) => { ctx.fillStyle = col; ctx.fillRect(Math.round(x), Math.round(y), w, h); };
      for (const a of agents.slice().sort((p, q) => p.y - q.y)) {
        const x = Math.round(a.x) - 3, y = Math.round(a.y) - 3;
        px(x - 2, y + 1, 10, 5, a.suit);                                  // shoulders
        px(x, y - 1, 6, 6, a.skin); px(x, y - 2, 6, 3, a.hair);          // head from above
        if (a.paper) px(x + 7, y + 2, 2, 3, "#f4e9c8");
      }
    }

    const io = new IntersectionObserver((es) => { visible = es[0].isIntersecting && !document.hidden; }); io.observe(container);
    document.addEventListener("visibilitychange", () => { visible = !document.hidden; });
    const ro = new ResizeObserver(() => layout()); ro.observe(container);
    layout(); raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); io.disconnect(); ro.disconnect(); canvas.remove(); bubbles.remove(); };
  }
  window.StookFloor = { mount };
})();
