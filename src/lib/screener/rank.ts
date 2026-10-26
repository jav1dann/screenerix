/**
 * Screener evaluation over the server's precomputed metric table.
 *
 * The background worker keeps every coin's metric values current
 * (`/api/scan/:venue/metrics`); applying a filter — ignore list, conditions,
 * sort — is a pure pass over those rows, done in the browser in about a
 * millisecond, so edits and new filters apply instantly.
 */
import { barMask } from '@/lib/scan/types';
import type { MetricRow } from '@/lib/scan/types';
import type { Condition, ScreenerFilter } from './filters';
import { METRIC_BY_KEY, unsupportedReason } from './metrics';
import type { MetricDef, Reading } from './metrics';

export interface ScanMatch { symbol: string; score: number | null }

export interface ScanSnapshot {
  filterId: string | null;
  /** Matching coins, best first by the filter's sort. */
  matches: ScanMatch[];
  /** Coins that passed the instant checks (candidates for the heavy ones). */
  candidates: number;
  /** Candidates whose bar data is loaded (fully evaluated). */
  scanned: number;
  /** Coins on the venue. */
  total: number;
  /** Conditions (and the sort) skipped because the venue lacks the data. */
  skipped: string[];
}

export const EMPTY_SCAN: ScanSnapshot = { filterId: null, matches: [], candidates: 0, scanned: 0, total: 0, skipped: [] };

export function passes(c: Condition, r: Reading | null): boolean {
  if (!r || !Number.isFinite(r.value)) return false;
  if (c.direction && c.direction !== 'any' && r.dir !== undefined && r.dir !== (c.direction === 'up' ? 1 : -1)) return false;
  if (c.min !== undefined && r.value < c.min) return false;
  if (c.max !== undefined && r.value > c.max) return false;
  return true;
}

/** Metric keys a filter reads (conditions + sort) — what to ask the server for. */
export function keysFor(filter: ScreenerFilter): string[] {
  return [...new Set([...filter.conditions.map((c) => c.metric), filter.sort.metric])].filter((k) => METRIC_BY_KEY.has(k)).sort();
}

const reading = (row: MetricRow, key: string): Reading | null => {
  const v = row.m[key];
  if (v === null || v === undefined) return null;
  const dir = row.d?.[key];
  return dir === undefined ? { value: v } : { value: v, dir };
};

/** Rank a venue's rows by `filter` (rows must carry the filter's `keysFor` metrics). */
export function rankRows(filter: ScreenerFilter, rows: readonly MetricRow[], exchange: string, venueName: string): ScanSnapshot {
  const supported = (d: MetricDef) => unsupportedReason(d, exchange, venueName) === null;
  const conds = filter.conditions.flatMap((c) => {
    const def = METRIC_BY_KEY.get(c.metric);
    return def && supported(def) ? [{ c, def }] : [];
  });
  const skipped = filter.conditions.flatMap((c) => {
    const def = METRIC_BY_KEY.get(c.metric);
    return def && !supported(def) ? [def.name] : [];
  });
  const sortDef = METRIC_BY_KEY.get(filter.sort.metric);
  const sortOk = sortDef && supported(sortDef) ? sortDef : undefined;
  if (sortDef && !sortOk) skipped.push(`${sortDef.name} (sort)`);
  const instant = conds.filter((x) => x.def.needs.length === 0);
  const heavy = conds.filter((x) => x.def.needs.length > 0);
  const need = barMask([...heavy.flatMap((x) => x.def.needs), ...(sortOk?.needs ?? [])]);
  const ignore = new Set(filter.ignore);

  const matches: ScanMatch[] = [];
  let candidates = 0;
  let scanned = 0;
  for (const row of rows) {
    if (ignore.has(row.s) || !instant.every(({ c, def }) => passes(c, reading(row, def.key)))) continue;
    candidates++;
    if ((row.b & need) !== need) continue;
    scanned++;
    if (!heavy.every(({ c, def }) => passes(c, reading(row, def.key)))) continue;
    matches.push({ symbol: row.s, score: sortOk ? (row.m[sortOk.key] ?? null) : null });
  }
  const dir = filter.sort.dir === 'desc' ? -1 : 1;
  matches.sort((x, y) => (x.score === null ? 1 : y.score === null ? -1 : (x.score - y.score) * dir));
  return { filterId: filter.id, matches, candidates, scanned, total: rows.length, skipped };
}
