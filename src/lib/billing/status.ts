/** Order states (client-safe; the order store lives in `orders.ts`). */

/**
 * waiting: no funds yet · confirming: seen on chain, not final · paid: Pro granted ·
 * partially_paid: less than the amount arrived · expired: the window closed unpaid ·
 * failed: refused / refunded by the provider.
 */
export type OrderStatus = 'waiting' | 'confirming' | 'paid' | 'partially_paid' | 'expired' | 'failed';

/** No further change is expected. */
export const FINAL_STATUSES: ReadonlySet<OrderStatus> = new Set(['paid', 'failed']);

export const STATUS_LABEL: Record<OrderStatus, string> = {
  waiting: 'Awaiting payment',
  confirming: 'Confirming',
  paid: 'Paid',
  partially_paid: 'Partially paid',
  expired: 'Expired',
  failed: 'Failed',
};
