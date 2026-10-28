/**
 * Alerts: stored and checked on the server, shown and edited in the terminal. Client-safe
 * (types, labels, validation, descriptions — no storage here).
 */
import { ADAPTERS, EXCHANGE_IDS } from '@/lib/market/exchanges';
import type { ExchangeId, Timeframe } from '@/lib/market/exchanges';
import { STRATEGIES, STRATEGY_BY_ID } from '@/lib/strategies/catalog';
import { isStrategyId } from '@/lib/strategies/types';
import type { Direction, Stage, StrategyId } from '@/lib/strategies/types';

export type AlertKind = 'price' | 'complex' | 'strategy';
export type AlertMode = 'once' | 'infinite';
export type AlertSound = 'off' | 'beep' | 'voice';
export type AlertStatus = 'active' | 'archived';
export type MarketType = 'futures' | 'spot';

/** % change of the price over the window. */
export type Metric = 'change' | 'volSpike' | 'price' | 'funding' | 'oiChange';
export type MetricWindow = '1m' | '5m' | '15m' | '1h';
export type Op = '>' | '<' | 'abs>';

export interface Condition { metric: Metric; window: MetricWindow; op: Op; value: number }

export interface AlertChannels { browser: boolean; telegram: boolean; push: boolean }

/** Strategy alerts: which setups to report, and when. */
export interface StrategySpec {
  /** One strategy, or every one. */
  strategy: StrategyId | 'all';
  /** Setup timeframe, or any. */
  tf: Timeframe | 'any';
  dir: Direction | 'any';
  /** Minimum score / strength index (0–100; 0 = any). */
  minScore: number;
  /** `active`: when a setup triggers (entry); `new`: when it's first detected (forming or active). */
  on: 'active' | 'new';
}
/** Strategy alerts' "any coin" symbol. */
export const ANY_COIN = '*';
/** Timeframes the strategy scanners run on. */
export const STRATEGY_ALERT_TFS: readonly Timeframe[] = ['1m', '5m', '15m', '1h'];
/** At most this many setups notified per alert and scan pass (a market-wide move shouldn't flood). */
export const MAX_STRATEGY_FIRES_PER_PASS = 5;

export interface Alert {
  id: string;
  userId: string;
  kind: AlertKind;
  exchange: ExchangeId;
  /** Base symbol, e.g. "BTC". */
  symbol: string;
  /** Price alerts: fires when price reaches `level` moving `direction`. */
  price?: { level: number; direction: 'above' | 'below' };
  /** Complex alerts: every condition must hold (AND). */
  conditions?: Condition[];
  /** Strategy alerts (`symbol` may be ANY_COIN). */
  strategy?: StrategySpec;
  channels: AlertChannels;
  sound: AlertSound;
  mode: AlertMode;
  /** Infinite alerts: at least this many minutes between notifications. */
  repeatMinutes: number;
  note?: string;
  status: AlertStatus;
  archivedReason?: 'fired' | 'manual';
  createdAt: number;
  updatedAt: number;
  lastTriggeredAt: number | null;
  triggerCount: number;
}

/** What the browser sends to create / edit an alert. */
export type AlertInput = Pick<Alert, 'kind' | 'exchange' | 'symbol' | 'price' | 'conditions' | 'strategy' | 'channels' | 'sound' | 'mode' | 'repeatMinutes' | 'note'> & { id?: string };

/**
 * Outcome per chosen channel: Telegram `sent` / `failed` / `unlinked` (chosen but no chat linked);
 * push = devices that accepted it (0: none subscribed or all failed). The terminal shows the browser
 * notification itself, so it isn't tracked here.
 */
export interface AlertDelivery { telegram?: 'sent' | 'failed' | 'unlinked'; push?: number }

/** What triggered, structured so notifications can be worded in the user's language. */
export type AlertDetail =
  | { kind: 'price'; direction: 'above' | 'below'; level: number }
  | {
    kind: 'strategy'; formationId: string; strategy: StrategyId; tf: Timeframe; dir: Direction; stage: Stage;
    entry: number; sl: number; tp1: number; tp2: number; score: number; strength: number | null;
  }
  | { kind: 'complex'; checks: Array<{ condition: Condition; value: number | null }> };

/** One firing, kept for the "Recent triggers" list and pushed to open terminals. */
export interface AlertEvent {
  id: string;
  alertId: string;
  userId: string;
  at: number;
  kind: AlertKind;
  exchange: ExchangeId;
  symbol: string;
  price: number;
  /** "BTC rose to 80,000" / "5m change +3.2% AND 1m volume 4.1× average". */
  text: string;
  sound: AlertSound;
  channels: AlertChannels;
  /** Absent on events recorded before notifications were localized (`text` is used then). */
  detail?: AlertDetail;
  /** Where it went, filled in once delivery finished (absent while sending, and on older events). */
  delivery?: AlertDelivery;
}

