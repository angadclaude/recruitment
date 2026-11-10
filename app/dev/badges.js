// Badges (Angad, 10 Nov 2026: "the team uses Canva right now. I don't want that to happen"): Day 1 → 🪪 Badges, admins
// type each starter's number(s) from the client, tick who to print and get the A4 PDF in the Canva files' layout: NDCS
// (Fundraising, 4 to a page, fold in the middle) and HelloFresh (8 fronts, then their backs mirrored for double-sided).
// The artwork never goes in this repo: the test draws its own. To look at the real thing, point it at the artwork file and
// a folder of photos (Name.jpg), both kept outside the repo:
//   BADGE_ART=/path/JL-badge-artwork.json BADGE_PHOTOS=/path/photos node app/dev/badges.js <dir>
// Usage: node app/build.js && node app/dev/badges.js <screenshot-dir>   (JL_BACKEND=pg: on the Supabase back end)
'use strict';
const { chromium } = require('playwright');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 8796, BASE = 'http://localhost:' + PORT, APP = BASE + '/join/';
const SHOTS = process.argv[2] || './shots-badges';
fs.mkdirSync(SHOTS, { recursive: true });
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, acceptDownloads: true };

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
const setTime = async iso => { CLOCK_OFF = new Date(iso).getTime() - Date.now(); return post('/dev/time', { iso }); };
let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; console.log('  ✓ ' + msg); };

