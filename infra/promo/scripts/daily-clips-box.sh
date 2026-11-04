#!/bin/bash
# On the box: the two full videos with sample numbers, cut into the clips around the numbers, and their sound.
set -euo pipefail
cd ~/stook-daily; mkdir -p clips
export DAILY_CHROME=$HOME/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux-arm64/chrome-headless-shell
FF=$HOME/bin/ffmpeg
echo '{}' > props-sample.json
for k in bell morning; do
  C=$([ "$k" = bell ] && echo DailyBell || echo DailyMorning)
  node daily-render.mjs "$C" props-sample.json "clips/$k-full.mp4"
  from=$(python3 -c "import json;print(json.load(open('cuts.json'))['$k']['from'])"); to=$(python3 -c "import json;print(json.load(open('cuts.json'))['$k']['to'])")
  $FF -v error -y -i "clips/$k-full.mp4" -vf "trim=end_frame=$from,setpts=PTS-STARTPTS" -an -c:v libx264 -preset medium -crf 16 -pix_fmt yuv420p -r 30 "clips/$k-head.mp4"
  $FF -v error -y -i "clips/$k-full.mp4" -vf "trim=start_frame=$((to + 1)),setpts=PTS-STARTPTS" -an -c:v libx264 -preset medium -crf 16 -pix_fmt yuv420p -r 30 "clips/$k-tail.mp4"
  $FF -v error -y -i "clips/$k-full.mp4" -vn -af loudnorm=I=-14:TP=-1:LRA=11 -c:a aac -b:a 256k -ar 48000 "clips/$k.m4a"
  rm -f "clips/$k-full.mp4"
  echo "$k done $(date -u +%T)"
done
echo finished
