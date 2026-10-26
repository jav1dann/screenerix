/**
 * Synthetic spread chart: A ÷ B candles built from two live chart streams on the
 * same venue (e.g. ETH ÷ BTC). Implements `ChartStream`, so it plugs into the
 * regular chart canvas.
 *
 * Bars are joined on open time: open = oA / oB, close = cA / cB, and the
 * high / low are bounded by hA / hB and lA / lB (exact intra-bar extremes of a
 * ratio aren't recoverable from two OHLC series). Volume is 0.
 */
import { getChartStream } from './chartStream';
import type { ChartDataEvent, ChartSnapshot, ChartStream } from './chartStream';
import { createEmitter } from './feed';
import type { ChartTimeframe, ExchangeId, RawCandle } from './exchanges';

export interface RatioKey { exchange: ExchangeId; a: string; b: string; tf: ChartTimeframe }

function ratioBar(x: RawCandle, y: RawCandle): RawCandle | null {
  if (!(y.o > 0 && y.c > 0 && y.h > 0 && y.l > 0)) return null;
  const o = x.o / y.o, c = x.c / y.c;
  return { t: x.t, o, c, h: Math.max(o, c, x.h / y.h), l: Math.min(o, c, x.l / y.l), v: 0 };
}

function join(as: RawCandle[], bs: RawCandle[]): RawCandle[] {
  const byT = new Map(bs.map((b) => [b.t, b]));
  return as.flatMap((a) => { const b = byT.get(a.t); const r = b ? ratioBar(a, b) : null; return r ? [r] : []; });
}

function createRatioStream(key: RatioKey): ChartStream {
  const legA = getChartStream({ exchange: key.exchange, symbol: key.a, tf: key.tf });
  const legB = getChartStream({ exchange: key.exchange, symbol: key.b, tf: key.tf });
  const emitter = createEmitter(250);
  const dataListeners = new Set<(e: ChartDataEvent) => void>();
  let candles: RawCandle[] = [];
  let snapshot: ChartSnapshot = legA.getSnapshot();

  const rebuild = () => {
    candles = join(legA.getCandles(), legB.getCandles());
    dataListeners.forEach((l) => l({ type: 'reset', candles }));
  };
  const refreshSnapshot = () => {
    const sa = legA.getSnapshot(), sb = legB.getSnapshot();
    const bad = [sa, sb].find((s) => s.status === 'unlisted' || s.status === 'error');
    const status = bad ? bad.status : sa.status === 'ready' && sb.status === 'ready' ? 'ready' : 'loading';
    const last = candles[candles.length - 1]?.c ?? null;
    const next: ChartSnapshot = {
      status,
      error: bad?.error,
      conn: sa.conn === 'live' && sb.conn === 'live' ? 'live' : sa.conn !== 'live' ? sa.conn : sb.conn,
      meta: null,
      stats: { ...sa.stats, last, trades24h: null, volume24h: null, high24h: null, low24h: null, range24h: null, change24h: null },
    };
    if (next.status !== snapshot.status || next.conn !== snapshot.conn || next.stats.last !== snapshot.stats.last || next.error !== snapshot.error) {
      snapshot = next;
      emitter.notify();
    }
  };

  /** A live update on one leg: re-derive that bar (or resync when bars don't line up). */
  const findAt = (bars: RawCandle[], t: number) => {
    for (let i = bars.length - 1; i >= 0; i--) if (bars[i].t === t) return bars[i];
    return undefined;
  };
  const onLeg = (side: 'a' | 'b') => (e: ChartDataEvent) => {
    if (e.type === 'reset') { rebuild(); refreshSnapshot(); return; }
    const other = findAt((side === 'a' ? legB : legA).getCandles(), e.candle.t);
    const bar = other ? (side === 'a' ? ratioBar(e.candle, other) : ratioBar(other, e.candle)) : null;
    if (!bar) { refreshSnapshot(); return; }
    const last = candles[candles.length - 1];
    if (last && last.t === bar.t) candles = [...candles.slice(0, -1), bar];
    else if (!last || bar.t > last.t) candles = [...candles, bar];
    else { rebuild(); refreshSnapshot(); return; }
    dataListeners.forEach((l) => l({ type: 'update', candle: bar }));
    refreshSnapshot();
  };

  let holders = 0;
  let release: (() => void) | null = null;

  return {
    key: { exchange: key.exchange, symbol: `${key.a}/${key.b}`, tf: key.tf },
    subscribe: emitter.subscribe,
    getSnapshot: () => snapshot,
    onData(listener) {
      dataListeners.add(listener);
      return () => { dataListeners.delete(listener); };
    },
    getCandles: () => candles,
    retain() {
      if (holders++ === 0) {
        const relA = legA.retain(), relB = legB.retain();
        const offA = legA.onData(onLeg('a')), offB = legB.onData(onLeg('b'));
        const offSa = legA.subscribe(refreshSnapshot), offSb = legB.subscribe(refreshSnapshot);
        rebuild();
        refreshSnapshot();
        release = () => { offA(); offB(); offSa(); offSb(); relA(); relB(); };
      }
      let done = false;
      return () => {
        if (done) return;
        done = true;
        if (--holders === 0) { release?.(); release = null; }
      };
    },
    retry() { legA.retry(); legB.retry(); },
    // A joined ratio series has no paged history of its own.
    loadOlder: () => Promise.resolve(false),
  };
}

const streams = new Map<string, ChartStream>();

/** Shared ratio stream per (venue, A, B, timeframe). */
export function getRatioStream(key: RatioKey): ChartStream {
  const id = `${key.exchange}|${key.a}|${key.b}|${key.tf}`;
  let s = streams.get(id);
  if (!s) { s = createRatioStream(key); streams.set(id, s); }
  return s;
}
