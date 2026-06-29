/*
 * SquadHub service worker — web push for the installable PWA.
 * Hand-written (no next-pwa/Serwist). Served at /sw.js → root scope "/".
 * Display-only: it shows pushed notifications and routes clicks; it does NOT
 * cache/intercept requests (the app stays online-first).
 */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// A push arrives only when the server sent one (which it does only while the
// user has no live socket — see server/src/sockets/index.ts), so we always show.
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    payload = {};
  }

  const title = payload.title || 'SquadHub';
  const options = {
    body: payload.body || '',
    tag: payload.tag || undefined,
    renotify: Boolean(payload.tag),
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: payload.url || '/' },
  };

  // Update the Dock/taskbar icon badge from the server-supplied unread count so
  // it stays current even while the app window is closed. (When the window is
  // open the client's useAppBadge hook owns this and re-syncs on focus.)
  const updateBadge = () => {
    const count = typeof payload.unreadCount === 'number' ? payload.unreadCount : null;
    if (count === null || !self.navigator || !self.navigator.setAppBadge) {
      return Promise.resolve();
    }
    const p = count > 0 ? self.navigator.setAppBadge(count) : self.navigator.clearAppBadge();
    return p && p.catch ? p.catch(() => {}) : Promise.resolve();
  };

  event.waitUntil(Promise.all([self.registration.showNotification(title, options), updateBadge()]));
});

// Click → focus an existing SquadHub window (and route it in-app) or open one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of wins) {
        if ('focus' in client) {
          await client.focus();
          if ('navigate' in client) {
            try {
              await client.navigate(url);
            } catch (e) {
              /* cross-scope navigate can throw — ignore, the window is focused */
            }
          }
          return;
        }
      }
      if (self.clients.openWindow) {
        await self.clients.openWindow(url);
      }
    })(),
  );
});
