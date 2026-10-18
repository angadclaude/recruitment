// Hub checks on PGlite (in-memory Postgres) with pretend users in each app's tables. Usage: node hub/dev/test.js
'use strict';
const path = require('path');
const { PGlite } = require(path.join(__dirname, '..', 'node_modules', '@electric-sql', 'pglite'));
const bcrypt = require(path.join(__dirname, '..', 'node_modules', 'bcryptjs'));
const core = require('../lib/core');
const { handle, COOKIE } = require('../lib/server');

let fails = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };

(async () => {
  const db = new PGlite();
  const q = async (t, p) => (await db.query(t, p || [])).rows;
  const exec = t => db.exec(t);
  // The apps' tables as they are in Supabase (only the columns the hub reads)
  await exec(`
    create schema jl; create table jl.tabs (name text primary key, headers jsonb); create table jl.rows (rid bigserial primary key, tab text, pos bigserial, vals jsonb);
    insert into jl.tabs values ('Users', '["id","name","email","company","roles","active","created_at","onesignal"]');
    insert into jl.rows (tab, vals) values ('Users', '["u1","Angad Oshan","angad@linkmarketing.org.uk","LINK","admin","TRUE","",""]'),
      ('Users', '["u2","Gone Person","gone@linkmarketing.org.uk","LINK","booker","FALSE","",""]');
    create table public.users (id varchar primary key default gen_random_uuid(), username text, password text, display_name text, role text);
    insert into public.users (username, password, display_name, role) values ('angad@linkmarketing.org.uk', 'x', 'Angad', 'manager'), ('ba@example.com', 'x', 'Bea Ambassador', 'user');
    create schema leaders; create table leaders.users (id varchar primary key default gen_random_uuid(), email text, password text, display_name text, role text);
    insert into leaders.users (email, password, display_name, role) values ('Angad@LinkMarketing.org.uk', 'x', 'Angad', 'manager');
    create schema hf; create table hf.users (id serial primary key, username text, password_hash text, full_name text, role text);
  `);
  await q('insert into hf.users (username, password_hash, full_name, role) values ($1, $2, $3, $4), ($5, $6, $7, $8)',
    ['jdoe', bcrypt.hashSync('old-pass', 4), 'Jo Doe', 'rep', 'sam@jussmarketing.co.uk', bcrypt.hashSync('x', 4), 'Sam Juss', 'rep']);
  await exec(core.SCHEMA);

  const mail = [];
  const sendMail = async (email, code) => { mail.push({ email, code }); };

  // Codes
  await core.requestCode(q, 'nobody@example.com', sendMail);
  ok(mail.length === 0, 'unknown email: same "sent" answer, but nothing is emailed');
  ok((await core.requestCode(q, 'not-an-email', sendMail)).ok === false, 'not an email address: refused');
  await core.requestCode(q, '  BA@Example.com ', sendMail);
  ok(mail.length === 1 && mail[0].email === 'ba@example.com' && /^\d{6}$/.test(mail[0].code), 'a playbook user gets a 6-digit code (email tidied to lower case)');
  ok((await core.verifyCode(q, 'ba@example.com', '000000')).ok === false || mail[0].code === '000000', 'wrong code refused');
  const v = await core.verifyCode(q, 'ba@example.com', mail[0].code);
  ok(v.ok && v.token && v.person.email === 'ba@example.com' && v.person.name === 'Bea Ambassador' && v.person.company === 'LINK', 'right code: signed in, name and company found from the FR Playbook');
  ok((await core.verifyCode(q, 'ba@example.com', mail[0].code)).ok === false, 'a code works once');
  const tokenRows = await q('select token_hash from core.sessions');
  ok(tokenRows.length === 1 && tokenRows[0].token_hash !== v.token, 'only a hash of the session is stored');

  // Tries and limits
  await core.requestCode(q, 'ba@example.com', sendMail);
  for (let i = 0; i < 5; i++) await core.verifyCode(q, 'ba@example.com', '99999' + i);
  ok(/Too many tries/.test((await core.verifyCode(q, 'ba@example.com', mail[mail.length - 1].code)).error), '5 wrong tries: even the right code is refused until a new one is sent');
  for (let i = 0; i < 4; i++) await core.requestCode(q, 'ba@example.com', sendMail);
  ok(/Too many codes/.test((await core.requestCode(q, 'ba@example.com', sendMail)).error || ''), 'at most 5 codes an hour per email');
  await core.requestCode(q, 'angad@linkmarketing.org.uk', sendMail);
  await q("update core.codes set expires_at = now() - interval '1 minute' where email = 'angad@linkmarketing.org.uk'");
  ok(/expired/.test((await core.verifyCode(q, 'angad@linkmarketing.org.uk', mail[mail.length - 1].code)).error), 'after 10 minutes a code has expired');

  // Home tiles
  await core.requestCode(q, 'angad@linkmarketing.org.uk', sendMail);
  await q("update core.codes set window_start = now() - interval '2 hours' where email = 'angad@linkmarketing.org.uk'");
  const a = await core.verifyCode(q, 'angad@linkmarketing.org.uk', mail[mail.length - 1].code);
  const ah = await core.home(q, a.person);
  ok(ah.tiles.map(t => t.id).join(',') === 'recruit,fr,leaders' && ah.person.name === 'Angad Oshan', 'Angad sees Recruitment, FR and Leaders (found by email, any case); name from the recruitment app');
  await core.requestCode(q, 'gone@linkmarketing.org.uk', sendMail);
  ok(mail[mail.length - 1].email !== 'gone@linkmarketing.org.uk', 'switched off in the recruitment app and nowhere else: no code');

  // Handoffs
  const bea = await core.sessionPerson(q, v.token);
  const hc = await core.createHandoff(q, bea, 'fr');
  const red = await core.redeemHandoff(q, hc, 'fr');
  ok(red && red.email === 'ba@example.com' && red.account.name === 'Bea Ambassador', 'FR redeems the ticket: it gets her email and her FR account');
  ok((await core.redeemHandoff(q, hc, 'fr')) === null, 'a ticket works once');
  const hc2 = await core.createHandoff(q, bea, 'fr');
  ok((await core.redeemHandoff(q, hc2, 'leaders')) === null, 'a ticket for FR can\'t be used in another app');
  ok((await core.createHandoff(q, bea, 'leaders')) === null, 'no ticket for an app she has no account in');
  const hc3 = await core.createHandoff(q, bea, 'fr');
  await q("update core.handoffs set expires_at = now() - interval '1 second' where used_at is null");
  ok((await core.redeemHandoff(q, hc3, 'fr')) === null, 'an unused ticket expires after 2 minutes');

  // HelloFresh: connect an old username once
  await q("insert into jl.rows (tab, vals) values ('Users', '[\"u3\",\"Jo Doe\",\"jo@jussmarketing.co.uk\",\"JUSS\",\"booker\",\"TRUE\",\"\",\"\"]')");
  await core.requestCode(q, 'jo@jussmarketing.co.uk', sendMail);
  const jo = await core.verifyCode(q, 'jo@jussmarketing.co.uk', mail[mail.length - 1].code);
  let jh = await core.home(q, jo.person);
  ok(jh.canConnectHf && !jh.tiles.some(t => t.id === 'hf'), 'JUSS person whose HelloFresh username isn\'t her email: offered "connect your HelloFresh account"');
  ok((await core.connectHf(q, jo.person, 'jdoe', 'wrong', bcrypt)).ok === false, 'wrong old password: not connected');
  ok((await core.connectHf(q, jo.person, 'JDoe', 'old-pass', bcrypt)).ok === true, 'right old username + password: connected (once)');
  jh = await core.home(q, jo.person);
  ok(jh.tiles.some(t => t.id === 'hf') && !jh.canConnectHf, 'HelloFresh tile appears');
  const jt = await core.createHandoff(q, jo.person, 'hf');
  ok((await core.redeemHandoff(q, jt, 'hf')).account.name === 'Jo Doe', 'HelloFresh redeems her ticket to the connected account');
  await core.requestCode(q, 'sam@jussmarketing.co.uk', sendMail);
  const sam = await core.verifyCode(q, 'sam@jussmarketing.co.uk', mail[mail.length - 1].code);
  ok((await core.connectHf(q, sam.person, 'jdoe', 'old-pass', bcrypt)).error.includes('already connected'), 'someone else can\'t take an account that\'s already connected');
  ok((await core.home(q, sam.person)).tiles.map(t => t.id).join(',') === 'hf' && sam.person.company === 'JUSS', 'HelloFresh username that is an email: found straight away, company JUSS');

  // HTTP: cookie, redirects, safety
  const call = (method, url, b, cookie) => new Promise(resolve => {
    const res = { statusCode: 200, headers: {}, setHeader(k, val) { this.headers[k.toLowerCase()] = val; }, end(x) { resolve({ status: this.statusCode, headers: this.headers, body: x ? (/json/.test(this.headers['content-type'] || '') ? JSON.parse(x) : x) : null }); } };
    handle({ method, url, body: b ? JSON.stringify(b) : undefined, headers: { cookie: cookie || '' } }, res, { q, exec, sendMail, bcrypt });
  });
  await call('POST', '/api/code', { email: 'ba@example.com' }).then(() => q("update core.codes set window_start = now() - interval '2 hours', sends = 0 where email = 'ba@example.com'"));
  await call('POST', '/api/code', { email: 'ba@example.com' });
  const vr = await call('POST', '/api/verify', { email: 'ba@example.com', code: mail[mail.length - 1].code });
  const setc = vr.headers['set-cookie'] || '';
  ok(vr.body.ok && /HttpOnly/.test(setc) && /Secure/.test(setc) && /SameSite=Lax/.test(setc) && vr.body.tiles.length === 1, 'web: verify sets a secure, HttpOnly cookie and returns her tiles');
  const cookie = setc.split(';')[0];
  ok((await call('GET', '/api/me', null, cookie)).body.person.email === 'ba@example.com', 'web: /api/me knows her from the cookie');
  const g1 = await call('GET', '/api/go?app=fr&r=/home', null, '');
  ok(g1.status === 302 && g1.headers.location === '/?app=fr&r=%2Fhome', 'web: not signed in → the hub\'s login, then back to the app');
  const g2 = await call('GET', '/api/go?app=fr&r=/home', null, cookie);
  ok(g2.status === 302 && /^https:\/\/link-fr-playbook\.vercel\.app\/auth\/hub#hub=[\w-]{32}&r=%2Fhome$/.test(g2.headers.location), 'web: signed in → straight to the FR Playbook with a one-use ticket (in the #, never sent to servers in logs)');
  const g3 = await call('GET', '/api/go?app=fr&r=//evil.example', null, cookie);
  ok(/&r=%2F$/.test(g3.headers.location), 'web: only paths on the app itself, never another site');
  ok((await call('GET', '/api/go?app=leaders', null, cookie)).headers.location === '/?noaccount=leaders', 'web: no account there → back to the hub with a message');
  await call('POST', '/api/logout', null, cookie);
  ok((await call('GET', '/api/me', null, cookie)).body.auth === true, 'web: signed out → the cookie is useless');

  await db.close();
  console.log(fails ? '\n' + fails + ' FAILED' : '\nALL HUB CHECKS PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
