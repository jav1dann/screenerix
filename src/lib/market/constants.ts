import type { AlertItem, ExchangeId, TabId, Timeframe } from './types';

/** Terminal header: top row (+ border), and the Market-Map-only control row. */
export const HEADER_TOP_H = 57;
export const HEADER_CONTROLS_H = 48;
export const TAKER_FEES = 0.0008;

/** Market Review panels; `mult` scales simulated volatility. */
export const TIMEFRAMES: ReadonlyArray<{ tf: Timeframe; mult: number }> = [
  { tf: '1m', mult: 1 }, { tf: '5m', mult: 2.2 }, { tf: '1h', mult: 5 }, { tf: '4h', mult: 9 },
];

export const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: 'map', label: 'Market Map' },
  { id: 'review', label: 'Market Review' },
  { id: 'dens', label: 'Densities' },
  { id: 'strat', label: 'Strategies' },
  { id: 'arb', label: 'Arbitrage Screener' },
];

/** [symbol, seed price, 24h volume in $M] — the simulated market (live mode lists every symbol the venue trades). */
export const SEED: ReadonlyArray<readonly [string, number, number]> = [
  ['BTC', 67420.5, 28400], ['ETH', 3512.4, 14200], ['SOL', 172.38, 3900], ['BNB', 584.2, 1650],
  ['XRP', 0.5231, 1420], ['DOGE', 0.14122, 980], ['TON', 6.912, 410], ['AVAX', 36.82, 520],
  ['LINK', 15.432, 610], ['SUI', 1.8634, 720], ['ARB', 1.1124, 380], ['WIF', 2.8412, 690],
  ['PEPE', 0.000012134, 840], ['OP', 2.312, 290], ['NEAR', 6.124, 330], ['APT', 9.042, 260],
];

export const SEED_ALERTS: AlertItem[] = [
  { id: 1, symbol: 'SOL', title: 'Price spike +0.62% in 1m', detail: '172.38 → 173.45 · Binance', positive: true, time: '09:41:12' },
  { id: 2, symbol: 'BTC', title: 'Ask wall pulled', detail: '$8.4M at 67,612 removed · Bybit', positive: false, time: '09:38:50' },
  { id: 3, symbol: 'WIF', title: 'Funding flipped negative', detail: '−0.0042% · OKX', positive: false, time: '09:30:02' },
  { id: 4, symbol: 'ETH', title: 'Spread 0.31% Bitget → Bybit', detail: 'Net after fees +0.23%', positive: true, time: '09:12:44' },
];

export const DEFAULT_PRIMARY: ExchangeId = 'binance';

/** Live alert rule — matches the "Any · |1m| > 0.3%" rule shown in the Alerts drawer. */
export const ALERT_MOVE_1M = 0.003;
/** Book levels shown per side in Densities. */
export const BOOK_DEPTH = 12;
