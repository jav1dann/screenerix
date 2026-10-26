/**
 * Exchange adapter contract.
 *
 * Each venue translates its public WebSocket / REST API into these normalised
 * shapes. Adapters are pure (no I/O): the live service owns sockets and the
 * route handlers own HTTP. Keep imports in this folder relative so the files
 * stay loadable by plain Node for integration checks.
 */

export type ExchangeId = 'binance' | 'bybit' | 'okx' | 'bitget' | 'coinbase' | 'gate';
/** Candle intervals with exchange-side history (REST klines). */
export type Timeframe = '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d';
/** Sub-minute chart intervals: native candles where the venue has them, else built from trades. */
export type SubMinute = '1s' | '30s';
/** Everything a chart can show. */
export type ChartTimeframe = SubMinute | Timeframe;

export const TIMEFRAME_MS: Record<ChartTimeframe, number> = {
  '1s': 1_000,
  '30s': 30_000,
  '1m': 60_000,
  '3m': 180_000,
  '5m': 300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '1d': 86_400_000,
};

export const KLINE_TIMEFRAMES: readonly Timeframe[] = ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '1d'];
export const isTimeframe = (v: string): v is Timeframe => (KLINE_TIMEFRAMES as readonly string[]).includes(v);
export const isSubMinute = (v: string): v is SubMinute => v === '1s' || v === '30s';

/** How a base symbol (e.g. "PEPE") maps onto a venue instrument (e.g. "1000PEPEUSDT"). */
export interface InstrumentMeta {
  /** Venue instrument id used in subscriptions and REST calls. */
  inst: string;
  /** Multiply venue sizes by this to get base-asset units (contracts → coins, 1000PEPE → PEPE). */
  contractSize: number;
  /** Multiply venue prices by this to get the price of one base unit. */
  priceScale: number;
}

/** Candle as returned by the klines proxy: `t` is the open time in ms. */
export interface RawCandle {
  t: number; o: number; h: number; l: number; c: number; v: number;
  /** Trade count, on venues whose klines publish it (Binance). */
  n?: number;
  /** Taker-buy volume (same units as `v`), on venues whose klines publish it (Binance) or built from trades. */
  tb?: number;
  /** Built from live prices between refetches: no volume / trade count of its own. */
  live?: true;
}

/** Trade in venue units; `side` is the aggressor. */
export interface RawTrade {
  t: number; price: number; size: number; side?: 'buy' | 'sell';
  /** Venue trade id, where paging back through trades needs it. */
  id?: string;
}

/** Open interest sample in base-asset units. */
export interface OiPoint { t: number; oi: number }

/** Price levels as [price, size] in venue units. Size 0 deletes a level. */
export type Levels = Array<[number, number]>;

export type FeedEvent =
  | {
      kind: 'ticker';
      inst: string;
      last?: number;
      open24h?: number;
      high24h?: number;
      low24h?: number;
      /** 24h trade count — only some venues publish it. */
      trades24h?: number;
      /** 24h turnover in quote currency. */
      quoteVol?: number;
      funding?: number | null;
    }
  | { kind: 'book'; inst: string; snapshot: boolean; bids: Levels; asks: Levels }
  /** Candle update in venue units: `t` = open time ms, `v` = volume in venue size units. */
  | { kind: 'kline'; inst: string; tf: Timeframe; t: number; o: number; h: number; l: number; c: number; v: number; tb?: number }
  /** Individual trade; `side` is the aggressor when the venue reports it. */
  | { kind: 'trade'; inst: string; price: number; size: number; t: number; side?: 'buy' | 'sell' }
  /** Current open interest, in base units or venue contracts (scaled downstream). */
  | { kind: 'oi'; inst: string; value: number; units: 'base' | 'contracts' };

