'use server';

/**
 * Credential auth: sign in, register, email verification, sign out. Errors are generic
 * ("Invalid email or password") so they don't reveal which emails have accounts; failures are
 * throttled per email and per IP. A new account gets a session only after its email code is
 * entered (`verifyEmail`); until then sign-in sends it back to the code screen.
 */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { safeNext } from '@/lib/auth/access';
import { clearSession, createSession, getCurrentUser } from '@/lib/auth/dal';
import { clearFailures, isThrottled, recordFailure } from '@/lib/auth/throttle';
import { bumpSessionVersion, burnPasswordCheck, createUser, ensureAdmin, findByEmail, isPendingVerification, normEmail, replacePendingUser, verifyPassword } from '@/lib/auth/users';
import type { UserRecord } from '@/lib/auth/users';
import { canReplacePending, checkVerificationCode, sendVerificationCode } from '@/lib/auth/verification';
import { isEmail } from '@/lib/format';
import { clientIp } from '@/lib/server/clientIp';
import { mailReady } from '@/lib/mail/send';

export interface AuthState {
  error: string | null;
  /** Echoed back so the form keeps what was typed. */
  email?: string;
  name?: string;
  /** Set: show the code screen for this email; another code can be sent in `resendIn` ms. */
  verify?: { email: string; resendIn: number };
}

export interface ResendResult { ok: boolean; resendIn: number; error?: string }

const str = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v : '');
const MAX_PASSWORD = 200;

/**
 * Throttle keys: the email (`e:`), plus the client IP (`ip:`) when a trusted reverse proxy
 * reports it (`TRUST_PROXY`, see clientIp.ts). Without one there's no trustworthy address, and
 * attempts are counted per email only. Rules per kind: throttle.ts.
 */
async function throttleKeys(email: string, prefix = ''): Promise<{ email: string; ip: string | null; all: string[] }> {
  const ip = clientIp(await headers());
  const keys = { email: `${prefix}e:${email}`, ip: ip ? `${prefix}ip:${ip}` : null };
  return { ...keys, all: keys.ip ? [keys.email, keys.ip] : [keys.email] };
}

const MAIL_FAILED = 'We couldn’t send the verification email. Please try again in a moment.';

/** Sends a code (cooldown permitting) and moves the form to the code screen. */
async function toVerify(user: UserRecord, lang: unknown, back: AuthState): Promise<AuthState> {
  const sent = await sendVerificationCode(user, lang);
  if (!sent.ok && sent.reason === 'mail') return { ...back, error: MAIL_FAILED };
  // 'wait': a code went out moments ago — it's still valid, so just show the code screen.
  return { error: null, verify: { email: user.email, resendIn: sent.resendIn } };
}

export async function signIn(_prev: AuthState, form: FormData): Promise<AuthState> {
  await ensureAdmin();
  const email = normEmail(str(form.get('email')));
  const password = str(form.get('password'));
  const next = safeNext(form.get('next'));
  if (!isEmail(email)) return { error: 'Enter a valid email address.', email };
  if (!password || password.length > MAX_PASSWORD) return { error: 'Enter your password.', email };
  const keys = await throttleKeys(email);
  if (isThrottled(keys.all)) return { error: 'Too many attempts. Try again in a few minutes.', email };
  const user = findByEmail(email);
  const ok = user ? await verifyPassword(user, password) : (await burnPasswordCheck(password), false);
  if (!user || !ok) {
    recordFailure(keys.all);
    return { error: 'Invalid email or password.', email };
  }
  // Only this email's count: the IP's keeps counting, or signing in to one's own account
  // between guesses would reset the limit on guessing other people's passwords.
  clearFailures([keys.email]);
  if (isPendingVerification(user)) return toVerify(user, form.get('lang'), { error: null, email });
  await createSession(user);
  redirect(next);
}

