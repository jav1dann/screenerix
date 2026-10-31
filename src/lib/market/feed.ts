import type {
  AlertItem, Asset, Candle, ExchangeId, OrderBook, StatusMap, Timeframe, VenueQuote,
} from './types';

export interface FeedConfig {
  /** Venue driving the ticker table, map, review and densities. */
  primary: ExchangeId;
  /** Extra venues streamed for the arbitrage screener (primary is implied). */
  compare: readonly ExchangeId[];
  /** Symbol whose candles and deep book are needed. */
  focus: string;
}

/**
 * Data source contract implemented by the live exchange service.
 * Reads are synchronous snapshots; `subscribe` fires (throttled) when they change.
 */
export interface MarketFeed {
  subscribe(listener: () => void): () => void;
  getVersion(): number;
  configure(config: FeedConfig): void;
  start(): void;
  stop(): void;
  /** Re-attempt a failed venue (instrument fetch + sockets). */
  retry(id: ExchangeId): void;

  getMarket(): Asset[];
  /** A venue's latest price for `symbol` (with when it arrived and whether its stream is live); null if none. */
  getQuote(id: ExchangeId, symbol: string): VenueQuote | null;
  /** Base symbols a streaming venue lists (empty while it loads, or when unavailable / restricted). */
  getListed(id: ExchangeId): string[];
  /** null while loading, [] when unavailable. */
  getCandles(symbol: string, tf: Timeframe): Candle[] | null;
  getBook(symbol: string): OrderBook | null;
  /**
   * Every streamed level of the primary venue's book for `symbol` as [price, base qty], best first
   * (null when no book is streamed). Same version memo as `getBook`.
   */
  getLevels(symbol: string): { bids: Array<[number, number]>; asks: Array<[number, number]> } | null;
  getStatus(): StatusMap;
  getAlerts(): AlertItem[];
  /** Add an alert raised elsewhere (e.g. a chart card's price alert). */
  pushAlert(alert: AlertItem): void;
  getUnread(): number;
  clearUnread(): void;
}

/** Listener set with trailing-edge throttling, for `useSyncExternalStore`. */
export function createEmitter(minIntervalMs: number) {
  const listeners = new Set<() => void>();
  let version = 0;
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    timer = null;
    last = Date.now();
    version++;
    listeners.forEach((l) => l());
  };

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getVersion: () => version,
    /** Schedule a change notification (coalesced to at most one per interval). */
    notify() {
      if (timer) return;
      timer = setTimeout(flush, Math.max(0, minIntervalMs - (Date.now() - last)));
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
