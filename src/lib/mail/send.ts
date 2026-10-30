/**
 * Transactional email through Resend (https://resend.com) — one HTTPS call, no SDK.
 * `RESEND_API_KEY` sends for real; `MAIL_FROM` is the sender (its domain must be verified in
 * Resend). Unset outside production: the message is printed to the server console instead,
 * so registration works locally. Unset in production: `mailReady()` is false. Server-only.
 */
const ENDPOINT = 'https://api.resend.com/emails';
const TIMEOUT_MS = 15_000;
const DEFAULT_FROM = 'Screenerix <support@screenerix.com>';

export interface Mail { to: string; subject: string; text: string; html: string }

export class MailError extends Error {}

const apiKey = () => process.env.RESEND_API_KEY?.trim() || undefined;
const devConsole = () => !apiKey() && process.env.NODE_ENV !== 'production';

/** Mail can go out: a Resend key, or (outside production) the console stand-in. */
export const mailReady = (): boolean => Boolean(apiKey()) || devConsole();

export async function sendMail(mail: Mail): Promise<void> {
  const key = apiKey();
  if (!key) {
    if (!devConsole()) throw new MailError('RESEND_API_KEY is not set');
    console.log(`[mail] RESEND_API_KEY is not set — not sent (development). To: ${mail.to}\n[mail] ${mail.subject}\n${mail.text}`);
    return;
  }
  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: process.env.MAIL_FROM?.trim() || DEFAULT_FROM, to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html }),
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    const err = e as Error & { cause?: { code?: string } };
    const why = err.name === 'TimeoutError' ? `no answer within ${TIMEOUT_MS} ms` : `${err.name}: ${err.message}${err.cause?.code ? ` (${err.cause.code})` : ''}`;
    console.error(`[mail] Resend unreachable after ${Date.now() - started} ms — ${why}`);
    throw new MailError(`Resend unreachable: ${why}`);
  }
  if (!res.ok) {
    // e.g. 403 {"name":"validation_error","message":"The screenerix.com domain is not verified…"}
    const body = (await res.text().catch(() => '')).slice(0, 1000);
    console.error(`[mail] Resend → HTTP ${res.status} sending "${mail.subject}" to ${mail.to}: ${body || '(empty body)'}`);
    throw new MailError(`Resend → ${res.status}`);
  }
}
