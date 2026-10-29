#!/usr/bin/env bash
# Render the film in 300-frame chunks (re-render one chunk after a fix), then join losslessly.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p out/chunks
for start in ${CHUNKS:-0 300 600 900 1200 1500}; do
  end=$((start + 300))
  python3 render.py --from "$start" --to "$end" --out "out/chunks/c_$(printf %04d "$start").mp4"
done
ls out/chunks/c_*.mp4 | sort | sed "s/^out\/chunks\//file '/; s/$/'/" > out/chunks/list.txt
ffmpeg -v error -y -f concat -safe 0 -i out/chunks/list.txt -c copy out/picture.mp4
echo out/picture.mp4
