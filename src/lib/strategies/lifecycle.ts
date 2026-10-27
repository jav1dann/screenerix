/**
 * Formation lifecycle: matches each pass's detector candidates to the setups
 * already tracked, and moves stages by price against the frozen levels.
 *
 *   FORMING ──(detector reports ACTIVE)──▶ ACTIVE ──(≥ 50% of the way to TP1)──▶ LATE
 *      └───────────────(price through SL, any stage)───────────────▶ INVALIDATED
 *
 * Stages only move forward. Levels follow the detector while FORMING and freeze
 * once ACTIVE. Ids are stable from the first sighting.
 */
import type { ExchangeId, Timeframe } from '@/lib/market/exchanges';
import { isMultiTf, STRATEGY_BY_ID } from './catalog';
import { qualityOf } from './types';
import type { Candidate, Formation, StrategyId } from './types';

const MIN = 60_000;
const HOUR = 60 * MIN;
/** A FORMING setup the detector stopped reporting is dropped after this. */
export const FORMING_GRACE_MS = 2 * MIN;
const KEEP_INVALIDATED_MS = 6 * HOUR;
const KEEP_DONE_MS = HOUR;
const KEEP_LATE_MS = 24 * HOUR;
const KEEP_ACTIVE_MS = 48 * HOUR;
/** Coins missing from passes (delisted, below the volume floor) lose their setups after this. */
const KEEP_UNSEEN_MS = HOUR;
/** Candidates within this fraction of a tracked entry are the same setup. */
const SAME_ENTRY = 0.005;
const MAX_PER_VENUE = 1_000;

export interface CoinPass { symbol: string; price: number; volume24h: number; candidates: readonly Candidate[] }

const sideKey = (f: { strategy: StrategyId; dir: string; tf?: string }, symbol: string) => `${f.strategy}:${tfOf(f)}:${symbol}:${f.dir}`;
/** A formation's timeframe (formations persisted before timeframes existed carry none). */
export const tfOf = (f: { strategy: StrategyId; tf?: Timeframe | string }): Timeframe => (f.tf as Timeframe | undefined) ?? STRATEGY_BY_ID.get(f.strategy)?.tfs[0] ?? '1h';
/** Stable id; multi-timeframe strategies include the timeframe (the same coin can set up on 1m and 15m). */
export const formationId = (c: Pick<Candidate, 'strategy' | 'tf' | 'dir' | 'anchorT'>, symbol: string): string => {
  const def = STRATEGY_BY_ID.get(c.strategy);
  return def && isMultiTf(def) ? `${c.strategy}:${c.tf}:${symbol}:${c.dir}:${c.anchorT}` : `${c.strategy}:${symbol}:${c.dir}:${c.anchorT}`;
};
const potentialOf = (entry: number, tp2: number) => (Math.abs(tp2 - entry) / entry) * 100;

function fromCandidate(c: Candidate): Pick<Formation, 'entry' | 'sl' | 'tp1' | 'tp2' | 'score' | 'quality' | 'orderFlow' | 'dailyAligned' | 'note' | 'potential' | 'strength'> {
  return { entry: c.entry, sl: c.sl, tp1: c.tp1, tp2: c.tp2, score: c.score, quality: qualityOf(c.score), orderFlow: c.orderFlow, dailyAligned: c.dailyAligned, note: c.note, potential: potentialOf(c.entry, c.tp2), strength: c.strength };
}

/** Price rules: SL → INVALIDATED; half way to TP1 (from ACTIVE) → LATE; TP2 → done. */
export function applyPrice(f: Formation, price: number, now: number): Formation {
  if (f.stage === 'INVALIDATED' || !(price > 0)) return f;
  const s = f.dir === 'LONG' ? 1 : -1;
  if (s * (price - f.sl) <= 0) return { ...f, price, stage: 'INVALIDATED', stageAt: now };
  let next: Formation = { ...f, price };
  if (f.stage === 'FORMING') return next;
  const progress = (s * (price - f.entry)) / Math.abs(f.tp1 - f.entry);
  if (f.stage === 'ACTIVE' && progress >= 0.5) next = { ...next, stage: 'LATE', stageAt: now };
  if (!next.doneAt && s * (price - f.tp2) >= 0) next = { ...next, stage: 'LATE', stageAt: next.stage === 'LATE' && f.stage === 'LATE' ? f.stageAt : now, doneAt: now };
  return next;
}

/** Whether a formation is still worth showing at `now`. */
export function keep(f: Formation, now: number): boolean {
  if (f.stage === 'INVALIDATED') return now - f.stageAt <= KEEP_INVALIDATED_MS;
  if (f.doneAt) return now - f.doneAt <= KEEP_DONE_MS;
  if (f.stage === 'LATE') return now - f.stageAt <= KEEP_LATE_MS;
  if (f.stage === 'ACTIVE') return now - f.stageAt <= KEEP_ACTIVE_MS;
  return now - f.seenAt <= FORMING_GRACE_MS;
}

/**
 * One pass for a venue: `prev` are the tracked formations, `coins` every coin
 * scanned this pass with its candidates. Returns the new tracked set (newest first).
 */
export function advance(venue: ExchangeId, prev: readonly Formation[], coins: readonly CoinPass[], now: number): Formation[] {
  const bySide = new Map<string, Formation[]>();
  for (const f of prev) {
    const k = sideKey(f, f.symbol);
    const list = bySide.get(k);
    if (list) list.push(f); else bySide.set(k, [f]);
  }
  const usedIds = new Set(prev.map((f) => f.id));
  const updated = new Map<string, Formation>();
  const scanned = new Map(coins.map((c) => [c.symbol, c]));

  for (const coin of coins) {
    for (const c of coin.candidates) {
      const tracked = bySide.get(sideKey(c, coin.symbol)) ?? [];
      const hit = tracked.find((f) => f.stage !== 'INVALIDATED' && !f.doneAt && !updated.has(f.id) && (f.anchorT === c.anchorT || Math.abs(f.entry - c.entry) / f.entry <= SAME_ENTRY));
      if (hit) {
        let f: Formation = { ...hit, seenAt: now, volume24h: coin.volume24h };
        if (hit.stage === 'FORMING') {
          f = { ...f, ...fromCandidate(c) };
          if (c.stage === 'ACTIVE') f = { ...f, stage: 'ACTIVE', stageAt: now };
        }
        updated.set(f.id, f);
        continue;
      }
      const id = formationId(c, coin.symbol);
      // The same setup already ran its course (invalidated / done): don't start it again.
      if (usedIds.has(id)) continue;
      usedIds.add(id);
      updated.set(id, {
        id, strategy: c.strategy, tf: c.tf, venue, symbol: coin.symbol, dir: c.dir, anchorT: c.anchorT, stage: c.stage,
        ...fromCandidate(c), price: coin.price, volume24h: coin.volume24h, detectedAt: now, stageAt: now, seenAt: now,
      });
    }
  }

  const out: Formation[] = [];
  const seen = new Set<string>();
  for (const f of [...updated.values(), ...prev]) {
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    const coin = scanned.get(f.symbol);
    if (!coin && now - f.seenAt > KEEP_UNSEEN_MS && f.stage !== 'INVALIDATED') continue;
    const next = coin ? applyPrice({ ...f, volume24h: coin.volume24h }, coin.price, now) : f;
    if (keep(next, now)) out.push(next);
  }
  out.sort((a, b) => b.detectedAt - a.detectedAt);
  return out.slice(0, MAX_PER_VENUE);
}
