/**
 * Server-side sub-minute history for venues without sub-minute candles (Binance, Bybit, Bitget,
 * Coinbase). Their REST trades reach back only minutes on a busy coin, so a 30s chart opened from
 * them alone starts nearly empty. The recorder streams trades for the most traded coins and for
 * every coin a sub-minute chart was opened on, and folds them into 30s / 1s buckets (the same
 * `applyTrade` the browser uses) that `getSubMinuteCandles` puts in front of the REST page.
 *
 * A coin opened before it was recorded is backfilled from REST trades (`recordBackfill`), so it
 * opens with history too and every later open is instant.
 *
 * Only complete buckets are served: the bucket a (re)connect happened in is partial and is left
 * out, so a dropped connection leaves a gap rather than a wrong candle. The 30s recording is
 * saved to the data directory every few minutes and reloaded on start (a restart leaves a gap,
 * not an empty chart). Server-only.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DATA_DIR } from '@/lib/auth/session';
import { ADAPTERS, TIMEFRAME_MS } from '@/lib/market/exchanges';
import type { ExchangeId, FeedEvent, InstrumentMeta, RawCandle, SubMinute } from '@/lib/market/exchanges';
import { applyTrade } from '@/lib/market/exchanges/shared';
import { openChannel } from '@/lib/market/socketHub';
import type { SocketChannel } from '@/lib/market/socketHub';

/** Buckets kept per coin: 6 h of 30s, 15 min of 1s. */
export const RECORD_KEEP: Record<SubMinute, number> = { '30s': 720, '1s': 900 };
/** A coin a chart asked for keeps recording this long after the last request. */
const REQUESTED_TTL_MS = 6 * 60 * 60_000;
/** Most coins recorded per venue (top coins + requested / backfilled ones). */
const MAX_PER_VENUE = 80;
/** Most traded coins recorded all the time, per venue. */
export const RECORD_TOP = 50;
const SAVE_MS = 2 * 60_000;
const fileOf = (venue: ExchangeId) => join(DATA_DIR, 'subminute', `${venue}.json`);
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
  /** Backfilled from REST trades since this process started recording it (no need to again). */
  backfilled: boolean;
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
export function startTradeRecorder(venue: ExchangeId, resolve: (base: string) => Promise<InstrumentMeta | null>, topCoins: () => string[], topCount = RECORD_TOP): () => void {
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
  // What was recorded before the restart (the time since is a gap; the bucket it stopped in is partial).
  void loadRecording(venue, r).then(() => sync(r, venue)).catch((e) => console.error(`[recorder] ${venue}: loading the saved recording failed:`, e));
  const save = setInterval(() => { void saveRecording(venue, r).catch((e) => console.error(`[recorder] ${venue}: saving failed:`, e)); }, SAVE_MS);
  save.unref?.();
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
  return () => { clearTimeout(first); clearInterval(timer); clearInterval(save); r.channel.close(); recorders.delete(venue); };
}

async function add(venue: ExchangeId, r: VenueRecorder, base: string, requestedUntil: number): Promise<Series | null> {
  const have = r.series.get(base);
  if (have) { have.requestedUntil = Math.max(have.requestedUntil, requestedUntil); return have; }
  if (r.series.size >= MAX_PER_VENUE) {
    const victim = [...r.series].filter(([b]) => !r.top.includes(b)).sort((a, b) => a[1].requestedUntil - b[1].requestedUntil)[0];
    if (!victim || victim[1].requestedUntil > requestedUntil) return null;
  }
  if (!makeRoom(r)) return null;
  const meta = await r.resolve(base).catch(() => null);
  if (!meta || r.series.has(base)) return r.series.get(base) ?? null;
  return addSeries(r, base, meta, requestedUntil);
}

function addSeries(r: VenueRecorder, base: string, meta: InstrumentMeta, requestedUntil: number): Series {
  const s: Series = { meta, buckets: { '30s': [], '1s': [] }, partial: { '30s': new Set(), '1s': new Set() }, requestedUntil, fresh: true, lastT: null, backfilled: false };
  r.series.set(base, s);
  r.byInst.set(meta.inst, base);
  return s;
}

/** Room for one more coin: drop the requested one whose request is oldest (top coins stay). */
function makeRoom(r: VenueRecorder): boolean {
  if (r.series.size < MAX_PER_VENUE) return true;
  const victim = [...r.series].filter(([b]) => !r.top.includes(b)).sort((a, b) => a[1].requestedUntil - b[1].requestedUntil)[0];
  if (!victim) return false;
  r.series.delete(victim[0]);
  r.byInst.delete(victim[1].meta.inst);
  return true;
}

