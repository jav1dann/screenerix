import type { NextRequest } from 'next/server';
import { startEngine } from '@/lib/server/scan/engine';
import { densitiesJson, densityVersion, parsePairs, parseStep, parseTrim } from '@/lib/server/scan/views';

const HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' };

/**
 * GET /api/scan/densities?pairs=binance:futures,bybit:spot&step=0.05[&min=300000&dist=5][&since=version]
 * → tracked density cards for the nesting step, from the cache, at least `min` $ within `dist` %
 * (defaults: everything tracked, i.e. at least $100K within 12%).
 */
export function GET(req: NextRequest) {
  void startEngine();
  const q = req.nextUrl.searchParams;
  const pairs = parsePairs(q.get('pairs'));
  const step = parseStep(q.get('step'));
  const trim = parseTrim(q.get('min'), q.get('dist'));
  if (!pairs) return Response.json({ error: 'pairs: venue:market list (e.g. binance:futures)' }, { status: 400 });
  if (step === null) return Response.json({ error: 'step: one of 0, 0.05, 0.1, 0.25, 0.5, 1' }, { status: 400 });
  if (!trim) return Response.json({ error: 'min / dist must be numbers' }, { status: 400 });
  const since = Number(q.get('since'));
  const version = densityVersion(pairs);
  if (since && since === version) return new Response(JSON.stringify({ version, unchanged: true }), { headers: HEADERS });
  return new Response(densitiesJson(pairs, step, trim), { headers: HEADERS });
}
