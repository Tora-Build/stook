# @stook/promo

Stook Street's 15-second ad for X, made with [Remotion](https://www.remotion.dev)
(React components rendered to video). Two cuts of one ad: square 1080×1080 and
vertical 1080×1920, 30 fps, H.264 / yuv420p.

The art is the site's own: the skyline is `apps/stook/public/city.js` ported to
`src/city.ts` (same seed, buildings, exchange, cars), the tower and its taxi,
bell and flag come from `apps/stook/src/components/Tower.tsx`. The tower beat is
labelled ILLUSTRATION: its numbers show the mechanic, not a real round.

Beats (`src/Ad.tsx`, `BEATS`): hook 0–2.2 s, the four tables 2.2–5 s, the call
on the tower 5–9 s (`src/TowerScene.tsx`), the bell 9–12 s (`src/BellScene.tsx`),
the end card 12–15 s.

```sh
npm install                 # standalone: not part of the pnpm workspace
npx remotion studio         # preview with a timeline, both compositions
npm run render:square       # → out/stook-15s-square.mp4
npm run render:vertical     # → out/stook-15s-vertical.mp4
npm run render              # both
sh stills.sh [frame ...]    # quick PNG stills of each beat (default 30 120 225 330 420)
sh check.sh                 # after a render: codec, size, length, and stills at 1/6/10/14 s
```

`out/` is not committed.

**Music.** Drop a track at `public/music.mp3` and it plays under the ad, faded in
and out; without it the render is silent. Use a track licensed for paid social
ads (Epidemic Sound, Artlist, or an AI-music plan that covers commercial use).

**Chrome.** Remotion downloads its own headless Chrome on first render. If that
fails, point it at one on the machine:
`REMOTION_CHROME=/path/to/chrome npx remotion render …` (see `remotion.config.ts`).

**License.** Remotion is free for individuals and for companies of up to 3
people; a larger company needs a Remotion company license
(https://www.remotion.dev/license).
