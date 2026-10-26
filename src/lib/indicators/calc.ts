/**
 * Technical indicators over oldest-first candles. Pure functions: each returns
 * named output series aligned to the candles (null during warm-up).
 */
import type { Series } from './math';
import { div, emaArr, highestArr, lowestArr, map, rmaArr, smaArr, stdevArr, sumArr, zip } from './math';

export interface Bar {
  t: number; o: number; h: number; l: number; c: number; v: number; n?: number;
  /** Taker-buy volume, where the venue publishes it (Binance klines) or candles were built from trades. */
  tb?: number;
}
export type Outputs = Record<string, Series>;

/** Candle outputs: `key` holds the close, `key.o` / `key.h` / `key.l` the rest of the OHLC. */
export const ohlcKeys = (key: string) => ({ o: `${key}.o`, h: `${key}.h`, l: `${key}.l` });

/**
 * Bar volume delta (taker buys − taker sells). Exact when the bar carries its taker-buy
 * volume; otherwise estimated from the candle: volume × body ÷ range.
 */
export const barDelta = (b: Bar): number =>
  b.tb !== undefined ? 2 * b.tb - b.v : b.h > b.l ? (b.v * (b.c - b.o)) / (b.h - b.l) : 0;

/**
 * CVD as candles: each bar opens at the previous cumulative delta and closes at it plus
 * the bar's delta (wicks = open / close; the live bar's intrabar extremes are tracked by the engine).
 */
export function cvd(bars: readonly Bar[]): Outputs {
  const k = ohlcKeys('cvd');
  const o: Series = [], h: Series = [], l: Series = [], c: Series = [];
  let cum = 0;
  for (const b of bars) {
    const open = cum;
    cum += barDelta(b);
    o.push(open);
    c.push(cum);
    h.push(Math.max(open, cum));
    l.push(Math.min(open, cum));
  }
  return { cvd: c, [k.o]: o, [k.h]: h, [k.l]: l };
}

const closes = (b: readonly Bar[]) => b.map((x) => x.c);
const highs = (b: readonly Bar[]) => b.map((x) => x.h);
const lows = (b: readonly Bar[]) => b.map((x) => x.l);
const prev = <T>(a: readonly T[], i: number, k = 1): T | undefined => a[i - k];
/** Shift a series `k` bars to the right (REF(x, k)). */
const ref = (a: Series, k: number): Series => a.map((_, i) => (i >= k ? a[i - k] : null));
const periods = (ps: readonly number[]) => ps.map((p) => Math.max(1, Math.round(p)));

/* ── Overlays ── */

export function ma(bars: readonly Bar[], ps: readonly number[]): Outputs {
  const c = closes(bars);
  return Object.fromEntries(periods(ps).map((p, i) => [`ma${i}`, smaArr(c, p)]));
}

export function ema(bars: readonly Bar[], ps: readonly number[]): Outputs {
  const c = closes(bars);
  return Object.fromEntries(periods(ps).map((p, i) => [`ema${i}`, emaArr(c, p)]));
}

/** Bollinger Bands: SMA ± k·σ (population). */
export function boll(bars: readonly Bar[], [n = 20, k = 2]: readonly number[]): Outputs {
  const c = closes(bars);
  const [p] = periods([n]);
  const mid = smaArr(c, p);
  const sd = stdevArr(c, p);
  return { up: zip(mid, sd, (m, s) => m + k * s), mid, dn: zip(mid, sd, (m, s) => m - k * s) };
}

/** Parabolic SAR (Wilder): start / step / max acceleration. */
export function sar(bars: readonly Bar[], [start = 0.02, step = 0.02, max = 0.2]: readonly number[]): Outputs {
  const out: Series = new Array<number | null>(bars.length).fill(null);
  if (bars.length < 2) return { sar: out };
  let up = bars[1].c >= bars[0].c;
  let af = start;
  let ep = up ? bars[0].h : bars[0].l;
  let s = up ? bars[0].l : bars[0].h;
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i];
    s += af * (ep - s);
    const p1 = bars[i - 1];
    const p2 = bars[Math.max(0, i - 2)];
    if (up) {
      s = Math.min(s, p1.l, p2.l);
      if (b.l < s) { up = false; s = ep; ep = b.l; af = start; }
      else if (b.h > ep) { ep = b.h; af = Math.min(af + step, max); }
    } else {
      s = Math.max(s, p1.h, p2.h);
      if (b.h > s) { up = true; s = ep; ep = b.h; af = start; }
      else if (b.l < ep) { ep = b.l; af = Math.min(af + step, max); }
    }
    out[i] = s;
  }
  return { sar: out };
}

