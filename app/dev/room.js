// A busy room: 20 people check in over about a minute (Google ~1.5 s a request) while a presenter on a slow phone
// (CPU 4x slower, like a cheap Android) rates them one after another: open → type → Save → ← back → next.
// Times every tap the way the phone feels it, counts freezes (long tasks) and how often the list redraws itself.
// Usage: node app/build.js && node app/dev/room.js
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 8791, BASE = 'http://localhost:' + PORT, APP = BASE + '/join/';
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const LATENCY = 1500, CPU = Number(process.env.CPU || 4), PEOPLE = 20, RATE = 8;

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
const login = async email => { await api('', 'requestCode', { email }); return (await api('', 'verifyCode', { email, code: await code(email), door: 'ba' })).token; };

/** ms from a tap until `done()` is true in the page (polled every frame). */
async function timed(page, act, done) {
  await page.evaluate(() => { window.__t0 = 0; document.addEventListener('click', () => { window.__t0 = performance.now(); }, { capture: true, once: true }); });
  await act();
  await page.waitForFunction(done, null, { timeout: 20000, polling: 16 });
  return Math.round(await page.evaluate(() => performance.now() - window.__t0));
}

(async () => {
  await ready;
  await post('/dev/run', { fn: 'setup' });
  await post('/dev/time', { iso: '2026-10-14T10:00:00+01:00' });  // Wednesday, in the room
  const admin = await (async () => { await api('', 'requestCode', { email: 'angad@linkmarketing.org.uk' }); return (await api('', 'verifyCode', { email: 'angad@linkmarketing.org.uk', code: await code('angad@linkmarketing.org.uk') })).token; })();
  const mk = (name, email, company, roles) => api(admin, 'saveUser', { user: { name, email, company, roles, active: true } });
  const bookers = [await mk('Fiza Iqbal', 'fiza@example.com', 'LINK', ['booker']), await mk('Abdullahi Ahmed', 'abdullahi@example.com', 'JUSS', ['booker'])];
  const nathan = await mk('Nathan Smith', 'nathan@example.com', 'LINK', ['presenter', 'booker']);  // like most presenters: books people too
  bookers.push(nathan);
  // Monday and Tuesday already happened: 30 a day, evaluations filled in (long answers), rated, called
  const long = 'I have worked in retail for three years and I love talking to people, I want to earn on results and build something of my own. ';
  for (const day of ['2026-10-12', '2026-10-13']) {
    await post('/dev/time', { iso: day + 'T10:00:00+01:00' });
    for (let i = 0; i < 30; i++) {
      const n = 100 + (day === '2026-10-12' ? 0 : 30) + i;
      const c = await api('', 'checkin', { form: { full_name: 'Earlier Person' + n + ' Smith', mobile: '07700 8' + String(100000 + n).slice(1), email: 'e' + n + '@example.com',
        over18: 'Yes', booker_id: bookers[n % 3].id, rtw: 'British or Irish citizen', privacy_ok: true } });
      await api('', 'submitEval', { id: c.id, resume: c.resume, answers: { q1_excitement: '8', q2_stood_out: long, q3_reason: 'Leadership', q4_situation: 'Studying', q5_start_date: '2026-10-19',
        q6_days: '5 days', q7_commute: 'Yes', q8_resilience: long + long, q9_results_paid: 'No', q10_door: 'D) "Annoying, but I\'ll keep going."', q11_coach: 'A) Ask them to show me, then copy it',
        q12_bdp_stage: 'Not sure yet', q12_bdp_why: long, q13_unspent: 'No', q14_questions: long } }).catch(() => {});
      await api(admin, 'saveNotes', { id: c.id, rag: 'G', stars: 4, tags: ['Great energy'], notes: long, why_note: long, interesting: 'Plays football' }).catch(() => {});
      await api(admin, 'saveOutcome', { id: c.id, outcome: i % 3 ? 'No answer' : 'Academy booked', academy_date: '2026-10-19', outcome_notes: long }).catch(() => {});
    }
  }
  await post('/dev/time', { iso: '2026-10-14T10:00:00+01:00' });
  const first = ['Adam', 'Bella', 'Chris', 'Dina', 'Ethan', 'Fatima', 'George', 'Hana', 'Imran', 'Jade'], last = ['Khan', 'Lewis'];
  const checkin = n => api('', 'checkin', { form: { full_name: first[n % 10] + ' ' + last[Math.floor(n / 10) % 2], mobile: '07700 9' + String(100000 + n).slice(1),
    email: 'c' + n + '@example.com', over18: 'Yes', booker_id: bookers[n % 3].id, rtw: 'British or Irish citizen', privacy_ok: true } });
  for (let n = 0; n < 6; n++) await checkin(n);  // the first few arrive before the presenter opens the app

  const browser = await chromium.launch();
  const ctx = await browser.newContext(PHONE);
  await ctx.clock.setSystemTime(new Date('2026-10-14T10:00:00+01:00'));
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  page.on('pageerror', e => console.log('PAGE ERROR', e.message));
  await page.addInitScript(() => {
    window.__long = []; window.__redraws = 0; window.__store = { n: 0, ms: 0 };
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { const t = performance.now(); set.call(this, k, v); if (k === 'lr_cache') { window.__store.n++; window.__store.ms += performance.now() - t; } };
    try { new PerformanceObserver(l => l.getEntries().forEach(e => window.__long.push(Math.round(e.duration)))).observe({ type: 'longtask', buffered: true }); } catch (e) {}
    const watch = () => { const p = document.getElementById('app'); if (!p) return setTimeout(watch, 50); new MutationObserver(ms => { if (ms.some(m => m.target.id === 'page' || (m.type === 'childList' && [...m.addedNodes].some(n => n.id === 'page')))) window.__redraws++; }).observe(p, { childList: true, subtree: true }); };
    document.addEventListener('DOMContentLoaded', watch);
  });
  // Log in (fast), then Google's real delay and a slow phone
  const tok = await login('nathan@example.com');
  await page.goto(APP + 'index.html');
  await page.evaluate(t => { localStorage.setItem('lr_tok', JSON.stringify(t)); }, tok);
  await page.goto(APP + 'index.html');
  await page.waitForSelector('#page .item', { timeout: 20000 });
  await post('/dev/delay', { ms: LATENCY });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  await page.evaluate(() => { window.__long = []; window.__redraws = 0; window.__store = { n: 0, ms: 0 }; });

  // The rest of the room checks in while the presenter works (one every ~3 s)
  let arrived = 6, stop = false;
  const arrivals = (async () => { while (arrived < PEOPLE && !stop) { await new Promise(r => setTimeout(r, 3000)); checkin(arrived++).catch(() => {}); } })();

  const rows = []; let lost = 0;
  // A finger: find it on screen, ~250 ms to react, tap where it was. Lost = the page changed under the finger, nothing opened.
  const human = async (sel, done) => {
    for (let tries = 0; tries < 4; tries++) {
      let b = null;
      try { const el = await page.$(sel); await el.scrollIntoViewIfNeeded({ timeout: 1500 }); b = await el.boundingBox(); } catch (e) { lost++; continue; }  // swapped out while finding it
      if (!b) { lost++; continue; }
      await page.waitForTimeout(250);
      await page.evaluate(() => { window.__t0 = performance.now(); });
      await page.touchscreen.tap(b.x + b.width / 2, b.y + Math.min(b.height / 2, 30));
      try { await page.waitForFunction(done, null, { timeout: 2500, polling: 16 }); return Math.round(await page.evaluate(() => performance.now() - window.__t0)) + (tries ? 2500 * tries : 0); }
      catch (e) { lost++; }
    }
    throw new Error('tap never landed: ' + sel);
  };
  for (let i = 0; i < RATE; i++) {
    const items = await page.$$('#page .item[data-id]');
    const id = await items[i % items.length].getAttribute('data-id');
    // Today's people quick-rated Green on the list first (one tap), then opened for notes
    if (await page.$('.quick[data-for="' + id + '"] .q-G')) await human('.quick[data-for="' + id + '"] .q-G', 'true');
    const open = await human('#page .item[data-id="' + id + '"]', () => !!document.getElementById('savenotes'));
    await page.click('.rag button.G'); await page.click('.stars button[data-s="4"]');
    await page.fill('#notes', 'Good energy, asked about progression. Person ' + (i + 1));
    const save = await timed(page, () => page.click('#savenotes'), () => /Notes saved|In the room · saved/.test(document.body.innerText));
    const backT = await human('#abBack', () => !!document.querySelector('#page .item[data-id]') && !document.getElementById('savenotes'));
    rows.push({ person: i + 1, open, save, back: backT });
    await page.waitForTimeout(800);  // looks up, finds the next person
  }
  stop = true; await arrivals;
  const st = await page.evaluate(() => ({ long: window.__long, redraws: window.__redraws, store: window.__store, outbox: (JSON.parse(localStorage.getItem('lr_outbox') || '[]')).length, cache: (localStorage.getItem('lr_cache') || '').length }));
  console.log('\nBusy room: ' + PEOPLE + ' check-ins, Google ' + LATENCY + ' ms, phone CPU ' + CPU + 'x slower\n');
  console.log('person  open   save   back   (ms from the tap)');
  rows.forEach(r => console.log(String(r.person).padEnd(7) + String(r.open).padEnd(7) + String(r.save).padEnd(7) + r.back));
  const avg = k => Math.round(rows.reduce((t, r) => t + r[k], 0) / rows.length), max = k => Math.max(...rows.map(r => r[k]));
  console.log('average ' + avg('open') + '    ' + avg('save') + '    ' + avg('back') + '\nworst   ' + max('open') + '    ' + max('save') + '    ' + max('back'));
  console.log('\nfreezes over 50 ms: ' + st.long.length + ' (longest ' + Math.max(0, ...st.long) + ' ms, total ' + st.long.reduce((a, b) => a + b, 0) + ' ms)');
  console.log('lost taps (finger landed while the page was being rebuilt): ' + lost);
  console.log('saving the phone copy: ' + st.store.n + ' times, ' + Math.round(st.store.ms) + ' ms in total');
  console.log('page redraws: ' + st.redraws + ' · saves still waiting for Google at the end: ' + st.outbox + ' · phone cache ' + Math.round(st.cache / 1024) + ' KB');
  await browser.close();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
