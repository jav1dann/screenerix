"""Act I — the noise: a 3D field of live tickers, six exchanges igniting, one coin answering 'where's the move?'."""
import math
from functools import lru_cache

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from .core import C, CUE, H, W, clamp, fmt_pct, fmt_price, fnt, in_out, lerp, out_cubic, seg, settle, smooth
from . import data as D

FOC = 820.0
N = 2600
ZFAR = 5200.0
WIF_ID = -1

_rs = np.random.RandomState(20261029)
PX = _rs.uniform(-2100, 2100, N)
PY = _rs.uniform(-1250, 1250, N)
PZ = _rs.uniform(90, ZFAR + 2600, N)
VX = _rs.normal(0, 1.0, N)
VY = _rs.normal(0, 0.6, N)
KIND = _rs.choice(3, N, p=[0.45, 0.33, 0.22])  # up / down / neutral
IS_LABEL = _rs.uniform(0, 1, N) < 0.13
# keep a clear channel through the centre so the signal reads
_r = np.hypot(PX, PY)
PX = np.where(_r < 140, PX * 3.2, PX)

EXTRA = ['ARKM', 'ORDI', 'STRK', 'BLUR', 'GALA', 'AAVE', 'UNI', 'LDO', 'MKR', 'IMX', 'POL', 'FIL', 'ICP', 'HBAR',
         'ATOM', 'ALGO', 'KAS', 'JASMY', 'BONK', 'FLOKI', 'TRX', 'LTC', 'BCH', 'ETC', 'RUNE', 'PYTH', 'ZRO', 'NOT',
         'EIGEN', 'AERO', 'TAO', 'STX', 'DYDX', 'GMX', 'CRV', 'SAND', 'MANA', 'AXS', 'CFX', 'MINA']
POOL = [c[0] for c in D.COINS if c[0] != 'WIF'] + EXTRA


@lru_cache(maxsize=None)
def label_text(i):
    r = D.Rng(1000 + i)
    sym = POOL[i % len(POOL)]
    p = D.PRICE.get(sym, 0.05 + r() * 60)
    ch = (r() - 0.45) * 0.14
    return sym, fmt_price(p), fmt_pct(ch), ch >= 0


