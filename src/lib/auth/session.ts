/**
 * Stateless session tokens: `base64url(JSON payload).base64url(HMAC-SHA256)`, signed with
 * `AUTH_SECRET` (or, when unset, a random secret generated once into `.data/auth-secret`).
 * Web Crypto only, so the same code verifies in the proxy and in route handlers / actions.
 * Revocation: the payload carries the user's `sessionVersion`; bumping it (sign-out,
 * password change) invalidates older tokens wherever the user record is checked.
 * Server-only — never import from client components.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Role } from './access';

export const SESSION_COOKIE = 'sx_session';
export const SESSION_TTL_MS = 7 * 24 * 3_600_000;
/** Accounts and the generated secret (`SX_DATA_DIR` overrides, e.g. a mounted volume). */
export const DATA_DIR = process.env.SX_DATA_DIR?.trim() || join(process.cwd(), '.data');

export interface SessionPayload {
  uid: string;
  role: Role;
  /** The user's `sessionVersion` when the token was issued. */
  v: number;
  /** Expiry (ms since epoch). */
  exp: number;
}

let secretCache: string | null = null;

/** The signing secret: `AUTH_SECRET`, else a persisted random one (logged as an error in production). */
export function authSecret(): string {
  if (secretCache) return secretCache;
  const env = process.env.AUTH_SECRET?.trim();
  if (env && env.length >= 32) return (secretCache = env);
  if (env) console.error('[auth] AUTH_SECRET is shorter than 32 characters — using the generated secret instead');
  const file = join(DATA_DIR, 'auth-secret');
  if (existsSync(file)) {
    const s = readFileSync(file, 'utf8').trim();
    if (s.length >= 32) return (secretCache = s);
  }
  if (process.env.NODE_ENV === 'production') console.error('[auth] AUTH_SECRET is not set — generated one in .data/auth-secret; set AUTH_SECRET in production');
  mkdirSync(DATA_DIR, { recursive: true });
  const s = randomBytes(48).toString('base64url');
  writeFileSync(file, s, { mode: 0o600 });
  return (secretCache = s);
}

const enc = new TextEncoder();
const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');
const fromB64url = (s: string) => new Uint8Array(Buffer.from(s, 'base64url'));

const keys = new Map<string, Promise<CryptoKey>>();
function hmacKey(secret: string): Promise<CryptoKey> {
  let k = keys.get(secret);
  if (!k) {
    k = crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
    keys.set(secret, k);
  }
  return k;
}

export async function signSession(p: SessionPayload, secret = authSecret()): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(p)));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(body)));
  return `${body}.${b64url(sig)}`;
}

/**
 * The payload of a valid, unexpired token; null for anything else. The clock is read only
 * after the signature checks out (server components pass `now` after `await io()`).
 */
export async function verifySession(token: string | undefined | null, secret = authSecret(), now?: number): Promise<SessionPayload | null> {
  if (!token || token.length > 2048) return null;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot !== token.lastIndexOf('.')) return null;
  const body = token.slice(0, dot), sig = token.slice(dot + 1);
  try {
    // crypto.subtle.verify compares in constant time.
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), fromB64url(sig), enc.encode(body));
    if (!ok) return null;
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<SessionPayload>;
    if (typeof p.uid !== 'string' || (p.role !== 'admin' && p.role !== 'user') || typeof p.v !== 'number' || typeof p.exp !== 'number') return null;
    if (p.exp <= (now ?? Date.now())) return null;
    return { uid: p.uid, role: p.role, v: p.v, exp: p.exp };
  } catch {
    return null;
  }
}

/**
 * Short-lived signed data that isn't a session (e.g. the OAuth state cookie). Signed with a
 * key derived for this purpose only, so a blob can never pass as a session token.
 */
export async function signBlob(data: unknown, secret = authSecret()): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(data)));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(`${secret}|blob`), enc.encode(body)));
  return `${body}.${b64url(sig)}`;
}

/** The data of a blob signed by `signBlob`, or null (tampered, malformed). */
export async function verifyBlob(token: string | undefined | null, secret = authSecret()): Promise<unknown> {
  if (!token || token.length > 4096) return null;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot !== token.lastIndexOf('.')) return null;
  const body = token.slice(0, dot);
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(`${secret}|blob`), fromB64url(token.slice(dot + 1)), enc.encode(body));
    return ok ? (JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as unknown) : null;
  } catch {
    return null;
  }
}

export const cookieOptions = (expires: Date) => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production' && process.env.AUTH_INSECURE_COOKIE !== '1',
  path: '/',
  expires,
});
