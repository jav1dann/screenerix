import type { ExchangeId } from './exchanges/types';

export type { ExchangeId, Timeframe } from './exchanges/types';
export type TabId = 'map' | 'review' | 'dens' | 'strat' | 'arb';
export type SortKey = 'sym' | 'ch24' | 'natr' | 'fund' | 'vol';
export type SortDir = 1 | -1;

export interface Asset {
  symbol: string;
  /** Position in the venue's 24h-volume ranking (most traded = 0). */
  index: number;
  /** Oldest-first closes, one per minute in live mode. Always ≥ 2 points. */
  history: number[];
  /** 24h turnover in quote currency. */
  volume: number;
  /** Change vs the price 24h ago (0.012 = +1.2%); null until the venue reports it. */
  change24h: number | null;
  /** Current funding rate; null on spot venues or before the first update. */
  funding: number | null;
  dir: 1 | -1;
}
export interface Candle { t?: number; o: number; c: number; h: number; l: number; v: number }
export interface CandleGeometry {
  upWick: string; upBody: string; downWick: string; downBody: string;
  upVol: string; downVol: string; lastY: number;
  high: string; low: string; last: string; change: number;
}
export interface BookLevel { price: number; notional: number; wall: boolean }
export interface OrderBook {
  /** Nearest first. */
  asks: BookLevel[];
  bids: BookLevel[];
  mid: number;
  spread: number;
  /** Half-width of the visible book as a fraction of mid. */
  range: number;
}
export interface AlertItem { id: number; symbol: string; title: string; detail: string; positive: boolean; time: string }
export interface TickerRow {
  asset: Asset; symbol: string; price: number; c1: number; c5: number; spark: number[]; trend: number;
  ch24: number | null;
  /** NATR (%) of 5m candles over 14 periods; null until scanned. */
  natr: number | null;
}
export interface VenueQuote { price: number; funding: number | null }

export type ConnState = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'error';
export interface VenueStatus { state: ConnState; error?: string }
export type StatusMap = Record<ExchangeId, VenueStatus>;
