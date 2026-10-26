/**
 * Formation detectors. Each takes a coin's candles — the last bar is the one
 * still forming (it follows the live price) — and reports at most one setup per
 * direction. Pure functions: the server engine runs them every pass, the tests
 * run them on synthetic bars.
 *
 * Stage here is only FORMING / ACTIVE; LATE and INVALIDATED come from price
 * moving relative to the frozen levels (`lifecycle.ts`).
 */
import { barDelta, levels, trueRange } from '@/lib/indicators/calc';
import type { Bar, Level } from '@/lib/indicators/calc';
import { emaArr, rmaArr } from '@/lib/indicators/math';
import type { Series } from '@/lib/indicators/math';
import type { Timeframe } from '@/lib/market/exchanges';
import type { Candidate, Direction, StrategyId } from './types';

export interface DetectInput {
  k1h: readonly Bar[] | null;
  k5m: readonly Bar[] | null;
  k1m?: readonly Bar[] | null;
  price: number;
}

/** Timeframe of the single-timeframe strategies (the price-action ones pass theirs). */
const FIXED_TF: Partial<Record<StrategyId, Timeframe>> = { breakout: '1h', defense: '1h', obRetest: '1h', sweepFvg: '1h', spikeFade: '5m' };

const ATR_N = 14;
const VOL_N = 20;
const MIN_1H = 60;
const MIN_5M = 40;

/* ── Helpers ── */

const atrSeries = (bars: readonly Bar[]): Series => rmaArr(trueRange(bars), ATR_N);

/** Mean volume of the `n` bars before `end`. */
function avgVol(bars: readonly Bar[], end: number, n = VOL_N): number {
  let s = 0, k = 0;
  for (let i = Math.max(0, end - n); i < end; i++) { s += bars[i].v; k++; }
  return k ? s / k : 0;
}

/** Bar delta: taker buys − sells (exact on venues with a taker split, else estimated from the candle). */
export { barDelta };

/** Bar `i`'s delta exceeds 1σ of the previous 50 bars in the trade's direction. */
export function orderFlowAt(bars: readonly Bar[], i: number, dir: Direction): boolean {
  if (i < 10 || i >= bars.length) return false;
  const ds: number[] = [];
  for (let k = Math.max(0, i - 50); k < i; k++) ds.push(barDelta(bars[k]));
  const mean = ds.reduce((a, b) => a + b, 0) / ds.length;
  const sd = Math.sqrt(ds.reduce((a, b) => a + (b - mean) ** 2, 0) / ds.length);
  return sd > 0 && (dir === 'LONG' ? 1 : -1) * barDelta(bars[i]) > sd;
}

/** Daily trend from 1h bars: 24-bar EMA slope over 6h, with price on the same side. 1 up, −1 down, 0 unclear. */
export function dailyTrend(k1h: readonly Bar[] | null, price: number): 1 | -1 | 0 {
  if (!k1h || k1h.length < 32) return 0;
  const ema = emaArr(k1h.map((b) => b.c), 24);
  const a = ema[ema.length - 1], b = ema[ema.length - 7];
  if (a === null || b === null) return 0;
  if (a > b && price > a) return 1;
  if (a < b && price < a) return -1;
  return 0;
}

const sign = (dir: Direction) => (dir === 'LONG' ? 1 : -1);

/** TP1 = 1.5R; TP2 = `cap` (an opposite level / swing) when it lies between 2R and 5R, else 3R. */
export function targets(dir: Direction, entry: number, sl: number, cap?: number): { tp1: number; tp2: number } {
  const r = Math.abs(entry - sl);
  const s = sign(dir);
  const capR = cap === undefined ? NaN : (s * (cap - entry)) / r;
  return { tp1: entry + s * 1.5 * r, tp2: capR >= 2 && capR <= 5 ? (cap as number) : entry + s * 3 * r };
}

/** Score 0–100: structure strength and volume confirmation (0–1 each) plus the two confirmations. */
export function scoreOf(structure: number, volume: number, orderFlow: boolean, daily: boolean): number {
  const c = (x: number) => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));
  return Math.round(15 + 35 * c(structure) + 20 * c(volume) + (orderFlow ? 15 : 0) + (daily ? 15 : 0));
}

