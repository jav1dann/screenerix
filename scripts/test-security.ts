/**
 * `npm run test:security` — regression checks for the security fixes: post-login redirects stay
 * on our origin (tabs / newlines / backslashes / schemes refused), push subscriptions only reach
 * the browsers' push services (no SSRF to internal hosts), and an account's email only changes
 * after the code sent to the new address is entered (no putting someone else's email on an
 * account). Runs against a throwaway data directory. Exits 1 on any failed check.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'sx-security-'));
process.env.SX_DATA_DIR = dir;
process.env.AUTH_SECRET = 'y'.repeat(40);
delete process.env.RESEND_API_KEY;
delete process.env.PUSH_TEST_HOSTS;

const results: string[] = [];
const check = (name: string, ok: boolean, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
const section = (name: string) => results.push(`\n${name}`);

/** Codes from the development console stand-in for email, by recipient. */
const mailed: Array<{ to: string; code: string }> = [];
const log = console.log;
console.log = (...a: unknown[]) => {
  const s = a.map(String).join(' ');
  const m = /To: (\S+)\n[\s\S]*?\n(\d{6})\n/.exec(s);
  if (m) mailed.push({ to: m[1], code: m[2] });
  else if (!s.startsWith('[auth]')) log(...a);
};

(async () => {
  const { safeNext } = await import('@/lib/auth/access');
  const { isPushEndpoint, addSubscription } = await import('@/lib/push/server');
  const users = await import('@/lib/auth/users');
  const v = await import('@/lib/auth/verification');

  section('Post-login redirect (safeNext)');
  for (const ok of ['/terminal', '/billing?period=year', '/terminal?account=google_linked', '/%09/x']) check(`keeps ${JSON.stringify(ok)}`, safeNext(ok) === ok);
  for (const bad of ['/\t/evil.com', '/\n/evil.com', '/\r/evil.com', '//evil.com', '/\\evil.com', '\\\\evil.com', 'https://evil.com', 'javascript:alert(1)', '/ /evil.com', '/ /x', '/login', '/login?next=//evil.com', `/${'a'.repeat(600)}`, 42]) {
    check(`refuses ${JSON.stringify(bad).slice(0, 40)}`, safeNext(bad) === '/terminal');
  }

  section('Push endpoints (SSRF)');
  for (const ok of ['https://fcm.googleapis.com/fcm/send/abc', 'https://updates.push.services.mozilla.com/wpush/v2/abc', 'https://web.push.apple.com/abc', 'https://wns2-par02p.notify.windows.com/w/?token=abc']) check(`accepts ${new URL(ok).hostname}`, isPushEndpoint(ok));
  for (const bad of ['https://localhost/x', 'https://127.0.0.1/x', 'https://10.0.0.5/x', 'https://169.254.169.254/latest', 'https://internal.corp/x', 'http://fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x', 'https://user:pw@fcm.googleapis.com/x', 'https://fcm.googleapis.com.evil.com/x', 'https://evilnotify.windows.com/x', 'not a url']) {
    check(`refuses ${bad}`, !isPushEndpoint(bad));
  }
  check('addSubscription refuses an internal endpoint', !addSubscription('u1', { endpoint: 'https://localhost:8443/push', keys: { p256dh: 'p', auth: 'a' } }));
  check('addSubscription accepts FCM', addSubscription('u1', { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'p', auth: 'a' } }));
  process.env.PUSH_TEST_HOSTS = 'localhost';
  check('PUSH_TEST_HOSTS allows test hosts outside production', isPushEndpoint('https://localhost:8443/push'));
  (process.env as Record<string, string>).NODE_ENV = 'production';
  check('…but never in production', !isPushEndpoint('https://localhost:8443/push'));
  (process.env as Record<string, string>).NODE_ENV = 'test';
  delete process.env.PUSH_TEST_HOSTS;

  section('Changing the account email');
  let now = Date.now();
  const me = await users.createUser({ email: 'me@test.local', name: 'Me', password: 'me-pass-1234' });
  const s1 = await v.sendEmailChangeCode(me, 'victim@test.local', now);
  const c1 = mailed.at(-1);
  check('the code goes to the NEW address', s1.ok && c1?.to === 'victim@test.local');
  check('the email has not changed yet', users.findById(me.id)!.email === 'me@test.local');
  check('the code is stored only as a hash', !JSON.stringify(users.findById(me.id)).includes(`"${c1!.code}"`));
  const other = await v.sendEmailChangeCode(users.findById(me.id)!, 'third@test.local', now + 10_000);
  check('switching address does not skip the cooldown (no inbox spamming)', !other.ok && other.reason === 'wait');
  const wrong = c1!.code === '000000' ? '111111' : '000000';
  let r = v.checkEmailChangeCode(users.findById(me.id)!, wrong, now);
  check('a wrong code is refused', !r.ok && r.reason === 'invalid' && users.findById(me.id)!.email === 'me@test.local');
  check('an expired code is refused', (() => { const x = v.checkEmailChangeCode(users.findById(me.id)!, c1!.code, now + 11 * 60_000); return !x.ok && x.reason === 'expired'; })());
  // Someone registers that address in the meantime: the code no longer applies.
  const victim = await users.createUser({ email: 'victim@test.local', name: 'V', password: 'victim-pass-1' });
  r = v.checkEmailChangeCode(users.findById(me.id)!, c1!.code, now);
  check('an address taken in the meantime is refused', !r.ok && r.reason === 'taken' && users.findById(me.id)!.email === 'me@test.local');
  void victim;
  now += 61_000;
  await v.sendEmailChangeCode(users.findById(me.id)!, 'new@test.local', now);
  const c2 = mailed.at(-1)!;
  r = v.checkEmailChangeCode(users.findById(me.id)!, c2.code, now);
  check('the right code changes the email', r.ok && users.findById(me.id)!.email === 'new@test.local' && !users.findById(me.id)!.emailChange);
  check('a registration code can’t confirm an email change (separate purpose)', (() => {
    const u = users.findById(me.id)!;
    return !v.checkEmailChangeCode({ ...u, emailChange: { email: 'x@test.local', hash: u.verification?.hash ?? 'AAAA', expiresAt: now + 60_000, attempts: 0, sends: [] } }, c2.code, now).ok;
  })());

  section('Pre-hijack through Google sign-in');
  // The attack this closes: put the victim's address on your account, wait for their Google sign-in.
  const attacker = await users.createUser({ email: 'attacker@test.local', name: 'A', password: 'attacker-pass' });
  await v.sendEmailChangeCode(attacker, 'target@test.local', now);
  const { user: g, created } = users.findOrCreateGoogleUser({ sub: 'google-target', email: 'target@test.local', name: 'Target' });
  check('the victim’s Google sign-in gets their own new account', created && g.id !== attacker.id && users.findById(attacker.id)!.email === 'attacker@test.local');

  rmSync(dir, { recursive: true, force: true });
  console.log = log;
  const failed = results.filter((x) => x.startsWith('FAIL')).length;
  const total = results.filter((x) => /^(PASS|FAIL)/.test(x)).length;
  console.log(results.join('\n'));
  console.log(`\n${total - failed}/${total} checks passed`);
  process.exit(failed ? 1 : 0);
})();
