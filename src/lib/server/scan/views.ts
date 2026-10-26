/** Projections of the scan cache into API payloads (shared by the JSON and SSE routes). */
import { ADAPTERS, isExchangeId } from '@/lib/market/exchanges';
import type { ExchangeId } from '@/lib/market/exchanges';
import { isDensityMarket, supportsDensity } from '@/lib/densities/types';
import type { DensityMarket } from '@/lib/densities/types';
import { METRIC_BY_KEY } from '@/lib/screener/metrics';
import { DENSITY_FLOOR, DENSITY_RANGE, isNestStep } from '@/lib/scan/types';
import type { DensitiesPayload, MetricRow, MetricsPayload, NestStep, ServerDensityCard } from '@/lib/scan/types';
import type { DensityEntryData } from './densityWorker';
import type { MetricsEntryData } from './marketWorker';
import type { StrategyEntryData } from './strategyWorker';
import type { StrategiesPayload } from '@/lib/strategies/types';
import { densityKey, metricsKey, scanStore, strategyKey } from './store';

/* ── Parameters ── */

export function parseVenue(v: string | null): ExchangeId | null {
  return v && isExchangeId(v) ? v : null;
}

/** Valid, de-duplicated metric keys (sorted, so equal sets share a cache line). */
export function parseKeys(raw: string | null): string[] | null {
  const keys = [...new Set((raw ?? '').split(',').map((k) => k.trim()).filter(Boolean))].sort();
  return keys.length <= 80 && keys.every((k) => METRIC_BY_KEY.has(k)) ? keys : null;
}

export function parsePairs(raw: string | null): Array<{ venue: ExchangeId; market: DensityMarket }> | null {
  const out: Array<{ venue: ExchangeId; market: DensityMarket }> = [];
  for (const p of (raw ?? '').split(',').map((x) => x.trim()).filter(Boolean)) {
    const [venue, market] = p.split(':');
    if (!venue || !market || !isExchangeId(venue) || !isDensityMarket(market) || !supportsDensity(venue, market)) return null;
    if (!out.some((x) => x.venue === venue && x.market === market)) out.push({ venue, market });
  }
  return out.length ? out : null;
}

/** Optional server-side trim of density cards: minimum size ($, at least the floor) and max distance (%). */
export function parseTrim(min: string | null, dist: string | null): { min: number; dist: number } | null {
  const m = min === null || min === '' ? DENSITY_FLOOR : Number(min);
  const d = dist === null || dist === '' ? DENSITY_RANGE : Number(dist);
  return Number.isFinite(m) && Number.isFinite(d) && m >= 0 && d > 0 ? { min: Math.max(DENSITY_FLOOR, m), dist: Math.min(DENSITY_RANGE, d) } : null;
}

export function parseStep(raw: string | null): NestStep | null {
  const n = raw === null || raw === '' ? 0 : Number(raw);
  return isNestStep(n) ? n : null;
}

/* ── Metrics ── */

const project = (r: MetricRow, keys: readonly string[]): MetricRow => {
  const m: Record<string, number | null> = {};
  let d: Record<string, 1 | -1> | undefined;
  for (const k of keys) {
    m[k] = r.m[k] ?? null;
    const dir = r.d?.[k];
    if (dir !== undefined) (d ??= {})[k] = dir;
  }
  return d ? { s: r.s, p: r.p, c: r.c, v: r.v, f: r.f, b: r.b, m, d } : { s: r.s, p: r.p, c: r.c, v: r.v, f: r.f, b: r.b, m };
};

export function metricsPayload(venue: ExchangeId, keys: readonly string[]): MetricsPayload {
  const e = scanStore().get<MetricsEntryData>(metricsKey(venue));
  if (!e) return { venue, version: 0, coverage: { scanned: 0, total: 0, updatedAt: 0 }, rows: [] };
  return { venue, version: e.version, coverage: e.data.coverage, rows: e.data.rows.map((r) => project(r, keys)) };
}

/** Memoised JSON of `metricsPayload` (one serialisation per cache version and key set). */
export function metricsJson(venue: ExchangeId, keys: readonly string[]): string {
  const hit = scanStore().serialize(metricsKey(venue), `m:${keys.join(',')}`, () => metricsPayload(venue, keys));
  return hit?.body ?? JSON.stringify(metricsPayload(venue, keys));
}

