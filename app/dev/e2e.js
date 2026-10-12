// End-to-end walk-through of the whole journey in a real browser (phone-sized), using the
// installable app (/join, what GitHub Pages serves) wired to the real Code.gs on a fake Google backend.
// Usage: node app/build.js && node app/dev/e2e.js <screenshot-dir>   (starts its own dev server on :8787)
'use strict';
const { chromium } = require('playwright');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const BASE = 'http://localhost:8787';
const APP = BASE + '/join/';
const PUBLIC = 'https://angadclaude.github.io/recruitment/join/';
const SHOTS = process.argv[2] || './shots';
fs.mkdirSync(SHOTS, { recursive: true });
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

const server = spawn(process.execPath, [path.join(__dirname, 'server.js'), '8787'], { stdio: ['ignore', 'pipe', 'inherit'] });
const ready = new Promise(r => server.stdout.on('data', d => { if (/dev server/.test(String(d))) r(); }));
process.on('exit', () => server.kill());

const post = (p, b) => fetch(BASE + p, { method: 'POST', body: JSON.stringify(b) }).then(r => r.json());
const getJson = p => fetch(BASE + p).then(r => r.json());
async function api(token, action, payload) {
  const r = await post('/api', Object.assign({ action, token }, payload || {}));
  if (!r.ok) throw new Error(action + ': ' + r.error);
  return r.data;
}
async function lastCode(email) {
  const m = (await getJson('/dev/mail')).filter(x => x.to === email && /login code/.test(x.subject)).pop();
  return m.subject.match(/(\d{6})/)[1];
}
async function loginApi(email) {
  await api('', 'requestCode', { email });
  return (await api('', 'verifyCode', { email, code: await lastCode(email) })).token;
}
async function loginUi(page, email, url) {
  await page.goto(url || APP + 'index.html');
  await page.fill('#em', email);
  await page.click('#go');
  await page.waitForSelector('#codeBox:not([hidden])');
  await page.fill('#code', await lastCode(email));
  await page.click('#go');
  await page.waitForSelector('.tabbar button');
}
/** ms from the real tap to `text` appearing on screen (excludes the test robot's own scrolling). */
async function tapToText(page, selector, text) {
  await page.evaluate(t => {
    window.__tap = 0; window.__seen = 0;
    document.addEventListener('click', () => { window.__tap = performance.now(); }, { capture: true, once: true });
    const mo = new MutationObserver(() => { if (window.__tap && !window.__seen && document.body.innerText.includes(t)) { window.__seen = performance.now(); mo.disconnect(); } });
    mo.observe(document.body, { subtree: true, childList: true, characterData: true });
  }, text);
  await page.click(selector);
  await page.waitForFunction(() => window.__seen > 0, null, { timeout: 10000 });
  return Math.round(await page.evaluate(() => window.__seen - window.__tap));
}
const shot = async (page, name, full) => { await page.waitForTimeout(300); return page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: !!full }); };
const setTime = iso => post('/dev/time', { iso });
const ok = (cond, msg) => { assert.ok(cond, msg); console.log('  ✓ ' + msg); };
const pushesTo = async id => (await getJson('/dev/pushes')).filter(p => p.body.include_aliases.external_id.includes(id));

