/** Bitget v2 USDT-FUTURES. Ticker and books15 pushes are full snapshots. */
import { arrayKlines, chunk, indexInstruments, isObj, levels, num, safeJson, splitTopic, topic } from './shared';
import type { ExchangeAdapter, FeedEvent, RawTrade, Timeframe } from './types';
import { TIMEFRAME_MS } from './types';

const URL = 'wss://ws.bitget.com/v2/ws/public';
const REST = 'https://api.bitget.com/api/v2/mix/market';
const INST_TYPE = 'USDT-FUTURES';
// `1Dutc` aligns daily candles to UTC midnight (plain `1D` uses UTC+8).
const GRANULARITY: Record<Timeframe, string> = { '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1H', '4h': '4H', '1d': '1Dutc' };
const TF_OF = Object.fromEntries(Object.entries(GRANULARITY).map(([tf, g]) => [`candle${g}`, tf])) as Record<string, Timeframe>;
/** Candle row: [ts, o, h, l, c, baseVolume, quoteVolume, usdtVolume]. */
const KLINE_IDX = { t: 0, o: 1, h: 2, l: 3, c: 4, v: 5 };
const side = (v: unknown): 'buy' | 'sell' | undefined => {
  const s = typeof v === 'string' ? v.toLowerCase() : '';
  return s === 'buy' || s === 'sell' ? s : undefined;
};

function parseTradeRows(rows: unknown): RawTrade[] {
  if (!Array.isArray(rows)) return [];
  const out: RawTrade[] = [];
  for (const r of rows) {
    if (!isObj(r)) continue;
    const [price, size, t] = [num(r.price), num(r.size), num(r.ts)];
    if (price !== undefined && size !== undefined && t !== undefined) out.push({ t, price, size, side: side(r.side), ...(r.tradeId ? { id: String(r.tradeId) } : {}) });
  }
  return out.sort((a, b) => a.t - b.t);
}

export const bitget: ExchangeAdapter = {
  id: 'bitget',
  name: 'Bitget',
  market: 'perp',
  quote: 'USDT',
  nativeTimeframes: ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '1d'],
  klineLimit: 1000,
  ws: {
    tickerUrl: URL,
    bookUrl: URL,
    klineUrl: URL,
    tradeUrl: URL,
    tickerTopics: (inst) => [topic('ticker', inst)],
    bookTopics: (inst) => [topic('books15', inst)],
    klineTopics: (inst, tf) => [topic(`candle${GRANULARITY[tf]}`, inst)],
    tradeTopics: (inst) => [topic('trade', inst)],
    oiTopics: (inst) => [topic('ticker', inst)], // ticker carries holdingAmount (open interest)
    // Bitget allows 10 messages/s per connection: big frames, sent at most 8 per second.
    framesPerSecond: 8,
    frames: (op, topics) =>
      chunk(topics, 50).map((ts) =>
        JSON.stringify({ op, args: ts.map((t) => { const [channel, instId] = splitTopic(t); return { instType: INST_TYPE, channel, instId }; }) })),
    ping: { everyMs: 25_000, frame: () => 'ping' },
    parse(raw) {
      const m = safeJson(raw);
      if (!isObj(m) || !isObj(m.arg) || !Array.isArray(m.data)) return [];
      const channel = String(m.arg.channel);
      const inst0 = String(m.arg.instId);
      const out: FeedEvent[] = [];
      const klineTf = TF_OF[channel];
      if (klineTf) {
        // The first push is a large snapshot; the chart stream keeps only what extends its series.
        for (const c of arrayKlines(m.data, KLINE_IDX)) out.push({ kind: 'kline', inst: inst0, tf: klineTf, ...c });
        return out;
      }
      if (channel === 'trade') {
        for (const tr of parseTradeRows(m.data)) out.push({ kind: 'trade', inst: inst0, ...tr });
        return out;
      }
      for (const d of m.data) {
        if (!isObj(d)) continue;
        const inst = String(d.instId ?? inst0);
        if (channel === 'ticker') {
          out.push({
            kind: 'ticker', inst, last: num(d.lastPr),
            open24h: num(d.open24h), high24h: num(d.high24h), low24h: num(d.low24h),
            quoteVol: num(d.quoteVolume), funding: num(d.fundingRate),
          });
          const oi = num(d.holdingAmount);
          if (oi !== undefined) out.push({ kind: 'oi', inst, value: oi, units: 'contracts' });
        } else if (channel === 'books15') {
          out.push({ kind: 'book', inst, snapshot: true, bids: levels(d.bids), asks: levels(d.asks) });
        }
      }
      return out;
    },
  },
  rest: {
    instrumentsUrl: `${REST}/contracts?productType=${INST_TYPE}`,
    parseInstruments(json, bases) {
      const list = isObj(json) && Array.isArray(json.data) ? json.data : [];
      const rows = list.flatMap((s) => (isObj(s) && s.symbolStatus === 'normal' && s.quoteCoin === 'USDT'
        ? [{ venueBase: String(s.baseCoin), inst: String(s.symbol) }] : []));
      return indexInstruments(rows, bases);
    },
    tickers: {
      urls: [`${REST}/tickers?productType=${INST_TYPE}`],
      parse([json]) {
        const list = isObj(json) && Array.isArray(json.data) ? json.data : [];
        return list.flatMap((d): FeedEvent[] => (isObj(d) ? [{
          kind: 'ticker', inst: String(d.symbol), last: num(d.lastPr), open24h: num(d.open24h), high24h: num(d.high24h),
          low24h: num(d.low24h), quoteVol: num(d.quoteVolume), funding: num(d.fundingRate),
        }] : []));
      },
    },
    // Bitget's `endTime` bounds bar close times: shift by one bar so the bar opening at `end` is included.
    klinesUrl: (meta, tf, limit, end) => (end === undefined
      ? `${REST}/candles?symbol=${meta.inst}&productType=${INST_TYPE}&granularity=${GRANULARITY[tf]}&limit=${limit}`
      : `${REST}/history-candles?symbol=${meta.inst}&productType=${INST_TYPE}&granularity=${GRANULARITY[tf]}&limit=${Math.min(limit, 200)}&endTime=${end + TIMEFRAME_MS[tf]}`),
    parseKlines: (json) => arrayKlines(isObj(json) ? json.data : [], KLINE_IDX),
    tradesUrl: (meta) => `${REST}/fills-history?symbol=${meta.inst}&productType=${INST_TYPE}&limit=1000`,
    parseTrades: (json) => parseTradeRows(isObj(json) ? json.data : []),
    olderTradesUrl: (meta, oldest) => (oldest.id ? `${REST}/fills-history?symbol=${meta.inst}&productType=${INST_TYPE}&limit=1000&idLessThan=${oldest.id}` : null),
    // Bitget publishes current OI (ticker `holdingAmount`) but no public history.
    oi: { periods: [] },
  },
};
