// Booking a presentation straight after the call (Angad, 23 Oct): Jess, Rubal and Angad book applicants, the app writes the
// confirmation / reminder / "sorry we missed you", the 18:00 and 10:30 alerts go to whoever booked them, check-in finds the
// booking by mobile, and admins see the show-up rate. Rules on the server, then the screens on a phone.
// Usage: node app/build.js && node app/dev/book.js <screenshot-dir>   (JL_BACKEND=pg: on the Supabase back end)
'use strict';
const { chromium } = require('playwright');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 8790, BASE = 'http://localhost:' + PORT, APP = BASE + '/join/';
const PUBLIC = require('../site.json').url;  // where the app lives (the links in messages point there)
const SHOTS = process.argv[2] || './shots-book';
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
const refused = (token, action, payload) => api(token, action, payload).then(() => '', e => e.message);
async function loginApi(email) {
  await api('', 'requestCode', { email });
  const m = (await getJson('/dev/mail')).filter(x => x.to === email && /login code/.test(x.subject)).pop();
  return (await api('', 'verifyCode', { email, code: m.subject.match(/(\d{6})/)[1] })).token;
}
let CLOCK_OFF = 0;
const CONTEXTS = [];
const setTime = async iso => {
  CLOCK_OFF = new Date(iso).getTime() - Date.now();
  await Promise.all(CONTEXTS.map(c => c.clock.setSystemTime(new Date(Date.now() + CLOCK_OFF)).catch(() => {})));
  return post('/dev/time', { iso });
};
let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; console.log('  ✓ ' + msg); };
const shot = async (page, name, full) => { await page.waitForTimeout(300); return page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: !!full }); };
const pushesSince = async n => (await getJson('/dev/pushes')).slice(n);
const to = (list, id) => list.filter(p => p.body.include_aliases.external_id.includes(id));
const textOf = href => decodeURIComponent(href.split(/[?&]text=|[?&]body=/)[1]);

// The approved wording (Angad, 23 Oct): the thank-you's style, no hearts, signed by whoever sends it, JUSS Marketing Ltd
const CONFIRM_SAM = 'Hey Sam! 👋\n\nGreat speaking with you! You’re *booked in* for your *Appointment Presentation* 🎉\n\n' +
  '📅 *Tuesday 27th October · 10:00 AM*\n⏱️ Approximately 60–90 minutes\n\n' +
  '📍 *Where*\nJUSS Marketing, 2nd Floor East\nAutomotive House, Grays Place, Slough SL2 5AF\n🗺️ https://maps.app.goo.gl/zeP4MjS2hMJzB9V9A\n' +
  '🚗 Parking right outside the main entrance\n🚆 By train? Exit Slough station from *platform 5*\n\n' +
  '👔 *Dress code:* office wear / smart casual\n📄 *Documents:* none needed yet 🙌\n\n👇 Tap *CONFIRM* to lock in your spot ✅\n{LINK}\n\n' +
  'Questions before then? Just message me here 💬\n\nKind regards,\n*Jess Grace*\nIn association with *JUSS Marketing Ltd*';

