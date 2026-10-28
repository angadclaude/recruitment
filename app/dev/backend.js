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

(async () => {
  console.log('Back end (PGlite)');
  await claims();
  await spoilt();
  await outbox();
  console.log(fails ? '\n' + fails + ' FAILED' : '\nALL BACK END CHECKS PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
