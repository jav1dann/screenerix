import { BOOK_DEPTH } from './constants';
import type { BookLevel, OrderBook } from './types';

/** Level is a wall when its notional is ≥ this multiple of the visible median. */
export const WALL_MULTIPLE = 4;

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Build a display book from [price, base size] levels.
 * `bids` must be sorted best (highest) first, `asks` best (lowest) first.
 */
export function deriveBook(bids: Array<[number, number]>, asks: Array<[number, number]>, depth = BOOK_DEPTH): OrderBook | null {
  const b = bids.slice(0, depth);
  const a = asks.slice(0, depth);
  if (!b.length || !a.length) return null;
  const notional = ([p, s]: [number, number]) => p * s;
  const med = median([...b, ...a].map(notional));
  const toLevel = (l: [number, number]): BookLevel => {
    const n = notional(l);
    return { price: l[0], notional: n, wall: med > 0 && n >= med * WALL_MULTIPLE };
  };
  const mid = (b[0][0] + a[0][0]) / 2;
  return {
    bids: b.map(toLevel),
    asks: a.map(toLevel),
    mid,
    spread: a[0][0] - b[0][0],
    range: (a[a.length - 1][0] - b[b.length - 1][0]) / 2 / mid,
  };
}

/** Largest wall on each side of a book, if any. */
export function topWalls(book: OrderBook): Array<{ side: 'Bid' | 'Ask'; level: BookLevel; dist: number }> {
  const out: Array<{ side: 'Bid' | 'Ask'; level: BookLevel; dist: number }> = [];
  const pick = (ls: BookLevel[]) => ls.reduce((m, l) => (l.notional > m.notional ? l : m), ls[0]);
  const tb = pick(book.bids);
  const ta = pick(book.asks);
  if (tb?.wall) out.push({ side: 'Bid', level: tb, dist: tb.price / book.mid - 1 });
  if (ta?.wall) out.push({ side: 'Ask', level: ta, dist: ta.price / book.mid - 1 });
  return out;
}
