#!/usr/bin/env python3
"""Voice-over + sound effects only (no music). Ducks the SFX under the voice, then masters to -14 LUFS / -1 dBTP."""
import json
import os
import subprocess
import sys

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sx.core import ASSETS, NF, FPS, VO  # noqa: E402

SR = 48000
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out')
DUR = NF / FPS


def envelope(x, attack=0.008, release=0.22):
    """Peak follower on |x| (one pole each way)."""
    a = np.exp(-1 / (attack * SR))
    r = np.exp(-1 / (release * SR))
    e = np.zeros_like(x)
    lvl = 0.0
    ax = np.abs(x)
    for i in range(0, len(x), 64):  # block-wise for speed; 1.3 ms resolution
        v = ax[i:i + 64].max()
        lvl = a * lvl + (1 - a) * v if v > lvl else r * lvl + (1 - r) * v
        e[i:i + 64] = lvl
    return e


def compress(x, thresh_db=-26.0, ratio=2.4, knee=8.0, attack=0.006, release=0.12):
    """Soft-knee RMS compressor (gentle, broadcast-style levelling of the narration)."""
    rms = np.sqrt(np.convolve(x * x, np.ones(480) / 480, mode='same') + 1e-12)
    lv = 20 * np.log10(rms)
    over = lv - thresh_db
    gr = np.where(over <= -knee / 2, 0.0,
                  np.where(over >= knee / 2, over * (1 - 1 / ratio), (1 - 1 / ratio) * (over + knee / 2) ** 2 / (2 * knee)))
    a, r = np.exp(-1 / (attack * SR / 64)), np.exp(-1 / (release * SR / 64))
    sm = np.zeros_like(gr)
    g = 0.0
    for i in range(0, len(gr), 64):
        v = gr[i:i + 64].max()
        g = a * g + (1 - a) * v if v > g else r * g + (1 - r) * v
        sm[i:i + 64] = g
    return x * 10 ** (-sm / 20)


def limiter(st, ceiling_db=-1.3, look=0.005, release=0.09):
    """Look-ahead true-peak limiter (4x oversampled detection)."""
    ceil = 10 ** (ceiling_db / 20)
    up = np.abs(resample_poly(st, 4, 1, axis=1)).max(axis=0)
    pk = up.reshape(-1, 4).max(axis=1)[:st.shape[1]]
    need = np.minimum(1.0, ceil / np.maximum(pk, 1e-9))
    la = int(look * SR)
    # min over the look-ahead window, then attack ramp (moving average) and exponential release
    from scipy.ndimage import minimum_filter1d, uniform_filter1d
    g = minimum_filter1d(need, size=2 * la + 1, origin=0)
    g = np.concatenate([g[la:], np.full(la, g[-1])])
    g = uniform_filter1d(g, size=la)
    r = np.exp(-1 / (release * SR))
    out = np.empty_like(g)
    cur = 1.0
    for i in range(len(g)):
        cur = g[i] if g[i] < cur else r * cur + (1 - r) * g[i]
        out[i] = cur
    d = np.concatenate([np.zeros(la), st[0][:-la]]), np.concatenate([np.zeros(la), st[1][:-la]])
    res = np.vstack(d) * out
    return np.concatenate([res[:, la:], np.zeros((2, la))], axis=1)


def main():
    vo, sr = sf.read(os.path.join(ROOT_VO), always_2d=False)
    if vo.ndim > 1:
        vo = vo.mean(axis=1)
    if sr != SR:
        vo = resample_poly(vo, SR, sr)
    n = int(DUR * SR)
    off = int(VO['vo_offset_s'] * SR)
    voice = np.zeros(n)
    m = min(len(vo), n - off)
    voice[off:off + m] = vo[:m]
    voice = compress(voice)

    sfx, sr2 = sf.read(os.path.join(OUT, 'sfx.wav'), always_2d=True)
    sfx = sfx.T[:, :n]
    if sfx.shape[1] < n:
        sfx = np.pad(sfx, ((0, 0), (0, n - sfx.shape[1])))

    # duck the effects under the narration (up to -5 dB), keeping transients that land between words
    env = envelope(voice)
    env = env / (env.max() + 1e-9)
    duck = 1 - 0.44 * np.clip(env * 3.0, 0, 1)
    sfx = sfx * duck

    voice_gain = 10 ** (11.0 / 20)
    sfx_gain = 10 ** (5.0 / 20)
    mix = np.vstack([voice, voice]) * voice_gain + sfx * sfx_gain
    mix = limiter(mix)
    # gentle end: the reverb tail finishes inside the picture's fade
    fade = int(0.35 * SR)
    mix[:, -fade:] *= np.linspace(1, 0, fade) ** 2
    pre = os.path.join(OUT, 'mix_pre.wav')
    sf.write(pre, mix.T.astype(np.float32), SR, subtype='FLOAT')

    # two-pass loudnorm (linear) → -14 LUFS integrated, -1 dBTP
    meas = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', pre, '-af', 'loudnorm=I=-14:TP=-1.0:LRA=11:print_format=json',
                           '-f', 'null', '-'], capture_output=True, text=True).stderr
    j = json.loads(meas[meas.rindex('{'):meas.rindex('}') + 1])
    af = ('loudnorm=I=-14:TP=-1.0:LRA=11:linear=true:'
          f"measured_I={j['input_i']}:measured_TP={j['input_tp']}:measured_LRA={j['input_lra']}:measured_thresh={j['input_thresh']}:offset={j['target_offset']}")
    final = os.path.join(OUT, 'mix.wav')
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', pre, '-af', af + ',aresample=48000', '-c:a', 'pcm_s24le', final], check=True)
    print('measured', {k: j[k] for k in ('input_i', 'input_tp', 'input_lra')})
    print(final)


ROOT_VO = os.path.join(ASSETS, 'audio', 'launch-voiceover-tightened.wav')

if __name__ == '__main__':
    main()
