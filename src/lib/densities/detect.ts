/**
 * Density detection — pure functions shared by the scanner and the UI.
 *
 * A density is a large resting limit order (or, with nesting, a cluster of
 * neighbouring levels) within `maxDistance` of the price. Densities are
 * tracked across snapshots so each keeps the time it was first seen.
 */
import type { DensityColoring, DensityFilters, DensitySort } from './settings';
import type { DensityMarket, DepthBook, DepthLevel } from './types';
import type { ExchangeId } from '@/lib/market/exchanges';

export type DensitySideId = 'bid' | 'ask';

export interface Density {
  side: DensitySideId;
  /** Level price (notional-weighted when nested). */
  price: number;
  /** Size in quote currency. */
  notional: number;
  /** |price / mid − 1| (fraction). */
  distance: number;
}

export interface TrackedDensity extends Density {
  id: string;
  /** When this density was first seen (ms). */
  firstSeen: number;
}

export interface DensityCard {
  /** `venue:market:symbol`. */
  key: string;
  venue: ExchangeId;
  market: DensityMarket;
  symbol: string;
  last: number;
  change24h: number | null;
  volume24h: number;
  densities: TrackedDensity[];
  updatedAt: number;
  /** Near levels follow the live WebSocket book. */
  live: boolean;
}

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export const minSizeFor = (symbol: string, f: DensityFilters): number => f.individual.find((x) => x.symbol === symbol)?.minSize ?? f.minSize;

/**
 * Bucket a book (one bucket per level, or per `stepPct` % of price when > 0) within
 * `maxDistance` % of the mid, and keep buckets ≥ `floor`. Also returns each side's
 * median bucket notional (for the "× median" rule). Densities come largest first.
 */
export function scanBook(book: DepthBook, opts: { stepPct: number; maxDistance: number; floor: number; side?: DensityFilters['side'] }): { densities: Density[]; medians: { bid: number; ask: number } } {
  const medians = { bid: 0, ask: 0 };
  const bestBid = book.bids[0]?.[0];
  const bestAsk = book.asks[0]?.[0];
  if (!bestBid || !bestAsk) return { densities: [], medians };
  const mid = (bestBid + bestAsk) / 2;
  const maxDist = opts.maxDistance / 100;
  const step = opts.stepPct > 0 ? (mid * opts.stepPct) / 100 : 0;
  const out: Density[] = [];
  const sides: Array<[DensitySideId, DepthLevel[]]> = [];
  if (opts.side !== 'asks') sides.push(['bid', book.bids]);
  if (opts.side !== 'bids') sides.push(['ask', book.asks]);
  for (const [side, levels] of sides) {
    const buckets = new Map<number, { notional: number; weighted: number }>();
    levels.forEach(([price, qty], i) => {
      if (Math.abs(price / mid - 1) > maxDist) return;
      const key = step > 0 ? Math.floor(price / step) : i;
      const b = buckets.get(key) ?? { notional: 0, weighted: 0 };
      const n = price * qty;
      b.notional += n;
      b.weighted += price * n;
      buckets.set(key, b);
    });
    const all = [...buckets.values()];
    medians[side] = median(all.map((b) => b.notional));
    for (const b of all) {
      if (b.notional < opts.floor) continue;
      const price = b.weighted / b.notional;
      out.push({ side, price, notional: b.notional, distance: Math.abs(price / mid - 1) });
    }
  }
  return { densities: out.sort((a, b) => b.notional - a.notional), medians };
}

/** Densities of one book under the user's filters, largest first. */
export function detectDensities(book: DepthBook, symbol: string, f: DensityFilters): Density[] {
  const { densities, medians } = scanBook(book, {
    stepPct: f.nesting.enabled ? f.nesting.stepPct : 0, maxDistance: f.maxDistance, floor: minSizeFor(symbol, f), side: f.side,
  });
  return f.multiple > 0 ? densities.filter((d) => d.notional >= f.multiple * medians[d.side]) : densities;
}

/** A server card's densities under the user's filters (size, distance, side, × median), largest first. */
export function filterDensities(ds: readonly TrackedDensity[], medians: { bid: number; ask: number }, symbol: string, f: DensityFilters): TrackedDensity[] {
  const minSize = minSizeFor(symbol, f);
  const maxDist = f.maxDistance / 100;
  return ds.filter((d) => d.notional >= minSize && d.distance <= maxDist
    && (f.side === 'both' || (f.side === 'bids') === (d.side === 'bid'))
    && (f.multiple <= 0 || d.notional >= f.multiple * medians[d.side]));
}

let seq = 0;
/**
 * Carry ids and first-seen times over from the previous snapshot: a density
 * matches the nearest previous one on the same side within `tolerance`
 * (fraction of price). New ones start at `now`.
 */
export function trackLifetimes(prev: readonly TrackedDensity[], next: readonly Density[], now: number, tolerance: number): TrackedDensity[] {
  const free = [...prev];
  return next.map((d) => {
    let best = -1;
    let bestGap = Infinity;
    free.forEach((p, i) => {
      if (p.side !== d.side) return;
      const gap = Math.abs(p.price / d.price - 1);
      if (gap <= tolerance && gap < bestGap) { best = i; bestGap = gap; }
    });
    if (best < 0) return { ...d, id: `d${++seq}`, firstSeen: now };
    const [p] = free.splice(best, 1);
    return { ...d, id: p.id, firstSeen: p.firstSeen };
  });
}

/** Matching tolerance for lifetimes: a nesting step, but never under 0.05%. */
export const trackTolerance = (f: DensityFilters): number => Math.max(f.nesting.enabled ? f.nesting.stepPct : 0, 0.05) / 100;

