import type { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth/dal';
import { refreshOrder } from '@/lib/billing/apply';
import { findOrder, toOrderView } from '@/lib/billing/orders';
import { paymentProvider } from '@/lib/billing/provider';

const NO_STORE = { 'cache-control': 'no-store' };

/**
 * GET /api/payments/crypto/orders/SX-…  →  the order (owner only; anyone else: 404). An open
 * order is re-checked with the provider at most every 15 s, so it completes without a webhook.
 * Not behind the proxy's subscription gate: expired accounts pay here.
 */
export async function GET(_req: NextRequest, ctx: RouteContext<'/api/payments/crypto/orders/[id]'>) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
  const { id } = await ctx.params;
  const order = findOrder(id);
  if (!order || order.userId !== user.id) return Response.json({ error: 'Not found' }, { status: 404, headers: NO_STORE });
  const fresh = await refreshOrder(order, paymentProvider());
  return Response.json({ order: toOrderView(fresh) }, { headers: NO_STORE });
}
