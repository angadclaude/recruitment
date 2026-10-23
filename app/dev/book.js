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
  '📅 *Tuesday 27th October · 10:00 AM*\n⏱️ About 1–2 hours\n\n' +
  '📍 *Where*\nJUSS Marketing, 2nd Floor East\nAutomotive House, Grays Place, Slough SL2 5AF\n🗺️ https://maps.app.goo.gl/zeP4MjS2hMJzB9V9A\n' +
  '🚗 Parking right outside the main entrance\n🚆 By train? Exit Slough station from *platform 5*\n\n' +
  '👔 *Dress code:* office wear / smart casual\n📄 *Documents:* none needed yet 🙌\n\n👉 Reply *YES* to lock in your spot ✅\n\n' +
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
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (...a) => { const ctx = await newContext(...a); CONTEXTS.push(ctx); await ctx.clock.setSystemTime(new Date(Date.now() + CLOCK_OFF)); return ctx; };
  const as = async (tok, url) => {
    const ctx = await browser.newContext(PHONE);
    await ctx.addInitScript(t => { try { if (!localStorage.getItem('lr_tok')) localStorage.setItem('lr_tok', JSON.stringify(t)); } catch (e) {} }, tok);
    const p = await ctx.newPage(); await p.goto(url || APP + 'index.html'); await p.waitForSelector('.tabbar button'); return p;
  };
  await setTime('2026-10-27T13:00:00+00:00');  // Tuesday afternoon
  const jp = await as(jess);
  await jp.waitForSelector('#bookNew');
  ok(await jp.$('.tabbar button.on[data-tab=today]') && /Book a presentation/.test(await jp.textContent('#bookNew')), 'Jess\'s Today page: 📅 Book a presentation');
  const exp = await jp.innerText('#page');
  ok(/Booked · 10:00|Expected today · 10:00/i.test(exp) && /Sam Carter/.test(exp) && /Checked in 09:40/.test(exp) && /Ollie Grant/.test(exp) && /Rebooked/.test(exp) && /Coming up/i.test(exp),
    'Expected today: Sam 🎓 checked in 09:40, Ollie didn\'t come (rebooked); Coming up lists Wednesday');
  await shot(jp, 'b1-today', true);
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
  ok(/^https:\/\/wa\.me\/447700900126\?text=/.test(href) && textOf(href) === CONFIRM_SAM.replace('Sam', 'Leah').replace('Tuesday 27th', 'Thursday 29th'),
    'the WhatsApp opens to her number with the approved wording, word for word');
  await shot(jp, 'b3-send');
  await jp.$eval('.bksheet a.btn.wa', a => { a.addEventListener('click', e => e.preventDefault()); a.click(); });
  await jp.waitForFunction(() => /Sent by you/.test(document.getElementById('bksent').textContent));
  let leah = null; for (let i = 0; i < 25 && !(leah && leah.confirm_at); i++) { leah = (await api(jess, 'bookingList', {})).items.find(b => b.first_name === 'Leah'); if (!leah || !leah.confirm_at) await new Promise(r => setTimeout(r, 200)); }
  ok(leah && leah.confirm_by === 'Jess Grace' && leah.confirm_via === 'whatsapp' && leah.notes === 'Lives in Slough' && leah.slot_date === '2026-10-29', 'tapping Send saves it as sent (by Jess, WhatsApp)');
  await jp.click('#bkdone');
  await jp.waitForSelector('[data-bkrem="2026-10-28"]');
  await jp.click('[data-bkrem="2026-10-28"]'); await jp.waitForSelector('.bksheet [data-bks]');
  const rs = await jp.innerText('.bksheet');
  ok(/TOMORROW · Wednesday 28 October/i.test(rs) && /0 of 1 sent/.test(rs) && /Ollie Grant/.test(rs), 'Coming up → 📲 Remind: tomorrow\'s send list ("0 of 1 sent")');
  const remTxt = textOf(await jp.getAttribute('.bksheet a.btn[data-bks]', 'href'));
  ok(remTxt === 'Hey Ollie! 👋\n\n*Tomorrow’s the day!* 🙌\nYour *Appointment Presentation* with *JUSS Marketing*\n\n📅 *Wednesday 28th October · 10:00 AM*\n' +
    '📍 Automotive House, Slough (2 mins from the station)\n🗺️ https://maps.app.goo.gl/zeP4MjS2hMJzB9V9A\n\n⏰ Aim to arrive *10 minutes early*\n👔 Office wear / smart casual\n\n' +
    '👉 Reply *YES* if you’re still coming ✅\n\nSee you tomorrow! 🔥\n\nKind regards,\n*Jess Grace*\nIn association with *JUSS Marketing Ltd*', 'the reminder: "Tomorrow’s the day!", signed by Jess');
  await shot(jp, 'b4-reminders');
  await jp.$eval('.bksheet a.btn[data-bks]', a => { a.addEventListener('click', e => e.preventDefault()); a.click(); });
  await jp.waitForFunction(() => /1 of 1 sent/.test(document.getElementById('bkprog').textContent));
  ok(true, 'each tap ticks them off ("1 of 1 sent")');
  await jp.click('#bkdone');
  await jp.context().close();

  // The 18:00 alert, tapped: the send list opens by itself
  const jp2 = await as(jess, APP + 'index.html?c=bookrem');
  await jp2.waitForSelector('.bksheet [data-bks], .bksheet .pill.green', { timeout: 15000 });
  ok(/Reminders/.test(await jp2.innerText('.bksheet')), 'tapping the 18:00 alert opens Today with the reminders ready');
  await jp2.context().close();

  // Someone who didn't come: "sorry we missed you" + rebook, straight from Today
  await setTime('2026-10-28T10:40:00+00:00');
  const ap = await as(angad);
  await ap.waitForSelector('.bkrow');
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

  // Show-up for admins, on Appts Attended
  const spp = await as(satpal);
  await spp.click('.tabbar button[data-tab=pay]'); await spp.waitForSelector('.showup');
  const sut = await spp.innerText('.showup');
  ok(/Jess Grace/.test(sut) && /Angad Oshan/.test(sut) && /Teamtailor/.test(sut) && !(await spp.$('#bookNew')), 'Satpal (admin): the 📅 Show-up card on Appts Attended; no Book button (he isn\'t on the booking team)');
  await shot(spp, 'b7-showup', true);
  await spp.context().close();
  await browser.close();

  console.log('GDPR');
  await setTime('2027-01-28T03:00:00+00:00'); await post('/dev/run', { fn: 'dailyMaintenance' });
  const bt = await getJson('/dev/sheet?name=Bookings'), iN = bt[0].indexOf('notes');
  ok(bt.length > 1 && bt.slice(1).every(r => !r[iN]), 'after 12 weeks a booking keeps who and when; the notes from the call go');
  await setTime('2027-05-01T03:00:00+00:00'); await post('/dev/run', { fn: 'dailyMaintenance' });
  ok((await getJson('/dev/sheet?name=Bookings')).length === 1, 'after 6 months every booking is deleted');

  console.log('\nALL ' + passed + ' ✓');
  process.exit(0);
})().catch(e => { console.error('\n✗ ' + (e && e.message)); process.exit(1); });
