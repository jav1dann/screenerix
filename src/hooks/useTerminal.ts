'use client';

import { useMemo, useSyncExternalStore } from 'react';
import { chartPrefs } from '@/lib/drawings/chartPrefs';
import type { ChartPrefs } from '@/lib/drawings/chartPrefs';
import { drawingStore } from '@/lib/drawings/drawingStore';
import type { Drawing } from '@/lib/drawings/types';
import type { ExchangeId } from '@/lib/market/exchanges';
import { terminalPrefs } from '@/lib/market/terminalPrefs';
import type { TerminalPrefs } from '@/lib/market/terminalPrefs';
import type { ListStore } from '@/lib/alerts/localStore';
import { DEFAULT_STATE as DEFAULT_INDICATORS, indicatorStore } from '@/lib/indicators/store';
import type { ActiveIndicator, IndicatorScope } from '@/lib/indicators/store';
import { indicatorUi } from '@/lib/indicators/ui';
import type { IndicatorUi } from '@/lib/indicators/ui';
import { colorRuleStore } from '@/lib/screener/colorRules';
import type { ColorRules } from '@/lib/screener/colorRules';
import { settingsStore } from '@/lib/settings/settings';
import type { Settings } from '@/lib/settings/settings';
import { settingsUi } from '@/lib/settings/settingsUi';
import type { SettingsUi } from '@/lib/settings/settingsUi';

/** Persisted expanded-chart preferences. */
export function useChartPrefs(): [ChartPrefs, (patch: Partial<ChartPrefs>) => void] {
  const prefs = useSyncExternalStore(chartPrefs.subscribe, chartPrefs.getSnapshot, chartPrefs.getServerSnapshot);
  return [prefs, chartPrefs.update];
}

/** Saved drawings for one venue + symbol. */
export function useDrawings(exchange: ExchangeId, symbol: string): readonly Drawing[] {
  const all = useSyncExternalStore(drawingStore.subscribe, drawingStore.getSnapshot, drawingStore.getServerSnapshot);
  return useMemo(() => all.filter((d) => d.exchange === exchange && d.symbol === symbol), [all, exchange, symbol]);
}

/** Persisted terminal session state (Futures / Spot, venue, sort, timeframe, grid). */
export function useTerminalPrefs(): [TerminalPrefs, (patch: Partial<TerminalPrefs>) => void] {
  const prefs = useSyncExternalStore(terminalPrefs.subscribe, terminalPrefs.getSnapshot, terminalPrefs.getServerSnapshot);
  return [prefs, terminalPrefs.update];
}

/** The central settings (Settings modal). */
export function useSettings(): Settings {
  return useSyncExternalStore(settingsStore.subscribe, settingsStore.getSnapshot, settingsStore.getServerSnapshot);
}

/** Settings modal open state + tab. */
export function useSettingsUi(): SettingsUi {
  return useSyncExternalStore(settingsUi.subscribe, settingsUi.getSnapshot, settingsUi.getServerSnapshot);
}

/** Active indicators of a chart-window type. */
export function useIndicators(scope: IndicatorScope): readonly ActiveIndicator[] {
  return useSyncExternalStore(indicatorStore.subscribe, () => indicatorStore.getSnapshot()[scope], () => DEFAULT_INDICATORS[scope]);
}

/** Indicator modal state. */
export function useIndicatorUi(): IndicatorUi {
  return useSyncExternalStore(indicatorUi.subscribe, indicatorUi.getSnapshot, indicatorUi.getServerSnapshot);
}

/** Custom metric color rules (Market Review list + chart-card headers). */
export function useColorRules(): ColorRules {
  return useSyncExternalStore(colorRuleStore.subscribe, colorRuleStore.getSnapshot, colorRuleStore.getServerSnapshot);
}

/** Watchlisted / excepted base symbols. */
export function useSymbolList(store: ListStore<string>): readonly string[] {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
}
