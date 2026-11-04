#!/bin/bash
# Prepares ~/stook-daily on the box: the bundle goes up, then the box renders the
# clips around the numbers and the mixed sound itself (about 20 minutes, once;
# a home upload of the clips takes far longer). Headless shell only: desktop
# Chrome tiled frames.
#   sh scripts/daily-clips.sh
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -c "
import json;g=json.load(open('src/beats-daily.json'));o={}
for k,v in g.items():
  b=lambda n:round((v['beatTimes'][n]-v['beatTimes'][0])*30);o[k]={'from':b(16),'to':b(28)-1,'total':b(44)+30}
print(json.dumps(o))" > out/cuts.json
npx remotion bundle src/index.ts --public-dir=public-daily --out-dir=bundle-daily --log=error
rsync -az --delete bundle-daily/ tora:stook-daily/bundle-daily/
scp -q out/cuts.json scripts/daily-render.mjs scripts/daily-clips-box.sh tora:stook-daily/
ssh tora 'nohup nice -n 10 bash ~/stook-daily/daily-clips-box.sh > ~/stook-daily/clips.log 2>&1 &'
