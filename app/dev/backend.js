// The Vercel back end's own safety nets, on PGlite (no network): node app/dev/backend.js
// 1. A once-a-day alert is claimed (and saved) before it goes out: a failure later in the same 5-minute run can't undo the
//    claim and send it again 5 minutes later.
// 2. A database step that fails inside a job fails the job (rolled back, the phone retries), even when Code.gs catches the
//    error and carries on: never a silent rollback reported as saved.
// 3. An email is claimed before it's sent: the 5-minute retry landing while it's with Google can't send it twice. A failed one
//    is retried; copies are kept 14 days.
'use strict';
process.env.RELAY_URL = 'https://relay.invalid/exec'; process.env.RELAY_SECRET = 'x'.repeat(40);
const { PGlite } = require('@electric-sql/pglite');
const { Runtime } = require('../../server/runtime');
const { SCHEMA, pgliteAdapter } = require('../../server/db');
const { _test } = require('../../server/live');

let fails = 0;
const ok = (cond, what) => { console.log((cond ? '  ✓ ' : '  ✗ ') + what); if (!cond) fails++; };

async function claims() {
  const db = await pgliteAdapter(); await db.migrate();
  const rt = new Runtime({ db, testMode: true, env: {} });
  const offset = Date.UTC(2026, 9, 28, 18, 5) - Date.now();  // Wed 28 Oct 2026 18:05 London (GMT)
  await rt.run({ type: 'eval', js: `__offset = ${offset};
    const p = PropertiesService.getScriptProperties(); p.setProperty('ONESIGNAL_APP_ID', 'a'); p.setProperty('ONESIGNAL_API_KEY', 'k');
    appendRow('Users', { id: 'jess1', name: 'Jess Grace', email: 'jess@linkmarketing.org.uk', company: 'LINK', roles: 'admin', active: 'TRUE' });
    appendRow('Bookings', { id: 'b1', booked_by_id: 'jess1', booked_by: 'Jess Grace', first_name: 'Lucy', last_name: 'Test', mobile: '07700900001',
      slot_date: '2026-10-29', slot_time: '10:00', company: 'JUSS', status: 'booked' }); 1` });
  // The 18:00 run sends the reminder, then a later step in the same run fails (a database timeout)
  const tick = () => rt.run({ type: 'eval', js: `maybeBookingReminders(); throw new Error('Service error: the database query took over 25 s')` }).catch(e => e.message);
  await tick(); await tick();
  const pushes = (await rt.run({ type: 'pushes' })).filter(x => /to remind for tomorrow/.test(x.body.headings.en));
  const saved = await rt.withDb(q => q("select val from jl.props where key = 'BOOK_REMINDED'"));
  ok(pushes.length === 1 && saved.length === 1 && saved[0].val === '2026-10-28',
    'the 18:00 booking reminder goes once, though the run fails after it twice (' + pushes.length + ' sent; claim saved: ' + (saved[0] || {}).val + ')');
  await rt.stop(); await db.end();
}

async function spoilt() {
  const db = await pgliteAdapter(); await db.migrate();
  const rt = new Runtime({ db, testMode: true, env: {} });
  // A save, then a database step that fails and is caught (like log() or a cache write), then "done"
  const err = await rt.run({ type: 'eval', js: `
    PropertiesService.getScriptProperties().setProperty('SAVED_BEFORE', 'yes');
    try { const b = SpreadsheetApp.getActive(), s = b.insertSheet('Tmp'); b.deleteSheet(s); s.appendRow(['h']); s.appendRow(['x']); } catch (e) { }
    'reported as saved'` }).then(v => 'resolved: ' + v, e => e);
  const kept = await rt.withDb(q => q("select val from jl.props where key = 'SAVED_BEFORE'"));
  ok(err instanceof Error && err.retry === true && /Trying again/.test(err.message) && !kept.length,
    'a failed database step that Code.gs caught fails the job ("Trying again…", the phone retries): ' + (err.message || err).slice(0, 70));
  // …and the next job runs normally
  const next = await rt.run({ type: 'eval', js: `PropertiesService.getScriptProperties().setProperty('NEXT', 'ok'); 'fine'` });
  ok(next === 'fine' && (await rt.withDb(q => q("select val from jl.props where key = 'NEXT'"))).length === 1, 'the next job saves as normal');
  await rt.stop(); await db.end();
}

