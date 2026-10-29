#!/usr/bin/env python3
"""Synthesised sound design for the Screenerix film — no music, no samples; every event sits on a visual frame.

Writes out/sfx.wav (48 kHz stereo float). Cue frames come from the same timeline as the picture.
"""
import math
import os
import sys

import numpy as np
import soundfile as sf
from scipy.signal import butter, fftconvolve, sosfilt

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sx.core import CUE, FPS, NF  # noqa: E402
from sx import layout as L  # noqa: E402
from sx import world as Wd  # noqa: E402

SR = 48000
N = int(NF / FPS * SR) + SR  # one second of tail room
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out')

bus = np.zeros((2, N))
send = np.zeros((2, N))


def T(frame):
    return frame / FPS


def rng(seed):
    return np.random.default_rng(seed)


def env_exp(n, tau, attack=0.002):
    t = np.arange(n) / SR
    a = np.clip(t / max(attack, 1e-4), 0, 1)
    return a * np.exp(-t / tau)


def sos(kind, f, order=2):
    if kind == 'band':
        return butter(order, [max(20, f[0]), min(SR / 2 - 100, f[1])], btype='bandpass', fs=SR, output='sos')
    return butter(order, min(f, SR / 2 - 100), btype=kind, fs=SR, output='sos')


def filt(x, kind, f, order=2):
    return sosfilt(sos(kind, f, order), x)


