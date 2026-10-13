// Push notifications (OneSignal). Never block the app if their CDN is unreachable.
try { importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js'); } catch (e) { /* offline or blocked */ }

// Pages (and config) come from the network first, so a new version shows up on the very next open;
// the phone's copy is only used when there's no signal. Versioned files (?v=…) and images are safe to serve from the copy.
const CACHE = 'recruit-d154455d';
const SHELL = ['index.html', 'checkin.html', 'eval.html', 'app.css?v=d154455d', 'app.js?v=d154455d', 'logos.js?v=d154455d', 'qr.js?v=d154455d', 'bulletin.js?v=d154455d',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-180.png',
  'fonts/anton-latin-400-normal.woff2', 'fonts/oswald-latin-500-normal.woff2', 'fonts/oswald-latin-600-normal.woff2', 'fonts/oswald-latin-700-normal.woff2'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.indexOf('recruit-') === 0 && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// The app asks which version this is, so it only reloads when there's actually something new to show.
self.addEventListener('message', e => { if (e.data === 'version' && e.ports && e.ports[0]) e.ports[0].postMessage('d154455d'); });
function pageKey(u) { return u.origin + u.pathname + (u.pathname.slice(-1) === '/' ? 'index.html' : ''); }
self.addEventListener('fetch', e => {
  const r = e.request;
  const u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== self.location.origin) return;  // Google API calls are never touched
  const isPage = r.mode === 'navigate' || /(\.html|\/|config\.js)$/.test(u.pathname);
  if (isPage) {
    const key = pageKey(u);
    const fromCache = () => caches.open(CACHE).then(c => c.match(key)).then(hit => hit || caches.match(self.registration.scope + 'index.html'));
    const net = fetch(u.href, { cache: 'no-cache', credentials: 'same-origin' }).then(res => {
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(key, copy)); }
      return res;
    });
    // Weak signal: don't hang. After 4s use the phone's copy (the network copy still lands for next time).
    const slow = new Promise(resolve => setTimeout(() => fromCache().then(hit => hit && resolve(hit)), 4000));
    e.respondWith(Promise.race([net.catch(fromCache), slow]));
    return;
  }
  e.respondWith(caches.open(CACHE).then(c => c.match(r).then(hit => {
    const fresh = fetch(r).then(res => { if (res && res.ok) c.put(r, res.clone()); return res; }).catch(() => hit);
    return hit || fresh;
  })));
});