async function outbox() {
  let relayCalls = 0, failNext = false;
  global.fetch = async (url, o) => {  // Google's relay: 1.5 s, like a slow Apps Script
    const b = JSON.parse(o.body); if (b.action === 'relayMail') relayCalls++;
    await new Promise(r => setTimeout(r, 1500));
    if (b.action === 'relayMail' && failNext) { failNext = false; return { status: 200, text: async () => JSON.stringify({ ok: false, error: 'Gmail said no' }) }; }
    return { status: 200, text: async () => JSON.stringify({ ok: true, data: { sent: true } }) };
  };
  const pg = new PGlite(); await pg.waitReady; await pg.exec(SCHEMA);
  const sql = (s, ...v) => pg.query(s.reduce((a, x, i) => a + '$' + i + x), v).then(r => r.rows);
  const relay = _test.relay({ sql });
  const add = async (who, ago) => (await sql`insert into jl.outbox (payload, created_at) values (${JSON.stringify({ via: 'gmail', to: who, subject: 'Welcome', body: 'hi', opts: {} })}::jsonb,
    now() - ${ago || '0 seconds'}::interval) returning id::text as id`)[0].id;
  // Sent straight after its job; the 5-minute retry lands 0.3 s later, while Google is still answering
  const id = await add('new.starter@example.com');
  const job = relay.deliver([id]);
  await new Promise(r => setTimeout(r, 300));
  await Promise.all([job, relay.retry()]);
  const row = (await sql`select tries, sent_at is not null as sent from jl.outbox where id = ${id}::bigint`)[0];
  ok(relayCalls === 1 && row.sent && row.tries === 1, 'an email with Google when the 5-minute retry lands goes once (' + relayCalls + ' sent)');
  // Google says no: it's tried again at the next retry
  relayCalls = 0; failNext = true;
  const id2 = await add('second@example.com');
  await relay.deliver([id2]).catch(() => {});
  await relay.retry();
  const row2 = (await sql`select tries, sent_at is not null as sent from jl.outbox where id = ${id2}::bigint`)[0];
  ok(relayCalls === 2 && row2.sent && row2.tries === 2, 'one Google refused is sent at the next retry (' + relayCalls + ' tries)');
  // A server copy that stopped mid-send (claimed 6 minutes ago, never sent): the retry picks it up
  relayCalls = 0;
  const id3 = await add('third@example.com');
  await sql`update jl.outbox set claimed_at = now() - interval '6 minutes' where id = ${id3}::bigint`;
  await relay.retry();
  ok(relayCalls === 1 && (await sql`select sent_at is not null as sent from jl.outbox where id = ${id3}::bigint`)[0].sent, 'one claimed by a server copy that stopped is sent by the retry');
  // GDPR: a copy older than 14 days is gone
  const old = await add('old@example.com', '15 days');
  await relay.retry();
  ok(!(await sql`select 1 from jl.outbox where id = ${old}::bigint`).length && (await sql`select 1 from jl.outbox where id = ${id}::bigint`).length === 1,
    'emails older than 14 days are deleted; newer ones are kept');
  await pg.close();
}

// 4. The live copy in the Google Sheet (server/mirror.js): a starter's photo (too long for a Sheet cell) goes as a note, and a
//    tab Google refuses is skipped and tried again, never in the way of the tabs after it (11 Nov: Users stood still 9 days).
async function mirror() {
  const { mirrorToSheet, CELL_MAX } = require('../../server/mirror');
  const photo = 'data:image/jpeg;base64,' + 'A'.repeat(140000);
  const tabs = { Candidates: [['c1', 'Lucy Test']], Codes: [['x']], StarterPhotos: [['a1', photo, '2026-11-02 10:40']], Users: [['u1', 'Christie Zammit']],
    Log: [['2026-11-02 10:00', 'x'.repeat(CELL_MAX + 500)]] };
  const props = {}, got = {}; let refuse = 'Candidates', calls = 0;
  const sql = (str, ...v) => {
    const q = str.join('?');
    if (/from jl\.tabs/.test(q)) return Promise.resolve(Object.keys(tabs).sort().map(n => ({ name: n, headers: ['id', 'b', 'c'] })));
    if (/from jl\.rows/.test(q)) return Promise.resolve(tabs[v[0]].map(r => ({ vals: r })));
    if (/^select val from jl\.props/.test(q.trim())) return Promise.resolve(props[v[0]] ? [{ val: props[v[0]] }] : []);
    if (/insert into jl\.props/.test(q)) { props[v[0]] = v[1]; return Promise.resolve([]); }
    throw new Error('unexpected query: ' + q);
  };
  const relay = (action, x) => {  // Google: refuses the tab it's told to, and any cell over its limit
    calls++;
    if (x.tab === refuse) return Promise.reject(new Error('Service Spreadsheets failed'));
    if (x.rows.some(r => r.some(c => String(c).length > CELL_MAX))) return Promise.reject(new Error('Your input contains more than the maximum of 50000 characters in a single cell.'));
    got[x.tab] = x.rows; return Promise.resolve({ tab: x.tab, rows: x.rows.length });
  };
  const err = console.error; console.error = () => {};
  const first = await mirrorToSheet(sql, relay);
  ok(got.StarterPhotos && got.StarterPhotos[0][1] === '(picture: in the app)' && got.StarterPhotos[0][0] === 'a1' && got.StarterPhotos[0][2] === '2026-11-02 10:40',
    'live copy: a starter\'s photo (140,000 characters, a Sheet cell holds 50,000) goes as "(picture: in the app)", its id and date kept');
  ok(got.Users && got.Users[0][1] === 'Christie Zammit' && first.some(x => x.tab === 'Candidates' && /Spreadsheets failed/.test(x.error)) && !got.Candidates,
    'live copy: a tab Google refuses is reported and skipped; the tabs after it (Users) are still copied');
  ok(got.Log && got.Log[0][1].length === CELL_MAX && /cut: too long for a Sheet cell/.test(got.Log[0][1]), 'live copy: any other cell too long for the Sheet is cut with a note, so its tab still goes');
  ok(!got.Codes && !first.some(x => x.tab === 'Codes'), 'live copy: never the login tabs');
  refuse = ''; calls = 0;
  const second = await mirrorToSheet(sql, relay);
  console.error = err;
  ok(calls === 1 && second.length === 1 && second[0].tab === 'Candidates' && second[0].rows === 1 && got.Candidates,
    'live copy: 5 minutes later only the refused tab is sent again (' + calls + ' call); unchanged tabs are left alone');
}

