/**
 * Browser side of the server scan cache.
 *
 * A subscription (metric table of a venue, or density cards of venue × market
 * pairs) paints from one JSON request — answered from the server's in-memory
 * cache — then stays current through Server-Sent Events carrying only changed
 * rows / cards. If the event stream can't stay open, it falls back to polling
 * every 2s (`since` makes unchanged polls tiny). Subscriptions are shared by
 * every component asking for the same data and close a few seconds after the
 * last one leaves.
 */
import { sessionExpired } from '@/lib/auth/expired';
import type { DensitiesPayload, DensityCoverage, MetricRow, MetricsPayload, NestStep, ServerDensityCard, Coverage } from './types';
import type { DensityMarket } from '@/lib/densities/types';
import type { ExchangeId } from '@/lib/market/exchanges';
import type { Formation, StrategiesPayload, StrategyCoverage } from '@/lib/strategies/types';

export type FeedState = 'loading' | 'live' | 'polling' | 'error';

export interface MetricTable { state: FeedState; version: number; coverage: Coverage; rows: MetricRow[] }
export interface DensityFeed { state: FeedState; version: number; coverage: DensityCoverage[]; cards: ServerDensityCard[] }

export const EMPTY_TABLE: MetricTable = { state: 'loading', version: 0, coverage: { scanned: 0, total: 0, updatedAt: 0 }, rows: [] };
export interface StrategyFeed { state: FeedState; version: number; coverage: StrategyCoverage[]; formations: Formation[] }
export const EMPTY_STRATEGIES: StrategyFeed = { state: 'loading', version: 0, coverage: [], formations: [] };
export const EMPTY_DENSITIES: DensityFeed = { state: 'loading', version: 0, coverage: [], cards: [] };

interface Source<T> { subscribe(listener: () => void): () => void; getSnapshot(): T }

const POLL_MS = 2_000;
const LINGER_MS = 5_000;
/** SSE errors in a row before switching to polling. */
const SSE_FAILURES = 3;

interface Spec<T, P> {
  jsonUrl: (since?: number) => string;
  streamUrl: string;
  event: string;
  empty: T;
  /** Full payload → state. */
  full(p: P): Omit<T, 'state'>;
  /** Patch (changed items + removed keys) applied to the current state. */
  patch(cur: T, p: P & { removed: string[] }): Omit<T, 'state'>;
}

function createSource<T extends { state: FeedState; version: number }, P extends { version: number }>(spec: Spec<T, P>, onIdle: () => void): Source<T> {
  const listeners = new Set<() => void>();
  let state: T = spec.empty;
  let es: EventSource | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let failures = 0;
  let active = false;

  const set = (next: T) => { state = next; listeners.forEach((l) => l()); };

  async function load(since?: number): Promise<boolean> {
    try {
      const res = await fetch(spec.jsonUrl(since), { cache: 'no-store' });
      if (res.status === 401) sessionExpired();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as P & { unchanged?: boolean };
      if (!active) return true;
      // Never step back: the event stream may already have delivered a newer version.
      if (!body.unchanged && body.version >= state.version) set({ ...spec.full(body), state: es ? 'live' : 'polling' } as T);
      return true;
    } catch {
      if (active && state.state === 'loading') set({ ...state, state: 'error' });
      return false;
    }
  }

  function poll(): void {
    if (!active) return;
    pollTimer = setTimeout(async () => { await load(state.version || undefined); poll(); }, POLL_MS);
  }

  function openStream(): void {
    if (typeof EventSource === 'undefined') { poll(); return; }
    es = new EventSource(spec.streamUrl);
    es.addEventListener(spec.event, (e) => {
      failures = 0;
      const p = JSON.parse((e as MessageEvent<string>).data) as P & { full: boolean; removed: string[] };
      set({ ...(p.full ? spec.full(p) : spec.patch(state, p)), state: 'live' } as T);
    });
    es.onerror = () => {
      // EventSource reconnects by itself; after repeated failures fall back to polling.
      if (++failures < SSE_FAILURES || !es) return;
      es.close();
      es = null;
      if (active) { set({ ...state, state: 'polling' }); poll(); }
    };
  }

  function start(): void {
    active = true;
    failures = 0;
    void load(); // instant paint from the cache
    openStream();
  }

  function stop(): void {
    active = false;
    es?.close();
    es = null;
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
    state = spec.empty;
    onIdle();
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
      if (!active) start();
      return () => {
        listeners.delete(listener);
        if (!listeners.size) idleTimer = setTimeout(stop, LINGER_MS);
      };
    },
    getSnapshot: () => state,
  };
}