/**
 * Complete `tf` buckets built from REST trades for a coin (a chart opened it before it was
 * recorded): they fill buckets the recording is missing or only has partly — recorded complete
 * buckets win — and the coin is recorded from now on, so the next open is instant.
 * `candles` must be closed buckets (none still in progress).
 */
export function recordBackfill(venue: ExchangeId, base: string, meta: InstrumentMeta, tf: SubMinute, candles: readonly RawCandle[], now = Date.now()): void {
  const r = recorders.get(venue);
  if (!r || !candles.length) return;
  let s = r.series.get(base);
  if (!s) {
    if (!makeRoom(r)) return;
    s = addSeries(r, base, meta, now + REQUESTED_TTL_MS);
    sync(r, venue, now);
  }
  const span = TIMEFRAME_MS[tf];
  const oldest = Math.floor(now / span) * span - RECORD_KEEP[tf] * span;
  const byT = new Map(s.buckets[tf].map((c) => [c.t, c]));
  for (const c of candles) {
    if (c.t < oldest) continue;
    if (!byT.has(c.t) || s.partial[tf].has(c.t)) { byT.set(c.t, { ...c }); s.partial[tf].delete(c.t); }
  }
  s.buckets[tf] = [...byT.values()].sort((a, b) => a.t - b.t).slice(-RECORD_KEEP[tf]);
  s.backfilled = true;
}

/**
 * Whether `base` was backfilled since recording started in this process: the recording has
 * carried on from there, so a new chart needs only the newest trades. (A recording loaded from
 * disk isn't: one backfill fills the time the server was down.)
 */
export const wasBackfilled = (venue: ExchangeId, base: string): boolean => recorders.get(venue)?.series.get(base)?.backfilled ?? false;

/* ── Saved recording (30s only: 1s keeps 15 min, stale after any restart) ── */

type Row = [t: number, o: number, h: number, l: number, c: number, v: number, tb?: number];
interface Saved { savedAt: number; series: Record<string, { meta: InstrumentMeta; requestedUntil: number; lastT: number | null; b30: Row[]; p30: number[] }> }

/** Save every venue's recording now (otherwise every few minutes; tests and shutdown). */
export async function saveRecordings(): Promise<void> {
  await Promise.all([...recorders].map(([venue, r]) => saveRecording(venue, r)));
}

async function saveRecording(venue: ExchangeId, r: VenueRecorder): Promise<void> {
  const out: Saved = { savedAt: Date.now(), series: {} };
  for (const [base, s] of r.series) {
    if (!s.buckets['30s'].length) continue;
    out.series[base] = {
      meta: s.meta, requestedUntil: s.requestedUntil, lastT: s.lastT,
      b30: s.buckets['30s'].map((c) => (c.tb === undefined ? [c.t, c.o, c.h, c.l, c.c, c.v] : [c.t, c.o, c.h, c.l, c.c, c.v, c.tb])),
      p30: [...s.partial['30s']],
    };
  }
  const file = fileOf(venue);
  await mkdir(join(DATA_DIR, 'subminute'), { recursive: true });
  await writeFile(`${file}.tmp`, JSON.stringify(out));
  await rename(`${file}.tmp`, file);
}

async function loadRecording(venue: ExchangeId, r: VenueRecorder, now = Date.now()): Promise<void> {
  let saved: Saved;
  try { saved = JSON.parse(await readFile(fileOf(venue), 'utf8')) as Saved; } catch { return; } // none yet / unreadable
  const span = TIMEFRAME_MS['30s'];
  const oldest = now - RECORD_KEEP['30s'] * span;
  for (const [base, x] of Object.entries(saved.series ?? {})) {
    if (r.series.has(base) || !x?.meta?.inst || !Array.isArray(x.b30) || !makeRoom(r)) continue;
    const s = addSeries(r, base, x.meta, Number(x.requestedUntil) || 0);
    s.buckets['30s'] = x.b30.filter((row) => Array.isArray(row) && row[0] >= oldest)
      .map(([t, o, h, l, c, v, tb]) => (tb === undefined ? { t, o, h, l, c, v } : { t, o, h, l, c, v, tb }));
    (x.p30 ?? []).forEach((t) => s.partial['30s'].add(t));
    // Recording stopped at the last saved trade: its bucket was cut short.
    if (typeof x.lastT === 'number') markPartial(s, x.lastT);
  }
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