export type SizeTier = 'base' | 'size1' | 'size2';
export function sizeTier(notional: number, c: DensityColoring): SizeTier {
  if (notional >= c.size2.min) return 'size2';
  if (notional >= c.size1.min) return 'size1';
  return 'base';
}
export function tierColor(d: Pick<Density, 'side' | 'notional'>, c: DensityColoring): string {
  const t = sizeTier(d.notional, c);
  return t === 'size2' ? c.size2.color : t === 'size1' ? c.size1.color : d.side === 'ask' ? c.asks : c.bids;
}

/** The densities a card shows: lifetime and side filters, largest first, then asks above bids by price. */
export function visibleDensities(card: DensityCard, f: DensityFilters, now: number): TrackedDensity[] {
  const minAge = f.minLifetime * 1000;
  const top = card.densities.filter((d) => now - d.firstSeen >= minAge).slice(0, f.perCard);
  return top.sort((a, b) => b.price - a.price);
}

const cardSize = (ds: readonly TrackedDensity[]) => Math.max(...ds.map((d) => d.notional));
const cardDistance = (ds: readonly TrackedDensity[]) => Math.min(...ds.map((d) => d.distance));
/** Lifetime of a card's oldest density. */
const cardAge = (ds: readonly TrackedDensity[], now: number) => Math.max(...ds.map((d) => now - d.firstSeen));

/** Cards with their visible densities, sorted; cards without any are dropped. */
export function sortCards(cards: readonly DensityCard[], f: DensityFilters, mode: DensitySort, now: number): Array<{ card: DensityCard; densities: TrackedDensity[] }> {
  const rows = cards.map((card) => ({ card, densities: visibleDensities(card, f, now) })).filter((r) => r.densities.length > 0);
  const tie = (a: typeof rows[number], b: typeof rows[number]) => a.card.key.localeCompare(b.card.key);
  const by: Record<DensitySort, (a: typeof rows[number], b: typeof rows[number]) => number> = {
    az: (a, b) => a.card.symbol.localeCompare(b.card.symbol) || tie(a, b),
    distance: (a, b) => cardDistance(a.densities) - cardDistance(b.densities) || tie(a, b),
    size: (a, b) => cardSize(b.densities) - cardSize(a.densities) || tie(a, b),
    timeAsc: (a, b) => cardAge(a.densities, now) - cardAge(b.densities, now) || tie(a, b),
    timeDesc: (a, b) => cardAge(b.densities, now) - cardAge(a.densities, now) || tie(a, b),
  };
  return rows.sort(by[mode]);
}

/**
 * Replace a REST snapshot's levels with the live WebSocket book where the live
 * book reaches (it is shallower but current); deeper REST levels stay.
 */
export function mergeLiveBook(rest: DepthBook, live: { bids: DepthLevel[]; asks: DepthLevel[] } | null): DepthBook {
  if (!live || !live.bids.length || !live.asks.length) return rest;
  const bidFloor = live.bids[live.bids.length - 1][0];
  const askCeil = live.asks[live.asks.length - 1][0];
  return {
    bids: [...live.bids, ...rest.bids.filter((l) => l[0] < bidFloor)],
    asks: [...live.asks, ...rest.asks.filter((l) => l[0] > askCeil)],
    ts: Date.now(),
  };
}

const STABLES = new Set(['USDC', 'FDUSD', 'TUSD', 'DAI', 'USDE', 'USDP', 'BUSD', 'PYUSD', 'USDD', 'EURI', 'EUR', 'AEUR', 'USD1', 'RLUSD', 'USDS', 'BFUSD', 'XUSD', 'USDT', 'USTC', 'GUSD', 'FRAX', 'LUSD', 'EURC']);
export const isStablecoin = (symbol: string): boolean => STABLES.has(symbol);

const LEVERAGED = /^(.+?)(UP|DOWN|BULL|BEAR|[2-5]L|[2-5]S)$/;
/** Leveraged tokens (e.g. BTCUP, ETH3L): the suffix must sit on a coin that is listed itself. */
export function isLeveragedToken(symbol: string, listed: ReadonlySet<string>): boolean {
  const m = LEVERAGED.exec(symbol);
  return Boolean(m && listed.has(m[1]));
}

/** "45s", "4m 12s", "2h 05m". */
export function fmtLifetime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
}

/**
 * Patch a server card with the live WebSocket book: inside the live book's price range
 * its densities are re-detected from the live levels (current to the second); outside it
 * the server's snapshot densities stay. Lifetimes carry over from the server densities
 * and from the previous patch (`prev`), so a live-only density keeps its first-seen time.
 */
export function patchWithLive(
  server: readonly TrackedDensity[],
  prev: readonly TrackedDensity[],
  live: { bids: DepthLevel[]; asks: DepthLevel[] },
  opts: { stepPct: number; maxDistance: number; floor: number },
  now: number,
): TrackedDensity[] {
  if (!live.bids.length || !live.asks.length) return [...server];
  const bidFloor = live.bids[live.bids.length - 1][0];
  const askCeil = live.asks[live.asks.length - 1][0];
  const inside = (d: Density) => (d.side === 'bid' ? d.price >= bidFloor : d.price <= askCeil);
  const fresh = scanBook({ ...live, ts: now }, opts).densities;
  const known = new Map<string, TrackedDensity>();
  for (const d of [...prev, ...server]) if (inside(d)) known.set(d.id, d);
  const tolerance = Math.max(opts.stepPct, 0.05) / 100;
  return [...server.filter((d) => !inside(d)), ...trackLifetimes([...known.values()], fresh, now, tolerance)].sort((a, b) => b.notional - a.notional);
}
