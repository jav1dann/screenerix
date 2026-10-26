/**
 * Landing language: `/` sends visitors to their language (`/ru`, `/tr`, `/az`) — the one they
 * picked in the switcher (`sx_lang`), else on a first visit the browser's preferred language.
 *
 * Auth guard in front of the terminal and its data APIs. Without a valid session the
 * terminal redirects to /login (with `next`), the APIs answer 401. The /terminal page also
 * checks the session itself (`requireUser`), so this is the first line, not the only one.
 * Signed in but the trial / Pro period has ended: the terminal sends them to /billing, the
 * APIs answer 402.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/auth/session';
import { DEFAULT_LOCALE, isLocale, LANG_COOKIE, localePath, negotiateLocale } from '@/lib/landing/i18n/locales';
import { hasAccess } from '@/lib/auth/access';
import { findById } from '@/lib/auth/users';
import type { UserRecord } from '@/lib/auth/users';

async function sessionUser(req: NextRequest): Promise<UserRecord | null> {
  const p = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!p) return null;
  // Revoked (signed out / password changed) or deleted accounts fail here too.
  const u = findById(p.uid);
  return u && u.sessionVersion === p.v ? u : null;
}

function landingRedirect(req: NextRequest): NextResponse {
  const saved = req.cookies.get(LANG_COOKIE)?.value;
  const locale = isLocale(saved) ? saved : negotiateLocale(req.headers.get('accept-language'));
  if (locale === DEFAULT_LOCALE) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = localePath(locale);
  // Varies by cookie / Accept-Language: never cache the redirect itself.
  return NextResponse.redirect(url, { status: 307, headers: { 'cache-control': 'no-store', vary: 'Cookie, Accept-Language' } });
}

export async function proxy(req: NextRequest) {
  if (req.nextUrl.pathname === '/') return landingRedirect(req);
  const { pathname, search } = req.nextUrl;
  const user = await sessionUser(req);
  if (user && hasAccess(user, Date.now())) return NextResponse.next();
  if (user) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Subscription required' }, { status: 402, headers: { 'cache-control': 'no-store' } });
    }
    return NextResponse.redirect(new URL('/billing?expired=1', req.url));
  }
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: { 'cache-control': 'no-store' } });
  }
  const url = new URL('/login', req.url);
  url.searchParams.set('next', `${pathname}${search}`);
  const res = NextResponse.redirect(url);
  // A stale / tampered cookie would otherwise keep bouncing: drop it.
  if (req.cookies.has(SESSION_COOKIE)) res.cookies.delete(SESSION_COOKIE);
  return res;
}

export const config = {
  matcher: ['/', '/terminal/:path*', '/api/scan/:path*', '/api/market/:path*', '/api/depth/:path*'],
};