/** Bull and Bear Index: mean of four SMAs. */
export function bbi(bars: readonly Bar[], ps: readonly number[]): Outputs {
  const c = closes(bars);
  const mas = periods(ps).map((p) => smaArr(c, p));
  return { bbi: c.map((_, i) => (mas.every((m) => m[i] !== null) ? mas.reduce((s, m) => s + (m[i] as number), 0) / mas.length : null)) };
}

/** Session VWAP of the typical price, reset at 00:00 UTC. */
export function vwap(bars: readonly Bar[]): Outputs {
  const out: Series = [];
  let day = -1, pv = 0, vol = 0;
  for (const b of bars) {
    const d = Math.floor(b.t / 86_400_000);
    if (d !== day) { day = d; pv = 0; vol = 0; }
    pv += ((b.h + b.l + b.c) / 3) * b.v;
    vol += b.v;
    out.push(vol > 0 ? pv / vol : null);
  }
  return { vwap: out };
}

/* ── Oscillators & sub-pane indicators ── */

/** MACD: DIF = EMA(fast) − EMA(slow), DEA = EMA(DIF, signal), histogram = DIF − DEA. */
export function macd(bars: readonly Bar[], [fast = 12, slow = 26, signal = 9]: readonly number[]): Outputs {
  const c = closes(bars);
  const [f, s, g] = periods([fast, slow, signal]);
  const dif = zip(emaArr(c, f), emaArr(c, s), (a, b) => a - b);
  const dea = emaArr(dif, g);
  return { hist: zip(dif, dea, (a, b) => a - b), dif, dea };
}

/** KDJ: RSV over n, K and D smoothed 1/m1, 1/m2 (seeded at 50), J = 3K − 2D. */
export function kdj(bars: readonly Bar[], [n = 9, m1 = 3, m2 = 3]: readonly number[]): Outputs {
  const [p] = periods([n]);
  const hh = highestArr(highs(bars), p);
  const ll = lowestArr(lows(bars), p);
  const k: Series = [], d: Series = [], j: Series = [];
  let pk = 50, pd = 50;
  for (let i = 0; i < bars.length; i++) {
    const h = hh[i], l = ll[i];
    if (h === null || l === null) { k.push(null); d.push(null); j.push(null); continue; }
    const rsv = h === l ? 50 : ((bars[i].c - l) / (h - l)) * 100;
    pk = ((m1 - 1) * pk + rsv) / m1;
    pd = ((m2 - 1) * pd + pk) / m2;
    k.push(pk); d.push(pd); j.push(3 * pk - 2 * pd);
  }
  return { k, d, j };
}

/** Wilder's RSI for each period. */
export function rsi(bars: readonly Bar[], ps: readonly number[]): Outputs {
  const up: Series = bars.map((b, i) => (i === 0 ? null : Math.max(b.c - bars[i - 1].c, 0)));
  const dn: Series = bars.map((b, i) => (i === 0 ? null : Math.max(bars[i - 1].c - b.c, 0)));
  return Object.fromEntries(periods(ps).map((p, i) => {
    const g = rmaArr(up, p), l = rmaArr(dn, p);
    return [`rsi${i}`, zip(g, l, (a, b) => (a + b === 0 ? 50 : (100 * a) / (a + b)))];
  }));
}

/** BIAS: distance of the close from its SMA, %. */
export function bias(bars: readonly Bar[], ps: readonly number[]): Outputs {
  const c = closes(bars);
  return Object.fromEntries(periods(ps).map((p, i) => [`bias${i}`, zip(c, smaArr(c, p), (x, m) => div(x - m, m) * 100)]));
}

