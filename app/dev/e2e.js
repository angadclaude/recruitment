// End-to-end walk-through of the whole journey in a real browser (phone-sized), using the
// installable app (/join, what Vercel serves) wired to the real Code.gs on a fake Google backend.
// Usage: node app/build.js && node app/dev/e2e.js <screenshot-dir>   (starts its own dev server on :8787)
'use strict';
const { chromium } = require('playwright');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const BASE = 'http://localhost:8787';
const APP = BASE + '/join/';
const PUBLIC = require('../site.json').url;  // where the app lives (Code.gs PUBLIC_URL must match)
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
/** door: which login they tap. Default = the right one (Admin login for the admins, BA login for everyone else). */
async function loginUi(page, email, url, door) {
  await page.goto(url || APP + 'index.html');
  await page.click('#doors button[data-door=' + (door || (/@(linkmarketing|jussmarketing)\./.test(email) ? 'admin' : 'ba')) + ']');
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
// The test server's clock and every test phone's clock move together, so the suite doesn't depend on today's real date
// (17 Oct: phones on the real clock were past the test week's Friday 18:00 deadline, so every save came back "late")
let CLOCK_OFF = 0;
const CONTEXTS = [];
const setTime = async iso => {
  CLOCK_OFF = iso ? new Date(iso).getTime() - Date.now() : 0;
  await Promise.all(CONTEXTS.map(c => c.clock.setSystemTime(new Date(Date.now() + CLOCK_OFF)).catch(() => {})));
  return post('/dev/time', { iso });
};
const ok = (cond, msg) => { assert.ok(cond, msg); console.log('  ✓ ' + msg); };
const pushesTo = async id => (await getJson('/dev/pushes')).filter(p => p.body.include_aliases.external_id.includes(id));

const coOf = p => p.evaluate(() => document.body.dataset.co || '');
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
  // Who ran the presentation (the names come from Google: on a phone that didn't check in, a moment after the form)
  await p.waitForSelector('.chips[data-name=q0_presenter]', { timeout: 5000 }).catch(() => {});
  if (await p.$('.chips[data-name=q0_presenter]')) await p.click('.chips[data-name=q0_presenter] .chip:has-text("Nathan")');
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
  // Simulate Angad's live Sheet (15 Oct): created before the who-sent-it columns existed, with the presenter-question
  // headers written twice (two people opened the app the moment that version went live)
  await post('/dev/eval', { js: "(() => { const h = SpreadsheetApp.getActive().getSheetByName('Candidates').data[0]; h.splice(-5); h.push('presented_by_id', 'presented_by'); return h.length; })()" });
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
  ok((await getJson('/dev/mail')).some(m => m.to === 'fiza@example.com' && /Set up the Juss & Link Recruitment App/.test(m.subject) && /Alerts: on ✅/.test(m.htmlBody)),
    'adding someone emails them the 2-minute setup steps straight away (log in, Add to Home Screen, turn on alerts)');
  const nathan = await loginApi('nathan@example.com');

  // Old Google Form history (last 6 months imported = the repeat window)
  await post('/dev/eval', { js: `
    const s = SpreadsheetApp.getActive().insertSheet('Form Responses 1');
    s.data = [['Timestamp','FOR OFFICE USE ONLY :','Full Name :','Phone number : ','Email ID :','Please tell us who booked you in to meet with us today?','Earliest start date : ','Who was the presentation run by today? '],
      [new Date('2026-06-05T10:00:00Z'),'','jagpreet kular','07700 900999','jag@example.com','Abdullahi','asap','Nathan'],
      [new Date('2026-03-01T10:00:00Z'),'','Seven Months','07700 900777','seven@example.com','Ian','asap','Mo'],
      [new Date('2025-01-05T10:00:00Z'),'','Too Old','07700 900888','old@example.com','X','asap','Y']];
    importHistory();` });
  const hist = await getJson('/dev/sheet?name=History');
  ok(hist.length === 2, 'history import keeps the last 6 months only');

  const browser = await chromium.launch();
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (...a) => { const ctx = await newContext(...a); CONTEXTS.push(ctx); await ctx.clock.setSystemTime(new Date(Date.now() + CLOCK_OFF)); return ctx; };

  // ── 1. QR #1 on the first slide → check-in ──
  console.log('candidate check-in (QR 1)');
  const cand = await browser.newContext(PHONE);
  const cp = await cand.newPage();
  await cp.goto(APP + 'checkin.html');
  await cp.waitForSelector('#f');
  await shot(cp, '01-checkin-empty');
  ok(await coOf(cp) === '' && (await cp.$$('.brandbar img')).length === 2, 'check-in opens in the shared look with both logos (company not known yet)');
  await fillCheckin(cp, { name: 'jasraj bhuller', mobile: '07700 900123', email: 'jasraj@example.com', booker: 'Fiza Iqbal', rtw: 'Graduate visa (PSW)', expiry: '2027-11-30' });
  ok(await coOf(cp) === 'LINK' && await cp.evaluate(() => document.documentElement.classList.contains('t-LINK')) && /You're with\s+LINK Marketing/.test(await cp.innerText('#with')),
    'picking a LINK booker (Fiza) switches the check-in to LINK colours ("You\'re with LINK Marketing")');
  await cp.click('#go');
  await cp.waitForSelector('text=You\'re checked in, Jasraj!');
  ok(await coOf(cp) === 'LINK' && (await cp.$$('.brandbar img')).length === 1, 'checked-in screen: LINK colours + LINK logo only');
  ok(/After the presentation, please scan the second QR code on the screen \(Evaluation form\) for us to proceed with your application\./.test(await cp.innerText('body')), 'checked-in screen: "After the presentation, please scan the second QR code… to proceed with your application."');
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
  // Non-qualifiers (under 18, Tier 4 and the other no-right-to-work answers): Jess + Rubal + their booker hear straight away
  const jId = users.find(u => /^jess@/.test(u.email)).id, rId = users.find(u => /^rubal@/.test(u.email)).id;
  const nqTo = async name => (await getJson('/dev/pushes')).filter(p => p.body.headings.en === '⛔ Non-qualifier checked in: ' + name);
  const kidP = await nqTo('Young Person'), ishP = await nqTo('Ishita Rani');
  const ids = list => list.map(p => p.body.include_aliases.external_id[0]).sort().join();
  ok(ids(kidP) === [jId, rId, fiza.id].sort().join() && /^Under 18 · booked by Fiza Iqbal\. No evaluation form/.test(kidP[0].body.contents.en),
    'under-18 checks in → instant push to Jess, Rubal and their booker only: "⛔ Non-qualifier checked in: Young Person"');
  ok(ids(ishP) === [jId, rId, mo.id].sort().join() && /Student visa \(Tier 4\) · booked by Mo Aden/.test(ishP[0].body.contents.en), 'Tier 4 checks in → the same alert (to Jess, Rubal and Mo)');
  ok(!(await pushesTo(fiza.id)).some(p => /Young just checked in/.test(p.body.headings.en)) && (await pushesTo(abd.id)).some(p => /Adham just checked in/.test(p.body.headings.en)),
    'the booker gets the non-qualifier alert instead of "just checked in" (everyone else still gets "just checked in")');
  const nbP = (await getJson('/dev/pushes')).filter(p => /^❓ No booker: Ali Yilmaz just checked in$/.test(p.body.headings.en));
  ok(ids(nbP) === [jId, rId].sort().join() && /They typed "Ian" \(not on the team list\)/.test(nbP[0].body.contents.en),
    'check-in with a booker not on the list → Jess + Rubal: "❓ No booker: Ali Yilmaz just checked in · They typed "Ian"…" (otherwise nobody hears about them)');
  let bad = null; try { await ci({ full_name: 'Bad', mobile: '123', email: 'x@y.z', booker_id: fiza.id }); } catch (e) { bad = e.message; }
  ok(/full name/.test(bad), 'validation: single-word name rejected');
  ok((await api(admin, 'getCandidate', { id: jag.id })).flags.some(f => /Seen before/.test(f.text)), 'repeat within 6 months flagged (Jagpreet, June)');
  ok(!(await api(admin, 'getCandidate', { id: seven.id })).flags.some(f => /Seen before/.test(f.text)), 'NOT flagged when last seen 7 months ago');

  // ── 2. Presenter rates on their phone (rating = in the room) ──
  console.log('presenter');
  const pres = await browser.newContext(PHONE);
  const pp = await pres.newPage();
  await pp.goto(APP + 'index.html'); await pp.waitForSelector('#doors');
  ok((await pp.$$eval('#doors button', b => b.map(x => x.textContent.trim()))).join(' | ') === '🛡️ Admin login | 🙌 BA login' && /BA login/.test(await pp.innerText('#doorHead')),
    'login screen: two doors, Admin login + BA login (BA picked on a new phone)');
  await pp.click('#doors button[data-door=admin]');
  ok(/Angad, Jess, Satpal and Rubal/.test(await pp.innerText('#doorHead')), 'Admin login says it\'s for Angad, Jess, Satpal and Rubal');
  await api('', 'requestCode', { email: 'fiza@example.com' });
  const fizaCode = await lastCode('fiza@example.com');
  const wrong = await api('', 'verifyCode', { email: 'fiza@example.com', code: fizaCode, door: 'admin' });
  const right = await api('', 'verifyCode', { email: 'fiza@example.com', code: fizaCode, door: 'ba' });
  ok(wrong.wrongDoor === 'ba' && !wrong.token && right.token, 'a BA trying Admin login is pointed to BA login (no admin session), and the same code still works there');
  await loginUi(pp, 'nathan@example.com');
  await pp.waitForSelector('text=Jasraj Bhuller');
  ok(!(await pp.$('#qr')) && !(await pp.$('#ev')), 'presenter has no QR / "open evaluations" buttons to press');
  // Under 18 (Young Person) and Tier 4 (Ishita): no rating needed, so no rating buttons, and not in "N of M rated"
  const nqRow = async c => (await pp.$('.quick[data-for="' + c.id + '"]')) ? 'buttons' : await pp.innerText('.item[data-id="' + c.id + '"] .pills');
  const prTxt = await pp.innerText('.section-h:has-text("In the room")');
  ok(/No rating needed/.test(await nqRow(kid)) && /No rating needed/.test(await nqRow(ishita)) && /0 of 5 rated/.test(prTxt) && await pp.$('.quick[data-for="' + adham.id + '"] .q-G'),
    'presenter\'s Today: under 18 and Tier 4 show "No rating needed" (no buttons); everyone else has Green / Amber / Red ("' + prTxt.replace(/\n/g, ' ') + '")');
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
  const jasId = (await api(admin, 'search', { q: 'Jasraj' })).items[0].id;
  // Not their candidate (Fiza booked Jasraj): the presenter sees who booked them and the room rating, nothing else
  const lockedTxt = await pp.innerText('#page');
  ok(/Not your candidate/.test(lockedTxt) && /booked by Fiza Iqbal/.test(lockedTxt) && !/07700|jasraj@example|Call outcome|Graduate visa/.test(lockedTxt) && !(await pp.$('a[href^="tel:"]')) && !(await pp.$('a[data-kind]')) && !(await pp.$('#jump')),
    'presenter on someone else\'s candidate: who booked them ("booked by Fiza Iqbal"), rating + notes; no phone, email, right to work, evaluation, outcome or WhatsApp');
  await pp.goBack(); await pp.waitForSelector('.item[data-id="' + jasId + '"]');
  const jasRow = await pp.innerText('.item[data-id="' + jasId + '"] .sub');
  ok(/^Fiza Iqbal LINK · in \d\d:\d\d$/.test(jasRow), 'presenter\'s Today list: who booked each one: "' + jasRow + '"');
  await pp.click('.item[data-id="' + jasId + '"]'); await pp.waitForSelector('text=Not your candidate');
  const nathView = await api(nathan, 'getCandidate', { id: jasId });
  ok(nathView.limited && !nathView.mobile && !nathView.email && nathView.booker_name === 'Fiza Iqbal' && !nathView.booker_id && !nathView.rtw && !nathView.q2_stood_out && !nathView.outcome && nathView.notes && nathView.rag === 'G',
    'server: a presenter gets the room fields + who booked them for someone else\'s candidate, nothing else (the app can\'t show what it never receives)');
  const nope = await post('/api', { action: 'markSent', token: nathan, id: jasId, kind: 'offer' });
  ok(!nope.ok && /No access/.test(nope.error), 'server: nobody can send or log messages for someone else\'s candidate');
  // One tap on the Today list: Green / Amber / Red = in the room, and notes another presenter just wrote are kept
  await api(nathan, 'saveNotes', { id: jag.id, rag: '', stars: 0, tags: ['Quiet'], notes: 'Sat at the back' });
  await pp.goBack(); await pp.waitForSelector('.kpis');
  await pp.click('.quick[data-for="' + jag.id + '"] .q-R');
  await pp.waitForFunction(() => !JSON.parse(localStorage.getItem('lr_outbox') || '[]').length);
  const jagNow = await api(admin, 'getCandidate', { id: jag.id });
  ok(jagNow.rag === 'R' && jagNow.in_room === 'TRUE' && jagNow.notes === 'Sat at the back' && jagNow.tags === 'Quiet', 'presenter taps Red on the list → in the room; notes + tags already written are kept');
  ok(!(await pp.$('.quick[data-for="' + jag.id + '"]')), 'rated card drops its Green / Amber / Red buttons');
  // After the presentation: only Jess / Rubal (and admins) see the thank-you list
  ok(!(await pp.$('#thanksAll')) && /name, who booked them and the room rating only/.test(await pp.innerText('#page')) && !(await pp.$('.act.call')),
    'presenter\'s Today: no thank-you list, no call / WhatsApp on anyone else\'s card, "🔒 name, who booked them and the room rating only"');
  // Jess (LINK recruitment team): all her LINK appointments in one list, whoever booked them
  const jessCtx = await browser.newContext(PHONE);
  const jsp = await jessCtx.newPage();
  await loginUi(jsp, 'jess@linkmarketing.org.uk');
  await jsp.click('#thanksAll'); await jsp.waitForSelector('.sheet .trow');
  const trows = await jsp.$$eval('.sheet .trow', r => r.map(x => x.innerText));
  const linkRows = trows.slice(0, 5), jussRows = trows.slice(5);
  ok(trows.length === 7 && linkRows.some(t => /Ishita/.test(t) && /Mo Aden/.test(t)) && linkRows.some(t => /Ali Yilmaz/.test(t) && /booker not confirmed/.test(t)) && !linkRows.some(t => /Adham|Jagpreet/.test(t)) &&
    jussRows.length === 2 && jussRows.every(t => /Adham|Jagpreet/.test(t)) && /JUSS · Rubal usually sends these/i.test(await jsp.innerText('.sheet')),
    'Jess: "Thank everyone" = her 5 LINK appointments first (whatever booker, even no booker), then the 2 JUSS ones she can send too');
  const jessJuss = decodeURIComponent((await jsp.getAttribute('[data-thanks="' + adham.id + '"][data-co=JUSS]', 'href')).split('?text=')[1]);
  ok(/in association with \*JUSS Marketing\*/.test(jessJuss) && /jmomagazine/.test(jessJuss) && /\*Jess Grace\*, on behalf of JUSS Marketing recruitment team 🧡💙$/.test(jessJuss),
    'Jess sending a JUSS thank-you: JUSS wording + magazine, signed "*Jess Grace*, on behalf of JUSS Marketing recruitment team"');
  // Non-qualifiers get an honest version: why we can't take them on, no "by Friday" promise, door left open
  const tmsg = async c => decodeURIComponent((await jsp.getAttribute('[data-thanks="' + c.id + '"][data-co=LINK]', 'href')).split('?text=')[1]);
  const ishMsg = await tmsg(ishita), kidMsg = await tmsg(kid);
  fs.writeFileSync(`${SHOTS}/msg-thanks-nonqual-visa.txt`, ishMsg); fs.writeFileSync(`${SHOTS}/msg-thanks-nonqual-under18.txt`, kidMsg);
  ok(/^Hey Ishita! 👋🧡/.test(ishMsg) && /\*self-employed\*, and your current visa or status doesn't allow self-employed work/.test(ishMsg) && /🔁 \*If your status changes\*, message us here/.test(ishMsg) &&
    !/Friday|next steps/.test(ishMsg) && /\*Jess Grace\*, on behalf of LINK Marketing recruitment team 🧡$/.test(ishMsg), 'Tier 4 thank-you: honest "visa or status doesn\'t allow self-employed work", no Friday promise, signed Jess');
  ok(/\*18 or over\*, so we can't take you on just yet/.test(kidMsg) && /🔁 \*When you turn 18\*, message us here and we'll book you straight back in/.test(kidMsg) && !/Friday/.test(kidMsg), 'under-18 thank-you: "18 or over… When you turn 18, message us"');
  ok(/⛔ Non-qualifier message/.test(await jsp.innerText('.sheet .trow:has-text("Ishita")')) && !/Non-qualifier/.test(await jsp.innerText('.sheet .trow:has-text("Jasraj")')), 'Jess\'s list marks which ones get the non-qualifier message');
  const thanks = decodeURIComponent((await jsp.getAttribute('[data-thanks="' + jasId + '"][data-co=LINK]', 'href')).split('?text=')[1]);
  fs.writeFileSync(`${SHOTS}/msg-thanks.txt`, thanks);
  ok(thanks === "Hey Jasraj! 👋🧡\n\nThanks for coming through for your *Appointment Presentation* today in association with *LINK Marketing* 🙌\nWe loved meeting you in person.\n\n📲 *What happens next*\nOur Team will contact you at the latest by *close of business on Friday 6PM* about your next steps.\nKeep your phone close! 👀\n\n📖 *While you wait*, flick through the *LINK Organisation Magazine 2026* 👇\nhttps://linkmagflip-74ibv4pf.manus.space\n\n*Jess Grace*, on behalf of LINK Marketing recruitment team 🧡",
    'thank-you WhatsApp = Angad\'s wording, laid out to scan (LINK, contact by Friday 6PM) + the LINK magazine, signed Jess Grace for the LINK recruitment team');
  const rowMsgJ = async (id, co) => decodeURIComponent((await jsp.getAttribute('.sheet .trow[data-tr="' + id + '"] a[data-thanks][data-co=' + co + ']', 'href')).split(/\?text=|[?&]body=/)[1] || '');
  ok(/in association with \*LINK Marketing\*/.test(await rowMsgJ(ishita.id, 'LINK')) && /in association with \*JUSS Marketing\*/.test(await rowMsgJ(ishita.id, 'JUSS')) && /\*Jess Grace\*, on behalf of JUSS Marketing/.test(await rowMsgJ(ishita.id, 'JUSS')) &&
    (await jsp.$$eval('.sheet .trow[data-tr="' + ishita.id + '"] .cosm', e => e.map(x => x.textContent))).join() === 'LINK,JUSS',
    'every row: two buttons in the companies\' colours, LINK and JUSS, each opening that company\'s message, signed by Jess (tap, tap, tap)');
  await jsp.locator('.sheet .trow[data-tr="' + ishita.id + '"]').screenshot({ path: SHOTS + '/04c-link-juss-row.png' });
  await jsp.$eval('.sheet .trow[data-tr="' + ishita.id + '"] a[data-thanks][data-co=LINK]', a => { a.addEventListener('click', e => e.preventDefault()); a.click(); });
  await jsp.waitForSelector('.sheet .trow:has-text("Ishita") .pill.green');
  let ishNow2 = null; for (let i = 0; i < 20 && !(ishNow2 && ishNow2.thanks_sent_at); i++) { ishNow2 = await api(admin, 'getCandidate', { id: ishita.id }); if (!ishNow2.thanks_sent_at) await new Promise(r => setTimeout(r, 200)); }
  ok(!!ishNow2.thanks_sent_at && ishNow2.thanks_by === 'Jess Grace' && ishNow2.brand === 'LINK',
    'Jess taps LINK → WhatsApp opens, the row turns "✓ Sent" and it\'s saved as sent by Jess Grace, as LINK');
  await shot(jsp, '04d-thank-everyone');
  await jessCtx.close();
  for (const [c, rag] of [[ishita, 'R'], [adham, 'G'], [ali, 'A'], [jag, 'A'], [kid, 'R']]) {
    await api(nathan, 'saveNotes', { id: c.id, rag, stars: rag === 'G' ? 3 : 2, tags: [], notes: 'test' });
  }

  // ── 3. QR #2 on the last slide → evaluation ──
  console.log('evaluation (QR 2)');
  await cp.goto(APP + 'eval.html');
  await cp.waitForSelector('text=Your evaluation, Jasraj');
  ok(true, 'same phone: evaluation QR opens straight into Jasraj\'s evaluation');
  ok(await coOf(cp) === 'LINK', 'LINK candidate\'s evaluation is in LINK colours');
  const q3 = await cp.$$eval('.chips[data-name=q3_reason] .chip', els => els.map(e => e.textContent));
  ok(['Uncapped earnings', 'Career progression', 'Learn new skills'].every(x => q3.includes(x)), 'evaluation keeps the standard options: earnings, career progression, learn new skills');
  ok((await cp.$$('.sl .slc')).length === 6 && /Mastery/.test(await cp.innerText('.sl')) && !/£10k/.test(await cp.innerText('body')), 'evaluation shows the Sales Skill Ladder (6 levels); Stage 6 has no £10k line');
  ok(/£400\+ OTE in 30 days/.test(await cp.innerText('.sl-wrap')) && /OTE = On Target Earnings/.test(await cp.innerText('.sl-wrap')) && !/ABAE/.test(await cp.innerText('body')), 'ladder says OTE (On Target Earnings), not ABAE');
  // A follow-up is part of its question: no number of its own, only there when it applies
  ok(!(await cp.$('[name=q9_results_detail]')) && !(await cp.$('.chips[data-name=q4_looking_for]')), 'before answering: no follow-up boxes ("What was it?", "How long looking?")');
  await cp.click('.chips[data-name=q9_results_paid] .chip:has-text("No")');
  ok(!(await cp.$('[name=q9_results_detail]')), 'Q9 "earned money on results?" → No: no "What was it?" box');
  await cp.click('.chips[data-name=q9_results_paid] .chip:has-text("Yes")');
  await cp.waitForSelector('.qcard[data-k=q9_results_paid] .qsub [name=q9_results_detail]');
  ok(/What was it\? One line is fine/.test(await cp.innerText('.qcard[data-k=q9_results_paid]')), 'Yes → "What was it? One line is fine" appears inside question 9 (one question, not a separate one)');
  await cp.locator('.qcard[data-k=q9_results_paid]').screenshot({ path: SHOTS + '/05b-q9-one-question.png', animations: 'disabled' });  // after its scroll-in fade
  const presChips = await cp.$$eval('.chips[data-name=q0_presenter] .chip', e => e.map(x => x.textContent));
  ok(await cp.textContent('.qcard[data-k=q0_presenter] .qn') === '01' && /Who ran today's presentation\?/.test(await cp.innerText('.qcard[data-k=q0_presenter]')) &&
    presChips.includes('Nathan') && presChips.slice(-2).join() === 'Someone else,Not sure' && !presChips.some(n => /Angad|Fiza|Mo\b/.test(n)),
    'question 1: "Who ran today\'s presentation?": one tap on a presenter\'s first name (' + presChips.join(', ') + ')');
  await cp.click('.chips[data-name=q0_presenter] .chip:has-text("Someone else")');
  await cp.waitForSelector('.qcard[data-k=q0_presenter] .qsub [name=q0_presenter_other]');
  ok(/Their name/.test(await cp.innerText('.qcard[data-k=q0_presenter]')), '"Someone else" → a "Their name" box inside question 1');
  await cp.locator('.qcard[data-k=q0_presenter]').screenshot({ path: SHOTS + '/05c-who-ran-it.png' });
  const nums = await cp.$$eval('.qcard .qn', e => e.map(x => x.textContent));
  ok(nums.join() === '01,02,03,04,05,06,07,08,09,10,11,12,13,14,15' && await cp.textContent('.qcard[data-k=q10_door] .qn') === '11',
    'questions are numbered 1–15 with no extra numbers for follow-ups ("A door gets shut…" is 11)');
  await fillEval(cp);
  ok(await cp.$('.qcard[data-k=q4_situation] .qsub .chips[data-name=q4_looking_for]') && await cp.$('.qcard[data-k=q12_bdp_stage] .qsub [name=q12_bdp_why]'),
    '"How long looking for work?" sits inside Q4 and "What would your own business mean?" inside Q12');
  ok(/All done/.test(await cp.innerText('#evcount')), 'progress bar fills as they answer → "All done. Hit submit 🚀"');
  await shot(cp, '05-evaluation', true);
  ok(!(await cp.$('[name=q0_presenter_other]')), 'picking Nathan instead → the name box goes');
  await cp.click('#go');
  await cp.waitForSelector('text=Thank you, Jasraj!');
  ok(/by close of business on Friday 6PM/.test(await cp.innerText('body')), 'after the evaluation: "Thank you, Jasraj!" + contact by Friday 6PM');
  const nathanId = (await api(admin, 'listUsers')).users.find(u => /^nathan@/.test(u.email)).id;
  let jEv = null; for (let i = 0; i < 25 && !(jEv && jEv.eval_at); i++) { jEv = await api(admin, 'getCandidate', { id: jasId }); if (!jEv.eval_at) await new Promise(r => setTimeout(r, 200)); }
  ok(jEv.presented_by === 'Nathan Smith' && jEv.presented_by_id === nathanId, 'saved on Jasraj\'s row: presentation run by Nathan Smith (presented_by + presented_by_id columns in the Sheet)');
  const presAns = (await post('/dev/eval', { js: "JSON.stringify([presenterAnswer({ q0_presenter: 'Someone else', q0_presenter_other: 'angad oshan' }), presenterAnswer({ q0_presenter: 'Not sure' }), presenterAnswer({ q0_presenter: 'gone' }), presenterAnswer({})])" })).out;
  ok(presAns === JSON.stringify([{ id: '', name: 'Angad Oshan' }, { id: '', name: 'Not sure' }, { id: '', name: 'Not sure' }, null]),
    '"Someone else" keeps the name they typed; "Not sure" (or a name no longer on the team) saved as "Not sure"; a form without the question changes nothing');
  ok((await cp.$$('.mag')).length === 1 && (await cp.getAttribute('.mag[data-mag=LINK]', 'href')) === 'https://linkmagflip-74ibv4pf.manus.space' && /LINK Organisation Magazine 2026/.test(await cp.innerText('.mag')),
    'thank-you screen: the LINK Organisation Magazine 2026 to flick through (LINK candidate)');
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
  await p2.waitForSelector('.chips[data-name=q0_presenter] .chip:has-text("Nathan")');
  ok(true, 'different phone: the presenters\' names arrive a moment after the form opens');
  ok(await coOf(p2) === 'JUSS', 'JUSS candidate (booked by Abdullahi) gets the JUSS colours, even on a different phone');
  await shot(p2, '07b-eval-juss', true);
  await p2c.close();
  // Same person scans the evaluation QR again after sending it → told it's already done (not a confusing "thank you")
  const p2d = await browser.newContext(PHONE);
  const p2e = await p2d.newPage();
  await p2e.goto(APP + 'eval.html'); await p2e.fill('#m', '07700 900123'); await p2e.click('#go');
  await p2e.waitForSelector('text=Already done, Jasraj');
  ok(/already sent your evaluation today/.test(await p2e.innerText('body')), 'evaluation sent already → "Already done, Jasraj. You\'ve already sent your evaluation today."');
  await p2e.click('#edit');
  await p2e.waitForSelector('text=Change your answers, Jasraj');
  ok((await p2e.$$('.chips[data-name=q3_reason] .chip.on')).length === 1 && await p2e.$eval('.chips[data-name=q0_presenter] .chip.on', b => b.textContent) === 'Nathan',
    'made a mistake → "Change my answers" opens the form with their answers filled in (Nathan still picked)');
  await p2e.fill('textarea[name=q14_questions]', 'Changed my mind: when is Day 1?');
  await post('/dev/eval', { js: 'globalThis.__lockBusy = 2' });  // Google busy: 2 people ahead in the queue
  const tEdit = Date.now();
  await p2e.click('#go');
  await p2e.waitForSelector('text=Updated, Jasraj!', { timeout: 30000 });
  const tShown = Date.now() - tEdit;
  let jasNow = null;
  for (let i = 0; i < 60 && !(jasNow && jasNow.eval_edited_at); i++) { jasNow = await api(admin, 'getCandidate', { id: jasId }); if (!jasNow.eval_edited_at) await new Promise(r => setTimeout(r, 500)); }
  ok(tShown < 1500 && jasNow.q14_questions === 'Changed my mind: when is Day 1?' && !!jasNow.eval_edited_at && !(await p2e.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('lr_sendq') || '{}')).length)),
    'Google busy → "Updated" shows straight away (' + tShown + 'ms); the save waits its turn behind and goes through by itself (' + Math.round((Date.now() - tEdit) / 1000) + 's), answers updated');
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
  const blocked = async c => { try { await ev(c); return ''; } catch (e) { return e.message; } };
  ok(/don't need to fill in the evaluation/.test(await blocked(ishita)) && /don't need to fill in the evaluation/.test(await blocked(kid)), 'non-qualifiers can\'t send an evaluation (server says no)');
  // Young Person tapped "No" to 18+ by mistake: an admin fixes it, then they can do the evaluation
  const fixed = await api(admin, 'fixEligibility', { id: kid.id, over18: 'Yes', rtw: 'British or Irish citizen' });
  ok(!fixed.non_qual && !fixed.flags.some(f => f.text === 'Under 18'), 'admin fixes a wrong "18 or over" answer → no longer a non-qualifier');
  await ev(adham); await ev(ali); await ev(jag); await ev(kid);

  // Speed: once loaded, switching tabs and opening a candidate needs no waiting on Google
  await post('/dev/delay', { ms: 1500 });  // Google-like latency
  let t0 = Date.now(); await pp.click('.tabbar button[data-tab=pay]'); await pp.waitForSelector('.payrow, .empty');
  const tPay = Date.now() - t0;
  t0 = Date.now(); await pp.click('.tabbar button[data-tab=today]'); await pp.waitForSelector('.kpis');
  const tToday = Date.now() - t0;
  ok(tPay < 500 && tToday < 500, 'tabs switch instantly even with 1.5s Google delay (Pay ' + tPay + 'ms, Today ' + tToday + 'ms)');
  // Timed from the tap itself: the robot waits for the cards' entrance animation before it taps, a finger doesn't.
  const tCand = await tapToText(pp, '.item:has-text("Adham Soliman")', 'Not your candidate');
  await pp.waitForSelector('.profile h1:has-text("Adham Soliman")');
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
  ok(!(await pp.$('.swipe')), 'presenter: no swipe-to-call on anyone else\'s card');
  const dark = await browser.newContext(Object.assign({ colorScheme: 'dark' }, PHONE));
  const dp = await dark.newPage();
  await loginUi(dp, 'nathan@example.com', null, 'admin'); await dp.waitForSelector('text=Jasraj Bhuller');
  ok(await dp.$('text=You\'re a BA, so you\'re in through BA login') && !(await dp.$('.tabbar button[data-tab=team]')), 'BA who taps Admin login by mistake lands in the BA app (no admin tabs), told to use BA login');
  await shot(dp, '04c-phone-in-dark-mode');
  ok(await dp.evaluate(() => getComputedStyle(document.body).backgroundColor) === 'rgb(247, 241, 236)', 'stays in the normal light (LINK) look even when the phone is in dark mode');
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
  // A background refresh can redraw the list mid-swipe, so swipe again if it didn't stick.
  for (let i = 0; i < 3 && !(await bp.$('.swipe.open')); i++) {
    await bp.evaluate(() => {
      const sw = document.querySelector('.swipe'); const t = (type, x) => sw.dispatchEvent(new TouchEvent(type, { bubbles: true, touches: type === 'touchend' ? [] : [new Touch({ identifier: 1, target: sw, clientX: x, clientY: 200 })] }));
      t('touchstart', 300); t('touchmove', 250); t('touchmove', 150); t('touchmove', 100); t('touchend', 100);
    });
    await bp.waitForSelector('.swipe.open', { timeout: 3000 }).catch(() => {});
  }
  await bp.waitForSelector('.swipe.open', { timeout: 1000 });
  ok(/^tel:/.test(await bp.getAttribute('.swipe.open .act.call', 'href')) && /wa\.me/.test(await bp.getAttribute('.swipe.open .act.wa', 'href')), 'booker swipes their own candidate → Call / WhatsApp buttons');
  await shot(bp, '04b-swipe');
  await bp.click('.swipe.open .item'); await bp.waitForFunction(() => !document.querySelector('.swipe.open'));  // tap closes the swipe
  ok(/3 more to hit 5/.test(mineTxt) && /0 don't count/.test(mineTxt), 'net attended 2/5 (Young Person counts once their 18+ answer was fixed)');
  await bp.click('.item:has-text("Jasraj Bhuller")');
  await bp.waitForSelector('#saveout');
  const snap = await bp.innerText('body');
  ok(/Southall/.test(snap) && /Commission selling phones/.test(snap), 'one-page snapshot: presenter notes + evaluation together');
  ok(/💡 Plays semi-pro football/.test(snap) && /Wants to earn on results, saving for a house/.test(snap), 'booker sees the room answers: 💡 ice-breaker + why sales');
  ok(/🎤 Presentation by Nathan Smith/.test(snap) && !/rated by/.test(snap), 'their page says who ran the presentation: "🎤 Presentation by Nathan Smith" (he rated the room too)');
  const hdr = (await getJson('/dev/sheet?name=Candidates'))[0];
  ok(hdr.slice(-17).join() === 'recruit_source,databyte_at,databyte_by,onboard_email_at,onboard_email_by,brand,presented_by_id,presented_by,offer_by,offer_via,offer_co,thanks_via,thanks_co,outcome_log,callback_at,callback_by_id,callback_nudged' && new Set(hdr).size === hdr.length,
    'live Sheet with the presenter headers written twice: the empty copies cleared, the new columns added in the right place (no data moved)');
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
  ok(/^https:\/\/wa\.me\//.test(await bp.getAttribute('.quick [data-send=offer]', 'href')), 'the card has a one-tap "🎉 Send Day 1 details on WhatsApp" button');
  await bp.click('.quick[data-for="' + kid.id + '"] [data-out]');
  await bp.waitForSelector('.sheet #sosave');
  await shot(bp, '09b-booker-outcome-sheet');
  await bp.click('.sheet .chips[data-name=outcome] .chip:has-text("No answer")');
  await bp.fill('#sonotes', 'Rang twice, voicemail');
  await bp.click('#sosave');
  await bp.waitForFunction(() => !document.querySelector('.sheet-back') && !JSON.parse(localStorage.getItem('lr_outbox') || '[]').length);
  const kidNow = await api(admin, 'getCandidate', { id: kid.id });
  ok(kidNow.outcome === 'No answer' && kidNow.outcome_notes === 'Rang twice, voicemail' && kidNow.outcome_by === 'Fiza Iqbal', 'booker logs a call outcome straight from the list card (sheet), no need to open the page');
  await bp.waitForSelector('.quick[data-for="' + kid.id + '"] [data-na]');
  const na = decodeURIComponent((await bp.getAttribute('.quick[data-for="' + kid.id + '"] [data-na]', 'href')).split('?text=')[1]);
  fs.writeFileSync(`${SHOTS}/msg-no-answer.txt`, na);
  ok(/📵 No answer · 1/i.test(await bp.innerText('body')) && /^Hey Young! 👋/.test(na) && /in association with \*LINK Marketing\*/.test(na) && /We tried calling you/.test(na) && /\*call or text me back on this number\*/.test(na) && /\*Fiza Iqbal\*, on behalf of LINK Marketing recruitment team 🧡$/.test(na),
    'no answer → "📵 No answer" on the list with a ready WhatsApp: "we tried calling you, call or text back", signed Fiza Iqbal for the LINK recruitment team');
  await bp.click('.item:has-text("Jasraj Bhuller")'); await bp.waitForSelector('a.wa[data-kind=offer]');
  const msg = decodeURIComponent((await bp.getAttribute('a.wa[data-kind=offer]', 'href')).split('?text=')[1]);
  fs.writeFileSync(`${SHOTS}/msg-link.txt`, msg);
  const wurl = (msg.match(/https:\/\/\S+welcome-link\.html\?t=\w+/) || [])[0];
  ok(/^JASRAJ!! 🎉 You're IN\./.test(msg) && /Pre-Coaching Module/.test(msg) && wurl, 'LINK WhatsApp: Gen Z copy + personal welcome link');
  ok(/– Jess, LINK Marketing$/.test(msg), 'LINK message signed by Jess (sent by Fiza)');
  ok(/Week 1 game plan \+ Sales Skill Ladder 📈 \+ tap \*CONFIRM\*/.test(msg), 'WhatsApp tells them the link has their Week 1 plan + the Sales Skill Ladder');
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
  ok(await coOf(wp) === 'LINK' && (await wp.$$('.sl .slc')).length === 6 && (await wp.$$('.bdp .steps li')).length === 6, 'LINK welcome page: LINK colours + Sales Skill Ladder (6 levels) + Business Development Programme');
  const wtxt = await wp.innerText('body');
  ok(/Monday 19 October/.test(wtxt) && /Day 1 is in 7 days/.test(wtxt) && /Pre-Coaching Module/.test(wtxt) && /Practical Learning Day/.test(wtxt), 'welcome page: date, countdown, pre-coaching, Week 1 plan');
  ok(/forms\.office\.com/.test(await wp.getAttribute('a:has-text("Open the Pre-Coaching Module")', 'href')) && (await wp.getAttribute('a:has-text("Google Maps")', 'href')) === 'https://maps.app.goo.gl/f4pkh222EHHTyQSM9', 'LINK welcome page: Pre-Coaching Module button + LINK Google Maps listing');
  const lTags = await wp.$$eval('.wl-week .wk', ds => ds.map(d => [...d.querySelectorAll('.wk-g span')].map(s => s.textContent)));
  ok(!(await wp.$('.wl-poster, img[src*="poster-"], .wl-guide')) && lTags.length === 4 && /Industry & product knowledge/.test(lTags[0]) && /Self-employment fundamentals/.test(lTags[0]) &&
    /Master sales techniques/.test(lTags[1]) && lTags[2].length === 0 && /Earn & grow/.test(lTags[3]),
    'LINK welcome page: the poster\'s Week 1 guide is folded into the game plan as tags under each day; no poster or separate list repeating it (Angad, 20 Oct)');
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
  const d1p = await api(admin, 'academyList', {});
  ok((d1p.pending || []).some(c => c.id === ishita.id) && !d1p.items.some(c => c.id === ishita.id) && !(await api(await loginApi('mo@example.com'), 'academyList', {})).pending &&
    !(await api(admin, 'chaseList', {})).items.some(c => c.id === ishita.id),
    'the decision waits on the Day 1 tab for admins, not on Chase (bookers don\'t get that list)');

  const ad = await browser.newContext(PHONE);
  const ap = await ad.newPage();
  await loginUi(ap, 'angad@linkmarketing.org.uk');
  await ap.goto(APP + 'index.html?c=academy'); await ap.waitForSelector('.card.needs');
  ok(/⚖️ Waiting on your decision · 1/.test(await ap.innerText('.card.needs')) && /Ishita/.test(await ap.innerText('.card.needs')),
    'Day 1 tab: "⚖️ Waiting on your decision · 1: Ishita" (tap the name to approve or decline)');
  await ap.goto(APP + 'index.html?c=' + adham.id);
  await ap.waitForSelector('a.wa[data-kind=offer]');
  ok(!(await ap.$('a.wa[data-kind=thanks]')) && /Thank-you not sent yet · Rubal Oshan sends it/.test(await ap.innerText('body')), 'admin (Angad) can see Adham\'s JUSS thank-you isn\'t sent yet, and that Rubal sends it');
  const rubCtx = await browser.newContext(PHONE);
  const rbp = await rubCtx.newPage();
  await loginUi(rbp, 'rubal@jussmarketing.co.uk', APP + 'index.html?c=' + adham.id);
  await rbp.waitForSelector('.cobig[data-kind=thanks][data-co=JUSS]');
  const jthanks = decodeURIComponent((await rbp.getAttribute('.cobig[data-kind=thanks][data-co=JUSS]', 'href')).split('?text=')[1]);
  const jasT = await api(admin, 'getCandidate', { id: (await api(admin, 'search', { q: 'Jasraj' })).items[0].id });
  await rbp.goto(APP + 'index.html?c=' + jasT.id); await rbp.waitForSelector('.cobig[data-kind=thanks][data-co=LINK]');
  const rubLink = decodeURIComponent((await rbp.getAttribute('.cobig[data-kind=thanks][data-co=LINK]', 'href')).split('?text=')[1]);
  ok(/in association with \*LINK Marketing\*/.test(rubLink) && /linkmagflip/.test(rubLink) && /\*Rubal Oshan\*, on behalf of LINK Marketing recruitment team 🧡$/.test(rubLink),
    'Rubal can send a LINK thank-you too: LINK wording + magazine, signed "*Rubal Oshan*, on behalf of LINK Marketing recruitment team"');
  await rubCtx.close();
  const rubSent = await api(await loginApi('rubal@jussmarketing.co.uk'), 'markSent', { id: jasT.id, kind: 'thanks' });
  ok(rubSent.ok && (await api(admin, 'getCandidate', { id: jasT.id })).thanks_by === 'Rubal Oshan', 'server accepts Rubal sending a LINK thank-you and records "sent by Rubal Oshan"');
  fs.writeFileSync(`${SHOTS}/msg-thanks-juss.txt`, jthanks);
  ok(/in association with \*JUSS Marketing\*/.test(jthanks) && /\*JUSS Marketing Organisation Magazine 2026\* 👇\nhttps:\/\/jmomagazine-gjfukcw6\.manus\.space\/\n/.test(jthanks) && !/linkmagflip/.test(jthanks) && /\*Rubal Oshan\*, on behalf of JUSS Marketing recruitment team 🧡💙$/.test(jthanks),
    'JUSS thank-you WhatsApp: JUSS wording + the JUSS Marketing Organisation Magazine 2026, signed Rubal Oshan for the JUSS recruitment team');
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
  ok(await coOf(jp) === 'JUSS' && (await jp.$$('.sl .slc')).length === 6, 'JUSS welcome page: JUSS colours + Sales Skill Ladder');
  ok(/Thursday onwards/.test(await jp.innerText('body')), 'JUSS welcome page uses the JUSS schedule');
  ok((await jp.getAttribute('a:has-text("Google Maps")', 'href')) === 'https://maps.app.goo.gl/zeP4MjS2hMJzB9V9A' && !(await jp.$('a:has-text("Pre-Coaching Module")')), 'JUSS welcome page: JUSS Google Maps listing, no pre-coaching button');
  ok(!(await jp.$('.wl-poster, img[src*="poster-"], .wl-guide')) && (await jp.$$('.wl-week .wk-g span')).length === 5, 'JUSS welcome page: the Week 1 guide as tags in the game plan, no poster');
  const jog = await (await fetch(jwurl.replace(PUBLIC, APP))).text();
  ok(jog.includes('og:image" content="' + PUBLIC + 'img/og-juss.jpg"'), 'JUSS WhatsApp link preview shows the JUSS poster card');
  // Not on WhatsApp: same message by text or email, and the app remembers it for the next message
  const smsAlt = await ap.getAttribute('.altsend a[data-kind=offer][data-via=sms]', 'href');
  const mailAlt = await ap.getAttribute('.altsend a[data-kind=offer][data-via=email]', 'href');
  const smsBody = decodeURIComponent(smsAlt.split('body=')[1]);
  ok(/^sms:\+447700900300[?&]body=/.test(smsAlt) && /Welcome to the JUSS Marketing BA Academy/.test(smsBody) && !/\*/.test(smsBody) && /welcome-juss\.html/.test(smsBody),
    'Day 1 details: "Not on WhatsApp? 📱 Text" opens their texts with the same message (no WhatsApp *stars*)');
  ok(/^mailto:adham@example\.com\?subject=/.test(mailAlt) && /You're in! BA Academy Day 1 – JUSS Marketing/.test(decodeURIComponent(mailAlt)), '"✉️ Email" opens an email to them with a subject line');
  await ap.$eval('.altsend a[data-kind=offer][data-via=sms]', a => { a.addEventListener('click', e => e.preventDefault()); a.click(); });
  let adNow = null; for (let i = 0; i < 25 && !(adNow && adNow.no_whatsapp); i++) { adNow = await api(admin, 'getCandidate', { id: adham.id }); if (!adNow.no_whatsapp) await new Promise(r => setTimeout(r, 200)); }
  ok(adNow.no_whatsapp === 'TRUE' && !!adNow.offer_sent_at && (await getJson('/dev/sheet?name=Log')).some(r => r[2] === 'sms_offer'), 'texting them saves "not on WhatsApp" + Day 1 sent (logged as sms_offer)');
  await ap.reload(); await ap.waitForSelector('a.sms[data-kind=offer]');
  ok(/^sms:/.test(await ap.getAttribute('a.sms[data-kind=offer]', 'href')) && /📵 Not on WhatsApp/.test(await ap.innerText('body')) && !!(await ap.$('.altsend a[data-via=whatsapp]')),
    'next time: the big button texts them ("📵 Not on WhatsApp" shown), WhatsApp still there as the small option');
  await ap.locator('.wa-grid').screenshot({ path: SHOTS + '/12b-not-on-whatsapp.png' });
  const appHtml = await (await fetch(APP + 'index.html')).text();
  ok(appHtml.includes('og:title" content="Juss & Link Recruitment App"') && appHtml.includes('img/og-app.jpg') && appHtml.includes('apple-mobile-web-app-title" content="Juss & Link Recruitment App"'),
    'sharing the app link shows "Juss & Link Recruitment App" + logo card; same name when added to the home screen');

  await ap.goto(APP + 'index.html?c=' + ishita.id);
  await ap.waitForSelector('#approve');
  ok(!(await ap.$('a.wa[data-kind=offer]')), 'no Academy WhatsApp until admin approves');
  await ap.click('#reject');
  await ap.waitForSelector('text=Rejected by');
  const ishLog = JSON.parse((await api(admin, 'getCandidate', { id: ishita.id })).outcome_log || '[]');
  ok(ishLog.length === 2 && ishLog[0].o === 'Academy booked' && ishLog[0].by === 'Mo Aden' && ishLog[1].o === 'Not suitable' && ishLog[1].by === 'Angad Oshan' && /^Academy booking rejected/.test(ishLog[1].n),
    'call log keeps both: Mo\'s "Academy booked", then Angad\'s rejection ("Not suitable · Academy booking rejected")');

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

  // ── 12:00: Jess / Rubal get "N thank-you messages to send" (theirs only, only if any are left; not the bookers) ──
  const staffIds = (await api(admin, 'listUsers', {})).users;
  const jessId = staffIds.find(u => /^jess@/.test(u.email)).id, rubalId = staffIds.find(u => /^rubal@/.test(u.email)).id;
  await setTime('2026-10-12T11:55:00+01:00');
  const before12 = (await getJson('/dev/pushes')).length;
  await post('/dev/run', { fn: 'keepWarm' });
  ok((await getJson('/dev/pushes')).length === before12, 'no thank-you reminder before 12:00');
  await setTime('2026-10-12T12:05:00+01:00');
  await post('/dev/run', { fn: 'keepWarm' });
  const at12 = (await getJson('/dev/pushes')).slice(before12);
  const rJess = at12.find(p => p.body.include_aliases.external_id.includes(jessId)), rRubal = at12.find(p => p.body.include_aliases.external_id.includes(rubalId));
  ok(at12.length === 2 && rJess && /^💬 \d+ thank-you messages? to send$/.test(rJess.body.headings.en) && !/Ishita/.test(rJess.body.contents.en) && /\?c=thanks$/.test(rJess.body.web_url) &&
    rRubal && /Adham/.test(rRubal.body.contents.en) && !/Jasraj/.test(rRubal.body.contents.en),
    '12:00 → Jess: "' + (rJess ? rJess.body.headings.en + ' | ' + rJess.body.contents.en : 'none') + '", Rubal gets the JUSS ones; nobody else (bookers don\'t)');
  await post('/dev/run', { fn: 'keepWarm' });
  ok((await getJson('/dev/pushes')).length === before12 + 2, 'thank-you reminder goes once a day');
  const j12 = await browser.newContext(PHONE);
  const j12p = await j12.newPage();
  await loginUi(j12p, 'jess@linkmarketing.org.uk', APP + 'index.html?c=thanks');
  await j12p.waitForSelector('.sheet .trow [data-thanks]');
  ok(true, 'tapping the 12:00 alert opens Jess\'s send list straight away');
  await j12.close();

  // ── The recruitment team: Jess, Rubal + Fiza (recruitment@jussmarketing.co.uk) work for both companies.
  //    They tap Send (thank-you or Day 1 details), choose LINK or JUSS, and everything after follows that choice ──
  console.log('recruitment team: which company?');
  await mk('Zara Iqbal', 'recruitment@jussmarketing.co.uk', 'JUSS', ['booker', 'admin']);
  const zaraT = await loginApi('recruitment@jussmarketing.co.uk');
  ok((await api(zaraT, 'me')).recruitTeam.map(x => x.name).sort().join() === 'Jess Grace,Rubal Oshan,Zara Iqbal', 'recruitment team = Jess, Rubal + recruitment@jussmarketing.co.uk (Fiza), from RECRUIT_TEAM');
  const rtc = await browser.newContext(PHONE), rtp = await rtc.newPage();
  await loginUi(rtp, 'recruitment@jussmarketing.co.uk', APP + 'index.html?c=thanks');
  await rtp.waitForSelector('.sheet .trow [data-thanks]');
  const zRows = await rtp.$$eval('.sheet .trow', r => r.map(x => x.dataset.tr));
  ok(zRows.length === (await api(admin, 'listDay', {})).items.length && /Every appointment today, LINK and JUSS/.test(await rtp.innerText('.sheet .hint')) && !(await rtp.$('.sheet .datehead')) && /Tap LINK or JUSS on each one/.test(await rtp.innerText('.sheet .hint')),
    'Fiza\'s thank-you list: every appointment today, LINK and JUSS (she works for both): "Tap LINK or JUSS on each one"');
  const zrow = async co => decodeURIComponent((await rtp.getAttribute('.sheet .trow[data-tr="' + adham.id + '"] a[data-thanks][data-co=' + co + ']', 'href')).split(/\?text=|[?&]body=/)[1] || '').replace(/\*/g, '');
  const zTy = await zrow('LINK');
  ok(/in association with LINK Marketing/.test(zTy) && /linkmagflip/.test(zTy) && /Zara Iqbal, on behalf of LINK Marketing recruitment team 🧡$/.test(zTy) && /in association with JUSS Marketing/.test(await zrow('JUSS')),
    'Adham (JUSS booker): his row\'s LINK button opens the LINK thank-you (wording, magazine, hearts) signed by Fiza; JUSS the JUSS one');
  await rtp.$eval('.sheet .trow[data-tr="' + adham.id + '"] a[data-thanks][data-co=LINK]', a => { a.addEventListener('click', e => e.preventDefault()); a.click(); });
  await rtp.waitForSelector('.sheet .trow[data-tr="' + adham.id + '"] .pill.green');
  let zA = null; for (let i = 0; i < 25 && !(zA && zA.thanks_sent_at && zA.brand === 'LINK'); i++) { zA = await api(admin, 'getCandidate', { id: adham.id }); if (!(zA.thanks_sent_at && zA.brand === 'LINK')) await new Promise(r => setTimeout(r, 200)); }
  ok(zA.thanks_by === 'Zara Iqbal' && zA.brand === 'LINK' && zA.company === 'JUSS' && (await rtp.innerText('.sheet .trow[data-tr="' + adham.id + '"] .co')) === 'LINK',
    'one tap on LINK → row "✓ Sent", tagged LINK; saved as sent by Fiza, as LINK (his booker, pay and lists stay JUSS)');
  ok(/welcome-link\.html/.test(zA.welcome_url) && (await post('/api', { action: 'welcomeInfo', t: zA.welcome_url.match(/[?&]t=(\w+)/)[1] })).data.company === 'LINK',
    'everything after follows it: his welcome page is now the LINK one, even from the JUSS link sent earlier');
  // Everyone else (Angad, the booker): one button as before, following the team's choice
  await ap.goto(APP + 'index.html?c=' + adham.id); await ap.waitForSelector('#wacard a.btn[data-kind=offer]');
  const aDy = decodeURIComponent((await ap.getAttribute('#wacard a.btn[data-kind=offer]', 'href')).split(/\?text=|[?&]body=/)[1] || '');
  ok(!(await ap.$('.cobig')) && /LINK Marketing BA Academy/.test(aDy) && /– Jess, LINK Marketing$/.test(aDy),
    'everyone else (Angad, the booker): one Send button as before, following the team\'s choice (LINK, signed Jess)');
  // Candidate page: 🎉 Day 1 details as two buttons, LINK and JUSS
  const zcb = async co => decodeURIComponent((await rtp.getAttribute('#wacard .cobig[data-kind=offer][data-co=' + co + ']', 'href')).split(/\?text=|[?&]body=/)[1] || '').replace(/\*/g, '');
  await rtp.goto(APP + 'index.html?c=' + adham.id); await rtp.waitForSelector('#wacard .cobig[data-kind=offer][data-co=JUSS]');
  const dLink = await zcb('LINK'), dJuss = await zcb('JUSS');
  fs.writeFileSync(`${SHOTS}/msg-academy-fiza-link.txt`, dLink);
  ok(/LINK Marketing BA Academy/.test(dLink) && /welcome-link\.html/.test(dLink) && /forms\.office\.com/.test(dLink) && dLink.indexOf('f4pkh222') >= 0 && /– Zara, LINK Marketing$/.test(dLink) &&
    /JUSS Marketing BA Academy/.test(dJuss) && /welcome-juss\.html/.test(dJuss) && !/forms\.office\.com/.test(dJuss) && dJuss.indexOf('zeP4MjS2hMJzB9V9A') >= 0 && /– Zara, JUSS Marketing$/.test(dJuss) &&
    (await rtp.$$eval('#wacard .cobig[data-kind=offer] b', e => e.map(x => x.textContent))).join() === 'LINK,JUSS',
    'candidate page: "🎉 Day 1 details" as LINK and JUSS buttons: LINK = LINK wording, welcome page, pre-coaching, Maps pin; JUSS = the JUSS versions; signed by Fiza');
  ok(/^sms:/.test(await rtp.getAttribute('#wacard .cobig[data-kind=offer][data-co=LINK]', 'href')) && /by text/.test(await rtp.innerText('#wacard .cobig[data-kind=offer][data-co=LINK]')),
    'Adham isn\'t on WhatsApp: both buttons text him');
  await rtp.click('#wacard .altsend button[data-chan=whatsapp]'); await rtp.waitForSelector('#wacard .cobig[data-kind=offer][data-via=whatsapp]');
  ok(/^https:\/\/wa\.me\//.test(await rtp.getAttribute('#wacard .cobig[data-kind=offer][data-co=JUSS]', 'href')), '"💬 WhatsApp" under them → the LINK / JUSS buttons switch to WhatsApp');
  await rtp.locator('#wacard').screenshot({ path: SHOTS + '/37-link-juss-buttons.png' });
  await rtp.$eval('#wacard .cobig[data-kind=offer][data-co=JUSS]', a => { a.addEventListener('click', e => e.preventDefault()); a.click(); });
  for (let i = 0; i < 25 && (zA.brand !== 'JUSS' || zA.offer_by !== 'Zara Iqbal'); i++) { zA = await api(admin, 'getCandidate', { id: adham.id }); if (zA.brand !== 'JUSS' || zA.offer_by !== 'Zara Iqbal') await new Promise(r => setTimeout(r, 200)); }
  ok(zA.brand === 'JUSS' && /welcome-juss\.html/.test(zA.welcome_url), 'one tap on JUSS → sent as JUSS, saved, JUSS welcome page again');
  // Who sent the Day 1 details, when, how, as which company
  ok(zA.offer_by === 'Zara Iqbal' && zA.offer_via === 'whatsapp' && zA.offer_co === 'JUSS' && /^2026-10-\d\d \d\d:\d\d/.test(zA.offer_sent_at) && zA.thanks_co === 'LINK' && /^(whatsapp|sms)$/.test(zA.thanks_via),
    'saved: Day 1 details sent by Fiza at ' + zA.offer_sent_at.slice(11, 16) + ', by WhatsApp, as JUSS (and her thank-you: as LINK, by ' + zA.thanks_via + ')');
  await rtp.waitForFunction(() => /Zara Iqbal/.test((document.querySelector('#wacard [data-sent=offer]') || {}).textContent || ''));
  const sentRe = /Zara Iqbal · \w{3} \d+ \w{3} \d\d:\d\d · JUSS · WhatsApp/;
  ok(sentRe.test(await rtp.innerText('#wacard [data-sent=offer]')) && /Day 1 details sent by Zara Iqbal/.test(await rtp.innerText('#d1sent')) && sentRe.test(await rtp.innerText('#d1sent')),
    'straight away on her phone: "✓ Sent by Zara Iqbal · ' + (await rtp.innerText('#wacard [data-sent=offer]')).split(' · ').slice(1).join(' · ') + '" under the buttons, and at the top of their page');
  const zList = await rtp.innerText('#out .sentlist');
  ok(/Messages sent/i.test(zList) && /Thank-you\s+Zara Iqbal · .* · LINK/.test(zList) && /BA Academy Day 1 details\s+Zara Iqbal · .* · JUSS · WhatsApp/.test(zList),
    'Outcome section: "📨 Messages sent": thank-you and Day 1 details, each with who, when, company, how');
  await rtp.locator('#out .sentlist').screenshot({ path: SHOTS + '/38-messages-sent.png' });
  const zBk = await loginApi('fiza@example.com');
  const bkTry = await post('/api', { action: 'setBrand', token: zBk, id: jasId, co: 'JUSS' }), bkThanks = await post('/api', { action: 'markSent', token: zBk, id: jasId, kind: 'thanks' });
  ok(!bkTry.ok && /recruitment team/.test(bkTry.error) && !bkThanks.ok && /Jess Grace, Rubal Oshan or Zara Iqbal/.test(bkThanks.error),
    'bookers can\'t choose the company or send thank-yous (the server checks): "' + bkThanks.error + '"');
  await rtc.close();

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
  ok(rTeam && /Tap to chase them in one go/.test(rTeam.body.contents.en) && /\?c=chase$/.test(rTeam.body.web_url), 'the team roundup opens the Chase tab when tapped');
  ok(rFiza && /\?c=chase$/.test(rFiza.body.web_url), "each booker's roundup opens their own Chase tab");

  // ── Chase tab, week by week: this week's people at risk (+ anything carried over from earlier weeks), one tap nudges every booker ──
  const BL = ['stale', 'log', 'callback'];
  const weOfE = ymd => { const d = new Date(ymd + 'T12:00:00Z'), w = d.getUTCDay(); return new Date(d.getTime() + (w ? 7 - w : 0) * 86400000).toISOString().slice(0, 10); };
  const chaseWk = c => { const cb = String(c.callback_at || '').slice(0, 10); return weOfE(cb > c.attended_date ? cb : c.attended_date); };
  const badgeOf = (all, carry) => carry && all > carry ? (all - carry) + '+' + carry : String(all);
  const pipeR = await api(admin, 'chaseList', {}), pipe = pipeR.items, cw = pipeR.weekEnding;
  const nowP = pipe.filter(c => chaseWk(c) <= cw), thisP = nowP.filter(c => chaseWk(c) === cw), carryP = nowP.filter(c => chaseWk(c) < cw);
  const toChase = [...new Set(nowP.filter(c => c.booker_id).map(c => c.booker_id))];
  const fizaLog = thisP.filter(c => c.booker_id === fiza.id && c.leak === 'log').map(c => c.first_name);
  ok(cw === '2026-10-18' && toChase.includes(fiza.id) && fizaLog.length > 0 && !pipe.some(c => c.id === ishita.id) && pipe.some(c => c.leak === 'callback' && c.outcome === 'No answer') && pipe.every(c => BL.includes(c.leak)),
    'Friday 15:00, week ending 18 Oct: ' + thisP.length + ' this week + ' + carryP.length + ' carried over, across ' + toChase.length + ' bookers: ' + nowP.map(c => c.first_name + ' (' + c.leak + ')').join(', ') + '. "No answer" stays on until it\'s resolved; rejected Ishita isn\'t chased');
  ok(!pipe.some(c => c.outcome === 'Academy booked'), 'Day 1 people (Day 1 text, not confirmed, no-show) are on the Day 1 tab only, not Chase');
  await ap.goto(APP + 'index.html?c=chase');
  await ap.waitForSelector('#nudgeAll');
  ok(await ap.textContent('#abTitle') === 'Chase' && await ap.$('.tabbar button.on[data-tab=chase]') &&
    JSON.stringify(await ap.$$eval('.tabbar button', b => b.map(x => x.dataset.tab))) === '["today","chase","academy","all","pay","team"]',
    'admin tab bar: Today · Chase · Day 1 · All · Appts Attended · Team, and the alert lands on Chase');
  ok(await ap.textContent('.tabbar button[data-tab=chase] .tbadge') === badgeOf(nowP.length, carryP.length) && new RegExp('^' + thisP.length + ' (person|people) to chase this week').test(await ap.innerText('.card .display')) &&
    /This week · ending/i.test(await ap.innerText('.seg-nav')),
    'Chase opens on this week (ending 18 Oct): ' + thisP.length + ' to chase this week, badge "' + badgeOf(nowP.length, carryP.length) + '" (badge and headline agree)');
  await ap.click('#cprev');
  await ap.waitForFunction(() => /^Week ending/i.test(document.querySelector('.seg-nav .lbl span').innerText));
  const prevHead = await ap.innerText('.card .display');
  ok(/still open|All closed out/.test(prevHead) && !(await ap.$('details.carry')), '‹ goes back a week (ending 11 Oct): "' + prevHead + '", that week on its own');
  await ap.click('#cnext');
  await ap.waitForFunction(() => /^This week/i.test(document.querySelector('.seg-nav .lbl span').innerText));
  await ap.waitForSelector('#nudgeAll');
  ok(await ap.$eval('#cnext', b => b.disabled), '› brings it back to this week (and stops there: no call-backs booked for later weeks yet)');
  ok((await ap.$$('[data-nudge]')).length === toChase.length && new RegExp('across ' + toChase.length + ' bookers?').test(await ap.innerText('#page')),
    'one card per booker with someone to chase (' + toChase.length + ')');
  const fizaRow = await ap.$eval('[data-nudge="' + fiza.id + '"]', b => b.closest('.trow').innerText);
  ok(fizaLog.every(n => new RegExp('Log the call: .*' + n).test(fizaRow)), 'each card says exactly who: "' + fizaRow.replace(/\n/g, ' | ') + '"');
  ok(!(await ap.$('.card.needs')), 'no "Needs you" box when the admins have nothing outstanding themselves');
  const grp = decodeURIComponent((await ap.getAttribute('#waGroup', 'href')).replace('https://wa.me/?text=', ''));
  ok(/^⏰ \*Pipeline check: week ending [^*]+\*/.test(grp) && /Outcomes due Fri 18:00/.test(grp) && new RegExp('\\*Fiza\\*\\n📞 Log the call: ' + fizaLog[0]).test(grp) && /Sort them now 👉 http/.test(grp),
    "Post to team WhatsApp: the week's list by booker in one message, ready for the bookers' group");
  await shot(ap, '25-chase-admin', true);
  await ap.click('[data-nudge="' + fiza.id + '"] >> xpath=.. >> .nm'); await ap.waitForSelector('text=Call outcome');
  ok(true, 'tapping a name opens that candidate');
  await ap.goBack(); await ap.waitForSelector('#nudgeAll');
  const beforeChase = (await getJson('/dev/pushes')).length;
  await ap.click('#nudgeAll');
  await ap.waitForSelector('#cres .flag');
  const chased = (await getJson('/dev/pushes')).slice(beforeChase);
  const cFiza = chased.find(p => p.body.include_aliases.external_id.includes(fiza.id));
  ok(chased.length === toChase.length && toChase.every(id => chased.some(p => p.body.include_aliases.external_id.includes(id))) &&
    cFiza && /^⏰ Angad: \d+ (person|people) to chase$/.test(cFiza.body.headings.en) && new RegExp('📞 Log the call: ' + fizaLog[0] + '.*\\((by Fri 18:00|\\d+ LATE)\\)').test(cFiza.body.contents.en) && /\?c=chase$/.test(cFiza.body.web_url),
    'Nudge all → each booker gets their own list: "' + (cFiza ? cFiza.body.headings.en + ' | ' + cFiza.body.contents.en.replace(/\n/g, ' | ') : 'none') + '"');
  ok(/Nudged: .*Fiza/.test(await ap.innerText('#cres')), 'the screen confirms who was nudged');
  await ap.click('#nudgeAll');
  await ap.waitForFunction(() => /Already nudged/.test(document.getElementById('cres').innerText));
  ok((await getJson('/dev/pushes')).length === beforeChase + chased.length, 'tapping again within 30 minutes doesn\'t spam them');
  const fizaTok = await loginApi('fiza@example.com');
  let notAdmin = null; try { await api(fizaTok, 'chaseOutcomes', {}); } catch (e) { notAdmin = e.message; }
  ok(/Admin only/.test(notAdmin), 'bookers can\'t nudge each other (admins only)');
  // The booker taps the nudge → their own Chase tab, grouped by what to do, buttons right there
  const fc = await browser.newContext(PHONE);
  const fcp = await fc.newPage();
  await loginUi(fcp, 'fiza@example.com', APP + 'index.html?c=chase');
  await fcp.waitForSelector('.section-h');
  const fizaPipe = (await api(fizaTok, 'chaseList', {})).items;
  const fNow = fizaPipe.filter(c => chaseWk(c) <= cw), fThis = fNow.filter(c => chaseWk(c) === cw), fCarry = fNow.filter(c => chaseWk(c) < cw);
  ok(fizaPipe.length && fizaPipe.every(c => c.booker_id === fiza.id && BL.includes(c.leak)), 'a booker\'s Chase list is their own people only');
  ok(await fcp.$('.tabbar button.on[data-tab=chase]') && JSON.stringify(await fcp.$$eval('.tabbar button', b => b.map(x => x.dataset.tab))) === '["mine","chase","pay"]' &&
    new RegExp('^' + fThis.length + ' to chase this week').test(await fcp.innerText('.card .display')) && await fcp.textContent('.tabbar button[data-tab=chase] .tbadge') === badgeOf(fNow.length, fCarry.length),
    'Fiza taps it → her Chase tab: "' + fThis.length + ' to chase this week" (tabs: Mine · Chase · Appts Attended)');
  ok(/📞 Log the call · \d+/i.test(await fcp.innerText('#page')) && await fcp.$('.ccard .quick [data-out]'), 'grouped by what to do, with Call / WhatsApp / Log outcome on each');
  await shot(fcp, '26-chase-booker', true);
  await fcp.click('.ccard .quick [data-out]'); await fcp.waitForSelector('.sheet #sosave');
  ok(/Log the call · /i.test(await fcp.innerText('.sheet')), 'Log outcome opens straight from the Chase tab (even for last week\'s appointments)');
  await fcp.click('#socancel');
  await fc.close();
  const reLog = () => getJson('/dev/sheet?name=Log').then(rows => rows.filter(r => r[2] === 'reassign' && r[3] === ali.id).length);
  const reBefore = await reLog();
  const rsame = await api(admin, 'reassignBooker', { id: ali.id, booker_id: fiza.id });
  ok(reBefore > 0 && rsame.booker_id === fiza.id && await reLog() === reBefore, 'saving the same booker again changes nothing (no duplicate Log lines)');
  await setTime('2026-10-16T18:05:00+01:00');
  const before1805 = (await getJson('/dev/pushes')).length;
  await post('/dev/run', { fn: 'keepWarm' });
  ok((await getJson('/dev/pushes')).length === before1805, 'no extra 18:00 message on Friday');

  // ── 7. Sunday close → logged but LATE; pay ──
  await setTime('2026-10-18T15:00:00+01:00');
  const late = await api(fizaTok, 'saveOutcome', { id: ali.id, outcome: 'No answer', outcome_notes: '' });
  ok(late.outcome_late === 'TRUE', 'outcome logged on Sunday accepted but flagged LATE');
  const pay = await api(admin, 'payReport', { weekEnding: '2026-10-18' });
  ok(pay.deadline === '2026-10-16 18:00' && (await api(admin, 'me', {})).deadlineLabel === 'Fri 18:00', 'outcome deadline = Friday 18:00 (matches "by Friday 6PM" in the thank-you WhatsApp)');
  const prow = n => pay.rows.find(r => r.name === n);
  ok(prow('Fiza Iqbal').net === 3 && prow('Fiza Iqbal').late === 1, 'incentive: Fiza net 3, 1 late');
  ok(prow('Mo Aden').net === 0, 'incentive: Mo net 0 (Tier 4 excluded; Seven + Late Arrival not rated by presenter)');
  ok(prow('Abdullahi Ahmed').net === 1, 'incentive: Abdullahi net 1 (Jagpreet repeat + removed)');
  await ap.goto(APP + 'index.html'); await ap.waitForSelector('.tabbar button');
  await ap.click('.tabbar button[data-tab=pay]'); await ap.waitForSelector('.payrow');
  await shot(ap, '14-admin-pay', true);
  // Every PDF button shows the PDF first (a preview, page by page), then "📤 Share / Save" hands it over (a download here)
  const pdfDl = async (page, sel) => {
    await page.click(sel); await page.waitForSelector('.pdfprev #pdfgo');
    const [d] = await Promise.all([page.waitForEvent('download'), page.click('#pdfgo')]);
    await page.waitForFunction(() => !document.querySelector('.pdfprev'));
    return d;
  };
  // Admins: the week's incentive as one grid (like Angad's old sheet): a row per BA, how many attended each day Mon-Fri,
  // the total and the non-qualifiers, "Appointments Attended" along the bottom
  await ap.click('#payPdf'); await ap.waitForSelector('.pdfprev .pdfpages canvas');
  const prevInfo = await ap.evaluate(() => {
    const cvs = [...document.querySelectorAll('.pdfprev .pdfpages canvas')], g = cvs[0].getContext('2d'), px = g.getImageData(0, 0, cvs[0].width, cvs[0].height).data;
    let ink = 0, green = 0;
    for (let i = 0; i < px.length; i += 4) { if (px[i] < 200 || px[i + 1] < 200 || px[i + 2] < 200) ink++; if (Math.abs(px[i] - 120) < 6 && Math.abs(px[i + 1] - 168) < 6 && Math.abs(px[i + 2] - 92) < 6) green++; }
    return { pages: cvs.length, label: document.querySelector('.pdfprev .label').textContent, title: document.querySelector('.pdfprev .display').textContent, ink: ink / (px.length / 4), green: green };
  });
  ok(prevInfo.pages === 1 && /Preview · 1 page/.test(prevInfo.label) && prevInfo.title === 'Appointments Total w-e 18.10.2026' && prevInfo.ink > 0.02 && prevInfo.green > 50,
    '📄 opens a preview first: the PDF on screen ("' + prevInfo.title + '", ' + prevInfo.label + ', drawn with its grid and the green total: ink ' + prevInfo.ink.toFixed(3) + ', green ' + prevInfo.green + 'px), then 📤 Share / Save');
  await shot(ap, '14d-pdf-preview');
  await ap.click('#pdfx'); await ap.waitForFunction(() => !document.querySelector('.pdfprev'));
  const ipd = await pdfDl(ap, '#payPdf');
  const ipPath = `${SHOTS}/14c-incentive.pdf`; await ipd.saveAs(ipPath);
  const ipRaw = fs.readFileSync(ipPath, 'latin1');
  // Attended = rated in the room, or a non-qualifier (often not rated); the non qualifiers = those that don't count (as on the poster)
  const inR = c => c.in_room === true || c.in_room === 'TRUE', cnt = c => inR(c) || !!c.non_qual, wkDays = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'];
  const attW = (await api(admin, 'listWeek', { weekEnding: '2026-10-18' })).items.filter(c => cnt(c) && wkDays.includes(c.attended_date));
  const big = n => new RegExp('BT /F2 12 Tf [\\d.]+ [\\d.]+ Td \\(' + n + '\\) Tj').test(ipRaw);
  const hitN = pay.rows.filter(r => r.net >= pay.target).length, greensP = (ipRaw.match(/0\.47 0\.66 0\.36 rg/g) || []).length;
  ok(ipd.suggestedFilename() === 'Appointments Total w-e 18.10.2026.pdf' && /\/Title \(Appointments Total w-e 18\.10\.2026\)/.test(ipRaw) && /Appointments total · week ending Sunday 18 October 2026/.test(ipRaw) &&
    /📄 Appointments total w\/e /.test(await ap.textContent('#payPdf')) &&
    ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', '12/10/2026', '16/10/2026', 'APPTS', 'QUALIFIERS', 'Appointments Attended'].every(t => ipRaw.includes('(' + t + ') Tj')) &&
    pay.rows.every(r => ipRaw.includes('(' + r.name + ') Tj')) && big(attW.length) && wkDays.every(x => big(attW.filter(c => c.attended_date === x).length)) &&
    new RegExp('0\\.83 0\\.18 0\\.16 rg BT /F2 12 Tf [\\d.]+ [\\d.]+ Td \\(' + attW.filter(c => c.pay_reason).length + '\\) Tj').test(ipRaw) && greensP === hitN + 1 &&
    !/\(\d+\. /.test(ipRaw) && !/\(No: /.test(ipRaw),
    '📄 "Appointments total" PDF ("Appointments Total w-e 18.10.2026.pdf") is one grid like the old sheet: every BA, Mon-Fri with dates, ' + attW.length + ' appointments attended (each day adds up), ' +
    attW.filter(c => c.pay_reason).length + ' non-qualifiers in red, ' + hitN + ' hit the incentive (green); no per-person detail');
  const nqWhy = /\(Non qualifiers: ([^)]*)\) Tj/.exec(ipRaw);
  ok(nqWhy && /\d+ not eligible/.test(nqWhy[1]) && /\d+ repeat/.test(nqWhy[1]), 'under the grid, what the non qualifiers are: "Non qualifiers: ' + (nqWhy ? nqWhy[1] : '?') + '"');
  const daySizes = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'].map(d => Number((new RegExp('BT /F2 ([\\d.]+) Tf [\\d.]+ [\\d.]+ Td \\(' + d + '\\) Tj').exec(ipRaw) || [])[1]));
  ok(daySizes[0] >= 6.5 && daySizes[0] < 8 && daySizes.every(z => z === daySizes[0]), 'the day names all fit their columns at one size (' + daySizes[0] + 'pt): WEDNESDAY no longer runs into THURSDAY');
  try { require('child_process').execFileSync('pdftoppm', ['-png', '-r', '70', '-singlefile', ipPath, `${SHOTS}/14c-incentive`]); } catch (e) { /* no renderer here */ }
  ok(await ap.$eval('.tabbar button[data-tab=pay]', b => b.textContent.trim()) === 'Appts Attended' && await ap.textContent('#abTitle') === 'Appts Attended' &&
    !/\bpay\b/i.test(await ap.$eval('#page', e => e.innerText)), 'the tab and its page say "Appts Attended" (was Incentive), never "Pay"');
  ok(!pay.rows.some(r => /Angad|Jess|Satpal|Rubal/.test(r.name)) && !(await ap.$$eval('.payrow .name', e => e.map(x => x.textContent))).some(n => /Angad|Jess|Satpal|Rubal/.test(n)),
    'incentive board: bookers only, no admins on it');
  const presTxt = await ap.innerText('#page');
  const nathanRow = await ap.innerText('.pres-row:has-text("Nathan Smith")');
  ok(/🎤 Presenters this week/i.test(presTxt) && /\d+ in the room/.test(nathanRow) && /\d+ evaluated/.test(nathanRow) && /\d+ booked/.test(nathanRow) && /\d+ started/.test(nathanRow),
    'admins: "🎤 Presenters this week": each presenter\'s room → evaluated → booked → started (Nathan: ' + nathanRow.replace(/\n/g, ' · ') + ')');
  await ap.locator('.pres-row').first().scrollIntoViewIfNeeded(); await shot(ap, '14b-presenters');

  // ── Bulletins: one tap for admins, same numbers as Pay ──
  await ap.click('.tabbar button[data-tab=today]'); await ap.waitForSelector('#bullDaily');
  for (let i = 0; i < 6; i++) await ap.click('#dprev');
  await ap.click('#bullDaily');
  await ap.waitForSelector('#bimg[data-info]', { timeout: 15000 });
  const bInfo = async () => JSON.parse(await ap.getAttribute('#bimg', 'data-info'));
  const monday = (await api(admin, 'listWeek', { weekEnding: '2026-10-18' })).items.filter(c => c.attended_date === '2026-10-12' && (c.in_room === true || c.in_room === 'TRUE' || c.non_qual));
  let bi = await bInfo();
  ok(bi.kind === 'daily' && bi.attended === monday.length && bi.nonQual === monday.filter(c => c.pay_reason).length && bi.nonQual > 0,
    'daily bulletin: ' + bi.attended + ' attended, ' + bi.nonQual + ' non-qualifiers (rated in the room or a non-qualifier, same rules as the incentive)');
  const expRows = pay.rows.filter(r => r.net > 0).sort((a, b) => b.net - a.net).map(r => r.name.split(' ')[0] + ' ' + r.net);
  ok(JSON.stringify(bi.rows.map(r => r.replace(/^\S+ /, '').replace(/ BAR$/, ''))) === JSON.stringify(expRows) && /^🥇 /.test(bi.rows[0]), 'top performers match the incentive, gold for #1: ' + bi.rows.join(' · '));
  ok(await ap.$eval('#bimg', i => i.complete && i.naturalWidth === 1536 && i.naturalHeight === 2304), 'poster image made on the phone (1536×2304)');
  const saveImg = async f => fs.writeFileSync(`${SHOTS}/${f}`, Buffer.from(await ap.$eval('#bimg', i => fetch(i.src).then(r => r.arrayBuffer()).then(b => Array.from(new Uint8Array(b))))));
  await saveImg('15-bulletin-daily.jpg');
  await shot(ap, '15b-bulletin-screen');
  ok(/Abdullahi 1 BAR$/.test(bi.rows[1]) && !/BAR/.test(bi.rows[0]), '(BAR) added automatically for a "BA referral" check-in (Adham → Abdullahi)');
  await ap.click('#bedit summary'); await ap.click('#bbar .chip');
  await ap.waitForFunction(() => /Fiza 3 BAR/.test(document.getElementById('bimg').dataset.info), null, { timeout: 5000 });
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

  // ── The week's appointments as a PDF (All tab, admins): everyone who checked in, by day, with evaluation + outcome ──
  await ap.click('.tabbar button[data-tab=all]'); await ap.waitForSelector('#weekPdf');
  ok((await ap.textContent('#weekPdf')).trim() === '📄 Appointments w/e Sun 18 Oct (PDF)', 'All tab (admins): "📄 Appointments w/e Sun 18 Oct (PDF)" for the week on screen');
  await ap.click('#flt .chip[data-f=late]'); await ap.waitForSelector('#flt .chip.on[data-f=late]');
  await ap.click('#weekPdf'); await ap.waitForSelector('.pdfprev .pdfpages canvas');
  const wPrev = await ap.evaluate(() => ({ pages: document.querySelectorAll('.pdfprev .pdfpages canvas').length, title: document.querySelector('.pdfprev .display').textContent }));
  ok(wPrev.pages >= 1 && wPrev.title === 'Appointments w-e 18.10.2026', 'the All tab\'s appointments PDF opens the same preview ("' + wPrev.title + '", ' + wPrev.pages + ' page' + (wPrev.pages === 1 ? '' : 's') + ')');
  await ap.click('#pdfx'); await ap.waitForFunction(() => !document.querySelector('.pdfprev'));
  const wdl = await pdfDl(ap, '#weekPdf');
  const wPath = `${SHOTS}/17-week-appointments.pdf`; await wdl.saveAs(wPath);
  await ap.click('#flt .chip[data-f=all]');
  const wRaw = fs.readFileSync(wPath, 'latin1'), wHas = s => wRaw.includes('(' + s.replace(/[\\()]/g, '\\$&') + ') Tj');
  const wk = (await api(admin, 'listWeek', { weekEnding: '2026-10-18' })).items, wkMon = wk.filter(c => c.attended_date === '2026-10-12');
  ok(wdl.suggestedFilename() === 'Appointments w-e 18.10.2026.pdf' && /^%PDF-1\.4/.test(wRaw) && /%%EOF\s*$/.test(wRaw) && /\/Title \(Appointments w-e 18\.10\.2026\)/.test(wRaw),
    '📄 → "Appointments w-e 18.10.2026.pdf" (the PDF\'s own title too)');
  ok(wHas('Appointments · week ending Sunday 18 October 2026') && wHas('Monday 12 October') && wHas(String(wk.length)) && wHas('Checked in') && wHas('Evaluated') && wHas('No outcome yet'),
    'a summary on top (checked in, evaluated, Academy booked, follow-ups, declined, no outcome yet), then the week day by day');
  ok(wk.length > 3 && wk.every(c => wHas(c.full_name) && (!c.mobile || wHas(c.mobile))),
    'everyone who checked in that week (all ' + wk.length + ', whatever filter is on screen), with their mobile');
  ok((wRaw.match(/\(Yes\) Tj/g) || []).length === wk.filter(c => !c.non_qual && c.eval_at).length && (wRaw.match(/\(No\) Tj/g) || []).length === wk.filter(c => !c.non_qual && !c.eval_at).length,
    'Eval: Yes / No for each one (evaluation form filled or not)');
  ok(/\(Academy booked: Mon 19 Oct[^)]*\) Tj/.test(wRaw) && /\(No answer \\\(late\\\)\) Tj/.test(wRaw) && (!wk.some(c => c.non_qual) || /\(Non-qualifier: /.test(wRaw)),
    'outcomes filled in automatically: "Academy booked: Mon 19 Oct", "No answer (late)", non-qualifiers say why');
  ok(wHas(wkMon.length + ' checked in  ·  ' + wkMon.filter(c => c.eval_at).length + ' evaluated  ·  ' + wkMon.filter(c => !c.non_qual && c.admin_status !== 'rejected' && c.outcome === 'Academy booked').length + ' Academy booked  ·  ' +
    wkMon.filter(c => !c.non_qual && c.admin_status !== 'rejected' && !c.outcome).length + ' no outcome yet') && /\(Page 1 of \d\) Tj/.test(wRaw), 'each day has its own totals line; pages numbered');
  try { require('child_process').execFileSync('pdftoppm', ['-png', '-r', '70', '-singlefile', wPath, `${SHOTS}/17-week-appointments`]); } catch (e) { /* no renderer here */ }

  // ── Who's expected on Monday: the evening-before briefing + the Day 1 list ──
  await setTime('2026-10-18T17:55:00+01:00');
  const beforeBrief = (await getJson('/dev/pushes')).length;
  await post('/dev/run', { fn: 'keepWarm' });
  ok((await getJson('/dev/pushes')).length === beforeBrief, 'no Academy briefing before 18:00');
  const monStarters = (await api(admin, 'academyList', {})).items.filter(c => c.academy_date === '2026-10-19');
  ok(monStarters.some(c => c.id === jasId) && monStarters.some(c => c.id === adham.id) && !monStarters.some(c => c.id === ishita.id),
    'Day 1 list for Mon 19 Oct: ' + monStarters.map(c => c.first_name).join(', ') + ' (not Ishita: an admin rejected her booking)');
  await setTime('2026-10-18T18:05:00+01:00');
  await post('/dev/run', { fn: 'keepWarm' });
  const brief = (await getJson('/dev/pushes')).slice(beforeBrief);
  const bFiza = brief.find(p => p.body.include_aliases.external_id.includes(fiza.id)), bAbd = brief.find(p => p.body.include_aliases.external_id.includes(abd.id));
  const bTeam = brief.find(p => p.body.include_aliases.external_id.includes(angadId));
  const nConf = monStarters.filter(c => c.academy_confirmed_at).length;
  ok(bFiza && /^🎓 Tomorrow's BA Academy: 1 starter of yours$/.test(bFiza.body.headings.en) && /Jasraj [✅⏳]/.test(bFiza.body.contents.en) && !/Adham/.test(bFiza.body.contents.en) && /\?c=academy$/.test(bFiza.body.web_url),
    'Sunday 18:00 → Fiza: "' + (bFiza ? bFiza.body.headings.en + ' | ' + bFiza.body.contents.en.replace(/\n/g, ' | ') : 'none') + '"');
  ok(bAbd && /Adham/.test(bAbd.body.contents.en) && !/Jasraj/.test(bAbd.body.contents.en), 'Abdullahi gets his own starter (Adham) only');
  ok(bTeam && bTeam.body.headings.en === '🎓 Tomorrow: ' + monStarters.length + ' starters expected · ' + nConf + ' confirmed',
    'admins: "' + (bTeam ? bTeam.body.headings.en + ' | ' + bTeam.body.contents.en : 'none') + '"');
  ok(!brief.some(p => p.body.include_aliases.external_id.includes(mo.id)), 'nobody with no starters tomorrow gets one (Mo\'s Ishita is still pending)');
  await post('/dev/run', { fn: 'keepWarm' });
  ok((await getJson('/dev/pushes')).length === beforeBrief + brief.length, 'the briefing goes once');
  await ap.goto(APP + 'index.html?c=academy');
  await ap.waitForSelector('.trow[data-cand="' + jasId + '"]');
  const d1Txt = await ap.innerText('#page');
  const adD1 = await ap.innerText('.trow[data-cand="' + adham.id + '"] .d1by');
  ok(/🎉 Day 1 details sent by Zara Iqbal · \w{3} \d+ \w{3} \d\d:\d\d · JUSS · WhatsApp/.test(adD1), 'Day 1 tab: each starter shows who sent their Day 1 details and when: "' + adD1 + '"');
  await ap.click('.trow[data-cand="' + adham.id + '"] .name'); await ap.waitForSelector('#d1sent');
  ok(/Day 1 details sent by Zara Iqbal · .* · JUSS · WhatsApp/.test(await ap.innerText('#d1sent')) && /BA Academy Day 1 details\s+Zara Iqbal/.test(await ap.innerText('#out .sentlist')),
    'tap them on the Day 1 tab → top of their page: "🎉 Day 1 details sent by Zara Iqbal · <time> · JUSS · WhatsApp" (and in Messages sent)');
  await ap.goto(APP + 'index.html?c=academy'); await ap.waitForSelector('.trow[data-cand="' + jasId + '"]');
  // Sends from before this version: filled in once from the Log (who, and how), the latest send winning
  const adB4 = await api(admin, 'getCandidate', { id: adham.id });
  await post('/dev/eval', { js: `(() => { MEMO = {}; const c = getC('${adham.id}'); c.offer_by = ''; c.offer_via = ''; c.offer_co = ''; c.thanks_via = ''; writeRow('Candidates', c); return 1; })()` });
  await ap.goto(APP + 'index.html?c=' + adham.id); await ap.waitForSelector('#d1sent');
  const noBy = await ap.innerText('#d1sent');
  ok(/^🎉 Day 1 details sent \w{3} \d+ \w{3} \d\d:\d\d · JUSS$/.test(noBy) && !/sent by/.test(noBy), 'who sent it not known yet (Google code not updated): "' + noBy + '", never "sent by" with no name');
  await ap.goto(APP + 'index.html?c=academy'); await ap.waitForSelector('.trow[data-cand="' + jasId + '"]');
  const adFill = JSON.parse((await post('/dev/eval', { js: `(() => { MEMO = {};
    PropertiesService.getScriptProperties().setProperty('SENDS_BACKFILLED', ''); backfillSends(); MEMO = {};
    const sends = readTable('Log').filter(l => l.candidate_id === '${adham.id}' && /_offer$/.test(l.action)).map(l => l.user);
    return JSON.stringify([getC('${adham.id}'), PropertiesService.getScriptProperties().getProperty('SENDS_BACKFILLED'), sends]); })()` })).out);
  ok(adB4.offer_by === 'Zara Iqbal' && adFill[2].length >= 2 && adFill[2][0] !== 'Zara Iqbal' && adFill[2][adFill[2].length - 1] === 'Zara Iqbal' &&
    adFill[0].offer_by === 'Zara Iqbal' && adFill[0].offer_via === adB4.offer_via && adFill[0].thanks_via === adB4.thanks_via && !!adFill[1],
    'older sends filled in once from the Log: Adham\'s Day 1 details went ' + adFill[2].length + ' times (' + adFill[2].join(', ') + ') → "' + adFill[0].offer_by + ' · ' + adFill[0].offer_via + '" (the latest), then never again');
  ok(await ap.textContent('#abTitle') === 'Day 1' && await ap.$('.tabbar button.on[data-tab=academy]') && /Monday 19 October · TOMORROW/i.test(d1Txt) && new RegExp(monStarters.length + ' expected · ' + nConf + ' confirmed').test(d1Txt),
    'tapping it opens the Day 1 tab: "Monday 19 October · TOMORROW · ' + monStarters.length + ' expected · ' + nConf + ' confirmed"');
  const d1Nav = await ap.innerText('.d1nav');
  ok(/Next week · ending/i.test(d1Nav) && /25 Oct/.test(d1Nav) && await ap.$('#d1prev') && await ap.$('#d1next'),
    'the Day 1 tab goes week by week like All: on Sunday it opens on the week ahead ("' + d1Nav.replace(/\n/g, ' ') + '", ‹ ›)');
  ok(/📅 Tuesday/.test(await ap.textContent('[data-d1="next_day"][data-id="' + jasId + '"]')) && await ap.$('.trow[data-cand="' + jasId + '"] a.btn[data-rem1]'),
    'before the day too: each Monday starter has "📅 Tuesday" under 💬 Remind (some are booked for Tuesday instead)');
  const jasD1Row = await ap.innerText('.trow[data-cand="' + jasId + '"]');
  ok(/Confirmed/.test(jasD1Row) && !/Day 1 text not sent/.test(jasD1Row), 'someone who has confirmed never shows "Day 1 text not sent" (they had the details, however they were sent)');
  const remind = decodeURIComponent((await ap.$eval('.trow[data-cand="' + jasId + '"] a.btn', a => a.href)).split('?text=')[1]);
  ok(/^Hi Jasraj,\n\nHope you are well\.\n\nJust a quick reminder that you’re due to start your training tomorrow, Monday 19th October at 1:30 PM 🕜/.test(remind) &&
    /https:\/\/maps\.app\.goo\.gl\/f4pkh222EHHTyQSM9/.test(remind) && /Kind Regards\nAngad Oshan\nIn Association with Juss Marketing and Link Marketing$/.test(remind),
    '💬 Remind: Jess / Rubal\'s wording, "…due to start your training tomorrow, Monday 19th October at 1:30 PM", LINK Maps pin, signed by the sender');
  ok(!(await ap.$('[data-d1="arrived"], [data-d1="no_show"]')), 'no Arrived / No-show buttons before Day 1');
  await shot(ap, '27-day1-list', true);
  let early = null; try { await api(admin, 'markDay1', { id: jasId, status: 'arrived' }); } catch (e) { early = e.message; }
  ok(/hasn't happened yet/.test(early), 'can\'t mark someone arrived before their Day 1');
  const fizaD1 = (await api(fizaTok, 'academyList', {})).items;
  ok(fizaD1.length && fizaD1.every(c => c.booker_id === fiza.id), 'a booker\'s Day 1 list shows their own starters only');
  ok(!(await api(nathan, 'academyList', {})).items.length, 'a presenter sees nobody (no access to other people\'s candidates)');

  // ── New starter onboarding (admins only): 1 · Databyte, 2 · the welcome email with FieldIQ ──
  console.log('onboarding');
  const allP = await getJson('/dev/pushes');
  const nsJ = allP.find(p => p.body.headings.en === '🚀 New starter to onboard: Jasraj Bhuller'), nsA = allP.find(p => p.body.headings.en === '🚀 New starter to onboard: Adham Soliman');
  ok(nsJ && nsJ.body.include_aliases.external_id.join() === jessId && nsA && nsA.body.include_aliases.external_id.join() === rubalId &&
    /^Booked by Abdullahi Ahmed for Monday 19th October\. Tap: add to Databyte, then send the welcome email\.$/.test(nsA.body.contents.en) && nsA.body.web_url.endsWith('?c=' + adham.id),
    'booked → straight to Jess (LINK: Jasraj) / Rubal (JUSS: Adham): "🚀 New starter to onboard: Adham Soliman · ' + (nsA ? nsA.body.contents.en : '') + '"');
  ok(!allP.some(p => /New starter to onboard: Ishita/.test(p.body.headings.en)), 'not for a booking waiting on an admin (Ishita was rejected)');
  const denied = async (a, x) => { try { await api(fizaTok, a, x); return ''; } catch (e) { return e.message; } };
  ok(/Admin only/.test(await denied('onboardStep', { id: jasId, databyte: true })) && /Admin only/.test(await denied('onboardPreview', { id: jasId })) && /Admin only/.test(await denied('onboardSend', { id: jasId })),
    'bookers can\'t touch onboarding (Databyte, welcome email): admins only');
  let tooSoon = null; try { await api(admin, 'onboardSend', { id: adham.id }); } catch (e) { tooSoon = e.message; }
  ok(/Add them to Databyte first/.test(tooSoon), 'the welcome email can\'t go before they\'re on Databyte (FieldIQ wouldn\'t work yet)');
  await ap.goto(APP + 'index.html?c=' + adham.id); await ap.waitForSelector('#onb');
  const onbTxt = await ap.innerText('#onb');
  ok(/First name\s*Adham/.test(onbTxt) && /Last name\s*Soliman/.test(onbTxt) && /adham@example\.com/.test(onbTxt) && /07700 900300/.test(onbTxt) && /Recruitment source\s*Personal Recruitment/.test(onbTxt) && (await ap.$$('#onb [data-copy]')).length === 5,
    'candidate page (admin): "🚀 Onboard Adham": first name, last name, email, phone (as 07700 900300), recruitment source, each with Copy');
  ok(/Booked by Abdullahi Ahmed \(a booker\) → Personal Recruitment/.test(onbTxt) && !(await ap.$('#onb .chips')),
    'recruitment source is a rule, not a choice: booked by a booker → "Personal Recruitment"');
  const srcOf = async id => (await post('/dev/eval', { js: `recruitSourceOf({ booker_id: '${id}' })` })).out;
  ok(await srcOf(abd.id) === 'Personal Recruitment' && await srcOf(jessId) === 'Office Recruitment' && await srcOf(rubalId) === 'Office Recruitment' && await srcOf('') === 'Office Recruitment',
    'the rule: any booker → Personal Recruitment; Jess / Rubal (the office) or no booker → Office Recruitment');
  ok(/📤 From Rubal Oshan · rubal@jussmarketing\.co\.uk not set up yet/i.test(onbTxt) && (await ap.getAttribute('#onb a[href*="databyte"]', 'href')) === 'https://uk.databyte.live/onboarding/dashboard/list',
    'step 2 says who it comes from (Angad onboarding a JUSS starter → Rubal\'s address), flagged until Gmail can send as it; Databyte opens its onboarding dashboard');
  ok(await ap.$('#obsend[disabled]'), 'step 2 (welcome email) is locked until they\'re on Databyte');
  await ap.locator('#onb').screenshot({ path: SHOTS + '/33-onboard.png' });
  await ap.click('#dbdone'); await ap.waitForSelector('#obsend:not([disabled])');
  const adOnb = await api(admin, 'getCandidate', { id: adham.id });
  ok(!!adOnb.databyte_at && adOnb.databyte_by === 'Angad Oshan' && adOnb.recruit_source === 'Personal Recruitment', '"✅ Added to Databyte" saved (who, when, Personal Recruitment) and step 2 unlocks');
  await ap.click('#obsend'); await ap.waitForSelector('.obframe'); await ap.waitForSelector('#oberr .err');
  ok(/Can't send as rubal@jussmarketing\.co\.uk yet/.test(await ap.innerText('#oberr')) && await ap.$('#obgo[disabled]') && /From Rubal Oshan <rubal@jussmarketing\.co\.uk>/.test(await ap.innerText('#obfrom')),
    'until the app\'s Gmail can send as Rubal: the preview says so and Send stays off (never falls back to another address)');
  let notReady = null; try { await api(admin, 'onboardSend', { id: adham.id }); } catch (e) { notReady = e.message; }
  ok(/Can't send as rubal@jussmarketing\.co\.uk yet/.test(notReady), 'the server refuses too');
  await post('/dev/eval', { js: "globalThis.__sendAs = ['rubal@jussmarketing.co.uk', 'jess@linkmarketing.org.uk']; CacheService.getScriptCache().remove('send_as'); 1" });
  await ap.click('#obcancel'); await ap.waitForSelector('.sheet-back', { state: 'detached' });
  await ap.click('#obsend'); await ap.waitForSelector('.obframe');
  await ap.waitForFunction(() => document.querySelector('#obgo') && !document.querySelector('#obgo').disabled);
  const prevHtml = await ap.$eval('.obframe', f => f.srcdoc);
  ok(await ap.textContent('#obsubj') === 'JUSS Marketing - Your Brand Ambassador Journey Begins!' && /Hi Adham,/.test(prevHtml) && /Monday 19th October @ 1:30 PM/.test(prevHtml) &&
    /fieldiqdownload/.test(prevHtml) && /Hello Fresh/.test(prevHtml) && /077823 77774/.test(prevHtml) && /You're in, Adham(<\/span>)* 🎉/.test(prevHtml) && /Tuesday 20th October/.test(prevHtml) &&
    /1:30pm – 6:00pm/.test(prevHtml) && /1:00pm – 6:00pm/.test(prevHtml) && /img\/logo-juss\.png/.test(prevHtml) && /See my Week 1 plan \+ CONFIRM/.test(prevHtml) && /<b>Rubal Oshan<\/b>/.test(prevHtml) &&
    /Read your <b>JUSS HF Playbook<\/b>/.test(prevHtml) && /href="https:\/\/juss-hf-playbook\.vercel\.app\/"[^>]*>📘 (<span[^>]*>)*Open my JUSS HF Playbook/.test(prevHtml),
    'preview: Rubal\'s JUSS email in the congratulations-page look ("You\'re in, Adham 🎉", JUSS logo, Day 1 / Day 2 cards, FieldIQ, JUSS HF Playbook, Week 1 plan + CONFIRM, Hello Fresh, JUSS number, signed Rubal: it\'s from her address)');
  ok(/reply <b>GOT IT<\/b> to this email so we know it reached you/.test(prevHtml), 'the email asks them to reply GOT IT (the strongest "not spam" signal, and Rubal knows it arrived)');
  // The whole email as the candidate sees it (images from this dev server instead of the live site)
  fs.writeFileSync(`${SHOTS}/welcome-email-juss.html`, prevHtml);
  const ep = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await ep.setContent(prevHtml.split(PUBLIC).join(APP), { waitUntil: 'load' });
  ok(await ep.evaluate(() => [...document.images].every(i => i.complete && i.naturalWidth > 0) && document.documentElement.scrollWidth <= innerWidth),
    'the email renders on a phone: the logo loads, nothing wider than the screen');
  // Week 1 day by day, like the Sales Skill Ladder (Angad, 20 Oct): a card a day with its level meter, number, date, time and what
  // happens; the first day on badge is the dark card; no poster picture any more
  const dayCards = await ep.evaluate(() => [...document.querySelectorAll('td')].filter(td => /^0[1-4]$/.test((td.querySelector('span') || {}).textContent || '') && td.style.width === '58px').length);
  ok(/Day 1 · Monday 19th October/.test(prevHtml) && /Day 2 · Tuesday 20th October/.test(prevHtml) && /Day 3 · Wednesday 21st October/.test(prevHtml) && /Day 4 onwards · Thursday 22nd October/.test(prevHtml) &&
    ['Induction Day', 'Sales Coaching', 'Practical Learning Day', 'Sales Days', '1st day on badge!', '10:30am – 8:30pm'].every(t => prevHtml.includes(t)) && dayCards === 4 &&
    !/poster-juss\.jpg/.test(prevHtml) && /Google Maps/.test(prevHtml) && /Add to calendar/.test(prevHtml),
    'Week 1 in the email, day by day like the Sales Skill Ladder: 4 dated cards (Induction → Sales Coaching → Practical Learning → 1st day on badge), Day 1 with the address, Maps and calendar; no poster picture');
  await ep.screenshot({ path: SHOTS + '/35-welcome-email-full.png', fullPage: true });
  // Google garbled emojis like 🎉 📅 🔥 into "������" (20 Oct): the HTML goes to Google as plain ASCII (&#…;), looking the same
  const { asciiHtml, emailSafe } = require('../../server/email.js');
  const safeHtml = asciiHtml(prevHtml), textBefore = await ep.evaluate(() => document.body.innerText);
  await ep.setContent(safeHtml.split(PUBLIC).join(APP), { waitUntil: 'load' });
  const textAfter = await ep.evaluate(() => document.body.innerText);
  const gm = emailSafe({ via: 'gmail', to: 'x@example.com', subject: 'Hi 🎉', body: 'b 🎉', opts: { htmlBody: '<b>🎉 Day 1 ✅</b>', name: 'n' } });
  const mm = emailSafe({ via: 'mail', msg: { to: 'x@example.com', subject: 's', htmlBody: '<p>📅 Mon</p>' } });
  ok(/^[\x00-\x7E]*$/.test(safeHtml) && /&#127881;/.test(safeHtml) && textAfter === textBefore && /🎉/.test(textAfter) &&
    gm.opts.htmlBody === '<b>&#127881; Day 1 &#9989;</b>' && gm.subject === 'Hi 🎉' && gm.body === 'b 🎉' && mm.msg.htmlBody === '<p>&#128197; Mon</p>',
    'emails go to Google with emojis written as &#…; (plain ASCII), so 🎉 📅 🔥 can\'t arrive as "������"; on screen it reads exactly the same');
  // Gmail's dark theme turned the white header text and button labels dark: kept white (Gmail-only CSS), the logo box keeps its shape
  const keptWhite = (prevHtml.match(/<span class="jls"[^>]*><span class="jld"/g) || []).length;
  ok(/<body class="body"/.test(prevHtml) && /u \+ \.body \.jls\{background:#000;mix-blend-mode:screen\}/.test(prevHtml) && /<span class="jld"[^>]*>You're in, Adham<\/span><\/span> 🎉/.test(prevHtml) &&
    />📲 <span class="jls"/.test(prevHtml) &&
    keptWhite >= 6 && /<img src="[^"]*logo-juss\.png"[^>]*width="90" height="56"/.test(prevHtml) && /background-image:linear-gradient\(#ffffff,#ffffff\)/.test(prevHtml) &&
    await ep.evaluate(() => getComputedStyle(document.querySelector('.jls')).mixBlendMode === 'normal'),
    'Gmail dark theme: header text and button labels stay white (' + keptWhite + ' places, Gmail-only CSS, nothing changes elsewhere); the logo box keeps its size even before the image loads');
  // …and the light page and cards stay light, their dark text dark (Angad, 20 Oct: "still coming through as a dark background")
  const keptDark = (prevHtml.match(/<span class="jks"[^>]*><span class="jkd"/g) || []).length;
  const plainBg = (prevHtml.match(/background:#(?:ffffff|EDF5F5|DDF2F3);(?!background-image)/g) || []).length;
  ok(/u \+ \.body \.jks\{background:#fff;mix-blend-mode:difference\}u \+ \.body \.jkd\{background:#fff;mix-blend-mode:difference\}/.test(prevHtml) && keptDark >= 25 && plainBg === 0 &&
    /background:#EDF5F5;background-image:linear-gradient\(#EDF5F5,#EDF5F5\)/.test(prevHtml) && /✅<\/td><td[^>]*><span class="jks"/.test(prevHtml) && /<span class="jkd"[^>]*>Hi Adham, you’re coming on board/.test(prevHtml) &&
    !/border:\d+px solid/.test(prevHtml) && /📅<\/td><td[^>]*><span class="jls"/.test(prevHtml) && /🏢<\/td><td[^>]*><span class="jks"/.test(prevHtml) && /💰<\/td><td[^>]*><span class="jls"/.test(prevHtml) &&
    !/rgba\(255,255,255,\.16\)/.test(prevHtml),
    'Gmail dark theme: every light background is set so Gmail leaves it light, the dark text is kept dark with nothing behind it (' + keptDark + ' places: no grey boxes), ' +
    'outlines are frames not borders (no black outlines), the Day 4 pills are solid (not pale lilac), and 📅 / 🏢 sit beside their text, not above it');
  // In Gmail (light theme: no recolouring), the dark-text trick is invisible: the page behind shows through and the text keeps its colour
  await ep.setContent(prevHtml.replace(/<body class="body" style="([^"]*)">/, '<body style="margin:0"><u></u><div class="body" style="$1">').split(PUBLIC).join(APP), { waitUntil: 'load' });
  const gmailLight = await ep.evaluate(() => getComputedStyle(document.querySelector('.jks')).mixBlendMode);
  // [0] the intro on the page's colour, [1] "Quick one" on white: with the trick vs without it, pixel by pixel
  const blended = [await ep.locator('.jks').nth(0).screenshot(), await ep.locator('.jks').nth(1).screenshot()];
  await ep.addStyleTag({ content: '.jks,.jkd{mix-blend-mode:normal!important;background:transparent!important}' });
  const plain = [await ep.locator('.jks').nth(0).screenshot(), await ep.locator('.jks').nth(1).screenshot()];
  const pxDiff = (a, b) => ep.evaluate(async ([a, b]) => {
    const load = async s => { const im = new Image(); im.src = 'data:image/png;base64,' + s; await im.decode(); const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
      const x = c.getContext('2d'); x.drawImage(im, 0, 0); return x.getImageData(0, 0, im.width, im.height).data; };
    const p = await load(a), q = await load(b); let m = 0; for (let i = 0; i < p.length; i++) m = Math.max(m, Math.abs(p[i] - q[i])); return p.length === q.length ? m : 999;
  }, [a.toString('base64'), b.toString('base64')]);
  const dOnPage = await pxDiff(blended[0], plain[0]), dOnWhite = await pxDiff(blended[1], plain[1]);
  ok(gmailLight === 'difference' && dOnWhite <= 3 && dOnPage <= 24, 'in Gmail\'s light theme the dark-text trick shows no box: on white no pixel changes (' + dOnWhite + '), on the page colour the text is a shade darker at most (' + dOnPage + ')');
  await ep.close();
  await ap.locator('.sheet').screenshot({ path: SHOTS + '/34-welcome-email.png' });
  const mbOnb = (await getJson('/dev/mail')).length;
  await ap.click('#obgo'); await ap.waitForSelector('#onb .pill.green:has-text("Onboarded")');
  const wm = (await getJson('/dev/mail')).slice(mbOnb).find(m => m.to === 'adham@example.com');
  ok(wm && wm.via === 'gmail' && wm.subject === 'JUSS Marketing - Your Brand Ambassador Journey Begins!' && wm.from === 'rubal@jussmarketing.co.uk' && wm.name === 'Rubal Oshan | JUSS Marketing' &&
    wm.bcc === 'rubal@jussmarketing.co.uk' && !wm.replyTo && /FieldIQ/.test(wm.body) && /juss-hf-playbook\.vercel\.app/.test(wm.body) && /reply GOT IT/.test(wm.body) &&
    /YOUR WEEK 1\nDay 1 · Monday 19th October: Induction Day, 1:30pm – 6:00pm/.test(wm.body),
    'sent from rubal@jussmarketing.co.uk as "Rubal Oshan | JUSS Marketing" (replies go to Rubal, who gets a copy), even though Angad pressed Send');
  ok((await api(admin, 'getCandidate', { id: adham.id })).onboard_email_by === 'Angad Oshan', 'saved: welcome email sent (who, when)');
  const huHref = await ap.getAttribute('#obwa', 'href'), hu = decodeURIComponent(huHref.split(/\?text=|[?&]body=/)[1] || '');
  ok(/^sms:\+447700900300/.test(huHref) && /^Hi Adham 👋 It's Angad from JUSS Marketing\./.test(hu) && /emailed your starter pack to adham@example\.com/.test(hu) && /JUSS HF Playbook/.test(hu) &&
    /It's from rubal@jussmarketing\.co\.uk\. Can't see it\? Check Spam or Promotions and tap Not spam/.test(hu) && /reply GOT IT/.test(hu) &&
    /FieldIQ \(download before Day 1\): https:\/\/www\.tfo\.group\/fieldiqdownload/.test(hu),
    'once sent: a one-tap heads-up (by text: Adham isn\'t on WhatsApp) "just emailed your starter pack… from rubal@… check Spam / Promotions, tap Not spam… reply GOT IT"');
  ok(!/not set up yet/i.test(await ap.innerText('#onb')), 'after a send the card no longer says "not set up yet"');
  await ap.locator('#onb').screenshot({ path: SHOTS + '/36-onboarded.png' });
  const lp = await api(admin, 'onboardPreview', { id: jasId });
  ok(lp.from === 'Jess Grace <jess@linkmarketing.org.uk>' && !lp.notReady && /<b>Jess Grace<\/b>/.test(lp.html) && /Read your <b>Link FR Playbook<\/b>/.test(lp.html) &&
    /href="https:\/\/link-fr-playbook\.vercel\.app\/"[^>]*>📘 (<span[^>]*>)*Open my Link FR Playbook/.test(lp.html) && /3\. Read your Link FR Playbook: https:\/\/link-fr-playbook\.vercel\.app\//.test(lp.text),
    'LINK starter → from Jess (jess@linkmarketing.org.uk), signed Jess, with the Link FR Playbook as step 3 (after FieldIQ and the Pre-Coaching Module)');
  const jessT = await loginApi('jess@linkmarketing.org.uk');  // one sign-in for all of these (codes per person are limited)
  const jessPrev = await api(jessT, 'onboardPreview', { id: adham.id });
  ok(jessPrev.from === 'Jess Grace <jess@linkmarketing.org.uk>' && /<b>Jess Grace<\/b>/.test(jessPrev.html) && /^JUSS Marketing - /.test(jessPrev.subject),
    'Jess or Rubal can send either brand: Jess sending a JUSS starter\'s email → from her address, signed by her');
  // Signed under the other company: "In association with …" (Angad, 20 Oct); under her own, just the company
  const signOf = h => (/<b>[^<]+<\/b>(?:<\/span>)*<\/div><div[^>]*>(?:<span[^>]*>)*([^<]+)</.exec(h) || [])[1];
  ok(signOf(jessPrev.html) === 'In association with JUSS Marketing' && /Jess Grace\nIn association with JUSS Marketing$/.test(jessPrev.text) &&
    signOf(lp.html) === 'Link Marketing' && signOf(prevHtml) === 'JUSS Marketing',
    'Jess signing a JUSS email: "Jess Grace · In association with JUSS Marketing"; her own LINK email and Rubal\'s JUSS one: just the company');
  ok(lp.subject === 'Link Marketing - Your Brand Ambassador Journey Begins!' && /NDCS/.test(lp.html) && /Pre-Coaching Module/.test(lp.html) && /073110 27272/.test(lp.html) && /Day 3 · Wednesday 21st October/.test(lp.html) && /Practical Learning Day/.test(lp.html) && /Sales Day</.test(lp.html) && /img\/logo-link\.png/.test(lp.html) && /Link Magazine/.test(lp.html),
    'LINK version: NDCS, the pre-coaching module, Day 3 timings, Link Magazine, LINK numbers');
  // Jess and Rubal, each sending as LINK and as JUSS (Angad, 20 Oct): the email carries that company's look throughout, from
  // the sender's own address, and the starter's own details (name, Day 1, their welcome link, in the same company)
  const rubT = await loginApi('rubal@jussmarketing.co.uk');
  const adTok = (/[?&]t=([^&]+)/.exec((await api(admin, 'getCandidate', { id: adham.id })).welcome_url) || [])[1];
  const LOOK = { LINK: ['logo-link.png', '#F15A24', 'Link Marketing', 'link-fr-playbook', 'maps.app.goo.gl/2wmckhXokt3KhCyE9'], JUSS: ['logo-juss.png', '#2BA9B8', 'JUSS Marketing', 'juss-hf-playbook', 'maps.app.goo.gl/n2wTFyzScHLr1Voy9'] };
  const combos = [[jessT, 'Jess Grace', 'jess@linkmarketing.org.uk', 'LINK', 'Link Marketing'], [jessT, 'Jess Grace', 'jess@linkmarketing.org.uk', 'JUSS', 'In association with JUSS Marketing'],
    [rubT, 'Rubal Oshan', 'rubal@jussmarketing.co.uk', 'JUSS', 'JUSS Marketing'], [rubT, 'Rubal Oshan', 'rubal@jussmarketing.co.uk', 'LINK', 'In association with Link Marketing']];
  const comboOut = [];
  for (const [tok, nm, em, co, sign] of combos) {
    const p = await api(tok, 'onboardPreview', { id: adham.id, co }), L = LOOK[co], other = LOOK[co === 'LINK' ? 'JUSS' : 'LINK'];
    const good = p.co === co && p.subject === L[2] + ' - Your Brand Ambassador Journey Begins!' && p.from === nm + ' <' + em + '>' && signOf(p.html) === sign &&
      p.html.includes('img/logo-' + co.toLowerCase() + '.png') && !p.html.includes(other[0]) && p.html.includes(L[1]) && !p.html.includes(other[1]) && p.html.includes(L[3]) && p.html.includes(L[4]) &&
      /You're in, Adham/.test(p.html) && /Day 1 · Monday 19th October/.test(p.html) && !!adTok && p.html.includes('welcome-' + co.toLowerCase() + '.html?t=' + adTok);
    comboOut.push(nm.split(' ')[0] + ' as ' + co + (good ? ' ✓' : ' ✗'));
  }
  ok(comboOut.every(x => /✓$/.test(x)), 'each sender × company carries that company\'s look (logo, colours, Playbook, Maps, signature) and Adham\'s own details and welcome link: ' + comboOut.join(' · '));
  // A Tuesday starter: every date follows their own Day 1
  const tueM = JSON.parse((await post('/dev/eval', { js: "JSON.stringify(onboardEmail({ full_name: 'Tia Tuesday', email: 'tia@example.com', academy_date: '2026-10-27', welcome_token: 'tok123', company: 'LINK' }, { name: 'Jess Grace', email: 'jess@linkmarketing.org.uk' }, 'LINK'))" })).out);
  ok(/You're in, Tia/.test(tueM.html) && /Day 1 · Tuesday 27th October/.test(tueM.html) && /Day 4 · Friday 30th October/.test(tueM.html) && /done before Tuesday/.test(tueM.html) && /Tuesday 27th October · 1:30 PM/.test(tueM.html) &&
    /welcome-link\.html\?t=tok123&n=Tia&d=2026-10-27/.test(tueM.html.replace(/&amp;/g, '&')) && tueM.to === 'tia@example.com',
    'a Tuesday starter\'s email: Day 1 Tuesday 27th → Day 4 Friday 30th, "done before Tuesday", their own welcome link with their name and date');
  await ap.goto(APP + 'index.html?c=academy'); await ap.waitForSelector('.onbq');
  const onbq = await ap.innerText('.onbq');
  ok(/To onboard · 1/.test(onbq) && /Jasraj/.test(onbq) && !/Adham/.test(onbq) && /Onboarded/.test(await ap.innerText('.trow[data-cand="' + adham.id + '"]')),
    'Day 1 tab (admins): "🚀 To onboard · 1" (Jasraj); Adham shows 🚀 Onboarded');
  // Fiza's welcome emails: from her own address, as whichever company she has chosen
  const zT2 = await loginApi('recruitment@jussmarketing.co.uk');
  const zPj = await api(zT2, 'onboardPreview', { id: jasId, co: 'JUSS' });
  ok(zPj.from === 'Zara Iqbal <recruitment@jussmarketing.co.uk>' && /^JUSS Marketing - /.test(zPj.subject) && /<b>Zara Iqbal<\/b>/.test(zPj.html) && /JUSS HF Playbook/.test(zPj.html) &&
    /Can't send as recruitment@jussmarketing\.co\.uk yet/.test(zPj.notReady) && zPj.co === 'JUSS',
    'Fiza previewing Jasraj (LINK booker) as JUSS → JUSS email from recruitment@jussmarketing.co.uk, signed Fiza; flagged until Gmail can send as her address');
  ok((await api(admin, 'getCandidate', { id: jasId })).brand !== 'JUSS', 'a preview never changes anything');
  const aPj = await api(admin, 'onboardPreview', { id: jasId, co: 'JUSS' });
  ok(/^Link Marketing - /.test(aPj.subject) && aPj.from === 'Jess Grace <jess@linkmarketing.org.uk>', 'only the recruitment team choose the company (Angad still gets the LINK email from Jess)');
  await post('/dev/eval', { js: "globalThis.__sendAs = ['rubal@jussmarketing.co.uk', 'jess@linkmarketing.org.uk', 'recruitment@jussmarketing.co.uk']; CacheService.getScriptCache().remove('send_as'); 1" });
  ok((await api(zT2, 'me')).welcomeFrom.mine.email === 'recruitment@jussmarketing.co.uk' && (await api(zT2, 'me')).welcomeFrom.mine.ready, 'her card shows "From Zara Iqbal · recruitment@jussmarketing.co.uk", ready once Gmail can send as it');
  await api(zT2, 'onboardStep', { id: jasId, databyte: true });
  const mbZ = (await getJson('/dev/mail')).length;
  await api(zT2, 'onboardSend', { id: jasId, co: 'LINK' });
  const zm = (await getJson('/dev/mail')).slice(mbZ).find(m => m.to === 'jasraj@example.com');
  ok(zm && zm.from === 'recruitment@jussmarketing.co.uk' && zm.name === 'Zara Iqbal | Link Marketing' && zm.bcc === 'recruitment@jussmarketing.co.uk' && zm.subject === 'Link Marketing - Your Brand Ambassador Journey Begins!' && /Link FR Playbook/.test(zm.body),
    'Fiza sends it as LINK → from recruitment@jussmarketing.co.uk as "Zara Iqbal | Link Marketing", she gets a copy');
  ok(/Zara Iqbal\nIn association with Link Marketing$/.test(zm.body),
    'a JUSS address sending a LINK email signs "In association with Link Marketing" (as Rubal would)');

  // ── Monday 10:00: Jess / Rubal get "N starters to remind" → Day 1 tab → Send reminders (one tap each) → print the sign-in sheet ──
  await setTime('2026-10-19T09:55:00+01:00');
  const beforeRem = (await getJson('/dev/pushes')).length;
  await post('/dev/run', { fn: 'keepWarm' });
  ok(!(await getJson('/dev/pushes')).slice(beforeRem).some(p => /to remind$/.test(p.body.headings.en)), 'no Day 1 reminder alert before 10:00');
  await setTime('2026-10-19T10:05:00+01:00');
  await post('/dev/run', { fn: 'keepWarm' });
  const remP = (await getJson('/dev/pushes')).slice(beforeRem).filter(p => /to remind$/.test(p.body.headings.en));
  const rmJ = remP.find(p => p.body.include_aliases.external_id.includes(jessId)), rmR = remP.find(p => p.body.include_aliases.external_id.includes(rubalId));
  ok(remP.length === 2 && rmJ && rmJ.body.headings.en === '🎓 Day 1 today: 1 starter to remind' && /Jasraj ✅/.test(rmJ.body.contents.en) && /\?c=remind$/.test(rmJ.body.web_url) &&
    rmR && /Adham ⏳/.test(rmR.body.contents.en) && /Not confirmed yet: Adham/.test(rmR.body.contents.en),
    '10:00 on Day 1 → Jess: "' + (rmJ ? rmJ.body.headings.en + ' | ' + rmJ.body.contents.en.replace(/\n/g, ' | ') : 'none') + '"; Rubal gets the JUSS starter (Adham)');
  const afterRem = (await getJson('/dev/pushes')).length;
  await post('/dev/run', { fn: 'keepWarm' });
  ok((await getJson('/dev/pushes')).length === afterRem, 'the 10:00 reminder alert goes once');
  const jr = await browser.newContext(PHONE); const jrp = await jr.newPage();
  await loginUi(jrp, 'jess@linkmarketing.org.uk', APP + 'index.html?c=remind');
  await jrp.waitForSelector('.sheet [data-r1]');
  ok(await jrp.$('.tabbar button.on[data-tab=academy]') && JSON.stringify(await jrp.$$eval('.tabbar button', b => b.map(x => x.dataset.tab))) === '["today","chase","academy","all","pay","team"]',
    'Jess taps it → the Day 1 tab with the send list already open');
  const remSheet = await jrp.innerText('.sheet');
  ok(/0 of 2 sent/.test(remSheet) && remSheet.indexOf('Jasraj') < remSheet.indexOf('Adham') && /TODAY · Monday 19 October/i.test(remSheet), 'send list: "0 of 2 sent", her LINK starters first');
  const remMsg = decodeURIComponent((await jrp.getAttribute('.sheet a.btn[data-r1="' + jasId + '"]', 'href')).split('?text=')[1]);
  ok(remMsg === 'Hi Jasraj,\n\nHope you are well.\n\nJust a quick reminder that you’re due to start your training today, Monday 19th October at 1:30 PM 🕜, with Juss Marketing & Link Marketing\n\n' +
    '📍 Address:\n2nd Floor East, Automotive House,\nGrays Place, Slough, SL2 5AF.\nhttps://maps.app.goo.gl/f4pkh222EHHTyQSM9\n\n' +
    'Please aim to arrive 10 minutes early ⏰ and let us know if you have any questions 😊\n\nKindly reply ‘Yes’ to confirm your attendance ✅\nWe look forward to seeing you! 👋\n\n' +
    'Thanks\nKind Regards\nJess Grace\nIn Association with Juss Marketing and Link Marketing',
    'the reminder in Jess / Rubal\'s words: "' + remMsg.replace(/\n+/g, ' | ') + '"');
  const adhamSend = await jrp.getAttribute('.sheet a.btn[data-r1="' + adham.id + '"]', 'href');
  ok(/^sms:/.test(adhamSend) && /maps\.app\.goo\.gl\/zeP4MjS2hMJzB9V9A/.test(decodeURIComponent(adhamSend)) && /Kindly reply ‘Yes’/.test(decodeURIComponent(adhamSend)) &&
    (await jrp.textContent('.sheet a.btn[data-r1="' + adham.id + '"]')).trim() === '📱 Text', 'Adham isn\'t on WhatsApp → 📱 Text, with the JUSS Maps pin');
  await shot(jrp, '29-day1-reminders');
  for (const id of [jasId, adham.id]) await jrp.$eval('.sheet a.btn[data-r1="' + id + '"]', a => { a.addEventListener('click', e => e.preventDefault()); a.click(); });
  await jrp.waitForFunction(() => /2 of 2 sent/.test(document.getElementById('d1prog').textContent));
  let jR = null; for (let i = 0; i < 25 && !(jR && jR.day1_reminded_at); i++) { jR = await api(admin, 'getCandidate', { id: jasId }); if (!jR.day1_reminded_at) await new Promise(r => setTimeout(r, 200)); }
  ok(jR.day1_reminded_by === 'Jess Grace' && /^2026-10-19 /.test(jR.day1_reminded_at), 'each tap ticks them off ("2 of 2 sent") and saves who sent it and when');
  await jrp.click('#d1done');
  await jrp.waitForSelector('[data-remall="2026-10-19"]');
  ok(/Send reminders · 2\/2/.test(await jrp.textContent('[data-remall="2026-10-19"]')) && /Reminded/.test(await jrp.innerText('#page')), 'the Day 1 tab shows 2/2 reminded');
  ok(!(await jrp.$('[data-yes="' + jasId + '"]')) && await jrp.$('[data-yes="' + adham.id + '"]'), '"👍 They replied Yes" on anyone not confirmed yet (Adham), not on Jasraj (already confirmed)');
  await jrp.click('[data-yes="' + adham.id + '"]');
  await jrp.waitForFunction(() => /2 expected · 2 confirmed/.test(document.getElementById('page').innerText));
  const adYes = await api(admin, 'getCandidate', { id: adham.id });
  ok(!!adYes.academy_confirmed_at && !(await jrp.$('[data-yes="' + adham.id + '"]')) && await jrp.textContent('#abTitle') === 'Day 1',
    'Adham replies "Yes" on WhatsApp → one tap → confirmed in the app too ("2 expected · 2 confirmed"), no page change');
  let noYes = null; try { await api(nathan, 'markConfirmed', { id: adham.id }); } catch (e) { noYes = e.message; }
  ok(/No access/.test(noYes), 'only admins or their booker can mark someone confirmed');
  const pdl = await pdfDl(jrp, '[data-pdf="2026-10-19"]');
  const pdfPath = `${SHOTS}/30-day1-signin.pdf`; await pdl.saveAs(pdfPath);
  const pdfRaw = fs.readFileSync(pdfPath, 'latin1');
  ok(pdl.suggestedFilename() === 'New Starts List 19.10.2026.pdf' && /^%PDF-1\.4/.test(pdfRaw) && /%%EOF\s*$/.test(pdfRaw) && /\/Title \(New Starts List 19\.10\.2026\)/.test(pdfRaw),
    '📄 New Starts List → "New Starts List 19.10.2026.pdf" (the PDF\'s own title too)');
  let pdfTxt = '';
  try { pdfTxt = require('child_process').execFileSync('pdftotext', ['-layout', pdfPath, '-'], { encoding: 'utf8' }); } catch (e) { pdfTxt = pdfRaw; }
  ok(/New Starts List 19\.10\.2026/.test(pdfTxt) && /BA Academy Day 1 · Monday 19 October 2026 · 1:30pm/.test(pdfTxt) && /Adham Soliman/.test(pdfTxt) && /Jasraj Bhuller/.test(pdfTxt) &&
    /2 expected · 2 confirmed/.test(pdfTxt) && /Arrived: ______ of 2/.test(pdfTxt) && /shred it after Day 1/.test(pdfTxt) && /Page 1 of 1/.test(pdfTxt),
    'the PDF is a real sign-in sheet: names, mobiles, booker, confirmed, an Arrived box to tick, totals, "shred after Day 1"');
  try { require('child_process').execFileSync('pdftoppm', ['-png', '-r', '70', '-singlefile', pdfPath, `${SHOTS}/30-day1-signin`]); } catch (e) { /* no renderer here */ }
  await jr.close();

  // ── 8. Check-in outside hours: accepted, flagged amber for admins only ──
  await setTime('2026-10-19T21:00:00+01:00');
  const owl = await ci({ full_name: 'Night Owl', mobile: '07700900111', email: 'n@example.com', booker_id: fiza.id });
  ok(!!owl.id, 'check-in after 17:00 still goes through (candidate just sees "checked in")');
  ok((await api(admin, 'getCandidate', { id: owl.id })).flags.some(f => /outside office hours/.test(f.text)), 'admin sees amber "checked in at 21:00 (outside office hours)"');

  // Day 1: tick who turned up → the real show-up rate
  await ap.goto(APP + 'index.html?c=academy');
  await ap.waitForSelector('[data-d1="arrived"][data-id="' + jasId + '"]');
  ok(/Monday 19 October · TODAY/i.test(await ap.innerText('#page')), 'on the day it says TODAY with Arrived / No-show for each starter');
  await ap.click('[data-d1="arrived"][data-id="' + jasId + '"]');
  await ap.waitForSelector('[data-d1="arrived"][data-id="' + jasId + '"].green');
  await ap.click('[data-d1="no_show"][data-id="' + adham.id + '"]');
  await ap.waitForSelector('[data-d1="no_show"][data-id="' + adham.id + '"].red');
  const jD1 = await api(admin, 'getCandidate', { id: jasId }), aD1 = await api(admin, 'getCandidate', { id: adham.id });
  ok(jD1.day1_status === 'arrived' && jD1.day1_by === 'Angad Oshan' && aD1.day1_status === 'no_show', 'saved on their row in the Sheet: Jasraj arrived, Adham no-show (with who marked it and when)');
  ok(/1 arrived · 1 no-show/.test(await ap.innerText('#page')), 'the day\'s count updates: "… 1 arrived · 1 no-show"');
  const monIds = (await api(admin, 'academyList', {})).items.filter(c => c.academy_date === '2026-10-19').map(c => c.id);
  const monRows = (await ap.$$eval('.trow[data-cand]', els => els.map(e => ({ id: e.dataset.cand, green: e.classList.contains('arrived') })))).filter(x => monIds.includes(x.id));
  ok(monRows.find(x => x.id === jasId).green && !monRows.find(x => x.id === adham.id).green && monRows[monRows.length - 1].id === adham.id,
    'arrived rows turn light green (Jasraj); the no-show drops to the bottom of the day (Adham)');
  const pdl2 = await pdfDl(ap, '[data-pdf="2026-10-19"]');
  const pdf2 = `${SHOTS}/30-day1-ticked.pdf`; await pdl2.saveAs(pdf2);
  const raw2 = fs.readFileSync(pdf2, 'latin1');
  ok(raw2.indexOf('(Jasraj Bhuller)') > 0 && raw2.indexOf('(Jasraj Bhuller)') < raw2.indexOf('(Adham Soliman)') && /\(No-show\) Tj/.test(raw2) && /0\.88 0\.96 0\.9 rg/.test(raw2) &&
    /1 arrived · 1 no-show/.test(raw2) && /Arrived: 1 of 2  ·  No-show: 1/.test(raw2),
    'the New Starts List PDF matches the screen: Jasraj highlighted green with "Yes", Adham at the bottom as "No-show", "Arrived: 1 of 2 · No-show: 1"');
  try { require('child_process').execFileSync('pdftoppm', ['-png', '-r', '70', '-singlefile', pdf2, `${SHOTS}/30-day1-ticked`]); } catch (e) { /* no renderer here */ }
  await shot(ap, '28-day1-arrivals', true);
  const abdT = await loginApi('abdullahi@example.com');
  const abdD1 = (await api(abdT, 'academyList', {})).items.find(c => c.id === adham.id);
  ok(abdD1 && abdD1.day1_status === 'no_show' && !(await api(abdT, 'chaseList', {})).items.some(c => c.id === adham.id), 'a no-show stays on the Day 1 tab for their booker to rebook (not on Chase)');
  const adQ = '.trow[data-cand="' + adham.id + '"] .quick';
  ok(await ap.$(adQ + ' [data-out]') && /Rebook/.test(await ap.innerText(adQ)), 'Day 1 tab: the no-show gets Call / WhatsApp / Rebook right there');
  await ap.click('[data-d1="no_show"][data-id="' + adham.id + '"]');
  await ap.waitForSelector('[data-d1="no_show"][data-id="' + adham.id + '"].ghost');
  ok((await api(admin, 'getCandidate', { id: adham.id })).day1_status === '', 'tap again to undo a mistake');
  await api(admin, 'markDay1', { id: adham.id, status: 'no_show' });
  const reb = await api(abdT, 'saveOutcome', { id: adham.id, outcome: 'Academy booked', academy_date: '2026-10-26', outcome_notes: 'missed the train' });
  const rebD1 = (await api(abdT, 'academyList', {})).items.find(c => c.id === adham.id);
  ok(reb.day1_status === '' && !reb.academy_confirmed_at && rebD1 && rebD1.academy_date === '2026-10-26' && !rebD1.day1_status && !rebD1.academy_confirmed_at,
    'rebooking (new Day 1 date) clears the no-show; on the Day 1 tab for 26 Oct, to be confirmed again');
  await api(abdT, 'saveOutcome', { id: adham.id, outcome: 'Academy booked', academy_date: '2026-10-19', outcome_notes: '' });
  // Starting Tuesday instead: a third button on the day moves their Day 1 (off Monday's list and its PDF, onto Tuesday's)
  await ap.goto(APP + 'index.html?c=academy');
  const tueB = '[data-d1="next_day"][data-id="' + adham.id + '"]';
  await ap.waitForSelector(tueB);
  ok(/📅 Tuesday/.test(await ap.textContent(tueB)), 'a third button on the day: Arrived · No-show · "📅 Tuesday"');
  await ap.click(tueB);
  ok(/Move to Tue\?/.test(await ap.textContent(tueB)) && (await api(admin, 'getCandidate', { id: adham.id })).academy_date === '2026-10-19', 'the first tap asks "Move to Tue?" (nothing moved yet)');
  await ap.click(tueB);
  await ap.waitForFunction(() => /Tuesday 20 October · TOMORROW/i.test(document.getElementById('page').innerText));
  const tue = await api(admin, 'getCandidate', { id: adham.id });
  ok(tue.academy_date === '2026-10-20' && !tue.day1_status && !(await api(admin, 'academyList', {})).items.some(c => c.id === adham.id && c.academy_date === '2026-10-19'),
    'the second tap moves Adham\'s Day 1 to Tue 20 Oct: on Tuesday\'s list to tick there, off Monday\'s (and its PDF)');
  await shot(ap, '28b-day1-moved-to-tuesday', true);
  // One New Starts List for the week (one 📄 for the week, under ‹ ›), each person with their start day
  const wkPdf = async x => {
    const d = await pdfDl(ap, '[data-pdf="' + x + '"]');
    const pth = `${SHOTS}/31-week-starts-${x}.pdf`; await d.saveAs(pth);
    return { name: d.suggestedFilename(), raw: fs.readFileSync(pth, 'latin1'), pth: pth };
  };
  ok((await ap.$$('[data-pdf]')).length === 1 && !(await ap.$('[data-pdf="2026-10-20"]')), 'one 📄 New Starts List for the week (not one per day)');
  const pMon = await wkPdf('2026-10-19');
  const facts = p => [p.name, /Monday 19 & Tuesday 20 October 2026/.test(p.raw), /2 expected \\\(Mon 19 Oct: 1 · Tue 20 Oct: 1\\\)/.test(p.raw),
    /\(Starts\) Tj/.test(p.raw), /\(Mon 19 Oct\) Tj/.test(p.raw), /\(Tue 20 Oct\) Tj/.test(p.raw), p.raw.indexOf('(Jasraj Bhuller)') > 0 && p.raw.indexOf('(Jasraj Bhuller)') < p.raw.indexOf('(Adham Soliman)')].join('|');
  ok(facts(pMon) === 'New Starts List 19.10.2026.pdf|true|true|true|true|true|true',
    'the week\'s 📄 New Starts List has Monday\'s and Tuesday\'s starters: "Monday 19 & Tuesday 20 October 2026", "2 expected (Mon 19 Oct: 1 · Tue 20 Oct: 1)", a Starts column (Jasraj Mon 19 Oct, then Adham Tue 20 Oct)');
  try { require('child_process').execFileSync('pdftoppm', ['-png', '-r', '70', '-singlefile', pMon.pth, `${SHOTS}/31-week-starts`]); } catch (e) { /* no renderer here */ }
  const monB = '[data-d1="prev_day"][data-id="' + adham.id + '"]';
  await ap.waitForSelector(monB);
  ok(/📅 Monday/.test(await ap.textContent(monB)) && !(await ap.$('[data-d1="next_day"][data-id="' + adham.id + '"]')), 'on Tuesday\'s list he has "📅 Monday" instead, to undo it');
  await ap.click(monB); await ap.click(monB);  // "Move to Mon?" → yes
  await ap.waitForFunction(() => !/Tuesday 20 October/i.test(document.getElementById('page').innerText));
  const backMon = await api(admin, 'getCandidate', { id: adham.id });
  ok(backMon.academy_date === '2026-10-19' && !backMon.day1_status, '📅 Monday (twice) puts him back on Monday\'s list');
  let gone = null; try { await api(admin, 'markDay1', { id: jasId, status: 'prev_day' }); } catch (e) { gone = e.message; }
  ok(/already gone/.test(gone), 'never onto a day that has gone (Monday → Sunday refused)');
  await api(admin, 'markDay1', { id: adham.id, status: 'arrived' });
  // Call log: every response logged, who and when (not just the latest)
  const adLog = JSON.parse((await api(admin, 'getCandidate', { id: adham.id })).outcome_log || '[]');
  ok(adLog.length === 3 && adLog.every(e => e.o === 'Academy booked' && e.by === 'Abdullahi Ahmed' && /^2026-10-\d\d \d\d:\d\d$/.test(e.at)) && adLog[1].d === '2026-10-26' && adLog[1].n === 'missed the train' && adLog[2].d === '2026-10-19',
    'call log saved: all 3 of Abdullahi\'s responses on Adham, each with day + time, Day 1 date and notes');
  await ap.goto(APP + 'index.html?c=' + adham.id); await ap.waitForSelector('#out .calllog');
  const clRows = await ap.$$eval('#out .calllog .sl-r', r => r.map(x => x.innerText.replace(/\n+/g, ' | ')));
  ok(clRows.length === 3 && /^Academy booked · Day 1 Mon 19 Oct \| Abdullahi Ahmed · \w{3} \d+ Oct \d\d:\d\d/.test(clRows[0]) && /Day 1 Mon 26 Oct \| Abdullahi Ahmed · \w{3} \d+ Oct \d\d:\d\d · LATE \| missed the train$/.test(clRows[1]) && !(await ap.$('#out #logged')),
    'their page, Outcome: "📞 Call log", newest first, each with who, day and time: ' + clRows.join(' / '));
  await ap.locator('#out .calllog').screenshot({ path: SHOTS + '/39-call-log.png' });
  // Outcomes logged before the call log existed: rebuilt from the Log. Like the live Log tab, its times read back as dates.
  await post('/dev/eval', { js: `(() => { SpreadsheetApp.getActive().getSheetByName('Log').data.forEach((r, i) => { if (i && r[3] === '${adham.id}' && /^\\d{4}-/.test(r[0])) r[0] = String(new Date(r[0].replace(' ', 'T') + ':00+01:00')); }); MEMO = {}; return 1; })()` });
  const olRun = async log => JSON.parse((await post('/dev/eval', { js: `(() => { MEMO = {}; const c = getC('${adham.id}'); c.outcome_log = ${JSON.stringify(typeof log === 'string' ? log : JSON.stringify(log))}; writeRow('Candidates', c);
    PropertiesService.getScriptProperties().setProperty('OUTCOMES_BACKFILLED_2', ''); backfillOutcomes(); MEMO = {};
    return JSON.stringify([getC('${adham.id}').outcome_log, PropertiesService.getScriptProperties().getProperty('OUTCOMES_BACKFILLED_2')]); })()` })).out);
  const same = l => l.length === 3 && l.map(e => e.at + '|' + e.by + '|' + e.o).join() === adLog.map(e => e.at + '|' + e.by + '|' + e.o).join();
  const olFill = await olRun(''), olB = JSON.parse(olFill[0] || '[]');
  ok(same(olB) && olB[2].d === '2026-10-19' && !!olFill[1], 'older outcomes rebuilt from the Log (its times stored as dates): same 3 entries, who and when (the latest with its Day 1 date)');
  // 15 Oct: the first fill read those times as blank. This one fills them in, keeping anything saved since
  const blank = adLog.slice(0, 2).map(e => ({ at: '', by: e.by, o: e.o })).concat([adLog[2]]);
  const olFix = JSON.parse((await olRun(blank))[0] || '[]');
  ok(same(olFix) && olFix.every(e => /^2026-10-\d\d \d\d:\d\d$/.test(e.at)) && olFix[2].n === adLog[2].n, 'call logs filled with blank times on 15 Oct: times filled in from the Log, newer entries kept as they were');

  // ── 9. Rejected person returns next week → red; scheduled pushes ──
  await setTime('2026-10-20T10:00:00+01:00');
  const back = await ci({ full_name: 'Ishita Rani', mobile: '07700900200', email: 'ishita@example.com', booker_id: abd.id, rtw: 'Graduate visa (PSW)', visa_expiry: '2028-01-01' });
  await api(nathan, 'saveNotes', { id: back.id, rag: 'A', stars: 2, tags: [], notes: '' });
  const again = await api(admin, 'getCandidate', { id: back.id });
  ok(again.flags.some(f => f.level === 'red' && /Previously not suitable/.test(f.text)), 'rejected candidate returning shows red "do not progress"');
  ok(/Repeat/.test(again.pay_reason), 'repeat attendee does not count for the incentive');
  // Admins can book people, but don't earn the recruitment incentive
  await api(admin, 'saveUser', { user: Object.assign({}, staffIds.find(u => u.id === jessId), { roles: ['admin', 'booker'] }) });
  const byJess = await ci({ full_name: 'Grace Okafor', mobile: '07700900787', email: 'grace@example.com', booker_id: jessId });
  await api(nathan, 'saveNotes', { id: byJess.id, rag: 'G', stars: 4, tags: [], notes: '' });
  const inc = await api(admin, 'payReport', { weekEnding: '2026-10-25' });
  ok(!inc.rows.some(r => r.booker_id === jessId) && !inc.unassigned.some(x => x.id === byJess.id) && inc.rows.some(r => r.booker_id === fiza.id),
    'admin who also books (Jess): her bookings aren\'t on the incentive and aren\'t "no booker"; bookers still are');
  const before = (await getJson('/dev/pushes')).length;
  await post('/dev/run', { fn: 'weeklyProgressEmails' });
  const prog = (await getJson('/dev/pushes')).slice(before);
  ok(prog.some(p => /net attended|target/.test(p.body.headings.en)), 'scheduled progress alert goes out as a push');
  ok(!prog.some(p => p.body.include_aliases.external_id.includes(jessId)), 'no incentive progress alert for an admin');
  const jb = await browser.newContext(PHONE); const jbp = await jb.newPage();
  await loginUi(jbp, 'jess@linkmarketing.org.uk');
  await jbp.click('.tabbar button[data-tab=mine]'); await jbp.waitForSelector('.item:has-text("Grace Okafor")');
  ok(!(await jbp.$('.hero .ring')) && /booked/i.test(await jbp.$eval('.hero', e => e.innerText)) && !/more to hit|target/i.test(await jbp.$eval('.hero', e => e.innerText)),
    'admin\'s "Mine": her numbers, no incentive ring or target');
  const tb6 = await jbp.$$eval('.tabbar button', b => b.map(x => { const r = x.getBoundingClientRect(), s = x.querySelector('span'); return { t: x.dataset.tab, fits: s.scrollWidth <= r.width + 1 && r.right <= innerWidth }; }));
  ok(tb6.map(x => x.t).join() === 'today,mine,chase,academy,all,pay' && tb6.every(x => x.fits), 'an admin who also books: Today · Mine · Chase · Day 1 · All · Appts Attended (on two lines), every label fits on a phone');
  await jbp.click('#abMe'); await jbp.click('#mTeam'); await jbp.waitForSelector('#slideqr');
  ok(await jbp.textContent('#abTitle') === 'Team', '…and Team is under their initials (7 tabs don\'t fit a phone)');
  await shot(jbp, '31-team-from-menu');
  await jbp.click('.tabbar button[data-tab=mine]'); await jbp.click('.item:has-text("Grace Okafor")'); await jbp.waitForSelector('.profile h1');
  ok(/Booked by Jess Grace \(admin\), so no incentive/.test(await jbp.$eval('#page', e => e.innerText)) && !(await jbp.$('#excl')), 'candidate page: "Booked by Jess Grace (admin), so no incentive"');
  await jb.close();
  // Admins who book (like Jess) get nudged for their own people too
  const jessU = (await api(admin, 'listUsers', {})).users.find(u => u.id === jessId);
  await api(admin, 'saveUser', { user: Object.assign({}, jessU, { roles: ['admin'] }) });
  const jn = await api(admin, 'chaseOutcomes', { ids: [jessId] });
  ok(jn.nudged.includes('Jess Grace'), 'Nudge reaches an admin who booked someone (Jess → Grace), not just people with the booker role');
  await api(admin, 'saveUser', { user: Object.assign({}, jessU, { roles: ['admin', 'booker'] }) });
  const tim = await ci({ full_name: 'Tiny Tim', mobile: '07700900888', email: 'tim@example.com', booker_id: abd.id, over18: 'No' });
  await api(nathan, 'saveNotes', { id: tim.id, rag: 'A', stars: 2, tags: [], notes: '' });
  const ev1 = await browser.newContext(PHONE); const evp = await ev1.newPage();
  await evp.goto(APP + 'eval.html'); await evp.waitForSelector('#m');
  await evp.fill('#m', '07700900888'); await evp.click('#go');
  await evp.waitForSelector('text=No form needed');
  ok(!(await evp.$('.qcard')) && /Our team will speak to you directly/.test(await evp.innerText('body')), 'under-18 scans the evaluation QR → "No form needed", no questions');
  await shot(evp, '17-nonqual-eval');
  await ev1.close();
  const incW2 = (await api(admin, 'payReport', { weekEnding: '2026-10-25' })).rows.find(r => r.booker_id === abd.id);
  ok(incW2.excluded.some(x => x.name === 'Tiny Tim' && x.why === 'Under 18') && incW2.missing === 1, 'under-18: never counts for the incentive and nobody is chased for their outcome');
  await ap.goto(APP + 'index.html?c=' + tim.id); await ap.waitForSelector('.profile h1');
  const timTxt = await ap.$eval('#page', e => e.innerText);
  ok(/⛔ Non-qualifier: Under 18/.test(timTxt) && /No evaluation form, doesn't count for the incentive, no outcome needed/.test(timTxt) && /not needed/i.test(timTxt), 'candidate page: ⛔ Non-qualifier banner, outcome "not needed"');
  await shot(ap, '18-nonqual-candidate', true);
  await ap.goto(APP + 'index.html'); await ap.waitForSelector('.tabbar button');
  await ap.click('.tabbar button[data-tab=all]'); await ap.waitForSelector('#flt'); await ap.click('#flt .chip[data-f=nq]');
  await ap.waitForSelector('.item:has-text("Tiny Tim")');
  ok((await ap.$$('.item')).length === 1 && /⛔ Non-qualifier/.test(await ap.innerText('.item')), 'All → "Non-qualifiers" filter lists them with a ⛔ badge');
  await ap.click('.tabbar button[data-tab=today]'); await ap.waitForSelector('#bullDaily'); await ap.click('#bullDaily');
  await ap.waitForSelector('#bimg[data-info]', { timeout: 15000 });
  const bi2 = JSON.parse(await ap.getAttribute('#bimg', 'data-info'));
  ok(bi2.rows.some(r => / Jess 1$/.test(r)) && !bi2.rows.some(r => /Abdullahi/.test(r)) && bi2.nonQual >= 1,
    'bulletin: admins are on it (Jess 1); a non-qualifier is never credited to the booker, only in the Non-qualifiers number');
  await ap.click('#abBack');
  await post('/dev/eval', { js: `globalThis.__pushOff = ['${abd.id}']` });
  const mailBefore = (await getJson('/dev/mail')).length;
  await post('/dev/run', { fn: 'weeklyProgressEmails' });
  const newMail = (await getJson('/dev/mail')).slice(mailBefore);
  ok(newMail.some(m => m.to === abd.email && /net attended|target/.test(m.subject)), 'booker who never turned alerts on still gets it, by email');
  ok(!newMail.some(m => m.to === fiza.email), 'booker with alerts on gets the push only (no duplicate email)');
  const alertLog = (await getJson('/dev/sheet?name=Log')).filter(r => r[2] === 'alert').map(r => r[4]);
  ok(alertLog.some(d => /just checked in → 📲 Fiza/.test(d)) && alertLog.some(d => /→ .*✉️ Abdullahi/.test(d)),
    'every alert is logged with who got it on their phone (📲) and who by email (✉️)');
  // Alerts check (Team → 🔔 Alerts check): who actually gets their alerts
  await post('/dev/eval', { js: `globalThis.__pushOff = ['${abd.id}']; globalThis.__pushNever = ['${mo.id}']` });
  await ap.goto(APP + 'index.html'); await ap.waitForSelector('.tabbar button[data-tab=team]');
  await ap.click('.tabbar button[data-tab=team]'); await ap.click('#alertsck'); await ap.waitForSelector('.achk');
  const ach = await ap.innerText('#page');
  const offTxt = await ap.innerText('.datehead:has-text("Not getting") + .list'), onTxt = await ap.innerText('.datehead:has-text("Alerts on") + .list');
  ok(/of \d+ get alerts on their phone/.test(ach) && /Abdullahi Ahmed/.test(offTxt) && /Mo Aden/.test(offTxt) && /Gets alerts by email instead: abdullahi@example\.com/.test(offTxt) && /Fiza Iqbal/.test(onTxt) && !/Fiza/.test(offTxt),
    'Alerts check: Abdullahi + Mo listed as not getting phone alerts (email instead), Fiza on');
  ok(/Phone alerts: connected/.test(ach) && /Email backup: \d+ emails left today/.test(ach) && /Scheduled alerts running/.test(ach), 'Alerts check: OneSignal connected, email allowance, scheduled alerts running');
  await shot(ap, '18-alerts-check', true);
  const mb = (await getJson('/dev/mail')).length;
  await ap.click('#setupMail'); await ap.waitForSelector('text=Setup steps sent to');
  const setupMails = (await getJson('/dev/mail')).slice(mb);
  ok(setupMails.some(m => m.to === abd.email && /Set up the Juss & Link Recruitment App/.test(m.subject) && /Add to Home Screen/.test(m.htmlBody)) && setupMails.some(m => m.to === mo.email) && !setupMails.some(m => m.to === fiza.email),
    '"Email setup steps" → only the people not set up get the 2-minute guide (iPhone: Add to Home Screen…)');
  const pb = (await getJson('/dev/pushes')).length;
  await ap.click('.trow:has-text("Fiza Iqbal") [data-test]'); await ap.waitForSelector('text=Test reached: Fiza Iqbal');
  ok((await getJson('/dev/pushes')).slice(pb).some(p => /Test alert from Angad/.test(p.body.headings.en) && p.body.include_aliases.external_id.includes(fiza.id)), 'Test button → a test alert lands on Fiza\'s phone');
  await post('/dev/eval', { js: 'globalThis.__pushOff = []; globalThis.__pushNever = []' });

  // ── 9b. A booker who isn't in the app yet: the candidate types their name, admin adds them by name, the credit follows ──
  console.log('booker not on the list');
  const nb = await browser.newContext(PHONE); const nbp = await nb.newPage();
  await nbp.goto(APP + 'checkin.html'); await nbp.waitForSelector('#f');
  await nbp.fill('[name=full_name]', 'Tara Newman'); await nbp.fill('[name=mobile]', '07700900801'); await nbp.fill('[name=email]', 'tara@example.com');
  await nbp.click('.chips[data-name=over18] .chip:has-text("Yes")');
  await nbp.fill('#bkq', 'Priya Sharma');
  ok(/Not on the list\? Type their full name/.test(await nbp.innerText('#sg')), 'booker not on the list → "Not on the list? Type their full name and carry on"');
  await nbp.locator('.qcard.ci:has(#bk)').screenshot({ path: SHOTS + '/19a-checkin-booker-not-listed.png' });
  await nbp.selectOption('[name=rtw]', 'British or Irish citizen'); await nbp.check('[name=privacy_ok]');
  await nbp.click('#go'); await nbp.waitForSelector('text=You\'re checked in, Tara!');
  ok(true, 'candidate checks in with the typed name (no need to tick "not sure")');
  await nb.close();
  const tara = (await api(admin, 'search', { q: 'Tara Newman' })).items[0];
  ok(!tara.booker_id && tara.booker_typed === 'Priya Sharma', 'saved as "Booker not confirmed: Priya Sharma"');
  const omar = await ci({ full_name: 'Omar Second', mobile: '07700900802', email: 'omar2@example.com', booker_id: '', booker_typed: 'priya' });
  await ap.goto(APP + 'index.html?c=' + tara.id); await ap.waitForSelector('#rb');
  await ap.selectOption('#rb', '__new');
  ok(await ap.inputValue('#nbkn') === 'Priya Sharma', 'Booker → "＋ Someone not on the list…" opens with the name the candidate typed');
  await ap.click('#nbk .chip:has-text("JUSS")');
  await ap.locator('#sec-adm').screenshot({ path: SHOTS + '/19b-add-booker-by-name.png' });
  await ap.click('#nbksave'); await ap.waitForSelector('text=Priya added and credited');
  const tNow = await api(admin, 'getCandidate', { id: tara.id }), oNow = await api(admin, 'getCandidate', { id: omar.id });
  ok(tNow.booker_name === 'Priya Sharma' && tNow.company === 'JUSS' && oNow.booker_name === 'Priya Sharma',
    'Priya added by name (JUSS): Tara credited to her, and Omar (who typed "priya") linked automatically');
  const priya = (await api(admin, 'listUsers')).users.find(x => x.name === 'Priya Sharma');
  ok(priya && !priya.email && (await api('', 'publicConfig')).bookers.some(b => b.name === 'Priya Sharma'), 'Priya is on the team with no email (not in the app yet) and in the check-in booker list straight away');
  await api(nathan, 'saveNotes', { id: tara.id, rag: 'G', stars: 4, tags: [], notes: '' });
  ok(((await api(admin, 'payReport', {})).rows.find(r => r.name === 'Priya Sharma') || {}).net === 1, 'Tara rated in the room → counts for Priya on the recruitment incentive');
  await ap.goto(APP + 'index.html'); await ap.waitForSelector('.tabbar button[data-tab=today]');
  await ap.click('.tabbar button[data-tab=today]'); await ap.waitForSelector('#bullDaily'); await ap.click('#bullDaily');
  await ap.waitForSelector('#bimg[data-info]', { timeout: 15000 });
  ok(JSON.parse(await ap.getAttribute('#bimg', 'data-info')).rows.some(r => / Priya 1$/.test(r)), 'Priya gets her recognition on the daily bulletin (Priya 1)');
  await ap.click('#abBack');
  const mb2 = (await getJson('/dev/mail')).length;
  await api(admin, 'saveUser', { user: Object.assign({}, priya, { email: 'priya@example.com' }) });
  ok((await getJson('/dev/mail')).slice(mb2).some(m => m.to === 'priya@example.com' && /Set up the/.test(m.subject)), 'adding her email later → she gets the setup email');
  const prTok = await loginApi('priya@example.com');
  const prView = await api(prTok, 'getCandidate', { id: tara.id });
  ok(!prView.limited && prView.mobile === '07700900801', 'she logs in and Tara is already hers, in full');
  // Near-duplicate names: the same person added twice splits their credit (live: "Ramis - Ali Abbas" + "Ramis - Ali Abass")
  const zedTypo = await ci({ full_name: 'Zed Typo', mobile: '07700900804', email: 'zedt@example.com', booker_id: '', booker_typed: 'Priya Sharmah' });
  ok((await api(admin, 'getCandidate', { id: zedTypo.id })).booker_id === priya.id, 'a check-in typed "Priya Sharmah" (typo) is credited to Priya Sharma straight away');
  const zed = await ci({ full_name: 'Zed Unsure', mobile: '07700900803', email: 'zed@example.com', booker_id: '', booker_typed: 'Not sure' });
  const tryAdd = async name => { try { await api(admin, 'saveUser', { user: { name: name, email: '', company: 'JUSS', roles: ['booker'], active: true } }); return 'added'; } catch (e) { return e.message; } };
  ok(new RegExp('SIMILAR\\|' + priya.id + '\\|Priya Sharma\\|JUSS\\|$').test(await tryAdd('Priya Sharmah')), 'adding "Priya Sharmah" when "Priya Sharma" is on the team is stopped (a typo = the same person twice)');
  ok(/SIMILAR\|/.test(await tryAdd('Ramis - Priya Sharma')) && /SIMILAR\|/.test(await tryAdd('Sharma Priya')), '…and so is the same name inside a longer one ("Ramis - Priya Sharma") or the other way round');
  await ap.goto(APP + 'index.html?c=' + zed.id); await ap.waitForSelector('#rb');
  await ap.selectOption('#rb', '__new');
  await ap.fill('#nbkn', 'Priya Sharmah');
  await ap.click('#nbksave'); await ap.waitForSelector('#nbkuse');
  ok(/Priya Sharma \(JUSS\) is already on the team\. Same person\?/.test(await ap.innerText('#nbksim')), '"＋ Someone not on the list…" with a near-match asks: "Priya Sharma (JUSS) is already on the team. Same person?"');
  await ap.locator('#sec-adm').screenshot({ path: SHOTS + '/19c-same-person.png' });
  await ap.click('#nbkuse'); await ap.waitForSelector('text=Booker updated');
  ok((await api(admin, 'getCandidate', { id: zed.id })).booker_id === priya.id && !(await api(admin, 'listUsers')).users.some(x => x.name === 'Priya Sharmah'),
    '"✅ Yes: credit Priya Sharma" → Zed is credited to her, no duplicate created');
  const twin = await api(admin, 'saveUser', { allowSimilar: true, user: { name: 'Priya Sharmah', email: '', company: 'LINK', roles: ['booker'], active: true } });
  ok(twin.name === 'Priya Sharmah', 'a genuinely different person can still be added ("Different person: add anyway")');
  await api(admin, 'deleteUser', { id: twin.id });
  const priyaNow = (await api(admin, 'listUsers')).users.find(x => x.id === priya.id);
  await api(admin, 'saveUser', { user: Object.assign({}, priyaNow, { name: 'Priya Sharma-Khan' }) });
  ok((await api(admin, 'getCandidate', { id: tara.id })).booker_name === 'Priya Sharma-Khan', 'renaming someone updates "booked by" on all their candidates');
  await api(admin, 'saveUser', { user: Object.assign({}, priyaNow, { name: 'Priya Sharma' }) });

  // ── 9d. A booker's other names (team members, their company): typed at check-in → credited automatically ──
  console.log('other names');
  const userOf = async id => (await api(admin, 'listUsers', {})).users.find(x => x.id === id);
  const saveAl = (usr, al) => api(admin, 'saveUser', { user: Object.assign({}, usr, { aliases: al }) });
  const fzAl = await saveAl(await userOf(fiza.id), ['Daniel Thompson', 'Sophie - Skye Promotions', '  ', 'daniel thompson', 'Fiza Iqbal']);
  ok(JSON.stringify(fzAl.aliases) === '["Daniel Thompson","Sophie - Skye Promotions"]', 'other names saved and tidied (blanks, repeats and their own name dropped): ' + fzAl.aliases.join(' · '));
  ok((await api('', 'publicConfig')).bookers.find(x => x.id === fiza.id).aliases.includes('Daniel Thompson'), 'they\'re in the check-in booker list');
  let clash = null; try { await saveAl(await userOf(abd.id), ['Daniel Thompson']); } catch (e) { clash = e.message; }
  ok(/"Daniel Thompson" is already one of Fiza Iqbal's other names/.test(clash), 'one name can only credit one booker: "Daniel Thompson is already one of Fiza Iqbal\'s other names"');
  await saveAl(await userOf(abd.id), ['Ali Milad']);
  await saveAl(await userOf(mo.id), ['Ramis - Ali Abbas']);
  const before9d = (await getJson('/dev/pushes')).length;
  let alN = 10;
  const alc = (n, typed) => ci({ full_name: 'Alias ' + n, mobile: '077009008' + (alN++), email: 'al' + n.toLowerCase() + '@example.com', booker_id: '', booker_typed: typed });
  const al1 = await alc('One', 'Daniel Thompson'), al2 = await alc('Two', 'Sophie from Skye Promotions'), al3 = await alc('Three', 'daniel'),
    al4 = await alc('Four', 'Daniel Thomson'), al5 = await alc('Fiver', 'Ali'), al6 = await alc('Sixteen', 'Ali Abbas');
  const bOf = async c => (await api(admin, 'getCandidate', { id: c.id })).booker_id;
  ok(await bOf(al1) === fiza.id, 'typed "Daniel Thompson" (one of Fiza\'s other names) → credited to Fiza straight away');
  ok(await bOf(al2) === fiza.id && await bOf(al3) === fiza.id && await bOf(al4) === fiza.id, '…and "Sophie from Skye Promotions", "daniel" and the typo "Daniel Thomson"');
  ok(!(await bOf(al5)) && await bOf(al6) === mo.id, '"Ali" could be Abdullahi\'s Ali Milad or Mo\'s Ali Abbas → nobody guessed; "Ali Abbas" → Mo');
  const p9d = (await getJson('/dev/pushes')).slice(before9d);
  ok(p9d.filter(p => p.body.include_aliases.external_id.includes(fiza.id) && /just checked in$/.test(p.body.headings.en)).length === 4 && p9d.some(p => /^❓ No booker: Alias Fiver/.test(p.body.headings.en)),
    'Fiza gets her 4 "just checked in" alerts; the unclear one goes to Jess + Rubal as "❓ No booker"');
  ok((await getJson('/dev/sheet?name=Log')).some(r => r[2] === 'auto_booker' && /"Daniel Thompson" → Fiza Iqbal/.test(r[4])), 'each automatic match is in the Log ("Daniel Thompson" → Fiza Iqbal)');
  const al7 = await alc('Seventeen', 'Zuzanna Sroda');
  ok(!(await bOf(al7)), 'typed "Zuzanna Sroda" (nobody\'s other name yet) → no booker');
  await ap.goto(APP + 'index.html'); await ap.waitForSelector('.tabbar button[data-tab=team]'); await ap.click('.tabbar button[data-tab=team]');
  await ap.click('.item[data-u="' + mo.id + '"]'); await ap.waitForSelector('#ual');
  ok(await ap.inputValue('#ual') === 'Ramis - Ali Abbas', 'Team → Mo: "Other names they use" shows what he has');
  await ap.fill('#ual', 'Ramis - Ali Abbas\nZuzanna Sroda');
  await shot(ap, '32-other-names', true);
  await ap.click('#usave'); await ap.waitForSelector('text=1 check-in that typed their name or other names now credited');
  ok(await bOf(al7) === mo.id, 'admin adds "Zuzanna Sroda" to Mo in the app → the check-in that typed it earlier is credited to Mo there and then');
  await ap.waitForSelector('.item[data-u="' + mo.id + '"]');
  ok(/also: Ramis - Ali Abbas · Zuzanna Sroda/.test(await ap.innerText('.item[data-u="' + mo.id + '"]')), 'the Team list shows everyone\'s other names');
  await saveAl(await userOf(abd.id), ['Ali Milad', 'John - Mayba', 'Sally - MSA', 'William - Zohra Marketing', 'Rajan - RS Global', 'Stones Recruitment Limited']);
  await ap.reload(); await ap.waitForSelector('.tabbar button[data-tab=team]'); await ap.click('.tabbar button[data-tab=team]'); await ap.waitForSelector('.item[data-u="' + abd.id + '"]');
  await ap.waitForFunction(id => /William - Zohra/.test((document.querySelector('.item[data-u="' + id + '"]') || {}).innerText || ''), abd.id);
  const widths = await ap.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  ok(widths[0] <= widths[1], 'a long "also: …" line wraps: the Team page stays phone-width (' + widths[0] + 'px of ' + widths[1] + 'px; live it had doubled)');
  await ap.goto(APP + 'index.html?c=' + al1.id); await ap.waitForSelector('.profile h1');
  ok(/booked by Fiza Iqbal.*\(they said "Daniel Thompson"\)/.test(await ap.innerText('#page')), 'candidate page: "booked by Fiza Iqbal (they said "Daniel Thompson")" so admins can see why');
  let simA = null; try { await api(admin, 'saveUser', { user: { name: 'Daniel Thompson', email: '', company: 'LINK', roles: ['booker'], active: true } }); } catch (e) { simA = e.message; }
  ok(new RegExp('SIMILAR\\|' + fiza.id + '\\|Fiza Iqbal\\|LINK\\|Daniel Thompson').test(simA), 'adding "Daniel Thompson" as a new person → "Daniel Thompson is one of Fiza Iqbal\'s other names. Same person?"');
  const cx = await browser.newContext(PHONE); const cxp = await cx.newPage();
  await cxp.goto(APP + 'checkin.html'); await cxp.waitForSelector('#f');
  await cxp.fill('#bkq', 'Skye');
  await cxp.waitForSelector('#sg button[data-name="Sophie - Skye Promotions"]');
  ok(/Sophie - Skye Promotions\s*LINK/.test(await cxp.innerText('#sg')), 'check-in: typing "Skye" suggests "Sophie - Skye Promotions"');
  await cxp.click('#sg button[data-name="Sophie - Skye Promotions"]');
  ok(/Sophie - Skye Promotions/.test(await cxp.innerText('.picked')) && await coOf(cxp) === 'LINK', '…picking it switches to Fiza\'s LINK colours');
  await cxp.fill('[name=full_name]', 'Picked Alias'); await cxp.fill('[name=mobile]', '07700900899'); await cxp.fill('[name=email]', 'pickal@example.com');
  await cxp.click('.chips[data-name=over18] .chip:has-text("Yes")'); await cxp.selectOption('[name=rtw]', 'British or Irish citizen'); await cxp.check('[name=privacy_ok]');
  await cxp.click('#go'); await cxp.waitForSelector('text=You\'re checked in, Picked!');
  const pa = (await api(admin, 'search', { q: 'Picked Alias' })).items[0];
  ok(pa.booker_id === fiza.id && pa.booker_typed === 'Sophie - Skye Promotions', '…and the check-in is Fiza\'s (it remembers they picked "Sophie - Skye Promotions")');
  await cx.close();

  // ── 9c. Logging in: someone added mid-session can log in straight away; an admin can show them a code ──
  console.log('login codes');
  // The race that hit Monish: a check-in read the team list just before he was added, then saved that old list back afterwards
  await post('/dev/eval', { js: "MEMO = {}; globalThis.__ver0 = PropertiesService.getScriptProperties().getProperty('USERS_VER') || '0'; globalThis.__stale = JSON.stringify(readTable('Users')); 1" });
  const monish = await api(admin, 'saveUser', { user: { name: 'Monish Somalai', email: 'monish_m4@yahoo.com', company: 'LINK', roles: ['booker', 'presenter'], active: true } });
  await post('/dev/eval', { js: "CacheService.getScriptCache().put('users_v3_' + __ver0, __stale, 600); 1" });
  const mb3 = (await getJson('/dev/mail')).length;
  await api('', 'requestCode', { email: ' Monish_M4@yahoo.com ' });
  ok((await getJson('/dev/mail')).slice(mb3).some(m => m.to === 'monish_m4@yahoo.com' && /login code/.test(m.subject)),
    'someone added a moment ago gets their login code, even if a check-in saved the old team list at that moment (capitals / spaces don\'t matter)');
  await api('', 'requestCode', { email: 'nobody@example.com' });
  const codeLog = (await getJson('/dev/sheet?name=Log')).filter(r => r[2] === 'login_code').map(r => r[4]);
  ok(codeLog.some(d => /monish_m4@yahoo\.com · emailed/.test(d)) && codeLog.some(d => /nobody@example\.com · no active team member/.test(d)),
    'every code request is logged (emailed / no such person), so "I never got a code" can be checked');
  for (let i = 0; i < 4; i++) await api('', 'requestCode', { email: 'monish_m4@yahoo.com' });
  const lim = await post('/api', { action: 'requestCode', email: 'monish_m4@yahoo.com' });
  ok(!lim.ok && /Check Spam\/Junk/.test(lim.error) && /show you a code/.test(lim.error), 'after 5 codes in 15 minutes: "Check Spam/Junk… or ask an admin to show you a code"');
  await ap.evaluate(() => localStorage.removeItem('lr_cache'));
  await ap.goto(APP + 'index.html'); await ap.waitForSelector('.tabbar button[data-tab=team]');
  await ap.click('.tabbar button[data-tab=team]'); await ap.click('.item:has-text("Monish Somalai")');
  await ap.click('#ucode'); await ap.waitForSelector('.codeshow .code');
  const shown = (await ap.innerText('.codeshow .code')).trim();
  ok(/^\d{6}$/.test(shown) && /BA login/.test(await ap.innerText('.codeshow')) && /Already have a code\?/.test(await ap.innerText('.codeshow')),
    'Team → Monish → 🔑 shows a 6-digit login code on the admin\'s screen, with exactly what to tap');
  await ap.locator('#uf').screenshot({ path: SHOTS + '/20-admin-login-code.png' });
  const mc = await browser.newContext(PHONE); const mp = await mc.newPage();
  await mp.goto(APP + 'index.html'); await mp.click('#doors button[data-door=ba]');
  await mp.fill('#em', 'monish_m4@yahoo.com'); await mp.click('#haveCode'); await mp.fill('#code', shown); await mp.click('#go');
  await mp.waitForSelector('.tabbar button');
  ok(true, 'Monish logs in with that code via "Already have a code?", even after hitting the limit');
  await mc.close();
  const rc = await browser.newContext(PHONE); const rp = await rc.newPage();
  await rp.goto(APP + 'index.html'); await rp.click('#doors button[data-door=ba]');
  await rp.fill('#em', 'nobody2@example.com'); await rp.click('#go'); await rp.waitForSelector('#codeBox:not([hidden])');
  await rp.reload(); await rp.waitForSelector('#em');
  ok(!(await rp.$('#codeBox[hidden]')) && /We emailed a code to/.test(await rp.innerText('#err')) && (await rp.innerText('#go')).trim() === 'Log in',
    'back from the email app: the code box is still open ("We emailed a code to…"), so nobody taps "Email me a code" again and again');
  await rc.close();
  await ap.click('#abBack');
  // Adding someone in the room: the app stays on their page, ready to show a login code
  await ap.click('#add'); await ap.waitForSelector('#un');
  await ap.fill('#un', 'Zara Newstarter'); await ap.fill('#ue', 'zara@example.com');
  await ap.click('#uf .chips[data-name=company] .chip:has-text("JUSS")');
  await ap.click('#usave'); await ap.waitForSelector('text=Zara is set up');
  ok(!!(await ap.$('#ucode')), 'adding someone keeps you on their page: "Zara is set up… With them now? Tap 🔑"');
  await ap.click('#ucode'); await ap.waitForSelector('.codeshow .code');
  const zcode = (await ap.innerText('.codeshow .code')).trim();
  const zc = await browser.newContext(PHONE); const zp = await zc.newPage();
  await zp.goto(APP + 'index.html'); await zp.click('#doors button[data-door=ba]');
  await zp.fill('#em', 'zara@example.com'); await zp.click('#haveCode'); await zp.fill('#code', zcode); await zp.click('#go');
  await zp.waitForSelector('.tabbar button'); await zc.close();
  ok(true, 'she logs in on the spot with that code, without waiting for any email');
  await ap.click('#abBack');
  const mb4 = (await getJson('/dev/mail')).length;
  await api(admin, 'saveUser', { user: Object.assign({}, monish, { email: 'monish.somalai@example.com' }) });
  ok((await getJson('/dev/mail')).slice(mb4).some(m => m.to === 'monish.somalai@example.com' && /Set up the/.test(m.subject)), 'correcting someone\'s email sends the setup steps to the new address');

  // ── Candidate side is instant, and nothing is ever lost: no signal, Google busy, or Google says no ──
  console.log('candidate: instant + nothing lost');
  const pollFor = async (fn, ms) => { for (let i = 0; i < (ms || 30000) / 400; i++) { const v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 400)); } return null; };
  const nsC = await browser.newContext(PHONE); const nsP = await nsC.newPage();
  await nsP.goto(APP + 'checkin.html'); await nsP.waitForSelector('[name=full_name]');
  await nsP.waitForFunction(() => !!localStorage.getItem('lr_cfg'));  // bookers' names have arrived
  await nsC.setOffline(true);
  await fillCheckin(nsP, { name: 'nia offline', mobile: '07700 911111', email: 'nia@example.com', booker: 'Fiza Iqbal' });
  const tNsCi = Date.now(); await nsP.click('#go'); await nsP.waitForSelector('text=You\'re checked in, Nia');
  ok(Date.now() - tNsCi < 1000 && !(await api(admin, 'search', { q: 'Nia Offline' })).items.length,
    'no signal: "You\'re checked in, Nia!" straight away (' + (Date.now() - tNsCi) + 'ms); the check-in waits on the phone');
  await nsC.setOffline(false);
  const niaC = await pollFor(async () => (await api(admin, 'search', { q: 'Nia Offline' })).items[0]);
  ok(niaC && niaC.booker_name === 'Fiza Iqbal' && await nsP.evaluate(() => !!JSON.parse(localStorage.getItem('lr_cand') || '{}').id && localStorage.getItem('lr_sendq') === '{}'),
    'signal back → the check-in reaches Google by itself (booked by Fiza), the phone now knows who she is');
  const tNsEv = Date.now(); await nsP.goto(APP + 'eval.html'); await nsP.waitForSelector('text=Your evaluation, Nia');
  ok(Date.now() - tNsEv < 1500, 'same phone scans the evaluation QR → her form, straight in (' + (Date.now() - tNsEv) + 'ms, Google double-checks behind)');
  await nsC.setOffline(true);
  await fillEval(nsP);
  const tNsSub = Date.now(); await nsP.click('#go'); await nsP.waitForSelector('text=Thank you, Nia');
  ok(Date.now() - tNsSub < 1000 && !(await api(admin, 'getCandidate', { id: niaC.id })).eval_at, 'no signal: "Thank you, Nia!" straight away; the answers wait safely on the phone');
  await nsC.setOffline(false);
  ok(await pollFor(async () => (await api(admin, 'getCandidate', { id: niaC.id })).eval_at) && await nsP.evaluate(id => !localStorage.getItem('lr_evaldraft_' + id), niaC.id),
    'signal back → her evaluation reaches Google by itself, and the copy on the phone is cleared');
  await nsC.close();
  // Google says no (something only Google can check): back to her form, everything still filled in, with the reason
  const nsX = await browser.newContext(PHONE); const nsXP = await nsX.newPage();
  await nsXP.route('**/api', route => {
    const b = JSON.parse(route.request().postData() || '{}');
    if (b.action === 'checkin') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'This mobile is already checked in under another name today.' }) });
    return route.continue();
  });
  await nsXP.goto(APP + 'checkin.html'); await nsXP.waitForSelector('[name=full_name]'); await nsXP.waitForFunction(() => !!localStorage.getItem('lr_cfg'));
  await fillCheckin(nsXP, { name: 'Omar Refused', mobile: '07700 922222', email: 'omar@example.com', booker: 'Fiza Iqbal' });
  await nsXP.click('#go'); await nsXP.waitForSelector('text=We couldn\'t check you in');
  ok(await nsXP.inputValue('[name=full_name]') === 'Omar Refused' && await nsXP.inputValue('[name=email]') === 'omar@example.com' && /Fiza Iqbal/.test(await nsXP.innerText('.picked')) &&
    await nsXP.$eval('[name=privacy_ok]', e => e.checked) && /already checked in under another name/.test(await nsXP.innerText('#err')),
    'Google says no → back to the form with everything still filled in (booker too) and the reason');
  await nsXP.unroute('**/api');
  await nsXP.click('#go'); await nsXP.waitForSelector('text=You\'re checked in, Omar');
  ok(await pollFor(async () => (await api(admin, 'search', { q: 'Omar Refused' })).items.length), 'fix it, tap again → checked in');
  await nsX.close();
  // The congratulations link: on screen without waiting for Google; Confirm with no signal still lands
  await api(admin, 'saveOutcome', { id: niaC.id, outcome: 'Academy booked', academy_date: '2026-10-26', outcome_notes: '' });
  const niaLink = (await api(admin, 'getCandidate', { id: niaC.id })).welcome_url;
  ok(/[?&]n=Nia&d=2026-10-26$/.test(niaLink), 'the congratulations link carries her first name and Day 1 date');
  const nsW = await browser.newContext(PHONE); const nsWP = await nsW.newPage();
  let slowG = true;  // Google slow today
  await nsWP.route('**/api', route => (slowG ? new Promise(r => setTimeout(r, 4000)) : Promise.resolve()).then(() => route.continue()).catch(() => {}));
  const tNsWl = Date.now(); await nsWP.goto(niaLink.replace(PUBLIC, APP)); await nsWP.waitForSelector('text=You\'re in, Nia');
  ok(Date.now() - tNsWl < 2500 && /Monday 26 October/.test(await nsWP.innerText('.wl-date')), 'welcome page on screen without waiting for Google (' + (Date.now() - tNsWl) + 'ms, Google taking 4s)');
  slowG = false; await nsWP.waitForTimeout(4500);
  await nsW.setOffline(true);
  await nsWP.click('#conf'); await nsWP.waitForSelector('.wl-done');
  ok(!(await api(admin, 'getCandidate', { id: niaC.id })).academy_confirmed_at, 'no signal: tap Confirm → "You\'re locked in" straight away');
  await nsW.setOffline(false);
  ok(await pollFor(async () => (await api(admin, 'getCandidate', { id: niaC.id })).academy_confirmed_at), 'signal back → her confirmation reaches Google by itself');
  const tNsAgain = Date.now(); await nsWP.reload(); await nsWP.waitForSelector('.wl-done');
  ok(Date.now() - tNsAgain < 1500 && (await nsWP.$$('link[rel=preconnect]')).length >= 3, 'opens again later already locked in, instantly; Maps / Calendar / Pre-Coaching links warmed up before the tap');
  await nsW.close();

  // ── "Thinking it over": when to call back → a reminder at that time + the "speak soon" message. "No answer": LINK / JUSS for the team ──
  const tia = await ci({ full_name: 'Tia Overton', mobile: '07700900611', email: 'tia@example.com', booker_id: abd.id });
  const meId = (await api(admin, 'me', {})).user.id;
  await ap.goto(APP + 'index.html?c=' + tia.id); await ap.waitForSelector('#saveout');
  await ap.click('#out .chips[data-name=outcome] .chip:has-text("Thinking it over")');
  ok(!(await ap.$eval('#cbk', e => e.hidden)) && (await ap.$$eval('#cbk .chip', b => b.map(x => x.textContent))).some(t => /Tomorrow 6pm/.test(t)),
    '"Thinking it over" → "When did they ask us to call back?": In 1 hour / Today 6pm / Tomorrow 12pm / Tomorrow 6pm / Another day');
  await ap.click('#saveout'); await ap.waitForSelector('#oerr .err, #oerr:not(:empty)');
  ok(/When did they ask us to call back/.test(await ap.innerText('#oerr')), 'can\'t save "Thinking it over" without a call-back time');
  await ap.click('#cbk .chip[data-v=pick]'); await ap.fill('#cbk .cbd', '2026-10-20'); await ap.fill('#cbk .cbt', '18:00');
  await ap.click('#saveout');
  const tiaNow = await pollFor(async () => { const x = await api(admin, 'getCandidate', { id: tia.id }); return x.callback_at === '2026-10-20 18:00' && x; });
  ok(tiaNow && tiaNow.outcome === 'Thinking it over' && tiaNow.callback_by_id === meId && JSON.parse(tiaNow.outcome_log).pop().cb === '2026-10-20 18:00',
    'saved: call back Tue 20 Oct 18:00, reminder goes to whoever logged it (Angad), and it\'s in the call log');
  await ap.waitForSelector('#wacard a[data-kind=thinking]');
  const spk = decodeURIComponent((await ap.getAttribute('#wacard a[data-kind=thinking]', 'href')).split(/\?text=|[?&]body=/)[1] || '');
  ok(/🔁 Call back Tue 20 Oct 18:00/.test(await ap.innerText('.profile')) && /^Hey Tia! 👋/.test(spk) && /I'll call you back (on \*Tuesday 20th October|\*today|\*tomorrow) at 6:00 PM\*/.test(spk) && /call or text me on this number/.test(spk) && /\*Angad Oshan\*, on behalf of JUSS Marketing recruitment team/.test(spk),
    'their pill says "🔁 Call back Tue 20 Oct 18:00"; one tap sends "speak soon, I\'ll call you back on Tuesday 20th October at 6:00 PM", signed by the sender, in their company\'s branding');
  fs.writeFileSync(`${SHOTS}/msg-speak-soon.txt`, spk);
  await ap.locator('#out').screenshot({ path: SHOTS + '/40-thinking-it-over.png' });
  const cbHead = p => p.body.headings.en === '🔁 Call Tia back now';
  await setTime('2026-10-20T17:55:00+01:00'); await post('/dev/run', { fn: 'keepWarm' });
  ok(!(await getJson('/dev/pushes')).some(cbHead), 'no reminder before the time');
  await setTime('2026-10-20T18:02:00+01:00'); await post('/dev/run', { fn: 'keepWarm' });
  const cbPush = (await getJson('/dev/pushes')).filter(cbHead);
  ok(cbPush.length === 1 && cbPush[0].body.include_aliases.external_id.includes(meId) && /asked for a call back at 18:00/.test(cbPush[0].body.contents.en),
    'at 18:00 → whoever logged it: "🔁 Call Tia back now · They asked for a call back at 18:00"');
  await post('/dev/run', { fn: 'keepWarm' });
  ok((await getJson('/dev/pushes')).filter(cbHead).length === 1, 'the reminder goes once');
  // The recruitment team: LINK / JUSS for both follow-up messages, signed by them
  const rt2 = await browser.newContext(PHONE), rt2p = await rt2.newPage();
  await loginUi(rt2p, 'recruitment@jussmarketing.co.uk', APP + 'index.html?c=' + tia.id); await rt2p.waitForSelector('#wacard .cobig[data-kind=thinking][data-co=LINK]');
  const rtMsg = async (k, co) => decodeURIComponent((await rt2p.getAttribute('#wacard .cobig[data-kind=' + k + '][data-co=' + co + ']', 'href')).split(/\?text=|[?&]body=/)[1] || '');
  ok(/opportunity with \*LINK Marketing\*/.test(await rtMsg('thinking', 'LINK')) && /opportunity with \*JUSS Marketing\*/.test(await rtMsg('thinking', 'JUSS')) && /\*Zara Iqbal\*, on behalf of JUSS/.test(await rtMsg('thinking', 'JUSS')),
    'Fiza: "speak soon" as LINK or JUSS buttons, signed by her');
  await api(admin, 'saveOutcome', { id: tia.id, outcome: 'No answer', outcome_notes: '' });
  ok((await api(admin, 'getCandidate', { id: tia.id })).callback_at === '', 'a different outcome clears the call-back time');
  await rt2p.reload(); await rt2p.waitForSelector('#wacard .cobig[data-kind=noanswer][data-co=JUSS]');
  const naL = await rtMsg('noanswer', 'LINK');
  ok(/in association with \*LINK Marketing\*/.test(naL) && /call or text me back on this number/.test(naL) && /\*Zara Iqbal\*, on behalf of LINK Marketing/.test(naL) && /in association with \*JUSS Marketing\*/.test(await rtMsg('noanswer', 'JUSS')),
    '"No answer": "we tried calling you, call or text me back on this number" as LINK or JUSS, signed by her');
  await rt2.close();
  // Day 1 date changed and the details sent straight away, before Google has answered: the link still carries the new date
  await api(admin, 'saveOutcome', { id: tia.id, outcome: 'Academy booked', academy_date: '2026-11-02', outcome_notes: '' });
  await ap.goto(APP + 'index.html?c=' + tia.id); await ap.waitForSelector('#wacard a[data-kind=offer]');
  ok(/[?&]d=2026-11-02/.test(decodeURIComponent(await ap.getAttribute('#wacard a[data-kind=offer]', 'href'))), 'booked for Mon 2 Nov: the Day 1 link says 2 Nov');
  await ap.route('**/api', route => new Promise(r => setTimeout(r, 6000)).then(() => route.continue()).catch(() => {}));  // Google slow
  await ap.fill('#adate', '2026-11-09'); await ap.click('#saveout');
  await ap.waitForFunction(() => /Day 1: Mon 9 Nov/.test(decodeURIComponent((document.querySelector('#wacard a[data-kind=offer]') || {}).href || '')));
  const d1Now = decodeURIComponent(await ap.getAttribute('#wacard a[data-kind=offer]', 'href'));
  ok(/[?&]d=2026-11-09/.test(d1Now) && !/d=2026-11-02/.test(d1Now) && /welcome-juss\.html/.test(d1Now),
    'moved to 9 Nov and sent straight away, Google still saving: the message AND its link both say 9 Nov (not the old 2 Nov)');
  await ap.unroute('**/api');
  ok(await pollFor(async () => (await api(admin, 'getCandidate', { id: tia.id })).academy_date === '2026-11-09'), 'and the new date reaches Google');

  // ── Stale: "No answer" / "Thinking it over" never just drop off Chase after 2 weeks ──
  await setTime('2026-10-27T10:00:00+00:00');  // Ali (in on Mon 12 Oct, "No answer") is now over 2 weeks old
  await api(admin, 'saveOutcome', { id: kid.id, outcome: 'Thinking it over', callback_at: '2026-10-29 18:00', outcome_notes: 'call me Thursday' });
  const st = (await api(admin, 'chaseList', {})).items, stOf = id => (st.find(c => c.id === id) || {}).leak;
  ok(stOf(ali.id) === 'stale' && stOf(kid.id) === 'callback',
    'over 2 weeks on "No answer": still on Chase as "🔴 Stale: close it out" (Ali); a call-back time still to come keeps them a call back (Young, Thu 18:00)');
  const kidC = st.find(c => c.id === kid.id), aliC = st.find(c => c.id === ali.id);
  ok(chaseWk(aliC) === '2026-10-18' && chaseWk(kidC) === '2026-11-01', 'week ending 1 Nov: Ali (week ending 18 Oct) is carried over; Young\'s call-back this Thursday makes them this week\'s');
  await ap.goto(APP + 'index.html?c=chase'); await ap.waitForSelector('[data-nudge]');
  // The phone shows its saved copy of Chase first, then the fresh one a moment later
  await ap.waitForFunction(() => /↩️ Carried over: Ali/.test(document.getElementById('page').innerText), null, { timeout: 10000 }).catch(() => {});
  ok(/↩️ Carried over: Ali/.test(await ap.innerText('#page')) && /This week · ending/i.test(await ap.innerText('.seg-nav')), 'admin Chase tab, this week: "↩️ Carried over: Ali" on Fiza\'s card');
  const carryN = st.filter(c => chaseWk(c) < '2026-11-01').length;
  ok(new RegExp('↩️ Carried over · ' + carryN).test(await ap.innerText('details.carry summary')) && !(await ap.$eval('details.carry', d => d.open)),
    'a folded "↩️ Carried over · ' + carryN + '" card for closing them out (folded for admins: each booker\'s card already says who)');
  await ap.click('details.carry summary');
  const aliClose = '.ccard:has(.item[data-id="' + ali.id + '"]) .qclose';
  await ap.waitForSelector(aliClose);
  await shot(ap, '45-chase-carried-over', true);
  ok(JSON.stringify(await ap.$$eval(aliClose + ' button', b => b.map(x => x.dataset.out))) === '["Academy booked","Declined","Not suitable","Thinking it over"]',
    'each carried-over person: ✅ Booked · Declined · Not suitable · 🔁 Call back');
  await ap.click(aliClose + ' [data-out="Declined"]'); await ap.waitForSelector('.sheet #sosave');
  ok(await ap.textContent('.sheet .chips[data-name=outcome] .chip.on') === 'Declined', 'tapping Declined opens the outcome sheet with Declined picked (Save confirms it)');
  await ap.click('#socancel');
  const stP0 = (await pushesTo(fiza.id)).length;
  await api(admin, 'chaseOutcomes', { ids: [fiza.id] });
  ok((await pushesTo(fiza.id)).slice(stP0).some(p => /🔴 Stale: close it out: Ali/.test(p.body.contents.en)), 'her nudge lists it too: "🔴 Stale: close it out: Ali"');
  const nextWk = await api(admin, 'chaseOutcomes', { ids: [fiza.id], week: '2026-11-08' });
  ok(!nextWk.nudged.length && !nextWk.recently.length, 'a nudge for a later week only covers that week (nothing booked for Fiza then: nobody nudged)');
  await api(admin, 'saveOutcome', { id: ali.id, outcome: 'Declined', outcome_notes: 'not for him' });
  ok(!(await api(admin, 'chaseList', {})).items.some(c => c.id === ali.id), 'log a final answer (Declined) → off Chase');

  // ── Walk out (Angad, 20 Oct): the presenter's fourth option. Non-qualifiers in the stats, rated or not ──
  console.log('walk out');
  const wally = await ci({ full_name: 'Wally Walker', mobile: '07700900881', email: 'wally@example.com', booker_id: fiza.id });
  const nadia = await ci({ full_name: 'Nadia Novisa', mobile: '07700900882', email: 'nadia@example.com', booker_id: fiza.id, rtw: 'Skilled Worker / Health & Care visa' });
  const rita = await ci({ full_name: 'Rita Rated', mobile: '07700900883', email: 'rita@example.com', booker_id: fiza.id });
  await api(nathan, 'saveNotes', { id: rita.id, rag: 'G', stars: 3, tags: [], notes: '' });
  const wo = await browser.newContext(PHONE), wop = await wo.newPage();
  await loginUi(wop, 'nathan@example.com');
  await wop.waitForSelector('.quick[data-for="' + wally.id + '"] .q-W');
  ok(JSON.stringify(await wop.$$eval('.quick[data-for="' + wally.id + '"] button', b => b.map(x => x.textContent.trim()))) === '["Green","Amber","Red","🚶 Walk out"]' &&
    await wop.$eval('.quick[data-for="' + wally.id + '"] .q-W', b => b.scrollWidth <= b.clientWidth + 1 && b.getBoundingClientRect().height < 44),
    'presenter\'s Today list: Green · Amber · Red · 🚶 Walk out on each person still to rate (on one line, fits a phone)');
  await shot(wop, '04b-presenter-walk-out');
  await wop.click('.quick[data-for="' + wally.id + '"] .q-W');
  await wop.waitForFunction(() => !JSON.parse(localStorage.getItem('lr_outbox') || '[]').length);
  const wNow = await api(admin, 'getCandidate', { id: wally.id });
  ok(wNow.rag === 'W' && wNow.in_room === 'TRUE' && !wNow.pay_reason && wNow.flags.some(f => f.level === 'red' && /Walked out of the presentation: no call, messages or BA Academy booking/.test(f.text)),
    'one tap "🚶 Walk out" → saved: came (in the room) and still counts for the incentive; red flag "Walked out of the presentation: no call, messages or BA Academy booking"');
  ok(!(await wop.$('.quick[data-for="' + nadia.id + '"]')) && /No rating needed/.test(await wop.innerText('.item[data-id="' + nadia.id + '"]')), 'Nadia (no right to work): no rating needed');
  await wop.click('.item[data-id="' + wally.id + '"]'); await wop.waitForSelector('#pres .rag');
  ok(await wop.$('#pres .rag button.W.on') && (await wop.$$('#pres .rag button')).length === 4, 'their page: the rating has Green / Amber / Red / 🚶 Walk out (Walk out on)');
  await wop.evaluate(() => document.querySelector('#pres .rag').scrollIntoView({ block: 'center' }));
  await wop.screenshot({ path: SHOTS + '/04c-rating-walk-out.png' });
  await wo.close();
  const chaseNow2 = (await api(admin, 'chaseList', {})).items;
  const fzPay = (await api(admin, 'payReport', {})).rows.find(r => r.booker_id === fiza.id);
  ok(!chaseNow2.some(c => c.id === wally.id || c.id === nadia.id) && !fzPay.excluded.some(x => x.id === wally.id) && fzPay.excluded.some(x => x.id === nadia.id && /Not eligible/.test(x.why)),
    'a walk out needs no call (not on Chase) but counts for Fiza\'s incentive (nobody\'s fault); the non-qualifier doesn\'t');
  // Their booker sees them, but can't reach them: no number, no call / WhatsApp / outcome, and the server refuses it too
  const refused = async (tok, a, x) => { try { await api(tok, a, x); return ''; } catch (e) { return e.message; } };
  const wFz = await api(fizaTok, 'getCandidate', { id: wally.id });
  ok(!wFz.mobile && !wFz.email && (await api(admin, 'getCandidate', { id: wally.id })).mobile === '07700900881', 'their booker (Fiza) gets no mobile or email for a walk out; admins still do');
  ok(/walked out/.test(await refused(fizaTok, 'saveOutcome', { id: wally.id, outcome: 'Academy booked', academy_date: '2026-11-02', outcome_notes: '' })) &&
    /walked out/.test(await refused(fizaTok, 'saveOutcome', { id: wally.id, outcome: 'Declined', outcome_notes: '' })) &&
    /walked out/.test(await refused(fizaTok, 'markSent', { id: wally.id, kind: 'noanswer', via: 'whatsapp' })) &&
    /walked out/.test(await refused(admin, 'saveOutcome', { id: wally.id, outcome: 'Academy booked', academy_date: '2026-11-02', outcome_notes: '' })),
    'a walk out can\'t be booked onto the BA Academy (not even by an admin), and their booker can\'t log an outcome or send a message');
  const wb = await browser.newContext(PHONE), wbp = await wb.newPage();
  // Fiza (test booker), signed in with her session (her code requests for the day are used up by now)
  await wbp.goto(APP + 'index.html'); await wbp.evaluate(t => localStorage.setItem('lr_tok', JSON.stringify(t)), fizaTok);
  await wbp.goto(APP + 'index.html?c=' + wally.id); await wbp.waitForSelector('.profile h1');
  const wbTxt = await wbp.innerText('#page');
  const wbHas = await wbp.evaluate(() => ['.profile .actions', '#saveout', '#wacard', 'a[href^="tel:"], a[href*="wa.me"], a[href^="sms:"]'].filter(s => document.querySelector(s)));
  ok(!wbHas.length && /Walked out of the presentation/.test(wbTxt) && /Not needed: they walked out/.test(wbTxt) && /Hidden: walked out/.test(wbTxt),
    'Fiza\'s phone: she sees Wally, "🚶 Walked out", but no Call / WhatsApp / Email, no outcome to log, no messages' + (wbHas.length ? ' (found: ' + wbHas.join(', ') + ')' : ''));
  await shot(wbp, '41-walk-out-booker', true);
  await wb.close();
  await api(admin, 'saveOutcome', { id: wally.id, outcome: 'Declined', outcome_notes: 'walked out' });
  ok((await api(admin, 'getCandidate', { id: wally.id })).outcome === 'Declined', 'an admin can still log a final answer (anything but booked)');
  await ap.goto(APP + 'index.html'); await ap.waitForSelector('.tabbar button[data-tab=all]');
  await ap.click('.tabbar button[data-tab=all]'); await ap.waitForSelector('#flt .chip[data-f=walk]');
  ok(/Walk outs 1/.test(await ap.textContent('#flt .chip[data-f=walk]')) && await ap.$('.ccard.walkout .item[data-id="' + wally.id + '"]') &&
    await ap.$eval('.ccard.walkout', e => getComputedStyle(e).backgroundColor) === 'rgb(253, 236, 236)' && await ap.$('.ccard.walkout .item[data-id="' + nadia.id + '"]') &&
    !(await ap.$('.ccard.walkout .item[data-id="' + rita.id + '"]')),
    'All tab: a "Walk outs" filter; the walk out and the non-qualifier stand out in light red (not Rita)');
  const wpd = await pdfDl(ap, '#weekPdf'), wpPath = `${SHOTS}/42-week-walk-out.pdf`; await wpd.saveAs(wpPath);
  const wpRaw = fs.readFileSync(wpPath, 'latin1');
  ok(/\(Walk out: do not book/.test(wpRaw) && (wpRaw.match(/0\.99 0\.88 0\.88 rg/g) || []).length === 2 && /1 walk out/.test(wpRaw),
    'the week\'s Appointments PDF: the whole row in light red for the walk out ("Walk out: do not book") and the non-qualifier; "1 walk out" in the day\'s line');
  try { require('child_process').execFileSync('pdftoppm', ['-png', '-r', '70', '-singlefile', wpPath, `${SHOTS}/42-week-walk-out`]); } catch (e) { /* no renderer here */ }
  // The poster: Nadia (not eligible, never rated: the team spoke to her) now counts as attended and as a non-qualifier
  await ap.click('.tabbar button[data-tab=today]'); await ap.waitForSelector('#bullDaily');
  await ap.click('#bullDaily'); await ap.waitForSelector('#bimg[data-info]', { timeout: 15000 });
  const tueAll = (await api(admin, 'listWeek', {})).items.filter(c => c.attended_date === '2026-10-27');
  const tueCnt = tueAll.filter(c => c.in_room === 'TRUE' || c.non_qual);
  const bw = await bInfo();
  ok(tueCnt.some(c => c.id === nadia.id && c.in_room !== 'TRUE') && tueCnt.some(c => c.id === wally.id && !c.pay_reason) && bw.attended === tueCnt.length &&
    bw.nonQual === tueCnt.filter(c => c.pay_reason).length && bw.nonQual >= 1 && !/not rated by the presenter/.test(await ap.innerText('#page')) && bw.walkOuts === 1,
    'daily stats poster: the unrated non-qualifier (Nadia) is in "attended" (' + bw.attended + ', with the walk out) and "non qualifiers" (' + bw.nonQual + '), and isn\'t "not rated"; then "🚶 WALK OUTS ' + bw.walkOuts + '"');
  await saveImg('15c-bulletin-walk-outs.jpg');
  // The Appointments total grid: the same, and what the non qualifiers are
  await ap.goto(APP + 'index.html'); await ap.waitForSelector('.tabbar button[data-tab=pay]');
  await ap.click('.tabbar button[data-tab=pay]'); await ap.waitForSelector('#payPdf');
  const gd = await pdfDl(ap, '#payPdf'), gPath = `${SHOTS}/14e-grid-walkout.pdf`; await gd.saveAs(gPath);
  const gRaw = fs.readFileSync(gPath, 'latin1');
  const wkAtt = (await api(admin, 'listWeek', {})).items.filter(c => (c.in_room === 'TRUE' || c.non_qual) && !['0', '6'].includes(String(new Date(c.attended_date + 'T00:00:00Z').getUTCDay())));
  ok(new RegExp('BT /F2 12 Tf [\\d.]+ [\\d.]+ Td \\(' + wkAtt.length + '\\) Tj').test(gRaw) && new RegExp('0\\.83 0\\.18 0\\.16 rg BT /F2 12 Tf [\\d.]+ [\\d.]+ Td \\(' + wkAtt.filter(c => c.pay_reason).length + '\\) Tj').test(gRaw) &&
    /\(Non qualifiers: 1 not eligible\.\) Tj/.test(gRaw) && /\(WALK\) Tj/.test(gRaw) && /\(OUTS\) Tj/.test(gRaw) &&
    (gRaw.match(/0\.83 0\.18 0\.16 rg BT \/F2 12 Tf [\d.]+ [\d.]+ Td \(1\) Tj/g) || []).length === 2,
    'Appointments total PDF: ' + wkAtt.length + ' attended (Nadia and the walk out included), ' + wkAtt.filter(c => c.pay_reason).length + ' non qualifier in red, then a WALK OUTS column (1), and under the grid "Non qualifiers: 1 not eligible."');
  try { require('child_process').execFileSync('pdftoppm', ['-png', '-r', '70', '-singlefile', gPath, `${SHOTS}/14e-grid-walkout`]); } catch (e) { /* no renderer here */ }

  // ── Day 1 tab, week by week (Angad, 20 Oct: "week ending wise similar to All tab") ──
  const d1Week = await api(admin, 'academyList', { weekEnding: '2026-10-25' });
  ok(d1Week.weekEnding === '2026-10-25' && d1Week.items.length && d1Week.items.every(c => c.academy_date >= '2026-10-19' && c.academy_date <= '2026-10-25') && d1Week.items.some(c => c.id === jasId) && !d1Week.pending,
    'server: one week of Day 1 starters when asked (w/e 25 Oct: ' + d1Week.items.map(c => c.first_name).join(', ') + ')');
  await api(admin, 'markDay1', { id: adham.id, status: 'no_show' });
  await ap.goto(APP + 'index.html?c=academy'); await ap.waitForSelector('.d1nav');
  const behindTxt = await ap.innerText('.d1behind');
  ok(/Still to sort from an earlier week · \d+/.test(behindTxt) && /Adham · no-show/.test(behindTxt) && !/Last week/.test(await ap.innerText('.d1nav')),
    'Tuesday after: the tab has moved on from last week; a no-show from an earlier week stays in sight: "' + behindTxt.split('\n')[0] + ' … Adham · no-show"');
  await shot(ap, '27b-day1-week-ahead', true);
  await ap.click('.d1behind .nm:has-text("Adham")');
  await ap.waitForFunction(() => /Last week · ending/i.test(document.querySelector('.d1nav').innerText));
  ok(/25 Oct/.test(await ap.innerText('.d1nav')) && /Monday 19 October/i.test(await ap.innerText('#page')) && await ap.$('.trow[data-cand="' + adham.id + '"] .quick [data-out]'),
    'tap Adham → that week (Last week · ending Sun 25 Oct) with his Rebook buttons');
  await ap.click('#d1prev');
  await ap.waitForFunction(() => /Week ending/i.test(document.querySelector('.d1nav').innerText) && !document.querySelector('#page .item.sk'));
  ok(/18 Oct/.test(await ap.innerText('.d1nav')) && !(await ap.$('.trow[data-cand="' + adham.id + '"]')), '‹ goes back a week (Week ending Sun 18 Oct, fetched on its own)');
  await ap.click('#d1next'); await ap.click('#d1next'); await ap.click('#d1next');
  await ap.waitForFunction(() => !/Last week/i.test(document.querySelector('.d1nav').innerText));
  ok(/Next week · ending/i.test(await ap.innerText('.d1nav')) || /Week ending/i.test(await ap.innerText('.d1nav')), '› goes forward again');
  await api(admin, 'markDay1', { id: adham.id, status: 'arrived' });

  // ── One login for every LINK × JUSS app (link-juss.vercel.app): Supabase only, hidden until Angad launches it ──
  const hubOff = await post('/api', { action: 'loginInfo' });
  ok(hubOff.ok && hubOff.data.hub === '', 'one login: hidden until launch (no "Sign in with your work email" button)');
  if (process.env.JL_BACKEND === 'pg') {
    const hubCore = require('../../hub/lib/core.js');
    const hq = async (text, params) => (await post('/dev/sql', { sql: text, params: params || [] })).rows;
    const person = async email => (await hq('insert into core.people (email) values ($1) on conflict (email) do update set email = excluded.email returning id::text as id, email', [email]))[0];
    // A ticket made by hand, skipping the hub's own checks (to prove the app checks too)
    const rawTicket = async (email, app, secs) => {
      const code = require('crypto').randomBytes(24).toString('base64url'), p = await person(email);
      await hq('insert into core.handoffs (code_hash, person_id, app, expires_at) values ($1, $2::uuid, $3, now() + make_interval(secs => $4::int))', [hubCore.sha(code), p.id, app, secs || 120]);
      return code;
    };
    const hubIn = ticket => post('/api', { action: 'hubLogin', ticket });
    const t1 = await hubCore.createHandoff(hq, await person('angad@linkmarketing.org.uk'), 'recruit');
    const h1 = await hubIn(t1);
    ok(h1.ok && h1.data.user.email === 'angad@linkmarketing.org.uk' && (await api(h1.data.token, 'me')).user.email === 'angad@linkmarketing.org.uk',
      'one login: a ticket from the hub signs Angad straight in (the same session a login code gives)');
    ok(/expired/.test((await hubIn(t1)).error), 'a ticket works once');
    ok(/expired/.test((await hubIn(await rawTicket('angad@linkmarketing.org.uk', 'fr'))).error), 'a ticket for another app (FR Playbook) doesn\'t open Recruitment');
    ok(/expired/.test((await hubIn(await rawTicket('angad@linkmarketing.org.uk', 'recruit', -60))).error), 'an old ticket (over 2 minutes) doesn\'t work');
    ok(/expired/.test((await hubIn('made-up')).error) && (await hubIn('')).ok === false, 'a made-up ticket doesn\'t work');
    await hq("insert into public.users (username, password, display_name) values ('zz.starter@example.com', 'x', 'Zz Starter')");
    ok(await hubCore.createHandoff(hq, await person('zz.starter@example.com'), 'recruit') === null && /expired/.test((await hubIn(await rawTicket('zz.starter@example.com', 'recruit'))).error),
      'new starters never get into Recruitment through the hub: only people active in Users (admins add them)');
    const hubLog = async () => (await getJson('/dev/sheet?name=Log')).filter(r => r[2] === 'hub_login').map(r => r[4]);
    ok((await hubLog()).join() === 'angad@linkmarketing.org.uk', 'each hub sign-in is in the Log');

    // Launch: the button appears, the welcome email's playbook link goes through the hub, the playbook opens by itself
    await post('/dev/props', { HUB_SIGNIN: '1' });
    const HUB_RECRUIT = 'https://link-juss.vercel.app/?app=recruit&r=%2F';
    ok((await post('/api', { action: 'loginInfo' })).data.hub === HUB_RECRUIT, 'launched: the login screen gets the hub link');
    const hc = await browser.newContext(PHONE), hp = await hc.newPage();
    await hp.goto(APP + 'index.html'); await hp.waitForSelector('#hubIn:not([hidden]) #hubGo');
    ok(await hp.getAttribute('#hubGo', 'href') === HUB_RECRUIT && await hp.$('#go'), 'login screen: "Sign in with your work email" (to the hub), with the 6-digit code login still underneath');
    await shot(hp, '60-login-hub');
    await hp.goto('about:blank');  // coming from the hub (another site) is always a fresh page load
    await hp.goto(APP + 'index.html#hub='+ encodeURIComponent(await hubCore.createHandoff(hq, await person('jess@linkmarketing.org.uk'), 'recruit')) + '&r=%2F');
    await hp.waitForSelector('.tabbar button');
    ok(!/hub=/.test(hp.url()) && (await hubLog()).pop() === 'jess@linkmarketing.org.uk',
      'arriving from the hub: signed in as Jess straight away, and the ticket is wiped from the address bar');
    await hp.reload(); await hp.waitForSelector('.tabbar button');
    ok(true, 'and she stays signed in (reopening the app doesn\'t ask again)');
    await hc.close();

    const welcome = async (id, to) => {
      const mb = (await getJson('/dev/mail')).length;
      await api(admin, 'onboardSend', { id });
      return (await getJson('/dev/mail')).slice(mb).find(m => m.to === to);
    };
    const adWm = await welcome(adham.id, 'adham@example.com');
    const adHf = await hq('select username, password_hash, full_name, start_date, role from hf.users where username = $1', ['adham@example.com']);
    const adNow2 = await api(admin, 'getCandidate', { id: adham.id });
    ok(adHf.length === 1 && adHf[0].full_name === 'Adham Soliman' && adHf[0].password_hash === '!hub-login-only' && adHf[0].start_date === adNow2.academy_date && adHf[0].role === 'rep',
      'onboarded (JUSS) → his HelloFresh Playbook opens by itself: email sign-in only, no password anyone could guess');
    ok(adWm && /https:\/\/link-juss\.vercel\.app\/\?app=hf&r=%2F/.test(adWm.body) && /href="https:\/\/link-juss\.vercel\.app\/\?app=hf&amp;r=%2F"|href="https:\/\/link-juss\.vercel\.app\/\?app=hf&r=%2F"/.test(adWm.htmlBody || ''),
      'his welcome email\'s playbook button goes through the hub (JUSS look, HelloFresh Playbook)');
    const jasWm = await welcome(jasId, 'jasraj@example.com');
    const jasFr = await hq('select username, password, display_name from public.users where username = $1', ['jasraj@example.com']);
    ok(jasFr.length === 1 && jasFr[0].display_name === 'Jasraj Bhuller' && jasFr[0].password === '!hub-login-only' && jasWm && /link-juss\.vercel\.app\/\?app=fr&r=%2F/.test(jasWm.body),
      'onboarded (LINK) → his FR Playbook opens, and the email links to it through the hub (LINK look)');
    const acc = await hubCore.accounts(hq, 'jasraj@example.com');
    ok(acc.fr && !acc.recruit && !acc.hf && await hubCore.createHandoff(hq, await person('jasraj@example.com'), 'recruit') === null,
      'a new starter gets their own company\'s playbook only: never Recruitment, never the other company\'s');
    await welcome(jasId, 'jasraj@example.com');
    ok((await hq('select count(*)::int as n from public.users where username = $1', ['jasraj@example.com']))[0].n === 1, 'sending the email again never makes a second account (or touches the one there)');
    const unl = (await getJson('/dev/sheet?name=Log')).filter(r => r[2] === 'playbook_unlocked').map(r => r[4]);
    ok(unl.includes('hf opened') && unl.includes('fr opened') && unl.includes('fr already open'), 'the Log says which playbook opened for whom');
    await post('/dev/props', { HUB_SIGNIN: '' });
  } else {
    ok(/isn't available here/.test((await post('/api', { action: 'hubLogin', ticket: 'x' })).error), 'one login: Supabase only (on Google the code login carries on)');
    await post('/dev/props', { HUB_SIGNIN: '1' });
    ok((await post('/api', { action: 'loginInfo' })).data.hub === '', 'even switched on, Google never shows the hub button');
    await post('/dev/props', { HUB_SIGNIN: '' });
  }

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

  // GDPR, as the check-in page says: full details 12 weeks → only the basics → deleted after 6 months
  await setTime('2027-01-20T03:00:00+00:00');  // ~14 weeks after the Monday check-ins
  await post('/dev/run', { fn: 'dailyMaintenance' });
  const tsheet = await getJson('/dev/sheet?name=Candidates'), th = tsheet[0];
  const trow = tsheet.find(r => r[th.indexOf('full_name')] === 'Jasraj Bhuller');
  const trimmed = trow && Object.fromEntries(th.map((k, i) => [k, trow[i] === undefined ? '' : trow[i]]));
  ok(trimmed && trimmed.full_name === 'Jasraj Bhuller' && trimmed.mobile === '07700900123' && trimmed.outcome && !trimmed.q1_excitement && !trimmed.notes && !trimmed.q13_unspent && !trimmed.p_interesting,
    'after 12 weeks: name, mobile and outcome kept; evaluation answers, convictions answer and presenter notes wiped');
  const adRow = tsheet.find(r => r[th.indexOf('full_name')] === 'Adham Soliman'), adOl = JSON.parse(adRow[th.indexOf('outcome_log')] || '[]');
  ok(adOl.length === 3 && adOl.every(e => e.at && e.by && e.o && !e.n) && !/missed the train/.test(adRow.join('|')), 'call log after 12 weeks: who, when and outcome kept; the call notes wiped with the rest');
  await setTime('2027-10-25T03:00:00+01:00');
  await post('/dev/run', { fn: 'dailyMaintenance' });
  ok((await getJson('/dev/sheet?name=Candidates')).length === 1, 'records older than 6 months deleted automatically');
  ok(!(await getJson('/dev/sheet?name=Log')).slice(1).some(r => /2026/.test(String(r[0]))), 'Log entries older than 6 months deleted too, including ones whose times the Sheet turned into dates');

  // ── 11. Moving to Supabase: Google's email relay, handover and switch (Google only; switched off on Supabase) ──
  const relay = (action, extra) => post('/api', Object.assign({ action }, extra || {}));
  ok((await relay('relayInfo')).ok === false && (await relay('relayInfo', { secret: 'guess' })).error === 'Not allowed', 'relay: refused without the secret');
  const RS = 'relay-test-secret-0123456789abcdefghij';  // the test key; Code.gs only ever holds its SHA-256
  await post('/dev/props', { RELAY_SECRET_SHA256: require('crypto').createHash('sha256').update(RS).digest('hex') });
  ok((await relay('relayInfo', { secret: RS.slice(0, -1) + 'X' })).error === 'Not allowed', 'relay: a wrong key is refused');
  if (process.env.JL_BACKEND === 'pg') {
    ok((await relay('relayInfo', { secret: RS })).error === 'Not allowed', 'relay: switched off on the Supabase back end, even with the key');
  } else {
    const ri = await relay('relayInfo', { secret: RS, withKeys: true });
    ok(ri.ok && ri.data.owner === 'angad@linkmarketing.org.uk' && ri.data.timers.includes('keepWarm') && !ri.data.frozen && !ri.data.movedTo && ri.data.onesignalKey === 'test-key',
      'relay: Google reports its owner, timers and switch state, and hands Vercel the phone-alert key (nobody copies it)');
    const mb = (await getJson('/dev/mail')).length;
    await relay('relayMail', { secret: RS, mail: { via: 'gmail', to: 'x@example.com', subject: 'Relayed', body: 'hi', opts: { from: 'jess@linkmarketing.org.uk', name: 'Jess Grace | Link Marketing' } } });
    const rm = (await getJson('/dev/mail')).slice(mb)[0];
    ok(rm && rm.to === 'x@example.com' && rm.via === 'gmail' && rm.from === 'jess@linkmarketing.org.uk', 'relay: Vercel\'s emails go out from Gmail, "send mail as" Jess / Rubal / Fiza as before');
    const ex = (await relay('relayExport', { secret: RS })).data;
    ok(ex.tabs.Candidates.headers.includes('full_name') && ex.tabs.Users.rows.length >= 4 && !('RELAY_SECRET_SHA256' in ex.props) && !('ONESIGNAL_API_KEY' in ex.props),
      'handover: every tab as text plus the settings, never the secret ones');
    await relay('relayFreeze', { secret: RS, on: true });
    const fr = await post('/api', { action: 'publicConfig' });
    ok(fr.ok === false && fr.retry === true, 'switch day: while the data is copied, saves wait ("Trying again…") and phones retry by themselves');
    await relay('relayFreeze', { secret: RS, on: false });
    ok((await post('/api', { action: 'publicConfig' })).ok === true, 'unfrozen: back to normal');
    ok((await relay('relaySwitch', { secret: RS, to: '' })).data.movedTo === '' &&
      JSON.parse((await post('/dev/eval', { js: 'JSON.stringify(ScriptApp.getProjectTriggers().map(t => t.fn))' })).out).includes('keepWarm'), 'undo the switch: Google\'s timers come back');
  }

  await browser.close();
  console.log('\nALL CHECKS PASSED');
  process.exit(0);
})().catch(e => { console.error('\nFAILED:', e); process.exit(1); });