export const MAX_ACTIVE_ALERTS = 100;
export const MAX_CONDITIONS = 4;
export const REPEAT_RANGE = { min: 1, max: 1440 } as const;

export const METRICS: ReadonlyArray<{ id: Metric; label: string; short: string; unit: '%' | '×' | '$'; windowed: boolean; hint: string }> = [
  { id: 'change', label: 'Price change', short: 'change', unit: '%', windowed: true, hint: 'Percent move of the price over the window' },
  { id: 'volSpike', label: 'Volume spike', short: 'volume', unit: '×', windowed: true, hint: 'Last closed candle’s volume vs. the average of the 20 before (1m / 5m candles)' },
  { id: 'price', label: 'Price', short: 'price', unit: '$', windowed: false, hint: 'The last price' },
  { id: 'funding', label: 'Funding rate', short: 'funding', unit: '%', windowed: false, hint: 'Current funding rate (perpetuals)' },
  { id: 'oiChange', label: 'Open interest change', short: 'OI', unit: '%', windowed: true, hint: 'Percent change of open interest over the window (5m data)' },
];
export const METRIC_BY_ID = new Map(METRICS.map((m) => [m.id, m]));
export const WINDOWS: readonly MetricWindow[] = ['1m', '5m', '15m', '1h'];
/** Windows each metric supports (volume spikes are per candle: 1m or 5m; OI history is 5m). */
export const WINDOWS_FOR: Record<Metric, readonly MetricWindow[]> = {
  change: WINDOWS, volSpike: ['1m', '5m'], price: ['1m'], funding: ['1m'], oiChange: ['5m', '15m', '1h'],
};
export const OPS: ReadonlyArray<{ id: Op; label: string }> = [{ id: '>', label: '≥' }, { id: '<', label: '≤' }, { id: 'abs>', label: '|x| ≥' }];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** A clean AlertInput, or the reason it's invalid. Symbol existence is checked by the server. */
export function validateAlertInput(raw: unknown): { ok: true; input: AlertInput } | { ok: false; error: string } {
  if (!isObj(raw)) return { ok: false, error: 'Invalid alert.' };
  const kind: AlertKind | null = raw.kind === 'complex' || raw.kind === 'price' || raw.kind === 'strategy' ? raw.kind : null;
  if (!kind) return { ok: false, error: 'Choose an alert type.' };
  const exchange = typeof raw.exchange === 'string' && (EXCHANGE_IDS as readonly string[]).includes(raw.exchange) ? (raw.exchange as ExchangeId) : null;
  if (!exchange) return { ok: false, error: 'Choose an exchange.' };
  const symbol = typeof raw.symbol === 'string' ? raw.symbol.trim().toUpperCase() : '';
  if (!(kind === 'strategy' && symbol === ANY_COIN) && !/^[\p{Lu}\p{Lo}\p{N}]{1,20}$/u.test(symbol)) return { ok: false, error: 'Choose a coin.' };
  const ch = isObj(raw.channels) ? raw.channels : {};
  const channels: AlertChannels = { browser: ch.browser === true, telegram: ch.telegram === true, push: ch.push === true };
  const sound: AlertSound = raw.sound === 'beep' || raw.sound === 'voice' ? raw.sound : 'off';
  const mode: AlertMode = raw.mode === 'infinite' ? 'infinite' : 'once';
  const repeat = Math.round(Number(raw.repeatMinutes));
  if (mode === 'infinite' && !(repeat >= REPEAT_RANGE.min && repeat <= REPEAT_RANGE.max)) return { ok: false, error: `Repeat interval: ${REPEAT_RANGE.min}–${REPEAT_RANGE.max} minutes.` };
  const note = typeof raw.note === 'string' ? raw.note.trim().slice(0, 140) : '';
  const base = { kind, exchange, symbol, channels, sound, mode, repeatMinutes: mode === 'infinite' ? repeat : 5, ...(note ? { note } : {}), ...(typeof raw.id === 'string' ? { id: raw.id } : {}) };

  if (kind === 'strategy') {
    const st = isObj(raw.strategy) ? raw.strategy : {};
    const strategy = st.strategy === 'all' || isStrategyId(st.strategy) ? st.strategy : null;
    if (!strategy) return { ok: false, error: 'Choose a strategy.' };
    const tf = st.tf === 'any' || (STRATEGY_ALERT_TFS as readonly unknown[]).includes(st.tf) ? (st.tf as StrategySpec['tf']) : null;
    if (!tf) return { ok: false, error: 'Choose a timeframe.' };
    const dir = st.dir === 'LONG' || st.dir === 'SHORT' ? st.dir : 'any';
    const minScore = finite(st.minScore) ? Math.round(Math.max(0, Math.min(100, st.minScore))) : 0;
    const on = st.on === 'new' ? 'new' : 'active';
    return { ok: true, input: { ...base, strategy: { strategy, tf, dir, minScore, on } } };
  }
  if (kind === 'price') {
    const p = isObj(raw.price) ? raw.price : {};
    if (!finite(p.level) || !(p.level > 0)) return { ok: false, error: 'Enter a target price above 0.' };
    if (p.direction !== 'above' && p.direction !== 'below') return { ok: false, error: 'Invalid direction.' };
    return { ok: true, input: { ...base, price: { level: p.level, direction: p.direction } } };
  }
  const list = Array.isArray(raw.conditions) ? raw.conditions : [];
  if (!list.length) return { ok: false, error: 'Add at least one condition.' };
  if (list.length > MAX_CONDITIONS) return { ok: false, error: `At most ${MAX_CONDITIONS} conditions.` };
  const conditions: Condition[] = [];
  for (const c of list) {
    if (!isObj(c)) return { ok: false, error: 'Invalid condition.' };
    const metric = METRIC_BY_ID.get(c.metric as Metric)?.id;
    if (!metric) return { ok: false, error: 'Unknown condition.' };
    const window = WINDOWS_FOR[metric].includes(c.window as MetricWindow) ? (c.window as MetricWindow) : WINDOWS_FOR[metric][0];
    const op = OPS.some((o) => o.id === c.op) ? (c.op as Op) : null;
    if (!op) return { ok: false, error: 'Invalid comparison.' };
    if (!finite(c.value)) return { ok: false, error: `Enter a value for “${METRIC_BY_ID.get(metric)!.label}”.` };
    if (metric === 'volSpike' && !(c.value > 0)) return { ok: false, error: 'Volume spike: a multiple above 0 (e.g. 3 for 3×).' };
    if (metric === 'price' && !(c.value > 0)) return { ok: false, error: 'Price: a value above 0.' };
    conditions.push({ metric, window, op, value: c.value });
  }
  return { ok: true, input: { ...base, conditions } };
}

