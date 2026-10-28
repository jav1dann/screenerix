/**
 * Live candle + 24h stats stream for one (exchange, symbol, timeframe).
 *
 * Streams are shared and ref-counted: every chart showing the same key reads
 * the same series. Each key follows one of two plans:
 *  - kline:  seed from the klines proxy, extend with the venue's kline stream;
 *  - trades: sub-minute timeframes (seeded from the server's 1s / 30s history:
 *            native candles or paged trades) and venues without a kline stream
 *            (seeded from klines), extended by folding live trades into buckets.
 * Sockets are shared with the rest of the app via `socketHub`.
 */
import { ADAPTERS, TIMEFRAME_MS } from './exchanges';
import { applyTrade } from './exchanges/shared';
import type { ChartTimeframe, ExchangeAdapter, ExchangeId, FeedEvent, InstrumentMeta, RawCandle, RawTrade, SubMinute, Timeframe } from './exchanges';
import { createEmitter } from './feed';
import { fetchInstrument, fetchKlines, fetchSubMinute } from './marketApi';
import { openChannel } from './socketHub';
import { RANGE_MINUTES, RANGE_WINDOWS } from './terminalPrefs';
import type { RangeWindow } from './terminalPrefs';
import type { SocketChannel } from './socketHub';
import type { ConnState } from './types';

const SEED_LIMIT = 300;
/** 1m candles kept for range stats — enough for the longest window (4h). */
const MINUTE_SEED = Math.max(...Object.values(RANGE_MINUTES));
const RELEASE_DELAY_MS = 2_000; // survive quick unmount/remount (StrictMode, tab switches)

export interface ChartKey { exchange: ExchangeId; symbol: string; tf: ChartTimeframe }

export interface ChartStats {
  last: number | null;
  /** (high − low) / low over the trailing window, from 1m candles. */
  ranges: Record<RangeWindow, number | null>;
  high24h: number | null;
  low24h: number | null;
  /** (high − low) / low over 24h. */
  range24h: number | null;
  change24h: number | null;
  /** Only venues that publish a 24h trade count (Binance). */
  trades24h: number | null;
  /** 24h turnover in quote currency. */
  volume24h: number | null;
}

export type ChartStatus = 'loading' | 'ready' | 'unlisted' | 'error';

export interface ChartSnapshot {
  status: ChartStatus;
  error?: string;
  conn: ConnState;
  meta: InstrumentMeta | null;
  stats: ChartStats;
}

export type ChartDataEvent = { type: 'reset'; candles: RawCandle[] } | { type: 'update'; candle: RawCandle };

export interface ChartStream {
  readonly key: ChartKey;
  /** Throttled (4 Hz) React-facing state. */
  subscribe(listener: () => void): () => void;
  getSnapshot(): ChartSnapshot;
  /** Every candle change, unthrottled — for imperative chart updates. */
  onData(listener: (e: ChartDataEvent) => void): () => void;
  getCandles(): RawCandle[];
  /** Hold the stream open; returns a release function. */
  retain(): () => void;
  retry(): void;
  /**
   * Prepend the page of candles before the oldest one (for scrolling back / go-to-date). Sub-minute
   * timeframes page back through the server's cursor (native candles or older trades).
   * Resolves false at the start of the available history or while not ready.
   */
  loadOlder(): Promise<boolean>;
}

const EMPTY_RANGES = Object.fromEntries(RANGE_WINDOWS.map((w) => [w, null])) as Record<RangeWindow, number | null>;

const EMPTY_STATS: ChartStats = {
  last: null, ranges: EMPTY_RANGES, high24h: null, low24h: null, range24h: null, change24h: null, trades24h: null, volume24h: null,
};

const isSubMinute = (tf: ChartTimeframe): tf is SubMinute => tf === '1s' || tf === '30s';

/** Whether the venue streams klines for `tf` (otherwise candles are folded from trades). */
function streamsKlines(adapter: ExchangeAdapter, tf: ChartTimeframe): tf is Timeframe {
  return !isSubMinute(tf) && adapter.nativeTimeframes.includes(tf as Timeframe) && adapter.ws.klineTopics('_', tf as Timeframe).length > 0;
}

/** Apply a candle to a series: replace the current bar, append a newer one, ignore older ones. */
function applyCandle(series: RawCandle[], c: RawCandle, max: number): boolean {
  const last = series[series.length - 1];
  if (!last || c.t > last.t) {
    series.push(c);
    if (series.length > max) series.shift();
    return true;
  }
  if (c.t === last.t) {
    series[series.length - 1] = c;
    return true;
  }
  return false;
}

