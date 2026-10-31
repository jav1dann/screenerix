/**
 * Live multi-exchange market service.
 *
 * - One hub channel per distinct WebSocket URL of each active venue
 *   (`socketHub.ts` shares sockets with chart cards and handles heartbeat,
 *   watchdog and reconnect).
 * - Instruments and candle history come from the `/api/market/*` proxy
 *   (server-side REST, no CORS); live ticks then extend history and candles.
 * - Exposes the shared `MarketFeed` contract so the terminal can switch
 *   between live data and the simulation transparently.
 *
 * Nothing touches the network until `start()` — safe to construct during SSR.
 */
import { fmtPct, fmtPrice, utcClock } from '@/lib/format';
import { deriveBook } from './book';
import { ALERT_MOVE_1M, TIMEFRAMES } from './constants';
import { ADAPTERS, EXCHANGE_IDS, TIMEFRAME_MS } from './exchanges';
import type { ExchangeAdapter, ExchangeId, FeedEvent, InstrumentMeta } from './exchanges';
import { createEmitter } from './feed';
import type { FeedConfig, MarketFeed } from './feed';
import { fetchInstruments, fetchKlines, fetchTickers, restrictionOf } from './marketApi';
import { openChannel } from './socketHub';
import type { SocketChannel } from './socketHub';
import type { AlertItem, Asset, Candle, OrderBook, StatusMap, VenueStatus } from './types';

const HISTORY_LEN = 90; // 1m closes kept per symbol (sparklines, 1m/5m change, map)
const CANDLE_LEN = 48; // candles per Market Review panel
const NOTIFY_MS = 250; // max UI refresh rate: 4 Hz
const FETCH_CONCURRENCY = 4;
const MINUTE = 60_000;
/*
 * Venues list hundreds of symbols. Every symbol gets live tickers (prices, volume,
 * funding); the heavier per-symbol data is limited to the most traded ones:
 */
const HISTORY_TOP = 60; // symbols seeded with 1m history (others build theirs from live ticks)
const BOOK_TOP = 30; // primary-venue symbols with a streamed order book (plus the focused one)
const RERANK_MS = 5 * 60_000; // how often the volume ranking (Market Map order) is refreshed
const INST_RETRY_MS = 2_000; // market list failed: first automatic retry, doubling…
const INST_RETRY_MAX_MS = 60_000; // …up to once a minute (Retry in the UI goes at once)
/** A venue that refuses our server's region is asked again when the server re-checks — and never more often than this. */
const RESTRICTED_RETRY_MIN_MS = 60_000;

const minuteOf = (t: number) => Math.floor(t / MINUTE) * MINUTE;

/* ───────────────────────── Venue state ───────────────────────── */

/** `open24h` is NaN until the venue reports it. `at`: when `last` arrived (0: its stream dropped since — stale). */
interface Quote { last: number; prev: number; open24h: number; quoteVol: number; funding: number | null; at: number }
interface LocalBook { bids: Map<number, number>; asks: Map<number, number> }
interface History { closes: number[]; minute: number }

interface Venue {
  id: ExchangeId;
  adapter: ExchangeAdapter;
  instStatus: 'idle' | 'loading' | 'ready' | 'error';
  instError?: string;
  /** Set with instStatus 'error' when the exchange refuses our server's region: the server's next check. */
  restricted?: { retryAt?: number };
  /** Failed market-list loads in a row (automatic retry backoff) and the pending retry. */
  instFailures: number;
  instRetry?: ReturnType<typeof setTimeout>;
  /** Same for the price / volume snapshot (live tickers may never come, e.g. sockets blocked). */
  snapFailures: number;
  snapRetry?: ReturnType<typeof setTimeout>;
  instruments: Record<string, InstrumentMeta>;
  byInst: Map<string, string>;
  quotes: Map<string, Quote>;
  books: Map<string, LocalBook>;
  history: Map<string, History>;
  /** Focus-symbol candles keyed `${symbol}|${tf}`; [] = unavailable. */
  candles: Map<string, Candle[]>;
  sockets: SocketChannel[];
  alertedMinute: Map<string, number>;
  /** Symbols by 24h quote volume, most traded first (drives Market Map order and the history / book budget). */
  rank: string[];
  /** The ranking reflects real volumes (snapshot loaded). */
  ranked: boolean;
}

