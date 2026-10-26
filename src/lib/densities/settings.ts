/**
 * Densities screener settings, persisted per browser: the control-bar
 * selection, the filters (+ presets) and the coloring (+ presets).
 */
import { createListStore, createValueStore } from '@/lib/alerts/localStore';
import { EXCHANGE_IDS } from '@/lib/market/exchanges';
import type { ExchangeId } from '@/lib/market/exchanges';
import { DENSITY_FLOOR, DENSITY_RANGE, NEST_STEPS } from '@/lib/scan/types';
import type { NestStep } from '@/lib/scan/types';
import { isDensityMarket } from './types';
import type { DensityMarket } from './types';

type Raw = Partial<Record<string, unknown>>;
const obj = (v: unknown): Raw => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Raw) : {});
const numIn = (v: unknown, d: number, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : d);
const boolOr = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const HEX = /^#[0-9a-f]{6}$/i;
const colorOr = (v: unknown, d: string) => (typeof v === 'string' && HEX.test(v) ? v : d);
const symbols = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter((s): s is string => typeof s === 'string' && /^[\p{Lu}\p{Lo}\p{N}]{1,20}$/u.test(s)))] : []);
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/* ── Control bar ── */

export type DensitySort = 'az' | 'distance' | 'size' | 'timeAsc' | 'timeDesc';
export const DENSITY_SORTS: readonly DensitySort[] = ['az', 'distance', 'size', 'timeAsc', 'timeDesc'];
export const SORT_LABEL: Record<DensitySort, string> = { az: 'A-Z', distance: 'Distance', size: 'Size', timeAsc: 'Time ↑', timeDesc: 'Time ↓' };

export interface DensityPrefs {
  venues: ExchangeId[];
  /** Perpetual futures and / or spot (at least one). */
  markets: DensityMarket[];
  sort: DensitySort;
}

export const DEFAULT_PREFS: DensityPrefs = { venues: ['binance'], markets: ['futures'], sort: 'size' };

function sanitizePrefs(raw: unknown): DensityPrefs {
  const r = obj(raw);
  const venues = Array.isArray(r.venues) ? EXCHANGE_IDS.filter((id) => (r.venues as unknown[]).includes(id)) : DEFAULT_PREFS.venues;
  const markets = Array.isArray(r.markets) ? (['futures', 'spot'] as const).filter((m) => (r.markets as unknown[]).some((x) => typeof x === 'string' && isDensityMarket(x) && x === m)) : DEFAULT_PREFS.markets;
  return {
    venues: venues.length ? venues : DEFAULT_PREFS.venues,
    markets: markets.length ? markets : DEFAULT_PREFS.markets,
    sort: typeof r.sort === 'string' && (DENSITY_SORTS as readonly string[]).includes(r.sort) ? (r.sort as DensitySort) : DEFAULT_PREFS.sort,
  };
}

export const densityPrefs = createValueStore<DensityPrefs>('screenerix.densityPrefs.v1', DEFAULT_PREFS, sanitizePrefs);

/** Venues in control-bar order; `id: null` = no data source yet ("Soon"). */
export const DENSITY_VENUES: ReadonlyArray<{ id: ExchangeId | null; name: string }> = [
  { id: 'binance', name: 'Binance' },
  { id: 'bybit', name: 'Bybit' },
  { id: 'okx', name: 'OKX' },
  { id: 'bitget', name: 'Bitget' },
  { id: 'gate', name: 'Gate.io' },
  { id: null, name: 'MEXC' },
  { id: null, name: 'KuCoin' },
  { id: null, name: 'BingX' },
  { id: null, name: 'HTX' },
  { id: null, name: 'Hyperliquid' },
  { id: null, name: 'Aster' },
  { id: null, name: 'Lighter' },
  { id: null, name: 'Bitunix' },
  { id: 'coinbase', name: 'Coinbase' },
];

/* ── Filters ── */

export type DensitySide = 'both' | 'bids' | 'asks';

export interface DensityFilters {
  /** Minimum density notional ($). */
  minSize: number;
  /** Max distance from the price (%). */
  maxDistance: number;
  /** Seconds a density must have stood. */
  minLifetime: number;
  /** Coins below this 24h turnover ($) aren't scanned. */
  minVolume24h: number;
  /** Also require ≥ this × the side's median level (0 = off). */
  multiple: number;
  side: DensitySide;
  /** Densities listed per card. */
  perCard: number;
  excludeStable: boolean;
  excludeLeveraged: boolean;
  /** Merge neighbouring levels into buckets of `stepPct` % of the price (one of the server's NEST_STEPS). */
  nesting: { enabled: boolean; stepPct: number };
  /** Per-coin minimum size, replacing `minSize`. */
  individual: Array<{ symbol: string; minSize: number }>;
  blacklist: string[];
}

