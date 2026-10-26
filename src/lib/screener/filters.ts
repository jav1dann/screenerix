/**
 * Saved screener filters (persisted per browser). At most one filter is enabled
 * at a time; the enabled one drives the Market Map.
 */
import type { MarketType } from '@/lib/alerts/alertStore';
import { createListStore } from '@/lib/alerts/localStore';
import { isExchangeId } from '@/lib/market/exchanges';
import type { ExchangeId } from '@/lib/market/exchanges';
import { fmtMetric, METRIC_BY_KEY } from './metrics';

export type Direction = 'any' | 'up' | 'down';

export interface Condition {
  metric: string;
  min?: number;
  max?: number;
  /** Directional metrics only: which way the move must go. */
  direction?: Direction;
}

export interface ScreenerFilter {
  id: string;
  name: string;
  exchange: ExchangeId;
  market: MarketType;
  sort: { metric: string; dir: 'desc' | 'asc' };
  /** The "Mode" switch. */
  enabled: boolean;
  /** Base symbols never shown, e.g. ["BTC", "ETH"]. */
  ignore: string[];
  conditions: Condition[];
  createdAt: number;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function isCondition(v: unknown): v is Condition {
  if (typeof v !== 'object' || v === null) return false;
  const c = v as Record<string, unknown>;
  return typeof c.metric === 'string' && METRIC_BY_KEY.has(c.metric)
    && (c.min === undefined || finite(c.min)) && (c.max === undefined || finite(c.max))
    && (c.direction === undefined || c.direction === 'any' || c.direction === 'up' || c.direction === 'down');
}

export function isFilter(v: unknown): v is ScreenerFilter {
  if (typeof v !== 'object' || v === null) return false;
  const f = v as Record<string, unknown>;
  const sort = f.sort as Record<string, unknown> | undefined;
  return typeof f.id === 'string' && typeof f.name === 'string'
    && typeof f.exchange === 'string' && isExchangeId(f.exchange)
    && (f.market === 'futures' || f.market === 'spot')
    && typeof sort === 'object' && sort !== null && typeof sort.metric === 'string' && METRIC_BY_KEY.has(sort.metric) && (sort.dir === 'desc' || sort.dir === 'asc')
    && typeof f.enabled === 'boolean'
    && Array.isArray(f.ignore) && f.ignore.every((s) => typeof s === 'string')
    && Array.isArray(f.conditions) && f.conditions.every(isCondition)
    && finite(f.createdAt);
}

export const filterStore = createListStore<ScreenerFilter>('screenerix.filters.v1', isFilter);

export function saveFilter(filter: ScreenerFilter): void {
  const all = filterStore.getSnapshot();
  const exists = all.some((f) => f.id === filter.id);
  const next = exists ? all.map((f) => (f.id === filter.id ? filter : f)) : [...all, filter];
  // Saving an enabled filter makes it the only enabled one.
  filterStore.set(filter.enabled ? next.map((f) => (f.id === filter.id ? f : { ...f, enabled: false })) : next);
}

/** Toggle a filter's Mode; enabling one disables the others. */
export function setFilterEnabled(id: string, enabled: boolean): void {
  filterStore.set(filterStore.getSnapshot().map((f) => (f.id === id ? { ...f, enabled } : enabled ? { ...f, enabled: false } : f)));
}

export function deleteFilter(id: string): void {
  filterStore.set(filterStore.getSnapshot().filter((f) => f.id !== id));
}

export const newFilterId = (): string => `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** One-line summary, e.g. "Range 5m ≥ 2% ↑ · Volume 1h ≥ $5M · ignores 2". */
export function describeFilter(f: ScreenerFilter): string {
  const parts = f.conditions.map((c) => {
    const def = METRIC_BY_KEY.get(c.metric);
    if (!def) return '';
    const fmt = (v: number) => fmtMetric(def.unit, v);
    const bound = c.min !== undefined && c.max !== undefined ? `${fmt(c.min)}–${fmt(c.max)}`
      : c.min !== undefined ? `≥ ${fmt(c.min)}`
      : c.max !== undefined ? `≤ ${fmt(c.max)}` : 'any';
    const dir = c.direction === 'up' ? ' ↑' : c.direction === 'down' ? ' ↓' : '';
    return `${def.name} ${bound}${dir}`;
  }).filter(Boolean);
  if (f.ignore.length) parts.push(`ignores ${f.ignore.length}`);
  return parts.length ? parts.join(' · ') : 'No conditions — every coin';
}

export const sortLabel = (f: ScreenerFilter): string => `${METRIC_BY_KEY.get(f.sort.metric)?.name ?? f.sort.metric} ${f.sort.dir === 'desc' ? '↓' : '↑'}`;