function candidate(
  strategy: StrategyId, dir: Direction, stage: Candidate['stage'], anchorT: number, entry: number, sl: number,
  extra: {
    cap?: number; structure: number; volume: number; flowAt: number; flowBars: readonly Bar[]; trend: 1 | -1 | 0; note: string; tp?: { tp1: number; tp2: number }; maxRisk?: number;
    /** Timeframe of a multi-timeframe strategy. */
    tf?: Timeframe;
    /** Score points taken off (weak-signal penalty). */
    penalty?: number;
  },
): Candidate | null {
  const s = sign(dir);
  if (!(entry > 0) || !(sl > 0) || s * (entry - sl) <= 0) return null;
  // A stop too far from entry (a wild sweep / block) isn't a tradeable setup.
  if (extra.maxRisk !== undefined && Math.abs(entry - sl) > extra.maxRisk) return null;
  const { tp1, tp2 } = extra.tp ?? targets(dir, entry, sl, extra.cap);
  if (!(tp1 > 0) || !(tp2 > 0) || s * (tp1 - entry) <= 0 || s * (tp2 - tp1) < 0) return null;
  const orderFlow = stage === 'ACTIVE' && orderFlowAt(extra.flowBars, extra.flowAt, dir);
  const dailyAligned = extra.trend === s;
  const score = Math.max(0, scoreOf(extra.structure, extra.volume, orderFlow, dailyAligned) - (extra.penalty ?? 0));
  const tf = extra.tf ?? FIXED_TF[strategy] ?? '1h';
  return { strategy, tf, dir, anchorT, stage, entry, sl, tp1, tp2, score, orderFlow, dailyAligned, note: extra.note };
}

/** Keep the best candidate per direction: ACTIVE before FORMING, then the higher score. */
function bestPerDir(cs: Array<Candidate | null>): Candidate[] {
  const out = new Map<Direction, Candidate>();
  for (const c of cs) {
    if (!c) continue;
    const cur = out.get(c.dir);
    if (!cur || (c.stage === 'ACTIVE' && cur.stage === 'FORMING') || (c.stage === cur.stage && c.score > cur.score)) out.set(c.dir, c);
  }
  return [...out.values()];
}

/** Levels with at least 3 touches from the last 150 closed bars (any side of price). */
function strongLevels(closed: readonly Bar[]): Level[] {
  return levels(closed.slice(-150), [2, 0.3, 8]).filter((l) => l.touches >= 3);
}

/** Nearest level beyond `from` in `dir` (the opposite level a trade would run into). */
function nextLevel(lv: readonly Level[], from: number, dir: Direction): number | undefined {
  const s = sign(dir);
  const ahead = lv.filter((l) => s * (l.price - from) > 0).sort((a, b) => s * (a.price - b.price));
  return ahead[0]?.price;
}

/* ── Level Breakout (1h) ── */

/** A breakout close must clear the level by this many ATR (a poke through isn't a break). */
const BREAK_CLEAR = 0.15;
/** Of the `FRESH_N` closes before the breakout, at least `FRESH_MIN` were on the origin side. */
const FRESH_N = 8, FRESH_MIN = 6;

/** Strong levels with near-duplicates (within 0.5 ATR) merged into the most-touched one. */
function distinctLevels(lv: readonly Level[], atr: number): Level[] {
  const out: Level[] = [];
  for (const l of [...lv].sort((a, b) => b.touches - a.touches)) {
    if (!out.some((k) => Math.abs(k.price - l.price) < 0.5 * atr)) out.push(l);
  }
  return out;
}

/** A decisive breakout candle: body ≥ 50% of the range, closing in the outer 40% toward `dir`. */
function decisive(b: Bar, dir: Direction): boolean {
  const range = b.h - b.l;
  if (!(range > 0)) return false;
  const s = sign(dir);
  const body = s * (b.c - b.o);
  const loc = dir === 'LONG' ? (b.c - b.l) / range : (b.h - b.c) / range;
  return body >= 0.5 * range && loc >= 0.6;
}

/** Index of the last closed bar whose range touched the level zone (±0.25 ATR), or -1. */
function lastTouch(closed: readonly Bar[], L: number, atr: number, from = closed.length - 1): number {
  for (let i = from; i >= Math.max(0, closed.length - 150); i--) {
    if (closed[i].h >= L - 0.25 * atr && closed[i].l <= L + 0.25 * atr) return i;
  }
  return -1;
}