async function fillCheckin(p, f) {
  await p.waitForSelector('#f');
  await p.fill('[name=full_name]', f.name);
  await p.fill('[name=mobile]', f.mobile);
  await p.fill('[name=email]', f.email);
  await p.click('.chips[data-name=over18] .chip:has-text("Yes")');
  if (f.booker) { await p.fill('#bkq', f.booker.slice(0, 3)); await p.click('#sg button:has-text("' + f.booker + '")'); }
  else await p.check('#unsure');
  await p.selectOption('[name=rtw]', f.rtw || 'British or Irish citizen');
  if (f.expiry) await p.fill('[name=visa_expiry]', f.expiry);
  await p.check('[name=privacy_ok]');
}
async function fillEval(p) {
  await p.click('.chips[data-name=q1_excitement] .chip[data-v="9"]');
  await p.fill('[name=q2_stood_out]', 'The Business Development Programme and the ladder to ownership');
  await p.click('.chips[data-name=q3_reason] .chip:has-text("Uncapped earnings")');
  await p.click('.chips[data-name=q4_situation] .chip:has-text("Looking for work")');
  await p.click('.chips[data-name=q4_looking_for] .chip:has-text("1–3 months")');
  await p.fill('[name=q5_start_date]', '2026-10-19');
  await p.click('.chips[data-name=q6_days] .chip:has-text("6–7 days")');
  await p.click('.chips[data-name=q7_commute] .chip:has-text("Yes")');
  await p.fill('[name=q8_resilience]', 'Worked nights in a warehouse while finishing my degree. Never missed a shift.');
  await p.click('.chips[data-name=q9_results_paid] .chip:has-text("Yes")');
  await p.fill('[name=q9_results_detail]', 'Commission selling phones in Turkey');
  await p.click('.chips[data-name=q10_door] .chip:has-text("A)")');
  await p.click('.chips[data-name=q11_coach] .chip:has-text("D)")');
  await p.click('.chips[data-name=q12_bdp_stage] .chip:has-text("Ownership")');
  await p.click('.chips[data-name=q13_unspent] .chip:has-text("No")');
}

