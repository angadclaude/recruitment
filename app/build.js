// Builds the installable web app into /join at the repo root from the same src/ files used by Google Apps Script.
// Where it's served from (Vercel / GitHub Pages) is in app/site.json. Usage: node app/build.js [publicBaseUrl]
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SITE = JSON.parse(fs.readFileSync(path.join(__dirname, 'site.json'), 'utf8'));
const BASE = process.argv[2] || SITE.url;
const MOVE = require('./move.js')(BASE, SITE.movedFrom);  // old addresses forward here, logged in
const APP_NAME = 'Juss & Link Recruitment App';  // what people see when the link is shared and under the icon
const SRC = path.join(__dirname, 'src');
const ASSETS = path.join(__dirname, 'assets');
const OUT = path.join(__dirname, '..', 'join');

const read = f => fs.readFileSync(path.join(SRC, f), 'utf8');
const inner = (html, tag) => html.replace(new RegExp('^[\\s\\S]*?<' + tag + '>'), '').replace(new RegExp('</' + tag + '>[\\s\\S]*$'), '');
const write = (f, s) => { fs.mkdirSync(path.dirname(path.join(OUT, f)), { recursive: true }); fs.writeFileSync(path.join(OUT, f), s); };
const copy = (from, to) => { fs.mkdirSync(path.dirname(path.join(OUT, to)), { recursive: true }); fs.copyFileSync(from, path.join(OUT, to)); };

const files = {
  'app.css': inner(read('Styles.html'), 'style'),
  'app.js': inner(read('JS.html'), 'script'),
  'logos.js': inner(read('Logos.html'), 'script'),
  'qr.js': inner(read('QR.html'), 'script'),
  'bulletin.js': inner(read('Bulletin.html'), 'script'),
};
const v = crypto.createHash('sha1').update(Object.values(files).join('')).digest('hex').slice(0, 8);
files['app.js'] = 'window.APP_VERSION = \'' + v + '\';\n' + files['app.js'];
Object.keys(files).forEach(f => write(f, files[f]));

// config.js holds the two settings Angad pastes in. Never overwrite it once it exists.
if (!fs.existsSync(path.join(OUT, 'config.js'))) {
  write('config.js', [
    '// The two settings for the installable app. Edit on GitHub, then wait ~1 minute.',
    'window.APP_CONFIG = {',
    "  API_URL: '',          // Apps Script Web app URL (Deploy → Manage deployments → Web app URL, ends in /exec)",
    "  ONESIGNAL_APP_ID: '', // OneSignal → Settings → Keys & IDs → OneSignal App ID",
    '};',
    '',
  ].join('\n'));
}

