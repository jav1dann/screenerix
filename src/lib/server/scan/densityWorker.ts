/**
 * Background densities worker for one venue × market: keeps every liquid
 * coin's large resting orders (≥ DENSITY_FLOOR within DENSITY_RANGE) for each
 * nesting step in the scan cache, with lifetimes tracked across snapshots —
 * so "seen for" times are real and the same for every visitor.
 */
import { isLeveragedToken, scanBook, trackLifetimes } from '@/lib/densities/detect';
import type { TrackedDensity } from '@/lib/densities/detect';
import type { DensityMarket, UniverseRow } from '@/lib/densities/types';
import type { ExchangeId } from '@/lib/market/exchanges';
import { getDensityUniverse, getDepth } from '@/lib/market/server/depthSources';
import { DENSITY_FLOOR, DENSITY_RANGE, NEST_STEPS } from '@/lib/scan/types';
import { limiter } from './limiter';
import { densityKey, scanStore } from './store';

/** Coins below this 24h turnover aren't scanned at all. */
const MIN_VOLUME = 1_000_000;
const LIQUID = 5_000_000;
/** Coins currently showing a sizable density (what people look at) refresh fastest. */
const HOT_SIZE = 250_000;
const HOT_DISTANCE = 0.05;
const HOT_MS = 30_000;
const LIQUID_MS = 60_000;
const COLD_MS = 5 * 60_000;
const UNIVERSE_MS = 60_000;
const RETRY_MS = 60_000;
const CONCURRENCY = 2;

/** Per nesting step: tracked densities and each side's median bucket. */
export interface StepResult { ds: TrackedDensity[]; med: { bid: number; ask: number } }

export interface DensityCoin {
  s: string;
  /** Mid of the last book. */
  last: number;
  c: number | null;
  v: number;
  lev: boolean;
  /** Book snapshot time. */
  at: number;
  /** Keyed by nesting step (`String(step)`). */
  steps: Record<string, StepResult>;
}

export interface DensityEntryData {
  venue: ExchangeId;
  market: DensityMarket;
  coverage: { scanned: number; total: number; error?: string; updatedAt: number };
  coins: DensityCoin[];
}

interface CoinState { row: UniverseRow; lev: boolean; at: number; retryAt: number; final: boolean; busy: boolean; result: DensityCoin | null }

export interface DensityWorker { stop(): void; stats(): { coins: number; scanned: number; fetches: number; errors: number } }

