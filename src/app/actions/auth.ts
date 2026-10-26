'use server';

/**
 * Credential auth: sign in, register, sign out. Errors are generic ("Invalid email or
 * password") so they don't reveal which emails have accounts; failures are throttled per
 * email and per IP.
 */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { safeNext } from '@/lib/auth/access';
import { clearSession, createSession, getCurrentUser } from '@/lib/auth/dal';
import { clearFailures, isThrottled, recordFailure } from '@/lib/auth/throttle';
import { bumpSessionVersion, burnPasswordCheck, createUser, ensureAdmin, findByEmail, normEmail, verifyPassword } from '@/lib/auth/users';
import { isEmail } from '@/lib/format';

export interface AuthState {
  error: string | null;
  /** Echoed back so the form keeps what was typed. */
  email?: string;
  name?: string;
}

const str = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v : '');
const MAX_PASSWORD = 200;

/**
 * Throttle keys: the email, plus the client IP when a trusted reverse proxy sets
 * X-Forwarded-For (`TRUST_PROXY=1`). Without one the header is client-controlled, so it isn't
 * used (and there's no socket address here), and failures are counted per email only.
 */
async function throttleKeys(email: string): Promise<string[]> {
  if (process.env.TRUST_PROXY !== '1') return [`e:${email}`];
  const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim();
  return ip ? [`e:${email}`, `ip:${ip}`] : [`e:${email}`];
}

export async function signIn(_prev: AuthState, form: FormData): Promise<AuthState> {
  await ensureAdmin();
  const email = normEmail(str(form.get('email')));
  const password = str(form.get('password'));
  const next = safeNext(form.get('next'));
  if (!isEmail(email)) return { error: 'Enter a valid email address.', email };
  if (!password || password.length > MAX_PASSWORD) return { error: 'Enter your password.', email };
  const keys = await throttleKeys(email);
  if (isThrottled(keys)) return { error: 'Too many attempts. Try again in a few minutes.', email };
  const user = findByEmail(email);
  const ok = user ? await verifyPassword(user, password) : (await burnPasswordCheck(password), false);
  if (!user || !ok) {
    recordFailure(keys);
    return { error: 'Invalid email or password.', email };
  }
  clearFailures(keys);
  await createSession(user);
  redirect(next);
}

export async function register(_prev: AuthState, form: FormData): Promise<AuthState> {
  await ensureAdmin();
  const name = str(form.get('name')).trim();
  const email = normEmail(str(form.get('email')));
  const password = str(form.get('password'));
  const next = safeNext(form.get('next'));
  if (!name) return { error: 'Enter your name.', email, name };
  if (!isEmail(email)) return { error: 'Enter a valid email address.', email, name };
  if (password.length < 8) return { error: 'Password must be at least 8 characters.', email, name };
  if (password.length > MAX_PASSWORD) return { error: 'Password is too long.', email, name };
  if (form.get('terms') !== 'on') return { error: 'Accept the Terms of Service and Privacy Policy to continue.', email, name };
  if (findByEmail(email)) return { error: 'An account with this email already exists. Sign in instead.', email, name };
  let user;
  try {
    user = await createUser({ email, name, password, role: 'user', termsAcceptedAt: Date.now() });
  } catch {
    return { error: 'An account with this email already exists. Sign in instead.', email, name };
  }
  await createSession(user);
  redirect(next);
}

/** Ends this session and every other one of the account (the version bump revokes old tokens). */
export async function signOut(): Promise<void> {
  const user = await getCurrentUser();
  if (user) bumpSessionVersion(user.id);
  await clearSession();
  redirect('/');
}
