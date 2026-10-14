// How fast does every step feel? Staff app (moving between pages, presenter notes) and the candidate's
// journey (check-in, evaluation, the congratulations link + Confirm). Times every tap the way a phone feels it, with Google's
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

/** ms from the tap to `text` appearing anywhere on screen. */
async function tapText(page, sel, text) {
  await page.evaluate(t => {
    window.__t0 = 0; window.__seen = 0;
    document.addEventListener('click', () => { window.__t0 = performance.now(); }, { capture: true, once: true });
    const mo = new MutationObserver(() => { if (window.__t0 && !window.__seen && document.body.innerText.includes(t)) { window.__seen = performance.now(); mo.disconnect(); } });
    mo.observe(document.body, { subtree: true, childList: true, characterData: true });
  }, text);
  await page.click(sel);
  await page.waitForFunction(() => window.__seen > 0, null, { timeout: 15000, polling: 16 });
  return Math.round(await page.evaluate(() => window.__seen - window.__t0));
}
async function fillEval(p) {
  await p.click('.chips[data-name=q1_excitement] .chip[data-v="9"]');
  await p.fill('[name=q2_stood_out]', 'The ladder to ownership');
  await p.click('.chips[data-name=q3_reason] .chip:has-text("Uncapped earnings")');
  await p.click('.chips[data-name=q4_situation] .chip:has-text("Working part-time")');
  await p.fill('[name=q5_start_date]', '2026-10-19');
  await p.click('.chips[data-name=q6_days] .chip:has-text("5 days")');
  await p.click('.chips[data-name=q7_commute] .chip:has-text("Yes")');
  await p.fill('[name=q8_resilience]', 'Kept going through exams while working weekends.');
  await p.click('.chips[data-name=q9_results_paid] .chip:has-text("No")');
  await p.click('.chips[data-name=q10_door] .chip:has-text("A)")');
  await p.click('.chips[data-name=q11_coach] .chip:has-text("D)")');
  await p.click('.chips[data-name=q12_bdp_stage] .chip:has-text("Ownership")');
  await p.click('.chips[data-name=q13_unspent] .chip:has-text("No")');
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

  // ── Presenter: type notes on someone in the room, save, back to the list ──
  await page.click('.tabbar button[data-tab=today]'); await page.waitForSelector('#page .item');
  await page.click('#page .item'); await page.waitForSelector('#savenotes');
  await page.fill('#notes', 'Strong eye contact, asked about progression.');
  rows.push({ what: 'presenter: save notes', ready: await tapText(page, '#savenotes', 'Notes saved'), still: '', must: INSTANT });
  rows.push({ what: 'presenter: ← back to the room', ready: (await tap(page, '#abBack')).ready, still: '', must: INSTANT });

  // ── Candidate: a brand-new phone scans QR 1 (check-in), later QR 2 (evaluation) ──
  const cctx = await browser.newContext(PHONE);
  const cp = await cctx.newPage();
  let kb = 0; cp.on('response', r => r.body().then(b => { kb += b.length / 1024; }).catch(() => {}));
  let t = Date.now();
  await cp.goto(APP + 'checkin.html', { waitUntil: 'commit' });
  await cp.waitForSelector('[name=full_name]', { timeout: 15000 });
  rows.push({ what: 'check-in: form on screen (new phone)', ready: Date.now() - t, still: '', must: 800 });
  await cp.fill('[name=full_name]', 'Zara Hughes'); await cp.fill('[name=mobile]', '07700 955555'); await cp.fill('[name=email]', 'zara@example.com');
  await cp.click('.chips[data-name=over18] .chip:has-text("Yes")');
  await cp.fill('#bkq', 'Fiz'); await cp.waitForSelector('#sg button', { timeout: 15000 });
  rows.push({ what: 'check-in: booker names ready to pick', ready: Date.now() - t, still: '', note: 'from opening the page' });
  await cp.click('#sg button:has-text("Fiza")');
  await cp.selectOption('[name=rtw]', 'British or Irish citizen'); await cp.check('[name=privacy_ok]');
  rows.push({ what: 'check-in: tap "Check me in" → done', ready: await tapText(cp, '#go', "checked in"), still: '', must: INSTANT });
  rows.push({ what: 'check-in page weight', ready: '', still: '', note: Math.round(kb) + ' KB downloaded (before compression)' });
  await cp.waitForTimeout(LATENCY + 500);  // presentation happens; the check-in has reached Google
  t = Date.now();
  await cp.goto(APP + 'eval.html', { waitUntil: 'commit' });
  await cp.waitForSelector('.evform .qcard', { timeout: 15000 });
  rows.push({ what: 'evaluation: form on screen (same phone)', ready: Date.now() - t, still: '', must: 800 });
  await fillEval(cp);
  rows.push({ what: 'evaluation: tap Submit → thank-you screen', ready: await tapText(cp, '#go', 'Thank you'), still: '', must: INSTANT });
  await cp.waitForTimeout(LATENCY + 500);

  // ── New starter: the congratulations link (WhatsApp / welcome email) ──
  const zara = (await api(admin, 'search', { q: 'Zara' })).items[0];
  await api(admin, 'saveOutcome', { id: zara.id, outcome: 'Academy booked', academy_date: '2026-10-19', outcome_notes: '' });
  const wurl = (await api(admin, 'getCandidate', { id: zara.id })).welcome_url.replace(/^https?:\/\/[^/]+\/recruitment\/join\//, APP);
  const wctx = await browser.newContext(PHONE);
  const wp = await wctx.newPage();
  t = Date.now();
  await wp.goto(wurl, { waitUntil: 'commit' });
  await wp.waitForSelector('text=You\'re in', { timeout: 15000 });
  rows.push({ what: 'welcome page: on screen (from the text / email)', ready: Date.now() - t, still: '', must: 800 });
  await wp.waitForSelector('#conf', { timeout: 15000 });
  rows.push({ what: 'welcome page: tap Confirm → locked in', ready: await tapText(wp, '#conf', 'locked in'), still: '', must: INSTANT });
  t = Date.now();
  await wp.reload({ waitUntil: 'commit' });
  await wp.waitForSelector('.wl-done', { timeout: 15000 });
  rows.push({ what: 'welcome page: opened again later', ready: Date.now() - t, still: '', must: 800 });
  const pre = await wp.$$eval('link[rel=preconnect]', ls => ls.map(l => new URL(l.href).host));
  rows.push({ what: 'welcome page: links warmed up before the tap', ready: '', still: '', note: pre.length ? pre.join(', ') : 'none', bad: pre.length < 3 });
  rows.forEach(r => { if (r.must && typeof r.ready === 'number' && r.ready > r.must) r.bad = true; });

  console.log('\nGoogle delay ' + LATENCY + ' ms per request · "content" = real content on screen · "settled" = animations finished\n');
  console.log('step'.padEnd(46) + 'content'.padStart(9) + 'settled'.padStart(9));
  rows.forEach(r => console.log((r.bad ? '✗ ' : '  ') + r.what.padEnd(44) + String(r.ready === '' ? '' : r.ready + 'ms').padStart(9) + String(r.still === '' ? '' : r.still + 'ms').padStart(9) + (r.note ? '   ' + r.note : '')));
  const bad = rows.filter(r => r.bad).length;
  console.log('\n' + (bad ? bad + ' slow' : 'ALL INSTANT'));
  await ctx.close(); await browser.close();
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
