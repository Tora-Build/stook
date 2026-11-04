// The daily video, in the street cut's design (infra/promo, src/Daily.tsx). The
// clips around the numbers and the sound are prebuilt (scripts/daily-clips.sh,
// in ~/stook-daily on the box); here only the part with today's price, move and
// chart is rendered, about five seconds, then all of it is joined. Any failure,
// or a frame that looks broken, throws, and render.mjs falls back to the studio.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const HOME = join(homedir(), "stook-daily");
export const dailyReady = () => existsSync(join(HOME, "cuts.json")) && existsSync(join(HOME, "bundle-daily"));

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: HOME, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 30, ...opts });
  if (r.status !== 0) throw new Error(`${cmd} failed: ${String(r.stderr).slice(-300)}`);
  return r.stdout;
}

/** Frames that differ from both neighbours while the neighbours match: how a broken render shows. */
function brokenFrames(ffmpeg, file) {
  const w = 54, h = 96, raw = run(ffmpeg, ["-v", "error", "-i", file, "-vf", `scale=${w}:${h}`, "-f", "rawvideo", "-pix_fmt", "gray", "-"]);
  const n = Math.floor(raw.length / (w * h)), at = (i) => raw.subarray(i * w * h, (i + 1) * w * h);
  const d = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
  let bad = 0;
  for (let i = 1; i < n - 1; i++) { const ab = d(at(i - 1), at(i)); if (ab > 6 && d(at(i), at(i + 1)) > 6 && d(at(i - 1), at(i + 1)) < ab * 0.6) bad++; }
  return bad;
}

/** The middle of each part must show up in the joined video at its place: a frozen join passes brokenFrames. */
function checkJoin(ffmpeg, out, parts) {
  const w = 54, h = 96, gray = (f) => run(ffmpeg, ["-v", "error", "-i", f, "-vf", `scale=${w}:${h}`, "-f", "rawvideo", "-pix_fmt", "gray", "-"]);
  const size = w * h, whole = gray(out);
  let start = 0;
  for (const part of parts) {
    const raw = gray(part), n = Math.floor(raw.length / size), mid = Math.floor(n / 2);
    const a = raw.subarray(mid * size, (mid + 1) * size), b = whole.subarray((start + mid) * size, (start + mid + 1) * size);
    if (b.length !== size) throw new Error(`joined video too short at ${part}`);
    let s = 0; for (let i = 0; i < size; i++) s += Math.abs(a[i] - b[i]);
    if (s / size > 8) throw new Error(`joined video does not match ${part}: ${(s / size).toFixed(1)}`);
    start += n;
  }
}

/** Seconds to the next 4 PM in New York, `lead` seconds from now. */
function secsToBell(lead) {
  const nowMs = Date.now() + lead * 1000, ny = new Date(new Date(nowMs).toLocaleString("en-US", { timeZone: "America/New_York" })), bell = new Date(ny);
  bell.setHours(16, 0, 0, 0); if (ny > bell) bell.setDate(bell.getDate() + 1);
  return Math.floor((bell - ny) / 1000);
}

const money = (v) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Today's numbers from the site, and the caption that goes with them. */
async function today(kind, lead) {
  const get = async (p) => { const r = await fetch(`https://stookstreet.xyz${p}`, { signal: AbortSignal.timeout(20_000) }); if (!r.ok) throw new Error(`${p} ${r.status}`); return r.json(); };
  const [q, chart] = await Promise.all([get("/prices"), get("/chart?coin=STOOK")]);
  const price = q.STOOK?.price, chg = typeof q.STOOK?.change24h === "number" ? q.STOOK.change24h : null;
  if (typeof price !== "number") throw new Error("no price");
  const since = Date.now() / 1000 - 86_400, day = (chart.points ?? []).filter((x) => x[0] >= since), step = Math.max(1, Math.floor(day.length / 120)), points = day.filter((_, i) => i % step === 0);
  if (points.length < 2) throw new Error("no chart");
  const date = new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/New_York" }).toUpperCase();
  const move = chg === null ? "" : ` ${chg >= 0 ? "▲" : "▼"}${Math.abs(chg).toFixed(2)}%`;
  const caption = kind === "bell"
    ? `🔔 Closing bell · ${date}\n\nPolymarket ${money(price)}${move}\n\nTomorrow's round is open 👉 stookstreet.xyz`
    : `Where does Polymarket close today? 🔔\n\n${money(price)} now. Bell at 4 PM New York.\nCall the close with $SSt. Closer call, bigger payout.\n\nPlay 👉 stookstreet.xyz`;
  return { props: { kind, date, price, chg, points, secsToBell: secsToBell(lead) }, caption };
}

/** Makes `out` for today; returns its caption. */
export async function makeDaily(kind, out, ffmpeg, { lead = 420 } = {}) {
  const cut = JSON.parse(readFileSync(join(HOME, "cuts.json"), "utf8"))[kind], { props, caption } = await today(kind, lead);
  const propsFile = join(HOME, `props-${kind}.json`), live = join(HOME, `live-${kind}.mp4`);
  writeFileSync(propsFile, JSON.stringify(props));
  run(process.execPath, ["daily-render.mjs", kind === "bell" ? "DailyBell" : "DailyMorning", propsFile, live, String(cut.from), String(cut.to)]);
  const bad = brokenFrames(ffmpeg, live);
  if (bad) throw new Error(`${bad} broken frames`);
  const parts = [join(HOME, `clips/${kind}-head.mp4`), live, join(HOME, `clips/${kind}-tail.mp4`)];
  // The concat filter, not the demuxer: the parts have different encoder settings, and the demuxer freezes on the first one's picture.
  run(ffmpeg, ["-v", "error", "-y", ...parts.flatMap((f) => ["-i", f]), "-i", join(HOME, `clips/${kind}.m4a`), "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0,fps=30,format=yuv420p[v]", "-map", "[v]", "-map", "3:a", "-c:v", "libx264", "-preset", "veryfast", "-crf", "19", "-c:a", "copy", "-shortest", "-movflags", "+faststart", out]);
  checkJoin(ffmpeg, out, parts);
  return caption;
}
