"""Screenerix UI components, recreated from the repo's React components (sizes in CSS px = world units)."""
import os
import re
from functools import lru_cache
from io import BytesIO

import cairosvg
from PIL import Image

from .core import ASSETS, C, fmt_pct, fmt_price, fmt_usd, mix, seg, clamp, lerp
from .canvas import tw
from . import data as D

# ── icons (lucide-static SVGs, the set behind lucide-react) ──


@lru_cache(maxsize=None)
def _icon_svg(name):
    with open(os.path.join(ASSETS, 'icons', f'{name}.svg')) as fh:
        return re.sub(r'<!--.*?-->', '', fh.read(), flags=re.S)


@lru_cache(maxsize=4096)
def icon_img(name, px, color, stroke=2.0):
    svg = _icon_svg(name).replace('currentColor', '#%02x%02x%02x' % color).replace('stroke-width="2"', f'stroke-width="{stroke}"')
    png = cairosvg.svg2png(bytestring=svg.encode(), output_width=px, output_height=px)
    return Image.open(BytesIO(png)).convert('RGBA')


def icon(cv, name, x, y, size, color, a=1.0, stroke=2.0):
    """Lucide icon with top-left (x, y), `size` world units."""
    px = int(round(cv.L(size)))
    if px < 3 or cv.a * a <= 0.002 or not cv.visible(x, y, x + size, y + size):
        return
    X, Y = cv.P(x, y)
    cv.paste(icon_img(name, px, tuple(color), stroke), int(round(X)), int(round(Y)), a)


def glass(cv, x0, y0, x1, y1, r=12, a=1.0, fill_a=0.62, line=C['line']):
    """.sx-glass: rgba(17,18,21,.62) + 1px #1E2024 border, radius 12."""
    cv.rect(x0, y0, x1, y1, fill=C['panel'], a=a * fill_a, r=r)
    cv.rect(x0, y0, x1, y1, outline=line, r=r, w=1, a=a)


# ── logo (src/components/shared/ScreenerixLogo.tsx, viewBox 300 240 650 760) ──
LOGO_BARS = [
    [(402, 578), (509, 634), (509, 940), (402, 884)],
    [(572, 408), (682, 466), (682, 846), (572, 788)],
    [(746, 310), (852, 366), (852, 680), (746, 624)],
]
LOGO_VB = (300, 240, 650, 760)


def logo_quads(x, y, size):
    """The three bars as world quads for a mark drawn `size` tall with top-left at (x, y)."""
    vx, vy, vw, vh = LOGO_VB
    k = size / vh
    return [[(x + (px - vx) * k, y + (py - vy) * k) for px, py in bar] for bar in LOGO_BARS]


def draw_bar(cv, quad, color, a=1.0, size=1.0):
    """One bar with the logo's 22-unit round-joined stroke."""
    cv.poly(quad, fill=color, a=a)
    cv.line(quad + [quad[0]], color, w=22 * size / LOGO_VB[3], a=a)


def wordmark(cv, x, y, fs, a=1.0, ix_a=None, reveal=None, glow=0.0):
    """SCREENER + green IX, Archivo 800, letter-spacing .08em; baseline-left at (x, y)."""
    s1 = 'SCREENER'
    w1 = cv.text_w(s1, fs, 800, 0.08) + 0.08 * fs
    cv.text(x, y, s1, fs, 800, C['text'], a=a, tracking=0.08)
    cv.text(x + w1, y, 'IX', fs, 800, C['up'], a=a if ix_a is None else ix_a, tracking=0.08)
    if glow > 0:
        cv.glow_text(x + w1, y, 'IX', fs, 800, C['up'], a=glow, tracking=0.08)
    return w1 + cv.text_w('IX', fs, 800, 0.08)


def logo_inline(cv, x, y, size=26, fs=14, a=1.0):
    """Header lock-up: mark (text colour) + wordmark, vertically centred on y."""
    for q in logo_quads(x, y - size / 2, size):
        draw_bar(cv, q, C['text'], a, size)
    wordmark(cv, x + size * 0.86 + 10, y + fs * 0.36, fs, a)


# ── chart primitives ──

