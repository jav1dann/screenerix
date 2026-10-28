import { isExchangeId } from '@/lib/market/exchanges';
import { isDensityMarket } from '@/lib/densities/types';
import { getDensityUniverse, hasDepth } from '@/lib/market/server/depthSources';
import { upstreamErrorResponse } from '@/lib/market/server/marketData';

/** GET /api/depth/:venue/:market/universe → { rows } — every coin with last price, 24h turnover and change, most traded first. */
export async function GET(_req: Request, ctx: RouteContext<'/api/depth/[venue]/[market]/universe'>) {
  const { venue, market } = await ctx.params;
  if (!isExchangeId(venue) || !isDensityMarket(market) || !hasDepth(venue, market)) return Response.json({ error: 'Unsupported venue / market' }, { status: 400 });
  try {
    return Response.json({ rows: await getDensityUniverse(venue, market) });
  } catch (e) {
    return upstreamErrorResponse(e);
  }
}
