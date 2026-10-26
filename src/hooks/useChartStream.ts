'use client';

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { getChartStream } from '@/lib/market/chartStream';
import type { ChartSnapshot, ChartStream } from '@/lib/market/chartStream';
import type { ChartTimeframe, ExchangeId } from '@/lib/market/exchanges';

/** Hold the shared live stream for a chart and re-render on (throttled) stat changes. */
export function useChartStream(exchange: ExchangeId, symbol: string, tf: ChartTimeframe): { stream: ChartStream; snapshot: ChartSnapshot } {
  const stream = useMemo(() => getChartStream({ exchange, symbol, tf }), [exchange, symbol, tf]);
  useEffect(() => stream.retain(), [stream]);
  const snapshot = useSyncExternalStore(stream.subscribe, stream.getSnapshot, stream.getSnapshot);
  return { stream, snapshot };
}
