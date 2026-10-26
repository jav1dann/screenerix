/**
 * The user's strategy workspaces and dashboard view state (localStorage).
 * A workspace binds one algorithm from the Pool to a venue plus its own filters,
 * table fields and chart level options; the same algorithm can be added twice.
 */
import { createValueStore } from '@/lib/alerts/localStore';
import { EXCHANGE_IDS, isExchangeId } from '@/lib/market/exchanges';
import type { ExchangeId, Timeframe } from '@/lib/market/exchanges';
import { STRATEGY_BY_ID } from './catalog';
import { isStrategyId, QUALITIES, STAGES } from './types';
import type { Quality, Stage, StrategyId } from './types';

export type FeedSort = 'newest' | 'potential' | 'quality' | 'closest' | 'volume';
export const FEED_SORTS: ReadonlyArray<{ value: FeedSort; label: string }> = [
  { value: 'newest', label: 'Newest first' },
  { value: 'potential', label: 'Highest potential' },
  { value: 'quality', label: 'Best quality' },
  { value: 'closest', label: 'Closest to entry' },
  { value: 'volume', label: 'Highest 24h volume' },
];
export type ViewMode = 'cards' | 'table';

export type TableField = 'symbol' | 'strategy' | 'tf' | 'venue' | 'stage' | 'dir' | 'quality' | 'potential' | 'price' | 'entry' | 'sl' | 'tp1' | 'tp2' | 'distance' | 'volume' | 'age' | 'flags';
export const TABLE_FIELDS: ReadonlyArray<{ id: TableField; label: string; hint: string }> = [
  { id: 'symbol', label: 'Symbol', hint: 'Coin' },
  { id: 'strategy', label: 'Strategy', hint: 'Algorithm that found the setup' },
  { id: 'tf', label: 'Timeframe', hint: 'Candles the setup was found on' },
  { id: 'venue', label: 'Exchange', hint: 'Venue the setup was found on' },
  { id: 'stage', label: 'Stage', hint: 'Forming / Active / Late / Invalidated' },
  { id: 'dir', label: 'Direction', hint: 'Long or Short' },
  { id: 'quality', label: 'Quality', hint: 'Setup quality and score (0–100)' },
  { id: 'potential', label: 'Potential', hint: 'Move from entry to TP2' },
  { id: 'price', label: 'Price', hint: 'Last price' },
  { id: 'entry', label: 'Entry', hint: 'Entry level' },
  { id: 'sl', label: 'SL', hint: 'Stop loss' },
  { id: 'tp1', label: 'TP1', hint: 'First target' },
  { id: 'tp2', label: 'TP2', hint: 'Second target' },
  { id: 'distance', label: 'To entry', hint: 'Distance from price to entry (bps)' },
  { id: 'volume', label: '24h Vol', hint: '24h turnover' },
  { id: 'age', label: 'Age', hint: 'Time since the setup was first detected' },
  { id: 'flags', label: 'Confirmations', hint: 'Order flow (Δ > 1σ) and daily-trend alignment' },
];
const FIELD_IDS = new Set(TABLE_FIELDS.map((f) => f.id));
export const DEFAULT_FIELDS: readonly TableField[] = ['symbol', 'tf', 'stage', 'dir', 'quality', 'potential', 'price', 'entry', 'sl', 'tp1', 'tp2', 'distance', 'volume', 'age'];

export const CHART_TFS: readonly Timeframe[] = ['1m', '5m', '15m', '1h', '4h'];
/** Chart timeframe options: a fixed one, or each formation's own ('setup'). */
export type ChartTf = Timeframe | 'setup';
export const CHART_TF_OPTIONS: ReadonlyArray<{ value: ChartTf; label: string }> = [{ value: 'setup', label: 'Setup timeframe' }, ...CHART_TFS.map((t) => ({ value: t, label: t }))];
/** Timeframes a formation can carry. */
const FORMATION_TFS: readonly Timeframe[] = ['1m', '5m', '15m', '1h'];
export const COLUMN_OPTIONS = [2, 3, 4] as const;
export type Columns = (typeof COLUMN_OPTIONS)[number];
export const MAX_CHARTS = 12;

export interface WorkspaceSettings {
  /* General */
  /** 'setup' = each chart on its formation's timeframe. */
  chartTf: ChartTf;
  columns: Columns;
  maxCharts: number;
  view: 'charts' | 'table';
  /* Strategy */
  long: boolean;
  short: boolean;
  /** %, 0 = any. */
  minPotential: number;
  /** 0–100. */
  minScore: number;
  /** Basis points, 0 = any. */
  maxDistBps: number;
  orderFlow: boolean;
  dailyTrend: boolean;
  /** Timeframes shown (multi-timeframe strategies); [] = all. */
  timeframes: Timeframe[];
  /* Filter & Sorting */
  stages: Stage[];
  /** $, 0 = any. */
  minVolume: number;
  /** Hours since detection, 0 = any. */
  maxAgeHours: number;
  exclude: string[];
  sort: FeedSort;
  /* Table Fields */
  fields: TableField[];
  /* Levels */
  showEntry: boolean;
  showSl: boolean;
  showTp1: boolean;
  showTp2: boolean;
  lineLabels: boolean;
  badge: boolean;
}

