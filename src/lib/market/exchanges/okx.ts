/** OKX v5 USDT-margined swaps. Book, trade and candle sizes are contracts (ctVal per instrument). */
import { arrayKlines, chunk, indexInstruments, isObj, levels, num, safeJson, splitTopic, topic } from './shared';
import type { ExchangeAdapter, FeedEvent, OiPoint, RawTrade, Timeframe } from './types';

const PUBLIC = 'wss://ws.okx.com:8443/ws/v5/public';
const BUSINESS = 'wss://ws.okx.com:8443/ws/v5/business';
const REST = 'https://www.okx.com/api/v5';
// `1Dutc` aligns daily candles to UTC midnight (plain `1D` uses UTC+8).
const BAR: Record<Timeframe, string> = { '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1H', '4h': '4H', '1d': '1Dutc' };
const TF_OF = Object.fromEntries(Object.entries(BAR).map(([tf, bar]) => [`candle${bar}`, tf])) as Record<string, Timeframe>;
const OI_PERIOD: Partial<Record<Timeframe, string>> = { '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1H', '4h': '4H', '1d': '1D' };
/** Candle row: [ts, o, h, l, c, vol (contracts), volCcy, volCcyQuote, confirm]. Contracts are scaled downstream. */
const KLINE_IDX = { t: 0, o: 1, h: 2, l: 3, c: 4, v: 5 };
const side = (v: unknown): 'buy' | 'sell' | undefined => (v === 'buy' || v === 'sell' ? v : undefined);

