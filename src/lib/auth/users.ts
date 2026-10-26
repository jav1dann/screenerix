/**
 * User accounts in `.data/users.json` (atomic writes; mtime-cached reads, so the proxy and
 * the app — separate bundles — always see the same records). Passwords: scrypt + salt.
 * The admin account is seeded from `ADMIN_EMAIL` / `ADMIN_PASSWORD`, or created with a
 * random password printed once to the server console. Server-only.
 */
import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DAY_MS, proPeriodStart, TRIAL_DAYS } from './access';
import type { Plan, Role, SessionUser } from './access';
import { DATA_DIR } from './session';

export interface TelegramLink {
  /** Telegram user id (= the private chat id with the bot). */
  id: number;
  username?: string;
  firstName?: string;
  linkedAt: number;
}

export interface UserRecord {
  id: string;
  /** Lower-cased, unique. */
  email: string;
  name: string;
  /** Absent on accounts created through Google (no password sign-in until one is set). */
  passHash?: string;
  salt?: string;
  /** Google account id, once the account has signed in with Google. */
  googleSub?: string;
  /** Google profile picture (googleusercontent.com). */
  picture?: string;
  role: Role;
  plan: Plan;
  /** When the account accepted the Terms and Privacy Policy (registration / first Google sign-in). */
  termsAcceptedAt?: number;
  /** End of the free trial (ms): registration + TRIAL_DAYS. */
  trialEndsAt?: number;
  /** End of the paid Pro period (ms); each payment extends it (`grantPro`). */
  proExpiresAt?: number;
  /** Telegram account linked through the bot (alerts are delivered there). */
  telegram?: TelegramLink;
  /** Bumped on sign-out / password change: older session tokens stop working. */
  sessionVersion: number;
  createdAt: number;
}

const FILE = () => join(DATA_DIR, 'users.json');
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LEN = 64;
export const DEFAULT_ADMIN_EMAIL = 'admin@screenerix.local';

let cache: { mtimeMs: number; users: UserRecord[] } | null = null;

function load(): UserRecord[] {
  const f = FILE();
  if (!existsSync(f)) return [];
  const { mtimeMs } = statSync(f);
  if (cache && cache.mtimeMs === mtimeMs) return cache.users;
  try {
    const raw = JSON.parse(readFileSync(f, 'utf8')) as { users?: UserRecord[] };
    const users = Array.isArray(raw.users) ? raw.users : [];
    cache = { mtimeMs, users };
    return startLegacyTrials(users);
  } catch (e) {
    console.error('[auth] users.json is unreadable', e);
    return [];
  }
}