def plot_candles(cv, x0, y0, x1, y1, cs, lo, hi, a=1.0, step=None, width=0.62, upto=None):
    n = len(cs)
    step = step or (x1 - x0) / n
    bw = max(1.0, step * width)

    def Y(v):
        return y1 - (v - lo) / (hi - lo) * (y1 - y0)
    for i, (o, h, l, c, v) in enumerate(cs):
        if upto is not None and i >= upto:
            break
        xc = x0 + step * (i + 0.5)
        col = C['up'] if c >= o else C['down']
        if xc < x0 or xc > x1:
            continue
        cv.line([(xc, Y(h)), (xc, Y(l))], col, w=1, a=a)
        top, bot = Y(max(o, c)), Y(min(o, c))
        cv.rect(xc - bw / 2, top, xc + bw / 2, max(bot, top + 1), fill=col, a=a)
    return Y


def vol_bars(cv, x0, base_y, step, cs, max_h, vmax, a=0.5, width=0.62, upto=None):
    bw = max(1.0, step * width)
    for i, (o, h, l, c, v) in enumerate(cs):
        if upto is not None and i >= upto:
            break
        xc = x0 + step * (i + 0.5)
        col = C['up'] if c >= o else C['down']
        cv.rect(xc - bw / 2, base_y - v / vmax * max_h, xc + bw / 2, base_y, fill=col, a=a)


def dashed(cv, x0, x1, y, color, w=1.0, dash=6.0, gap=4.0, a=1.0):
    x = x0
    while x < x1:
        cv.line([(x, y), (min(x + dash, x1), y)], color, w=w, a=a)
        x += dash + gap


def level_line(cv, x0, x1, y, kind, progress, axis_x, a=1.0):
    """Strategy price line (src/lib/strategies/chartLines.ts): title + axis label in the level colour."""
    col = {'entry': C['entry'], 'sl': C['down'], 'tp1': C['up'], 'tp2': C['up']}[kind]
    title = {'entry': 'Entry', 'sl': 'SL', 'tp1': 'TP1', 'tp2': 'TP2'}[kind]
    xe = lerp(x0, x1, progress)
    if progress <= 0:
        return
    if kind == 'entry':
        cv.line([(x0, y), (xe, y)], col, w=2, a=a)
    elif kind == 'tp2':
        dashed(cv, x0, xe, y, col, w=1, dash=10, gap=6, a=a)
    else:
        dashed(cv, x0, xe, y, col, w=1, dash=5, gap=4, a=a)
    la = a * clamp((progress - 0.7) / 0.3)
    cv.text(x1 - 6, y - 5, title, 11, 600, col, a=la, anchor='rs')
    tw_ = cv.text_w(LEVEL_PRICE[kind], 11, 500) + 10
    cv.rect(axis_x, y - 9.5, axis_x + max(53, tw_), y + 9.5, fill=col, a=la, r=2)
    cv.text(axis_x + 5, y + 4, LEVEL_PRICE[kind], 11, 500, C['bg'], a=la)


LEVEL_PRICE = {'entry': fmt_price(D.ETH_ENTRY), 'sl': fmt_price(D.ETH_SL), 'tp1': fmt_price(D.ETH_TP1), 'tp2': fmt_price(D.ETH_TP2)}


def price_label(cv, x, y, text, bg, a=1.0, fs=11, w=None):
    """lightweight-charts last-price / price-line axis label."""
    tw = cv.text_w(text, fs, 500) + 10
    w = w or tw
    cv.rect(x, y - fs * 0.85, x + w, y + fs * 0.85, fill=bg, a=a, r=2)
    cv.text(x + 5, y + fs * 0.36, text, fs, 500, (255, 255, 255), a=a)


def stat_row(cv, x_right, y, items, x_min, a=1.0):
    """ChartHeader <Stat>: uppercase 9px label + 11px semibold value, laid out right-to-left."""
    x = x_right
    for label, value, color in reversed(items):
        wv = cv.text_w(value, 11, 600)
        wl = cv.text_w(label.upper(), 9, 500, 0.04)
        if x - wv - wl - 4 < x_min:
            break
        cv.text(x, y, value, 11, 600, color or C['text'], a=a, anchor='rs')
        cv.text(x - wv - 4, y, label.upper(), 9, 500, C['muted'], a=a, anchor='rs', tracking=0.04)
        x -= wv + wl + 4 + 12


VOL_PANE = 0.26


