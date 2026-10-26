import type { NextRequest } from 'next/server';
import { startEngine } from '@/lib/server/scan/engine';
import { metricsKey, scanStore } from '@/lib/server/scan/store';
import { densitiesPayload, densityKeys, metricsPayload, parseKeys, parsePairs, parseStep, parseTrim, parseVenue, parseVenues, strategiesPayload, strategyKeys } from '@/lib/server/scan/views';

/** At most one patch per second per stream; a comment heartbeat while idle. */
const PATCH_MS = 1_000;
const HEARTBEAT_MS = 15_000;
/** Bytes queued for a client before patches are held back (it gets a full resync once it drains). */
const QUEUE_BYTES = 1 << 20;
/** A client that stays backed up this long is dropped; EventSource reconnects. */
const STALL_MS = 30_000;

/**
 * GET /api/scan/stream?venue=binance&keys=range_5m,turnover  and / or  &pairs=binance:futures&step=0[&min=&dist=]  and / or  &strat=binance,bybit
 * Server-Sent Events from the scan cache:
 *   event: metrics     data: { full, version, coverage, rows, removed }
 *   event: densities   data: { full, version, coverage, cards, removed }
 *   event: strategies  data: { full, version, coverage, formations, removed }
 * The first event of each kind is the full state (`full: true`); later ones carry
 * only the rows / cards that changed since the last event on this connection.
 * A client that doesn't keep up is not buffered without bound: patches pause while
 * its queue is full, a full state follows when it drains, and it is closed after STALL_MS.
 */
export function GET(req: NextRequest) {
  void startEngine();
  const q = req.nextUrl.searchParams;
  const venue = q.has('venue') ? parseVenue(q.get('venue')) : null;
  const keys = venue ? parseKeys(q.get('keys')) : null;
  const pairs = q.has('pairs') ? parsePairs(q.get('pairs')) : null;
  const step = parseStep(q.get('step'));
  const trim = parseTrim(q.get('min'), q.get('dist'));
  const strat = q.has('strat') ? parseVenues(q.get('strat')) : null;
  if (q.has('strat') && !strat) return Response.json({ error: 'strat invalid' }, { status: 400 });
  if (q.has('venue') && (!venue || !keys)) return Response.json({ error: 'venue / keys invalid' }, { status: 400 });
  if (q.has('pairs') && (!pairs || step === null || !trim)) return Response.json({ error: 'pairs / step invalid' }, { status: 400 });
  if (!venue && !pairs && !strat) return Response.json({ error: 'venue+keys, pairs+step and / or strat required' }, { status: 400 });

  const store = scanStore();
  const watch = [...(venue ? [metricsKey(venue)] : []), ...(pairs ? densityKeys(pairs) : []), ...(strat ? strategyKeys(strat) : [])];
  const signal = req.signal;
  const enc = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const write = (chunk: string) => {
        if (!open) return;
        try { controller.enqueue(enc.encode(chunk)); } catch { open = false; }
      };
      let seq = 0;
      const send = (event: string, data: unknown) => write(`event: ${event}\nid: ${++seq}\ndata: ${JSON.stringify(data)}\n\n`);
      write(`retry: 3000\n\n`);

      const since: Record<string, number> = {};
      const sentRows = new Map<string, string>();
      const sentCards = new Map<string, string>();
      const sentFormations = new Map<string, string>();
      let first = true;
      let stalledSince = 0;

      while (open && !signal.aborted) {
        if ((controller.desiredSize ?? 1) <= 0) {
          stalledSince ||= Date.now();
          if (Date.now() - stalledSince > STALL_MS) break;
          await new Promise((r) => setTimeout(r, PATCH_MS));
          continue;
        }
        if (stalledSince) {
          // Skipped patches can't be replayed: start over from the full state.
          stalledSince = 0;
          first = true;
          sentRows.clear();
          sentCards.clear();
          sentFormations.clear();
        }
        if (venue && keys) {
          const k = metricsKey(venue);
          const v = store.get(k)?.version ?? 0;
          if (first || v > (since[k] ?? 0)) {
            since[k] = v;
            const p = metricsPayload(venue, keys);
            const rows = [];
            const seen = new Set<string>();
            for (const r of p.rows) {
              seen.add(r.s);
              const j = JSON.stringify(r);
              if (sentRows.get(r.s) !== j) { rows.push(r); sentRows.set(r.s, j); }
            }
            const removed = [...sentRows.keys()].filter((s) => !seen.has(s));
            removed.forEach((s) => sentRows.delete(s));
            if (first || rows.length || removed.length) send('metrics', { full: first, venue, version: p.version, coverage: p.coverage, rows, removed });
          }
        }
        if (pairs && step !== null && trim) {
          const ks = densityKeys(pairs);
          if (first || ks.some((k) => (store.get(k)?.version ?? 0) > (since[k] ?? 0))) {
            ks.forEach((k) => { since[k] = store.get(k)?.version ?? 0; });
            const p = densitiesPayload(pairs, step, trim);
            const cards = [];
            const seen = new Set<string>();
            for (const c of p.cards) {
              seen.add(c.key);
              const j = JSON.stringify(c);
              if (sentCards.get(c.key) !== j) { cards.push(c); sentCards.set(c.key, j); }
            }
            const removed = [...sentCards.keys()].filter((key) => !seen.has(key));
            removed.forEach((key) => sentCards.delete(key));
            if (first || cards.length || removed.length) send('densities', { full: first, version: p.version, step, coverage: p.coverage, cards, removed });
          }
        }
        if (strat) {
          const ks = strategyKeys(strat);
          if (first || ks.some((k) => (store.get(k)?.version ?? 0) > (since[k] ?? 0))) {
            ks.forEach((k) => { since[k] = store.get(k)?.version ?? 0; });
            const p = strategiesPayload(strat);
            const formations = [];
            const seen = new Set<string>();
            for (const f of p.formations) {
              seen.add(f.id);
              const j = JSON.stringify(f);
              if (sentFormations.get(f.id) !== j) { formations.push(f); sentFormations.set(f.id, j); }
            }
            const removed = [...sentFormations.keys()].filter((id) => !seen.has(id));
            removed.forEach((id) => sentFormations.delete(id));
            if (first || formations.length || removed.length) send('strategies', { full: first, version: p.version, coverage: p.coverage, formations, removed });
          }
        }
        first = false;
        const t0 = Date.now();
        await store.waitForChange(watch, since, HEARTBEAT_MS, signal);
        if (Date.now() - t0 >= HEARTBEAT_MS - 50) write(': ping\n\n');
        // Coalesce bursts of updates into one patch per second.
        const rest = PATCH_MS - (Date.now() - t0);
        if (rest > 0 && !signal.aborted) await new Promise((r) => setTimeout(r, rest));
      }
      open = false;
      // A stalled client's queue is discarded (error), not left for a reader that never comes.
      try { if (stalledSince) controller.error(new Error('client stalled')); else controller.close(); } catch { /* already closed by the client */ }
    },
  }, { highWaterMark: QUEUE_BYTES, size: (chunk) => chunk.byteLength });

  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' },
  });
}
