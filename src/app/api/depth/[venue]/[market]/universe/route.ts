import { isExchangeId } from '@/lib/market/exchanges';
import { isDensityMarket } from '@/lib/densities/types';
import { getDensityUniverse, hasDepth } from '@/lib/market/server/depthSources';
import { upstreamErrorResponse, venueRestrictedResponse } from '@/lib/market/server/marketData';

/** GET /api/depth/:venue/:market/universe → { rows } — every coin with last price, 24h turnover and change, most traded first. */
export async function GET(_req: Request, ctx: RouteContext<'/api/depth/[venue]/[market]/universe'>) {
  const { venue, market } = await ctx.params;
  if (!isExchangeId(venue) || !isDensityMarket(market) || !hasDepth(venue, market)) return Response.json({ error: 'Unsupported venue / market' }, { status: 400 });
  // Futures depth comes from the venue's market API: refused from this server's region → say so at once.
  // (Spot depth uses other hosts; those refusals are caught per host inside upstreamJson.)
  const restricted = market === 'futures' ? venueRestrictedResponse(venue) : null;
  if (restricted) return restricted;
  try {
    return Response.json({ rows: await getDensityUniverse(venue, market) });
  } catch (e) {
    return upstreamErrorResponse(e, market === 'futures' ? venue : null);
  }
}
