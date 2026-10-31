import { connection } from 'next/server';
import { allVenueHealth } from '@/lib/market/server/venueHealth';
import { runningEngine, startEngine } from '@/lib/server/scan/engine';

/**
 * GET /api/scan/status → background worker health: coverage per venue, cache ages, upstream budget use,
 * and `venues`: which exchanges refuse this server's region (paused until their next check).
 */
export async function GET() {
  await connection(); // always dynamic: never evaluated at build time
  void startEngine();
  const engine = await runningEngine();
  if (!engine) return Response.json({ running: false, reason: 'SCANNER=off' }, { headers: { 'cache-control': 'no-store' } });
  return Response.json({ running: true, venues: allVenueHealth(), ...(engine.status() as object) }, { headers: { 'cache-control': 'no-store' } });
}
