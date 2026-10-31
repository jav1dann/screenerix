/**
 * Central terminal settings (the Settings modal), persisted per browser.
 *
 * One value store with a section per Settings tab. `sanitize` repairs every
 * field, so old or hand-edited storage can never break the terminal. Session
 * state (the venue, sort, timeframe and grid picked in the header) stays in
 * `terminalPrefs`; the "Default …" settings here override it when the terminal opens.
 */
import type { MarketType } from '@/lib/alerts/alertStore';
import { createListStore, createValueStore } from '@/lib/alerts/localStore';
import { ADAPTERS, EXCHANGE_IDS, isExchangeId } from '@/lib/market/exchanges';
import type { ExchangeId, Timeframe } from '@/lib/market/exchanges';
import { CARD_TIMEFRAMES, GRID_LAYOUTS, RANGE_WINDOWS } from '@/lib/market/terminalPrefs';
import type { GridCount, SortMode, SortPref, TerminalPrefs } from '@/lib/market/terminalPrefs';
import { GROUPS, METRIC_BY_KEY, METRICS, unsupportedReason } from '@/lib/screener/metrics';
import type { GroupId } from '@/lib/screener/metrics';

export type { SortMode, SortPref } from '@/lib/market/terminalPrefs';

/* ── Tabs ── */

export type SettingsTab = 'exchanges' | 'sorting' | 'timeframe' | 'tops' | 'indicators' | 'chart' | 'buttons';
export const SETTINGS_TABS: ReadonlyArray<{ id: SettingsTab; label: string }> = [
  { id: 'exchanges', label: 'Exchanges & Markets' },
  { id: 'sorting', label: 'Sorting' },
  { id: 'timeframe', label: 'Timeframe' },
  { id: 'tops', label: 'Tops' },
  { id: 'indicators', label: 'Indicators Above the Chart' },
  { id: 'chart', label: 'Chart Settings' },
  { id: 'buttons', label: 'Buttons on Charts' },
];
export const isSettingsTab = (v: unknown): v is SettingsTab => SETTINGS_TABS.some((t) => t.id === v);

/* ── Catalogs ── */

/** Venues in settings order; `id: null` = no data source yet. */
export const SETTINGS_VENUES: ReadonlyArray<{ id: ExchangeId | null; name: string; badge?: 'ALPHA' | 'SOON' }> = [
  { id: 'binance', name: 'Binance' },
  { id: 'bybit', name: 'Bybit' },
  { id: 'okx', name: 'OKX' },
  { id: 'gate', name: 'Gate' },
  { id: null, name: 'MEXC', badge: 'SOON' },
  { id: 'bitget', name: 'BitGet' },
  { id: null, name: 'KuCoin', badge: 'SOON' },
  { id: null, name: 'BingX', badge: 'SOON' },
  { id: null, name: 'HTX', badge: 'SOON' },
  { id: null, name: 'HL', badge: 'ALPHA' },
  { id: null, name: 'Aster', badge: 'SOON' },
  { id: null, name: 'Lighter', badge: 'ALPHA' },
  { id: null, name: 'Bitunix', badge: 'SOON' },
  { id: 'coinbase', name: 'Coinbase' },
];

export const marketOf = (id: ExchangeId): MarketType => (ADAPTERS[id].market === 'perp' ? 'futures' : 'spot');
export const MARKET_LABEL: Record<MarketType, string> = { futures: 'Futures', spot: 'Spot' };

export interface SortModeDef {
  id: SortMode;
  /** Settings label, e.g. "Range (%)". */
  title: string;
  /** Short name after the window in the header, e.g. "5m Range". */
  short: string;
  windows: ReadonlyArray<{ id: string; label: string }>;
  key: (window: string) => string;
  /** Ranking direction for a window (default: highest first). */
  dir?: (window: string) => 'asc' | 'desc';
  hint?: string;
}

const RANGE_WINS = RANGE_WINDOWS.map((w) => ({ id: w, label: w }));
const AVG_WINS = [
  { id: '1_30m', label: '1m/30m' }, { id: '5_2h', label: '5m/2h' }, { id: '15_6h', label: '15m/6h' },
  { id: '30_12h', label: '30m/12h' }, { id: '1h_24h', label: '1h/24h' },
];
const SPIKE_WINS = [{ id: '1m', label: '1m' }, { id: '5m', label: '5m' }, { id: '15m', label: '15m' }, { id: '1h', label: '1h' }];
/** NATR metric windows: candle size / ATR periods (`natr_1_30`, `natr_5_14`). */
const NATR_WINS = [{ id: '5_14', label: '5m·14' }, { id: '1_30', label: '1m·30' }];

