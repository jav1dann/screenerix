/**
 * Browser side of web push: register `/sw.js`, subscribe with the server's VAPID public key
 * and hand the subscription to the account (`subscribePush`).
 */
import { subscribePush, unsubscribePush } from '@/app/actions/alerts';

export const pushSupported = (): boolean =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && typeof Notification !== 'undefined';

const keyBytes = (b64url: string): Uint8Array<ArrayBuffer> => {
  const s = atob(b64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64url.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch {
    return null;
  }
}

/** Ask permission and subscribe this browser; resolves with an error message, or null on success. */
export async function enablePush(publicKey: string): Promise<string | null> {
  if (!pushSupported()) return 'This browser doesn’t support push notifications (on iPhone: add the site to the Home Screen first).';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'Notifications are blocked for this site. Allow them in the browser’s site settings.';
  const reg = await registerServiceWorker();
  if (!reg) return 'Couldn’t start the notification service worker.';
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  const r = await subscribePush(sub.toJSON());
  return r.ok ? null : r.error;
}

export async function disablePush(): Promise<void> {
  const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await unsubscribePush(sub.endpoint).catch(() => {});
  await sub.unsubscribe().catch(() => false);
}

/** Whether this browser currently has a push subscription. */
export async function pushEnabled(): Promise<boolean> {
  if (!pushSupported()) return false;
  const reg = await navigator.serviceWorker.getRegistration();
  return Boolean(await reg?.pushManager.getSubscription());
}