const sources = new Map<string, Source<unknown>>();

/** Live metric table of a venue (only the requested metric keys). */
export function metricSource(venue: ExchangeId, keys: readonly string[]): Source<MetricTable> {
  const k = [...new Set(keys)].sort().join(',');
  const id = `m|${venue}|${k}`;
  let src = sources.get(id) as Source<MetricTable> | undefined;
  if (!src) {
    const q = `keys=${encodeURIComponent(k)}`;
    src = createSource<MetricTable, MetricsPayload>({
      jsonUrl: (since) => `/api/scan/${venue}/metrics?${q}${since ? `&since=${since}` : ''}`,
      streamUrl: `/api/scan/stream?venue=${venue}&${q}`,
      event: 'metrics',
      empty: EMPTY_TABLE,
      full: (p) => ({ version: p.version, coverage: p.coverage, rows: p.rows }),
      patch(cur, p) {
        const bySym = new Map(cur.rows.map((r) => [r.s, r]));
        for (const r of p.rows) bySym.set(r.s, r);
        for (const s of p.removed) bySym.delete(s);
        return { version: p.version, coverage: p.coverage, rows: [...bySym.values()].sort((a, b) => b.v - a.v) };
      },
    }, () => sources.delete(id));
    sources.set(id, src as Source<unknown>);
  }
  return src;
}

/**
 * Live density cards for venue × market pairs at a nesting step, trimmed on the server to
 * densities of at least `min` ($) within `dist` (%) — the loosest the user's filters can ask for.
 */
export function densitySource(pairs: ReadonlyArray<{ venue: ExchangeId; market: DensityMarket }>, step: NestStep, min: number, dist: number): Source<DensityFeed> {
  const p = pairs.map((x) => `${x.venue}:${x.market}`).sort().join(',');
  const id = `d|${p}|${step}|${min}|${dist}`;
  let src = sources.get(id) as Source<DensityFeed> | undefined;
  if (!src) {
    const q = `pairs=${encodeURIComponent(p)}&step=${step}&min=${min}&dist=${dist}`;
    src = createSource<DensityFeed, DensitiesPayload>({
      jsonUrl: (since) => `/api/scan/densities?${q}${since ? `&since=${since}` : ''}`,
      streamUrl: `/api/scan/stream?${q}`,
      event: 'densities',
      empty: EMPTY_DENSITIES,
      full: (x) => ({ version: x.version, coverage: x.coverage, cards: x.cards }),
      patch(cur, x) {
        const byKey = new Map(cur.cards.map((c) => [c.key, c]));
        for (const c of x.cards) byKey.set(c.key, c);
        for (const k of x.removed) byKey.delete(k);
        return { version: x.version, coverage: x.coverage, cards: [...byKey.values()] };
      },
    }, () => sources.delete(id));
    sources.set(id, src as Source<unknown>);
  }
  return src;
}

/** Live strategy formations of the given venues (every stage; the dashboard filters locally). */
export function strategySource(venues: readonly ExchangeId[]): Source<StrategyFeed> {
  const v = [...new Set(venues)].sort().join(',');
  const id = `s|${v}`;
  let src = sources.get(id) as Source<StrategyFeed> | undefined;
  if (!src) {
    src = createSource<StrategyFeed, StrategiesPayload>({
      jsonUrl: (since) => `/api/scan/strategies?venues=${v}${since ? `&since=${since}` : ''}`,
      streamUrl: `/api/scan/stream?strat=${v}`,
      event: 'strategies',
      empty: EMPTY_STRATEGIES,
      full: (x) => ({ version: x.version, coverage: x.coverage, formations: x.formations }),
      patch(cur, x) {
        const byId = new Map(cur.formations.map((f) => [f.id, f]));
        for (const f of x.formations) byId.set(f.id, f);
        for (const k of x.removed) byId.delete(k);
        return { version: x.version, coverage: x.coverage, formations: [...byId.values()] };
      },
    }, () => sources.delete(id));
    sources.set(id, src as Source<unknown>);
  }
  return src;
}