export interface Workspace {
  uid: string;
  strategy: StrategyId;
  name: string;
  venue: ExchangeId;
  enabled: boolean;
  settings: WorkspaceSettings;
}

export interface DashboardPrefs {
  strategiesView: ViewMode;
  feedView: ViewMode;
  stage: Stage | 'ALL';
  quality: Quality;
  /** %, 0 = any. */
  minPotential: number;
  sort: FeedSort;
}

export interface StrategiesState { workspaces: Workspace[]; dashboard: DashboardPrefs }

export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
  chartTf: '15m', columns: 3, maxCharts: 9, view: 'charts',
  long: true, short: true, minPotential: 0, minScore: 0, maxDistBps: 0, orderFlow: false, dailyTrend: false, timeframes: [],
  stages: ['FORMING', 'ACTIVE', 'LATE'], minVolume: 0, maxAgeHours: 0, exclude: [], sort: 'newest',
  fields: [...DEFAULT_FIELDS],
  showEntry: true, showSl: true, showTp1: true, showTp2: true, lineLabels: true, badge: true,
};
export const DEFAULT_DASHBOARD: DashboardPrefs = { strategiesView: 'cards', feedView: 'cards', stage: 'ALL', quality: 'LOW', minPotential: 0, sort: 'newest' };
export const DEFAULT_STATE: StrategiesState = { workspaces: [], dashboard: DEFAULT_DASHBOARD };

/** The loosest Strategy + Filter settings ("Clear filters"). */
export const CLEARED_FILTERS: Partial<WorkspaceSettings> = {
  long: true, short: true, minPotential: 0, minScore: 0, maxDistBps: 0, orderFlow: false, dailyTrend: false, timeframes: [],
  stages: [...STAGES], minVolume: 0, maxAgeHours: 0, exclude: [],
};

/** Settings keys per modal tab (for "Reset default"). */
export const SETTINGS_SECTIONS = {
  general: ['chartTf', 'columns', 'maxCharts', 'view'],
  strategy: ['long', 'short', 'minPotential', 'minScore', 'maxDistBps', 'orderFlow', 'dailyTrend', 'timeframes'],
  filter: ['stages', 'minVolume', 'maxAgeHours', 'exclude', 'sort'],
  fields: ['fields'],
  levels: ['showEntry', 'showSl', 'showTp1', 'showTp2', 'lineLabels', 'badge'],
} as const satisfies Record<string, ReadonlyArray<keyof WorkspaceSettings>>;
export type SettingsSection = keyof typeof SETTINGS_SECTIONS;

/* ── Sanitize ── */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const num = (v: unknown, d: number, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d);
const oneOf = <T>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d);
const SORTS = FEED_SORTS.map((s) => s.value);

export function sanitizeSettings(raw: unknown, base: WorkspaceSettings = DEFAULT_WORKSPACE_SETTINGS): WorkspaceSettings {
  const r = isObj(raw) ? raw : {};
  const d = base;
  const stages = Array.isArray(r.stages) ? STAGES.filter((s) => (r.stages as unknown[]).includes(s)) : d.stages;
  const fields = Array.isArray(r.fields) ? [...new Set((r.fields as unknown[]).filter((f): f is TableField => typeof f === 'string' && FIELD_IDS.has(f as TableField)))] : d.fields;
  const exclude = Array.isArray(r.exclude) ? [...new Set((r.exclude as unknown[]).filter((s): s is string => typeof s === 'string' && /^[A-Z0-9]{1,20}$/.test(s)))].slice(0, 200) : d.exclude;
  return {
    chartTf: oneOf<ChartTf>(r.chartTf, ['setup', ...CHART_TFS], d.chartTf),
    columns: oneOf(r.columns, COLUMN_OPTIONS, d.columns),
    maxCharts: Math.round(num(r.maxCharts, d.maxCharts, 1, MAX_CHARTS)),
    view: oneOf(r.view, ['charts', 'table'] as const, d.view),
    long: bool(r.long, d.long),
    short: bool(r.short, d.short),
    minPotential: num(r.minPotential, d.minPotential, 0, 100),
    minScore: Math.round(num(r.minScore, d.minScore, 0, 100)),
    maxDistBps: Math.round(num(r.maxDistBps, d.maxDistBps, 0, 10_000)),
    orderFlow: bool(r.orderFlow, d.orderFlow),
    dailyTrend: bool(r.dailyTrend, d.dailyTrend),
    timeframes: Array.isArray(r.timeframes) ? FORMATION_TFS.filter((t) => (r.timeframes as unknown[]).includes(t)) : d.timeframes,
    stages,
    minVolume: num(r.minVolume, d.minVolume, 0, 1e12),
    maxAgeHours: num(r.maxAgeHours, d.maxAgeHours, 0, 168),
    exclude,
    sort: oneOf(r.sort, SORTS, d.sort),
    fields: fields.length ? fields : [...DEFAULT_FIELDS],
    showEntry: bool(r.showEntry, d.showEntry),
    showSl: bool(r.showSl, d.showSl),
    showTp1: bool(r.showTp1, d.showTp1),
    showTp2: bool(r.showTp2, d.showTp2),
    lineLabels: bool(r.lineLabels, d.lineLabels),
    badge: bool(r.badge, d.badge),
  };
}

