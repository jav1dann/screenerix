'use client';

import { useMemo, useSyncExternalStore } from 'react';
import { alertsClient } from '@/lib/alerts/client';
import type { AlertView } from '@/lib/alerts/client';
import { pinKey, pinStore, setPinned } from '@/lib/alerts/pinStore';
import type { ExchangeId } from '@/lib/market/exchanges';

/** Active price alerts on one venue + symbol (drawn as lines on its charts; checked on the server). */
export function useAlerts(exchange: ExchangeId, symbol: string): readonly AlertView[] {
  const s = useSyncExternalStore(alertsClient.subscribe, alertsClient.getSnapshot, alertsClient.getServerSnapshot);
  return useMemo(() => s.alerts.filter((a) => a.kind === 'price' && a.status === 'active' && a.exchange === exchange && a.symbol === symbol), [s.alerts, exchange, symbol]);
}

export function usePinned(exchange: ExchangeId, symbol: string): [boolean, (pinned: boolean) => void] {
  const all = useSyncExternalStore(pinStore.subscribe, pinStore.getSnapshot, pinStore.getServerSnapshot);
  const key = pinKey(exchange, symbol);
  return [all.includes(key), (pinned) => setPinned(exchange, symbol, pinned)];
}
