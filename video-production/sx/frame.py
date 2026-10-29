"""One frame = pure function of its index: canvas → warp → glow → motion blur → overlays → grade."""
import math

import cv2
import numpy as np

from . import act1
from . import data as D
from . import layout as L
from . import ui
from . import world as Wd
from .camera import Cam, overscan, project, warp
from .canvas import GLOW_SS, Canvas, tw
from .core import (C, CUE, H, NF, W, clamp, in_out, in_out_quint, lerp, mix, out_cubic, seg, settle, smooth, brand)
from .post import Overlay, add_glow, finish, motion_blur

WORLD_START = CUE['screenerix']
E0 = CUE['seconds'] - 2          # camera settles after the pull-back
UI_FADE = (CUE['market2'] + 22, E0 + 14)
MORPH = (CUE['so'] - 2, CUE['you'] + 3)


# ── geometry helpers shared by drawing and the signal ──

def hero_geom(f):
    x, y = Wd.hero_rect(f)
    radio = (x + 10 + tw('SOL', 13, 800) + 6 + tw('BN·F', 9, 700) + 18 + 6 + 5.5, y + 19.5)
    ry = ui.density_row_y(y, D.HERO_ROW)
    return x, y, radio, ry


def wif_geom(f):
    x, y, w, h = L.WIF_PANEL
    cs = list(D.wif_candles())
    sc = ui.chart_scale(x, y, w, h, cs)
    g = Wd.wif_spike(f)
    vol = D.WIF_AVG_VOL * (0.9 + (D.WIF_SPIKE_X - 0.9) * g)
    vmax = max([k[4] for k in cs[:-1]] + [vol])
    bx = sc['px0'] + sc['step'] * (sc['n'] - 0.5)
    top = sc['py1'] - vol / vmax * (sc['py1'] - sc['py0']) * ui.VOL_PANE
    s2 = settle((f - CUE['spike'] - 12) / 60.0, 1.6, 7.0) if f > CUE['spike'] + 12 else 0
    chip = (bx - 196 - 40 + 18, sc['py0'] + 36 + 10 * (1 - s2) + 25)
    return bx, top, sc['py1'], chip


def eth_geom(f):
    x, y, w, h = L.STRAT_CHART
    cs = Wd.eth_series(f)
    o, c = Wd.eth_live(f)
    oo, hh, ll, _, v = cs[-1]
    cs[-1] = (oo, max(hh, c), min(ll, c), c, v)
    sc = ui.chart_scale(x, y, w, h, cs, {'tp2': D.ETH_TP2, 'sl': D.ETH_SL})
    Y, step, px0, n = sc['Y'], sc['step'], sc['px0'], sc['n']
    rects = []
    for i in range(n - 3, n):
        a, _, _, b, _ = cs[i]
        xc = px0 + step * (i + 0.5)
        bw = max(1.0, step * 0.62)
        rects.append((xc - bw / 2, Y(max(a, b)), xc + bw / 2, Y(min(a, b))))
    fx, fy, fw = L.FORM_CARD
    badge = (fx + fw - 12 - ui.tw_badge(Wd.stage_t(f)) + 10, fy + 20)
    return rects, (px0 + step * (n - 0.5), Y(c)), badge


# ── end card: three candles become the mark, then the wordmark ──
MARK_H = 168.0
WM_FS = 84.0
_k = MARK_H / ui.LOGO_VB[3]
MARK_CX_OFF = ((402 + 852) / 2 - ui.LOGO_VB[0]) * _k
MARK_CY_OFF = ((310 + 940) / 2 - ui.LOGO_VB[1]) * _k
MARK_W = (852 + 11 - (402 - 11)) * _k
GAP = MARK_H * 0.39
Y_C = 450.0


def lockup():
    wm_w = tw('SCREENERIX', WM_FS, 800, 0.08) + 0.08 * WM_FS
    total = MARK_W + GAP + wm_w
    x0 = W / 2 - total / 2
    return x0, wm_w


def end_scale(f):
    return 1 + 0.035 * smooth(seg(f, MORPH[0], NF))


def end_xf(f, x, y):
    s = end_scale(f)
    return W / 2 + (x - W / 2) * s, H / 2 + (y - H / 2) * s


