#!/bin/sh
# Stills of each beat, both formats, into out/stills/ (to check a cut without rendering it).
#   sh stills.sh [frame ...]     default: 30 120 225 330 420
cd "$(dirname "$0")" && mkdir -p out/stills
FRAMES=${*:-"30 120 225 330 420"}
for comp in Square Vertical; do
  for fr in $FRAMES; do
    npx remotion still src/index.ts "$comp" "out/stills/$comp-$fr.png" --frame="$fr" --log=error
  done
done