/** "Minimum lifetime" choices, in seconds (the stored unit). */
export const MIN_LIFETIME_OPTIONS: readonly number[] = [0, 1, 5, 15, 30, 60, 300, 900, 1800, 3600, 14_400];

/** 0 → "Any", 45 → "45s", 300 → "5m", 5400 → "1h 30m". */
export function fmtLifetime(sec: number): string {
  if (!(sec > 0)) return 'Any';
  if (sec < 60) return `${sec}s`;
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const parts = [h && `${h}h`, m && `${m}m`, s && `${s}s`].filter(Boolean);
  return parts.join(' ');
}

export const DEFAULT_FILTERS: DensityFilters = {
  minSize: 300_000,
  maxDistance: 5,
  minLifetime: 0,
  minVolume24h: 5_000_000,
  multiple: 0,
  side: 'both',
  perCard: 4,
  excludeStable: true,
  excludeLeveraged: true,
  nesting: { enabled: false, stepPct: 0.05 },
  individual: [],
  blacklist: [],
};

/** Nesting steps a user can pick (the server evaluates exactly these). */
export const NESTING_CHOICES = NEST_STEPS.filter((x) => x > 0);
const nearestStep = (v: number): number => NESTING_CHOICES.reduce((best, x) => (Math.abs(x - v) < Math.abs(best - v) ? x : best), NESTING_CHOICES[0]);
/** The server step a filter set reads (0 = nesting off). */
export const stepOf = (f: DensityFilters): NestStep => (f.nesting.enabled ? (nearestStep(f.nesting.stepPct) as NestStep) : 0);

export function sanitizeFilters(raw: unknown): DensityFilters {
  const r = obj(raw);
  const d = DEFAULT_FILTERS;
  const nest = obj(r.nesting);
  const seen = new Set<string>();
  const individual = (Array.isArray(r.individual) ? r.individual : []).flatMap((x) => {
    const o = obj(x);
    const symbol = typeof o.symbol === 'string' ? o.symbol : '';
    if (!symbols([symbol]).length || seen.has(symbol) || typeof o.minSize !== 'number' || !(o.minSize >= 0)) return [];
    seen.add(symbol);
    return [{ symbol, minSize: o.minSize }];
  });
  return {
    // The server tracks densities ≥ DENSITY_FLOOR within DENSITY_RANGE: nothing smaller / further exists.
    minSize: Math.max(DENSITY_FLOOR, numIn(r.minSize, d.minSize, 0, 1e12)),
    maxDistance: numIn(r.maxDistance, d.maxDistance, 0.01, DENSITY_RANGE),
    minLifetime: numIn(r.minLifetime, d.minLifetime, 0, 86_400),
    minVolume24h: numIn(r.minVolume24h, d.minVolume24h, 0, 1e13),
    multiple: numIn(r.multiple, d.multiple, 0, 1_000),
    side: r.side === 'bids' || r.side === 'asks' ? r.side : 'both',
    perCard: Math.round(numIn(r.perCard, d.perCard, 1, 12)),
    excludeStable: boolOr(r.excludeStable, d.excludeStable),
    excludeLeveraged: boolOr(r.excludeLeveraged, d.excludeLeveraged),
    nesting: { enabled: boolOr(nest.enabled, d.nesting.enabled), stepPct: nearestStep(numIn(nest.stepPct, d.nesting.stepPct, 0.001, 5)) },
    individual,
    blacklist: symbols(r.blacklist),
  };
}

export const densityFilters = createValueStore<DensityFilters>('screenerix.densityFilters.v1', DEFAULT_FILTERS, sanitizeFilters);

/** Settings that differ from the defaults (badge on the Filters button). */
export function activeFilterCount(f: DensityFilters): number {
  const d = DEFAULT_FILTERS;
  return [
    f.minSize !== d.minSize, f.maxDistance !== d.maxDistance, f.minLifetime !== d.minLifetime, f.minVolume24h !== d.minVolume24h,
    f.multiple !== d.multiple, f.side !== d.side, f.excludeStable !== d.excludeStable, f.excludeLeveraged !== d.excludeLeveraged,
    f.nesting.enabled, f.individual.length > 0, f.blacklist.length > 0,
  ].filter(Boolean).length;
}