export function sanitizeStrategies(raw: unknown): StrategiesState {
  if (!isObj(raw)) return DEFAULT_STATE;
  const seen = new Set<string>();
  const workspaces: Workspace[] = [];
  for (const w of Array.isArray(raw.workspaces) ? raw.workspaces : []) {
    if (!isObj(w) || !isStrategyId(w.strategy)) continue;
    const uid = typeof w.uid === 'string' && w.uid && !seen.has(w.uid) ? w.uid : newUid();
    seen.add(uid);
    const def = STRATEGY_BY_ID.get(w.strategy)!;
    workspaces.push({
      uid,
      strategy: w.strategy,
      name: typeof w.name === 'string' && w.name.trim() ? w.name.trim().slice(0, 40) : def.name,
      venue: typeof w.venue === 'string' && isExchangeId(w.venue) ? w.venue : EXCHANGE_IDS[0],
      enabled: bool(w.enabled, true),
      settings: sanitizeSettings(w.settings),
    });
  }
  const d = isObj(raw.dashboard) ? raw.dashboard : {};
  return {
    workspaces: workspaces.slice(0, 20),
    dashboard: {
      strategiesView: oneOf(d.strategiesView, ['cards', 'table'] as const, DEFAULT_DASHBOARD.strategiesView),
      feedView: oneOf(d.feedView, ['cards', 'table'] as const, DEFAULT_DASHBOARD.feedView),
      stage: oneOf(d.stage, ['ALL', ...STAGES] as const, DEFAULT_DASHBOARD.stage),
      quality: oneOf(d.quality, QUALITIES, DEFAULT_DASHBOARD.quality),
      minPotential: num(d.minPotential, DEFAULT_DASHBOARD.minPotential, 0, 100),
      sort: oneOf(d.sort, SORTS, DEFAULT_DASHBOARD.sort),
    },
  };
}

let uidSeq = 0;
function newUid(): string {
  return `ws${Date.now().toString(36)}${(uidSeq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export const strategiesStore = createValueStore<StrategiesState>('screenerix.strategies.v1', DEFAULT_STATE, sanitizeStrategies);

/* ── Actions ── */

const setWorkspaces = (f: (ws: Workspace[]) => Workspace[]) => {
  const s = strategiesStore.getSnapshot();
  strategiesStore.set({ ...s, workspaces: f(s.workspaces) });
};

/** Subscribe to an algorithm on `venue`; returns the new workspace's uid. */
export function addWorkspace(strategy: StrategyId, venue: ExchangeId): string {
  const def = STRATEGY_BY_ID.get(strategy)!;
  const uid = newUid();
  setWorkspaces((ws) => {
    const same = ws.filter((w) => w.strategy === strategy).length;
    return [...ws, { uid, strategy, name: same ? `${def.name} ${same + 1}` : def.name, venue, enabled: true, settings: { ...DEFAULT_WORKSPACE_SETTINGS, chartTf: def.chartTf } }];
  });
  return uid;
}
export const removeWorkspace = (uid: string) => setWorkspaces((ws) => ws.filter((w) => w.uid !== uid));
export const toggleWorkspace = (uid: string, enabled: boolean) => setWorkspaces((ws) => ws.map((w) => (w.uid === uid ? { ...w, enabled } : w)));
export function updateWorkspace(uid: string, patch: Partial<Omit<Workspace, 'uid' | 'settings'>> & { settings?: Partial<WorkspaceSettings> }): void {
  setWorkspaces((ws) => ws.map((w) => (w.uid === uid
    ? { ...w, ...patch, name: patch.name !== undefined ? patch.name.slice(0, 40) : w.name, settings: patch.settings ? sanitizeSettings({ ...w.settings, ...patch.settings }) : w.settings }
    : w)));
}
/** Restore one settings tab of a workspace to its defaults. */
export function resetWorkspaceSection(uid: string, section: SettingsSection): void {
  const w = strategiesStore.getSnapshot().workspaces.find((x) => x.uid === uid);
  if (!w) return;
  const base: WorkspaceSettings = { ...DEFAULT_WORKSPACE_SETTINGS, chartTf: STRATEGY_BY_ID.get(w.strategy)!.chartTf };
  const patch: Partial<WorkspaceSettings> = {};
  for (const k of SETTINGS_SECTIONS[section]) (patch as Record<string, unknown>)[k] = base[k];
  updateWorkspace(uid, { settings: patch });
}
export const setDashboard = (patch: Partial<DashboardPrefs>) => {
  const s = strategiesStore.getSnapshot();
  strategiesStore.set({ ...s, dashboard: { ...s.dashboard, ...patch } });
};
