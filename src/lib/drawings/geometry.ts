/**
 * Pure geometry for chart drawings: time ↔ logical bar index (with extrapolation
 * beyond the data), magnet snapping, hit-testing, line extension and measurements.
 * Pixel conversion of logical / price values is done by the chart (lightweight-charts).
 */
import type { DrawPoint } from './types';

export interface Bar { t: number; o: number; h: number; l: number; c: number }

/** Candle open times (ms, ascending) plus the nominal bar interval. */
export interface TimeAxis { times: readonly number[]; spanMs: number }

/** Fractional logical index for a time; extrapolates by `spanMs` outside the data. */
export function timeToLogical(axis: TimeAxis, t: number): number | null {
  const { times, spanMs } = axis;
  const n = times.length;
  if (!n) return null;
  if (t <= times[0]) return (t - times[0]) / spanMs;
  if (t >= times[n - 1]) return n - 1 + (t - times[n - 1]) / spanMs;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid; else hi = mid;
  }
  return lo + (t - times[lo]) / (times[hi] - times[lo]);
}

/** Inverse of `timeToLogical`. */
export function logicalToTime(axis: TimeAxis, logical: number): number | null {
  const { times, spanMs } = axis;
  const n = times.length;
  if (!n) return null;
  if (logical <= 0) return times[0] + logical * spanMs;
  if (logical >= n - 1) return times[n - 1] + (logical - (n - 1)) * spanMs;
  const i = Math.floor(logical);
  return times[i] + (logical - i) * (times[i + 1] - times[i]);
}

/** Snap to the nearest O/H/L/C of the bar under `logical` (strong magnet). */
export function magnetSnap(bars: readonly Bar[], logical: number, price: number): DrawPoint | null {
  if (!bars.length) return null;
  const i = Math.min(bars.length - 1, Math.max(0, Math.round(logical)));
  const b = bars[i];
  const best = [b.o, b.h, b.l, b.c].reduce((m, p) => (Math.abs(p - price) < Math.abs(m - price) ? p : m), b.c);
  return { time: b.t, price: best };
}

/** Distance from point P to segment AB, in pixels. */
export function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const u = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + u * dx), py - (ay + u * dy));
}

/**
 * Extend segment AB to the edges of a `w × h` box: forward past B (ray),
 * or in both directions (extended line). Returns the clipped endpoints.
 */
export function extendToBox(ax: number, ay: number, bx: number, by: number, w: number, h: number, both: boolean): [number, number, number, number] {
  const dx = bx - ax;
  const dy = by - ay;
  if (!dx && !dy) return [ax, ay, bx, by];
  // Largest t ≥ 1 along the direction that stays within the box (and smallest t ≤ 0 backwards).
  const limits = (from: number, d: number, max: number): [number, number] => {
    if (d === 0) return [-Infinity, Infinity];
    const t1 = (0 - from) / d;
    const t2 = (max - from) / d;
    return [Math.min(t1, t2), Math.max(t1, t2)];
  };
  const [tx0, tx1] = limits(ax, dx, w);
  const [ty0, ty1] = limits(ay, dy, h);
  const tMax = Math.max(1, Math.min(tx1, ty1));
  const tMin = both ? Math.min(0, Math.max(tx0, ty0)) : 0;
  return [ax + dx * tMin, ay + dy * tMin, ax + dx * tMax, ay + dy * tMax];
}

export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;

/** Price at a fib level: 1 at the first point, 0 at the second (TradingView convention). */
export const fibPrice = (a: DrawPoint, b: DrawPoint, level: number): number => b.price + (a.price - b.price) * level;

export interface Measure { dPrice: number; pct: number; bars: number; ms: number }

export function measure(a: DrawPoint, b: DrawPoint, axis: TimeAxis): Measure {
  const la = timeToLogical(axis, a.time) ?? 0;
  const lb = timeToLogical(axis, b.time) ?? 0;
  return { dPrice: b.price - a.price, pct: a.price ? b.price / a.price - 1 : 0, bars: Math.round(lb - la), ms: b.time - a.time };
}

/** Compact duration: 90s → "1m 30s", 26h → "1d 2h". */
export function fmtDuration(ms: number): string {
  const s = Math.round(Math.abs(ms) / 1000);
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts = d ? [`${d}d`, h && `${h}h`] : h ? [`${h}h`, m && `${m}m`] : m ? [`${m}m`, sec && `${sec}s`] : [`${sec}s`];
  return `${ms < 0 ? '−' : ''}${parts.filter(Boolean).join(' ')}`;
}

/** Shift all points by a logical / price delta (moving a whole drawing). */
export function translate(points: readonly DrawPoint[], axis: TimeAxis, dLogical: number, dPrice: number): DrawPoint[] {
  return points.map((p) => {
    const l = timeToLogical(axis, p.time);
    const time = l === null ? p.time : (logicalToTime(axis, l + dLogical) ?? p.time);
    return { time, price: p.price + dPrice };
  });
}

/** Total volume of the bars whose open time falls between two times (inclusive, any order). */
export function sumVolume(bars: ReadonlyArray<{ t: number; v: number }>, t0: number, t1: number): number {
  const lo = Math.min(t0, t1);
  const hi = Math.max(t0, t1);
  let sum = 0;
  for (const b of bars) if (b.t >= lo && b.t <= hi) sum += b.v;
  return sum;
}
