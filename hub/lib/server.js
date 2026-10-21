// The hub's API: POST /api/code, /api/verify, /api/logout, /api/connect · GET /api/me, /api/go?app=…&r=…
// Settings (Vercel → link-juss → Environment Variables): DATABASE_URL, DATABASE_PASSWORD, RELAY_URL, RELAY_SECRET, HUB_SECRET,
// HUB_LAUNCHED=1 once it's open to everyone (before that, codes are only emailed to MAIL_ALLOW).
'use strict';
const core = require('./core');

const COOKIE = 'lj_hub';
let DB = null, MIGRATED = false;

function db() {
  if (!DB) {
    const postgres = require('postgres');
    const sql = postgres(process.env.DATABASE_URL, { password: process.env.DATABASE_PASSWORD, max: 3, prepare: false, idle_timeout: 20, connect_timeout: 15, onnotice: () => {} });
    DB = { q: (t, p) => sql.unsafe(t, p || []), exec: t => sql.unsafe(t), sql };
  }
  return DB;
}
/** Create the core tables once per server instance (several statements: a plain, unprepared query). */
async function ready(exec) { if (!MIGRATED) { await exec(core.SCHEMA); MIGRATED = true; } }

/** Login codes go out from Gmail through the recruitment app's Google relay. */
async function sendCodeEmail(email, code) {
  const allow = String(process.env.MAIL_ALLOW || 'angad@linkmarketing.org.uk').toLowerCase().split(/[,\s]+/);
  if (process.env.HUB_LAUNCHED !== '1' && !allow.includes(email)) { console.log('not launched: code not emailed to', email.replace(/^(.).*@/, '$1…@')); return; }
  const html = '<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:420px;margin:0 auto;padding:24px;color:#22222B">' +
    '<div style="height:6px;border-radius:3px;background:linear-gradient(90deg,#F15A24,#EDA03A 55%,#3BB4C1)"></div>' +
    '<p style="font-size:15px;margin:22px 0 6px">Your LINK × JUSS login code:</p>' +
    '<p style="font-size:40px;letter-spacing:8px;font-weight:700;margin:0 0 18px">' + code + '</p>' +
    '<p style="font-size:13px;color:#6E6C78;margin:0">It works for 10 minutes. If you didn\'t ask for it, ignore this email.</p></div>';
  const res = await fetch(process.env.RELAY_URL, { method: 'POST', headers: { 'content-type': 'text/plain' }, signal: AbortSignal.timeout(60000),
    body: JSON.stringify({ action: 'relayMail', secret: process.env.RELAY_SECRET, mail: { via: 'mail', msg: { to: email, subject: code + ' is your LINK × JUSS login code', htmlBody: html, name: 'LINK × JUSS' } } }) });
  const j = JSON.parse(await res.text());
  if (!j.ok) throw new Error('relay: ' + j.error);
}

/** "You're a Leader now": in their brand, from Gmail via the relay. Same launch rule as the codes. */
async function sendCongrats(email, name, company, opened) {
  const allow = String(process.env.MAIL_ALLOW || 'angad@linkmarketing.org.uk').toLowerCase().split(/[,\s]+/);
  if (process.env.HUB_LAUNCHED !== '1' && !allow.includes(email)) return;
  const juss = company === 'JUSS', stripe = juss ? 'linear-gradient(90deg,#E4613F,#EDA03A 45%,#34B1C0)' : 'linear-gradient(90deg,#FF8A3D,#F15A24 55%,#CF3A10)';
  const first = String(name || '').split(' ')[0] || 'there', brand = juss ? 'JUSS Marketing' : 'LINK Marketing';
  // Stage 3 is inside each company's playbook (21 Oct)
  const pb = juss ? 'JUSS Playbook' : 'Link Org Playbook';
  const html = '<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:440px;margin:0 auto;padding:24px;color:#22222B">' +
    '<div style="height:6px;border-radius:3px;background:' + stripe + '"></div>' +
    '<p style="font-size:24px;font-weight:700;margin:22px 0 8px">You\'re a Leader, ' + first + ' 🎉</p>' +
    '<p style="font-size:15px;margin:0 0 16px">You\'ve been moved on to <b>Stage 3 · Leader</b> at ' + brand + '. ' +
    (opened ? 'Stage 3 is open now in your ' + pb + '.' : 'Stage 3 opens in your ' + pb + ' as soon as your login is ready.') + '</p>' +
    '<p style="margin:0 0 18px"><a href="https://link-juss.vercel.app/" style="display:inline-block;background:#22222B;color:#fff;text-decoration:none;padding:13px 20px;border-radius:12px;font-weight:600">Open my apps</a></p>' +
    '<p style="font-size:13px;color:#6E6C78;margin:0">Sign in with this email address; we\'ll send you a code.</p></div>';
  const res = await fetch(process.env.RELAY_URL, { method: 'POST', headers: { 'content-type': 'text/plain' }, signal: AbortSignal.timeout(60000),
    body: JSON.stringify({ action: 'relayMail', secret: process.env.RELAY_SECRET, mail: { via: 'mail', msg: { to: email, subject: 'You\'re a Leader 🎉 Stage 3 is open', htmlBody: html, name: brand } } }) });
  const j = JSON.parse(await res.text());
  if (!j.ok) throw new Error('relay: ' + j.error);
}

