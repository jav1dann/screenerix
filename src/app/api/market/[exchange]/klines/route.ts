import type { NextRequest } from 'next/server';
import { isExchangeId, isSubMinute, isTimeframe } from '@/lib/market/exchanges';
import { getKlines, getSubMinuteCandles, isBaseSymbol, parseCursor, UpstreamError } from '@/lib/market/server/marketData';

/**
 * GET /api/market/:exchange/klines?symbol=BTC&tf=1m&limit=90 → { candles } (oldest first).
 * Optional `end` (ms): the candles opening at or before it, for older history.
 * `tf=1s` / `tf=30s` → { candles, asOf, cursor }: recent sub-minute history (no `limit` / `end`); pass `cursor`
 * back for the page before it (see getSubMinuteCandles).
 */
export async function GET(req: NextRequest, ctx: RouteContext<'/api/market/[exchange]/klines'>) {
  const { exchange } = await ctx.params;
  const q = req.nextUrl.searchParams;
  const symbol = (q.get('symbol') ?? '').toUpperCase();
  const tf = q.get('tf') ?? '1m';
  const limit = Number(q.get('limit') ?? 90);
  const endParam = q.get('end');
  const end = endParam === null ? undefined : Number(endParam);

  if (!isExchangeId(exchange)) return Response.json({ error: 'Unknown exchange' }, { status: 400 });
  if (!isBaseSymbol(symbol)) return Response.json({ error: 'Invalid symbol' }, { status: 400 });
  if (isSubMinute(tf)) {
    try {
      const cursor = q.get('cursor');
      if (cursor !== null && !parseCursor(cursor)) return Response.json({ error: 'Invalid cursor' }, { status: 400 });
      return Response.json(await getSubMinuteCandles(exchange, symbol, tf, cursor));
    } catch (e) {
      const status = e instanceof UpstreamError ? e.status : 502;
      return Response.json({ error: e instanceof Error ? e.message : 'Upstream error' }, { status });
    }
  }
  if (!isTimeframe(tf)) return Response.json({ error: 'Unsupported timeframe' }, { status: 400 });
  if (!Number.isInteger(limit) || limit < 2 || limit > 300) return Response.json({ error: 'limit must be 2–300' }, { status: 400 });
  if (end !== undefined && !(Number.isInteger(end) && end > 0)) return Response.json({ error: 'end must be a timestamp in ms' }, { status: 400 });

  try {
    return Response.json({ candles: await getKlines(exchange, symbol, tf, limit, end) });
  } catch (e) {
    const status = e instanceof UpstreamError ? e.status : 502;
    return Response.json({ error: e instanceof Error ? e.message : 'Upstream error' }, { status });
  }
}
