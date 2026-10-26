/**
 * The background scan engine: one screener worker per venue and one densities
 * worker per venue × market, started once per server process (see
 * `src/instrumentation.ts`) and kept on `globalThis` so hot reloads and the
 * separately bundled route handlers all see the same instance.
 */
import { DENSITY_MARKETS } from '@/lib/densities/types';
import type { DensityMarket } from '@/lib/densities/types';
import { EXCHANGE_IDS } from '@/lib/market/exchanges';
import type { ExchangeId } from '@/lib/market/exchanges';
import { startDensityWorker } from './densityWorker';
import type { DensityWorker } from './densityWorker';
import { limiter } from './limiter';
import { startMarketWorker } from './marketWorker';
import type { MarketWorker } from './marketWorker';
import { scanStore } from './store';
import { startAlertWorker } from './alertWorker';
import type { AlertWorker } from './alertWorker';
import { startStrategyWorker } from './strategyWorker';
import type { StrategyWorker } from './strategyWorker';

const PERSIST_MS = 60_000;

export interface Engine {
  startedAt: number;
  restored: number;
  markets: Map<ExchangeId, MarketWorker>;
  densities: Map<string, DensityWorker>;
  strategies: Map<ExchangeId, StrategyWorker>;
  status(): unknown;
}

const KEY = Symbol.for('screenerix.scanEngine');
type Global = typeof globalThis & { [KEY]?: Promise<Engine> };

async function boot(): Promise<Engine> {
  const store = scanStore();
  // Last known state first, so the very first requests are answered from cache.
  const restored = await store.restore();
  const markets = new Map<ExchangeId, MarketWorker>();
  const densities = new Map<string, DensityWorker>();
  for (const venue of EXCHANGE_IDS) markets.set(venue, startMarketWorker(venue));
  for (const venue of EXCHANGE_IDS) {
    for (const market of DENSITY_MARKETS[venue]) densities.set(`${venue}:${market}`, startDensityWorker(venue, market as DensityMarket));
  }
  const strategies = new Map<ExchangeId, StrategyWorker>();
  for (const [venue, w] of markets) strategies.set(venue, startStrategyWorker(venue, w));
  const alerts = new Map<ExchangeId, AlertWorker>();
  for (const [venue, w] of markets) alerts.set(venue, startAlertWorker(venue, w));
  const persist = setInterval(() => { void store.persist().catch(() => {}); }, PERSIST_MS);
  persist.unref?.();
  const startedAt = Date.now();
  console.log(`[scan] background engine started: ${markets.size} screener venues, ${densities.size} density markets, ${restored} cached entries restored`);
  return {
    startedAt,
    restored,
    markets,
    densities,
    strategies,
    status: () => ({
      uptimeSec: Math.round((Date.now() - startedAt) / 1000),
      restored,
      screener: Object.fromEntries([...markets].map(([k, w]) => [k, w.stats()])),
      densities: Object.fromEntries([...densities].map(([k, w]) => [k, w.stats()])),
      strategies: Object.fromEntries([...strategies].map(([k, w]) => [k, w.stats()])),
      alerts: Object.fromEntries([...alerts].map(([k, w]) => [k, w.stats()])),
      entries: Object.fromEntries(store.keys().map((k) => { const e = store.get(k)!; return [k, { version: e.version, ageSec: Math.round((Date.now() - e.updatedAt) / 1000) }]; })),
      upstream: limiter().stats(),
    }),
  };
}

/** Start the engine (idempotent per process). Disabled with `SCANNER=off`. */
export function startEngine(): Promise<Engine> | null {
  if (process.env.SCANNER === 'off' || process.env.NEXT_PHASE === 'phase-production-build') return null;
  const g = globalThis as Global;
  return (g[KEY] ??= boot());
}

/** The running engine, if any (routes use this for status; data reads go through the store). */
export function runningEngine(): Promise<Engine> | null {
  return (globalThis as Global)[KEY] ?? null;
}
