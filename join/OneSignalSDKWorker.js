// Push notifications (OneSignal). Never block the app if their CDN is unreachable.
try { importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js'); } catch (e) { /* offline or blocked */ }

// App shell kept on the phone: show the saved copy instantly, update it in the background.
const CACHE = 'recruit-16c7bc16';
const SHELL = ['index.html', 'app.css?v=16c7bc16', 'app.js?v=16c7bc16', 'logos.js?v=16c7bc16', 'qr.js?v=16c7bc16', 'config.js?v=16c7bc16',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-180.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.indexOf('recruit-') === 0 && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== self.location.origin) return;  // Google API calls are never cached here
  const nav = r.mode === 'navigate';
  e.respondWith(caches.open(CACHE).then(c => c.match(r, { ignoreSearch: nav }).then(hit => {
    const net = fetch(r).then(res => { if (res && res.ok) c.put(nav ? new URL(r.url).pathname.replace(/^.*\//, '') || 'index.html' : r, res.clone()); return res; })
      .catch(() => hit || caches.match('index.html'));
    return hit || net;
  })));
});