export function detectBreakout(bars: readonly Bar[] | null, price: number): Candidate[] {
  if (!bars || bars.length < MIN_1H) return [];
  const n = bars.length;
  const closed = bars.slice(0, -1);
  const atrS = atrSeries(bars);
  const atr = atrS[n - 2];
  if (!atr) return [];
  const all = strongLevels(closed);
  const lv = distinctLevels(all, atr);
  const trend = dailyTrend(bars, price);
  const out: Array<Candidate | null> = [];
  // One breakout bar can clear several levels: keep the furthest one per bar and direction.
  const active = new Map<string, { L: number; c: Candidate | null }>();
  for (const l of lv) {
    const L = l.price;
    const structure = (l.touches - 2) / 4;
    // The most recent close through the level within the last 12 closed bars.
    let found: { b: number; dir: Direction } | null = null;
    for (let b = closed.length - 1; b >= Math.max(FRESH_N, closed.length - 12); b--) {
      const prev = closed[b - 1].c, cur = closed[b].c;
      const dir: Direction | null = prev <= L && cur > L ? 'LONG' : prev >= L && cur < L ? 'SHORT' : null;
      if (!dir) continue;
      found = { b, dir };
      break;
    }
    if (found) {
      const { b, dir } = found;
      const s = sign(dir);
      const bar = closed[b];
      const vr = bar.v / (avgVol(closed, b) || Infinity);
      // A real break: clears the level by 0.15 ATR on a decisive candle and volume, from a level
      // price had respected (not one it was chopping around), and it hasn't come back since.
      const clears = s * (bar.c - L) >= BREAK_CLEAR * atr;
      let origin = 0;
      for (let k = b - FRESH_N; k < b; k++) if (s * (closed[k].c - L) <= 0) origin++;
      const held = closed.slice(b + 1).every((x) => s * (x.c - L) > 0) && s * (price - L) > 0;
      if (clears && decisive(bar, dir) && origin >= FRESH_MIN && vr >= 1.5 && held) {
        const key = `${b}:${dir}`;
        const prev = active.get(key);
        if (!prev || s * (L - prev.L) > 0) {
          active.set(key, {
            L,
            c: candidate('breakout', dir, 'ACTIVE', bar.t, L, L - s * atr, {
              cap: nextLevel(all, L, dir), structure, volume: (vr - 1) / 2, flowAt: b, flowBars: closed, trend, maxRisk: 4 * atr, note: `${l.touches}-touch ${dir === 'LONG' ? 'resistance' : 'support'} broken`,
            }),
          });
        }
        continue;
      }
    }
    // Pressing the level from the side price has held: within 0.5 ATR, the last 3 closes still on that side.
    const last3 = closed.slice(-3);
    const touch = lastTouch(closed, L, atr);
    const anchor = closed[touch >= 0 ? touch : closed.length - 1].t;
    if (L > price && L - price <= 0.5 * atr && last3.every((x) => x.c < L)) {
      out.push(candidate('breakout', 'LONG', 'FORMING', anchor, L, L - atr, { cap: nextLevel(all, L, 'LONG'), structure, volume: 0.25, maxRisk: 4 * atr, flowAt: 0, flowBars: closed, trend, note: `Pressing ${l.touches}-touch resistance` }));
    } else if (L < price && price - L <= 0.5 * atr && last3.every((x) => x.c > L)) {
      out.push(candidate('breakout', 'SHORT', 'FORMING', anchor, L, L + atr, { cap: nextLevel(all, L, 'SHORT'), structure, volume: 0.25, maxRisk: 4 * atr, flowAt: 0, flowBars: closed, trend, note: `Pressing ${l.touches}-touch support` }));
    }
  }
  for (const { c } of active.values()) out.push(c);
  return bestPerDir(out);
}

/* ── Level Defense (1h) ── */

export function detectDefense(bars: readonly Bar[] | null, price: number): Candidate[] {
  if (!bars || bars.length < MIN_1H) return [];
  const n = bars.length;
  const closed = bars.slice(0, -1);
  const atrS = atrSeries(bars);
  const atr = atrS[n - 2];
  if (!atr) return [];
  const lv = strongLevels(closed).filter((l) => Math.abs(l.price - price) <= 3 * atr);
  const trend = dailyTrend(bars, price);
  const out: Array<Candidate | null> = [];
  for (const l of lv) {
    const L = l.price;
    const structure = (l.touches - 2) / 4;
    for (const dir of ['LONG', 'SHORT'] as const) {
      const s = sign(dir);
      // Support below for longs, resistance above for shorts.
      if (s * (price - L) <= 0) continue;
      let hit = -1;
      for (let b = closed.length - 1; b >= Math.max(0, closed.length - 3); b--) {
        const x = closed[b];
        const range = x.h - x.l;
        if (range <= 0) continue;
        const wick = dir === 'LONG' ? Math.min(x.o, x.c) - x.l : x.h - Math.max(x.o, x.c);
        const pierced = dir === 'LONG' ? x.l <= L * 1.001 : x.h >= L * 0.999;
        if (pierced && s * (x.c - L) > 0 && wick >= 0.5 * range) { hit = b; break; }
      }
      const cap = nextLevel(lv, price, dir);
      if (hit >= 0) {
        const x = closed[hit];
        const extreme = dir === 'LONG' ? x.l : x.h;
        const vr = x.v / (avgVol(closed, hit) || Infinity);
        out.push(candidate('defense', dir, 'ACTIVE', x.t, L, extreme - s * 0.2 * atr, {
          cap, structure, volume: (vr - 0.8) / 1.5, maxRisk: 4 * atr, flowAt: hit, flowBars: closed, trend, note: `${l.touches}-touch ${dir === 'LONG' ? 'support' : 'resistance'} defended`,
        }));
      } else if (Math.abs(price - L) / L <= 0.003) {
        out.push(candidate('defense', dir, 'FORMING', closed[closed.length - 1].t, L, L - s * 0.5 * atr, {
          cap, structure, volume: 0.25, maxRisk: 4 * atr, flowAt: 0, flowBars: closed, trend, note: `Testing ${l.touches}-touch ${dir === 'LONG' ? 'support' : 'resistance'}`,
        }));
      }
    }
  }
  return bestPerDir(out);
}

