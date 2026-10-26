/**
 * Strategies view state shared by the header's workspace tabs and the module:
 * the selected tab (remembered per browser), the Pool / Settings modals and the
 * chart to highlight in a workspace.
 */
import { createValueStore } from '@/lib/alerts/localStore';

export type StrategyTab = 'dashboard' | string;
export type WorkspaceSettingsTab = 'general' | 'strategy' | 'filter' | 'fields' | 'levels';
export const WORKSPACE_SETTINGS_TABS: ReadonlyArray<{ id: WorkspaceSettingsTab; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'strategy', label: 'Strategy' },
  { id: 'filter', label: 'Filter & Sorting' },
  { id: 'fields', label: 'Table Fields' },
  { id: 'levels', label: 'Levels' },
];

export interface StrategyUi {
  tab: StrategyTab;
  pool: boolean;
  /** Workspace whose settings are open. */
  settings: { uid: string; tab: WorkspaceSettingsTab } | null;
  /** Formation id to highlight in its workspace grid. */
  focus: string | null;
}

const lastTab = createValueStore<string>('screenerix.strategyTab.v1', 'dashboard', (v) => (typeof v === 'string' && v ? v : 'dashboard'));
const INITIAL: StrategyUi = { tab: 'dashboard', pool: false, settings: null, focus: null };
let state: StrategyUi | null = null;
const listeners = new Set<() => void>();
const get = (): StrategyUi => (state ??= { ...INITIAL, tab: typeof window === 'undefined' ? 'dashboard' : lastTab.getSnapshot() });
const emit = (patch: Partial<StrategyUi>) => { state = { ...get(), ...patch }; listeners.forEach((l) => l()); };

export const strategyUi = {
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
  getSnapshot: get,
  getServerSnapshot: () => INITIAL,
};

export function selectStrategyTab(tab: StrategyTab, focus: string | null = null): void {
  lastTab.set(tab);
  emit({ tab, focus });
}
export const openPool = () => emit({ pool: true });
export const closePool = () => emit({ pool: false });
export const openWorkspaceSettings = (uid: string, tab: WorkspaceSettingsTab = 'general') => emit({ settings: { uid, tab } });
export const selectWorkspaceSettingsTab = (tab: WorkspaceSettingsTab) => { const s = get().settings; if (s) emit({ settings: { ...s, tab } }); };
export const closeWorkspaceSettings = () => emit({ settings: null });
