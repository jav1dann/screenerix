/* Screenerix service worker: shows alert notifications pushed by the server (web push) and
   opens the terminal when one is clicked. No caching / offline logic. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data ? event.data.text() : '' }; }
  const title = data.title || 'Screenerix alert';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    tag: data.tag || undefined,
    renotify: Boolean(data.tag),
    icon: '/icons/icon-192.png',
    // PNG: Android doesn't render SVG notification icons; the badge is a white-on-transparent mask.
    badge: '/icons/badge-96.png',
    data: { url: data.url || '/terminal' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/terminal', self.location.origin).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = wins.find((w) => w.url.startsWith(self.location.origin + '/terminal'));
    if (open) return open.focus();
    return self.clients.openWindow(url);
  })());
});
