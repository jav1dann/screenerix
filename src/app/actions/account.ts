'use server';

/**
 * Account settings: email & password, linked accounts (Google, Telegram), plan summary.
 * Telegram links are issued by POST /api/telegram/link-token.
 * Sensitive changes ask for the current password; failures are throttled per account.
 */
import { accessOf } from '@/lib/auth/access';
import type { AccessState } from '@/lib/auth/access';
import { createSession, getCurrentUser } from '@/lib/auth/dal';
import { googleConfigured } from '@/lib/auth/google';
import { clearFailures, isThrottled, recordFailure } from '@/lib/auth/throttle';
import { findByEmail, findById, hashPassword, normEmail, setLang, setTelegram, updateUser, verifyPassword } from '@/lib/auth/users';
import { checkEmailChangeCode, sendEmailChangeCode } from '@/lib/auth/verification';
import { ordersOf, toOrderView } from '@/lib/billing/orders';
import type { OrderView } from '@/lib/billing/orders';
import { isEmail } from '@/lib/format';
import { telegramConfigured } from '@/lib/telegram/bot';
import { isLang } from '@/lib/telegram/i18n';
import type { Lang } from '@/lib/telegram/i18n';

export interface AccountView {
  name: string;
  email: string;
  /** A new email waiting for its code (`confirmEmailChange`), while that code is valid. */
  pendingEmail: string | null;
  hasPassword: boolean;
  google: { configured: boolean; linked: boolean; sub: string | null; picture: string | null };
  telegram: { configured: boolean; linked: boolean; id: number | null; username: string | null; name: string | null; linkedAt: number | null };
  /** Language of Telegram / push alerts and bot replies (null: not chosen — English). */
  lang: Lang | null;
  access: { state: AccessState; until?: number };
  orders: OrderView[];
}

export type AccountResult = { ok: true; account: AccountView; message?: string } | { ok: false; error: string };

const SIGNED_OUT = { ok: false, error: 'Your session has ended. Sign in again.' } as const;
const MAX_PASSWORD = 200;

/** The signed-in account's full record (null: signed out / revoked). */
async function me() {
  const s = await getCurrentUser();
  return s ? findById(s.id) : null;
}

function viewOf(id: string): AccountView | null {
  const u = findById(id);
  if (!u) return null;
  return {
    name: u.name,
    email: u.email,
    pendingEmail: u.emailChange && u.emailChange.expiresAt > Date.now() ? u.emailChange.email : null,
    hasPassword: Boolean(u.passHash),
    google: { configured: googleConfigured(), linked: Boolean(u.googleSub), sub: u.googleSub ?? null, picture: u.picture ?? null },
    telegram: {
      configured: telegramConfigured(), linked: Boolean(u.telegram), id: u.telegram?.id ?? null,
      username: u.telegram?.username ?? null, name: u.telegram?.firstName ?? null, linkedAt: u.telegram?.linkedAt ?? null,
    },
    lang: u.lang ?? null,
    access: accessOf(u, Date.now()),
    orders: ordersOf(u.id).slice(0, 10).map(toOrderView),
  };
}

const ok = (id: string, message?: string): AccountResult => {
  const account = viewOf(id);
  return account ? { ok: true, account, ...(message ? { message } : {}) } : SIGNED_OUT;
};

export async function getAccount(): Promise<AccountResult> {
  const u = await me();
  return u ? ok(u.id) : SIGNED_OUT;
}

/**
 * New email, step 1: the current password, then a code is sent to the new address. The email
 * changes only when that code is entered (`confirmEmailChange`) — proof the inbox is theirs, so
 * nobody can put someone else's address on an account (and catch their later Google sign-in).
 */
export async function changeEmail(newEmail: string, password: string): Promise<AccountResult> {
  const u = await me();
  if (!u) return SIGNED_OUT;
  const email = normEmail(String(newEmail ?? ''));
  if (!isEmail(email) || email.length > 200) return { ok: false, error: 'Enter a valid email address.' };
  if (email === u.email) return { ok: false, error: 'That’s already your email.' };
  if (!u.passHash) return { ok: false, error: 'Set a password first — it confirms changes like this one.' };
  const keys = [`acct:${u.id}`];
  if (isThrottled(keys)) return { ok: false, error: 'Too many attempts. Try again in a few minutes.' };
  if (typeof password !== 'string' || password.length > MAX_PASSWORD || !(await verifyPassword(u, password))) {
    recordFailure(keys);
    return { ok: false, error: 'The password is incorrect.' };
  }
  if (findByEmail(email)) return { ok: false, error: 'Another account already uses this email.' };
  clearFailures(keys);
  const sent = await sendEmailChangeCode(u, email);
  if (!sent.ok && sent.reason === 'mail') return { ok: false, error: 'We couldn’t send the confirmation code. Please try again in a moment.' };
  if (!sent.ok) return { ok: false, error: `A code was sent moments ago. You can request another in ${Math.ceil(sent.resendIn / 1000)} s.` };
  return ok(u.id, `We sent a 6-digit code to ${email}. Enter it below to finish the change.`);
}

