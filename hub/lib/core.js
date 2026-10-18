// The one login for every LINK × JUSS app (link-juss.vercel.app). Everything lives in the shared Supabase:
//   core.people     one row per person (by work email)
//   core.codes      the 6-digit email codes (hashed; 10 minutes; 5 tries)
//   core.sessions   hub logins (hashed tokens in an HttpOnly cookie; 90 days)
//   core.handoffs   one-use tickets (2 minutes) that sign you in to an app: the app redeems it in the same database
//   core.app_links  accounts connected by hand (HelloFresh usernames that aren't emails)
// Each app keeps its own users and roles; the hub only proves who you are (your email) and finds your accounts.
// q(text, params) → rows: any Postgres client (postgres-js live, PGlite in tests).
'use strict';
const crypto = require('crypto');

const SCHEMA = `
create schema if not exists core;
create table if not exists core.people (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text not null default '',
  company text not null default '',
  created_at timestamptz not null default now(),
  last_login timestamptz
);
create table if not exists core.codes (
  email text primary key,
  code_hash text not null,
  expires_at timestamptz not null,
  tries integer not null default 0,
  window_start timestamptz not null default now(),
  sends integer not null default 1
);
create table if not exists core.sessions (
  token_hash text primary key,
  person_id uuid not null references core.people (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen timestamptz not null default now()
);
create table if not exists core.handoffs (
  code_hash text primary key,
  person_id uuid not null references core.people (id) on delete cascade,
  app text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create table if not exists core.app_links (
  person_id uuid not null references core.people (id) on delete cascade,
  app text not null,
  local_id text not null,
  linked_at timestamptz not null default now(),
  how text not null default '',
  primary key (person_id, app)
);
`;

/** The apps. handoff: where the one-use ticket is sent (#c=…); each app redeems it with redeemHandoff(). */
const APPS = {
  recruit: { name: 'Recruitment', blurb: 'Check-ins, outcomes, Chase, Day 1', url: 'https://jl-recruitment.vercel.app/', handoff: 'https://jl-recruitment.vercel.app/index.html', company: '' },
  fr: { name: 'Fund Raising Playbook', blurb: 'LINK · your BA playbook', url: 'https://link-fr-playbook.vercel.app/', handoff: 'https://link-fr-playbook.vercel.app/auth/hub', company: 'LINK' },
  hf: { name: 'HelloFresh Playbook', blurb: 'JUSS · your BA playbook', url: 'https://juss-hf-playbook.vercel.app/', handoff: 'https://juss-hf-playbook.vercel.app/auth/hub', company: 'JUSS' },
  leaders: { name: 'Leaders Playbook', blurb: 'For team leaders', url: 'https://link-leaders-playbook.vercel.app/', handoff: 'https://link-leaders-playbook.vercel.app/auth/hub', company: 'LINK' },
};

