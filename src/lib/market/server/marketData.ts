/**
 * Server-side market data helpers used by the `/api/market/*` route handlers.
 * Only URLs produced by an adapter are ever fetched.
 */
import { cacheLife } from 'next/cache';
import { ADAPTERS, KLINE_TIMEFRAMES, TIMEFRAME_MS } from '@/lib/market/exchanges';
import type { ExchangeId, FeedEvent, InstrumentMeta, OiPoint, RawCandle, RawTrade, SubMinute, Timeframe } from '@/lib/market/exchanges';
import { aggregate, candlesFromTrades, trimPartialHead } from '@/lib/market/exchanges/shared';
import { limiter, RateLimitedError } from '@/lib/server/scan/limiter';
import { recordBackfill, recordedCandles, recordsTrades, trackTrades, wasBackfilled } from './tradeRecorder';

export class UpstreamError extends Error {
  constructor(message: string, readonly status = 502) { super(message); }
}

/**
 * An API route's answer for a failed upstream call. Errors re-thrown from a `'use cache'`
 * function reach the route as Next's generic production error (neither an UpstreamError nor a
 * readable message), so anything that isn't our own UpstreamError gets a plain message.
 */
export function upstreamErrorResponse(e: unknown): Response {
  return e instanceof UpstreamError
    ? Response.json({ error: e.message }, { status: e.status })
    : Response.json({ error: 'The exchange didn’t respond' }, { status: 502 });
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

/** Most upstream requests one getKlines call spends (OKX / Coinbase: 300 per page; Bitget history: 200). */
const KLINE_PAGES = 8;

/** Oldest-first candles in base-unit prices and base-unit volume; non-native timeframes are aggregated. */
/** Latest `limit` candles, or (with `end`, ms) the `limit` candles opening at or before `end`. */
export async function getKlines(id: ExchangeId, base: string, tf: Timeframe, limit: number, end?: number): Promise<RawCandle[]> {
  const meta = await requireInstrument(id, base);
  const adapter = ADAPTERS[id];
  const src = baseTimeframe(id, tf);
  const factor = TIMEFRAME_MS[tf] / TIMEFRAME_MS[src];
  // Aggregated timeframes end on a whole target bar: the source window closes where that bar does.
  const srcEnd = end === undefined ? undefined : Math.floor(end / TIMEFRAME_MS[tf]) * TIMEFRAME_MS[tf] + TIMEFRAME_MS[tf] - TIMEFRAME_MS[src];
  const want = limit * factor;
  const page = async (pageEnd: number | undefined, n: number) => adapter.rest.parseKlines(await upstreamJson(adapter.rest.klinesUrl(meta, src, Math.min(n, adapter.klineLimit), pageEnd)), src, adapter.klineLimit)
    .filter((c) => pageEnd === undefined || c.t <= pageEnd);
  // More than one upstream page holds (a chart's full history): page back here, so the browser gets it in one answer.
  let raw = await page(srcEnd, want);
  for (let i = 1; raw.length < want && i < KLINE_PAGES; i++) {
    const before = raw[0]?.t;
    if (before === undefined) break;
    let older: RawCandle[];
    try { older = (await page(before - 1, want - raw.length)).filter((c) => c.t < before); } catch { break; } // keep what we have
    if (!older.length) break;
    raw = [...older, ...raw];
  }
  const k = meta.priceScale;
  const scaled = raw.map((c) => ({ t: c.t, o: c.o * k, h: c.h * k, l: c.l * k, c: c.c * k, v: c.v * meta.contractSize, ...(c.n === undefined ? {} : { n: c.n }), ...(c.tb === undefined ? {} : { tb: c.tb * meta.contractSize }) }));
  // Aggregated: the source window rarely starts on a target bar's open, so its first bar is dropped (partial).
  return (factor > 1 ? trimPartialHead(aggregate(scaled, TIMEFRAME_MS[tf]), scaled[0]?.t, TIMEFRAME_MS[tf]) : scaled).slice(-limit);
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
/**
 * Trades before id `firstId` (oldest first) back to time `until`, in pages of 1000 addressed by id,
 * fetched `BACKFILL_BATCH` at a time. Only pages contiguous with `firstId` are kept: a failed page
 * ends the backfill there (a hole in the trades would make wrong candles). `reachedStart`: id 0.
 */
async function backfillById(id: ExchangeId, meta: InstrumentMeta, firstId: number, until: number, maxPages: number): Promise<{ trades: RawTrade[]; reachedStart: boolean }> {
  const rest = ADAPTERS[id].rest;
  let out: RawTrade[] = [];
  for (let k = 1; k <= maxPages; k += BACKFILL_BATCH) {
    const ks = Array.from({ length: Math.min(BACKFILL_BATCH, maxPages - k + 1) }, (_, i) => k + i).filter((x) => firstId - (x - 1) * 1_000 > 0);
    if (!ks.length) return { trades: out, reachedStart: true };
    const pages = await Promise.all(ks.map((x) => upstreamJson(rest.tradesFromIdUrl!(meta, Math.max(0, firstId - x * 1_000))).then((j) => rest.parseTrades(j), () => null)));
    for (let i = 0; i < pages.length; i++) {
      const lo = Math.max(0, firstId - ks[i] * 1_000), hi = firstId - (ks[i] - 1) * 1_000;
      const page = pages[i]?.filter((t) => Number(t.id) >= lo && Number(t.id) < hi);
      if (!page?.length) return { trades: out, reachedStart: lo === 0 && !!page };
      out = [...page, ...out];
      if (lo === 0) return { trades: out, reachedStart: true };
      if (page[0].t <= until) return { trades: out, reachedStart: false };
    }
  }
  return { trades: out, reachedStart: false };
}

/** First-load backfill on venues with sequential trade ids: pages of 1000 trades, fetched in parallel batches. */
const BACKFILL_PAGES: Record<SubMinute, number> = { '30s': 24, '1s': 8 };
const BACKFILL_BATCH = 6;

const SUB_MINUTE: Record<SubMinute, { bars: number; pages: number }> = {
  '1s': { bars: 600, pages: 3 },
  '30s': { bars: 720, pages: 6 }, // 6 h — the server's recording (tradeRecorder) holds that much
};

const scaleCandle = (c: RawCandle, m: InstrumentMeta): RawCandle => ({
  t: c.t, o: c.o * m.priceScale, h: c.h * m.priceScale, l: c.l * m.priceScale, c: c.c * m.priceScale, v: c.v * m.contractSize,
  ...(c.n === undefined ? {} : { n: c.n }), ...(c.tb === undefined ? {} : { tb: c.tb * m.contractSize }),
});

/** Sub-minute candles plus the cursor for the page before them (null: no older history available). */
export interface SubMinutePage { candles: RawCandle[]; asOf: number; cursor: string | null }

/**
 * Where the next older page starts. Native candles: before the oldest candle's open. Trades: page
 * back from the oldest kept trade (`anchor`), keeping only trades before `start` (the oldest kept
 * bucket's open — earlier trades re-fetched from its second are already in the newer page).
 */
type Cursor = { kind: 'n'; before: number } | { kind: 't'; start: number; anchor: RawTrade } | { kind: 'r'; before: number };

function encodeCursor(c: Cursor): string {
  return c.kind === 'n' || c.kind === 'r' ? `${c.kind}.${c.before}` : `t.${c.start}.${c.anchor.t}.${encodeURIComponent(c.anchor.id ?? '')}`;
}

export function parseCursor(s: string | null | undefined): Cursor | null {
  if (!s || s.length > 200) return null;
  const [kind, a, b, id] = s.split('.');
  if ((kind === 'n' || kind === 'r') && Number.isFinite(Number(a)) && Number(a) > 0) return { kind, before: Number(a) };
  if (kind === 't' && Number(a) > 0 && Number(b) > 0 && id) return { kind: 't', start: Number(a), anchor: { t: Number(b), price: 0, size: 0, id: decodeURIComponent(id) } };
  return null;
}

/**
 * 1s / 30s history: the venue's own sub-minute candles where it has them (Gate 30s, OKX 1s —
 * 30s is aggregated from 1s), otherwise built from trades, paging back where the venue allows
 * (Binance, Bitget, Gate, Coinbase; Bybit and OKX trades: the latest page only). On venues
 * without sub-minute candles the server also records them from the trade stream
 * (tradeRecorder): those come before the trades page, and scroll back first.
 * Only complete buckets are returned (a first bucket the data started inside is dropped), and
 * `cursor` (passed back as `cursor`) loads the page before them — sub-minute charts scroll back.
 * `asOf`: trades after this time are not in the candles (the live stream adds them).
 */
export function getSubMinuteCandles(id: ExchangeId, base: string, tf: SubMinute, cursor: string | null = null): Promise<SubMinutePage> {
  // Charts opening the same series together share one load (paged trades cost real rate-limit weight).
  if (recordsTrades(id)) trackTrades(id, base);
  const key = `${id}|${base}|${tf}|${cursor ?? ''}`;
  const hit = subMinuteCache.get(key);
  if (hit && Date.now() - hit.at < SUB_MINUTE_CACHE_MS) return hit.p;
  const p = loadSubMinute(id, base, tf, parseCursor(cursor));
  subMinuteCache.set(key, { at: Date.now(), p });
  p.catch(() => subMinuteCache.delete(key));
  if (subMinuteCache.size > 500) for (const [k, v] of subMinuteCache) if (Date.now() - v.at >= SUB_MINUTE_CACHE_MS) subMinuteCache.delete(k);
  return p;
}

const SUB_MINUTE_CACHE_MS = 5_000;
const subMinuteCache = new Map<string, { at: number; p: Promise<SubMinutePage> }>();

async function loadSubMinute(id: ExchangeId, base: string, tf: SubMinute, cursor: Cursor | null): Promise<SubMinutePage> {
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
    const start = cursor?.kind === 'n' ? cursor.before : undefined;
    let out: RawCandle[] = [];
    for (let i = 0; i < pages; i++) {
      const before = out[0]?.t ?? start;
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
    const candles = (src === tf ? scaled : trimPartialHead(aggregate(scaled, span), scaled[0]?.t, span)).slice(-bars);
    return { candles, asOf, cursor: candles.length ? encodeCursor({ kind: 'n', before: candles[0].t }) : null };
  }

  // Recorded buckets before the cursor (scrolling back through the server's recording).
  if (cursor?.kind === 'r') {
    const candles = recordedCandles(id, base, tf, cursor.before, bars);
    const first = candles[0];
    return { candles, asOf: Date.now(), cursor: first && recordedCandles(id, base, tf, first.t, 1).length ? encodeCursor({ kind: 'r', before: first.t }) : null };
  }

  // Trades: the newest page (first load) or the pages before the cursor, oldest first.
  const older = cursor?.kind === 't' ? cursor : null;
  let trades = older ? [] : rest.parseTrades(await upstreamJson(rest.tradesUrl(meta)));
  const seen = new Set(trades.flatMap((t) => (t.id ? [t.id] : [])));
  let exhausted = !rest.olderTradesUrl;
  // First load: what the recording doesn't cover yet is backfilled from older trades, all pages
  // in parallel where the venue's trade ids are sequential (Binance, Coinbase).
  const newestT = trades[trades.length - 1]?.t ?? Date.now();
  const recordedFrom = older ? undefined : recordedCandles(id, base, tf)[0]?.t;
  const covered = recordedFrom !== undefined && (recordedFrom <= newestT - want + span || wasBackfilled(id, base, tf));
  const firstId = Number(trades[0]?.id);
  let budget = older ? pages : covered ? 1 : pages;
  if (!older && !covered && rest.tradesFromIdUrl && Number.isInteger(firstId) && firstId > 0) {
    const back = await backfillById(id, meta, firstId, newestT - want, BACKFILL_PAGES[tf]);
    back.trades.forEach((t) => seen.add(t.id!));
    trades = [...back.trades, ...trades];
    exhausted = back.reachedStart;
    budget = 1; // paged here
  }
  for (let i = older ? 0 : 1; i < budget && rest.olderTradesUrl; i++) {
    const oldest = trades[0] ?? older?.anchor;
    if (!oldest || (trades.length && trades[trades.length - 1].t - trades[0].t >= want)) break;
    const url = rest.olderTradesUrl(meta, oldest);
    if (!url) { exhausted = true; break; }
    let page: RawTrade[];
    try { page = rest.parseTrades(await upstreamJson(url)); } catch (e) { if (!trades.length && older) throw e; break; }
    const fresh = page.filter((t) => t.t <= oldest.t && !(t.id && (seen.has(t.id) || t.id === oldest.id)));
    if (!fresh.length) { exhausted = true; break; }
    fresh.forEach((t) => { if (t.id) seen.add(t.id); });
    trades = [...fresh, ...trades];
  }
  // Older pages: only what precedes the newer page's first bucket (the anchor's second may overlap it).
  if (older) trades = trades.filter((t) => t.t < older.start);
  const scaled = trades.map((t) => ({ ...t, price: t.price * meta.priceScale, size: t.size * meta.contractSize }));
  const built = candlesFromTrades(scaled, span, Infinity);
  // Trades start inside the oldest bucket, so it is partial — unless the venue's history ends there.
  // (A lone bucket is kept: a market so busy that every page fits in one bucket shows it partial.)
  const keepHead = (exhausted && older) || built.length < 2;
  const fromTrades = (keepHead ? built : built.slice(1)).slice(-bars);
  const asOf = older ? Date.now() : scaled[scaled.length - 1]?.t ?? Date.now();
  // The closed buckets these trades make (both sub-minute timeframes) go into the recording.
  if (!older && scaled.length > 1 && recordsTrades(id)) {
    for (const t of ['30s', '1s'] as const) {
      const sp = TIMEFRAME_MS[t];
      const all = candlesFromTrades(scaled, sp, Infinity);
      const closed = (exhausted ? all : all.slice(1)).filter((c) => c.t + sp <= asOf);
      // This request backfilled as deep as `tf` needs; that covers `t` too only if `t` needs no more.
      const complete = !covered && BACKFILL_PAGES[tf] >= BACKFILL_PAGES[t];
      recordBackfill(id, base, meta, t, closed, complete);
    }
  }
  // First load: the server's recording fills in before the trades page (the page is exact for the
  // recent minutes; the recording reaches back hours). Scrolling back continues in the recording.
  const recorded = older ? [] : recordedCandles(id, base, tf, fromTrades[0]?.t ?? Infinity);
  if (recorded.length) {
    const candles = [...recorded, ...fromTrades].slice(-bars);
    const head = candles[0];
    return { candles, asOf, cursor: recordedCandles(id, base, tf, head.t, 1).length ? encodeCursor({ kind: 'r', before: head.t }) : null };
  }
  const candles = fromTrades;
  const first = candles[0];
  const anchor = first ? trades.find((t) => t.t >= first.t) : undefined;
  return {
    candles,
    asOf,
    cursor: first && anchor && rest.olderTradesUrl && !exhausted ? encodeCursor({ kind: 't', start: first.t, anchor }) : null,
  };
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
