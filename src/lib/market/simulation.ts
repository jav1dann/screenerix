/**
 * Seeded multi-exchange market simulation — the offline / demo data source.
 * The live equivalent is `liveExchangeService.ts`; both feed the same views.
 */
import { createRng, fmtPct, fmtPrice, lastOf, utcClock } from '@/lib/format';
import type { Rng } from '@/lib/format';
import { SEED } from './constants';
import { EXCHANGE_IDS, exchangeName } from './exchanges';
import type { AlertItem, Asset, BookLevel, Candle, OrderBook, TickerRow } from './types';

export type CandleCache = Map<string, Candle[]>;

/** Simulated asset: adds per-venue offsets used to fake cross-exchange quotes. */
export interface SimAsset extends Asset {
  volatility: number;
  funding: number;
  /** Indexed like `EXCHANGE_IDS`. */
  exOffsets: number[];
  exFunding: number[];
}

export function initMarket(noise: Rng): SimAsset[] {
  return SEED.map(([symbol, price, volM], index) => {
    const volatility = symbol === 'BTC' ? 0.0011 : symbol === 'ETH' ? 0.0015 : 0.0026;
    const history: number[] = [];
    let x = price;
    for (let k = 0; k < 90; k++) {
      history.unshift(x);
      x = x / (1 + (noise() - 0.5) * volatility * 2 + (noise() - 0.5) * 0.0005);
    }
    return {
      symbol, index, volatility, history,
      volume: volM * 1e6,
      // The simulated series is short: its whole span stands in for 24h.
      change24h: history[history.length - 1] / history[0] - 1,
      funding: (noise() - 0.3) * 0.0003,
      dir: 1,
      exOffsets: EXCHANGE_IDS.map(() => (noise() - 0.5) * 0.004 * (index > 8 ? 1.5 : 0.45)),
      exFunding: EXCHANGE_IDS.map(() => (noise() - 0.35) * 0.0004),
    };
  });
}

export function getCandles(cache: CandleCache, a: SimAsset, k: number, mult: number): Candle[] {
  const key = `${a.symbol}|${k}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const r = createRng(a.index * 97 + k * 13 + 5);
  const out: Candle[] = [];
  let close = lastOf(a.history);
  const v = a.volatility * mult * 1.3;
  for (let j = 0; j < 48; j++) {
    const open = close / (1 + (r() - 0.48) * v * 2);
    out.unshift({
      o: open, c: close,
      h: Math.max(open, close) * (1 + r() * v * 0.6),
      l: Math.min(open, close) * (1 - r() * v * 0.6),
      v: 0.25 + r(),
    });
    close = open;
  }
  cache.set(key, out);
  return out;
}

function updateCandles(cache: CandleCache, a: SimAsset): void {
  const p = lastOf(a.history);
  cache.forEach((series, key) => {
    if (!key.startsWith(`${a.symbol}|`)) return;
    const c = series[series.length - 1];
    c.c = p;
    c.h = Math.max(c.h, p);
    c.l = Math.min(c.l, p);
    c.v += 0.01;
  });
}

/** Synthetic order book around the last price. Pass `jitter` to randomise sizes each call. */
export function buildBook(a: SimAsset, jitter: Rng | null): OrderBook {
  const mid = lastOf(a.history);
  const step = mid * 0.00035 * (a.index > 8 ? 3 : 1);
  const r = createRng(a.index * 31 + 7);
  const unit = a.volume * 0.00004;
  const asks: BookLevel[] = [];
  const bids: BookLevel[] = [];
  for (let j = 1; j <= 12; j++) {
    let qa = 0.4 + r();
    let qb = 0.4 + r();
    if (j === 4 + (a.index % 5)) qa *= 5 + r() * 3;
    if (j === 6 + (a.index % 4)) qb *= 5.5 + r() * 3;
    if (r() < 0.08) qa *= 4;
    if (r() < 0.08) qb *= 4;
    const ja = jitter ? 0.85 + jitter() * 0.3 : 1;
    const jb = jitter ? 0.85 + jitter() * 0.3 : 1;
    asks.push({ price: mid + step * j, notional: qa * unit * ja, wall: qa > 3.5 });
    bids.push({ price: mid - step * j, notional: qb * unit * jb, wall: qb > 3.5 });
  }
  return { asks, bids, mid, spread: step * 2, range: (step * 12) / mid };
}

function stepMarket(market: SimAsset[], cache: CandleCache, noise: Rng): AlertItem | null {
  let alert: AlertItem | null = null;
  market.forEach((a) => {
    const prev = lastOf(a.history);
    const next = prev * (1 + (noise() - 0.5) * a.volatility * 2 + (noise() - 0.5) * 0.0002);
    a.history.push(next);
    a.history.shift();
    a.dir = next >= prev ? 1 : -1;
    a.change24h = next / a.history[0] - 1;
    a.volume *= 1 + (noise() - 0.5) * 0.002;
    a.funding += (noise() - 0.5) * 0.00001;
    a.exOffsets = a.exOffsets.map((x) => x * 0.92 + (noise() - 0.5) * 0.001 * (a.index > 8 ? 1.5 : 0.5));
    updateCandles(cache, a);
    const c1 = next / prev - 1;
    if (!alert && Math.abs(c1) > a.volatility * 0.85 && noise() < 0.25) {
      alert = {
        id: Date.now() + a.index,
        symbol: a.symbol,
        title: `${c1 > 0 ? 'Price spike' : 'Price drop'} ${fmtPct(c1)} in 1m`,
        detail: `${fmtPrice(prev)} → ${fmtPrice(next)} · ${exchangeName(EXCHANGE_IDS[a.index % 4])}`,
        positive: c1 > 0,
        time: utcClock(),
      };
    }
  });
  return alert;
}

/** Ticker table row; tolerant of short history while live data warms up. */
export function toRow(a: Asset, natr: number | null = null): TickerRow {
  const h = a.history;
  const p = lastOf(h);
  const back = (n: number) => (h.length > n ? p / h[h.length - 1 - n] - 1 : 0);
  const spark = h.slice(-30);
  return {
    asset: a, symbol: a.symbol, price: p,
    c1: back(1),
    c5: back(5),
    spark, trend: lastOf(spark) - spark[0],
    ch24: a.change24h,
    natr,
  };
}

export interface MarketStore {
  market: SimAsset[];
  cache: CandleCache;
  noise: Rng;
  /** Advance every asset by one tick; returns an alert if one fired. */
  step: () => AlertItem | null;
}

/** A fresh, deterministically seeded market — identical on server and client. */
export function createMarketStore(seed = 42): MarketStore {
  const noise = createRng(seed);
  const market = initMarket(noise);
  const cache: CandleCache = new Map();
  return { market, cache, noise, step: () => stepMarket(market, cache, noise) };
}