def chart_scale(x, y, w, h, cs, levels=None):
    """Plot geometry of chart_card (price → y, bar spacing), shared with motion code."""
    px0, px1, py0, py1 = x + 36, x + w - 54, y + 38, y + h - 22
    lo = min(k[2] for k in cs)
    hi = max(k[1] for k in cs)
    if levels:
        lo = min(lo, min(levels.values()))
        hi = max(hi, max(levels.values()))
    pad = (hi - lo) * 0.08
    lo, hi = lo - pad * 3.0, hi + pad  # scaleMargins top .08 / bottom .24
    n = len(cs)
    step = (px1 - px0 - 8) / (n + 4)  # rightOffset: 4 bars
    y0, y1 = py0 + 4, py1

    def Y(v):
        return y1 - (v - lo) / (hi - lo) * (y1 - y0)
    return {'px0': px0, 'px1': px1, 'py0': py0, 'py1': py1, 'lo': lo, 'hi': hi, 'n': n, 'step': step, 'Y': Y}


def chart_card(cv, x, y, w, h, sym, f, venue='binance', tf='1m', cs=None, a=1.0, content=1.0, live_glow=0.0,
               stats=None, levels=None, levels_t=1.0, last_override=None, quote='USDT', spike=None, wm=True,
               chart_a=1.0, axis_a=1.0, panel_a=1.0, header_a=1.0, axis_skip=()):
    """src/components/chart/Chart.tsx card: header, tool rail, candles + volume, price scale, watermark."""
    if not cv.visible(x, y, x + w, y + h, 40):
        return None
    glass(cv, x, y, x + w, y + h, a=a * panel_a)
    if content <= 0.01:
        return None
    ca = a * content
    cs = list(cs if cs is not None else D.candles(sym, 36))
    o, hh, ll, c, v = cs[-1]
    lc = last_override if last_override is not None else c * D.live(sym, f)
    cs[-1] = (o, max(hh, lc), min(ll, lc), lc, v)
    up = lc >= o

    ha_ = header_a
    # header (py-1, two lines) + border-b
    hy = y + 38
    tx = x + 10
    cv.text(tx, y + 17, sym, 12, 700, C['text'], a=ca * header_a)
    sw = cv.text_w(sym, 12, 700)
    cv.text(tx + sw, y + 17, '/' + quote, 12, 400, C['muted'], a=ca * header_a)
    qw = cv.text_w('/' + quote, 12, 400)
    dx, dy = tx + sw + qw + 9, y + 13
    cv.circle(dx, dy, 3, fill=C['up'], a=ca * header_a)
    if live_glow > 0:
        cv.glow_circle(dx, dy, 7, C['mint'], a=live_glow * ca * header_a)
        cv.circle(dx, dy, 3 + 6 * live_glow, outline=C['mint'], w=1, a=ca * header_a * live_glow * 0.6)
    cv.sprite(venue, tx, y + 23.5, 10, a=ca * header_a)
    vline = f"{D.EX_NAME[venue]} · {'Spot' if venue == 'coinbase' else 'Futures'} · {tf} · "
    cv.text(tx + 14, y + 31.5, vline, 9.5, 400, C['muted'], a=ca * header_a)
    cv.text(tx + 14 + cv.text_w(vline, 9.5), y + 31.5, fmt_price(lc), 9.5, 400, C['text'], a=ca * header_a)
    ix = x + w - 8 - 24
    for name in ('chevron-up', 'settings', 'square-function', 'expand'):
        icon(cv, name, ix + 5, y + 12, 14, C['muted'], a=ca * header_a)
        ix -= 24
    if stats is None:
        stats = [('5m Range', fmt_pct(D.stat(sym, 'range5m')).replace('+', ''), None),
                 ('Fund.', fmt_pct(D.stat(sym, 'fund'), 4), C['up'] if D.stat(sym, 'fund') >= 0 else C['down'])]
    stat_row(cv, ix + 18, y + 24, stats, tx + max(sw + qw + 24, cv.text_w(vline, 9.5) + 60), a=ca * header_a)
    cv.line([(x + 1, hy), (x + w - 1, hy)], C['line'], w=1, a=ca * header_a)

    # tool rail (w-9, py-2, gap-1): copy, pin, star, ban
    for i, name in enumerate(('copy', 'pin', 'star', 'ban')):
        icon(cv, name, x + 11, hy + 13 + i * 32, 14, C['muted'], a=ca)

    # plot area
    px0, px1, py0, py1 = x + 36, x + w - 54, hy, y + h - 22
    cv.line([(px1, py0), (px1, py1)], C['line'], w=1, a=ca * axis_a)
    cv.line([(px0, py1), (x + w - 1, py1)], C['line'], w=1, a=ca * axis_a)
    for k in range(1, 5):
        gy = py0 + (py1 - py0) * k / 5
        cv.line([(px0, gy), (px1, gy)], C['line'], w=1, a=ca * 0.55 * axis_a)
    for k in range(1, 4):
        gx = px0 + (px1 - px0) * k / 4
        cv.line([(gx, py0), (gx, py1)], C['line'], w=1, a=ca * 0.55 * axis_a)
    if wm:
        ws = min((py1 - py0) * 0.28, (px1 - px0) * 0.28 * 0.7)
        cv.text((px0 + px1) / 2, (py0 + py1) / 2, sym, ws, 800, C['text'], a=ca * 0.06 * chart_a, anchor='mm')

    sc = chart_scale(x, y, w, h, cs, levels)
    lo, hi, n, step = sc['lo'], sc['hi'], sc['n'], sc['step']
    vol_cs = cs
    if spike is not None:
        vol_cs = cs[:-1] + [(o, max(hh, lc), min(ll, lc), lc, spike)]
    vmax = max(k[4] for k in vol_cs)
    vol_bars(cv, px0, py1, step, vol_cs, (py1 - py0) * VOL_PANE, vmax, a=0.42 * ca * chart_a)
    Yf = plot_candles(cv, px0, py0 + 4, px0 + step * n, py1, cs, lo, hi, a=ca * chart_a, step=step)

    # price scale labels
    for k in range(1, 5):
        pv = lo + (hi - lo) * (1 - k / 5)
        gy = py0 + (py1 - py0) * k / 5 - 4 * (1 - k / 5)
        if any(abs(gy - sy) < 16 for sy in axis_skip):
            continue
        cv.text(px1 + 6, gy + 4, fmt_price(pv), 11, 400, C['muted'], a=ca * axis_a)
    ly = Yf(lc)
    if not any(abs(ly - sy) < 14 for sy in axis_skip):
        price_label(cv, px1 + 1, ly, fmt_price(lc), C['up'] if up else C['down'], a=ca, w=53)
    for k, t in enumerate(('09:20', '09:35', '09:50')):
        cv.text(px0 + (px1 - px0) * (k + 1) / 4, y + h - 7, t, 11, 400, C['muted'], a=ca * axis_a, anchor='ms')
    return {'Y': Yf, 'step': step, 'px0': px0, 'px1': px1, 'py0': py0, 'py1': py1, 'last': lc, 'last_y': ly, 'n': n, 'lo': lo, 'hi': hi}