export const okx: ExchangeAdapter = {
  id: 'okx',
  name: 'OKX',
  market: 'perp',
  quote: 'USDT',
  nativeTimeframes: ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '1d'],
  klineLimit: 300,
  ws: {
    tickerUrl: PUBLIC,
    bookUrl: PUBLIC,
    klineUrl: BUSINESS,
    tradeUrl: PUBLIC,
    tickerTopics: (inst) => [topic('tickers', inst), topic('funding-rate', inst)],
    // Full incremental book for the focused symbol, 5-level snapshots for the rest.
    bookTopics: (inst, deep) => [topic(deep ? 'books' : 'books5', inst)],
    klineTopics: (inst, tf) => [topic(`candle${BAR[tf]}`, inst)],
    tradeTopics: (inst) => [topic('trades', inst)],
    oiTopics: (inst) => [topic('open-interest', inst)],
    frames: (op, topics) =>
      chunk(topics, 100).map((ts) =>
        JSON.stringify({ op, args: ts.map((t) => { const [channel, instId] = splitTopic(t); return { channel, instId }; }) })),
    ping: { everyMs: 25_000, frame: () => 'ping' },
    parse(raw) {
      const m = safeJson(raw);
      if (!isObj(m) || !isObj(m.arg) || !Array.isArray(m.data)) return [];
      const channel = String(m.arg.channel);
      const out: FeedEvent[] = [];
      const klineTf = TF_OF[channel];
      if (klineTf) {
        for (const c of arrayKlines(m.data, KLINE_IDX)) out.push({ kind: 'kline', inst: String(m.arg.instId), tf: klineTf, ...c });
        return out;
      }
      for (const d of m.data) {
        if (!isObj(d)) continue;
        const inst = String(d.instId ?? m.arg.instId);
        if (channel === 'tickers') {
          const last = num(d.last);
          const baseVol = num(d.volCcy24h);
          out.push({
            kind: 'ticker', inst, last,
            open24h: num(d.open24h), high24h: num(d.high24h), low24h: num(d.low24h),
            quoteVol: last !== undefined && baseVol !== undefined ? last * baseVol : undefined,
          });
        } else if (channel === 'funding-rate') {
          out.push({ kind: 'ticker', inst, funding: num(d.fundingRate) ?? null });
        } else if (channel === 'books5' || channel === 'books') {
          const snapshot = channel === 'books5' || m.action === 'snapshot';
          out.push({ kind: 'book', inst, snapshot, bids: levels(d.bids), asks: levels(d.asks) });
        } else if (channel === 'trades') {
          const [price, size, t] = [num(d.px), num(d.sz), num(d.ts)];
          if (price !== undefined && size !== undefined && t !== undefined) out.push({ kind: 'trade', inst, price, size, t, side: side(d.side) });
        } else if (channel === 'open-interest') {
          const oi = num(d.oiCcy);
          if (oi !== undefined) out.push({ kind: 'oi', inst, value: oi, units: 'base' });
        }
      }
      return out;
    },
  },
  rest: {
    instrumentsUrl: `${REST}/public/instruments?instType=SWAP`,
    parseInstruments(json, bases) {
      const list = isObj(json) && Array.isArray(json.data) ? json.data : [];
      const rows = list.flatMap((s) => (isObj(s) && s.state === 'live' && String(s.instId).endsWith('-USDT-SWAP')
        ? [{ venueBase: String(s.instId).split('-')[0], inst: String(s.instId), contractSize: num(s.ctVal) ?? 1 }] : []));
      return indexInstruments(rows, bases);
    },
    tickers: {
      // Funding isn't in the tickers payload: `instId=ANY` returns every swap's current rate in one call.
      urls: [`${REST}/market/tickers?instType=SWAP`, `${REST}/public/funding-rate?instId=ANY`],
      parse([json, funding]) {
        const list = isObj(json) && Array.isArray(json.data) ? json.data : [];
        const out = list.flatMap((d): FeedEvent[] => {
          if (!isObj(d)) return [];
          const last = num(d.last);
          const baseVol = num(d.volCcy24h);
          return [{
            kind: 'ticker', inst: String(d.instId), last, open24h: num(d.open24h), high24h: num(d.high24h), low24h: num(d.low24h),
            quoteVol: last !== undefined && baseVol !== undefined ? last * baseVol : undefined,
          }];
        });
        for (const f of isObj(funding) && Array.isArray(funding.data) ? funding.data : []) {
          if (isObj(f)) out.push({ kind: 'ticker', inst: String(f.instId), funding: num(f.fundingRate) ?? null });
        }
        return out;
      },
    },
    // Older pages come from history-candles (`after` = strictly before this ts).
    klinesUrl: (meta, tf, limit, end) => (end === undefined
      ? `${REST}/market/candles?instId=${meta.inst}&bar=${BAR[tf]}&limit=${limit}`
      : `${REST}/market/history-candles?instId=${meta.inst}&bar=${BAR[tf]}&limit=${Math.min(limit, 100)}&after=${end + 1}`),
    parseKlines: (json) => arrayKlines(isObj(json) ? json.data : [], KLINE_IDX),
    tradesUrl: (meta) => `${REST}/market/trades?instId=${meta.inst}&limit=500`,
    // 1s candles (about the last 24 minutes); 30s charts are aggregated from them.
    subMinuteKlines: {
      '1s': {
        maxLimit: 300,
        url: (meta, limit, before) => `${REST}/market/candles?instId=${meta.inst}&bar=1s&limit=${limit}${before === undefined ? '' : `&after=${before}`}`,
      },
    },
    parseTrades(json) {
      const list = isObj(json) && Array.isArray(json.data) ? json.data : [];
      const out: RawTrade[] = [];
      for (const r of list) {
        if (!isObj(r)) continue;
        const [price, size, t] = [num(r.px), num(r.sz), num(r.ts)];
        if (price !== undefined && size !== undefined && t !== undefined) out.push({ t, price, size, side: side(r.side) });
      }
      return out.sort((a, b) => a.t - b.t);
    },
    oi: {
      periods: ['5m', '15m', '30m', '1h', '4h', '1d'],
      historyUrl: (meta, period, limit) =>
        `${REST}/rubik/stat/contracts/open-interest-history?instId=${meta.inst}&period=${OI_PERIOD[period] ?? '5m'}&limit=${Math.min(limit, 100)}`,
      // Rows: [ts, oi (contracts), oiCcy (base), oiUsd] — newest first.
      parseHistory(json) {
        const rows = isObj(json) && Array.isArray(json.data) ? json.data : [];
        const out: OiPoint[] = [];
        for (const r of rows) {
          if (!Array.isArray(r)) continue;
          const [t, oi] = [num(r[0]), num(r[2])];
          if (t !== undefined && oi !== undefined) out.push({ t, oi });
        }
        return out.sort((a, b) => a.t - b.t);
      },
    },
  },
};