function createChartStream(key: ChartKey): ChartStream & { dispose(): void } {
  const { exchange, symbol, tf } = key;
  const adapter = ADAPTERS[exchange];
  const emitter = createEmitter(250);
  const dataListeners = new Set<(e: ChartDataEvent) => void>();
  const span = TIMEFRAME_MS[tf];
  const klineMode = streamsKlines(adapter, tf);
  const needsMinute = tf !== '1m';
  const minuteFromTrades = needsMinute && !streamsKlines(adapter, '1m');
  // Grows when older history is prepended, so live bars don't trim what was loaded.
  let maxCandles = isSubMinute(tf) ? 2_000 : 1_000;
  let olderReq: Promise<boolean> | null = null;
  let historyStart = false;
  /** Sub-minute: where the page before the oldest candle starts (null: none available). */
  let subCursor: string | null = null;

  let status: ChartStatus = 'loading';
  let error: string | undefined;
  let meta: InstrumentMeta | null = null;
  let candles: RawCandle[] = [];
  let minute: RawCandle[] = []; // 1m series for range stats (aliases `candles` when tf = 1m)
  let seeded = false;
  const pendingCandles: RawCandle[] = []; // live klines that arrived before the REST seed
  const pendingTrades: RawTrade[] = []; // live trades that arrived before the REST seed
  const ticker = { last: NaN, open24h: NaN, high24h: NaN, low24h: NaN, trades24h: NaN, quoteVol: NaN };
  let channels: SocketChannel[] = [];
  let refs = 0;
  let gen = 0;
  let started = false;
  let snapshot: { v: number; s: ChartSnapshot } | null = null;

  const emit = (e: ChartDataEvent) => dataListeners.forEach((l) => l(e));
  const fin = (n: number) => (Number.isFinite(n) ? n : null);
  const scaleCandle = (c: RawCandle, m: InstrumentMeta): RawCandle => ({
    t: c.t, o: c.o * m.priceScale, h: c.h * m.priceScale, l: c.l * m.priceScale, c: c.c * m.priceScale, v: c.v * m.contractSize,
    ...(c.tb === undefined ? {} : { tb: c.tb * m.contractSize }),
  });

  function onEvents(events: FeedEvent[]): void {
    const m = meta;
    if (!m) return;
    let changed = false;
    for (const ev of events) {
      if (ev.inst !== m.inst) continue;
      if (ev.kind === 'ticker') {
        if (ev.last !== undefined) ticker.last = ev.last * m.priceScale;
        if (ev.open24h !== undefined) ticker.open24h = ev.open24h * m.priceScale;
        if (ev.high24h !== undefined) ticker.high24h = ev.high24h * m.priceScale;
        if (ev.low24h !== undefined) ticker.low24h = ev.low24h * m.priceScale;
        if (ev.trades24h !== undefined) ticker.trades24h = ev.trades24h;
        if (ev.quoteVol !== undefined) ticker.quoteVol = ev.quoteVol;
        changed = true;
      } else if (ev.kind === 'kline') {
        const c = scaleCandle(ev, m);
        if (klineMode && ev.tf === tf) {
          if (!seeded) pendingCandles.push(c);
          else if (applyCandle(candles, c, maxCandles)) emit({ type: 'update', candle: c });
          changed = true;
        }
        if (needsMinute && !minuteFromTrades && ev.tf === '1m' && seeded) { applyCandle(minute, c, maxCandles); changed = true; }
      } else if (ev.kind === 'trade') {
        const trade: RawTrade = { t: ev.t, price: ev.price * m.priceScale, size: ev.size * m.contractSize, side: ev.side };
        if (!seeded) { pendingTrades.push(trade); continue; }
        if (!klineMode) {
          const c = applyTrade(candles, span, trade.price, trade.size, trade.t, maxCandles, trade.side);
          if (c) emit({ type: 'update', candle: c });
        }
        if (minuteFromTrades) applyTrade(minute, TIMEFRAME_MS['1m'], trade.price, trade.size, trade.t, maxCandles, trade.side);
        changed = true;
      }
    }
    if (changed) emitter.notify();
  }

  function subscribeTopics(m: InstrumentMeta): void {
    const byUrl = new Map<string, Set<string>>();
    const add = (url: string, topics: string[]) => {
      const set = byUrl.get(url) ?? new Set<string>();
      topics.forEach((t) => set.add(t));
      byUrl.set(url, set);
    };
    add(adapter.ws.tickerUrl, adapter.ws.tickerTopics(m.inst));
    if (klineMode) add(adapter.ws.klineUrl, adapter.ws.klineTopics(m.inst, tf));
    if (needsMinute && !minuteFromTrades) add(adapter.ws.klineUrl, adapter.ws.klineTopics(m.inst, '1m'));
    if (!klineMode || minuteFromTrades) add(adapter.ws.tradeUrl, adapter.ws.tradeTopics(m.inst));
    channels = [...byUrl].map(([url, topics]) => {
      // After a reconnect, refetch history so the series has no gap.
      const ch = openChannel(adapter, url, { onEvents, onChange: emitter.notify, onReset: () => { if (seeded) seed(gen).catch(() => { /* keep the live-extended series */ }); } });
      ch.setTopics(topics);
      return ch;
    });
  }

  /** Download history and splice in any live data that arrived meanwhile. */
  async function seed(g: number): Promise<void> {
    const subMinute = isSubMinute(tf);
    const [main, oneMinute] = await Promise.all([
      subMinute
        ? fetchSubMinute(exchange, symbol, tf).then((r) => ({ candles: r.candles, lastTrade: r.asOf, cursor: r.cursor }))
        : fetchKlines(exchange, symbol, tf as Timeframe, SEED_LIMIT).then((c) => ({ candles: c, lastTrade: Date.now(), cursor: null })),
      needsMinute ? fetchKlines(exchange, symbol, '1m', MINUTE_SEED) : Promise.resolve(null),
    ]);
    if (g !== gen) return;
    const live = seeded ? candles.slice(-1) : pendingCandles.splice(0);
    // A re-seed (after a reconnect) keeps the older history already paged in before the new page.
    const first = main.candles[0]?.t;
    const kept = seeded && first !== undefined ? candles.filter((c) => c.t < first) : [];
    candles = [...kept, ...main.candles];
    if (!kept.length) {
      subCursor = main.cursor;
      historyStart = subMinute && !subCursor;
    }
    minute = oneMinute ?? candles;
    live.forEach((c) => applyCandle(candles, c, maxCandles));
    // Replay buffered trades that the REST seed didn't already include.
    for (const t of pendingTrades.splice(0)) {
      if (!klineMode && t.t > main.lastTrade) applyTrade(candles, span, t.price, t.size, t.t, maxCandles, t.side);
      if (minuteFromTrades) applyTrade(minute, TIMEFRAME_MS['1m'], t.price, t.size, t.t, maxCandles, t.side);
    }
    seeded = true;
    status = 'ready';
    emit({ type: 'reset', candles });
    emitter.notify();
  }

  /** Automatic re-attempts of a failed load (transient upstream / network errors), before showing the error. */
  const RETRY_DELAYS_MS = [2_000, 5_000, 15_000];
  let attempts = 0;

  async function start(): Promise<void> {
    const g = ++gen;
    historyStart = false;
    status = 'loading';
    error = undefined;
    seeded = false;
    pendingCandles.length = 0;
    pendingTrades.length = 0;
    emitter.notify();
    try {
      const m = await fetchInstrument(exchange, symbol);
      if (g !== gen) return;
      if (!m) { status = 'unlisted'; emitter.notify(); return; }
      meta = m;
      subscribeTopics(m); // stream while the seed downloads; early data is buffered
      await seed(g);
      if (g === gen) attempts = 0;
    } catch (e) {
      if (g !== gen) return;
      const delay = RETRY_DELAYS_MS[attempts];
      if (delay !== undefined) {
        attempts++;
        setTimeout(() => {
          if (g !== gen || !started) return;
          channels.forEach((c) => c.close()); // start() re-subscribes
          channels = [];
          void start();
        }, delay);
        return; // stays 'loading' while retrying
      }
      status = 'error';
      error = e instanceof Error ? e.message : String(e);
      emitter.notify();
    }
  }

  function stop(): void {
    gen++;
    started = false;
    channels.forEach((c) => c.close());
    channels = [];
  }

  function connState(): ConnState {
    if (!channels.length) return status === 'loading' ? 'connecting' : 'idle';
    for (const s of ['error', 'reconnecting', 'connecting'] as const) if (channels.some((c) => c.state === s)) return s;
    return 'live';
  }

  function buildStats(): ChartStats {
    const lastCandle = candles[candles.length - 1];
    const last = fin(ticker.last) ?? lastCandle?.c ?? null;
    // Walk back from the newest 1m candle once, widening the window as we go.
    const ranges = { ...EMPTY_RANGES };
    const newest = minute[minute.length - 1];
    if (newest) {
      let hi = -Infinity;
      let lo = Infinity;
      let w = 0;
      const windows = RANGE_WINDOWS.map((r) => ({ r, from: newest.t - (RANGE_MINUTES[r] - 1) * 60_000 }));
      for (let i = minute.length - 1; i >= 0 && w < windows.length; i--) {
        const c = minute[i];
        while (w < windows.length && c.t < windows[w].from) {
          ranges[windows[w].r] = lo > 0 && Number.isFinite(hi) ? (hi - lo) / lo : null;
          w++;
        }
        hi = Math.max(hi, c.h);
        lo = Math.min(lo, c.l);
      }
      // Windows reaching past the oldest candle use everything we have.
      for (; w < windows.length; w++) ranges[windows[w].r] = lo > 0 && Number.isFinite(hi) ? (hi - lo) / lo : null;
    }
    const high24h = fin(ticker.high24h);
    const low24h = fin(ticker.low24h);
    const open24h = fin(ticker.open24h);
    return {
      last,
      ranges,
      high24h,
      low24h,
      range24h: high24h !== null && low24h ? (high24h - low24h) / low24h : null,
      change24h: last !== null && open24h ? last / open24h - 1 : null,
      trades24h: fin(ticker.trades24h),
      volume24h: fin(ticker.quoteVol),
    };
  }

  const self: ChartStream & { dispose(): void } = {
    key,
    subscribe: emitter.subscribe,
    getSnapshot() {
      const v = emitter.getVersion();
      if (snapshot?.v === v) return snapshot.s;
      const s: ChartSnapshot = { status, error, conn: connState(), meta, stats: status === 'loading' && !meta ? EMPTY_STATS : buildStats() };
      snapshot = { v, s };
      return s;
    },
    onData(listener) {
      dataListeners.add(listener);
      return () => { dataListeners.delete(listener); };
    },
    getCandles: () => candles,
    retain() {
      refs++;
      if (!started) {
        started = true;
        streams.set(keyOf(key), self); // re-register if this instance was released earlier
        void start();
      }
      let released = false;
      return () => {
        if (released) return;
        released = true;
        refs--;
        if (refs === 0) setTimeout(() => { if (refs === 0) release(key); }, RELEASE_DELAY_MS);
      };
    },
    loadOlder() {
      if (status !== 'ready' || historyStart || !candles.length) return Promise.resolve(false);
      if (olderReq) return olderReq;
      const g = gen;
      const page: Promise<RawCandle[]> = isSubMinute(tf)
        ? fetchSubMinute(exchange, symbol, tf, subCursor ?? undefined).then((r) => {
          if (g === gen) subCursor = r.cursor;
          return r.candles;
        })
        : fetchKlines(exchange, symbol, tf as Timeframe, SEED_LIMIT, candles[0].t - 1);
      olderReq = page
        .then((older) => {
          if (g !== gen) return false;
          const head = older.filter((c) => c.t < candles[0].t);
          if (!head.length) { if (!isSubMinute(tf) || !subCursor) historyStart = true; return false; }
          candles.unshift(...head); // in place: the 1m series may alias `candles`
          maxCandles = Math.max(maxCandles, candles.length + 1_000);
          emit({ type: 'reset', candles });
          emitter.notify();
          return true;
        })
        .finally(() => { olderReq = null; });
      return olderReq;
    },
    retry() {
      attempts = 0;
      channels.forEach((c) => c.retry());
      stop();
      started = true;
      void start();
    },
    dispose: stop,
  };
  return self;
}

const streams = new Map<string, ChartStream & { dispose(): void }>();
const keyOf = (k: ChartKey) => `${k.exchange}|${k.symbol}|${k.tf}`;

function release(k: ChartKey): void {
  const id = keyOf(k);
  streams.get(id)?.dispose();
  streams.delete(id);
}

/** Get (or create) the shared stream for a key. No network until `retain()`. */
export function getChartStream(key: ChartKey): ChartStream {
  const id = keyOf(key);
  let s = streams.get(id);
  if (!s) {
    s = createChartStream(key);
    streams.set(id, s);
  }
  return s;
}
