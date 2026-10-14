// How fast does the staff app move between pages? Times every tap the way a phone feels it, with Google's
// real ~1.5 s response time switched on. Prints a table; exits non-zero if a page that should be instant isn't.
// Usage: node app/build.js && node app/dev/speed.js [video-folder]
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 8790, BASE = 'http://localhost:' + PORT, APP = BASE + '/join/';
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const LATENCY = 1500;
const INSTANT = 150;  // ms: anything quicker feels instant on a phone

const server = spawn(process.execPath, [path.join(__dirname, 'server.js'), String(PORT)], { stdio: ['ignore', 'pipe', 'inherit'] });
const ready = new Promise(r => server.stdout.on('data', d => { if (/dev server/.test(String(d))) r(); }));
process.on('exit', () => server.kill());

const post = (p, b) => fetch(BASE + p, { method: 'POST', body: JSON.stringify(b) }).then(r => r.json());
const getJson = p => fetch(BASE + p).then(r => r.json());
async function api(token, action, payload) {
  const r = await post('/api', Object.assign({ action, token }, payload || {}));
  if (!r.ok) throw new Error(action + ': ' + r.error);
  return r.data;
}
const code = async email => (await getJson('/dev/mail')).filter(x => x.to === email && /login code/.test(x.subject)).pop().subject.match(/(\d{6})/)[1];

/** Tap `sel`; ms until the page shows real content (no skeleton), and until it has stopped moving (animations done). */
async function tap(page, sel) {
  await page.evaluate(() => {
    window.__t0 = 0; window.__ready = 0; window.__still = 0;
    document.addEventListener('click', () => { window.__t0 = performance.now(); }, { capture: true, once: true });
  });
  await page.click(sel);
  await page.waitForFunction(() => {
    const p = document.getElementById('page');
    if (!window.__t0 || !p) return false;
    const real = !p.querySelector('.sk') && p.innerText.trim().length > 20;
    if (real && !window.__ready) window.__ready = performance.now();
    if (window.__ready && !document.getAnimations().some(a => a.playState === 'running' && a.effect && a.effect.getTiming().iterations !== Infinity)) { window.__still = performance.now(); return true; }
    return false;
  }, null, { timeout: 15000, polling: 16 });
  return page.evaluate(() => ({ ready: Math.round(window.__ready - window.__t0), still: Math.round(window.__still - window.__t0) }));
}

