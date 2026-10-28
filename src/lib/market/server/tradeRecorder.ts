/**
 * Server-side sub-minute history for venues without sub-minute candles (Binance, Bybit, Bitget,
 * Coinbase). Their REST trades reach back only minutes on a busy coin, so a 30s chart opened from
 * them alone starts nearly empty. The recorder streams trades for the most traded coins and for
 * every coin a sub-minute chart was opened on, and folds them into 30s / 1s buckets (the same
 * `applyTrade` the browser uses) that `getSubMinuteCandles` puts in front of the REST page.
 *
 * Only complete buckets are served: the bucket a (re)connect happened in is partial and is left
 * out, so a dropped connection leaves a gap rather than a wrong candle. Memory only (history
 * starts again after a restart). Server-only.
 */
import { ADAPTERS, TIMEFRAME_MS } from '@/lib/market/exchanges';
import type { ExchangeId, FeedEvent, InstrumentMeta, RawCandle, SubMinute } from '@/lib/market/exchanges';
import { applyTrade } from '@/lib/market/exchanges/shared';
import { openChannel } from '@/lib/market/socketHub';
import type { SocketChannel } from '@/lib/market/socketHub';

/** Buckets kept per coin: 6 h of 30s, 15 min of 1s. */
export const RECORD_KEEP: Record<SubMinute, number> = { '30s': 720, '1s': 900 };
/** A coin a chart asked for keeps recording this long after the last request. */
const REQUESTED_TTL_MS = 6 * 60 * 60_000;
/** Most coins recorded per venue (top coins + requested ones). */
const MAX_PER_VENUE = 60;
const TOP_FIRST_MS = 20_000;
const TOP_REFRESH_MS = 5 * 60_000;

interface Series {
  meta: InstrumentMeta;
  buckets: Record<SubMinute, RawCandle[]>;
  /** Bucket opens that are partial (recording started or resumed inside them). */
  partial: Record<SubMinute, Set<number>>;
  /** Asked for by a chart until then (0: only as a top coin). */
  requestedUntil: number;
  /** No trade since (re)subscribing: the bucket of the next trade is where recording resumes. */
  fresh: boolean;
  /** Exchange time of the last trade received (its bucket is cut short when the connection drops). */
  lastT: number | null;
}

interface VenueRecorder {
  series: Map<string, Series>;
  byInst: Map<string, string>;
  top: string[];
  channel: SocketChannel;
  resolve(base: string): Promise<InstrumentMeta | null>;
}

const g = globalThis as typeof globalThis & { __sxTradeRecorders?: Map<ExchangeId, VenueRecorder> };
const recorders: Map<ExchangeId, VenueRecorder> = (g.__sxTradeRecorders ??= new Map());

const SUBS: readonly SubMinute[] = ['30s', '1s'];

/** Whether `venue` needs recorded history (no native sub-minute candles). */
export const recordsTrades = (venue: ExchangeId): boolean => !ADAPTERS[venue].rest.subMinuteKlines;

function markPartial(s: Series, now: number): void {
  for (const tf of SUBS) {
    const span = TIMEFRAME_MS[tf];
    s.partial[tf].add(Math.floor(now / span) * span);
    // Bounded: only opens still within the kept window matter.
    const oldest = now - RECORD_KEEP[tf] * span;
    for (const t of s.partial[tf]) if (t < oldest) s.partial[tf].delete(t);
  }
}

function sync(r: VenueRecorder, venue: ExchangeId, now = Date.now()): void {
  for (const [base, s] of r.series) {
    if (s.requestedUntil < now && !r.top.includes(base)) { r.series.delete(base); r.byInst.delete(s.meta.inst); }
  }
  const adapter = ADAPTERS[venue];
  r.channel.setTopics(new Set([...r.series.values()].flatMap((s) => adapter.ws.tradeTopics(s.meta.inst))));
}

/**
 * Start recording on `venue`. `resolve` looks a coin's instrument up; `topCoins` (most traded
 * first) is re-read every few minutes. Idempotent; returns a stop function.
 */