/** BRAR: BR (buying vs selling pressure vs the prior close) and AR (vs the open). */
export function brar(bars: readonly Bar[], [n = 26]: readonly number[]): Outputs {
  const [p] = periods([n]);
  const hcy: Series = bars.map((b, i) => (i === 0 ? null : Math.max(0, b.h - bars[i - 1].c)));
  const cyl: Series = bars.map((b, i) => (i === 0 ? null : Math.max(0, bars[i - 1].c - b.l)));
  const ho = bars.map((b) => b.h - b.o), ol = bars.map((b) => b.o - b.l);
  return {
    br: zip(sumArr(hcy, p), sumArr(cyl, p), (a, b) => div(a, b) * 100),
    ar: zip(sumArr(ho, p), sumArr(ol, p), (a, b) => div(a, b) * 100),
  };
}

/** True range series (first bar: high − low). */
export function trueRange(bars: readonly Bar[]): number[] {
  return bars.map((b, i) => {
    const pc = prev(bars, i)?.c;
    return pc === undefined ? b.h - b.l : Math.max(b.h - b.l, Math.abs(b.h - pc), Math.abs(b.l - pc));
  });
}

/** DMI: +DI / −DI (Wilder), ADX = SMA(DX, m), ADXR = (ADX + ADX m bars ago) / 2. */
export function dmi(bars: readonly Bar[], [n = 14, m = 6]: readonly number[]): Outputs {
  const [p, q] = periods([n, m]);
  const pdm: Series = bars.map((b, i) => { const a = prev(bars, i); if (!a) return null; const u = b.h - a.h, d = a.l - b.l; return u > d && u > 0 ? u : 0; });
  const mdm: Series = bars.map((b, i) => { const a = prev(bars, i); if (!a) return null; const u = b.h - a.h, d = a.l - b.l; return d > u && d > 0 ? d : 0; });
  const tr = rmaArr(trueRange(bars).map((x, i) => (i === 0 ? null : x)), p);
  const pdi = zip(rmaArr(pdm, p), tr, (a, t) => div(a, t) * 100);
  const mdi = zip(rmaArr(mdm, p), tr, (a, t) => div(a, t) * 100);
  const dx = zip(pdi, mdi, (a, b) => (a + b === 0 ? 0 : (Math.abs(a - b) / (a + b)) * 100));
  const adx = smaArr(dx, q);
  return { pdi, mdi, adx, adxr: zip(adx, ref(adx, q), (a, b) => (a + b) / 2) };
}

/** CR: buying vs selling energy around the prior bar's midpoint, with shifted MAs. */
export function cr(bars: readonly Bar[], [n = 26, ...mas]: readonly number[]): Outputs {
  const [p] = periods([n]);
  const up: Series = bars.map((b, i) => { const a = prev(bars, i); return a ? Math.max(0, b.h - (a.h + a.l) / 2) : null; });
  const dn: Series = bars.map((b, i) => { const a = prev(bars, i); return a ? Math.max(0, (a.h + a.l) / 2 - b.l) : null; });
  const crv = zip(sumArr(up, p), sumArr(dn, p), (a, b) => div(a, b) * 100);
  const out: Outputs = { cr: crv };
  periods(mas.length ? mas : [10, 20, 40, 60]).forEach((m, i) => { out[`ma${i}`] = ref(smaArr(crv, m), Math.floor(m / 2.5 + 1)); });
  return out;
}

/** PSY: share of up closes over n bars, %, and its SMA. */
export function psy(bars: readonly Bar[], [n = 12, m = 6]: readonly number[]): Outputs {
  const [p, q] = periods([n, m]);
  const ups: Series = bars.map((b, i) => (i === 0 ? null : b.c > bars[i - 1].c ? 1 : 0));
  const psyv = map(sumArr(ups, p), (s) => (s / p) * 100);
  return { psy: psyv, maPsy: smaArr(psyv, q) };
}

