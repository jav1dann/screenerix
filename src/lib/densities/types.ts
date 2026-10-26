/** Shared types for the Densities screener (server routes + client engine). */
import type { ExchangeId } from '@/lib/market/exchanges';

export type DensityMarket = 'futures' | 'spot';

/** Venue × market pairs with order-book depth (Coinbase lists spot only). */
export const DENSITY_MARKETS: Record<ExchangeId, readonly DensityMarket[]> = {
  binance: ['futures', 'spot'],
  bybit: ['futures', 'spot'],
  okx: ['futures', 'spot'],
  bitget: ['futures', 'spot'],
  gate: ['futures', 'spot'],
  coinbase: ['spot'],
};

export const supportsDensity = (venue: ExchangeId, market: DensityMarket): boolean => DENSITY_MARKETS[venue].includes(market);

export const isDensityMarket = (v: string): v is DensityMarket => v === 'futures' || v === 'spot';

/** One coin of a venue × market, in quote currency (USDT; USD on Coinbase). */
export interface UniverseRow {
  symbol: string;
  last: number;
  /** 24h turnover in quote currency. */
  volume24h: number;
  /** 0.012 = +1.2%; null when the venue doesn't report it. */
  change24h: number | null;
}

/** [price, base quantity], best first. */
export type DepthLevel = [number, number];

export interface DepthBook {
  bids: DepthLevel[];
  asks: DepthLevel[];
  /** Server time of the snapshot (ms). */
  ts: number;
}