function save(users: UserRecord[]): void {
  mkdirSync(DATA_DIR, { recursive: true });
  const f = FILE();
  const tmp = `${f}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ users }, null, 2), { mode: 0o600 });
  renameSync(tmp, f);
  cache = { mtimeMs: statSync(f).mtimeMs, users };
}

const trialEnd = (now: number) => now + TRIAL_DAYS * DAY_MS;

/**
 * Accounts from before subscriptions (no trial or Pro dates) get a fresh trial once, starting
 * now, rather than being locked out. Never during `next build`.
 */
function startLegacyTrials(users: UserRecord[]): UserRecord[] {
  if (process.env.NEXT_PHASE === 'phase-production-build') return users;
  const legacy = (u: UserRecord) => u.role !== 'admin' && u.trialEndsAt === undefined && u.proExpiresAt === undefined;
  const count = users.filter(legacy).length;
  if (!count) return users;
  const ends = trialEnd(Date.now());
  const next = users.map((u) => (legacy(u) ? { ...u, plan: 'trial' as const, trialEndsAt: ends } : u));
  save(next);
  console.log(`[auth] started a ${TRIAL_DAYS}-day trial for ${count} existing account(s)`);
  return next;
}

export const normEmail = (e: string) => e.trim().toLowerCase();

function hash(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password.normalize('NFKC'), salt, KEY_LEN, SCRYPT, (err, key) => (err ? reject(err) : resolve(key))));
}

export async function hashPassword(password: string): Promise<{ passHash: string; salt: string }> {
  const salt = randomBytes(16).toString('base64url');
  return { passHash: (await hash(password, salt)).toString('base64url'), salt };
}

export async function verifyPassword(user: Pick<UserRecord, 'passHash' | 'salt'>, password: string): Promise<boolean> {
  // Google-only account: no password to match (same cost as a wrong one).
  if (!user.passHash || !user.salt) { await burnPasswordCheck(password); return false; }
  const expected = Buffer.from(user.passHash, 'base64url');
  const got = await hash(password, user.salt);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

/** A dummy hash so unknown emails cost the same time as wrong passwords. */
let dummy: { passHash: string; salt: string } | null = null;
export async function burnPasswordCheck(password: string): Promise<void> {
  dummy ??= await hashPassword(randomBytes(12).toString('hex'));
  await verifyPassword(dummy, password);
}

export function findByEmail(email: string): UserRecord | null {
  const e = normEmail(email);
  return load().find((u) => u.email === e) ?? null;
}

export function findById(id: string): UserRecord | null {
  return load().find((u) => u.id === id) ?? null;
}

/** New accounts start on the free trial (admins: full access, no dates needed). */
export async function createUser(input: { email: string; name: string; password: string; role?: Role; plan?: Plan; termsAcceptedAt?: number }): Promise<UserRecord> {
  const email = normEmail(input.email);
  if (findByEmail(email)) throw new Error('EMAIL_TAKEN');
  const now = Date.now();
  const role = input.role ?? 'user';
  const plan = input.plan ?? (role === 'admin' ? 'pro' : 'trial');
  const user: UserRecord = {
    id: randomUUID(), email, name: input.name.trim().slice(0, 80), ...(await hashPassword(input.password)),
    role, plan, sessionVersion: 1, createdAt: now,
    ...(plan === 'trial' ? { trialEndsAt: trialEnd(now) } : {}),
    ...(input.termsAcceptedAt ? { termsAcceptedAt: input.termsAcceptedAt } : {}),
  };
  save([...load(), user]);
  return user;
}

export function updateUser(id: string, patch: Partial<Omit<UserRecord, 'id' | 'createdAt'>>): UserRecord | null {
  const users = load();
  const i = users.findIndex((u) => u.id === id);
  if (i < 0) return null;
  const next = { ...users[i], ...patch };
  save(users.map((u, k) => (k === i ? next : u)));
  return next;
}

export const findByGoogleSub = (sub: string): UserRecord | null => load().find((u) => u.googleSub === sub) ?? null;
export const findByTelegramId = (id: number): UserRecord | null => load().find((u) => u.telegram?.id === id) ?? null;

/** Connect a Google account to `uid` (from the account screen). 'taken': it already belongs to another account. */
export function linkGoogle(uid: string, sub: string, picture?: string): 'ok' | 'taken' | 'missing' {
  const other = findByGoogleSub(sub);
  if (other && other.id !== uid) return 'taken';
  return updateUser(uid, { googleSub: sub, ...(picture ? { picture } : {}) }) ? 'ok' : 'missing';
}

/** Connect (or, with null, disconnect) a Telegram account; a Telegram account links to one Screenerix account at a time. */
export function setTelegram(uid: string, link: TelegramLink | null): UserRecord | null {
  if (link) {
    const other = findByTelegramId(link.id);
    if (other && other.id !== uid) updateUser(other.id, { telegram: undefined });
  }
  return updateUser(uid, { telegram: link ?? undefined });
}

/** Sign-out everywhere: tokens carrying an older version stop working. */
export function bumpSessionVersion(id: string): void {
  const u = findById(id);
  if (u) updateUser(id, { sessionVersion: u.sessionVersion + 1 });
}

/**
 * The account of a Google sign-in (the email is verified by Google): the one already linked
 * to this Google id, else the account with this email (linked now — same id, role and plan;
 * its password keeps working), else a new account.
 */
export function findOrCreateGoogleUser(p: { sub: string; email: string; name: string; picture?: string }): { user: UserRecord; created: boolean } {
  const linked = load().find((u) => u.googleSub === p.sub);
  if (linked) {
    const picture = p.picture ?? linked.picture;
    const user = picture !== linked.picture ? updateUser(linked.id, { picture }) ?? linked : linked;
    return { user, created: false };
  }
  const byEmail = findByEmail(p.email);
  if (byEmail) {
    const user = updateUser(byEmail.id, { googleSub: p.sub, ...(p.picture ? { picture: p.picture } : {}) }) ?? byEmail;
    console.log(`[auth] linked Google sign-in to ${user.email}`);
    return { user, created: false };
  }
  const user: UserRecord = {
    id: randomUUID(), email: normEmail(p.email), name: p.name.trim().slice(0, 80) || normEmail(p.email).split('@')[0],
    googleSub: p.sub, ...(p.picture ? { picture: p.picture } : {}),
    // The Google button sits under the Terms consent (Register) / notice (Sign in).
    role: 'user', plan: 'trial', sessionVersion: 1, createdAt: Date.now(), termsAcceptedAt: Date.now(), trialEndsAt: trialEnd(Date.now()),
  };
  save([...load(), user]);
  return { user, created: true };
}

/**
 * A paid period: Pro until `max(now, current end) + days`, so a renewal stacks on the time
 * left. Returns the updated record (null: no such account).
 */
export function grantPro(id: string, days: number, now = Date.now()): UserRecord | null {
  const u = findById(id);
  if (!u) return null;
  return updateUser(id, { plan: 'pro', proExpiresAt: proPeriodStart(u, now) + days * DAY_MS });
}

export const toSessionUser = (u: UserRecord): SessionUser => ({
  id: u.id, name: u.name, email: u.email, role: u.role, plan: u.plan, ...(u.picture ? { picture: u.picture } : {}),
  ...(u.trialEndsAt ? { trialEndsAt: u.trialEndsAt } : {}), ...(u.proExpiresAt ? { proExpiresAt: u.proExpiresAt } : {}),
});

let seeding: Promise<void> | null = null;

/**
 * Make sure the admin account exists. `ADMIN_EMAIL` / `ADMIN_PASSWORD` set: create it, or
 * promote that email to admin and sync the password when it changed. Unset (and no admin
 * yet): create `admin@screenerix.local` with a random password, printed once to the console.
 */
export function ensureAdmin(): Promise<void> {
  // Never while `next build` prerenders: a generated password would only land in build logs.
  if (process.env.NEXT_PHASE === 'phase-production-build') return Promise.resolve();
  seeding ??= (async () => {
    const email = process.env.ADMIN_EMAIL?.trim();
    const password = process.env.ADMIN_PASSWORD ?? '';
    if (email) {
      if (password.length < 8) console.error('[auth] ADMIN_PASSWORD must be at least 8 characters — admin password not set from env');
      const existing = findByEmail(email);
      if (!existing) {
        if (password.length >= 8) {
          await createUser({ email, name: process.env.ADMIN_NAME?.trim() || 'Admin', password, role: 'admin', plan: 'pro' });
          console.log(`[auth] admin account created: ${normEmail(email)}`);
        }
        return;
      }
      const patch: Partial<UserRecord> = {};
      if (existing.role !== 'admin') patch.role = 'admin';
      if (existing.plan !== 'pro') patch.plan = 'pro';
      if (password.length >= 8 && !(await verifyPassword(existing, password))) Object.assign(patch, await hashPassword(password), { sessionVersion: existing.sessionVersion + 1 });
      if (Object.keys(patch).length) { updateUser(existing.id, patch); console.log(`[auth] admin account updated: ${existing.email}`); }
      return;
    }
    if (load().some((u) => u.role === 'admin')) return;
    const generated = randomBytes(15).toString('base64url');
    await createUser({ email: DEFAULT_ADMIN_EMAIL, name: 'Admin', password: generated, role: 'admin', plan: 'pro' });
    // Also on disk (owner-only), so the password isn't lost if the console scrolled past it.
    const credFile = join(DATA_DIR, 'admin-credentials.txt');
    writeFileSync(credFile, `email: ${DEFAULT_ADMIN_EMAIL}\npassword: ${generated}\n\nGenerated because ADMIN_EMAIL / ADMIN_PASSWORD were not set.\nSign in, then set them (or change the password) and delete this file.\n`, { mode: 0o600 });
    console.log(`[auth] ADMIN_EMAIL is not set — created admin "${DEFAULT_ADMIN_EMAIL}" with password: ${generated}\n[auth] also saved to ${credFile}; set ADMIN_EMAIL / ADMIN_PASSWORD to choose your own`);
  })().catch((e) => { seeding = null; console.error('[auth] admin seed failed', e); });
  return seeding;
}
