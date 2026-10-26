'use client';

import { useEffect, useEffectEvent, useMemo, useState, useSyncExternalStore } from 'react';
import type { ExchangeId } from '@/lib/market/exchanges';
import { EMPTY_TABLE, metricSource } from '@/lib/scan/client';
import type { MetricTable } from '@/lib/scan/client';
import { filterStore } from '@/lib/screener/filters';
import type { ScreenerFilter } from '@/lib/screener/filters';
import { assignSlots, SWAP_MARGIN } from '@/lib/screener/slots';
import type { Ranked } from '@/lib/screener/slots';

/** Every saved filter. */
export function useFilters(): readonly ScreenerFilter[] {
  return useSyncExternalStore(filterStore.subscribe, filterStore.getSnapshot, filterStore.getServerSnapshot);
}

const noSubscribe = () => () => {};
const emptyTable = () => EMPTY_TABLE;

/**
 * A venue's live metric table from the server's background scanner (null venue = idle):
 * the cached state at once, then patches as values change.
 */
export function useMetricTable(venue: ExchangeId | null, keys: readonly string[]): MetricTable {
  const keyId = keys.join(',');
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `keyId` is the content of `keys`
  const src = useMemo(() => (venue && keys.length ? metricSource(venue, keys) : null), [venue, keyId]);
  return useSyncExternalStore(src?.subscribe ?? noSubscribe, src?.getSnapshot ?? emptyTable, emptyTable);
}

const SWAP_MS = 5_000;
const FILL_MS = 1_000;

/**
 * Card slots for a live ranking: positions stay put, the weakest cards are swapped
 * out every 5s for coins that beat them by more than 2%, while vacancies — coins
 * that stopped ranking, empty slots, unscored warm-up placeholders — fill within ~1s.
 * A new `resetKey` (filter, range, venue, grid) rebuilds from the strict order.
 * `held` cards (in use) are never swapped out or vacated.
 */
export function useStableSlots(ranked: readonly Ranked[], n: number, dir: 'desc' | 'asc', resetKey: string, held?: ReadonlySet<string>): string[] {
  const [state, setState] = useState<{ key: string; slots: string[] }>(() => ({ key: resetKey, slots: assignSlots([], ranked, n, dir) }));
  // Reset synchronously during render (React's "adjust state on prop change" pattern), so no stale frame shows.
  let current = state;
  if (state.key !== resetKey) {
    current = { key: resetKey, slots: assignSlots([], ranked, n, dir) };
    setState(current);
  }

  const tick = useEffectEvent((swaps: boolean) => {
    setState((s) => {
      if (s.key !== resetKey) return s;
      const slots = assignSlots(s.slots, ranked, n, dir, SWAP_MARGIN, swaps, held);
      return slots.length === s.slots.length && slots.every((x, i) => x === s.slots[i]) ? s : { key: s.key, slots };
    });
  });
  useEffect(() => {
    const fill = setInterval(() => tick(false), FILL_MS);
    const swap = setInterval(() => tick(true), SWAP_MS);
    return () => { clearInterval(fill); clearInterval(swap); };
  }, []);

  return current.slots;
}
