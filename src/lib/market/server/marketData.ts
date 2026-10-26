/**
 * Server-side market data helpers used by the `/api/market/*` route handlers.
 * Only URLs produced by an adapter are ever fetched.
 */
import { cacheLife } from 'next/cache';
import { ADAPTERS, KLINE_TIMEFRAMES, TIMEFRAME_MS } from '@/lib/market/exchanges';
import type { ExchangeId, FeedEvent, InstrumentMeta, OiPoint, RawCandle, RawTrade, SubMinute, Timeframe } from '@/lib/market/exchanges';
import { aggregate, candlesFromTrades } from '@/lib/market/exchanges/shared';
import { limiter, RateLimitedError } from '@/lib/server/scan/limiter';

export class UpstreamError extends Error {
  constructor(message: string, readonly status = 502) { super(message); }
}

/** Base symbols are tickers like "BTC" or "1000SATS" — some venues also list non-Latin names (e.g. Binance "龙虾"). */
export const isBaseSymbol = (s: string): boolean => /^[\p{Lu}\p{Lo}\p{N}]{1,20}$/u.test(s);

/**
 * GET an exchange REST URL as JSON, within the shared upstream budget (see limiter.ts):
 * background-worker calls wait for their share; user-facing calls are charged and
 * fail fast with a 429 while the venue is rate-limited.
 */
export async function upstreamJson(url: string, timeoutMs = 10_000): Promise<unknown> {
  try {
    await limiter().acquire(url);
  } catch (e) {
    if (e instanceof RateLimitedError) throw new UpstreamError(e.message, 429);
    throw e;
  }
  let res: Response;
  try {
    res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'Screenerix/1.0' }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    throw new UpstreamError(`Upstream unreachable: ${e instanceof Error ? e.message : String(e)}`);
  }
  // Rate limits pass through as-is so clients back off; a rejected symbol (400 / 404) is a 404; other failures are a 502.
  if (!res.ok) {
    // An unread body holds its socket and buffers until GC.
    void res.body?.cancel().catch(() => {});
    limiter().report(url, res.status, res.headers.get('retry-after'));
    const status = res.status === 429 || res.status === 418 ? res.status : res.status === 400 || res.status === 404 ? 404 : 502;
    throw new UpstreamError(`Upstream HTTP ${res.status}`, status);
  }
  return res.json();
}

/**
 * Parsed instrument map of every listing on a venue, shared for 10 minutes (one in-flight download per venue).
 * Only the parsed map is kept: full contract lists are large (Gate's is ~1.3 MB) and can take 10–20s.
 * Usable outside requests (no `'use cache'`).
 */
const parsedLists = new Map<ExchangeId, { at: number; data: Promise<Record<string, InstrumentMeta>> }>();
export function loadInstruments(id: ExchangeId): Promise<Record<string, InstrumentMeta>> {
  const hit = parsedLists.get(id);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.data;
  const data = upstreamJson(ADAPTERS[id].rest.instrumentsUrl, 30_000).then((list) => ADAPTERS[id].rest.parseInstruments(list));
  data.catch(() => parsedLists.delete(id));
  parsedLists.set(id, { at: Date.now(), data });
  return data;
}

/** Any listed base symbol, from the shared parsed map (not a re-parse of the whole list per symbol). Usable outside requests. */
export function lookupInstrument(id: ExchangeId, base: string): Promise<InstrumentMeta | null> {
  return loadInstruments(id).then((all) => all[base] ?? null);
}

/** Base symbol → venue instrument for every active listing on the venue. Cached for hours. */
export async function getInstruments(id: ExchangeId): Promise<Record<string, InstrumentMeta>> {
  'use cache';
  cacheLife('hours');
  return loadInstruments(id);
}

/** Whole-market ticker snapshot (venue units). Shared by concurrent / back-to-back requests for a few seconds. */
const tickerSnapshots = new Map<ExchangeId, { at: number; data: Promise<FeedEvent[]> }>();
export function getTickers(id: ExchangeId): Promise<FeedEvent[]> {
  const hit = tickerSnapshots.get(id);
  if (hit && Date.now() - hit.at < 5_000) return hit.data;
  const { urls, parse } = ADAPTERS[id].rest.tickers;
  const data = Promise.all(urls.map((u) => upstreamJson(u, 30_000))).then(parse);
  data.catch(() => tickerSnapshots.delete(id));
  tickerSnapshots.set(id, { at: Date.now(), data });
  return data;
}

/** Resolve any base symbol (not just the universe) on a venue; null if unlisted. */
export async function getInstrument(id: ExchangeId, base: string): Promise<InstrumentMeta | null> {
  'use cache';
  cacheLife('hours');
  return lookupInstrument(id, base);
}

