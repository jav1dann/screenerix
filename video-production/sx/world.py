"""Acts II–IV in world space: Market Map → Densities → volume spike → Strategies → alerts."""
import math
from functools import lru_cache

import numpy as np

from .canvas import tw
from .core import (C, CUE, clamp, fmt_price, in_out, in_out_quint, lerp, out_cubic, out_expo, seg, settle, smooth)
from . import data as D
from . import layout as L
from . import ui
from . import act1

# ── Market Map reveal: data particles land on the candles ──
CENTER_SLOT = 12


@lru_cache(maxsize=None)
def card_delay(sym):
    r, c = divmod(L.HOME[sym], 5)
    cr, cc = divmod(CENTER_SLOT, 5)
    return int(math.hypot(r - cr, c - cc) * 9)


def reveal_t0(sym):
    return CUE['screenerix'] + card_delay(sym)


@lru_cache(maxsize=None)
def card_geom(sym):
    """Candle close points of a map card (relative to its top-left), mirroring ui.chart_card."""
    cs = D.candles(sym, 36)
    w, h = L.CARD_W, L.CARD_H
    px0, px1, py0, py1 = 36, w - 54, 38, h - 22
    lo, hi = min(k[2] for k in cs), max(k[1] for k in cs)
    pad = (hi - lo) * 0.08
    lo, hi = lo - pad * 3.0, hi + pad
    n = len(cs)
    step = (px1 - px0 - 8) / (n + 4)
    y0, y1 = py0 + 4, py1
    pts = []
    for i, (o, hh, ll, c, v) in enumerate(cs):
        xc = px0 + step * (i + 0.5)
        pts.append((xc, y1 - ((o + c) / 2 - lo) / (hi - lo) * (y1 - y0)))
    return pts


