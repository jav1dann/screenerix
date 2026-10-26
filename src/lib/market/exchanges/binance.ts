/** Binance USDⓈ-M perpetuals. Ticker/mark/kline/trade streams live on /market, depth on /public. */
import { arrayKlines, chunk, indexInstruments, isObj, levels, num, safeJson } from './shared';
import type { ExchangeAdapter, FeedEvent, OiPoint, RawTrade, Timeframe } from './types';
import { isTimeframe } from './types';

const MARKET = 'wss://fstream.binance.com/market/ws';
const REST = 'https://fapi.binance.com';
let reqId = 1;

/** Parse one stream payload (a single object; array streams are split by the caller). */
function parseOne(m: unknown): FeedEvent[] {
  if (!isObj(m) || typeof m.s !== 'string') return [];
  const inst = m.s;
  const out: FeedEvent[] = [];
  if (m.e === '24hrTicker') {
    out.push({ kind: 'ticker', inst, last: num(m.c), open24h: num(m.o), high24h: num(m.h), low24h: num(m.l), trades24h: num(m.n), quoteVol: num(m.q) });
  } else if (m.e === 'kline' && isObj(m.k)) {
    const k = m.k;
    const [t, o, h, l, c, v, tb] = [num(k.t), num(k.o), num(k.h), num(k.l), num(k.c), num(k.v), num(k.V)];
    const tf = String(k.i);
    if (isTimeframe(tf) && t !== undefined && o !== undefined && h !== undefined && l !== undefined && c !== undefined) {
      out.push({ kind: 'kline', inst, tf, t, o, h, l, c, v: v ?? 0, ...(tb === undefined ? {} : { tb }) });
    }
  } else if (m.e === 'aggTrade') {
    const [price, size, t] = [num(m.p), num(m.q), num(m.T)];
    // m = buyer is maker → the aggressor sold.
    if (price !== undefined && size !== undefined && t !== undefined) out.push({ kind: 'trade', inst, price, size, t, side: m.m ? 'sell' : 'buy' });
  } else if (m.e === 'markPriceUpdate') {
    out.push({ kind: 'ticker', inst, funding: num(m.r) ?? null });
  } else if (m.e === 'depthUpdate') {
    out.push({ kind: 'book', inst, snapshot: true, bids: levels(m.b), asks: levels(m.a) });
  }
  return out;
}

