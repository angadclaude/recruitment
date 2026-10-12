// End-to-end walk-through of the whole journey in a real browser (phone-sized).
// Usage: node dev/e2e.js <screenshot-dir>   (starts its own dev server on :8787)
'use strict';
const { chromium } = require('playwright');
const assert = require('assert');
const fs = require('fs');

const BASE = 'http://localhost:8787';
const SHOTS = process.argv[2] || './shots';
fs.mkdirSync(SHOTS, { recursive: true });
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

const post = (p, b) => fetch(BASE + p, { method: 'POST', body: JSON.stringify(b) }).then(r => r.json());
async function api(token, action, payload) {
  const r = await post('/api', Object.assign({ action, token }, payload || {}));
  if (!r.ok) throw new Error(action + ': ' + r.error);
  return r.data;
}
async function lastCode(email) {
  const mail = await fetch(BASE + '/dev/mail').then(r => r.json());
  const m = mail.filter(x => x.to === email && /login code/.test(x.subject)).pop();
  return m.subject.match(/(\d{6})/)[1];
}
async function loginApi(email) {
  await api('', 'requestCode', { email });
  return (await api('', 'verifyCode', { email, code: await lastCode(email) })).token;
}
async function loginUi(page, email) {
  await page.goto(BASE + '/exec?app=staff');
  await page.fill('#em', email);
  await page.click('#go');
  await page.waitForSelector('#codeBox:not([hidden])');
  await page.fill('#code', await lastCode(email));
  await page.click('#go');
  await page.waitForSelector('.tabs');
}
const shot = (page, name, full) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: !!full });
const setTime = iso => post('/dev/time', { iso });
const ok = (cond, msg) => { assert.ok(cond, msg); console.log('  ✓ ' + msg); };

const { spawn } = require('child_process');
const server = spawn(process.execPath, [require('path').join(__dirname, 'server.js'), '8787'], { stdio: ['ignore', 'pipe', 'inherit'] });
const ready = new Promise(r => server.stdout.on('data', d => { if (/dev server/.test(String(d))) r(); }));
process.on('exit', () => server.kill());

