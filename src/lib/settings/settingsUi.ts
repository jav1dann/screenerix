/**
 * Open / closed state of the Settings modal, callable from anywhere (chart cards,
 * header dropdowns, the profile menu) without threading props through the tree.
 * The last tab viewed is remembered per browser.
 */
import { createValueStore } from '@/lib/alerts/localStore';
import { isSettingsTab } from './settings';
import type { SettingsTab } from './settings';

export interface SettingsUi { open: boolean; tab: SettingsTab }

const lastTab = createValueStore<SettingsTab>('screenerix.settingsTab.v1', 'exchanges', (v) => (isSettingsTab(v) ? v : 'exchanges'));

let state: SettingsUi = { open: false, tab: 'exchanges' };
const CLOSED: SettingsUi = { open: false, tab: 'exchanges' };
const listeners = new Set<() => void>();
const emit = (next: SettingsUi) => { state = next; listeners.forEach((l) => l()); };

export const settingsUi = {
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
  getSnapshot: () => state,
  getServerSnapshot: () => CLOSED,
};

/** Open the Settings modal on `tab` (default: the last tab viewed). */
export function openSettings(tab?: SettingsTab): void {
  emit({ open: true, tab: tab ?? lastTab.getSnapshot() });
}
export function selectSettingsTab(tab: SettingsTab): void {
  lastTab.set(tab);
  emit({ ...state, tab });
}
export function closeSettings(): void {
  lastTab.set(state.tab);
  emit({ ...state, open: false });
}
