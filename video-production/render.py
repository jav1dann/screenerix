#!/usr/bin/env python3
"""Render the Screenerix launch film (or a slice of it).

  python3 render.py --stills 389 782 973          # PNG stills to out/stills/
  python3 render.py --from 700 --to 1000 --out out/test.mp4
  python3 render.py --out out/picture.mp4          # all 1800 frames
"""
import argparse
import os
import subprocess
import sys
import time
from multiprocessing import Pool

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from PIL import Image  # noqa: E402

from sx.core import FPS, H, NF, W  # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out')


def _render(f):
    from sx.frame import render
    return f, render(f).tobytes()


def stills(frames, scale):
    os.makedirs(os.path.join(OUT, 'stills'), exist_ok=True)
    from sx.frame import render
    for f in frames:
        t = time.time()
        im = Image.fromarray(render(f))
        if scale != 1:
            im = im.resize((int(W * scale), int(H * scale)), Image.LANCZOS)
        p = os.path.join(OUT, 'stills', f'f{f:04d}.png')
        im.save(p)
        print(f'{p}  {time.time() - t:.2f}s', flush=True)


def video(f0, f1, path, workers, crf):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    cmd = ['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
           '-c:v', 'libx264', '-preset', 'slow', '-crf', str(crf), '-pix_fmt', 'yuv420p', '-tune', 'film',
           '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-movflags', '+faststart', path]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    t0 = time.time()
    frames = list(range(f0, f1))
    done = 0
    with Pool(workers) as pool:
        for f, buf in pool.imap(_render, frames, chunksize=2):
            proc.stdin.write(buf)
            done += 1
            if done % 30 == 0 or done == len(frames):
                el = time.time() - t0
                print(f'frame {f}  {done}/{len(frames)}  {el:.0f}s elapsed  eta {el / done * (len(frames) - done):.0f}s', flush=True)
    proc.stdin.close()
    if proc.wait() != 0:
        raise SystemExit('ffmpeg failed')
    print(path)


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--stills', type=int, nargs='*')
    ap.add_argument('--scale', type=float, default=1.0)
    ap.add_argument('--from', dest='f0', type=int, default=0)
    ap.add_argument('--to', dest='f1', type=int, default=NF)
    ap.add_argument('--out', default=os.path.join(OUT, 'picture.mp4'))
    ap.add_argument('--workers', type=int, default=os.cpu_count() or 4)
    ap.add_argument('--crf', type=int, default=14)
    a = ap.parse_args()
    if a.stills:
        stills(a.stills, a.scale)
    else:
        video(a.f0, a.f1, a.out, a.workers, a.crf)
