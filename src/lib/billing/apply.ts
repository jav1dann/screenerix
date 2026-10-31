/**
 * Order settlement: the provider's view of a payment → our order status, and Pro for the
 * account once it is fully paid. The only place Pro is granted. Synchronous from read to
 * write, so a webhook and a status poll landing together can't both apply it. Server-only.
 */
import 'server-only';
import { grantPro } from '@/lib/auth/users';
import { FINAL_STATUSES, findOrder, patchOrder } from './orders';
import type { Order, OrderStatus } from './orders';
import { PERIODS } from './plans';
import type { PaymentProvider, ProviderPayment } from './provider';

/** Rounding slack on "paid in full" (provider amounts are decimals). */
const EPSILON = 1e-6;

function statusOf(order: Order, p: ProviderPayment, now: number): OrderStatus {
  switch (p.status) {
    case 'finished': return p.actuallyPaid + EPSILON >= order.payAmount ? 'paid' : 'partially_paid';
    case 'confirming': case 'confirmed': case 'sending': return 'confirming';
    case 'partially_paid': return 'partially_paid';
    case 'failed': case 'refunded': return 'failed';
    case 'expired': return 'expired';
    default: return now > order.expiresAt ? 'expired' : 'waiting';
  }
}

/**
 * Applies the provider's payment state to `order` and returns the updated order. Pro is granted
 * once — `appliedAt` makes replays no-ops — and only for a finished payment of the full amount
 * in the order's currency to the order's payment. A paid order never moves back.
 */
export function settleOrder(order: Order, p: ProviderPayment, now = Date.now()): Order {
  if (p.providerId !== order.providerId || (p.orderId && p.orderId !== order.id)) {
    console.error(`[billing] payment ${p.providerId} does not belong to order ${order.id}`);
    return order;
  }
  if (order.status === 'paid') return order;
  let status = statusOf(order, p, now);
  if (status === 'paid' && p.payCurrency && p.payCurrency !== order.payCurrency) {
    console.error(`[billing] order ${order.id} paid in ${p.payCurrency}, expected ${order.payCurrency}`);
    status = 'partially_paid';
  }
  const patch: Partial<Order> = { status, actuallyPaid: p.actuallyPaid, checkedAt: now };
  if (status === 'paid' && !order.appliedAt) {
    const user = grantPro(order.userId, PERIODS[order.period].days, now);
    if (!user) {
      console.error(`[billing] order ${order.id} paid but account ${order.userId} no longer exists`);
    } else {
      Object.assign(patch, { paidAt: now, appliedAt: now, proExpiresAt: user.proExpiresAt });
      console.log(`[billing] order ${order.id} paid → ${user.email} Pro until ${new Date(user.proExpiresAt!).toISOString()}`);
    }
  }
  return patchOrder(order.id, patch) ?? order;
}

/** Provider status checks per open order are at least this far apart. */
export const CHECK_EVERY_MS = 15_000;
const inFlight = new Map<string, Promise<Order>>();

/**
 * The order, refreshed from the provider when it is still open and wasn't checked recently —
 * so payments complete even where the webhook can't reach us (local development).
 */
export function refreshOrder(order: Order, provider: PaymentProvider | null, now = Date.now()): Promise<Order> {
  if (!provider || provider.name !== order.provider || FINAL_STATUSES.has(order.status) || now - (order.checkedAt ?? order.createdAt) < CHECK_EVERY_MS) {
    return Promise.resolve(order);
  }
  let p = inFlight.get(order.id);
  if (!p) {
    p = provider.get(order.providerId)
      .then((pay) => settleOrder(findOrder(order.id) ?? order, pay))
      .catch((e: unknown) => {
        console.error(`[billing] status check for ${order.id} failed: ${(e as Error).message}`);
        return patchOrder(order.id, { checkedAt: Date.now() }) ?? order;
      })
      .finally(() => inFlight.delete(order.id));
    inFlight.set(order.id, p);
  }
  return p;
}
