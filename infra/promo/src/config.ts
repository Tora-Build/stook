// Every cut and hit of the three ads, in frames, from the track's beat grid in
// beats.json: frame = round((beatTime(beat) - start) * fps), start being the
// second of the track the ad opens on. To re-time to another track, rebuild the
// grid with scripts/beats.mjs and move the beat numbers.
import B from "./beats.json";

export const FPS = B.fps;
const T = B.beatTimes, SPB = 60 / B.bpm;
/** The time of a beat (fractions between beats, beats past the grid at bpm). */
export function beatTime(b: number) {
  if (b <= 0) return T[0]! + b * SPB;
  const i = Math.floor(b), k = b - i;
  if (i + 1 < T.length) return T[i]! + (T[i + 1]! - T[i]!) * k;
  return T[T.length - 1]! + (b - (T.length - 1)) * SPB;
}
const edit = (e: { start: number; seconds: number; fadeOut: number }) => {
  const at = (b: number) => Math.round((beatTime(b) - e.start) * FPS);
  const total = Math.round(e.seconds * FPS);
  // every beat inside the ad, for the small motion hits
  const beats: number[] = []; for (let b = 0; b < 400; b++) { const f = at(b); if (f > total) break; if (f >= 0) beats.push(f); }
  return { at, total, start: e.start, startFrame: Math.round(e.start * FPS), fadeOut: Math.round(e.fadeOut * FPS), beats };
};

const F = edit(B.full), L = edit(B.long), S = edit(B.short);
/** The full-length ad, the track's own length: TV open, the drop, board, floor, tower, elevator, house, bell, end. */
export const FULL = { ...F, cuts: B.full.cuts.map(F.at), drop: F.at(16), flaps: B.full.flaps.map(F.at), pops: B.full.pops.map(F.at), coins: F.at(B.full.coins), win: F.at(B.full.win), stop: F.at(B.full.stop), lift: F.at(B.full.lift), liftWin: F.at(B.full.liftWin), rewards: F.at(B.full.rewards), pages: B.full.pages.map(F.at), funded: F.at(B.full.funded), four: F.at(B.full.four), bell: F.at(B.full.bell) };
/** The 15 s cut: TV open, the drop on the hook, board, the call, the bell, end. */
export const LONG = { ...L, cuts: B.long.cuts.map(L.at), drop: L.at(16), flaps: B.long.flaps.map(L.at), coins: L.at(B.long.coins), win: L.at(B.long.win), bell: L.at(B.long.bell) };
/** The 6 s cut: the hook on the drop, the fastest pick, end. */
export const SHORT = { ...S, cuts: B.short.cuts.map(S.at), drop: S.at(16), coins: S.at(B.short.coins), win: S.at(B.short.win) };