export const SORT_MODES: readonly SortModeDef[] = [
  { id: 'range', title: 'Range (%)', short: 'Range', windows: RANGE_WINS, key: (w) => `range_${w}` },
  { id: 'oiRange', title: 'OI Range (%)', short: 'OI Range', windows: RANGE_WINS, key: (w) => `oiRange_${w}`, hint: 'Futures venues with open-interest history' },
  { id: 'avgTrades', title: 'Average number of trades', short: 'Avg trades', windows: AVG_WINS, key: (w) => `avgTrades_${w}`, hint: 'Venues that publish trade counts (Binance)' },
  { id: 'tradesSpike', title: 'Trades Spike (%)', short: 'Trades spike', windows: SPIKE_WINS, key: (w) => `tradesSpike_${w}`, hint: 'Venues that publish trade counts (Binance)' },
  { id: 'avgVolume', title: 'Average volume', short: 'Avg volume', windows: AVG_WINS, key: (w) => `avgVol_${w}` },
  { id: 'volume', title: 'Volume', short: 'Volume', windows: RANGE_WINS, key: (w) => `vol_${w}` },
  { id: 'natr', title: 'NATR (%)', short: 'NATR', windows: NATR_WINS, key: (w) => `natr_${w}`, hint: 'Normalized ATR: average candle range as % of price' },
];
// Funding is not a sort: every Map card shows the live rate in its header instead.
/** Sort modes that existed before a stored settings object recorded `seen` (newer ones are switched on for it). */
const LEGACY_SORT_MODES: readonly SortMode[] = ['range', 'oiRange', 'avgTrades', 'tradesSpike', 'avgVolume', 'volume'];
export const SORT_MODE: Record<SortMode, SortModeDef> = Object.fromEntries(SORT_MODES.map((m) => [m.id, m])) as Record<SortMode, SortModeDef>;
export const isSortMode = (v: unknown): v is SortMode => SORT_MODES.some((m) => m.id === v);

export const sortMetric = (s: SortPref): string => SORT_MODE[s.mode].key(s.window);
export const sortDir = (s: SortPref): 'asc' | 'desc' => SORT_MODE[s.mode].dir?.(s.window) ?? 'desc';
export function sortLabel(s: SortPref): string {
  const m = SORT_MODE[s.mode];
  return `${m.windows.find((w) => w.id === s.window)?.label ?? s.window} ${m.short}`;
}
/** Why a sort can't be computed on `venue` (e.g. no trade counts), or null when it can. */
export function sortUnavailable(s: SortPref, venue: ExchangeId): string | null {
  const def = METRIC_BY_KEY.get(sortMetric(s));
  return def ? unsupportedReason(def, venue, ADAPTERS[venue].name) : null;
}
/**
 * `sort`, or — on a venue that can't compute it — the first enabled mode that venue can.
 * The stored choice is kept, so it comes back on a venue that supports it.
 */
export function venueSort(sort: SortPref, modes: readonly SortMode[], venue: ExchangeId): SortPref {
  if (!sortUnavailable(sort, venue)) return sort;
  const ok = modes.filter((m) => !sortUnavailable({ mode: m, window: SORT_MODE[m].windows[0].id }, venue));
  return ok.length ? allowedSort(sort, ok) : sort;
}

/** Live stats every chart card computes itself (no server metric needed). */
export const LIVE_INDICATORS = [
  { id: 'sort', label: 'Sort metric', hint: 'Whatever the Market Map is sorted by (e.g. 5m Range)' },
  { id: 'range24h', label: 'Daily range' },
  { id: 'change24h', label: 'Daily change' },
  { id: 'trades24h', label: 'Daily trades' },
  { id: 'volume24h', label: 'Daily volume' },
] as const;
export type LiveIndicator = (typeof LIVE_INDICATORS)[number]['id'];
/** A live stat id, or any metric key from the screener catalog. */
export type IndicatorId = LiveIndicator | (string & {});

