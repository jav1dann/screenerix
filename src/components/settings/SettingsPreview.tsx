'use client';

/**
 * Live preview for the chart-related Settings tabs: a real Market Map card (BTC on the
 * session's venue, timeframe and sort), read-only. It reads the same settings store as
 * every card, so each edit shows here the moment it's made.
 */
import { useMemo } from 'react';
import Chart from '@/components/chart/Chart';
import { useMetricTable } from '@/hooks/useScreener';
import { useSettings, useTerminalPrefs } from '@/hooks/useTerminal';
import { ADAPTERS } from '@/lib/market/exchanges';
import { METRIC_BY_KEY } from '@/lib/screener/metrics';
import { allowedSort, MARKET_LABEL, pick, sortMetric, venuesFor } from '@/lib/settings/settings';
import { selectSettingsTab } from '@/lib/settings/settingsUi';

const SYMBOL = 'BTC';

export default function SettingsPreview() {
  const settings = useSettings();
  const [prefs] = useTerminalPrefs();
  // The same narrowing as the terminal, so the preview matches what the Map shows.
  const market = pick(prefs.market, settings.exchanges.markets);
  const venue = pick(prefs.venue[market], venuesFor(settings, market));
  const sort = allowedSort(prefs.sort, settings.sorting.modes);
  const tf = pick(prefs.tf, settings.timeframe.enabled);

  const sortKey = sortMetric(sort);
  const keys = useMemo(
    () => [...new Set([sortKey, ...settings.indicators.items.filter((k) => METRIC_BY_KEY.has(k))])].sort(),
    [sortKey, settings.indicators.items],
  );
  const table = useMetricTable(venue, keys);
  const metrics = table.rows.find((r) => r.s === SYMBOL)?.m;

  return (
    <div data-settings-preview className="-mx-5 -my-2 flex flex-col gap-1.5 bg-[#111215] px-5 py-2 md:sticky md:-top-5 md:-mt-5 md:pt-5 md:z-10 md:shadow-[0_10px_16px_-10px_rgba(0,0,0,0.7)]">
      <span className="flex items-center gap-1.5 text-[11px] text-[#6B6E78]">
        <span className="h-1.5 w-1.5 rounded-full bg-sx-up" aria-hidden="true" />
        Live preview · {SYMBOL} · {ADAPTERS[venue].name} {MARKET_LABEL[market]} · {tf}
      </span>
      <div className="h-[220px] md:h-[280px]">
      <Chart
        key={`${venue}:${SYMBOL}`}
        symbol={SYMBOL}
        exchange={venue}
        interval={tf}
        sort={sort}
        metrics={metrics}
        height="100%"
        onSettingsClick={() => selectSettingsTab('indicators')}
        preview
      />
      </div>
    </div>
  );
}