# ── Densities card (src/components/terminal/modules/Densities.tsx · DensityCardView) ──
SHORT = {'binance': 'BN', 'bybit': 'BY', 'okx': 'OKX', 'bitget': 'BG', 'gate': 'GT', 'coinbase': 'CB'}


def tier(notional, side):
    if notional >= 2_000_000:
        return C['violet']
    if notional >= 500_000:
        return C['amber']
    return C['down'] if side == 'ask' else C['up']


def fmt_life(s):
    s = int(max(0, s))
    if s < 60:
        return f'{s}s'
    if s < 3600:
        return f'{s // 60}m {s % 60:02d}s'
    return f'{s // 3600}h {(s % 3600) // 60:02d}m'


def density_card(cv, x, y, w, sym, last, chg, rows, f, venue='binance', a=1.0, live_icon=0.0, hero=None, row_h=22.5,
                 header_a=1.0, rows_a=1.0, row_grow=None, panel_a=1.0):
    """Returns the card height. `hero` tweaks one row: {'i','bar','size','dist','life','hl'} progress values."""
    hgt = 10 + 20 + 4 + row_h * len(rows) + 10
    if not cv.visible(x, y, x + w, y + hgt, 40):
        return hgt
    glass(cv, x, y, x + w, y + hgt, a=a * panel_a)
    ha = a * header_a
    cx = x + 10
    cv.text(cx, y + 24, sym, 13, 800, C['text'], a=ha)
    sx = cx + cv.text_w(sym, 13, 800) + 6
    chip = f"{SHORT[venue]}·F"
    cw = cv.text_w(chip, 9, 700) + 18
    cv.rect(sx, y + 14, sx + cw, y + 26, fill=(255, 255, 255), a=ha * 0.06, r=3)
    cv.sprite(venue, sx + 3, y + 15, 10, a=ha)
    cv.text(sx + 15, y + 23.5, chip, 9, 700, C['muted'], a=ha)
    rx = sx + cw + 6
    if live_icon > 0:
        icon(cv, 'radio', rx, y + 14, 11, C['up'], a=ha * live_icon)
    cv.text(x + w - 10, y + 24, fmt_pct(chg), 11, 400, C['up'] if chg >= 0 else C['down'], a=ha, anchor='rs')
    pw = cv.text_w(fmt_pct(chg), 11) + 8
    cv.text(x + w - 10 - pw, y + 24, fmt_price(last), 11, 600, C['text'], a=ha, anchor='rs')

    mx = max(r[2] for r in rows)
    ry = y + 34
    for i, (price, side, notional, life) in enumerate(rows):
        g = 1.0 if row_grow is None else row_grow[i]
        if g <= 0.01:
            ry += row_h
            continue
        ra = a * rows_a * clamp(g * 1.4)
        top = ry + (row_h - 2) * (1 - g) / 2
        bot = top + (row_h - 2) * g
        col = tier(notional, side)
        bar = max(0.04, notional / mx)
        size_txt = fmt_usd(notional)
        dist = (price - last) / last
        dist_txt = f"{'+' if dist >= 0 else '−'}{abs(dist) * 100:.2f}%"
        life_txt = fmt_life(life + f / 60.0)
        hl = 0.0
        if hero and hero['i'] == i:
            bar *= hero['bar']
            if hero['size'] < 1:
                size_txt = fmt_usd(notional * (0.12 + 0.88 * hero['size']))
            hl = hero['hl']
            life_txt = fmt_life(hero['life_s']) if hero.get('life_s') is not None else life_txt
        if hl > 0:
            cv.rect(x + 4, top - 1, x + w - 4, bot + 1, fill=C['mint'], a=ra * 0.07 * hl, r=4)
            cv.rect(x + 4, top - 1, x + w - 4, bot + 1, outline=C['mint'], a=ra * 0.35 * hl, r=4, w=1)
        if bar > 0.005:
            cv.rect(x + 10 - 6, top, x + 10 - 6 + (w - 8 - 0) * bar, bot, fill=col, a=ra * 0.25, r=4)
            if hero and hero['i'] == i and hero.get('bar_glow', 0) > 0:
                cv.glow_rect(x + 4, top, x + 4 + (w - 8) * bar, bot, col, a=hero['bar_glow'] * 0.5, r=4)
        base = (top + bot) / 2 + 4
        cv.text(x + 10, base, fmt_price(price), 11, 400, C['down'] if side == 'ask' else C['up'], a=ra)
        da, la, sa = 0.75, 0.6, 1.0
        if hero and hero['i'] == i:
            da *= hero['dist']
            la *= hero['life']
            sa *= clamp(hero['size'] * 6)
        cv.text(x + w - 10, base, life_txt, 11, 400, C['text'], a=ra * la, anchor='rs')
        cv.text(x + w - 10 - 56, base, dist_txt, 11, 400, C['text'], a=ra * da, anchor='rs')
        cv.text(x + w - 10 - 112, base, size_txt, 11, 700, col, a=ra * sa, anchor='rs')
        if hero and hero['i'] == i and hero.get('size_glow', 0) > 0:
            cv.glow_text(x + w - 10 - 112, base, size_txt, 11, 700, col, a=hero['size_glow'], anchor='rs')
        ry += row_h
    return hgt