const isLiveIndicator = (v: string): v is LiveIndicator => LIVE_INDICATORS.some((x) => x.id === v);
export const isIndicator = (v: unknown): v is IndicatorId => typeof v === 'string' && (isLiveIndicator(v) || METRIC_BY_KEY.has(v));
export function indicatorLabel(id: IndicatorId): string {
  return LIVE_INDICATORS.find((x) => x.id === id)?.label ?? METRIC_BY_KEY.get(id)?.name ?? id;
}
/** Catalog metrics grouped for the Indicators tab. */
export const INDICATOR_GROUPS: ReadonlyArray<{ id: GroupId; title: string; keys: string[] }> =
  GROUPS.map((g) => ({ id: g.id, title: g.title, keys: METRICS.filter((m) => m.group === g.id).map((m) => m.key) }));

export const INDICATOR_SIZES = ['xs', 'sm', 'md', 'lg', 'xl'] as const;
export type IndicatorSize = (typeof INDICATOR_SIZES)[number];

export const CHART_BUTTONS = [
  { id: 'copy', label: 'Copy name' },
  { id: 'pin', label: 'Pin' },
  { id: 'watchlist', label: 'Add to watchlist' },
  { id: 'exceptions', label: 'Add to exceptions', hint: 'Hides the coin from the Market Map' },
  { id: 'tradingview', label: 'Open in TradingView' },
  { id: 'tiger', label: 'Open in Tiger' },
  { id: 'metascalp', label: 'Open in Metascalp' },
  { id: 'vataga', label: 'Open in Vataga' },
  { id: 'colibri', label: 'Open in Colibri' },
] as const;
export type ButtonId = (typeof CHART_BUTTONS)[number]['id'];
export const TERMINAL_BUTTONS = ['tiger', 'metascalp', 'vataga', 'colibri'] as const;
export type TerminalButton = (typeof TERMINAL_BUTTONS)[number];
const isButton = (v: unknown): v is ButtonId => CHART_BUTTONS.some((b) => b.id === v);

/* ── Settings ── */

export interface Settings {
  exchanges: {
    /** Venue the terminal opens on ('last' = where the previous session left off). */
    defaultVenue: 'last' | ExchangeId;
    venues: ExchangeId[];
    markets: MarketType[];
  };
  /** `seen`: every mode this settings object has offered, so modes added later start enabled. */
  sorting: { defaultMode: 'last' | SortMode; modes: SortMode[]; seen: SortMode[] };
  timeframe: { defaultTf: 'last' | Timeframe; enabled: Timeframe[] };
  tops: { defaultGrid: 'last' | GridCount; enabled: GridCount[] };
  indicators: { showSettingsBadge: boolean; items: IndicatorId[]; size: IndicatorSize };
  chart: {
    /** Price-scale margins of the Map cards (% of the chart height). */
    gapTop: number;
    gapBottom: number;
    /** Bar spacing (px). */
    candleWidth: number;
    /** Empty bars after the last candle. */
    rightSpace: number;
    grid: boolean;
    watermark: { show: boolean; size: number; opacity: number; offsetX: number; offsetY: number; instrumentType: boolean };
  };
  buttons: { order: ButtonId[]; enabled: ButtonId[]; templates: Record<TerminalButton, string> };
}

export const DEFAULT_SETTINGS: Settings = {
  exchanges: { defaultVenue: 'last', venues: [...EXCHANGE_IDS], markets: ['futures', 'spot'] },
  sorting: { defaultMode: 'last', modes: SORT_MODES.map((m) => m.id), seen: SORT_MODES.map((m) => m.id) },
  timeframe: { defaultTf: 'last', enabled: [...CARD_TIMEFRAMES] },
  tops: { defaultGrid: 'last', enabled: GRID_LAYOUTS.map((g) => g.count) },
  indicators: { showSettingsBadge: true, items: ['sort', 'range24h', 'trades24h', 'volume24h'], size: 'sm' },
  chart: {
    gapTop: 8, gapBottom: 24, candleWidth: 6, rightSpace: 4, grid: true,
    watermark: { show: true, size: 28, opacity: 6, offsetX: 0, offsetY: 0, instrumentType: false },
  },
  buttons: {
    order: CHART_BUTTONS.map((b) => b.id),
    enabled: ['copy', 'pin', 'watchlist', 'exceptions', 'tradingview', 'tiger'],
    templates: { tiger: '', metascalp: '', vataga: '', colibri: '' },
  },
};