def band_sweep(x, fc, width_oct=0.9):
    """Time-varying band-pass by STFT overlap-add; fc is an array of centre frequencies (Hz) per sample."""
    n = len(x)
    win, hop = 2048, 512
    w = np.hanning(win)
    out = np.zeros(n + win)
    norm = np.zeros(n + win)
    freqs = np.fft.rfftfreq(win, 1 / SR)
    lf = np.log2(np.maximum(freqs, 1.0))
    xp = np.concatenate([x, np.zeros(win)])
    for s in range(0, n, hop):
        seg = xp[s:s + win] * w
        c = fc[min(n - 1, s + win // 2)]
        g = np.exp(-0.5 * ((lf - math.log2(max(c, 20))) / (width_oct / 2.355)) ** 2)
        out[s:s + win] += np.fft.irfft(np.fft.rfft(seg) * g, win) * w
        norm[s:s + win] += w * w
    return out[:n] / np.maximum(norm[:n], 1e-3)


def pan_st(x, p):
    """Equal-power pan; p scalar or per-sample array in [-1, 1]."""
    p = np.clip(p, -1, 1)
    a = (p + 1) * math.pi / 4
    return np.vstack([x * np.cos(a), x * np.sin(a)])


def place(st, t, gain=1.0, rev=0.0):
    i = int(round(t * SR))
    if st.ndim == 1:
        st = np.vstack([st, st]) * 0.7071
    n = min(st.shape[1], N - i)
    if n <= 0:
        return
    j0 = max(0, -i)
    bus[:, max(0, i):i + n] += st[:, j0:n] * gain
    if rev > 0:
        send[:, max(0, i):i + n] += st[:, j0:n] * gain * rev


def db(x):
    return 10 ** (x / 20)


# ── instruments ──

def whoosh(dur, peak, f0, fpk, f1, pan0=0.0, pan1=0.0, width=1.0, body=0.45, seed=1):
    n = int(dur * SR)
    t = np.arange(n) / SR
    r = rng(seed)
    nl, nr = r.standard_normal(n), r.standard_normal(n)
    u = np.clip(t / peak, 0, 1)
    v = np.clip((t - peak) / max(dur - peak, 1e-3), 0, 1)
    lf = np.where(t < peak, np.log2(f0) + (np.log2(fpk) - np.log2(f0)) * u ** 1.4,
                  np.log2(fpk) + (np.log2(f1) - np.log2(fpk)) * v ** 0.8)
    fc = 2 ** lf
    e = np.where(t < peak, u ** 2.2, np.exp(-v * 4.2) * (1 - v) ** 0.5)
    left = band_sweep(nl, fc, width) * e
    right = band_sweep(nr, fc * 1.04, width) * e
    if body > 0:
        b = filt(r.standard_normal(n), 'low', 220, 2) * e * body * 3
        left, right = left + b, right + b
    p = pan0 + (pan1 - pan0) * np.clip(t / dur, 0, 1)
    a = (np.clip(p, -1, 1) + 1) * math.pi / 4
    st = np.vstack([left * np.cos(a) * 1.41, right * np.sin(a) * 1.41])
    return st / (np.abs(st).max() + 1e-9)


def impact(depth=1.0, tau=0.38, f_hi=62, f_lo=33, seed=3):
    n = int(SR * (tau * 5 + 0.2))
    t = np.arange(n) / SR
    f = f_lo + (f_hi - f_lo) * np.exp(-t / 0.09)
    sub = np.sin(2 * np.pi * np.cumsum(f) / SR) * env_exp(n, tau, 0.003)
    thump = np.sin(2 * np.pi * np.cumsum(120 * np.exp(-t / 0.05) + 70) / SR) * env_exp(n, 0.07, 0.001) * 0.6
    r = rng(seed)
    trans = filt(r.standard_normal(n), 'high', 1400, 2) * env_exp(n, 0.006, 0.0004) * 0.5
    crunch = filt(r.standard_normal(n), 'band', (260, 1100), 2) * env_exp(n, 0.05, 0.001) * 0.35
    x = sub * depth + thump + trans + crunch
    x = np.tanh(x * 1.6) / np.tanh(1.6)
    return x / (np.abs(x).max() + 1e-9)


GLASS = [1.0, 2.32, 4.25, 6.63, 9.38]


def glass(f=2600, decay=0.16, bright=0.6, seed=5):
    n = int(SR * decay * 6)
    t = np.arange(n) / SR
    r = rng(seed)
    x = np.zeros(n)
    for k, ratio in enumerate(GLASS):
        fr = f * ratio * (1 + r.normal(0, 0.004))
        if fr > SR / 2 - 500:
            break
        amp = (bright ** k) / (1 + k * 0.6)
        x += amp * np.sin(2 * np.pi * fr * t + r.uniform(0, 6.28)) * np.exp(-t / (decay / (1 + k * 0.9)))
    x += filt(r.standard_normal(n), 'high', 5000, 2) * env_exp(n, 0.0025, 0.0002) * 0.5
    x *= np.clip(t / 0.0006, 0, 1)
    return x / (np.abs(x).max() + 1e-9)


def tick(f=3200, dur=0.03, seed=7, q2=1.6):
    n = int(SR * dur)
    r = rng(seed)
    x = r.standard_normal(n) * env_exp(n, 0.0015, 0.0002)
    a = filt(x, 'band', (f / 1.25, f * 1.25), 2)
    b = filt(x, 'band', (f * q2 / 1.2, f * q2 * 1.2), 2) * 0.6
    y = (a + b) * env_exp(n, dur / 3, 0.0003)
    return y / (np.abs(y).max() + 1e-9)


def grains(t0, t1, rate_fn, gain_fn, seed=11, fmin=2800, fmax=9000):
    """Data ticks: a sparse, stereo field of micro-clicks (Act I's thousands of tickers)."""
    r = rng(seed)
    t = t0
    while t < t1:
        rate = max(1e-3, rate_fn(t))
        t += r.exponential(1 / rate)
        if t >= t1:
            break
        g = gain_fn(t) * r.uniform(0.25, 1.0)
        if g <= 0.001:
            continue
        x = tick(r.uniform(fmin, fmax), 0.018, seed=int(r.integers(1e9)))
        place(pan_st(x, r.uniform(-0.9, 0.9)), t, g, rev=0.25)


def riser(dur, f0, f1, seed=13, curve=2.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    u = t / dur
    fc = 2 ** (np.log2(f0) + (np.log2(f1) - np.log2(f0)) * u ** 1.3)
    r = rng(seed)
    e = u ** curve
    e[-int(0.006 * SR):] *= np.linspace(1, 0, int(0.006 * SR))
    left = band_sweep(r.standard_normal(n), fc, 0.7) * e
    right = band_sweep(r.standard_normal(n), fc * 1.03, 0.7) * e
    st = np.vstack([left, right])
    return st / (np.abs(st).max() + 1e-9)


def shimmer(dur, count, fmin, fmax, seed=17, shape='decay'):
    n = int(dur * SR) + SR
    st = np.zeros((2, n))
    r = rng(seed)
    for k in range(count):
        u = r.uniform(0, 1) ** (1.6 if shape == 'decay' else 1.0)
        ts = u * dur
        g = (1 - u) ** 1.5 if shape == 'decay' else math.sin(math.pi * u)
        x = glass(r.uniform(fmin, fmax), r.uniform(0.05, 0.14), 0.45, seed=int(r.integers(1e9))) * g
        i = int(ts * SR)
        m = min(len(x), n - i)
        st[:, i:i + m] += pan_st(x[:m], r.uniform(-0.8, 0.8))
    return st / (np.abs(st).max() + 1e-9)


def air(dur, fc=1800, width=1.6, seed=19):
    n = int(dur * SR)
    t = np.arange(n) / SR
    e = np.sin(np.pi * np.clip(t / dur, 0, 1)) ** 2
    r = rng(seed)
    st = np.vstack([band_sweep(r.standard_normal(n), np.full(n, fc), width) * e,
                    band_sweep(r.standard_normal(n), np.full(n, fc * 1.05), width) * e])
    return st / (np.abs(st).max() + 1e-9)


def reverb_ir(seconds=2.2, seed=23):
    n = int(seconds * SR)
    t = np.arange(n) / SR
    r = rng(seed)
    ir = np.zeros((2, n))
    for ch in range(2):
        x = np.zeros(n)
        for lo, hi, tau, g in ((40, 400, 0.52, 0.9), (400, 2500, 0.40, 0.8), (2500, 12000, 0.22, 0.5)):
            x += filt(r.standard_normal(n), 'band', (lo, hi), 2) * np.exp(-t / tau) * g
        pre = int(0.018 * SR)
        x = np.concatenate([np.zeros(pre), x[:-pre]])
        for d, g in ((0.011, 0.5), (0.023, 0.35), (0.037, 0.25)):  # early reflections
            k = int((d + ch * 0.003) * SR)
            x[k] += g
        ir[ch] = x / np.sqrt(np.sum(x ** 2))
    return ir


# ── the cue sheet ──

def build():
    # Act I — signal birth, the field of tickers, six exchanges, the question
    place(air(1.2, 3200, 1.2, seed=31), T(2), db(-30), rev=0.4)
    place(glass(3400, 0.5, 0.35, seed=32), T(8), db(-31), rev=0.6)  # the signal wakes
    grains(T(CUE['thousands'] - 6), T(CUE['screenerix'] - 10),
           lambda t: 6 + 70 * np.clip((t - T(CUE['thousands'])) / 0.6, 0, 1) * (1 - 0.82 * np.clip((t - T(CUE['one'])) / 0.8, 0, 1)),
           lambda t: db(-33) * np.clip((t - T(CUE['thousands'] - 6)) / 0.4, 0, 1) * (1 - 0.6 * np.clip((t - T(CUE['one'])) / 0.8, 0, 1)), seed=33)
    place(whoosh(1.6, 0.9, 300, 1600, 500, -0.2, 0.2, 1.3, 0.6, seed=34), T(CUE['thousands'] - 20), db(-24), rev=0.3)
    for i in range(6):  # ignitions — glass taps, varied but never a melody
        fi = CUE['six'] + 2 + i * 10
        ang = -90 + i * 60
        p = math.cos(math.radians(ang)) * 0.6
        place(pan_st(glass(2900 + 140 * ((i * 7) % 5), 0.11, 0.5, seed=40 + i), p), T(fi), db(-25), rev=0.35)
        place(pan_st(air(0.22, 5200, 1.0, seed=50 + i)[0], p), T(fi) - 0.03, db(-34), rev=0.2)
    # "One question" — time slows: a falling sweep
    n = int(1.1 * SR)
    tt = np.arange(n) / SR
    down = band_sweep(rng(60).standard_normal(n), 2 ** (np.log2(3800) - (np.log2(3800) - np.log2(260)) * (tt / 1.1) ** 0.7), 1.0)
    down *= np.exp(-tt / 0.45) * np.clip(tt / 0.04, 0, 1)
    place(pan_st(down / np.abs(down).max(), 0), T(CUE['one'] - 4), db(-27), rev=0.4)
    place(whoosh(1.0, 0.25, 900, 600, 120, 0, 0, 1.2, 0.8, seed=61), T(CUE['one'] - 6), db(-28))
    # "move" — WIF answers: a single clean ping
    place(pan_st(glass(2300, 0.32, 0.4, seed=62), 0.35), T(CUE['move']), db(-22), rev=0.5)
    place(pan_st(impact(0.4, 0.12, 120, 70, seed=63), 0.3), T(CUE['move']), db(-30))
    # the pause — reverse swell into the map
    place(riser(T(CUE['screenerix']) - T(CUE['move'] + 26), 300, 5200, seed=64, curve=2.4), T(CUE['move'] + 26), db(-23), rev=0.3)

    # Act II — impact: the noise becomes a map
    place(impact(1.0, 0.42, seed=70), T(CUE['screenerix']) - 0.004, db(-13), rev=0.35)
    place(shimmer(0.9, 26, 3800, 8500, seed=71), T(CUE['screenerix']), db(-26), rev=0.5)
    for sym in L.ORDER:  # each card lands as its candles arrive
        t_land = T(Wd.reveal_t0(sym) + 44)
        x, y = L.slot_xy(L.HOME[sym])
        p = np.clip((x + L.CARD_W / 2) / 1100, -0.8, 0.8)
        place(pan_st(tick(4200 + (L.HOME[sym] * 173) % 1800, 0.02, seed=80 + L.HOME[sym]), p), t_land, db(-33), rev=0.3)
    place(air(0.7, 900, 1.4, seed=72), T(CUE['map'] - 10), db(-31), rev=0.2)
    # "live" — a soft pulse travelling the grid
    place(air(0.55, 1500, 1.0, seed=73), T(CUE['live']) - 0.05, db(-28), rev=0.6)
    place(glass(1800, 0.26, 0.3, seed=74), T(CUE['live']), db(-30), rev=0.6)
    place(whoosh(1.8, 0.8, 200, 700, 250, -0.4, 0.4, 1.4, 0.4, seed=75), T(CUE['every'] - 10), db(-31))
    # "Ranked as it moves" — three slot swaps
    for k, (a, b, f0, f1) in enumerate(L.SWAPS):
        xa, _ = L.slot_xy(L.HOME[a])
        xb, _ = L.slot_xy(L.HOME[b])
        place(whoosh((f1 - f0) / FPS + 0.1, (f1 - f0) / FPS * 0.5, 700, 2600, 900,
                     np.clip(xa / 900, -0.8, 0.8), np.clip(xb / 900, -0.8, 0.8), 0.9, 0.2, seed=90 + k), T(f0), db(-27))
        place(tick(3600, 0.025, seed=95 + k), T(f1), db(-31), rev=0.2)

    # Act III — push into the card, the ladder, the wall
    place(whoosh(1.15, 0.72, 160, 900, 140, 0, 0, 1.3, 0.9, seed=100), T(CUE['order'] - 34), db(-21), rev=0.2)
    for i in range(6):
        place(pan_st(tick(5200 - i * 260, 0.02, seed=110 + i), -0.2 + i * 0.05), T(Wd.M0 + 34 + i * 3.5), db(-32), rev=0.25)
    # Sized — the liquidity wall reveal accent
    place(impact(0.55, 0.22, 95, 48, seed=120), T(CUE['sized']) - 0.004, db(-17), rev=0.3)
    fill = whoosh(0.42, 0.32, 600, 2400, 3000, -0.3, 0.3, 0.7, 0.0, seed=121)
    place(fill, T(CUE['sized']), db(-29), rev=0.3)
    place(glass(1500, 0.22, 0.35, seed=122), T(CUE['sized']) + 0.01, db(-27), rev=0.4)
    # Tracked — a precise double tick
    place(pan_st(tick(3000, 0.03, seed=130), 0.15), T(CUE['tracked']) - 0.002, db(-21), rev=0.2)
    place(pan_st(tick(3400, 0.03, seed=131), 0.25), T(CUE['tracked']) + 0.075, db(-24), rev=0.2)
    # Timed — the lifetime clock
    place(pan_st(tick(2500, 0.04, seed=140, q2=1.64), 0.35), T(CUE['timed']) - 0.002, db(-20), rev=0.25)
    place(pan_st(tick(2500, 0.04, seed=141, q2=1.64), 0.35), T(CUE['timed'] + 60), db(-32), rev=0.25)

    # Act IV — the whip to the spike
    place(whoosh(0.95, 0.5, 300, 3200, 600, -0.7, 0.7, 1.1, 0.6, seed=150), T(CUE['timed'] + 36), db(-17), rev=0.15)
    place(riser(T(CUE['spike']) - T(CUE['spike'] - 22), 500, 3800, seed=151, curve=1.6), T(CUE['spike'] - 22), db(-27))
    place(impact(1.0, 0.5, 70, 30, seed=152), T(CUE['spike']) - 0.006, db(-12), rev=0.3)
    up = riser(0.24, 400, 4200, seed=153, curve=0.6)
    place(up * np.linspace(1, 0.2, up.shape[1]), T(CUE['spike']), db(-24), rev=0.4)
    place(pan_st(glass(3100, 0.12, 0.55, seed=154), 0.3), T(CUE['spike'] + 12), db(-25), rev=0.35)  # chip pop
    place(pan_st(tick(4400, 0.02, seed=155), 0.3), T(CUE['caught']), db(-29), rev=0.2)            # chip locks
    place(whoosh(0.9, 0.45, 260, 1800, 400, -0.5, 0.6, 1.2, 0.5, seed=160), T(CUE['setup'] - 40), db(-22), rev=0.15)
    for k in range(4):  # level lines draw on
        n = int(0.34 * SR)
        tt = np.arange(n) / SR
        dr = band_sweep(rng(170 + k).standard_normal(n), np.linspace(1400, 4200, n), 0.35)
        dr *= np.sin(np.pi * tt / 0.34) ** 1.5
        place(pan_st(dr / np.abs(dr).max(), -0.1 + k * 0.12), T(CUE['setup'] + 4 + k * 8), db(-31), rev=0.25)
    # tension into ACTIVE
    place(riser(T(CUE['active']) - T(CUE['forming'] + 14), 240, 2600, seed=180, curve=2.6), T(CUE['forming'] + 14), db(-25))
    grains(T(CUE['forming'] + 14), T(CUE['active']) - 0.02,
           lambda t: 4 + 60 * ((t - T(CUE['forming'] + 14)) / (T(CUE['active']) - T(CUE['forming'] + 14))) ** 2,
           lambda t: db(-34), seed=181, fmin=3000, fmax=6000)
    # ACTIVE — confirmation strike
    place(impact(0.7, 0.3, 80, 40, seed=190), T(CUE['active']) - 0.004, db(-15), rev=0.35)
    place(glass(2050, 0.42, 0.5, seed=191), T(CUE['active']), db(-21), rev=0.55)
    place(shimmer(0.7, 14, 4200, 8000, seed=192), T(CUE['active']) + 0.02, db(-29), rev=0.6)

    # alerts
    place(whoosh(1.0, 0.5, 240, 1400, 300, -0.2, 0.6, 1.3, 0.5, seed=200), T(CUE['active'] + 28), db(-25), rev=0.15)
    place(pan_st(air(0.3, 2600, 1.2, seed=201)[0], 0.2), T(CUE['moment'] - 10), db(-28), rev=0.3)
    place(pan_st(glass(2700, 0.14, 0.45, seed=202), 0.1), T(CUE['moment'] - 4), db(-25), rev=0.4)  # toast lands
    place(pan_st(air(0.34, 1900, 1.4, seed=203)[0], 0.5), T(CUE['know'] - 22), db(-29), rev=0.3)
    place(pan_st(glass(1950, 0.38, 0.42, seed=204), 0.45), T(CUE['know']) - 0.004, db(-20), rev=0.55)  # "you'll know"
    place(pan_st(impact(0.3, 0.1, 140, 90, seed=205), 0.4), T(CUE['know']), db(-29))

    # Act V — pull-back, candles, the mark
    place(whoosh(1.6, 0.7, 180, 1100, 90, 0.4, -0.2, 1.6, 1.0, seed=210), T(CUE['market2'] - 10), db(-19), rev=0.35)
    place(air(1.4, 600, 1.8, seed=211), T(CUE['market2'] + 10), db(-30), rev=0.4)
    place(riser(T(CUE['you']) - T(CUE['seconds'] + 4), 200, 4800, seed=212, curve=2.8), T(CUE['seconds'] + 4), db(-24), rev=0.25)
    place(shimmer(1.0, 18, 3000, 7000, seed=213, shape='swell'), T(CUE['seconds'] + 20), db(-31), rev=0.5)
    place(impact(1.0, 0.65, 58, 28, seed=220), T(CUE['you']) - 0.006, db(-11), rev=0.45)  # logo hit
    place(glass(1650, 0.6, 0.45, seed=221), T(CUE['you']), db(-22), rev=0.7)
    place(shimmer(1.6, 30, 3500, 9000, seed=222), T(CUE['you']) + 0.03, db(-28), rev=0.7)
    for i in range(8):  # SCREENER letters
        place(pan_st(tick(5600 + i * 90, 0.016, seed=230 + i), -0.4 + i * 0.1), T(CUE['you'] + 18 + i * 3.2 + 4), db(-37), rev=0.35)
    place(shimmer(0.8, 16, 5000, 10000, seed=240), T(CUE['brand']) - 0.01, db(-25), rev=0.6)  # IX
    place(air(0.9, 3800, 1.0, seed=241), T(CUE['brand']) - 0.15, db(-31), rev=0.5)
    place(pan_st(tick(3000, 0.03, seed=250), 0), T(CUE['brand_end'] + 28 + 12), db(-34), rev=0.4)  # CTA settles


def main():
    build()
    wet = np.vstack([fftconvolve(send[c], reverb_ir()[c])[:N] for c in range(2)])
    mix = bus + wet * 0.55
    mix = filt(mix, 'high', 28, 2)  # clean sub rumble below the impacts' fundamentals
    peak = np.abs(mix).max()
    print(f'sfx peak {20 * np.log10(peak + 1e-12):.1f} dBFS')
    os.makedirs(OUT, exist_ok=True)
    sf.write(os.path.join(OUT, 'sfx.wav'), mix.T.astype(np.float32), SR, subtype='FLOAT')
    print(os.path.join(OUT, 'sfx.wav'))


if __name__ == '__main__':
    main()
