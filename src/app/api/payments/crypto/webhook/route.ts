import type { NextRequest } from 'next/server';
import { settleOrder } from '@/lib/billing/apply';
import { findOrder } from '@/lib/billing/orders';
import { paymentProvider } from '@/lib/billing/provider';

/**
 * POST /api/payments/crypto/webhook — the provider's payment notifications (IPN).
 * 1. The signature over the raw body must check out (401 otherwise).
 * 2. The payment is then re-fetched from the provider: its answer, not the payload, decides.
 * 3. `settleOrder` maps the status and grants Pro once for a full payment.
 * Verified calls get 200 even for unknown orders, so the provider stops retrying; a provider
 * outage answers 503 so it retries later. No session: the proxy doesn't match this path.
 */
export async function POST(req: NextRequest) {
  const provider = paymentProvider();
  if (!provider) return Response.json({ error: 'Payments are not configured' }, { status: 503 });
  const raw = await req.text();
  const ids = provider.verifyWebhook(raw, req.headers);
  if (!ids) {
    console.error('[billing] webhook rejected: bad or missing signature');
    return Response.json({ error: 'Invalid signature' }, { status: 401 });
  }
  const order = findOrder(ids.orderId);
  if (!order || order.providerId !== ids.providerId || order.provider !== provider.name) {
    console.error(`[billing] webhook for unknown order ${ids.orderId} / payment ${ids.providerId}`);
    return Response.json({ ok: true });
  }
  try {
    const payment = await provider.get(ids.providerId);
    const next = settleOrder(order, payment);
    return Response.json({ ok: true, status: next.status });
  } catch (e) {
    console.error(`[billing] webhook for ${order.id}: provider check failed: ${(e as Error).message}`);
    return Response.json({ error: 'Provider unavailable' }, { status: 503 });
  }
}