def mark_origin(f):
    """Top-left of the mark (screen, before push) — centred, then sliding left into the lock-up."""
    x0, _ = lockup()
    left_x = x0 - ((402 - 11) - ui.LOGO_VB[0]) * _k
    centred_x = W / 2 - MARK_CX_OFF
    t = in_out(seg(f, CUE['you'] + 12, CUE['brand'] - 6))
    return lerp(centred_x, left_x, t), Y_C - MARK_CY_OFF


def bar_quads(f):
    """Screen quads of the three candles→bars at frame f (≥ E0)."""
    ox, oy = mark_origin(f)
    final = ui.logo_quads(ox, oy, MARK_H)
    rects, _, _ = eth_geom(E0)
    cam = L.camera(E0)
    src = []
    for (x0, y0, x1, y1) in rects:
        a = project(cam, x0, y0)
        b = project(cam, x1, y1)
        src.append([(a[0], a[1]), (b[0], a[1]), (b[0], b[1]), (a[0], b[1])])
    # pre-logo: axis-aligned bars standing where the slanted bars will be
    pre = []
    for q in final:
        xs = [p[0] for p in q]
        ys = [p[1] for p in q]
        x0, x1 = min(xs), max(xs)
        pre.append([(x0, min(ys) + 18), (x1, min(ys) + 18), (x1, max(ys) - 18), (x0, max(ys) - 18)])
    out = []
    for i in range(3):
        t_fly = in_out_quint(seg(f, E0 + 4 + i * 3, MORPH[0] + 4 + i * 2))
        t_m = in_out(seg(f, MORPH[0] + i * 2, MORPH[1] - 4 + i * 2))
        # quad corner order: src/pre are TL,TR,BR,BL; logo bars are listed TL,TR(top-right),BR,BL in viewBox order
        q = []
        for k in range(4):
            sx, sy = src[i][k]
            px, py = pre[i][k]
            fx_, fy_ = final[i][k]
            x = lerp(lerp(sx, px, t_fly), fx_, t_m)
            y = lerp(lerp(sy, py, t_fly), fy_, t_m)
            q.append(end_xf(f, x, y))
        out.append(q)
    return out


def draw_end(cv, f):
    if f < E0:
        return
    quads = bar_quads(f)
    with cv.screen():
        # warm brand glow behind the mark (preloader .lx-pre-glow)
        g = smooth(seg(f, MORPH[0], CUE['brand'] + 30))
        if g > 0:
            cx, cy = end_xf(f, W / 2, Y_C)
            for k in range(28):  # soft radial falloff, like .lx-pre-glow
                r = 470 * (1 - k / 28) + 30
                cv.glow_circle(cx, cy, r, (48, 164, 108), a=0.0038 * g)
        tm = in_out(seg(f, MORPH[0], MORPH[1]))
        for i, q in enumerate(quads):
            col = C['up'] if i == 2 else mix(C['up'], C['text'], tm)
            a = 0.85 + 0.15 * smooth(seg(f, E0, E0 + 20))
            if tm > 0.02:
                ui.draw_bar(cv, q, col, a=a, size=MARK_H * end_scale(f) * tm + 1e-6)
            else:
                cv.poly(q, fill=col, a=a)
            if i == 2:
                gl = 0.35 + 0.65 * math.exp(-max(0, f - CUE['you']) / 22) * (1 if f >= CUE['you'] - 4 else 0.3)
                cv.glow_poly(q, C['up'], a=gl * 0.9)
            elif tm < 1:
                cv.glow_poly(q, C['up'], a=0.4 * (1 - tm))
        # wordmark
        x0, wm_w = lockup()
        tx = x0 + MARK_W + GAP
        base = Y_C + WM_FS * 0.36
        s = end_scale(f)
        letters = 'SCREENER'
        cx = tx
        for i, ch in enumerate(letters):
            t0 = CUE['you'] + 18 + i * 3.2
            p = brand(seg(f, t0, t0 + 18))
            if p > 0:
                X, Y = end_xf(f, cx, base + 16 * (1 - p))
                cv.text(X, Y, ch, WM_FS * s, 800, C['text'], a=p)
            cx += tw(ch, WM_FS, 800) + 0.08 * WM_FS
        p = brand(seg(f, CUE['brand'] - 2, CUE['brand'] + 14))
        if p > 0:
            X, Y = end_xf(f, cx, base + 10 * (1 - p))
            cv.text(X, Y, 'IX', WM_FS * s, 800, C['up'], a=p, tracking=0.08)
            gl = math.exp(-max(0, f - CUE['brand']) / 30) * 0.9 + 0.12
            cv.glow_text(X, Y, 'IX', WM_FS * s, 800, C['up'], a=gl * p, tracking=0.08)
        # tagline + CTA
        t1 = CUE['brand_end'] + 6
        p = brand(seg(f, t1, t1 + 26))
        if p > 0:
            X, Y = end_xf(f, W / 2, 604 + 14 * (1 - p))
            cv.text(X, Y, 'The market moves in seconds. So should you.', 30 * s, 700, C['text'], a=0.94 * p, anchor='ms', tracking=-0.01)
        t2 = t1 + 22
        p = brand(seg(f, t2, t2 + 26))
        if p > 0:
            label = 'Start your free 3-day trial.'
            bw = tw(label, 19, 600) + 48
            bx0, by0 = W / 2 - bw / 2, 664 + 12 * (1 - p)
            (X0, Y0), (X1, Y1) = end_xf(f, bx0, by0), end_xf(f, bx0 + bw, by0 + 50)
            cv.glow_rect(X0 + 18, Y1 - 6, X1 - 18, Y1 + 10, C['up'], a=0.35 * p, r=10)
            cv.rect(X0, Y0, X1, Y1, fill=C['text'], a=p, r=10 * s)
            cv.text((X0 + X1) / 2, (Y0 + Y1) / 2 + 6.5 * s, label, 19 * s, 600, C['bg'], a=p, anchor='ms')


