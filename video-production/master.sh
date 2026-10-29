#!/usr/bin/env bash
# Mux the rendered picture with the VO+SFX mix into the delivery MP4 and a lightweight preview.
set -euo pipefail
cd "$(dirname "$0")"
DEST=../video-assets/video
mkdir -p "$DEST"
ffmpeg -v error -y -i out/picture.mp4 -i out/mix.wav -map 0:v:0 -map 1:a:0 -c:v copy \
  -c:a aac -b:a 320k -ar 48000 -ac 2 -shortest -movflags +faststart \
  -metadata title="Screenerix — The market moves in seconds" "$DEST/screenerix-launch.mp4"
ffmpeg -v error -y -i "$DEST/screenerix-launch.mp4" -vf "scale=960:-2" -r 30 -c:v libx264 -preset slow -crf 23 \
  -pix_fmt yuv420p -c:a aac -b:a 160k -movflags +faststart "$DEST/screenerix-launch-preview.mp4"
ls -la "$DEST"
