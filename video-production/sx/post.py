"""Compositing: glow (bloom from an emissive buffer), camera motion blur, vignette, grain, screen-space overlays."""
from functools import lru_cache

import cv2
import numpy as np
from PIL import Image, ImageDraw

from .core import C, H, W

BG = np.array(C['bg'], dtype=np.float32) / 255.0


@lru_cache(maxsize=1)
def vignette():
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)
    d = np.sqrt(((x - W / 2) / (W * 0.62)) ** 2 + ((y - H / 2) / (H * 0.62)) ** 2)
    v = 1.0 - 0.32 * np.clip(d - 0.35, 0, None) ** 1.6
    return np.clip(v, 0.6, 1.0)[..., None]


def add_glow(img, glow_half, strength=1.0):
    """img float32 HxWx3 (0..1); glow_half uint8 (H/2 × W/2 × 3), already in screen space."""
    if glow_half is None or strength <= 0:
        return img
    g = glow_half.astype(np.float32) / 255.0
    if g.max() < 0.004:
        return img
    tight = cv2.GaussianBlur(g, (0, 0), 3.0)
    wide = cv2.GaussianBlur(g, (0, 0), 14.0)
    halo = cv2.GaussianBlur(g, (0, 0), 40.0)
    light = tight * 0.85 + wide * 0.75 + halo * 0.5
    light = cv2.resize(light, (W, H), interpolation=cv2.INTER_LINEAR) * strength
    return 1.0 - (1.0 - img) * (1.0 - np.clip(light, 0, 1))


def motion_blur(img, A, samples=7):
    """Average `img` along the affine screen motion A (2×3, maps t-½ → t+½ positions)."""
    I = np.array([[1, 0, 0], [0, 1, 0]], dtype=np.float64)
    D = (A - I) * 0.5  # 180° shutter
    # magnitude: displacement of the frame corners
    corners = np.array([[0, 0, 1], [W, 0, 1], [0, H, 1], [W, H, 1], [W / 2, H / 2, 1]], dtype=np.float64).T
    disp = np.abs(D @ corners).max()
    if disp < 2.5:
        return img
    n = int(min(15, max(3, samples * disp / 30)))
    acc = np.zeros_like(img)
    for k in range(n):
        s = (k / (n - 1)) - 0.5
        M = I + D * s
        acc += cv2.warpAffine(img, M.astype(np.float32), (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    return acc / n


def finish(img, f, grain=0.0075):
    img = img * vignette() + BG * (1 - vignette()) * 0.5
    rng = np.random.default_rng(1000 + f)
    n = rng.standard_normal((H // 2, W // 2), dtype=np.float32)
    n = cv2.resize(n, (W, H), interpolation=cv2.INTER_LINEAR)[..., None] * grain
    img = img + n * (0.45 + 2.2 * img * (1 - img))  # strongest in the mid-tones; blacks and whites stay clean
    return np.clip(img * 255.0 + 0.5, 0, 255).astype(np.uint8)


class Overlay:
    """Screen-space drawing over the composited frame (2× supersampled band-limited)."""

    def __init__(self):
        self.ss = 2
        self.img = Image.new('RGBA', (W * self.ss, H * self.ss), (0, 0, 0, 0))
        self.d = ImageDraw.Draw(self.img)
        self.glow = Image.new('RGB', (W // 2, H // 2), (0, 0, 0))
        self.gd = ImageDraw.Draw(self.glow, 'RGBA')
        self.used = False
        self.gused = False

    def _c(self, c, a):
        return (int(c[0]), int(c[1]), int(c[2]), int(max(0, min(1, a)) * 255))

    def dot(self, x, y, r, color, a=1.0):
        if a <= 0.003 or r <= 0:
            return
        s = self.ss
        # stacking on an RGBA layer: draw into a temp only when needed — approximate with max-alpha draw
        self.d.ellipse((x * s - r * s, y * s - r * s, x * s + r * s, y * s + r * s), fill=self._c(color, a))
        self.used = True

    def line(self, pts, color, w, a=1.0):
        if a <= 0.003 or len(pts) < 2:
            return
        s = self.ss
        self.d.line([(x * s, y * s) for x, y in pts], fill=self._c(color, a), width=max(1, int(w * s)), joint='curve')
        self.used = True

    def ring(self, x, y, r, color, w, a=1.0):
        if a <= 0.003:
            return
        s = self.ss
        self.d.ellipse((x * s - r * s, y * s - r * s, x * s + r * s, y * s + r * s), outline=self._c(color, a), width=max(1, int(w * s)))
        self.used = True

    def glow_dot(self, x, y, r, color, a=1.0):
        if a <= 0.003:
            return
        self.gd.ellipse((x / 2 - r / 2, y / 2 - r / 2, x / 2 + r / 2, y / 2 + r / 2), fill=self._c(color, a))
        self.gused = True

    def glow_line(self, pts, color, w, a=1.0):
        if a <= 0.003 or len(pts) < 2:
            return
        self.gd.line([(x / 2, y / 2) for x, y in pts], fill=self._c(color, a), width=max(1, int(w / 2)), joint='curve')
        self.gused = True

    def composite(self, img):
        if self.gused:
            img = add_glow(img, np.asarray(self.glow), 1.0)
        if self.used:
            o = np.asarray(self.img.resize((W, H), Image.LANCZOS)).astype(np.float32) / 255.0
            a = o[..., 3:4]
            img = img * (1 - a) + o[..., :3] * a
        return img
