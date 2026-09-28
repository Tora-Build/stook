// The daily X post, made and sent from the box:
//   node src/render.mjs morning|bell [--dry]
// A headless Chromium opens the poster studio (../studio.html), fills the
// poster with today's numbers from stookstreet.xyz, draws it frame by frame
// and renders its sound offline; ffmpeg joins them into an MP4. The video
// then goes to stookstreet.xyz/x/video, where the worker holds the X keys,
// posts it and keeps the daily and monthly limits. The same video goes to the
// Telegram channel (TG_CHANNEL, with TG_BOT_TOKEN, from ~/stook-alerts.env),
// once a day, with the site's link (a link costs nothing there). --dry stops
// after the video (saved in ~/x-posts/ either way).
//
// By hand, to Telegram only, any scene of the studio:
//   node src/render.mjs live --telegram-only [--still] [--caption file.txt] [--dm]
// --still sends the scene's last frame as an image; --caption replaces the
// studio's text; --dm sends to TG_CHAT_ID (the private chat) instead of the
// channel. Captions are formatted: the first line bold, a contract address
// tap-to-copy.
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const kind = process.argv[2];
const flag = (f) => process.argv.includes(f);
const dry = flag("--dry"), tgOnly = flag("--telegram-only"), still = flag("--still"), dm = flag("--dm");
const captionFile = process.argv.includes("--caption") ? process.argv[process.argv.indexOf("--caption") + 1] : null;
if (!/^[a-z]+$/.test(kind ?? "") || (!tgOnly && !dry && kind !== "morning" && kind !== "bell")) { console.error("usage: render.mjs morning|bell [--dry] | render.mjs <scene> --telegram-only [--still] [--caption file] [--dm]"); process.exit(2); }
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
const dir = join(homedir(), "x-posts"); mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().slice(0, 10), mp4 = join(dir, `${stamp}-${kind}.mp4`), wav = join(dir, `${stamp}-${kind}.wav`);
const { TG_BOT_TOKEN: tg, TG_CHANNEL, TG_CHAT_ID } = process.env, channel = dm ? TG_CHAT_ID : TG_CHANNEL, tgDone = join(dir, `${stamp}-${kind}.telegram`);
const toTelegram = !dry && tg && channel && (tgOnly || !existsSync(tgDone));
if (tgOnly && !toTelegram) { console.error("no Telegram keys or chat (~/stook-alerts.env)"); process.exit(2); }
let toX = false;
if (!dry && !tgOnly) { const pre = await ask("&check=1").catch((e) => ({ skipped: String(e) })); toX = !!pre.ok; if (!toX) log("x skip:", pre.skipped); }
if (!dry && !toX && !toTelegram) process.exit(0);

/** Telegram HTML: the first line bold, a Solana address tap-to-copy. */
function telegramHtml(text) {
  const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const [head, ...rest] = esc(text).split("\n");
  return [`<b>${head}</b>`, ...rest].join("\n").replace(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g, (a) => `<code>${a}</code>`);
}

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
let caption;
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } });
  const studio = join(dirname(fileURLToPath(import.meta.url)), "../studio.html");
  await page.goto(pathToFileURL(studio).href);
  await page.waitForFunction(() => window.autoReady === true, null, { timeout: 60_000 });
  await page.waitForTimeout(1500); // the skyline paints its first frames
  const got = await page.evaluate(([k, t]) => window.autoPoster.fill(k, t), [kind, table]);
  caption = captionFile ? readFileSync(captionFile, "utf8").trim() : got.caption;
  if (still) {
    const png = await page.evaluate((t) => window.autoPoster.frame(t), got.dur);
    writeFileSync(mp4.replace(/\.mp4$/, ".png"), Buffer.from(png.slice(png.indexOf(",") + 1), "base64"));
    log(`image ${mp4.replace(/\.mp4$/, ".png")}`);
  } else {
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
  }
} finally { await browser.close(); }

writeFileSync(mp4.replace(/\.mp4$/, ".txt"), caption);
if (dry) { log("dry run, not posted:\n" + caption); process.exit(0); }
let failed = false;
if (toX) {
  const res = await ask(`&text=${encodeURIComponent(caption)}`, readFileSync(mp4), { "content-type": "video/mp4" }).catch((e) => ({ error: String(e) }));
  log("site:", JSON.stringify(res));
  if (!res.posted && !res.skipped) failed = true;
}
if (toTelegram) {
  const form = new FormData();
  form.append("chat_id", channel);
  form.append("caption", telegramHtml(caption.replace(/link in bio/g, "stookstreet.xyz")));
  form.append("parse_mode", "HTML");
  if (still) form.append("photo", new Blob([readFileSync(mp4.replace(/\.mp4$/, ".png"))], { type: "image/png" }), `stook-${kind}.png`);
  else { form.append("supports_streaming", "true"); form.append("video", new Blob([readFileSync(mp4)], { type: "video/mp4" }), `stook-${kind}.mp4`); }
  const r = await fetch(`https://api.telegram.org/bot${tg}/${still ? "sendPhoto" : "sendVideo"}`, { method: "POST", body: form, signal: AbortSignal.timeout(120_000) }).then((x) => x.json()).catch((e) => ({ ok: false, description: String(e) }));
  if (r.ok && !tgOnly) { writeFileSync(tgDone, String(r.result?.message_id ?? "")); log("telegram: posted", r.result?.message_id); }
  else if (r.ok) log("telegram: posted", r.result?.message_id);
  else { log("telegram:", r.description); failed = true; }
}
if (failed) process.exit(1);
