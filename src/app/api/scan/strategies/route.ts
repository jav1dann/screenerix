import type { NextRequest } from 'next/server';
import { startEngine } from '@/lib/server/scan/engine';
import { parseVenues, strategiesJson, strategyVersion } from '@/lib/server/scan/views';

const HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' };

/**
 * GET /api/scan/strategies?venues=binance,bybit[&since=version]
 * → tracked strategy formations of those venues (every stage), from the cache.
 */
export function GET(req: NextRequest) {
  void startEngine();
  const q = req.nextUrl.searchParams;
  const venues = parseVenues(q.get('venues'));
  if (!venues) return Response.json({ error: 'venues: exchange list (e.g. binance,bybit)' }, { status: 400 });
  const since = Number(q.get('since'));
  const version = strategyVersion(venues);
  if (since && since === version) return new Response(JSON.stringify({ version, unchanged: true }), { headers: HEADERS });
  return new Response(strategiesJson(venues), { headers: HEADERS });
}
