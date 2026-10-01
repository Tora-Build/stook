#!/bin/sh
# Stills of chosen frames into out/stills/ (to check a cut without rendering it).
#   sh stills.sh [frame ...]                         15 s ad, both formats (default 30 120 250 325 420)
#   COMPS="Square6 Vertical6" sh stills.sh 30 115 165
cd "$(dirname "$0")" && mkdir -p out/stills
FRAMES=${*:-"30 120 250 325 420"}
for comp in ${COMPS:-Square Vertical}; do
  for fr in $FRAMES; do
    npx remotion still src/index.ts "$comp" "out/stills/$comp-$fr.png" --frame="$fr" --log=error
  done
done
