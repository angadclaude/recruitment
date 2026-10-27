// Megan's bookings from Hyrre (Angad, 27 Oct): the 08:30 pull hands J&L Slough's approved appointments with a one-time ticket;
// they show on Book Appts as booked by Megan Hyrre (or by Rubal / Jess when Hyrre's note says so), Hyrre sends their messages,
// check-in finds them, Megan's alerts go to Rubal and Jess, and a weekday with no pull by 09:15 tells the booking team.
// Usage: node app/build.js && node app/dev/hyrre.js <screenshot-dir>   (JL_BACKEND=pg: on the Supabase back end)
'use strict';
const { chromium } = require('playwright');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const PORT = 8794, BASE = 'http://localhost:' + PORT, APP = BASE + '/join/';
const SHOTS = process.argv[2] || './shots-hyrre';
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
const runEval = async js => (await post('/dev/eval', { js })).out;

const KEY = 'test-sync-key-' + crypto.randomBytes(8).toString('hex');
const WINDOW = { from: '2026-10-19', to: '2026-12-10' };
// What scripts/hyrre-pull.js sends: one line per application with an appointment (Slough, pipeline 403)
const item = (id, name, phone, date, extra) => Object.assign({ id, name, phone, date, time: '10:00', approval: 'approved', attendance: 'none', note: '', source: 'Hirematic', archived: false, active: true }, extra || {});
const FIRST = [
  item('h1', 'AISHA KHAN', '+447700900201', '2026-10-27'),                          // Megan
  item('h2', 'ben cole', '07700 900202', '2026-10-27', { note: 'Booked by Rubal' }),  // Rubal, by hand in Hyrre
  item('h3', 'Cara Doe', '07700900203', '2026-10-27', { approval: 'pending' }),      // pencilled in, not approved yet
  item('h4', 'Dan Ely', '+447700900204', '2026-10-28', { note: 'Booked by Jess' }),  // Jess
  item('h5', 'Eva Fox', '+49151234567', '2026-10-28'),                              // not a UK mobile
  item('h6', 'Finn Gray', '07700900206', '2026-10-28', { archived: true }),          // archived in Hyrre
  item('h7', 'Gus Hale', '07700900207', '2026-10-27'),                              // Megan, until Jess's note turns up
  item('h8', 'Hana Iqbal', '07700900208', '2026-10-27'),                            // Megan: comes on the day
  item('h9', 'Ian Jones', '07700900209', '2026-10-27', { source: 'Indeed' }),        // Megan: doesn't come
];

