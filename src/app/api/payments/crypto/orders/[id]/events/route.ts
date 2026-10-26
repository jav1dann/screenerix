import type { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth/dal';
import { CHECK_EVERY_MS, refreshOrder } from '@/lib/billing/apply';
import { FINAL_STATUSES, findOrder, toOrderView, waitForOrderChange } from '@/lib/billing/orders';
import { paymentProvider } from '@/lib/billing/provider';

const HEARTBEAT_MS = 15_000;
/** EventSource reconnects after this; a long-open modal keeps its stream. */
const MAX_OPEN_MS = 30 * 60_000;

/**
 * GET /api/payments/crypto/orders/SX-…/events  →  Server-Sent Events, owner only:
 *   event: status   data: { order }
 * sent at once and on every change (webhook, provider check); closed once the order is paid
 * or failed. While open, the provider is asked for news every 15 s as a webhook fallback.
 */
export async function GET(req: NextRequest, ctx: RouteContext<'/api/payments/crypto/orders/[id]/events'>) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: { 'cache-control': 'no-store' } });
  const { id } = await ctx.params;
  const first = findOrder(id);
  if (!first || first.userId !== user.id) return Response.json({ error: 'Not found' }, { status: 404, headers: { 'cache-control': 'no-store' } });

  const signal = req.signal;
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const write = (chunk: string) => {
        if (!open) return;
        try { controller.enqueue(enc.encode(chunk)); } catch { open = false; }
      };
      write('retry: 3000\n\n');
      const started = Date.now();
      let sent = '';
      while (open && !signal.aborted && Date.now() - started < MAX_OPEN_MS) {
        const order = await refreshOrder(findOrder(id) ?? first, paymentProvider());
        const view = JSON.stringify({ order: toOrderView(order) });
        if (view !== sent) { write(`event: status\ndata: ${view}\n\n`); sent = view; } else write(': ping\n\n');
        if (FINAL_STATUSES.has(order.status)) break;
        await waitForOrderChange(id, Math.min(HEARTBEAT_MS, CHECK_EVERY_MS), signal);
      }
      open = false;
      try { controller.close(); } catch { /* closed by the client */ }
    },
  });
  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' },
  });
}
