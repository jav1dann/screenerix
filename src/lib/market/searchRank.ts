/**
 * Ticker matching shared by the search modal and the filter "Ignore coins" input:
 * exact symbol → prefix → contains. Sorting is stable, so the input order
 * (usually most traded first) breaks ties.
 */
export const normalizeQuery = (query: string): string => query.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

/** 0 = exact, 1 = prefix, 2 = contains, -1 = no match. `q` must be normalised. */
export function matchTier(symbol: string, q: string): number {
  const s = symbol.toUpperCase();
  return s === q ? 0 : s.startsWith(q) ? 1 : s.includes(q) ? 2 : -1;
}

export function rankBy<T>(items: readonly T[], symbolOf: (t: T) => string, query: string, opts: { exactOnly?: boolean } = {}): T[] {
  const q = normalizeQuery(query);
  if (!q) return [...items];
  const scored: Array<{ t: T; tier: number }> = [];
  for (const t of items) {
    const tier = matchTier(symbolOf(t), q);
    if (tier === 0 || (tier > 0 && !opts.exactOnly)) scored.push({ t, tier });
  }
  scored.sort((x, y) => x.tier - y.tier);
  return scored.map((x) => x.t);
}
