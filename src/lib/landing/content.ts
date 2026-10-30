import { PERIODS, TRIAL_DAYS, yearlyPerMonth, yearlySavingPct } from '@/lib/billing/plans';
import { createRng, lastOf } from '@/lib/format';
import type { Rng } from '@/lib/format';
import type { Candle } from '@/lib/market/types';

export type AuthMode = 'signin' | 'register';

export interface PreviewAsset { symbol: string; volatility: number; history: number[]; dir: 1 | -1 }
/** Pro plan prices (USD), from the checkout's own table so the two can't drift apart. */
export const PRICING = {
  trialDays: TRIAL_DAYS,
  monthly: PERIODS.month.usd,
  yearly: PERIODS.year.usd,
} as const;
export { yearlyPerMonth, yearlySavingPct };

/** Support channels shown in the landing page's Contact section. */
export const CONTACT = {
  email: 'support@screenerix.com',
  telegram: 'screenerix_support',
} as const;

/** Exchanges the terminal streams from (shown as wordmarks on the landing page). */
export const EXCHANGE_NAMES = ['Binance', 'Bybit', 'OKX', 'Bitget', 'Gate', 'Coinbase'] as const;

const PREVIEW_SEED: ReadonlyArray<readonly [string, number]> = [
  ['BTC', 67420.5], ['ETH', 3512.4], ['SOL', 172.38], ['BNB', 584.2],
  ['XRP', 0.5231], ['DOGE', 0.14122], ['TON', 6.912], ['AVAX', 36.82],
];

function initPreview(noise: Rng): PreviewAsset[] {
  return PREVIEW_SEED.map(([symbol, price]) => {
    const volatility = symbol === 'BTC' ? 0.0011 : symbol === 'ETH' ? 0.0015 : 0.0026;
    const history: number[] = [];
    let x = price;
    for (let k = 0; k < 60; k++) {
      history.unshift(x);
      x = x / (1 + (noise() - 0.5) * volatility * 2);
    }
    return { symbol, volatility, history, dir: 1 };
  });
}

function initCandles(price: number, vol: number): Candle[] {
  const r = createRng(11);
  const out: Candle[] = [];
  let close = price;
  for (let j = 0; j < 48; j++) {
    const open = close / (1 + (r() - 0.48) * vol * 2);
    out.unshift({ o: open, c: close, h: Math.max(open, close) * (1 + r() * vol * 0.6), l: Math.min(open, close) * (1 - r() * vol * 0.6), v: 0.25 + r() });
    close = open;
  }
  return out;
}

export interface PreviewStore {
  assets: PreviewAsset[];
  candles: Candle[];
  /** Advance the preview feed by one tick. */
  step: () => void;
}

/** Lightweight, deterministically seeded feed for the hero preview and feature visuals. */
export function createPreviewStore(seed = 7): PreviewStore {
  const noise = createRng(seed);
  const assets = initPreview(noise);
  const candles = initCandles(lastOf(assets[0].history), assets[0].volatility * 5 * 1.3);
  const step = () => {
    assets.forEach((a) => {
      const prev = lastOf(a.history);
      const next = prev * (1 + (noise() - 0.5) * a.volatility * 2);
      a.history.push(next);
      a.history.shift();
      a.dir = next >= prev ? 1 : -1;
    });
    const p = lastOf(assets[0].history);
    const c = candles[candles.length - 1];
    c.c = p; c.h = Math.max(c.h, p); c.l = Math.min(c.l, p);
  };
  return { assets, candles, step };
}

export interface PreviewLevel { price: number; size: number; ask: boolean; wall: boolean }

/** A small, seeded order book around `mid` with one ask wall and one bid wall (sizes in $K). */
export function previewBook(mid: number, levels = 4, step = mid * 0.00035, seed = 19): PreviewLevel[] {
  const r = createRng(seed);
  return Array.from({ length: levels * 2 }, (_, i) => {
    const ask = i < levels;
    const lvl = ask ? levels - i : i - levels + 1;
    const wall = (ask && lvl === levels - 1) || (!ask && lvl === Math.min(2, levels));
    return { price: mid + (ask ? 1 : -1) * lvl * step, size: (40 + r() * 90) * (wall ? 4.5 : 1), ask, wall };
  });
}
