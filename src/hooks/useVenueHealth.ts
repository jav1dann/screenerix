'use client';

import { useEffect, useState } from 'react';
import { fetchJson } from '@/lib/market/marketApi';
import type { ExchangeId } from '@/lib/market/types';

export interface VenueHealth { state: 'ok' | 'restricted'; message?: string; retryAt?: number }
export type VenueHealthMap = Partial<Record<ExchangeId, VenueHealth>>;

/** How often the terminal re-reads which exchanges our server can reach. */
const REFRESH_MS = 5 * 60_000;

/**
 * Which exchanges refuse our server's region (`/api/market/venues`), re-read every few minutes;
 * null until the first answer (or when it fails — the feed's own statuses still apply).
 */
export function useVenueHealth(): VenueHealthMap | null {
  const [health, setHealth] = useState<VenueHealthMap | null>(null);
  useEffect(() => {
    let on = true;
    const load = () => fetchJson<{ venues: VenueHealthMap }>('/api/market/venues')
      .then((r) => { if (on) setHealth(r.venues); })
      .catch(() => { /* keep what we had */ });
    void load();
    const id = setInterval(load, REFRESH_MS);
    return () => { on = false; clearInterval(id); };
  }, []);
  return health;
}