async function pool<T>(items: T[], size: number, run: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      try { await run(item); } catch { /* per-item failures leave that symbol on live-only data */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
}

/* ───────────────────────── Feed ───────────────────────── */

export function createLiveFeed(): MarketFeed {
  const emitter = createEmitter(NOTIFY_MS);
  const notify = emitter.notify;
  const venues = new Map<ExchangeId, Venue>();
  let config: FeedConfig | null = null;
  let running = false;
  let alerts: AlertItem[] = [];
  let unread = 0;
  let historyFor = ''; // primary whose 1m history is loaded / loading
  let candlesFor = ''; // `${primary}|${focus}` whose candles are loaded / loading
  let historyGen = 0;
  let candleGen = 0;
  let marketMemo: { v: number; list: Asset[] } | null = null;
  let alertSeq = 0;
  let rerankTimer: ReturnType<typeof setInterval> | undefined;
  const bookMemo = new Map<string, { v: number; book: OrderBook | null }>();
  const levelMemo = new Map<string, { v: number; levels: { bids: Array<[number, number]>; asks: Array<[number, number]> } | null }>();

  const activeIds = (): Set<ExchangeId> =>
    running && config ? new Set([config.primary, ...config.compare]) : new Set();

  function venue(id: ExchangeId): Venue {
    const hit = venues.get(id);
    if (hit) return hit;
    const adapter = ADAPTERS[id];
    const v: Venue = {
      id, adapter, instStatus: 'idle', instFailures: 0, snapFailures: 0, instruments: {}, byInst: new Map(),
      quotes: new Map(), books: new Map(), history: new Map(), candles: new Map(),
      sockets: [], alertedMinute: new Map(), rank: [], ranked: false,
    };
    for (const url of new Set([adapter.ws.tickerUrl, adapter.ws.bookUrl])) {
      v.sockets.push(openChannel(adapter, url, {
        onEvents: (events) => handleEvents(v, events),
        onChange: notify,
        onReset: () => {
          if (url === adapter.ws.bookUrl) v.books.clear();
          // Prices received before the drop are no longer current: stale until the stream updates them.
          if (url === adapter.ws.tickerUrl) v.quotes.forEach((q) => { q.at = 0; });
          notify();
        },
      }));
    }
    venues.set(id, v);
    return v;
  }

  /** Symbol to load candles / deep book for: the focus if listed, else the most traded. */
  function focusOf(v: Venue): string | undefined {
    if (!config) return undefined;
    return v.instruments[config.focus] ? config.focus : (v.rank[0] ?? Object.keys(v.instruments)[0]);
  }

  /** Order symbols by 24h quote volume (unquoted symbols last). */
  function rerank(v: Venue): void {
    const vol = (sym: string) => v.quotes.get(sym)?.quoteVol ?? -1;
    v.rank = Object.keys(v.instruments).sort((a, b) => vol(b) - vol(a));
  }

  /** One REST call seeds every symbol's price / volume / funding, so the full list is ranked immediately. */
  async function loadSnapshot(v: Venue): Promise<void> {
    try {
      handleEvents(v, await fetchTickers(v.id));
      // Recovered after failures: the 1m history was tried against the dead venue too — reload it.
      if (v.snapFailures && historyFor === v.id) historyFor = '';
      v.snapFailures = 0;
    } catch (e) {
      // Refused from our server's region now (it served the market list before): the venue is restricted.
      const restricted = restrictionOf(e);
      if (restricted) { markRestricted(v, restricted, e); return; }
      // Live tickers may fill in; if they don't (venue down, sockets blocked) the snapshot retries.
      clearTimeout(v.snapRetry);
      const wait = Math.min(INST_RETRY_MAX_MS, INST_RETRY_MS * 2 ** v.snapFailures++);
      v.snapRetry = setTimeout(() => {
        v.snapRetry = undefined;
        if (activeIds().has(v.id) && v.instStatus === 'ready') void loadSnapshot(v);
      }, wait);
    }
    rerank(v);
    v.ranked = true;
    apply();
  }

  async function loadInstruments(v: Venue): Promise<void> {
    if (v.instStatus === 'loading' || v.instStatus === 'ready') return;
    v.instStatus = 'loading';
    v.instError = undefined;
    notify();
    try {
      const instruments = await fetchInstruments(v.id);
      v.instruments = instruments;
      v.byInst = new Map(Object.entries(instruments).map(([base, m]) => [m.inst, base]));
      v.rank = Object.keys(instruments);
      v.restricted = undefined;
      v.instStatus = Object.keys(instruments).length ? 'ready' : 'error';
      if (v.instStatus === 'error') v.instError = 'No active symbols listed';
      else { v.instFailures = 0; void loadSnapshot(v); }
    } catch (e) {
      const restricted = restrictionOf(e);
      if (restricted) { markRestricted(v, restricted, e); return; }
      v.instStatus = 'error';
      v.instError = `Market list unavailable: ${e instanceof Error ? e.message : String(e)}`;
    }
    if (v.instStatus === 'error') scheduleInstRetry(v);
    apply();
  }

  /**
   * The exchange refuses our server's region (HTTP 451 / 403): not an outage — show it as
   * restricted, drop its data and stream topics, and ask again only when the server re-checks.
   * Other venues are untouched.
   */
  function markRestricted(v: Venue, restricted: { retryAt?: number }, e: unknown): void {
    v.instStatus = 'error';
    v.instError = e instanceof Error ? e.message : 'Not available from our servers’ region';
    v.restricted = restricted;
    v.instruments = {}; v.byInst = new Map(); v.rank = []; v.ranked = false;
    v.quotes.clear(); v.books.clear(); v.history.clear(); v.candles.clear();
    v.sockets.forEach((s) => s.setTopics(new Set()));
    if (historyFor === v.id) historyFor = '';
    if (candlesFor.startsWith(`${v.id}|`)) candlesFor = '';
    clearTimeout(v.snapRetry); v.snapRetry = undefined; v.snapFailures = 0;
    clearTimeout(v.instRetry);
    const wait = Math.max(RESTRICTED_RETRY_MIN_MS, (restricted.retryAt ?? 0) - Date.now());
    v.instRetry = setTimeout(() => {
      v.instRetry = undefined;
      if (v.instStatus !== 'error') return;
      v.instStatus = 'idle';
      apply();
    }, wait);
    apply();
  }

  /**
   * After a failed market-list load: stay in `error` (shown with a Retry button) and try again
   * later, backing off. Never straight away — `apply` runs on every change and would otherwise
   * re-request the list in a tight loop while the venue is down.
   */
  function scheduleInstRetry(v: Venue): void {
    clearTimeout(v.instRetry);
    const wait = Math.min(INST_RETRY_MAX_MS, INST_RETRY_MS * 2 ** v.instFailures);
    v.instFailures++;
    v.instRetry = setTimeout(() => {
      v.instRetry = undefined;
      if (v.instStatus !== 'error') return;
      v.instStatus = 'idle';
      apply();
    }, wait);
  }

  async function loadHistory(v: Venue): Promise<void> {
    const gen = ++historyGen;
    const focus = focusOf(v);
    const symbols = [...new Set([...(focus ? [focus] : []), ...v.rank.slice(0, HISTORY_TOP)])];
    await pool(symbols, FETCH_CONCURRENCY, async (symbol) => {
      const candles = await fetchKlines(v.id, symbol, '1m', HISTORY_LEN).catch(() => []); // builds from live ticks instead
      if (gen !== historyGen || !candles.length) return;
      const closes = candles.map((c) => c.c);
      let minute = candles[candles.length - 1].t;
      const q = v.quotes.get(symbol);
      if (q && Number.isFinite(q.last)) {
        const now = minuteOf(Date.now());
        if (now > minute) { closes.push(q.last); minute = now; } else closes[closes.length - 1] = q.last;
      } else {
        // Quiet contracts may not tick for a while — show the last close until they do. A historical
        // close is not a current quote: `at` 0 keeps it out of anything that needs one (arbitrage).
        const last = closes[closes.length - 1];
        v.quotes.set(symbol, { last, prev: last, open24h: q?.open24h ?? NaN, quoteVol: q?.quoteVol ?? 0, funding: q?.funding ?? null, at: 0 });
      }
      v.history.set(symbol, { closes: closes.slice(-HISTORY_LEN), minute });
      notify();
    });
  }

  async function loadCandles(v: Venue, symbol: string): Promise<void> {
    const gen = ++candleGen;
    for (const { tf } of TIMEFRAMES) v.candles.delete(`${symbol}|${tf}`);
    notify();
    await pool([...TIMEFRAMES], FETCH_CONCURRENCY, async ({ tf }) => {
      let candles: Candle[] = [];
      try { candles = await fetchKlines(v.id, symbol, tf, CANDLE_LEN); } catch { /* shown as unavailable */ }
      if (gen !== candleGen) return;
      const q = v.quotes.get(symbol);
      const last = candles[candles.length - 1];
      if (q && last) { last.c = q.last; last.h = Math.max(last.h, q.last); last.l = Math.min(last.l, q.last); }
      v.candles.set(`${symbol}|${tf}`, candles);
      notify();
    });
  }

  /** Reconcile sockets, subscriptions and REST loads with the current config. */
  function apply(): void {
    const active = activeIds();
    for (const id of EXCHANGE_IDS) {
      if (!active.has(id)) {
        const v = venues.get(id);
        if (v) {
          v.sockets.forEach((s) => s.setTopics(new Set()));
          // Not shown any more: drop a pending market-list retry (it reloads when shown again).
          if (v.instRetry) { clearTimeout(v.instRetry); v.instRetry = undefined; v.instFailures = 0; if (v.instStatus === 'error') v.instStatus = 'idle'; }
          clearTimeout(v.snapRetry); v.snapRetry = undefined; v.snapFailures = 0;
          v.quotes.clear(); v.books.clear(); v.history.clear(); v.candles.clear();
        }
        continue;
      }
      const v = venue(id);
      // Only from idle: loading is in flight, a failed load waits for its retry (or Retry).
      if (v.instStatus !== 'ready') { if (v.instStatus === 'idle') void loadInstruments(v); continue; }

      const isPrimary = id === config?.primary;
      const focus = focusOf(v);
      const topics = new Map<string, Set<string>>(v.sockets.map((s) => [s.url, new Set<string>()]));
      const tickerTopics = topics.get(v.adapter.ws.tickerUrl);
      // Tickers for every symbol: one whole-market stream where the venue has it, else one topic each.
      const marketWide = v.adapter.ws.allTickerTopics?.();
      if (marketWide) marketWide.forEach((t) => tickerTopics?.add(t));
      // Order books only for the most traded symbols (and the focused one) on the primary venue.
      const booked = new Set(isPrimary ? [...v.rank.slice(0, BOOK_TOP), ...(focus ? [focus] : [])] : []);
      for (const [symbol, meta] of Object.entries(v.instruments)) {
        if (!marketWide) v.adapter.ws.tickerTopics(meta.inst).forEach((t) => tickerTopics?.add(t));
        const bookTopics = booked.has(symbol) ? v.adapter.ws.bookTopics(meta.inst, symbol === focus) : [];
        bookTopics.forEach((t) => topics.get(v.adapter.ws.bookUrl)?.add(t));
        if (!bookTopics.length) v.books.delete(symbol);
      }
      v.sockets.forEach((s) => s.setTopics(topics.get(s.url) ?? new Set()));
    }

    const p = config && active.has(config.primary) ? venues.get(config.primary) : undefined;
    if (p?.instStatus === 'ready') {
      if (p.ranked && historyFor !== p.id) { historyFor = p.id; void loadHistory(p); }
      const focus = focusOf(p);
      const key = `${p.id}|${focus}`;
      if (focus && candlesFor !== key) { candlesFor = key; void loadCandles(p, focus); }
    }
    notify();
  }

  function handleEvents(v: Venue, events: FeedEvent[]): void {
    for (const ev of events) {
      const symbol = v.byInst.get(ev.inst);
      if (!symbol) continue;
      const meta = v.instruments[symbol];
      if (ev.kind === 'ticker') {
        const q = v.quotes.get(symbol) ?? { last: NaN, prev: NaN, open24h: NaN, quoteVol: 0, funding: null, at: 0 };
        if (ev.quoteVol !== undefined) q.quoteVol = ev.quoteVol;
        if (ev.open24h !== undefined && ev.open24h > 0) q.open24h = ev.open24h * meta.priceScale;
        if (ev.funding !== undefined) q.funding = ev.funding;
        if (ev.last !== undefined) {
          const price = ev.last * meta.priceScale;
          q.prev = Number.isFinite(q.last) ? q.last : price;
          q.last = price;
          q.at = Date.now();
          v.quotes.set(symbol, q);
          onPrice(v, symbol, price);
        } else {
          v.quotes.set(symbol, q);
        }
      } else if (ev.kind === 'book') {
        let book = v.books.get(symbol);
        if (ev.snapshot) {
          book = { bids: new Map(), asks: new Map() };
          v.books.set(symbol, book);
        } else if (!book) {
          continue; // delta before snapshot — wait for the snapshot
        }
        const put = (side: Map<number, number>, levels: Array<[number, number]>) => {
          for (const [p, s] of levels) {
            const price = p * meta.priceScale;
            if (s === 0) side.delete(price); else side.set(price, s * meta.contractSize);
          }
        };
        put(book.bids, ev.bids);
        put(book.asks, ev.asks);
      }
    }
    notify();
  }

  function onPrice(v: Venue, symbol: string, price: number): void {
    const now = Date.now();
    let h = v.history.get(symbol);
    // Symbols outside the history budget build a 1m series from live ticks.
    if (!h) { h = { closes: [price], minute: minuteOf(now) }; v.history.set(symbol, h); }
    {
      const m = minuteOf(now);
      if (m > h.minute) {
        h.closes.push(price);
        if (h.closes.length > HISTORY_LEN) h.closes.shift();
        h.minute = m;
      } else {
        h.closes[h.closes.length - 1] = price;
      }
      if (v.id === config?.primary && h.closes.length >= 2) maybeAlert(v, symbol, h.closes[h.closes.length - 2], price, m);
    }
    for (const { tf } of TIMEFRAMES) {
      const series = v.candles.get(`${symbol}|${tf}`);
      const last = series?.[series.length - 1];
      if (!series || !last) continue;
      const span = TIMEFRAME_MS[tf];
      if (last.t !== undefined && now >= last.t + span) {
        series.push({ t: Math.floor(now / span) * span, o: last.c, h: Math.max(last.c, price), l: Math.min(last.c, price), c: price, v: 0 });
        if (series.length > CANDLE_LEN) series.shift();
      } else {
        last.c = price;
        last.h = Math.max(last.h, price);
        last.l = Math.min(last.l, price);
      }
    }
  }

  function maybeAlert(v: Venue, symbol: string, ref: number, price: number, minute: number): void {
    const move = price / ref - 1;
    if (Math.abs(move) < ALERT_MOVE_1M || v.alertedMinute.get(symbol) === minute) return;
    v.alertedMinute.set(symbol, minute);
    alerts = [{
      id: Date.now() * 1000 + (alertSeq++ % 1000),
      symbol,
      title: `${move > 0 ? 'Price spike' : 'Price drop'} ${fmtPct(move)} in 1m`,
      detail: `${fmtPrice(ref)} → ${fmtPrice(price)} · ${v.adapter.name}`,
      positive: move > 0,
      time: utcClock(),
    }, ...alerts].slice(0, 14);
    unread++;
  }

  function venueStatus(id: ExchangeId, active: Set<ExchangeId>): VenueStatus {
    const v = venues.get(id);
    if (!v || !active.has(id)) return { state: 'idle' };
    if (v.instStatus === 'error') return { state: 'error', error: v.instError, ...(v.restricted ? { restricted: v.restricted } : {}) };
    if (v.instStatus !== 'ready') return { state: 'connecting' };
    const live = v.sockets.filter((s) => s.state !== 'idle');
    if (!live.length) return { state: 'connecting' };
    for (const s of ['error', 'reconnecting', 'connecting'] as const) {
      const hit = live.find((x) => x.state === s);
      if (hit) return { state: s, error: hit.error };
    }
    return { state: 'live' };
  }

  const primaryVenue = (): Venue | undefined => {
    const v = config ? venues.get(config.primary) : undefined;
    return v && activeIds().has(v.id) ? v : undefined;
  };

  return {
    subscribe: emitter.subscribe,
    getVersion: emitter.getVersion,

    configure(next) {
      if (config && config.primary === next.primary && config.focus === next.focus && config.compare.join() === next.compare.join()) return;
      config = { ...next, compare: [...next.compare] };
      apply();
    },
    start() {
      if (running) return;
      running = true;
      // Volumes drift: refresh the ranking (Market Map order, book budget) periodically.
      rerankTimer = setInterval(() => {
        venues.forEach((v) => { if (v.ranked) rerank(v); });
        apply();
      }, RERANK_MS);
      apply();
    },
    stop() {
      if (!running) return;
      running = false;
      clearInterval(rerankTimer);
      historyFor = '';
      candlesFor = '';
      historyGen++;
      candleGen++;
      apply();
    },
    retry(id) {
      const v = venues.get(id);
      if (!v) return;
      if (v.instStatus === 'error') { clearTimeout(v.instRetry); v.instRetry = undefined; v.instFailures = 0; v.instStatus = 'idle'; }
      if (id === config?.primary) { historyFor = ''; candlesFor = ''; }
      v.sockets.forEach((s) => s.retry());
      apply();
    },

    getMarket() {
      const v = emitter.getVersion();
      if (marketMemo?.v === v) return marketMemo.list;
      const p = primaryVenue();
      const list: Asset[] = [];
      if (p) {
        // Most traded first: the Market Map pages through the venue in this order.
        p.rank.forEach((symbol, index) => {
          const q = p.quotes.get(symbol);
          if (!p.instruments[symbol] || !q || !Number.isFinite(q.last)) return;
          const closes = p.history.get(symbol)?.closes;
          list.push({
            symbol, index,
            history: closes && closes.length >= 2 ? closes : [q.prev, q.last],
            volume: q.quoteVol,
            change24h: q.open24h > 0 ? q.last / q.open24h - 1 : null,
            funding: q.funding,
            dir: q.last >= q.prev ? 1 : -1,
          });
        });
      }
      marketMemo = { v, list };
      return list;
    },
    getQuote(id, symbol) {
      const active = activeIds();
      const v = active.has(id) ? venues.get(id) : undefined;
      const q = v?.quotes.get(symbol);
      return v && q && Number.isFinite(q.last)
        ? { price: q.last, funding: q.funding, at: q.at, live: venueStatus(id, active).state === 'live' }
        : null;
    },
    getListed(id) {
      const v = activeIds().has(id) ? venues.get(id) : undefined;
      return v?.instStatus === 'ready' ? Object.keys(v.instruments) : [];
    },
    getCandles(symbol, tf) {
      return primaryVenue()?.candles.get(`${symbol}|${tf}`) ?? null;
    },
    getBook(symbol) {
      const v = emitter.getVersion();
      const key = `${config?.primary}|${symbol}`;
      const hit = bookMemo.get(key);
      if (hit && hit.v === v) return hit.book;
      const b = primaryVenue()?.books.get(symbol);
      const book = b
        ? deriveBook([...b.bids].sort((x, y) => y[0] - x[0]), [...b.asks].sort((x, y) => x[0] - y[0]))
        : null;
      bookMemo.set(key, { v, book });
      return book;
    },
    getLevels(symbol) {
      const v = emitter.getVersion();
      const key = `${config?.primary}|${symbol}`;
      const hit = levelMemo.get(key);
      if (hit && hit.v === v) return hit.levels;
      const b = primaryVenue()?.books.get(symbol);
      const levels = b && b.bids.size && b.asks.size
        ? { bids: [...b.bids].sort((x, y) => y[0] - x[0]), asks: [...b.asks].sort((x, y) => x[0] - y[0]) }
        : null;
      levelMemo.set(key, { v, levels });
      return levels;
    },
    getStatus() {
      const active = activeIds();
      return Object.fromEntries(EXCHANGE_IDS.map((id) => [id, venueStatus(id, active)])) as StatusMap;
    },
    getAlerts: () => alerts,
    pushAlert(alert) { alerts = [alert, ...alerts].slice(0, 14); unread++; notify(); },
    getUnread: () => unread,
    clearUnread() { unread = 0; notify(); },
  };
}
