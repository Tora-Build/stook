# @stook/promo

Stook Street's ads for X, made with [Remotion](https://www.remotion.dev)
(React components rendered to video), cut to a retro-funk track. Each in square
1080×1080 and vertical 1080×1920, 30 fps, H.264 / yuv420p, AAC:

| composition | file | what |
|---|---|---|
| `Full`, `FullVertical` | `out/stook-68s-{square,vertical}.mp4` | the whole track (68.2 s): 1970s TV open → "WHERE WILL IT LAND?" on the drop (9.33 s) → split-flap board → the floor → the call on the tower → the elevator, WIN 2.3× → or be the house → the 4 PM bell → end card |
| `Square`, `Vertical` | `out/stook-15s-{square,vertical}.mp4` | track from 7.2 s, drop at 2.1 s: TV → hook → board → the call → the bell → end card |
| `Square6`, `Vertical6` | `out/stook-6s-{square,vertical}.mp4` | track from 8.8 s, drop at 0.5 s: hook → fastest pick → end card |

Every scene change is on a bar line of the track and the picture bumps a little
on each beat after the drop. The art is the site's own (`city.js` ported to
`src/city.ts`; tower, taxi, bell, flag from `Tower.tsx`); the numbers
(WIN 2.3×, PAID) are demo values; the phone plays real footage of the
live round page. All on-screen lines are big text, so the ads read muted.

```sh
npm install                  # standalone: not part of the pnpm workspace
cp <track>.mp3 public/music.mp3   # not committed (gitignored)
npx remotion studio          # preview all six
sh render.sh                 # all six → out/   (sh render.sh Full: one)
sh stills.sh 283 900         # PNG stills (COMPS="Full FullVertical" for others)
sh check.sh                  # codec, size, length, audio; stills of each MP4
```

## Copy

Lines that may change live in `src/copy.ts`: `explainer` (under the hook from
frame 0 of every cut, for muted first-time viewers) and, in the 68 s cut only,
the reward-coin caption on the floor (`rewards`, `rewardsSub`, and
`rewardTables`, which lights only $ZCAT, $KNOTS and $GP; $STOOK is a standard
launch with no transfer fee and is never lit there).

## The beat grid

Cuts and hits live in `src/beats.json` as **beat numbers** into the track's beat
grid (`beatTimes`, seconds, measured with librosa; 112.3 BPM, first beat
0.60 s, a bar is 4 beats = 2.14 s, the drop is beat 16). `src/config.ts` turns a
beat into a frame: `round((beatTime(beat) − start) × 30)`, where `start` is the
second of the track the ad opens on (0, 7.2, 8.8). Beats past the measured grid
continue at the BPM.

`node scripts/beats.mjs` prints every bar line and where each ad's cuts land.
For another track:

- a measured grid: `node scripts/beats.mjs --from grid.json --set` (`{ bpm, beats: [s…] }`), or
- a steady tempo: `node scripts/beats.mjs --bpm 120 --offset 0.4 --set`, where the
  offset is the first downbeat in seconds;

then move the beat numbers in `beats.json` (`cuts`, `flaps`, `coins`, `bell`, …)
so cuts land on that track's phrases, and set each ad's `start` and `fadeOut`.

Without `public/music.mp3` every render is silent; `--props='{"track":"none"}'`
forces silence. Optional sound effects play with the music when present:
`public/sfx/{flap,stop,coins,bell}.(mp3|wav)`.

## Footage

`node scripts/record.mjs` records the live round page on a 390×844 touch screen
(taps a floor, "Not sure", "Sure") to `footage/raw.webm` and trims
`--from 5.3 --to 8.8` s into `public/footage/round-phone.mp4` (committed, ~120 KB).

## Notes

- If Remotion can't fetch its headless Chrome: `REMOTION_CHROME=/path/to/chrome sh render.sh`.
- **License:** Remotion is free for individuals and companies of up to 3
  people; larger companies need a company license (https://www.remotion.dev/license).
  The track is Pixabay's "Retro Funk" (prettyjohn1); check Pixabay's license
  terms for paid ads before running it.
