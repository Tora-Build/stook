// The beat grid behind every cut, in frames.
//   node scripts/beats.mjs                         where each ad's cuts land now
//   node scripts/beats.mjs --bpm 120 --offset 0.4 [--seconds 70] [--set]
//       a steady grid for another track (first downbeat at --offset s); --set
//       writes it into src/beats.json as bpm + beatTimes.
//   node scripts/beats.mjs --from grid.json --set
//       a measured grid ({ bpm, beats: [seconds…] }, e.g. from librosa).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const file = join(dirname(fileURLToPath(import.meta.url)), "../src/beats.json");
const B = JSON.parse(readFileSync(file, "utf8"));
const arg = (f) => (process.argv.includes(f) ? process.argv[process.argv.indexOf(f) + 1] : undefined);
if (arg("--from")) { const g = JSON.parse(readFileSync(arg("--from"), "utf8")); B.bpm = Math.round(g.bpm * 1000) / 1000; B.beatTimes = g.beats; }
else if (arg("--bpm")) { const bpm = Number(arg("--bpm")), off = Number(arg("--offset") ?? 0), secs = Number(arg("--seconds") ?? 70); B.bpm = bpm; B.beatTimes = []; for (let t = off; t <= secs; t += 60 / bpm) B.beatTimes.push(Math.round(t * 1000) / 1000); }
const T = B.beatTimes, spb = 60 / B.bpm, fps = B.fps;
const time = (b) => { const i = Math.floor(b), k = b - i; return i + 1 < T.length ? T[i] + (T[i + 1] - T[i]) * k : T[T.length - 1] + (b - (T.length - 1)) * spb; };
console.log(`bpm ${B.bpm}, ${T.length} beats, first at ${T[0]} s; a bar (4 beats) is ${(4 * spb).toFixed(2)} s`);
console.log("bar lines (beat:second:frame): " + Array.from({ length: 30 }, (_, n) => n * 4).filter((b) => time(b) < 70).map((b) => `${b}:${time(b).toFixed(2)}:${Math.round(time(b) * fps)}`).join("  "));
for (const k of ["full", "long", "short"]) { const e = B[k]; console.log(`${k.padEnd(5)} (from ${e.start} s, ${e.seconds} s): cuts at frames ${e.cuts.map((b) => Math.round((time(b) - e.start) * fps)).join(", ")}`); }
if (process.argv.includes("--set")) { writeFileSync(file, JSON.stringify(B, null, 1) + "\n"); console.log("wrote", file); }
