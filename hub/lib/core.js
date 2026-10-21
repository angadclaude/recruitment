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
create table if not exists core.approvers (
  email text primary key,
  granted_by text not null default '',
  granted_at timestamptz not null default now()
);
create table if not exists core.promotions (
  id bigserial primary key,
  email text not null,
  name text not null default '',
  company text not null,
  to_stage integer not null,
  by_email text not null,
  at timestamptz not null default now(),
  applied_app text,
  applied_at timestamptz
);
`;

/** The apps. handoff: where the one-use ticket is sent (#c=…); each app redeems it with redeemHandoff(). */
const APPS = {
  recruit: { name: 'Recruitment', blurb: 'Check-ins, outcomes, Chase, Day 1', url: 'https://jl-recruitment.vercel.app/', handoff: 'https://jl-recruitment.vercel.app/index.html', company: '' },
  fr: { name: 'Link Org Playbook', blurb: 'LINK · your BA playbook', url: 'https://link-fr-playbook.vercel.app/', handoff: 'https://link-fr-playbook.vercel.app/auth/hub', company: 'LINK' },
  hf: { name: 'JUSS Playbook', blurb: 'JUSS · your BA & Leader playbook', url: 'https://juss-hf-playbook.vercel.app/', handoff: 'https://juss-hf-playbook.vercel.app/auth/hub', company: 'JUSS' },
  // No separate Leaders tiles: Stage 3 is inside each company's playbook since 21 Oct (link-leaders-playbook.vercel.app and
  // juss-leaders-playbook.vercel.app redirect there). Angad wants one go-to app per company.
};

/** The ladder (like CG1), Angad's words (19 Oct): Stages 1 & 2 = Brand Ambassador (their company's playbook; the playbook's
 *  Cycle of Development Stage 1, then Stage 2 "Becoming a Leader"), Stage 3 = Leader (Leaders Playbook). stage 2 here means
 *  "a Brand Ambassador, Stage 1 or 2". An approver moves people on to Stage 3 within their own company, admins anyone. */
const STAGES = { 2: 'Brand Ambassador', 3: 'Leader' };
const STAGE_LABEL = { 2: 'Stage 1–2 · Brand Ambassador', 3: 'Stage 3 · Leader' };
const PLAYBOOK = { LINK: 'fr', JUSS: 'hf' };
// LINK Stage 3 is a switch on their Link Org Playbook login (public.users.unlocks), the same one its coaches use; the app
// opens their Stage 3 account itself the first time. leaders.users rows stay when a coach locks Stage 3 again, so they
// aren't the signal. Coaches (role 'manager') see everything in the app but aren't Stage 3.
const LINK_STAGE3 = 'cod-stage-3';
// JUSS Stage 3 is the Cycle of Development stage on their JUSS Playbook login (hf.users.cod_stage: 3 = Leader, 4 = Crew
// Leader), the one its coaches set; the app makes their Leader pages' account (jleaders.users) itself the first time they
// open one. Coaches (role 'coach') see everything in the app but aren't Stage 3.
const JUSS_STAGE3 = 3;
/** Already a Leader: Stage 3 open in their company's playbook. */
function isLeader(acc, company) { const a = company === 'LINK' ? acc.fr : acc.hf; return !!(a && a.stage3); }

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
  // The exact spelling first (one pair of usernames differs only in capitals), as the Link Org Playbook's own login does
  const fr = (await q(`select id::text, display_name, role, (role <> 'manager' and $2 = any(coalesce(unlocks, '{}'))) as stage3
    from public.users where lower(username) = $1 order by (username = $1) desc, last_login desc nulls last limit 1`, [email, LINK_STAGE3]).catch(() => []))[0];
  if (fr) out.fr = { id: fr.id, name: fr.display_name, role: fr.role, stage3: !!fr.stage3 };
  const hf = await hfLogin(q, email, personId);
  if (hf) out.hf = { id: hf.id, name: hf.full_name, role: hf.role, stage3: !!hf.stage3 };
  return out;
}

/** Their JUSS Playbook login, found the way its own hub sign-in finds it: the one connected in the hub (core.app_links,
 *  for usernames that aren't emails), else the one whose username is this email, else the one with this email on it
 *  (typed by their coach, or the old Leaders Playbook email of a leader who moved in on 21 Oct). */
async function hfLogin(q, email, personId) {
  const cols = `id::text, full_name, role, (role <> 'coach' and cod_stage >= ${JUSS_STAGE3}) as stage3`;
  const link = (await q("select local_id from core.app_links where app = 'hf' and person_id = " + (personId ? '$1::uuid' : '(select id from core.people where email = $1)'),
    [personId || email]))[0];
  const linked = link && (await q(`select ${cols} from hf.users where id = $1::int`, [link.local_id]).catch(() => []))[0];
  return linked || (await q(`select ${cols} from hf.users where lower(username) = $1 or lower(email) = $1 order by (lower(username) = $1) desc, id limit 1`,
    [email]).catch(() => []))[0] || null;
}
/** The email a JUSS Playbook login goes by: the one proved in the hub, else the one on the login, else the username if it's one. */
function hfEmail(u, linked) { return linked || (isEmail(norm(u.email)) ? norm(u.email) : isEmail(norm(u.username)) ? norm(u.username) : ''); }

/** Admin = an admin in the recruitment app (Angad, Jess, Satpal, Rubal). Approver = someone an admin chose. */
function isAdmin(acc) { return !!(acc.recruit && (acc.recruit.roles || []).includes('admin')); }
async function isApprover(q, email) { return (await q('select 1 from core.approvers where email = $1', [email])).length > 0; }
function stageOf(acc, pending) {
  if (isLeader(acc, 'LINK') || isLeader(acc, 'JUSS') || pending) return 3;
  // A playbook coach (Link Org Playbook role 'manager', JUSS Playbook role 'coach') isn't on the BA ladder: like staff, no stage
  if ((acc.fr && acc.fr.role !== 'manager') || (acc.hf && acc.hf.role !== 'coach')) return 2;
  return 0;  // staff only (recruitment app), no BA stage
}

/** Who someone is across the apps: a display name and their company (LINK / JUSS). JUSS people get the JUSS look
 *  everywhere (hub, JUSS Playbook); LINK people the LINK look (hub, Link Org Playbook). */
function profile(acc) {
  const name = (acc.recruit && acc.recruit.name) || (acc.fr && acc.fr.name) || (acc.hf && acc.hf.name) || '';
  const co = String((acc.recruit && acc.recruit.company) || '').toUpperCase();
  const company = co === 'LINK' || co === 'JUSS' ? co : acc.hf && !acc.fr ? 'JUSS' : acc.fr ? 'LINK' : '';
  return { name: tidyName(name), company };
}

/**
 * New starter onboarded in the recruitment app → their playbook opens: LINK → FR Playbook, JUSS → JUSS Playbook.
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

/** What the hub home shows: the person, their stage, a tile for each app they can open, and what they may manage. */
async function home(q, person) {
  await applyPending(q);
  const acc = await accounts(q, person.email, person.id);
  const tiles = Object.keys(APPS).filter(k => acc[k]).map(k => Object.assign({ id: k }, APPS[k], { role: acc[k].role || (acc[k].roles || []).join(', ') }));
  // A JUSS person without a HelloFresh account found by email can connect their old username once
  const p = profile(acc), company = p.company || person.company;
  const canConnectHf = !acc.hf && (company === 'JUSS' || !tiles.length);
  const waiting = (await q('select 1 from core.promotions where email = $1 and to_stage = 3 and applied_at is null', [person.email])).length > 0;
  const stage = stageOf(acc, waiting), admin = isAdmin(acc);
  return {
    person: Object.assign({}, person, { name: person.name || p.name, company }), tiles, canConnectHf,
    stage, stageName: STAGES[stage] || '', stageLabel: STAGE_LABEL[stage] || '', waitingForLeaders: waiting && !isLeader(acc, 'LINK') && !isLeader(acc, 'JUSS'),
    admin, approver: admin || await isApprover(q, person.email),
  };
}

/** Everyone an approver may move on: BAs of their company (admins: both), with their stage. */
async function team(q, viewer) {
  const vacc = await accounts(q, viewer.email, viewer.id), admin = isAdmin(vacc);
  if (!admin && !(await isApprover(q, viewer.email))) return { ok: false, error: 'Only approvers can move people on. Ask an admin.' };
  await applyPending(q);
  const vco = profile(vacc).company || viewer.company, cos = admin ? ['LINK', 'JUSS'] : [vco];
  const pending = new Set((await q('select email from core.promotions where to_stage = 3 and applied_at is null')).map(r => r.email));
  const people = [];
  if (cos.includes('LINK')) {
    (await q("select id::text, lower(username) as email, display_name, $1 = any(coalesce(unlocks, '{}')) as stage3 from public.users where role <> 'manager' order by display_name", [LINK_STAGE3])).forEach(u => {
      const stage = u.stage3 || pending.has(u.email) ? 3 : 2;
      people.push({ app: 'fr', id: u.id, name: tidyName(u.display_name), email: u.email, company: 'LINK', stage, canPromote: stage === 2 });
    });
  }
  if (cos.includes('JUSS')) {
    const linked = {};
    (await q("select l.local_id, p.email from core.app_links l join core.people p on p.id = l.person_id where l.app = 'hf'")).forEach(r => { linked[r.local_id] = r.email; });
    (await q("select id::text, username, email, full_name, cod_stage >= $1 as stage3 from hf.users where role <> 'coach' order by full_name", [JUSS_STAGE3])).forEach(u => {
      const email = hfEmail(u, linked[u.id]);
      const stage = u.stage3 || (email && pending.has(email)) ? 3 : 2;
      people.push({ app: 'hf', id: u.id, name: tidyName(u.full_name), email, company: 'JUSS', stage, canPromote: stage === 2 && !!email });
    });
  }
  return { ok: true, companies: cos, people };
}

/** An approver moves a BA on to Leader: Stage 3 opens in their company's playbook. */
async function promote(q, viewer, app, id, notify) {
  const company = app === 'fr' ? 'LINK' : app === 'hf' ? 'JUSS' : '';
  if (!company) return { ok: false, error: 'Unknown playbook' };
  const vacc = await accounts(q, viewer.email, viewer.id), admin = isAdmin(vacc);
  const vco = profile(vacc).company || viewer.company;
  if (!admin && !((await isApprover(q, viewer.email)) && vco === company)) return { ok: false, error: 'You can only move on people in your own company.' };
  let ba;
  if (app === 'fr') {
    const u = (await q('select lower(username) as email, display_name from public.users where id = $1', [String(id)]))[0];
    ba = u && { email: u.email, name: tidyName(u.display_name) };
  } else {
    const u = (await q('select id::text, username, email, full_name from hf.users where id = $1::int', [String(id)]))[0];
    if (u) {
      const link = (await q("select p.email from core.app_links l join core.people p on p.id = l.person_id where l.app = 'hf' and l.local_id = $1", [u.id]))[0];
      ba = { email: hfEmail(u, link && link.email), name: tidyName(u.full_name) };
    }
  }
  if (!ba) return { ok: false, error: 'Couldn\'t find that person.' };
  if (!ba.email) return { ok: false, error: ba.name + ' needs to sign in to the hub once (so we know their email) before they can be moved on.' };
  const had = await accounts(q, ba.email);
  if (isLeader(had, company) || (await q('select 1 from core.promotions where email = $1 and to_stage = 3 and applied_at is null', [ba.email])).length) return { ok: true, already: true, name: ba.name };
  await q('insert into core.promotions (email, name, company, to_stage, by_email) values ($1, $2, $3, 3, $4)', [ba.email, ba.name, company, viewer.email]);
  const opened = (await applyPending(q)).includes(ba.email);
  if (notify) { try { await notify(ba.email, ba.name, company, opened); } catch (e) { console.error('congrats email', e); } }
  return { ok: true, name: ba.name, opened, waiting: !opened };
}

/** Open Stage 3 for every approved promotion; with no playbook login yet it waits. LINK: switch Stage 3 on in their Link
 *  Org Playbook login (added to what's there, nothing else touched). JUSS: their JUSS Playbook login goes to Stage 3, only
 *  ever up (a Crew Leader stays at 4); if it has no email, the one they use here goes on it (lower case), so their Leader
 *  pages find them, unless another login already has it. Neither app's Leader account is made here: the apps do that. */
async function applyPending(q) {
  const rows = await q('select id, email, name, company from core.promotions where to_stage = 3 and applied_at is null order by id');
  const done = [];
  for (const r of rows) {
    let target;
    if (r.company === 'LINK') {
      target = 'fr';
      const hit = await q(`update public.users set unlocks = array(select distinct unnest(coalesce(unlocks, '{}') || array[$2]::text[]))
        where id = (select id from public.users where lower(username) = $1 order by (username = $1) desc, last_login desc nulls last limit 1) returning id`, [r.email, LINK_STAGE3]);
      if (!hit.length) continue;
    } else {
      target = 'hf';
      const login = await hfLogin(q, norm(r.email));
      if (!login || login.role === 'coach') continue;
      await q(`update hf.users u set cod_stage = greatest(u.cod_stage, $2::smallint),
          email = case when coalesce(u.email, '') = '' and lower(u.username) <> $3::text
            and not exists (select 1 from hf.users o where o.id <> u.id and (lower(o.username) = $3::text or lower(o.email) = $3::text)) then $3::text else u.email end
        where u.id = $1::int`, [login.id, JUSS_STAGE3, norm(r.email)]);
    }
    await q('update core.promotions set applied_app = $2, applied_at = now() where id = $1', [r.id, target]);
    done.push(r.email);
  }
  return done;
}

/** Admins choose the approvers (by work email; they must be in one of the apps). */
async function approvers(q, viewer) {
  if (!isAdmin(await accounts(q, viewer.email, viewer.id))) return { ok: false, error: 'Only admins choose approvers.' };
  const rows = await q('select a.email, a.granted_by, a.granted_at, p.name, p.company from core.approvers a left join core.people p on p.email = a.email order by a.email');
  const list = [];
  for (const r of rows) { const pr = profile(await accounts(q, r.email)); list.push({ email: r.email, name: r.name || pr.name, company: r.company || pr.company, by: r.granted_by }); }
  return { ok: true, approvers: list };
}
async function setApprover(q, viewer, rawEmail, on) {
  if (!isAdmin(await accounts(q, viewer.email, viewer.id))) return { ok: false, error: 'Only admins choose approvers.' };
  const email = norm(rawEmail);
  if (on) {
    if (!isEmail(email) || !Object.keys(await accounts(q, email)).length) return { ok: false, error: 'That email isn\'t in any of the apps.' };
    await q('insert into core.approvers (email, granted_by) values ($1, $2) on conflict (email) do nothing', [email, viewer.email]);
  } else {
    await q('delete from core.approvers where email = $1', [email]);
  }
  return approvers(q, viewer);
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
  if (!u || !(await bcrypt.compare(String(password || ''), u.password_hash))) return { ok: false, error: 'That username and password don\'t match the JUSS Playbook.' };
  const taken = (await q("select person_id::text from core.app_links where app = 'hf' and local_id = $1", [u.id]))[0];
  if (taken && taken.person_id !== person.id) return { ok: false, error: 'That HelloFresh account is already connected to another email. Ask Angad.' };
  await q("insert into core.app_links (person_id, app, local_id, how) values ($1::uuid, 'hf', $2, 'old password') on conflict (person_id, app) do update set local_id = excluded.local_id, linked_at = now(), how = excluded.how", [person.id, u.id]);
  return { ok: true };
}

module.exports = { SCHEMA, APPS, STAGES, norm, sha, accounts, profile, requestCode, verifyCode, sessionPerson, logout, home, createHandoff, redeemHandoff, connectHf, unlockPlaybook,
  team, promote, applyPending, approvers, setApprover };