export function startTradeRecorder(venue: ExchangeId, resolve: (base: string) => Promise<InstrumentMeta | null>, topCoins: () => string[], topCount = 20): () => void {
  if (!recordsTrades(venue)) return () => {};
  if (recorders.has(venue)) return () => {};
  const adapter = ADAPTERS[venue];
  const r: VenueRecorder = {
    series: new Map(), byInst: new Map(), top: [], resolve,
    channel: openChannel(adapter, adapter.ws.tradeUrl, {
      onEvents: (events: FeedEvent[]) => {
        for (const ev of events) {
          if (ev.kind !== 'trade') continue;
          const base = r.byInst.get(ev.inst);
          const s = base ? r.series.get(base) : undefined;
          if (!s) continue;
          if (s.fresh) { s.fresh = false; markPartial(s, ev.t); }
          s.lastT = ev.t;
          const price = ev.price * s.meta.priceScale, size = ev.size * s.meta.contractSize;
          for (const tf of SUBS) applyTrade(s.buckets[tf], TIMEFRAME_MS[tf], price, size, ev.t, RECORD_KEEP[tf], ev.side);
        }
      },
      // Connection lost: trades after the last one received were missed — its bucket is partial
      // (exchange time, not ours: the clocks differ), and so is the one recording resumes in.
      onReset: () => r.series.forEach((s) => { if (s.lastT !== null) markPartial(s, s.lastT); s.fresh = true; }),
    }),
  };
  recorders.set(venue, r);
  // Background passes never throw out (an unhandled rejection on the server).
  const refreshTop = async () => {
    try {
      const want = topCoins().slice(0, topCount);
      r.top = want;
      for (const base of want) await add(venue, r, base, 0);
      sync(r, venue);
    } catch (e) { console.error(`[recorder] ${venue}: top coins refresh failed:`, e); }
  };
  // First pass once the market worker has its first ticker snapshot, then every few minutes.
  const first = setTimeout(() => { void refreshTop(); }, TOP_FIRST_MS);
  const timer = setInterval(() => { void refreshTop(); }, TOP_REFRESH_MS);
  first.unref?.();
  timer.unref?.();
  return () => { clearTimeout(first); clearInterval(timer); r.channel.close(); recorders.delete(venue); };
}

async function add(venue: ExchangeId, r: VenueRecorder, base: string, requestedUntil: number): Promise<Series | null> {
  const have = r.series.get(base);
  if (have) { have.requestedUntil = Math.max(have.requestedUntil, requestedUntil); return have; }
  if (r.series.size >= MAX_PER_VENUE) {
    // Make room: the requested coin whose request is oldest (top coins stay).
    const victim = [...r.series].filter(([b]) => !r.top.includes(b)).sort((a, b) => a[1].requestedUntil - b[1].requestedUntil)[0];
    if (!victim || victim[1].requestedUntil > requestedUntil) return null;
    r.series.delete(victim[0]);
    r.byInst.delete(victim[1].meta.inst);
  }
  const meta = await r.resolve(base).catch(() => null);
  if (!meta || r.series.has(base)) return r.series.get(base) ?? null;
  const s: Series = { meta, buckets: { '30s': [], '1s': [] }, partial: { '30s': new Set(), '1s': new Set() }, requestedUntil, fresh: true, lastT: null };
  r.series.set(base, s);
  r.byInst.set(meta.inst, base);
  return s;
}

/** A sub-minute chart was opened on `base`: keep (or start) recording it. */
export function trackTrades(venue: ExchangeId, base: string, now = Date.now()): void {
  const r = recorders.get(venue);
  if (!r) return;
  void add(venue, r, base, now + REQUESTED_TTL_MS)
    .then((s) => { if (s) sync(r, venue, now); })
    .catch((e) => console.error(`[recorder] ${venue}: tracking ${base} failed:`, e));
}

/**
 * Recorded complete buckets of `tf` with open time before `before` (all when omitted), oldest
 * first, at most `limit` (the newest of them). Never the bucket still in progress.
 */
export function recordedCandles(venue: ExchangeId, base: string, tf: SubMinute, before = Infinity, limit = RECORD_KEEP[tf], now = Date.now()): RawCandle[] {
  const s = recorders.get(venue)?.series.get(base);
  if (!s) return [];
  const span = TIMEFRAME_MS[tf];
  const current = Math.floor(now / span) * span;
  const out = s.buckets[tf].filter((c) => c.t < before && c.t < current && !s.partial[tf].has(c.t));
  return out.slice(-limit).map((c) => ({ ...c }));
}
