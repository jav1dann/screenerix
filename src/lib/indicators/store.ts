/**
 * Active indicators per chart-window type, persisted per browser:
 *  - card   every Market Map card (and the Settings preview)
 *  - chart  the expanded chart, Market Review and the ratio chart
 */
import { createValueStore } from '@/lib/alerts/localStore';
import { defaultParams, INDICATOR_BY_ID } from './registry';

export type IndicatorScope = 'card' | 'chart';
export const SCOPES: readonly IndicatorScope[] = ['card', 'chart'];

export interface ActiveIndicator {
  uid: string;
  id: string;
  params: number[];
  visible: boolean;
}
export type IndicatorState = Record<IndicatorScope, ActiveIndicator[]>;

const KEY = 'screenerix.indicators.v1';
/** Before this store, the expanded chart kept its indicators in chartPrefs. */
const LEGACY_PREFS = 'screenerix.chartPrefs.v1';

let seq = 0;
export const newUid = (): string => `i${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function instance(id: string, params?: readonly number[]): ActiveIndicator {
  const def = INDICATOR_BY_ID.get(id);
  return { uid: newUid(), id, params: def ? cleanParams(id, params) : [], visible: true };
}

export const DEFAULT_STATE: IndicatorState = {
  card: [{ uid: 'card-volbg', id: 'volbg', params: [], visible: true }],
  chart: [
    { uid: 'chart-vol', id: 'vol', params: [5, 10], visible: true },
    { uid: 'chart-oi', id: 'oi.self', params: [], visible: true },
    { uid: 'chart-dens', id: 'densities', params: [300, 3], visible: true },
  ],
};

/** Stored params, clamped to the definition (defaults for missing ones). */
export function cleanParams(id: string, raw: unknown): number[] {
  const def = INDICATOR_BY_ID.get(id);
  if (!def) return [];
  const arr = Array.isArray(raw) ? raw : [];
  return def.params.map((p, i) => {
    const v = arr[i];
    return typeof v === 'number' && Number.isFinite(v) ? Math.min(p.max, Math.max(p.min, v)) : p.def;
  });
}

function cleanList(raw: unknown): ActiveIndicator[] | null {
  if (!Array.isArray(raw)) return null;
  const seen = new Set<string>();
  const out: ActiveIndicator[] = [];
  for (const x of raw) {
    if (typeof x !== 'object' || x === null) continue;
    const r = x as Record<string, unknown>;
    const def = typeof r.id === 'string' ? INDICATOR_BY_ID.get(r.id) : undefined;
    // One instance per indicator; unknown or not-yet-available ones are dropped.
    if (!def || def.soon || seen.has(def.id)) continue;
    seen.add(def.id);
    out.push({
      uid: typeof r.uid === 'string' && r.uid ? r.uid.slice(0, 40) : newUid(),
      id: def.id,
      params: cleanParams(def.id, r.params),
      visible: typeof r.visible === 'boolean' ? r.visible : true,
    });
  }
  return out;
}

/** Old chartPrefs flags → indicator instances (expanded chart). */
export function fromLegacyPrefs(raw: unknown): ActiveIndicator[] | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!('mas' in r) && !('rsi' in r) && !('volumePane' in r)) return null;
  const out: ActiveIndicator[] = [];
  const mas = Array.isArray(r.mas) ? (r.mas as Array<Record<string, unknown>>).filter((m) => m && m.enabled === true) : [];
  const periods = (type: string) => mas.filter((m) => m.type === type).map((m) => Number(m.period)).filter((n) => Number.isInteger(n) && n > 0);
  const smaP = periods('sma'), emaP = periods('ema');
  // The old chart had up to 3 lines; fill the remaining periods with defaults it didn't already use.
  const fill = (id: string, ps: number[]) => [...ps, ...defaultParams(INDICATOR_BY_ID.get(id)!).filter((d) => !ps.includes(d))];
  if (smaP.length) out.push(instance('sma', fill('sma', smaP)));
  if (emaP.length) out.push(instance('ema', fill('ema', emaP)));
  if (r.vwap === true) out.push(instance('vwap'));
  if (r.densityLines !== false) out.push(instance('densities'));
  if (r.volumePane !== false) out.push(instance('vol'));
  if (r.oiPane !== false) out.push(instance('oi.self'));
  if (r.rsi === true) out.push(instance('rsi', [14, 12, 24]));
  if (r.macd === true) out.push(instance('macd'));
  return out;
}

function readLegacy(): unknown {
  try { const s = window.localStorage.getItem(LEGACY_PREFS); return s ? JSON.parse(s) : null; } catch { return null; }
}

export function sanitizeIndicators(raw: unknown): IndicatorState {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    card: cleanList(r.card) ?? DEFAULT_STATE.card,
    chart: cleanList(r.chart) ?? DEFAULT_STATE.chart,
  };
}

export const indicatorStore = createValueStore<IndicatorState>(KEY, DEFAULT_STATE, (raw) => sanitizeIndicators(raw));

/** First visit after the upgrade: carry the expanded chart's old indicator flags over. */
let migrated = false;
function migrate(): void {
  if (migrated || typeof window === 'undefined') return;
  migrated = true;
  try { if (window.localStorage.getItem(KEY)) return; } catch { return; }
  const legacy = fromLegacyPrefs(readLegacy());
  if (legacy) indicatorStore.set({ ...indicatorStore.getSnapshot(), chart: legacy });
}

// Runs once when the module loads in the browser, before any chart reads the store.
migrate();

export const getIndicators = (scope: IndicatorScope): ActiveIndicator[] => { migrate(); return indicatorStore.getSnapshot()[scope]; };

function setScope(scope: IndicatorScope, list: ActiveIndicator[]): void {
  migrate();
  indicatorStore.set({ ...indicatorStore.getSnapshot(), [scope]: list });
}

export function addIndicator(scope: IndicatorScope, id: string): void {
  const list = getIndicators(scope);
  const def = INDICATOR_BY_ID.get(id);
  if (!def || def.soon || list.some((x) => x.id === id)) return;
  setScope(scope, [...list, instance(id)]);
}
export function removeIndicator(scope: IndicatorScope, uid: string): void {
  setScope(scope, getIndicators(scope).filter((x) => x.uid !== uid));
}
export function toggleIndicator(scope: IndicatorScope, id: string, on: boolean): void {
  const hit = getIndicators(scope).find((x) => x.id === id);
  if (on && !hit) addIndicator(scope, id);
  else if (!on && hit) removeIndicator(scope, hit.uid);
}
export function setVisible(scope: IndicatorScope, uid: string, visible: boolean): void {
  setScope(scope, getIndicators(scope).map((x) => (x.uid === uid ? { ...x, visible } : x)));
}
export function setParams(scope: IndicatorScope, uid: string, params: readonly number[]): void {
  setScope(scope, getIndicators(scope).map((x) => (x.uid === uid ? { ...x, params: cleanParams(x.id, params) } : x)));
}
export function moveIndicator(scope: IndicatorScope, uid: string, by: -1 | 1): void {
  const list = [...getIndicators(scope)];
  const i = list.findIndex((x) => x.uid === uid);
  const j = i + by;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  setScope(scope, list);
}
