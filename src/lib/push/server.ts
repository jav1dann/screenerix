/**
 * Web Push: browser subscriptions per user in `.data/push-subscriptions.json`, sent with VAPID
 * (`VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT`, server-side env). Subscriptions
 * the push service reports gone (404 / 410) are dropped. Server-only.
 */
import 'server-only';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import webpush from 'web-push';
import { DATA_DIR } from '@/lib/auth/session';

export interface PushSub { userId: string; endpoint: string; keys: { p256dh: string; auth: string }; createdAt: number; ua?: string }

const FILE = () => join(DATA_DIR, 'push-subscriptions.json');
const MAX_PER_USER = 10;
let cache: { mtimeMs: number; subs: PushSub[] } | null = null;

function load(): PushSub[] {
  const f = FILE();
  if (!existsSync(f)) return [];
  const { mtimeMs } = statSync(f);
  if (cache && cache.mtimeMs === mtimeMs) return cache.subs;
  try {
    const raw = JSON.parse(readFileSync(f, 'utf8')) as { subs?: PushSub[] };
    cache = { mtimeMs, subs: Array.isArray(raw.subs) ? raw.subs : [] };
    return cache.subs;
  } catch {
    return [];
  }
}

function save(subs: PushSub[]): void {
  mkdirSync(DATA_DIR, { recursive: true });
  const f = FILE();
  const tmp = `${f}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ subs }), { mode: 0o600 });
  renameSync(tmp, f);
  cache = { mtimeMs: statSync(f).mtimeMs, subs };
}

function vapid(): { publicKey: string; privateKey: string; subject: string } | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject: process.env.VAPID_SUBJECT?.trim() || 'mailto:admin@screenerix.local' };
}

/** The public key the browser subscribes with (null: push isn't configured). */
export const pushPublicKey = (): string | null => vapid()?.publicKey ?? null;

/**
 * The browsers' push services (Chrome / Edge / Opera / Brave: FCM, Firefox: Mozilla, Edge
 * legacy: WNS, Safari: Apple). The server POSTs to a subscription's endpoint whenever an alert
 * fires, so any other host is refused: otherwise an account could aim the server at internal
 * services (SSRF). `PUSH_TEST_HOSTS` (comma-separated, never in production) adds hosts for tests.
 */
const PUSH_HOSTS = ['fcm.googleapis.com', 'android.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'];
const PUSH_HOST_SUFFIXES = ['.push.services.mozilla.com', '.notify.windows.com', '.push.apple.com'];

const testHosts = (): string[] => (process.env.NODE_ENV === 'production' ? [] : (process.env.PUSH_TEST_HOSTS ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean));

/** An endpoint on a known push service: https, default port, no credentials. */
export function isPushEndpoint(v: unknown): v is string {
  if (typeof v !== 'string' || v.length > 2048) return false;
  let u: URL;
  try { u = new URL(v); } catch { return false; }
  if (u.protocol !== 'https:' || u.username || u.password) return false;
  const host = u.hostname.toLowerCase();
  if (testHosts().includes(host)) return true;
  return !u.port && (PUSH_HOSTS.includes(host) || PUSH_HOST_SUFFIXES.some((s) => host.endsWith(s)));
}

/** Store a browser's subscription for `userId` (replacing the same endpoint). */
export function addSubscription(userId: string, raw: unknown, ua?: string): boolean {
  const s = raw as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null;
  const endpoint = s?.endpoint;
  const p256dh = s?.keys?.p256dh, auth = s?.keys?.auth;
  if (!isPushEndpoint(endpoint) || typeof p256dh !== 'string' || typeof auth !== 'string' || p256dh.length > 200 || auth.length > 100) return false;
  const others = load().filter((x) => x.endpoint !== endpoint);
  const mine = others.filter((x) => x.userId === userId).sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_PER_USER - 1);
  save([...others.filter((x) => x.userId !== userId), ...mine, { userId, endpoint, keys: { p256dh, auth }, createdAt: Date.now(), ...(ua ? { ua: ua.slice(0, 200) } : {}) }]);
  return true;
}

export function removeSubscription(userId: string, endpoint: string): void {
  const all = load();
  if (all.some((x) => x.userId === userId && x.endpoint === endpoint)) save(all.filter((x) => !(x.userId === userId && x.endpoint === endpoint)));
}

export const subscriptionCount = (userId: string): number => load().filter((x) => x.userId === userId).length;

/** Send to every browser of `userId`; returns how many accepted it. */
export async function sendPush(userId: string, payload: { title: string; body: string; tag?: string; url?: string }): Promise<number> {
  const keys = vapid();
  // Re-checked here too: subscriptions stored before the allow-list was introduced.
  const subs = load().filter((x) => x.userId === userId && isPushEndpoint(x.endpoint));
  if (!keys || !subs.length) return 0;
  const body = JSON.stringify(payload);
  const gone: string[] = [];
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, body, { vapidDetails: keys, TTL: 600, urgency: 'high', timeout: 10_000 });
      sent++;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) gone.push(s.endpoint);
      else console.error(`[push] send failed (${status ?? 'network'})`);
    }
  }));
  if (gone.length) save(load().filter((x) => !gone.includes(x.endpoint)));
  return sent;
}