def density_row_y(y, i, row_h=22.5):
    return y + 34 + row_h * i + row_h / 2


# ── Strategies (src/components/strategies/parts.tsx) ──

def tw_badge(t):
    return lerp(tw('FORMING', 10, 700, 0.025) + 22, tw('ACTIVE', 10, 700, 0.025) + 22, t)


def stage_badge(cv, x_right, y, t, glow=0.0, a=1.0):
    """StageBadge morphing FORMING → ACTIVE (t 0..1); right-aligned at x_right, vertically centred on y."""
    col = mix(C['forming'], C['up'], t)
    label_a, label_b = 'FORMING', 'ACTIVE'
    wa = cv.text_w(label_a, 10, 700, 0.025) + 22
    wb = cv.text_w(label_b, 10, 700, 0.025) + 22
    bw = lerp(wa, wb, t)
    x0 = x_right - bw
    cv.rect(x0, y - 9, x_right, y + 9, fill=col, a=a * 0.13, r=6)
    cv.rect(x0, y - 9, x_right, y + 9, outline=col, a=a * 0.27, r=6, w=1)
    cv.circle(x0 + 10, y, 3, fill=col, a=a)
    if glow > 0:
        cv.glow_rect(x0, y - 9, x_right, y + 9, col, a=glow * 0.35, r=6)
        cv.glow_circle(x0 + 10, y, 5, col, a=glow * 0.8)
    ta, tb = clamp(1 - t * 2), clamp(t * 2 - 1)
    if ta > 0:
        cv.text(x0 + 17, y + 3.6 - 4 * (1 - ta), label_a, 10, 700, col, a=a * ta, tracking=0.025)
    if tb > 0:
        cv.text(x0 + 17, y + 3.6 + 4 * (1 - tb), label_b, 10, 700, col, a=a * tb, tracking=0.025)
    return x0


