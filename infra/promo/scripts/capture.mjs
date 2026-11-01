// Footage of the live app for the ad: frame-exact PNGs of the site running
// locally (pnpm -F @stook/app dev, with VITE_FEED_OVERRIDES empty so every
// coin shows its own anchor), one file a frame at 30 fps, into
// public/footage/<shot>/0001.jpg…  The page's clock is faked and stepped a
// frame at a time, so the city, the floor and the clocks animate exactly as
// on the site, and every frame is sharp (device pixels, not a screen recording).
//   node scripts/capture.mjs            all shots
//   node scripts/capture.mjs home 2     one shot, 2 seconds
import { chromium } from "playwright-core";
import { mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.APP_URL || "http://localhost:5180";
const FPS = 30, W = 432, H = 768, DSF = 2.5; // phone shots → 1080×1920
const WIDE = { W: 1440, H: 720, DSF: 2.5 };   // desktop shots → 3600×1800, to pan across (the hero only: the header and its copy are hidden)

/** Each shot: the path, what to do before the first frame, how long, and what to do during. */
const SHOTS = {
  // the desktop hero: the whole living city with the tower, at night
  city: { path: "/", wide: true, seconds: 9, prep: async (p) => { await setTheme(p, "dark"); await p.evaluate(() => window.scrollTo(0, 0)); } },
  // the same, swept from day to night (the theme tween)
  cityDawn: { path: "/", wide: true, seconds: 7, prep: async (p) => { await setTheme(p, "light"); await p.evaluate(() => window.scrollTo(0, 0)); }, during: async (p, f) => { if (f === 24) await setTheme(p, "dark"); } },
  // the desktop floor
  floorWide: { path: "/", wide: true, seconds: 7, prep: async (p) => { await p.evaluate(() => { const el = document.querySelector("#floor"); window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 40); }); } },
  // the desktop coin page: THE HOUSE
  houseWide: { path: "/c/SSt.", wide: true, seconds: 6, prep: async (p) => { await setTheme(p, "dark"); await p.evaluate(() => window.scrollTo(0, 0)); } },
  // the home hero at night: the living city, the tower, the ticker
  home: { path: "/", seconds: 9, prep: async (p) => { await p.evaluate(() => window.scrollTo(0, 0)); } },
  // the same, swept from day to night (the theme tween) for the open
  dawn: { path: "/", seconds: 7, prep: async (p) => { await setTheme(p, "light"); }, during: async (p, f) => { if (f === 20) await setTheme(p, "dark"); } },
  // the trading floor: tables, traders talking, the board's clock
  floor: { path: "/", seconds: 8, prep: async (p) => { await p.addStyleTag({ content: ".hf-foot { visibility: hidden !important }" }); const el = await p.$("#floor"); await el.scrollIntoViewIfNeeded(); await p.evaluate(() => { const el = document.querySelector("#floor"); const r = el.getBoundingClientRect(); window.scrollBy(0, r.top - 64); }); } },
  // the coin page: THE HOUSE tower, house size, deposit box
  house: { path: "/c/SSt.", seconds: 7, prep: async (p) => { await p.evaluate(() => window.scrollTo(0, 0)); } },
  houseDesk: { path: "/c/SSt.", seconds: 5, prep: async (p) => { await p.evaluate(() => { const el = document.querySelector(".house-body"); if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 70); }); } },
  // list a coin: the pitch and the seed chips
  list: { path: "/list", seconds: 6, prep: async (p) => { await p.evaluate(() => window.scrollTo(0, 0)); } },
  listSeed: { path: "/list", seconds: 5, prep: async (p) => { await p.evaluate(() => { const el = document.querySelector(".list-usd, .list-flow, [class*=list-seed]"); if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 160); }); } },
  // the board
  board: { path: "/board", seconds: 5, prep: async (p) => { await p.evaluate(() => window.scrollTo(0, 0)); } },
  // the How page's drawings of the tower, the call, the bell and the house: the
  // real components on a made-up round (nothing sent), each scene scrolled under
  // the header, played with during the shot
  howTower: { path: "/how?step=tower", seconds: 10, prep: scene, during: async (p, f) => { if (f === 90) await tapRow(p, "$102.02"); if (f === 200) await tapRow(p, "$101.01"); } },
  howCall: { path: "/how?step=line", seconds: 8, prep: scene, during: async (p, f) => { const chip = async (re) => p.getByRole("button", { name: re }).first().click(); if (f === 60) await chip(/^Tight/); if (f === 130) await chip(/^Wide/); if (f === 190) await chip(/^Medium/); } },
  howBell: { path: "/how?step=bell", seconds: 14, prep: scene, during: async (p, f) => { if (f === 265) await p.getByRole("button", { name: "ring the bell" }).click(); } },
  howHouse: { path: "/how?step=house", seconds: 6, prep: scene, during: async (p, f) => { const set = (v) => p.evaluate((v) => { const el = document.querySelector("input.px-range"); const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; s.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); }, v); if (f === 40) await set(2000); if (f === 90) await set(3500); if (f === 140) await set(5000); } },
};

