const CACHE = 'studio-square-v105';
const CORE = [
  './',
  './index.html',
  './support.js',
  './pwa.js',
  './legacy.js',
  './gas.js',
  './manifest.webmanifest',
  './logo.png',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-192.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
  './ds/organic-3ba02c43-f29f-4d43-a84d-8827018ee00e/styles.css',
  './ds/organic-3ba02c43-f29f-4d43-a84d-8827018ee00e/ds-bundle.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(CORE.map((u) => c.add(new Request(u, { cache: 'reload' })).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  // Third-party requests (React CDN, Google Fonts) always go to the network:
  // opaque cached responses break script loading on iOS Safari.
  if (new URL(req.url).origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res; })
        .catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req)
        .then((res) => { if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; })
        .catch(() => hit);
      return hit || net;
    })
  );
});

/* ---- "your photos are ready" notice, with the app closed ---------------
   There is no push server behind this app, so the worker checks the shop's
   backend itself: on every start, and — where the browser supports it, i.e.
   an installed app on Android Chrome — on a periodic background sync. The
   watch list is written by the page into the cache, because a worker cannot
   read localStorage. */

const ENDPOINT = 'https://script.google.com/macros/s/AKfycbxgAz_RFMiEQjebRM87C6Bm7L6RnAINVsyC_mM8D-vRoGJ1Q_gq4UPzAnU4ui-PQJNZ5A/exec';
const WATCH_URL = './__ss_watch';

async function readWatch() {
  try {
    const c = await caches.open(CACHE);
    const r = await c.match(WATCH_URL);
    return r ? await r.json() : [];
  } catch (e) { return []; }
}

async function writeWatch(list) {
  try {
    const c = await caches.open(CACHE);
    await c.put(WATCH_URL, new Response(JSON.stringify(list), { headers: { 'Content-Type': 'application/json' } }));
  } catch (e) {}
}

async function checkWatched() {
  const list = await readWatch();
  const open = list.filter((w) => !w.told);
  if (!open.length) return;

  let changed = false;
  for (const w of open) {
    try {
      const u = ENDPOINT + '?action=orderstatus&id=' + encodeURIComponent(w.id) +
                '&phone=' + encodeURIComponent(w.phone);
      const res = await fetch(u, { cache: 'no-store' });
      const data = await res.json();
      if (data && data.ok && data.status === 'gotovo') {
        w.told = true;
        changed = true;
        await self.registration.showNotification('Studio Square', {
          body: w.lang === 'en'
            ? 'Your photos are ready for collection.'
            : 'Vaše fotografije su gotove i spremne za preuzimanje.',
          icon: './icon-192.png',
          badge: './icon-192.png',
          tag: 'ss-' + w.id,
          requireInteraction: true,
          data: { url: './' }
        });
      }
    } catch (e) { /* offline — the next start or sync tries again */ }
  }
  if (changed) await writeWatch(list);
}

self.addEventListener('message', (e) => {
  const d = e.data || {};
  if (d.type === 'ss-watch') e.waitUntil(writeWatch(d.list || []).then(checkWatched));
  if (d.type === 'ss-check') e.waitUntil(checkWatched());
});

self.addEventListener('periodicsync', (e) => {
  if (e.tag === 'ss-orders') e.waitUntil(checkWatched());
});

self.addEventListener('sync', (e) => {
  if (e.tag === 'ss-orders') e.waitUntil(checkWatched());
});

/* A real push, if a push service is ever wired up. */
self.addEventListener('push', (e) => {
  let body = 'Vaše fotografije su gotove i spremne za preuzimanje.';
  try { const d = e.data && e.data.json(); if (d && d.body) body = d.body; } catch (err) {}
  e.waitUntil(self.registration.showNotification('Studio Square', {
    body: body, icon: './icon-192.png', badge: './icon-192.png', requireInteraction: true, data: { url: './' }
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((all) => {
    for (const c of all) if ('focus' in c) return c.focus();
    return clients.openWindow('./');
  }));
});

self.addEventListener('activate', (e) => { e.waitUntil(checkWatched()); });
