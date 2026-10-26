import type { NextRequest } from 'next/server';
import { isExchangeId } from '@/lib/market/exchanges';
import { getInstrument, getInstruments, isBaseSymbol, UpstreamError } from '@/lib/market/server/marketData';

/**
 * GET /api/market/:exchange/instruments            → { instruments } for the tracked universe
 * GET /api/market/:exchange/instruments?symbol=STRK → { instrument } (null if unlisted)
 */
export async function GET(req: NextRequest, ctx: RouteContext<'/api/market/[exchange]/instruments'>) {
  const { exchange } = await ctx.params;
  if (!isExchangeId(exchange)) return Response.json({ error: 'Unknown exchange' }, { status: 400 });
  const symbol = req.nextUrl.searchParams.get('symbol')?.toUpperCase();
  if (symbol !== undefined && !isBaseSymbol(symbol)) return Response.json({ error: 'Invalid symbol' }, { status: 400 });
  try {
    if (symbol) return Response.json({ instrument: await getInstrument(exchange, symbol) });
    return Response.json({ instruments: await getInstruments(exchange) });
  } catch (e) {
    const status = e instanceof UpstreamError ? e.status : 502;
    return Response.json({ error: e instanceof Error ? e.message : 'Upstream error' }, { status });
  }
}
