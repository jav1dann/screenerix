"""Supersampled drawing surface in world (camera) or screen coordinates, with a parallel glow buffer."""
import os
from contextlib import contextmanager
from functools import lru_cache

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from .core import ASSETS, C, H, W, fnt

GLOW_SS = 0.5  # glow buffer resolution relative to output


@lru_cache(maxsize=None)
def logo_src(name):
    return Image.open(os.path.join(ASSETS, 'logos', f'{name}.png')).convert('RGBA')


@lru_cache(maxsize=2048)
def _sized(name, px, blur):
    im = logo_src(name) if isinstance(name, str) else name
    im = im.resize((px, px), Image.LANCZOS)
    if blur:
        im = im.filter(ImageFilter.GaussianBlur(blur))
    return im


def tw(s, size, weight=400, tracking=0.0):
    """Text advance in world units (zoom independent)."""
    f = fnt(weight, size * 8)
    return f.getlength(s, features=['tnum']) / 8 + tracking * size * max(0, len(s) - 1)


class Canvas:
    def __init__(self, cam, ss=2.0, ov=1.0):
        self.cam, self.ss, self.ov = cam, ss, ov
        self.cw, self.ch = int(round(W * ov * ss)), int(round(H * ov * ss))
        self.img = Image.new('RGB', (self.cw, self.ch), C['bg'])
        self.d = ImageDraw.Draw(self.img, 'RGBA')
        self.gw, self.gh = int(W * ov * GLOW_SS), int(H * ov * GLOW_SS)
        self.glow = Image.new('RGB', (self.gw, self.gh), (0, 0, 0))
        self.gd = ImageDraw.Draw(self.glow, 'RGBA')
        self.a = 1.0
        self._screen = False

    # ── transforms ──
    @contextmanager
    def opacity(self, a):
        prev = self.a
        self.a = prev * max(0.0, min(1.0, a))
        try:
            yield
        finally:
            self.a = prev

    @contextmanager
    def screen(self):
        prev = self._screen
        self._screen = True
        try:
            yield
        finally:
            self._screen = prev

    def scale(self):
        return 1.0 if self._screen else self.cam.zoom

    def P(self, x, y, k=None):
        """Point → canvas px (k = pixel scale; ss for the main image)."""
        k = self.ss if k is None else k
        if self._screen:
            return (x + W * (self.ov - 1) / 2) * k, (y + H * (self.ov - 1) / 2) * k
        z = self.cam.zoom
        return ((x - self.cam.cx) * z + W * self.ov / 2) * k, ((y - self.cam.cy) * z + H * self.ov / 2) * k

    def L(self, v, k=None):
        return v * self.scale() * (self.ss if k is None else k)

    def visible(self, x0, y0, x1, y1, pad=0):
        a, b = self.P(x0, y0)
        c, d = self.P(x1, y1)
        p = pad * self.ss
        return not (c < -p or a > self.cw + p or d < -p or b > self.ch + p)

    def _pm(self, c, a):
        k = max(0.0, min(1.0, a * self.a))
        return (int(c[0] * k), int(c[1] * k), int(c[2] * k))

    def _col(self, c, a):
        return (int(c[0]), int(c[1]), int(c[2]), int(max(0.0, min(1.0, a * self.a)) * 255 + 0.5))

    # ── primitives ──
    def rect(self, x0, y0, x1, y1, fill=None, outline=None, r=0, w=1.0, a=1.0, oa=None):
        if self.a * a <= 0.002 or not self.visible(x0, y0, x1, y1, 4):
            return
        p0, p1 = self.P(x0, y0), self.P(x1, y1)
        if p1[0] - p0[0] < 0.5 or p1[1] - p0[1] < 0.5:
            return
        rr = self.L(r)
        ww = max(1, int(round(self.L(w)))) if outline else 0
        kw = dict(fill=self._col(fill, a) if fill else None)
        if outline:
            kw.update(outline=self._col(outline, a if oa is None else oa), width=ww)
        box = (p0[0], p0[1], max(p0[0], p1[0] - 1), max(p0[1], p1[1] - 1))
        if rr >= 1:
            self.d.rounded_rectangle(box, min(rr, (p1[0] - p0[0]) / 2, (p1[1] - p0[1]) / 2), **kw)
        else:
            self.d.rectangle(box, **kw)

    def line(self, pts, color, w=1.0, a=1.0):
        if self.a * a <= 0.002 or len(pts) < 2:
            return
        q = [self.P(x, y) for x, y in pts]
        self.d.line(q, fill=self._col(color, a), width=max(1, int(round(self.L(w)))), joint='curve')

    def poly(self, pts, fill, a=1.0, outline=None, w=1.0):
        if self.a * a <= 0.002:
            return
        q = [self.P(x, y) for x, y in pts]
        self.d.polygon(q, fill=self._col(fill, a) if fill else None,
                       outline=self._col(outline, a) if outline else None, width=max(1, int(round(self.L(w)))) if outline else 0)

    def circle(self, x, y, r, fill=None, outline=None, w=1.0, a=1.0):
        if self.a * a <= 0.002:
            return
        cx, cy = self.P(x, y)
        rr = max(0.6, self.L(r))
        self.d.ellipse((cx - rr, cy - rr, cx + rr, cy + rr), fill=self._col(fill, a) if fill else None,
                       outline=self._col(outline, a) if outline else None, width=max(1, int(round(self.L(w)))) if outline else 0)

    def text_w(self, s, size, weight=400, tracking=0.0):
        return tw(s, size, weight, tracking)

    def text(self, x, y, s, size, weight=400, color=C['text'], a=1.0, anchor='ls', tracking=0.0):
        """Text at world/screen (x, y). anchor: Pillow anchor (l/m/r + a/t/m/s/b). tracking in em."""
        if self.a * a <= 0.002 or not s:
            return
        px = self.L(size)
        if px < 1.2:
            return
        f = fnt(weight, px)
        X, Y = self.P(x, y)
        if not (-px * len(s) < X < self.cw + px * len(s) and -px * 2 < Y < self.ch + px * 2):
            return
        col = self._col(color, a)
        if tracking == 0:
            self._text(X, Y, s, f, col, anchor)
            return
        total = f.getlength(s, features=['tnum']) + tracking * px * (len(s) - 1)
        if anchor[0] == 'm':
            X -= total / 2
        elif anchor[0] == 'r':
            X -= total
        for ch in s:
            self._text(X, Y, ch, f, col, 'l' + anchor[1])
            X += f.getlength(ch, features=['tnum']) + tracking * px

    def _text(self, X, Y, s, f, col, anchor):
        """Pillow ignores ink alpha for text on RGB, so paste the colour through an alpha-scaled glyph mask."""
        if col[3] >= 254:
            self.d.text((X, Y), s, font=f, fill=col[:3], anchor=anchor, features=['tnum'])
            return
        x0, y0, x1, y1 = f.getbbox(s, anchor=anchor, features=['tnum'])
        if x1 <= x0 or y1 <= y0:
            return
        fx, fy = X - int(X), Y - int(Y)
        m = Image.new('L', (x1 - x0 + 2, y1 - y0 + 2), 0)
        ImageDraw.Draw(m).text((fx - x0, fy - y0), s, font=f, fill=col[3], anchor=anchor, features=['tnum'])
        self.img.paste(col[:3], (int(X) + x0, int(Y) + y0), m)

    def sprite(self, name, x, y, size, a=1.0, blur=0):
        """Square logo sprite (video-assets/logos/<name>.png) with top-left at (x, y), `size` world units."""
        if self.a * a <= 0.002:
            return
        px = int(round(self.L(size)))
        if px < 2 or not self.visible(x, y, x + size, y + size):
            return
        im = _sized(name, px, blur)
        X, Y = self.P(x, y)
        self.paste(im, int(round(X)), int(round(Y)), a)

    def paste(self, im, X, Y, a=1.0):
        aa = a * self.a
        if aa <= 0.002:
            return
        alpha = im.getchannel('A')
        if aa < 0.999:
            alpha = alpha.point(lambda v: int(v * aa))
        self.img.paste(im.convert('RGB'), (X, Y), alpha)

    # ── glow buffer (half resolution, additive light) ──
    def glow_circle(self, x, y, r, color, a=1.0):
        if self.a * a <= 0.002:
            return
        cx, cy = self.P(x, y, GLOW_SS)
        rr = max(0.8, self.L(r, GLOW_SS))
        self.gd.ellipse((cx - rr, cy - rr, cx + rr, cy + rr), fill=self._col(color, a))

    def glow_rect(self, x0, y0, x1, y1, color, a=1.0, r=0):
        if self.a * a <= 0.002:
            return
        p0, p1 = self.P(x0, y0, GLOW_SS), self.P(x1, y1, GLOW_SS)
        if p1[0] - p0[0] < 0.5 or p1[1] - p0[1] < 0.5:
            return
        rr = self.L(r, GLOW_SS)
        box = (p0[0], p0[1], p1[0], p1[1])
        if rr >= 1:
            self.gd.rounded_rectangle(box, min(rr, (p1[0] - p0[0]) / 2, (p1[1] - p0[1]) / 2), fill=self._col(color, a))
        else:
            self.gd.rectangle(box, fill=self._col(color, a))

    def glow_line(self, pts, color, w=1.0, a=1.0):
        if self.a * a <= 0.002:
            return
        q = [self.P(x, y, GLOW_SS) for x, y in pts]
        self.gd.line(q, fill=self._col(color, a), width=max(1, int(round(self.L(w, GLOW_SS)))), joint='curve')

    def glow_poly(self, pts, color, a=1.0):
        if self.a * a <= 0.002:
            return
        self.gd.polygon([self.P(x, y, GLOW_SS) for x, y in pts], fill=self._col(color, a))

    def glow_text(self, x, y, s, size, weight, color, a=1.0, anchor='ls', tracking=0.0):
        px = self.L(size, GLOW_SS)
        if px < 1 or self.a * a <= 0.002:
            return
        f = fnt(weight, px)
        X, Y = self.P(x, y, GLOW_SS)
        if tracking == 0:
            self.gd.text((X, Y), s, font=f, fill=self._pm(color, a), anchor=anchor, features=['tnum'])
            return
        total = f.getlength(s, features=['tnum']) + tracking * px * (len(s) - 1)
        if anchor[0] == 'm':
            X -= total / 2
        elif anchor[0] == 'r':
            X -= total
        for ch in s:
            self.gd.text((X, Y), ch, font=f, fill=self._pm(color, a), anchor='l' + anchor[1], features=['tnum'])
            X += f.getlength(ch, features=['tnum']) + tracking * px

    def arrays(self):
        return np.asarray(self.img), np.asarray(self.glow)
