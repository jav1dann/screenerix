/**
 * Custom color rules: per metric, ascending breakpoints → colors. A value takes the
 * color of the highest breakpoint it reaches (below the first one it keeps its
 * default color). One rule set, persisted per browser, colors the Market Review
 * ticker list and the matching values in every chart-card header.
 *
 * Breakpoints are in the metric's display unit (2 = 2%, dollars, counts).
 */
import { createValueStore } from '@/lib/alerts/localStore';
import { fmtMetric, GROUPS, METRIC_BY_KEY, METRICS } from './metrics';
import type { GroupId, MetricUnit } from './metrics';

export interface ColorStop { min: number; color: string }
export interface ColorRule {
  stops: ColorStop[];
  /** Compare |value| (signed metrics such as daily change or funding: −3% colors like +3%). */
  abs?: boolean;
}
export type ColorRules = Readonly<Record<string, ColorRule>>;

/** Live 24h stats a rule can target besides the screener catalog (card headers and the ticker list). */
export const LIVE_RULE_METRICS: ReadonlyArray<{ key: string; name: string; unit: MetricUnit }> = [
  { key: 'change24h', name: 'Daily change', unit: '%' },
  { key: 'range24h', name: 'Daily range', unit: '%' },
  { key: 'volume24h', name: 'Daily volume', unit: '$' },
  { key: 'trades24h', name: 'Daily trades', unit: 'n' },
];

/** Every metric a rule can target, grouped for the picker. */
export const RULE_GROUPS: ReadonlyArray<{ id: GroupId | 'live'; title: string; metrics: ReadonlyArray<{ key: string; name: string; unit: MetricUnit }> }> = [
  { id: 'live', title: 'Daily (live)', metrics: LIVE_RULE_METRICS },
  ...GROUPS.map((g) => ({ id: g.id, title: g.title, metrics: METRICS.filter((m) => m.group === g.id).map((m) => ({ key: m.key, name: m.name, unit: m.unit })) })),
];

export function ruleMetric(key: string): { key: string; name: string; unit: MetricUnit } | undefined {
  const def = METRIC_BY_KEY.get(key);
  return def ? { key, name: def.name, unit: def.unit } : LIVE_RULE_METRICS.find((m) => m.key === key);
}

export const fmtRuleValue = (key: string, v: number): string => fmtMetric(ruleMetric(key)?.unit ?? 'n', v);

/** Color of `value` under the rule for `key`, or undefined (no rule / below every breakpoint). */
export function ruleColor(rules: ColorRules, key: string, value: number | null | undefined): string | undefined {
  const rule = rules[key];
  if (!rule || value === null || value === undefined || !Number.isFinite(value)) return undefined;
  const v = rule.abs ? Math.abs(value) : value;
  let color: string | undefined;
  for (const s of rule.stops) if (v >= s.min) color = s.color; // stops are kept ascending
  return color;
}

/** Example rules a new metric starts from (trader-typical NATR / range tiers). */
export const DEFAULT_STOPS: readonly ColorStop[] = [
  { min: 2, color: '#F5A524' },
  { min: 5, color: '#E5484D' },
];

const HEX = /^#[0-9a-f]{6}$/i;
const MAX_STOPS = 8;

export function sanitizeRule(raw: unknown): ColorRule | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as { stops?: unknown; abs?: unknown };
  const stops = (Array.isArray(r.stops) ? r.stops : [])
    .flatMap((s): ColorStop[] => {
      const o = (typeof s === 'object' && s !== null ? s : {}) as { min?: unknown; color?: unknown };
      return typeof o.min === 'number' && Number.isFinite(o.min) && typeof o.color === 'string' && HEX.test(o.color) ? [{ min: o.min, color: o.color }] : [];
    })
    .sort((a, b) => a.min - b.min)
    .slice(0, MAX_STOPS);
  return stops.length ? { stops, ...(r.abs === true ? { abs: true } : {}) } : null;
}

function sanitize(raw: unknown): ColorRules {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, ColorRule> = {};
  for (const [key, v] of Object.entries(raw)) {
    const rule = ruleMetric(key) ? sanitizeRule(v) : null;
    if (rule) out[key] = rule;
  }
  return out;
}

export const colorRuleStore = createValueStore<ColorRules>('screenerix.colorRules.v1', {}, sanitize);

/** Save (or, with no breakpoints, remove) the rule of one metric. */
export function setColorRule(key: string, rule: ColorRule | null): void {
  const next: Record<string, ColorRule> = { ...colorRuleStore.getSnapshot() };
  const clean = rule && sanitizeRule(rule);
  if (clean) next[key] = clean; else delete next[key];
  colorRuleStore.set(next);
}
