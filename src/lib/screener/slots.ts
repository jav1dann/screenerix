/**
 * Stable grid slots for a live ranking. Coins that still rank keep their card
 * position; a newcomer replaces the weakest card only when it beats it by
 * `margin` (so near-ties don't flicker). Coins that stop ranking — and unscored
 * warm-up placeholders, once scored coins are waiting — are replaced at once.
 */
export interface Ranked { symbol: string; score: number | null }

/** True when `a` ranks better than `b` by more than `margin` (relative). `null` always loses. */
export function beats(a: number | null, b: number | null, dir: 'desc' | 'asc', margin: number): boolean {
  if (a === null) return false;
  if (b === null) return true;
  const slack = Math.abs(b) * margin;
  return dir === 'desc' ? a > b + slack : a < b - slack;
}

/**
 * @param prev   Symbols currently on screen, by slot.
 * @param ranked Current ranking, best first.
 * @param swaps  When false, only vacancies are filled (no hysteresis swaps).
 * @param held   Cards in use (hovered, expanded, editing an alert): kept in their slot
 *               even if they stop ranking or a challenger beats them.
 */
export const SWAP_MARGIN = 0.02;
const NONE: ReadonlySet<string> = new Set();

export function assignSlots(prev: readonly string[], ranked: readonly Ranked[], n: number, dir: 'desc' | 'asc', margin = SWAP_MARGIN, swaps = true, held: ReadonlySet<string> = NONE): string[] {
  const score = new Map(ranked.map((r) => [r.symbol, r.score]));
  // 1. Incumbents that still rank keep their slot; the rest become vacancies. An
  //    unscored incumbent is a vacancy too while a scored coin is off screen.
  const shown = new Set(prev.slice(0, n));
  const scoredWaiting = ranked.filter((r) => r.score !== null && !shown.has(r.symbol)).length;
  let unseat = scoredWaiting;
  const slots: Array<string | null> = prev.slice(0, n).map((s) => {
    if (held.has(s)) return s;
    if (!score.has(s)) return null;
    if (score.get(s) === null && unseat > 0) { unseat--; return null; }
    return s;
  });
  const taken = new Set(slots.filter((s): s is string => s !== null));
  const challengers = ranked.filter((r) => !taken.has(r.symbol));
  let next = 0;
  // 2. Fill vacancies (and empty trailing slots) with the best challengers.
  for (let i = 0; i < n; i++) {
    if (i < slots.length && slots[i] !== null) continue;
    const c = challengers[next++];
    if (!c) break;
    if (i < slots.length) slots[i] = c.symbol; else slots.push(c.symbol);
  }
  // 3. Hysteresis swaps: the best challenger replaces the weakest incumbent while it clearly beats it.
  if (swaps) {
    while (next < challengers.length) {
      const c = challengers[next];
      let weakest = -1;
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        if (s === null || held.has(s)) continue;
        if (weakest < 0 || beats(score.get(slots[weakest]!) ?? null, score.get(s) ?? null, dir, 0)) weakest = i;
      }
      if (weakest < 0 || !beats(c.score, score.get(slots[weakest]!) ?? null, dir, margin)) break;
      slots[weakest] = c.symbol;
      next++;
    }
  }
  return slots.filter((s): s is string => s !== null);
}
