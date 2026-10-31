/**
 * Google Sign-In: OpenID Connect authorization-code flow with PKCE (S256), `state` and
 * `nonce`. No SDK — two HTTPS calls to Google's documented endpoints.
 *
 *   /api/auth/google           → `sx_oauth` cookie (signed state, nonce, PKCE verifier, next) → Google
 *   /api/auth/google/callback  → state check → code exchange → id_token claims → user → session
 *
 * `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are read server-side only (never NEXT_PUBLIC_).
 * The redirect URI is `${public origin}/api/auth/google/callback` (`publicOrigin`: AUTH_URL, else
 * the host the visitor used) and must be registered on the OAuth client in Google Cloud Console
 * exactly — scheme, host, no trailing slash. Server-only.
 */
import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { signBlob, verifyBlob } from './session';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const ISSUERS: ReadonlySet<string> = new Set(['https://accounts.google.com', 'accounts.google.com']);
const TOKEN_TIMEOUT_MS = 15_000;
/** Clock skew allowed on the id_token's `exp`. */
const SKEW_MS = 60_000;

export const OAUTH_COOKIE = 'sx_oauth';
/** The cookie is only sent to the two Google routes. */
export const OAUTH_COOKIE_PATH = '/api/auth/google';
export const OAUTH_TTL_MS = 10 * 60_000;
export const CALLBACK_PATH = '/api/auth/google/callback';

/** Why a Google sign-in failed — mapped to a friendly message on /login (`?error=google_<code>`). */
export type GoogleErrorCode = 'cancelled' | 'expired' | 'unverified' | 'unavailable' | 'failed';

export class GoogleAuthError extends Error {
  constructor(readonly code: GoogleErrorCode, message: string) {
    super(message);
  }
}

export interface GoogleProfile {
  /** Google's stable account id. */
  sub: string;
  email: string;
  name: string;
  /** Avatar URL (Google's image host only). */
  picture?: string;
}

export function googleConfig(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}
export const googleConfigured = (): boolean => googleConfig() !== null;

const random = (bytes = 32) => randomBytes(bytes).toString('base64url');
/** RFC 7636 S256 code challenge. */
export const pkceChallenge = (verifier: string): string => createHash('sha256').update(verifier).digest('base64url');

/** What the start route remembers for the callback (signed into the `sx_oauth` cookie). */
export interface OAuthState {
  state: string;
  nonce: string;
  verifier: string;
  /** Where to land after sign-in (already passed through `safeNext`). */
  next: string;
  /** Issued at (ms). */
  at: number;
  /** 'link': connect this Google account to the signed-in account `uid` instead of signing in. */
  mode: 'signin' | 'link';
  uid?: string;
}

export async function newOAuthState(next: string, now = Date.now(), link?: { uid: string }): Promise<{ data: OAuthState; cookie: string }> {
  const data: OAuthState = { state: random(), nonce: random(), verifier: random(48), next, at: now, mode: link ? 'link' : 'signin', ...(link ? { uid: link.uid } : {}) };
  return { data, cookie: await signBlob({ k: 'google-oauth', ...data }) };
}

/** The state of a valid, unexpired `sx_oauth` cookie, or null. */
export async function readOAuthState(cookie: string | undefined, now = Date.now()): Promise<OAuthState | null> {
  const raw = (await verifyBlob(cookie)) as Partial<OAuthState & { k: string }> | null;
  if (!raw || raw.k !== 'google-oauth') return null;
  const { state, nonce, verifier, next, at, uid } = raw;
  const mode = raw.mode === 'link' ? 'link' : 'signin';
  if (mode === 'link' && typeof uid !== 'string') return null;
  if (typeof state !== 'string' || typeof nonce !== 'string' || typeof verifier !== 'string' || typeof next !== 'string' || typeof at !== 'number') return null;
  if (now - at > OAUTH_TTL_MS || at > now + SKEW_MS) return null;
  return { state, nonce, verifier, next, at, mode, ...(mode === 'link' ? { uid: uid as string } : {}) };
}

/** The redirect URI registered with Google, for the app's public origin (`publicOrigin`). */
export const redirectUri = (origin: string): string => `${origin}${CALLBACK_PATH}`;

