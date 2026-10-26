/**
 * Screener metric catalog. Every filter condition and sort key refers to one of
 * these. Metrics are computed from the bar sets in `needs`, fetched lazily by the
 * scanner, plus the live price / funding / 24h turnover from the market feed.
 *
 * Units: '%' values are percentages (2 = 2%), '$' is quote currency, 'n' a count.
 * Directional metrics report a magnitude plus the sign of the move, so a
 * condition can ask for "≥ 2%, up only".
 */
import { aggregate } from '@/lib/market/exchanges/shared';
import type { OiPoint, RawCandle } from '@/lib/market/exchanges';

/** Bar sets the scanner can fetch per coin. */
/** `k1h` is loaded for the strategy engine only (no metric needs it). */
export type BarSet = 'k1m' | 'k5m' | 'oi5' | 'oi1h' | 'k1h';
export type MetricUnit = '%' | '$' | 'n' | 'price' | 'corr';
export type GroupId =
  | 'last1m' | 'range' | 'oiRange' | 'natr' | 'volume' | 'trades'
  | 'avgVolume' | 'avgTrades' | 'volSpike' | 'tradesSpike' | 'other';

export interface MetricInput {
  bars: Partial<Record<BarSet, RawCandle[] | OiPoint[] | null>>;
  /** BTC bars on the same venue (correlation). */
  btc: { k1m?: RawCandle[] | null; k5m?: RawCandle[] | null };
  price: number;
  /** Funding rate as a fraction (0.0001 = 0.01%), null on spot. */
  funding: number | null;
  /** Live 24h turnover in quote currency. */
  turnover: number;
}

export interface Reading { value: number; dir?: 1 | -1 }

export interface MetricDef {
  key: string;
  group: GroupId;
  /** Row label inside its group, e.g. "5m". */
  label: string;
  /** Standalone name, e.g. "Range 5m". */
  name: string;
  unit: MetricUnit;
  needs: readonly BarSet[];
  /** Needs per-candle trade counts (only some venues publish them). */
  trades?: boolean;
  /** Needs open-interest history. */
  oi?: boolean;
  /** Needs a funding rate (perpetuals). */
  funding?: boolean;
  directional?: boolean;
  hint?: string;
  compute(x: MetricInput): Reading | null;
}

export const GROUPS: ReadonlyArray<{ id: GroupId; title: string; hint?: string }> = [
  { id: 'last1m', title: 'Last 1m candle' },
  { id: 'range', title: 'Range (%)', hint: '(high − low) / low over the window' },
  { id: 'oiRange', title: 'OI Range (%)', hint: 'Open-interest swing over the window' },
  { id: 'natr', title: 'NATR (%)', hint: 'Average true range ÷ price · candle / periods' },
  { id: 'volume', title: 'Volume ($)' },
  { id: 'trades', title: 'Trades' },
  { id: 'avgVolume', title: 'Average volume ($)', hint: 'Mean candle volume · candle over span' },
  { id: 'avgTrades', title: 'Average number of trades', hint: 'Mean trades per candle · candle over span' },
  { id: 'volSpike', title: 'Volume Spike (%)', hint: 'Last closed candle vs. the average of the previous 20' },
  { id: 'tradesSpike', title: 'Trades Spike (%)', hint: 'Last closed candle vs. the average of the previous 20' },
  { id: 'other', title: 'Funding, correlation & price' },
];

/* ── helpers ── */

const MIN = 60_000;
const HOUR = 60 * MIN;
const WINDOWS: ReadonlyArray<{ id: string; ms: number }> = [
  { id: '5m', ms: 5 * MIN }, { id: '15m', ms: 15 * MIN }, { id: '30m', ms: 30 * MIN },
  { id: '1h', ms: HOUR }, { id: '2h', ms: 2 * HOUR }, { id: '4h', ms: 4 * HOUR },
  { id: '6h', ms: 6 * HOUR }, { id: '12h', ms: 12 * HOUR }, { id: '24h', ms: 24 * HOUR },
];

const candles = (x: MetricInput, set: 'k1m' | 'k5m'): RawCandle[] | null => (x.bars[set] as RawCandle[] | null | undefined) ?? null;
const oiPoints = (x: MetricInput, set: 'oi5' | 'oi1h'): OiPoint[] | null => (x.bars[set] as OiPoint[] | null | undefined) ?? null;
const usd = (b: RawCandle) => b.v * b.c;
const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;
const sign = (v: number): 1 | -1 => (v >= 0 ? 1 : -1);

