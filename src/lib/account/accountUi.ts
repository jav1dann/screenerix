/**
 * Open / closed state of the Account settings modal, callable from anywhere in the terminal
 * (profile menu, the alert wizard's "Connect Telegram") — like `settingsUi`.
 */
export type AccountSection = 'email' | 'linked' | 'billing';

export interface AccountUi { open: boolean; section: AccountSection; notice?: { tone: 'ok' | 'error'; text: string } }

const CLOSED: AccountUi = { open: false, section: 'email' };
let state: AccountUi = CLOSED;
const listeners = new Set<() => void>();
const emit = (next: AccountUi) => { state = next; listeners.forEach((l) => l()); };

export const accountUi = {
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
  getSnapshot: () => state,
  getServerSnapshot: () => CLOSED,
};

export function openAccount(section: AccountSection = 'email', notice?: AccountUi['notice']): void {
  emit({ open: true, section, ...(notice ? { notice } : {}) });
}
export function selectAccountSection(section: AccountSection): void {
  emit({ ...state, section, notice: undefined });
}
export function closeAccount(): void {
  emit(CLOSED);
}