/** Back to /login on the public origin with a `google_<code>` error (and the original destination). */
export function loginErrorUrl(origin: string, code: GoogleErrorCode, next: string): string {
  const u = new URL('/login', origin);
  u.searchParams.set('error', `google_${code}`);
  if (next !== '/terminal') u.searchParams.set('next', next);
  return u.toString();
}

export function googleAuthUrl(p: { clientId: string; redirectUri: string; state: string; nonce: string; verifier: string }): string {
  const u = new URL(AUTH_ENDPOINT);
  u.search = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state: p.state,
    nonce: p.nonce,
    code_challenge: pkceChallenge(p.verifier),
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString();
  return u.toString();
}

/** Google profile images only (an https URL on googleusercontent.com), else dropped. */
function safePicture(v: unknown): string | undefined {
  if (typeof v !== 'string' || v.length > 1024) return undefined;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && (u.hostname === 'googleusercontent.com' || u.hostname.endsWith('.googleusercontent.com')) ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Claims of an id_token received directly from Google's token endpoint over TLS (OIDC
 * Core §3.1.3.7: the TLS server validation stands in for the signature check), checked for
 * issuer, audience, expiry and our nonce. Throws `GoogleAuthError`.
 */
export function claimsFromIdToken(idToken: unknown, opts: { clientId: string; nonce: string; now?: number }): GoogleProfile {
  const now = opts.now ?? Date.now();
  const parts = typeof idToken === 'string' ? idToken.split('.') : [];
  if (parts.length !== 3) throw new GoogleAuthError('failed', 'malformed id_token');
  let c: Record<string, unknown>;
  try {
    c = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new GoogleAuthError('failed', 'unreadable id_token');
  }
  if (typeof c.iss !== 'string' || !ISSUERS.has(c.iss)) throw new GoogleAuthError('failed', 'id_token issuer');
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (!aud.includes(opts.clientId) || (aud.length > 1 && c.azp !== opts.clientId)) throw new GoogleAuthError('failed', 'id_token audience');
  if (typeof c.exp !== 'number' || c.exp * 1000 < now - SKEW_MS) throw new GoogleAuthError('expired', 'id_token expired');
  if (c.nonce !== opts.nonce) throw new GoogleAuthError('expired', 'id_token nonce');
  if (typeof c.sub !== 'string' || !c.sub || typeof c.email !== 'string' || !c.email.includes('@')) throw new GoogleAuthError('failed', 'id_token subject / email');
  if (c.email_verified !== true && c.email_verified !== 'true') throw new GoogleAuthError('unverified', 'email not verified by Google');
  const name = typeof c.name === 'string' && c.name.trim() ? c.name.trim() : c.email.split('@')[0];
  const picture = safePicture(c.picture);
  return { sub: c.sub, email: c.email, name: name.slice(0, 80), ...(picture ? { picture } : {}) };
}

/** Code → tokens (PKCE) → the verified profile. Throws `GoogleAuthError`; never surfaces Google's raw response. */
export async function exchangeCode(p: {
  code: string;
  verifier: string;
  nonce: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
  fetchImpl?: typeof fetch;
  now?: number;
}): Promise<GoogleProfile> {
  const doFetch = p.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: p.code,
        code_verifier: p.verifier,
        redirect_uri: p.redirectUri,
        client_id: p.clientId,
        client_secret: p.clientSecret,
      }).toString(),
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch {
    throw new GoogleAuthError('unavailable', 'token endpoint unreachable');
  }
  const body = (await res.json().catch(() => null)) as { id_token?: unknown; error?: unknown } | null;
  if (!res.ok || !body) {
    const err = typeof body?.error === 'string' ? body.error : `HTTP ${res.status}`;
    // invalid_grant: the code was used, expired or doesn't match the verifier — start over.
    throw new GoogleAuthError(err === 'invalid_grant' ? 'expired' : 'unavailable', `token exchange: ${err}`);
  }
  return claimsFromIdToken(body.id_token, { clientId: p.clientId, nonce: p.nonce, now: p.now });
}