function page(opts) {
  const og = opts.og ? [
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${opts.og.title}">`,
    `<meta property="og:description" content="${opts.og.desc}">`,
    `<meta property="og:image" content="${BASE}img/${opts.og.img}">`,
    `<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">`,
    `<meta property="og:url" content="${BASE}${opts.file === 'index.html' ? '' : opts.file}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
  ].join('\n  ') : '';
  const staff = opts.mode === 'staff';
  return `<!DOCTYPE html>
<html lang="en"${opts.theme ? ' class="t-' + opts.theme + '"' : ''}>
<head>
  <meta charset="utf-8">${MOVE ? '\n  ' + MOVE : ''}
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${opts.title}</title>
  <meta name="theme-color" content="${opts.theme === 'JUSS' ? '#0D2833' : '#17171D'}">
  <meta name="color-scheme" content="only light">
  <meta name="robots" content="noindex, nofollow">
  <link rel="icon" href="icons/icon-192.png">
  <link rel="apple-touch-icon" href="icons/icon-180.png">
  ${staff ? '<link rel="manifest" href="manifest.webmanifest">\n  <meta name="apple-mobile-web-app-capable" content="yes">\n  <meta name="apple-mobile-web-app-title" content="' + APP_NAME + '">\n  <meta name="application-name" content="' + APP_NAME + '">' : ''}
  ${og}
  <link rel="preload" href="fonts/anton-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="fonts/oswald-latin-600-normal.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="app.css?v=${v}">
</head>
<body>
  <div id="boot" data-mode="${opts.mode}" data-k="" data-cid=""></div>
  <div id="app"><div class="loading">Loading…</div></div>
  <div id="toast" class="toast" hidden></div>
  <script>(function () { var q = new URLSearchParams(location.search), b = document.getElementById('boot').dataset; b.k = q.get('t') || ''; b.cid = q.get('c') || ''; })();</script>
  <script src="config.js?v=${v}"></script>
  <script src="logos.js?v=${v}"></script>
  ${staff ? `<script src="qr.js?v=${v}"></script>` : ''}
  ${staff ? `<script>
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    if ((window.APP_CONFIG || {}).ONESIGNAL_APP_ID) {
      var s = document.createElement('script'); s.src = 'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js'; s.defer = true;
      s.onerror = function () { window.__osLoadErr = true; }; document.head.appendChild(s);
    }
  </script>` : ''}
  ${staff ? `<script src="bulletin.js?v=${v}"></script>` : ''}
  <script src="app.js?v=${v}"></script>
</body>
</html>
`;
}

const pages = [
  { file: 'index.html', mode: 'staff', title: APP_NAME,
    og: { title: APP_NAME, desc: 'Bookers, presenters & admins: log in with your work email.', img: 'og-app.jpg' } },
  { file: 'checkin.html', mode: 'checkin', title: 'Check in · Juss & Link' },
  { file: 'eval.html', mode: 'eval', title: 'Your evaluation · Juss & Link' },
  { file: 'welcome-link.html', mode: 'welcome', theme: 'LINK', title: "You're in! · LINK Marketing BA Academy",
    og: { title: "You're IN 🎉 LINK Marketing BA Academy", desc: 'Your Week 1 game plan + confirm your spot', img: 'og-link.jpg' } },
  { file: 'welcome-juss.html', mode: 'welcome', theme: 'JUSS', title: "You're in! · JUSS Marketing BA Academy",
    og: { title: "You're IN 🎉 JUSS Marketing BA Academy", desc: 'Your Week 1 game plan + confirm your spot', img: 'og-juss.jpg' } },
  // The link in the booking confirmation: their day, where, and CONFIRM (Angad, 23 Oct)
  { file: 'booked.html', mode: 'booked', theme: 'JUSS', title: "You're booked in · JUSS Marketing" },
];
pages.forEach(p => write(p.file, page(p)));

write('manifest.webmanifest', JSON.stringify({
  name: APP_NAME, short_name: APP_NAME,
  start_url: './index.html', scope: './', display: 'standalone',
  background_color: '#F4F2EF', theme_color: '#17171D',  // the top bar is dark (the stage)
  icons: [
    { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  ],
}, null, 2));
// One service worker does both jobs: OneSignal push + keeping the app on the phone so it opens
// instantly (even with no signal). OneSignal expects this exact filename in this folder.
write('OneSignalSDKWorker.js', `// Push notifications (OneSignal). Never block the app if their CDN is unreachable.
try { importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js'); } catch (e) { /* offline or blocked */ }

// Pages (and config) come from the network first, so a new version shows up on the very next open;
// the phone's copy is only used when there's no signal. Versioned files (?v=…) and images are safe to serve from the copy.
const CACHE = 'recruit-${v}';
const SHELL = ['index.html', 'checkin.html', 'eval.html', 'app.css?v=${v}', 'app.js?v=${v}', 'logos.js?v=${v}', 'qr.js?v=${v}', 'bulletin.js?v=${v}',
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
self.addEventListener('message', e => { if (e.data === 'version' && e.ports && e.ports[0]) e.ports[0].postMessage('${v}'); });
function pageKey(u) { return u.origin + u.pathname + (u.pathname.slice(-1) === '/' ? 'index.html' : ''); }
self.addEventListener('fetch', e => {
  const r = e.request;
  const u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== self.location.origin) return;  // Google API calls are never touched
  const isPage = r.mode === 'navigate' || /(\\.html|\\/|config\\.js)$/.test(u.pathname);
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
`);

['icon-180.png', 'icon-192.png', 'icon-512.png'].forEach(f => copy(path.join(ASSETS, f), 'icons/' + f));
['poster-link.jpg', 'poster-juss.jpg', 'og-link.jpg', 'og-juss.jpg', 'og-app.jpg', 'logo-juss.png', 'logo-link.png'].forEach(f => copy(path.join(ASSETS, f), 'img/' + f));
// The face finder's cascade for the new starters poster (MIT, see img/face-LICENSE.txt)
copy(path.join(ASSETS, 'face', 'facefinder.bin'), 'img/facefinder.bin');
copy(path.join(ASSETS, 'face', 'LICENSE.txt'), 'img/face-LICENSE.txt');
// App + bulletin fonts (Oswald, Anton, Roboto and Arimo, SIL Open Font License, see fonts/OFL.txt)
fs.readdirSync(path.join(ASSETS, 'fonts')).forEach(f => copy(path.join(ASSETS, 'fonts', f), 'fonts/' + f));

console.log('Built ' + OUT + ' (v' + v + ') for ' + BASE);
// The Google code builds the links people get (welcome links, alert taps, slide QR codes) from its own PUBLIC_URL
const gsUrl = (/PUBLIC_URL:\s*'([^']*)'/.exec(read('Code.gs')) || [])[1];
if (!process.argv[2] && gsUrl !== BASE) console.warn('⚠️  Code.gs PUBLIC_URL is ' + gsUrl + ' but the app is at ' + BASE + ': change it, then paste Code.gs into Apps Script and deploy a New version.');