export async function requireInstrument(id: ExchangeId, base: string): Promise<InstrumentMeta> {
  // Plain memo (not `'use cache'`): the background worker calls this outside any request.
  const meta = await lookupInstrument(id, base);
  if (!meta) throw new UpstreamError(`${base} is not listed on ${ADAPTERS[id].name}`, 404);
  return meta;
}

/** Largest native timeframe that evenly divides `tf` (e.g. Coinbase 30m ← 15m). */
function baseTimeframe(id: ExchangeId, tf: Timeframe): Timeframe {
  const native = ADAPTERS[id].nativeTimeframes;
  if (native.includes(tf)) return tf;
  const span = TIMEFRAME_MS[tf];
  const options = KLINE_TIMEFRAMES.filter((t) => native.includes(t) && TIMEFRAME_MS[t] < span && span % TIMEFRAME_MS[t] === 0);
  const base = options[options.length - 1];
  if (!base) throw new UpstreamError(`${tf} is not available on ${ADAPTERS[id].name}`, 400);
  return base;
}

/** Oldest-first candles in base-unit prices and base-unit volume; non-native timeframes are aggregated. */
/** Latest `limit` candles, or (with `end`, ms) the `limit` candles opening at or before `end`. */
export async function getKlines(id: ExchangeId, base: string, tf: Timeframe, limit: number, end?: number): Promise<RawCandle[]> {
  const meta = await requireInstrument(id, base);
  const adapter = ADAPTERS[id];
  const src = baseTimeframe(id, tf);
  const factor = TIMEFRAME_MS[tf] / TIMEFRAME_MS[src];
  // Aggregated timeframes end on a whole target bar: the source window closes where that bar does.
  const srcEnd = end === undefined ? undefined : Math.floor(end / TIMEFRAME_MS[tf]) * TIMEFRAME_MS[tf] + TIMEFRAME_MS[tf] - TIMEFRAME_MS[src];
  const raw = adapter.rest.parseKlines(await upstreamJson(adapter.rest.klinesUrl(meta, src, Math.min(limit * factor, adapter.klineLimit), srcEnd)), src, adapter.klineLimit)
    .filter((c) => srcEnd === undefined || c.t <= srcEnd);
  const k = meta.priceScale;
  const scaled = raw.map((c) => ({ t: c.t, o: c.o * k, h: c.h * k, l: c.l * k, c: c.c * k, v: c.v * meta.contractSize, ...(c.n === undefined ? {} : { n: c.n }), ...(c.tb === undefined ? {} : { tb: c.tb * meta.contractSize }) }));
  return (factor > 1 ? aggregate(scaled, TIMEFRAME_MS[tf]) : scaled).slice(-limit);
}

/** Recent public trades, oldest first, in base units. */
export async function getTrades(id: ExchangeId, base: string): Promise<RawTrade[]> {
  const meta = await requireInstrument(id, base);
  const adapter = ADAPTERS[id];
  return adapter.rest.parseTrades(await upstreamJson(adapter.rest.tradesUrl(meta)))
    .map((t) => ({ ...t, price: t.price * meta.priceScale, size: t.size * meta.contractSize }));
}

/**
 * How much sub-minute history a chart opens with, and the most upstream requests spent on it.
 * Thin markets reach `bars` in one page; for the busiest the page budget is the limit.
 */
const SUB_MINUTE: Record<SubMinute, { bars: number; pages: number }> = {
  '1s': { bars: 600, pages: 3 },
  '30s': { bars: 240, pages: 6 },
};

const scaleCandle = (c: RawCandle, m: InstrumentMeta): RawCandle => ({
  t: c.t, o: c.o * m.priceScale, h: c.h * m.priceScale, l: c.l * m.priceScale, c: c.c * m.priceScale, v: c.v * m.contractSize,
  ...(c.n === undefined ? {} : { n: c.n }), ...(c.tb === undefined ? {} : { tb: c.tb * m.contractSize }),
});

/**
 * 1s / 30s history: the venue's own sub-minute candles where it has them (Gate 30s, OKX 1s —
 * 30s is aggregated from 1s), otherwise built from trades, paging back where the venue allows
 * (Binance, Bitget, Gate, Coinbase; Bybit and OKX trades: the latest page only).
 * `asOf`: trades after this time are not in the candles (the live stream adds them).
 */
