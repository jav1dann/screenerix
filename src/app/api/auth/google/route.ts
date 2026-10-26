/**
 * Google Sign-In, step 1: remember state / nonce / PKCE verifier / destination in a signed,
 * short-lived cookie and send the browser to Google's consent screen.
 * `?mode=link` (signed in only): connect a Google account to the current account instead.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { safeNext } from '@/lib/auth/access';
import { googleAuthUrl, googleConfig, loginErrorUrl, newOAuthState, OAUTH_COOKIE, OAUTH_COOKIE_PATH, OAUTH_TTL_MS, redirectUri } from '@/lib/auth/google';
import { getCurrentUser } from '@/lib/auth/dal';
import { cookieOptions } from '@/lib/auth/session';

export async function GET(req: NextRequest) {
  const next = safeNext(req.nextUrl.searchParams.get('next'));
  const cfg = googleConfig();
  if (!cfg) return NextResponse.redirect(loginErrorUrl(req.nextUrl.origin, 'unavailable', next));
  let link: { uid: string } | undefined;
  if (req.nextUrl.searchParams.get('mode') === 'link') {
    const user = await getCurrentUser();
    if (!user) return NextResponse.redirect(new URL('/login?next=%2Fterminal', req.nextUrl.origin));
    link = { uid: user.id };
  }
  const { data, cookie } = await newOAuthState(link ? '/terminal' : next, Date.now(), link);
  const res = NextResponse.redirect(googleAuthUrl({ clientId: cfg.clientId, redirectUri: redirectUri(req.nextUrl.origin), ...data }));
  // SameSite=Lax: sent on Google's top-level redirect back to the callback, never cross-site otherwise.
  res.cookies.set(OAUTH_COOKIE, cookie, {
    httpOnly: true,
    sameSite: 'lax',
    secure: cookieOptions(new Date()).secure,
    path: OAUTH_COOKIE_PATH,
    maxAge: OAUTH_TTL_MS / 1000,
  });
  res.headers.set('cache-control', 'no-store');
  return res;
}
