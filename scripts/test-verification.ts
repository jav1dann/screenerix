/**
 * `npm run test:verification` — email verification on registration, against a throwaway data
 * directory: pending accounts get no trial, codes are 6 digits stored only as a hash, expire
 * after 10 minutes, lock after 5 wrong guesses, resend respects the 1-minute cooldown and the
 * hourly cap, a sign-up in progress can't be taken over, Google sign-in verifies (dropping the
 * unconfirmed password), and the Resend request / failure path. Exits 1 on any failed check.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'sx-verify-'));
process.env.SX_DATA_DIR = dir;
process.env.AUTH_SECRET = 'x'.repeat(40);
delete process.env.RESEND_API_KEY;

const results: string[] = [];
const check = (name: string, ok: boolean, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
const section = (name: string) => results.push(`\n${name}`);

/** The code from the development console stand-in for email. */
const sent: string[] = [];
const log = console.log;
console.log = (...a: unknown[]) => { const m = /\n(\d{6})\n/.exec(a.map(String).join(' ')); if (m) sent.push(m[1]); else if (!String(a[0]).startsWith('[auth]')) log(...a); };

(async () => {
  const users = await import('@/lib/auth/users');
  const v = await import('@/lib/auth/verification');
  const { DAY_MS, TRIAL_DAYS } = await import('@/lib/auth/access');
  const MIN = 60_000;
  let now = Date.now();

  section('Registration');
  let u = await users.createUser({ email: 'New@Test.local', name: 'New', password: 'new-pass-1', termsAcceptedAt: now, pendingVerification: true });
  check('pending account: emailVerified false, no trial yet', u.emailVerified === false && u.trialEndsAt === undefined);
  // A fresh read from disk (another process) must not start a "legacy" trial for it.
  const file = join(dir, 'users.json');
  writeFileSync(file, readFileSync(file, 'utf8'));
  await new Promise((r) => setTimeout(r, 20));
  writeFileSync(file, readFileSync(file, 'utf8') + ' ');
  check('re-reading users.json leaves its trial unstarted', users.findById(u.id)?.trialEndsAt === undefined);

  section('Sending a code');
  const s1 = await v.sendVerificationCode(u, 'ru', now);
  const code1 = sent.at(-1)!;
  u = users.findById(u.id)!;
  check('a 6-digit code is sent', s1.ok && /^\d{6}$/.test(code1), code1);
  check('only its hash is stored', !!u.verification && !JSON.stringify(u).includes(`"${code1}"`) && u.verification.hash.length > 20);
  check('it expires in 10 minutes', u.verification!.expiresAt === now + 10 * MIN);
  const s2 = await v.sendVerificationCode(u, 'en', now + 30_000);
  check('resend within the minute: wait, nothing sent', !s2.ok && s2.reason === 'wait' && s2.resendIn === 30_000 && sent.length === 1);

  section('Checking codes');
  const wrong = code1 === '000000' ? '111111' : '000000';
  let r = v.checkVerificationCode(users.findById(u.id)!, wrong, now);
  check('wrong code: invalid, 4 attempts left', !r.ok && r.reason === 'invalid' && r.attemptsLeft === 4);
  check('garbage: invalid', !v.checkVerificationCode(users.findById(u.id)!, '12ab', now).ok);
  for (let i = 0; i < 3; i++) r = v.checkVerificationCode(users.findById(u.id)!, wrong, now);
  check('5th wrong guess locks the code', !r.ok && r.reason === 'locked');
  r = v.checkVerificationCode(users.findById(u.id)!, code1, now);
  check('the right code is refused once locked', !r.ok && r.reason === 'locked');

  now += 61_000;
  await v.sendVerificationCode(users.findById(u.id)!, 'en', now);
  const code2 = sent.at(-1)!;
  check('after the cooldown a new code is sent', sent.length === 2 && users.findById(u.id)!.verification!.attempts === 0);
  if (code1 !== code2) check('the old code no longer works', !v.checkVerificationCode(users.findById(u.id)!, code1, now).ok);
  check('code expired after 10 minutes', (() => { const x = v.checkVerificationCode(users.findById(u.id)!, code2, now + 10 * MIN + 1); return !x.ok && x.reason === 'expired'; })());
  r = v.checkVerificationCode(users.findById(u.id)!, ` ${code2.slice(0, 3)} ${code2.slice(3)} `, now);
  u = users.findById(u.id)!;
  check('right code (spaces ignored) verifies the account', r.ok && u.emailVerified === true && u.emailVerifiedAt === now && !u.verification);
  check(`…and starts the ${TRIAL_DAYS}-day trial then`, u.plan === 'trial' && u.trialEndsAt === now + TRIAL_DAYS * DAY_MS);
  check('a verified account takes no more codes', !v.checkVerificationCode(u, code2, now).ok);

  section('Resend limits');
  let p = await users.createUser({ email: 'spam@test.local', name: 'S', password: 'spam-pass-1', pendingVerification: true });
  let t = now;
  for (let i = 0; i < 5; i++) { await v.sendVerificationCode(users.findById(p.id)!, 'en', t); t += 61_000; }
  p = users.findById(p.id)!;
  const capped = await v.sendVerificationCode(p, 'en', t);
  check('at most 5 codes an hour', !capped.ok && capped.reason === 'wait' && capped.resendIn > 50 * MIN, `wait ${Math.round((capped.ok ? 0 : capped.resendIn) / MIN)} min`);
  check('…then sending works again', (await v.sendVerificationCode(users.findById(p.id)!, 'en', now + 61 * MIN)).ok);

  section('Taking over a pending sign-up');
  const q = users.findById(p.id)!;
  check('not while its code is valid', !v.canReplacePending(q, now + 61 * MIN + 5 * MIN));
  check('once it has expired', v.canReplacePending(q, now + 61 * MIN + 11 * MIN));
  const replaced = await users.replacePendingUser(q.id, { name: 'Real Owner', password: 'owner-pass-1', termsAcceptedAt: now });
  check('replacing sets the new password and clears the old code', !!replaced && !replaced.verification && await users.verifyPassword(replaced, 'owner-pass-1') && !(await users.verifyPassword(replaced, 'spam-pass-1')));

  section('Google sign-in');
  const g0 = await users.createUser({ email: 'g@test.local', name: 'G', password: 'squatter-pass', pendingVerification: true });
  const { user: g, created } = users.findOrCreateGoogleUser({ sub: 'google-1', email: 'g@test.local', name: 'G' });
  check('verifies a pending account with that email', !created && g.id === g0.id && g.emailVerified === true && !!g.trialEndsAt);
  check('…and drops its unconfirmed password', !g.passHash && !(await users.verifyPassword(g, 'squatter-pass')));
  const legacy = await users.createUser({ email: 'old@test.local', name: 'O', password: 'old-pass-1' });
  check('accounts created without verification stay active', legacy.emailVerified === undefined && !users.isPendingVerification(legacy) && !!legacy.trialEndsAt);

  section('Resend (email provider)');
  process.env.RESEND_API_KEY = 're_test';
  process.env.MAIL_FROM = 'Screenerix <support@screenerix.com>';
  const realFetch = globalThis.fetch;
  let req: { url: string; auth: string | null; body: Record<string, unknown> } | null = null;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    req = { url, auth: new Headers(init.headers).get('authorization'), body: JSON.parse(String(init.body)) };
    return new Response('{"id":"e1"}', { status: 200 });
  }) as typeof fetch;
  const m = await users.createUser({ email: 'mail@test.local', name: 'M', password: 'mail-pass-1', pendingVerification: true });
  const ok = await v.sendVerificationCode(m, 'az', now);
  const body = req!.body as { from: string; to: string[]; subject: string; text: string; html: string };
  check('posts to api.resend.com with the bearer key', ok.ok && req!.url === 'https://api.resend.com/emails' && req!.auth === 'Bearer re_test');
  check('from MAIL_FROM to the account, in its language', body.from === 'Screenerix <support@screenerix.com>' && body.to[0] === 'mail@test.local' && body.subject.startsWith('Screenerix təsdiq kodunuz: '), body.subject);
  const mailed = /(\d{6})$/.exec(body.subject)![1];
  check('the emailed code verifies', v.checkVerificationCode(users.findById(m.id)!, mailed, now).ok && body.text.includes(mailed) && body.html.includes(mailed));
  globalThis.fetch = (async () => new Response('{"name":"validation_error","message":"domain is not verified"}', { status: 403 })) as typeof fetch;
  const errs: string[] = [];
  const err = console.error;
  console.error = (...a: unknown[]) => { errs.push(a.map(String).join(' ')); };
  const f = await users.createUser({ email: 'fail@test.local', name: 'F', password: 'fail-pass-1', pendingVerification: true });
  const failed = await v.sendVerificationCode(f, 'en', now);
  console.error = err;
  globalThis.fetch = realFetch;
  check('a refused send fails without storing a code or a cooldown', !failed.ok && failed.reason === 'mail' && !users.findById(f.id)!.verification);
  check('…and logs Resend’s answer', errs.some((e) => e.includes('HTTP 403') && e.includes('domain is not verified')), errs[0]);

  rmSync(dir, { recursive: true, force: true });
  console.log = log;
  const failedChecks = results.filter((x) => x.startsWith('FAIL')).length;
  const total = results.filter((x) => /^(PASS|FAIL)/.test(x)).length;
  console.log(results.join('\n'));
  console.log(`\n${total - failedChecks}/${total} checks passed`);
  process.exit(failedChecks ? 1 : 0);
})();
