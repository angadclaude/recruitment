// Day 1's bigger changes are never lost (Angad, 24 Nov 2026: "whilst we are confirming new starts every Monday morning, we're
// clicking dropped out and it's not… saving that, and it's not organizing the people who have dropped out. It's just going back
// to its original form"). Until then 🚫 Dropped out, a move to the other day and 🚪 Didn't continue needed a second tap inside
// four seconds of the first, on a button that only changed its words to "Dropped out?": tapped once, it went back by itself and
// nothing was saved. Here: a Monday morning's list worked on two admins' phones at once. The tap asks on a sheet that stays
// until it's answered (left alone for longer than the old four seconds, left with "No", a save that fails on a bad signal and
// is tried again), the saved starter goes to the bottom of their booker's list, an older answer from the server never puts
// them back, the other phone shows it within seconds without a reload, and a move asked twice only moves one day.
// Usage: node app/build.js && node app/dev/day1.js <screenshot-dir>   (JL_BACKEND=pg: on the Supabase back end)
'use strict';
const { chromium } = require('playwright');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 8799, BASE = 'http://localhost:' + PORT, APP = BASE + '/join/';
const SHOTS = process.argv[2] || './shots-day1';
fs.mkdirSync(SHOTS, { recursive: true });
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

const server = spawn(process.execPath, [path.join(__dirname, 'server.js'), String(PORT)], { stdio: ['ignore', 'pipe', 'inherit'] });
const ready = new Promise(r => server.stdout.on('data', d => { if (/dev server/.test(String(d))) r(); }));
process.on('exit', () => server.kill());

const post = (p, b) => fetch(BASE + p, { method: 'POST', body: JSON.stringify(b) }).then(r => r.json());
const getJson = p => fetch(BASE + p).then(r => r.json());
async function api(token, action, payload) {
  const r = await post('/api', Object.assign({ action, token }, payload || {}));
  if (!r.ok) throw new Error(r.error);
  return r.data;
}
const ev = async js => (await post('/dev/eval', { js })).out;
async function loginApi(email) {
  await api('', 'requestCode', { email });
  const m = (await getJson('/dev/mail')).filter(x => x.to === email && /login code/.test(x.subject)).pop();
  return (await api('', 'verifyCode', { email, code: m.subject.match(/(\d{6})/)[1] })).token;
}
let CLOCK_OFF = 0;
const setTime = async iso => { CLOCK_OFF = new Date(iso).getTime() - Date.now(); return post('/dev/time', { iso }); };
let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; console.log('  ✓ ' + msg); };

