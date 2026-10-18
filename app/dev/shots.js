// Visual check: seeds a morning's data on the fake Google backend, then screenshots every screen
// as a LINK user and as a JUSS user (phone size). Usage: node app/build.js && node app/dev/shots.js <dir> [only]
// `only` = a word to match against shot names, to re-shoot just those.
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 8788, BASE = 'http://localhost:' + PORT, APP = BASE + '/join/';
const PUBLIC = require('../site.json').url;
const DIR = process.argv[2] || './shots-ui';
const ONLY = process.argv[3] || '';
fs.mkdirSync(DIR, { recursive: true });
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

const server = spawn(process.execPath, [path.join(__dirname, 'server.js'), String(PORT)], { stdio: ['ignore', 'pipe', 'inherit'] });
const ready = new Promise(r => server.stdout.on('data', d => { if (/dev server/.test(String(d))) r(); }));
process.on('exit', () => server.kill());

const post = (p, b) => fetch(BASE + p, { method: 'POST', body: JSON.stringify(b) }).then(r => r.json());
const getJson = p => fetch(BASE + p).then(r => r.json());
async function api(token, action, payload) {
  const r = await post('/api', Object.assign({ action, token }, payload || {}));
  if (!r.ok) throw new Error(action + ': ' + r.error);
  return r.data;
}
async function login(email) {
  await api('', 'requestCode', { email });
  const m = (await getJson('/dev/mail')).filter(x => x.to === email && /login code/.test(x.subject)).pop();
  return (await api('', 'verifyCode', { email, code: m.subject.match(/(\d{6})/)[1] })).token;
}