(async () => {
  await ready;
  console.log('setup');
  await post('/dev/run', { fn: 'setup' });
  await post('/dev/props', { ONESIGNAL_APP_ID: 'test-app', ONESIGNAL_API_KEY: 'test-key' });
  await setTime('2026-10-12T09:30:00+01:00'); // Monday morning
  const admin = await loginApi('angad@linkmarketing.org.uk');
  const users = (await api(admin, 'listUsers')).users;
  ok(users.length === 4 && users.every(u => u.roles.includes('admin')), '4 admins seeded (Angad, Jess, Satpal, Rubal)');
  ok((await post('/dev/eval', { js: 'JSON.stringify(ScriptApp.getProjectTriggers().map(t => t.fn))' })).out.includes('keepWarm'), 'keep-warm trigger installed');
  const angadId = users.find(u => /angad/.test(u.email)).id;

  const mk = (name, email, company, roles) => api(admin, 'saveUser', { user: { name, email, company, roles, active: true } });
  const fiza = await mk('fiza iqbal', 'fiza@example.com', 'LINK', ['booker']);
  const abd = await mk('Abdullahi Ahmed', 'abdullahi@example.com', 'JUSS', ['booker']);
  const mo = await mk('Mo Aden', 'mo@example.com', 'LINK', ['booker']);
  await mk('Nathan Smith', 'nathan@example.com', 'LINK', ['presenter']);
  ok(fiza.name === 'Fiza Iqbal', 'names are tidied (fiza iqbal → Fiza Iqbal)');
  const nathan = await loginApi('nathan@example.com');

  // Old Google Form history (12 months imported; repeat window is 6 months)
  await post('/dev/eval', { js: `
    const s = SpreadsheetApp.getActive().insertSheet('Form Responses 1');
    s.data = [['Timestamp','FOR OFFICE USE ONLY :','Full Name :','Phone number : ','Email ID :','Please tell us who booked you in to meet with us today?','Earliest start date : ','Who was the presentation run by today? '],
      [new Date('2026-06-05T10:00:00Z'),'','jagpreet kular','07700 900999','jag@example.com','Abdullahi','asap','Nathan'],
      [new Date('2026-03-01T10:00:00Z'),'','Seven Months','07700 900777','seven@example.com','Ian','asap','Mo'],
      [new Date('2025-01-05T10:00:00Z'),'','Too Old','07700 900888','old@example.com','X','asap','Y']];
    importHistory();` });
  const hist = await getJson('/dev/sheet?name=History');
  ok(hist.length === 3, 'history import keeps last 12 months only');

  const browser = await chromium.launch();

  // ── 1. QR #1 on the first slide → check-in ──
  console.log('candidate check-in (QR 1)');
  const cand = await browser.newContext(PHONE);
  const cp = await cand.newPage();
  await cp.goto(APP + 'checkin.html');
  await cp.waitForSelector('#f');
  await shot(cp, '01-checkin-empty');
  await fillCheckin(cp, { name: 'jasraj bhuller', mobile: '07700 900123', email: 'jasraj@example.com', booker: 'Fiza Iqbal', rtw: 'Graduate visa (PSW)', expiry: '2027-11-30' });
  await cp.click('#go');
  await cp.waitForSelector('text=You\'re checked in, Jasraj!');
  await shot(cp, '02-checked-in');
  ok(true, 'candidate checked in from the static slide QR (no presenter action)');
  ok((await pushesTo(fiza.id)).some(p => /Jasraj just checked in/.test(p.body.headings.en)), 'PUSH → booker: "Jasraj just checked in"');
  const push1 = (await getJson('/dev/pushes'))[0];
  ok(push1.headers.Authorization === 'Key test-key' && push1.url.indexOf('api.onesignal.com') > 0, 'push sent via OneSignal API with the stored key');

  // Same phone scans QR #1 again → recognised
  const again1 = await cand.newPage();
  await again1.goto(APP + 'checkin.html');
  await again1.waitForSelector('text=You\'re checked in, Jasraj!');
  await again1.close();
  ok(true, 'same phone re-scanning check-in goes straight back to "checked in"');

  // More candidates (API) — mirrors the handwritten sheet
  const ci = form => api('', 'checkin', { form: Object.assign({ over18: 'Yes', privacy_ok: true, source: 'Indeed', rtw: 'British or Irish citizen' }, form) });
  const ishita = await ci({ full_name: 'Ishita Rani', mobile: '07700900200', email: 'ishita@example.com', booker_id: mo.id, rtw: 'Student visa (Tier 4)' });
  const adham = await ci({ full_name: 'Adham Soliman', mobile: '07700900300', email: 'adham@example.com', booker_id: abd.id });
  const ali = await ci({ full_name: 'Ali Yilmaz', mobile: '+44 7700 900400', email: 'ali@example.com', booker_typed: 'Ian' });
  const jag = await ci({ full_name: 'Jagpreet Kular', mobile: '07700900999', email: 'jag@example.com', booker_id: abd.id });
  const seven = await ci({ full_name: 'Seven Months', mobile: '07700900777', email: 'seven@example.com', booker_id: mo.id });
  const kid = await ci({ full_name: 'Young Person', mobile: '07700900500', email: 'yp@example.com', booker_id: fiza.id, over18: 'No' });
  let bad = null; try { await ci({ full_name: 'Bad', mobile: '123', email: 'x@y.z', booker_id: fiza.id }); } catch (e) { bad = e.message; }
  ok(/full name/.test(bad), 'validation: single-word name rejected');
  ok((await api(admin, 'getCandidate', { id: jag.id })).flags.some(f => /Seen before/.test(f.text)), 'repeat within 6 months flagged (Jagpreet, June)');
  ok(!(await api(admin, 'getCandidate', { id: seven.id })).flags.some(f => /Seen before/.test(f.text)), 'NOT flagged when last seen 7 months ago');

  // ── 2. Presenter rates on their phone (rating = in the room) ──
  console.log('presenter');
  const pres = await browser.newContext(PHONE);
  const pp = await pres.newPage();
  await loginUi(pp, 'nathan@example.com');
  await pp.waitForSelector('text=Jasraj Bhuller');
  ok(!(await pp.$('#qr')) && !(await pp.$('#ev')), 'presenter has no QR / "open evaluations" buttons to press');
  await shot(pp, '03-presenter-today', true);
  await pp.click('.item:has-text("Jasraj Bhuller")');
  await pp.waitForSelector('#savenotes');
  await pp.click('.rag button.G');
  await pp.click('.stars button[data-s="4"]');
  await pp.click('.chips[data-name=tags] .chip:has-text("Earnings driven")');
  await pp.click('.chips[data-name=tags] .chip:has-text("Future owner")');
  await pp.fill('#notes', 'Southall. Likes performance-based earnings, looking for personal development + environment. Strong.');
  await pp.click('#savenotes');
  await pp.waitForSelector('text=In the room · saved');
  await shot(pp, '04-presenter-notes', true);
  ok((await api(admin, 'getCandidate', { id: (await api(admin, 'search', { q: 'Jasraj' })).items[0].id })).in_room === 'TRUE', 'rating Jasraj automatically confirmed "in the room"');
  for (const [c, rag] of [[ishita, 'R'], [adham, 'G'], [ali, 'A'], [jag, 'A'], [kid, 'R']]) {
    await api(nathan, 'saveNotes', { id: c.id, rag, stars: rag === 'G' ? 3 : 2, tags: [], notes: 'test' });
  }

  // ── 3. QR #2 on the last slide → evaluation ──
  console.log('evaluation (QR 2)');
  await cp.goto(APP + 'eval.html');
  await cp.waitForSelector('text=Your evaluation, Jasraj');
  ok(true, 'same phone: evaluation QR opens straight into Jasraj\'s evaluation');
  await fillEval(cp);
  await shot(cp, '05-evaluation', true);
  await cp.click('#go');
  await cp.waitForSelector('text=Fiza will give you a call');
  await shot(cp, '06-eval-done');
  ok((await pushesTo(fiza.id)).some(p => /evaluation is in/.test(p.body.headings.en) && /\?c=/.test(p.body.web_url)), 'PUSH → booker: "evaluation is in" (opens the snapshot)');
  ok((await getJson('/dev/mail')).filter(m => /evaluation/.test(m.subject)).length === 0, 'no email sent when push is set up');

  // Different phone, already checked in → finds them by mobile
  const p2c = await browser.newContext(PHONE);
  const p2 = await p2c.newPage();
  await p2.goto(APP + 'eval.html');
  await p2.waitForSelector('text=Evaluation time');
  await shot(p2, '07-eval-find-by-mobile');
  await p2.fill('#m', '07700 900300');
  await p2.click('#go');
  await p2.waitForSelector('text=Your evaluation, Adham');
  ok(true, 'different phone: evaluation QR finds Adham by mobile number');
  await p2c.close();

  // Never checked in → evaluation QR offers check-in, then evaluation straight after
  const p3c = await browser.newContext(PHONE);
  const p3 = await p3c.newPage();
  await p3.goto(APP + 'eval.html');
  await p3.fill('#m', '07700 900600');
  await p3.click('#go');
  await p3.waitForSelector('text=can\'t find a check-in');
  await p3.click('#ci');
  await fillCheckin(p3, { name: 'Late Arrival', mobile: '07700 900600', email: 'late@example.com', booker: 'Mo Aden' });
  await p3.click('#go');
  await p3.waitForSelector('text=Your evaluation, Late');
  ok(true, 'missed the check-in QR → checks in from the evaluation QR, then evaluates');
  await p3c.close();

  const ev = (c, extra) => api('', 'submitEval', { id: c.id, resume: c.resume, answers: Object.assign({
    q1_excitement: '8', q2_stood_out: 'x', q3_reason: 'Leadership', q4_situation: 'Studying', q5_start_date: '2026-10-19', q6_days: '5 days',
    q7_commute: 'Yes', q8_resilience: 'x', q9_results_paid: 'No', q10_door: 'D) "Annoying, but I\'ll keep going."', q11_coach: 'A) Ask them to show me, then copy it',
    q12_bdp_stage: 'Not sure yet', q13_unspent: 'No' }, extra || {}) });
  await ev(ishita, { q13_unspent: 'Yes', q10_door: 'C) "Maybe this isn\'t for me."', q1_excitement: '5' });
  await ev(adham); await ev(ali); await ev(jag); await ev(kid);

  // Speed: once loaded, switching tabs and opening a candidate needs no waiting on Google
  await post('/dev/delay', { ms: 1500 });  // Google-like latency
  let t0 = Date.now(); await pp.click('.tabbar button[data-tab=pay]'); await pp.waitForSelector('.payrow, .empty');
  const tPay = Date.now() - t0;
  t0 = Date.now(); await pp.click('.tabbar button[data-tab=today]'); await pp.waitForSelector('.kpis');
  const tToday = Date.now() - t0;
  ok(tPay < 500 && tToday < 500, 'tabs switch instantly even with 1.5s Google delay (Pay ' + tPay + 'ms, Today ' + tToday + 'ms)');
  t0 = Date.now(); await pp.click('.item:has-text("Adham Soliman")'); await pp.waitForSelector('.profile h1:has-text("Adham Soliman")');
  const tCand = Date.now() - t0;
  ok(tCand < 500, 'candidate page opens instantly from the phone\'s copy (' + tCand + 'ms)');
  await pp.goBack(); await pp.waitForSelector('.kpis');
  await post('/dev/delay', { ms: 0 });
  ok(true, 'phone back button returns to the list');

  // Level 1: offline engine, instant saves, swipe, dark mode
  await pp.reload(); await pp.waitForSelector('.tabbar button');
  ok(await pp.evaluate(() => navigator.serviceWorker.getRegistration().then(r => !!(r && r.active))), 'app is installed on the phone (service worker active)');
  await pres.setOffline(true);
  await pp.reload(); await pp.waitForSelector('text=Jasraj Bhuller', { timeout: 8000 });
  ok(true, 'app opens with NO signal (from the phone\'s copy)');
  await pp.click('.item:has-text("Jagpreet Kular")'); await pp.waitForSelector('#savenotes');
  await pp.fill('#notes', 'Did Day 1 in June already. Saved with no signal.');
  const tSave = await tapToText(pp, '#savenotes', '⏳ Syncing');
  ok(tSave < 300, 'save shows instantly even offline (' + tSave + 'ms after the tap)');
  ok(/No signal/.test(await pp.innerText('#bars')), 'banner: "No signal, 1 change saved on your phone"');
  ok((await api(admin, 'getCandidate', { id: jag.id })).notes !== 'Did Day 1 in June already. Saved with no signal.', 'not on the server yet (offline)');
  await pres.setOffline(false);
  await pp.waitForFunction(() => !JSON.parse(localStorage.getItem('lr_outbox') || '[]').length, null, { timeout: 15000 });
  ok((await api(admin, 'getCandidate', { id: jag.id })).notes === 'Did Day 1 in June already. Saved with no signal.', 'signal back → change synced to Google automatically');
  await pp.goBack(); await pp.waitForSelector('.kpis');
  await pp.evaluate(() => {
    const sw = document.querySelector('.swipe'); const t = (type, x) => sw.dispatchEvent(new TouchEvent(type, { bubbles: true, touches: type === 'touchend' ? [] : [new Touch({ identifier: 1, target: sw, clientX: x, clientY: 200 })] }));
    t('touchstart', 300); t('touchmove', 250); t('touchmove', 150); t('touchmove', 100); t('touchend', 100);
  });
  await pp.waitForSelector('.swipe.open');
  ok(/^tel:/.test(await pp.getAttribute('.swipe.open .act.call', 'href')) && /wa\.me/.test(await pp.getAttribute('.swipe.open .act.wa', 'href')), 'swipe a candidate → Call / WhatsApp buttons');
  await shot(pp, '04b-swipe');
  const dark = await browser.newContext(Object.assign({ colorScheme: 'dark' }, PHONE));
  const dp = await dark.newPage();
  await loginUi(dp, 'nathan@example.com'); await dp.waitForSelector('text=Jasraj Bhuller');
  await shot(dp, '04c-phone-in-dark-mode');
  ok(await dp.evaluate(() => getComputedStyle(document.body).backgroundColor) === 'rgb(243, 241, 238)', 'stays in the normal light look even when the phone is in dark mode');
  await dark.close();

  // ── 4. Booker: snapshot → outcome → Gen Z WhatsApp with welcome link ──
  console.log('booker');
  const bk = await browser.newContext(PHONE);
  const bp = await bk.newPage();
  await loginUi(bp, 'fiza@example.com');
  await bp.waitForSelector('text=Jasraj Bhuller');
  await shot(bp, '08-booker-my-candidates', true);
  const mineTxt = await bp.innerText('body');
  ok(!/Adham|Ishita/.test(mineTxt), 'booker only sees their own candidates');
  ok(/4 more to hit 5/.test(mineTxt) && /1 don't count/.test(mineTxt), 'net attended 1/5 (under-18 not counted)');
  await bp.click('.item:has-text("Jasraj Bhuller")');
  await bp.waitForSelector('#saveout');
  const snap = await bp.innerText('body');
  ok(/Southall/.test(snap) && /Commission selling phones/.test(snap), 'one-page snapshot: presenter notes + evaluation together');
  ok(!/Unspent convictions/.test(snap), 'conviction answer hidden from bookers');
  await bp.click('.chips[data-name=outcome] .chip:has-text("Academy booked")');
  await bp.fill('#adate', '2026-10-19');
  await bp.fill('#onotes', 'Great call.');
  const tOut = await tapToText(bp, '#saveout', 'Outcome saved ✓');
  ok(tOut < 300, 'outcome save feels instant (' + tOut + 'ms after the tap)');
  await bp.waitForSelector('a.wa[data-kind=offer]');
  await shot(bp, '09-booker-outcome', true);
  const msg = decodeURIComponent((await bp.getAttribute('a.wa[data-kind=offer]', 'href')).split('?text=')[1]);
  fs.writeFileSync(`${SHOTS}/msg-link.txt`, msg);
  const wurl = (msg.match(/https:\/\/\S+welcome-link\.html\?t=\w+/) || [])[0];
  ok(/^JASRAJ!! 🎉 You're IN\./.test(msg) && /Pre-Coaching Module/.test(msg) && wurl, 'LINK WhatsApp: Gen Z copy + personal welcome link');
  ok(/– Jess, LINK Marketing$/.test(msg), 'LINK message signed by Jess (sent by Fiza)');
  ok(msg.length < 520, 'message is short and scannable (' + msg.length + ' chars)');
  ok(/⏳ Not confirmed yet/.test(await bp.innerText('body')), 'snapshot shows "not confirmed yet"');

  // ── 5. Candidate opens their welcome page from WhatsApp → confirms ──
  console.log('welcome page');
  const wp = await cand.newPage();
  await wp.goto(wurl.replace(PUBLIC, APP));
  await wp.waitForSelector('text=You\'re in, Jasraj');
  await shot(wp, '10-welcome-page', true);
  const wtxt = await wp.innerText('body');
  ok(/Monday 19 October/.test(wtxt) && /Day 1 is in 7 days/.test(wtxt) && /Pre-Coaching Module/.test(wtxt) && /Practical Learning Day/.test(wtxt), 'welcome page: date, countdown, pre-coaching, Week 1 plan');
  const og = await (await fetch(wurl.replace(PUBLIC, APP))).text();
  ok(og.includes('og:image" content="' + PUBLIC + 'img/og-link.jpg"'), 'WhatsApp link preview shows the LINK poster card (og:image)');
  await wp.click('#conf');
  await wp.waitForSelector('text=You\'re locked in');
  await shot(wp, '11-welcome-confirmed');
  ok((await pushesTo(fiza.id)).some(p => /confirmed Day 1/.test(p.body.headings.en)), 'PUSH → booker: "Jasraj confirmed Day 1!"');
  await bp.reload(); await bp.waitForSelector('.tabbar button');
  await bp.click('.item:has-text("Jasraj Bhuller")');
  await bp.waitForSelector('text=confirmed Day 1 on their welcome page');
  ok(true, 'booker snapshot shows ✅ confirmed');

  // ── 6. Admin: JUSS message, RED approval, slide QR codes ──
  console.log('admin');
  await api(await loginApi('abdullahi@example.com'), 'saveOutcome', { id: adham.id, outcome: 'Academy booked', academy_date: '2026-10-19', outcome_notes: '' });
  const pend = await api(await loginApi('mo@example.com'), 'saveOutcome', { id: ishita.id, outcome: 'Academy booked', academy_date: '2026-10-19', outcome_notes: 'keen' });
  ok(pend.admin_status === 'pending', 'RED candidate booked by booker → waits for admin');
  ok((await pushesTo(angadId)).some(p => /Decision needed/.test(p.body.headings.en)), 'PUSH → admins: "Decision needed"');

  const ad = await browser.newContext(PHONE);
  const ap = await ad.newPage();
  await loginUi(ap, 'angad@linkmarketing.org.uk');
  await ap.goto(APP + 'index.html?c=' + adham.id);
  await ap.waitForSelector('a.wa[data-kind=offer]');
  const jmsg = decodeURIComponent((await ap.getAttribute('a.wa[data-kind=offer]', 'href')).split('?text=')[1]);
  fs.writeFileSync(`${SHOTS}/msg-juss.txt`, jmsg);
  ok(/JUSS Marketing BA Academy/.test(jmsg) && /welcome-juss\.html/.test(jmsg) && !/Pre-Coaching/.test(jmsg), 'JUSS booker → JUSS message + JUSS welcome page');
  ok(/– Rubal, JUSS Marketing$/.test(jmsg), 'JUSS message signed by Rubal (sent by Angad)');
  const jwurl = jmsg.match(/https:\/\/\S+welcome-juss\.html\?t=\w+/)[0];
  const jp = await cand.newPage();
  await jp.goto(jwurl.replace(PUBLIC, APP));
  await jp.waitForSelector('text=You\'re in, Adham');
  await shot(jp, '12-welcome-juss', true);
  ok(/Thursday onwards/.test(await jp.innerText('body')), 'JUSS welcome page uses the JUSS schedule');

  await ap.goto(APP + 'index.html?c=' + ishita.id);
  await ap.waitForSelector('#approve');
  ok(!(await ap.$('a.wa[data-kind=offer]')), 'no Academy WhatsApp until admin approves');
  await ap.click('#reject');
  await ap.waitForSelector('text=Rejected by');

  await ap.click('.tabbar button[data-tab=team]');
  await ap.waitForSelector('#slideqr');
  await ap.click('#slideqr');
  await ap.waitForSelector('.qrcard img');
  await shot(ap, '13-slide-qr-codes', true);
  const qrs = await ap.$$eval('.qrcard p.small', els => els.map(e => e.textContent));
  ok(qrs[0] === PUBLIC + 'checkin.html' && qrs[1] === PUBLIC + 'eval.html', 'slide QR codes point to the permanent check-in / evaluation pages');

  await api(admin, 'reassignBooker', { id: ali.id, booker_id: fiza.id });
  await api(admin, 'setPayExcluded', { id: jag.id, excluded: true, reason: 'Share code failed at Academy' });

  // ── 7. Sunday close → logged but LATE; pay ──
  await setTime('2026-10-18T15:00:00+01:00');
  const late = await api(await loginApi('fiza@example.com'), 'saveOutcome', { id: ali.id, outcome: 'No answer', outcome_notes: '' });
  ok(late.outcome_late === 'TRUE', 'outcome logged on Sunday accepted but flagged LATE');
  const pay = await api(admin, 'payReport', { weekEnding: '2026-10-18' });
  const prow = n => pay.rows.find(r => r.name === n);
  ok(prow('Fiza Iqbal').net === 2 && prow('Fiza Iqbal').late === 1, 'pay: Fiza net 2, 1 late');
  ok(prow('Mo Aden').net === 0, 'pay: Mo net 0 (Tier 4 excluded; Seven + Late Arrival not rated by presenter)');
  ok(prow('Abdullahi Ahmed').net === 1, 'pay: Abdullahi net 1 (Jagpreet repeat + removed)');
  await ap.goto(APP + 'index.html'); await ap.waitForSelector('.tabbar button');
  await ap.click('.tabbar button[data-tab=pay]'); await ap.waitForSelector('.payrow');
  await shot(ap, '14-admin-pay', true);

  // ── 8. Check-in outside hours: accepted, flagged amber for admins only ──
  await setTime('2026-10-19T21:00:00+01:00');
  const owl = await ci({ full_name: 'Night Owl', mobile: '07700900111', email: 'n@example.com', booker_id: fiza.id });
  ok(!!owl.id, 'check-in after 17:00 still goes through (candidate just sees "checked in")');
  ok((await api(admin, 'getCandidate', { id: owl.id })).flags.some(f => /outside office hours/.test(f.text)), 'admin sees amber "checked in at 21:00 (outside office hours)"');

  // ── 9. Rejected person returns next week → red; scheduled pushes ──
  await setTime('2026-10-20T10:00:00+01:00');
  const back = await ci({ full_name: 'Ishita Rani', mobile: '07700900200', email: 'ishita@example.com', booker_id: abd.id, rtw: 'Graduate visa (PSW)', visa_expiry: '2028-01-01' });
  await api(nathan, 'saveNotes', { id: back.id, rag: 'A', stars: 2, tags: [], notes: '' });
  const again = await api(admin, 'getCandidate', { id: back.id });
  ok(again.flags.some(f => f.level === 'red' && /Previously not suitable/.test(f.text)), 'rejected candidate returning shows red "do not progress"');
  ok(/Repeat/.test(again.pay_reason), 'repeat attendee does not count for pay');
  const before = (await getJson('/dev/pushes')).length;
  await post('/dev/run', { fn: 'weeklyProgressEmails' });
  ok((await getJson('/dev/pushes')).slice(before).some(p => /net attended|target/.test(p.body.headings.en)), 'scheduled progress alert goes out as a push');

  // ── 10. Access removed / Apps Script fallback / GDPR ──
  await api(admin, 'saveUser', { user: Object.assign({}, fiza, { active: false }) });
  const fz = await loginApi('mo@example.com');
  await api(admin, 'saveUser', { user: Object.assign({}, mo, { active: false }) });
  ok((await post('/api', { action: 'me', token: fz })).auth === true, 'switched-off user is locked out immediately');

  const gas = await browser.newContext(PHONE);
  const gp = await gas.newPage();
  await gp.goto(BASE + '/exec?go=eval');
  await gp.waitForSelector('text=Evaluation time');
  ok(true, 'Google Apps Script link still works as a fallback');

  await setTime('2027-10-25T03:00:00+01:00');
  await post('/dev/run', { fn: 'dailyMaintenance' });
  ok((await getJson('/dev/sheet?name=Candidates')).length === 1, 'records older than 12 months deleted automatically');

  await browser.close();
  console.log('\nALL CHECKS PASSED');
  process.exit(0);
})().catch(e => { console.error('\nFAILED:', e); process.exit(1); });
