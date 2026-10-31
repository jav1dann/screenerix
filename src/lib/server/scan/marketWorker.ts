/**
 * Background screener worker for one venue: keeps every listed coin's metric
 * row (all of `METRICS`) up to date in the scan cache.
 *
 *  - Prices, 24h change / turnover and funding from the whole-market ticker
 *    snapshot every few seconds; each price also feeds 1m live buckets.
 *  - Bar sets (1m / 5m candles, OI history) refreshed per coin by tier —
 *    liquid coins more often — within the shared upstream budget. Live buckets
 *    fill the minutes in between, so price metrics stay current.
 *  - Rows are recomputed after every ticker snapshot and published as one
 *    versioned entry.
 */
import { ADAPTERS, TIMEFRAME_MS } from '@/lib/market/exchanges';
import type { ExchangeId, InstrumentMeta, OiPoint, RawCandle } from '@/lib/market/exchanges';
import { getKlines, getOiHistory, getTickers, loadInstruments, oiPeriod } from '@/lib/market/server/marketData';
import { mergeLive, METRICS, recordLive, unsupportedReason } from '@/lib/screener/metrics';
import type { BarSet, LiveBuckets, MetricInput } from '@/lib/screener/metrics';
import { BAR_BITS } from '@/lib/scan/types';
import type { Coverage, MetricRow } from '@/lib/scan/types';
import { limiter } from './limiter';
import { metricsKey, scanStore } from './store';

export interface MetricsEntryData { venue: ExchangeId; coverage: Coverage; rows: MetricRow[] }

/** Coins at or above this 24h turnover are refreshed on the faster schedule. */
const LIQUID = 5_000_000;
const MIN = 60_000;
/** Bar-set refresh periods: [liquid, other]. */
const TTL: Record<BarSet, [number, number]> = { k1m: [5 * MIN, 15 * MIN], k5m: [15 * MIN, 30 * MIN], oi5: [15 * MIN, 60 * MIN], oi1h: [30 * MIN, 60 * MIN], k1h: [15 * MIN, 60 * MIN] };
/** 1h bars feed the strategy engine, which only scans coins with at least this turnover. */
export const STRATEGY_MIN_VOLUME = 1_000_000;
const TICKERS_MS: Partial<Record<ExchangeId, number>> = { binance: 10_000 };
const DEFAULT_TICKERS_MS = 5_000;
const CONCURRENCY = 3;
const RETRY_MS = 60_000;
const BAR_MS = { k1m: MIN, k5m: 5 * MIN, k1h: 60 * MIN } as const;

type Bars = RawCandle[] | OiPoint[];
interface SetState { at: number; data: Bars | null; retryAt: number; final: boolean; busy: boolean }
interface Coin {
  meta: InstrumentMeta;
  price: number;
  open24h: number | null;
  volume: number;
  funding: number | null;
  live: LiveBuckets;
  sets: Partial<Record<BarSet, SetState>>;
}

const fetchSet = (venue: ExchangeId, symbol: string, set: BarSet): Promise<Bars> => {
  switch (set) {
    case 'k1m': return getKlines(venue, symbol, '1m', 61);
    case 'k5m': return getKlines(venue, symbol, '5m', 288);
    case 'k1h': return getKlines(venue, symbol, '1h', 200);
    case 'oi5': { const p = oiPeriod(venue, '5m'); return p ? getOiHistory(venue, symbol, p, Math.ceil((289 * 5 * MIN) / TIMEFRAME_MS[p])) : Promise.resolve([]); }
    case 'oi1h': { const p = oiPeriod(venue, '1h'); return p ? getOiHistory(venue, symbol, p, Math.ceil((25 * 60 * MIN) / TIMEFRAME_MS[p])) : Promise.resolve([]); }
  }
};

/** One coin as the strategy engine sees it: live price and candles (forming bar follows the live price). */
export interface CoinSnapshot { symbol: string; price: number; volume: number; k1m: RawCandle[] | null; k5m: RawCandle[] | null; k1h: RawCandle[] | null }

