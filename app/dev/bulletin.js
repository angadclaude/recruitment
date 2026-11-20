// Bulletins: the office is off them, and the midweek poster (Angad, 19 + 20 Nov 2026: "the office appointments should go off
// the bulletin that we post daily and weekly… office stats should not appear as well. That means Christy or Megan. Daily,
// weekly, and half weekly bulletins"; "I need a midweek bulletin. So from the appointments from Monday, Tuesday & Wednesday").
// One week of appointments by field bookers, Megan, Christie and an admin: what each poster counts and names, what the screen
// says it left off, that Today still counts everyone, and the midweek's days, total, wording, button and file.
// Usage: node app/build.js && node app/dev/bulletin.js <screenshot-dir>   (JL_BACKEND=pg: on the Supabase back end)
'use strict';
const { chromium } = require('playwright');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 8798, BASE = 'http://localhost:' + PORT, APP = BASE + '/join/';
const SHOTS = process.argv[2] || './shots-bulletin';
fs.mkdirSync(SHOTS, { recursive: true });
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, acceptDownloads: true };

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
  await setTime('2026-11-19T17:30:00+00:00');  // Thursday evening, the week of Mon 16 to Fri 20 Nov
  // Signed in as the app's first admin, whoever the server's settings say that is: the address is asked for, never written here
  const admin = await loginApi(await ev('usersAll().filter(u => isAdmin(u) && truthy(u.active))[0].email'));
  const me = (await api(admin, 'me')).user;
  for (const n of ['Hasini Perera', 'Nathan Mcgrath', 'Ramis Ali', 'Tia Lee', 'Zara Khan'])
    await api(admin, 'saveUser', { user: { name: n, email: n.split(' ')[0].toLowerCase() + '@example.com', company: 'JUSS', roles: ['booker'], active: true } });
  // The office: Christie (an office booker by name in the settings), Megan (Hyrre's caller) and another admin
  await api(admin, 'saveUser', { user: { name: 'Christie Zammit', email: 'christie@example.com', company: 'JUSS', roles: ['booker', 'admin'], active: true } });
  await ev('hyrreBooker().id');
  const users = (await api(admin, 'listUsers')).users, isOn = u => u.active === true || u.active === 'TRUE';
  const other = users.find(u => String(u.roles).indexOf('admin') >= 0 && isOn(u) && u.id !== me.id && u.name !== 'Christie Zammit');
  const idOf = n => (n === 'Megan Hyrre' ? 'hyrremegan' : n ? users.find(u => u.name === n).id : '');

  console.log('a week of appointments');
  let seq = 0;
  const appt = (day, booker, n, extra) => Array.from({ length: n }, () => {
    seq++;
    return Object.assign({ id: 'bl' + seq, attended_date: day, full_name: 'Candidate ' + seq, mobile: '07700900' + (100 + seq), email: 'c' + seq + '@example.com', booker_id: idOf(booker), booker_name: booker }, extra || {});
  });
  const UNDER18 = { over18: 'No', in_room: '', rag: '', stars: '' }, NOT_RATED = { in_room: '', rag: '', stars: '' }, WALK = { rag: 'W' };
  const rows = [].concat(
    // Monday: the field 5 attended (one a walk out) + 1 non-qualifier; the office 4 attended (one a walk out) + 1 non-qualifier + 1 not rated
    appt('2026-11-16', 'Hasini Perera', 2), appt('2026-11-16', 'Nathan Mcgrath', 2), appt('2026-11-16', 'Tia Lee', 1, WALK), appt('2026-11-16', 'Zara Khan', 1, UNDER18),
    appt('2026-11-16', 'Megan Hyrre', 3), appt('2026-11-16', 'Megan Hyrre', 1, WALK), appt('2026-11-16', 'Megan Hyrre', 1, UNDER18), appt('2026-11-16', 'Megan Hyrre', 1, NOT_RATED),
    // Tuesday: the field 2, an admin's 2. Wednesday: the field 4, Christie's 2
    appt('2026-11-17', 'Hasini Perera', 2), appt('2026-11-17', other.name, 2),
    appt('2026-11-18', 'Hasini Perera', 1), appt('2026-11-18', 'Nathan Mcgrath', 2), appt('2026-11-18', 'Tia Lee', 1), appt('2026-11-18', 'Christie Zammit', 2),
    // Thursday (today): the field 5, and one of theirs not rated yet
    appt('2026-11-19', 'Ramis Ali', 4), appt('2026-11-19', 'Hasini Perera', 1), appt('2026-11-19', 'Zara Khan', 1, NOT_RATED));
  const put = await ev(`(() => { const rows = ${JSON.stringify(rows)};
    rows.forEach(r => appendRow('Candidates', Object.assign({ created_at: nowStr(), week_ending: weekEnding(r.attended_date), over18: 'Yes', rtw: 'British or Irish citizen', in_room: 'TRUE', rag: 'G', stars: '4', company: 'JUSS' }, r)));
    delete MEMO.Candidates; return rows.length; })()`);
  const week = (await api(admin, 'listWeek', { weekEnding: '2026-11-22' })).items, cnt = c => c.in_room === true || c.in_room === 'TRUE' || !!c.non_qual;
  const officeOf = n => week.filter(c => c.booker_name === n).every(c => c.office === true || c.booker_id === 'hyrremegan');
  ok(put === rows.length && week.length === rows.length && officeOf('Christie Zammit') && officeOf(other.name) && officeOf('Megan Hyrre') && !week.some(c => c.booker_name === 'Hasini Perera' && c.office),
    rows.length + ' check-ins in the week; the office\'s are Megan\'s, Christie\'s and an admin\'s (' + other.name.split(' ')[0] + '), not the field bookers\'');

  const browser = await chromium.launch();
  const pageErrors = require('./watch').watch(browser);  // every page's own errors, all the way through
  const ctx = await browser.newContext(PHONE);
  await ctx.clock.setSystemTime(new Date(Date.now() + CLOCK_OFF));
  await ctx.addInitScript(t => { try { if (!localStorage.getItem('lr_tok')) localStorage.setItem('lr_tok', JSON.stringify(t)); } catch (e) {} }, admin);
  const p = await ctx.newPage();
  await p.goto(APP + 'index.html'); await p.waitForSelector('.tabbar button[data-tab=today]');
  const shot = n => p.screenshot({ path: path.join(SHOTS, n + '.png') });
  const info = async () => JSON.parse(await p.getAttribute('#bimg', 'data-info'));
  const infoIs = re => p.waitForFunction(r => { const i = document.getElementById('bimg'); return i && new RegExp(r).test(i.dataset.info || ''); }, re, { timeout: 15000 });
  const saveImg = async f => fs.writeFileSync(path.join(SHOTS, f), Buffer.from(await p.$eval('#bimg', i => fetch(i.src).then(r => r.arrayBuffer()).then(b => Array.from(new Uint8Array(b))))));
  const names = i => i.rows.map(r => r.replace(/^\S+ /, '')).join(', '), notes = () => p.innerText('#bnotes').catch(() => '');
  const hero = () => p.$$eval('.hero .kpi', k => k.map(x => Number(x.querySelector('b').dataset.n)));
  const kind = async k => { await p.click('#bkind button[data-k=' + k + ']'); await infoIs('"kind":"' + k + '"'); return info(); };
  const back = async () => { await p.click('#abBack'); await p.waitForSelector('#bullDaily'); };

  console.log('Today, Thursday');
  await p.click('.tabbar button[data-tab=today]'); await p.waitForSelector('#bullDaily');
  await p.waitForFunction(() => /Thursday/.test(document.querySelector('.hero').innerText) && document.querySelectorAll('.hero .kpi b').length === 5);
  ok((await p.$$eval('.bullbtns button', b => b.map(x => x.textContent.trim()))).join(' | ') === '📣 Today\'s bulletin | 🏆 Week top 5 | 📈 Midweek bulletin · Mon to Wed',
    'Today on a Thursday: 📣 Today\'s bulletin | 🏆 Week top 5 | 📈 Midweek bulletin · Mon to Wed');
  ok(await p.$eval('#bullMid', b => b.getBoundingClientRect().width > 300 && b.scrollWidth <= b.clientWidth + 1), 'the midweek button has its own full-width line and its words fit');
  await shot('1-today-thursday');
  await p.click('#bullDaily'); await infoIs('"kind":"daily"');
  const thu = await info(), thuNote = await notes();
  ok(thu.attended === 5 && thu.nonQual === 0 && thu.office.attended === 0 && names(thu) === 'Ramis 4' && /^⚠️ 1 checked in but not rated by the presenter yet, so not counted\.$/.test(thuNote.trim()),
    'Thursday\'s poster: 5 attended, "' + names(thu) + '" on Top performers; no office that day, so no office line: "' + thuNote.trim() + '"');
  ok((await p.$$eval('#bkind button', b => b.map(x => x.textContent))).join(' | ') === '📊 Daily | 📈 Midweek | 🏆 Week top 5' &&
    await p.$eval('#bkind', e => e.scrollWidth <= e.clientWidth + 1 && [...e.children].every(b => b.scrollWidth <= b.clientWidth + 1 && b.getBoundingClientRect().height < 48)),
    'the bulletin screen has three tabs that fit a phone on one line: 📊 Daily | 📈 Midweek | 🏆 Week top 5');

  console.log('Monday: the office is off the poster');
  await p.click('.daybar .dchip[data-d="2026-11-16"]'); await infoIs('"day":"2026-11-16"');
  const mon = await info(), monNote = await notes(), monAll = week.filter(c => c.attended_date === '2026-11-16');
  ok(mon.attended === 5 && mon.nonQual === 1 && mon.walkOuts === 1 && names(mon) === 'Hasini 2, Nathan 2',
    'Monday\'s poster is the field bookers\' only: ' + mon.attended + ' attended, ' + mon.nonQual + ' non-qualifier, ' + mon.walkOuts + ' walk out, Top performers "' + names(mon) + '" (Megan\'s 4 attended, her non-qualifier and her walk out aren\'t in any of them)');
  ok(mon.office.attended === 4 && mon.office.nonQual === 1 && monNote.trim() === '🏢 Not on the bulletin: the office\'s 4 attended and 1 non-qualifier today. Today and Appts Attended still count them.',
    'and the screen says what it left off: "' + monNote.trim() + '"');
  await saveImg('2-daily-monday.jpg'); await shot('3-bulletin-screen-monday');
  await p.click('.daybar .dchip[data-d="2026-11-17"]'); await infoIs('"day":"2026-11-17"');
  const tue = await info();
  await p.click('.daybar .dchip[data-d="2026-11-18"]'); await infoIs('"day":"2026-11-18"');
  const wed = await info();
  ok(tue.attended === 2 && tue.office.attended === 2 && names(tue) === 'Hasini 2' && wed.attended === 4 && wed.office.attended === 2 && names(wed) === 'Nathan 2',
    'an admin\'s and Christie\'s go the same way: Tuesday ' + tue.attended + ' attended ("' + names(tue) + '", ' + other.name.split(' ')[0] + '\'s 2 left off), Wednesday ' + wed.attended + ' ("' + names(wed) + '", Christie\'s 2 left off)');

  console.log('Week top 5 and the midweek');
  const wk = await kind('weekly'), wkNote = await notes();
  ok(names(wk) === 'Hasini 6, Nathan 4, Ramis 4, Tia 2' && wk.office.attended === 8 && wk.office.nonQual === 1 && /🏢 Not on the bulletin: the office's 8 attended and 1 non-qualifier this week\./.test(wkNote),
    'Week top 5: "' + names(wk) + '", nobody from the office (their 8 attended this week are left off)');
  await saveImg('4-week-top-5.jpg');
  const mid = await kind('midweek'), midNote = await notes(), dweek = await p.innerText('.daybar .dweek');
  ok(mid.day === '2026-11-22' && mid.midTotal === mon.attended + tue.attended + wed.attended && mid.midTotal === 11 && names(mid) === 'Hasini 5, Nathan 4, Tia 2' && dweek === 'Mon to Wed · w/e Sun 22 Nov',
    '📈 Midweek ("' + dweek + '"): ' + mid.midTotal + ' attended = Monday\'s ' + mon.attended + ' + Tuesday\'s ' + tue.attended + ' + Wednesday\'s ' + wed.attended + '; "' + names(mid) + '" (Thursday\'s Ramis 4 isn\'t in it)');
  ok(mid.office.attended === 8 && mid.office.nonQual === 1 && /🏢 Not on the bulletin: the office's 8 attended and 1 non-qualifier, Monday to Wednesday\./.test(midNote) && !/Wednesday isn't in yet/.test(midNote),
    'and the office\'s 8 attended on those days are left off it too: "' + midNote.trim().split('\n').pop() + '"');
  await p.click('#bedit summary');
  const msgs = [await p.inputValue('#bm0'), await p.inputValue('#bm1'), await p.inputValue('#bm2')];
  ok(msgs[0] === 'Already qualified for the weekly recruitment incentive: {Hasini}!! {Nathan} just {1} away!' && msgs[1] === 'Big shout out to {Hasini} leading the way with {5} so far this week!!' &&
    msgs[2] === 'Two days left to hit {5}!\nLet\'s have a big Thursday and Friday team!!', 'its wording writes itself: "' + msgs.join('" / "').replace(/\n/g, ' ') + '"');
  ok(await p.$eval('#bimg', i => i.complete && i.naturalWidth === 1536 && i.naturalHeight === 2304), 'the midweek poster is made on the phone (1536 × 2304)');
  await saveImg('5-midweek.jpg'); await shot('6-bulletin-screen-midweek');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#bshare')]);
  ok(dl.suggestedFilename() === 'JL-midweek-2026-11-22.jpg', 'Share → "JL-midweek-2026-11-22.jpg"');
  await back();

  console.log('Today still counts everyone');
  ok((await p.textContent('#bullMid')).trim() === '📈 Midweek bulletin · Mon to Wed', 'back on Today (Thursday)');
  await p.click('#bullMid'); await infoIs('"kind":"midweek"');
  ok(await p.$('#bkind button.on[data-k=midweek]') && (await info()).midTotal === 11, 'the Today button opens the midweek poster');
  await back();
  for (let i = 0; i < 3; i++) await p.click('#dprev');
  await p.waitForFunction(() => /Monday/.test(document.querySelector('.hero').innerText) && document.querySelectorAll('.hero .kpi b').length === 5);
  const h = await hero(), notRated = monAll.filter(c => !cnt(c)).length;
  ok(!(await p.$('#bullMid')) && h[0] === monAll.length && h[0] === mon.attended + mon.nonQual + mon.office.attended + mon.office.nonQual + notRated && h[1] === mon.nonQual + mon.office.nonQual,
    'Today on Monday (no midweek button): Checked in ' + h[0] + ' = the poster\'s ' + mon.attended + ' + ' + mon.nonQual + ' + the office\'s ' + mon.office.attended + ' + ' + mon.office.nonQual + ' + ' + notRated + ' not rated; Non-qual ' + h[1] + ' = both');

  await browser.close();
  require('./watch').report(pageErrors); passed++;
  console.log('\nALL ' + passed + ' BULLETIN CHECKS PASSED (' + (process.env.JL_BACKEND === 'pg' ? 'Supabase back end' : 'Google back end') + ')');
  process.exit(0);
})().catch(e => { console.error('\nFAILED:', e); process.exit(1); });
