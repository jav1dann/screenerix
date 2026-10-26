/** Workspace and dashboard filtering / sorting of formations (pure; shared by every view and the tests). */
import type { DashboardPrefs, FeedSort, Workspace, WorkspaceSettings } from './store';
import { distanceBps, QUALITY_RANK } from './types';
import type { Formation, Stage } from './types';

const HOUR = 3_600_000;

/** Whether a formation passes a workspace's Strategy and Filter settings (`ignoreStages` for per-stage counters). */
export function matchFormation(f: Formation, s: WorkspaceSettings, now: number, ignoreStages = false): boolean {
  if (f.dir === 'LONG' ? !s.long : !s.short) return false;
  if (s.minPotential > 0 && f.potential < s.minPotential) return false;
  if (f.score < s.minScore) return false;
  if (s.maxDistBps > 0 && distanceBps(f, f.price) > s.maxDistBps) return false;
  if (s.orderFlow && !f.orderFlow) return false;
  if (s.dailyTrend && !f.dailyAligned) return false;
  if (s.timeframes.length && !s.timeframes.includes(f.tf)) return false;
  if (!ignoreStages && !s.stages.includes(f.stage)) return false;
  if (s.minVolume > 0 && f.volume24h < s.minVolume) return false;
  if (s.maxAgeHours > 0 && now - f.detectedAt > s.maxAgeHours * HOUR) return false;
  if (s.exclude.includes(f.symbol)) return false;
  return true;
}

export function sortFormations(list: readonly Formation[], sort: FeedSort): Formation[] {
  const out = [...list];
  switch (sort) {
    case 'newest': return out.sort((a, b) => b.detectedAt - a.detectedAt);
    case 'potential': return out.sort((a, b) => b.potential - a.potential);
    case 'quality': return out.sort((a, b) => b.score - a.score || b.potential - a.potential);
    case 'closest': return out.sort((a, b) => distanceBps(a, a.price) - distanceBps(b, b.price));
    case 'volume': return out.sort((a, b) => b.volume24h - a.volume24h);
  }
}

/** A workspace's formations: its algorithm on its venue, through its settings, sorted. */
export function workspaceFormations(ws: Workspace, all: readonly Formation[], now: number, exceptions: ReadonlySet<string> = new Set()): Formation[] {
  return sortFormations(
    all.filter((f) => f.strategy === ws.strategy && f.venue === ws.venue && !exceptions.has(f.symbol) && matchFormation(f, ws.settings, now)),
    ws.settings.sort,
  );
}

/** Per-stage counts of a workspace (every filter except the stage filter). */
export function stageCounts(ws: Workspace, all: readonly Formation[], now: number, exceptions: ReadonlySet<string> = new Set()): Record<Stage, number> {
  const out: Record<Stage, number> = { FORMING: 0, ACTIVE: 0, LATE: 0, INVALIDATED: 0 };
  for (const f of all) {
    if (f.strategy === ws.strategy && f.venue === ws.venue && !exceptions.has(f.symbol) && matchFormation(f, ws.settings, now, true)) out[f.stage]++;
  }
  return out;
}

/** The dashboard feed: every enabled workspace's formations (each through its own settings, stage filter aside), then the feed's quick filters. */
export function feedFormations(workspaces: readonly Workspace[], all: readonly Formation[], d: DashboardPrefs, now: number, exceptions: ReadonlySet<string> = new Set()): Array<{ f: Formation; ws: Workspace }> {
  const byId = new Map<string, { f: Formation; ws: Workspace }>();
  for (const ws of workspaces) {
    if (!ws.enabled) continue;
    for (const f of all) {
      if (byId.has(f.id) || f.strategy !== ws.strategy || f.venue !== ws.venue || exceptions.has(f.symbol)) continue;
      if (!matchFormation(f, ws.settings, now, true)) continue;
      if (d.stage !== 'ALL' && f.stage !== d.stage) continue;
      if (QUALITY_RANK[f.quality] < QUALITY_RANK[d.quality]) continue;
      if (d.minPotential > 0 && f.potential < d.minPotential) continue;
      byId.set(f.id, { f, ws });
    }
  }
  const items = [...byId.values()];
  const order = new Map(sortFormations(items.map((x) => x.f), d.sort).map((f, i) => [f.id, i]));
  return items.sort((a, b) => order.get(a.f.id)! - order.get(b.f.id)!);
}