def formation_card(cv, x, y, w, f, stage_t=0.0, stage_glow=0.0, a=1.0, to_entry=10):
    hgt = 148
    if not cv.visible(x, y, x + w, y + hgt, 30):
        return hgt
    glass(cv, x, y, x + w, y + hgt, a=a)
    cx = x + 12
    cv.text(cx, y + 25, 'ETH', 14, 800, C['text'], a=a)
    sx = cx + cv.text_w('ETH', 14, 800) + 6
    cw = cv.text_w('Binance', 9, 700) + 18
    cv.rect(sx, y + 14, sx + cw, y + 26, fill=(255, 255, 255), a=a * 0.06, r=3)
    cv.sprite('binance', sx + 3, y + 15, 10, a=a)
    cv.text(sx + 15, y + 23.5, 'Binance', 9, 700, C['muted'], a=a)
    dx = sx + cw + 6
    dw = cv.text_w('LONG', 10, 700) + 22
    cv.rect(dx, y + 12, dx + dw, y + 28, fill=C['up'], a=a * 0.15, r=6)
    icon(cv, 'arrow-up-right', dx + 5, y + 14.5, 11, C['up'], a=a)
    cv.text(dx + 17, y + 24, 'LONG', 10, 700, C['up'], a=a)
    stage_badge(cv, x + w - 12, y + 20, stage_t, stage_glow, a=a)
    # strategy name + quality + flags
    r2 = y + 48
    cv.text(cx, r2, 'Level Breakout', 11, 400, C['muted'], a=a)
    fx = x + w - 12
    icon(cv, 'trending-up', fx - 12, r2 - 10, 12, C['up'], a=a)
    icon(cv, 'waves', fx - 28, r2 - 10, 12, C['up'], a=a)
    qw = cv.text_w('HIGH', 10, 700) + cv.text_w('82', 10, 600) + 16
    q0 = fx - 34 - qw
    cv.rect(q0, r2 - 12, q0 + qw, r2 + 4, fill=(255, 255, 255), a=a * 0.05, r=6)
    cv.text(q0 + 6, r2, 'HIGH', 10, 700, C['up'], a=a)
    cv.text(q0 + 10 + cv.text_w('HIGH', 10, 700), r2, '82', 10, 600, C['muted'], a=a)
    # levels grid
    ly0 = y + 60
    cv.rect(cx, ly0, x + w - 12, ly0 + 40, fill=(255, 255, 255), a=a * 0.03, r=8)
    colw = (w - 24 - 16) / 4
    for i, (lab, val, col) in enumerate((('ENTRY', D.ETH_ENTRY, C['entry']), ('SL', D.ETH_SL, C['down']),
                                         ('TP1', D.ETH_TP1, C['up']), ('TP2', D.ETH_TP2, C['up']))):
        lx = cx + 8 + i * (colw + 2)
        cv.text(lx, ly0 + 15, lab, 9, 700, col, a=a, tracking=0.025)
        cv.text(lx, ly0 + 31, fmt_price(val), 11, 400, C['text'], a=a)
    # footer
    fy = y + 128
    parts = [('Potential ', '2.65%', C['up']), ('To entry ', f'{to_entry} bps', C['text']), ('Vol ', '$14.20B', C['text']), ('Age ', '38m', C['text'])]
    px = cx
    for lab, val, col in parts:
        cv.text(px, fy, lab, 11, 400, C['muted'], a=a)
        px += cv.text_w(lab, 11)
        cv.text(px, fy, val, 11, 700, col, a=a)
        px += cv.text_w(val, 11, 700) + 12
    return hgt


# ── alerts ──