(async () => {
  await ready;
  console.log('setup (' + (process.env.JL_BACKEND === 'pg' ? 'Supabase back end' : 'Google back end') + ')');
  await post('/dev/run', { fn: 'setup' });
  await setTime('2026-11-23T08:40:00+00:00');  // Monday morning: Day 1, the room being ticked in
  // Signed in as the app's first admin, whoever the server's settings say that is: the address is asked for, never written here
  const admin = await loginApi(await ev('usersAll().filter(u => isAdmin(u) && truthy(u.active))[0].email'));
  const me = (await api(admin, 'me')).user;
  await api(admin, 'saveUser', { user: { name: 'Ada Admin', email: 'ada@example.com', company: 'LINK', roles: ['admin'], active: true } });
  await api(admin, 'saveUser', { user: { name: 'Bo Booker', email: 'bo@example.com', company: 'JUSS', roles: ['booker'], active: true } });
  await api(admin, 'saveUser', { user: { name: 'Nia Nolan', email: 'nia@example.com', company: 'JUSS', roles: ['booker'], active: true } });
  const ada = await loginApi('ada@example.com');
  const users = (await api(admin, 'listUsers')).users, idOf = n => users.find(u => u.name === n).id;
  // Six starters for today, three each from two bookers, all in last week and booked onto the Academy
  const NAMES = [['Amy Adams', 'Bo Booker'], ['Ben Brook', 'Bo Booker'], ['Cal Cole', 'Bo Booker'], ['Dee Dunn', 'Nia Nolan'], ['Eli Ems', 'Nia Nolan'], ['Fay Fox', 'Nia Nolan']];
  const rows = NAMES.map((n, i) => ({ id: 'd1' + 'abcdef'[i], attended_date: '2026-11-17', full_name: n[0], mobile: '0770090030' + i, email: n[0].split(' ')[0].toLowerCase() + '@example.com',
    booker_id: idOf(n[1]), booker_name: n[1], outcome: 'Academy booked', academy_date: '2026-11-23', outcome_by: n[1], outcome_at: '2026-11-17 15:00', offer_sent_at: '2026-11-17 15:05' }));
  await ev(`(() => { const rows = ${JSON.stringify(rows)};
    rows.forEach(r => appendRow('Candidates', Object.assign({ created_at: nowStr(), week_ending: weekEnding(r.attended_date), over18: 'Yes', rtw: 'British or Irish citizen', in_room: 'TRUE', rag: 'G', stars: '4', company: 'JUSS' }, r)));
    delete MEMO.Candidates; return rows.length; })()`);
  const cand = id => api(admin, 'getCandidate', { id });
  const dropsLogged = async () => Number(await ev('readTable("Log").filter(l => l.action === "day1_dropped").length'));
  ok((await api(admin, 'academyList', {})).items.filter(c => c.academy_date === '2026-11-23').length === 6, 'six starters booked for today, Monday 23 November: three of Bo\'s, three of Nia\'s');

  const browser = await chromium.launch();
  const pageErrors = require('./watch').watch(browser);  // every page's own errors, all the way through
  const phone = async token => {
    const ctx = await browser.newContext(PHONE);
    await ctx.clock.setSystemTime(new Date(Date.now() + CLOCK_OFF));
    await ctx.addInitScript(t => { try { if (!localStorage.getItem('lr_tok')) localStorage.setItem('lr_tok', JSON.stringify(t)); } catch (e) {} }, token);
    const p = await ctx.newPage();
    await p.goto(APP + 'index.html?c=academy'); await p.waitForSelector('.trow[data-cand="d1a"]');
    return p;
  };
  const p = await phone(admin), q = await phone(ada);  // two admins' phones on the same list
  const shot = (pg, n) => pg.screenshot({ path: path.join(SHOTS, n + '.png') });
  const dropB = id => '[data-d1="dropped"][data-id="' + id + '"]', rowIds = pg => pg.$$eval('.alist .trow[data-cand]', r => r.map(x => x.dataset.cand));
  const gone = pg => pg.waitForSelector('.sheet-back', { state: 'detached' });
  const toastIs = (pg, re) => pg.waitForFunction(r => new RegExp(r).test((document.getElementById('toast') || {}).textContent || ''), re.source, { timeout: 10000 }).then(() => true, () => false);

  console.log('🚫 Dropped out: asked on a sheet that waits');
  ok((await p.textContent(dropB('d1b'))).trim() === '🚫 Dropped out' && (await rowIds(p)).join() === 'd1a,d1b,d1c,d1d,d1e,d1f', 'Monday\'s list on the first phone: each booker\'s three together, 🚫 Dropped out on every row');
  await p.click(dropB('d1b')); await p.waitForSelector('.d1ask[data-kind="drop"] #d1yes');
  const sheet1 = await p.innerText('.d1ask');
  ok(/Ben Brook · Day 1 Monday 23 November/i.test(sheet1) && /🚫 Dropped out\?/.test(sheet1) && /Yes, Ben dropped out/.test(await p.textContent('#d1yes')) && /No, go back/.test(sheet1) && /Nothing is saved until you tap Yes/.test(sheet1),
    'one tap on Ben\'s 🚫 Dropped out opens a sheet that names him: "🚫 Dropped out?" · "🚫 Yes, Ben dropped out" · "No, go back" · "Nothing is saved until you tap Yes"');
  await shot(p, '1-dropped-out-asks');
  await p.waitForTimeout(5200);  // longer than the four seconds the old second tap had
  ok(await p.$('.d1ask #d1yes') && !(await cand('d1b')).day1_status && (await p.textContent(dropB('d1b'))).trim() === '🚫 Dropped out',
    'left alone for five seconds (the old second tap had four): the sheet is still there asking, the button behind it never changed its words, nothing has gone back by itself');
  await p.click('#d1yes'); await p.waitForSelector('.trow.dropped[data-cand="d1b"]');
  const ben = await cand('d1b'), benRow = await p.innerText('.trow.dropped[data-cand="d1b"]');
  ok(ben.day1_status === 'dropped' && ben.day1_by === me.name && await dropsLogged() === 1 && !(await p.$('.sheet-back')) && await toastIs(p, /Ben: dropped out/),
    'Yes, however late: saved on the server (dropped out, by ' + me.name.split(' ')[0] + ', in the Log), the sheet closes, "🚫 Ben: dropped out"');
  ok((await rowIds(p)).join() === 'd1a,d1c,d1b,d1d,d1e,d1f' && /🚫 Dropped out/.test(benRow) && /↩️ Undo/.test(benRow) && /5 expected/.test(await p.innerText('#page')) && /1 dropped out/.test(await p.innerText('#page')),
    'and he\'s organised: at the bottom of Bo\'s three, greyed with "🚫 Dropped out" and ↩️ Undo, the day says "5 expected … · 1 dropped out"');
  await shot(p, '2-dropped-out-saved');

  console.log('"No, go back", and a save that fails on a bad signal');
  await p.click(dropB('d1e')); await p.waitForSelector('.d1ask #d1no'); await p.click('#d1no'); await gone(p);
  ok(!(await cand('d1e')).day1_status && await dropsLogged() === 1 && (await p.textContent(dropB('d1e'))).trim() === '🚫 Dropped out', '"No, go back" on Eli: the sheet goes, nothing is saved, his row is as it was');
  let cut = true;
  await p.route('**/api', route => (cut && /"action":"markDay1"/.test(route.request().postData() || '') ? route.abort() : route.continue()));
  await p.click(dropB('d1e')); await p.click('#d1yes'); await p.waitForSelector('.d1ask #d1err .err');
  const errTxt = await p.innerText('#d1err');
  ok(/Not saved yet: No connection/.test(errTxt) && /Tap Yes again/.test(errTxt) && await p.$('.d1ask #d1yes:not([disabled])') && !(await cand('d1e')).day1_status,
    'the save fails (no signal): the sheet stays and says so in red ("' + errTxt.trim() + '"), with Yes ready to tap again; nothing pretends to be saved');
  await shot(p, '3-not-saved-yet');
  cut = false;
  await p.click('#d1yes'); await p.waitForSelector('.trow.dropped[data-cand="d1e"]');
  ok((await cand('d1e')).day1_status === 'dropped' && await dropsLogged() === 2 && (await rowIds(p)).join() === 'd1a,d1c,d1b,d1d,d1f,d1e', 'the signal back, Yes again: saved, and Eli is at the bottom of Nia\'s three');
  await p.unroute('**/api');

  console.log('the other phone, without a reload');
  await q.bringToFront();
  const seen = await q.waitForSelector('.trow.dropped[data-cand="d1b"]', { timeout: 25000 }).then(() => true, () => false);
  ok(seen && await q.$('.trow.dropped[data-cand="d1e"]') && (await rowIds(q)).join() === 'd1a,d1c,d1b,d1d,d1f,d1e',
    'the second admin\'s phone, open on the same list and never reloaded, shows Ben and Eli dropped out within seconds (it took up to five minutes)');
  await q.click('[data-d1="arrived"][data-id="d1a"]'); await q.waitForSelector('[data-d1="arrived"][data-id="d1a"].green');
  await p.bringToFront();
  ok(await p.waitForSelector('[data-d1="arrived"][data-id="d1a"].green', { timeout: 25000 }).then(() => true, () => false) && (await cand('d1a')).day1_by === 'Ada Admin',
    'and the other way: Ada ticks Amy Arrived on hers, and the first phone shows it without a reload');

  console.log('an older answer from the server never puts them back');
  // The list is asked for, and the server answers before the drop is saved; that answer reaches the phone after the drop has.
  let held = null, holding = true;
  await p.route('**/api', async route => {
    if (holding && !held && /"action":"academyList"/.test(route.request().postData() || '')) { const resp = await route.fetch(); held = () => route.fulfill({ response: resp }); return; }
    return route.continue();
  });
  for (let i = 0; i < 60 && !held; i++) { await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await p.waitForTimeout(500); }
  ok(!!held, 'the first phone asks for the list again; the server\'s answer (Fay still expected) is on its way, slowly');
  holding = false;
  await p.click(dropB('d1f')); await p.click('#d1yes'); await p.waitForSelector('.trow.dropped[data-cand="d1f"]');
  await held(); await p.waitForTimeout(1500);
  ok((await cand('d1f')).day1_status === 'dropped' && await p.$('.trow.dropped[data-cand="d1f"]') && !(await p.$('.trow:not(.dropped)[data-cand="d1f"]')),
    'Fay is dropped out and saved, then that older answer arrives: she stays dropped out on screen (it used to put her back to "expected" until the next refresh)');
  await p.unroute('**/api');
  await p.click('.trow.dropped[data-cand="d1f"] [data-d1="dropped"]'); await p.waitForSelector('.trow:not(.dropped)[data-cand="d1f"]');
  ok(!(await cand('d1f')).day1_status && !(await p.$('.sheet-back')), '↩️ Undo is still one tap, no sheet: Fay is expected again');

  console.log('a move to Tuesday and 🚪 Didn\'t continue ask the same way');
  const tueB = '[data-d1="next_day"][data-id="d1c"]';
  await p.click(tueB); await p.waitForSelector('.d1ask[data-kind="move"] #d1yes');
  const mvTxt = await p.innerText('.d1ask');
  ok(/📅 Move to Tuesday\?/.test(mvTxt) && /from Monday 23 November to Tuesday 24 November/.test(mvTxt) && /Yes, move Cal to Tuesday/.test(await p.textContent('#d1yes')) && (await cand('d1c')).academy_date === '2026-11-23',
    '📅 Tuesday on Cal: "📅 Move to Tuesday?" · "from Monday 23 November to Tuesday 24 November" · "📅 Yes, move Cal to Tuesday"; nothing moved yet');
  await p.waitForTimeout(4500);
  await p.click('#d1yes'); await p.waitForFunction(() => /Tuesday 24 November · TOMORROW/i.test(document.getElementById('page').innerText));
  ok((await cand('d1c')).academy_date === '2026-11-24', 'Yes, after more than four seconds: Cal\'s Day 1 is Tuesday 24 November, on Tuesday\'s list');
  // The phone's answer was lost and the same move is asked again: it says which day it was moving him from
  const twice = await api(admin, 'markDay1', { id: 'd1c', status: 'next_day', from: '2026-11-23' });
  ok(twice.academy_date === '2026-11-24' && (await cand('d1c')).academy_date === '2026-11-24', 'the same move asked a second time (the first answer lost on a bad signal) doesn\'t move him another day: still Tuesday, not Wednesday');
  const leftB = '[data-d1="left"][data-id="d1a"]';
  await p.click(leftB); await p.waitForSelector('.d1ask[data-kind="left"] #d1yes');
  ok(/🚪 Didn't continue\?/.test(await p.innerText('.d1ask')) && /Yes, Amy didn't continue/.test(await p.textContent('#d1yes')) && !(await cand('d1a')).day1_left_at, '🚪 Didn\'t continue on Amy (arrived): "🚪 Didn\'t continue?" · "🚪 Yes, Amy didn\'t continue"; nothing saved yet');
  await p.click('#d1yes'); await p.waitForSelector('.trow.left[data-cand="d1a"]');
  ok(!!(await cand('d1a')).day1_left_at && (await cand('d1a')).day1_status === 'arrived', 'Yes: saved as didn\'t continue (still a Day 1 start)');

  console.log('a booker\'s own starter');
  const bo = await phone(await loginApi('bo@example.com'));
  ok(!(await bo.$('[data-d1="arrived"]')) && !(await bo.$('[data-d1="no_show"]')) && !(await bo.$(dropB('d1a'))) && await bo.$(dropB('d1c')),
    'Bo\'s New starts: no Arrived / No-show (those are the admins\'), and nothing to tap on today\'s starters; 🚫 Dropped out on Cal, whose Day 1 is still to come (tomorrow)');
  await bo.click(dropB('d1c')); await bo.waitForSelector('.d1ask #d1yes'); await bo.click('#d1yes'); await bo.waitForSelector('.trow.dropped[data-cand="d1c"]');
  ok((await cand('d1c')).day1_status === 'dropped' && (await cand('d1c')).day1_by === 'Bo Booker', 'a booker drops their own starter, before the day, the same way: 🚫 Dropped out → Yes → saved (by Bo)');

  require('./watch').report(pageErrors);
  await browser.close();
  console.log('\nALL ✓ ' + passed + ' checks (' + (process.env.JL_BACKEND === 'pg' ? 'Supabase back end' : 'Google back end') + ')');
  process.exit(0);
})().catch(e => { console.error('\n✗ ' + (e && e.stack || e)); process.exit(1); });
