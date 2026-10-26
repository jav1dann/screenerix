/**
 * Strategy worker for one venue: every pass it runs the formation detectors over
 * the market worker's candles (1h + 5m, forming bar on the live price), advances
 * each setup's lifecycle and publishes the venue's formations to the scan cache.
 * It makes no upstream requests of its own.
 */
import type { ExchangeId } from '@/lib/market/exchanges';
import { detectAll } from '@/lib/strategies/detect';
import { advance, tfOf } from '@/lib/strategies/lifecycle';
import type { CoinPass } from '@/lib/strategies/lifecycle';
import type { Formation, StrategyCoverage } from '@/lib/strategies/types';
import type { MarketWorker } from './marketWorker';
import { STRATEGY_MIN_VOLUME } from './marketWorker';
import { scanStore, strategyKey } from './store';

const PASS_MS = 15_000;

export interface StrategyEntryData { venue: ExchangeId; coverage: StrategyCoverage; formations: Formation[] }

export interface StrategyWorker { stop(): void; stats(): { formations: number; scanned: number; total: number; passMs: number } }

export function startStrategyWorker(venue: ExchangeId, market: MarketWorker): StrategyWorker {
  const store = scanStore();
  const key = strategyKey(venue);
  // Tracked setups survive a restart (the cache is persisted).
  let formations: Formation[] = (store.get<StrategyEntryData>(key)?.data.formations ?? []).map((f) => ({ ...f, tf: tfOf(f) }));
  let coverage: StrategyCoverage = { venue, scanned: 0, total: 0, updatedAt: 0 };
  let passMs = 0;
  let last = '';

  function pass(): void {
    const t0 = Date.now();
    const coins = market.snapshot(STRATEGY_MIN_VOLUME);
    const passes: CoinPass[] = [];
    let scanned = 0;
    for (const c of coins) {
      if (!c.k1h && !c.k5m && !c.k1m) continue;
      if (c.k1h) scanned++;
      let candidates: CoinPass['candidates'] = [];
      try { candidates = detectAll({ k1h: c.k1h, k5m: c.k5m, k1m: c.k1m, price: c.price }); } catch { /* a bad series skips the coin this pass */ }
      passes.push({ symbol: c.symbol, price: c.price, volume24h: c.volume, candidates });
    }
    const now = Date.now();
    formations = advance(venue, formations, passes, now);
    // Coins with a live 1m setup get their 1m candles every minute (accurate wicks for the sweep).
    const hot = new Set<string>();
    for (const p of passes) if (p.candidates.some((c) => c.tf === '1m')) hot.add(p.symbol);
    for (const f of formations) if (f.tf === '1m' && f.stage !== 'INVALIDATED' && !f.doneAt) hot.add(f.symbol);
    market.setHot([...hot], 'strategies');
    coverage = { venue, scanned, total: coins.length, updatedAt: now };
    passMs = now - t0;
    // Publish only when something changed (prices move every pass, so this is mostly every pass).
    const sig = `${scanned}/${coins.length}|${formations.map((f) => `${f.id}${f.stage}${f.price}`).join(',')}`;
    if (sig !== last) { last = sig; store.put<StrategyEntryData>(key, { venue, coverage, formations }); }
  }

  const timer = setInterval(pass, PASS_MS);
  timer.unref?.();
  const first = setTimeout(pass, 2_000);
  first.unref?.();

  return {
    stop() { clearInterval(timer); clearTimeout(first); },
    stats: () => ({ formations: formations.length, scanned: coverage.scanned, total: coverage.total, passMs }),
  };
}
