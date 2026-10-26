import type { NextRequest } from 'next/server';
import { isExchangeId } from '@/lib/market/exchanges';
import { isDensityMarket } from '@/lib/densities/types';
import { getDepth, hasDepth } from '@/lib/market/server/depthSources';
import { isBaseSymbol, UpstreamError } from '@/lib/market/server/marketData';

/** GET /api/depth/:venue/:market/book?symbol=BTC → { bids, asks, ts } — [price, base qty], best first, within ±12% of the mid. */
export async function GET(req: NextRequest, ctx: RouteContext<'/api/depth/[venue]/[market]/book'>) {
  const { venue, market } = await ctx.params;
  const symbol = (req.nextUrl.searchParams.get('symbol') ?? '').toUpperCase();
  if (!isExchangeId(venue) || !isDensityMarket(market) || !hasDepth(venue, market)) return Response.json({ error: 'Unsupported venue / market' }, { status: 400 });
  if (!isBaseSymbol(symbol)) return Response.json({ error: 'Invalid symbol' }, { status: 400 });
  try {
    return Response.json(await getDepth(venue, market, symbol));
  } catch (e) {
    const status = e instanceof UpstreamError ? e.status : 502;
    return Response.json({ error: e instanceof Error ? e.message : 'Upstream error' }, { status });
  }
}
