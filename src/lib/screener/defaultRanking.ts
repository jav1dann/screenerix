/**
 * Market Map ranking when no filter is enabled: liquid coins, best first by the
 * header's sort (e.g. 5m Range, 1h Volume). Runs through `rankRows` like a filter.
 */
import type { MarketType } from '@/lib/alerts/alertStore';
import type { ExchangeId } from '@/lib/market/exchanges';
import type { RangeWindow } from '@/lib/market/terminalPrefs';
import type { ScreenerFilter } from './filters';

/** Minimum 24h turnover (quote currency) for the default ranking. */
export const LIQUID_MIN = 5_000_000;

/** Liquid coins sorted by `metric` (highest first unless `dir` is 'asc'). `id` / `name` identify the sort, e.g. "range:5m" / "5m Range". */
export function sortRanking(id: string, name: string, metric: string, exchange: ExchangeId, market: MarketType, ignore: readonly string[] = [], dir: 'asc' | 'desc' = 'desc'): ScreenerFilter {
  return {
    id,
    name,
    exchange,
    market,
    sort: { metric, dir },
    enabled: true,
    ignore: [...ignore],
    conditions: [{ metric: 'turnover', min: LIQUID_MIN }],
    createdAt: 0,
  };
}

export function rangeRanking(range: RangeWindow, exchange: ExchangeId, market: MarketType): ScreenerFilter {
  return sortRanking(`range:${range}`, `${range} Range`, `range_${range}`, exchange, market);
}
