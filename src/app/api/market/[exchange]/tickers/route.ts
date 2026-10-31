import type { NextRequest } from 'next/server';
import { isExchangeId } from '@/lib/market/exchanges';
import { getTickers, upstreamErrorResponse, venueRestrictedResponse } from '@/lib/market/server/marketData';

/** GET /api/market/:exchange/tickers → { tickers } — 24h ticker snapshot for every instrument (venue units). */
export async function GET(_req: NextRequest, ctx: RouteContext<'/api/market/[exchange]/tickers'>) {
  const { exchange } = await ctx.params;
  if (!isExchangeId(exchange)) return Response.json({ error: 'Unknown exchange' }, { status: 400 });
  // The exchange refuses this server's region: say so at once (no upstream call, no retry storm).
  const restricted = venueRestrictedResponse(exchange);
  if (restricted) return restricted;
  try {
    return Response.json({ tickers: await getTickers(exchange) });
  } catch (e) {
    return upstreamErrorResponse(e, exchange);
  }
}
