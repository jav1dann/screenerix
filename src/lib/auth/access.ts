/**
 * Roles, subscription state and feature access (shared by server and client; no secrets here).
 * Every gate in the app should ask `can(user, feature, now)` / `hasAccess`, so admins always pass.
 */
export type Role = 'admin' | 'user';
export type Plan = 'pro' | 'trial';

/** What the browser knows about the signed-in user. */
export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  plan: Plan;
  /** Avatar from Google sign-in. */
  picture?: string;
  /** End of the free trial (ms). */
  trialEndsAt?: number;
  /** End of the paid Pro period (ms). */
  proExpiresAt?: number;
}

export const FEATURES = ['marketMap', 'allExchanges', 'review', 'densities', 'strategies', 'arbitrage', 'alerts', 'workspaces', 'indicators', 'drawings'] as const;
export type Feature = (typeof FEATURES)[number];

export const TRIAL_DAYS = 3;
export const DAY_MS = 86_400_000;

type AccessFields = Pick<SessionUser, 'role' | 'trialEndsAt' | 'proExpiresAt'>;

/** Where an account stands: admins always pass; otherwise a paid Pro period, the trial, or neither. */
export type AccessState = 'admin' | 'pro' | 'trial' | 'expired';

export function accessOf(user: AccessFields, now: number): { state: AccessState; until?: number } {
  if (user.role === 'admin') return { state: 'admin' };
  if (user.proExpiresAt && user.proExpiresAt > now) return { state: 'pro', until: user.proExpiresAt };
  if (user.trialEndsAt && user.trialEndsAt > now) return { state: 'trial', until: user.trialEndsAt };
  return { state: 'expired', until: user.proExpiresAt ?? user.trialEndsAt };
}

export const hasAccess = (user: AccessFields | null | undefined, now: number): boolean => !!user && accessOf(user, now).state !== 'expired';

/** The trial and Pro both include every feature; an expired account has none. */
export function can(user: AccessFields | null | undefined, feature: Feature, now: number): boolean {
  return FEATURES.includes(feature) && hasAccess(user, now);
}

export const isAdmin = (user: Pick<SessionUser, 'role'> | null | undefined): boolean => user?.role === 'admin';

/** The /login message for an OAuth failure (`?error=google_<code>`); null for anything else. */
export function oauthErrorMessage(error: unknown): string | null {
  if (typeof error !== 'string' || !error.startsWith('google_')) return null;
  switch (error) {
    case 'google_cancelled': return 'Google sign-in was cancelled.';
    case 'google_expired': return 'That sign-in attempt expired. Please try again.';
    case 'google_unverified': return 'Your Google account’s email isn’t verified. Verify it with Google, or register with email.';
    case 'google_unavailable': return 'Google sign-in is unavailable right now. Use your email and password instead.';
    default: return 'Google sign-in didn’t work. Please try again.';
  }
}

/** A post-login destination: a same-origin path only (no `//host`, schemes or backslashes). */
export function safeNext(next: unknown, fallback = '/terminal'): string {
  if (typeof next !== 'string' || !next.startsWith('/') || next.startsWith('//') || next.includes('\\') || /[\r\n]/.test(next)) return fallback;
  if (next.startsWith('/login')) return fallback;
  return next.slice(0, 512);
}