(async () => {
  await ready;
  console.log('setup (' + (process.env.JL_BACKEND === 'pg' ? 'Supabase back end' : 'Google back end') + ')');
  await post('/dev/run', { fn: 'setup' });
  await setTime('2026-11-10T10:00:00+00:00');  // Tuesday 10 Nov, the morning after Day 1
  const angad = await loginApi('angad@linkmarketing.org.uk');
  await api(angad, 'saveUser', { user: { name: 'Abdullahi Ahmed', email: 'abdullahi@example.com', company: 'JUSS', roles: ['booker'], active: true } });
  const booker = await loginApi('abdullahi@example.com');

  const browser = await chromium.launch();
  const ctx = await browser.newContext(PHONE);
  await ctx.clock.setSystemTime(new Date(Date.now() + CLOCK_OFF));
  await ctx.addInitScript(t => { try { if (!localStorage.getItem('lr_tok')) localStorage.setItem('lr_tok', JSON.stringify(t)); } catch (e) {} }, angad);
  const p = await ctx.newPage();
  await p.goto(APP + 'index.html'); await p.waitForSelector('.tabbar button');

  console.log('starters and their photos');
  const PH = process.env.BADGE_PHOTOS, realPhoto = n => { const f = PH && path.join(PH, n + '.jpg'); return f && fs.existsSync(f) ? 'data:image/jpeg;base64,' + fs.readFileSync(f).toString('base64') : null; };
  // A head-and-shoulders picture as the app saves them (480 × 572), a different colour each
  const fakePhoto = hue => p.evaluate(hue => { const c = document.createElement('canvas'); c.width = 480; c.height = 572; const g = c.getContext('2d');
    g.fillStyle = 'hsl(' + hue + ',45%,82%)'; g.fillRect(0, 0, 480, 572); g.fillStyle = 'hsl(' + hue + ',40%,35%)';
    g.beginPath(); g.arc(240, 230, 90, 0, 7); g.fill(); g.fillRect(110, 360, 260, 212); return c.toDataURL('image/jpeg', 0.85); }, hue);
  const START = [
    ['Sara Adeyemi', 'LINK', '2026-11-09', '2026-11-15'], ['Harvey Sandhu', 'LINK', '2026-11-09', '2026-11-15'], ['Ivan Ilic', 'LINK', '2026-11-09', '2026-11-15'],
    ['Dina Shah', 'LINK', '2026-11-02', '2026-11-08'], ['Lakshmi Venkata Priya Arul Murugan', 'LINK', '2026-11-09', '2026-11-15'],
    ['Eric Hale', 'JUSS', '2026-11-09', '2026-11-15'], ['Hana Begum', 'JUSS', '2026-11-09', '2026-11-15'], ['Jade Jones', 'JUSS', '2026-11-02', '2026-11-08'],
    ['Kira Fong-Sullivan', 'JUSS', '2026-11-02', '2026-11-08'], ['Ştefan Ionescu', 'JUSS', '2026-11-09', '2026-11-15'],
    ['Old Starter', 'LINK', '2026-09-21', '2026-09-27'],  // 7 weeks ago: off the list
  ];
  const S = {};
  for (let i = 0; i < START.length; i++) {
    const [name, co, day1, we] = START[i];
    const r = await api(angad, 'addStarter', { weekEnding: we, full_name: name, company: co, day1_date: day1 });
    if (name !== 'Ivan Ilic') await api(angad, 'saveStarterPhoto', { id: r.id, data: realPhoto(name) || await fakePhoto(i * 33) });  // Ivan: no photo yet
    S[name.split(' ')[0]] = r;
  }

  console.log('who can');
  for (const a of ['badgeList', 'saveBadge', 'badgesPrinted', 'badgeArt', 'saveBadgeArt'])
    ok(/Only admins make badges/.test(await refused(booker, a, { id: S.Sara.id, badge_no: '1', ids: [S.Sara.id], art: {} })), 'a booker can\'t: ' + a);

  console.log('the list');
  let L = await api(angad, 'badgeList', {});
  const names = L.rows.map(r => r.full_name);
  ok(L.rows.length === 10 && !names.includes('Old Starter') && L.weeks === 6, 'everyone who started in the last 6 Day 1 weeks (10), not one from 7 weeks ago');
  ok(L.rows.filter(r => r.campaign === 'FR').length === 5 && L.rows.filter(r => r.campaign === 'HF').length === 5, 'NDCS = Fundraising (5), HelloFresh = HF (5): where they were placed');
  ok(!L.art.ndcs && !L.art.hf && !L.art.hfBack && L.expiry.FR === '2027-03-31', 'no artwork yet; NDCS expiry 31/03/2027 unless typed');
  const bookerAvail = await api(booker, 'availWeek', { weekEnding: '2026-11-15' });
  ok(bookerAvail.rows.every(r => !('badge_no' in r)), 'badge numbers aren\'t sent to bookers with the availability');

  console.log('numbers');
  ok(/one ID number/.test(await refused(angad, 'saveBadge', { id: S.Sara.id, badge_no: '90145\n90146' })), 'NDCS: one ID number');
  ok(/three numbers/.test(await refused(angad, 'saveBadge', { id: S.Eric.id, badge_no: 'JU0145\nR0145\nGD2D014\nX1' })), 'HelloFresh: three numbers at most');
  ok(/letters and numbers only/.test(await refused(angad, 'saveBadge', { id: S.Eric.id, badge_no: 'JU0145\n<b>' })), 'letters and numbers only');
  ok(/Pick the expiry/.test(await refused(angad, 'saveBadge', { id: S.Sara.id, badge_no: '90145', badge_expiry: '07/04/2027' })), 'an expiry is a date');
  const su = await api(angad, 'saveBadge', { id: S.Sara.id, badge_no: ' 90145 ' });
  const dh = await api(angad, 'saveBadge', { id: S.Dina.id, badge_no: '90136', badge_expiry: '2027-04-07' });
  await api(angad, 'saveBadge', { id: S.Harvey.id, badge_no: '90133' });
  await api(angad, 'saveBadge', { id: S.Ivan.id, badge_no: '90134' });
  await api(angad, 'saveBadge', { id: S.Lakshmi.id, badge_no: '90140' });
  const er = await api(angad, 'saveBadge', { id: S.Eric.id, badge_no: 'ju0145, r0145, gd2d014' });
  await api(angad, 'saveBadge', { id: S.Hana.id, badge_no: 'JU0148\nR0148\nGD2D018' });
  await api(angad, 'saveBadge', { id: S.Jade.id, badge_no: 'JU0149\nR0149\nGD2D019' });
  await api(angad, 'saveBadge', { id: S['Ştefan'].id, badge_no: 'JU0151\nR0151\nGD2D021' });
  ok(su.badge_no === '90145' && !su.badge_expiry && dh.badge_expiry === '2027-04-07' && er.badge_no === 'JU0145\nR0145\nGD2D014' && er.badge_by === 'Angad Oshan',
    'saved, tidied (upper case, a line each), with who typed them; Dina\'s own expiry 07/04/2027 (one on the Canva file had its own)');
  const logs = await post('/dev/eval', { js: "JSON.stringify(readTable('Log').filter(l => l.action === 'badge').map(l => l.detail))" });
  ok(!/90145|JU0145/.test(logs.out) && /Sara Adeyemi: number saved/.test(logs.out), 'the Log says a number was saved, never the number');

  console.log('the artwork, from a file');
  ok(/isn't a badge artwork file/.test(await refused(angad, 'saveBadgeArt', { art: { ndcs: 'data:text/html;base64,PHNjcmlwdD4=' } })), 'anything but a picture is refused');
  let artFile = process.env.BADGE_ART;
  if (!artFile) {  // the test's own stand-in (the real one carries a signature and logos: never in this public repo)
    const fake = await p.evaluate(() => {
      const mk = (w, hh, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = hh; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, hh); draw(g); return c.toDataURL('image/png'); };
      return { kind: 'jl-badge-art',
        ndcs: mk(2270, 725, g => { g.fillStyle = '#6B1FAD'; g.fillRect(0, 0, 988, 284); g.fillRect(1010, 0, 1260, 284); g.fillStyle = '#fff'; g.font = 'bold 90px sans-serif'; g.fillText('PAID', 395, 110); g.fillStyle = '#6B1FAD'; g.font = 'bold 40px sans-serif'; g.fillText('NAME :', 418, 350); g.fillText('ID NUMBER:', 418, 441); g.fillText('EXPIRY DATE :', 418, 541); }),
        hf: mk(1036, 730, g => { g.lineWidth = 7; g.strokeRect(4, 4, 1028, 722); g.fillStyle = '#8CC63F'; g.beginPath(); g.arc(600, 150, 80, 0, 7); g.fill(); g.strokeRect(490, 296, 516, 78); }),
        hfBack: mk(1036, 730, g => { g.fillStyle = '#000'; g.font = '40px sans-serif'; g.textAlign = 'center'; g.fillText('To verify our agents', 518, 140); g.fillRect(400, 370, 240, 240); }) };
    });
    artFile = path.join(SHOTS, 'test-badge-artwork.json'); fs.writeFileSync(artFile, JSON.stringify(fake));
  }

  console.log('the Badges screen');
  await p.click('.tabbar button[data-tab=academy]');
  await p.waitForSelector('#goBadges');
  await p.click('#goBadges');
  await p.waitForSelector('.bdrow');
  let txt = await p.innerText('#page');
  ok(/The badge artwork isn't in yet/.test(txt) && (await p.$$('[data-bdprint][disabled]')).length === 2, 'no artwork yet: it says so, and Print waits for it');
  await p.setInputFiles('#bdartf', artFile);
  await p.waitForFunction(() => !/badge artwork isn't in yet/.test(document.querySelector('#page').innerText));
  L = await api(angad, 'badgeList', {});
  ok(L.art.ndcs && L.art.hf && L.art.hfBack, 'the artwork file opened on the phone puts it in (admins), once');
  await p.waitForFunction(() => document.querySelectorAll('.bdrow img.avph').length >= 9);
  txt = await p.innerText('#page');
  const heads = await p.$$eval('.section-h', l => l.map(x => x.textContent.replace(/\s+/g, ' ').trim()));
  ok(heads.join('|') === '🟣 NDCS · Fundraising 5|🍋 HelloFresh 5', 'two lists: ' + heads.join(', '));
  ok(/Print at 100% \(Actual size\)/.test(txt) && /double-sided, flip on the long edge/.test(txt), 'how to print: 100%, HelloFresh double-sided on the long edge');
  const rowTxt = n => p.$eval('.bdrow:has-text("' + n + '")', el => el.innerText);
  ok(/No photo yet/.test(await rowTxt('Ivan Ilic')) && !/Ready to print/.test(await rowTxt('Ivan Ilic')) && await p.$eval('.bdrow:has-text("Ivan Ilic") .bdpick', el => el.disabled), 'Ivan: his number\'s in but no photo yet, so not "ready" and he can\'t be ticked');
  ok(/Waiting for numbers/.test(await rowTxt('Kira Fong-Sullivan')) && /1 waiting for their numbers/.test(txt), 'Kira: waiting for her HelloFresh numbers');
  const picked = await p.$$eval('.bdrow .bdpick:checked', l => l.length);
  ok(picked === 8, 'ticked by themselves: everyone with their numbers and a photo, not printed yet (' + picked + ': 4 NDCS, 4 HelloFresh)');
  await p.screenshot({ path: SHOTS + '/b1-badges.png', fullPage: true });

  console.log('typing them in on the phone');
  const kin = '.bdrow:has-text("Kira Fong-Sullivan") .bdno';
  await p.fill(kin + '[data-i="0"]', 'ju0146'); await p.fill(kin + '[data-i="1"]', 'r0146'); await p.fill(kin + '[data-i="2"]', 'gd2d016');
  await p.click('.section-h');  // leave the box: it saves
  await p.waitForFunction(() => /Ready to print/.test((document.querySelector('.bdrow[data-bd] ') || {}).innerText || '') || true);
  let keira = null; for (let i = 0; i < 30 && !(keira && keira.badge_no.split('\n').length === 3); i++) { keira = (await api(angad, 'badgeList', {})).rows.find(r => r.full_name === 'Kira Fong-Sullivan'); await p.waitForTimeout(150); }
  ok(keira.badge_no === 'JU0146\nR0146\nGD2D016', 'Kira\'s three numbers typed on the phone are saved (upper case)');
  await p.waitForFunction(() => document.querySelector('.bdrow:has(.name)') && /Ready to print/.test(Array.from(document.querySelectorAll('.bdrow')).find(r => /Kira/.test(r.innerText)).innerText));
  ok(await p.$eval('.bdrow:has-text("Kira Fong-Sullivan") .bdpick', el => el.checked), 'and she\'s ticked to print');

  console.log('NDCS: print');
  await p.click('[data-bdprint=ndcs]');
  await p.waitForSelector('.pdfprev canvas');
  ok(/Preview · 1 page\b/i.test(await p.innerText('.pdfprev')) && /NDCS badges 10\.11\.2026/i.test(await p.innerText('.pdfprev')), 'NDCS: a preview first, 1 page (4 badges a page), "NDCS badges 10.11.2026"');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#pdfgo')]);
  const pdf = fs.readFileSync(await dl.path());
  fs.writeFileSync(SHOTS + '/NDCS-badges.pdf', pdf);
  const head = pdf.slice(0, 1200).toString('latin1');
  ok(/^%PDF-1\.4/.test(head) && (pdf.toString('latin1').match(/\/DCTDecode/g) || []).length === 1 && /\/MediaBox \[0 0 595\.28 841\.89\]/.test(head) && pdf.length > 100000,
    'the PDF: A4, one 300 dpi page (' + Math.round(pdf.length / 1024) + ' KB)');
  let su2 = null; for (let i = 0; i < 30 && !(su2 && su2.badge_printed_at); i++) { su2 = (await api(angad, 'badgeList', {})).rows.find(r => r.full_name === 'Sara Adeyemi'); await p.waitForTimeout(150); }
  const after = (await api(angad, 'badgeList', {})).rows;
  ok(su2.badge_printed_at && su2.badge_printed_by === 'Angad Oshan' && !after.find(r => r.full_name === 'Ivan Ilic').badge_printed_at, 'shared / saved → ticked off as printed (who and when); Ivan (no photo) wasn\'t on it');
  await p.waitForFunction(() => /Printed/.test(Array.from(document.querySelectorAll('.bdrow')).find(r => /Sara/.test(r.innerText)).innerText));
  ok(!(await p.$eval('.bdrow:has-text("Sara Adeyemi") .bdpick', el => el.checked)), 'printed: not ticked next time (tick them again to reprint)');

  console.log('HelloFresh: print');
  await p.click('[data-bdprint=hf]');
  await p.waitForSelector('.pdfprev canvas');
  ok(/Preview · 2 pages/i.test(await p.innerText('.pdfprev')), 'HelloFresh: 2 pages (the fronts, then their backs)');
  await p.screenshot({ path: SHOTS + '/b2-hf-preview.png' });
  const [dl2] = await Promise.all([p.waitForEvent('download'), p.click('#pdfgo')]);
  const pdf2 = fs.readFileSync(await dl2.path());
  fs.writeFileSync(SHOTS + '/HelloFresh-badges.pdf', pdf2);
  ok((pdf2.toString('latin1').match(/\/DCTDecode/g) || []).length === 2 && /\/Count 2/.test(pdf2.toString('latin1')), 'the PDF has the two pages');

  console.log('what\'s on the pages');
  // The pages are pictures: take them out of the PDFs and look at the pixels where the photo, name and numbers go
  const jpegs = buf => { const out = [], s = buf.toString('latin1'); let i = 0;
    while ((i = s.indexOf('/DCTDecode', i)) >= 0) { const a = s.indexOf('stream\n', i) + 7, b = s.indexOf('\nendstream', a); out.push(buf.slice(a, b).toString('base64')); i = b; } return out; };
  const look = (b64, boxes) => p.evaluate(async a => {
    const im = await new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/jpeg;base64,' + a.b64; });
    const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d'); g.drawImage(im, 0, 0);
    return { w: im.width, h: im.height, dark: a.boxes.map(b => { const d = g.getImageData(b[0], b[1], b[2], b[3]).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] < 450) n++; return n; }) };
  }, { b64, boxes });
  const N = { x: 105, y: 164, dy: 790, photo: [33, 38], name: [633, 350], id: [735, 441.6], exp: [782, 540.8] };  // as BADGE.ndcs in the app
  const nd = jpegs(pdf), nboxes = [];
  [0, 1, 2, 3].forEach(j => { const y = N.y + j * N.dy;
    nboxes.push([N.x + N.photo[0] + 150, y + N.photo[1] + 120, 100, 100], [N.x + N.name[0], y + N.name[1] - 34, 300, 40], [N.x + N.id[0], y + N.id[1] - 34, 150, 40], [N.x + N.exp[0], y + N.exp[1] - 34, 250, 40]); });
  const nl = await look(nd[0], nboxes);
  ok(nl.w === 2480 && nl.h === 3508, 'NDCS page: A4 at 300 dpi (2480 × 3508)');
  ok([0, 1, 2, 3].every(j => nl.dark[4 * j] > 1000 && nl.dark[4 * j + 1] > 200 && nl.dark[4 * j + 2] > 100 && nl.dark[4 * j + 3] > 100),
    'NDCS: 4 badges (Dina, Harvey, Lakshmi, Sara), each with their photo, name, ID number and expiry where the Canva file has them');
  const H = { x: 175, dx: 1070, y: 191, dy: 787, w: 1036, h: 730, name: [747.5, 348.9], codeX: 239, codes: [539.8, 611.5, 676.9] };  // as BADGE.hf
  const hj = jpegs(pdf2), slot = j => [H.x + (j % 2) * H.dx, H.y + Math.floor(j / 2) * H.dy];
  const front = await look(hj[0], [0, 1, 2, 3, 4].map(j => [slot(j)[0] + H.name[0] - 150, slot(j)[1] + H.name[1] - 36, 300, 44])
    .concat([0, 1, 2, 3, 4].map(j => [slot(j)[0] + H.codeX - 80, slot(j)[1] + H.codes[2] - 34, 160, 40])).concat([[slot(5)[0], slot(5)[1], H.w, H.h]]));
  ok(front.dark.slice(0, 5).every(n => n > 150) && front.dark.slice(5, 10).every(n => n > 100) && front.dark[10] === 0,
    'HelloFresh fronts: 5 badges, each name in its box and the three numbers in theirs; the 6th place empty');
  const back = await look(hj[1], [0, 1, 2, 3, 4, 5].map(j => [2480 - slot(j)[0] - H.w, slot(j)[1], H.w, H.h]));
  ok(back.dark.slice(0, 5).every(n => n > 1000) && back.dark[5] === 0, 'HelloFresh backs: behind each of the 5, mirrored across the page (double-sided, flip on the long edge); none behind the empty place');

  await browser.close();
  console.log('\nALL ' + passed + ' BADGE CHECKS PASSED (' + (process.env.JL_BACKEND === 'pg' ? 'Supabase back end' : 'Google back end') + ')');
  process.exit(0);
})().catch(e => { console.error('\nFAILED:', e); process.exit(1); });
