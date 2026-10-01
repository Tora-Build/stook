#!/bin/sh
# After a render: each MP4's codec, size, frame rate, length, file size and
# whether it has sound; stills at 1, 6, 10 and 14 s (1, 3, 5 s for the 6 s cut).
cd "$(dirname "$0")/out" && mkdir -p stills
for f in stook-*.mp4; do
  [ -f "$f" ] || continue
  v=$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,pix_fmt,width,height,r_frame_rate -of csv=p=0 "$f")
  d=$(ffprobe -v error -show_entries format=duration,size -of csv=p=0 "$f")
  a=$(ffprobe -v error -select_streams a -show_entries stream=codec_name -of csv=p=0 "$f")
  echo "$f: $v $d audio=${a:-none}"
  case "$f" in *chiptune*) continue ;; esac
  case "$f" in *6s*) T="1 3 5" ;; *68s*) T="5 9.4 15 22 30 40 48 56 64" ;; *) T="1 6 10 14" ;; esac
  for t in $T; do ffmpeg -v error -y -ss "$t" -i "$f" -frames:v 1 "stills/mp4-${f%.mp4}-${t}s.png"; done
done
