/**
 * The app's public origin (e.g. https://screenerix.com), for the URLs handed to third parties —
 * the Google redirect URI (must match Google Cloud Console exactly) and the payment webhook — and
 * for redirects after sign-in.
 *
 *   1. `AUTH_URL` when set: always, in production it is required.
 *   2. Otherwise the host the visitor actually used, from the request headers: behind a trusted
 *      reverse proxy (`TRUST_PROXY`, see clientIp.ts) its X-Forwarded-Proto / X-Forwarded-Host,
 *      else the Host header. Local development (http://localhost:3000) works without config.
 *
 * Never `request.nextUrl.origin`: under `next start` that is the server's own listen address
 * (http://localhost:3000), whatever the proxy sends — Google would be told to come back there.
 * Server-only.
 */
import 'server-only';
import { proxyTrust } from './clientIp';

let warned = false;
/** Logged once per process, not on every sign-in. */
function warnOnce(message: string): void {
  if (warned) return;
  warned = true;
  console.error(message);
}

/** `AUTH_URL` as a bare origin ("https://screenerix.com/" → "https://screenerix.com"), or null when unset / invalid. */
export function configuredOrigin(raw = process.env.AUTH_URL): string | null {
  const v = raw?.trim();
  if (!v) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('scheme');
    if (u.pathname !== '/' || u.search || u.hash) warnOnce(`[app] AUTH_URL should be just the origin (e.g. https://screenerix.com) — using ${u.origin}`);
    return u.origin;
  } catch {
    warnOnce('[app] AUTH_URL is not a valid absolute URL (expected e.g. https://screenerix.com) — ignored');
    return null;
  }
}

const HOST_RE = /^[a-z0-9.-]+(:\d{1,5})?$|^\[[0-9a-f:.]+\](:\d{1,5})?$/i;
/** The last value of a possibly comma-separated forwarded header (the one our proxy set). */
const lastOf = (v: string | null) => v?.split(',').map((s) => s.trim()).filter(Boolean).pop() ?? null;

/** The origin the visitor used, from the request headers (see the module comment); null if they don't say. */
export function requestOrigin(headers: Headers): string | null {
  const trusted = proxyTrust().kind !== 'none';
  const host = (trusted ? lastOf(headers.get('x-forwarded-host')) : null) ?? headers.get('host')?.trim() ?? null;
  if (!host || !HOST_RE.test(host)) return null;
  const fwdProto = trusted ? lastOf(headers.get('x-forwarded-proto'))?.toLowerCase() : null;
  const proto = fwdProto === 'https' || fwdProto === 'http' ? fwdProto : 'http';
  return `${proto}://${host.toLowerCase()}`;
}

const isLoopback = (origin: string) => /^https?:\/\/(localhost|127\.\d+\.\d+\.\d+|\[::1\])(:\d+)?$/i.test(origin);

/**
 * The public origin for this request. `fallback` is used only when neither `AUTH_URL` nor the
 * headers give one. In production a missing AUTH_URL is logged, and loudly when what's left is
 * a loopback address (the proxy isn't passing the public host on).
 */
export function publicOrigin(headers: Headers | null, fallback = 'http://localhost:3000'): string {
  const configured = configuredOrigin();
  if (configured) return configured;
  const origin = (headers && requestOrigin(headers)) ?? fallback;
  if (process.env.NODE_ENV === 'production') {
    warnOnce(isLoopback(origin)
      ? `[app] AUTH_URL is not set and the request arrives as ${origin} — Google sign-in would send visitors there. Set AUTH_URL to your public origin (e.g. https://screenerix.com) and restart`
      : '[app] AUTH_URL is not set — using the request host for Google redirects and payment webhooks; set AUTH_URL to your public origin');
  }
  return origin;
}