(async () => {
  await ready;
  console.log('setup');
  await post('/dev/run', { fn: 'setup' });
  await setTime('2026-10-12T09:30:00+01:00'); // Monday
  const admin = await loginApi('angad@linkmarketing.org.uk');
  const users = (await api(admin, 'listUsers')).users;
  ok(users.length === 4 && users.every(u => u.roles.includes('admin')), '4 admins seeded (Angad, Jess, Satpal, Rubal)');

  const mk = (name, email, company, roles) => api(admin, 'saveUser', { user: { name, email, company, roles, active: true } });
  const fiza = await mk('fiza iqbal', 'fiza@example.com', 'LINK', ['booker']);
  const abd = await mk('Abdullahi Ahmed', 'abdullahi@example.com', 'JUSS', ['booker']);
  const mo = await mk('Mo Aden', 'mo@example.com', 'LINK', ['booker']);
  await mk('Nathan Smith', 'nathan@example.com', 'LINK', ['presenter']);
  ok(fiza.name === 'Fiza Iqbal', 'names are tidied (fiza iqbal → Fiza Iqbal)');

  const nathan = await loginApi('nathan@example.com');
  const qr = await api(nathan, 'qrInfo');
  const k = new URL(qr.url).searchParams.get('k');

  // Old Google Form history → repeat detection
  await post('/dev/eval', { js: `
    const s = SpreadsheetApp.getActive().insertSheet('Form Responses 1');
    s.data = [['Timestamp','FOR OFFICE USE ONLY :','Full Name :','Phone number : ','Email ID :','Please tell us who booked you in to meet with us today?','Earliest start date : ','Who was the presentation run by today? '],
      [new Date('2026-06-05T10:00:00Z'),'','jagpreet kular','07700 900999','jag@example.com','Abdullahi','asap','Nathan'],
      [new Date('2025-01-05T10:00:00Z'),'','Too Old','07700 900888','old@example.com','X','asap','Y']];
    importHistory();` });
  const hist = await fetch(BASE + '/dev/sheet?name=History').then(r => r.json());
  ok(hist.length === 2 && hist[1][2] === '07700900999', 'history import keeps last 12 months only, phone normalised');

  const browser = await chromium.launch();

  // ── 1. Candidate checks in on their phone ──
  console.log('candidate check-in');
  const cand = await browser.newContext(PHONE);
  const cp = await cand.newPage();
  await cp.goto(qr.url);
  await cp.waitForSelector('#f');
  await shot(cp, '01-checkin-empty');
  await cp.fill('[name=full_name]', 'jasraj bhuller');
  await cp.fill('[name=mobile]', '07700 900123');
  await cp.fill('[name=email]', 'jasraj@example.com');
  await cp.click('.chips[data-name=over18] .chip:has-text("Yes")');
  await cp.fill('#bkq', 'fiz');
  await shot(cp, '02-checkin-booker-typeahead');
  await cp.click('#sg button:has-text("Fiza Iqbal")');
  await cp.click('.chips[data-name=source] .chip:has-text("TikTok")');
  await cp.selectOption('[name=rtw]', 'Graduate visa (PSW)');
  await cp.fill('[name=visa_expiry]', '2027-11-30');
  await cp.check('[name=privacy_ok]');
  await shot(cp, '03-checkin-filled', true);
  await cp.click('#go');
  await cp.waitForSelector('text=You\'re checked in, Jasraj!');
  await shot(cp, '04-checked-in');
  ok(true, 'candidate checked in via QR and booker type-ahead');

  // Expired / missing QR
  const other = await browser.newContext(PHONE);
  const p2 = await other.newPage();
  await p2.goto(BASE + '/exec?k=wrongcode');
  await p2.waitForSelector('text=This QR code has expired');
  ok(true, 'wrong/old QR code is rejected (stops check-ins from home)');
  await other.close();
  const p3 = await cand.newPage();
  await p3.goto(qr.url);
  await p3.waitForSelector('text=You\'re checked in, Jasraj!');
  ok(true, 'same phone re-opening the link goes straight back to their check-in');
  await p3.close();

  // More candidates (API) — mirrors the handwritten sheet
  const ci = (form) => api('', 'checkin', { k, form: Object.assign({ over18: 'Yes', privacy_ok: true, source: 'Indeed', rtw: 'British or Irish citizen' }, form) });
  const ishita = await ci({ full_name: 'Ishita Rani', mobile: '07700900200', email: 'ishita@example.com', booker_id: mo.id, rtw: 'Student visa (Tier 4)' });
  const adham = await ci({ full_name: 'Adham Soliman', mobile: '07700900300', email: 'adham@example.com', booker_id: abd.id });
  const ali = await ci({ full_name: 'Ali Yilmaz', mobile: '+44 7700 900400', email: 'ali@example.com', booker_typed: 'Ian' });
  const jag = await ci({ full_name: 'Jagpreet Kular', mobile: '07700900999', email: 'jag@example.com', booker_id: abd.id });
  const kid = await ci({ full_name: 'Young Person', mobile: '07700900500', email: 'yp@example.com', booker_id: fiza.id, over18: 'No' });
  let bad = null; try { await ci({ full_name: 'Bad', mobile: '123', email: 'x@y.z', booker_id: fiza.id }); } catch (e) { bad = e.message; }
  ok(/full name/.test(bad), 'validation: single-word name rejected');

  // ── 2. Presenter on their phone ──
  console.log('presenter');
  const pres = await browser.newContext(PHONE);
  const pp = await pres.newPage();
  await loginUi(pp, 'nathan@example.com');
  await pp.waitForSelector('text=Jasraj Bhuller');
  await shot(pp, '05-presenter-today', true);
  await pp.click('#qr');
  await pp.waitForSelector('.overlay');
  await shot(pp, '06-qr-screen');
  await pp.click('.overlay .close');

  await pp.click('.item:has-text("Jasraj Bhuller")');
  await pp.waitForSelector('#inroom');
  await pp.click('#inroom');
  await pp.click('.rag button.G');
  await pp.click('.stars button[data-s="4"]');
  await pp.click('.chips[data-name=tags] .chip:has-text("Earnings driven")');
  await pp.click('.chips[data-name=tags] .chip:has-text("Future owner")');
  await pp.fill('#notes', 'Southall. Likes performance-based earnings, looking for personal development + environment. Strong.');
  await pp.click('#savenotes');
  await pp.waitForSelector('text=Last saved');
  await shot(pp, '07-presenter-notes', true);
  ok(true, 'presenter: in room, Green, 4 stars, tags, notes');

  for (const [c, rag] of [[ishita, 'R'], [adham, 'G'], [ali, 'A'], [jag, 'A'], [kid, 'R']]) {
    await api(nathan, 'saveNotes', { id: c.id, in_room: true, rag, stars: rag === 'G' ? 3 : 2, tags: [], notes: 'test' });
  }
  await pp.click('#back');
  await pp.waitForSelector('#ev');
  await pp.click('#ev');
  await pp.waitForSelector('text=Close evaluations');
  await shot(pp, '08-presenter-evals-open', true);

  // ── 3. Candidate's evaluation appears automatically ──
  console.log('evaluation');
  await cp.waitForSelector('text=Your evaluation, Jasraj', { timeout: 20000 });
  ok(true, 'evaluation appeared on the candidate\'s phone without re-scanning');
  await cp.click('.chips[data-name=q1_excitement] .chip[data-v="9"]');
  await cp.fill('[name=q2_stood_out]', 'The Business Development Programme and the ladder to ownership');
  await cp.click('.chips[data-name=q3_reason] .chip:has-text("Uncapped earnings")');
  await cp.click('.chips[data-name=q4_situation] .chip:has-text("Looking for work")');
  await cp.click('.chips[data-name=q4_looking_for] .chip:has-text("1–3 months")');
  await cp.fill('[name=q5_start_date]', '2026-10-19');
  await cp.click('.chips[data-name=q6_days] .chip:has-text("6–7 days")');
  await cp.click('.chips[data-name=q7_commute] .chip:has-text("Yes")');
  await cp.fill('[name=q8_resilience]', 'Worked nights in a warehouse while finishing my degree. Kept a schedule and never missed a shift.');
  await cp.click('.chips[data-name=q9_results_paid] .chip:has-text("Yes")');
  await cp.fill('[name=q9_results_detail]', 'Commission selling phones in Turkey');
  await cp.click('.chips[data-name=q10_door] .chip:has-text("A)")');
  await cp.click('.chips[data-name=q11_coach] .chip:has-text("D)")');
  await cp.click('.chips[data-name=q12_bdp_stage] .chip:has-text("Ownership")');
  await cp.click('.chips[data-name=q13_unspent] .chip:has-text("No")');
  await shot(cp, '09-evaluation', true);
  await cp.click('#go');
  await cp.waitForSelector('text=Fiza will give you a call');
  await shot(cp, '10-eval-done');
  ok(true, 'evaluation submitted; candidate told Fiza will call');

  const mail = await fetch(BASE + '/dev/mail').then(r => r.json());
  ok(mail.some(m => m.to === 'fiza@example.com' && /evaluation is in/.test(m.subject)), 'booker emailed the moment the evaluation lands (free alert)');

  // Other evaluations via API
  const ev = (c, extra) => api('', 'submitEval', { id: c.id, resume: c.resume, answers: Object.assign({
    q1_excitement: '8', q2_stood_out: 'x', q3_reason: 'Leadership', q4_situation: 'Studying', q5_start_date: '2026-10-19', q6_days: '5 days',
    q7_commute: 'Yes', q8_resilience: 'x', q9_results_paid: 'No', q10_door: 'D) "Annoying, but I\'ll keep going."', q11_coach: 'A) Ask them to show me, then copy it',
    q12_bdp_stage: 'Not sure yet', q13_unspent: 'No' }, extra || {}) });
  await ev(ishita, { q13_unspent: 'Yes', q10_door: 'C) "Maybe this isn\'t for me."', q1_excitement: '5' });
  await ev(adham); await ev(ali); await ev(jag); await ev(kid);

  // ── 4. Booker: one-page snapshot → call → outcome → WhatsApp ──
  console.log('booker');
  const bk = await browser.newContext(PHONE);
  const bp = await bk.newPage();
  await loginUi(bp, 'fiza@example.com');
  await bp.waitForSelector('text=My candidates');
  await bp.waitForSelector('text=Jasraj Bhuller');
  await shot(bp, '11-booker-my-candidates', true);
  const mineTxt = await bp.innerText('body');
  ok(!/Adham|Ishita/.test(mineTxt), 'booker only sees their own candidates');
  ok(/1\s*\/5/.test(mineTxt.replace(/\s+/g, ' ')), 'net attended shows 1/5 (under-18 not counted)');
  await bp.click('.item:has-text("Jasraj Bhuller")');
  await bp.waitForSelector('#saveout');
  await shot(bp, '12-booker-snapshot', true);
  const snap = await bp.innerText('body');
  ok(/Southall/.test(snap) && /Commission selling phones/.test(snap), 'snapshot shows presenter notes + evaluation together');
  ok(!/Unspent convictions/.test(snap), 'conviction answer hidden from bookers');
  await bp.click('.chips[data-name=outcome] .chip:has-text("Academy booked")');
  await bp.fill('#adate', '2026-10-19');
  await bp.fill('#onotes', 'Great call. Confirmed share code ready.');
  await bp.click('#saveout');
  await bp.waitForSelector('a.wa[data-kind=offer]');
  await shot(bp, '13-booker-outcome-whatsapp', true);
  const href = await bp.getAttribute('a.wa[data-kind=offer]', 'href');
  const msg = decodeURIComponent(href.split('?text=')[1]);
  ok(href.startsWith('https://wa.me/447700900123'), 'WhatsApp link uses +44 number');
  ok(/LINK Marketing BA Academy/.test(msg) && /PRE-COACHING MODULE/.test(msg) && /Monday 19 October/.test(msg), 'LINK welcome message with Day 1 date + pre-coaching module');
  fs.writeFileSync(`${SHOTS}/msg-link.txt`, msg);

  // ── 5. Admin: JUSS message, RED approval, pay exclusion ──
  console.log('admin');
  await api(await loginApi('abdullahi@example.com'), 'saveOutcome', { id: adham.id, outcome: 'Academy booked', academy_date: '2026-10-19', outcome_notes: '' });
  const mot = await loginApi('mo@example.com');
  const pend = await api(mot, 'saveOutcome', { id: ishita.id, outcome: 'Academy booked', academy_date: '2026-10-19', outcome_notes: 'keen' });
  ok(pend.admin_status === 'pending', 'RED candidate booked by booker → waits for admin');
  ok((await fetch(BASE + '/dev/mail').then(r => r.json())).filter(m => /Needs your decision/.test(m.subject)).length === 4, 'all 4 admins emailed for the decision');

  const ad = await browser.newContext(PHONE);
  const ap = await ad.newPage();
  await loginUi(ap, 'angad@linkmarketing.org.uk');
  await ap.goto(BASE + '/exec?app=staff&c=' + adham.id);
  await ap.waitForSelector('a.wa[data-kind=offer]');
  const jmsg = decodeURIComponent((await ap.getAttribute('a.wa[data-kind=offer]', 'href')).split('?text=')[1]);
  ok(/JUSS Marketing BA Academy/.test(jmsg) && /onwards: Sales Days/.test(jmsg) && !/PRE-COACHING/.test(jmsg), 'JUSS booker → JUSS welcome message');
  fs.writeFileSync(`${SHOTS}/msg-juss.txt`, jmsg);

  await ap.goto(BASE + '/exec?app=staff&c=' + ishita.id);
  await ap.waitForSelector('#approve');
  await shot(ap, '14-admin-red-decision', true);
  const atxt = await ap.innerText('body');
  ok(/Not eligible: Student visa/.test(atxt) && /Declared an unspent conviction/.test(atxt) && /Doesn't count/.test(atxt), 'admin sees Tier 4 + conviction flags; Tier 4 excluded from pay');
  ok(!(await ap.$('a.wa[data-kind=offer]')), 'no Academy WhatsApp until admin approves');
  await ap.click('#reject');
  await ap.waitForSelector('text=Rejected by');

  await api(admin, 'reassignBooker', { id: ali.id, booker_id: fiza.id });
  await api(admin, 'setPayExcluded', { id: jag.id, excluded: true, reason: 'Share code failed at Academy' });

  // ── 6. Sunday close → logged but flagged LATE ──
  await setTime('2026-10-18T15:00:00+01:00');
  const fz = await loginApi('fiza@example.com');
  const late = await api(fz, 'saveOutcome', { id: ali.id, outcome: 'No answer', outcome_notes: '' });
  ok(late.outcome_late === 'TRUE', 'outcome logged on Sunday is accepted but flagged LATE');

  const pay = await api(admin, 'payReport', { weekEnding: '2026-10-18' });
  const prow = n => pay.rows.find(r => r.name === n);
  ok(prow('Fiza Iqbal').net === 2 && prow('Fiza Iqbal').late === 1, 'pay: Fiza net 2 (Jasraj + Ali; under-18 excluded), 1 late');
  ok(prow('Mo Aden').net === 0, 'pay: Mo net 0 (Tier 4 excluded)');
  ok(prow('Abdullahi Ahmed').net === 1, 'pay: Abdullahi net 1 (Adham; Jagpreet is a repeat and removed by admin)');
  await ap.goto(BASE + '/exec?app=staff');
  await ap.waitForSelector('.tabs');
  await ap.click('.tabs button[data-tab=pay]');
  await ap.waitForSelector('table.t');
  await shot(ap, '15-admin-pay', true);
  await ap.click('.tabs button[data-tab=all]');
  await ap.waitForSelector('#flt');
  await shot(ap, '16-admin-all', true);
  await ap.click('.tabs button[data-tab=team]');
  await ap.waitForSelector('#add');
  await shot(ap, '17-admin-team', true);

  // ── 7. Next week: rejected person comes back → red banner ──
  await setTime('2026-10-20T10:00:00+01:00');
  const k2 = new URL((await api(nathan, 'qrInfo')).url).searchParams.get('k');
  ok(k2 !== k, 'QR code changes every day');
  const back = await api('', 'checkin', { k: k2, form: { full_name: 'Ishita Rani', mobile: '07700900200', email: 'ishita@example.com', booker_id: abd.id, over18: 'Yes', rtw: 'Graduate visa (PSW)', visa_expiry: '2028-01-01', privacy_ok: true } });
  await api(admin, 'markInRoom', { id: back.id, in_room: true });
  const again = await api(admin, 'getCandidate', { id: back.id });
  ok(again.flags.some(f => f.level === 'red' && /Previously not suitable/.test(f.text)), 'repeat of a rejected candidate shows red "do not progress"');
  ok(/Repeat/.test(again.pay_reason), 'repeat attendee does not count for pay');

  // ── 8. Access removed → instantly locked out ──
  await api(admin, 'saveUser', { user: Object.assign({}, fiza, { active: false }) });
  const r = await post('/api', { action: 'me', token: fz });
  ok(r.auth === true, 'switched-off user is logged out immediately');
  const del = await api(admin, 'deleteUser', { id: fiza.id });
  ok(del.deactivated && !del.deleted, 'delete on a user with candidates switches them off instead (keeps pay history)');

  // ── 9. GDPR: 12-month auto-delete ──
  await setTime('2027-10-25T03:00:00+01:00');
  await post('/dev/run', { fn: 'dailyMaintenance' });
  const left = await fetch(BASE + '/dev/sheet?name=Candidates').then(r => r.json());
  ok(left.length === 1, 'records older than 12 months deleted automatically');

  await browser.close();
  console.log('\nALL CHECKS PASSED');
  process.exit(0);
})().catch(e => { console.error('\nFAILED:', e); process.exit(1); });