function cookieToken(req) {
  const m = new RegExp('(?:^|;\\s*)' + COOKIE + '=([^;]+)').exec(req.headers.cookie || '');
  return m ? decodeURIComponent(m[1]) : '';
}
function setCookie(res, token, maxAge) {
  res.setHeader('set-cookie', COOKIE + '=' + encodeURIComponent(token) + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + maxAge);
}
function json(res, code, body) { res.statusCode = code; res.setHeader('content-type', 'application/json; charset=utf-8'); res.setHeader('cache-control', 'no-store'); res.end(JSON.stringify(body)); }
function body(req) {
  let b = req.body;
  if (Buffer.isBuffer(b)) b = b.toString('utf8');
  if (typeof b === 'string') { try { b = JSON.parse(b || '{}'); } catch (e) { b = {}; } }
  return b && typeof b === 'object' ? b : {};
}
/** Only send people back to a path on the app, never to another site. */
function safePath(r) { const s = String(r || '/'); return /^\/(?!\/)[^\s]*$/.test(s) ? s : '/'; }

/** One handler for every /api/* path (opts.q / opts.sendMail / opts.bcrypt are swapped in by the tests). */
async function handle(req, res, opts) {
  const o = opts || {};
  const q = o.q || db().q, exec = o.exec || db().exec, sendMail = o.sendMail || sendCodeEmail, bcrypt = o.bcrypt || require('bcryptjs');
  const notify = o.notify || sendCongrats;
  const url = new URL(req.url, 'https://hub.local');
  const action = url.pathname.replace(/^\/api\//, '').replace(/\/$/, '');
  try {
    await ready(exec);
    if (action === 'code' && req.method === 'POST') return json(res, 200, await core.requestCode(q, body(req).email, sendMail));
    if (action === 'verify' && req.method === 'POST') {
      const b = body(req), r = await core.verifyCode(q, b.email, b.code);
      if (!r.ok) return json(res, 200, r);
      setCookie(res, r.token, 90 * 86400);
      return json(res, 200, Object.assign({ ok: true }, await core.home(q, r.person)));
    }
    const person = await core.sessionPerson(q, cookieToken(req));
    if (action === 'me') return json(res, 200, person ? Object.assign({ ok: true }, await core.home(q, person)) : { ok: false, auth: true });
    if (action === 'logout' && req.method === 'POST') { await core.logout(q, cookieToken(req)); setCookie(res, '', 0); return json(res, 200, { ok: true }); }
    if (action === 'go') {
      let app = url.searchParams.get('app'), r = safePath(url.searchParams.get('r'));
      // Each Leaders Playbook is Stage 3 of its company's playbook now (21 Oct): old links land on its Stage 3 pages
      if (app === 'leaders') { app = 'fr'; r = '/leaders/playbook'; }
      if (app === 'jleaders') { app = 'hf'; r = '/leaders/playbook'; }
      if (!core.APPS[app]) return json(res, 400, { ok: false, error: 'Unknown app' });
      if (!person) { res.statusCode = 302; res.setHeader('location', '/?app=' + encodeURIComponent(app) + '&r=' + encodeURIComponent(r)); return res.end(); }
      const code = await core.createHandoff(q, person, app);
      res.statusCode = 302;
      res.setHeader('cache-control', 'no-store');
      res.setHeader('location', code ? core.APPS[app].handoff + '#hub=' + code + '&r=' + encodeURIComponent(r) : '/?noaccount=' + encodeURIComponent(app));
      return res.end();
    }
    if (action === 'connect' && req.method === 'POST') {
      if (!person) return json(res, 200, { ok: false, auth: true });
      const b = body(req), r = await core.connectHf(q, person, b.username, b.password, bcrypt);
      return json(res, 200, r.ok ? Object.assign({ ok: true }, await core.home(q, person)) : r);
    }
    if (!person && ['team', 'promote', 'approvers'].includes(action)) return json(res, 200, { ok: false, auth: true });
    if (action === 'team') return json(res, 200, await core.team(q, person));
    if (action === 'promote' && req.method === 'POST') { const b = body(req); return json(res, 200, await core.promote(q, person, b.app, b.id, notify)); }
    if (action === 'approvers' && req.method === 'POST') { const b = body(req); return json(res, 200, await core.setApprover(q, person, b.email, !!b.on)); }
    if (action === 'approvers') return json(res, 200, await core.approvers(q, person));
    return json(res, 404, { ok: false, error: 'Not found' });
  } catch (e) {
    console.error(action, e);
    return json(res, 200, { ok: false, error: 'Something went wrong. Try again in a moment.' });
  }
}

module.exports = { handle, COOKIE };