(async () => {
  await ready;
  await post('/dev/run', { fn: 'setup' });
  await post('/dev/time', { iso: '2026-10-14T11:00:00+01:00' });  // Wednesday
  const admin = await api('', 'requestCode', { email: 'angad@linkmarketing.org.uk' }).then(async () =>
    (await api('', 'verifyCode', { email: 'angad@linkmarketing.org.uk', code: await code('angad@linkmarketing.org.uk') })).token);
  const mk = (name, email, company, roles) => api(admin, 'saveUser', { user: { name, email, company, roles, active: true } });
  const bookers = [await mk('Fiza Iqbal', 'fiza@example.com', 'LINK', ['booker']), await mk('Abdullahi Ahmed', 'abdullahi@example.com', 'JUSS', ['booker'])];
  // A realistic week: 30 check-ins Mon–Wed, a third booked onto the Academy
  const first = ['Adam', 'Bella', 'Chris', 'Dina', 'Ethan', 'Fatima', 'George', 'Hana', 'Imran', 'Jade'], last = ['Khan', 'Lewis', 'Mensah'];
  let n = 0;
  for (const day of ['2026-10-12', '2026-10-13', '2026-10-14']) {
    await post('/dev/time', { iso: day + 'T10:00:00+01:00' });
    for (let i = 0; i < 10; i++, n++) {
      const b = bookers[n % 2];
      const c = (await api('', 'checkin', { form: { full_name: first[n % 10] + ' ' + last[Math.floor(n / 10)], mobile: '07700 9' + String(100000 + n).slice(1), email: 'c' + n + '@example.com',
        over18: 'Yes', booker_id: b.id, rtw: 'British or Irish citizen', privacy_ok: true } }));
      if (n % 3 === 0 && c.id) await api(admin, 'saveOutcome', { id: c.id, outcome: 'Academy booked', academy_date: '2026-10-19', outcome_notes: '' }).catch(() => {});
    }
  }
  await post('/dev/time', { iso: '2026-10-14T15:00:00+01:00' });

  const browser = await chromium.launch();
  const VIDEO = process.argv[2];  // optional: a folder to save a screen recording of the run in
  const ctx = await browser.newContext(VIDEO ? Object.assign({ recordVideo: { dir: VIDEO, size: { width: 390, height: 844 } } }, PHONE) : PHONE);
  const page = await ctx.newPage();
  // Log in like Angad would (fast server), then switch Google's real delay on
  await page.goto(APP + 'index.html');
  await page.click('#doors button[data-door=admin]');
  await page.fill('#em', 'angad@linkmarketing.org.uk'); await page.click('#go');
  await page.waitForSelector('#codeBox:not([hidden])');
  await page.fill('#code', await code('angad@linkmarketing.org.uk')); await page.click('#go');
  await page.waitForSelector('.tabbar button');
  await page.waitForTimeout(1500);
  await post('/dev/delay', { ms: LATENCY });

  const rows = [];
  const tabs = await page.$$eval('.tabbar button[data-tab]', bs => bs.map(b => b.dataset.tab));
  const rec = (what, t, mustBeInstant) => rows.push({ what, ready: t.ready, still: t.still, bad: mustBeInstant && t.ready > INSTANT });
  for (const pass of ['1st visit', '2nd visit']) {
    for (const t of tabs) {
      if (pass === '1st visit' && t === tabs[0]) continue;  // already on it
      rec(t + ' · ' + pass, await tap(page, '.tabbar button[data-tab=' + t + ']'), pass === '2nd visit');
    }
  }
  // Open someone from the middle of All, then come back: same place in the list?
  await tap(page, '.tabbar button[data-tab=all]');
  await page.evaluate(() => { const it = document.querySelectorAll('#page .item')[14]; it.scrollIntoView({ block: 'center' }); });
  await page.waitForTimeout(400);
  const y0 = await page.evaluate(() => window.scrollY);
  await page.evaluate(() => { const it = document.querySelectorAll('#page .item')[14]; it.setAttribute('data-speed', '1'); });
  rec('open a candidate from All', await tap(page, '#page .item[data-speed="1"]'), true);
  rec('← back to All', await tap(page, '#abBack'), true);
  const y1 = await page.evaluate(() => window.scrollY);
  rows.push({ what: 'All: same place in the list after ← back', ready: '', still: '', note: 'scrollY ' + y0 + ' → ' + y1, bad: Math.abs(y1 - y0) > 40 });
  // Switch tab and come back: still in the same place? Tap the tab you're on: back to the top?
  await tap(page, '.tabbar button[data-tab=pay]');
  await tap(page, '.tabbar button[data-tab=all]');
  const y2 = await page.evaluate(() => window.scrollY);
  rows.push({ what: 'All: same place after switching tabs and back', ready: '', still: '', note: 'scrollY ' + y0 + ' → ' + y2, bad: Math.abs(y2 - y0) > 40 });
  await page.click('.tabbar button[data-tab=all]'); await page.waitForTimeout(900);
  const y3 = await page.evaluate(() => window.scrollY);
  rows.push({ what: 'tap the tab you\'re on: back to the top', ready: '', still: '', note: 'scrollY ' + y3, bad: y3 > 5 });
  // Day 1 → open a starter (not in this week's list) → instant?
  await tap(page, '.tabbar button[data-tab=academy]');
  const d1 = await page.$('#page [data-cand]');
  if (d1) { await d1.evaluate(e => e.setAttribute('data-speed', '2')); rec('open a starter from Day 1', await tap(page, '#page [data-cand][data-speed="2"]'), true); }
  // Cold open: app closed and opened again later (cache on the phone)
  await page.goto(APP + 'index.html');
  const t0 = Date.now();
  await page.waitForFunction(() => { const p = document.getElementById('page'); return p && !p.querySelector('.sk') && p.innerText.trim().length > 20; }, null, { timeout: 15000, polling: 16 });
  rows.push({ what: 'open the app again (from the home screen)', ready: Date.now() - t0, still: '' });
  await page.click('.tabbar button[data-tab=chase]');
  const t1 = Date.now();
  await page.waitForFunction(() => { const p = document.getElementById('page'); return p && !p.querySelector('.sk') && /chase|Nudge|nobody/i.test(p.innerText); }, null, { timeout: 15000, polling: 16 });
  rows.push({ what: 'Chase straight after opening the app', ready: Date.now() - t1, still: '', bad: Date.now() - t1 > 400 });

  console.log('\nGoogle delay ' + LATENCY + ' ms per request · "content" = real content on screen · "settled" = animations finished\n');
  console.log('page'.padEnd(46) + 'content'.padStart(9) + 'settled'.padStart(9));
  rows.forEach(r => console.log((r.bad ? '✗ ' : '  ') + r.what.padEnd(44) + String(r.ready === '' ? '' : r.ready + 'ms').padStart(9) + String(r.still === '' ? '' : r.still + 'ms').padStart(9) + (r.note ? '   ' + r.note : '')));
  const bad = rows.filter(r => r.bad).length;
  console.log('\n' + (bad ? bad + ' slow' : 'ALL INSTANT'));
  await ctx.close(); await browser.close();
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
