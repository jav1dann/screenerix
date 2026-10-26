/** Failed sign-in throttle: at most `MAX` failures per key (email, IP) per window. In-memory, per server. */
const WINDOW_MS = 5 * 60_000;
const MAX = 5;

const g = globalThis as typeof globalThis & { __sxAuthFails?: Map<string, number[]> };
const fails = (g.__sxAuthFails ??= new Map<string, number[]>());

const recent = (key: string, now: number) => (fails.get(key) ?? []).filter((t) => now - t < WINDOW_MS);

/** True when any of `keys` has used up its failures. */
export function isThrottled(keys: readonly string[], now = Date.now()): boolean {
  return keys.some((k) => recent(k, now).length >= MAX);
}

export function recordFailure(keys: readonly string[], now = Date.now()): void {
  for (const k of keys) fails.set(k, [...recent(k, now), now]);
  if (fails.size > 10_000) for (const [k, ts] of fails) if (!ts.some((t) => now - t < WINDOW_MS)) fails.delete(k);
}

export function clearFailures(keys: readonly string[]): void {
  for (const k of keys) fails.delete(k);
}
