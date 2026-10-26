/** Gate v4 USDT-settled futures. Book and candle sizes are contracts (quanto_multiplier per contract). */
import { chunk, indexInstruments, isObj, num, safeJson, splitTopic, topic } from './shared';
import type { ExchangeAdapter, FeedEvent, Levels, OiPoint, RawCandle, RawTrade, Timeframe } from './types';
import { isTimeframe, TIMEFRAME_MS } from './types';

const URL = 'wss://fx-ws.gateio.ws/v4/ws/usdt';
const REST = 'https://api.gateio.ws/api/v4/futures/usdt';
const OI_PERIODS: readonly Timeframe[] = ['5m', '15m', '30m', '1h', '4h', '1d'];

/** Gate trade sizes are signed contracts: negative = sell aggressor. Times may be s (with fraction) or ms. */
function gateTrade(r: unknown): RawTrade | null {
  if (!isObj(r)) return null;
  const price = num(r.price);
  const size = num(r.size);
  let t = num(r.create_time_ms) ?? (num(r.create_time) ?? NaN) * 1000;
  if (t < 1e12) t *= 1000;
  if (price === undefined || size === undefined || !Number.isFinite(t)) return null;
  return { t: Math.round(t), price, size: Math.abs(size), side: size < 0 ? 'sell' : 'buy', ...(r.id !== undefined ? { id: String(r.id) } : {}) };
}
const now = () => Math.floor(Date.now() / 1000);

function gateLevels(rows: unknown): Levels {
  if (!Array.isArray(rows)) return [];
  const out: Levels = [];
  for (const r of rows) {
    if (!isObj(r)) continue;
    const p = num(r.p);
    const s = num(r.s);
    if (p !== undefined && s !== undefined) out.push([p, s]);
  }
  return out;
}

/** REST and WS candles share the `{ t (s), o, h, l, c, v }` shape. */
function gateCandle(r: unknown): RawCandle | null {
  if (!isObj(r)) return null;
  const [t, o, h, l, c] = [num(r.t), num(r.o), num(r.h), num(r.l), num(r.c)];
  if (t === undefined || o === undefined || h === undefined || l === undefined || c === undefined) return null;
  return { t: t * 1000, o, h, l, c, v: num(r.v) ?? 0 };
}

