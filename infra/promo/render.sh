#!/bin/sh
# Renders the six ads into out/: full length (68 s), 15 s, 6 s; square and vertical.
# Silent unless public/music.mp3 is there (then it plays, with any public/sfx/*).
# The 68 s files are re-encoded at crf 27 afterwards to keep them near X-friendly sizes.
#   sh render.sh                       all six
#   sh render.sh Full FullVertical     only these compositions
cd "$(dirname "$0")" && mkdir -p out
name() { case "$1" in Street) echo stook-60s-vertical ;; StreetSquare) echo stook-60s-square ;; Full) echo stook-68s-square ;; FullVertical) echo stook-68s-vertical ;; Square) echo stook-15s-square ;; Vertical) echo stook-15s-vertical ;; Square6) echo stook-6s-square ;; Vertical6) echo stook-6s-vertical ;; esac; }
for comp in ${*:-Street StreetSquare}; do
  out="out/$(name "$comp").mp4"
  npx remotion render src/index.ts "$comp" "$out" --log=error --crf 18 --concurrency 3
  case "$comp" in Full*)
    ffmpeg -v error -y -i "$out" -c:v libx264 -preset slow -crf 27 -pix_fmt yuv420p -c:a copy -movflags +faststart "$out.tmp.mp4" && mv "$out.tmp.mp4" "$out" ;;
  Street*)
    # the master at crf 18 as rendered; a web copy for the site's player (apps/stook/public/video) at crf 27 (about 13 MB, under the Worker asset limit)
    ffmpeg -v error -y -i "$out" -c:v libx264 -preset slow -crf 27 -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart "out/$(name "$comp")-web.mp4" ;;
  esac
done
