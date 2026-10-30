/**
 * Data access layer for auth (server components, actions, route handlers): the session
 * cookie → a verified, current user. Pages that need a user call `requireUser()`.
 */
import { io } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { accessOf } from './access';
import type { SessionUser } from './access';
import { cookieOptions, SESSION_COOKIE, SESSION_TTL_MS, signSession, verifySession } from './session';
import { ensureAdmin, findById, isPendingVerification, toSessionUser } from './users';
import type { UserRecord } from './users';

/** The signed-in user, or null (bad / expired / revoked cookie, deleted account). */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  // Clock reads below (expiry, first-run admin seed) stay out of the prerender.
  await io();
  await ensureAdmin();
  const p = await verifySession(token, undefined, Date.now());
  if (!p) return null;
  const u = findById(p.uid);
  // Unverified accounts never get a session; refuse one anyway.
  if (!u || u.sessionVersion !== p.v || isPendingVerification(u)) return null;
  return toSessionUser(u);
}

/**
 * Where `user` stands right now (trial / Pro / expired). Call after `getCurrentUser` /
 * `requireUser`, which have already left the prerender, so this clock read is request-time.
 */
export function accessNow(user: SessionUser): ReturnType<typeof accessOf> {
  return accessOf(user, Date.now());
}

export async function requireUser(next = '/terminal'): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  return user;
}

/** The session cookie for `u` (name, signed token, options) — set it on a response directly (route handlers). */
export async function sessionCookie(u: UserRecord): Promise<{ name: string; value: string; options: ReturnType<typeof cookieOptions> }> {
  const exp = Date.now() + SESSION_TTL_MS;
  const value = await signSession({ uid: u.id, role: u.role, v: u.sessionVersion, exp });
  return { name: SESSION_COOKIE, value, options: cookieOptions(new Date(exp)) };
}

export async function createSession(u: UserRecord): Promise<void> {
  const c = await sessionCookie(u);
  (await cookies()).set(c.name, c.value, c.options);
}

export async function clearSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}