/** DMA: difference of two SMAs and its SMA. */
export function dma(bars: readonly Bar[], [n1 = 10, n2 = 50, m = 10]: readonly number[]): Outputs {
  const c = closes(bars);
  const [a, b, q] = periods([n1, n2, m]);
  const dif = zip(smaArr(c, a), smaArr(c, b), (x, y) => x - y);
  return { dif, ama: smaArr(dif, q) };
}

/** TRIX: % change of a triple EMA, and its SMA. */
export function trix(bars: readonly Bar[], [n = 12, m = 9]: readonly number[]): Outputs {
  const [p, q] = periods([n, m]);
  const tr = emaArr(emaArr(emaArr(closes(bars), p), p), p);
  const t = tr.map((x, i) => { const y = tr[i - 1]; return x === null || y === null || y === undefined || y === 0 ? null : ((x - y) / y) * 100; });
  return { trix: t, maTrix: smaArr(t, q) };
}

/** On-balance volume and its SMA. */
export function obv(bars: readonly Bar[], [m = 30]: readonly number[]): Outputs {
  let acc = 0;
  const o: Series = bars.map((b, i) => {
    const pc = prev(bars, i)?.c;
    if (pc !== undefined) acc += b.c > pc ? b.v : b.c < pc ? -b.v : 0;
    return acc;
  });
  return { obv: o, maObv: smaArr(o, periods([m])[0]) };
}

/** VR: volume on up bars vs down bars (flat bars split), %, and its SMA. */
export function vr(bars: readonly Bar[], [n = 26, m = 6]: readonly number[]): Outputs {
  const [p, q] = periods([n, m]);
  const part = (f: (d: number) => boolean): Series => bars.map((b, i) => { const pc = prev(bars, i)?.c; return pc === undefined ? null : f(b.c - pc) ? b.v : 0; });
  const av = sumArr(part((d) => d > 0), p), bv = sumArr(part((d) => d < 0), p), cv = sumArr(part((d) => d === 0), p);
  const v = av.map((a, i) => { const b = bv[i], c = cv[i]; if (a === null || b === null || c === null) return null; const den = b + c / 2; return den === 0 ? null : ((a + c / 2) / den) * 100; });
  return { vr: v, maVr: smaArr(v, q) };
}

/** Williams %R (−100 … 0) for each period. */
export function wr(bars: readonly Bar[], ps: readonly number[]): Outputs {
  const h = highs(bars), l = lows(bars);
  return Object.fromEntries(periods(ps).map((p, i) => {
    const hh = highestArr(h, p), ll = lowestArr(l, p);
    return [`wr${i}`, bars.map((b, k) => { const x = hh[k], y = ll[k]; return x === null || y === null ? null : x === y ? -50 : ((x - b.c) / (x - y)) * -100; })];
  }));
}

/** Momentum: close − close n bars ago, and its SMA. */
export function mtm(bars: readonly Bar[], [n = 12, m = 6]: readonly number[]): Outputs {
  const [p, q] = periods([n, m]);
  const v: Series = bars.map((b, i) => (i >= p ? b.c - bars[i - p].c : null));
  return { mtm: v, maMtm: smaArr(v, q) };
}

/** Ease of movement (volume-normalised midpoint change), and its SMA. */
export function emv(bars: readonly Bar[], [n = 14, m = 9]: readonly number[]): Outputs {
  const [p, q] = periods([n, m]);
  const vol = bars.map((b) => b.v);
  const volRatio = zip(smaArr(vol, p), vol, (a, v) => div(a, v));
  const hl = bars.map((b) => b.h - b.l);
  const hlMa = smaArr(hl, p);
  const raw: Series = bars.map((b, i) => {
    const a = prev(bars, i);
    const r = volRatio[i], hm = hlMa[i];
    if (!a || r === null || hm === null || hm === 0 || b.h + b.l === 0) return null;
    const mid = (100 * (b.h + b.l - (a.h + a.l))) / (b.h + b.l);
    return (mid * r * (b.h - b.l)) / hm;
  });
  const e = smaArr(raw, p);
  return { emv: e, maEmv: smaArr(e, q) };
}