/* ── Order Block Retest (1h) ── */

export function detectOrderBlock(bars: readonly Bar[] | null, price: number): Candidate[] {
  if (!bars || bars.length < MIN_1H) return [];
  const n = bars.length;
  const closed = bars.slice(0, -1);
  const live = bars[n - 1];
  const atrS = atrSeries(bars);
  const atr = atrS[n - 2];
  if (!atr) return [];
  const trend = dailyTrend(bars, price);
  const out: Array<Candidate | null> = [];
  for (const dir of ['LONG', 'SHORT'] as const) {
    const s = sign(dir);
    for (let i = closed.length - 4; i >= Math.max(11, closed.length - 48); i--) {
      const ob = closed[i];
      // The last opposite candle before the move.
      if (s * (ob.c - ob.o) >= 0) continue;
      const a = atrS[i];
      if (!a) continue;
      const edge = dir === 'LONG' ? ob.h : ob.l;
      let e = -1, disp = 0;
      for (let j = i + 1; j <= i + 3; j++) {
        const d = s * (closed[j].c - edge);
        if (d > disp) { disp = d; e = j; }
      }
      if (disp < 2 * a || e < 0) continue;
      // The displacement breaks the swing of the 10 bars before the OB.
      const prior = closed.slice(i - 10, i);
      const swing = dir === 'LONG' ? Math.max(...prior.map((x) => x.h)) : Math.min(...prior.map((x) => x.l));
      if (s * (closed[e].c - swing) <= 0) continue;
      const far = dir === 'LONG' ? ob.l : ob.h;
      const after = closed.slice(e + 1);
      // Broken once a close crosses the far edge; stale when price ran too far to come back.
      if (after.some((x) => s * (x.c - far) < 0) || s * (price - far) <= 0) break;
      if (s * (price - edge) > 6 * atr) break;
      const retested = [...after, live].some((x) => (dir === 'LONG' ? x.l <= edge : x.h >= edge));
      const ext = dir === 'LONG' ? Math.max(...closed.slice(i + 1, e + 1).map((x) => x.h)) : Math.min(...closed.slice(i + 1, e + 1).map((x) => x.l));
      const moveVol = closed.slice(i + 1, e + 1).reduce((m, x) => m + x.v, 0) / (e - i);
      out.push(candidate('obRetest', dir, retested ? 'ACTIVE' : 'FORMING', ob.t, edge, far - s * 0.2 * atr, {
        cap: ext, maxRisk: 4 * atr, structure: disp / (4 * a), volume: moveVol / (avgVol(closed, i) || Infinity) - 1, flowAt: closed.length - 1, flowBars: closed, trend,
        note: `${dir === 'LONG' ? 'Bullish' : 'Bearish'} order block, ${(disp / a).toFixed(1)} ATR displacement`,
      }));
      break; // the most recent valid OB per direction
    }
  }
  return bestPerDir(out);
}

/* ── Sweep + CHoCH + FVG Retest (1h) ── */

interface Pivot { i: number; price: number }
function pivots(bars: readonly Bar[], wing: number): { highs: Pivot[]; lows: Pivot[] } {
  const highs: Pivot[] = [], lows: Pivot[] = [];
  for (let i = wing; i < bars.length - wing; i++) {
    let hi = true, lo = true;
    for (let k = 1; k <= wing; k++) {
      if (bars[i - k].h >= bars[i].h || bars[i + k].h > bars[i].h) hi = false;
      if (bars[i - k].l <= bars[i].l || bars[i + k].l < bars[i].l) lo = false;
    }
    if (hi) highs.push({ i, price: bars[i].h });
    if (lo) lows.push({ i, price: bars[i].l });
  }
  return { highs, lows };
}

