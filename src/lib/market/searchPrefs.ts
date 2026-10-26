/** Ticker search settings, persisted per browser. */
import { createValueStore } from '@/lib/alerts/localStore';
import { EXCHANGE_IDS, isExchangeId } from './exchanges';
import type { ExchangeId } from './exchanges';

export interface SearchPrefs {
  exactOnly: boolean;
  /** Venues searched (the current primary is always included). */
  venues: ExchangeId[];
}

const DEFAULTS: SearchPrefs = { exactOnly: false, venues: [...EXCHANGE_IDS] };

function sanitize(raw: unknown): SearchPrefs {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<Record<keyof SearchPrefs, unknown>>;
  return {
    exactOnly: r.exactOnly === true,
    venues: Array.isArray(r.venues) ? r.venues.filter((v): v is ExchangeId => typeof v === 'string' && isExchangeId(v)) : DEFAULTS.venues,
  };
}

export const searchPrefs = createValueStore<SearchPrefs>('screenerix.searchPrefs.v1', DEFAULTS, sanitize);

/** Checklist order in the search settings; venues without an adapter are listed as coming soon. */
export const SEARCH_VENUES: ReadonlyArray<{ id: ExchangeId | null; name: string }> = [
  { id: 'binance', name: 'Binance' },
  { id: 'bybit', name: 'Bybit' },
  { id: 'okx', name: 'OKX' },
  { id: 'gate', name: 'Gate' },
  { id: null, name: 'MEXC' },
  { id: 'bitget', name: 'BitGet' },
  { id: null, name: 'KuCoin' },
  { id: null, name: 'BingX' },
  { id: null, name: 'HTX' },
  { id: null, name: 'HL' },
  { id: null, name: 'Aster' },
  { id: null, name: 'Lighter' },
  { id: null, name: 'Bitunix' },
  { id: 'coinbase', name: 'Coinbase' },
];