export function startDensityWorker(venue: ExchangeId, market: DensityMarket): DensityWorker {
  const store = scanStore();
  const key = densityKey(venue, market);
  const coins = new Map<string, CoinState>();
  // Lifetimes survive a restart: start from the persisted densities.
  const persisted = new Map((store.get<DensityEntryData>(key)?.data.coins ?? []).map((c) => [c.s, c]));
  let universeError: string | undefined;
  let stopped = false;
  let dirty = false;
  let fetches = 0;
  let errors = 0;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const sleep = (ms: number) => new Promise<void>((r) => { const t = setTimeout(() => { timers.delete(t); r(); }, ms); timers.add(t); });

  function publish(): void {
    const out: DensityCoin[] = [];
    let scanned = 0;
    for (const c of coins.values()) {
      if (c.at || c.final) scanned++;
      const r = c.result ?? persisted.get(c.row.symbol) ?? null;
      if (r && Object.values(r.steps).some((x) => x.ds.length)) out.push({ ...r, c: c.row.change24h, v: c.row.volume24h, lev: c.lev });
    }
    store.put<DensityEntryData>(key, { venue, market, coverage: { scanned, total: coins.size, error: universeError, updatedAt: Date.now() }, coins: out });
  }

  async function universeLoop(): Promise<void> {
    while (!stopped) {
      try {
        const rows = await limiter().asWorker(() => getDensityUniverse(venue, market));
        const listed = new Set(rows.map((r) => r.symbol));
        const keep = new Set<string>();
        for (const row of rows) {
          if (row.volume24h < MIN_VOLUME) continue;
          keep.add(row.symbol);
          const c = coins.get(row.symbol);
          if (c) { c.row = row; c.lev = isLeveragedToken(row.symbol, listed); }
          else coins.set(row.symbol, { row, lev: isLeveragedToken(row.symbol, listed), at: 0, retryAt: 0, final: false, busy: false, result: null });
        }
        for (const s of coins.keys()) if (!keep.has(s)) coins.delete(s);
        universeError = undefined;
      } catch (e) {
        errors++;
        universeError = e instanceof Error ? e.message : 'Universe unavailable';
      }
      dirty = true;
      await sleep(universeError ? 15_000 : UNIVERSE_MS);
    }
  }

  /** A coin with a sizable density near the price (fresh or restored from the cache). */
  const isHot = (c: CoinState) => (c.result ?? persisted.get(c.row.symbol))?.steps['0']?.ds.some((d) => d.notional >= HOT_SIZE && d.distance <= HOT_DISTANCE) ?? false;

  /** Most urgent coin: hot coins that are due, then never scanned (most traded first), then the stalest that is due. */
  function next(): CoinState | null {
    const now = Date.now();
    let best: CoinState | null = null;
    let bestRank = Infinity;
    for (const c of coins.values()) {
      if (c.busy || c.final || c.retryAt > now) continue;
      const hot = isHot(c);
      const age = now - c.at;
      if (c.at && age < (hot ? HOT_MS : c.row.volume24h >= LIQUID ? LIQUID_MS : COLD_MS)) continue;
      // Hot coins are refreshed first (after a restart they haven't been fetched yet, but their cards are on screen).
      const tier = hot ? 0 : c.at ? 2 : 1;
      const rank = tier * 1e15 + (c.at ? -age : -c.row.volume24h);
      if (rank < bestRank) { best = c; bestRank = rank; }
    }
    return best;
  }

  function evaluate(c: CoinState, book: { bids: Array<[number, number]>; asks: Array<[number, number]> }, now: number): void {
    const prev = c.result ?? persisted.get(c.row.symbol) ?? null;
    const steps: Record<string, StepResult> = {};
    for (const step of NEST_STEPS) {
      const { densities, medians } = scanBook({ ...book, ts: now }, { stepPct: step, maxDistance: DENSITY_RANGE, floor: DENSITY_FLOOR });
      const tolerance = Math.max(step, 0.05) / 100;
      steps[String(step)] = { ds: trackLifetimes(prev?.steps[String(step)]?.ds ?? [], densities, now, tolerance), med: medians };
    }
    const mid = book.bids[0] && book.asks[0] ? (book.bids[0][0] + book.asks[0][0]) / 2 : c.row.last;
    c.result = { s: c.row.symbol, last: mid, c: c.row.change24h, v: c.row.volume24h, lev: c.lev, at: now, steps };
  }

  async function bookLoop(): Promise<void> {
    while (!stopped) {
      const c = next();
      if (!c) { await sleep(1_000); continue; }
      c.busy = true;
      try {
        const book = await limiter().asWorker(() => getDepth(venue, market, c.row.symbol));
        c.at = Date.now();
        c.retryAt = 0;
        fetches++;
        evaluate(c, book, c.at);
      } catch (e) {
        errors++;
        const status = (e as { status?: unknown } | null)?.status;
        if (status === 404 || status === 400) c.final = true;
        else c.retryAt = Date.now() + (status === 429 || status === 418 ? 30_000 : RETRY_MS);
      } finally {
        c.busy = false;
        dirty = true;
      }
    }
  }

  async function flushLoop(): Promise<void> {
    while (!stopped) {
      await sleep(2_000);
      if (dirty) { dirty = false; publish(); }
    }
  }

  void universeLoop();
  for (let i = 0; i < CONCURRENCY; i++) void bookLoop();
  void flushLoop();

  return {
    stop() { stopped = true; timers.forEach(clearTimeout); },
    stats() {
      let scanned = 0;
      for (const c of coins.values()) if (c.at || c.final) scanned++;
      return { coins: coins.size, scanned, fetches, errors };
    },
  };
}
