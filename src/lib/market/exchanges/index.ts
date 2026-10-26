import { binance } from './binance';
import { bitget } from './bitget';
import { bybit } from './bybit';
import { coinbase } from './coinbase';
import { gate } from './gate';
import { okx } from './okx';
import type { ExchangeAdapter, ExchangeId } from './types';

export const ADAPTERS: Record<ExchangeId, ExchangeAdapter> = { binance, bybit, okx, bitget, coinbase, gate };

/** Display order of the exchange pills. */
export const EXCHANGE_IDS: readonly ExchangeId[] = ['binance', 'bybit', 'okx', 'bitget', 'coinbase', 'gate'];

export const isExchangeId = (v: string): v is ExchangeId => (EXCHANGE_IDS as readonly string[]).includes(v);

export const exchangeName = (id: ExchangeId): string => ADAPTERS[id].name;

export type { ChartTimeframe, ExchangeAdapter, ExchangeId, FeedEvent, InstrumentMeta, OiPoint, RawCandle, RawTrade, SubMinute, Timeframe } from './types';
export { isSubMinute, isTimeframe, KLINE_TIMEFRAMES, TIMEFRAME_MS } from './types';
