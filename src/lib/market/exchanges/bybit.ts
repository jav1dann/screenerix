/** Bybit v5 linear (USDT) perpetuals. Tickers and order books arrive as snapshot + delta. */
import { arrayKlines, chunk, indexInstruments, isObj, levels, num, safeJson } from './shared';
import type { ExchangeAdapter, FeedEvent, OiPoint, RawTrade, Timeframe } from './types';

const URL = 'wss://stream.bybit.com/v5/public/linear';
const REST = 'https://api.bybit.com';
const INTERVAL: Record<Timeframe, string> = { '1m': '1', '3m': '3', '5m': '5', '15m': '15', '30m': '30', '1h': '60', '4h': '240', '1d': 'D' };
const TF_OF = Object.fromEntries(Object.entries(INTERVAL).map(([tf, i]) => [i, tf])) as Record<string, Timeframe>;
const OI_PERIOD: Partial<Record<Timeframe, string>> = { '5m': '5min', '15m': '15min', '30m': '30min', '1h': '1h', '4h': '4h', '1d': '1d' };
const side = (v: unknown): 'buy' | 'sell' | undefined => (v === 'Buy' ? 'buy' : v === 'Sell' ? 'sell' : undefined);

export const bybit: ExchangeAdapter = {
  id: 'bybit',
  name: 'Bybit',
  market: 'perp',
  quote: 'USDT',
  nativeTimeframes: ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '1d'],
  klineLimit: 1000,
  ws: {
    tickerUrl: URL,
    bookUrl: URL,
    klineUrl: URL,
    tradeUrl: URL,
    tickerTopics: (inst) => [`tickers.${inst}`],
    bookTopics: (inst) => [`orderbook.50.${inst}`],
    klineTopics: (inst, tf) => [`kline.${INTERVAL[tf]}.${inst}`],
    tradeTopics: (inst) => [`publicTrade.${inst}`],
    oiTopics: (inst) => [`tickers.${inst}`], // tickers carry openInterest
    frames: (op, topics) => chunk(topics, 10).map((args) => JSON.stringify({ op, args })),
    ping: { everyMs: 20_000, frame: () => JSON.stringify({ op: 'ping' }) },
    parse(raw) {
      const m = safeJson(raw);
      if (!isObj(m) || typeof m.topic !== 'string') return [];
      const out: FeedEvent[] = [];
      if (m.topic.startsWith('kline.') && Array.isArray(m.data)) {
        const [, interval, inst] = m.topic.split('.');
        const tf = TF_OF[interval];
        for (const k of m.data) {
          if (!isObj(k) || !tf) continue;
          const [t, o, h, l, c] = [num(k.start), num(k.open), num(k.high), num(k.low), num(k.close)];
          if (t !== undefined && o !== undefined && h !== undefined && l !== undefined && c !== undefined) {
            out.push({ kind: 'kline', inst, tf, t, o, h, l, c, v: num(k.volume) ?? 0 });
          }
        }
        return out;
      }
      if (m.topic.startsWith('publicTrade.') && Array.isArray(m.data)) {
        for (const tr of m.data) {
          if (!isObj(tr)) continue;
          const [price, size, t] = [num(tr.p), num(tr.v), num(tr.T)];
          if (price !== undefined && size !== undefined && t !== undefined) out.push({ kind: 'trade', inst: String(tr.s), price, size, t, side: side(tr.S) });
        }
        return out;
      }
      if (!isObj(m.data)) return out;
      const d = m.data;
      if (m.topic.startsWith('tickers.')) {
        const inst = String(d.symbol ?? m.topic.slice(8));
        out.push({
          kind: 'ticker',
          inst,
          last: num(d.lastPrice),
          open24h: num(d.prevPrice24h),
          high24h: num(d.highPrice24h),
          low24h: num(d.lowPrice24h),
          quoteVol: num(d.turnover24h),
          funding: num(d.fundingRate),
        });
        const oi = num(d.openInterest);
        if (oi !== undefined) out.push({ kind: 'oi', inst, value: oi, units: 'contracts' });
      } else if (m.topic.startsWith('orderbook.')) {
        out.push({ kind: 'book', inst: String(d.s), snapshot: m.type === 'snapshot', bids: levels(d.b), asks: levels(d.a) });
      }
      return out;
    },
  },
  rest: {
    instrumentsUrl: `${REST}/v5/market/instruments-info?category=linear&limit=1000`,
    parseInstruments(json, bases) {
      const list = isObj(json) && isObj(json.result) && Array.isArray(json.result.list) ? json.result.list : [];
      const rows = list.flatMap((s) => (isObj(s) && s.status === 'Trading' && s.quoteCoin === 'USDT' && s.contractType === 'LinearPerpetual'
        ? [{ venueBase: String(s.baseCoin), inst: String(s.symbol) }] : []));
      return indexInstruments(rows, bases);
    },
    tickers: {
      urls: [`${REST}/v5/market/tickers?category=linear`],
      parse([json]) {
        const list = isObj(json) && isObj(json.result) && Array.isArray(json.result.list) ? json.result.list : [];
        return list.flatMap((d): FeedEvent[] => (isObj(d) ? [{
          kind: 'ticker', inst: String(d.symbol), last: num(d.lastPrice), open24h: num(d.prevPrice24h),
          high24h: num(d.highPrice24h), low24h: num(d.lowPrice24h), quoteVol: num(d.turnover24h), funding: num(d.fundingRate),
        }] : []));
      },
    },
    klinesUrl: (meta, tf, limit, end) => `${REST}/v5/market/kline?category=linear&symbol=${meta.inst}&interval=${INTERVAL[tf]}&limit=${limit}${end === undefined ? '' : `&end=${end}`}`,
    parseKlines: (json) =>
      arrayKlines(isObj(json) && isObj(json.result) ? json.result.list : [], { t: 0, o: 1, h: 2, l: 3, c: 4, v: 5 }),
    tradesUrl: (meta) => `${REST}/v5/market/recent-trade?category=linear&symbol=${meta.inst}&limit=1000`,
    parseTrades(json) {
      const list = isObj(json) && isObj(json.result) && Array.isArray(json.result.list) ? json.result.list : [];
      const out: RawTrade[] = [];
      for (const r of list) {
        if (!isObj(r)) continue;
        const [price, size, t] = [num(r.price), num(r.size), num(r.time)];
        if (price !== undefined && size !== undefined && t !== undefined) out.push({ t, price, size, side: side(r.side) });
      }
      return out.sort((a, b) => a.t - b.t);
    },
    oi: {
      periods: ['5m', '15m', '30m', '1h', '4h', '1d'],
      historyUrl: (meta, period, limit) =>
        `${REST}/v5/market/open-interest?category=linear&symbol=${meta.inst}&intervalTime=${OI_PERIOD[period] ?? '5min'}&limit=${Math.min(limit, 200)}`,
      parseHistory(json, meta) {
        const list = isObj(json) && isObj(json.result) && Array.isArray(json.result.list) ? json.result.list : [];
        const out: OiPoint[] = [];
        for (const r of list) {
          const t = isObj(r) ? num(r.timestamp) : undefined;
          const oi = isObj(r) ? num(r.openInterest) : undefined;
          if (t !== undefined && oi !== undefined) out.push({ t, oi: oi * meta.contractSize });
        }
        return out.sort((a, b) => a.t - b.t);
      },
    },
  },
};
