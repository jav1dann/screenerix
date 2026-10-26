/** Pinned coins, persisted per browser. Keys are "exchange:SYMBOL". */
import type { ExchangeId } from '@/lib/market/exchanges';
import { createListStore } from './localStore';

export const pinStore = createListStore<string>('screenerix.pins.v1', (v): v is string => typeof v === 'string');

export const pinKey = (exchange: ExchangeId, symbol: string): string => `${exchange}:${symbol}`;

export function setPinned(exchange: ExchangeId, symbol: string, pinned: boolean): void {
  const key = pinKey(exchange, symbol);
  const all = pinStore.getSnapshot().filter((k) => k !== key);
  pinStore.set(pinned ? [...all, key] : all);
}
