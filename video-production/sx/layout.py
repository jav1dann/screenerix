"""World layout (where every module lives) and the continuous camera choreography."""
import math

from .camera import Cam, Spline
from .canvas import tw
from .core import CUE, in_out, lerp, seg, spring
from . import data as D

# ── Market Map terminal (Terminal.tsx layout, 5×5 grid) ──
CARD_W, CARD_H, GAP = 368, 236, 10
GX, GY = -940, -516
HX, HY, HWIDTH = -956, -672, 1912
FRAME = (-972, -688, 972, 722)  # landing ProductPreview-style window frame around the terminal

ORDER = ['BTC', 'ETH', 'BNB', 'XRP', 'WIF',
         'DOGE', 'TON', 'AVAX', 'LINK', 'SUI',
         'NEAR', 'ARB', 'APT', 'OP', 'INJ',
         'TIA', 'SEI', 'JUP', 'ONDO', 'SOL',
         'FET', 'PEPE', 'ENA', 'WLD', 'RNDR']
HOME = {s: i for i, s in enumerate(ORDER)}
# "Ranked as it moves": stable slots swap as the ranking changes (useStableSlots).
SWAPS = [('SOL', 'AVAX', CUE['ranked'] + 4, CUE['ranked'] + 32),
         ('WIF', 'NEAR', CUE['ranked'] + 18, CUE['ranked'] + 46),
         ('PEPE', 'OP', CUE['ranked'] + 32, CUE['ranked'] + 60)]
HERO = 'SOL'
HERO_SLOT = HOME['AVAX']  # SOL ends in the centre column, row 2


def slot_xy(i):
    r, c = divmod(i, 5)
    return GX + c * (CARD_W + GAP), GY + r * (CARD_H + GAP)


def card_xy(sym, f):
    """Card top-left at frame f, plus a 0..1 'lift' while it is being re-ranked."""
    x, y = slot_xy(HOME[sym])
    lift = 0.0
    for a, b, f0, f1 in SWAPS:
        if sym in (a, b):
            other = b if sym == a else a
            t = in_out(seg(f, f0, f1))
            ox, oy = slot_xy(HOME[other])
            dx, dy = ox - x, oy - y
            ln = math.hypot(dx, dy) or 1
            side = 1 if sym == a else -1
            arc = math.sin(math.pi * t) * 46 * side
            x, y = lerp(x, ox, t) - dy / ln * arc, lerp(y, oy, t) + dx / ln * arc
            lift = math.sin(math.pi * t)
    return x, y, lift


def conn_dot(sym, x, y):
    """Live-connection dot of a chart card header (after 'SYM/USDT')."""
    return x + 10 + tw(sym, 12, 700) + tw('/USDT', 12, 400) + 9, y + 13


# ── floating modules to the right of the terminal ──
WIF_PANEL = (1180, -470, 760, 470)       # WIF · Bybit · 1m chart (spike)
FORM_CARD = (2040, -40, 300)             # formation card
STRAT_CHART = (2360, -150, 640, 420)     # ETH · 15m chart with Entry / SL / TP
TOAST_XY = (2640, -262)
TG_XY = (3036, -118)


# ── camera ──
K = [
    # frame                 cx     cy    zoom   pitch roll  stop
    (CUE['screenerix'] - 53, 0, 90, 0.47, 28, -3.0, False),
    (CUE['screenerix'], 0, 52, 0.55, 22, -2.0, False),
    (CUE['map'] + 6, 0, 8, 0.74, 7, -0.3, False),
    (CUE['every'] + 4, -150, -22, 0.88, 4, 0.3, False),
    (CUE['live'] + 35, 175, -62, 1.0, 2, 0.5, False),
    (CUE['ranked'] + 35, 60, -118, 1.12, 0.5, 0.2, False),
    (CUE['order'] - 18, 0, -152, 1.32, 0, 0.0, False),
    (CUE['order'] + 22, 0, -152, 2.42, 0, 0.0, False),
    (CUE['sized'] - 6, 6, -150, 2.80, 0, 0.0, True),
    (CUE['tracked'] - 2, 22, -150, 2.87, 0, 0.0, False),
    (CUE['timed'] + 4, 52, -148, 2.96, 0, 0.0, False),
    (CUE['timed'] + 34, 66, -147, 3.0, 0, 0.0, True),
    (CUE['spike'] - 30, 760, -190, 1.22, 0, -1.6, False),
    (CUE['spike'] - 8, 1528, -214, 1.70, 0, 0.0, False),
    (CUE['spike'] + 18, 1560, -220, 1.78, 0, 0.0, True),
    (CUE['setup'] - 36, 1600, -214, 1.84, 0, 0.0, False),
    (CUE['setup'] - 14, 2120, -62, 1.38, 0, 1.1, False),
    (CUE['setup'] + 6, 2500, 50, 1.58, 0, 0.0, True),
    (CUE['active'] - 14, 2518, 54, 1.70, 0, 0.0, False),
    (CUE['active'] + 14, 2524, 55, 1.74, 0, 0.0, True),
    (CUE['moment'] - 38, 2690, 4, 1.56, 0, 2.6, False),
    (CUE['moment'] - 6, 2830, -60, 1.52, 0, 0.4, True),
    (CUE['know'] + 20, 2858, -70, 1.60, 0, 0.0, False),
    (CUE['market2'] - 12, 2850, -64, 1.56, 0, 0.0, False),
    (CUE['market2'] + 34, 1560, -24, 0.44, 16, -2.0, False),
    (CUE['seconds'] - 2, 1200, 0, 0.34, 0, 0.0, True),
    (1800, 1200, 0, 0.34, 0, 0.0, True),
]
TRACK = Spline(K)

KICKS = [(CUE['screenerix'], 0.035), (CUE['sized'], 0.016), (CUE['tracked'], 0.012), (CUE['timed'], 0.012),
         (CUE['spike'], 0.04), (CUE['active'], 0.026), (CUE['know'], 0.01)]


def kick(f):
    return sum(a * spring((f - f0) / 60.0, freq=2.1, damp=6.5) for f0, a in KICKS)


def camera(f):
    c = TRACK.at(f)
    return Cam(c.cx, c.cy, c.zoom * (1 + kick(f)), c.pitch, c.roll)


def density_rows(sym):
    """Neighbour cards: the curated rows, or seeded walls around the price."""
    if sym == HERO:
        return D.SOL_ROWS
    if sym in D.DENSITY_NEIGHBOURS:
        return D.DENSITY_NEIGHBOURS[sym]
    r = D.Rng(D.seed_of(sym) + 17)
    p = D.PRICE[sym]
    return [(p * (1 + 0.004 + r() * 0.012), 'ask', 300_000 + r() * 1_400_000, int(r() * 2400)),
            (p * (1 - 0.003 - r() * 0.014), 'bid', 300_000 + r() * 2_600_000, int(r() * 3000))]
