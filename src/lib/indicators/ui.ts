/** Open / closed state of the Indicator modal, callable from any chart window. */
import type { MarketType } from '@/lib/alerts/alertStore';
import type { ExchangeId } from '@/lib/market/exchanges';
import type { IndicatorScope } from './store';

export interface IndicatorWindow {
  /** Null for spread (ratio) charts. */
  exchange: ExchangeId | null;
  market: MarketType;
  symbol: string | null;
}
export interface IndicatorUi { open: boolean; scope: IndicatorScope; window: IndicatorWindow | null; focus: string | null }

const CLOSED: IndicatorUi = { open: false, scope: 'card', window: null, focus: null };
let state = CLOSED;
const listeners = new Set<() => void>();
const emit = (next: IndicatorUi) => { state = next; listeners.forEach((l) => l()); };

export const indicatorUi = {
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
  getSnapshot: () => state,
  getServerSnapshot: () => CLOSED,
};

/** Open the modal for a window's scope; `focus` expands one active indicator's settings. */
export function openIndicators(scope: IndicatorScope, window: IndicatorWindow | null, focus: string | null = null): void {
  emit({ open: true, scope, window, focus });
}
export function closeIndicators(): void {
  emit({ ...state, open: false });
}