@lru_cache(maxsize=None)
def label_sprite(i, highlight=False):
    """Ticker chip as an RGBA sprite at 2× (48 px font)."""
    sym, price, chg, up = label_text(i) if i >= 0 else ('WIF', '2.8412', '+4.82%', True)
    f1, f2 = fnt(700, 44), fnt(500, 44)
    w1 = f1.getlength(sym + '  ')
    w2 = f2.getlength(price + '  ', features=['tnum'])
    w3 = f2.getlength(chg, features=['tnum'])
    im = Image.new('RGBA', (int(w1 + w2 + w3 + 24), 64), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    tcol = C['text'] if not highlight else (255, 255, 255)
    d.text((12, 46), sym, font=f1, fill=tcol + (255,), anchor='ls')
    d.text((12 + w1, 46), price, font=f2, fill=(C['mint'] if highlight else C['muted']) + (255,), anchor='ls', features=['tnum'])
    d.text((12 + w1 + w2, 46), chg, font=f2, fill=(C['up'] if up else C['down']) + (255,), anchor='ls', features=['tnum'])
    return im


@lru_cache(maxsize=6000)
def label_scaled(i, px_h, blur, highlight=False):
    src = label_sprite(i, highlight)
    k = px_h / src.height
    im = src.resize((max(2, int(src.width * k)), max(2, int(src.height * k))), Image.LANCZOS)
    if blur:
        im = im.filter(ImageFilter.GaussianBlur(blur))
    return im


# ── dolly and time dilation ──

def _speed(f):
    if f < 30:
        return 4 + 10 * smooth(f / 30)
    if f < CUE['one'] - 2:
        return 14.0
    if f < CUE['one'] + 54:
        return lerp(14.0, 2.4, in_out(seg(f, CUE['one'] - 2, CUE['one'] + 54)))
    if f < CUE['screenerix'] - 53:
        return 2.4
    return lerp(2.4, 0.6, smooth(seg(f, CUE['screenerix'] - 53, CUE['screenerix'])))


def _dil(f):
    return lerp(1.0, 0.18, smooth(seg(f, CUE['one'] - 4, CUE['one'] + 50)))


_F = np.arange(0, 480, 0.25)
_ZC = np.concatenate([[0], np.cumsum([_speed(f) * 0.25 for f in _F[:-1]])])
_TD = np.concatenate([[0], np.cumsum([_dil(f) * 0.25 for f in _F[:-1]])])


def zc(f):
    return float(np.interp(f, _F, _ZC))


def tdil(f):
    return float(np.interp(f, _F, _TD))


def dolly_speed(f):
    return _speed(f)


def project_all(f):
    """Screen positions, scale and depth of every particle at frame f."""
    z = zc(f)
    T = tdil(f)
    dz = PZ - z
    s = FOC / np.maximum(dz, 1.0)
    x = PX + VX * T * 2.2
    y = PY + VY * T * 2.2
    return W / 2 + x * s, H / 2 + y * s, s, dz


def fog(dz):
    return np.clip((ZFAR - dz) / 1900.0, 0, 1) * np.clip((dz - 70) / 260.0, 0, 1)


def global_alpha(f):
    return smooth(seg(f, CUE['thousands'] - 8, CUE['thousands'] + 34))


def dim(f):
    return 1 - 0.5 * smooth(seg(f, CUE['one'] - 6, CUE['one'] + 40))


COL = [C['up'], C['down'], (176, 180, 190)]


def draw_field(cv, f, alpha=1.0, exclude_alpha=None):
    """Particles on the canvas (screen space)."""
    if alpha <= 0.003:
        return
    sx, sy, s, dz = project_all(f)
    vis = (dz > 70) & (dz < ZFAR) & (sx > -200) & (sx < W + 200) & (sy > -120) & (sy < H + 120)
    a_all = fog(dz) * alpha
    label_a = 1 - smooth(seg(f, CUE['screenerix'] - 40, CUE['screenerix'] - 4))  # labels settle into dots before the map
    idx = np.nonzero(vis)[0]
    order = idx[np.argsort(-dz[idx])]  # far → near
    with cv.screen():
        for i in order:
            a = float(a_all[i])
            if exclude_alpha is not None:
                a *= float(exclude_alpha[i])
            if a <= 0.01:
                continue
            k = KIND[i]
            if IS_LABEL[i]:
                hpx = 15.0 * s[i] * 1.0
                if hpx < 8 or label_a <= 0.01:
                    cv.circle(sx[i], sy[i], max(0.7, 1.2 * s[i]), fill=COL[k], a=a * 0.7)
                    continue
                blur = 0
                if dz[i] < 300:
                    blur = int(clamp((300 - dz[i]) / 50, 1, 4))
                elif dz[i] > 3200:
                    blur = 1
                im = label_scaled(int(i), int(hpx * cv.ss), blur)
                X, Y = cv.P(sx[i], sy[i])
                cv.paste(im, int(X - im.width / 2), int(Y - im.height / 2), a * label_a * (0.55 if blur > 1 else 0.9))
                if label_a < 1:
                    cv.circle(sx[i], sy[i], max(0.7, 1.2 * s[i]), fill=COL[k], a=a * 0.7 * (1 - label_a))
            else:
                r = clamp(1.5 * s[i], 0.6, 9.0)
                aa = a * (0.85 if r < 5 else 0.85 * 5 / r)
                cv.circle(sx[i], sy[i], r, fill=COL[k], a=aa)


# ── exchanges: six marks ignite around the signal ──
RING_R = 300.0


def exchange_state(i, f):
    fi = CUE['six'] + 2 + i * 10
    ang = math.radians(-90 + i * 60)
    exit_t = smooth(seg(f, CUE['one'] - 18, CUE['one'] + 40))
    rad = RING_R + 260 * exit_t
    cx, cy = W / 2 + math.cos(ang) * rad, H / 2 + 20 + math.sin(ang) * rad * 0.82
    sc = (0.55 + 0.45 * settle((f - fi) / 60.0, 1.4, 6.0)) * (1 + 0.45 * exit_t)
    a = seg(f, fi, fi + 8) * (1 - exit_t)
    return fi, cx, cy, sc, a


def draw_exchanges(cv, f):
    if f < CUE['six'] - 2 or f > CUE['one'] + 44:
        return
    with cv.screen():
        for i, ex in enumerate(D.EXCHANGES):
            fi, cx, cy, sc, a = exchange_state(i, f)
            if a <= 0.003:
                continue
            size = 62 * sc
            # dark disc so marks read over the field
            cv.circle(cx, cy, size * 0.78, fill=C['bg'], a=a * 0.85)
            cv.circle(cx, cy, size * 0.78, outline=C['line2'], w=1.2, a=a)
            cv.sprite(ex, cx - size / 2, cy - size / 2, size, a=a)
            p = seg(f, fi, fi + 34)
            if 0 < p < 1:
                rr = size * 0.8 + 110 * out_cubic(p)
                cv.circle(cx, cy, rr, outline=C['mint'], w=1.4, a=a * (1 - p) * 0.55)
                cv.glow_circle(cx, cy, size * 0.9, C['mint'], a=(1 - p) * 0.35)
            # ignition burst
            age = f - fi
            if 0 <= age < 46:
                r = D.Rng(77 + i)
                for k in range(18):
                    th = r() * math.tau
                    sp = 2.5 + r() * 5
                    dist = sp * (1 - math.exp(-age / 14)) * 14
                    px, py = cx + math.cos(th) * (size * 0.6 + dist), cy + math.sin(th) * (size * 0.6 + dist)
                    cv.circle(px, py, 1.6, fill=C['mint'] if k % 3 else C['up'], a=(1 - age / 46) * 0.9)


# ── WIF: the coin that answers the question ──

def wif_pos(f):
    """Screen position of the WIF chip (it drifts with the field)."""
    t = tdil(f)
    return 1236 + math.sin(t * 0.012) * 18, 452 + math.cos(t * 0.009) * 10


def draw_wif(cv, f, alpha=1.0):
    if f < 40 or alpha <= 0.003:
        return
    x, y = wif_pos(f)
    hl = smooth(seg(f, CUE['wheres'], CUE['wheres'] + 16))
    a = smooth(seg(f, CUE['one'] + 20, CUE['one'] + 56)) * alpha * (0.6 + 0.4 * hl) * (1 if hl > 0 else dim(f) + 0.3)
    sc = 1 + 0.22 * hl
    hpx = 18 * sc
    with cv.screen():
        im = label_scaled(WIF_ID, int(hpx * cv.ss), 0, hl > 0.5)
        X, Y = cv.P(x, y)
        cv.paste(im, int(X - im.width / 2), int(Y - im.height / 2), a)
        if hl > 0:
            w = im.width / cv.ss
            cv.glow_rect(x - w / 2 + 4, y - hpx * 0.4, x + w / 2 - 4, y + hpx * 0.4, C['mint'], a=0.22 * hl * alpha)
        # "move": a green candle pushes up beside it
        p = seg(f, CUE['move'], CUE['move'] + 14)
        if p > 0:
            g = settle((f - CUE['move']) / 60.0, 1.8, 7.0)
            cx = x - im.width / cv.ss / 2 - 16
            base = y + 9
            top = base - 30 * g
            cv.line([(cx, top - 6 * g), (cx, base + 3)], C['up'], w=1.4, a=alpha)
            cv.rect(cx - 4, top, cx + 4, base, fill=C['up'], a=alpha, r=1.5)
            cv.glow_rect(cx - 5, top, cx + 5, base, C['up'], a=0.7 * alpha * (1 - 0.5 * seg(f, CUE['move'] + 10, CUE['move'] + 60)))
            q = seg(f, CUE['move'], CUE['move'] + 30)
            cv.circle(cx, (top + base) / 2, 14 + 50 * out_cubic(q), outline=C['up'], w=1.3, a=alpha * (1 - q) * 0.6)