/** Windows up to 1h are summed from 1m candles; longer ones from 5m candles. */
const sourceFor = (ms: number): { set: 'k1m' | 'k5m'; barMs: number } => (ms <= HOUR ? { set: 'k1m', barMs: MIN } : { set: 'k5m', barMs: 5 * MIN });

/** `bars` without the trailing live-price candles (`mergeLive`), whose volume / trades are 0. */
export function venueBars(bars: RawCandle[] | null): RawCandle[] | null {
  if (!bars) return null;
  let end = bars.length;
  while (end > 0 && bars[end - 1].live) end--;
  return end === bars.length ? bars : bars.slice(0, end);
}
/** Candles for volume / trade metrics: the venue's own bars only. */
const flowCandles = (x: MetricInput, set: 'k1m' | 'k5m'): RawCandle[] | null => venueBars(candles(x, set));

/** The last `ms` of candles; `flow` drops live-price bars (volume / trade metrics). */
function lastBars(x: MetricInput, ms: number, flow = false): RawCandle[] | null {
  const { set, barMs } = sourceFor(ms);
  const bars = flow ? flowCandles(x, set) : candles(x, set);
  const n = Math.round(ms / barMs);
  if (!bars || bars.length < Math.min(n, 2)) return null;
  return bars.slice(-n);
}

function rangeOf(bars: RawCandle[]): Reading | null {
  if (!bars.length) return null;
  let hi = -Infinity, lo = Infinity;
  for (const b of bars) { if (b.h > hi) hi = b.h; if (b.l < lo) lo = b.l; }
  if (!(lo > 0)) return null;
  return { value: ((hi - lo) / lo) * 100, dir: sign(bars[bars.length - 1].c - bars[0].o) };
}

/** Venue candles bucketed to `bucketMs` (1m stays 1m; everything else from 5m), for volume / trade metrics. */
function bucketed(x: MetricInput, bucketMs: number): RawCandle[] | null {
  if (bucketMs === MIN) return flowCandles(x, 'k1m');
  const k5 = flowCandles(x, 'k5m');
  if (!k5) return null;
  return bucketMs === 5 * MIN ? k5 : aggregate(k5, bucketMs);
}

const tradesOf = (b: RawCandle): number | null => (b.n === undefined ? null : b.n);
const hasTrades = (bars: RawCandle[]) => bars.length > 0 && bars.every((b) => b.n !== undefined);

/** Average true range over `period` candles, as % of the last close. */
function natr(bars: RawCandle[] | null, period: number): Reading | null {
  if (!bars || bars.length < period + 1) return null;
  const tail = bars.slice(-(period + 1));
  const trs: number[] = [];
  for (let i = 1; i < tail.length; i++) {
    const b = tail[i], pc = tail[i - 1].c;
    trs.push(Math.max(b.h - b.l, Math.abs(b.h - pc), Math.abs(b.l - pc)));
  }
  const close = tail[tail.length - 1].c;
  return close > 0 ? { value: (mean(trs) / close) * 100 } : null;
}

/**
 * Last closed candle vs the mean of the previous 20, as a % change. The venue's forming
 * candle is skipped: seconds into a bar it holds a sliver of the volume / trades and would
 * read as a −95…−100% "spike" on every coin.
 */
function spike(bars: RawCandle[] | null, pick: (b: RawCandle) => number | null, bucketMs: number, now = Date.now()): Reading | null {
  if (!bars) return null;
  const closed = bars.length && bars[bars.length - 1].t + bucketMs > now ? bars.slice(0, -1) : bars;
  if (closed.length < 21) return null;
  const tail = closed.slice(-21);
  const vals = tail.map(pick);
  if (vals.some((v) => v === null)) return null;
  const last = vals[20] as number;
  const base = mean(vals.slice(0, 20) as number[]);
  if (!(base > 0)) return null;
  const b = tail[20];
  return { value: (last / base - 1) * 100, dir: sign(b.c - b.o) };
}

