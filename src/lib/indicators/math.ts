/**
 * Series math for indicators. Every function takes and returns arrays aligned to
 * the candles (index i = candle i); `null` marks warm-up or missing input.
 */
export type Series = Array<number | null>;

const nulls = (n: number): Series => new Array<number | null>(n).fill(null);

/** Simple moving average over `period` non-null values (window restarts after a gap). */
export function smaArr(src: readonly (number | null)[], period: number): Series {
  const out = nulls(src.length);
  if (period < 1) return out;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < src.length; i++) {
    const v = src[i];
    if (v === null) { sum = 0; count = 0; continue; }
    sum += v;
    count++;
    if (count > period) { sum -= src[i - period] as number; count = period; }
    if (count === period) out[i] = sum / period;
  }
  return out;
}

/** Exponential moving average seeded with the SMA of its first `period` values. */
export function emaArr(src: readonly (number | null)[], period: number): Series {
  return smoothed(src, period, 2 / (period + 1));
}

/** Wilder's moving average (RMA): EMA with α = 1 / period. */
export function rmaArr(src: readonly (number | null)[], period: number): Series {
  return smoothed(src, period, 1 / period);
}

/** Chinese-style weighted SMA(N, M): y = (M·x + (N − M)·y′) / N, seeded with the first value. */
export function smaW(src: readonly (number | null)[], n: number, m: number): Series {
  const out = nulls(src.length);
  let prev: number | null = null;
  for (let i = 0; i < src.length; i++) {
    const v = src[i];
    if (v === null) continue;
    prev = prev === null ? v : (m * v + (n - m) * prev) / n;
    out[i] = prev;
  }
  return out;
}

function smoothed(src: readonly (number | null)[], period: number, alpha: number): Series {
  const out = nulls(src.length);
  if (period < 1) return out;
  let prev: number | null = null;
  let seed = 0;
  let count = 0;
  for (let i = 0; i < src.length; i++) {
    const v = src[i];
    if (v === null) continue;
    if (prev === null) {
      seed += v;
      if (++count === period) { prev = seed / period; out[i] = prev; }
      continue;
    }
    prev = alpha * v + (1 - alpha) * prev;
    out[i] = prev;
  }
  return out;
}

/** Population standard deviation over `period` values. */
export function stdevArr(src: readonly (number | null)[], period: number): Series {
  const mean = smaArr(src, period);
  return mean.map((m, i) => {
    if (m === null) return null;
    let s = 0;
    for (let j = i - period + 1; j <= i; j++) s += ((src[j] as number) - m) ** 2;
    return Math.sqrt(s / period);
  });
}

/** Rolling max / min / sum over `period` values (null until the window is full). */
export function highestArr(src: readonly number[], period: number): Series {
  return rolling(src, period, (a, b) => (a > b ? a : b));
}
export function lowestArr(src: readonly number[], period: number): Series {
  return rolling(src, period, (a, b) => (a < b ? a : b));
}
function rolling(src: readonly number[], period: number, pick: (a: number, b: number) => number): Series {
  const out = nulls(src.length);
  for (let i = period - 1; i < src.length; i++) {
    let x = src[i];
    for (let j = i - period + 1; j < i; j++) x = pick(x, src[j]);
    out[i] = x;
  }
  return out;
}
export function sumArr(src: readonly (number | null)[], period: number): Series {
  const out = nulls(src.length);
  let sum = 0;
  let count = 0;
  for (let i = 0; i < src.length; i++) {
    const v = src[i];
    if (v === null) { sum = 0; count = 0; continue; }
    sum += v;
    count++;
    if (count > period) { sum -= src[i - period] as number; count = period; }
    if (count === period) out[i] = sum;
  }
  return out;
}

/** a − b, a / b, … element-wise (null if either side is null or the result isn't finite). */
export function zip(a: readonly (number | null)[], b: readonly (number | null)[], f: (x: number, y: number) => number): Series {
  return a.map((x, i) => {
    const y = b[i];
    if (x === null || y === null || y === undefined) return null;
    const r = f(x, y);
    return Number.isFinite(r) ? r : null;
  });
}
export const map = (a: readonly (number | null)[], f: (x: number, i: number) => number): Series =>
  a.map((x, i) => { if (x === null) return null; const r = f(x, i); return Number.isFinite(r) ? r : null; });

/** Safe division: null when the denominator is 0. */
export const div = (x: number, y: number): number => (y === 0 ? NaN : x / y);
