// The daily X post, made and sent from the box:
//   node src/render.mjs morning|bell [--dry]
// A headless Chromium opens the poster studio (../studio.html), fills the
// poster with today's numbers from stookstreet.xyz, draws it frame by frame
// and renders its sound offline; ffmpeg joins them into an MP4. The video
// then goes to stookstreet.xyz/x/video, where the worker holds the X keys,
// posts it and keeps the daily and monthly limits. --dry stops after the
// video (saved in ~/x-posts/ either way).
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const kind = process.argv[2];
const dry = process.argv.includes("--dry");
if (kind !== "morning" && kind !== "bell") { console.error("usage: render.mjs morning|bell [--dry]"); process.exit(2); }
const SITE = process.env.X_POST_URL ?? "https://stookstreet.xyz/x/video";
const FFMPEG = process.env.FFMPEG ?? join(homedir(), "bin/ffmpeg");
const FPS = 30;
const log = (...a) => console.log(new Date().toISOString(), kind, ...a);

// The morning question asks about one table; a different one each time.
const day = Math.floor(Date.now() / 86_400_000), table = Math.floor(day / 2) % 4;

// Ask first, so a day already posted (or a month at its cap) costs no render.
async function ask(query, body, headers = {}) {
  const r = await fetch(`${SITE}?kind=${kind}${query}`, { method: "POST", body, headers: { authorization: `Bearer ${process.env.TAPE_TOKEN}`, ...headers }, signal: AbortSignal.timeout(180_000) });
  const text = await r.text();
  if (!r.ok) throw new Error(`site ${r.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}
if (!dry) { const pre = await ask("&check=1"); if (!pre.ok) { log("skip:", pre.skipped); process.exit(0); } }

const dir = join(homedir(), "x-posts"); mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().slice(0, 10), mp4 = join(dir, `${stamp}-${kind}.mp4`), wav = join(dir, `${stamp}-${kind}.wav`);

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
let caption;
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } });
  const studio = join(dirname(fileURLToPath(import.meta.url)), "../studio.html");
  await page.goto(pathToFileURL(studio).href);
  await page.waitForFunction(() => window.autoReady === true, null, { timeout: 60_000 });
  await page.waitForTimeout(1500); // the skyline paints its first frames
  const got = await page.evaluate(([k, t]) => window.autoPoster.fill(k, t), [kind, table]);
  caption = got.caption;
  writeFileSync(wav, Buffer.from(await page.evaluate(() => window.autoPoster.sound()), "base64"));

  const ff = spawn(FFMPEG, ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-i", "-", "-i", wav,
    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", mp4],
    { stdio: ["pipe", "inherit", "inherit"] });
  const done = new Promise((ok, no) => ff.on("exit", (c) => (c === 0 ? ok() : no(new Error(`ffmpeg exited ${c}`)))));
  const frames = Math.ceil(got.dur * FPS);
  for (let i = 0; i < frames; i++) {
    const png = await page.evaluate((t) => window.autoPoster.frame(t), i / FPS);
    if (!ff.stdin.write(Buffer.from(png.slice(png.indexOf(",") + 1), "base64"))) await new Promise((r) => ff.stdin.once("drain", r));
  }
  ff.stdin.end(); await done;
  log(`video ${mp4} (${frames} frames)`);
} finally { await browser.close(); }

writeFileSync(mp4.replace(/\.mp4$/, ".txt"), caption);
if (dry) { log("dry run, not posted:\n" + caption); process.exit(0); }
const res = await ask(`&text=${encodeURIComponent(caption)}`, readFileSync(mp4), { "content-type": "video/mp4" });
log("site:", JSON.stringify(res));
if (!res.posted && !res.skipped) process.exit(1);