@lru_cache(maxsize=None)
def flight_plan():
    """Assign particles visible as the map forms to candle targets (laminar left→right mapping)."""
    f0 = CUE['screenerix'] - 1
    sx, sy, s, dz = act1.project_all(f0)
    vis = (dz > 70) & (dz < act1.ZFAR) & (sx > -60) & (sx < 1980) & (sy > -60) & (sy < 1140) & (act1.fog(dz) > 0.15)
    cand = np.nonzero(vis)[0]
    targets = []
    for sym in L.ORDER:
        for j, (tx, ty) in enumerate(card_geom(sym)):
            targets.append((sym, j, tx, ty))
    cam = L.camera(CUE['screenerix'])
    from .camera import project
    tpos = []
    for sym, j, tx, ty in targets:
        x, y, _ = L.card_xy(sym, CUE['screenerix'])
        tpos.append(project(cam, x + tx, y + ty))
    tpos = np.array(tpos)
    ci = cand[np.lexsort((sy[cand], np.round(sx[cand] / 90)))]
    ti = np.lexsort((tpos[:, 1], np.round(tpos[:, 0] / 40)))
    n = min(len(ci), len(ti))
    pairs = [(int(ci[k * len(ci) // n]), int(ti[k])) for k in range(n)]
    used = {p for p, _ in pairs}
    extra = [int(i) for i in cand if int(i) not in used]
    return pairs, targets, extra, (sx, sy, s, dz)


def particle_flight(ov, f, cam_fn):
    """Transition particles drawn in screen space (post-warp overlay) between the field and the map."""
    t_end = CUE['screenerix'] + 100
    if f < CUE['screenerix'] or f > t_end:
        return
    pairs, targets, extra, (sx0, sy0, s0, dz0) = flight_plan()
    from .camera import project

    def pos_at(ff, pi, ti):
        sym, j, tx, ty = targets[ti]
        t0 = reveal_t0(sym) + j * 0.35
        p = in_out_quint(seg(ff, t0, t0 + 44))
        cx, cy, _ = L.card_xy(sym, ff)
        tgx, tgy = project(cam_fn(ff), cx + tx, cy + ty)
        x0, y0 = sx0[pi], sy0[pi]
        x, y = lerp(x0, tgx, p), lerp(y0, tgy, p)
        dx, dy = tgx - x0, tgy - y0
        ln = math.hypot(dx, dy) or 1
        arc = math.sin(math.pi * p) * min(90, ln * 0.18) * (1 if pi % 2 else -1)
        return x - dy / ln * arc, y + dx / ln * arc, p

    for k, (pi, ti) in enumerate(pairs):
        x, y, p = pos_at(f, pi, ti)
        if p >= 1:
            continue
        col = act1.COL[act1.KIND[pi]]
        a = float(act1.fog(dz0[pi])) * (1 - 0.7 * smooth(seg(p, 0.85, 1.0)))
        if 0.02 < p < 0.98:
            xp, yp, _ = pos_at(f - 1.6, pi, ti)
            ov.line([(xp, yp), (x, y)], col, 1.3, a * 0.55)
        ov.dot(x, y, 1.5, col, a)
    # the rest disperse outward and fade
    q = seg(f, CUE['screenerix'], CUE['screenerix'] + 34)
    if q < 1:
        for pi in extra[::2]:
            x0, y0 = sx0[pi], sy0[pi]
            dx, dy = x0 - 960, y0 - 540
            x, y = x0 + dx * 0.5 * out_cubic(q), y0 + dy * 0.5 * out_cubic(q)
            ov.dot(x, y, 1.3, act1.COL[act1.KIND[pi]], float(act1.fog(dz0[pi])) * (1 - q) * 0.8)


def map_card_alpha(sym, f):
    t0 = reveal_t0(sym)
    candles = smooth(seg(f, t0 + 30, t0 + 50))
    panel = smooth(seg(f, t0 + 34, t0 + 60))
    return candles, panel


def live_pulse(sym, f):
    """'Every market, live.' — a wave of LIVE pulses spreading from the signal's card."""
    x, y, _ = L.card_xy(sym, f)
    wx, wy, _ = L.card_xy('WIF', f)
    d = math.hypot(x - wx, y - wy) / 378.0
    t = f - (CUE['live'] + d * 3.2)
    return math.exp(-((t - 6) / 9.0) ** 2) if -20 < t < 40 else 0.0


# ── Densities morph ──
M0 = CUE['order'] - 16  # morph start


def dens_mix(sym, f):
    x, y, _ = L.card_xy(sym, f)
    hx, hy = L.slot_xy(L.HERO_SLOT)
    d = math.hypot(x - hx, y - hy) / 378.0
    return smooth(seg(f, M0 + 8 + d * 5, M0 + 34 + d * 5))


def hero_state(f):
    s_on = CUE['sized']
    size = out_cubic(seg(f, s_on, s_on + 26))
    bar = out_expo(seg(f, s_on, s_on + 22))
    size_glow = math.exp(-max(0, f - s_on) / 22) * (1 if f >= s_on else 0)
    t_on = CUE['tracked']
    dist = smooth(seg(f, t_on, t_on + 12))
    hl = smooth(seg(f, t_on - 2, t_on + 16))
    m_on = CUE['timed']
    life = smooth(seg(f, m_on, m_on + 10))
    life_s = 252 + max(0, f - m_on) / 60.0
    return {'i': D.HERO_ROW, 'bar': bar, 'size': size, 'size_glow': size_glow * 0.9, 'bar_glow': size_glow * 0.8,
            'dist': dist, 'life': life, 'life_s': life_s, 'hl': hl}


def hero_rect(f):
    x, y, _ = L.card_xy(L.HERO, f)
    return x, y


def draw_terminal(cv, f, ui_a):
    """The terminal page: frame, header, section title, 25 cards (map → densities)."""
    fx0, fy0, fx1, fy1 = L.FRAME
    head_a = smooth(seg(f, CUE['screenerix'] + 30, CUE['map'] + 4)) * ui_a
    cv.rect(fx0, fy0, fx1, fy1, fill=(255, 255, 255), a=0.018 * head_a, r=18)
    cv.rect(fx0, fy0, fx1, fy1, outline=C['line'], a=head_a, r=18, w=1.2)
    tab = 2.0 * in_out(seg(f, M0 + 4, M0 + 26))
    ui.terminal_header(cv, L.HX, L.HY, L.HWIDTH, active=tab, a=head_a, f=f)
    # section title (Market Map → Densities)
    m = in_out(seg(f, M0 + 4, M0 + 26))
    ty = L.GY - 16
    cv.text(L.GX + 4, ty, 'Market Map', 20, 800, C['text'], a=head_a * (1 - m))
    cv.text(L.GX + 4 + tw('Market Map', 20, 800) + 12, ty, '25 live charts · 1m · top 5m Range · coins ≥ $5M 24h', 12, 400, C['muted'], a=head_a * (1 - m))
    cv.text(L.GX + 4, ty, 'Densities', 14, 600, C['text'], a=head_a * m)
    cv.text(L.GX + 4 + tw('Densities', 14, 600) + 12, ty, '214 coins · ≥ $300K within 2% · Binance Futures 412 / 412', 12, 400, C['muted'], a=head_a * m)

    # cards: draw re-ranking ones last (lifted above the grid)
    order = sorted(L.ORDER, key=lambda s: L.card_xy(s, f)[2])
    for sym in order:
        if sym == L.HERO and f >= M0:
            continue
        x, y, lift = L.card_xy(sym, f)
        ca, pa = map_card_alpha(sym, f)
        if ca <= 0.003 and pa <= 0.003:
            continue
        dm = dens_mix(sym, f) if f >= M0 else 0.0
        if lift > 0.01:
            cv.rect(x + 6, y + 14, x + L.CARD_W + 6, y + L.CARD_H + 18, fill=(0, 0, 0), a=0.45 * lift * ui_a, r=14)
            cv.rect(x, y, x + L.CARD_W, y + L.CARD_H, fill=C['bg'], a=min(1.0, lift * 3) * ui_a, r=12)
        if dm < 0.5:
            lp = live_pulse(sym, f)
            ui.chart_card(cv, x, y, L.CARD_W, L.CARD_H, sym, f, a=ui_a * (1 - smooth(dm * 2)), content=1.0, chart_a=ca,
                          panel_a=pa, live_glow=lp + (signal_owner_glow(sym, f)))
            if lift > 0.01:
                cv.rect(x, y, x + L.CARD_W, y + L.CARD_H, outline=C['up'], a=0.5 * lift * ui_a, r=12, w=1.2)
        if dm > 0.5:
            rows = L.density_rows(sym)
            last = D.PRICE[sym] * D.live(sym, f, 0.0006)
            ui.density_card(cv, x, y, L.CARD_W, sym, last, D.stat(sym, 'chg'), rows, f, a=ui_a * smooth(dm * 2 - 1),
                            live_icon=1.0 if sym in ('BTC', 'ETH', 'WIF') else 0.0)
    draw_hero(cv, f, ui_a)


def signal_owner_glow(sym, f):
    if sym == 'WIF' and CUE['map'] - 10 < f < CUE['ranked'] + 30:
        return 0.35
    if sym == L.HERO and CUE['ranked'] + 30 <= f < M0:
        return 0.35
    return 0.0


def draw_hero(cv, f, ui_a):
    """SOL: chart card that becomes the Densities card (price scale → order-book ladder)."""
    x, y = hero_rect(f)
    ca, pa = map_card_alpha(L.HERO, f)
    if f < M0:
        return  # drawn with the grid
    w = L.CARD_W
    chart_a = 1 - smooth(seg(f, M0, M0 + 26))
    axis_a = 1 - smooth(seg(f, M0 + 12, M0 + 34))
    rows = D.SOL_ROWS
    dens_h = 10 + 20 + 4 + 22.5 * len(rows) + 10
    hh = lerp(L.CARD_H, dens_h, in_out(seg(f, M0 + 20, M0 + 48)))
    ui.glass(cv, x, y, x + w, y + hh, a=ui_a)
    geo = None
    if chart_a > 0.003 or axis_a > 0.003:
        geo = ui.chart_card(cv, x, y, w, L.CARD_H, L.HERO, f, a=ui_a, content=max(chart_a, axis_a) * 1.0,
                            chart_a=chart_a, axis_a=axis_a, panel_a=0.0, wm=True,
                            header_a=(1 - smooth(seg(f, M0 + 4, M0 + 18))) / max(chart_a, axis_a, 1e-3))
    # header crossfade: density header grows in
    hdr = smooth(seg(f, M0 + 18, M0 + 40))
    grow = [smooth(seg(f, M0 + 26 + i * 3.5, M0 + 44 + i * 3.5)) for i in range(len(rows))]
    hero = hero_state(f)
    last = D.SOL_LAST * (1 + 0.0004 * math.sin(f * 0.09))
    ui.density_card(cv, x, y, w, L.HERO, last, 0.0214, rows, f, a=ui_a, live_icon=hdr * live_icon_pulse(f),
                    hero=hero, header_a=hdr, rows_a=1.0, row_grow=grow, panel_a=0.0)
    # the ladder: price-scale labels fly into the row price column
    if geo is not None or f < M0 + 50:
        Yf = geo['Y'] if geo else None
        for i, (price, side, notional, life) in enumerate(rows):
            p = in_out(seg(f, M0 + 8 + i * 2, M0 + 36 + i * 2))
            if p <= 0 or grow[i] >= 0.999:
                continue
            sy0 = (Yf(price) if Yf else y + 120) + 4
            sx0 = x + w - 54 + 6
            ex, ey = x + 10, ui.density_row_y(y, i) + 4
            lx, ly = lerp(sx0, ex, p), lerp(sy0, ey, p)
            col = C['down'] if side == 'ask' else C['up']
            la = ui_a * (1 - grow[i]) * smooth(seg(f, M0 + 2, M0 + 10))
            cv.text(lx, ly, fmt_price(price), 11, 400, col, a=la)
            if p < 0.6:
                cv.line([(x + 36, sy0 - 4), (x + w - 54, sy0 - 4)], col, w=1, a=la * 0.35 * (1 - p / 0.6))


def live_icon_pulse(f):
    return 0.75 + 0.25 * math.sin(f * 0.12)


# ── WIF spike ──

def wif_spike(f):
    s = CUE['spike'] - 2
    g = settle((f - s) / 60.0, 1.3, 7.5) if f >= s else 0.0
    return g


def draw_wif(cv, f, ui_a):
    x, y, w, h = L.WIF_PANEL
    if not cv.visible(x, y, x + w, y + h, 60):
        return None
    cs = list(D.wif_candles())
    g = wif_spike(f)
    o, hh, ll, c, v = cs[-1]
    o = cs[-2][3]
    close = o * (1 + 0.0004 * math.sin(f * 0.13) + 0.0165 * g)
    cs[-1] = (o, max(o, close) * (1 + 0.0012 * g), min(o, close) * 0.9994, close, v)
    vol = D.WIF_AVG_VOL * (0.9 + (D.WIF_SPIKE_X - 0.9) * g)
    cap = cs[-2][3] * 1.0205
    stats = [('5m Range', '3.12%', None), ('Fund.', '+0.0100%', C['up']), ('Daily range', '11.48%', None), ('Daily volume', '$690.4M', None)]
    geo = ui.chart_card(cv, x, y, w, h, 'WIF', f, venue='bybit', tf='1m', cs=cs, a=ui_a, last_override=close,
                        spike=vol, levels={'cap': cap}, stats=stats)
    if geo is None:
        return None
    n, step, px0, py1, py0 = geo['n'], geo['step'], geo['px0'], geo['py1'], geo['py0']
    vmax = max([k[4] for k in cs[:-1]] + [vol])
    max_h = (py1 - py0) * ui.VOL_PANE
    bx = px0 + step * (n - 0.5)
    top = py1 - vol / vmax * max_h
    if g > 0:
        cv.glow_rect(bx - step * 0.4, top, bx + step * 0.4, py1, C['up'], a=0.9 * ui_a * (0.5 + 0.5 * math.exp(-(f - CUE['spike']) / 30)))
        # multiplier read-out beside the bar
        cv.text(bx - step * 0.7, top - 8, f'×{D.WIF_SPIKE_X * clamp(g, 0, 1.0):.1f}', 12, 700, C['up'], a=ui_a * smooth(seg(f, CUE['spike'] + 4, CUE['spike'] + 14)), anchor='rs')
    geo.update(spike_x=bx, spike_top=top)
    # HeroVisual chip: pops above the spike
    ca = seg(f, CUE['spike'] + 12, CUE['spike'] + 20)
    if ca > 0:
        sc = settle((f - CUE['spike'] - 12) / 60.0, 1.6, 7.0)
        cxp, cyp = bx - 196 - 40, py0 + 36 + 10 * (1 - sc)
        pulse = 0.5 + 0.5 * math.cos((f - CUE['caught']) * 0.16)
        with cv.opacity(ui_a * ca):
            ui.spike_chip(cv, cxp, cyp, a=1.0, pulse=pulse, glow=math.exp(-max(0, f - CUE['caught']) / 20))
        lock = seg(f, CUE['caught'], CUE['caught'] + 20)
        if 0 < lock < 1:
            cv.rect(cxp - 6 * lock, cyp - 6 * lock, cxp + 196 + 6 * lock, cyp + 50 + 6 * lock, outline=C['up'], r=14, w=1.2, a=ui_a * (1 - lock) * 0.7)
        geo.update(chip_dot=(cxp + 18, cyp + 25))
    return geo


# ── Strategies ──

def eth_live(f):
    """The live candle climbs into the Entry line; at 'active' it closes through the level."""
    o, c_end = D.ETH_RISE[2]
    t = smooth(seg(f, CUE['setup'] - 10, CUE['active'])) * 0.88 + 0.12 * smooth(seg(f, CUE['active'] - 6, CUE['active'] + 30))
    wig = 0.8 * math.sin(f * 0.21) * (1 - seg(f, CUE['active'] - 20, CUE['active']))
    close = lerp(o + 1.0, c_end, t) + wig
    return o, close


def eth_series(f):
    cs = list(D.eth_candles())
    for i, (o, c) in enumerate(D.ETH_RISE[:2]):
        cs.append((o, c + 1.2, o - 1.6, c, 0.62 + 0.1 * i))
    o, c = eth_live(f)
    cs.append((o, max(o, c) + 0.6, o - 1.4, c, 0.5 + 0.6 * smooth(seg(f, CUE['active'] - 30, CUE['active'] + 10))))
    return cs


def stage_t(f):
    return in_out(seg(f, CUE['active'], CUE['active'] + 12))


def draw_strategy(cv, f, ui_a, keep_candles=None):
    fx, fy, fw = L.FORM_CARD
    x, y, w, h = L.STRAT_CHART
    if not cv.visible(fx - 40, y - 40, x + w + 40, y + h + 40):
        return None
    st = stage_t(f)
    glow = math.exp(-max(0, f - CUE['active']) / 26) * (1 if f >= CUE['active'] else 0)
    o, c = eth_live(f)
    to_entry = max(0, int(round((D.ETH_ENTRY - c) / D.ETH_ENTRY * 1e4)))
    ui.formation_card(cv, fx, fy, fw, f, stage_t=st, stage_glow=glow * 0.9, a=ui_a, to_entry=to_entry)
    cs = eth_series(f)
    levels = {'tp2': D.ETH_TP2, 'sl': D.ETH_SL}
    stats = [('5m Range', '0.42%', None), ('Fund.', '+0.0081%', C['up']), ('Daily range', '2.84%', None), ('Daily volume', '$14.20B', None)]
    sc = ui.chart_scale(x, y, w, h, cs, levels)
    skip = [sc['Y'](p) for p in (D.ETH_TP2, D.ETH_TP1, D.ETH_ENTRY, D.ETH_SL)]
    geo = ui.chart_card(cv, x, y, w, h, 'ETH', f, venue='binance', tf='15m', cs=cs, a=ui_a, last_override=c,
                        levels=levels, stats=stats, chart_a=1.0, axis_skip=skip)
    if geo is None:
        return None
    Y, px0, px1 = geo['Y'], geo['px0'], geo['px1']
    seg_x0 = px0 + geo['step'] * (len(cs) - 9)  # segments start on the origin candle
    for k, (kind, price) in enumerate((('tp2', D.ETH_TP2), ('tp1', D.ETH_TP1), ('entry', D.ETH_ENTRY), ('sl', D.ETH_SL))):
        p = out_cubic(seg(f, CUE['setup'] + 4 + k * 8, CUE['setup'] + 26 + k * 8))
        ui.level_line(cv, seg_x0, px1, Y(price), kind, p, px1 + 1, a=ui_a)
    # the breakout: entry line flares as price closes through
    if glow > 0:
        cv.glow_line([(seg_x0, Y(D.ETH_ENTRY)), (px1, Y(D.ETH_ENTRY))], C['entry'], w=3, a=glow * 0.6 * ui_a)
    step = geo['step']
    n = len(cs)
    rects = []
    for i in range(n - 3, n):
        oo, hh, ll, cc, vv = cs[i]
        xc = px0 + step * (i + 0.5)
        bw = max(1.0, step * 0.62)
        rects.append((xc - bw / 2, Y(max(oo, cc)), xc + bw / 2, Y(min(oo, cc))))
    geo.update(rects=rects, live_xy=(px0 + step * (n - 0.5), Y(c)), entry_y=Y(D.ETH_ENTRY))
    badge_x = fx + fw - 12
    geo.update(badge_dot=(badge_x - ui.tw_badge(st) + 10, fy + 20))
    return geo


# ── alerts ──

def toast_state(f):
    t0 = CUE['moment'] - 8
    p = seg(f, t0, t0 + 18)
    return p, settle((f - t0) / 60.0, 1.5, 7.0) if f >= t0 else 0.0


def tg_state(f):
    t0 = CUE['know'] - 26
    p = seg(f, t0, t0 + 16)
    return p, settle((f - t0) / 60.0, 1.3, 6.5) if f >= t0 else 0.0


def draw_alerts(cv, f, ui_a):
    p, s = toast_state(f)
    if p > 0:
        tx, ty = L.TOAST_XY
        with cv.opacity(ui_a * p):
            ui.toast(cv, tx + 70 * (1 - s), ty)
    p2, s2 = tg_state(f)
    if p2 > 0:
        gx, gy = L.TG_XY
        with cv.opacity(ui_a * p2):
            ui.telegram(cv, gx, gy + 60 * (1 - s2))
