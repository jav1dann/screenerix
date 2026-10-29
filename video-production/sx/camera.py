"""2.5D camera: zoom/pan over the world plane, plus pitch/roll applied as a homography."""
import math
from dataclasses import dataclass, replace

import cv2
import numpy as np

from .core import H, W, clamp, lerp

FOCAL = 2300.0  # perspective strength of pitch / roll (px)


@dataclass(frozen=True)
class Cam:
    cx: float = 0.0
    cy: float = 0.0
    zoom: float = 1.0
    pitch: float = 0.0  # degrees, + tips the top away from the viewer
    roll: float = 0.0   # degrees

    def flat(self):
        return abs(self.pitch) < 1e-3 and abs(self.roll) < 1e-3


class Track:
    """Keyframed camera: [(frame, Cam, ease)] — `ease` shapes the segment arriving at that key."""

    def __init__(self, keys):
        self.keys = sorted(keys, key=lambda k: k[0])

    def at(self, f):
        ks = self.keys
        if f <= ks[0][0]:
            return ks[0][1]
        for (fa, a, _), (fb, b, ease) in zip(ks, ks[1:]):
            if f <= fb:
                t = ease((f - fa) / (fb - fa)) if fb > fa else 1.0
                # zoom interpolates geometrically so pushes feel linear in perceived scale
                z = math.exp(lerp(math.log(a.zoom), math.log(b.zoom), t))
                return Cam(lerp(a.cx, b.cx, t), lerp(a.cy, b.cy, t), z, lerp(a.pitch, b.pitch, t), lerp(a.roll, b.roll, t))
        return ks[-1][1]


def _tilt_matrix(cam):
    """3×3 homography in output-pixel units, centred coords → centred coords."""
    p, r = math.radians(cam.pitch), math.radians(cam.roll)
    cr, sr, cp, sp = math.cos(r), math.sin(r), math.cos(p), math.sin(p)
    # plane point (x, y, 0) → roll about z → pitch about x → perspective divide at FOCAL
    R = np.array([[cr, -sr, 0], [sr * cp, cr * cp, 0], [-sr * sp, -cr * sp, 1]], dtype=np.float64)
    # x' = R00 x + R01 y ; y' = R10 x + R11 y ; z' = R20 x + R21 y (+ FOCAL)
    M = np.array([[FOCAL * R[0, 0], FOCAL * R[0, 1], 0],
                  [FOCAL * R[1, 0], FOCAL * R[1, 1], 0],
                  [R[2, 0], R[2, 1], FOCAL]], dtype=np.float64)
    return M / FOCAL


def tilt(cam):
    return _tilt_matrix(cam)


def overscan(cam):
    """Canvas size factor so the tilted plane still covers the whole frame."""
    if cam.flat():
        return 1.0
    Mi = np.linalg.inv(_tilt_matrix(cam))
    pts = np.array([[-W / 2, -H / 2, 1], [W / 2, -H / 2, 1], [W / 2, H / 2, 1], [-W / 2, H / 2, 1]], dtype=np.float64).T
    q = Mi @ pts
    q = q[:2] / q[2]
    need = max(2 * np.abs(q[0]).max() / W, 2 * np.abs(q[1]).max() / H)
    return float(clamp(need * 1.03, 1.0, 2.6))


def warp_matrix(cam, ov, ss_in, ss_out):
    """Canvas pixels (size W·ov·ss_in) → output pixels (size W·ss_out)."""
    T_in = np.array([[1 / ss_in, 0, -W * ov / 2], [0, 1 / ss_in, -H * ov / 2], [0, 0, 1]], dtype=np.float64)
    T_out = np.array([[ss_out, 0, W * ss_out / 2], [0, ss_out, H * ss_out / 2], [0, 0, 1]], dtype=np.float64)
    return T_out @ _tilt_matrix(cam) @ T_in


def project(cam, x, y):
    """World point → output pixel (1920×1080 space)."""
    px, py = (x - cam.cx) * cam.zoom, (y - cam.cy) * cam.zoom
    if cam.flat():
        return px + W / 2, py + H / 2
    v = _tilt_matrix(cam) @ np.array([px, py, 1.0])
    return v[0] / v[2] + W / 2, v[1] / v[2] + H / 2


def unproject(cam, sx, sy):
    """Output pixel → world point (inverse of `project`)."""
    v = np.array([sx - W / 2, sy - H / 2, 1.0])
    if not cam.flat():
        v = np.linalg.inv(_tilt_matrix(cam)) @ v
        v = v / v[2]
    return v[0] / cam.zoom + cam.cx, v[1] / cam.zoom + cam.cy


def with_kick(cam, amount):
    return replace(cam, zoom=cam.zoom * (1 + amount))


def warp(img, cam, ov, ss_in, ss_out, border):
    Mx = warp_matrix(cam, ov, ss_in, ss_out)
    return cv2.warpPerspective(img, Mx, (int(W * ss_out), int(H * ss_out)), flags=cv2.INTER_LINEAR,
                               borderMode=cv2.BORDER_CONSTANT, borderValue=border)


class Spline:
    """C1 camera path through keys (frame, cx, cy, zoom, pitch, roll, stop).

    Components interpolate with monotone cubic Hermite (Fritsch–Carlson), so the camera never
    overshoots a key; `stop=True` keys get zero velocity (the camera settles there).
    Zoom is interpolated in log space.
    """

    def __init__(self, keys):
        self.t = np.array([k[0] for k in keys], dtype=np.float64)
        vals = np.array([[k[1], k[2], math.log(k[3]), k[4], k[5]] for k in keys], dtype=np.float64)
        self.v = vals
        stops = [bool(k[6]) for k in keys]
        n = len(keys)
        d = np.diff(vals, axis=0) / np.diff(self.t)[:, None]
        m = np.zeros_like(vals)
        for i in range(n):
            if stops[i] or i == 0 or i == n - 1:
                continue
            for j in range(vals.shape[1]):
                a, b = d[i - 1, j], d[i, j]
                m[i, j] = 0.0 if a * b <= 0 else 2.0 / (1.0 / a + 1.0 / b)  # harmonic mean
        self.m = m

    def at(self, f):
        t = self.t
        if f <= t[0]:
            v = self.v[0]
        elif f >= t[-1]:
            v = self.v[-1]
        else:
            i = int(np.searchsorted(t, f) - 1)
            h = t[i + 1] - t[i]
            s = (f - t[i]) / h
            h00, h10, h01, h11 = 2 * s ** 3 - 3 * s ** 2 + 1, s ** 3 - 2 * s ** 2 + s, -2 * s ** 3 + 3 * s ** 2, s ** 3 - s ** 2
            v = h00 * self.v[i] + h10 * h * self.m[i] + h01 * self.v[i + 1] + h11 * h * self.m[i + 1]
        return Cam(float(v[0]), float(v[1]), float(math.exp(v[2])), float(v[3]), float(v[4]))