export function detectSweepFvg(bars: readonly Bar[] | null, price: number): Candidate[] {
  if (!bars || bars.length < MIN_1H) return [];
  const n = bars.length;
  const closed = bars.slice(0, -1);
  const live = bars[n - 1];
  const atrS = atrSeries(bars);
  const atr = atrS[n - 2];
  if (!atr) return [];
  const trend = dailyTrend(bars, price);
  const { highs, lows } = pivots(closed, 3);
  const last = closed.length - 1;
  const out: Array<Candidate | null> = [];
  for (const dir of ['LONG', 'SHORT'] as const) {
    const s = sign(dir);
    const swept = dir === 'LONG' ? lows : highs;
    const opposite = dir === 'LONG' ? highs : lows;
    for (let sw = last - 2; sw >= Math.max(4, last - 36); sw--) {
      const bar = closed[sw];
      // A wick through an untouched swing, closing back inside.
      const p = [...swept].reverse().find((q) =>
        q.i < sw - 1 && q.i >= sw - 60 &&
        (dir === 'LONG' ? bar.l < q.price && bar.c > q.price : bar.h > q.price && bar.c < q.price) &&
        closed.slice(q.i + 1, sw).every((x) => (dir === 'LONG' ? x.l >= q.price : x.h <= q.price)));
      if (!p) continue;
      // CHoCH: a close through the last opposite swing before the sweep.
      const between = opposite.filter((q) => q.i > p.i && q.i < sw);
      const choLevel = between.length ? between[between.length - 1].price : (dir === 'LONG' ? Math.max(...closed.slice(sw - 5, sw).map((x) => x.h)) : Math.min(...closed.slice(sw - 5, sw).map((x) => x.l)));
      let ch = -1;
      for (let c = sw + 1; c <= last; c++) if (s * (closed[c].c - choLevel) > 0) { ch = c; break; }
      if (ch < 0) continue;
      // The fair-value gap left by the move (the largest 3-bar imbalance), up to two bars after the CHoCH.
      let gap: { k: number; lo: number; hi: number } | null = null;
      for (let k = sw + 2; k <= Math.min(ch + 2, last); k++) {
        const a = closed[k - 2], c = closed[k];
        const g = dir === 'LONG' ? (a.h < c.l ? { k, lo: a.h, hi: c.l } : null) : (a.l > c.h ? { k, lo: c.h, hi: a.l } : null);
        if (g && (!gap || g.hi - g.lo > gap.hi - gap.lo)) gap = g;
      }
      if (!gap) continue;
      const after = closed.slice(gap.k + 1);
      const extreme = dir === 'LONG' ? bar.l : bar.h;
      const farEdge = dir === 'LONG' ? gap.lo : gap.hi;
      if (after.some((x) => s * (x.c - farEdge) < 0) || s * (price - extreme) <= 0) break;
      const nearEdge = dir === 'LONG' ? gap.hi : gap.lo;
      const retested = [...after, live].some((x) => (dir === 'LONG' ? x.l <= nearEdge : x.h >= nearEdge));
      const swingAfter = dir === 'LONG' ? Math.max(...closed.slice(sw).map((x) => x.h)) : Math.min(...closed.slice(sw).map((x) => x.l));
      const vr = closed[ch].v / (avgVol(closed, ch) || Infinity);
      out.push(candidate('sweepFvg', dir, retested ? 'ACTIVE' : 'FORMING', bar.t, (gap.lo + gap.hi) / 2, extreme - s * 0.1 * atr, {
        cap: swingAfter, maxRisk: 4 * atr, structure: 0.5 + Math.min(0.5, (gap.hi - gap.lo) / atr), volume: (vr - 1) / 2, flowAt: ch, flowBars: closed, trend,
        note: `${dir === 'LONG' ? 'Sell-side' : 'Buy-side'} sweep, CHoCH, FVG ${retested ? 'retest' : 'pending'}`,
      }));
      break;
    }
  }
  return bestPerDir(out);
}

/* ── Spike-fade (5m) ── */

export function detectSpikeFade(bars: readonly Bar[] | null, price: number, k1h: readonly Bar[] | null = null): Candidate[] {
  if (!bars || bars.length < MIN_5M) return [];
  const n = bars.length;
  const atrS = atrSeries(bars);
  const trend = dailyTrend(k1h, price);
  const out: Array<Candidate | null> = [];
  for (let idx = n - 1; idx >= n - 4; idx--) {
    const b = bars[idx];
    const a = atrS[idx - 1];
    if (!a || b.h - b.l < 3 * a) continue;
    const forming = idx === n - 1;
    const vr = b.v / (avgVol(bars, idx) || Infinity);
    // The forming bar's volume is partial (live ticks carry none), so only closed spikes need the volume.
    if (!forming && vr < 3) continue;
    const up = b.c > b.o;
    const dir: Direction = up ? 'SHORT' : 'LONG';
    const s = sign(dir);
    const ext = up ? b.h : b.l;
    const room = s * (b.o - b.c);
    if (room < a) continue;
    const later = bars.slice(idx + 1);
    if (later.some((x) => (up ? x.h > b.h : x.l < b.l))) continue;
    const entry = b.c;
    out.push(candidate('spikeFade', dir, forming ? 'FORMING' : 'ACTIVE', b.t, entry, ext + -s * 0.2 * a, {
      tp: { tp1: (entry + b.o) / 2, tp2: b.o }, maxRisk: 8 * a, structure: (b.h - b.l) / (6 * a), volume: forming ? 0.3 : (vr - 3) / 3,
      flowAt: idx + 1 < n ? idx + 1 : idx, flowBars: bars, trend, note: `${((b.h - b.l) / a).toFixed(1)} ATR ${up ? 'up' : 'down'} spike${forming ? ' (bar open)' : ''}`,
    }));
  }
  return bestPerDir(out);
}

/* ── Price action on 1m / 5m / 15m ── */

const MIN_PA = 40;
/** Bars searched back for the impulse / compression. */
const PA_WINDOW = 40;
/** A consolidation range lives this many bars after its impulse. */
const RANGE_LIFE = 30;

