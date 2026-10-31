'use client';

import { useEffect } from 'react';
import type { MarketType } from '@/lib/alerts/alertStore';
import { EXCHANGE_IDS } from '@/lib/market/exchanges';
import { terminalPrefs } from '@/lib/market/terminalPrefs';
import type { ExchangeId, StatusMap } from '@/lib/market/types';
import { autoVenue, availableVenues } from '@/lib/market/venueChoice';
import type { VenueHealthMap } from './useVenueHealth';

/**
 * Which exchanges refuse our servers' region (from the feed this session, or the server's last
 * check), the working alternatives to the shown one — and, for visitors who never picked a venue,
 * an automatic switch to one that works (a picked venue is never changed: see venueChoice.ts).
 */
export function useVenueSelection(p: {
  market: MarketType;
  primary: ExchangeId;
  chosen: boolean;
  /** Venues enabled in Settings for this market. */
  enabled: readonly ExchangeId[];
  status: StatusMap;
  health: VenueHealthMap | null;
}): { restricted: ReadonlySet<ExchangeId>; alternatives: ExchangeId[]; status: StatusMap } {
  const restrictedIds = EXCHANGE_IDS.filter((id) => !!p.status[id].restricted || p.health?.[id]?.state === 'restricted');
  const restricted = new Set(restrictedIds);
  const isRestricted = (id: ExchangeId) => restricted.has(id);
  const next = autoVenue({ market: p.market, current: p.primary, chosen: p.chosen, enabled: p.enabled, restricted: isRestricted });
  const market = p.market;
  useEffect(() => {
    if (!next) return;
    const cur = terminalPrefs.getSnapshot();
    terminalPrefs.update({ venue: { ...cur.venue, [market]: next } });
  }, [next, market]);
  // Venues not streamed right now (status 'idle') still show what the server knows: a refused
  // exchange is "unavailable" in the pills and the Arbitrage columns, not "not streaming".
  const status = Object.fromEntries(EXCHANGE_IDS.map((id) => {
    const st = p.status[id];
    const h = p.health?.[id];
    return [id, h?.state === 'restricted' && !st.restricted && st.state === 'idle'
      ? { state: 'error' as const, error: h.message ?? 'Not available from our servers’ region', restricted: { retryAt: h.retryAt } }
      : st];
  })) as StatusMap;
  return { restricted, alternatives: availableVenues(p.market, p.enabled, isRestricted).filter((id) => id !== p.primary), status };
}
