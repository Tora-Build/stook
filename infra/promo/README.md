# @stook/promo

Stook Street's ads for X and the site, made with [Remotion](https://www.remotion.dev)
(React components rendered to video), cut to a retro-funk track. Each in square
1080×1080 and vertical 1080×1920, 30 fps, H.264 / yuv420p, AAC:

| composition | file | what |
|---|---|---|
| `Street`, `StreetSquare` | `out/stook-60s-{vertical,square}.mp4` (+ `-web.mp4`, the site's copy) | **the current cut** (`src/Street.tsx`, 64 s, told the way pump.fun's ads are): a chat on a phone at night ("where's polymarket closing today?"), the link, the dive into it on the drop; WHERE WILL IT CLOSE? over the live city; 4 PM NEW YORK; the floor on a phone, every coin's table; the site's own tower in the phone (a tap moves the call), HOW SURE? (tight, medium, wide), the lock, a bar of silence, the bell on the beat's return and what it paid; OR BE THE HOUSE, 90%; LIST YOUR COIN, $200; the chat's payoff (WIN 2.3×); the door. Heavy type slamming in on the beats, a glitch on every cut, the real site as footage (`scripts/capture.mjs`, including the How page's drawings played live). Its track is `public/street.mp3` (Mixkit "Party" by Arulo, trap, free licence; grid in `src/beats-street.json`) with `public/sfx/*.mp3`: `whoosh`, `hit`, `ding`, `win` from Mixkit; `ping` is the iPhone's own text tone, trimmed from a clip the user chose; `sent` (the send swoosh) and `bell` (the exchange bell) are synthesised with ffmpeg noise and sine sources, see below. The picture pulses on the track's own kicks (`kicks` in `beats-street.json`, librosa onsets on the low band). |
| `Full`, `FullVertical` | `out/stook-68s-{square,vertical}.mp4` | the whole track (68.2 s): 1970s TV open → "WHERE WILL IT LAND?" on the drop (9.33 s) → split-flap board → the floor → the call on the tower → the elevator, WIN 2.3× → or be the house → the 4 PM bell → end card |
| `Square`, `Vertical` | `out/stook-15s-{square,vertical}.mp4` | track from 7.2 s, drop at 2.1 s: TV → hook → board → the call → the bell → end card |
| `Square6`, `Vertical6` | `out/stook-6s-{square,vertical}.mp4` | track from 8.8 s, drop at 0.5 s: hook → fastest pick → end card |

Every scene change is on a bar line of the track and the picture bumps a little
on each beat after the drop. The art is the site's own (`city.js` ported to
`src/city.ts`; tower, taxi, bell, flag from `Tower.tsx`); the numbers
(WIN 2.3×, PAID) are demo values. The tower is the S&P 500 ($STOOK's Stonk):
floors are ~0.5% bands around the real last price and the line is the real
last day of SPYx, baked into `src/data/spx.json` from
`https://stookstreet.xyz/chart?coin=STOOK`. All on-screen lines are big text,
so the ads read muted. Only the 68 s cut is rendered by default now
(`sh render.sh Full FullVertical`); the 15 s and 6 s compositions remain.

```sh
npm install                  # standalone: not part of the pnpm workspace
cp <track>.mp3 public/music.mp3   # the old cuts' track; not committed (gitignored)
# the street cut: public/street.mp3 and public/sfx/*.mp3 (gitignored too). Mixkit's free
# library has direct links: https://assets.mixkit.co/music/303/303.mp3 is the track,
# https://assets.mixkit.co/active_storage/sfx/<id>/<id>-preview.mp3 the effects
# (1491 whoosh, 2596 hit, 110 ding, 2863 win). The track is loudness-normalised (ffmpeg loudnorm I=-14).
# sent and bell are made with ffmpeg: sent = 0.35 s of pink noise through a 1.2 kHz bandpass; bell = sines 1047, 2491, 2890 Hz
# under a 9 Hz tremolo for 2.6 s, faded out.
# footage of the live app (public/footage, gitignored): run the app locally in its
# mainnet look, then step it a frame at a time into PNGs
VITE_FEED_OVERRIDES= VITE_FAUCET_AUTHORITY_BYTES= pnpm -F @stook/app dev   # in the repo root
node scripts/capture.mjs     # every shot; `node scripts/capture.mjs floor 3` for one shot, 3 s
# (the how* shots film the How page's drawings and play with them: a tap on a floor, the chips, the bell, the slider)
npx remotion studio          # preview
sh render.sh                 # the street cut, vertical and square → out/  (`sh render.sh Full FullVertical` for the old one)
cp out/stook-60s-vertical-web.mp4 ../../apps/stook/public/video/stook-60s.mp4   # the site's player (components/Watch.tsx)
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

The street cut keeps its own grid in `src/beats-street.json` (`ST` in `src/config.ts`): beat 24 is the
track's drop, 88-92 its silent bar; to re-time it, measure the new track (librosa's
`beat_track`), put the beats in `beatTimes` with the drop on 24, and move `B` in `src/Street.tsx`.

Without `public/music.mp3` every render is silent; `--props='{"track":"none"}'`
forces silence. Optional sound effects play with the music when present:
`public/sfx/{flap,stop,coins,bell}.(mp3|wav)`.

## The daily videos

`src/Daily.tsx`: 1080x1920, about 19 s, one for the bell and one for the morning.
Built by `scripts/daily-clips.sh`, rendered by `scripts/daily-render.mjs`.
`public-daily/` and `bundle-daily/` are not in git. Each video has its own track
from Mixkit (mixkit.co), by Arulo: bell "Trap" (305), morning "C.B.P.D" (400).
Sound effects are also Mixkit: 619, 2908, 1143, 2609, 444, 1045, 2719, 1490, 1457,
1993, 1989. Render with chrome-headless-shell (`DAILY_CHROME`): desktop Chrome
gives tiled, half-black frames.

## Notes

- If Remotion can't fetch its headless Chrome: `REMOTION_CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" sh render.sh`.
- The chat, the slams and the counters are `src/Street.tsx`; the coin, the anchor and the tower's prices are `src/brand.ts` (data from `src/data/poly.json`, `https://stookstreet.xyz/chart?coin=STOOK`).
- **License:** Remotion is free for individuals and companies of up to 3
  people; larger companies need a company license (https://www.remotion.dev/license).
  The track is Pixabay's "Retro Funk" (prettyjohn1); check Pixabay's license
  terms for paid ads before running it.