/** New email, step 2: the code from the new inbox. */
export async function confirmEmailChange(code: string): Promise<AccountResult> {
  const u = await me();
  if (!u) return SIGNED_OUT;
  const keys = [`acct-email:${u.id}`];
  if (isThrottled(keys)) return { ok: false, error: 'Too many attempts. Try again in a few minutes.' };
  const r = checkEmailChangeCode(u, String(code ?? ''));
  if (r.ok) { clearFailures(keys); return ok(u.id, 'Email updated. Use it the next time you sign in.'); }
  recordFailure(keys);
  if (r.reason === 'taken') return { ok: false, error: 'Another account started using this email. Choose a different one.' };
  if (r.reason === 'expired') return { ok: false, error: 'This code has expired. Request a new one.' };
  if (r.reason === 'locked') return { ok: false, error: 'Too many incorrect attempts. Request a new code.' };
  return { ok: false, error: `That code is incorrect. ${r.attemptsLeft} attempt${r.attemptsLeft === 1 ? '' : 's'} left.` };
}

/** Drops a requested email change (the current email stays). */
export async function cancelEmailChange(): Promise<AccountResult> {
  const u = await me();
  if (!u) return SIGNED_OUT;
  // Keeps the send history, so cancelling doesn't reset the resend cooldown.
  if (u.emailChange) updateUser(u.id, { emailChange: { ...u.emailChange, expiresAt: 0 } });
  return ok(u.id);
}

/** First password for an account created with Google ("add email sign-in"). */
export async function setPassword(password: string): Promise<AccountResult> {
  const u = await me();
  if (!u) return SIGNED_OUT;
  if (u.passHash) return { ok: false, error: 'This account already has a password. Change it instead.' };
  if (typeof password !== 'string' || password.length < 8) return { ok: false, error: 'Use at least 8 characters.' };
  if (password.length > MAX_PASSWORD) return { ok: false, error: 'That password is too long.' };
  updateUser(u.id, await hashPassword(password));
  return ok(u.id, `Password set. You can now also sign in with ${u.email}.`);
}

/** New password; other devices are signed out (this one gets a fresh session). */
export async function changePassword(current: string, next: string): Promise<AccountResult> {
  const u = await me();
  if (!u) return SIGNED_OUT;
  if (!u.passHash) return { ok: false, error: 'This account has no password yet.' };
  if (typeof next !== 'string' || next.length < 8) return { ok: false, error: 'Use at least 8 characters.' };
  if (next.length > MAX_PASSWORD) return { ok: false, error: 'That password is too long.' };
  const keys = [`acct:${u.id}`];
  if (isThrottled(keys)) return { ok: false, error: 'Too many attempts. Try again in a few minutes.' };
  if (typeof current !== 'string' || current.length > MAX_PASSWORD || !(await verifyPassword(u, current))) {
    recordFailure(keys);
    return { ok: false, error: 'The current password is incorrect.' };
  }
  clearFailures(keys);
  const updated = updateUser(u.id, { ...(await hashPassword(next)), sessionVersion: u.sessionVersion + 1 });
  if (updated) await createSession(updated);
  return ok(u.id, 'Password changed. Other devices were signed out.');
}

/** Disconnect Google — only when a password remains to sign in with. */
export async function unlinkGoogle(): Promise<AccountResult> {
  const u = await me();
  if (!u) return SIGNED_OUT;
  if (!u.googleSub) return ok(u.id);
  if (!u.passHash) return { ok: false, error: 'Set a password first, or you’d have no way to sign in.' };
  updateUser(u.id, { googleSub: undefined, picture: undefined });
  return ok(u.id, 'Google disconnected.');
}

export async function disconnectTelegram(): Promise<AccountResult> {
  const u = await me();
  if (!u) return SIGNED_OUT;
  setTelegram(u.id, null);
  return ok(u.id, 'Telegram disconnected.');
}

/** Language of Telegram / push alerts and bot replies (the bot's /language sets the same field). */
export async function setNotifyLanguage(lang: Lang): Promise<AccountResult> {
  const u = await me();
  if (!u) return SIGNED_OUT;
  if (!isLang(lang)) return { ok: false, error: 'Choose a language.' };
  setLang(u.id, lang);
  return ok(u.id, 'Alert language saved.');
}
