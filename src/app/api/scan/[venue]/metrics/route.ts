import type { NextRequest } from 'next/server';
import { startEngine } from '@/lib/server/scan/engine';
import { metricsKey, scanStore } from '@/lib/server/scan/store';
import { metricsJson, parseKeys, parseVenue } from '@/lib/server/scan/views';

const HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' };

/**
 * GET /api/scan/:venue/metrics?keys=range_5m,natr_5_14[&since=version]
 * → the background worker's metric table for the venue: { venue, version, coverage, rows }.
 * Served from the in-memory cache (no upstream calls). With `since` equal to the
 * current version the body is just { version, unchanged: true }.
 */
export async function GET(req: NextRequest, ctx: RouteContext<'/api/scan/[venue]/metrics'>) {
  void startEngine(); // no-op once running; covers servers started without instrumentation
  const venue = parseVenue((await ctx.params).venue);
  const keys = parseKeys(req.nextUrl.searchParams.get('keys'));
  if (!venue) return Response.json({ error: 'Unknown venue' }, { status: 400 });
  if (!keys) return Response.json({ error: 'Unknown metric key' }, { status: 400 });
  const since = Number(req.nextUrl.searchParams.get('since'));
  const version = scanStore().get(metricsKey(venue))?.version ?? 0;
  if (since && since === version) return new Response(JSON.stringify({ version, unchanged: true }), { headers: HEADERS });
  return new Response(metricsJson(venue, keys), { headers: HEADERS });
}