(async () => {
  await ready;
  console.log('setup (' + (process.env.JL_BACKEND === 'pg' ? 'Supabase back end' : 'Google back end') + ')');
  await post('/dev/run', { fn: 'setup' });
  await post('/dev/props', { ONESIGNAL_APP_ID: 'test-app', ONESIGNAL_API_KEY: 'test-key' });
  await setTime('2026-10-26T09:20:00+00:00');  // Monday 26 Oct, 09:20 London
  const angad = await loginApi('angad@linkmarketing.org.uk'), jess = await loginApi('jess@linkmarketing.org.uk');
  const rubal = await loginApi('rubal@jussmarketing.co.uk'), satpal = await loginApi('satpal@jussmarketing.co.uk');
  const users = (await api(angad, 'listUsers')).users, idOf = re => users.find(u => re.test(u.email)).id;
  const angadId = idOf(/angad/), jessId = idOf(/jess/), rubalId = idOf(/rubal/), satpalId = idOf(/satpal/);

  console.log('the key and the one-time ticket');
  let n0 = (await getJson('/dev/pushes')).length;
  await post('/dev/run', { fn: 'keepWarm' });
  ok(!(await pushesSince(n0)).some(p => /Hyrre/.test(p.body.headings.en)), 'before the first pull: no "didn\'t come in" alert (not set up yet)');
  ok(await refused('', 'hyrreTicket', { key: KEY }) === 'Wrong key.', 'no key set up in J&L: no ticket ("Wrong key.")');
  await post('/dev/props', { HYRRE_SYNC_SHA256: crypto.createHash('sha256').update(KEY).digest('hex') });
  ok(await refused('', 'hyrreTicket', { key: 'guess' }) === 'Wrong key.' && await refused('', 'hyrreTicket', {}) === 'Wrong key.', 'a wrong or missing key: no ticket');
  const ticket = async () => (await api('', 'hyrreTicket', { key: KEY })).ticket;
  const t1 = await ticket();
  ok(/^[0-9a-f]{64}$/.test(t1), 'the key from .env.hyrre → a one-time ticket');
  ok(/run out or was used/.test(await refused('', 'hyrreImport', { ticket: 'made-up', pipeline: '403', window: WINDOW, items: FIRST })) &&
    /run out or was used/.test(await refused('', 'hyrreImport', { pipeline: '403', window: WINDOW, items: FIRST })), 'no ticket or a made-up one: nothing comes in');
  ok(/Only the Slough pipeline/.test(await refused('', 'hyrreImport', { ticket: await ticket(), pipeline: '402', window: WINDOW, items: FIRST })), 'Cardiff\'s pipeline (402) is refused: Slough only');

  console.log('the 08:30 pull');
  const first = await api('', 'hyrreImport', { ticket: t1, pipeline: '403', window: WINDOW, items: FIRST });
  ok(first.approved === 7 && first.added === 7 && first.updated === 0 && first.cancelled === 0 && /^2026-10-26 09:20/.test(first.at),
    'first pull: 7 approved, 7 new (pencilled-in Cara and archived Finn left out)');
  ok(/run out or was used/.test(await refused('', 'hyrreImport', { ticket: t1, pipeline: '403', window: WINDOW, items: FIRST })), 'the same ticket twice: refused (one pull per ticket)');
  let list = (await api(rubal, 'bookingList', {})).items;
  const by = id => list.find(b => b.hyrre_id === id && b.status !== 'cancelled');
  const aisha = by('h1');
  ok(aisha && aisha.first_name === 'Aisha' && aisha.last_name === 'Khan' && aisha.mobile === '07700900201' && aisha.booked_by === 'Megan Hyrre' && aisha.company === 'JUSS' &&
    aisha.slot_date === '2026-10-27' && aisha.slot_time === '10:00' && aisha.source === 'Hirematic' && aisha.status === 'booked' && !aisha.confirm_token,
    'Aisha: booked by Megan Hyrre, Tue 27 10:00, name tidied, +44 mobile → 07, from Hirematic, JUSS, no CONFIRM page (Hyrre messages her)');
  ok(by('h2').booked_by === 'Rubal Oshan' && by('h2').booked_by_id === rubalId && by('h4').booked_by === 'Jess Grace',
    '"Booked by Rubal" / "Booked by Jess" in Hyrre\'s note → Rubal / Jess, not Megan');
  ok(by('h5').mobile === '+49151234567' && !by('h3') && !by('h6'), 'a non-UK number is kept as given; Cara (pencilled in) and Finn (archived) aren\'t bookings');
  const meganId = aisha.booked_by_id;
  ok(!(await api(angad, 'listUsers')).users.some(u => u.id === meganId) && /can't be edited/.test(await refused(angad, 'saveUser', { user: { id: meganId, name: 'X', company: 'JUSS', roles: ['booker'], active: true } })) &&
    /can't be deleted/.test(await refused(angad, 'deleteUser', { id: meganId })), 'Megan Hyrre isn\'t on the Team list and can\'t be edited, switched on or deleted');
  const me = await api(rubal, 'me');
  ok(me.book.hyrre && me.book.hyrre.approved === 7 && me.book.hyrreBy === 'Megan Hyrre' && !(await api(satpal, 'me')).book.hyrre,
    'Book Appts knows the last pull (7 approved, when) for the booking team only');
  ok(/comes from Hyrre/.test(await refused(rubal, 'saveBooking', { booking: Object.assign({}, aisha, { slot_date: '2026-10-28' }) })) &&
    /comes from Hyrre/.test(await refused(rubal, 'bookingAction', { id: aisha.id, act: 'cancel' })) &&
    /comes from Hyrre/.test(await refused(rubal, 'bookingAction', { id: aisha.id, act: 'sent', kind: 'confirm', via: 'whatsapp' })),
    'Hyrre\'s bookings are changed in Hyrre: J&L won\'t move, cancel or message them');
  ok(/^Already booked for Tuesday 27th October \(by Rubal\)/.test(await refused(jess, 'saveBooking', { booking: { first_name: 'Ben', mobile: '07700900202', slot_date: '2026-10-29' } })),
    'booking Ben again from Book Appts: "Already booked for Tuesday 27th October (by Rubal)…"');

  console.log('the next pull: moved, declined, corrected');
  const second = FIRST.map(x => x.id === 'h1' ? Object.assign({}, x, { date: '2026-10-29' }) : x.id === 'h4' ? Object.assign({}, x, { approval: 'rejected' })
    : x.id === 'h5' ? Object.assign({}, x, { name: 'Eva Fox-Smith' }) : x.id === 'h7' ? Object.assign({}, x, { note: 'Booked by Jess' }) : x);
  const p2 = await api('', 'hyrreImport', { ticket: await ticket(), pipeline: '403', window: WINDOW, items: second });
  list = (await api(rubal, 'bookingList', {})).items;
  ok(p2.approved === 6 && p2.added === 1 && p2.updated === 2 && p2.cancelled === 2, 'second pull: Aisha moved, Dan declined, Eva\'s name and Gus\'s booker corrected → 1 new, 2 changed, 2 off');
  ok(by('h1').slot_date === '2026-10-29' && !list.some(b => b.hyrre_id === 'h1' && b.slot_date === '2026-10-27') && !by('h4'),
    'Aisha now on Thu 29 (Tuesday\'s is off the list); Dan (declined in Hyrre) is off it');
  ok(by('h5').last_name === 'Fox-Smith' && by('h7').booked_by === 'Jess Grace' && list.filter(b => b.hyrre_id).length === 6, 'Eva Fox-Smith; Gus now booked by Jess (the note came later)');
  const p3 = await api('', 'hyrreImport', { ticket: await ticket(), pipeline: '403', window: WINDOW, items: second });
  ok(p3.added === 0 && p3.updated === 0 && p3.cancelled === 0 && p3.approved === 6, 'the same again: nothing changes (no doubles)');

  console.log('18:00: Hyrre reminds its own');
  n0 = (await getJson('/dev/pushes')).length;
  await setTime('2026-10-26T18:05:00+00:00'); await post('/dev/run', { fn: 'keepWarm' });
  ok(!(await pushesSince(n0)).some(p => /to remind for tomorrow/.test(p.body.headings.en)), 'no "N to remind for tomorrow": Hyrre sends their reminders');

  console.log('on the day');
  await setTime('2026-10-27T09:40:00+00:00');
  const found = await api('', 'bookingByMobile', { mobile: '07700 900208' });
  ok(found.found && found.booker_name === 'Megan Hyrre' && found.company === 'JUSS', 'check-in page: "booked by Megan Hyrre"');
  n0 = (await getJson('/dev/pushes')).length;
  const ci = await api('', 'checkin', { form: { full_name: 'hana iqbal', mobile: '07700900208', email: 'hana@example.com', over18: 'Yes', rtw: 'British or Irish citizen', privacy_ok: true, source: 'Indeed' } });
  const hc = await api(angad, 'getCandidate', { id: ci.id }), cp = await pushesSince(n0);
  ok(hc.booker_id === meganId && hc.booker_name === 'Megan Hyrre' && hc.brand === 'JUSS' && ci.company === 'JUSS', 'Hana checks in: booked by Megan Hyrre, JUSS');
  ok(to(cp, rubalId).some(p => p.body.headings.en === '🙌 Hana just checked in') && to(cp, jessId).some(p => p.body.headings.en === '🙌 Hana just checked in') &&
    !to(cp, meganId).length && !cp.some(p => /No booker/.test(p.body.headings.en)), 'Megan\'s "🙌 Hana just checked in" goes to Rubal and Jess; no "No booker" alert');
  list = (await api(rubal, 'bookingList', {})).items;
  ok(list.find(b => b.hyrre_id === 'h8').status === 'came', 'her booking: came');
  ok(await runEval('recruitSourceOf(getC(' + JSON.stringify(ci.id) + '))') === 'Office Recruitment', 'Megan\'s starters are Office Recruitment (no incentive)');
  const pr = await api(satpal, 'payReport', { weekEnding: '2026-11-01' });
  ok(!pr.unassigned.some(x => x.id === ci.id) && !pr.rows.some(r => r.name === 'Megan Hyrre'), 'the pay report: Hana isn\'t "needs a booker", and Megan earns nothing');
  const p4 = await api('', 'hyrreImport', { ticket: await ticket(), pipeline: '403', window: WINDOW, items: second.map(x => x.id === 'h8' ? Object.assign({}, x, { attendance: 'attended' }) : x) });
  ok(list.find(b => b.hyrre_id === 'h8').status === 'came' && (await api(rubal, 'bookingList', {})).items.find(b => b.hyrre_id === 'h8').status === 'came' && p4.cancelled === 0,
    'a later pull leaves a check-in as it was');

  console.log('10:30: who didn\'t come');
  n0 = (await getJson('/dev/pushes')).length;
  await setTime('2026-10-27T10:35:00+00:00'); await post('/dev/run', { fn: 'keepWarm' });
  const mp = await pushesSince(n0), mr = to(mp, rubalId), mj = to(mp, jessId);
  ok(mr.some(p => /^Ian didn't check in/.test(p.body.contents.en) && /Mark them absent in Hyrre \(Shift \+ click their appointment\) and Hyrre sends the rebook link/.test(p.body.contents.en)) &&
    mj.some(p => /^Ian didn't check in/.test(p.body.contents.en)), 'Megan\'s no-show (Ian) → Rubal and Jess: "Mark them absent in Hyrre… Hyrre sends the rebook link"');
  ok(mr.some(p => /^Ben didn't check in/.test(p.body.contents.en) && /Mark them absent in Hyrre/.test(p.body.contents.en) && !/sorry we missed you/.test(p.body.contents.en)) &&
    mj.some(p => /^Gus didn't check in/.test(p.body.contents.en)), 'Rubal hears about Ben, Jess about Gus, with Hyrre\'s way to rebook (not our WhatsApp)');
  const su = (await api(satpal, 'payReport', { weekEnding: '2026-11-01' })).showup;
  const megRow = su.rows.find(r => r.name === 'Megan Hyrre');
  ok(megRow && megRow.booked === 2 && megRow.came === 1, 'show-up: Megan Hyrre 1 of 2 came (Hana yes, Ian no)');

  console.log('a weekday with no pull');
  n0 = (await getJson('/dev/pushes')).length;
  await setTime('2026-10-28T09:10:00+00:00'); await post('/dev/run', { fn: 'keepWarm' });
  ok(!(await pushesSince(n0)).some(p => /Hyrre/.test(p.body.headings.en)), 'Wed 09:10: not yet (it\'s due by 09:15)');
  await setTime('2026-10-28T09:20:00+00:00'); await post('/dev/run', { fn: 'keepWarm' });
  const late = await pushesSince(n0), la = to(late, angadId)[0];
  ok(la && la.body.headings.en === '🤖 Hyrre\'s bookings didn\'t come in this morning' && /Angad's computer/.test(la.body.contents.en) && /\?c=book$/.test(la.body.web_url) &&
    to(late, rubalId).length === 1 && to(late, jessId).length === 1 && !to(late, satpalId).length, 'Wed 09:20, no pull today → Angad, Rubal and Jess: "' + (la ? la.body.headings.en : 'none') + '"');
  n0 = (await getJson('/dev/pushes')).length; await post('/dev/run', { fn: 'keepWarm' });
  ok(!(await pushesSince(n0)).some(p => /Hyrre/.test(p.body.headings.en)), 'once a day');
  await setTime('2026-10-31T10:00:00+00:00'); n0 = (await getJson('/dev/pushes')).length; await post('/dev/run', { fn: 'keepWarm' });
  ok(!(await pushesSince(n0)).some(p => /Hyrre/.test(p.body.headings.en)), 'not at the weekend');

  console.log('the screens');
  await setTime('2026-10-28T08:35:00+00:00');
  await api('', 'hyrreImport', { ticket: await ticket(), pipeline: '403', window: WINDOW, items: second });
  await setTime('2026-10-29T08:40:00+00:00');  // Thursday: Aisha's day
  await api('', 'hyrreImport', { ticket: await ticket(), pipeline: '403', window: WINDOW, items: second });
  await api(jess, 'saveBooking', { booking: { first_name: 'Leah', last_name: 'Brown', mobile: '07700900126', slot_date: '2026-10-29', source: 'Teamtailor' } });
  const browser = await chromium.launch();
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (...a) => { const ctx = await newContext(...a); CONTEXTS.push(ctx); await ctx.clock.setSystemTime(new Date(Date.now() + CLOCK_OFF)); return ctx; };
  const ctx = await browser.newContext(PHONE);
  await ctx.addInitScript(t => { try { if (!localStorage.getItem('lr_tok')) localStorage.setItem('lr_tok', JSON.stringify(t)); } catch (e) {} }, rubal);
  const rp = await ctx.newPage(); await rp.goto(APP + 'index.html'); await rp.waitForSelector('.tabbar button');
  await rp.click('.tabbar button[data-tab=book]'); await rp.waitForSelector('#bookNew');
  await rp.waitForFunction(() => /Thursday 29 October/.test(document.querySelector('.bknav') && document.querySelector('.bknav').textContent));
  const txt = await rp.innerText('#page');
  ok(/🤖 Hyrre · pulled today at 08:40: 6 approved bookings/.test(txt), 'Book Appts: "🤖 Hyrre · pulled today at 08:40: 6 approved bookings"');
  const aRow = await rp.$eval('.bkrow:has-text("Aisha Khan")', el => el.innerText);
  ok(/booked by Megan Hyrre · Hirematic · 🤖 Hyrre/.test(aRow) && /Approved in Hyrre/.test(aRow) && !/Not confirmed|Confirmation not sent|Mark as confirmed/.test(aRow),
    'Aisha\'s row: booked by Megan Hyrre · Hirematic · 🤖 Hyrre, ✅ Approved in Hyrre (no "not confirmed", nothing to send)');
  const lRow = await rp.$eval('.bkrow:has-text("Leah Brown")', el => el.innerText);
  ok(/booked by Jess · Teamtailor/.test(lRow) && /Not confirmed/.test(lRow), 'Leah (booked in the app by Jess) still works as before');
  const kp = JSON.stringify(await rp.$$eval('.kpis .kpi', l => l.map(k => [k.querySelector('b').dataset.n, k.querySelector('span').textContent])));  // the final numbers (they count up)
  ok(kp === '[["2","Booked"],["1","Confirmed"],["1","Not confirmed"],["1","Not sent"]]', 'today\'s numbers count Aisha as confirmed (approved in Hyrre), and only Leah as not sent: ' + kp);
  await rp.click('[data-bkrem="2026-10-29"]'); await rp.waitForSelector('.bksheet [data-bks]');
  const remList = await rp.innerText('.bksheet');
  ok(/0 of 1 sent/.test(remList) && /Leah Brown/.test(remList) && !/Aisha/.test(remList), 'today\'s reminders list only Leah (Hyrre reminds Aisha)');
  await rp.click('#bkdone');
  await shot(rp, 'h1-book-appts', true);
  await rp.click('.bkrow:has-text("Aisha Khan") [data-bk]'); await rp.waitForSelector('.bksheet');
  const sh = await rp.innerText('.bksheet');
  ok(/🤖 From Hyrre, approved there/.test(sh) && /Hyrre sends their confirmation and reminders/.test(sh) && /Booked by Megan Hyrre/.test(sh) &&
    !(await rp.$('.bksheet #bkc')) && !(await rp.$('.bksheet #bke')) && !(await rp.$('.bksheet #bkx')) && !(await rp.$('.bksheet #bky')),
    'her booking: "🤖 From Hyrre, approved there… Hyrre sends their confirmation and reminders"; no send, change or cancel buttons');
  await shot(rp, 'h2-booking-sheet');
  await rp.click('#bkdone');
  await setTime('2026-10-29T10:40:00+00:00'); await rp.reload(); await rp.waitForSelector('.tabbar button');
  await rp.click('.tabbar button[data-tab=book]'); await rp.waitForSelector('.bkrow');
  const after = await rp.$eval('.bkrow:has-text("Aisha Khan")', el => el.innerText);
  ok(/Didn't come/.test(after) && /Mark them absent in Hyrre/.test(after) && !(await rp.$('.bkrow:has-text("Aisha Khan") [data-bks]')),
    'after 10:30: Aisha "didn\'t come" with "Mark them absent in Hyrre…" instead of our WhatsApp');
  await shot(rp, 'h3-didnt-come', true);
  await browser.close();

  console.log('\nALL ' + passed + ' HYRRE CHECKS PASSED (' + (process.env.JL_BACKEND === 'pg' ? 'Supabase' : 'Google') + ' back end)');
  process.exit(0);
})().catch(e => { console.error('\n✗ FAILED:', e.message); process.exit(1); });
