import type { NextRequest } from 'next/server';
import { isExchangeId, TIMEFRAME_MS } from '@/lib/market/exchanges';
import { getOiCurrent, getOiHistory, isBaseSymbol, oiPeriod, upstreamErrorResponse, venueRestrictedResponse } from '@/lib/market/server/marketData';

/**
 * GET /api/market/:exchange/oi?symbol=BTC&tf=1m&limit=200 → { period, points } (base units, oldest first)
 * GET /api/market/:exchange/oi?symbol=BTC&current=1      → { oi } (base units, or null)
 */
export async function GET(req: NextRequest, ctx: RouteContext<'/api/market/[exchange]/oi'>) {
  const { exchange } = await ctx.params;
  const q = req.nextUrl.searchParams;
  const symbol = (q.get('symbol') ?? '').toUpperCase();
  const tf = q.get('tf') ?? '5m';
  const limit = Number(q.get('limit') ?? 200);
  if (!isExchangeId(exchange)) return Response.json({ error: 'Unknown exchange' }, { status: 400 });
  // The exchange refuses this server's region: say so at once (no upstream call, no retry storm).
  const restricted = venueRestrictedResponse(exchange);
  if (restricted) return restricted;
  if (!isBaseSymbol(symbol)) return Response.json({ error: 'Invalid symbol' }, { status: 400 });
  if (!(tf in TIMEFRAME_MS)) return Response.json({ error: 'Unsupported timeframe' }, { status: 400 });
  if (!Number.isInteger(limit) || limit < 2 || limit > 500) return Response.json({ error: 'limit must be 2–500' }, { status: 400 });

  try {
    if (q.get('current')) return Response.json({ oi: await getOiCurrent(exchange, symbol) });
    const period = oiPeriod(exchange, tf);
    return Response.json({ period, points: period ? await getOiHistory(exchange, symbol, period, limit) : [] });
  } catch (e) {
    return upstreamErrorResponse(e, exchange);
  }
}