const CODE_MINUTES = 10, CODE_TRIES = 5, SENDS_PER_HOUR = 5, SESSION_DAYS = 90, HANDOFF_SECONDS = 120;
const norm = e => String(e || '').trim().toLowerCase();
const isEmail = e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const pepper = () => process.env.HUB_SECRET || 'dev-only';
const codeHash = (email, code) => sha(pepper() + ':' + email + ':' + code);
const tidyName = s => String(s || '').trim().replace(/\s+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

/** Every account this email has, in each app. */
async function accounts(q, email, personId) {
  const out = {};
  // Recruitment: the Users tab (jl.tabs / jl.rows), active people only
  const t = (await q("select headers from jl.tabs where name = 'Users'"))[0];
  if (t) {
    const h = t.headers, at = k => h.indexOf(k);
    if (at('email') >= 0) {
      const rows = await q('select vals from jl.rows where tab = $1 and lower(vals->>$2::int) = $3', ['Users', at('email'), email]);
      const u = rows.map(r => r.vals).find(v => /^true$/i.test(String(v[at('active')] || '')));
      if (u) out.recruit = { id: u[at('id')], name: u[at('name')], company: u[at('company')], roles: String(u[at('roles')] || '').split(/[,\s]+/).filter(Boolean) };
    }
  }
  const fr = (await q('select id::text, display_name, role from public.users where lower(username) = $1', [email]).catch(() => []))[0];
  if (fr) out.fr = { id: fr.id, name: fr.display_name, role: fr.role };
  const ld = (await q('select id::text, display_name, role from leaders.users where lower(email) = $1', [email]).catch(() => []))[0];
  if (ld) out.leaders = { id: ld.id, name: ld.display_name, role: ld.role };
  let hf = null;
  if (personId) {
    const link = (await q("select local_id from core.app_links where person_id = $1 and app = 'hf'", [personId]))[0];
    if (link) hf = (await q('select id::text, full_name, role from hf.users where id = $1::int', [link.local_id]).catch(() => []))[0];
  }
  if (!hf) hf = (await q('select id::text, full_name, role from hf.users where lower(username) = $1', [email]).catch(() => []))[0];
  if (hf) out.hf = { id: hf.id, name: hf.full_name, role: hf.role };
  return out;
}

/** Who someone is across the apps: a display name and their company (LINK / JUSS). JUSS people get the JUSS look
 *  everywhere (hub, HelloFresh Playbook); LINK people the LINK look (hub, FR / Leaders Playbook). */
function profile(acc) {
  const name = (acc.recruit && acc.recruit.name) || (acc.fr && acc.fr.name) || (acc.leaders && acc.leaders.name) || (acc.hf && acc.hf.name) || '';
  const co = String((acc.recruit && acc.recruit.company) || '').toUpperCase();
  const company = co === 'LINK' || co === 'JUSS' ? co : acc.hf && !acc.fr && !acc.leaders ? 'JUSS' : acc.fr || acc.leaders ? 'LINK' : '';
  return { name: tidyName(name), company };
}

/**
 * New starter onboarded in the recruitment app → their playbook opens: LINK → FR Playbook, JUSS → HelloFresh Playbook.
 * The account has no usable password (it can't be guessed or registered over); they sign in with their email through the hub.
 * Never touches an existing account. Recruitment itself is never unlocked this way: only admins add people there.
 */
async function unlockPlaybook(q, starter) {
  const email = norm(starter.email), company = String(starter.company || '').toUpperCase(), name = tidyName(starter.name);
  if (!isEmail(email) || !name) return { ok: false, error: 'Needs a name and a valid email' };
  const NO_PASSWORD = '!hub-login-only';  // not a bcrypt hash: no password ever matches it
  if (company === 'LINK') {
    if ((await q('select 1 from public.users where lower(username) = $1', [email])).length) return { ok: true, app: 'fr', existed: true };
    await q("insert into public.users (username, password, display_name, role) values ($1, $2, $3, 'user')", [email, NO_PASSWORD, name]);
    return { ok: true, app: 'fr', created: true };
  }
  if (company === 'JUSS') {
    if ((await q('select 1 from hf.users where lower(username) = $1', [email])).length) return { ok: true, app: 'hf', existed: true };
    await q("insert into hf.users (username, password_hash, full_name, mentor_name, start_date, role) values ($1, $2, $3, $4, $5, 'rep')",
      [email, NO_PASSWORD, name, String(starter.mentor || ''), String(starter.startDate || new Date().toISOString().slice(0, 10))]);
    return { ok: true, app: 'hf', created: true };
  }
  return { ok: false, error: 'Company must be LINK or JUSS' };
}

/** Step 1: email a code, only to people one of the apps knows (or the hub has seen). Never says which. */
async function requestCode(q, rawEmail, sendMail) {
  const email = norm(rawEmail);
  if (!isEmail(email)) return { ok: false, error: 'That doesn\'t look like an email address.' };
  const known = Object.keys(await accounts(q, email)).length || (await q('select 1 from core.people where email = $1', [email])).length;
  if (!known) return { ok: true, sent: true };  // same answer either way
  const prev = (await q('select window_start, sends from core.codes where email = $1', [email]))[0];
  const fresh = !prev || Date.now() - new Date(prev.window_start).getTime() > 3600000;
  if (!fresh && prev.sends >= SENDS_PER_HOUR) return { ok: false, error: 'Too many codes. Wait an hour, or use the last code we sent.' };
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  await q(`insert into core.codes (email, code_hash, expires_at, tries, window_start, sends) values ($1, $2, now() + make_interval(mins => $3::int), 0, now(), 1)
    on conflict (email) do update set code_hash = excluded.code_hash, expires_at = excluded.expires_at, tries = 0,
      window_start = case when $4::boolean then now() else core.codes.window_start end,
      sends = case when $4::boolean then 1 else core.codes.sends + 1 end`, [email, codeHash(email, code), CODE_MINUTES, fresh]);
  await sendMail(email, code);
  return { ok: true, sent: true };
}

/** Step 2: check the code; returns a new session token (only its hash is stored). */
async function verifyCode(q, rawEmail, rawCode) {
  const email = norm(rawEmail), code = String(rawCode || '').replace(/\D/g, '');
  const row = (await q('select code_hash, expires_at, tries from core.codes where email = $1', [email]))[0];
  if (!row || new Date(row.expires_at).getTime() < Date.now()) return { ok: false, error: 'That code has expired. Ask for a new one.' };
  if (row.tries >= CODE_TRIES) return { ok: false, error: 'Too many tries. Ask for a new code.' };
  if (row.code_hash !== codeHash(email, code)) {
    await q('update core.codes set tries = tries + 1 where email = $1', [email]);
    return { ok: false, error: 'That code isn\'t right. Check the latest email.' };
  }
  await q('delete from core.codes where email = $1', [email]);
  const acc = await accounts(q, email), p = profile(acc);
  const person = (await q(`insert into core.people (email, name, company, last_login) values ($1, $2, $3, now())
    on conflict (email) do update set last_login = now(), name = case when excluded.name <> '' then excluded.name else core.people.name end,
      company = case when excluded.company <> '' then excluded.company else core.people.company end returning id::text, email, name, company`, [email, p.name, p.company]))[0];
  const token = crypto.randomBytes(32).toString('base64url');
  await q('insert into core.sessions (token_hash, person_id, expires_at) values ($1, $2::uuid, now() + make_interval(days => $3::int))', [sha(token), person.id, SESSION_DAYS]);
  return { ok: true, token, person };
}

async function sessionPerson(q, token) {
  if (!token) return null;
  const r = (await q(`update core.sessions s set last_seen = now() from core.people p
    where s.token_hash = $1 and s.expires_at > now() and p.id = s.person_id returning p.id::text, p.email, p.name, p.company`, [sha(token)]))[0];
  return r || null;
}
async function logout(q, token) { if (token) await q('delete from core.sessions where token_hash = $1', [sha(token)]); }

/** What the hub home shows: the person and a tile for each app they can open. */
async function home(q, person) {
  const acc = await accounts(q, person.email, person.id);
  const tiles = Object.keys(APPS).filter(k => acc[k]).map(k => Object.assign({ id: k }, APPS[k], { role: acc[k].role || (acc[k].roles || []).join(', ') }));
  // A JUSS person without a HelloFresh account found by email can connect their old username once
  const p = profile(acc), company = p.company || person.company;
  const canConnectHf = !acc.hf && (company === 'JUSS' || !tiles.length);
  return { person: Object.assign({}, person, { name: person.name || p.name, company }), tiles, canConnectHf };
}

/** A one-use ticket to sign in to an app (only if this person has an account there). */
async function createHandoff(q, person, app) {
  if (!APPS[app]) throw new Error('Unknown app');
  const acc = await accounts(q, person.email, person.id);
  if (!acc[app]) return null;
  const code = crypto.randomBytes(24).toString('base64url');
  await q('insert into core.handoffs (code_hash, person_id, app, expires_at) values ($1, $2::uuid, $3, now() + make_interval(secs => $4::int))', [sha(code), person.id, app, HANDOFF_SECONDS]);
  return code;
}

/** Used by the apps: swap a ticket for the person's email + their account id in that app. Works once, for 2 minutes. */
async function redeemHandoff(q, code, app) {
  const r = (await q(`update core.handoffs h set used_at = now() from core.people p
    where h.code_hash = $1 and h.app = $2 and h.used_at is null and h.expires_at > now() and p.id = h.person_id
    returning p.id::text as person_id, p.email, p.name`, [sha(String(code || '')), app]))[0];
  if (!r) return null;
  const acc = await accounts(q, r.email, r.person_id);
  return acc[app] ? { email: r.email, name: r.name, personId: r.person_id, account: acc[app] } : null;
}

/** HelloFresh usernames that aren't emails: prove it's you once with the old username + password. */
async function connectHf(q, person, username, password, bcrypt) {
  const u = (await q('select id::text, password_hash from hf.users where lower(username) = $1', [String(username || '').trim().toLowerCase()]))[0];
  if (!u || !(await bcrypt.compare(String(password || ''), u.password_hash))) return { ok: false, error: 'That username and password don\'t match the HelloFresh Playbook.' };
  const taken = (await q("select person_id::text from core.app_links where app = 'hf' and local_id = $1", [u.id]))[0];
  if (taken && taken.person_id !== person.id) return { ok: false, error: 'That HelloFresh account is already connected to another email. Ask Angad.' };
  await q("insert into core.app_links (person_id, app, local_id, how) values ($1::uuid, 'hf', $2, 'old password') on conflict (person_id, app) do update set local_id = excluded.local_id, linked_at = now(), how = excluded.how", [person.id, u.id]);
  return { ok: true };
}

module.exports = { SCHEMA, APPS, norm, sha, accounts, profile, requestCode, verifyCode, sessionPerson, logout, home, createHandoff, redeemHandoff, connectHf, unlockPlaybook };