/** Rate of change, %, and its SMA. */
export function roc(bars: readonly Bar[], [n = 12, m = 6]: readonly number[]): Outputs {
  const [p, q] = periods([n, m]);
  const v: Series = bars.map((b, i) => (i >= p && bars[i - p].c !== 0 ? ((b.c - bars[i - p].c) / bars[i - p].c) * 100 : null));
  return { roc: v, maRoc: smaArr(v, q) };
}

/** Price-volume trend (cumulative). */
export function pvt(bars: readonly Bar[]): Outputs {
  let acc = 0;
  return { pvt: bars.map((b, i) => { const pc = prev(bars, i)?.c; if (pc) acc += ((b.c - pc) / pc) * b.v; return acc; }) };
}

/** Awesome Oscillator: SMA(median, fast) − SMA(median, slow). */
export function ao(bars: readonly Bar[], [fast = 5, slow = 34]: readonly number[]): Outputs {
  const mid = bars.map((b) => (b.h + b.l) / 2);
  const [f, s] = periods([fast, slow]);
  return { ao: zip(smaArr(mid, f), smaArr(mid, s), (a, b) => a - b) };
}

/** Normalised ATR: Wilder ATR ÷ close, %. */
export function natr(bars: readonly Bar[], [n = 14]: readonly number[]): Outputs {
  const atr = rmaArr(trueRange(bars), periods([n])[0]);
  return { natr: zip(atr, closes(bars), (a, c) => div(a, c) * 100) };
}

/** Volume with SMAs. */
export function vol(bars: readonly Bar[], ps: readonly number[]): Outputs {
  const v = bars.map((b) => b.v);
  return { vol: v, ...Object.fromEntries(periods(ps).map((p, i) => [`ma${i}`, smaArr(v, p)])) };
}

/** Trades per candle (venues that publish counts), with an SMA. */
export function trades(bars: readonly Bar[], [m = 20]: readonly number[]): Outputs {
  const n: Series = bars.map((b) => (b.n === undefined ? null : b.n));
  return { trades: n, maTrades: smaArr(n, periods([m])[0]) };
}

/* ── Levels: clustered swing highs / lows ── */

export interface Level { price: number; touches: number; side: 'support' | 'resistance' }

/** Fractal pivots (`wing` bars each side), clustered within `tol`; the `keep` most-touched above and below the last close. */
export function levels(bars: readonly Bar[], [wing = 2, tolPct = 0.3, keep = 3]: readonly number[]): Level[] {
  const w = Math.max(1, Math.round(wing));
  const tol = tolPct / 100;
  const pivots: number[] = [];
  for (let i = w; i < bars.length - w; i++) {
    let hi = true, lo = true;
    for (let k = 1; k <= w; k++) {
      if (bars[i - k].h >= bars[i].h || bars[i + k].h > bars[i].h) hi = false;
      if (bars[i - k].l <= bars[i].l || bars[i + k].l < bars[i].l) lo = false;
    }
    if (hi) pivots.push(bars[i].h);
    if (lo) pivots.push(bars[i].l);
  }
  const clusters: Array<{ sum: number; n: number }> = [];
  for (const p of pivots.sort((a, b) => a - b)) {
    const last = clusters.at(-1);
    if (last && Math.abs(p - last.sum / last.n) / (last.sum / last.n) <= tol) { last.sum += p; last.n++; } else clusters.push({ sum: p, n: 1 });
  }
  const last = bars.at(-1)?.c;
  if (last === undefined) return [];
  const all = clusters.map((c) => ({ price: c.sum / c.n, touches: c.n }));
  const pickSide = (above: boolean): Level[] => all
    .filter((x) => (above ? x.price > last : x.price <= last))
    .sort((a, b) => b.touches - a.touches || Math.abs(a.price - last) - Math.abs(b.price - last))
    .slice(0, Math.max(0, Math.round(keep)))
    .map((x) => ({ ...x, side: above ? 'resistance' : 'support' }));
  return [...pickSide(true), ...pickSide(false)];
}
