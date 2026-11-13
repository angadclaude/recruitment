// Megan's bookings from Hyrre (Angad, 27 Oct): the 08:45 / 16:45 pull hands J&L Slough's approved appointments with a one-time ticket;
// they show on Book Appts as booked by Megan Hyrre (or by Rubal / Jess when Hyrre's note says so), Hyrre sends their confirmation,
// our reminder goes to them too, signed Megan (30 Oct: 18:00 the evening before, or the morning alert after the 08:45 pull),
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
  // Until "the screens" nobody manages Megan (Christie isn't on yet): the booking team sends Megan's, signed Megan, and gets her alerts.
  // That's the fallback if Megan's manager is ever switched off; from "the screens" on, Christie (the office phone) is the only one who sends them.
  ok(!(await api(rubal, 'me', {})).book.hyrreSender, 'nobody manages Megan yet: no office-phone sender');

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
    aisha.slot_date === '2026-10-27' && aisha.slot_time === '10:00' && aisha.source === 'Hirematic' && aisha.status === 'booked' && /^[0-9a-f]{24}$/.test(aisha.confirm_token),
    'Aisha: booked by Megan Hyrre, Tue 27 10:00, name tidied, +44 mobile → 07, from Hirematic, JUSS, a CONFIRM page for our reminder');
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
    /comes from Hyrre/.test(await refused(rubal, 'bookingAction', { id: aisha.id, act: 'sent', kind: 'confirm', via: 'whatsapp' })) &&
    /isn't over yet/.test(await refused(rubal, 'bookingAction', { id: aisha.id, act: 'sent', kind: 'missed', via: 'whatsapp' })) &&
    /comes from Hyrre/.test(await refused(rubal, 'saveBooking', { booking: { rebook_of: aisha.id, first_name: 'Aisha', mobile: aisha.mobile, slot_date: '2026-10-30' } })),
    'Hyrre\'s bookings are changed in Hyrre: J&L won\'t move or cancel them or send our confirmation; "sorry we missed you" and rebook only once they\'ve missed it');
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

  console.log('18:00: our reminder for Hyrre\'s too, signed Megan (Angad, 30 Oct)');
  n0 = (await getJson('/dev/pushes')).length;
  await setTime('2026-10-26T18:05:00+00:00'); await post('/dev/run', { fn: 'keepWarm' });
  const rp18 = await pushesSince(n0);
  const megRem = (l, id, when) => to(l, id).find(p => new RegExp('^📲 \\d+ of Megan\'s to remind for ' + when + '$').test(p.body.headings.en));
  const mr18 = megRem(rp18, rubalId, 'tomorrow');
  ok(!megRem(rp18, satpalId, 'tomorrow'), '…not Satpal');
  ok(mr18 && mr18.body.headings.en === '📲 2 of Megan\'s to remind for tomorrow' && mr18.body.contents.en === 'Tuesday\'s 10:00 presentation: Hana ⏳, Ian ⏳. Tap to send the reminders, signed Megan.' &&
    /\?c=bookrem$/.test(mr18.body.web_url) && megRem(rp18, jessId, 'tomorrow'), 'Megan\'s two for Tuesday (Hana, Ian) → Rubal and Jess: "📲 2 of Megan\'s to remind for tomorrow… signed Megan"');
  ok(to(rp18, rubalId).some(p => p.body.headings.en === '📲 1 to remind for tomorrow' && /: Ben ⏳\. Tap to send the reminders, signed by you\.$/.test(p.body.contents.en)) &&
    to(rp18, jessId).some(p => p.body.headings.en === '📲 1 to remind for tomorrow' && /: Gus ⏳\./.test(p.body.contents.en)), 'the ones Rubal and Jess booked in Hyrre: theirs, signed by them');
  const ian = (await api(rubal, 'bookingList', {})).items.find(b => b.hyrre_id === 'h9');
  const ianR = await api(rubal, 'bookingAction', { id: ian.id, act: 'sent', kind: 'remind', via: 'whatsapp' });
  ok(/^2026-10-26 18:05/.test(ianR.remind_at) && ianR.remind_by === 'Rubal Oshan' && ianR.remind_via === 'whatsapp', 'Rubal sends Ian\'s reminder: saved (who, when, WhatsApp)');

  console.log('08:45: the morning pull, then today\'s reminders');
  n0 = (await getJson('/dev/pushes')).length;
  await setTime('2026-10-27T08:46:00+00:00');
  await api('', 'hyrreImport', { ticket: await ticket(), pipeline: '403', window: WINDOW, items: second });
  const rp8 = await pushesSince(n0), mr8 = megRem(rp8, rubalId, 'today');
  ok(mr8 && mr8.body.headings.en === '📲 1 of Megan\'s to remind for today' && mr8.body.contents.en === 'Tuesday\'s 10:00 presentation: Hana ⏳. Tap to send the reminders, signed Megan.' && megRem(rp8, jessId, 'today'),
    'after the 08:45 pull → Rubal and Jess: "📲 1 of Megan\'s to remind for today" (Hana; Ian had his last night)');
  ok(to(rp8, rubalId).some(p => p.body.headings.en === '📲 1 to remind for today' && /: Ben ⏳/.test(p.body.contents.en)), 'and Rubal\'s own (Ben), not reminded last night');
  n0 = (await getJson('/dev/pushes')).length;
  await setTime('2026-10-27T08:40:00+00:00');
  await api('', 'hyrreImport', { ticket: await ticket(), pipeline: '403', window: WINDOW, items: second });
  ok(!(await pushesSince(n0)).some(p => /to remind/.test(p.body.headings.en)), 'another pull that morning: no second alert');
  const hana = (await api(rubal, 'bookingList', {})).items.find(b => b.hyrre_id === 'h8');
  const info = await api('', 'bookingInfo', { t: hana.confirm_token });
  n0 = (await getJson('/dev/pushes')).length;
  await api('', 'confirmBooking', { t: hana.confirm_token });
  const cf = await pushesSince(n0);
  ok(info.booker === 'Megan' && info.first_name === 'Hana' && to(cf, rubalId).some(p => p.body.headings.en === '✅ Hana confirmed Tuesday\'s presentation') &&
    to(cf, jessId).some(p => p.body.headings.en === '✅ Hana confirmed Tuesday\'s presentation'), 'Hana taps CONFIRM in our reminder (her page says booked by Megan) → Rubal and Jess hear');

  console.log('on the day');
  await setTime('2026-10-27T09:40:00+00:00');
  const found = await api('', 'bookingByMobile', { mobile: '07700 900208' });
  ok(found.found && found.booker_name === 'Megan Hyrre' && found.company === 'JUSS', 'check-in page: "booked by Megan Hyrre"');
  n0 = (await getJson('/dev/pushes')).length;
  const ci = await api('', 'checkin', { form: { full_name: 'hana iqbal', mobile: '07700900208', email: 'hana@example.com', over18: 'Yes', rtw: 'British or Irish citizen', privacy_ok: true, source: 'Indeed' } });
  const hc = await api(angad, 'getCandidate', { id: ci.id }), cp = await pushesSince(n0);
  ok(hc.booker_id === meganId && hc.booker_name === 'Megan Hyrre' && hc.brand === 'JUSS' && ci.company === 'JUSS', 'Hana checks in: booked by Megan Hyrre, JUSS');
  ok(to(cp, rubalId).some(p => p.body.headings.en === '🙌 Hana just checked in (Megan\'s)') && to(cp, jessId).some(p => p.body.headings.en === '🙌 Hana just checked in (Megan\'s)') &&
    !to(cp, meganId).length && !cp.some(p => /No booker/.test(p.body.headings.en)), 'Megan\'s "🙌 Hana just checked in (Megan\'s)" goes to Rubal and Jess, titled whose; no "No booker" alert');
  list = (await api(rubal, 'bookingList', {})).items;
  ok(list.find(b => b.hyrre_id === 'h8').status === 'came', 'her booking: came');
  // Kim: approved in Hyrre after the morning pull, so in the room before J&L knows her booking
  await api('', 'checkin', { form: { full_name: 'Kim Lee', mobile: '07700900210', email: 'kim@example.com', over18: 'Yes', rtw: 'British or Irish citizen', privacy_ok: true, source: 'Indeed' } });
  // Sitara: Hyrre's caller heard "Sitar" and another mobile; she types her own name and number (30 Oct, Sitara Iqbal)
  await api('', 'checkin', { form: { full_name: 'Sitara Iqbal', mobile: '07700900213', email: 'sitara@example.com', over18: 'Yes', rtw: 'British or Irish citizen', privacy_ok: true, source: 'Indeed', booker_typed: 'Megan Hyrre' } });
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
  ok(mr.some(p => /^Ian didn't check in for the 10:00 presentation\. Tap to send "sorry we missed you" and rebook them\. Mark them absent in Hyrre too \(Shift \+ click their appointment\)\.$/.test(p.body.contents.en)) &&
    mj.some(p => /^Ian didn't check in/.test(p.body.contents.en)), 'Megan\'s no-show (Ian) → Rubal and Jess: "Tap to send \"sorry we missed you\" and rebook them. Mark them absent in Hyrre too…"');
  ok(mr.some(p => /^Ben didn't check in/.test(p.body.contents.en) && /sorry we missed you/.test(p.body.contents.en) && /absent in Hyrre too/.test(p.body.contents.en)) &&
    mj.some(p => /^Gus didn't check in/.test(p.body.contents.en)), 'Rubal hears about Ben, Jess about Gus: our WhatsApp and rebook, and Hyrre marked absent too');
  const su = (await api(satpal, 'payReport', { weekEnding: '2026-11-01' })).showup;
  const megRow = su.rows.find(r => r.name === 'Megan Hyrre');
  ok(megRow && megRow.booked === 2 && megRow.came === 1, 'show-up: Megan Hyrre 1 of 2 came (Hana yes, Ian no)');

  console.log('after the presentation: Hyrre\'s attended / no-show from our check-ins (Angad, 30 Oct)');
  await setTime('2026-10-27T10:40:00+00:00');
  const third = second.concat([item('h10', 'Kim Lee', '07700900210', '2026-10-27'), item('h12', 'Sitar Iqbal', '07700900212', '2026-10-27')]);
  const m0 = await api('', 'hyrreImport', { ticket: await ticket(), pipeline: '403', window: WINDOW, items: third });
  ok(Array.isArray(m0.marks) && m0.marks.length === 0 && m0.added === 2, 'before MARK_FROM (2 Nov): nothing to mark (Kim\'s and Sitar\'s bookings come in)');
  const linked = (await api(rubal, 'bookingList', {})).items, kimB = linked.find(b => b.hyrre_id === 'h10'), sitB = linked.find(b => b.hyrre_id === 'h12');
  ok(kimB.status === 'came' && sitB.status === 'came' && (await api(angad, 'getCandidate', { id: sitB.candidate_id })).full_name === 'Sitara Iqbal',
    'the pull links them to their check-ins: Kim (same mobile, booked after she was in the room) and Sitara (heard as "Sitar", another mobile) → came, not "didn\'t come"');
  await post('/dev/props', { HYRRE_MARK_FROM: '2026-10-01' });
  const m1 = await api('', 'hyrreImport', { ticket: await ticket(), pipeline: '403', window: WINDOW, items: third });
  const marks = JSON.stringify(m1.marks.slice().sort((a, b) => a.id.localeCompare(b.id)));
  ok(marks === JSON.stringify([{ id: 'h10', status: 'attended' }, { id: 'h12', status: 'attended' }, { id: 'h2', status: 'no_show' }, { id: 'h7', status: 'no_show' }, { id: 'h8', status: 'attended' }, { id: 'h9', status: 'no_show' }]),
    'Tue 10:40: Hana (checked in), Kim (in the room before her booking came) and Sitara (Sitar) → attended; Ben, Gus, Ian → no-show: ' + marks);
  ok(!m1.marks.some(m => m.id === 'h1' || m.id === 'h5') && !('name' in m1.marks[0]) && !('mobile' in m1.marks[0]), 'later days aren\'t marked, and only the Hyrre id and the mark go back');
  const did = { h8: 'attended', h10: 'attended', h12: 'attended', h2: 'no_show', h7: 'no_show', h9: 'no_show' };
  const done = third.map(x => (did[x.id] ? Object.assign({}, x, { attendance: did[x.id] }) : x));
  const m2 = await api('', 'hyrreImport', { ticket: await ticket(), pipeline: '403', window: WINDOW, items: done.map(x => x.id === 'h9' ? Object.assign({}, x, { attendance: 'none' }) : x) });
  ok(JSON.stringify(m2.marks) === JSON.stringify([{ id: 'h9', status: 'no_show' }]), 'the next pull: only what Hyrre still has unmarked (Ian), never one marked there already');
  const m3 = await api('', 'hyrreImport', { ticket: await ticket(), pipeline: '403', window: WINDOW, items: done });
  ok(m3.marks.length === 0, 'all marked in Hyrre: nothing more to do');

  // Ian missed Tuesday; Hyrre's rebook link moves him to Thursday that afternoon: Tuesday stays a no-show (the show-up keeps him), Thursday is new
  const mvHy = await api('', 'hyrreImport', { ticket: await ticket(), pipeline: '403', window: WINDOW, items: done.map(x => x.id === 'h9' ? Object.assign({}, x, { date: '2026-10-29', attendance: 'none' }) : x) });
  const ianRows = (await api(rubal, 'bookingList', {})).items.filter(b => b.hyrre_id === 'h9').sort((a, b) => a.slot_date.localeCompare(b.slot_date));
  ok(mvHy.added === 1 && mvHy.cancelled === 0 && ianRows.length === 2 && ianRows[0].slot_date === '2026-10-27' && ianRows[0].status === 'no_show' && ianRows[1].slot_date === '2026-10-29' && ianRows[1].status === 'booked',
    'Ian moved to Thursday in Hyrre after missing Tuesday: Tuesday reads as a no-show (📅 Rebooked), not cancelled; Thursday is booked');
  const su2 = (await api(satpal, 'payReport', { weekEnding: '2026-11-01' })).showup.rows.find(r => r.name === 'Megan Hyrre');
  ok(su2 && su2.booked === 4 && su2.came === 3, 'show-up still counts his Tuesday: Megan Hyrre 3 of 4 came (Hana, Kim, Sitara; not Ian)');
  await api('', 'hyrreImport', { ticket: await ticket(), pipeline: '403', window: WINDOW, items: done });  // back to the fixtures: Thursday's dropped again (still to come → cancelled)

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
  const m4 = await api('', 'hyrreImport', { ticket: await ticket(), pipeline: '403', window: WINDOW, items: second });
  ok(!m4.marks.some(m => m.id === 'h5') && m4.marks.some(m => m.id === 'h9'), 'Wed 08:35: Eva\'s (today, 10:00) waits until the presentation is over; Tuesday\'s still unmarked in Hyrre are asked again');
  // Christie Zammit manages Megan (Angad, 5 Nov) and is the office phone (Angad, 9 Nov: "only the office phone should be Megan/Christy")
  const christie = await api(angad, 'saveUser', { user: { name: 'Christie Zammit', email: 'christie@example.com', company: 'JUSS', roles: ['booker', 'admin'], active: true } });
  const chrisTok = await loginApi('christie@example.com');
  const meC = await api(chrisTok, 'me', {}), meR = await api(rubal, 'me', {});
  ok(meC.bookTeam.some(t => t.id === christie.id) && meC.book.hyrreManager === true && meR.book.hyrreManager === false && meR.bookTeam.some(t => t.id === rubalId) &&
    meC.book.hyrreSender === 'Christie Zammit' && meR.book.hyrreSender === 'Christie Zammit',
    'Christie Zammit manages Megan: on the booking team by name (no email in the repo), Megan\'s manager, and the one who sends Megan\'s (everyone\'s app knows it)');
  await setTime('2026-10-29T08:40:00+00:00');  // Thursday: Aisha's day
  n0 = (await getJson('/dev/pushes')).length;
  await api('', 'hyrreImport', { ticket: await ticket(), pipeline: '403', window: WINDOW, items: second });
  const rpT = await pushesSince(n0), mrC = megRem(rpT, christie.id, 'today');
  ok(mrC && mrC.body.contents.en === 'Thursday\'s 10:00 presentation: Aisha ⏳. Tap to send the reminders, signed Christie / Megan.' && !megRem(rpT, rubalId, 'today') && !megRem(rpT, jessId, 'today'),
    'Thursday\'s morning pull: "📲 1 of Megan\'s to remind for today" goes to Christie only, "signed Christie / Megan"; not Rubal or Jess (Angad, 9 Nov)');
  await api(jess, 'saveBooking', { booking: { first_name: 'Leah', last_name: 'Brown', mobile: '07700900126', slot_date: '2026-10-29', source: 'Teamtailor' } });
  const browser = await chromium.launch();
  const pageErrors = require('./watch').watch(browser);  // every page's own errors, all the way through
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
  ok(/booked by Megan Hyrre · Hirematic · 🤖 Hyrre/.test(aRow) && /Approved in Hyrre/.test(aRow) && /Not confirmed yet/.test(aRow) && /Mark as confirmed/.test(aRow) && !/Confirmation not sent/.test(aRow),
    'Aisha\'s row: booked by Megan Hyrre · Hirematic · 🤖 Hyrre, 🤖 Approved in Hyrre but ⏳ Not confirmed yet (approved isn\'t confirmed, Angad 10 Nov), Mark as confirmed; no "confirmation not sent" (Hyrre sends it)');
  const lRow = await rp.$eval('.bkrow:has-text("Leah Brown")', el => el.innerText);
  ok(/booked by Jess · Teamtailor/.test(lRow) && /Not confirmed/.test(lRow), 'Leah (booked in the app by Jess) still works as before');
  const kp = JSON.stringify(await rp.$$eval('.kpis .kpi', l => l.map(k => [k.querySelector('b').dataset.n, k.querySelector('span').textContent])));  // the final numbers (they count up)
  ok(kp === '[["2","Booked"],["0","Confirmed"],["2","Not confirmed"],["1","Not sent"]]', 'today\'s numbers: approved in Hyrre isn\'t confirmed (Aisha hasn\'t tapped CONFIRM), only Leah not sent: ' + kp);
  // Rubal's own phone (Angad, 9 Nov: she sent one signed Megan from it): Megan's aren't hers to send
  await rp.click('[data-bkrem="2026-10-29"]'); await rp.waitForSelector('.bksheet [data-bks]');
  const remList = await rp.innerText('.bksheet');
  ok(/0 of 1 sent/.test(remList) && /Leah Brown/.test(remList) && !/Aisha Khan/.test(remList) && /📱 Christie sends Megan's from the office phone \(1\)\./.test(remList),
    'Rubal\'s phone: today\'s reminders are Leah\'s only ("0 of 1 sent"); Aisha (Megan\'s) isn\'t there: "📱 Christie sends Megan\'s from the office phone (1)"');
  const lMsg = decodeURIComponent((await rp.getAttribute('.bksheet .trow:has-text("Leah Brown") a.btn[data-kind=remind]', 'href')).split('?text=')[1]);
  ok(/Kind regards,\n\*Rubal Oshan\*\nIn association with \*JUSS Marketing Ltd\*$/.test(lMsg) && /\n👉 Confirm your spot: https:\/\/[^\n]+\/b\/[a-hjkmnp-z2-9]{8}\n\n📅/.test(lMsg), 'Leah\'s (booked in the app) is still signed by whoever sends it (Rubal), her link under the opening line');
  await rp.click('#bkdone');
  await rp.click('.bkrow:has-text("Aisha Khan") [data-bk]'); await rp.waitForSelector('.bksheet');
  const shR = await rp.innerText('.bksheet');
  ok(/our 📲 reminder is sent from the office phone/.test(shR) && /📱 Christie sends Megan's from the office phone, signed Christie \/ Megan\. Nothing to send from this phone\./.test(shR) &&
    !(await rp.$('.bksheet #bkr')) && await rp.$('.bksheet #bky') && !(await rp.$('.bksheet a[data-bks]')),
    'Aisha\'s booking on Rubal\'s phone: no reminder button, "📱 Christie sends Megan\'s from the office phone, signed Christie / Megan. Nothing to send from this phone."; Mark as confirmed stays');
  await shot(rp, 'h2b-office-phone-note');
  await rp.click('#bkdone');
  // The office phone, logged in as Christie: Megan's are hers, signed "Christie / Megan"; the team's own by her name
  const cctx = await browser.newContext(PHONE);
  await cctx.addInitScript(t => { try { if (!localStorage.getItem('lr_tok')) localStorage.setItem('lr_tok', JSON.stringify(t)); } catch (e) {} }, chrisTok);
  const chp = await cctx.newPage(); await chp.goto(APP + 'index.html'); await chp.waitForSelector('.tabbar button');
  await chp.click('.tabbar button[data-tab=book]'); await chp.waitForSelector('#bookNew');
  await chp.waitForFunction(() => /Thursday 29 October/.test(document.querySelector('.bknav') && document.querySelector('.bknav').textContent));
  await chp.click('[data-bkrem="2026-10-29"]'); await chp.waitForSelector('.bksheet [data-bks]');
  const cWa = async who => decodeURIComponent((await chp.getAttribute('.bksheet .trow:has-text("' + who + '") a.btn[data-kind=remind]', 'href')).split('?text=')[1]);
  const aMsg = await cWa('Aisha Khan');
  ok(/0 of 2 sent/.test(await chp.innerText('.bksheet')) && /Megan's: Christie \/ Megan/.test(await chp.innerText('.bksheet')) &&
    /^Hey Aisha! 👋\n\n\*Today’s the day!\* 🙌/.test(aMsg) &&
    /Kind regards,\n\*Christie \/ Megan\*\nIn association with \*JUSS Marketing Ltd\*$/.test(aMsg) && /\n👉 Confirm your spot: https:\/\/[^\n]+\/b\/[a-hjkmnp-z2-9]{8}\n\n📅/.test(aMsg) && /signed Christie \/ Megan/.test(await chp.innerText('.bksheet .trow:has-text("Aisha Khan")')) &&
    /Kind regards,\n\*Christie Zammit\*\n/.test(await cWa('Leah Brown')),
    'the office phone (Christie): both, "0 of 2 sent"; Aisha\'s reminder ("Today\'s the day!") signed *Christie / Megan*, with her link under the opening line; Leah\'s signed Christie Zammit');
  // The surer tone (Angad, 12 Nov: 2 of 41 had tapped CONFIRM): she's booked, so nothing asks if she's still coming
  ok(aMsg.includes('You’re booked in to *meet the team* at *JUSS Marketing*\n👉 Confirm your spot: ') &&
    aMsg.includes('📍 Automotive House, Slough (2 mins from the station)\n🗺️ Tap for directions: https://maps.app.goo.gl/zeP4MjS2hMJzB9V9A\n\n🤝 *Rubal or Jess* will be hosting and expecting you\n' +
      '⏰ Aim to arrive *10 minutes early* · done by 11:30\n👔 Office wear / smart casual\n\nKind regards,') &&
    (aMsg.match(/https?:\/\//g) || []).length === 2 && /\/b\/[a-hjkmnp-z2-9]{8}$/.test(aMsg.match(/https?:\/\/\S+/)[0]) && !/Aisha|n=|booked\.html/.test(aMsg.match(/https?:\/\/\S+/)[0]) &&
    !/still coming|Tap \*CONFIRM|See you|earnings/i.test(aMsg),
    'Megan\'s reminder in the surer tone: her link first (nothing about her in it, so the card is ours), the place with "Tap for directions", Rubal or Jess hosting and expecting her, 10 minutes early · done by 11:30, office wear; no earnings line, no "See you"');
  await chp.click('.bksheet .trow:has-text("Aisha Khan") a.btn[data-kind=remind]');
  await chp.waitForFunction(() => /1 of 2 sent/.test(document.getElementById('bkprog').textContent));
  await chp.waitForTimeout(800);
  const aSent = (await api(chrisTok, 'bookingList', {})).items.find(b => b.hyrre_id === 'h1' && b.slot_date === '2026-10-29');
  ok(/^2026-10-29 08:4/.test(aSent.remind_at) && aSent.remind_by === 'Christie Zammit', 'tapping Send on the office phone ticks her off ("1 of 2 sent") and saves it (Christie)');
  await chp.click('#bkdone');
  ok(/Reminded/.test(await chp.innerText('.bkrow:has-text("Aisha Khan")')), 'her row: 📲 Reminded');
  await shot(chp, 'h1-book-appts', true);
  await chp.click('.bkrow:has-text("Aisha Khan") [data-bk]'); await chp.waitForSelector('.bksheet');
  const sh = await chp.innerText('.bksheet');
  ok(/🤖 From Hyrre, approved there/.test(sh) && /Hyrre sends their confirmation and texts; our 📲 reminder is signed Christie \/ Megan/.test(sh) && /Booked by Megan Hyrre/.test(sh) &&
    await chp.$('.bksheet #bkr') && await chp.$('.bksheet #bky') && !(await chp.$('.bksheet #bkc')) && !(await chp.$('.bksheet #bke')) && !(await chp.$('.bksheet #bkx')) && !(await chp.$('.bksheet .bkoffice')),
    'her booking on the office phone: "📲 Send a reminder · signed Christie / Megan" and "Mark as confirmed"; no confirmation, change or cancel (Hyrre\'s)');
  await shot(chp, 'h2-booking-sheet');
  await chp.click('#bkdone');
  await setTime('2026-10-29T10:40:00+00:00');
  n0 = (await getJson('/dev/pushes')).length; await post('/dev/run', { fn: 'keepWarm' });
  const pm = await pushesSince(n0), ma = to(pm, christie.id).find(p => /^Aisha didn't check in/.test(p.body.contents.en));
  ok(ma && /Tap to send "sorry we missed you" and rebook them\. The 11:15 pull marks them absent in Hyrre, and Hyrre sends its rebook link as usual\.$/.test(ma.body.contents.en) && !/Shift \+ click/.test(ma.body.contents.en) &&
    !to(pm, rubalId).some(p => /^Aisha didn't check in/.test(p.body.contents.en)) && !to(pm, jessId).some(p => /^Aisha didn't check in/.test(p.body.contents.en)),
    'Thu 10:40, marking on: Megan\'s no-show (Aisha) → Christie only: "Tap to send \"sorry we missed you\" and rebook them. The 11:15 pull marks them absent in Hyrre…"');
  await rp.reload(); await rp.waitForSelector('.tabbar button');
  await rp.click('.tabbar button[data-tab=book]'); await rp.waitForSelector('.bkrow');
  const afterR = await rp.$eval('.bkrow:has-text("Aisha Khan")', el => el.innerText);
  ok(/Didn't come/.test(afterR) && /📱 Christie sends Megan's from the office phone: the "sorry we missed you" and the rebook\./.test(afterR) &&
    !(await rp.$('.bkrow:has-text("Aisha Khan") a[data-kind=missed]')) && !(await rp.$('.bkrow:has-text("Aisha Khan") [data-bkre]')),
    'after 10:30 on Rubal\'s phone: Aisha "didn\'t come", and "Christie sends Megan\'s from the office phone: the sorry we missed you and the rebook" (no buttons)');
  await chp.reload(); await chp.waitForSelector('.tabbar button');
  await chp.click('.tabbar button[data-tab=book]'); await chp.waitForSelector('.bkrow');
  const after = await chp.$eval('.bkrow:has-text("Aisha Khan")', el => el.innerText);
  ok(/Didn't come/.test(after) && /The 11:15 pull marks them absent in Hyrre, and Hyrre sends its rebook link as usual\./.test(after) &&
    await chp.$('.bkrow:has-text("Aisha Khan") a[data-kind=missed]') && await chp.$('.bkrow:has-text("Aisha Khan") [data-bkre]'),
    'on the office phone: Aisha "didn\'t come" with 💬 Sorry we missed you and 📅 Rebook (Angad, 30 Oct), and what Hyrre does');
  await shot(chp, 'h3-didnt-come', true);

  console.log('Megan\'s no-show: our "sorry we missed you" and rebook, from the office phone (Angad, 30 Oct + 9 Nov)');
  const missMsg = decodeURIComponent((await chp.getAttribute('.bkrow:has-text("Aisha Khan") a.btn[data-kind=missed]', 'href')).split('?text=')[1]);
  ok(/^Hey Aisha! 👋\n\nWe missed you today 😕 Everything OK\?\n\n/.test(missMsg) && /You can come in and \*meet the team\* \*Monday to Friday at 10:00 AM\*\./.test(missMsg) && !/presentation/i.test(missMsg) && /Which day suits you\? Just reply here/.test(missMsg) &&
    /Kind regards,\n\*Christie \/ Megan\*\nIn association with \*JUSS Marketing Ltd\*$/.test(missMsg), 'Aisha\'s "sorry we missed you": rebook by replying, signed *Christie / Megan*');
  await chp.click('.bkrow:has-text("Aisha Khan") a.btn[data-kind=missed]'); await chp.waitForTimeout(800);
  let aNow = (await api(chrisTok, 'bookingList', {})).items.find(b => b.id === aSent.id);
  ok(/^2026-10-29 10:4/.test(aNow.missed_at) && aNow.missed_by === 'Christie Zammit', 'Christie taps it on the office phone: saved (✓ Messaged)');
  await chp.click('.bkrow:has-text("Aisha Khan") [data-bkre]'); await chp.waitForSelector('#bksave');
  const form = await chp.innerText('.bksheet');
  ok(/Rebook · they didn't come/i.test(form) && /🤖 Still Megan's \(from Hyrre · Hirematic\), booked for JUSS Marketing, signed Christie \/ Megan\. Ours from now on/.test(form) && !(await chp.$('.bksheet .chips[data-name=bksrc]')),
    'Rebook: "🤖 Still Megan\'s (from Hyrre · Hirematic)… signed Christie / Megan. Ours from now on", no "where did they apply"');
  await shot(chp, 'h4-rebook-megan');
  await chp.click('.bksheet [data-day="2026-10-30"]'); await chp.click('#bksave'); await chp.waitForSelector('.bksheet a[data-kind=confirm]');
  const confMsg = decodeURIComponent((await chp.getAttribute('.bksheet a.btn.wa[data-kind=confirm]', 'href')).split('?text=')[1]);
  ok(/booked in/.test(confMsg) && /30th October/.test(confMsg) && /Kind regards,\n\*Christie \/ Megan\*\n/.test(confMsg), 'then the confirmation for Fri 30th, signed *Christie / Megan*');
  let all = (await api(rubal, 'bookingList', {})).items;
  const re = all.find(b => b.rebook_of === aSent.id);
  ok(re && re.booked_by === 'Megan Hyrre' && re.booked_by_id === meganId && re.source === 'Hirematic' && !re.hyrre_id && re.slot_date === '2026-10-30' && re.status === 'booked' &&
    all.find(b => b.id === aSent.id).status === 'no_show', 'the rebook: still Megan\'s, from Hirematic, ours (no Hyrre id); Thursday\'s stays a no-show (📅 Rebooked)');
  ok(!(await refused(rubal, 'saveBooking', { booking: { id: re.id, first_name: 'Aisha', last_name: 'Khan', mobile: re.mobile, slot_date: '2026-11-02', source: 'Hirematic' } })) &&
    !(await refused(rubal, 'saveBooking', { booking: { id: re.id, first_name: 'Aisha', last_name: 'Khan', mobile: re.mobile, slot_date: '2026-10-30', source: 'Hirematic' } })),
    'ours to change from now on (a day moved and back)');
  ok((await api(rubal, 'bookingList', {})).items.find(b => b.id === re.id).source === 'Hirematic', 'changing the day keeps where they applied (Hirematic: it turned into "Teamtailor")');
  await setTime('2026-10-29T11:16:00+00:00');
  const m5 = await api('', 'hyrreImport', { ticket: await ticket(), pipeline: '403', window: WINDOW, items: second });
  ok(JSON.stringify(m5.marks.find(m => m.id === 'h1')) === JSON.stringify({ id: 'h1', status: 'no_show' }) &&
    JSON.stringify(m5.marks.find(m => m.id === 'h5')) === JSON.stringify({ id: 'h5', status: 'no_show' }),
    '11:15 pull: Aisha (rebooked here) is still marked no-show in Hyrre, like Eva: Hyrre does what it does (Angad, 30 Oct)');
  const pull = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'hyrre-pull.js'), 'utf8');
  ok(/ask_rebook: m\.status === 'no_show' \}/.test(pull), 'the pull marks Hyrre the way its own appointment box does (a no-show asked to rebook), nothing more');
  n0 = (await getJson('/dev/pushes')).length;
  const p6 = await api('', 'hyrreImport', { ticket: await ticket(), pipeline: '403', window: WINDOW,
    items: second.map(x => x.id === 'h1' ? Object.assign({}, x, { attendance: 'no_show' }) : x).concat([item('h1', 'AISHA KHAN', '+447700900201', '2026-11-02')]) });
  all = (await api(rubal, 'bookingList', {})).items;
  const aOpen = all.filter(b => b.mobile === '07700900201' && b.status === 'booked');
  const mv = to(await pushesSince(n0), rubalId).find(p => /^📅 Aisha rebooked in Hyrre too/.test(p.body.headings.en));
  ok(aOpen.length === 1 && aOpen[0].id === re.id && aOpen[0].hyrre_id === 'h1' && aOpen[0].slot_date === '2026-11-02' && p6.added === 0,
    'she also used Hyrre\'s link (Mon 2 Nov, approved): one booking, not two, on Hyrre\'s day, Hyrre\'s again');
  ok(mv && mv.body.headings.en === '📅 Aisha rebooked in Hyrre too: now Monday' && /^Rebooked here for Friday 30th October, then for Monday 2nd November in Hyrre\. It's one booking now/.test(mv.body.contents.en),
    'Rubal and Jess hear: "📅 Aisha rebooked in Hyrre too: now Monday…"');
  const ianB = all.find(b => b.hyrre_id === 'h9');
  const ianRe = await api(rubal, 'saveBooking', { booking: { rebook_of: ianB.id, first_name: 'Ian', last_name: 'Jones', mobile: ianB.mobile, slot_date: '2026-10-30' } });
  await setTime('2026-10-30T09:40:00+00:00');
  await api('', 'checkin', { form: { full_name: 'Ian Jones', mobile: '07700900209', email: 'ian@example.com', over18: 'Yes', rtw: 'British or Irish citizen', privacy_ok: true, source: 'Indeed' } });
  const fri = second.map(x => x.id === 'h1' ? Object.assign({}, x, { attendance: 'no_show' }) : x.id === 'h9' ? Object.assign({}, x, { date: '2026-10-30' }) : x)
    .concat([item('h1', 'AISHA KHAN', '+447700900201', '2026-11-02')]);
  await setTime('2026-10-30T10:40:00+00:00');
  const p8 = await api('', 'hyrreImport', { ticket: await ticket(), pipeline: '403', window: WINDOW, items: fri.map(x => x.id === 'h9' ? Object.assign({}, x, { date: '2026-11-04' }) : x) });
  ok(p8.added === 0 && p8.skipped === 1 && !(await api(rubal, 'bookingList', {})).items.some(b => b.mobile === '07700900209' && b.slot_date === '2026-11-04'),
    'Ian, rebooked here for Fri and came: a later day approved for him in Hyrre isn\'t added (he\'s been)');
  const p7 = await api('', 'hyrreImport', { ticket: await ticket(), pipeline: '403', window: WINDOW, items: fri });
  all = (await api(rubal, 'bookingList', {})).items;
  const ianNow = all.filter(b => b.mobile === '07700900209' && b.status !== 'cancelled');
  ok(p7.added === 0 && ianNow.length === 2 && all.find(b => b.id === ianRe.id).hyrre_id === 'h9' && all.find(b => b.id === ianRe.id).status === 'came' &&
    JSON.stringify(p7.marks.find(m => m.id === 'h9')) === JSON.stringify({ id: 'h9', status: 'attended' }) && all.find(b => b.id === re.id).status === 'booked',
    'approved in Hyrre for Friday, the day he came: still one booking, and Hyrre marks him attended');

  console.log('rebooked twice, a day gone by, last week\'s link (11 Nov)');
  let rows = (await api(chrisTok, 'bookingList', {})).items;
  const kimHy = rows.find(b => b.hyrre_id === 'h10');
  const k1 = await api(chrisTok, 'saveBooking', { booking: { rebook_of: kimHy.id, first_name: 'Kim', last_name: 'Lee', mobile: kimHy.mobile, slot_date: '2026-11-02' } });
  await setTime('2026-11-02T10:40:00+00:00');  // Monday: she misses that one too
  const k2 = await api(chrisTok, 'saveBooking', { booking: { rebook_of: k1.id, first_name: 'Kim', last_name: 'Lee', mobile: kimHy.mobile, slot_date: '2026-11-03', source: 'Teamtailor' } });
  const nora = await api(chrisTok, 'saveBooking', { booking: { first_name: 'Nora', last_name: 'Tile', mobile: '07700900231', slot_date: '2026-11-03', source: 'Teamtailor' } });
  rows = (await api(chrisTok, 'bookingList', {})).items;
  ok(k1.booked_by === 'Megan Hyrre' && k2.booked_by === 'Megan Hyrre' && k2.booked_by_id === meganId && k2.source === 'Hirematic' && !k2.hyrre_id && rows.find(b => b.id === k1.id).status === 'no_show',
    'a Megan no-show rebooked a second time is still Megan\'s, from Hirematic (it used to become the sender\'s, "Teamtailor", so every phone could send it)');
  // Tuesday 10:05: Nora has checked in, Kim hasn't confirmed. "Confirmed" is who tapped CONFIRM, not who's in the room
  await setTime('2026-11-03T09:50:00+00:00');
  await api('', 'checkin', { form: { full_name: 'Nora Tile', mobile: '07700900231', email: 'nora@example.com', over18: 'Yes', rtw: 'British or Irish citizen', privacy_ok: true, source: 'Indeed' } });
  await setTime('2026-11-03T10:05:00+00:00');
  await chp.reload(); await chp.waitForSelector('.tabbar button');
  await chp.click('.tabbar button[data-tab=book]'); await chp.waitForSelector('.bkrow');
  await chp.waitForTimeout(900);
  const tiles = JSON.stringify(await chp.$$eval('.kpis .kpi', l => l.map(k => [k.querySelector('b').dataset.n, k.querySelector('span').textContent])));
  ok(tiles === '[["2","Booked"],["0","Confirmed"],["1","Not confirmed"],["0","Not sent"]]' || /\["2","Booked"\],\["0","Confirmed"\],\["1","Not confirmed"\]/.test(tiles),
    'the day\'s tiles before 10:30 with one already in the room: Booked 2 · Confirmed 0 · Not confirmed 1 (someone who checked in used to count as "confirmed"): ' + tiles);
  // 10:40: Kim's day has been and gone. Her link can't confirm it, and says so
  await setTime('2026-11-03T10:40:00+00:00');
  const bkSheet = await getJson('/dev/sheet?name=Bookings'), bi = bkSheet[0].indexOf('id'), ti = bkSheet[0].indexOf('confirm_token');
  const kTok = bkSheet.find(r => r[bi] === k2.id)[ti];
  const kInfo = await api('', 'bookingInfo', { t: kTok });
  ok(kInfo.over === true && /been and gone\. Reply to the message/.test(await refused('', 'confirmBooking', { t: kTok })) && !(await api(chrisTok, 'bookingList', {})).items.find(b => b.id === k2.id).confirmed_at,
    'a CONFIRM link tapped after the day has gone: "That day has been and gone. Reply to the message you were sent and we\'ll book you another day." (it used to say "locked in" and tell the team she\'d confirmed)');
  const kPage = await cctx.newPage();
  await kPage.goto(APP + 'booked.html?t=' + kTok + '&n=Kim&d=2026-11-03');
  await kPage.waitForFunction(() => /has been and gone/.test(document.body.innerText));
  ok(!(await kPage.$('#conf')) && !/locked in/.test(await kPage.innerText('body')), 'her page: "Tuesday 3rd November has been and gone. Reply to the message… and we\'ll book you another day", no Confirm button');
  // 11:15 pull: Hyrre has her approved for Thursday. Tuesday's stays a "didn't come" (📅 Rebooked); Thursday's is added
  await setTime('2026-11-03T11:16:00+00:00');
  const p9 = await api('', 'hyrreImport', { ticket: await ticket(), pipeline: '403', window: WINDOW, items: fri.concat([item('h10', 'Kim Lee', '07700900210', '2026-11-05')]) });
  rows = (await api(chrisTok, 'bookingList', {})).items;
  const kTue = rows.find(b => b.id === k2.id), kThu = rows.find(b => b.hyrre_id === 'h10' && b.slot_date === '2026-11-05');
  ok(p9.added === 1 && kTue.status === 'no_show' && kTue.slot_date === '2026-11-03' && kThu && kThu.status === 'booked' && kThu.booked_by === 'Megan Hyrre',
    'missed the day we rebooked her for, approved in Hyrre for a later one the same morning: Tuesday stays a no-show where it was, Thursday is added (the pull used to move Tuesday\'s booking, and its "didn\'t come" row went)');
  await kPage.reload();
  await kPage.waitForFunction(() => /you've been rebooked/.test(document.body.innerText));
  ok(!/You're booked in/.test(await kPage.innerText('body')) && !(await kPage.$('#conf')),
    'her old link now: "That day has passed and you\'ve been rebooked: your newest message has your new day…" (it used to keep showing "You\'re booked in" for Tuesday)');
  await kPage.close();
  // The office phone left open overnight: next morning "today" has moved on with the day (Monday's reminders used to say "tomorrow")
  ok(/Today/i.test(await chp.innerText('.bknav .lbl')) && /Tuesday 3 November/i.test(await chp.innerText('.bknav .lbl')), 'Tuesday, Book Appts open on the office phone: "Today · Tuesday 3 November"');
  await setTime('2026-11-04T08:50:00+00:00');
  await chp.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await chp.waitForFunction(() => /Wednesday 4 November/i.test((document.querySelector('.bknav .lbl') || {}).innerText || ''), null, { timeout: 15000 }).catch(() => {});
  ok(/Today/i.test(await chp.innerText('.bknav .lbl')) && /Wednesday 4 November/i.test(await chp.innerText('.bknav .lbl')),
    'the same page, never reloaded, opened again on Wednesday morning: "Today · Wednesday 4 November" (it used to stay on Tuesday until a reload)');
  console.log('the same-day welcome for Megan\'s new bookings (Angad, 12 Nov)');
  // Megan now tells them "one of our team will WhatsApp you directions before the day". A pull that brings new approved bookings
  // → one alert to whoever sends Megan's (the office phone), a send list like the reminders', each one once, its own state
  await post('/dev/props', { HYRRE_WELCOME_FROM: '2026-11-04' });
  const lastPull = fri.concat([item('h10', 'Kim Lee', '07700900210', '2026-11-05')]);
  const wItems = lastPull.concat([
    item('w1', 'Nina Patel', '07700900241', '2026-11-05', { source: 'Job Ad #2' }),      // tomorrow
    item('w2', 'Omar Reid', '07700900242', '2026-11-06', { source: 'Job Ad #1' }),       // Friday
    item('w3', 'Pia Stone', '07700900243', '2026-11-04', { source: 'Job Ad #1' }),       // today: the morning reminder is her one message
    item('w4', 'Quin Tate', '07700900244', '2026-11-06', { note: 'Booked by Rubal' }),   // by hand in Hyrre: Rubal's, not Megan's
  ]);
  const isWel = p => /to welcome$/.test(p.body.headings.en);
  n0 = (await getJson('/dev/pushes')).length;
  const pw = await api('', 'hyrreImport', { ticket: await ticket(), pipeline: '403', window: WINDOW, items: wItems });
  const wp = await pushesSince(n0), wc = to(wp, christie.id).filter(isWel);
  ok(pw.added === 4 && wc.length === 1 && wc[0].body.headings.en === '👋 2 of Megan\'s to welcome' &&
    wc[0].body.contents.en === 'New from Hyrre: Nina, Omar. Tap to send each one their welcome on WhatsApp, signed Christie / Megan: their day, the address and who\'s expecting them.' &&
    /\?c=bookwel$/.test(wc[0].body.web_url) && wp.filter(isWel).length === 1,
    'a pull with 4 new bookings → one alert, to the office phone (Christie) only: "👋 2 of Megan\'s to welcome · New from Hyrre: Nina, Omar…" (not Pia, who\'s in today; not Quin, booked by Rubal; not Kim, pulled before it started)');
  ok(megRem(wp, christie.id, 'today') && /: Pia ⏳\./.test(megRem(wp, christie.id, 'today').body.contents.en), 'Pia, in today: the morning reminder is her one message ("📲 1 of Megan\'s to remind for today")');
  n0 = (await getJson('/dev/pushes')).length;
  const pw2 = await api('', 'hyrreImport', { ticket: await ticket(), pipeline: '403', window: WINDOW, items: wItems });
  ok(pw2.added === 0 && !(await pushesSince(n0)).some(isWel), 'the next pull, nothing new: no second alert (once per pull that brings someone, never a nag)');
  rows = (await api(chrisTok, 'bookingList', {})).items;
  let nina = rows.find(b => b.hyrre_id === 'w1');
  const omar = rows.find(b => b.hyrre_id === 'w2'), quin = rows.find(b => b.hyrre_id === 'w4'), eva = rows.find(b => b.hyrre_id === 'h5');
  const openCodes = rows.filter(b => b.status === 'booked').map(b => b.short_code);
  ok(/^[a-hjkmnp-z2-9]{8}$/.test(nina.short_code) && openCodes.every(c => /^[a-hjkmnp-z2-9]{8}$/.test(c)) && new Set(openCodes).size === openCodes.length && !nina.welcome_at && !nina.remind_at,
    'each has its short code (8 random characters, no two the same, older bookings given theirs too); nothing sent yet');
  ok(/for Megan's bookings from Hyrre/.test(await refused(chrisTok, 'bookingAction', { id: quin.id, act: 'sent', kind: 'welcome', via: 'whatsapp' })) &&
    /presentation is over/.test(await refused(chrisTok, 'bookingAction', { id: eva.id, act: 'sent', kind: 'welcome', via: 'whatsapp' })),
    'the welcome is Megan\'s only (Quin, booked by Rubal: refused) and never for a presentation that\'s over (Eva: refused)');
  const wPage = await cctx.newPage(); await wPage.goto(APP + 'index.html?c=bookwel'); await wPage.waitForSelector('.bksheet #bkwprog');
  const wl = await wPage.innerText('.bksheet');
  ok(/0 of 2 sent/.test(wl) && /Nina Patel/.test(wl) && /Thu 5 Nov · Job Ad #2/.test(wl) && /Omar Reid/.test(wl) && !/Pia Stone|Quin Tate|Kim Lee/.test(wl) && /signed Christie \/ Megan/i.test(wl) &&
    /It isn't their reminder: that still goes the evening before\./.test(wl) && /their link turns into a card on top of the message/.test(wl),
    'tapping the alert on the office phone opens Book Appts with the welcome list: Nina and Omar, "0 of 2 sent", signed Christie / Megan');
  const wHref = await wPage.getAttribute('.bksheet .trow:has-text("Nina Patel") a.btn[data-kind=welcome]', 'href'), wMsg = decodeURIComponent(wHref.split('?text=')[1]);
  const SITE = require('../site.json').url;
  ok(/^https:\/\/wa\.me\/447700900241\?text=/.test(wHref) && wMsg === 'Hey Nina! 👋\n\nYou’re *booked in* to *meet the team* at *JUSS Marketing* 🎉\n👉 Confirm your spot: ' + SITE + 'b/' + nina.short_code + '\n\n' +
    '📅 *Thursday 5th November · 10:00 AM*\n📍 2nd Floor East, Automotive House, Grays Place, Slough SL2 5AF\n🗺️ Tap for directions: https://maps.app.goo.gl/zeP4MjS2hMJzB9V9A\n' +
    '🚆 Right opposite Slough station (exit from *platform 5*)\n\n🤝 *Rubal or Jess* will be expecting you\n⏰ Aim to arrive *10 minutes early* · done by 11:30\n\n' +
    'Kind regards,\n*Christie / Megan*\nIn association with *JUSS Marketing Ltd*',
    'Nina\'s welcome, word for word: booked in to meet the team, her booking link, Thursday 5th November · 10:00 AM, the address with "Tap for directions", right opposite Slough station (platform 5), Rubal or Jess expecting her, 10 minutes early · done by 11:30, signed *Christie / Megan*');
  ok((wMsg.match(/https?:\/\//g) || []).length === 2 && wMsg.match(/https?:\/\/\S+/)[0] === SITE + 'b/' + nina.short_code && wMsg.indexOf(SITE) < wMsg.indexOf('https://maps.app.goo.gl/') &&
    !/nina|patel|900241/i.test(nina.short_code) && !/See you/.test(wMsg),
    'her link is the first link in it (WhatsApp makes the card from the first), with nothing about her in it; the Google Maps link comes after, under the address');
  const bHtml = fs.readFileSync(path.join(__dirname, '..', '..', 'join', 'b.html'), 'utf8'), ogDesc = (/property="og:description" content="([^"]*)"/.exec(bHtml) || [])[1];
  const card = await wPage.$eval('.bksheet .wacard', el => ({ t: el.querySelector('b').textContent, d: el.querySelector('span').textContent, img: el.querySelector('img').getAttribute('src'), site: el.querySelector('i').textContent }));
  ok(card.t === 'You\'re booked in' && card.d === ogDesc && card.d === 'Tap to confirm you\'re coming. Rubal or Jess will have your name ready at the door.' && card.img === 'img/og-booked-juss.jpg' &&
    SITE.indexOf('//' + card.site + '/') > 0 && await wPage.$eval('.bksheet .wacard img', i => i.complete && i.naturalWidth === 1200 && i.naturalHeight === 630),
    'the list shows the card they\'ll see on top of the message, in the page\'s own words (the same as its preview tags), with the 1200 × 630 picture');
  await shot(wPage, 'h5-welcome-list', true);
  await wPage.click('.bksheet .trow:has-text("Nina Patel") a.btn[data-kind=welcome]');
  await wPage.waitForFunction(() => /1 of 2 sent/.test(document.getElementById('bkwprog').textContent));
  await wPage.waitForTimeout(800);
  nina = (await api(chrisTok, 'bookingList', {})).items.find(b => b.hyrre_id === 'w1');
  ok(/^2026-11-04 08:5/.test(nina.welcome_at) && nina.welcome_by === 'Christie Zammit' && nina.welcome_via === 'whatsapp' && !nina.remind_at && !nina.confirm_at,
    'tapping Send ticks her off ("1 of 2 sent") and saves it as welcomed (Christie, WhatsApp): its own state, not a reminder and not our confirmation');
  await wPage.click('#bkdone'); await wPage.waitForSelector('#bkwel');
  ok(/👋 Welcome Megan's new bookings · 1$/.test((await wPage.innerText('#bkwel')).trim()), 'back on Book Appts: "👋 Welcome Megan\'s new bookings · 1" (Omar still to go; Nina isn\'t offered again)');
  await rp.reload(); await rp.waitForSelector('.tabbar button'); await rp.click('.tabbar button[data-tab=book]'); await rp.waitForSelector('.bkwelo');
  ok(/👋 1 of Megan's new booking to welcome · 📱 Christie sends Megan's from the office phone/.test(await rp.innerText('.bkwelo')) && !(await rp.$('#bkwel')),
    'Rubal\'s phone: "👋 1 of Megan\'s new booking to welcome · 📱 Christie sends Megan\'s from the office phone", no send button');
  // Nina taps her link: the short link is her "You're booked in" page, and it confirms
  const nctx = await browser.newContext(PHONE), np = await nctx.newPage();
  await np.goto(APP + 'b/' + nina.short_code); await np.waitForSelector('#conf');
  ok(/You're booked in, Nina/.test(await np.innerText('#app')) && /Thursday 5 November/.test(await np.innerText('#app')) && /from Megan/.test(await np.innerText('#app')), 'her short link: "You\'re booked in, Nina 🎉", Thursday 5 November, the message from Megan');
  await shot(np, 'h6-short-link-page', true);
  await np.click('#conf'); await np.waitForSelector('.wl-done');
  for (let i = 0; i < 25 && !nina.confirmed_at; i++) { nina = (await api(chrisTok, 'bookingList', {})).items.find(b => b.hyrre_id === 'w1'); if (!nina.confirmed_at) await new Promise(r => setTimeout(r, 200)); }
  ok(nina.confirmed_by === 'CONFIRM', 'she taps 🔒 Confirm I\'m coming there: confirmed');
  await nctx.close();
  // 18:00: she's still on the evening reminder list (welcomed isn't reminded), in the tone for someone who has confirmed
  n0 = (await getJson('/dev/pushes')).length;
  await setTime('2026-11-04T18:05:00+00:00'); await post('/dev/run', { fn: 'keepWarm' });
  const ev = megRem(await pushesSince(n0), christie.id, 'tomorrow');
  ok(ev && /Nina ✅/.test(ev.body.contents.en) && /Kim ⏳/.test(ev.body.contents.en), '18:00: Nina, welcomed this morning, is still on "📲 2 of Megan\'s to remind for tomorrow" (the welcome never counts as the reminder): ' + (ev ? ev.body.contents.en : 'none'));
  await wPage.goto(APP + 'index.html'); await wPage.waitForSelector('.tabbar button'); await wPage.click('.tabbar button[data-tab=book]'); await wPage.waitForSelector('#bknext');
  await wPage.click('#bknext'); await wPage.waitForSelector('[data-bkrem="2026-11-05"]'); await wPage.click('[data-bkrem="2026-11-05"]'); await wPage.waitForSelector('.bksheet [data-bks]');
  const remOf = async who => decodeURIComponent((await wPage.getAttribute('.bksheet .trow:has-text("' + who + '") a.btn[data-kind=remind]', 'href')).split('?text=')[1]);
  const ninaRem = await remOf('Nina Patel'), kimRem = await remOf('Kim Lee');
  ok(/0 of 2 sent/.test(await wPage.innerText('.bksheet')) && /✅ You’re confirmed\. Anything changes, just message me\.\n\nKind regards,/.test(ninaRem) && /🗺️ Tap for directions: https:\/\/maps\.app\.goo\.gl\//.test(ninaRem) &&
    !/\/b\//.test(ninaRem) && !/Confirm your spot/.test(ninaRem) && /\*Christie \/ Megan\*\nIn association with \*JUSS Marketing Ltd\*$/.test(ninaRem) && /🤝 \*Rubal or Jess\* will be hosting and expecting you/.test(ninaRem),
    'her reminder is still to send ("0 of 2 sent"), and as she\'s confirmed it says so: no link of hers to confirm with, the map link stays');
  ok(/\n👉 Confirm your spot: https:\/\/[^\n]+\/b\/[a-hjkmnp-z2-9]{8}\n\n📅/.test(kimRem) && (kimRem.match(/https?:\/\//g) || []).length === 2 && /🗺️ Tap for directions: https:\/\/maps\.app\.goo\.gl\//.test(kimRem) &&
    kimRem.indexOf('/b/') < kimRem.indexOf('maps.app.goo.gl') && !/still coming|Tap \*CONFIRM/i.test(kimRem), 'Kim (not confirmed): the surer wording, her own link first, then the map link');
  await wPage.click('#bkdone');
  // Friday 10:40: Omar was never welcomed and his presentation is over: he's off the list and can't be sent one
  await setTime('2026-11-06T10:40:00+00:00');
  n0 = (await getJson('/dev/pushes')).length;
  await api('', 'hyrreImport', { ticket: await ticket(), pipeline: '403', window: WINDOW, items: wItems.concat([item('w5', 'Rae Underhill', '07700900245', '2026-11-09', { source: 'Job Ad #1' })]) });
  const wc2 = to(await pushesSince(n0), christie.id).filter(isWel);
  ok(wc2.length === 1 && wc2[0].body.headings.en === '👋 1 of Megan\'s to welcome' && /^New from Hyrre: Rae\. Tap to send their welcome on WhatsApp/.test(wc2[0].body.contents.en) &&
    /presentation is over/.test(await refused(chrisTok, 'bookingAction', { id: omar.id, act: 'sent', kind: 'welcome', via: 'whatsapp' })),
    'Friday 10:40, a pull with Rae for Monday: "👋 1 of Megan\'s to welcome" (Rae only). Omar, never welcomed, is skipped now his presentation is over');
  await wPage.close();
  // A mobile from another country (Hyrre keeps it as given): its own country code, not 44 in front of it
  const jsSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'JS.html'), 'utf8');
  const intlNo = new Function(jsSrc.match(/function intlNo\(mobile\) \{[^\n]+\}/)[0] + '; return intlNo;')();
  ok(intlNo('07700900201') === '447700900201' && intlNo('+49151234567') === '49151234567' && intlNo('00353871234567') === '353871234567' && /'https:\/\/wa\.me\/' \+ intlNo\(mobile\)/.test(jsSrc) && /'sms:\+' \+ intlNo\(mobile\)/.test(jsSrc),
    'WhatsApp and text links: 07700 900201 → 447700900201; Eva\'s +49151234567 → 49151234567 (it used to open a chat with 4449151234567)');
  await browser.close();
  require('./watch').report(pageErrors); passed++;

  console.log('\nALL ' + passed + ' HYRRE CHECKS PASSED (' + (process.env.JL_BACKEND === 'pg' ? 'Supabase' : 'Google') + ' back end)');
  process.exit(0);
})().catch(e => { console.error('\n✗ FAILED:', e.message); process.exit(1); });