export const gate: ExchangeAdapter = {
  id: 'gate',
  name: 'Gate',
  market: 'perp',
  quote: 'USDT',
  nativeTimeframes: ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '1d'],
  klineLimit: 2000,
  ws: {
    tickerUrl: URL,
    bookUrl: URL,
    tradeUrl: URL,
    tickerTopics: (inst) => [topic('futures.tickers', inst)],
    // `!all` streams every contract's ticker on one subscription.
    allTickerTopics: () => [topic('futures.tickers', '!all')],
    bookTopics: (inst) => [topic('futures.order_book', inst)],
    klineUrl: URL,
    klineTopics: (inst, tf) => [topic('futures.candlesticks', inst, tf)],
    tradeTopics: (inst) => [topic('futures.trades', inst)],
    oiTopics: (inst) => [topic('futures.tickers', inst)], // tickers carry total_size (open interest)
    frames(op, topics) {
      const tickers: string[] = [];
      const trades: string[] = [];
      const frames: string[] = [];
      for (const t of topics) {
        const [channel, inst, tf] = splitTopic(t);
        if (channel === 'futures.tickers') tickers.push(inst);
        else if (channel === 'futures.trades') trades.push(inst);
        // Book and candle subscriptions take one contract per request.
        else if (channel === 'futures.order_book') frames.push(JSON.stringify({ time: now(), channel, event: op, payload: [inst, '20', '0'] }));
        else if (channel === 'futures.candlesticks') frames.push(JSON.stringify({ time: now(), channel, event: op, payload: [tf, inst] }));
      }
      for (const payload of chunk(tickers, 20)) frames.push(JSON.stringify({ time: now(), channel: 'futures.tickers', event: op, payload }));
      for (const payload of chunk(trades, 20)) frames.push(JSON.stringify({ time: now(), channel: 'futures.trades', event: op, payload }));
      return frames;
    },
    ping: { everyMs: 20_000, frame: () => JSON.stringify({ time: now(), channel: 'futures.ping' }) },
    parse(raw) {
      const m = safeJson(raw);
      if (!isObj(m)) return [];
      const out: FeedEvent[] = [];
      if (m.channel === 'futures.tickers' && m.event === 'update' && Array.isArray(m.result)) {
        for (const t of m.result) {
          if (!isObj(t)) continue;
          const last = num(t.last);
          const pct = num(t.change_percentage);
          const inst = String(t.contract);
          out.push({
            kind: 'ticker',
            inst,
            last,
            open24h: last !== undefined && pct !== undefined ? last / (1 + pct / 100) : undefined,
            high24h: num(t.high_24h),
            low24h: num(t.low_24h),
            quoteVol: num(t.volume_24h_quote),
            funding: num(t.funding_rate),
          });
          const oi = num(t.total_size);
          if (oi !== undefined) out.push({ kind: 'oi', inst, value: oi, units: 'contracts' });
        }
      } else if (m.channel === 'futures.trades' && m.event === 'update' && Array.isArray(m.result)) {
        for (const r of m.result) {
          const tr = gateTrade(r);
          if (tr && isObj(r)) out.push({ kind: 'trade', inst: String(r.contract), ...tr });
        }
      } else if (m.channel === 'futures.candlesticks' && m.event === 'update' && Array.isArray(m.result)) {
        for (const r of m.result) {
          // `n` is "<interval>_<contract>", e.g. "1m_BTC_USDT".
          const name = isObj(r) ? String(r.n ?? '') : '';
          const cut = name.indexOf('_');
          const tf = name.slice(0, cut);
          const c = gateCandle(r);
          if (c && cut > 0 && isTimeframe(tf)) out.push({ kind: 'kline', inst: name.slice(cut + 1), tf, ...c });
        }
      } else if (m.channel === 'futures.order_book' && m.event === 'all' && isObj(m.result)) {
        out.push({ kind: 'book', inst: String(m.result.contract), snapshot: true, bids: gateLevels(m.result.bids), asks: gateLevels(m.result.asks) });
      }
      return out;
    },
  },
  rest: {
    instrumentsUrl: `${REST}/contracts`,
    parseInstruments(json, bases) {
      const list = Array.isArray(json) ? json : [];
      const rows = list.flatMap((s) => (isObj(s) && !s.in_delisting && String(s.name).endsWith('_USDT')
        ? [{ venueBase: String(s.name).slice(0, -5), inst: String(s.name), contractSize: num(s.quanto_multiplier) ?? 1 }] : []));
      return indexInstruments(rows, bases);
    },
    tickers: {
      urls: [`${REST}/tickers`],
      parse([json]) {
        return (Array.isArray(json) ? json : []).flatMap((t): FeedEvent[] => {
          if (!isObj(t)) return [];
          const last = num(t.last);
          const pct = num(t.change_percentage);
          return [{
            kind: 'ticker', inst: String(t.contract), last,
            open24h: last !== undefined && pct !== undefined ? last / (1 + pct / 100) : undefined,
            high24h: num(t.high_24h), low24h: num(t.low_24h), quoteVol: num(t.volume_24h_quote), funding: num(t.funding_rate),
          }];
        });
      },
    },
    // Gate rejects `limit` together with from / to, so older pages are a time window.
    klinesUrl: (meta, tf, limit, end) => {
      if (end === undefined) return `${REST}/candlesticks?contract=${meta.inst}&interval=${tf}&limit=${limit}`;
      const to = Math.floor(end / 1000);
      return `${REST}/candlesticks?contract=${meta.inst}&interval=${tf}&from=${to - (limit - 1) * (TIMEFRAME_MS[tf] / 1000)}&to=${to}`;
    },
    parseKlines: (json) => (Array.isArray(json) ? json.flatMap((r) => gateCandle(r) ?? []).sort((a, b) => a.t - b.t) : []),
    tradesUrl: (meta) => `${REST}/trades?contract=${meta.inst}&limit=1000`,
    // Up to the oldest trade's second (repeats are dropped by id).
    olderTradesUrl: (meta, oldest) => `${REST}/trades?contract=${meta.inst}&limit=1000&to=${Math.floor(oldest.t / 1000)}`,
    subMinuteKlines: {
      '30s': {
        maxLimit: 1000,
        url: (meta, limit, before) => (before === undefined
          ? `${REST}/candlesticks?contract=${meta.inst}&interval=30s&limit=${limit}`
          : `${REST}/candlesticks?contract=${meta.inst}&interval=30s&from=${Math.floor(before / 1000) - limit * 30}&to=${Math.floor(before / 1000) - 30}`),
      },
    },
    parseTrades: (json) => (Array.isArray(json) ? json.flatMap((r) => gateTrade(r) ?? []).sort((a, b) => a.t - b.t) : []),
    oi: {
      periods: OI_PERIODS,
      historyUrl: (meta, period, limit) => `${REST}/contract_stats?contract=${meta.inst}&interval=${period}&limit=${Math.min(limit, 500)}`,
      // open_interest is in contracts.
      parseHistory(json, meta) {
        if (!Array.isArray(json)) return [];
        const out: OiPoint[] = [];
        for (const r of json) {
          const t = isObj(r) ? num(r.time) : undefined;
          const oi = isObj(r) ? num(r.open_interest) : undefined;
          if (t !== undefined && oi !== undefined) out.push({ t: t * 1000, oi: oi * meta.contractSize });
        }
        return out.sort((a, b) => a.t - b.t);
      },
    },
  },
};
