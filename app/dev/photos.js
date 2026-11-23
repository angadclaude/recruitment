// Starters' photos at full size (Angad, 23 Nov 2026: "the pictures taken from the app are absolutely rubbish. This needs to be
// high res to the best of the capabilities… I never had an issue with Canva"). Until then the phone shrank every photo to
// 480 × 572 and lists showed a 168 px copy of that. A photo taken through the app from a "camera" picture with fine detail:
// what's sent and kept (a small copy for lists, the full-size one by itself), who may fetch it, the viewer and Save, the
// poster and a badge print made from the full-size one, an old low-res photo said to be low-res, and the 6-month trim.
// Usage: node app/build.js && node app/dev/photos.js <screenshot-dir>   (JL_BACKEND=pg: on the Supabase back end)
'use strict';
const { chromium } = require('playwright');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 8797, BASE = 'http://localhost:' + PORT, APP = BASE + '/join/';
const SHOTS = process.argv[2] || './shots-photos';
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
const ev = async js => (await post('/dev/eval', { js })).out;
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
  await setTime('2026-11-24T10:00:00+00:00');  // Tuesday, the morning after Day 1 (Mon 23 Nov)
  // Signed in as someone on the badge team (they're admins too), whoever the server's settings say that is: no address written here
  const makerEmail = await ev('usersAll().filter(u => truthy(u.active) && canBadge(u) && isAdmin(u))[0].email');
  let maker = await loginApi(makerEmail);
  await api(maker, 'saveUser', { user: { name: 'Bo Booker', email: 'bo@example.com', company: 'JUSS', roles: ['booker'], active: true } });
  const booker = await loginApi('bo@example.com');
  const WE = '2026-11-29';
  const add = n => api(maker, 'addStarter', { weekEnding: WE, full_name: n, company: 'LINK', day1_date: '2026-11-23', campaign: '' });
  const sara = await add('Sara Adeyemi'), omar = await add('Omar Old');
  const rowOf = async id => (await api(maker, 'availWeek', { weekEnding: WE })).rows.find(r => r.id === id);

  const browser = await chromium.launch();
  const pageErrors = require('./watch').watch(browser);  // every page's own errors, all the way through
  const ctx = await browser.newContext(PHONE);
  await ctx.clock.setSystemTime(new Date(Date.now() + CLOCK_OFF));
  await ctx.addInitScript(t => { try { if (!localStorage.getItem('lr_tok')) localStorage.setItem('lr_tok', JSON.stringify(t)); } catch (e) {} }, maker);
  const p = await ctx.newPage();
  const asked = [];  // what the app asks the server for, and how big what it sends is
  p.on('request', q => { if (q.method() === 'POST' && /\/api$/.test(new URL(q.url()).pathname)) { try { const b = JSON.parse(q.postData() || '{}'); asked.push({ action: b.action, id: b.id, data: (b.data || '').length, hd: (b.hd || '').length }); } catch (e) { /* not ours */ } } });
  await p.goto(APP + 'index.html'); await p.waitForSelector('.tabbar button');
  const shot = n => p.screenshot({ path: path.join(SHOTS, n + '.png') });
  const toastIs = re => p.waitForFunction(r => new RegExp(r).test((document.getElementById('toast') || {}).textContent || ''), re.source, { timeout: 10000 }).then(() => true, () => false);
  // An image's size, and how much fine detail survives in it: how dark the hair-thin black lines still are (0 = solid black,
  // 255 = gone into the white behind them)
  const look = src => p.evaluate(src => new Promise(res => { const i = new Image(); i.onload = () => {
    const c = document.createElement('canvas'); c.width = i.naturalWidth; c.height = i.naturalHeight; const g = c.getContext('2d'); g.drawImage(i, 0, 0);
    const y = Math.round(c.height * 0.5), d = g.getImageData(0, y, c.width, 1).data; let lo = 255;
    for (let x = Math.round(c.width * 0.3); x < c.width * 0.7; x++) { const v = d[x * 4]; if (v < lo) lo = v; }
    res({ w: i.naturalWidth, h: i.naturalHeight, line: lo }); }; i.onerror = () => res(null); i.src = src; }), src);

  console.log('a photo from the phone\'s camera');
  // What a phone's camera hands over: 2400 × 3200, white, with black lines 1 px wide down the middle (fine detail, like hair or the
  // writing on a name tag). With no face in it the app frames the middle 1584 px: at full size (1440 wide) a line is still
  // nearly a pixel wide and stays black; in a 480 px copy it's a third of a pixel and fades into the white.
  const camera = Buffer.from(await p.evaluate(() => new Promise(res => {
    const c = document.createElement('canvas'); c.width = 2400; c.height = 3200; const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, 2400, 3200);
    g.fillStyle = '#000'; for (let x = 600; x < 1800; x += 37) g.fillRect(x, 0, 1, 3200);
    c.toBlob(b => b.arrayBuffer().then(a => res(Array.from(new Uint8Array(a)))), 'image/jpeg', 0.92);
  })));
  // Availability for the week they started (the Day 1 tab may be showing next week's Day 1: back a week at a time until they're there)
  const toWeek = async pg => {
    await pg.click('#goAvail'); await pg.waitForSelector('#avprev');
    for (let i = 0; i < 4; i++) {
      if (await pg.waitForSelector('.avrow[data-av="' + sara.id + '"]', { timeout: 2500 }).then(() => true, () => false)) return;
      await pg.click('#avprev');
    }
    throw new Error('the starters\' week never came up on availability');
  };
  await p.click('.tabbar button[data-tab=academy]'); await p.waitForSelector('#goAvail');
  await toWeek(p);
  await p.click('.avrow[data-av="' + sara.id + '"]'); await p.waitForSelector('#avcam', { state: 'attached' });
  ok(await p.$eval('#avphview', b => b.hidden) && await p.$eval('#avphadj', b => b.hidden), 'no photo yet: nothing to look at or adjust');
  await p.setInputFiles('#avcam', { name: 'IMG_0420.jpg', mimeType: 'image/jpeg', buffer: camera });
  await p.waitForSelector('#cropok'); await p.click('#cropok');
  ok(await toastIs(/Photo saved/), 'taken, framed, ✅ Use photo → "Photo saved ✓"');
  const sent = asked.filter(a => a.action === 'saveStarterPhoto').pop();
  ok(sent && sent.data > 5000 && sent.data <= 120000 && sent.hd > sent.data * 2 && sent.hd <= 1300000,
    'the phone sends two: the small copy for lists (' + Math.round(sent.data / 1000) + 'k characters) and the full-size photo (' + Math.round(sent.hd / 1000) + 'k)');
  const saraRow = await rowOf(sara.id), big = await api(maker, 'starterPhoto', { id: sara.id }), small = (await api(maker, 'availPhotos', { weekEnding: WE })).photos[sara.id];
  const bigL = await look(big.data), smallL = await look(small);
  ok(saraRow.has_photo && saraRow.photo_hd && big.hd && bigL.w === 1440 && bigL.h === 1716 && bigL.line < 100,
    'kept at full size: ' + bigL.w + ' × ' + bigL.h + ', and a hair-thin line is still black in it (' + bigL.line + ' on a scale where 0 is black and 255 is white)');
  ok(smallL.w === 480 && smallL.h === 572 && smallL.line > bigL.line + 50,
    'the small copy the lists use is still 480 × 572 (all that was kept until 23 Nov): the same line has faded to grey in it (' + smallL.line + ')');
  ok(await refused(booker, 'starterPhoto', { id: sara.id }) === 'Not allowed' && (await api(booker, 'availPhotos', { weekEnding: WE })).photos[sara.id] === small,
    'the full-size photo is for the people who make the poster and the badges: a booker is refused it (they still see the small picture)');

  console.log('looking at it, and saving it');
  ok(!(await p.$eval('#avphview', b => b.hidden)), 'the sheet now has 🔍 Full size');
  const calls0 = asked.filter(a => a.action === 'starterPhoto').length;
  await p.click('#avphview'); await p.waitForSelector('#pvimg[data-size]');
  ok(await p.$eval('#pvimg', i => i.dataset.size) === '1440x1716' && (await p.innerText('#pvsize')) === 'Full size · 1440 × 1716' && await p.$eval('#pvnote', n => n.hidden) &&
    asked.filter(a => a.action === 'starterPhoto').length === calls0,
    'tap it: their photo at "Full size · 1440 × 1716" (the phone that took it already has it, so nothing is fetched)');
  await shot('1-photo-full-size');
  await p.waitForFunction(() => !document.getElementById('pvsave').disabled);
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#pvsave')]);
  const saved = fs.readFileSync(await dl.path());
  fs.writeFileSync(path.join(SHOTS, '2-saved-' + dl.suggestedFilename()), saved);
  const savedL = await look('data:image/jpeg;base64,' + saved.toString('base64'));
  ok(dl.suggestedFilename() === 'Sara Adeyemi.jpg' && savedL.w === 1440 && savedL.h === 1716 && savedL.line < 100,
    '⬇️ Save → "Sara Adeyemi.jpg", the full-size photo itself (' + savedL.w + ' × ' + savedL.h + ', ' + Math.round(saved.length / 1024) + ' KB)');
  await p.click('#pvx');

  console.log('another phone, the poster and a badge');
  // A second phone (nothing kept from the camera): it has to ask for the full-size photo, once
  const ctx2 = await browser.newContext(PHONE);
  await ctx2.clock.setSystemTime(new Date(Date.now() + CLOCK_OFF));
  await ctx2.addInitScript(t => { try { if (!localStorage.getItem('lr_tok')) localStorage.setItem('lr_tok', JSON.stringify(t)); } catch (e) {} }, maker);
  const q = await ctx2.newPage(), asked2 = [];
  q.on('request', r => { if (r.method() === 'POST' && /\/api$/.test(new URL(r.url()).pathname)) { try { const b = JSON.parse(r.postData() || '{}'); asked2.push(b.action + (b.id ? ':' + b.id : '')); } catch (e) { /* not ours */ } } });
  const big2 = () => asked2.filter(a => a === 'starterPhoto:' + sara.id).length;
  // Omar's photo is from before: only the small copy exists (as a phone on the old version, or a photo before 23 Nov)
  await api(maker, 'saveStarterPhoto', { id: omar.id, data: small });
  await api(maker, 'saveBadge', { id: sara.id, badge_no: '90145' }); await api(maker, 'saveBadge', { id: omar.id, badge_no: '90146' });
  const art = await p.evaluate(() => { const c = document.createElement('canvas'); c.width = 2270; c.height = 725; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 2270, 725); g.fillStyle = '#6B1FAD'; g.fillRect(0, 0, 988, 284); return c.toDataURL('image/png'); });
  await api(maker, 'saveBadgeArt', { art: { ndcs: art } });
  await q.goto(APP + 'index.html'); await q.waitForSelector('.tabbar button');
  await q.click('.tabbar button[data-tab=academy]'); await q.waitForSelector('#goAvail');
  await toWeek(q);
  await q.waitForSelector('.avrow[data-av="' + sara.id + '"] img.avph');
  ok(big2() === 0, 'the list shows the small pictures: nobody\'s full-size photo is fetched just to look at the list');
  await q.click('#avposter'); await q.waitForSelector('#avpimg');
  ok(big2() === 1 && !asked2.includes('starterPhoto:' + omar.id) && await q.$eval('#avpimg', i => new Promise(r => { const d = () => r(i.naturalWidth === 1536); if (i.complete) d(); else i.onload = d; })),
    '📸 Poster: made from the full-size photo (fetched once); Omar, with only a small one, is drawn from that');
  await q.screenshot({ path: path.join(SHOTS, '3-poster.png') });
  await q.click('#avpx');
  await q.click('.avrow[data-av="' + omar.id + '"]'); await q.waitForSelector('#avphview'); await q.click('#avphview'); await q.waitForSelector('#pvimg[data-size]');
  ok((await q.innerText('#pvsize')) === 'Low-res photo · 480 × 572' && /taken before photos were kept at full size.*Take it again/.test(await q.innerText('#pvnote')),
    'an old photo says what it is: "' + (await q.innerText('#pvsize')) + '" · "' + (await q.innerText('#pvnote')) + '"');
  await q.screenshot({ path: path.join(SHOTS, '4-photo-low-res.png') });
  await q.click('#pvx'); await q.click('#avcancel');
  await q.click('.tabbar button[data-tab=academy]'); await q.waitForSelector('#goBadges'); await q.click('#goBadges'); await q.waitForSelector('.bdrow');
  const low = await q.innerText('#bdlow');
  ok(/1 low-res photo/.test(low) && /Omar/.test(low) && !/Sara/.test(low) && /take the photo again first/.test(low), 'Badges says whose badge would print soft, by name, before it\'s printed: "' + low.replace(/\s+/g, ' ') + '"');
  await q.screenshot({ path: path.join(SHOTS, '5-badges-low-res.png') });
  const before = big2();
  await q.click('[data-bdprint=ndcs]'); await q.waitForSelector('.pdfprev canvas');
  ok(big2() === before && /Preview · 1 page\b/i.test(await q.innerText('.pdfprev')), 'a badge print uses the full-size photo too (this phone already has Sara\'s from the poster: not fetched twice)');
  await q.click('.pdfprev .sheetx');
  // Retaken on the first phone: the second one fetches the new one before it prints
  await p.click('#avphadj'); await p.waitForSelector('#cropok'); await p.click('#cropok');
  const adj = await toastIs(/Photo saved/) && await look((await api(maker, 'starterPhoto', { id: sara.id })).data);
  // (no face in the test's picture, so the framing screen offers the middle two thirds of it: 950 of the 1440 px)
  ok(adj && (await rowOf(sara.id)).photo_at !== saraRow.photo_at && adj.w > 900 && adj.w <= 1440 && adj.line < 100,
    '✂️ Adjust cuts the new frame from the full-size photo: ' + adj.w + ' px of real detail, never blown up (it used to be cut again from the 480 px copy, about 317 px)');
  await q.click('[data-bdprint=ndcs]'); await q.waitForSelector('.pdfprev canvas');
  ok(big2() === before + 1, 'a photo changed on another phone since: the print fetches the new full-size one first');
  await q.click('.pdfprev .sheetx');
  await ctx2.close();

  console.log('an old phone, taking it off, and six months on');
  await api(maker, 'saveStarterPhoto', { id: sara.id, data: small });  // a phone still on the old version sends only the small copy
  ok(!(await rowOf(sara.id)).photo_hd && !(await api(maker, 'starterPhoto', { id: sara.id })).data,
    'a new photo with no full-size copy (a phone not updated yet): the old full-size one goes with the old photo, never left beside a different picture');
  await api(maker, 'saveStarterPhoto', { id: sara.id, data: small, hd: big.data });
  await api(maker, 'saveStarterPhoto', { id: sara.id, data: '' });
  ok(!(await rowOf(sara.id)).has_photo && !(await api(maker, 'starterPhoto', { id: sara.id })).data && !(await api(maker, 'availPhotos', { weekEnding: WE })).photos[sara.id], 'photo removed: both copies are gone');
  ok(/didn't come through/.test(await refused(maker, 'saveStarterPhoto', { id: sara.id, data: small, hd: 'data:image/jpeg;base64,' + 'A'.repeat(1500001) })) &&
    /didn't come through/.test(await refused(maker, 'saveStarterPhoto', { id: sara.id, data: small, hd: 'data:text/html;base64,PHNjcmlwdD4=' })), 'a full-size photo over the limit, or anything that isn\'t a JPEG, is refused');
  await api(maker, 'saveStarterPhoto', { id: sara.id, data: small, hd: big.data });
  await setTime('2027-05-24T10:00:00+00:00');  // 25 weeks after their Day 1 week
  maker = await loginApi(makerEmail);  // six months on: signed in again
  const kept = await ev('trimHdPhotos()'), row25 = await rowOf(sara.id);
  await setTime('2027-06-07T10:00:00+00:00');  // 27 weeks after
  const gone = await ev('trimHdPhotos()'), again = await ev('trimHdPhotos()');
  const after = await api(maker, 'starterPhoto', { id: sara.id }), still = (await api(maker, 'availPhotos', { weekEnding: WE })).photos[sara.id];
  const logLine = await ev("readTable('Log').filter(l => l.action === 'photos_trimmed').map(l => l.user + ': ' + l.detail).join(' | ')");
  ok(kept === 0 && row25.photo_hd && gone === 1 && again === 0 && !after.data && !(await rowOf(sara.id)).photo_hd && still === small,
    'the full-size copy is kept 26 weeks (as long as a badge can be reprinted), then goes; the small copy stays for good (' + logLine + ')');

  await browser.close();
  require('./watch').report(pageErrors); passed++;
  console.log('\nALL ' + passed + ' PHOTO CHECKS PASSED (' + (process.env.JL_BACKEND === 'pg' ? 'Supabase back end' : 'Google back end') + ')');
  process.exit(0);
})().catch(e => { console.error('\nFAILED:', e); process.exit(1); });