# ── the signal ──

def _scr(f, wx, wy):
    return project(L.camera(f), wx, wy)


def anchor_center(f):
    return 960 + 26 * math.sin(f * 0.017), 560 + 12 * math.sin(f * 0.023 + 1)


def anchor_wif_chip(f):
    x, y = act1.wif_pos(f)
    w = act1.label_sprite(act1.WIF_ID).width / act1.label_sprite(act1.WIF_ID).height * 18 * 1.22
    return x - w / 2 - 16, y - 6


def anchor_wif_card(f):
    x, y, _ = L.card_xy('WIF', f)
    return _scr(f, *L.conn_dot('WIF', x, y))


def anchor_sol_card(f):
    x, y, _ = L.card_xy('SOL', f)
    return _scr(f, *L.conn_dot('SOL', x, y))


def anchor_radio(f):
    _, _, r, _ = hero_geom(f)
    return _scr(f, *r)


def anchor_row_left(f):
    x, _, _, ry = hero_geom(f)
    return _scr(f, x + 6, ry)


def anchor_row_dist(f):
    x, _, _, ry = hero_geom(f)
    return _scr(f, x + L.CARD_W - 10 - 56 - 24, ry)


def anchor_row_life(f):
    x, _, _, ry = hero_geom(f)
    return _scr(f, x + L.CARD_W - 10 - 22, ry)


def anchor_spike(f):
    bx, top, base, _ = wif_geom(f)
    return _scr(f, bx, top)


def anchor_chip(f):
    _, _, _, chip = wif_geom(f)
    return _scr(f, *chip)


def anchor_eth(f):
    _, live, _ = eth_geom(f)
    return _scr(f, *live)


def anchor_badge(f):
    _, _, badge = eth_geom(f)
    return _scr(f, *badge)


def anchor_toast(f):
    _, s = Wd.toast_state(f)
    tx, ty = L.TOAST_XY
    return _scr(f, tx + 70 * (1 - s) + 20, ty + 20)


def anchor_tg(f):
    _, s = Wd.tg_state(f)
    gx, gy = L.TG_XY
    return _scr(f, gx + 21, gy + 60 * (1 - s) + 20)


def anchor_third(f):
    if f >= E0:
        q = bar_quads(f)[2]
        return q[0][0] * 0.5 + q[1][0] * 0.5, min(q[0][1], q[1][1]) + 4
    rects, _, _ = eth_geom(f)
    x0, y0, x1, y1 = rects[2]
    return _scr(f, (x0 + x1) / 2, y0)