def toast(cv, x, y, w=360, a=1.0, text='Price rose to 3,528.40 (alert at 3,528.00)'):
    """AlertsHost toast: #1A1710/95, amber/50 border, BellRing, exchange icon + symbol."""
    h = 58
    cv.rect(x, y + 6, x + w, y + h + 10, fill=(0, 0, 0), a=a * 0.35, r=14)  # shadow-lg
    cv.rect(x, y, x + w, y + h, fill=C['toast'], a=a * 0.95, r=12)
    cv.rect(x, y, x + w, y + h, outline=C['alert'], a=a * 0.5, r=12, w=1)
    icon(cv, 'bell-ring', x + 12, y + 12, 16, C['alert'], a=a)
    cv.sprite('binance', x + 40, y + 13, 13, a=a)
    cv.text(x + 58, y + 24, 'ETH', 12, 700, C['alert'], a=a)
    cv.text(x + 40, y + 44, text, 12, 400, C['text'], a=a)
    icon(cv, 'x', x + w - 26, y + 12, 14, C['muted'], a=a)
    return h


def telegram(cv, x, y, w=330, a=1.0):
    """The bot's message (src/lib/alerts/server/deliver.ts): 🔔 <b>ETH</b> · Binance / text / Open Screenerix."""
    h = 104
    cv.sprite('telegram', x, y - 26, 18, a=a)
    cv.text(x + 26, y - 12, 'Telegram · Screenerix bot', 11, 600, C['muted'], a=a)
    cv.rect(x, y + 6, x + w, y + h + 10, fill=(0, 0, 0), a=a * 0.3, r=16)
    cv.rect(x, y, x + w, y + h, fill=C['tg_bubble'], a=a, r=14)
    icon(cv, 'bell', x + 14, y + 13, 14, C['alert'], a=a)
    cv.text(x + 34, y + 25, 'ETH', 13, 700, (255, 255, 255), a=a)
    cv.text(x + 34 + cv.text_w('ETH', 13, 700), y + 25, ' · Binance', 13, 400, (255, 255, 255), a=a)
    cv.text(x + 14, y + 49, 'Price rose to 3,528.40 (alert at 3,528.00)', 13, 400, (255, 255, 255), a=a)
    cv.text(x + 14, y + 73, 'Open Screenerix', 13, 400, C['tg_link'], a=a)
    cv.text(x + w - 12, y + h - 10, '09:41', 10, 400, (122, 140, 160), a=a, anchor='rs')
    return h


def spike_chip(cv, x, y, a=1.0, pulse=1.0, glow=0.0):
    """HeroVisual chip: 'WIF · Volume spike' / '×4.8 · 1m · Bybit'."""
    w, h = 196, 50
    cv.rect(x, y + 8, x + w, y + h + 14, fill=(0, 0, 0), a=a * 0.4, r=14)
    cv.rect(x, y, x + w, y + h, fill=C['panel'], a=a * 0.94, r=12)
    cv.rect(x, y, x + w, y + h, outline=C['up'], a=a * 0.25, r=12, w=1)
    cv.circle(x + 18, y + h / 2, 4, fill=C['up'], a=a * (0.35 + 0.65 * pulse))
    cv.glow_circle(x + 18, y + h / 2, 9, C['up'], a=a * (0.4 + 0.6 * glow) * pulse)
    cv.text(x + 32, y + 21, 'WIF · Volume spike', 12, 600, C['text'], a=a)
    m = '×4.8 · 1m · '
    cv.text(x + 32, y + 38, m, 12, 400, C['muted'], a=a)
    mx = x + 32 + cv.text_w(m, 12)
    cv.sprite('bybit', mx, y + 28.5, 11, a=a)
    cv.text(mx + 15, y + 38, 'Bybit', 12, 400, C['muted'], a=a)
    return w, h


# ── terminal header (src/components/terminal/TerminalHeader.tsx) ──
TABS = ['Market Map', 'Market Review', 'Densities', 'Strategies', 'Arbitrage Screener']