/** Numeric ranges, shared by sanitize and the Chart tab's inputs. */
export const CHART_LIMITS = {
  gapTop: [0, 40], gapBottom: [0, 50], candleWidth: [1, 30], rightSpace: [0, 50],
  size: [5, 60], opacity: [0, 40], offsetX: [-50, 50], offsetY: [-50, 50],
} as const satisfies Record<string, readonly [number, number]>;

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Obj) : {});
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const num = (v: unknown, d: number, [lo, hi]: readonly [number, number]) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const str = (v: unknown, d: string, max = 500) => (typeof v === 'string' ? v.slice(0, max) : d);
/** Valid, de-duplicated members of `v` in `order`'s order; `fallback` when none survive. */
function subset<T>(v: unknown, order: readonly T[], fallback: readonly T[]): T[] {
  const set = new Set(Array.isArray(v) ? v : []);
  const out = order.filter((x) => set.has(x));
  return out.length ? out : [...fallback];
}
/** Enabled sort modes plus any mode added since the settings were saved (it starts enabled). */
function withNewModes(modes: SortMode[], seenRaw: unknown): SortMode[] {
  const seen = new Set<unknown>(Array.isArray(seenRaw) ? seenRaw : LEGACY_SORT_MODES);
  const added = SORT_MODES.map((m) => m.id).filter((id) => !seen.has(id) && !modes.includes(id));
  return added.length ? SORT_MODES.map((m) => m.id).filter((id) => modes.includes(id) || added.includes(id)) : modes;
}
/** Valid members of `v` in the stored order (de-duplicated). */
function ordered<T>(v: unknown, valid: (x: unknown) => x is T): T[] {
  return Array.isArray(v) ? [...new Set(v.filter(valid))] : [];
}

const GRID_COUNTS = GRID_LAYOUTS.map((g) => g.count) as GridCount[];

export function sanitizeSettings(raw: unknown): Settings {
  const r = obj(raw);
  const d = DEFAULT_SETTINGS;
  const ex = obj(r.exchanges), so = obj(r.sorting), tf = obj(r.timeframe), tp = obj(r.tops);
  const ind = obj(r.indicators), ch = obj(r.chart), wm = obj(ch.watermark), bt = obj(r.buttons), tpl = obj(bt.templates);
  const L = CHART_LIMITS;
  // Buttons: the stored order first, then any button added since (so new buttons appear at the end).
  const order = ordered(bt.order, isButton);
  for (const b of d.buttons.order) if (!order.includes(b)) order.push(b);
  const items = ordered(ind.items, isIndicator);
  return {
    exchanges: {
      defaultVenue: typeof ex.defaultVenue === 'string' && isExchangeId(ex.defaultVenue) ? ex.defaultVenue : 'last',
      venues: subset(ex.venues, EXCHANGE_IDS, d.exchanges.venues),
      markets: subset<MarketType>(ex.markets, ['futures', 'spot'], d.exchanges.markets),
    },
    sorting: {
      defaultMode: isSortMode(so.defaultMode) ? so.defaultMode : 'last',
      modes: withNewModes(subset(so.modes, SORT_MODES.map((m) => m.id), d.sorting.modes), so.seen),
      seen: SORT_MODES.map((m) => m.id),
    },
    timeframe: {
      defaultTf: (CARD_TIMEFRAMES as readonly unknown[]).includes(tf.defaultTf) ? (tf.defaultTf as Timeframe) : 'last',
      enabled: subset(tf.enabled, CARD_TIMEFRAMES, d.timeframe.enabled),
    },
    tops: {
      defaultGrid: GRID_COUNTS.includes(tp.defaultGrid as GridCount) ? (tp.defaultGrid as GridCount) : 'last',
      enabled: subset(tp.enabled, GRID_COUNTS, d.tops.enabled),
    },
    indicators: {
      showSettingsBadge: bool(ind.showSettingsBadge, d.indicators.showSettingsBadge),
      items: Array.isArray(ind.items) ? items : d.indicators.items,
      size: (INDICATOR_SIZES as readonly unknown[]).includes(ind.size) ? (ind.size as IndicatorSize) : d.indicators.size,
    },
    chart: {
      gapTop: num(ch.gapTop, d.chart.gapTop, L.gapTop),
      gapBottom: num(ch.gapBottom, d.chart.gapBottom, L.gapBottom),
      candleWidth: num(ch.candleWidth, d.chart.candleWidth, L.candleWidth),
      rightSpace: num(ch.rightSpace, d.chart.rightSpace, L.rightSpace),
      grid: bool(ch.grid, d.chart.grid),
      watermark: {
        show: bool(wm.show, d.chart.watermark.show),
        size: num(wm.size, d.chart.watermark.size, L.size),
        opacity: num(wm.opacity, d.chart.watermark.opacity, L.opacity),
        offsetX: num(wm.offsetX, d.chart.watermark.offsetX, L.offsetX),
        offsetY: num(wm.offsetY, d.chart.watermark.offsetY, L.offsetY),
        instrumentType: bool(wm.instrumentType, d.chart.watermark.instrumentType),
      },
    },
    buttons: {
      order,
      enabled: Array.isArray(bt.enabled) ? ordered(bt.enabled, isButton) : d.buttons.enabled,
      templates: {
        tiger: str(tpl.tiger, ''), metascalp: str(tpl.metascalp, ''), vataga: str(tpl.vataga, ''), colibri: str(tpl.colibri, ''),
      },
    },
  };
}

