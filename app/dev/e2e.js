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
async function tapToText(page, selector, text, keepFocus) {
  await page.evaluate(t => {
    window.__tap = 0; window.__seen = 0;
    document.addEventListener('click', () => { window.__tap = performance.now(); }, { capture: true, once: true });
    const mo = new MutationObserver(() => { if (window.__tap && !window.__seen && document.body.innerText.includes(t)) { window.__seen = performance.now(); mo.disconnect(); } });
    mo.observe(document.body, { subtree: true, childList: true, characterData: true });
  }, text);
  if (keepFocus) await page.evaluate(sel => document.querySelector(sel).click(), selector);  // iPhone: text box stays focused
  else await page.click(selector);
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
  // Simulate Angad's live Sheet, created before the presenter-question columns existed
  await post('/dev/eval', { js: "SpreadsheetApp.getActive().getSheetByName('Candidates').data[0].splice(-3)" });
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
  const adham = await ci({ full_name: 'Adham Soliman', mobile: '07700900300', email: 'adham@example.com', booker_id: abd.id, source: 'Friend who works here (BA referral)' });
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
  ok(!(await pp.$('.chips[data-name=why]')), 'presenter types the answers (no tap options in presenter notes)');
  await pp.fill('#whynote', 'Wants to earn on results, saving for a house');
  await pp.fill('#interesting', 'Plays semi-pro football');
  await pp.click('.chips[data-name=tags] .chip:has-text("Great energy")');
  await pp.click('.chips[data-name=tags] .chip:has-text("Future owner")');
  await pp.fill('#notes', 'Southall. Likes performance-based earnings, looking for personal development + environment. Strong.');
  await pp.click('#savenotes');
  await pp.waitForSelector('text=In the room · saved');
  await shot(pp, '04-presenter-notes', true);
  ok((await api(admin, 'getCandidate', { id: (await api(admin, 'search', { q: 'Jasraj' })).items[0].id })).in_room === 'TRUE', 'rating Jasraj automatically confirmed "in the room"');
  const thanks = decodeURIComponent((await pp.getAttribute('a.wa[data-kind=thanks]', 'href')).split('?text=')[1]);
  fs.writeFileSync(`${SHOTS}/msg-thanks.txt`, thanks);
  ok(thanks === "Hey Jasraj! 👋\n\nThanks for coming through for your Appointment Presentation today in association with LINK Marketing.\nWe loved meeting you in person.\n\nOur Team will contact you at the latest by close of business on Friday 6PM about your next steps 📲\nKeep your phone close!",
    'thank-you WhatsApp = Angad\'s wording (LINK, contact by Friday 6PM)');
  for (const [c, rag] of [[ishita, 'R'], [adham, 'G'], [ali, 'A'], [jag, 'A'], [kid, 'R']]) {
    await api(nathan, 'saveNotes', { id: c.id, rag, stars: rag === 'G' ? 3 : 2, tags: [], notes: 'test' });
  }

  // ── 3. QR #2 on the last slide → evaluation ──
  console.log('evaluation (QR 2)');
  await cp.goto(APP + 'eval.html');
  await cp.waitForSelector('text=Your evaluation, Jasraj');
  ok(true, 'same phone: evaluation QR opens straight into Jasraj\'s evaluation');
  const q3 = await cp.$$eval('.chips[data-name=q3_reason] .chip', els => els.map(e => e.textContent));
  ok(['Uncapped earnings', 'Career progression', 'Learn new skills'].every(x => q3.includes(x)), 'evaluation keeps the standard options: earnings, career progression, learn new skills');
  await fillEval(cp);
  await shot(cp, '05-evaluation', true);
  await cp.click('#go');
  await cp.waitForSelector('text=Thank you, Jasraj!');
  ok(/by close of business on Friday 6PM/.test(await cp.innerText('body')), 'after the evaluation: "Thank you, Jasraj!" + contact by Friday 6PM');
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
  await p2.waitForSelector('text=Is this you, Adham?');
  ok(true, 'typed mobile → "Is this you, Adham?" first (a typo can\'t open someone else\'s form)');
  await p2.click('#yes');
  await p2.waitForSelector('text=Your evaluation, Adham');
  ok(true, 'different phone: evaluation QR finds Adham by mobile number');
  await p2c.close();
  // Same person scans the evaluation QR again after sending it → told it's already done (not a confusing "thank you")
  const p2d = await browser.newContext(PHONE);
  const p2e = await p2d.newPage();
  await p2e.goto(APP + 'eval.html'); await p2e.fill('#m', '07700 900123'); await p2e.click('#go');
  await p2e.waitForSelector('text=Already done, Jasraj');
  ok(/already sent your evaluation today/.test(await p2e.innerText('body')), 'evaluation sent already → "Already done, Jasraj. You\'ve already sent your evaluation today."');
  await p2e.click('#edit');
  await p2e.waitForSelector('text=Change your answers, Jasraj');
  ok((await p2e.$$('.chips[data-name=q3_reason] .chip.on')).length === 1, 'made a mistake → "Change my answers" opens the form with their answers filled in');
  await p2e.fill('textarea[name=q14_questions]', 'Changed my mind: when is Day 1?');
  await post('/dev/eval', { js: 'globalThis.__lockBusy = 2' });  // Google busy: 2 people ahead in the queue
  const tEdit = Date.now();
  await p2e.click('#go');
  await p2e.waitForSelector('text=Updated, Jasraj!', { timeout: 30000 });
  const jasId = (await api(admin, 'search', { q: 'Jasraj' })).items[0].id;
  const jasNow = await api(admin, 'getCandidate', { id: jasId });
  ok(jasNow.q14_questions === 'Changed my mind: when is Day 1?' && !!jasNow.eval_edited_at, 'Google busy → the save waits its turn and goes through by itself (' + Math.round((Date.now() - tEdit) / 1000) + 's), answers updated');
  ok((await pushesTo(fiza.id)).some(p => /Jasraj changed their evaluation answers/.test(p.body.headings.en)), 'PUSH → booker: "Jasraj changed their evaluation answers"');
  await p2d.close();

  // Never checked in → evaluation QR offers check-in, then evaluation straight after
  const p3c = await browser.newContext(PHONE);
  const p3 = await p3c.newPage();
  await p3.goto(APP + 'eval.html');
  await p3.fill('#m', '07700 900600');
  await p3.click('#go');
  await p3.waitForSelector('text=can\'t find a check-in');
  await p3.click('#ci');
  await fillCheckin(p3, { name: 'Late Arrival', mobile: '07700 900600', email: 'late@example.com', booker: 'Mo Aden' });
  await post('/dev/eval', { js: 'globalThis.__lockBusy = 2' });
  await p3.click('#go');
  await p3.waitForSelector('text=Busy, still checking you in…', { timeout: 5000 });
  await p3.waitForSelector('text=Your evaluation, Late', { timeout: 30000 });
  ok(true, '10am rush: Google busy → candidate sees "Busy, still checking you in…" and gets in by itself (no error)');
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
  ok(!(await pp.$('#bullDaily')), "presenters don't see the bulletin buttons (admins only)");
  await post('/dev/delay', { ms: 0 });
  ok(true, 'phone back button returns to the list');

  // Level 1: offline engine, instant saves, swipe, dark mode
  await pp.reload(); await pp.waitForSelector('.tabbar button');
  ok(await pp.evaluate(() => navigator.serviceWorker.getRegistration().then(r => !!(r && r.active))), 'app is installed on the phone (service worker active)');
  // A new version is published while the phone has the old one saved → must show on the very next open
  const idx = path.join(__dirname, '..', '..', 'join', 'index.html');
  const orig = fs.readFileSync(idx, 'utf8');
  fs.writeFileSync(idx, orig.replace('<head>', '<head><meta name="build-test" content="NEW">'));
  await pp.reload(); await pp.waitForSelector('.tabbar button');
  const gotNew = await pp.$('meta[name="build-test"]');
  fs.writeFileSync(idx, orig);
  ok(!!gotNew, 'a newly published version shows on the very next open (not stuck on the old copy)');
  await pp.reload(); await pp.waitForSelector('.tabbar button');
  // OneSignal registers the same worker file with its own "?appId=…": the app must not fight it or reload
  await pp.evaluate(() => { window.__still = 1; return navigator.serviceWorker.register('OneSignalSDKWorker.js?appId=test&sdkVersion=160000', { scope: './' }); });
  await pp.waitForFunction(() => navigator.serviceWorker.controller && /appId=test/.test(navigator.serviceWorker.controller.scriptURL), null, { timeout: 10000 });
  await pp.waitForTimeout(3000);
  ok(await pp.evaluate(() => window.__still === 1), 'OneSignal taking over the worker does not reload the app');
  await pp.reload(); await pp.waitForSelector('.tabbar button'); await pp.waitForTimeout(1500);
  ok(await pp.evaluate(() => navigator.serviceWorker.getRegistration().then(r => /appId=test/.test(r.active.scriptURL))), "next open keeps OneSignal's worker (no swapping back and forth)");
  await pp.click('#abMe');
  ok(/Alerts: not set up yet/.test(await pp.innerText('#menu')), 'account menu shows the alerts status');
  await pp.click('#menu', { position: { x: 5, y: 5 } });
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
  await post('/dev/eval', { js: 'globalThis.__lockBusy = 1' });
  await pp.fill('#notes', 'Saved while Google was busy.');
  await pp.click('#savenotes');
  await pp.waitForFunction(() => !JSON.parse(localStorage.getItem('lr_outbox') || '[]').length, null, { timeout: 20000 });
  ok((await api(admin, 'getCandidate', { id: jag.id })).notes === 'Saved while Google was busy.', "presenter's save while Google is busy → kept and retried, not lost");
  await pp.goBack(); await pp.waitForSelector('.kpis');
  // A background refresh can redraw the list mid-swipe, so swipe again if it didn't stick.
  for (let i = 0; i < 3 && !(await pp.$('.swipe.open')); i++) {
    await pp.evaluate(() => {
      const sw = document.querySelector('.swipe'); const t = (type, x) => sw.dispatchEvent(new TouchEvent(type, { bubbles: true, touches: type === 'touchend' ? [] : [new Touch({ identifier: 1, target: sw, clientX: x, clientY: 200 })] }));
      t('touchstart', 300); t('touchmove', 250); t('touchmove', 150); t('touchmove', 100); t('touchend', 100);
    });
    await pp.waitForSelector('.swipe.open', { timeout: 3000 }).catch(() => {});
  }
  await pp.waitForSelector('.swipe.open', { timeout: 1000 });
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
  ok(/💡 Plays semi-pro football/.test(snap) && /Wants to earn on results, saving for a house/.test(snap), 'booker sees the room answers: 💡 ice-breaker + why sales');
  const hdr = (await getJson('/dev/sheet?name=Candidates'))[0];
  ok(hdr.slice(-4).join() === 'p_why_sales,p_why_sales_note,p_interesting,eval_edited_at', 'existing Sheet got the new columns automatically (no data moved)');
  ok(!/Unspent convictions/.test(snap), 'conviction answer hidden from bookers');
  await bp.click('.chips[data-name=outcome] .chip:has-text("Academy booked")');
  await bp.fill('#adate', '2026-10-19');
  await bp.fill('#onotes', 'Great call.');
  await post('/dev/delay', { ms: 1500 });  // Google-like delay, like on Angad's phone
  const tOut = await tapToText(bp, '#saveout', 'Outcome saved ✓', true);
  ok(tOut < 300, 'outcome save feels instant (' + tOut + 'ms after the tap)');
  await bp.waitForSelector('a.wa[data-kind=offer]', { timeout: 10000 });
  await post('/dev/delay', { ms: 0 });
  ok(true, 'iPhone-style save (notes box still focused): 🎉 congratulations button appears once synced');
  await shot(bp, '09-booker-outcome', true);
  await bp.goBack(); await bp.waitForSelector('text=🎉 Send congratulations');
  ok(true, 'list shows "🎉 Send congratulations" until it\'s sent');
  await bp.click('.item:has-text("Jasraj Bhuller")'); await bp.waitForSelector('a.wa[data-kind=offer]');
  const msg = decodeURIComponent((await bp.getAttribute('a.wa[data-kind=offer]', 'href')).split('?text=')[1]);
  fs.writeFileSync(`${SHOTS}/msg-link.txt`, msg);
  const wurl = (msg.match(/https:\/\/\S+welcome-link\.html\?t=\w+/) || [])[0];
  ok(/^JASRAJ!! 🎉 You're IN\./.test(msg) && /Pre-Coaching Module/.test(msg) && wurl, 'LINK WhatsApp: Gen Z copy + personal welcome link');
  ok(/– Jess, LINK Marketing$/.test(msg), 'LINK message signed by Jess (sent by Fiza)');
  const links = msg.match(/https:\/\/\S+/g);
  ok(/welcome-link\.html/.test(links[0]), 'first link is the welcome page (so WhatsApp shows the poster card)');
  ok(links.some(l => l.indexOf('forms.office.com') >= 0 && l.indexOf('QT4blMNFxEuaVSUMKK6uNT5Z') > 0), 'LINK message carries the Pre-Coaching Module link');
  ok(links.indexOf('https://maps.app.goo.gl/f4pkh222EHHTyQSM9') >= 0, 'LINK message carries LINK Marketing\'s Google Maps listing');
  ok(/⏳ Not confirmed yet/.test(await bp.innerText('body')), 'snapshot shows "not confirmed yet"');

  // ── 5. Candidate opens their welcome page from WhatsApp → confirms ──
  console.log('welcome page');
  const wp = await cand.newPage();
  await wp.goto(wurl.replace(PUBLIC, APP));
  await wp.waitForSelector('text=You\'re in, Jasraj');
  await shot(wp, '10-welcome-page', true);
  const wtxt = await wp.innerText('body');
  ok(/Monday 19 October/.test(wtxt) && /Day 1 is in 7 days/.test(wtxt) && /Pre-Coaching Module/.test(wtxt) && /Practical Learning Day/.test(wtxt), 'welcome page: date, countdown, pre-coaching, Week 1 plan');
  ok(/forms\.office\.com/.test(await wp.getAttribute('a:has-text("Open the Pre-Coaching Module")', 'href')) && (await wp.getAttribute('a:has-text("Google Maps")', 'href')) === 'https://maps.app.goo.gl/f4pkh222EHHTyQSM9', 'LINK welcome page: Pre-Coaching Module button + LINK Google Maps listing');
  ok(await wp.$eval('.wl-poster img', i => i.complete && i.naturalWidth > 0 && /poster-link/.test(i.src)), 'LINK welcome page shows the LINK Week 1 poster (your screenshot)');
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
  const lockedEdit = await post('/api', { action: 'myEval', id: adham.id, resume: adham.resume });
  ok(!lockedEdit.ok && /can't be changed/.test(lockedEdit.error), 'once the booker has logged the call, the candidate can no longer change their answers');
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
  ok(jmsg.indexOf('https://maps.app.goo.gl/zeP4MjS2hMJzB9V9A') >= 0 && jmsg.indexOf('f4pkh222') < 0 && !/forms\.office\.com/.test(jmsg), 'JUSS message carries JUSS Marketing\'s Google Maps listing (no LINK pre-coaching)');
  ok(/– Rubal, JUSS Marketing$/.test(jmsg), 'JUSS message signed by Rubal (sent by Angad)');
  const jwurl = jmsg.match(/https:\/\/\S+welcome-juss\.html\?t=\w+/)[0];
  const jp = await cand.newPage();
  await jp.goto(jwurl.replace(PUBLIC, APP));
  await jp.waitForSelector('text=You\'re in, Adham');
  await shot(jp, '12-welcome-juss', true);
  ok(/Thursday onwards/.test(await jp.innerText('body')), 'JUSS welcome page uses the JUSS schedule');
  ok((await jp.getAttribute('a:has-text("Google Maps")', 'href')) === 'https://maps.app.goo.gl/zeP4MjS2hMJzB9V9A' && !(await jp.$('a:has-text("Pre-Coaching Module")')), 'JUSS welcome page: JUSS Google Maps listing, no pre-coaching button');
  ok(await jp.$eval('.wl-poster img', i => i.complete && i.naturalWidth > 0 && /poster-juss/.test(i.src)), 'JUSS welcome page shows the JUSS Week 1 poster (your screenshot)');
  const jog = await (await fetch(jwurl.replace(PUBLIC, APP))).text();
  ok(jog.includes('og:image" content="' + PUBLIC + 'img/og-juss.jpg"'), 'JUSS WhatsApp link preview shows the JUSS poster card');
  const appHtml = await (await fetch(APP + 'index.html')).text();
  ok(appHtml.includes('og:title" content="Juss & Link Recruitment App"') && appHtml.includes('img/og-app.jpg') && appHtml.includes('apple-mobile-web-app-title" content="Juss & Link Recruitment App"'),
    'sharing the app link shows "Juss & Link Recruitment App" + logo card; same name when added to the home screen');

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

  // Shared phone: someone else's check-in is saved on it → "Not you?" gives a fresh form
  const shc = await browser.newContext(PHONE);
  const shp = await shc.newPage();
  await shp.goto(APP + 'checkin.html');
  await shp.evaluate(a => localStorage.setItem('lr_cand', JSON.stringify(a)), { id: adham.id, resume: adham.resume, first_name: 'Adham' });
  await shp.goto(APP + 'checkin.html');
  await shp.waitForSelector('#notme');
  await shp.click('#notme'); await shp.waitForSelector('[name=full_name]');
  ok(true, 'shared phone: "Not you? Check someone else in" → a fresh check-in form');
  await shc.close();

  // ── Daily 18:00 round-up for every booker (runs from the 5-minute keep-warm, no extra trigger) ──
  await setTime('2026-10-12T17:55:00+01:00');
  let before18 = (await getJson('/dev/pushes')).length;
  await post('/dev/run', { fn: 'keepWarm' });
  ok((await getJson('/dev/pushes')).length === before18, 'no round-up before 18:00');
  await setTime('2026-10-12T18:05:00+01:00');
  await post('/dev/run', { fn: 'keepWarm' });
  const digests = (await getJson('/dev/pushes')).slice(before18);
  const dFiza = digests.find(p => p.body.include_aliases.external_id.includes(fiza.id));
  ok(dFiza && /^📊 Today: \d+ in · \d+ evaluations?/.test(dFiza.body.headings.en) && /Week: \d+\/5 net attended/.test(dFiza.body.contents.en),
    '18:00 round-up → Fiza: "' + (dFiza ? dFiza.body.headings.en + ' | ' + dFiza.body.contents.en.replace(/\n/g, ' | ') : 'none') + '"');
  const jessId = (await api(admin, 'listUsers', {})).users.find(u => /Jess/.test(u.name)).id;
  ok(!digests.some(p => p.body.include_aliases.external_id.includes(jessId)), 'no round-up for someone with no appointments (no spam)');
  await post('/dev/run', { fn: 'keepWarm' });
  ok((await getJson('/dev/pushes')).length === before18 + digests.length, 'sent once a day only (the next run 5 minutes later sends nothing)');
  // Friday 15:00: week roundup to each booker + team roundup to admins (instead of the 18:00 round-up)
  await setTime('2026-10-16T14:55:00+01:00');
  const beforeFri = (await getJson('/dev/pushes')).length;
  await post('/dev/run', { fn: 'keepWarm' });
  ok((await getJson('/dev/pushes')).length === beforeFri, 'Friday: nothing before 15:00');
  await setTime('2026-10-16T15:05:00+01:00');
  await post('/dev/run', { fn: 'keepWarm' });
  const fri = (await getJson('/dev/pushes')).slice(beforeFri);
  const rFiza = fri.find(p => p.body.include_aliases.external_id.includes(fiza.id));
  ok(rFiza && /^🏁 Week roundup: \d+ appointments? · \d+ booked$/.test(rFiza.body.headings.en) && /✅ Booked: /.test(rFiza.body.contents.en) && /Day 1 text/.test(rFiza.body.contents.en),
    'Friday 15:00 → Fiza: "' + (rFiza ? rFiza.body.headings.en + ' | ' + rFiza.body.contents.en.replace(/\n/g, ' | ') : 'none') + '"');
  const rTeam = fri.find(p => p.body.include_aliases.external_id.includes(angadId) && /^📋 Team week/.test(p.body.headings.en));
  ok(rTeam && /Fiza Iqbal: \d+ in/.test(rTeam.body.contents.en) && /Day 1 texts sent \d+\/\d+/.test(rTeam.body.contents.en),
    'Friday 15:00 → admins get the team roundup: "' + (rTeam ? rTeam.body.headings.en + ' | ' + rTeam.body.contents.en.replace(/\n/g, ' | ') : 'none') + '"');
  await setTime('2026-10-16T18:05:00+01:00');
  await post('/dev/run', { fn: 'keepWarm' });
  ok((await getJson('/dev/pushes')).length === beforeFri + fri.length, 'no extra 18:00 message on Friday');

  // ── 7. Sunday close → logged but LATE; pay ──
  await setTime('2026-10-18T15:00:00+01:00');
  const late = await api(await loginApi('fiza@example.com'), 'saveOutcome', { id: ali.id, outcome: 'No answer', outcome_notes: '' });
  ok(late.outcome_late === 'TRUE', 'outcome logged on Sunday accepted but flagged LATE');
  const pay = await api(admin, 'payReport', { weekEnding: '2026-10-18' });
  ok(pay.deadline === '2026-10-16 18:00' && (await api(admin, 'me', {})).deadlineLabel === 'Fri 18:00', 'outcome deadline = Friday 18:00 (matches "by Friday 6PM" in the thank-you WhatsApp)');
  const prow = n => pay.rows.find(r => r.name === n);
  ok(prow('Fiza Iqbal').net === 2 && prow('Fiza Iqbal').late === 1, 'pay: Fiza net 2, 1 late');
  ok(prow('Mo Aden').net === 0, 'pay: Mo net 0 (Tier 4 excluded; Seven + Late Arrival not rated by presenter)');
  ok(prow('Abdullahi Ahmed').net === 1, 'pay: Abdullahi net 1 (Jagpreet repeat + removed)');
  await ap.goto(APP + 'index.html'); await ap.waitForSelector('.tabbar button');
  await ap.click('.tabbar button[data-tab=pay]'); await ap.waitForSelector('.payrow');
  await shot(ap, '14-admin-pay', true);

  // ── Bulletins: one tap for admins, same numbers as Pay ──
  await ap.click('.tabbar button[data-tab=today]'); await ap.waitForSelector('#bullDaily');
  for (let i = 0; i < 6; i++) await ap.click('#dprev');
  await ap.click('#bullDaily');
  await ap.waitForSelector('#bimg[data-info]', { timeout: 15000 });
  const bInfo = async () => JSON.parse(await ap.getAttribute('#bimg', 'data-info'));
  const monday = (await api(admin, 'listWeek', { weekEnding: '2026-10-18' })).items.filter(c => c.attended_date === '2026-10-12' && (c.in_room === true || c.in_room === 'TRUE'));
  let bi = await bInfo();
  ok(bi.kind === 'daily' && bi.attended === monday.length && bi.nonQual === monday.filter(c => c.pay_reason).length && bi.nonQual > 0,
    'daily bulletin: ' + bi.attended + ' attended, ' + bi.nonQual + ' non-qualifiers (rated only, same rules as Pay)');
  const expRows = pay.rows.filter(r => r.net > 0).sort((a, b) => b.net - a.net).map(r => r.name.split(' ')[0] + ' ' + r.net);
  ok(JSON.stringify(bi.rows.map(r => r.replace(/^\S+ /, '').replace(/ BAR$/, ''))) === JSON.stringify(expRows) && /^🥇 /.test(bi.rows[0]), 'top performers match Pay, gold for #1: ' + bi.rows.join(' · '));
  ok(await ap.$eval('#bimg', i => i.complete && i.naturalWidth === 1536 && i.naturalHeight === 2304), 'poster image made on the phone (1536×2304)');
  const saveImg = async f => fs.writeFileSync(`${SHOTS}/${f}`, Buffer.from(await ap.$eval('#bimg', i => fetch(i.src).then(r => r.arrayBuffer()).then(b => Array.from(new Uint8Array(b))))));
  await saveImg('15-bulletin-daily.jpg');
  await shot(ap, '15b-bulletin-screen');
  ok(/Abdullahi 1 BAR$/.test(bi.rows[1]) && !/BAR/.test(bi.rows[0]), '(BAR) added automatically for a "BA referral" check-in (Adham → Abdullahi)');
  await ap.click('#bedit summary'); await ap.click('#bbar .chip');
  await ap.waitForFunction(() => /Fiza 2 BAR/.test(document.getElementById('bimg').dataset.info), null, { timeout: 5000 });
  ok(/BAR$/.test((await bInfo()).rows[0]), 'admin can still tap a name to add/remove (BAR)');
  const infoIs = (re) => ap.waitForFunction(r => { const i = document.getElementById('bimg'); return i && new RegExp(r).test(i.dataset.info || ''); }, re, { timeout: 10000 });
  await ap.click('.daybar .dchip[data-d="2026-10-13"]'); await infoIs('"attended":0');
  ok(await ap.$('.daybar .dchip.on[data-d="2026-10-13"]'), "tap Tue inside the bulletin → Tuesday's poster (no going back to Today)");
  await ap.click('#bwprev'); await ap.waitForSelector('.daybar .dchip.on[data-d="2026-10-06"]');
  ok(true, '‹ jumps to the same day last week');
  await ap.click('#bwnext'); await ap.waitForSelector('.daybar .dchip.on[data-d="2026-10-13"]');
  ok(await ap.$('#bwnext[disabled]'), "› stops at this week (can't go into the future)");
  await ap.click('.daybar .dchip[data-d="2026-10-12"]'); await infoIs('"attended":[1-9]');
  await ap.click('#bkind button[data-k=weekly]');
  await ap.waitForFunction(() => /weekly/.test((document.getElementById('bimg') || {}).dataset ? document.getElementById('bimg').dataset.info || '' : ''), null, { timeout: 10000 });
  bi = await bInfo();
  ok(bi.rows[0] === '🥇 ' + expRows[0], 'Week top 5 poster: ' + bi.rows.join(' · '));
  const blue = await ap.inputValue('#bm1').catch(async () => { await ap.click('#bedit summary'); return ap.inputValue('#bm1'); });
  ok(/Abdullahi.*BAR incentive.*1 BAR/.test(blue), 'blue box writes itself: "' + blue + '"');
  await saveImg('16-bulletin-week.jpg');
  const [dl] = await Promise.all([ap.waitForEvent('download'), ap.click('#bshare')]);
  ok(dl.suggestedFilename() === 'JL-top5-2026-10-18.jpg', 'Share → image ready for WhatsApp (saved where sharing isn\'t available)');
  await ap.click('#abBack'); await ap.waitForSelector('#bullDaily');

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
  await post('/dev/eval', { js: `globalThis.__pushOff = ['${abd.id}']` });
  const mailBefore = (await getJson('/dev/mail')).length;
  await post('/dev/run', { fn: 'weeklyProgressEmails' });
  const newMail = (await getJson('/dev/mail')).slice(mailBefore);
  ok(newMail.some(m => m.to === abd.email && /net attended|target/.test(m.subject)), 'booker who never turned alerts on still gets it, by email');
  ok(!newMail.some(m => m.to === fiza.email), 'booker with alerts on gets the push only (no duplicate email)');
  await post('/dev/eval', { js: 'globalThis.__pushOff = []' });

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