/* ── Densities ── */

export function densityVersion(pairs: ReadonlyArray<{ venue: ExchangeId; market: DensityMarket }>): number {
  const store = scanStore();
  return pairs.reduce((sum, p) => sum + (store.get(densityKey(p.venue, p.market))?.version ?? 0), 0);
}

export function densitiesPayload(pairs: ReadonlyArray<{ venue: ExchangeId; market: DensityMarket }>, step: NestStep, trim = { min: DENSITY_FLOOR, dist: DENSITY_RANGE }): DensitiesPayload {
  const maxDist = trim.dist / 100;
  const store = scanStore();
  const cards: ServerDensityCard[] = [];
  const coverage: DensitiesPayload['coverage'] = [];
  for (const { venue, market } of pairs) {
    const e = store.get<DensityEntryData>(densityKey(venue, market));
    coverage.push({ venue, market, scanned: e?.data.coverage.scanned ?? 0, total: e?.data.coverage.total ?? 0, ...(e?.data.coverage.error ? { error: `${ADAPTERS[venue].name}: ${e.data.coverage.error}` } : {}) });
    for (const c of e?.data.coins ?? []) {
      const r = c.steps[String(step)];
      const ds = r?.ds.filter((d) => d.notional >= trim.min && d.distance <= maxDist) ?? [];
      if (!r || !ds.length) continue;
      cards.push({
        key: `${venue}:${market}:${c.s}`, venue, market, symbol: c.s, last: c.last, change24h: c.c, volume24h: c.v, lev: c.lev,
        medians: r.med, densities: ds, updatedAt: c.at,
      });
    }
  }
  return { version: densityVersion(pairs), step, coverage, cards };
}

/** Memoised JSON for a single venue × market (the common case); several pairs are combined on the fly. */
export function densitiesJson(pairs: ReadonlyArray<{ venue: ExchangeId; market: DensityMarket }>, step: NestStep, trim: { min: number; dist: number }): string {
  if (pairs.length === 1) {
    const { venue, market } = pairs[0];
    const hit = scanStore().serialize(densityKey(venue, market), `d:${step}:${trim.min}:${trim.dist}`, () => densitiesPayload(pairs, step, trim));
    if (hit) return hit.body;
  }
  return JSON.stringify(densitiesPayload(pairs, step, trim));
}

export const densityKeys = (pairs: ReadonlyArray<{ venue: ExchangeId; market: DensityMarket }>) => pairs.map((p) => densityKey(p.venue, p.market));

/* ── Strategies ── */

/** De-duplicated, sorted venue list (`binance,bybit`). */
export function parseVenues(raw: string | null): ExchangeId[] | null {
  const out = [...new Set((raw ?? '').split(',').map((x) => x.trim()).filter(Boolean))].sort();
  return out.length && out.every(isExchangeId) ? (out as ExchangeId[]) : null;
}

export const strategyKeys = (venues: readonly ExchangeId[]) => venues.map(strategyKey);

export function strategyVersion(venues: readonly ExchangeId[]): number {
  const store = scanStore();
  return venues.reduce((sum, v) => sum + (store.get(strategyKey(v))?.version ?? 0), 0);
}

export function strategiesPayload(venues: readonly ExchangeId[]): StrategiesPayload {
  const store = scanStore();
  const coverage: StrategiesPayload['coverage'] = [];
  const formations: StrategiesPayload['formations'] = [];
  for (const venue of venues) {
    const e = store.get<StrategyEntryData>(strategyKey(venue));
    coverage.push(e?.data.coverage ?? { venue, scanned: 0, total: 0, updatedAt: 0 });
    if (e) formations.push(...e.data.formations);
  }
  return { version: strategyVersion(venues), coverage, formations };
}

export function strategiesJson(venues: readonly ExchangeId[]): string {
  if (venues.length === 1) {
    const hit = scanStore().serialize(strategyKey(venues[0]), 's', () => strategiesPayload(venues));
    if (hit) return hit.body;
  }
  return JSON.stringify(strategiesPayload(venues));
}