SCHEDULE = [  # (start frame, transition frames, anchor)
    (0, 0, anchor_center),
    (CUE['wheres'], 26, anchor_wif_chip),
    (CUE['screenerix'], 52, anchor_wif_card),
    (CUE['ranked'] + 16, 28, anchor_sol_card),
    (Wd.M0 + 18, 24, anchor_radio),
    (CUE['tracked'] - 4, 20, anchor_row_left),
    (CUE['tracked'] + 18, 22, anchor_row_dist),
    (CUE['timed'] - 3, 14, anchor_row_life),
    (CUE['timed'] + 37, 48, anchor_spike),
    (CUE['caught'] - 6, 16, anchor_chip),
    (CUE['setup'] - 40, 44, anchor_eth),
    (CUE['active'] + 4, 16, anchor_badge),
    (CUE['moment'] - 12, 22, anchor_toast),
    (CUE['know'] - 26, 24, anchor_tg),
    (CUE['market2'] - 6, 56, anchor_third),
]


def signal_pos(f):
    cur = SCHEDULE[0][2](f)
    for i in range(1, len(SCHEDULE)):
        fs, dur, fn = SCHEDULE[i]
        if f < fs:
            break
        if f < fs + dur:
            prev = SCHEDULE[i - 1][2](f)
            nxt = fn(f)
            t = in_out(seg(f, fs, fs + dur))
            # a gentle arc so moves read as travel, not interpolation
            dx, dy = nxt[0] - prev[0], nxt[1] - prev[1]
            ln = math.hypot(dx, dy) or 1
            arc = math.sin(math.pi * t) * min(70, ln * 0.12)
            cur = (lerp(prev[0], nxt[0], t) - dy / ln * arc, lerp(prev[1], nxt[1], t) + dx / ln * arc)
        else:
            cur = fn(f)
    return cur


def signal_alpha(f):
    return smooth(seg(f, 2, 26)) * (1 - smooth(seg(f, CUE['you'] - 2, CUE['you'] + 10)))


def draw_signal(ov, f):
    a = signal_alpha(f)
    if a <= 0.003:
        return
    pts = [signal_pos(f - k * 0.75) for k in range(0, 16)]
    x, y = pts[0]
    # trail
    for k in range(len(pts) - 1):
        t = 1 - k / (len(pts) - 1)
        ov.line([pts[k + 1], pts[k]], C['mint'], 2.6 * t + 0.4, a * 0.55 * t)
    ov.glow_line(pts[:10], C['mint'], 6, a * 0.5)
    breathe = 0.85 + 0.15 * math.sin(f * 0.21)
    ov.glow_dot(x, y, 26 * breathe, C['mint'], a * 0.8)
    ov.glow_dot(x, y, 10, (220, 255, 236), a)
    ov.dot(x, y, 4.2, C['mint'], a)
    ov.dot(x, y, 2.0, (245, 255, 250), a)
    # arrival pings at beats
    for fb in (CUE['move'], CUE['live'], CUE['sized'], CUE['tracked'], CUE['timed'], CUE['spike'], CUE['active'], CUE['know']):
        q = seg(f, fb, fb + 28)
        if 0 < q < 1:
            ov.ring(x, y, 6 + 42 * out_cubic(q), C['mint'], 1.4, a * (1 - q) * 0.7)


# ── background ──

def draw_grid(cv, f, a):
    """The landing page's faint 56px grid, laid on the world plane."""
    if a <= 0.003:
        return
    z = cv.scale()
    step = 56.0
    if z * step < 7:
        step *= 2
    gx0, gy0 = cv.cam.cx - W * cv.ov / 2 / z, cv.cam.cy - H * cv.ov / 2 / z
    gx1, gy1 = cv.cam.cx + W * cv.ov / 2 / z, cv.cam.cy + H * cv.ov / 2 / z
    x = math.floor(gx0 / step) * step
    while x <= gx1:
        cv.line([(x, gy0), (x, gy1)], (255, 255, 255), w=1 / z, a=0.035 * a)
        x += step
    y = math.floor(gy0 / step) * step
    while y <= gy1:
        cv.line([(gx0, y), (gx1, y)], (255, 255, 255), w=1 / z, a=0.035 * a)
        y += step


def draw_screen_grid(cv, f, a):
    if a <= 0.003:
        return
    with cv.screen():
        off = (act1.zc(f) * 0.02) % 56
        x = (W / 2) % 56
        while x < W:
            cv.line([(x, 0), (x, H)], (255, 255, 255), w=1, a=0.03 * a)
            x += 56
        y = (H / 2 + off) % 56
        while y < H:
            cv.line([(0, y), (W, y)], (255, 255, 255), w=1, a=0.03 * a)
            y += 56


