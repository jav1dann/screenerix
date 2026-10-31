import type { NextRequest } from 'next/server';
import { isExchangeId } from '@/lib/market/exchanges';
import { getTrades, isBaseSymbol, upstreamErrorResponse, venueRestrictedResponse } from '@/lib/market/server/marketData';

/** GET /api/market/:exchange/trades?symbol=BTC → { trades } (recent public trades, oldest first). */
export async function GET(req: NextRequest, ctx: RouteContext<'/api/market/[exchange]/trades'>) {
  const { exchange } = await ctx.params;
  const symbol = (req.nextUrl.searchParams.get('symbol') ?? '').toUpperCase();
  if (!isExchangeId(exchange)) return Response.json({ error: 'Unknown exchange' }, { status: 400 });
  // The exchange refuses this server's region: say so at once (no upstream call, no retry storm).
  const restricted = venueRestrictedResponse(exchange);
  if (restricted) return restricted;
  if (!isBaseSymbol(symbol)) return Response.json({ error: 'Invalid symbol' }, { status: 400 });
  try {
    return Response.json({ trades: await getTrades(exchange, symbol) });
  } catch (e) {
    return upstreamErrorResponse(e, exchange);
  }
}
