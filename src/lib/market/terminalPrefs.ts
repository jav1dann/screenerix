/** Terminal session state (market type, venue, sort, card timeframe, grid layout), persisted per browser. */
import { createValueStore } from '@/lib/alerts/localStore';
import type { MarketType } from '@/lib/alerts/alertStore';
import { ADAPTERS, isExchangeId } from './exchanges';
import type { ExchangeId, Timeframe } from './exchanges/types';

export const RANGE_WINDOWS = ['5m', '15m', '30m', '1h', '2h', '4h'] as const;
export type RangeWindow = (typeof RANGE_WINDOWS)[number];
export const isRangeWindow = (v: unknown): v is RangeWindow => (RANGE_WINDOWS as readonly unknown[]).includes(v);

/** Window length in 1m candles. */
export const RANGE_MINUTES: Record<RangeWindow, number> = { '5m': 5, '15m': 15, '30m': 30, '1h': 60, '2h': 120, '4h': 240 };

/** Timeframes offered for the Market Map chart cards. */
export const CARD_TIMEFRAMES: readonly Timeframe[] = ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '1d'];

export const GRID_LAYOUTS = [
  { count: 3, cols: 3, rows: 1 },
  { count: 4, cols: 2, rows: 2 },
  { count: 6, cols: 3, rows: 2 },
  { count: 9, cols: 3, rows: 3 },
  { count: 12, cols: 4, rows: 3 },
  { count: 16, cols: 4, rows: 4 },
  { count: 25, cols: 5, rows: 5 },
  { count: 50, cols: 5, rows: 10 },
] as const;
export type GridLayout = (typeof GRID_LAYOUTS)[number];
export type GridCount = GridLayout['count'];

export const gridLayout = (count: GridCount): GridLayout => GRID_LAYOUTS.find((g) => g.count === count) ?? GRID_LAYOUTS[3];
export const gridLabel = (g: GridLayout): string => `${g.count} (${g.cols}x${g.rows})`;

/** Market Map sort families (windows and metric keys live in `@/lib/settings/settings`). */
export type SortMode = 'range' | 'oiRange' | 'avgTrades' | 'tradesSpike' | 'avgVolume' | 'volume' | 'natr';
export interface SortPref { mode: SortMode; window: string }
/** A stored 'funding' sort (removed — funding is shown on every card) falls back to the default. */
const SORT_MODE_IDS: readonly SortMode[] = ['range', 'oiRange', 'avgTrades', 'tradesSpike', 'avgVolume', 'volume', 'natr'];

export interface TerminalPrefs {
  market: MarketType;
  /** Primary venue per market type (switching Futures ↔ Spot restores the previous choice). */
  venue: Record<MarketType, ExchangeId>;
  /** Market Map ranking. */
  sort: SortPref;
  /** Timeframe of the Market Map chart cards. */
  tf: Timeframe;
  /** Number of chart cards on the Market Map. */
  grid: GridCount;
}

const DEFAULTS: TerminalPrefs = { market: 'futures', venue: { futures: 'binance', spot: 'coinbase' }, sort: { mode: 'range', window: '5m' }, tf: '1m', grid: 9 };

/** A stored venue that still trades `market`. */
const venueFor = (v: unknown, market: MarketType): ExchangeId | null =>
  typeof v === 'string' && isExchangeId(v) && (ADAPTERS[v].market === 'perp') === (market === 'futures') ? v : null;

function sanitize(raw: unknown): TerminalPrefs {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const venue = (typeof r.venue === 'object' && r.venue !== null ? r.venue : {}) as Record<string, unknown>;
  const sort = (typeof r.sort === 'object' && r.sort !== null ? r.sort : {}) as Record<string, unknown>;
  // v1 stored only a Range window (`range`); it becomes a Range sort.
  const legacyRange = isRangeWindow(r.range) ? r.range : null;
  return {
    market: r.market === 'spot' ? 'spot' : 'futures',
    venue: {
      futures: venueFor(venue.futures, 'futures') ?? DEFAULTS.venue.futures,
      spot: venueFor(venue.spot, 'spot') ?? DEFAULTS.venue.spot,
    },
    // The window is validated against its mode by the settings layer (`allowedSort`).
    sort: SORT_MODE_IDS.includes(sort.mode as SortMode) && typeof sort.window === 'string'
      ? { mode: sort.mode as SortMode, window: sort.window }
      : legacyRange ? { mode: 'range', window: legacyRange } : DEFAULTS.sort,
    tf: (CARD_TIMEFRAMES as readonly unknown[]).includes(r.tf) ? (r.tf as Timeframe) : DEFAULTS.tf,
    grid: GRID_LAYOUTS.some((g) => g.count === r.grid) ? (r.grid as GridCount) : DEFAULTS.grid,
  };
}

export const terminalPrefs = createValueStore<TerminalPrefs>('screenerix.terminalPrefs.v1', DEFAULTS, sanitize);