/** Candles aggregated to `ms` buckets (e.g. 5m → 15m); the newest bucket may still be forming. */
export function resample(bars: readonly Bar[], ms: number): Bar[] {
  const out: Bar[] = [];
  for (const b of bars) {
    const t = Math.floor(b.t / ms) * ms;
    const last = out[out.length - 1];
    if (last && last.t === t) {
      last.h = Math.max(last.h, b.h);
      last.l = Math.min(last.l, b.l);
      last.c = b.c;
      last.v += b.v;
    } else {
      out.push({ t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v });
    }
  }
  return out;
}

const isGreen = (b: Bar) => b.c > b.o;

/** Impulse: at least this many ATR from the leg's low to its high, over 2–6 bars. */
const IMPULSE_ATR = 2.5;
const IMPULSE_MAX_BARS = 6;
/** Range bars needed between the impulse and the sweep (the liquidity has to build up). */
const RANGE_MIN_BARS = 3;
/** The consolidation may give back at most this much of the impulse (a shallow, bullish pullback). */
const MAX_RETRACE = 0.62;
/** After the sweep, the shift in structure has to come within this many bars. */
const MSS_WITHIN = 10;
/** Range lows within this many ATR of the low count as equal lows (a resting pool of stops). */
const EQUAL_LOWS_ATR = 0.15;

interface Continuation {
  /** Range high (buy-side liquidity) and low (sell-side liquidity). */
  R: number;
  S: number;
  sweep: { i: number; low: number } | null;
  /** The last lower high before the sweep: a close above it is the shift in structure. */
  mss: number;
  /** The bar that closed above `mss`. */
  confirm: number | null;
  /** Range lows within 0.15 ATR of the range low. */
  eqLows: number;
  /** The range high was taken before the sweep. */
  pierced: boolean;
}

/**
 * Walks the closed bars after an impulse ending at `e`: builds the range, finds the sweep of
 * its low and the shift in structure after it. null when the setup failed (range too deep,
 * broke out without a sweep, lost the sweep low or the impulse origin, went stale).
 */
function continuationAfter(bars: readonly Bar[], e: number, last: number, origin: number, move: number, a: number): Continuation | null {
  const top = bars[e].h;
  let R = top, S = Infinity, sI = -1, pierced = false;
  let sweep: Continuation['sweep'] = null;
  let mss = -Infinity;
  const done = (confirm: number | null): Continuation => {
    let eqLows = 0;
    for (let i = e + 1; i < (sweep ? sweep.i : last + 1); i++) if (bars[i].l - S <= EQUAL_LOWS_ATR * a) eqLows++;
    return { R, S, sweep, mss, confirm, eqLows, pierced };
  };
  for (let j = e + 1; j <= last; j++) {
    const b = bars[j];
    if (sweep) {
      if (b.c < sweep.low || b.l <= origin) return null; // the sweep low gave way: a breakdown
      if (b.c > mss) return done(j);
      if (j - sweep.i >= MSS_WITHIN) return null;
      continue;
    }
    const rangeBars = j - e - 1;
    if (rangeBars >= RANGE_MIN_BARS && b.l < S && restingLow(bars, e, j, S, sI, a)) {
      if (b.l <= origin) return null;
      // One-candle sweep (wick under, close back in) or two-candle (close under, the next reclaims).
      let reclaim = -1;
      if (b.c > S) reclaim = j;
      else if (j + 1 <= last && bars[j + 1].c > S && bars[j + 1].l > origin) reclaim = j + 1;
      else if (j === last) return done(null); // closed under the low just now: still undecided
      if (reclaim < 0) return null;
      // The last lower high: the highest high of the (up to) three bars before the sweep.
      mss = Math.max(...bars.slice(Math.max(e + 1, j - 3), j).map((x) => x.h));
      sweep = { i: j, low: Math.min(b.l, bars[reclaim].l) };
      if (reclaim > j) {
        j = reclaim;
        if (bars[reclaim].c > mss) return done(reclaim);
      }
      continue;
    }
    // Still in the range.
    if (rangeBars >= RANGE_MIN_BARS && b.c > R) return null; // broke out without taking the lows
    if (b.h > R) { pierced = true; R = b.h; }
    if (b.l < S) { S = b.l; sI = j; }
    if (top - S > MAX_RETRACE * move) return null; // too deep for a continuation
    if (j - e > RANGE_LIFE) return null;
  }
  if (!Number.isFinite(S) || last - e < RANGE_MIN_BARS) return null;
  return done(null);
}

/**
 * Whether the range low `S` (set at bar `sI`) is resting liquidity when bar `j` trades under it:
 * equal lows, or a low that held for at least two full candles. A low the pullback made a bar
 * or two earlier is just the pullback still going, and taking it is no sweep.
 */
function restingLow(bars: readonly Bar[], e: number, j: number, S: number, sI: number, a: number): boolean {
  if (j - sI >= 3) return true;
  let touches = 0;
  for (let i = e + 1; i < j; i++) if (bars[i].l - S <= EQUAL_LOWS_ATR * a) touches++;
  return touches >= 2;
}

