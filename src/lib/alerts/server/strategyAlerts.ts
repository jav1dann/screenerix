/**
 * Strategy alerts: after each strategy-engine pass, the formations that just became ACTIVE (or
 * were just detected) are matched against the venue's active strategy alerts and delivered like
 * any firing (event, open terminals, Telegram, push). Each setup is reported at most once per
 * alert; one-time alerts archive after their first. Server-only.
 */
import { hasAccess } from '@/lib/auth/access';
import { findById } from '@/lib/auth/users';
import { STRATEGY_BY_ID } from '@/lib/strategies/catalog';
import type { Formation } from '@/lib/strategies/types';
import { fmtPrice } from '@/lib/format';
import type { ExchangeId } from '@/lib/market/exchanges';
import { ANY_COIN, MAX_STRATEGY_FIRES_PER_PASS } from '../types';
import type { Alert, AlertDetail } from '../types';
import { deliver } from './deliver';
import { allAlerts, recordDelivery, recordFire } from './store';

/** What changed for a formation this pass: first seen, and / or just became ACTIVE. */
export interface FormationChange { formation: Formation; isNew: boolean; activated: boolean }

/** Whether `f` is what alert `a` asks for (pure: used by the worker and the tests). */
export function matches(a: Pick<Alert, 'kind' | 'symbol' | 'strategy'>, c: FormationChange): boolean {
  const sp = a.strategy;
  const f = c.formation;
  if (a.kind !== 'strategy' || !sp) return false;
  if (!(sp.on === 'active' ? c.activated : c.isNew)) return false;
  if (f.stage === 'INVALIDATED' || f.doneAt) return false;
  return (sp.strategy === 'all' || f.strategy === sp.strategy)
    && (a.symbol === ANY_COIN || f.symbol === a.symbol)
    && (sp.tf === 'any' || f.tf === sp.tf)
    && (sp.dir === 'any' || f.dir === sp.dir)
    && (f.strength?.value ?? f.score) >= sp.minScore;
}

/** "Long Continuation after Liquidity Sweep · 5m LONG — active: entry 3,200, SL 3,180, TP1 3,240 · strength 72%" (stored English text). */
export const strategyEventText = (f: Formation): string =>
  `${STRATEGY_BY_ID.get(f.strategy)?.name ?? f.strategy} · ${f.tf} ${f.dir} — ${f.stage.toLowerCase()}: entry ${fmtPrice(f.entry)}, SL ${fmtPrice(f.sl)}, TP1 ${fmtPrice(f.tp1)} · strength ${f.strength?.value ?? f.score}%`;

const detailOf = (f: Formation): AlertDetail => ({
  kind: 'strategy', formationId: f.id, strategy: f.strategy, tf: f.tf, dir: f.dir, stage: f.stage,
  entry: f.entry, sl: f.sl, tp1: f.tp1, tp2: f.tp2, score: f.score, strength: f.strength?.value ?? null,
});

/** Setups already reported per alert (formation ids; process memory, trimmed). */
const g = globalThis as typeof globalThis & { __sxStrategyFired?: Map<string, Set<string>> };
const fired = (g.__sxStrategyFired ??= new Map());

/** Match one pass's changes for `venue`; returns how many notifications were sent. */
export function notifyStrategyAlerts(venue: ExchangeId, changes: readonly FormationChange[], now = Date.now()): number {
  if (!changes.length) return 0;
  const alerts = allAlerts().filter((a) => a.kind === 'strategy' && a.status === 'active' && a.exchange === venue);
  let sent = 0;
  const access = new Map<string, boolean>();
  for (const alert of alerts) {
    let ok = access.get(alert.userId);
    if (ok === undefined) { const u = findById(alert.userId); ok = Boolean(u && hasAccess(u, now)); access.set(alert.userId, ok); }
    if (!ok) continue;
    const seen = fired.get(alert.id) ?? new Set<string>();
    let current: Alert | null = alert;
    let n = 0;
    for (const c of changes) {
      if (!current || current.status !== 'active' || n >= MAX_STRATEGY_FIRES_PER_PASS) break;
      if (!matches(current, c) || seen.has(c.formation.id)) continue;
      const f = c.formation;
      const r = recordFire(current, f.entry, strategyEventText(f), now, detailOf(f), f.symbol);
      if (!r) break;
      seen.add(f.id);
      current = r.alert;
      n++;
      sent++;
      void deliver(r.event)
        .then((d) => { if (d.telegram || d.push !== undefined) recordDelivery(r.event, d); })
        .catch((e) => console.error(`[alerts] strategy delivery failed: ${(e as Error).message}`));
    }
    if (seen.size > 2_000) fired.set(alert.id, new Set([...seen].slice(-1_000)));
    else fired.set(alert.id, seen);
  }
  return sent;
}

/**
 * Compare a pass's formations with the previous pass's: new ids, and ids whose stage just became
 * ACTIVE. `prev` comes from the persisted cache on start, so a restart doesn't re-report.
 */
export function changesBetween(prev: ReadonlyMap<string, Formation['stage']>, next: readonly Formation[]): FormationChange[] {
  const out: FormationChange[] = [];
  for (const f of next) {
    const before = prev.get(f.id);
    const isNew = before === undefined;
    const activated = f.stage === 'ACTIVE' && before !== 'ACTIVE';
    if (isNew || activated) out.push({ formation: f, isNew, activated });
  }
  return out;
}
