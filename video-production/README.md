# Screenerix launch film — code-generated production

A 30-second, 1920×1080, 60 fps product film rendered entirely from code (Python, Pillow, NumPy,
OpenCV, SciPy, FFmpeg). It is isolated from the web app: nothing here is imported by `src/`.

## Sources of truth

- Brand tokens, logo geometry, component layouts: the repo (`src/lib/theme.ts`, `ScreenerixLogo.tsx`,
  `Chart.tsx`, `ChartHeader.tsx`, `Densities.tsx`, `strategies/parts.tsx`, `AlertsHost.tsx`, …).
- Narration timing: `video-assets/timeline/vo-timing.json` (forced alignment of the approved take,
  tightened edit placed at a 0.5 s offset). Every visual and sound cue is keyed to a word onset (`sx.core.CUE`).
- Fonts: Archivo TTFs (`video-assets/fonts`). Logos: rasterised from `src/components/shared/brand/logos.ts`.
  Icons: lucide-static (the set behind `lucide-react`).

## Pipeline

| Step | Command | Output |
|---|---|---|
| Stills for review | `python3 render.py --stills 389 782 973` | `out/stills/` |
| Picture (chunked) | `./render_chunks.sh` (`CHUNKS="300" ./render_chunks.sh` re-renders one) | `out/picture.mp4` |
| Sound design | `python3 sfx.py` | `out/sfx.wav` |
| Mix (VO + SFX, no music) | `python3 mix.py` | `out/mix.wav` (−14 LUFS, −1 dBTP) |
| Master | `./master.sh` | `video-assets/video/screenerix-launch.mp4` |

Every frame is a pure function of its index, so frames render in parallel and re-renders are
deterministic.

## Engine (`sx/`)

- `camera.py` — 2.5D camera (pan, log-space zoom, pitch/roll homography), monotone-spline path.
- `canvas.py` — 2× supersampled drawing in world or screen space, alpha-correct text, glow buffer.
- `ui.py` — the product components (chart card, density card, formation card, toast, chip, header, logo).
- `act1.py` — the 3D ticker field, exchange ignitions and the WIF highlight.
- `world.py` — Market Map, Densities morph, the spike, Strategies, alerts.
- `frame.py` — the signal path, candles → logo end card, compositing (warp, bloom, 180° motion blur, grain).
