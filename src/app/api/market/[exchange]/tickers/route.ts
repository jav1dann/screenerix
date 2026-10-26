import type { NextRequest } from 'next/server';
import { isExchangeId } from '@/lib/market/exchanges';
import { getTickers, UpstreamError } from '@/lib/market/server/marketData';

/** GET /api/market/:exchange/tickers → { tickers } — 24h ticker snapshot for every instrument (venue units). */
export async function GET(_req: NextRequest, ctx: RouteContext<'/api/market/[exchange]/tickers'>) {
  const { exchange } = await ctx.params;
  if (!isExchangeId(exchange)) return Response.json({ error: 'Unknown exchange' }, { status: 400 });
  try {
    return Response.json({ tickers: await getTickers(exchange) });
  } catch (e) {
    const status = e instanceof UpstreamError ? e.status : 502;
    return Response.json({ error: e instanceof Error ? e.message : 'Upstream error' }, { status });
  }
}