export interface ExchangeAdapter {
  id: ExchangeId;
  name: string;
  market: 'perp' | 'spot';
  quote: 'USDT' | 'USD';
  /** Kline intervals available from the venue; others are aggregated from a smaller native one. */
  nativeTimeframes: readonly Timeframe[];
  /** Max candles per klines request. */
  klineLimit: number;
  ws: {
    /** Socket carrying ticker / funding topics. */
    tickerUrl: string;
    /** Socket carrying order book topics (may equal `tickerUrl`). */
    bookUrl: string;
    /** Opaque topic keys for one instrument's ticker + funding streams. */
    tickerTopics(inst: string): string[];
    /**
     * Topic keys that stream tickers (and funding) for the whole market at once,
     * e.g. Binance `!ticker@arr`. When defined, the market feed uses these instead
     * of one subscription per instrument.
     */
    allTickerTopics?(): string[];
    /** Max subscribe/unsubscribe frames per second the venue accepts (default: unlimited). */
    framesPerSecond?: number;
    /** Opaque topic keys for one instrument's book; `deep` = the focused symbol. Empty = no book. */
    bookTopics(inst: string, deep: boolean): string[];
    /** Socket carrying kline (or trade) topics. */
    klineUrl: string;
    /** Kline topic keys for one instrument and timeframe. Empty = build candles from `tradeTopics`. */
    klineTopics(inst: string, tf: Timeframe): string[];
    /** Socket carrying trade topics. */
    tradeUrl: string;
    /** Trade topic keys: sub-minute candles, and venues without a kline stream. */
    tradeTopics(inst: string): string[];
    /** Topic keys whose messages carry open interest (on `tickerUrl`); empty = poll REST. */
    oiTopics(inst: string): string[];
    /** Serialise subscribe / unsubscribe frames for a set of topic keys. */
    frames(op: 'subscribe' | 'unsubscribe', topics: string[]): string[];
    /** Application-level keep-alive, if the venue needs one. */
    ping?: { everyMs: number; frame: () => string };
    parse(raw: string): FeedEvent[];
  };
  rest: {
    instrumentsUrl: string;
    /** Base coin → instrument for every active listing (or only `bases`, when given). */
    parseInstruments(json: unknown, bases?: readonly string[]): Record<string, InstrumentMeta>;
    /** Whole-market 24h ticker snapshot: one or more URLs, parsed together into ticker events (venue units). */
    tickers: { urls: string[]; parse(jsons: unknown[]): FeedEvent[] };
    /** Latest `limit` candles, or the `limit` candles up to `end` (ms, inclusive) for older history. */
    klinesUrl(meta: InstrumentMeta, tf: Timeframe, limit: number, end?: number): string;
    /** Oldest-first candles in venue price units. */
    parseKlines(json: unknown, tf: ChartTimeframe, limit: number): RawCandle[];
    /**
     * Native sub-minute candles (parsed by `parseKlines`): the newest `limit`, or the `limit`
     * opening before `before` (ms, exclusive). A venue with '1s' only gets 30s aggregated from it.
     */
    subMinuteKlines?: Partial<Record<SubMinute, { url(meta: InstrumentMeta, limit: number, before?: number): string; maxLimit: number }>>;
    /** Recent public trades (~500–1000), used to seed sub-minute candles. */
    tradesUrl(meta: InstrumentMeta): string;
    /** Oldest-first trades in venue units. */
    parseTrades(json: unknown): RawTrade[];
    /** The page of trades before `oldest` (paging back for sub-minute history); absent: recent trades only. */
    olderTradesUrl?(meta: InstrumentMeta, oldest: RawTrade): string | null;
    /** Open-interest history / snapshot, where the venue publishes it. */
    oi?: {
      periods: readonly Timeframe[];
      historyUrl?(meta: InstrumentMeta, period: Timeframe, limit: number): string;
      /** Oldest-first samples in base units. */
      parseHistory?(json: unknown, meta: InstrumentMeta): OiPoint[];
      /** Snapshot endpoint for venues without a live OI stream. */
      currentUrl?(meta: InstrumentMeta): string;
      parseCurrent?(json: unknown, meta: InstrumentMeta): number | null;
    };
  };
}
