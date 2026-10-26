/**
 * Expanded-chart preferences, persisted so the terminal reopens the way it was left.
 * Grid and watermark live in the central settings (`settings.chart`), shared with the cards;
 * indicators in `@/lib/indicators/store` (the Indicator modal).
 */
import { createValueStore } from '@/lib/alerts/localStore';
import { TIMEFRAME_MS } from '@/lib/market/exchanges';
import type { ChartTimeframe } from '@/lib/market/exchanges';

/** Cursor tools of the expanded chart. */
export type ChartCursor = 'cross' | 'dot' | 'pointer';
export const CHART_CURSORS: readonly ChartCursor[] = ['cross', 'dot', 'pointer'];

export interface ChartPrefs {
  tf: ChartTimeframe;
  /** Snap the crosshair and drawing points to candle high / low / open / close (Ctrl does it temporarily). */
  magnet: boolean;
  locked: boolean;
  hidden: boolean;
  logScale: boolean;
  /** The cursor tool the chart returns to after drawing / Esc. */
  cursor: ChartCursor;
  /** Chart cards: stats banner folded away (applies to every card). */
  cardHeaderCollapsed: boolean;
  /** Expanded terminal: OHLCV / 24h stats line folded away. */
  expandedStatsCollapsed: boolean;
}

export const DEFAULT_PREFS: ChartPrefs = {
  tf: '1m',
  magnet: false,
  locked: false,
  hidden: false,
  logScale: false,
  cursor: 'cross',
  cardHeaderCollapsed: false,
  expandedStatsCollapsed: false,
};

const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);

function sanitize(raw: unknown): ChartPrefs {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_PREFS;
  const r = raw as Partial<Record<keyof ChartPrefs, unknown>>;
  return {
    tf: typeof r.tf === 'string' && r.tf in TIMEFRAME_MS ? (r.tf as ChartTimeframe) : DEFAULT_PREFS.tf,
    magnet: bool(r.magnet, DEFAULT_PREFS.magnet),
    locked: bool(r.locked, DEFAULT_PREFS.locked),
    hidden: bool(r.hidden, DEFAULT_PREFS.hidden),
    logScale: bool(r.logScale, DEFAULT_PREFS.logScale),
    cursor: CHART_CURSORS.includes(r.cursor as ChartCursor) ? (r.cursor as ChartCursor) : DEFAULT_PREFS.cursor,
    cardHeaderCollapsed: bool(r.cardHeaderCollapsed, DEFAULT_PREFS.cardHeaderCollapsed),
    expandedStatsCollapsed: bool(r.expandedStatsCollapsed, DEFAULT_PREFS.expandedStatsCollapsed),
  };
}

export const chartPrefs = createValueStore<ChartPrefs>('screenerix.chartPrefs.v1', DEFAULT_PREFS, sanitize);
