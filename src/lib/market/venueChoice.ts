/**
 * Which venue the terminal shows when the stored one can't be used, and which venues the
 * Arbitrage screener compares by default — given which exchanges refuse our servers' region.
 * Pure (client-safe, tested by test:venues).
 */
import type { MarketType } from '@/lib/alerts/alertStore';
import { ADAPTERS } from './exchanges';
import type { ExchangeId } from './exchanges';

/** Default order per market: most liquid first (the first one that isn't restricted wins). */
export const VENUE_ORDER: Record<MarketType, readonly ExchangeId[]> = {
  futures: ['binance', 'bybit', 'okx', 'bitget', 'gate'],
  spot: ['coinbase'],
};

const tradesMarket = (id: ExchangeId, market: MarketType) => (ADAPTERS[id].market === 'perp') === (market === 'futures');

/**
 * The venue to switch to, or null to keep `current`. Only for visitors who never picked a venue
 * themselves (`chosen` false): a venue someone picked — or set as their default in Settings — is
 * never changed behind their back (the terminal explains the restriction and offers alternatives).
 */
export function autoVenue(p: {
  market: MarketType;
  current: ExchangeId;
  chosen: boolean;
  /** Venues enabled in Settings for this market. */
  enabled: readonly ExchangeId[];
  restricted: (id: ExchangeId) => boolean;
}): ExchangeId | null {
  if (p.chosen || !p.restricted(p.current)) return null;
  const order = [...VENUE_ORDER[p.market], ...p.enabled];
  const next = order.find((id) => p.enabled.includes(id) && tradesMarket(id, p.market) && !p.restricted(id));
  return next && next !== p.current ? next : null;
}

/** The venues the Arbitrage screener starts with: up to `count` unrestricted ones, in default order. */
export function defaultCompare(market: MarketType, restricted: (id: ExchangeId) => boolean, count = 4): ExchangeId[] {
  return VENUE_ORDER[market].filter((id) => !restricted(id)).slice(0, count);
}

/** Venues of `market` that aren't restricted, for "switch to …" suggestions. */
export const availableVenues = (market: MarketType, enabled: readonly ExchangeId[], restricted: (id: ExchangeId) => boolean): ExchangeId[] =>
  enabled.filter((id) => tradesMarket(id, market) && !restricted(id));
