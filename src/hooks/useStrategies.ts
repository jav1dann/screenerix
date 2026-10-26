'use client';

import { useMemo, useSyncExternalStore } from 'react';
import type { ExchangeId } from '@/lib/market/exchanges';
import { EMPTY_STRATEGIES, strategySource } from '@/lib/scan/client';
import type { StrategyFeed } from '@/lib/scan/client';
import { DEFAULT_STATE, strategiesStore } from '@/lib/strategies/store';
import type { StrategiesState } from '@/lib/strategies/store';

const noSubscribe = () => () => {};
const emptyFeed = () => EMPTY_STRATEGIES;
const defaultState = () => DEFAULT_STATE;

/** The user's strategy workspaces + dashboard view state. */
export function useStrategies(): StrategiesState {
  return useSyncExternalStore(strategiesStore.subscribe, strategiesStore.getSnapshot, defaultState);
}

/** Live formations of the given venues (from the server's strategy engine). */
export function useStrategyFeed(venues: readonly ExchangeId[]): StrategyFeed {
  const id = [...new Set(venues)].sort().join(',');
  // Keyed by `id` (the content of `venues`), so a fresh array doesn't resubscribe.
  const src = useMemo(() => (id ? strategySource(id.split(',') as ExchangeId[]) : null), [id]);
  return useSyncExternalStore(src?.subscribe ?? noSubscribe, src?.getSnapshot ?? emptyFeed, emptyFeed);
}
