// Records the live round page on a phone (390×844, touch) for the ad's Tower
// beat: a tap on a floor, then "Not sure", then "Sure", so the gold coins and
// the WIN tag move. Writes footage/raw.webm, then trims the good part to
// public/footage/round-phone.mp4 (H.264, no audio).
//
//   node scripts/record.mjs [round-url] [--from 1.2] [--to 4.4]
//   CHROME=/path/to/chrome node scripts/record.mjs      (else Playwright's cached Chromium)
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url)), root = join(here, "..");
const arg = (f, d) => (process.argv.includes(f) ? process.argv[process.argv.indexOf(f) + 1] : d);
const url = process.argv[2]?.startsWith("http") ? process.argv[2] : "https://stookstreet.xyz/m/DpNQrFTtxy9Y8h6rB1Pdom7h3oMtV7xibeCYb8fEB6Aw";
const from = Number(arg("--from", "5.3")), to = Number(arg("--to", "8.8"));
const cached = join(homedir(), "Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
const executablePath = process.env.CHROME ?? (existsSync(cached) ? cached : undefined);

const raw = join(root, "footage"); rmSync(raw, { recursive: true, force: true }); mkdirSync(raw, { recursive: true });
const browser = await chromium.launch({ executablePath });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, recordVideo: { dir: raw, size: { width: 390, height: 844 } } });
await ctx.addInitScript(() => { try { localStorage.setItem("stook.tower-coach.v1", "done"); localStorage.setItem("stook-theme", "night"); } catch {} });
const page = await ctx.newPage();
await page.goto(url, { waitUntil: "load", timeout: 60000 });
await page.waitForSelector(".tw-fl", { timeout: 30000 }); await page.waitForTimeout(1500);
const start = Date.now(), t = () => ((Date.now() - start) / 1000).toFixed(1);
// a floor two above the price, on its windows
const floors = page.locator(".tw-fl"); const n = await floors.count();
const live = await page.evaluate(() => { const fl = [...document.querySelectorAll(".tw-fl")]; const i = fl.findIndex((e) => e.classList.contains("in")); return i < 0 ? Math.floor(fl.length / 2) : i; });
const target = floors.nth(Math.max(0, Math.min(n - 1, live - 2))); await target.scrollIntoViewIfNeeded();
const box = await target.boundingBox();
console.log(t(), "tap floor"); await page.touchscreen.tap(box.x + box.width * 0.55, box.y + box.height / 2); await page.waitForTimeout(1300);
const sure = page.locator(".tw-kbar .floor-btn");
console.log(t(), "Not sure"); await sure.nth(2).tap(); await page.waitForTimeout(1100);
console.log(t(), "Sure"); await sure.nth(0).tap(); await page.waitForTimeout(1500);
await ctx.close(); await browser.close();
const webm = readdirSync(raw).find((f) => f.endsWith(".webm")); renameSync(join(raw, webm), join(raw, "raw.webm"));
const out = join(root, "public/footage/round-phone.mp4"); mkdirSync(dirname(out), { recursive: true });
// the recording starts at page open; on this machine the first tap lands ~5.5 s in. Check footage/raw.webm and set --from/--to
execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", String(from), "-to", String(to), "-i", join(raw, "raw.webm"), "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "22", "-r", "30", "-movflags", "+faststart", out]);
console.log("wrote", out);
