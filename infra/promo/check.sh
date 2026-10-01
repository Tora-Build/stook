#!/bin/sh
# After a render: each MP4's codec, pixel format, size, frame rate, length and
# file size, and a still at 1, 6, 10 and 14 s into out/stills/.
cd "$(dirname "$0")/out" && mkdir -p stills
for v in square vertical; do
  f="stook-15s-$v.mp4"; [ -f "$f" ] || continue
  printf '%s: ' "$f"; ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,pix_fmt,width,height,r_frame_rate -show_entries format=duration,size -of csv=p=0 "$f" | tr '\n' ' '; echo
  for t in 1 6 10 14; do ffmpeg -v error -y -ss "$t" -i "$f" -frames:v 1 "stills/mp4-$v-${t}s.png"; done
done
