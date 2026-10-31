/**
 * `npm run test:security` — regression checks for the security fixes: post-login redirects stay
 * on our origin (tabs / newlines / backslashes / schemes refused), push subscriptions only reach
 * the browsers' push services (no SSRF to internal hosts), and an account's email only changes
 * after the code sent to the new address is entered (no putting someone else's email on an
 * account), the client IP for rate limits comes from the trusted proxy's end of X-Forwarded-For
 * (a client can't fake it), throttle limits per kind, the admin account only ever comes from
 * ADMIN_EMAIL / ADMIN_PASSWORD (no generated password in logs or files), and `server-only`
 * modules refuse to load outside the server. Runs against a throwaway data directory.
 * Exits 1 on any failed check.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

  section('Client IP for rate limits (TRUST_PROXY)');
  const { clientIp, proxyTrust } = await import('@/lib/server/clientIp');
  const h = (o: Record<string, string>) => new Headers(o);
  const quiet = console.error; console.error = () => {};
  check('no TRUST_PROXY: X-Forwarded-For ignored', clientIp(h({ 'x-forwarded-for': '1.2.3.4' }), proxyTrust('')) === null);
  check('TRUST_PROXY=1: the address our proxy appended (rightmost)', clientIp(h({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9' }), proxyTrust('1')) === '203.0.113.9');
  check('…a client-sent fake on the left is never used', clientIp(h({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2, 203.0.113.9' }), proxyTrust('1')) === '203.0.113.9');
  check('TRUST_PROXY=2: CDN → nginx chain', clientIp(h({ 'x-forwarded-for': '6.6.6.6, 198.51.100.7, 10.0.0.2' }), proxyTrust('2')) === '198.51.100.7');
  check('TRUST_PROXY=true means one proxy', proxyTrust('true').kind === 'hops');
  check('TRUST_PROXY=cloudflare: CF-Connecting-IP', clientIp(h({ 'cf-connecting-ip': '198.51.100.20', 'x-forwarded-for': '6.6.6.6' }), proxyTrust('cloudflare')) === '198.51.100.20');
  check('missing header behind a proxy → no IP (logged)', clientIp(h({}), proxyTrust('1')) === null);
  check('garbage in the header → no IP', clientIp(h({ 'x-forwarded-for': 'not-an-ip' }), proxyTrust('1')) === null);
  check('"ip:port" form accepted', clientIp(h({ 'x-forwarded-for': '203.0.113.9:51234' }), proxyTrust('1')) === '203.0.113.9');
  check('IPv6 grouped by /64 (no dodging by rotating addresses)', clientIp(h({ 'x-forwarded-for': '2001:db8:1:2:aaaa::1' }), proxyTrust('1')) === clientIp(h({ 'x-forwarded-for': '2001:db8:1:2:ffff:1:2:3' }), proxyTrust('1')) && clientIp(h({ 'x-forwarded-for': '2001:db8:1:2::9' }), proxyTrust('1')) === '2001:db8:1:2::/64');
  console.error = quiet;

  section('Public origin for Google OAuth (AUTH_URL / proxy headers)');
  const o = await import('@/lib/server/origin');
  const saveEnv = { AUTH_URL: process.env.AUTH_URL, TRUST_PROXY: process.env.TRUST_PROXY, NODE_ENV: process.env.NODE_ENV };
  const env = process.env as Record<string, string | undefined>;
  console.error = () => {};
  env.AUTH_URL = 'https://screenerix.com/';
  check('AUTH_URL wins (trailing slash dropped)', o.publicOrigin(h({ host: 'localhost:3000' })) === 'https://screenerix.com');
  check('…and the Google redirect URI matches the console exactly', (await import('@/lib/auth/google')).redirectUri(o.publicOrigin(h({}))) === 'https://screenerix.com/api/auth/google/callback');
  check('AUTH_URL with a path → its origin', o.configuredOrigin('https://screenerix.com/app') === 'https://screenerix.com');
  check('AUTH_URL without a scheme is refused (not turned into a broken URL)', o.configuredOrigin('screenerix.com') === null && o.configuredOrigin('ftp://x.com') === null);
  delete env.AUTH_URL; delete env.TRUST_PROXY;
  check('no AUTH_URL, no proxy: the Host the browser used (local dev)', o.publicOrigin(h({ host: 'localhost:3000' })) === 'http://localhost:3000');
  check('…X-Forwarded-Host / -Proto ignored without TRUST_PROXY (a client could forge them)', o.publicOrigin(h({ host: 'localhost:3000', 'x-forwarded-host': 'evil.com', 'x-forwarded-proto': 'https' })) === 'http://localhost:3000');
  env.TRUST_PROXY = '1';
  check('TRUST_PROXY: X-Forwarded-Proto / -Host from the proxy (nginx default Host: localhost:3000)', o.publicOrigin(h({ host: 'localhost:3000', 'x-forwarded-host': 'screenerix.com', 'x-forwarded-proto': 'https' })) === 'https://screenerix.com');
  check('TRUST_PROXY: proxy passing Host $host', o.publicOrigin(h({ host: 'screenerix.com', 'x-forwarded-proto': 'https' })) === 'https://screenerix.com');
  check('a malformed host is refused (fallback)', o.publicOrigin(h({ host: 'bad host/../x' }), 'http://fallback:1') === 'http://fallback:1');
  env.AUTH_URL = 'https://screenerix.com';
  check('AUTH_URL still wins over proxy headers', o.publicOrigin(h({ host: 'localhost:3000', 'x-forwarded-host': 'other.example', 'x-forwarded-proto': 'http' })) === 'https://screenerix.com');
  // The code exchange (callback) must send Google the very same redirect_uri as the start route.
  env.AUTH_URL = 'https://screenerix.com';
  const gauth = await import('@/lib/auth/google');
  const startUri = new URL(gauth.googleAuthUrl({ clientId: 'cid', redirectUri: gauth.redirectUri(o.publicOrigin(h({ host: 'localhost:3000' }))), state: 's', nonce: 'n', verifier: 'v' })).searchParams.get('redirect_uri');
  let sentUri: string | null = null;
  const idToken = ['e30', Buffer.from(JSON.stringify({ iss: 'https://accounts.google.com', aud: 'cid', exp: Math.floor(Date.now() / 1000) + 600, nonce: 'n', sub: 'g-1', email: 'u@test.local', email_verified: true, name: 'U' })).toString('base64url'), 'sig'].join('.');
  const profile = await gauth.exchangeCode({
    code: 'c', verifier: 'v', nonce: 'n', clientId: 'cid', clientSecret: 'secret',
    redirectUri: gauth.redirectUri(o.publicOrigin(h({ host: 'localhost:3000', 'x-forwarded-proto': 'https' }))),
    fetchImpl: (async (_url: string, init: RequestInit) => { sentUri = new URLSearchParams(String(init.body)).get('redirect_uri'); return new Response(JSON.stringify({ id_token: idToken }), { status: 200 }); }) as typeof fetch,
  });
  check('start and code exchange send Google the identical redirect_uri', startUri === 'https://screenerix.com/api/auth/google/callback' && sentUri === startUri, `${startUri} / ${sentUri}`);
  check('…and the verified Google identity comes back', profile.sub === 'g-1' && profile.email === 'u@test.local');
  for (const [k, v] of Object.entries(saveEnv)) { if (v === undefined) delete env[k]; else env[k] = v; }
  console.error = quiet;

  section('Throttle limits');
  const th = await import('@/lib/auth/throttle');
  const t0 = Date.now();
  const burn = (key: string, n: number) => { for (let i = 0; i < n; i++) th.recordFailure([key], t0); };
  burn('e:a@test.local', 4);
  check('email: 4 failures still allowed', !th.isThrottled(['e:a@test.local'], t0));
  burn('e:a@test.local', 1);
  check('email: blocked at 5', th.isThrottled(['e:a@test.local'], t0));
  check('email: free again after 5 minutes', !th.isThrottled(['e:a@test.local'], t0 + 5 * 60_000 + 1));
  burn('ip:203.0.113.9', 19);
  check('IP: 19 failures (across emails) still allowed — shared networks', !th.isThrottled(['ip:203.0.113.9'], t0));
  burn('ip:203.0.113.9', 1);
  check('IP: blocked at 20 — no guessing one password across many emails', th.isThrottled(['e:other@test.local', 'ip:203.0.113.9'], t0));
  burn('reg:ip:203.0.113.9', 5);
  check('sign-ups per IP: blocked at 5', th.isThrottled(['reg:ip:203.0.113.9'], t0));
  check('…for 15 minutes', th.isThrottled(['reg:ip:203.0.113.9'], t0 + 14 * 60_000) && !th.isThrottled(['reg:ip:203.0.113.9'], t0 + 15 * 60_000 + 1));
  th.clearFailures(['e:a@test.local']);
  check('clearing an email leaves the IP count alone', th.isThrottled(['ip:203.0.113.9'], t0));

  section('Admin account (ADMIN_EMAIL / ADMIN_PASSWORD only)');
  const tsx = join(process.cwd(), 'node_modules', '.bin', 'tsx');
  const seed = (dataDir: string, env: Record<string, string | undefined>) => {
    const r = spawnSync(tsx, ['--tsconfig', 'tsconfig.json', '--require', './scripts/server-env.cjs', 'scripts/admin-seed-harness.ts'], {
      env: { ...process.env, NODE_ENV: 'production', SX_DATA_DIR: dataDir, AUTH_SECRET: 'z'.repeat(40), ADMIN_EMAIL: '', ADMIN_PASSWORD: '', ...env }, encoding: 'utf8',
    });
    const out = `${r.stdout}\n${r.stderr}`;
    const last = r.stdout.trim().split('\n').pop() ?? '{}';
    return { out, admins: (JSON.parse(last) as { admins: Array<{ email: string; sessionVersion: number; passwordMatches?: boolean }> }).admins };
  };
  const d1 = mkdtempSync(join(tmpdir(), 'sx-admin-'));
  const none = seed(d1, {});
  check('unset: no admin is created', none.admins.length === 0);
  check('unset: the log says what to set', none.out.includes('set ADMIN_EMAIL and ADMIN_PASSWORD'));
  check('unset: no credentials file', !existsSync(join(d1, 'admin-credentials.txt')));
  check('unset: no password in the log', !/password:/i.test(none.out));
  const pw1 = 'Correct-Horse-91';
  const made = seed(d1, { ADMIN_EMAIL: 'Owner@Test.local', ADMIN_PASSWORD: pw1, CHECK_PASSWORD: pw1 });
  check('set: admin created from env', made.admins.length === 1 && made.admins[0].email === 'owner@test.local' && made.admins[0].passwordMatches === true);
  check('set: the password is not in the log', !made.out.includes(pw1));
  const pw2 = 'Battery-Staple-77';
  const changed = seed(d1, { ADMIN_EMAIL: 'owner@test.local', ADMIN_PASSWORD: pw2, CHECK_PASSWORD: pw2 });
  check('a new ADMIN_PASSWORD replaces the old one and signs the admin out', changed.admins[0].passwordMatches === true && changed.admins[0].sessionVersion === made.admins[0].sessionVersion + 1);
  check('…and is not logged either', !changed.out.includes(pw2));
  const short = seed(d1, { ADMIN_EMAIL: 'owner@test.local', ADMIN_PASSWORD: 'short', CHECK_PASSWORD: pw2 });
  check('a too-short ADMIN_PASSWORD is refused (old one kept)', short.admins[0].passwordMatches === true && short.out.includes('at least 8 characters'));
  const d2 = mkdtempSync(join(tmpdir(), 'sx-admin-'));
  mkdirSync(d2, { recursive: true });
  writeFileSync(join(d2, 'admin-credentials.txt'), 'email: admin@screenerix.local\npassword: legacy-secret-123\n');
  const legacy = seed(d2, {});
  check('a legacy plaintext credentials file is deleted at start', !existsSync(join(d2, 'admin-credentials.txt')) && legacy.out.includes('deleted'));
  check('…without printing what it held', !legacy.out.includes('legacy-secret-123'));
  rmSync(d1, { recursive: true, force: true }); rmSync(d2, { recursive: true, force: true });

  section('server-only modules');
  for (const mod of ['src/lib/auth/session.ts', 'src/lib/billing/nowpayments.ts', 'src/lib/mail/send.ts', 'src/lib/auth/users.ts']) {
    const plain = spawnSync(tsx, ['--tsconfig', 'tsconfig.json', mod], { encoding: 'utf8', env: { ...process.env, SX_DATA_DIR: dir } });
    check(`${mod} refuses to load outside the server`, plain.status !== 0 && /cannot be imported from a Client Component/.test(plain.stderr));
  }

  rmSync(dir, { recursive: true, force: true });
  console.log = log;
  const failed = results.filter((x) => x.startsWith('FAIL')).length;
  const total = results.filter((x) => /^(PASS|FAIL)/.test(x)).length;
  console.log(results.join('\n'));
  console.log(`\n${total - failed}/${total} checks passed`);
  process.exit(failed ? 1 : 0);
})();
