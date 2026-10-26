/**
 * Coinbase spot (USD). Market data via the Advanced Trade public WebSocket;
 * candles via the Exchange REST API. There is no funding on spot.
 */
import { arrayKlines, indexInstruments, isObj, num, safeJson, splitTopic, topic } from './shared';
import type { ExchangeAdapter, FeedEvent, Levels, RawTrade, Timeframe } from './types';

const URL = 'wss://advanced-trade-ws.coinbase.com';
const REST = 'https://api.exchange.coinbase.com';
// Native REST granularities; 3m / 30m / 4h are aggregated server-side from smaller ones.
const GRANULARITY: Partial<Record<Timeframe, number>> = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '1d': 86400 };

export const coinbase: ExchangeAdapter = {
  id: 'coinbase',
  name: 'Coinbase',
  market: 'spot',
  quote: 'USD',
  nativeTimeframes: ['1m', '5m', '15m', '1h', '1d'],
  klineLimit: 300,
  ws: {
    tickerUrl: URL,
    bookUrl: URL,
    tradeUrl: URL,
    // `heartbeats` keeps the socket alive when products are quiet.
    tickerTopics: (inst) => [topic('ticker', inst), topic('heartbeats', '*')],
    // level2 snapshots are large, so only the focused product gets a book.
    bookTopics: (inst, deep) => (deep ? [topic('level2', inst)] : []),
    klineUrl: URL,
    // The `candles` channel is 5m-only, so candles are built from `market_trades` instead.
    klineTopics: () => [],
    tradeTopics: (inst) => [topic('market_trades', inst)],
    oiTopics: () => [], // spot: no open interest
    frames(op, topics) {
      const byChannel = new Map<string, string[]>();
      for (const t of topics) {
        const [channel, inst] = splitTopic(t);
        const list = byChannel.get(channel) ?? [];
        if (inst !== '*') list.push(inst);
        byChannel.set(channel, list);
      }
      return [...byChannel].map(([channel, ids]) =>
        JSON.stringify(channel === 'heartbeats' ? { type: op, channel } : { type: op, channel, product_ids: ids }));
    },
    parse(raw) {
      const m = safeJson(raw);
      if (!isObj(m) || !Array.isArray(m.events)) return [];
      const out: FeedEvent[] = [];
      for (const ev of m.events) {
        if (!isObj(ev)) continue;
        if (m.channel === 'ticker' && Array.isArray(ev.tickers)) {
          for (const t of ev.tickers) {
            if (!isObj(t)) continue;
            const last = num(t.price);
            const pct = num(t.price_percent_chg_24_h);
            const baseVol = num(t.volume_24_h);
            out.push({
              kind: 'ticker',
              inst: String(t.product_id),
              last,
              open24h: last !== undefined && pct !== undefined ? last / (1 + pct / 100) : undefined,
              high24h: num(t.high_24_h),
              low24h: num(t.low_24_h),
              quoteVol: last !== undefined && baseVol !== undefined ? last * baseVol : undefined,
              funding: null,
            });
          }
        } else if (m.channel === 'market_trades' && Array.isArray(ev.trades)) {
          for (const tr of ev.trades) {
            if (!isObj(tr)) continue;
            const price = num(tr.price);
            const size = num(tr.size);
            const t = Date.parse(String(tr.time));
            if (price !== undefined && size !== undefined && Number.isFinite(t)) out.push({ kind: 'trade', inst: String(tr.product_id), price, size, t });
          }
        } else if (m.channel === 'l2_data' && Array.isArray(ev.updates)) {
          const bids: Levels = [];
          const asks: Levels = [];
          for (const u of ev.updates) {
            if (!isObj(u)) continue;
            const p = num(u.price_level);
            const s = num(u.new_quantity);
            if (p === undefined || s === undefined) continue;
            (u.side === 'bid' ? bids : asks).push([p, s]);
          }
          out.push({ kind: 'book', inst: String(ev.product_id), snapshot: ev.type === 'snapshot', bids, asks });
        }
      }
      return out;
    },
  },
  rest: {
    instrumentsUrl: `${REST}/products`,
    parseInstruments(json, bases) {
      const list = Array.isArray(json) ? json : [];
      const rows = list.flatMap((s) => (isObj(s) && s.status === 'online' && !s.trading_disabled && s.quote_currency === 'USD'
        ? [{ venueBase: String(s.base_currency), inst: String(s.id) }] : []));
      return indexInstruments(rows, bases);
    },
    tickers: {
      urls: [`${REST}/products/stats`],
      parse([json]) {
        if (!isObj(json)) return [];
        return Object.entries(json).flatMap(([inst, v]): FeedEvent[] => {
          const d = isObj(v) && isObj(v.stats_24hour) ? v.stats_24hour : null;
          if (!d || !inst.endsWith('-USD')) return [];
          const last = num(d.last);
          const baseVol = num(d.volume);
          return [{
            kind: 'ticker', inst, last, open24h: num(d.open), high24h: num(d.high), low24h: num(d.low),
            quoteVol: last !== undefined && baseVol !== undefined ? last * baseVol : undefined, funding: null,
          }];
        });
      },
    },
    klinesUrl: (meta, tf, _limit, end) => {
      const g = GRANULARITY[tf] ?? 60;
      if (end === undefined) return `${REST}/products/${meta.inst}/candles?granularity=${g}`;
      const iso = (ms: number) => new Date(ms).toISOString();
      return `${REST}/products/${meta.inst}/candles?granularity=${g}&start=${iso(end - 299 * g * 1000)}&end=${iso(end)}`;
    },
    // Rows are [time(s), low, high, open, close, volume], newest first.
    parseKlines: (json, _tf, limit) => arrayKlines(json, { t: 0, l: 1, h: 2, o: 3, c: 4, v: 5 }, 1000).slice(-limit),
    tradesUrl: (meta) => `${REST}/products/${meta.inst}/trades?limit=1000`,
    // `after` pages to older trades (by trade id).
    olderTradesUrl: (meta, oldest) => (oldest.id ? `${REST}/products/${meta.inst}/trades?limit=1000&after=${oldest.id}` : null),
    parseTrades(json) {
      if (!Array.isArray(json)) return [];
      const out: RawTrade[] = [];
      for (const r of json) {
        if (!isObj(r)) continue;
        const [price, size, t] = [num(r.price), num(r.size), Date.parse(String(r.time))];
        // Coinbase reports the maker side here, so aggressor side is left unset.
        if (price !== undefined && size !== undefined && Number.isFinite(t)) out.push({ t, price, size, ...(r.trade_id !== undefined ? { id: String(r.trade_id) } : {}) });
      }
      return out.sort((a, b) => a.t - b.t);
    },
  },
};