/** Scrolls the How page so its drawing sits just under the header. */
async function scene(p) {
  await p.evaluate(() => { const el = document.querySelector(".placard-scene"); const head = document.querySelector(".ss-head"); const h = head ? head.getBoundingClientRect().height : 0; window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - h - 12); });
}
/** Taps the tower's row whose axis label says `price`, inside the chart. */
async function tapRow(p, price) {
  const sc = await p.locator(".placard-scene").boundingBox();
  const lab = await p.getByText(price, { exact: true }).first().boundingBox();
  if (sc && lab) await p.mouse.click(sc.x + sc.width * 0.3, lab.y + lab.height / 2);
}

async function setTheme(p, want) {
  await p.evaluate((want) => {
    const cur = document.documentElement.dataset.theme === "day" ? "light" : "dark";
    if (cur !== want) document.querySelector('button[aria-label^="Switch to"]')?.click();
  }, want);
}

const only = process.argv[2], secs = process.argv[3] ? +process.argv[3] : null;
const browser = await chromium.launch({ channel: "chrome" });
try {
  for (const [name, shot] of Object.entries(SHOTS)) {
    if (only && name !== only) continue;
    const dir = join(ROOT, "public", "footage", name); mkdirSync(dir, { recursive: true });
    const ctx = await browser.newContext(shot.wide
      ? { viewport: { width: WIDE.W, height: WIDE.H }, deviceScaleFactor: WIDE.DSF, colorScheme: "dark" }
      : { viewport: { width: W, height: H }, deviceScaleFactor: DSF, isMobile: true, hasTouch: true, colorScheme: "dark" });
    const p = await ctx.newPage();
    // "load", not "networkidle": the live quotes poll for ever, so the page is never idle
    await p.goto(BASE + shot.path, { waitUntil: "load", timeout: 60_000 });
    if (shot.wide) await p.addStyleTag({ content: ".ss-head, .home-hero-in, .house-hero-in { visibility: hidden !important } .city-fade-left::before, .city-fade-left::after, .city-fade-both::before, .city-fade-both::after { display: none !important }" });
    await p.waitForTimeout(2500); // data, fonts, the city script
    await shot.prep?.(p);
    await p.waitForTimeout(800);
    // from here the page's time is ours: one frame per step
    await p.clock.install();
    const n = Math.round((secs ?? shot.seconds) * FPS);
    for (let f = 0; f < n; f++) {
      await shot.during?.(p, f);
      await p.clock.runFor(Math.round(1000 / FPS));
      await p.screenshot({ path: join(dir, `${String(f + 1).padStart(4, "0")}.jpg`), type: "jpeg", quality: 92, animations: "allow", caret: "hide" });
    }
    console.log(name, n, "frames");
    await ctx.close();
  }
} finally { await browser.close(); }
