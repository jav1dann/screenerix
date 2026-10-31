import { connection } from 'next/server';
import { venueHealthReport } from '@/lib/market/server/venueHealth';

/**
 * GET /api/market/venues → { venues: { [id]: { state: 'ok' | 'restricted', status?, retryAt?, message? } } }
 * Which exchanges this server can currently reach. 'restricted': the exchange refuses this
 * server's region (HTTP 451 / 403) — the terminal picks another venue for new visitors and says why.
 * 'ok' also means "not refused so far" (a venue nobody has asked yet).
 */
export async function GET() {
  await connection(); // always dynamic: the live state, never a build-time snapshot
  return Response.json(venueHealthReport(), { headers: { 'cache-control': 'no-store' } });
}
