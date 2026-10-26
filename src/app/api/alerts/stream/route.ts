import type { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth/dal';
import { onUserAlerts } from '@/lib/alerts/server/store';
import type { AlertChange } from '@/lib/alerts/server/store';

const HEARTBEAT_MS = 20_000;
/** EventSource reconnects after this, so a long-open terminal re-checks its session. */
const MAX_OPEN_MS = 30 * 60_000;

/**
 * GET /api/alerts/stream → Server-Sent Events for the signed-in account:
 *   event: alert     data: { alert }        (created / edited / archived / restored / fired)
 *   event: removed   data: { id }
 *   event: fired     data: { event }        (a firing: toast, sound, browser notification)
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: { 'cache-control': 'no-store' } });
  const enc = new TextEncoder();
  const signal = req.signal;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      const write = (chunk: string) => {
        if (!open) return;
        try { controller.enqueue(enc.encode(chunk)); } catch { close(); }
      };
      const strip = <T extends { userId: string }>(o: T) => { const { userId: _u, ...rest } = o; void _u; return rest; };
      const off = onUserAlerts(user.id, (c: AlertChange) => {
        if (c.type === 'alert') write(`event: alert\ndata: ${JSON.stringify({ alert: strip(c.alert) })}\n\n`);
        else if (c.type === 'removed') write(`event: removed\ndata: ${JSON.stringify({ id: c.id })}\n\n`);
        else write(`event: fired\ndata: ${JSON.stringify({ event: strip(c.event) })}\n\n`);
      });
      const beat = setInterval(() => write(': ping\n\n'), HEARTBEAT_MS);
      const limit = setTimeout(() => close(), MAX_OPEN_MS);
      function close() {
        if (!open) return;
        open = false;
        off();
        clearInterval(beat);
        clearTimeout(limit);
        try { controller.close(); } catch { /* closed by the client */ }
      }
      signal.addEventListener('abort', close);
      write('retry: 3000\n\n');
    },
  });
  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' },
  });
}
