// Switch-day controls (CLAUDE.md runbook). Reads .env.supabase and .env.relay from the repo root; prints no secrets.
//
//   node scripts/switch.js status      where things stand (Google frozen / forwarding, Vercel live, last export)
//   node scripts/switch.js freeze      1. Google stops saving + its timers stop (phones retry by themselves)
//   (then)  node scripts/import-from-google.js --apply     2. copy + verify: must say 0 mismatches
//   node scripts/switch.js live        3. Vercel's API answers and its timers run (jl.props.VERCEL_LIVE)
//   node scripts/switch.js forward     4. Google passes every request on to Vercel (old open tabs keep working)
//   (then)  merge the switch PR (join/config.js API_URL '/api/rpc')   5.
//
// Undo, in reverse: `unforward` (Google answers again and its timers come back), `notlive`, `unfreeze`.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { postgresAdapter } = require('../server/db');
const VERCEL_API = 'https://jl-recruitment.vercel.app/api/rpc';

const env = {};
for (const f of ['.env.supabase', '.env.relay']) {
  const p = path.join(ROOT, f);
  if (fs.existsSync(p)) fs.readFileSync(p, 'utf8').split(/\r?\n/).forEach(l => { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ''); });
}
async function relay(action, extra) {
  const res = await fetch(env.RELAY_URL, { method: 'POST', headers: { 'content-type': 'text/plain' },
    body: JSON.stringify(Object.assign({ action, secret: env.RELAY_SECRET }, extra || {})), signal: AbortSignal.timeout(120000) });
  const j = JSON.parse(await res.text());
  if (!j.ok) throw new Error(action + ': ' + j.error);
  return j.data;
}
async function withDb(fn) {
  const db = postgresAdapter({ url: env.DATABASE_URL, password: env.DATABASE_PASSWORD });
  try { await db.migrate(); return await fn(db.sql); } finally { await db.end(); }
}
const now = () => new Date().toLocaleString('en-GB', { timeZone: 'Europe/London' });

async function status() {
  const g = await relay('relayInfo');
  const v = await withDb(async sql => ({
    live: (await sql`select val from jl.props where key = 'VERCEL_LIVE'`)[0],
    tabs: await sql`select t.name, (select count(*) from jl.rows r where r.tab = t.name)::int as n from jl.tabs t order by t.created_at`,
    outbox: (await sql`select count(*) filter (where sent_at is null and tries > 0)::int as failed, count(*) filter (where sent_at is not null)::int as sent from jl.outbox`)[0],
  }));
  const api = await fetch(VERCEL_API, { method: 'POST', body: '{"action":"publicConfig"}' }).then(r => r.json()).catch(e => ({ error: e.message }));
  console.log('Google:  ' + (g.movedTo ? 'FORWARDING to ' + g.movedTo : g.frozen ? 'FROZEN (saves wait) since ' + g.frozen : 'live (the app\'s back end)') + '; timers: ' + (g.timers.join(', ') || 'none'));
  console.log('Vercel:  ' + (v.live ? 'LIVE since ' + v.live.val : 'not live (API refuses, timers idle)') + '; API says: ' + (api.ok ? 'ok' : api.error));
  console.log('Supabase copy: ' + v.tabs.map(t => t.name + ' ' + t.n).join(', '));
  console.log('Emails via relay: ' + v.outbox.sent + ' sent, ' + v.outbox.failed + ' failed and waiting to retry');
}

const steps = {
  status,
  freeze: async () => { await relay('relayFreeze', { on: true }); console.log('Google frozen at ' + now() + '. Wait 60 seconds (a running timer finishes), then run the import with --apply.'); },
  unfreeze: async () => { await relay('relayFreeze', { on: false }); console.log('Google unfrozen: saving again, timers back.'); },
  live: async () => { await withDb(sql => sql`insert into jl.props (key, val) values ('VERCEL_LIVE', ${now()}) on conflict (key) do update set val = excluded.val`); console.log('Vercel is live: its API answers and its timers run (within 5 minutes).'); },
  notlive: async () => { await withDb(sql => sql`delete from jl.props where key = 'VERCEL_LIVE'`); console.log('Vercel not live: API refuses (new instances), timers idle.'); },
  forward: async () => {
    const api = await fetch(VERCEL_API, { method: 'POST', body: '{"action":"publicConfig"}' }).then(r => r.json());
    if (!api.ok) throw new Error('Vercel API is not answering (' + api.error + '). Run `live` first and wait a minute.');
    await relay('relaySwitch', { to: VERCEL_API });
    console.log('Google now passes every request on to ' + VERCEL_API + ' and its timers are off.');
  },
  unforward: async () => { await relay('relaySwitch', { to: '' }); console.log('Google answers requests itself again; its timers are back.'); },
};

const cmd = process.argv[2] || 'status';
if (!steps[cmd]) { console.log('Usage: node scripts/switch.js ' + Object.keys(steps).join(' | ')); process.exit(1); }
steps[cmd]().catch(e => { console.error('FAILED:', e.message || e); process.exit(1); });