(async () => {
  await ready;
  await post('/dev/run', { fn: 'setup' });
  await post('/dev/time', { iso: '2026-10-12T11:30:00+01:00' });
  const admin = await login('angad@linkmarketing.org.uk');
  const mk = (name, email, company, roles) => api(admin, 'saveUser', { user: { name, email, company, roles, active: true } });
  const fiza = await mk('Fiza Iqbal', 'fiza@example.com', 'LINK', ['booker']);
  const abd = await mk('Abdullahi Ahmed', 'abdullahi@example.com', 'JUSS', ['booker']);
  const mo = await mk('Mo Aden', 'mo@example.com', 'LINK', ['booker']);
  await mk('Nathan Smith', 'nathan@example.com', 'LINK', ['presenter']);
  const nathan = await login('nathan@example.com');

  const ci = form => api('', 'checkin', { form: Object.assign({ over18: 'Yes', privacy_ok: true, source: 'Indeed', rtw: 'British or Irish citizen' }, form) });
  const people = [
    ['Jasraj Bhuller', '07700900123', fiza.id, 'G', 4], ['Ishita Rani', '07700900200', mo.id, 'R', 2], ['Adham Soliman', '07700900300', abd.id, 'G', 5],
    ['Ali Yilmaz', '07700900400', '', '', 0], ['Jagpreet Kular', '07700900999', abd.id, 'A', 3], ['Priya Sandhu', '07700900611', fiza.id, '', 0],
    ['Kemi Adebayo', '07700900622', abd.id, '', 0], ['Tom Walsh', '07700900633', fiza.id, 'A', 3],
  ];
  const C = {};
  for (const p of people) {
    C[p[0]] = await ci({ full_name: p[0], mobile: p[1], email: p[0].split(' ')[0].toLowerCase() + '@example.com', booker_id: p[2], booker_typed: p[2] ? '' : 'Ian' });
    if (p[3]) await api(nathan, 'saveNotes', { id: C[p[0]].id, rag: p[3], stars: p[4], tags: p[3] === 'G' ? ['Great energy'] : [], notes: 'Confident, asked good questions.',
      why_note: 'Wants to earn on results', interesting: p[3] === 'G' ? 'Plays semi-pro football' : '' });
  }
  const ev = (c, extra) => api('', 'submitEval', { id: c.id, resume: c.resume, answers: Object.assign({
    q1_excitement: '9', q2_stood_out: 'The ladder to ownership', q3_reason: 'Uncapped earnings', q4_situation: 'Looking for work', q4_looking_for: '1–3 months',
    q5_start_date: '2026-10-19', q6_days: '6–7 days', q7_commute: 'Yes', q8_resilience: 'Worked nights in a warehouse while finishing my degree.', q9_results_paid: 'Yes',
    q9_results_detail: 'Commission selling phones', q10_door: 'A) "Next door."', q11_coach: 'D) Practise it until it lands',
    q12_bdp_stage: 'Stage 5–6 – Ownership (my own business)', q13_unspent: 'No' }, extra || {}) });
  for (const n of ['Jasraj Bhuller', 'Ishita Rani', 'Adham Soliman', 'Jagpreet Kular', 'Tom Walsh']) await ev(C[n]);
  await api(await login('abdullahi@example.com'), 'saveOutcome', { id: C['Adham Soliman'].id, outcome: 'Academy booked', academy_date: '2026-10-19', outcome_notes: 'Great call' });
  await api(await login('fiza@example.com'), 'saveOutcome', { id: C['Tom Walsh'].id, outcome: 'Thinking it over', academy_date: '', outcome_notes: '' });

  const browser = await chromium.launch();
  const shot = async (page, name, full) => {
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(DIR, name + '.png'), fullPage: !!full });
    console.log('  ' + name);
  };
  const want = n => !ONLY || n.indexOf(ONLY) >= 0;
  const staff = async (email, shots) => {
    if (!shots.some(s => want(s[0]))) return;
    const tok = await login(email);
    const ctx = await browser.newContext(PHONE);
    await ctx.addInitScript(t => { try { if (!localStorage.getItem('lr_tok')) localStorage.setItem('lr_tok', JSON.stringify(t)); } catch (e) {} }, tok);
    const p = await ctx.newPage();
    await p.goto(APP + 'index.html');
    await p.waitForSelector('.tabbar button');
    for (const s of shots) { if (!want(s[0])) continue; await s[1](p); await shot(p, s[0], s[2]); }
    await ctx.close();
  };
  const open = name => async p => { await p.click('.item:has-text("' + name + '")'); await p.waitForSelector('.profile h1'); };
  const tab = t => async p => { await p.click('.tabbar button[data-tab=' + t + ']'); await p.waitForTimeout(300); };
  const noop = async () => {};

  // Staff
  await staff('nathan@example.com', [['s1-presenter-today', noop], ['s1-presenter-today-full', noop, true], ['s2-presenter-cand', open('Priya Sandhu'), true]]);
  await staff('fiza@example.com', [['s3-link-booker-mine', noop], ['s3-link-booker-mine-full', noop, true], ['s4-link-booker-cand', open('Jasraj Bhuller')], ['s4-link-booker-cand-full', noop, true]]);
  await staff('abdullahi@example.com', [['s5-juss-booker-mine', noop], ['s6-juss-booker-cand', open('Jagpreet Kular')], ['s6-juss-booker-cand-full', noop, true]]);
  await staff('angad@linkmarketing.org.uk', [['s7-link-admin-today', noop], ['s7-link-admin-pay', tab('pay')], ['s7-link-admin-all', tab('all')], ['s7-link-admin-team', tab('team')]]);
  await staff('satpal@jussmarketing.co.uk', [['s8-juss-admin-today', noop], ['s8-juss-admin-pay', tab('pay')], ['s8-juss-admin-cand', async p => { await tab('all')(p); await open('Adham Soliman')(p); }, true]]);

  // Login
  if (want('c0-login')) { const ctx = await browser.newContext(PHONE); const p = await ctx.newPage(); await p.goto(APP + 'index.html'); await p.waitForSelector('#em'); await shot(p, 'c0-login'); await ctx.close(); }

  // Candidate: check-in (neutral → booker picked), checked in, evaluation, done
  for (const [co, booker, who] of [['link', 'Fiza Iqbal', 'Sam Carter'], ['juss', 'Abdullahi Ahmed', 'Leah Brown']]) {
    if (!['c1', 'c2', 'c3', 'c4', 'c5'].some(k => want(k + '-' + co) || want(k))) continue;
    const ctx = await browser.newContext(PHONE);
    const p = await ctx.newPage();
    await p.goto(APP + 'checkin.html'); await p.waitForSelector('#f');
    if (co === 'link') await shot(p, 'c1-checkin-empty');
    await p.fill('[name=full_name]', who); await p.fill('[name=mobile]', co === 'link' ? '07700911001' : '07700911002'); await p.fill('[name=email]', co + '@example.com');
    await p.click('.chips[data-name=over18] .chip:has-text("Yes")');
    await p.fill('#bkq', booker.slice(0, 3)); await p.click('#sg button:has-text("' + booker + '")');
    await p.selectOption('[name=rtw]', 'British or Irish citizen'); await p.check('[name=privacy_ok]');
    await shot(p, 'c2-checkin-picked-' + co, true);
    await p.click('#go'); await p.waitForSelector('text=You\'re checked in');
    await shot(p, 'c3-checked-in-' + co);
    await p.goto(APP + 'eval.html'); await p.waitForSelector('text=Your evaluation');
    await shot(p, 'c4-eval-' + co);
    await p.click('.chips[data-name=q1_excitement] .chip[data-v="8"]');
    await p.click('.chips[data-name=q3_reason] .chip:has-text("Leadership")');
    await shot(p, 'c4-eval-' + co + '-full', true);
    await ctx.close();
  }
  if (want('c5')) {
    // Evaluation on a different phone: found by mobile
    const ctx = await browser.newContext(PHONE); const p = await ctx.newPage();
    await p.goto(APP + 'eval.html'); await p.waitForSelector('text=Evaluation time'); await shot(p, 'c5-eval-find');
    await ctx.close();
  }
  // Welcome pages
  if (want('c6')) {
    const adham = await api(admin, 'getCandidate', { id: C['Adham Soliman'].id });
    await api(await login('fiza@example.com'), 'saveOutcome', { id: C['Jasraj Bhuller'].id, outcome: 'Academy booked', academy_date: '2026-10-19', outcome_notes: '' });
    const jas = await api(admin, 'getCandidate', { id: C['Jasraj Bhuller'].id });
    for (const [c, co] of [[jas, 'link'], [adham, 'juss']]) {
      const ctx = await browser.newContext(PHONE); const p = await ctx.newPage();
      await p.goto(c.welcome_url.replace(PUBLIC, APP)); await p.waitForSelector('text=You\'re in');
      await shot(p, 'c6-welcome-' + co); await shot(p, 'c6-welcome-' + co + '-full', true);
      await ctx.close();
    }
  }
  await browser.close();
  console.log('done → ' + DIR);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
