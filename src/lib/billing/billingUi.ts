/**
 * Open / closed state of the crypto payment modal, callable from anywhere in the terminal
 * (the profile menu) without threading props — like `settingsUi`.
 */
import type { Period } from './plans';

export interface BillingUi { open: boolean; period?: Period }

const CLOSED: BillingUi = { open: false };
let state: BillingUi = CLOSED;
const listeners = new Set<() => void>();
const emit = (next: BillingUi) => { state = next; listeners.forEach((l) => l()); };

export const billingUi = {
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
  getSnapshot: () => state,
  getServerSnapshot: () => CLOSED,
};

export function openBilling(period?: Period): void {
  emit({ open: true, period });
}
export function closeBilling(): void {
  emit(CLOSED);
}