const num = (v: number) => (Math.abs(v) >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : `${+v.toPrecision(6)}`);

/** "5m change ≥ +3%", "1m volume ≥ 3×", "funding ≤ −0.05%". */
export function describeCondition(c: Condition): string {
  const m = METRIC_BY_ID.get(c.metric)!;
  const op = c.op === '>' ? '≥' : c.op === '<' ? '≤' : '|x| ≥';
  const v = m.unit === '%' ? `${c.value > 0 && c.op !== 'abs>' ? '+' : ''}${num(c.value)}%` : m.unit === '×' ? `${num(c.value)}×` : num(c.value);
  return `${m.windowed ? `${c.window} ` : ''}${m.short} ${op} ${v}`;
}

/** How the dashboard shows an alert: watching, paused by the user, or archived after firing (one-time). */
export type AlertDisplayStatus = 'active' | 'paused' | 'triggered';
export const displayStatus = (a: Pick<Alert, 'status' | 'archivedReason'>): AlertDisplayStatus =>
  a.status === 'active' ? 'active' : a.archivedReason === 'fired' ? 'triggered' : 'paused';

/** "Long Continuation after Liquidity Sweep · 5m · long · strength ≥ 70 · when active". */
export function describeStrategySpec(sp: StrategySpec): string {
  const name = sp.strategy === 'all' ? 'Any strategy' : STRATEGY_BY_ID.get(sp.strategy)?.name ?? sp.strategy;
  return [
    name,
    sp.tf === 'any' ? null : sp.tf,
    sp.dir === 'any' ? null : sp.dir.toLowerCase(),
    sp.minScore > 0 ? `strength ≥ ${sp.minScore}` : null,
    sp.on === 'active' ? 'when active' : 'when detected',
  ].filter(Boolean).join(' · ');
}

/** Strategies a strategy alert can name ("all" first). */
export const STRATEGY_ALERT_OPTIONS: ReadonlyArray<{ id: StrategyId | 'all'; label: string }> = [{ id: 'all', label: 'Any strategy' }, ...STRATEGIES.map((x) => ({ id: x.id, label: x.name }))];

/** One line for lists and notifications. */
export function describeAlert(a: Pick<Alert, 'kind' | 'price' | 'conditions' | 'strategy'>): string {
  if (a.kind === 'strategy' && a.strategy) return describeStrategySpec(a.strategy);
  if (a.kind === 'price' && a.price) return `Price ${a.price.direction === 'above' ? 'rises to' : 'falls to'} ${num(a.price.level)}`;
  return (a.conditions ?? []).map(describeCondition).join(' AND ');
}

export const marketOfExchange = (ex: ExchangeId): MarketType => (ADAPTERS[ex].market === 'perp' ? 'futures' : 'spot');
