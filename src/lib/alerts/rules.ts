/**
 * When alerts fire — pure functions over a coin's price and bars, shared by the server's
 * alert worker and the tests.
 */
import type { OiPoint, RawCandle } from '@/lib/market/exchanges';
import type { Alert, Condition, MetricWindow } from './types';

const MIN = 60_000;
const WINDOW_MS: Record<MetricWindow, number> = { '1m': MIN, '5m': 5 * MIN, '15m': 15 * MIN, '1h': 60 * MIN };
/** Volume spike baseline: the candles before the last closed one. */
const SPIKE_BASE = 20;

/** What the rules read about one coin. */
export interface CoinState {
  price: number;
  /** Funding rate as a fraction (0.0001 = 0.01%). */
  funding: number | null;
  k1m: readonly RawCandle[] | null;
  k5m: readonly RawCandle[] | null;
  oi5: readonly OiPoint[] | null;
}

export const isBeyond = (p: NonNullable<Alert['price']>, price: number): boolean => (p.direction === 'above' ? price >= p.level : price <= p.level);

/** Infinite alerts wait `repeatMinutes` between notifications. */
const cooled = (a: Pick<Alert, 'lastTriggeredAt' | 'repeatMinutes'>, now: number) =>
  a.lastTriggeredAt === null || now - a.lastTriggeredAt >= Math.max(1, a.repeatMinutes) * MIN;

/**
 * Price alert on a move `prev → price`. One-time: the first time price reaches the level from
 * its side. Infinite: whenever it is beyond the level, at most every `repeatMinutes`.
 */
export function priceFires(a: Pick<Alert, 'status' | 'mode' | 'price' | 'lastTriggeredAt' | 'repeatMinutes'>, prev: number | null, price: number, now: number): boolean {
  if (a.status !== 'active' || !a.price || !(price > 0) || !isBeyond(a.price, price)) return false;
  if (a.mode === 'once') return prev === null || !isBeyond(a.price, prev);
  return cooled(a, now);
}

/** Close of the last 1m candle that ended at or before `t` (the price `t` ago), or null without data. */
function priceAt(k1m: readonly RawCandle[], t: number): number | null {
  for (let i = k1m.length - 1; i >= 0; i--) if (k1m[i].t + MIN <= t) return k1m[i].c;
  return null;
}

/** Last closed venue candle's volume ÷ the mean of the 20 before it (live-only bars carry no volume). */
function volumeSpike(bars: readonly RawCandle[] | null): number | null {
  if (!bars) return null;
  const venue = bars.filter((b) => !b.live);
  // The newest venue bar may have been fetched mid-candle: the one before it is the last closed.
  const last = venue.length - 2;
  if (last < SPIKE_BASE) return null;
  let sum = 0;
  for (let i = last - SPIKE_BASE; i < last; i++) sum += venue[i].v;
  const avg = sum / SPIKE_BASE;
  return avg > 0 ? venue[last].v / avg : null;
}

/** A condition's current value: % for change / funding / OI, a multiple for volume, the price for price. */
export function conditionValue(c: Condition, coin: CoinState, now: number): number | null {
  switch (c.metric) {
    case 'price': return coin.price > 0 ? coin.price : null;
    case 'funding': return coin.funding === null ? null : coin.funding * 100;
    case 'change': {
      if (!coin.k1m?.length) return null;
      const ref = priceAt(coin.k1m, now - WINDOW_MS[c.window]);
      return ref && ref > 0 ? (coin.price / ref - 1) * 100 : null;
    }
    case 'volSpike': return volumeSpike(c.window === '5m' ? coin.k5m : coin.k1m);
    case 'oiChange': {
      const oi = coin.oi5;
      if (!oi?.length) return null;
      const last = oi[oi.length - 1];
      const from = last.t - WINDOW_MS[c.window];
      let ref: OiPoint | null = null;
      for (let i = oi.length - 1; i >= 0; i--) if (oi[i].t <= from) { ref = oi[i]; break; }
      return ref && ref.oi > 0 ? (last.oi / ref.oi - 1) * 100 : null;
    }
  }
}

export function conditionHolds(c: Condition, value: number | null): boolean {
  if (value === null || !Number.isFinite(value)) return false;
  if (c.op === '>') return value >= c.value;
  if (c.op === '<') return value <= c.value;
  return Math.abs(value) >= Math.abs(c.value);
}

/** Every condition holds now (AND); values are returned for the notification text. */
export function complexState(conds: readonly Condition[], coin: CoinState, now: number): { holds: boolean; values: Array<number | null> } {
  const values = conds.map((c) => conditionValue(c, coin, now));
  return { holds: conds.length > 0 && conds.every((c, i) => conditionHolds(c, values[i])), values };
}

/**
 * Complex alert: one-time fires when the conditions start holding (edge — including the first
 * check after it was saved); infinite fires while they hold, at most every `repeatMinutes`.
 */
export function complexFires(a: Pick<Alert, 'status' | 'mode' | 'lastTriggeredAt' | 'repeatMinutes'>, holds: boolean, heldBefore: boolean, now: number): boolean {
  if (a.status !== 'active' || !holds) return false;
  return a.mode === 'once' ? !heldBefore : cooled(a, now);
}
