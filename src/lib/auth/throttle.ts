/**
 * Attempt throttle: at most `max` recorded attempts per key in a sliding window. Keys say what
 * they count (an email, an account, a client IP from `clientIp`), and each kind has its rule:
 *   ip:…      failed sign-ins / code checks from one address — higher, a whole office or
 *             mobile carrier can share it; stops guessing one password across many emails
 *   reg:ip:…  new sign-ups from one address (each one sends an email)
 *   anything else (an email, an account): 5 per 5 minutes
 * In-memory, per server process: a restart clears it, and several instances each keep their own.
 */
import 'server-only';

const MIN = 60_000;

interface Rule { max: number; windowMs: number }
const DEFAULT_RULE: Rule = { max: 5, windowMs: 5 * MIN };
/** First match wins. */
const RULES: ReadonlyArray<readonly [RegExp, Rule]> = [
  [/^reg:ip:/, { max: 5, windowMs: 15 * MIN }],
  [/(^|:)ip:/, { max: 20, windowMs: 5 * MIN }],
];
const MAX_WINDOW_MS = Math.max(DEFAULT_RULE.windowMs, ...RULES.map(([, r]) => r.windowMs));

export const ruleOf = (key: string): Rule => RULES.find(([re]) => re.test(key))?.[1] ?? DEFAULT_RULE;

const g = globalThis as typeof globalThis & { __sxAuthFails?: Map<string, number[]> };
const fails = (g.__sxAuthFails ??= new Map<string, number[]>());

const recent = (key: string, now: number) => (fails.get(key) ?? []).filter((t) => now - t < ruleOf(key).windowMs);

/** True when any of `keys` has used up its attempts. */
export function isThrottled(keys: readonly string[], now = Date.now()): boolean {
  return keys.some((k) => recent(k, now).length >= ruleOf(k).max);
}

export function recordFailure(keys: readonly string[], now = Date.now()): void {
  for (const k of keys) fails.set(k, [...recent(k, now), now]);
  if (fails.size > 10_000) for (const [k, ts] of fails) if (!ts.some((t) => now - t < MAX_WINDOW_MS)) fails.delete(k);
}

/** After a success: the account's / email's count starts over (an IP's count is kept, see callers). */
export function clearFailures(keys: readonly string[]): void {
  for (const k of keys) fails.delete(k);
}
