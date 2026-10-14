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
const setTime = iso => post('/dev/time', { iso });
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
  // Not their candidate (Fiza booked Jasraj): the presenter sees the room rating, nothing else
  const lockedTxt = await pp.innerText('#page');
  ok(/Not your candidate/.test(lockedTxt) && !/07700|jasraj@example|Fiza|Call outcome|Graduate visa/.test(lockedTxt) && !(await pp.$('a[href^="tel:"]')) && !(await pp.$('a[data-kind]')) && !(await pp.$('#jump')),
    'presenter on someone else\'s candidate: rating + notes only (no phone, email, booker, right to work, evaluation, outcome or WhatsApp)');
  const nathView = await api(nathan, 'getCandidate', { id: jasId });
  ok(nathView.limited && !nathView.mobile && !nathView.email && !nathView.booker_name && !nathView.rtw && !nathView.q2_stood_out && !nathView.outcome && nathView.notes && nathView.rag === 'G',
    'server: a presenter gets only the room fields for someone else\'s candidate (the app can\'t show what it never receives)');
  const nope = await post('/api', { action: 'markSent', token: nathan, id: jasId, kind: 'offer' });
  ok(!nope.ok && /No access/.test(nope.error), 'server: nobody can send or log messages for someone else\'s candidate');
  // One tap on the Today list: Green / Amber / Red = in the room, and notes another presenter just wrote are kept
  await api(nathan, 'saveNotes', { id: ishita.id, rag: '', stars: 0, tags: ['Quiet'], notes: 'Sat at the back' });
  await pp.goBack(); await pp.waitForSelector('.kpis');
  await pp.click('.quick[data-for="' + ishita.id + '"] .q-R');
  await pp.waitForFunction(() => !JSON.parse(localStorage.getItem('lr_outbox') || '[]').length);
  const ishNow = await api(admin, 'getCandidate', { id: ishita.id });
  ok(ishNow.rag === 'R' && ishNow.in_room === 'TRUE' && ishNow.notes === 'Sat at the back' && ishNow.tags === 'Quiet', 'presenter taps Red on the list → in the room; notes + tags already written are kept');
  ok(!(await pp.$('.quick[data-for="' + ishita.id + '"]')), 'rated card drops its Green / Amber / Red buttons');
  // After the presentation: only Jess / Rubal (and admins) see the thank-you list
  ok(!(await pp.$('#thanksAll')) && /name and room rating only/.test(await pp.innerText('#page')) && !(await pp.$('.act.call')),
    'presenter\'s Today: no thank-you list, no call / WhatsApp on anyone else\'s card, "🔒 name and room rating only"');
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
  const jessJuss = decodeURIComponent((await jsp.getAttribute('[data-thanks="' + adham.id + '"]', 'href')).split('?text=')[1]);
  ok(/in association with \*JUSS Marketing\*/.test(jessJuss) && /jmomagazine/.test(jessJuss) && /\*Jess Grace\*, on behalf of JUSS Marketing recruitment team 🧡💙$/.test(jessJuss),
    'Jess sending a JUSS thank-you: JUSS wording + magazine, signed "*Jess Grace*, on behalf of JUSS Marketing recruitment team"');
  // Non-qualifiers get an honest version: why we can't take them on, no "by Friday" promise, door left open
  const tmsg = async c => decodeURIComponent((await jsp.getAttribute('[data-thanks="' + c.id + '"]', 'href')).split('?text=')[1]);
  const ishMsg = await tmsg(ishita), kidMsg = await tmsg(kid);
  fs.writeFileSync(`${SHOTS}/msg-thanks-nonqual-visa.txt`, ishMsg); fs.writeFileSync(`${SHOTS}/msg-thanks-nonqual-under18.txt`, kidMsg);
  ok(/^Hey Ishita! 👋🧡/.test(ishMsg) && /\*self-employed\*, and your current visa or status doesn't allow self-employed work/.test(ishMsg) && /🔁 \*If your status changes\*, message us here/.test(ishMsg) &&
    !/Friday|next steps/.test(ishMsg) && /\*Jess Grace\*, on behalf of LINK Marketing recruitment team 🧡$/.test(ishMsg), 'Tier 4 thank-you: honest "visa or status doesn\'t allow self-employed work", no Friday promise, signed Jess');
  ok(/\*18 or over\*, so we can't take you on just yet/.test(kidMsg) && /🔁 \*When you turn 18\*, message us here and we'll book you straight back in/.test(kidMsg) && !/Friday/.test(kidMsg), 'under-18 thank-you: "18 or over… When you turn 18, message us"');
  ok(/⛔ Non-qualifier message/.test(await jsp.innerText('.sheet .trow:has-text("Ishita")')) && !/Non-qualifier/.test(await jsp.innerText('.sheet .trow:has-text("Jasraj")')), 'Jess\'s list marks which ones get the non-qualifier message');
  const thanks = decodeURIComponent((await jsp.getAttribute('[data-thanks="' + jasId + '"]', 'href')).split('?text=')[1]);
  fs.writeFileSync(`${SHOTS}/msg-thanks.txt`, thanks);
  ok(thanks === "Hey Jasraj! 👋🧡\n\nThanks for coming through for your *Appointment Presentation* today in association with *LINK Marketing* 🙌\nWe loved meeting you in person.\n\n📲 *What happens next*\nOur Team will contact you at the latest by *close of business on Friday 6PM* about your next steps.\nKeep your phone close! 👀\n\n📖 *While you wait*, flick through the *LINK Organisation Magazine 2026* 👇\nhttps://linkmagflip-74ibv4pf.manus.space\n\n*Jess Grace*, on behalf of LINK Marketing recruitment team 🧡",
    'thank-you WhatsApp = Angad\'s wording, laid out to scan (LINK, contact by Friday 6PM) + the LINK magazine, signed Jess Grace for the LINK recruitment team');
  await jsp.$eval('[data-thanks="' + ishita.id + '"]', a => { a.addEventListener('click', e => e.preventDefault()); a.click(); });
  await jsp.waitForSelector('.sheet .trow:has-text("Ishita") .pill.green');
  let ishNow2 = null; for (let i = 0; i < 20 && !(ishNow2 && ishNow2.thanks_sent_at); i++) { ishNow2 = await api(admin, 'getCandidate', { id: ishita.id }); if (!ishNow2.thanks_sent_at) await new Promise(r => setTimeout(r, 200)); }
  ok(!!ishNow2.thanks_sent_at && ishNow2.thanks_by === 'Jess Grace', 'Jess taps 💬 Send → WhatsApp opens, the row turns "✓ Sent" and it\'s saved as sent by Jess Grace');
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
  await cp.locator('.qcard[data-k=q9_results_paid]').screenshot({ path: SHOTS + '/05b-q9-one-question.png' });
  const nums = await cp.$$eval('.qcard .qn', e => e.map(x => x.textContent));
  ok(nums.join() === '01,02,03,04,05,06,07,08,09,10,11,12,13,14' && await cp.textContent('.qcard[data-k=q10_door] .qn') === '10',
    'questions are numbered 1–14 with no extra numbers for follow-ups ("A door gets shut…" is 10)');
  await fillEval(cp);
  ok(await cp.$('.qcard[data-k=q4_situation] .qsub .chips[data-name=q4_looking_for]') && await cp.$('.qcard[data-k=q12_bdp_stage] .qsub [name=q12_bdp_why]'),
    '"How long looking for work?" sits inside Q4 and "What would your own business mean?" inside Q12');
  ok(/All done/.test(await cp.innerText('#evcount')), 'progress bar fills as they answer → "All done. Hit submit 🚀"');
  await shot(cp, '05-evaluation', true);
  await cp.click('#go');
  await cp.waitForSelector('text=Thank you, Jasraj!');
  ok(/by close of business on Friday 6PM/.test(await cp.innerText('body')), 'after the evaluation: "Thank you, Jasraj!" + contact by Friday 6PM');
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
  ok((await p2e.$$('.chips[data-name=q3_reason] .chip.on')).length === 1, 'made a mistake → "Change my answers" opens the form with their answers filled in');
  await p2e.fill('textarea[name=q14_questions]', 'Changed my mind: when is Day 1?');
  await post('/dev/eval', { js: 'globalThis.__lockBusy = 2' });  // Google busy: 2 people ahead in the queue
  const tEdit = Date.now();
  await p2e.click('#go');
  await p2e.waitForSelector('text=Updated, Jasraj!', { timeout: 30000 });

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
  const hdr = (await getJson('/dev/sheet?name=Candidates'))[0];
  ok(hdr.slice(-5).join() === 'recruit_source,databyte_at,databyte_by,onboard_email_at,onboard_email_by', 'existing Sheet got the new columns automatically (no data moved)');
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
  ok(/📵 No answer · 1/i.test(await bp.innerText('body')) && /^Hey Young! 👋/.test(na) && /in association with \*LINK Marketing\*/.test(na) && /We tried calling you/.test(na) && /\*call or text back\*/.test(na) && /\*Fiza Iqbal\*, on behalf of LINK Marketing recruitment team 🧡$/.test(na),
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
  ok(!(await ap.$('a.wa[data-kind=thanks]')) && /Thank-you not sent yet · Rubal Oshan sends it/.test(await ap.innerText('body')), 'admin (Angad) can see Adham\'s JUSS thank-you isn\'t sent yet, and that Rubal sends it');
  const rubCtx = await browser.newContext(PHONE);
  const rbp = await rubCtx.newPage();
  await loginUi(rbp, 'rubal@jussmarketing.co.uk', APP + 'index.html?c=' + adham.id);
  await rbp.waitForSelector('a.wa[data-kind=thanks]');
  const jthanks = decodeURIComponent((await rbp.getAttribute('a.wa[data-kind=thanks]', 'href')).split('?text=')[1]);
  const jasT = await api(admin, 'getCandidate', { id: (await api(admin, 'search', { q: 'Jasraj' })).items[0].id });
  await rbp.goto(APP + 'index.html?c=' + jasT.id); await rbp.waitForSelector('a.wa[data-kind=thanks]');
  const rubLink = decodeURIComponent((await rbp.getAttribute('a.wa[data-kind=thanks]', 'href')).split('?text=')[1]);
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
  ok(await jp.$eval('.wl-poster img', i => i.complete && i.naturalWidth > 0 && /poster-juss/.test(i.src)), 'JUSS welcome page shows the JUSS Week 1 poster (your screenshot)');
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

  // ── Chase tab: everyone who could drop out of the pipeline, one tap nudges every booker (no copy-pasting from the sheet) ──
  const BL = ['log', 'callback', 'text', 'confirm', 'noshow'];
  const pipe = (await api(admin, 'chaseList', {})).items;
  const toChase = [...new Set(pipe.filter(c => c.booker_id && BL.includes(c.leak)).map(c => c.booker_id))];
  const fizaLog = pipe.filter(c => c.booker_id === fiza.id && c.leak === 'log').map(c => c.first_name);
  ok(toChase.includes(fiza.id) && fizaLog.length > 0 && !pipe.some(c => c.id === ishita.id) && pipe.some(c => c.leak === 'callback' && c.outcome === 'No answer'),
    'Friday 15:00: ' + pipe.length + ' at risk across ' + toChase.length + ' bookers: ' + pipe.map(c => c.first_name + ' (' + c.leak + ')').join(', ') + '. "No answer" stays on until it\'s resolved; rejected Ishita isn\'t chased');
  await ap.goto(APP + 'index.html?c=chase');
  await ap.waitForSelector('#nudgeAll');
  ok(await ap.textContent('#abTitle') === 'Chase' && await ap.$('.tabbar button.on[data-tab=chase]') &&
    JSON.stringify(await ap.$$eval('.tabbar button', b => b.map(x => x.dataset.tab))) === '["today","chase","academy","all","pay","team"]',
    'admin tab bar: Today · Chase · Day 1 · All · Incentive · Team, and the alert lands on Chase');
  ok(await ap.textContent('.tabbar button[data-tab=chase] .tbadge') === String(pipe.length) && new RegExp('^' + pipe.length + ' (person|people) to chase').test(await ap.innerText('.card .display')),
    'the Chase tab shows how many are at risk: ' + pipe.length + ' (badge and headline agree)');
  ok((await ap.$$('[data-nudge]')).length === toChase.length && new RegExp('across ' + toChase.length + ' bookers?').test(await ap.innerText('#page')),
    'one card per booker with someone to chase (' + toChase.length + ')');
  const fizaRow = await ap.$eval('[data-nudge="' + fiza.id + '"]', b => b.closest('.trow').innerText);
  ok(fizaLog.every(n => new RegExp('Log the call: .*' + n).test(fizaRow)), 'each card says exactly who: "' + fizaRow.replace(/\n/g, ' | ') + '"');
  ok(!(await ap.$('.card.needs')), 'no "Needs you" box when the admins have nothing outstanding themselves');
  const grp = decodeURIComponent((await ap.getAttribute('#waGroup', 'href')).replace('https://wa.me/?text=', ''));
  ok(/^⏰ \*Pipeline check: don't lose anyone\*/.test(grp) && /Outcomes due Fri 18:00/.test(grp) && new RegExp('\\*Fiza\\*\\n📞 Log the call: ' + fizaLog[0]).test(grp) && /Sort them now 👉 http/.test(grp),
    "Post to team WhatsApp: the whole list by booker in one message, ready for the bookers' group");
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
    cFiza && /^⏰ Angad: \d+ (person|people) to chase$/.test(cFiza.body.headings.en) && new RegExp('📞 Log the call: ' + fizaLog[0] + '.*\\(by Fri 18:00\\)').test(cFiza.body.contents.en) && /\?c=chase$/.test(cFiza.body.web_url),
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
  ok(fizaPipe.length && fizaPipe.every(c => c.booker_id === fiza.id && BL.includes(c.leak)), 'a booker\'s Chase list is their own people only');
  ok(await fcp.$('.tabbar button.on[data-tab=chase]') && JSON.stringify(await fcp.$$eval('.tabbar button', b => b.map(x => x.dataset.tab))) === '["mine","chase","pay"]' &&
    new RegExp('^' + fizaPipe.length + ' to chase').test(await fcp.innerText('.card .display')) && await fcp.textContent('.tabbar button[data-tab=chase] .tbadge') === String(fizaPipe.length),
    'Fiza taps it → her Chase tab: "' + fizaPipe.length + ' to chase" (tabs: Mine · Chase · Incentive)');
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
  ok(await ap.$eval('.tabbar button[data-tab=pay]', b => b.textContent.trim()) === 'Incentive' && await ap.textContent('#abTitle') === 'Recruitment incentive' &&
    !/\bpay\b/i.test(await ap.$eval('#page', e => e.innerText)), 'says "Recruitment incentive" (tab: Incentive), never "Pay"');
  ok(!pay.rows.some(r => /Angad|Jess|Satpal|Rubal/.test(r.name)) && !(await ap.$$eval('.payrow .name', e => e.map(x => x.textContent))).some(n => /Angad|Jess|Satpal|Rubal/.test(n)),
    'incentive board: bookers only, no admins on it');

  // ── Bulletins: one tap for admins, same numbers as Pay ──
  await ap.click('.tabbar button[data-tab=today]'); await ap.waitForSelector('#bullDaily');
  for (let i = 0; i < 6; i++) await ap.click('#dprev');
  await ap.click('#bullDaily');
  await ap.waitForSelector('#bimg[data-info]', { timeout: 15000 });
  const bInfo = async () => JSON.parse(await ap.getAttribute('#bimg', 'data-info'));
  const monday = (await api(admin, 'listWeek', { weekEnding: '2026-10-18' })).items.filter(c => c.attended_date === '2026-10-12' && (c.in_room === true || c.in_room === 'TRUE'));
  let bi = await bInfo();
  ok(bi.kind === 'daily' && bi.attended === monday.length && bi.nonQual === monday.filter(c => c.pay_reason).length && bi.nonQual > 0,
    'daily bulletin: ' + bi.attended + ' attended, ' + bi.nonQual + ' non-qualifiers (rated only, same rules as the incentive)');
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
  ok(await ap.textContent('#abTitle') === 'Day 1' && await ap.$('.tabbar button.on[data-tab=academy]') && /Monday 19 October · TOMORROW/i.test(d1Txt) && new RegExp(monStarters.length + ' expected · ' + nConf + ' confirmed').test(d1Txt),
    'tapping it opens the Day 1 tab: "Monday 19 October · TOMORROW · ' + monStarters.length + ' expected · ' + nConf + ' confirmed"');
  const remind = decodeURIComponent((await ap.$eval('.trow[data-cand="' + jasId + '"] a.btn', a => a.href)).split('?text=')[1]);
  ok(/^Hi Jasraj,\n\nHope you are well\.\n\nJust a quick reminder that you’re due to start your training tomorrow, Monday 19th October at 1:30 PM 🕜/.test(remind) &&
    /https:\/\/maps\.app\.goo\.gl\/f4pkh222EHHTyQSM9/.test(remind) && /Kind Regards\nAngad Oshan\nIn Association with Juss Marketing and Link Marketing$/.test(remind),
    '💬 Remind: Jess / Rubal\'s wording, "…due to start your training tomorrow, Monday 19th October at 1:30 PM", LINK Maps pin, signed by the sender');
  ok(!(await ap.$('[data-d1]')), 'no Arrived / No-show buttons before Day 1');
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
    /fieldiqdownload/.test(prevHtml) && /Hello Fresh/.test(prevHtml) && /077823 77774/.test(prevHtml) && /You're in, Adham 🎉/.test(prevHtml) && /Tuesday 20th October/.test(prevHtml) &&
    /1:30pm – 6:00pm/.test(prevHtml) && /1:00pm – 6:00pm/.test(prevHtml) && /img\/logo-juss\.png/.test(prevHtml) && /See my Week 1 plan \+ CONFIRM/.test(prevHtml) && /<b>Rubal Oshan<\/b>/.test(prevHtml) &&
    /Read your <b>JUSS HF Playbook<\/b>/.test(prevHtml) && /href="https:\/\/hf-playbook\.replit\.app\/"[^>]*>📘 Open my JUSS HF Playbook/.test(prevHtml),
    'preview: Rubal\'s JUSS email in the congratulations-page look ("You\'re in, Adham 🎉", JUSS logo, Day 1 / Day 2 cards, FieldIQ, JUSS HF Playbook, Week 1 plan + CONFIRM, Hello Fresh, JUSS number, signed Rubal: it\'s from her address)');
  ok(/reply <b>GOT IT<\/b> to this email so we know it reached you/.test(prevHtml), 'the email asks them to reply GOT IT (the strongest "not spam" signal, and Rubal knows it arrived)');
  // The whole email as the candidate sees it (images from this dev server instead of GitHub Pages)
  fs.writeFileSync(`${SHOTS}/welcome-email-juss.html`, prevHtml);
  const ep = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await ep.setContent(prevHtml.split(PUBLIC).join(APP), { waitUntil: 'load' });
  ok(await ep.evaluate(() => [...document.images].every(i => i.complete && i.naturalWidth > 0) && document.documentElement.scrollWidth <= innerWidth),
    'the email renders on a phone: logo + Week 1 poster load, nothing wider than the screen');
  await ep.screenshot({ path: SHOTS + '/35-welcome-email-full.png', fullPage: true }); await ep.close();
  await ap.locator('.sheet').screenshot({ path: SHOTS + '/34-welcome-email.png' });
  const mbOnb = (await getJson('/dev/mail')).length;
  await ap.click('#obgo'); await ap.waitForSelector('#onb .pill.green:has-text("Onboarded")');
  const wm = (await getJson('/dev/mail')).slice(mbOnb).find(m => m.to === 'adham@example.com');
  ok(wm && wm.via === 'gmail' && wm.subject === 'JUSS Marketing - Your Brand Ambassador Journey Begins!' && wm.from === 'rubal@jussmarketing.co.uk' && wm.name === 'Rubal Oshan | JUSS Marketing' &&
    wm.bcc === 'rubal@jussmarketing.co.uk' && !wm.replyTo && /FieldIQ/.test(wm.body) && /hf-playbook\.replit\.app/.test(wm.body) && /reply GOT IT/.test(wm.body),
    'sent from rubal@jussmarketing.co.uk as "Rubal Oshan | JUSS Marketing" (replies go to Rubal, who gets a copy), even though Angad pressed Send');
  ok((await api(admin, 'getCandidate', { id: adham.id })).onboard_email_by === 'Angad Oshan', 'saved: welcome email sent (who, when)');
  const huHref = await ap.getAttribute('#obwa', 'href'), hu = decodeURIComponent(huHref.split(/\?text=|[?&]body=/)[1] || '');
  ok(/^sms:\+447700900300/.test(huHref) && /^Hi Adham 👋 It's Angad from JUSS Marketing\./.test(hu) && /emailed your starter pack to adham@example\.com/.test(hu) && /JUSS HF Playbook/.test(hu) &&
    /It's from rubal@jussmarketing\.co\.uk\. Can't see it\? Check Spam or Promotions and tap Not spam/.test(hu) && /reply GOT IT/.test(hu),
    'once sent: a one-tap heads-up (by text: Adham isn\'t on WhatsApp) "just emailed your starter pack… from rubal@… check Spam / Promotions, tap Not spam… reply GOT IT"');
  ok(!/not set up yet/i.test(await ap.innerText('#onb')), 'after a send the card no longer says "not set up yet"');
  await ap.locator('#onb').screenshot({ path: SHOTS + '/36-onboarded.png' });
  const lp = await api(admin, 'onboardPreview', { id: jasId });
  ok(lp.from === 'Jess Grace <jess@linkmarketing.org.uk>' && !lp.notReady && /<b>Jess Grace<\/b>/.test(lp.html) && /Read your <b>Link FR Playbook<\/b>/.test(lp.html) &&
    /href="https:\/\/link-marketing-playbook\.replit\.app\/"[^>]*>📘 Open my Link FR Playbook/.test(lp.html) && /3\. Read your Link FR Playbook: https:\/\/link-marketing-playbook\.replit\.app\//.test(lp.text),
    'LINK starter → from Jess (jess@linkmarketing.org.uk), signed Jess, with the Link FR Playbook as step 3 (after FieldIQ and the Pre-Coaching Module)');
  const jessPrev = await api(await loginApi('jess@linkmarketing.org.uk'), 'onboardPreview', { id: adham.id });
  ok(jessPrev.from === 'Jess Grace <jess@linkmarketing.org.uk>' && /<b>Jess Grace<\/b>/.test(jessPrev.html) && /^JUSS Marketing - /.test(jessPrev.subject),
    'Jess or Rubal can send either brand: Jess sending a JUSS starter\'s email → from her address, signed by her');
  ok(lp.subject === 'Link Marketing - Your Brand Ambassador Journey Begins!' && /NDCS/.test(lp.html) && /Pre-Coaching Module/.test(lp.html) && /073110 27272/.test(lp.html) && /Day 3 onwards/.test(lp.html) && /img\/logo-link\.png/.test(lp.html) && /Link Magazine/.test(lp.html),
    'LINK version: NDCS, the pre-coaching module, Day 3 timings, Link Magazine, LINK numbers');
  await ap.goto(APP + 'index.html?c=academy'); await ap.waitForSelector('.onbq');
  const onbq = await ap.innerText('.onbq');
  ok(/To onboard · 1/.test(onbq) && /Jasraj/.test(onbq) && !/Adham/.test(onbq) && /Onboarded/.test(await ap.innerText('.trow[data-cand="' + adham.id + '"]')),
    'Day 1 tab (admins): "🚀 To onboard · 1" (Jasraj); Adham shows 🚀 Onboarded');

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
  const [pdl] = await Promise.all([jrp.waitForEvent('download'), jrp.click('[data-pdf="2026-10-19"]')]);
  const pdfPath = `${SHOTS}/30-day1-signin.pdf`; await pdl.saveAs(pdfPath);
  const pdfRaw = fs.readFileSync(pdfPath, 'latin1');
  ok(pdl.suggestedFilename() === 'Day1-2026-10-19.pdf' && /^%PDF-1\.4/.test(pdfRaw) && /%%EOF\s*$/.test(pdfRaw), '📄 Print list → Day1-2026-10-19.pdf');
  let pdfTxt = '';
  try { pdfTxt = require('child_process').execFileSync('pdftotext', ['-layout', pdfPath, '-'], { encoding: 'utf8' }); } catch (e) { pdfTxt = pdfRaw; }
  ok(/BA Academy · Day 1 sign-in/.test(pdfTxt) && /Monday 19 October 2026 · 1:30pm/.test(pdfTxt) && /Adham Soliman/.test(pdfTxt) && /Jasraj Bhuller/.test(pdfTxt) &&
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
  await shot(ap, '28-day1-arrivals', true);
  const abdT = await loginApi('abdullahi@example.com');
  ok((await api(abdT, 'chaseList', {})).items.some(c => c.id === adham.id && c.leak === 'noshow'), 'a no-show goes straight onto their booker\'s Chase list: "❌ No-show: rebook"');
  await ap.click('[data-d1="no_show"][data-id="' + adham.id + '"]');
  await ap.waitForSelector('[data-d1="no_show"][data-id="' + adham.id + '"].ghost');
  ok((await api(admin, 'getCandidate', { id: adham.id })).day1_status === '', 'tap again to undo a mistake');
  await api(admin, 'markDay1', { id: adham.id, status: 'no_show' });
  const reb = await api(abdT, 'saveOutcome', { id: adham.id, outcome: 'Academy booked', academy_date: '2026-10-26', outcome_notes: 'missed the train' });
  ok(reb.day1_status === '' && !reb.academy_confirmed_at && (await api(abdT, 'chaseList', {})).items.some(c => c.id === adham.id && c.leak !== 'noshow'),
    'rebooking (new Day 1 date) clears the no-show; they need confirming again');
  await api(abdT, 'saveOutcome', { id: adham.id, outcome: 'Academy booked', academy_date: '2026-10-19', outcome_notes: '' });
  await api(admin, 'markDay1', { id: adham.id, status: 'arrived' });

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
  ok(tb6.map(x => x.t).join() === 'today,mine,chase,academy,all,pay' && tb6.every(x => x.fits), 'an admin who also books: Today · Mine · Chase · Day 1 · All · Incentive, every label fits on a phone');
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
  await setTime('2027-10-25T03:00:00+01:00');
  await post('/dev/run', { fn: 'dailyMaintenance' });
  ok((await getJson('/dev/sheet?name=Candidates')).length === 1, 'records older than 6 months deleted automatically');

  await browser.close();
  console.log('\nALL CHECKS PASSED');
  process.exit(0);
})().catch(e => { console.error('\nFAILED:', e); process.exit(1); });