/** Pearson correlation of per-candle returns with BTC over the last `n` candles. */
export function correlation(a: RawCandle[] | null | undefined, b: RawCandle[] | null | undefined, n: number): number | null {
  if (!a || !b) return null;
  const bt = new Map(b.map((c) => [c.t, c.c]));
  const pairs: Array<[number, number]> = [];
  for (let i = 1; i < a.length; i++) {
    const p0 = bt.get(a[i - 1].t), p1 = bt.get(a[i].t);
    if (p0 === undefined || p1 === undefined || !(a[i - 1].c > 0) || !(p0 > 0)) continue;
    pairs.push([a[i].c / a[i - 1].c - 1, p1 / p0 - 1]);
  }
  const tail = pairs.slice(-n);
  if (tail.length < Math.min(n, 10)) return null;
  const mx = mean(tail.map((p) => p[0])), my = mean(tail.map((p) => p[1]));
  let sxy = 0, sxx = 0, syy = 0;
  for (const [x, y] of tail) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

/* ── catalog ── */

const defs: MetricDef[] = [];
const add = (d: MetricDef) => { defs.push(d); };

// Last 1m candle
add({
  key: 'move1m', group: 'last1m', label: 'Movement 1m', name: 'Movement 1m', unit: '%', needs: ['k1m'], directional: true,
  compute: (x) => {
    const b = candles(x, 'k1m')?.at(-1);
    return b && b.o > 0 ? { value: Math.abs(b.c / b.o - 1) * 100, dir: sign(b.c - b.o) } : null;
  },
});
add({
  key: 'oi1m', group: 'last1m', label: '1m OI', name: '1m OI', unit: '%', needs: ['oi5'], oi: true, directional: true,
  hint: "Venues publish OI history at 5m at best, so this compares the two latest samples",
  compute: (x) => {
    const pts = oiPoints(x, 'oi5');
    if (!pts || pts.length < 2) return null;
    const [a, b] = [pts[pts.length - 2].oi, pts[pts.length - 1].oi];
    return a > 0 ? { value: Math.abs(b / a - 1) * 100, dir: sign(b - a) } : null;
  },
});
add({
  key: 'vol1m', group: 'last1m', label: 'Volume 1m', name: 'Volume 1m', unit: '$', needs: ['k1m'],
  compute: (x) => { const b = flowCandles(x, 'k1m')?.at(-1); return b ? { value: usd(b) } : null; },
});
add({
  key: 'vol1mPct', group: 'last1m', label: 'Volume 1m (%)', name: 'Volume 1m vs 30m avg', unit: '%', needs: ['k1m'],
  hint: 'Last 1m volume vs. the average of the previous 30 minutes',
  compute: (x) => {
    const bars = flowCandles(x, 'k1m');
    if (!bars || bars.length < 31) return null;
    const base = mean(bars.slice(-31, -1).map(usd));
    return base > 0 ? { value: (usd(bars[bars.length - 1]) / base - 1) * 100 } : null;
  },
});
add({
  key: 'trades1m', group: 'last1m', label: 'Trades 1m', name: 'Trades 1m', unit: 'n', needs: ['k1m'], trades: true,
  compute: (x) => { const b = flowCandles(x, 'k1m')?.at(-1); const n = b ? tradesOf(b) : null; return n === null ? null : { value: n }; },
});
add({
  key: 'trades1mPct', group: 'last1m', label: 'Trades 1m (%)', name: 'Trades 1m vs 30m avg', unit: '%', needs: ['k1m'], trades: true,
  hint: 'Last 1m trade count vs. the average of the previous 30 minutes',
  compute: (x) => {
    const bars = flowCandles(x, 'k1m');
    if (!bars || bars.length < 31 || !hasTrades(bars.slice(-31))) return null;
    const base = mean(bars.slice(-31, -1).map((b) => b.n as number));
    return base > 0 ? { value: ((bars[bars.length - 1].n as number) / base - 1) * 100 } : null;
  },
});

for (const w of WINDOWS) {
  const src = sourceFor(w.ms).set;
  add({ key: `range_${w.id}`, group: 'range', label: w.id, name: `Range ${w.id}`, unit: '%', needs: [src], directional: true, compute: (x) => { const b = lastBars(x, w.ms); return b ? rangeOf(b) : null; } });
}
for (const w of WINDOWS) {
  const set: 'oi5' | 'oi1h' = w.ms <= 6 * HOUR ? 'oi5' : 'oi1h';
  add({
    key: `oiRange_${w.id}`, group: 'oiRange', label: w.id, name: `OI Range ${w.id}`, unit: '%', needs: [set], oi: true, directional: true,
    compute: (x) => {
      const pts = oiPoints(x, set);
      if (!pts || pts.length < 2) return null;
      const end = pts[pts.length - 1].t;
      const win = pts.filter((p) => p.t >= end - w.ms);
      const span = win.length >= 2 ? win : pts.slice(-2);
      let hi = -Infinity, lo = Infinity;
      for (const p of span) { if (p.oi > hi) hi = p.oi; if (p.oi < lo) lo = p.oi; }
      return lo > 0 ? { value: ((hi - lo) / lo) * 100, dir: sign(span[span.length - 1].oi - span[0].oi) } : null;
    },
  });
}

add({ key: 'natr_1_30', group: 'natr', label: '1 / 30', name: 'NATR 1m/30', unit: '%', needs: ['k1m'], compute: (x) => natr(candles(x, 'k1m'), 30) });
add({ key: 'natr_5_14', group: 'natr', label: '5 / 14', name: 'NATR 5m/14', unit: '%', needs: ['k5m'], compute: (x) => natr(candles(x, 'k5m'), 14) });

for (const w of WINDOWS) {
  const src = sourceFor(w.ms).set;
  add({ key: `vol_${w.id}`, group: 'volume', label: w.id, name: `Volume ${w.id}`, unit: '$', needs: [src], compute: (x) => { const b = lastBars(x, w.ms, true); return b ? { value: b.reduce((s, c) => s + usd(c), 0) } : null; } });
}
for (const w of WINDOWS) {
  const src = sourceFor(w.ms).set;
  add({
    key: `trades_${w.id}`, group: 'trades', label: w.id, name: `Trades ${w.id}`, unit: 'n', needs: [src], trades: true,
    compute: (x) => { const b = lastBars(x, w.ms, true); return b && hasTrades(b) ? { value: b.reduce((s, c) => s + (c.n as number), 0) } : null; },
  });
}

const AVERAGES: ReadonlyArray<{ id: string; label: string; bucket: number; span: number }> = [
  { id: '1_30m', label: '1m over 30m', bucket: MIN, span: 30 * MIN },
  { id: '5_2h', label: '5m over 2h', bucket: 5 * MIN, span: 2 * HOUR },
  { id: '15_6h', label: '15m over 6h', bucket: 15 * MIN, span: 6 * HOUR },
  { id: '30_12h', label: '30m over 12h', bucket: 30 * MIN, span: 12 * HOUR },
  { id: '1h_24h', label: '1h over 24h', bucket: HOUR, span: 24 * HOUR },
];
for (const a of AVERAGES) {
  const set: BarSet = a.bucket === MIN ? 'k1m' : 'k5m';
  const n = a.span / a.bucket;
  add({
    key: `avgVol_${a.id}`, group: 'avgVolume', label: a.label, name: `Avg volume ${a.label}`, unit: '$', needs: [set],
    compute: (x) => { const b = bucketed(x, a.bucket)?.slice(-n); return b && b.length >= Math.min(n, 2) ? { value: mean(b.map(usd)) } : null; },
  });
}
for (const a of AVERAGES) {
  const set: BarSet = a.bucket === MIN ? 'k1m' : 'k5m';
  const n = a.span / a.bucket;
  add({
    key: `avgTrades_${a.id}`, group: 'avgTrades', label: a.label, name: `Avg trades ${a.label}`, unit: 'n', needs: [set], trades: true,
    compute: (x) => { const b = bucketed(x, a.bucket)?.slice(-n); return b && b.length >= Math.min(n, 2) && hasTrades(b) ? { value: mean(b.map((c) => c.n as number)) } : null; },
  });
}

const SPIKES: ReadonlyArray<{ id: string; bucket: number }> = [
  { id: '1m', bucket: MIN }, { id: '5m', bucket: 5 * MIN }, { id: '15m', bucket: 15 * MIN }, { id: '1h', bucket: HOUR },
];
for (const s of SPIKES) {
  const set: BarSet = s.bucket === MIN ? 'k1m' : 'k5m';
  add({ key: `volSpike_${s.id}`, group: 'volSpike', label: s.id, name: `Volume spike ${s.id}`, unit: '%', needs: [set], directional: true, compute: (x) => spike(bucketed(x, s.bucket), usd, s.bucket) });
}
for (const s of SPIKES) {
  const set: BarSet = s.bucket === MIN ? 'k1m' : 'k5m';
  add({ key: `tradesSpike_${s.id}`, group: 'tradesSpike', label: s.id, name: `Trades spike ${s.id}`, unit: '%', needs: [set], trades: true, directional: true, compute: (x) => spike(bucketed(x, s.bucket), tradesOf, s.bucket) });
}

add({ key: 'funding', group: 'other', label: 'Funding (%)', name: 'Funding', unit: '%', needs: [], funding: true, compute: (x) => (x.funding === null ? null : { value: x.funding * 100 }) });
add({ key: 'corr_1_50', group: 'other', label: 'Correlation to BTC 1 / 50', name: 'BTC corr 1m/50', unit: 'corr', needs: ['k1m'], hint: 'Pearson correlation of 1m returns over 50 candles (−1…1)', compute: (x) => { const c = correlation(candles(x, 'k1m'), x.btc.k1m, 50); return c === null ? null : { value: c }; } });
add({ key: 'corr_5_20', group: 'other', label: 'Correlation to BTC 5 / 20', name: 'BTC corr 5m/20', unit: 'corr', needs: ['k5m'], hint: 'Pearson correlation of 5m returns over 20 candles (−1…1)', compute: (x) => { const c = correlation(candles(x, 'k5m'), x.btc.k5m, 20); return c === null ? null : { value: c }; } });
add({ key: 'lastPrice', group: 'other', label: 'Last price', name: 'Last price', unit: 'price', needs: [], compute: (x) => (x.price > 0 ? { value: x.price } : null) });
add({ key: 'turnover', group: 'other', label: '24h turnover ($)', name: '24h turnover', unit: '$', needs: [], hint: 'From the live 24h ticker', compute: (x) => ({ value: x.turnover }) });

export const METRICS: readonly MetricDef[] = defs;
export const METRIC_BY_KEY: ReadonlyMap<string, MetricDef> = new Map(defs.map((d) => [d.key, d]));
export const metricsIn = (group: GroupId): MetricDef[] => defs.filter((d) => d.group === group);

/** Venues whose klines carry per-candle trade counts. */
const TRADE_COUNT_VENUES: ReadonlySet<string> = new Set(['binance']);
/** Venues with an open-interest history endpoint. */
const OI_VENUES: ReadonlySet<string> = new Set(['binance', 'bybit', 'okx', 'gate']);
const PERP_VENUES: ReadonlySet<string> = new Set(['binance', 'bybit', 'okx', 'bitget', 'gate']);

/** Why a metric can't be computed on a venue, or null when it can. */
export function unsupportedReason(def: MetricDef, exchange: string, venueName: string): string | null {
  if (def.trades && !TRADE_COUNT_VENUES.has(exchange)) return `${venueName} doesn't publish trade counts`;
  if (def.oi && !OI_VENUES.has(exchange)) return `${venueName} doesn't publish open-interest history`;
  if (def.funding && !PERP_VENUES.has(exchange)) return 'Spot markets have no funding';
  return null;
}

export function fmtMetric(unit: MetricUnit, v: number): string {
  switch (unit) {
    case '%': return `${+v.toFixed(Math.abs(v) < 1 ? 3 : 2)}%`;
    case '$': return v >= 1e9 ? `$${+(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `$${+(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `$${+(v / 1e3).toFixed(1)}K` : `$${+v.toFixed(2)}`;
    case 'n': return v >= 1e6 ? `${+(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${+(v / 1e3).toFixed(1)}K` : `${Math.round(v)}`;
    case 'corr': return v.toFixed(2);
    default: return `${+v.toPrecision(6)}`;
  }
}

/** 1m price buckets built from live ticks (no volume), oldest first. */
export type LiveBuckets = RawCandle[];
const LIVE_KEEP = 70;

/** Record a live price into `buckets` (mutated in place; keeps the last ~70 minutes). */
export function recordLive(buckets: LiveBuckets, price: number, now: number): void {
  if (!(price > 0)) return;
  const t = Math.floor(now / MIN) * MIN;
  const last = buckets[buckets.length - 1];
  if (last && last.t === t) {
    last.c = price;
    if (price > last.h) last.h = price;
    if (price < last.l) last.l = price;
    return;
  }
  if (last && t < last.t) return;
  buckets.push({ t, o: price, h: price, l: price, c: price, v: 0 });
  if (buckets.length > LIVE_KEEP) buckets.splice(0, buckets.length - LIVE_KEEP);
}

/**
 * Fold live 1m buckets into cached `barMs` candles (a copy — the cache is never
 * mutated), so price-based metrics track every tick since the last refetch, not
 * just the current price. Buckets older than the cache's last bar are ignored
 * (the venue's bars win). Live-only bars are marked `live` (volume / trades 0), and
 * volume / trade metrics skip them (`venueBars`).
 */
export function mergeLive(bars: RawCandle[], live: LiveBuckets | undefined, barMs: number): RawCandle[] {
  const first = bars[bars.length - 1];
  if (!first || !live?.length) return bars;
  const out = bars.slice();
  for (const b of live) {
    const t = Math.floor(b.t / barMs) * barMs;
    const last = out[out.length - 1];
    if (t < last.t) continue;
    if (t === last.t) {
      out[out.length - 1] = { ...last, c: b.c, h: Math.max(last.h, b.h), l: Math.min(last.l, b.l) };
    } else {
      out.push({ t, o: b.o, h: b.h, l: b.l, c: b.c, v: 0, ...(first.n === undefined ? {} : { n: 0 }), live: true });
    }
  }
  return out;
}
