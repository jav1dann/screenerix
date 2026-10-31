/**
 * Cross-exchange spread table (Arbitrage screener), as a pure function so it can be tested.
 *
 * Accuracy rules — a spread is only ever computed from genuine, current quotes:
 *  - Coins come from every selected venue that is actually streaming (not the primary venue's
 *    list), and a coin needs listings on at least two of them to be compared at all.
 *  - A quote counts only when it is current: its venue's stream is live, and the price arrived
 *    within `QUOTE_MAX_AGE_MS` and since the last reconnect (the feed zeroes `at` on a drop).
 *  - A quote far from the others' median is a different asset that reuses the ticker, not an
 *    opportunity: it is shown struck through and left out.
 *  - A spread needs at least two valid quotes, from the venues that quoted — nothing is ever
 *    filled in from another venue, the snapshot, or a candle close.
 */
import type { ExchangeId, VenueQuote } from './types';

/** A price older than this (or from before its stream's last reconnect) is not a current quote. */
export const QUOTE_MAX_AGE_MS = 120_000;
/** A quote this far from the median of the venues is treated as a different asset. */
export const OUTLIER = 0.1;
/** Valid quotes a spread needs. */
export const MIN_QUOTES = 2;

/**
 * Why a cell has no usable price:
 * ok        — a current quote, used in the spread
 * outlier   — current, but far from the others (likely a different token): shown, not used
 * stale     — the last price is too old or from before a reconnect: shown greyed, not used
 * none      — the venue is up but has no quote for this coin (not listed / not ticked yet)
 * unavailable — the venue isn't streaming (restricted, down, still loading)
 */
export type CellState = 'ok' | 'outlier' | 'stale' | 'none' | 'unavailable';
export interface ArbCell { quote: VenueQuote | null; state: CellState }

export interface ArbRow {
  symbol: string;
  cells: ArbCell[];
  /** (max − min) / min over the valid quotes; null with fewer than MIN_QUOTES. */
  spread: number | null;
  /** Spread net of taker fees on both legs; null without a spread. */
  net: number | null;
  /** Indexes (into `venues`) of the cheapest / dearest valid quote; −1 without a spread. */
  iMn: number;
  iMx: number;
  /** Funding difference across the venues in the spread; null with fewer than two fundings. */
  fundDelta: number | null;
  /** Valid quotes in this row. */
  valid: number;
}

export interface ArbInput {
  /** Venues compared, in column order. */
  venues: readonly ExchangeId[];
  /** The venue is streaming (not restricted, not failed, done loading). */
  available: (id: ExchangeId) => boolean;
  /** Base symbols the venue lists. */
  listed: (id: ExchangeId) => readonly string[];
  getQuote: (id: ExchangeId, symbol: string) => VenueQuote | null;
  now: number;
  /** Taker fees on both legs, as a fraction (subtracted from the spread). */
  fees: number;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** A quote fit for a spread right now. */
export const isCurrent = (q: VenueQuote | null, now: number): q is VenueQuote =>
  !!q && q.live && q.at > 0 && now - q.at <= QUOTE_MAX_AGE_MS && Number.isFinite(q.price) && q.price > 0;

/** Coins listed on at least two of the available venues (the only ones a spread can exist for). */
export function comparableSymbols(venues: readonly ExchangeId[], available: (id: ExchangeId) => boolean, listed: (id: ExchangeId) => readonly string[]): string[] {
  const count = new Map<string, number>();
  for (const id of venues) {
    if (!available(id)) continue;
    for (const s of new Set(listed(id))) count.set(s, (count.get(s) ?? 0) + 1);
  }
  return [...count].filter(([, n]) => n >= MIN_QUOTES).map(([s]) => s);
}

export function buildArbRows({ venues, available, listed, getQuote, now, fees }: ArbInput): ArbRow[] {
  const up = venues.map((id) => available(id));
  const rows = comparableSymbols(venues, available, listed).map((symbol): ArbRow => {
    const quotes = venues.map((id, j) => (up[j] ? getQuote(id, symbol) : null));
    const current = quotes.flatMap((q, j) => (isCurrent(q, now) ? [{ j, p: q.price, funding: q.funding }] : []));
    const mid = current.length ? median(current.map((x) => x.p)) : 0;
    const valid = current.length >= MIN_QUOTES ? current.filter((x) => Math.abs(x.p / mid - 1) <= OUTLIER) : current;
    const validSet = new Set(valid.map((x) => x.j));
    const cells = quotes.map((q, j): ArbCell => {
      if (!up[j]) return { quote: null, state: 'unavailable' };
      if (!q) return { quote: null, state: 'none' };
      if (!isCurrent(q, now)) return { quote: q, state: 'stale' };
      return { quote: q, state: validSet.has(j) ? 'ok' : 'outlier' };
    });
    let iMn = -1, iMx = -1, spread: number | null = null;
    if (valid.length >= MIN_QUOTES) {
      const mn = valid.reduce((m, x) => (x.p < m.p ? x : m));
      const mx = valid.reduce((m, x) => (x.p > m.p ? x : m));
      iMn = mn.j; iMx = mx.j;
      spread = (mx.p - mn.p) / mn.p;
    }
    const fundings = valid.flatMap((x) => (x.funding !== null ? [x.funding] : []));
    return {
      symbol, cells, spread, iMn, iMx,
      net: spread === null ? null : spread - fees,
      fundDelta: spread !== null && fundings.length >= 2 ? Math.max(...fundings) - Math.min(...fundings) : null,
      valid: valid.length,
    };
  });
  // Widest spreads first; coins without one (too few current quotes) after, alphabetically.
  return rows.sort((a, b) => (b.spread ?? -1) - (a.spread ?? -1) || a.symbol.localeCompare(b.symbol));
}