export const binance: ExchangeAdapter = {
  id: 'binance',
  name: 'Binance',
  market: 'perp',
  quote: 'USDT',
  nativeTimeframes: ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '1d'],
  klineLimit: 1500,
  ws: {
    tickerUrl: MARKET,
    bookUrl: 'wss://fstream.binance.com/public/ws',
    klineUrl: MARKET,
    tradeUrl: MARKET,
    tickerTopics: (inst) => [`${inst.toLowerCase()}@ticker`, `${inst.toLowerCase()}@markPrice@1s`],
    // Whole-market streams: one subscription covers every symbol (arrays, ~1/s).
    allTickerTopics: () => ['!ticker@arr', '!markPrice@arr@1s'],
    framesPerSecond: 5, // Binance allows 10 incoming messages/s per connection
    bookTopics: (inst) => [`${inst.toLowerCase()}@depth20@500ms`],
    klineTopics: (inst, tf) => [`${inst.toLowerCase()}@kline_${tf}`],
    tradeTopics: (inst) => [`${inst.toLowerCase()}@aggTrade`],
    oiTopics: () => [], // no OI stream — polled via REST
    frames: (op, topics) =>
      chunk(topics, 50).map((params) => JSON.stringify({ method: op === 'subscribe' ? 'SUBSCRIBE' : 'UNSUBSCRIBE', params, id: reqId++ })),
    parse(raw) {
      const msg = safeJson(raw);
      // `!ticker@arr` / `!markPrice@arr` deliver arrays of the per-symbol payloads.
      return Array.isArray(msg) ? msg.flatMap(parseOne) : parseOne(msg);
    },
  },
  rest: {
    instrumentsUrl: `${REST}/fapi/v1/exchangeInfo`,
    parseInstruments(json, bases) {
      const list = isObj(json) && Array.isArray(json.symbols) ? json.symbols : [];
      const rows = list.flatMap((s) => (isObj(s) && s.status === 'TRADING' && s.contractType === 'PERPETUAL' && s.quoteAsset === 'USDT'
        ? [{ venueBase: String(s.baseAsset), inst: String(s.symbol) }] : []));
      return indexInstruments(rows, bases);
    },
    tickers: {
      urls: [`${REST}/fapi/v1/ticker/24hr`, `${REST}/fapi/v1/premiumIndex`],
      parse([daily, premium]) {
        const out: FeedEvent[] = [];
        for (const t of Array.isArray(daily) ? daily : []) {
          if (!isObj(t)) continue;
          out.push({
            kind: 'ticker', inst: String(t.symbol), last: num(t.lastPrice), open24h: num(t.openPrice),
            high24h: num(t.highPrice), low24h: num(t.lowPrice), trades24h: num(t.count), quoteVol: num(t.quoteVolume),
          });
        }
        for (const p of Array.isArray(premium) ? premium : []) {
          if (isObj(p)) out.push({ kind: 'ticker', inst: String(p.symbol), funding: num(p.lastFundingRate) ?? null });
        }
        return out;
      },
    },
    klinesUrl: (meta, tf, limit, end) => `${REST}/fapi/v1/klines?symbol=${meta.inst}&interval=${tf}&limit=${limit}${end === undefined ? '' : `&endTime=${end}`}`,
    parseKlines: (json) => arrayKlines(json, { t: 0, o: 1, h: 2, l: 3, c: 4, v: 5, n: 8, tb: 9 }),
    tradesUrl: (meta) => `${REST}/fapi/v1/aggTrades?symbol=${meta.inst}&limit=1000`,
    // Aggregate-trade ids are sequential: the 1000 before the oldest one.
    olderTradesUrl: (meta, oldest) => (oldest.id && Number(oldest.id) > 0 ? `${REST}/fapi/v1/aggTrades?symbol=${meta.inst}&fromId=${Math.max(0, Number(oldest.id) - 1000)}&limit=1000` : null),
    parseTrades(json) {
      if (!Array.isArray(json)) return [];
      const out: RawTrade[] = [];
      for (const r of json) {
        if (!isObj(r)) continue;
        const [price, size, t] = [num(r.p), num(r.q), num(r.T)];
        if (price !== undefined && size !== undefined && t !== undefined) out.push({ t, price, size, side: r.m ? 'sell' : 'buy', id: String(r.a) });
      }
      return out.sort((a, b) => a.t - b.t);
    },
    oi: {
      periods: ['5m', '15m', '30m', '1h', '4h', '1d'] satisfies Timeframe[],
      historyUrl: (meta, period, limit) => `${REST}/futures/data/openInterestHist?symbol=${meta.inst}&period=${period}&limit=${Math.min(limit, 500)}`,
      parseHistory(json, meta) {
        if (!Array.isArray(json)) return [];
        const out: OiPoint[] = [];
        for (const r of json) {
          const t = isObj(r) ? num(r.timestamp) : undefined;
          const oi = isObj(r) ? num(r.sumOpenInterest) : undefined;
          if (t !== undefined && oi !== undefined) out.push({ t, oi: oi * meta.contractSize });
        }
        return out.sort((a, b) => a.t - b.t);
      },
      currentUrl: (meta) => `${REST}/fapi/v1/openInterest?symbol=${meta.inst}`,
      parseCurrent: (json, meta) => {
        const oi = isObj(json) ? num(json.openInterest) : undefined;
        return oi === undefined ? null : oi * meta.contractSize;
      },
    },
  },
};