(async () => {
  await ready;
  console.log('setup (' + (process.env.JL_BACKEND === 'pg' ? 'Supabase back end' : 'Google back end') + ')');
  await post('/dev/run', { fn: 'setup' });
  await post('/dev/props', { ONESIGNAL_APP_ID: 'test-app', ONESIGNAL_API_KEY: 'test-key' });
  await setTime('2026-10-26T13:00:00+00:00');  // Monday 26 Oct, 13:00 London (GMT from 25 Oct)
  const angad = await loginApi('angad@linkmarketing.org.uk'), jess = await loginApi('jess@linkmarketing.org.uk');
  const rubal = await loginApi('rubal@jussmarketing.co.uk'), satpal = await loginApi('satpal@jussmarketing.co.uk');
  const users = (await api(angad, 'listUsers')).users, idOf = re => users.find(u => re.test(u.email)).id;
  const angadId = idOf(/angad/), jessId = idOf(/jess/), rubalId = idOf(/rubal/);
  const mk = (name, email, company, roles) => api(angad, 'saveUser', { user: { name, email, company, roles, active: true } });
  await mk('Fiza Iqbal', 'fiza@example.com', 'LINK', ['booker']);
  await mk('Nathan Smith', 'nathan@example.com', 'LINK', ['presenter']);
  const fiza = await loginApi('fiza@example.com'), nathan = await loginApi('nathan@example.com');

  console.log('booking (server rules)');
  const me = await api(jess, 'me');
  ok(JSON.stringify(me.bookTeam.map(t => t.name).sort()) === '["Angad Oshan","Jess Grace","Rubal Oshan"]' && me.book.time === '10:00' && me.book.co === 'JUSS',
    'the booking team is Jess, Rubal and Angad; presentations at 10:00; everyone booked is JUSS\'s');
  const sam = await api(jess, 'saveBooking', { booking: { first_name: 'sam', last_name: 'carter', mobile: '07700 900123', slot_date: '2026-10-27', source: 'Teamtailor', notes: 'Driving in, has done sales before' } });
  ok(sam.first_name === 'Sam' && sam.last_name === 'Carter' && sam.mobile === '07700900123' && sam.status === 'booked' && sam.company === 'JUSS' &&
    sam.booked_by === 'Jess Grace' && sam.slot_time === '10:00' && !sam._row, 'Jess books Sam Carter for Tue 27 Oct (name tidied, mobile cleaned, JUSS, 10:00)');
  for (const [who, tok] of [['Fiza (a booker)', fiza], ['Nathan (a presenter)', nathan], ['Satpal (an admin)', satpal]]) {
    const e = await refused(tok, 'saveBooking', { booking: { first_name: 'X', mobile: '07700900999', slot_date: '2026-10-27' } });
    ok(e === 'Presentations are booked by Angad, Jess or Rubal.', who + ' can\'t book: "' + e + '"');
  }
  ok(/^Already booked for Tuesday 27th October \(by Jess\)/.test(await refused(rubal, 'saveBooking', { booking: { first_name: 'Sam', mobile: '+44 7700 900123', slot_date: '2026-10-28' } })),
    'the same mobile can\'t be booked twice (+44 counts as 07): "Already booked for Tuesday 27th October (by Jess)…"');
  ok(await refused(jess, 'saveBooking', { booking: { first_name: 'A', mobile: '07700900111', slot_date: '2026-10-31' } }) === 'Presentations are Monday to Friday.' &&
    await refused(jess, 'saveBooking', { booking: { first_name: 'A', mobile: '07700900111', slot_date: '2026-10-23' } }) === 'Pick the day of their presentation.' &&
    await refused(jess, 'saveBooking', { booking: { first_name: 'A', mobile: '0123', slot_date: '2026-10-27' } }) === 'Add a valid UK mobile (07…).' &&
    await refused(jess, 'saveBooking', { booking: { first_name: ' ', mobile: '07700900111', slot_date: '2026-10-27' } }) === 'Add their first name.',
    'a weekend, a day gone, a bad mobile or no name are refused in plain words');
  const ollie = await api(angad, 'saveBooking', { booking: { first_name: 'Ollie', last_name: 'Grant', mobile: '07700900124', slot_date: '2026-10-27', source: 'Indeed' } });
  const ruby = await api(jess, 'saveBooking', { booking: { first_name: 'Ruby', last_name: 'Khan', mobile: '07700900125', slot_date: '2026-10-27', source: 'Referral' } });
  const jb = await api(jess, 'bundle', {}), fb = await api(fiza, 'bundle', {});
  ok(jb.bookings.length === 3 && jb.bookings.every(b => !b._row) && fb.bookings === undefined, 'the week\'s bundle carries the bookings for the booking team only (not for Fiza)');
  let s = await api(jess, 'bookingAction', { id: sam.id, act: 'sent', kind: 'confirm', via: 'whatsapp' });
  ok(/^2026-10-26 13:00/.test(s.confirm_at) && s.confirm_by === 'Jess Grace' && s.confirm_via === 'whatsapp' && !s.no_whatsapp, 'sending the confirmation is saved: when, by whom, WhatsApp');
  s = await api(jess, 'bookingAction', { id: sam.id, act: 'yes' });
  ok(!!s.confirmed_at && s.confirmed_by === 'Jess Grace', 'Sam replies YES → one tap → confirmed');
  const r1 = await api(jess, 'bookingAction', { id: ruby.id, act: 'sent', kind: 'confirm', via: 'sms' });
  ok(r1.no_whatsapp === 'TRUE' && r1.confirm_via === 'sms', 'sent by text = not on WhatsApp: her next messages go by text too');
  ok(/booking team/.test(await refused(fiza, 'bookingAction', { id: sam.id, act: 'yes' })), 'nobody else can change a booking');

  console.log('CONFIRM, like Day 1');
  ok([sam, ollie, ruby].every(b => /^[0-9a-f]{24}$/.test(b.confirm_token)) && new Set([sam, ollie, ruby].map(b => b.confirm_token)).size === 3, 'every booking has its own "You\'re booked in" page link');
  const info = await api('', 'bookingInfo', { t: sam.confirm_token });
  ok(info.first_name === 'Sam' && info.slot_date === '2026-10-27' && info.slot_time === '10:00' && info.company === 'JUSS' && info.booker === 'Jess' && !!info.confirmed_at &&
    !('mobile' in info) && !('last_name' in info) && !('notes' in info), 'the page gets only what it shows: first name, the day, JUSS, who booked them (first name), confirmed or not');
  ok(/expired/.test(await refused('', 'bookingInfo', { t: 'nope' })) && /expired/.test(await refused('', 'confirmBooking', { t: '' })), 'a wrong link: "This link has expired…"');
  let c0 = (await getJson('/dev/pushes')).length;
  const oc = await api('', 'confirmBooking', { t: ollie.confirm_token });
  const ol = (await api(angad, 'bookingList', {})).items.find(b => b.id === ollie.id), op = to(await pushesSince(c0), angadId)[0];
  ok(!!oc.confirmed_at && ol.confirmed_by === 'CONFIRM' && op && op.body.headings.en === '✅ Ollie confirmed Tuesday\'s presentation' && /tapped CONFIRM for Tuesday 27th October at 10:00/.test(op.body.contents.en) && /\?c=book$/.test(op.body.web_url),
    'Ollie taps 🔒 Confirm I\'m coming → confirmed in the app; Angad: "' + (op ? op.body.headings.en : 'none') + '"');
  c0 = (await getJson('/dev/pushes')).length; await api('', 'confirmBooking', { t: ollie.confirm_token });
  ok(!(await pushesSince(c0)).length, 'tapping it again: no second alert');

  console.log('18:00 the evening before');
  let n0 = (await getJson('/dev/pushes')).length;
  await setTime('2026-10-26T17:55:00+00:00'); await post('/dev/run', { fn: 'keepWarm' });
  ok(!(await pushesSince(n0)).some(p => /to remind for tomorrow/.test(p.body.headings.en)), 'nothing before 18:00');
  await setTime('2026-10-26T18:05:00+00:00'); await post('/dev/run', { fn: 'keepWarm' });
  const rem = await pushesSince(n0), rj = to(rem, jessId)[0], ra = to(rem, angadId)[0];
  ok(rj && rj.body.headings.en === '📲 2 to remind for tomorrow' && rj.body.contents.en === 'Tuesday\'s 10:00 presentation: Sam ✅, Ruby ⏳. Tap to send the reminders, signed by you.' &&
    /\?c=bookrem$/.test(rj.body.web_url) && ra && ra.body.headings.en === '📲 1 to remind for tomorrow' && !to(rem, rubalId).length,
    '18:00 → whoever booked them: Jess "' + (rj ? rj.body.headings.en + ' | ' + rj.body.contents.en : 'none') + '", Angad his 1, Rubal nothing');
  n0 = (await getJson('/dev/pushes')).length; await post('/dev/run', { fn: 'keepWarm' });
  ok(!(await pushesSince(n0)).length, 'the 18:00 alert goes once');

  console.log('on the day: check-in finds the booking');
  await setTime('2026-10-27T09:40:00+00:00');
  const found = await api('', 'bookingByMobile', { mobile: '07700 900123' });
  ok(found.found && found.booker_id === jessId && found.booker_name === 'Jess Grace' && found.company === 'JUSS' && found.time === '10:00' && !found.first_name && !found.mobile,
    'the check-in page asks by mobile: who booked them and the time, nothing about the person');
  ok(!(await api('', 'bookingByMobile', { mobile: '07700900999' })).found, 'an unknown mobile finds nothing');
  n0 = (await getJson('/dev/pushes')).length;
  const ci = await api('', 'checkin', { form: { full_name: 'sam carter', mobile: '07700900123', email: 'sam@example.com', over18: 'Yes', booker_id: users.find(u => /satpal/.test(u.email)).id,
    rtw: 'British or Irish citizen', privacy_ok: true, source: 'Indeed' } });
  ok(ci.company === 'JUSS', 'Sam checks in (picking Satpal by mistake) → he\'s with JUSS Marketing');
  const sc = await api(angad, 'getCandidate', { id: ci.id });
  ok(sc.booker_id === jessId && sc.booker_name === 'Jess Grace' && sc.brand === 'JUSS' && sc.booking_id === sam.id && sc.booking_note === 'Driving in, has done sales before',
    'the booking wins: booked by Jess, his messages from JUSS, the notes from the call on his record');
  // Before 29 Oct a LINK tap on his thank-you was saved as the company he joins (Payam Safie): once, back to his booking's
  await post('/dev/eval', { js: `(() => { const c = readRow('Candidates', rowOfId('Candidates', '${ci.id}')); c.brand = 'LINK'; writeRow('Candidates', c);
    PropertiesService.getScriptProperties().deleteProperty('BRAND_TAP_UNDONE_2'); brandTapUndone(); brandTapUndone(); return 'ok'; })()` });
  const tapLog = (await getJson('/dev/sheet?name=Log')).filter(r => r[2] === 'brand' && r[3] === ci.id);
  ok((await api(angad, 'getCandidate', { id: ci.id })).brand === 'JUSS' && tapLog.length === 1 && tapLog[0][4] === "LINK → JUSS (their booking's: a tap on LINK was for that message only)",
    'once: a LINK tap saved on a Book Appts applicant before 29 Oct goes back to his booking\'s company (JUSS), one Log line');
  ok(to(await pushesSince(n0), jessId).some(p => p.body.headings.en === '🙌 Sam just checked in'), 'Jess gets "🙌 Sam just checked in"');
  const sb = (await api(jess, 'bookingList', {})).items.find(b => b.id === sam.id);
  ok(sb.status === 'came' && sb.candidate_id === ci.id && /^2026-10-27 09:40/.test(sb.came_at), 'his booking: came, at 09:40, linked to his check-in');
  const room = (await api(nathan, 'listDay', {})).items.find(c => c.id === ci.id);
  ok(room.limited && room.booking_note === 'Driving in, has done sales before' && !room.mobile, 'the presenter sees the notes from the call (and still not his mobile)');
  let su = (await api(satpal, 'payReport', {})).showup;
  ok(su.booked === 1 && su.came === 1, 'show-up before 10:30: only who has come counts so far (1 of 1)');
  ok(!(await api(fiza, 'payReport', {})).showup, 'bookers don\'t get the show-up numbers');

  console.log('10:30: who didn\'t come');
  n0 = (await getJson('/dev/pushes')).length;
  await setTime('2026-10-27T10:35:00+00:00'); await post('/dev/run', { fn: 'keepWarm' });
  const mp = await pushesSince(n0), mj = to(mp, jessId)[0], ma = to(mp, angadId)[0];
  ok(mj && mj.body.headings.en === '😕 1 didn\'t come today' && /^Ruby didn't check in for the 10:00 presentation/.test(mj.body.contents.en) && /\?c=bookmiss$/.test(mj.body.web_url) &&
    ma && /^Ollie /.test(ma.body.contents.en), '10:30 → Jess: "' + (mj ? mj.body.headings.en + ' | ' + mj.body.contents.en : 'none') + '"; Angad hears about Ollie');
  su = (await api(satpal, 'payReport', {})).showup;
  ok(su.booked === 3 && su.came === 1 && JSON.stringify(su.rows.map(r => [r.name, r.booked, r.came])) === '[["Jess Grace",2,1],["Angad Oshan",1,0]]' &&
    JSON.stringify(su.sources.map(x => [x.source, x.booked, x.came]).sort()) === '[["Indeed",1,0],["Referral",1,0],["Teamtailor",1,1]]',
    'show-up after 10:30: 1 of 3 came; Jess 1 of 2, Angad 0 of 1; by where they applied');
  const ol2 = await api(angad, 'saveBooking', { booking: { first_name: 'Ollie', last_name: 'Grant', mobile: '07700900124', slot_date: '2026-10-28', source: 'Indeed', rebook_of: ollie.id } });
  const list = (await api(angad, 'bookingList', {})).items;
  ok(ol2.rebook_of === ollie.id && list.find(b => b.id === ollie.id).status === 'no_show' && (await api(satpal, 'payReport', {})).showup.booked === 3,
    'Ollie is rebooked for Wed 28: a new booking; the one he missed stays a no-show (still counts as booked)');
  const moved = await api(jess, 'saveBooking', { booking: Object.assign({}, ruby, { slot_date: '2026-10-29' }) });
  ok(moved.id === ruby.id && moved.slot_date === '2026-10-29' && !moved.confirm_at && moved.no_whatsapp === 'TRUE', 'Ruby\'s day changed to Thu 29: same booking, its messages start again (still by text)');
  const cx = await api(jess, 'bookingAction', { id: ruby.id, act: 'cancel' });
  ok(cx.status === 'cancelled' && !(await api(jess, 'bookingList', {})).items.some(b => b.id === ruby.id) && (await api(satpal, 'payReport', {})).showup.booked === 2,
    'a cancelled booking leaves the lists and the show-up count');

  console.log('the screens');
  const browser = await chromium.launch();
  const pageErrors = require('./watch').watch(browser);  // every page's own errors, all the way through
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (...a) => { const ctx = await newContext(...a); CONTEXTS.push(ctx); await ctx.clock.setSystemTime(new Date(Date.now() + CLOCK_OFF)); return ctx; };
  const as = async (tok, url) => {
    const ctx = await browser.newContext(PHONE);
    await ctx.addInitScript(t => { try { if (!localStorage.getItem('lr_tok')) localStorage.setItem('lr_tok', JSON.stringify(t)); } catch (e) {} }, tok);
    const p = await ctx.newPage(); await p.goto(url || APP + 'index.html'); await p.waitForSelector('.tabbar button'); return p;
  };
  await setTime('2026-10-27T13:00:00+00:00');  // Tuesday afternoon
  const jp = await as(jess);
  ok(!(await jp.$('#bookNew')) && JSON.stringify(await jp.$$eval('.tabbar button', b => b.map(x => x.dataset.tab))) === '["today","book","chase","academy","all","pay"]',
    'Jess\'s tabs: Today, Book Appts, Chase, Day 1, All, Appts Attended (Team is under her initials); Today has no booking on it');
  await jp.click('.tabbar button[data-tab=book]'); await jp.waitForSelector('#bookNew');
  ok(/Book Appts/.test(await jp.textContent('#abTitle')) && /Book a presentation/.test(await jp.textContent('#bookNew')), 'its own tab, Book Appts: 📅 Book a presentation');
  const exp = await jp.innerText('#page');
  ok(/Today · 10:00 AM/i.test(exp) && /Tuesday 27 October/.test(exp) && /Sam Carter/.test(exp) && /Checked in 09:40/.test(exp) && /Ollie Grant/.test(exp) && /Rebooked/.test(exp) &&
    /Show-up/i.test(exp) && await jp.$('.bkmode .chip.on[data-bkmode=day]') && await jp.$('#bkprev') && await jp.$('#bknext'),
    'Day by day, like Today (Angad, 23 Oct): Today · Tuesday 27 October, Sam 🎓 checked in 09:40, Ollie didn\'t come (rebooked), the day\'s show-up');
  await shot(jp, 'b1-today', true);
  await jp.click('#bknext'); await jp.waitForFunction(() => /Wednesday 28 October/.test(document.querySelector('.bknav').textContent));
  const wed = await jp.innerText('#page');
  ok(/Tomorrow · 10:00 AM/i.test(wed) && /Ollie Grant/.test(wed) && !/Sam Carter/.test(wed) && /Not confirmed/i.test(wed) && /Send tomorrow's reminders/.test(wed),
    '› the next day: Tomorrow · Wednesday 28 October, Ollie, not confirmed, 📲 Send tomorrow\'s reminders');
  await jp.click('#bkprev'); await jp.waitForFunction(() => /Tuesday 27 October/.test(document.querySelector('.bknav').textContent));
  await jp.click('#bkprev'); await jp.waitForFunction(() => /Monday 26 October/.test(document.querySelector('.bknav').textContent));
  await jp.click('#bkprev'); await jp.waitForFunction(() => /Friday 23 October/.test(document.querySelector('.bknav').textContent));
  ok(true, '‹ goes back a weekday at a time, skipping the weekend (Monday → Friday)');
  await jp.click('[data-bkmode=week]'); await jp.waitForSelector('#bkwprev');
  let wk = await jp.innerText('#page');
  ok(/Week ending/i.test(wk) && /Sun 25 Oct/.test(wk) && /Nobody booked for this week/.test(wk), 'Week: the week of the day on screen (w/e Sun 25 Oct, nobody booked)');
  await jp.click('#bkwnext'); await jp.waitForFunction(() => /This week/i.test(document.querySelector('.bknav').textContent));
  wk = await jp.innerText('#page');
  ok(/Tue 27 Oct · today/i.test(wk) && /Wed 28 Oct · tomorrow/i.test(wk) && /Sam Carter/.test(wk) && wk.toLowerCase().indexOf('tue 27') < wk.toLowerCase().indexOf('wed 28') &&
    (wk.match(/Ollie Grant/g) || []).length === 2 && await jp.$('.bkremw [data-bkrem="2026-10-28"]') && !(await jp.$('[data-bkrem="2026-10-27"]')),
    '› this week in one go, like All: Tuesday then Wednesday, everyone booked, 📲 Remind on the days still to come');
  await shot(jp, 'b1-week', true);
  // Like the All tab's (Angad, 23 Oct): the week as a PDF, who was booked and who came
  ok((await jp.textContent('.bkpdf')).trim() === '📄 Booked appointments w/e Sun 1 Nov (PDF)', 'Week: "📄 Booked appointments w/e Sun 1 Nov (PDF)", like the All tab\'s');
  await jp.click('.bkpdf'); await jp.waitForSelector('.pdfprev #pdfgo');
  const bTitle = await jp.textContent('.pdfprev .display');
  const [bdl] = await Promise.all([jp.waitForEvent('download'), jp.click('#pdfgo')]);
  await jp.waitForFunction(() => !document.querySelector('.pdfprev'));
  const bPath = `${SHOTS}/b10-booked-week.pdf`; await bdl.saveAs(bPath);
  const bRaw = fs.readFileSync(bPath, 'latin1'), bHas = s => bRaw.includes('(' + s.replace(/[\\()]/g, '\\$&') + ') Tj');
  ok(bTitle === 'Booked Appointments w-e 01.11.2026' && bdl.suggestedFilename() === 'Booked Appointments w-e 01.11.2026.pdf' && /\/Title \(Booked Appointments w-e 01\.11\.2026\)/.test(bRaw) &&
    bHas('Booked appointments · week ending Sunday 1 November 2026') && bHas('Tuesday 27 October') && bHas('Wednesday 28 October') &&
    bHas('Sam Carter') && bHas('Came 09:40') && bHas('Didn\'t come (rebooked)') && bHas('Expected') && bHas('Show-up') && bHas('Came?'),
    '📄 → "Booked Appointments w-e 01.11.2026.pdf": a table per day, confirmed or not, Sam came 09:40, Ollie didn\'t come (rebooked), Wednesday\'s expected');
  let bTxt = ''; try { bTxt = require('child_process').execFileSync('pdftotext', ['-layout', bPath, '-'], { encoding: 'utf8' }); } catch (e) { bTxt = ''; }
  if (bTxt) fs.writeFileSync(`${SHOTS}/b10-booked-week.txt`, bTxt);
  await jp.click('.bkdayh [data-bkday="2026-10-28"]'); await jp.waitForFunction(() => /Wednesday 28 October/.test(document.querySelector('.bknav').textContent));
  ok(await jp.$('.bkmode .chip.on[data-bkmode=day]'), 'tap a day in the week → that day');
  await jp.click('#bkprev'); await jp.waitForFunction(() => /Tuesday 27 October/.test(document.querySelector('.bknav').textContent));
  await jp.click('#bookNew'); await jp.waitForSelector('.bksheet #bkfn');
  await shot(jp, 'b2-book-form');
  await jp.fill('#bkfn', 'Leah'); await jp.fill('#bksn', 'Brown'); await jp.fill('#bkmob', '07700900126');
  await jp.click('#bksave');
  ok(/Pick the day of their presentation/.test(await jp.innerText('#bkerr')), 'no day picked → "Pick the day of their presentation."');
  const days = await jp.$$eval('#bkdays [data-day]', b => b.map(x => x.textContent));
  ok(JSON.stringify(days) === '["Wed 28 Oct","Thu 29 Oct","Fri 30 Oct","Mon 2 Nov","Tue 3 Nov"]', 'the next 5 presentation days, weekends skipped (today\'s 10:00 has gone): ' + days.join(', '));
  await jp.click('[data-day="2026-10-29"]'); await jp.click('.chips[data-name=bksrc] .chip:has-text("Teamtailor")');
  await jp.fill('#bknotes', 'Lives in Slough');
  await jp.click('#bksave'); await jp.waitForSelector('.waprev');
  const prev = await jp.innerText('.waprev');
  ok(/^Hey Leah! 👋/.test(prev) && /Thursday 29th October · 10:00 AM/.test(prev) && !/🧡|💙/.test(prev) && /In association with JUSS Marketing Ltd$/.test(prev.trim()),
    'Next → the confirmation to send: "Hey Leah!", Thursday 29th October · 10:00 AM, no hearts, In association with JUSS Marketing Ltd');
  const href = await jp.getAttribute('.bksheet a.btn.wa', 'href');
  const leahTok = (await api(jess, 'bookingList', {})).items.find(b => b.first_name === 'Leah').confirm_token;
  const leahPage = PUBLIC + 'booked.html?t=' + leahTok + '&n=Leah&d=2026-10-29';
  ok(/^https:\/\/wa\.me\/447700900126\?text=/.test(href) && textOf(href) === CONFIRM_SAM.replace('Sam', 'Leah').replace('Tuesday 27th', 'Thursday 29th').replace('{LINK}', leahPage),
    'the WhatsApp opens to her number with the approved wording, word for word');
  const smsHref = await jp.getAttribute('.bksheet .bksend2 a.btn.sms', 'href');
  ok(await jp.$('.bksheet .bksend2 a.btn.wa') && /^sms:\+447700900126/.test(smsHref) && !/\*/.test(textOf(smsHref)) && /Thursday 29th October · 10:00 AM/.test(textOf(smsHref)),
    'WhatsApp and 📱 Text side by side (not on WhatsApp: text it from the phone), the text without WhatsApp\'s stars');
  ok(!(await jp.$('.deskpaste')) && /^Opens with this ready/.test(await jp.innerText('#bksent')), 'on a phone: no paste note, WhatsApp opens with the message ready');
  await shot(jp, 'b3-send');
  await jp.$eval('.bksheet a.btn.wa', a => { a.addEventListener('click', e => e.preventDefault()); a.click(); });
  await jp.waitForFunction(() => /Sent by you/.test(document.getElementById('bksent').textContent));
  let leah = null; for (let i = 0; i < 25 && !(leah && leah.confirm_at); i++) { leah = (await api(jess, 'bookingList', {})).items.find(b => b.first_name === 'Leah'); if (!leah || !leah.confirm_at) await new Promise(r => setTimeout(r, 200)); }
  ok(leah && leah.confirm_by === 'Jess Grace' && leah.confirm_via === 'whatsapp' && leah.notes === 'Lives in Slough' && leah.slot_date === '2026-10-29', 'tapping Send saves it as sent (by Jess, WhatsApp)');
  await jp.click('#bkdone');
  await jp.click('#bknext'); await jp.waitForSelector('[data-bkrem="2026-10-28"]');
  await jp.click('[data-bkrem="2026-10-28"]'); await jp.waitForSelector('.bksheet [data-bks]');
  const rs = await jp.innerText('.bksheet');
  ok(/TOMORROW · Wednesday 28 October/i.test(rs) && /0 of 1 sent/.test(rs) && /Ollie Grant/.test(rs), 'Tomorrow → 📲 Send tomorrow\'s reminders: the send list ("0 of 1 sent")');
  const remTxt = textOf(await jp.getAttribute('.bksheet a.btn[data-bks]', 'href'));
  // The surer tone (Angad, 12 Nov): they're booked, so nothing asks "still coming?"; the hosts are named; "done by" is the slot + 90
  // minutes; and their short link goes once, alone, as the very last line (WhatsApp shows the first link in a message as a card)
  const ol2B = (await api(jess, 'bookingList', {})).items.find(b => b.first_name === 'Ollie' && b.slot_date === '2026-10-28');
  ok(/^[a-hjkmnp-z2-9]{8}$/.test(ol2B.short_code), 'every booking has a short code for its link: 8 random letters and numbers (' + ol2B.short_code.length + ' characters, none of 0 o 1 l i)');
  ok(remTxt === 'Hey Ollie! 👋\n\n*Tomorrow’s the day!* 🙌\nYour *Appointment Presentation* with *JUSS Marketing*\n\n📅 *Wednesday 28th October · 10:00 AM*\n' +
    '📍 Automotive House, Slough (2 mins from the station)\n🗺️ Map and parking: tap your link below 👇\n\n' +
    '🤝 *Rubal or Jess* will be hosting and expecting you\n💷 Meet the team and see real earnings examples\n⏰ Aim to arrive *10 minutes early* · done by 11:30\n👔 Office wear / smart casual\n\n' +
    'See you tomorrow! 🔥\n\nKind regards,\n*Jess Grace*\nIn association with *JUSS Marketing Ltd*\n\n' + PUBLIC + 'b/' + ol2B.short_code,
    'the reminder, word for word: "Tomorrow’s the day!", Rubal or Jess hosting, real earnings examples, 10 minutes early · done by 11:30, office wear, signed by Jess, then her link');
  ok((remTxt.match(/https?:\/\//g) || []).length === 1 && remTxt.split('\n').pop() === PUBLIC + 'b/' + ol2B.short_code && !/still coming|CONFIRM|\bYES\b|maps\.app/i.test(remTxt),
    'one link in it, alone on the very last line after the sign-off (so WhatsApp makes it the card); no "Still coming? Tap CONFIRM", no second link');
  const rsCard = await jp.innerText('.bksheet');
  ok(/their link turns into a card on top of the message\. Give it a second to appear, then send\./.test(rsCard), 'the send list says the link turns into a card: give it a second, then send');
  // The other two branches, in the same tone: already confirmed (no link, nothing to confirm) and no page at all (reply YES)
  // (the app's own functions, lifted from JS.html, with this booking and Jess's settings)
  const appJs = fs.readFileSync(path.join(__dirname, '..', 'src', 'JS.html'), 'utf8');
  const fnOf = n => { const m = new RegExp('\\nfunction ' + n + '\\([^\\n]*\\{(?:[^\\n]*\\}(?=\\n)|[\\s\\S]*?\\n\\})').exec(appJs); if (!m) throw new Error('no function ' + n + ' in JS.html'); return m[0]; };
  const constOf = n => { const m = new RegExp('\\nconst ' + n + ' = (?:[^\\n]*;(?=\\n)|[\\s\\S]*?\\n\\};)').exec(appJs); if (!m) throw new Error('no const ' + n + ' in JS.html'); return m[0]; };
  const meJ = await api(jess, 'me', {});
  const msgs = new Function('S', ['D', 'addDays', 'fmtOrd', 'fmt12', 'bookCfg', 'bookCo', 'bookHy', 'bookDaysTo', 'bookPage', 'bookLink', 'bookHosts', 'bookDoneBy', 'bookSigner', 'bookSign', 'msgBookRemind', 'msgBookWelcome'].map(fnOf)
    .concat(['DAYS_LONG', 'MONTHS_LONG', 'OFFICES', 'BOOK_DEFAULT'].map(constOf)).join('\n') + '\nreturn { remind: msgBookRemind, welcome: msgBookWelcome };');
  const asJess = () => msgs({ me: JSON.parse(JSON.stringify(meJ)) });
  ok(asJess().remind(ol2B) === remTxt, '(the same message from the app\'s own function, for the other branches)');
  const oneHost = { me: Object.assign(JSON.parse(JSON.stringify(meJ)), {}) }; oneHost.me.book.hosts = ['Sam'];
  const variants = {
    confirmed: asJess().remind(Object.assign({}, ol2B, { confirmed_at: '2026-10-27 12:00:00' })),
    noPage: asJess().remind(Object.assign({}, ol2B, { confirm_token: '', short_code: '' })),
    later: asJess().remind(Object.assign({}, ol2B, { slot_time: '14:00' })),
    hosts: msgs(oneHost).remind(ol2B),
  };
  const four = '🤝 *Rubal or Jess* will be hosting and expecting you\n💷 Meet the team and see real earnings examples\n⏰ Aim to arrive *10 minutes early* · done by 11:30\n👔 Office wear / smart casual\n\n';
  ok(variants.confirmed.includes(four + '✅ You’re confirmed. Anything changes, just message me.\n\nSee you tomorrow! 🔥') && /🗺️ https:\/\/maps\.app\.goo\.gl\//.test(variants.confirmed) &&
    !variants.confirmed.includes('/b/') && /\*JUSS Marketing Ltd\*$/.test(variants.confirmed),
    'already confirmed: the same lines, "✅ You’re confirmed", the map link, and no link to confirm with');
  ok(variants.noPage.includes(four + '👉 Reply *YES* and we’ll have your name ready at the door ✅\n\nSee you tomorrow! 🔥') && /🗺️ https:\/\/maps\.app\.goo\.gl\//.test(variants.noPage) &&
    !/still coming/i.test(variants.noPage) && !/still coming/i.test(variants.confirmed),
    'no page for them: "Reply YES and we’ll have your name ready at the door" (never "if you’re still coming"), the map link');
  ok(/· done by 3:30\n/.test(variants.later) && /· 2:00 PM\*\n/.test(variants.later) && /🤝 \*Sam\* will be hosting and expecting you/.test(variants.hosts),
    '"done by" is their slot + 90 minutes (a 2:00 PM slot → done by 3:30), and the hosts come from the settings (CONFIG.BOOK_HOSTS), not the message');
  await shot(jp, 'b4-reminders');
  await jp.$eval('.bksheet a.btn[data-bks]', a => { a.addEventListener('click', e => e.preventDefault()); a.click(); });
  await jp.waitForFunction(() => /1 of 1 sent/.test(document.getElementById('bkprog').textContent));
  ok(true, 'each tap ticks them off ("1 of 1 sent")');
  await jp.click('#bkdone');

  // Leah taps the link in her WhatsApp: her "You're booked in" page, like Day 1's welcome page, with 🔒 Confirm I'm coming
  n0 = (await getJson('/dev/pushes')).length;
  const lctx = await browser.newContext(PHONE), lp = await lctx.newPage();
  await lp.goto(leahPage.replace(PUBLIC, APP)); await lp.waitForSelector('#conf');
  const lpt = await lp.innerText('#app');
  ok(/You're booked in, Leah/.test(lpt) && /Thursday 29 October/.test(lpt) && /10:00 AM/.test(lpt) && /Automotive House/.test(lpt) && /JUSS Marketing/.test(lpt) && /from Jess/.test(lpt) &&
    await lp.evaluate(() => document.body.dataset.co) === 'JUSS', 'her page: "You\'re booked in, Leah 🎉", Thursday 29 October · 10:00 AM, where, Maps + calendar, JUSS look');
  const cal = await lp.getAttribute('a[href*="calendar.google.com"]', 'href');
  ok(/10:00 AM · approximately 60–90 minutes/.test(lpt) && /dates=20261029T100000\/20261029T113000/.test(cal),
    'how long: "approximately 60–90 minutes" (Angad, 23 Oct; was 1–2 hours), and Add to calendar books 10:00–11:30');
  await shot(lp, 'b9-booked-page', true);
  await lp.click('#conf'); await lp.waitForSelector('.wl-done');
  ok(/locked in\. See you Thursday at 10:00 AM/.test(await lp.textContent('.wl-done')), 'tap 🔒 Confirm I\'m coming → "✅ You\'re locked in. See you Thursday at 10:00 AM! 🔥"');
  let lc = null; for (let i = 0; i < 25 && !(lc && lc.confirmed_at); i++) { lc = (await api(jess, 'bookingList', {})).items.find(b => b.first_name === 'Leah'); if (!lc.confirmed_at) await new Promise(r => setTimeout(r, 200)); }
  ok(lc.confirmed_by === 'CONFIRM' && to(await pushesSince(n0), jessId).some(p => p.body.headings.en === '✅ Leah confirmed Thursday\'s presentation'), 'confirmed in the app, and Jess gets "✅ Leah confirmed Thursday\'s presentation"');
  await lctx.close();

  // Her short link (…/b/<code>, the reminder's last line): the same page, and what WhatsApp reads to draw the card (Angad, 12 Nov)
  const shortUrl = APP + 'b/' + lc.short_code;
  const sHtml = await (await fetch(shortUrl)).text(), sHead = sHtml.split('</head>')[0];
  const meta = (html, p) => (new RegExp('<meta property="' + p + '" content="([^"]*)"').exec(html) || [])[1];
  ok(meta(sHtml, 'og:title') === 'You\'re booked in' && meta(sHtml, 'og:description') === 'Tap to confirm you\'re coming. Rubal or Jess will have your name ready at the door.' &&
    meta(sHtml, 'og:image') === PUBLIC + 'img/og-booked-juss.jpg' && /<meta name="twitter:card" content="summary_large_image">/.test(sHead) && sHtml.indexOf('og:title') < sHtml.indexOf('<script src='),
    'the short link\'s page, as first served (no JavaScript): og:title "You\'re booked in", og:description "Tap to confirm you\'re coming. Rubal or Jess will have your name ready at the door.", the JUSS card image');
  ok(!/Leah|Brown|07700900126|7700900126|2026-10-29|29 Oct/i.test(sHtml) && sHtml.indexOf(lc.confirm_token) < 0 && !/property="og:url"/.test(sHtml) && /<meta name="robots" content="noindex, nofollow">/.test(sHead) &&
    !/leah|brown|900126/i.test(lc.short_code),
    'nothing about her in the tags or the code: no name, mobile, day or token; no og:url (the card opens the link that was sent); still noindex');
  const img = fs.statSync(path.join(__dirname, '..', '..', 'join', 'img', 'og-booked-juss.jpg')), imgL = fs.statSync(path.join(__dirname, '..', '..', 'join', 'img', 'og-booked-link.jpg'));
  ok(img.size > 10000 && img.size < 300000 && imgL.size > 10000 && imgL.size < 300000, 'the card images are in the build, JUSS and LINK, under 300 KB each (WhatsApp\'s limit): ' + Math.round(img.size / 1024) + ' KB and ' + Math.round(imgL.size / 1024) + ' KB');
  const sctx = await browser.newContext(PHONE), sp = await sctx.newPage();
  await sp.goto(shortUrl); await sp.waitForSelector('.wl-done');
  const spt = await sp.innerText('#app');
  ok(/You're booked in, Leah/.test(spt) && /Thursday 29 October/.test(spt) && /10:00 AM/.test(spt) && /locked in\. See you Thursday at 10:00 AM/.test(spt) && await sp.$('a[href*="maps.app.goo.gl"]') &&
    await sp.evaluate(() => getComputedStyle(document.querySelector('.wl-hero h1')).fontFamily.indexOf('Anton') >= 0 && !!document.querySelector('link[href^="app.css"]').sheet),
    'the short link opens the same "You\'re booked in, Leah" page: her day, the map button, already locked in, styles and fonts loaded');
  const lHtml = await (await fetch(APP + 'bl/' + lc.short_code)).text();
  ok(meta(lHtml, 'og:image') === PUBLIC + 'img/og-booked-link.jpg' && meta(lHtml, 'og:title') === 'You\'re booked in' && /class="t-LINK"/.test(lHtml), 'a LINK booking\'s link (…/bl/<code>) has the LINK card');
  const longHtml = await (await fetch(APP + 'booked.html')).text();
  ok(meta(longHtml, 'og:title') === 'You\'re booked in' && meta(longHtml, 'og:image') === PUBLIC + 'img/og-booked-juss.jpg' && !/<base /.test(longHtml) && /<base href="\/join\/">/.test(sHtml),
    'the long booked.html?t=… links (already sent) work as before and get the same card');
  await sp.goto(APP + 'b/zzzzzzzz'); await sp.waitForFunction(() => /link has expired/.test(document.body.innerText));
  ok(!(await sp.$('#conf')) && !/booked in,/.test(await sp.innerText('body')) && /link has expired/.test(await refused('', 'bookingInfo', { t: lc.short_code.slice(0, 7) })) &&
    /link has expired/.test(await refused('', 'bookingInfo', { t: '' })),
    'a made-up or cut-off code opens nothing: "This link has expired…"');
  await sctx.close();

  // Booked on another device (Angad, 23 Oct: booked Lucy on the laptop, couldn't open her on the phone). It shows up on Jess's
  // phone by itself (Angad, 23 Oct: "it should keep updating whenever someone books more people"), and opens with one tap
  await jp.click('[data-bkmode=week]'); await jp.waitForSelector('#bkwprev');
  await api(angad, 'saveBooking', { booking: { first_name: 'Lucy', last_name: 'Smith', mobile: '07700900130', slot_date: '2026-10-28' } });
  const t0 = Date.now(); await jp.waitForSelector('.bkrow:has-text("Lucy Smith")', { timeout: 25000 });
  ok(Date.now() - t0 < 20000, 'Week open on Jess\'s phone: Lucy, booked by Angad on his laptop, appears by itself (' + Math.round((Date.now() - t0) / 1000) + ' s, no refresh)');
  await jp.tap('.bkrow:has-text("Lucy Smith") .name'); await jp.waitForSelector('.bksheet .bkinfo');
  ok(/Booked by Angad Oshan/.test(await jp.innerText('.bksheet')) && /Lucy Smith/.test(await jp.innerText('.bksheet')), 'first and last name; tapping her opens the booking made on another device');
  await jp.click('#bkc'); await jp.waitForSelector('.bksheet .bksend2 a.btn.sms');
  ok(/Hey Lucy!/.test(textOf(await jp.getAttribute('.bksheet .bksend2 a.btn.sms', 'href'))), '→ 💬 Send the confirmation → 📱 Text: her confirmation by text from the phone');
  await jp.click('#bkdone'); await jp.waitForSelector('.bkrow:has-text("Lucy Smith") .markyes');
  // Two statuses and one button (Angad, 23 Oct: "Not confirmed, They replied Yes, Confirmed… too confusing")
  const lrow = await jp.innerText('.bkrow:has-text("Lucy Smith") .pills');
  ok(/⏳ Not confirmed yet/.test(lrow) && /✅ Mark as confirmed/.test(lrow) && !/They replied Yes/.test(lrow) &&
    await jp.$eval('.bkrow:has-text("Lucy Smith") .markyes', b => b.tagName === 'BUTTON' && b.classList.contains('btn') && !b.classList.contains('pill')),
    'a row says ⏳ Not confirmed yet, with a ✅ Mark as confirmed button (a white button, not a status pill)');
  await jp.click('.bkrow:has-text("Lucy Smith") .markyes'); await jp.waitForSelector('.bkrow:has-text("Lucy Smith") .pill.green:has-text("Confirmed")');
  ok(!(await jp.$('.bkrow:has-text("Lucy Smith") .markyes')) && !/not sent/i.test(await jp.innerText('.bkrow:has-text("Lucy Smith") .pills')) &&
    (await api(jess, 'bookingList', {})).items.find(b => b.first_name === 'Lucy').confirmed_by === 'Jess Grace',
    'Mark as confirmed (she said yes on WhatsApp) → ✅ Confirmed, the button and "not sent" go, saved as confirmed by Jess');
  await shot(jp, 'b11-confirmed', true);
  await jp.context().close();

  // The 18:00 alert, tapped: the send list opens by itself
  const jp2 = await as(jess, APP + 'index.html?c=bookrem');
  await jp2.waitForSelector('.bksheet [data-bks], .bksheet .pill.green', { timeout: 15000 });
  ok(/Reminders/.test(await jp2.innerText('.bksheet')) && await jp2.$('.tabbar button.on[data-tab=book]'), 'tapping the 18:00 alert opens Book Appts with the reminders ready');
  await jp2.context().close();

  // Someone who didn't come: "sorry we missed you" + rebook, straight from Today
  await setTime('2026-10-28T10:40:00+00:00');
  const ap = await as(angad);
  await ap.click('.tabbar button[data-tab=book]'); await ap.waitForSelector('.bkrow');
  const missRow = await ap.innerText('.bkrow:has-text("Ollie")');
  ok(/Didn't come/.test(missRow) && await ap.$('.bkrow:has-text("Ollie") a[data-kind=missed]') && await ap.$('.bkrow:has-text("Ollie") [data-bkre]'), 'Wed 10:40, Ollie didn\'t come again → "Sorry we missed you" + 📅 Rebook on his row');
  const missTxt = textOf(await ap.getAttribute('.bkrow:has-text("Ollie") a.btn[data-kind=missed]', 'href'));
  ok(missTxt === 'Hey Ollie! 👋\n\nWe missed you at your *Appointment Presentation* today 😕 Everything OK?\n\nYour spot isn’t gone: let’s get you *rebooked* 📅\n' +
    'We run presentations *Monday to Friday at 10:00 AM*.\n\n👉 Which day suits you? Just reply here 💬\n\nKind regards,\n*Angad Oshan*\nIn association with *JUSS Marketing Ltd*',
    'the "sorry we missed you", signed by Angad');
  await shot(ap, 'b5-didnt-come', true);
  await ap.click('.bkrow:has-text("Ollie") [data-bkre]'); await ap.waitForSelector('.bksheet #bkfn');
  const rbv = [await ap.inputValue('#bkfn'), await ap.inputValue('#bkmob'), await ap.innerText('.bksheet .label')];
  ok(rbv[0] === 'Ollie' && rbv[1] === '07700900124' && /Rebook/i.test(rbv[2]), '📅 Rebook opens the form with his details filled in ' + JSON.stringify(rbv));
  await ap.click('#bkdone');
  await ap.click('.bkrow:has-text("Ollie") .name'); await ap.waitForSelector('.bksheet .bkinfo');
  ok(/Booked by Angad Oshan/.test(await ap.innerText('.bksheet')), 'tapping a name opens the booking: who booked them, when, what\'s been sent');
  await ap.context().close();

  // The check-in page: their mobile finds the booking
  await setTime('2026-10-29T09:45:00+00:00');
  const cctx = await browser.newContext(PHONE), cp = await cctx.newPage();
  await cp.goto(APP + 'checkin.html'); await cp.waitForSelector('#f');
  await cp.fill('[name=full_name]', 'Leah Brown'); await cp.fill('[name=mobile]', '07700 900126');
  await cp.waitForSelector('.bkfound');
  ok(/Found your booking: today 10:00 AM, booked by Jess Grace/.test(await cp.textContent('.bkfound')) && /Jess Grace/.test(await cp.textContent('#bk .picked')) && await cp.evaluate(() => document.body.dataset.co) === 'JUSS',
    'Leah types her mobile → "✓ Found your booking: today 10:00 AM, booked by Jess Grace", Jess filled in, JUSS look');
  await shot(cp, 'b6-checkin-found');
  await cp.fill('[name=email]', 'leah@example.com'); await cp.click('.chips[data-name=over18] .chip:has-text("Yes")');
  await cp.selectOption('[name=rtw]', 'British or Irish citizen'); await cp.check('[name=privacy_ok]');
  await cp.click('#go'); await cp.waitForSelector('text=You\'re checked in');
  let lb = null; for (let i = 0; i < 25 && !(lb && lb.status === 'came'); i++) { lb = (await api(jess, 'bookingList', {})).items.find(b => b.first_name === 'Leah'); if (lb.status !== 'came') await new Promise(r => setTimeout(r, 200)); }
  ok(lb.status === 'came', 'checked in → her booking says she came');
  await cctx.close();

  // Show-up by where they applied (Angad, 12 Nov): this week and the last 4 weeks, most came first, adding up to the card's totals.
  // Earlier weeks' bookings, as Hyrre's sources name them (and three that must not count: 5 weeks back, a Saturday, cancelled)
  const weNow = (await api(satpal, 'payReport', {})).weekEnding;
  const dayOf = (we, back, wd) => { const d = new Date(we + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 7 * back - 7 + wd); return d.toISOString().slice(0, 10); };  // wd 1 = Monday
  const old = [[1, 1, 'Job Ad #1', 'came'], [1, 2, 'Job Ad #1', 'booked'], [1, 3, 'Hirematic', 'came'], [2, 2, 'Job Ad #2', 'no_show'], [2, 4, 'Job Ad #1', 'came'], [3, 5, 'Teamtailor', 'booked'],
    [3, 1, 'Hirematic', 'cancelled'], [2, 6, 'Job Ad #1', 'came'], [4, 3, 'Job Ad #1', 'came']];
  await post('/dev/eval', { js: `(() => { ${JSON.stringify(old.map(o => ({ d: dayOf(weNow, o[0], o[1]), s: o[2], st: o[3] })))}.forEach((o, i) => appendRow('Bookings', { id: 'old' + i, created_at: o.d + ' 09:00:00',
    booked_by_id: 'hyrremegan', booked_by: 'Megan Hyrre', first_name: 'Old' + i, last_name: 'Row', mobile: '0770090030' + i, source: o.s, notes: '', slot_date: o.d, slot_time: '10:00', company: 'JUSS', status: o.st })); return 'ok'; })()` });
  const sw = [0, 1, 2, 3].map(k => { const d = new Date(weNow + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 7 * k); return d.toISOString().slice(0, 10); });
  const weeks = []; for (const w of sw) weeks.push((await api(satpal, 'payReport', { weekEnding: w })).showup);
  const suNow = weeks[0], bs = suNow.bySource, sum = (l, f) => l.reduce((a, x) => a + f(x), 0);
  ok(bs && sum(bs.rows, r => r.week.booked) === suNow.booked && sum(bs.rows, r => r.week.came) === suNow.came && suNow.booked > 0 &&
    JSON.stringify(bs.rows.filter(r => r.week.booked).map(r => [r.source, r.week.booked, r.week.came]).sort()) === JSON.stringify(suNow.sources.map(x => [x.source, x.booked, x.came]).sort()),
    'show-up by source, this week: the sources add up to the card\'s totals (' + suNow.came + ' of ' + suNow.booked + ' came) and match "where they applied"');
  ok(sum(bs.rows, r => r.four.booked) === bs.four.booked && sum(bs.rows, r => r.four.came) === bs.four.came && bs.four.booked === sum(weeks, w => w.booked) && bs.four.came === sum(weeks, w => w.came) &&
    bs.four.booked === suNow.booked + 6 && bs.four.came === suNow.came + 3,
    'the last 4 weeks: the sources add up to its total, which is the four weeks\' cards added together (' + bs.four.came + ' of ' + bs.four.booked + '); 5 weeks back, a Saturday and a cancelled booking don\'t count');
  const ja1 = bs.rows.find(r => r.source === 'Job Ad #1'), ja2 = bs.rows.find(r => r.source === 'Job Ad #2');
  ok(ja1 && ja1.four.booked === 3 && ja1.four.came === 2 && ja1.week.booked === 0 && ja2.four.booked === 1 && ja2.four.came === 0 &&
    bs.rows.every((r, i) => !i || bs.rows[i - 1].week.came > r.week.came || (bs.rows[i - 1].week.came === r.week.came && bs.rows[i - 1].four.came >= r.four.came)),
    'Job Ad #1: 2 of 3 came over the 4 weeks, Job Ad #2: 0 of 1; sorted by who came (this week, then the 4 weeks): ' + bs.rows.map(r => r.source + ' ' + r.week.came + '/' + r.four.came).join(', '));
  // Show-up for admins, on Appts Attended
  const spp = await as(satpal);
  await spp.click('.tabbar button[data-tab=pay]'); await spp.waitForSelector('.showup');
  const sut = await spp.innerText('.showup');
  const srcRows = await spp.$$eval('.susrc tr', l => l.map(tr => [...tr.children].map(td => td.textContent)));
  ok(JSON.stringify(srcRows[0]) === '["","This week","Last 4 weeks"]' && JSON.stringify(srcRows[1]) === '["Source","Booked","Came","%","Booked","Came","%"]' &&
    JSON.stringify(srcRows.find(r => r[0] === 'Job Ad #1')) === '["Job Ad #1","0","0","–","3","2","67%"]' &&
    JSON.stringify(srcRows[srcRows.length - 1].slice(0, 3)) === JSON.stringify(['All', String(suNow.booked), String(suNow.came)]) &&
    JSON.stringify(srcRows[srcRows.length - 1].slice(4, 6)) === JSON.stringify([String(bs.four.booked), String(bs.four.came)]) &&
    await spp.evaluate(() => document.querySelector('.susrc').scrollWidth <= document.querySelector('.showup').clientWidth),
    'on the card: Source | This week (Booked · Came · %) | Last 4 weeks (Booked · Came · %), "Job Ad #1 … 3 · 2 · 67%", and an "All" row with the card\'s totals; it fits a phone');
  ok(/Jess Grace/.test(sut) && /Angad Oshan/.test(sut) && /Teamtailor/.test(sut) && !(await spp.$('.tabbar button[data-tab=book]')) && await spp.$('.tabbar button[data-tab=team]'), 'Satpal (admin): the 📅 Show-up card on Appts Attended; no Book Appts tab (he isn\'t on the booking team), Team stays a tab');
  await shot(spp, 'b7-showup', true);
  // A week nobody counts for yet (next week, looked at now; a Monday before 10:30 is the same): the card stays, for the 4 weeks by source
  const nextWe = (() => { const d = new Date(weNow + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 7); return d.toISOString().slice(0, 10); })();
  const suNext = (await api(satpal, 'payReport', { weekEnding: nextWe })).showup;
  const cardOf = new Function('S', 'h', 'fmt', 'addDays', 'weekEndingOf', 'bookCfg', fnOf('showupCard') + '\nreturn showupCard;')({ me: { today: nextWe } }, x => String(x), x => x, (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }, d => d, () => ({ missed: '10:30' }));
  const nextCard = cardOf(suNext);
  ok(suNext.booked === 0 && suNext.bySource.four.booked === bs.four.booked - 1 && sum(suNext.bySource.rows, r => r.four.booked) === suNext.bySource.four.booked &&
    /nobody counted yet this week/.test(nextCard) && /<td>Job Ad #1<\/td><td>0<\/td><td>0<\/td><td><b>–<\/b><\/td><td class="g2">3<\/td><td>2<\/td>/.test(nextCard) && !/Booked by/.test(nextCard) &&
    cardOf({ rows: [], sources: [], booked: 0, came: 0, bySource: { from: 'a', to: 'b', rows: [], four: { booked: 0, came: 0 } } }) === '',
    'a week with nobody counted yet still shows the card for its 4 weeks by source ("nobody counted yet this week", Job Ad #1 2 of 3); nothing at all in 4 weeks: no card');
  await spp.context().close();

  // On a laptop: WhatsApp's computer app turns pre-filled emojis into "�" (Angad, 23 Oct: Jake's confirmation from the laptop).
  // There the button copies the message and opens the chat empty, to paste in; on a phone the message is pre-filled as before.
  const jake = await api(angad, 'saveBooking', { booking: { first_name: 'Jake', last_name: 'Hill', mobile: '07700900131', slot_date: '2026-10-30' } });
  const dctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  await dctx.addInitScript(t => { try { if (!localStorage.getItem('lr_tok')) localStorage.setItem('lr_tok', JSON.stringify(t)); } catch (e) {} }, angad);
  const dp = await dctx.newPage(); await dp.goto(APP + 'index.html'); await dp.waitForSelector('.tabbar button[data-tab=book]');
  await dp.click('.tabbar button[data-tab=book]'); await dp.click('[data-bkmode=week]'); await dp.waitForSelector('.bkrow:has-text("Jake Hill")');
  await dp.click('.bkrow:has-text("Jake Hill") .name'); await dp.waitForSelector('#bkc'); await dp.click('#bkc'); await dp.waitForSelector('.bksheet .bksend2 a.btn.wa');
  ok(/opens the chat empty with the message copied: click the message box, press Ctrl\+V, then Send/.test(await dp.innerText('.bksheet .deskpaste')) && !/Opens with this ready/.test(await dp.innerText('#bksent')),
    'on a laptop the sheet says so before you press it: WhatsApp opens empty, press Ctrl+V (Angad, 23 Oct: "the whole details are wiped off")');
  const full = await dp.getAttribute('.bksheet .bksend2 a.btn.wa', 'href');
  await dp.$eval('.bksheet .bksend2 a.btn.wa', a => { a.addEventListener('click', e => { window.__href = a.getAttribute('href'); e.preventDefault(); }); a.click(); });
  await dp.waitForFunction(() => /paste it into WhatsApp/.test((document.getElementById('toast') || {}).textContent || ''));
  const clip = (await dp.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n');  // Windows reads it back with \r\n
  ok(await dp.evaluate(() => window.__href) === 'https://wa.me/447700900131' && clip === textOf(full) && /^Hey Jake! 👋/.test(clip) && /📅 \*Friday 30th October · 10:00 AM\*/.test(clip),
    'on a laptop, 💬 WhatsApp copies the message (every emoji intact) and opens the chat empty: "📋 Copied the message: paste it into WhatsApp"');
  await dp.waitForTimeout(3000);
  ok(await dp.getAttribute('.bksheet .bksend2 a.btn.wa', 'href') === full, 'the button keeps its message for next time');
  ok(await dp.isVisible('#pastebar') && /Message copied\. In WhatsApp, click the message box, press Ctrl\+V, then Send\./.test(await dp.innerText('#pastebar')) && await dp.isHidden('#toast'),
    'and after: "Message copied… press Ctrl+V" stays on screen once the toast has gone, for when you come back from an empty chat');
  await shot(dp, 'b8-laptop-paste');
  await dp.click('#pastebar button'); ok(await dp.isHidden('#pastebar'), '"Got it" closes it');
  let jk = null; for (let i = 0; i < 25 && !(jk && jk.confirm_at); i++) { jk = (await api(angad, 'bookingList', {})).items.find(b => b.id === jake.id); if (!jk.confirm_at) await new Promise(r => setTimeout(r, 200)); }
  ok(jk.confirm_via === 'whatsapp' && jk.confirm_by === 'Angad Oshan', 'and it still counts as sent on WhatsApp');
  await dctx.close();

  // A booked person types another mobile than the one on their booking (Angad, 26 Oct: "make sure booked appointments,
  // when they check in, go on the list properly"): today's booking under the same full name, only if it's the only one
  console.log('check-in: a different mobile from the booking');
  await setTime('2026-11-02T09:45:00+00:00');  // Monday
  const form = (nm, mob) => ({ form: { full_name: nm, mobile: mob, email: mob + '@example.com', over18: 'Yes', rtw: 'British or Irish citizen', privacy_ok: true, source: 'Indeed' } });
  const priya = await api(rubal, 'saveBooking', { booking: { first_name: 'Priya', last_name: 'Patel', mobile: '07700900140', slot_date: '2026-11-02', notes: 'Retail background' } });
  const pci = await api('', 'checkin', form('  priya   PATEL ', '07700900199'));
  const pc = await api(angad, 'getCandidate', { id: pci.id }), pb = (await api(rubal, 'bookingList', {})).items.find(b => b.id === priya.id);
  ok(pci.company === 'JUSS' && pc.booker_id === rubalId && pc.booking_id === priya.id && pc.booking_note === 'Retail background' && pb.status === 'came' && pb.candidate_id === pci.id,
    'Priya types 07700900199 (booked as 07700900140): her booking is found by her name, credited to Rubal, the notes from the call, booking → came');
  const other = await api('', 'checkin', form('Priyanka Patel', '07700900198'));
  ok(!(await api(angad, 'getCandidate', { id: other.id })).booking_id, 'someone else (Priyanka Patel, no booking) isn\'t matched to anyone\'s booking');
  await api(jess, 'saveBooking', { booking: { first_name: 'Ali', last_name: 'Khan', mobile: '07700900150', slot_date: '2026-11-02' } });
  await api(angad, 'saveBooking', { booking: { first_name: 'Ali', last_name: 'Khan', mobile: '07700900151', slot_date: '2026-11-02' } });
  const ali = await api('', 'checkin', form('Ali Khan', '07700900152'));
  ok(!(await api(angad, 'getCandidate', { id: ali.id })).booking_id, 'two Ali Khans booked today and a third number: no guessing (by mobile only)');
  await api(jess, 'saveBooking', { booking: { first_name: 'Tom', last_name: 'Reed', mobile: '07700900160', slot_date: '2026-11-03' } });
  const tom = await api('', 'checkin', form('Tom Reed', '07700900161'));
  ok(!(await api(angad, 'getCandidate', { id: tom.id })).booking_id, 'by name only for today\'s bookings (Tom is booked for tomorrow)');
  const benie = await api(jess, 'saveBooking', { booking: { first_name: 'Benie', last_name: 'Bofoya', mobile: '07700900170', slot_date: '2026-11-02' } });
  const beni = await api('', 'checkin', form('Beni Bofoya', '07700900171'));
  ok((await api(angad, 'getCandidate', { id: beni.id })).booking_id === benie.id && (await api(jess, 'bookingList', {})).items.find(b => b.id === benie.id).status === 'came',
    'a name a letter out ("Beni" booked as "Benie", another mobile) still finds today\'s booking (30 Oct: Sitar / Sitara)');
  await browser.close();
  require('./watch').report(pageErrors); passed++;

  console.log('GDPR');
  await setTime('2027-01-28T03:00:00+00:00'); await post('/dev/run', { fn: 'dailyMaintenance' });
  const bt = await getJson('/dev/sheet?name=Bookings'), iN = bt[0].indexOf('notes');
  ok(bt.length > 1 && bt.slice(1).every(r => !r[iN]), 'after 12 weeks a booking keeps who and when; the notes from the call go');
  await setTime('2027-05-08T03:00:00+00:00'); await post('/dev/run', { fn: 'dailyMaintenance' });
  ok((await getJson('/dev/sheet?name=Bookings')).length === 1, 'after 6 months every booking is deleted');

  console.log('\nALL ' + passed + ' ✓');
  process.exit(0);
})().catch(e => { console.error('\n✗ ' + (e && e.message)); process.exit(1); });
