/**
 * Google Sign-In, step 2: check the state against the signed cookie, exchange the code
 * (PKCE), verify the id_token claims, find / link / create the account and issue our usual
 * session cookie. Every failure lands on /login with a `google_<code>` error — never Google's
 * raw response.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getCurrentUser, sessionCookie } from '@/lib/auth/dal';
import { appOrigin, exchangeCode, GoogleAuthError, googleConfig, loginErrorUrl, OAUTH_COOKIE, OAUTH_COOKIE_PATH, readOAuthState, redirectUri } from '@/lib/auth/google';
import type { GoogleErrorCode } from '@/lib/auth/google';
import { isThrottled, recordFailure } from '@/lib/auth/throttle';
import { ensureAdmin, findOrCreateGoogleUser, linkGoogle } from '@/lib/auth/users';
import { clientIp } from '@/lib/server/clientIp';

/** Per-IP throttle keys — only behind a trusted proxy (`TRUST_PROXY`, see clientIp.ts). */
function throttleKeys(req: NextRequest): string[] {
  const ip = clientIp(req.headers);
  return ip ? [`google:ip:${ip}`] : [];
}

/** Redirect (no-store) that also drops the one-time OAuth cookie. */
function redirect(url: string): NextResponse {
  const res = NextResponse.redirect(url);
  res.cookies.set(OAUTH_COOKIE, '', { path: OAUTH_COOKIE_PATH, maxAge: 0 });
  res.headers.set('cache-control', 'no-store');
  return res;
}

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const sp = req.nextUrl.searchParams;
  const saved = await readOAuthState(req.cookies.get(OAUTH_COOKIE)?.value);
  const next = saved?.next ?? '/terminal';
  // A failed "connect Google" goes back to the account screen, a failed sign-in to /login.
  // Without the cookie (it expired on a slow consent screen) a signed-in visitor was connecting:
  // /login would just bounce them to the terminal without saying why.
  const linking = saved ? saved.mode === 'link' : Boolean(await getCurrentUser());
  const fail = (code: GoogleErrorCode) => redirect(linking
    ? new URL(`/terminal?account=google_${code}`, appOrigin(origin)).toString()
    : loginErrorUrl(origin, code, next));

  // The user closed the consent screen (or Google refused the request).
  const err = sp.get('error');
  if (err) return fail(err === 'access_denied' ? 'cancelled' : 'failed');
  const cfg = googleConfig();
  if (!cfg) return fail('unavailable');
  // Missing / expired cookie or a state we didn't issue: a stale tab, or a forged callback.
  const code = sp.get('code');
  if (!saved || sp.get('state') !== saved.state || !code || code.length > 2048) return fail('expired');

  const keys = throttleKeys(req);
  if (isThrottled(keys)) return fail('failed');
  let profile;
  try {
    profile = await exchangeCode({ code, verifier: saved.verifier, nonce: saved.nonce, redirectUri: redirectUri(origin), ...cfg });
  } catch (e) {
    const reason = e instanceof GoogleAuthError ? e : new GoogleAuthError('failed', 'unexpected error');
    console.error(`[auth] Google sign-in failed: ${reason.message}`);
    recordFailure(keys);
    return fail(reason.code);
  }

  if (saved.mode === 'link') {
    // Connecting from the account screen: only to the same signed-in account that started it.
    const back = (code: string) => redirect(new URL(`/terminal?account=${code}`, appOrigin(origin)).toString());
    const current = await getCurrentUser();
    if (!current || current.id !== saved.uid) return back('google_session');
    const r = linkGoogle(current.id, profile.sub, profile.picture);
    if (r === 'ok') console.log(`[auth] Google account linked to ${current.email}`);
    return back(r === 'ok' ? 'google_linked' : r === 'taken' ? 'google_in_use' : 'google_session');
  }

  // The admin account exists before a Google sign-in can match (and link to) its email.
  await ensureAdmin();
  const { user, created } = findOrCreateGoogleUser(profile);
  if (created) console.log(`[auth] account created via Google: ${user.email}`);
  const res = redirect(new URL(next, appOrigin(origin)).toString());
  const c = await sessionCookie(user);
  res.cookies.set(c.name, c.value, c.options);
  return res;
}