/** One coin as the alert engine reads it (venue bars only for volume; the forming bar follows the live price). */
export interface AlertCoin {
  price: number;
  funding: number | null;
  k1m: RawCandle[] | null;
  k5m: RawCandle[] | null;
  oi5: OiPoint[] | null;
}

export interface MarketWorker {
  stop(): void;
  stats(): { coins: number; scanned: number; fetches: number; errors: number; hot1m: number };
  /** Coins with at least `minVolume` 24h turnover. */
  snapshot(minVolume: number): CoinSnapshot[];
  /**
   * Coins whose 1m candles refresh every minute, per source (strategies: live 1m setups; alerts:
   * symbols with complex alerts). Each call replaces that source's list; alerts go first.
   */
  setHot(symbols: readonly string[], source?: 'strategies' | 'alerts'): void;
  /** One coin's price and bars for the alert engine (null: not listed / no price yet). */
  coin(symbol: string): AlertCoin | null;
  /** Called after every ticker pass (new prices for the whole venue); returns an unsubscribe. */
  onPrices(listener: () => void): () => void;
}

/** 1m refresh period of hot coins, and how many may be hot at once. */
const HOT_TTL = MIN;
export const MAX_HOT = 40;

export function startMarketWorker(venue: ExchangeId): MarketWorker {
  const adapter = ADAPTERS[venue];
  const store = scanStore();
  const key = metricsKey(venue);
  const coins = new Map<string, Coin>();
  let hot = new Set<string>();
  const hotBy: Record<'strategies' | 'alerts', readonly string[]> = { strategies: [], alerts: [] };
  const priceListeners = new Set<() => void>();
  const supported = METRICS.filter((d) => unsupportedReason(d, venue, adapter.name) === null);
  const sets: BarSet[] = [...new Set(supported.flatMap((d) => d.needs))];
  /** Metric sets plus the strategy engine's 1h bars (which don't count towards metric coverage). */
  const scheduled: BarSet[] = [...sets, 'k1h'];
  // Last persisted values: served for a coin until its own bars are loaded again (warm restart).
  const persisted = new Map((store.get<MetricsEntryData>(key)?.data.rows ?? []).map((r) => [r.s, r]));
  let stopped = false;
  let fetches = 0;
  let errors = 0;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const sleep = (ms: number) => new Promise<void>((r) => { const t = setTimeout(() => { timers.delete(t); r(); }, ms); timers.add(t); });

  /* ── Rows ── */

  const merged = (c: Coin, set: BarSet): Bars | null => {
    const st = c.sets[set];
    if (!st?.data) return null;
    return set === 'k1m' || set === 'k5m' || set === 'k1h' ? mergeLive(st.data as RawCandle[], c.live, BAR_MS[set]) : st.data;
  };

  function rowOf(symbol: string, c: Coin, btc: MetricInput['btc']): MetricRow {
    const old = persisted.get(symbol);
    let loaded = 0;
    for (const s of sets) { const st = c.sets[s]; if (st && (st.data || st.final)) loaded |= BAR_BITS[s]; }
    // Sets not reloaded since a restart still count as loaded when their persisted values are served.
    const b = loaded | (old ? old.b : 0);
    const input: MetricInput = { bars: {}, btc, price: c.price, funding: c.funding, turnover: c.volume };
    for (const s of sets) input.bars[s] = merged(c, s);
    const m: Record<string, number | null> = {};
    const d: Record<string, 1 | -1> = {};
    for (const def of supported) {
      const ready = def.needs.every((s) => (loaded & BAR_BITS[s]) !== 0);
      if (!ready) {
        // Not loaded since the restart: keep the last persisted value until it is.
        m[def.key] = old?.m[def.key] ?? null;
        if (old?.d?.[def.key]) d[def.key] = old.d[def.key];
        continue;
      }
      const r = def.compute(input);
      m[def.key] = r && Number.isFinite(r.value) ? r.value : null;
      if (r?.dir !== undefined) d[def.key] = r.dir;
    }
    return { s: symbol, p: c.price, c: c.open24h ? c.price / c.open24h - 1 : null, v: c.volume, f: c.funding, b, m, d };
  }

  function publish(): void {
    const btcCoin = coins.get('BTC');
    const btc: MetricInput['btc'] = btcCoin ? { k1m: merged(btcCoin, 'k1m') as RawCandle[] | null, k5m: merged(btcCoin, 'k5m') as RawCandle[] | null } : {};
    const all = sets.reduce((m, s) => m | BAR_BITS[s], 0);
    const rows: MetricRow[] = [];
    let scanned = 0;
    for (const [symbol, c] of coins) {
      if (!(c.price > 0)) continue;
      const row = rowOf(symbol, c, btc);
      if ((row.b & all) === all) scanned++;
      rows.push(row);
    }
    rows.sort((a, b) => b.v - a.v);
    store.put<MetricsEntryData>(key, { venue, coverage: { scanned, total: rows.length, updatedAt: Date.now() }, rows });
  }

  /* ── Tickers ── */

  async function tickers(): Promise<void> {
    const [instruments, events] = await limiter().asWorker(() => Promise.all([loadInstruments(venue), getTickers(venue)]));
    const byInst = new Map(Object.entries(instruments).map(([base, meta]) => [meta.inst, { base, meta }]));
    const now = Date.now();
    for (const ev of events) {
      if (ev.kind !== 'ticker') continue;
      const hit = byInst.get(ev.inst);
      if (!hit) continue;
      let c = coins.get(hit.base);
      if (!c) { c = { meta: hit.meta, price: 0, open24h: null, volume: 0, funding: null, live: [], sets: {} }; coins.set(hit.base, c); }
      const k = hit.meta.priceScale;
      if (ev.last !== undefined && ev.last > 0) { c.price = ev.last * k; recordLive(c.live, c.price, now); }
      if (ev.open24h !== undefined && ev.open24h > 0) c.open24h = ev.open24h * k;
      if (ev.quoteVol !== undefined) c.volume = ev.quoteVol;
      if (ev.funding !== undefined) c.funding = ev.funding;
    }
    // Delisted coins drop out.
    for (const symbol of coins.keys()) if (!instruments[symbol]) coins.delete(symbol);
    publish();
    for (const l of priceListeners) {
      try { l(); } catch (e) { console.error(`[scan] ${venue} price listener failed`, e); }
    }
  }

  async function tickerLoop(): Promise<void> {
    while (!stopped) {
      const started = Date.now();
      let restrictedUntil = 0;
      try { await tickers(); } catch (e) {
        errors++;
        const { code, retryAt } = (e ?? {}) as { code?: unknown; retryAt?: unknown };
        if (code === 'restricted' && typeof retryAt === 'number') restrictedUntil = retryAt;
      }
      // A refused venue is checked again when its breaker allows (venueHealth.ts), not every few seconds.
      const wait = restrictedUntil ? restrictedUntil - Date.now() : (TICKERS_MS[venue] ?? DEFAULT_TICKERS_MS) - (Date.now() - started);
      await sleep(Math.max(1_000, wait));
    }
  }

  /* ── Bars ── */

  /** Most urgent (coin, set): never loaded before stale, liquid before illiquid, then the stalest. */
  function next(): { symbol: string; c: Coin; set: BarSet; st: SetState } | null {
    const now = Date.now();
    let best: { symbol: string; c: Coin; set: BarSet; st: SetState } | null = null;
    let bestRank = Infinity;
    for (const [symbol, c] of coins) {
      if (!(c.price > 0)) continue;
      const liquid = c.volume >= LIQUID;
      for (const set of c.volume >= STRATEGY_MIN_VOLUME ? scheduled : sets) {
        const st = (c.sets[set] ??= { at: 0, data: null, retryAt: 0, final: false, busy: false });
        if (st.busy || st.final || st.retryAt > now) continue;
        const age = now - st.at;
        // Hot coins: 1m bars every minute; with an alert on them, 5m bars every 5 minutes too.
        const ttl = set === 'k1m' && hot.has(symbol) ? HOT_TTL : set === 'k5m' && hotBy.alerts.includes(symbol) ? 5 * MIN : TTL[set][liquid ? 0 : 1];
        if (st.at && age < ttl) continue;
        // Lower = sooner: unseen liquid, unseen other, stale liquid, stale other; then older / more traded first.
        // Strategy-only 1h bars come after the metric sets of the same tier.
        const tier = (st.at ? 2 : 0) + (liquid ? 0 : 1) + (set === 'k1h' ? 0.5 : 0);
        const rank = tier * 1e15 - (st.at ? age : c.volume);
        if (rank < bestRank) { best = { symbol, c, set, st }; bestRank = rank; }
      }
    }
    return best;
  }

  let dirty = false;
  async function barLoop(): Promise<void> {
    while (!stopped) {
      const task = next();
      if (!task) { await sleep(1_000); continue; }
      const { symbol, set, st } = task;
      st.busy = true;
      try {
        st.data = await limiter().asWorker(() => fetchSet(venue, symbol, set));
        st.at = Date.now();
        st.retryAt = 0;
        fetches++;
      } catch (e) {
        errors++;
        const { status, code, retryAt } = (e ?? {}) as { status?: unknown; code?: unknown; retryAt?: unknown };
        if (status === 404 || status === 400) { st.final = true; st.data = null; }
        // Refused from this server's region: wait for the venue's next check, not a minute.
        else if (code === 'restricted' && typeof retryAt === 'number') st.retryAt = retryAt;
        else st.retryAt = Date.now() + (status === 429 || status === 418 ? 30_000 : RETRY_MS);
      } finally {
        st.busy = false;
        dirty = true;
      }
    }
  }

  /** Bars landing between ticker snapshots are published at most every 2s. */
  async function flushLoop(): Promise<void> {
    while (!stopped) {
      await sleep(2_000);
      if (dirty) { dirty = false; publish(); }
    }
  }

  void tickerLoop();
  for (let i = 0; i < CONCURRENCY; i++) void barLoop();
  void flushLoop();

  return {
    stop() { stopped = true; timers.forEach(clearTimeout); },
    stats() {
      const entry = store.get<MetricsEntryData>(key);
      return { coins: coins.size, scanned: entry?.data.coverage.scanned ?? 0, fetches, errors, hot1m: hot.size };
    },
    snapshot(minVolume) {
      const out: CoinSnapshot[] = [];
      for (const [symbol, c] of coins) {
        if (!(c.price > 0) || c.volume < minVolume) continue;
        out.push({ symbol, price: c.price, volume: c.volume, k1m: merged(c, 'k1m') as RawCandle[] | null, k5m: merged(c, 'k5m') as RawCandle[] | null, k1h: merged(c, 'k1h') as RawCandle[] | null });
      }
      return out;
    },
    setHot(symbols, source = 'strategies') {
      hotBy[source] = symbols;
      hot = new Set([...hotBy.alerts, ...hotBy.strategies].slice(0, MAX_HOT));
    },
    coin(symbol) {
      const c = coins.get(symbol);
      if (!c || !(c.price > 0)) return null;
      return { price: c.price, funding: c.funding, k1m: merged(c, 'k1m') as RawCandle[] | null, k5m: merged(c, 'k5m') as RawCandle[] | null, oi5: (c.sets.oi5?.data as OiPoint[] | null | undefined) ?? null };
    },
    onPrices(listener) {
      priceListeners.add(listener);
      return () => { priceListeners.delete(listener); };
    },
  };
}
