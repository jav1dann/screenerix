'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { DensityMarket } from '@/lib/densities/types';
import type { ExchangeId } from '@/lib/market/exchanges';
import { densitySource, EMPTY_DENSITIES } from '@/lib/scan/client';
import type { DensityFeed } from '@/lib/scan/client';
import type { NestStep } from '@/lib/scan/types';
import { coloringPresetStore, densityColoring, densityFilters, densityPrefs, filterPresetStore } from '@/lib/densities/settings';
import type { ColoringPreset, DensityColoring, DensityFilters, DensityPrefs, FilterPreset } from '@/lib/densities/settings';

export function useDensityPrefs(): [DensityPrefs, (patch: Partial<DensityPrefs>) => void] {
  return [useSyncExternalStore(densityPrefs.subscribe, densityPrefs.getSnapshot, densityPrefs.getServerSnapshot), densityPrefs.update];
}

export function useDensityFilters(): DensityFilters {
  return useSyncExternalStore(densityFilters.subscribe, densityFilters.getSnapshot, densityFilters.getServerSnapshot);
}

export function useDensityColoring(): DensityColoring {
  return useSyncExternalStore(densityColoring.subscribe, densityColoring.getSnapshot, densityColoring.getServerSnapshot);
}

export function useFilterPresets(): readonly FilterPreset[] {
  return useSyncExternalStore(filterPresetStore.subscribe, filterPresetStore.getSnapshot, filterPresetStore.getServerSnapshot);
}

export function useColoringPresets(): readonly ColoringPreset[] {
  return useSyncExternalStore(coloringPresetStore.subscribe, coloringPresetStore.getSnapshot, coloringPresetStore.getServerSnapshot);
}

const noSubscribe = () => () => {};
const emptyFeed = () => EMPTY_DENSITIES;

/**
 * Density cards of venue × market pairs from the server's background scanner:
 * the cached state at once, then patches as books change.
 */
export function useServerDensities(pairs: ReadonlyArray<{ venue: ExchangeId; market: DensityMarket }>, step: NestStep, min: number, dist: number): DensityFeed {
  const id = pairs.map((p) => `${p.venue}:${p.market}`).sort().join(',');
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `id` is the content of `pairs`
  const src = useMemo(() => (pairs.length ? densitySource(pairs, step, min, dist) : null), [id, step, min, dist]);
  return useSyncExternalStore(src?.subscribe ?? noSubscribe, src?.getSnapshot ?? emptyFeed, emptyFeed);
}

/** A clock for live lifetimes, ticking every `ms`. */
export function useNow(ms = 1_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