/**
 * Long continuation after a liquidity sweep (SMC):
 *  1. Impulse: a bullish displacement of 2–6 bars, mostly green, with at least one body
 *     ≥ 1 ATR, ≥ 2.5 ATR from the leg's low to its high (ATR measured before the leg).
 *  2. Range: at least three bars of consolidation holding the upper part of the impulse
 *     (≤ 62% retrace). Its lows are the sell-side liquidity.
 *  3. Sweep: a closed candle trades below the range low and closes back inside (or the next
 *     candle reclaims it) without losing the impulse's origin.
 *  4. Market-structure shift: within ten bars a candle closes above the last lower high
 *     before the sweep. That close triggers the long.
 * Forming: the range is set and price is coming down to its low, or the low was swept and
 * the shift hasn't closed yet. Active: the shift closed.
 */
export function detectLongContinuationSweep(bars: readonly Bar[] | null, tf: Timeframe, price: number, k1h: readonly Bar[] | null = null): Candidate[] {
  if (!bars || bars.length < MIN_PA) return [];
  const n = bars.length;
  const last = n - 2; // the newest closed bar (the last one is still forming)
  const atrS = atrSeries(bars);
  const trend = dailyTrend(k1h, price);

  // Newest impulse first: the leg ends at bar e, a high the next two bars don't exceed.
  for (let e = last - RANGE_MIN_BARS; e >= Math.max(ATR_N + IMPULSE_MAX_BARS + 1, n - PA_WINDOW); e--) {
    if (!isGreen(bars[e]) || bars[e + 1].h > bars[e].h || bars[e + 2].h > bars[e].h) continue;
    let lo = e;
    for (let k = e - 1; k > e - IMPULSE_MAX_BARS; k--) if (bars[k].l < bars[lo].l) lo = k;
    if (lo === e) continue;
    const a = atrS[lo - 1];
    if (!a || !(a > 0)) continue;
    const leg = bars.slice(lo, e + 1);
    // The leg tops out at e (otherwise the impulse ended earlier and e is already in the range).
    if (Math.max(...leg.map((b) => b.h)) > bars[e].h) continue;
    const move = bars[e].h - bars[lo].l;
    if (move < IMPULSE_ATR * a || leg.filter(isGreen).length < Math.ceil(0.6 * leg.length) || Math.max(...leg.map((b) => b.c - b.o)) < a) continue;
    const origin = bars[lo].l;

    const found = continuationAfter(bars, e, last, origin, move, a);
    if (!found) continue; // this impulse's structure failed: an older one may still hold
    const { R, S, sweep, mss, confirm, eqLows, pierced } = found;
    const H = R - S;
    const common = {
      tf, trend, flowBars: bars, penalty: pierced ? 10 : 0,
      structure: 0.7 * Math.min(1, move / (4 * a)) + 0.3 * Math.min(1, eqLows / 3),
    };
    const pool = eqLows >= 2 ? `${eqLows} equal lows` : 'range low';
    const weak = pierced ? ' · range high taken first (weaker)' : '';
    const impulse = `${(move / a).toFixed(1)} ATR impulse`;
    const tp = (entry: number, sl: number) => {
      const risk = entry - sl;
      const tp1 = R - entry >= 0.5 * risk ? R : entry + 1.5 * risk;
      return { tp1, tp2: Math.max(R + 1.5 * H, tp1 + risk) };
    };

    let c: Candidate | null = null;
    if (sweep && confirm !== null) {
      const b = bars[confirm];
      const sl = sweep.low - 0.1 * a;
      const vSweep = bars[sweep.i].v / (avgVol(bars, sweep.i) || Infinity);
      const vShift = b.v / (avgVol(bars, confirm) || Infinity);
      c = candidate('longContinuationSweep', 'LONG', 'ACTIVE', bars[e].t, b.c, sl, {
        ...common, tp: tp(b.c, sl), volume: (vSweep + vShift - 2) / 4, flowAt: confirm, maxRisk: 3 * a,
        note: `${impulse}, ${pool} swept, structure shifted up${weak}`,
      });
    } else if (sweep) {
      // Swept: the trigger is a close above the last lower high.
      const sl = sweep.low - 0.1 * a;
      c = candidate('longContinuationSweep', 'LONG', 'FORMING', bars[e].t, mss, sl, {
        ...common, tp: tp(mss, sl), volume: 0.25, flowAt: 0, maxRisk: 3 * a,
        note: `${impulse}, ${pool} swept, waiting for the structure shift${weak}`,
      });
    } else if (price > S && price - S <= a) {
      // Coming down to the liquidity under the range. The stop sits under the impulse's
      // origin, so the sweep itself doesn't invalidate the setup.
      const sl = origin - 0.1 * a;
      c = candidate('longContinuationSweep', 'LONG', 'FORMING', bars[e].t, S, sl, {
        ...common, tp: tp(S, sl), volume: 0.25, flowAt: 0,
        note: `${impulse}, ${Math.round(((bars[e].h - S) / move) * 100)}% pullback, price nearing the ${pool}${weak}`,
      });
    }
    return c ? [c] : []; // the newest intact impulse decides
  }
  return [];
}