# ── frame ──

def cam_for(f):
    return L.camera(f) if f >= WORLD_START else Cam()


def screen_motion(f):
    """Affine map of screen motion over one frame (t-½ → t+½)."""
    if f < WORLD_START:
        s = 1 + act1.dolly_speed(f) * 0.0006
        return np.array([[s, 0, W / 2 * (1 - s)], [0, s, H / 2 * (1 - s)]], dtype=np.float64)
    if f < WORLD_START + 2:
        return np.array([[1, 0, 0], [0, 1, 0]], dtype=np.float64)
    c0, c1 = L.camera(f - 0.5), L.camera(f + 0.5)
    cam = L.camera(f)
    from .camera import unproject
    wpts = [unproject(cam, x, y) for x, y in ((W * 0.25, H * 0.3), (W * 0.75, H * 0.3), (W * 0.5, H * 0.8))]
    src = np.float32([project(c0, *p) for p in wpts])
    dst = np.float32([project(c1, *p) for p in wpts])
    return cv2.getAffineTransform(src, dst).astype(np.float64)


def ui_alpha(f):
    return 1 - smooth(seg(f, *UI_FADE))


def render(f):
    cam = cam_for(f)
    ov = overscan(cam)
    ss = 2.0 if ov <= 1.35 else 1.5
    cv = Canvas(cam, ss=ss, ov=ov)

    if f < WORLD_START:
        draw_screen_grid(cv, f, smooth(seg(f, 0, 40)) * (1 - 0.4 * smooth(seg(f, CUE['one'], CUE['one'] + 40)))
                         * (1 - smooth(seg(f, WORLD_START - 34, WORLD_START - 2))))
        act1.draw_field(cv, f, act1.global_alpha(f) * act1.dim(f))
        act1.draw_exchanges(cv, f)
        act1.draw_wif(cv, f, alpha=1 - smooth(seg(f, WORLD_START - 12, WORLD_START)))
    else:
        ua = ui_alpha(f)
        draw_grid(cv, f, smooth(seg(f, WORLD_START, WORLD_START + 60)) * ua)
        if f < CUE['market2'] + 80:
            Wd.draw_terminal(cv, f, ua)
        if f > CUE['timed'] + 20:
            Wd.draw_wif(cv, f, ua)
        if CUE['spike'] + 40 < f < E0:
            Wd.draw_strategy(cv, f, ua)
            # until the end card takes them, the three rising candles stay lit while the UI fades
            if UI_FADE[0] <= f < E0:
                rects, _, _ = eth_geom(f)
                for (x0, y0, x1, y1) in rects:
                    cv.rect(x0, y0, x1, y1, fill=C['up'], a=1.0)
                    cv.glow_rect(x0, y0, x1, y1, C['up'], a=0.5 * (1 - ua))
        if f > CUE['moment'] - 30:
            Wd.draw_alerts(cv, f, ua)
        draw_end(cv, f)

    img, glow = cv.arrays()
    if cam.flat() and ov == 1.0:
        out = cv2.resize(img, (W, H), interpolation=cv2.INTER_AREA)
        g = cv2.resize(glow, (W // 2, H // 2), interpolation=cv2.INTER_AREA) if glow.shape[1] != W // 2 else glow
    else:
        big = warp(img, cam, ov, ss, 2.0, C['bg'])
        out = cv2.resize(big, (W, H), interpolation=cv2.INTER_AREA)
        g = warp(glow, cam, ov, GLOW_SS, 0.5, (0, 0, 0))
    out = out.astype(np.float32) / 255.0
    out = add_glow(out, g, 1.0)
    out = motion_blur(out, screen_motion(f))

    ovl = Overlay()
    Wd.particle_flight(ovl, f, L.camera)
    if WORLD_START <= f < WORLD_START + 16:
        x0, y0 = act1.wif_pos(f)
        q = seg(f, WORLD_START, WORLD_START + 16)
        ovl.dot(x0, y0, 3 * (1 - q), C['mint'], 1 - q)
    draw_signal(ovl, f)
    out = ovl.composite(out)

    fade = smooth(seg(f, NF - 16, NF - 1))
    if fade > 0:
        out = out * (1 - fade) + np.array(C['bg'], np.float32) / 255.0 * fade
    return finish(out, f)
