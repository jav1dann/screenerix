import type { InstrumentMeta, Levels, RawCandle, RawTrade } from './types';

/** Parse a numeric field; returns undefined for missing / non-finite values. */
export function num(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function levels(rows: unknown): Levels {
  if (!Array.isArray(rows)) return [];
  const out: Levels = [];
  for (const r of rows) {
    if (!Array.isArray(r)) continue;
    const p = num(r[0]);
    const s = num(r[1]);
    if (p !== undefined && s !== undefined) out.push([p, s]);
  }
  return out;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function safeJson(raw: string): unknown {
  try { return JSON.parse(raw); } catch { return null; }
}

export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Topic keys are "channel|inst" (optionally "channel|inst|extra"). */
export const topic = (...parts: string[]): string => parts.join('|');
export const splitTopic = (t: string): string[] => t.split('|');

/** Normalise array-of-arrays klines `[t, o, h, l, c, v]` into oldest-first candles. */
export function arrayKlines(rows: unknown, idx: { t: number; o: number; h: number; l: number; c: number; v: number; n?: number; tb?: number }, tScale = 1): RawCandle[] {
  if (!Array.isArray(rows)) return [];
  const out: RawCandle[] = [];
  for (const r of rows) {
    if (!Array.isArray(r)) continue;
    const t = num(r[idx.t]);
    const o = num(r[idx.o]);
    const h = num(r[idx.h]);
    const l = num(r[idx.l]);
    const c = num(r[idx.c]);
    const v = num(r[idx.v]) ?? 0;
    if (t === undefined || o === undefined || h === undefined || l === undefined || c === undefined) continue;
    const n = idx.n === undefined ? undefined : num(r[idx.n]);
    const tb = idx.tb === undefined ? undefined : num(r[idx.tb]);
    const bar: RawCandle = { t: t * tScale, o, h, l, c, v };
    if (n !== undefined) bar.n = n;
    if (tb !== undefined) bar.tb = tb;
    out.push(bar);
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Merge `factor` consecutive candles (aligned to `bucketMs`) into one. */
export function aggregate(candles: RawCandle[], bucketMs: number): RawCandle[] {
  const out: RawCandle[] = [];
  for (const c of candles) {
    const t = Math.floor(c.t / bucketMs) * bucketMs;
    const last = out[out.length - 1];
    if (last && last.t === t) {
      last.h = Math.max(last.h, c.h);
      last.l = Math.min(last.l, c.l);
      last.c = c.c;
      last.v += c.v;
      if (c.n !== undefined) last.n = (last.n ?? 0) + c.n;
      if (c.tb !== undefined) last.tb = (last.tb ?? 0) + c.tb;
    } else {
      out.push({ ...c, t });
    }
  }
  return out;
}

/**
 * Drop the oldest aggregated candle when the source data started inside its bucket (at
 * `firstSourceT`, not on the bucket's open): it would be a partial candle — wrong open, high and low.
 * A lone candle is kept.
 */
export function trimPartialHead(candles: RawCandle[], firstSourceT: number | undefined, bucketMs: number): RawCandle[] {
  if (candles.length < 2 || firstSourceT === undefined || firstSourceT % bucketMs === 0) return candles;
  return candles.slice(1);
}

/**
 * Split a venue base like "1000PEPE", "10000SATS" or "1000000MOG" into the real
 * coin and its contract multiplier. Plain bases (incl. "1INCH") pass through.
 */
export function splitMultiplier(venueBase: string): { base: string; mult: number } {
  const m = /^(10{3,})([A-Z][A-Z0-9]*)$/.exec(venueBase);
  return m ? { base: m[2], mult: Number(m[1]) } : { base: venueBase, mult: 1 };
}

export interface InstrumentRow {
  /** Base as the venue names it, possibly with a multiplier prefix ("1000PEPE"). */
  venueBase: string;
  inst: string;
  /** Base units per venue size unit before the multiplier (e.g. OKX ctVal). */
  contractSize?: number;
}

/**
 * Index a venue's instrument list by real base coin. Prices / sizes of
 * multiplied contracts are rescaled to one coin. A plain listing wins over a
 * multiplied one. Pass `bases` to keep only those coins.
 */
export function indexInstruments(rows: Iterable<InstrumentRow>, bases?: readonly string[]): Record<string, InstrumentMeta> {
  const out: Record<string, InstrumentMeta> = {};
  for (const r of rows) {
    const { base, mult } = splitMultiplier(r.venueBase.toUpperCase());
    const meta: InstrumentMeta = { inst: r.inst, contractSize: mult * (r.contractSize ?? 1), priceScale: 1 / mult };
    const prev = out[base];
    if (!prev || (prev.priceScale !== 1 && mult === 1)) out[base] = meta;
  }
  if (!bases) return out;
  const want = new Set(bases);
  return Object.fromEntries(Object.entries(out).filter(([b]) => want.has(b)));
}

/** Fold one trade into a series of `span`-ms candles. */
export function applyTrade(series: RawCandle[], span: number, price: number, size: number, t: number, max: number, side?: 'buy' | 'sell'): RawCandle | null {
  const bucket = Math.floor(t / span) * span;
  const last = series[series.length - 1];
  // Taker side is known per trade: candles built from trades carry a real taker-buy volume.
  const buy = side === undefined ? undefined : side === 'buy' ? size : 0;
  if (last && last.t === bucket) {
    const next: RawCandle = { ...last, h: Math.max(last.h, price), l: Math.min(last.l, price), c: price, v: last.v + size };
    if (buy !== undefined) next.tb = (last.tb ?? 0) + buy;
    series[series.length - 1] = next;
    return next;
  }
  if (!last || bucket > last.t) {
    // Like the venues' own candles: a bucket opens at its first trade (not the previous close,
    // which would also stretch its high / low to a price never traded in it).
    const next: RawCandle = { t: bucket, o: price, h: price, l: price, c: price, v: size };
    if (buy !== undefined) next.tb = buy;
    series.push(next);
    if (series.length > max) series.shift();
    return next;
  }
  return null;
}

/** Aggregate trades (oldest first) into candles. */
export function candlesFromTrades(trades: RawTrade[], span: number, max: number): RawCandle[] {
  const out: RawCandle[] = [];
  for (const t of trades) applyTrade(out, span, t.price, t.size, t.t, max, t.side);
  return out;
}