export interface FilterPreset { id: string; name: string; filters: DensityFilters; builtIn?: boolean }

export const BUILTIN_FILTER_PRESETS: readonly FilterPreset[] = [
  { id: 'builtin:default', name: 'Default', filters: DEFAULT_FILTERS, builtIn: true },
  { id: 'builtin:large', name: 'Large ≥ $1M', filters: { ...DEFAULT_FILTERS, minSize: 1_000_000 }, builtIn: true },
  { id: 'builtin:near', name: 'Near price ≤ 1%', filters: { ...DEFAULT_FILTERS, maxDistance: 1 }, builtIn: true },
  { id: 'builtin:lived', name: 'Long-lived ≥ 5m', filters: { ...DEFAULT_FILTERS, minLifetime: 300 }, builtIn: true },
];

const isFilterPreset = (v: unknown): v is FilterPreset => {
  const o = obj(v);
  return typeof o.id === 'string' && typeof o.name === 'string' && o.name.trim().length > 0 && typeof o.filters === 'object' && o.filters !== null;
};
export const filterPresetStore = createListStore<FilterPreset>('screenerix.densityFilterPresets.v1', isFilterPreset);

export function saveFilterPreset(name: string, filters: DensityFilters): void {
  filterPresetStore.set([...filterPresetStore.getSnapshot(), { id: newId(), name: name.trim(), filters }]);
}
export function deleteFilterPreset(id: string): void {
  filterPresetStore.set(filterPresetStore.getSnapshot().filter((p) => p.id !== id));
}

/* ── Coloring ── */

export interface DensityColoring {
  /** "High densities": sizes from `min` up get this color (Size 2 wins over Size 1). */
  size1: { min: number; color: string };
  size2: { min: number; color: string };
  font: string;
  asks: string;
  bids: string;
}

export const DEFAULT_COLORING: DensityColoring = {
  size1: { min: 500_000, color: '#F5A524' },
  size2: { min: 2_000_000, color: '#B48CFF' },
  font: '#EDEEF0',
  asks: '#E5484D',
  bids: '#30A46C',
};

export function sanitizeColoring(raw: unknown): DensityColoring {
  const r = obj(raw);
  const d = DEFAULT_COLORING;
  const tier = (v: unknown, t: DensityColoring['size1']) => { const o = obj(v); return { min: numIn(o.min, t.min, 0, 1e12), color: colorOr(o.color, t.color) }; };
  return { size1: tier(r.size1, d.size1), size2: tier(r.size2, d.size2), font: colorOr(r.font, d.font), asks: colorOr(r.asks, d.asks), bids: colorOr(r.bids, d.bids) };
}

export const densityColoring = createValueStore<DensityColoring>('screenerix.densityColoring.v1', DEFAULT_COLORING, sanitizeColoring);

export interface ColoringPreset { id: string; name: string; coloring: DensityColoring; builtIn?: boolean }

export const BUILTIN_COLORING_PRESETS: readonly ColoringPreset[] = [
  { id: 'builtin:default', name: 'Default', coloring: DEFAULT_COLORING, builtIn: true },
  {
    id: 'builtin:contrast', name: 'High contrast', builtIn: true,
    coloring: { size1: { min: 500_000, color: '#FFD60A' }, size2: { min: 2_000_000, color: '#FF2D95' }, font: '#FFFFFF', asks: '#FF453A', bids: '#32D74B' },
  },
  {
    id: 'builtin:mono', name: 'Mono', builtIn: true,
    coloring: { size1: { min: 500_000, color: '#B8BAC4' }, size2: { min: 2_000_000, color: '#FFFFFF' }, font: '#EDEEF0', asks: '#8B8D98', bids: '#5C5E6A' },
  },
];

const isColoringPreset = (v: unknown): v is ColoringPreset => {
  const o = obj(v);
  return typeof o.id === 'string' && typeof o.name === 'string' && o.name.trim().length > 0 && typeof o.coloring === 'object' && o.coloring !== null;
};
export const coloringPresetStore = createListStore<ColoringPreset>('screenerix.densityColoringPresets.v1', isColoringPreset);

export function saveColoringPreset(name: string, coloring: DensityColoring): void {
  coloringPresetStore.set([...coloringPresetStore.getSnapshot(), { id: newId(), name: name.trim(), coloring }]);
}
export function deleteColoringPreset(id: string): void {
  coloringPresetStore.set(coloringPresetStore.getSnapshot().filter((p) => p.id !== id));
}