def terminal_header(cv, x0, y0, width, active=0.0, a=1.0, f=0):
    """Top row (56px) + Market Map control row (48px). `active` is a float tab index (animates the pill)."""
    cv.line([(x0, y0 + 56), (x0 + width, y0 + 56)], C['line'], w=1, a=a)
    cv.line([(x0, y0 + 104), (x0 + width, y0 + 104)], C['line'], w=1, a=a)
    logo_inline(cv, x0 + 16, y0 + 28, a=a)
    nx = x0 + 16 + 26 * 0.86 + 10 + cv.text_w('SCREENERIX', 14, 800, 0.08) + 24
    widths = [cv.text_w(t, 13, 600) + 28 for t in TABS]
    tw = sum(widths) + 2 * (len(TABS) - 1) + 6
    cv.rect(nx, y0 + 12, nx + tw, y0 + 44, fill=(255, 255, 255), a=a * 0.03, r=10)
    cv.rect(nx, y0 + 12, nx + tw, y0 + 44, outline=C['line'], a=a, r=10, w=1)
    xs = []
    cx = nx + 3
    for wdt in widths:
        xs.append(cx)
        cx += wdt + 2
    i0 = int(clamp(active, 0, len(TABS) - 1))
    i1 = min(i0 + 1, len(TABS) - 1)
    t = active - i0
    ax = lerp(xs[i0], xs[i1], t)
    aw = lerp(widths[i0], widths[i1], t)
    cv.rect(ax, y0 + 15, ax + aw, y0 + 41, fill=(255, 255, 255), a=a * 0.08, r=7)
    for i, (tx, wdt) in enumerate(zip(xs, widths)):
        on = clamp(1 - abs(active - i))
        cv.text(tx + wdt / 2, y0 + 32.5, TABS[i], 13, 600, mix(C['muted'], C['text'], on), a=a, anchor='ms')
    # right cluster
    rx = x0 + width - 16
    cv.circle(rx - 15, y0 + 28, 15, fill=C['line2'], a=a)
    cv.text(rx - 15, y0 + 33, 'JI', 11, 700, C['text'], a=a, anchor='ms')
    bx = rx - 40 - 92
    cv.rect(bx, y0 + 13, bx + 84, y0 + 43, fill=(255, 255, 255), a=a * 0.03, r=8)
    cv.rect(bx, y0 + 13, bx + 84, y0 + 43, outline=C['line'], a=a, r=8, w=1)
    icon(cv, 'bell', bx + 11, y0 + 21, 14, C['text'], a=a)
    cv.text(bx + 31, y0 + 32.5, 'Alerts', 12, 600, C['text'], a=a)
    ex = bx - 150
    cv.text(ex + 20, y0 + 32.5, '← Exit to website', 12, 600, C['muted'], a=a)
    # control row: Exchange pills · market · sort · timeframe · grid
    ry = y0 + 80
    cv.text(x0 + 16, ry + 4, 'Exchange', 12, 600, C['muted'], a=a)
    px = x0 + 16 + cv.text_w('Exchange', 12, 600) + 10
    for ex_id in D.EXCHANGES[:5]:
        name = D.EX_NAME[ex_id]
        pw = cv.text_w(name, 12, 600) + 46
        on = ex_id == 'binance'
        cv.rect(px, ry - 13, px + pw, ry + 13, fill=C['up'] if on else (255, 255, 255), a=a * (0.10 if on else 0.02), r=13)
        cv.rect(px, ry - 13, px + pw, ry + 13, outline=(48, 164, 108) if on else C['line'], a=a * (0.4 if on else 1), r=13, w=1)
        cv.circle(px + 12, ry, 3, fill=C['up'], a=a)
        cv.sprite(ex_id, px + 19, ry - 6, 12, a=a)
        cv.text(px + 35, ry + 4, name, 12, 600, C['text'] if on else C['muted'], a=a)
        px += pw + 6
    px += 10
    for label, w_ in (('Futures', 64), ('Spot', 46)):
        on = label == 'Futures'
        if on:
            cv.rect(px, ry - 12, px + w_, ry + 12, fill=(255, 255, 255), a=a * 0.08, r=7)
        cv.text(px + w_ / 2, ry + 4, label, 12, 600, C['text'] if on else C['muted'], a=a, anchor='ms')
        px += w_ + 2
    px += 16
    for label in ('Sort · 5m Range', '1m', '3m', '5m', '15m', '1h', 'Grid · 25 (5x5)'):
        lw = cv.text_w(label, 12, 600) + 22
        on = label == '1m'
        cv.rect(px, ry - 13, px + lw, ry + 13, fill=(255, 255, 255), a=a * (0.08 if on else 0.02), r=8)
        cv.rect(px, ry - 13, px + lw, ry + 13, outline=C['line'], a=a, r=8, w=1)
        cv.text(px + 11, ry + 4, label, 12, 600, C['text'] if on or '·' in label else C['muted'], a=a)
        px += lw + 6