export async function register(_prev: AuthState, form: FormData): Promise<AuthState> {
  await ensureAdmin();
  const name = str(form.get('name')).trim();
  const email = normEmail(str(form.get('email')));
  const password = str(form.get('password'));
  if (!name) return { error: 'Enter your name.', email, name };
  if (!isEmail(email)) return { error: 'Enter a valid email address.', email, name };
  if (password.length < 8) return { error: 'Password must be at least 8 characters.', email, name };
  if (password.length > MAX_PASSWORD) return { error: 'Password is too long.', email, name };
  if (form.get('terms') !== 'on') return { error: 'Accept the Terms of Service and Privacy Policy to continue.', email, name };
  const TAKEN = { error: 'An account with this email already exists. Sign in instead.', email, name };
  if (!mailReady()) {
    console.error('[auth] registration refused: RESEND_API_KEY is not set, so the verification code can’t be emailed');
    return { error: 'Registration is temporarily unavailable. Please try again later.', email, name };
  }
  // New sign-ups per client IP (behind a trusted proxy): each one sends an email.
  const regIp = (await throttleKeys(email, 'reg:')).ip;
  const ipKeys = regIp ? [regIp] : [];
  if (isThrottled(ipKeys)) return { error: 'Too many sign-ups from this network. Try again in a few minutes.', email, name };
  const existing = findByEmail(email);
  let user: UserRecord | null;
  if (existing && isPendingVerification(existing)) {
    // Same person resubmitting (same password): back to the code screen. Someone else: only
    // once the outstanding code has expired, so nobody can hijack a sign-up in progress.
    if (await verifyPassword(existing, password)) return toVerify(existing, form.get('lang'), { error: null, email, name });
    if (!canReplacePending(existing)) return { error: 'This email is waiting for verification. Check the inbox, or try again in 10 minutes.', email, name };
    user = await replacePendingUser(existing.id, { name, password, termsAcceptedAt: Date.now() });
  } else if (existing) {
    return TAKEN;
  } else {
    try {
      user = await createUser({ email, name, password, role: 'user', termsAcceptedAt: Date.now(), pendingVerification: true });
    } catch {
      return TAKEN;
    }
  }
  if (!user) return TAKEN;
  recordFailure(ipKeys);
  return toVerify(user, form.get('lang'), { error: null, email, name });
}

/** The 6-digit code from the email: verifies the account, signs it in and starts the trial. */
export async function verifyEmail(_prev: AuthState, form: FormData): Promise<AuthState> {
  const email = normEmail(str(form.get('email')));
  const code = str(form.get('code'));
  const next = safeNext(form.get('next'));
  const stay = (error: string): AuthState => ({ error, verify: { email, resendIn: 0 } });
  if (!/^\d{6}$/.test(code.replace(/\s/g, ''))) return stay('Enter the 6-digit code from the email.');
  const keys = await throttleKeys(email, 'v:');
  if (isThrottled(keys.all)) return stay('Too many attempts. Try again in a few minutes.');
  const user = findByEmail(email);
  if (!user || !isPendingVerification(user)) {
    recordFailure(keys.all);
    return stay('This code is incorrect or has expired.');
  }
  const r = checkVerificationCode(user, code);
  if (!r.ok) {
    recordFailure(keys.all);
    if (r.reason === 'expired') return stay('This code has expired. Send a new one.');
    if (r.reason === 'locked') return stay('Too many incorrect attempts. Send a new code.');
    return stay(`That code is incorrect. ${r.attemptsLeft} attempt${r.attemptsLeft === 1 ? '' : 's'} left.`);
  }
  clearFailures([keys.email]);
  await createSession(r.user);
  redirect(next);
}

/** "Resend code": a new code for a pending account, once the cooldown allows. */
export async function resendVerification(rawEmail: string, lang?: string): Promise<ResendResult> {
  const email = normEmail(String(rawEmail ?? ''));
  const user = isEmail(email) ? findByEmail(email) : null;
  // Unknown or already verified: answer like a success, without sending anything.
  if (!user || !isPendingVerification(user)) return { ok: true, resendIn: 60_000 };
  const sent = await sendVerificationCode(user, lang);
  if (sent.ok) return { ok: true, resendIn: sent.resendIn };
  if (sent.reason === 'wait') return { ok: false, resendIn: sent.resendIn, error: 'Please wait before requesting another code.' };
  return { ok: false, resendIn: 0, error: MAIL_FAILED };
}

/** Ends this session and every other one of the account (the version bump revokes old tokens). */
export async function signOut(): Promise<void> {
  const user = await getCurrentUser();
  if (user) bumpSessionVersion(user.id);
  await clearSession();
  redirect('/');
}
