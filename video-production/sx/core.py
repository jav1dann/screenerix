"""Shared constants, brand tokens, fonts, easing and the narration cue table."""
import json
import math
import os
from functools import lru_cache

from PIL import ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ASSETS = os.path.join(ROOT, 'video-assets')

W, H = 1920, 1080
FPS = 60
NF = 1800  # 30.000 s

# Brand tokens (src/lib/theme.ts, src/app/globals.css) and module colours from the repo.
C = {
    'bg': (11, 12, 14), 'panel': (17, 18, 21), 'line': (30, 32, 36), 'line2': (42, 45, 51),
    'text': (237, 238, 240), 'muted': (139, 141, 152), 'faint': (95, 98, 108),
    'up': (48, 164, 108), 'down': (229, 72, 77), 'alert': (245, 197, 66), 'mint': (127, 224, 176),
    'amber': (245, 165, 36),      # density size1 tier (DEFAULT_COLORING)
    'violet': (180, 140, 255),    # density size2 tier
    'forming': (229, 185, 49),    # STAGE_META.FORMING
    'entry': (62, 139, 255),      # LEVEL_COLORS.entry
    'toast': (26, 23, 16),        # alert toast bg #1A1710
    'tg_bubble': (24, 37, 51), 'tg_link': (106, 178, 242), 'tg_bg': (14, 22, 33),
}


def rgba(c, a=1.0):
    return (int(c[0]), int(c[1]), int(c[2]), int(max(0, min(1, a)) * 255 + 0.5))


def mix(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t + 0.5) for i in range(3))


@lru_cache(maxsize=4096)
def font(weight, size):
    """Archivo at `weight` (400–800), float `size` in device pixels (quantised to 1/4 px)."""
    return ImageFont.truetype(os.path.join(ASSETS, 'fonts', f'Archivo-{weight}.ttf'), max(1.0, size))


def fnt(weight, size):
    return font(weight, round(size * 4) / 4)


# ── easing ──

def clamp(x, a=0.0, b=1.0):
    return a if x < a else b if x > b else x


def seg(f, a, b):
    """Progress 0..1 of frame `f` through [a, b]."""
    if b <= a:
        return 1.0 if f >= b else 0.0
    return clamp((f - a) / (b - a))


def lerp(a, b, t):
    return a + (b - a) * t


def smooth(t):
    t = clamp(t)
    return t * t * (3 - 2 * t)


def in_out(t):  # cubic
    t = clamp(t)
    return 4 * t * t * t if t < 0.5 else 1 - (-2 * t + 2) ** 3 / 2


def out_cubic(t):
    t = clamp(t)
    return 1 - (1 - t) ** 3


def out_expo(t):
    t = clamp(t)
    return 1.0 if t >= 1 else 1 - 2 ** (-10 * t)


def in_cubic(t):
    t = clamp(t)
    return t * t * t


def in_out_quint(t):
    t = clamp(t)
    return 16 * t ** 5 if t < 0.5 else 1 - (-2 * t + 2) ** 5 / 2


@lru_cache(maxsize=None)
def _bezier_table(x1, y1, x2, y2, n=2048):
    xs, ys = [], []
    for i in range(n + 1):
        u = i / n
        a, b = 3 * (1 - u) ** 2 * u, 3 * (1 - u) * u * u
        xs.append(a * x1 + b * x2 + u ** 3)
        ys.append(a * y1 + b * y2 + u ** 3)
    return xs, ys


def bezier(t, x1, y1, x2, y2):
    """CSS cubic-bezier easing."""
    t = clamp(t)
    xs, ys = _bezier_table(x1, y1, x2, y2)
    lo, hi = 0, len(xs) - 1
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if xs[mid] < t:
            lo = mid
        else:
            hi = mid
    span = xs[hi] - xs[lo] or 1
    return ys[lo] + (ys[hi] - ys[lo]) * (t - xs[lo]) / span


def brand(t):
    """The site's entrance curve: cubic-bezier(.2,.7,.2,1) (landing.css .lx-rise)."""
    return bezier(t, 0.2, 0.7, 0.2, 1.0)


def glide(t):
    """Camera travel: gentle start, long settle."""
    return bezier(t, 0.45, 0.0, 0.15, 1.0)


def spring(t, freq=2.2, damp=5.0):
    """Damped impulse response, 0 at t<=0, decays to 0 (for kicks). `t` in seconds."""
    if t <= 0:
        return 0.0
    return math.exp(-damp * t) * math.sin(2 * math.pi * freq * t)


def settle(t, freq=1.6, damp=6.0):
    """Step response 0→1 with a soft overshoot. `t` in seconds."""
    if t <= 0:
        return 0.0
    return 1 - math.exp(-damp * t) * math.cos(2 * math.pi * freq * t)


# ── narration cues (video-assets/timeline/vo-timing.json) ──

with open(os.path.join(ASSETS, 'timeline', 'vo-timing.json')) as fh:
    VO = json.load(fh)
WORDS = VO['words']


def wf(i):
    """Onset frame of word index `i` in the 58-word script."""
    return WORDS[i]['f_in']


def wo(i):
    return WORDS[i]['f_out']


CUE = {
    'thousands': wf(0), 'six': wf(3), 'exchanges': wf(4), 'one': wf(5), 'wheres': wf(7), 'move': wf(9),
    'screenerix': wf(10), 'map': wf(16), 'every': wf(17), 'live': wf(19), 'ranked': wf(20), 'moves': wf(23),
    'order': wf(24), 'walls': wf(26), 'sized': wf(27), 'tracked': wf(28), 'timed': wf(29),
    'volume': wf(31), 'spike': wf(32), 'caught': wf(33), 'starts': wf(36), 'setup': wf(38), 'forming': wf(40),
    'to': wf(41), 'active': wf(42), 'moment': wf(44), 'know': wf(48), 'market2': wf(50), 'seconds': wf(53),
    'so': wf(54), 'you': wf(56), 'brand': wf(57), 'brand_end': wo(57),
}


# ── formatters (src/lib/format.ts) ──

def fmt_price(p):
    if p >= 1000:
        return f'{p:,.2f}'
    if p >= 10:
        return f'{p:.2f}'
    if p >= 1:
        return f'{p:.4f}'
    if p >= 0.01:
        return f'{p:.5f}'
    return f'{p:.4g}'


def fmt_pct(x, d=2):
    return f"{'+' if x >= 0 else '-'}{abs(x * 100):.{d}f}%"


def fmt_usd(v):
    if v >= 1e9:
        return f'${v / 1e9:.2f}B'
    if v >= 1e6:
        return f'${v / 1e6:.1f}M'
    if v >= 1e3:
        return f'${v / 1e3:.0f}K'
    return f'${v:.0f}'


class Rng:
    """Park–Miller PRNG, the same generator as createRng() in src/lib/format.ts."""

    def __init__(self, seed):
        self.s = (seed % 2147483646) + 1

    def __call__(self):
        self.s = (self.s * 16807) % 2147483647
        return (self.s - 1) / 2147483646
