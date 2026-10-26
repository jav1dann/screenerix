/**
 * Open / closed state of the alerts dashboard and the create / edit wizard, callable from
 * anywhere in the terminal (header button, chart price lines) — like `settingsUi`.
 */
import type { ExchangeId } from '@/lib/market/exchanges';
import type { AlertView } from './client';
import type { AlertKind } from './types';

export type WizardInit =
  | { mode: 'create'; kind?: AlertKind; exchange?: ExchangeId; symbol?: string; price?: number }
  | { mode: 'edit'; alert: AlertView };

export interface AlertsUi { dashboard: boolean; wizard: WizardInit | null }

const CLOSED: AlertsUi = { dashboard: false, wizard: null };
let state: AlertsUi = CLOSED;
const listeners = new Set<() => void>();
const emit = (next: AlertsUi) => { state = next; listeners.forEach((l) => l()); };

export const alertsUi = {
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
  getSnapshot: () => state,
  getServerSnapshot: () => CLOSED,
};

export const openAlerts = (): void => emit({ ...state, dashboard: true });
export const closeAlerts = (): void => emit({ ...state, dashboard: false });
export const openAlertWizard = (init: WizardInit): void => emit({ ...state, wizard: init });
export const closeAlertWizard = (): void => emit({ ...state, wizard: null });