export function getSubMinuteCandles(id: ExchangeId, base: string, tf: SubMinute): Promise<{ candles: RawCandle[]; asOf: number }> {
  // Charts opening the same series together share one load (paged trades cost real rate-limit weight).
  const key = `${id}|${base}|${tf}`;
  const hit = subMinuteCache.get(key);
  if (hit && Date.now() - hit.at < SUB_MINUTE_CACHE_MS) return hit.p;
  const p = loadSubMinute(id, base, tf);
  subMinuteCache.set(key, { at: Date.now(), p });
  p.catch(() => subMinuteCache.delete(key));
  if (subMinuteCache.size > 500) for (const [k, v] of subMinuteCache) if (Date.now() - v.at >= SUB_MINUTE_CACHE_MS) subMinuteCache.delete(k);
  return p;
}

const SUB_MINUTE_CACHE_MS = 5_000;
const subMinuteCache = new Map<string, { at: number; p: Promise<{ candles: RawCandle[]; asOf: number }> }>();

async function loadSubMinute(id: ExchangeId, base: string, tf: SubMinute): Promise<{ candles: RawCandle[]; asOf: number }> {
  const meta = await requireInstrument(id, base);
  const rest = ADAPTERS[id].rest;
  const span = TIMEFRAME_MS[tf];
  const { bars, pages } = SUB_MINUTE[tf];
  const want = bars * span;
  const native = rest.subMinuteKlines;
  const src: SubMinute | null = native?.[tf] ? tf : tf === '30s' && native?.['1s'] ? '1s' : null;

  if (src) {
    const k = native![src]!;
    const asOf = Date.now();
    let out: RawCandle[] = [];
    for (let i = 0; i < pages; i++) {
      const before = out[0]?.t;
      let page: RawCandle[];
      try {
        page = rest.parseKlines(await upstreamJson(k.url(meta, k.maxLimit, before)), src, k.maxLimit).filter((c) => before === undefined || c.t < before);
      } catch (e) {
        if (!out.length) throw e;
        break; // keep what we have (e.g. rate-limited mid-way)
      }
      if (!page.length) break;
      out = [...page, ...out];
      if (out[out.length - 1].t - out[0].t >= want) break;
    }
    const scaled = out.map((c) => scaleCandle(c, meta));
    return { candles: (src === tf ? scaled : aggregate(scaled, span)).slice(-bars), asOf };
  }

  let trades = rest.parseTrades(await upstreamJson(rest.tradesUrl(meta)));
  const seen = new Set(trades.flatMap((t) => (t.id ? [t.id] : [])));
  for (let i = 1; i < pages && rest.olderTradesUrl && trades.length; i++) {
    if (trades[trades.length - 1].t - trades[0].t >= want) break;
    const url = rest.olderTradesUrl(meta, trades[0]);
    if (!url) break;
    let older: RawTrade[];
    try { older = rest.parseTrades(await upstreamJson(url)); } catch { break; }
    const oldestT = trades[0].t;
    const fresh = older.filter((t) => t.t <= oldestT && !(t.id && seen.has(t.id)));
    if (!fresh.length) break;
    fresh.forEach((t) => { if (t.id) seen.add(t.id); });
    trades = [...fresh, ...trades];
  }
  const scaled = trades.map((t) => ({ ...t, price: t.price * meta.priceScale, size: t.size * meta.contractSize }));
  return { candles: candlesFromTrades(scaled, span, Infinity).slice(-bars), asOf: scaled[scaled.length - 1]?.t ?? Date.now() };
}

/** OI period for a chart timeframe: the largest supported period ≤ tf (min 5m), or null if no history. */
export function oiPeriod(id: ExchangeId, tf: string): Timeframe | null {
  const periods = ADAPTERS[id].rest.oi?.periods ?? [];
  if (!periods.length) return null;
  const span = TIMEFRAME_MS[tf as Timeframe] ?? 0;
  const fit = periods.filter((p) => TIMEFRAME_MS[p] <= span);
  return fit[fit.length - 1] ?? periods[0];
}

/** Open-interest history in base units; [] where the venue publishes none. */
export async function getOiHistory(id: ExchangeId, base: string, period: Timeframe, limit: number): Promise<OiPoint[]> {
  const oi = ADAPTERS[id].rest.oi;
  if (!oi?.historyUrl || !oi.parseHistory) return [];
  const meta = await requireInstrument(id, base);
  return oi.parseHistory(await upstreamJson(oi.historyUrl(meta, period, limit)), meta);
}

/** Current open interest in base units, for venues without a live OI stream. */
export async function getOiCurrent(id: ExchangeId, base: string): Promise<number | null> {
  const oi = ADAPTERS[id].rest.oi;
  if (!oi?.currentUrl || !oi.parseCurrent) return null;
  const meta = await requireInstrument(id, base);
  return oi.parseCurrent(await upstreamJson(oi.currentUrl(meta)), meta);
}
