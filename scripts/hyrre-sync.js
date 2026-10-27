// The 08:30 pull from Hyrre, the part that runs on Angad's computer (the scheduled task "hyrre-morning-pull" calls it).
//
//   node scripts/hyrre-sync.js setup    once: makes the key (.env.hyrre, gitignored, never printed) and gives J&L its SHA-256
//   node scripts/hyrre-sync.js ticket   prints a one-time ticket (15 minutes) for scripts/hyrre-pull.js to send Hyrre's bookings with
//   node scripts/hyrre-sync.js snippet  prints scripts/hyrre-pull.js with a fresh ticket in it, ready to run in a Hyrre tab
//   node scripts/hyrre-sync.js last     what the last pull brought, no secrets
//
// The task runs main's copy of this file from a temp folder (`git show origin/main:scripts/hyrre-sync.js`) with --root <the repo>,
// so whatever branch the folder is on, the pull matches what's live; the snippet is main's scripts/hyrre-pull.js too.
// Reads .env.hyrre (the key) and, for setup / last, .env.supabase, from the repo root.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const arg = process.argv.indexOf('--root');
const ROOT = arg > 0 ? path.resolve(process.argv[arg + 1]) : path.join(__dirname, '..');
const site = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'app', 'site.json'), 'utf8')).url; } catch (e) { return 'https://jl-recruitment.vercel.app/'; } })();
const API = site.replace(/\/$/, '') + '/api/rpc';

function readEnv(file) {
  const p = path.join(ROOT, file), env = {};
  if (fs.existsSync(p)) fs.readFileSync(p, 'utf8').split(/\r?\n/).forEach(l => { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ''); });
  return env;
}
async function withDb(fn) {
  const env = readEnv('.env.supabase');
  if (!env.DATABASE_URL) throw new Error('.env.supabase is missing (needed for setup / last).');
  const { postgresAdapter } = require(path.join(ROOT, 'server', 'db'));
  const db = postgresAdapter({ url: env.DATABASE_URL, password: env.DATABASE_PASSWORD });
  try { await db.migrate(); return await fn(db.sql); } finally { await db.end(); }
}
async function ticket() {
  const key = readEnv('.env.hyrre').HYRRE_SYNC_KEY;
  if (!key) throw new Error('No key yet: run `node scripts/hyrre-sync.js setup` once.');
  const r = await fetch(API, { method: 'POST', body: JSON.stringify({ action: 'hyrreTicket', key }), signal: AbortSignal.timeout(60000) });
  const j = await r.json();
  if (!j.ok) throw new Error('J&L refused the ticket: ' + j.error);
  return j.data.ticket;
}
/** main's copy of the snippet (what's live), else the one in the folder */
function pullSource() {
  try { return execFileSync('git', ['-C', ROOT, 'show', 'origin/main:scripts/hyrre-pull.js'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch (e) { return fs.readFileSync(path.join(ROOT, 'scripts', 'hyrre-pull.js'), 'utf8'); }
}

const steps = {
  async setup() {
    const p = path.join(ROOT, '.env.hyrre');
    let key = readEnv('.env.hyrre').HYRRE_SYNC_KEY;
    if (!key) { key = crypto.randomBytes(32).toString('hex'); fs.writeFileSync(p, 'HYRRE_SYNC_KEY=' + key + '\n'); }
    const hash = crypto.createHash('sha256').update(key).digest('hex');
    await withDb(sql => sql`insert into jl.props (key, val) values ('HYRRE_SYNC_SHA256', ${hash}) on conflict (key) do update set val = excluded.val`);
    console.log('Key ready in .env.hyrre (not printed); J&L has its fingerprint. Try: node scripts/hyrre-sync.js ticket');
  },
  async ticket() { console.log(await ticket()); },
  async snippet() {
    const src = pullSource();
    if (!/'__TICKET__', __DRY__\);\s*$/.test(src)) throw new Error('scripts/hyrre-pull.js has changed shape: expected it to end with (\'__TICKET__\', __DRY__);');
    process.stdout.write(src.replace(/'__TICKET__', __DRY__\);\s*$/, JSON.stringify(await ticket()) + ', false);\n'));
  },
  async last() {
    const row = (await withDb(sql => sql`select val from jl.props where key = 'HYRRE_LAST'`))[0];
    console.log(row ? row.val : 'No pull from Hyrre yet.');
  },
};

const step = process.argv[2];
if (!steps[step]) { console.log('Usage: node scripts/hyrre-sync.js setup | ticket | snippet | last  [--root <repo folder>]'); process.exit(1); }
steps[step]().catch(e => { console.error(e.message); process.exit(1); });