export const settingsStore = createValueStore<Settings>('screenerix.settings.v1', DEFAULT_SETTINGS, sanitizeSettings);

export function updateSection<K extends keyof Settings>(section: K, patch: Partial<Settings[K]>): void {
  const s = settingsStore.getSnapshot();
  settingsStore.set(sanitizeSettings({ ...s, [section]: { ...s[section], ...patch } }));
}
export function resetSection(section: keyof Settings): void {
  settingsStore.set({ ...settingsStore.getSnapshot(), [section]: DEFAULT_SETTINGS[section] });
}

/* ── Resolution helpers (settings × session state) ── */

/** Enabled venues of a market; every venue of it when the user unchecked them all. */
export function venuesFor(s: Settings, market: MarketType): ExchangeId[] {
  const all = EXCHANGE_IDS.filter((id) => marketOf(id) === market);
  const on = all.filter((id) => s.exchanges.venues.includes(id));
  return on.length ? on : all;
}
/** First enabled entry, or the value itself when it's enabled. */
export const pick = <T>(value: T, enabled: readonly T[]): T => (enabled.includes(value) ? value : enabled[0] ?? value);
/** A sort the enabled modes allow (keeps the window when the mode offers it). */
export function allowedSort(sort: SortPref, modes: readonly SortMode[]): SortPref {
  const mode = pick(sort.mode, modes);
  const def = SORT_MODE[mode];
  return { mode, window: def.windows.some((w) => w.id === sort.window) ? sort.window : def.windows[0].id };
}

/* ── Watchlist & exceptions (base symbols, any venue) ── */

const isSymbol = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9._-]{1,32}$/.test(v);
export const watchlistStore = createListStore<string>('screenerix.watchlist.v1', isSymbol);
export const exceptionStore = createListStore<string>('screenerix.exceptions.v1', isSymbol);

export function toggleIn(store: typeof watchlistStore, symbol: string, on: boolean): void {
  const rest = store.getSnapshot().filter((s) => s !== symbol);
  store.set(on ? [...rest, symbol] : rest);
}

/* ── Startup defaults ── */

/** What the "Default …" settings change in the session state when the terminal opens (null = nothing). */
export function startupPatch(s: Settings, p: TerminalPrefs): Partial<TerminalPrefs> | null {
  const patch: Partial<TerminalPrefs> = {};
  const { defaultVenue } = s.exchanges;
  if (defaultVenue !== 'last') {
    const market = marketOf(defaultVenue);
    patch.market = market;
    patch.venue = { ...p.venue, [market]: defaultVenue };
    // A default chosen in Settings is the user's pick: kept even if that exchange is unavailable.
    patch.venueChosen = { ...p.venueChosen, [market]: true };
  }
  const { defaultMode } = s.sorting;
  if (defaultMode !== 'last') patch.sort = allowedSort({ mode: defaultMode, window: p.sort.window }, [defaultMode]);
  if (s.timeframe.defaultTf !== 'last') patch.tf = s.timeframe.defaultTf;
  if (s.tops.defaultGrid !== 'last') patch.grid = s.tops.defaultGrid;
  return Object.keys(patch).length ? patch : null;
}
