/**
 * Email verification for accounts registered with a password: a 6-digit code (crypto random),
 * stored only as an HMAC on the account with a 10-minute expiry, sent by email. Each code
 * allows 5 guesses; a new one can be sent after a 1-minute cooldown, at most 5 per hour.
 * Server-only.
 */
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { isLocale } from '@/lib/landing/i18n/locales';
import type { Locale } from '@/lib/landing/i18n/locales';
import { MailError, sendMail } from '@/lib/mail/send';
import { authSecret } from './session';
import { isPendingVerification, markEmailVerified, updateUser } from './users';
import type { UserRecord } from './users';

export const CODE_LENGTH = 6;
export const CODE_TTL_MS = 10 * 60_000;
export const RESEND_COOLDOWN_MS = 60_000;
const MAX_ATTEMPTS = 5;
const MAX_SENDS_PER_HOUR = 5;
const HOUR_MS = 3_600_000;

const codeHash = (uid: string, code: string) => createHmac('sha256', authSecret()).update(`email-verify:${uid}:${code}`).digest();

const recentSends = (u: UserRecord, now: number) => (u.verification?.sends ?? []).filter((t) => now - t < HOUR_MS);

/** Milliseconds until another code may be sent to `u` (0: now). */
export function resendWait(u: UserRecord, now = Date.now()): number {
  const sends = recentSends(u, now);
  if (!sends.length) return 0;
  const cooldown = Math.max(0, sends[sends.length - 1] + RESEND_COOLDOWN_MS - now);
  const hourly = sends.length >= MAX_SENDS_PER_HOUR ? sends[sends.length - MAX_SENDS_PER_HOUR] + HOUR_MS - now : 0;
  return Math.max(cooldown, hourly);
}

/** A pending account may be taken over by a new registration once its code has expired (limits email squatting). */
export const canReplacePending = (u: UserRecord, now = Date.now()): boolean => !u.verification || u.verification.expiresAt <= now;

const COPY: Record<Locale, { subject: string; intro: string; expires: string; ignore: string }> = {
  en: { subject: 'Your Screenerix verification code: {code}', intro: 'Enter this code to confirm your email and start your free trial:', expires: 'The code expires in 10 minutes.', ignore: 'If you didn’t create a Screenerix account, you can ignore this email.' },
  ru: { subject: 'Код подтверждения Screenerix: {code}', intro: 'Введите этот код, чтобы подтвердить email и начать бесплатный период:', expires: 'Код действует 10 минут.', ignore: 'Если вы не регистрировались в Screenerix, просто проигнорируйте это письмо.' },
  tr: { subject: 'Screenerix doğrulama kodunuz: {code}', intro: 'E-postanızı doğrulamak ve ücretsiz denemenizi başlatmak için bu kodu girin:', expires: 'Kod 10 dakika geçerlidir.', ignore: 'Screenerix hesabı oluşturmadıysanız bu e-postayı yok sayabilirsiniz.' },
  az: { subject: 'Screenerix təsdiq kodunuz: {code}', intro: 'E-poçtunuzu təsdiqləmək və pulsuz sınaq dövrünü başlatmaq üçün bu kodu daxil edin:', expires: 'Kod 10 dəqiqə etibarlıdır.', ignore: 'Screenerix hesabı yaratmamısınızsa, bu məktubu nəzərə almayın.' },
};

function verificationMail(to: string, code: string, lang: Locale) {
  const c = COPY[lang];
  const subject = c.subject.replace('{code}', code);
  const text = `${c.intro}\n\n${code}\n\n${c.expires}\n${c.ignore}\n\n— Screenerix`;
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#0b0c0e;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#e8e9ec">
<div style="max-width:440px;margin:0 auto;padding:28px;border-radius:14px;background:#111215;border:1px solid #23252b">
<div style="font-weight:700;font-size:16px;margin-bottom:20px">Screenerix</div>
<p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#c9cbd1">${c.intro}</p>
<div style="font-size:32px;font-weight:700;letter-spacing:8px;padding:14px 0;text-align:center;border-radius:10px;background:#0b0c0e;border:1px solid #23252b;color:#30a46c">${code}</div>
<p style="margin:16px 0 0;font-size:13px;color:#8b8e98">${c.expires}<br>${c.ignore}</p>
</div></body></html>`;
  return { to, subject, text, html };
}

export type SendResult = { ok: true; resendIn: number } | { ok: false; reason: 'wait' | 'mail'; resendIn: number };

/** Sends a fresh code to a pending account, unless the cooldown / hourly cap says wait. */
export async function sendVerificationCode(u: UserRecord, lang: unknown, now = Date.now()): Promise<SendResult> {
  const wait = resendWait(u, now);
  if (wait > 0) return { ok: false, reason: 'wait', resendIn: wait };
  const code = String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0');
  try {
    await sendMail(verificationMail(u.email, code, isLocale(lang) ? lang : 'en'));
  } catch (e) {
    if (!(e instanceof MailError)) console.error('[auth] verification email failed', e);
    return { ok: false, reason: 'mail', resendIn: 0 };
  }
  // Saved once it's out: a failed send leaves the previous code (and no cooldown) in place.
  updateUser(u.id, { verification: { hash: codeHash(u.id, code).toString('base64url'), expiresAt: now + CODE_TTL_MS, attempts: 0, sends: [...recentSends(u, now), now] } });
  console.log(`[auth] verification code sent to ${u.email}`);
  return { ok: true, resendIn: RESEND_COOLDOWN_MS };
}

export type CheckResult = { ok: true; user: UserRecord } | { ok: false; reason: 'invalid' | 'expired' | 'locked'; attemptsLeft?: number };

/** Checks a code typed for `u`; the right one verifies the account (and starts its trial). */
export function checkVerificationCode(u: UserRecord, input: string, now = Date.now()): CheckResult {
  const v = u.verification;
  if (!isPendingVerification(u) || !v || v.expiresAt <= now) return { ok: false, reason: 'expired' };
  if (v.attempts >= MAX_ATTEMPTS) return { ok: false, reason: 'locked' };
  const code = input.replace(/\D/g, '');
  const expected = Buffer.from(v.hash, 'base64url');
  const got = codeHash(u.id, code);
  if (code.length === CODE_LENGTH && expected.length === got.length && timingSafeEqual(expected, got)) {
    const user = markEmailVerified(u.id, now) ?? u;
    console.log(`[auth] email verified: ${u.email}`);
    return { ok: true, user };
  }
  const attempts = v.attempts + 1;
  updateUser(u.id, { verification: { ...v, attempts } });
  return attempts >= MAX_ATTEMPTS ? { ok: false, reason: 'locked' } : { ok: false, reason: 'invalid', attemptsLeft: MAX_ATTEMPTS - attempts };
}