// 5. A tab's columns only ever grow at the end. Rows are written by column position, so readTable refuses a tab whose columns
//    don't start with the ones it knows. On 11 Nov a new column went into the middle of the Candidates list: every harness
//    passed (they build their tabs fresh, in the new order) and the live app, whose tab has the old order, stopped reading
//    candidates for 25 minutes. app/dev/columns.json is the columns the live data has: this code must start with exactly
//    those, and must read tabs built with them. Adding a column: put it LAST in SHEETS in Code.gs, then add it last here too.
async function columns() {
  const fs = require('fs'), path = require('path'), vm = require('vm');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'Code.gs'), 'utf8'), i = src.indexOf('const SHEETS = '), j = src.indexOf('\n};', i);
  const now = vm.runInNewContext('(' + src.slice(i + 15, j + 2) + ')'), live = require('./columns.json');
  Object.keys(live).forEach(t => {
    const at = live[t].findIndex((h, k) => !now[t] || now[t][k] !== h);
    ok(at < 0, t + ': the ' + live[t].length + ' columns the live data has are still the first ' + live[t].length + ', in order' +
      (at < 0 ? (now[t].length > live[t].length ? ' (+ ' + now[t].slice(live[t].length).join(', ') + ' at the end)' : '')
        : ' ✗ column ' + (at + 1) + ' is "' + ((now[t] || [])[at] || 'missing') + '" where the live tab has "' + live[t][at] + '": a new column goes LAST in SHEETS, never in the middle'));
  });
  ok(Object.keys(now).every(t => live[t]), 'every tab is listed in app/dev/columns.json (' + Object.keys(now).filter(t => !live[t]).join(', ') + ')');
  // …and tabs as the live data has them (those headers, a row that wide) are read by this code, both ways round
  const db = await pgliteAdapter(); await db.migrate();
  const rt = new Runtime({ db, testMode: true, env: {} });
  const out = await rt.run({ type: 'eval', js: `(() => { const LIVE = ${JSON.stringify(live)}, bad = [];
    setup();
    Object.keys(LIVE).forEach(n => { try {
      const sh = sheet(n), w = LIVE[n].length;
      sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).clearContent();
      sh.getRange(1, 1, 2, w).setValues([LIVE[n].slice(), LIVE[n].map((h, k) => (k ? h + '!' : 'row1'))]);
      delete MEMO[n];
      const r = readTable(n).filter(x => x.id === 'row1' || x[LIVE[n][0]] === 'row1')[0];
      if (!r || LIVE[n].some((h, k) => k && r[h] !== h + '!')) bad.push(n + ': a value came back under the wrong column');
      else if (SHEETS[n].slice(LIVE[n].length).some(h => r[h] !== '')) bad.push(n + ': a new column is not empty');
    } catch (e) { bad.push(n + ': ' + e.message); } });
    return JSON.stringify(bad); })()` });
  ok(out === '[]', 'tabs with the live data\'s columns are read by this code, every value under its own column' + (out === '[]' ? '' : ' ✗ ' + out));
  await rt.stop(); await db.end();
}

(async () => {
  console.log('Back end (PGlite)');
  await claims();
  await spoilt();
  await outbox();
  await mirror();
  await columns();
  console.log(fails ? '\n' + fails + ' FAILED' : '\nALL BACK END CHECKS PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