/**
 * Short after a fakeout and liquidity sweep: higher lows compress into a resistance
 * touched twice, price breaks above and fails back below (fakeout), holds a tight
 * range, then a bearish candle wicks above the range high and closes back below.
 */
export function detectShortFakeoutSweep(bars: readonly Bar[] | null, tf: Timeframe, price: number, k1h: readonly Bar[] | null = null): Candidate[] {
  if (!bars || bars.length < MIN_PA) return [];
  const n = bars.length;
  const atrS = atrSeries(bars);
  const trend = dailyTrend(k1h, price);
  for (let f = n - 4; f >= Math.max(ATR_N + 12, n - PA_WINDOW); f--) {
    const a = atrS[f - 1];
    if (!a) continue;
    // Compression: the 12–24 bars before the fakeout.
    const cw = bars.slice(Math.max(0, f - 24), f);
    const R = Math.max(...cw.map((b) => b.h));
    const touches = cw.filter((b) => b.h >= R - 0.25 * a).length;
    const lows = pivots(cw, 2).lows.slice(-3);
    const rising = lows.length >= 2 && lows.every((p, i) => i === 0 || p.price > lows[i - 1].price);
    if (bars[f].h <= R || touches < 2 || !rising) continue;
    // The fakeout fails back below resistance within three bars.
    let g = -1;
    for (let k = f; k <= Math.min(f + 2, n - 2); k++) if (bars[k].c < R) { g = k; break; }
    if (g < 0) return [];
    const Hf = Math.max(...bars.slice(f, g + 1).map((b) => b.h));
    const origin = lows[0].price;
    const structure = 0.5 * Math.min(1, (touches - 1) / 3) + 0.5 * Math.min(1, lows.length / 3);
    let localHigh = -Infinity, bottom = Infinity, count = 0;
    // TP1 the range low (the higher-low support line once price is already below it);
    // TP2 the compression's origin low (3R when that isn't below TP1).
    const support = lows[lows.length - 1].price;
    const levelsFor = (entry: number, sl: number) => {
      const tp1 = bottom < entry ? bottom : support;
      return { tp1, tp2: origin < tp1 ? origin : Math.min(tp1, entry - 3 * (sl - entry)) };
    };
    for (let j = g + 1; j < n; j++) {
      const b = bars[j];
      const closed = j < n - 1;
      if (closed && count >= 2 && b.h > localHigh && b.c < R && b.c < b.o && b.o - b.c >= 0.5 * (b.h - b.l)) {
        // The sweep: buyers above the range trapped, strong bearish close back below resistance.
        const sl = Math.max(Hf, b.h) + 0.1 * a;
        const vr = b.v / (avgVol(bars, j) || Infinity);
        const c = candidate('shortFakeoutSweep', 'SHORT', 'ACTIVE', bars[f].t, b.c, sl, {
          tf, tp: levelsFor(b.c, sl), structure, volume: vr - 1, flowAt: j, flowBars: bars, trend,
          note: `Fakeout above ${touches}-touch resistance, range high swept`,
        });
        return c ? [c] : [];
      }
      if (!closed) break;
      if (b.c >= R) return []; // reclaimed resistance: no fakeout any more
      localHigh = Math.max(localHigh, b.h);
      bottom = Math.min(bottom, b.l);
      count++;
      if (localHigh - bottom > 1.5 * a) return []; // not a tight range
    }
    if (count < 2) return [];
    const sl = Hf + 0.1 * a;
    const c = candidate('shortFakeoutSweep', 'SHORT', 'FORMING', bars[f].t, R, sl, {
      tf, tp: levelsFor(R, sl), structure, volume: 0.25, flowAt: 0, flowBars: bars, trend,
      note: `Fakeout above ${touches}-touch resistance, tight range below`,
    });
    return c ? [c] : [];
  }
  return [];
}

/** Every detector over one coin (the price-action pair on 1m, 5m and 15m built from 5m). */
export function detectAll({ k1h, k5m, k1m = null, price }: DetectInput): Candidate[] {
  const pa: Array<[Timeframe, readonly Bar[] | null]> = [['1m', k1m], ['5m', k5m], ['15m', k5m ? resample(k5m, 15 * 60_000) : null]];
  return [
    ...detectBreakout(k1h, price),
    ...detectDefense(k1h, price),
    ...detectOrderBlock(k1h, price),
    ...detectSweepFvg(k1h, price),
    ...detectSpikeFade(k5m, price, k1h),
    ...pa.flatMap(([tf, bars]) => [...detectLongContinuationSweep(bars, tf, price, k1h), ...detectShortFakeoutSweep(bars, tf, price, k1h)]),
  ];
}
