// Copies the Google Sheet (every tab, as the app reads it) and the Script Properties into Supabase (schema jl),
// then reads everything back and compares it field by field with Google's copy.
//
//   node scripts/import-from-google.js            dry run: fetch, save the export to private/, show what would change
//   node scripts/import-from-google.js --apply    replace jl's tabs + settings with Google's, then verify (0 mismatches expected)
//   node scripts/import-from-google.js --verify   only compare Supabase with a fresh Google export
//
// Reads .env.supabase (DATABASE_URL, DATABASE_PASSWORD) and .env.relay (RELAY_URL, RELAY_SECRET) from the repo root.
// The export holds personal data: it is saved to private/ (never committed) and nowhere else.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { postgresAdapter } = require('../server/db');

function loadEnv(file) {
  const p = path.join(ROOT, file);
  if (!fs.existsSync(p)) return;
  fs.readFileSync(p, 'utf8').split(/\r?\n/).forEach(line => {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
}
loadEnv('.env.supabase');
loadEnv('.env.relay');

const KEEP_PROPS = /^(VERCEL_|CRON_LAST_)/;  // Vercel's own settings survive a re-import

async function relay(action, extra) {
  const res = await fetch(process.env.RELAY_URL, { method: 'POST', headers: { 'content-type': 'text/plain' },
    body: JSON.stringify(Object.assign({ action, secret: process.env.RELAY_SECRET }, extra || {})), signal: AbortSignal.timeout(300000) });
  const j = JSON.parse(await res.text());
  if (!j.ok) throw new Error(action + ': ' + j.error);
  return j.data;
}

async function readSupabase(sql) {
  const tabs = {};
  for (const t of await sql`select name, headers, max_rows, max_cols from jl.tabs order by created_at, name`) {
    const rows = await sql`select vals from jl.rows where tab = ${t.name} order by pos`;
    tabs[t.name] = { headers: t.headers, rows: rows.map(r => r.vals), max_rows: t.max_rows, max_cols: t.max_cols };
  }
  const props = {};
  (await sql`select key, val from jl.props`).forEach(r => { if (!KEEP_PROPS.test(r.key)) props[r.key] = r.val; });
  return { tabs, props };
}

/** Field by field. Trailing empty cells don't count (Sheets pads rows to the widest one). */
function compare(google, supa) {
  const trim = a => { const b = a.slice(); while (b.length && (b[b.length - 1] === '' || b[b.length - 1] === undefined)) b.pop(); return b; };
  const out = { tabs: {}, mismatches: 0, notes: [] };
  const names = new Set(Object.keys(google.tabs).concat(Object.keys(supa.tabs)));
  for (const n of names) {
    const g = google.tabs[n], s = supa.tabs[n];
    if (!g || !s) { out.mismatches++; out.notes.push(n + ': only in ' + (g ? 'Google' : 'Supabase')); continue; }
    let bad = 0;
    if (JSON.stringify(trim(g.headers)) !== JSON.stringify(trim(s.headers))) { bad++; out.notes.push(n + ': headers differ'); }
    // Google pads with blank rows after the last one; ignore trailing blank rows on both sides
    const gr = g.rows.slice(), sr = s.rows.slice(), blank = r => trim(r).length === 0;
    while (gr.length && blank(gr[gr.length - 1])) gr.pop();
    while (sr.length && blank(sr[sr.length - 1])) sr.pop();
    if (gr.length !== sr.length) { bad++; out.notes.push(n + ': ' + gr.length + ' rows in Google, ' + sr.length + ' in Supabase'); }
    for (let i = 0; i < Math.min(gr.length, sr.length); i++) {
      const a = trim(gr[i]), b = trim(sr[i]);
      if (a.length !== b.length || a.some((v, j) => String(v) !== String(b[j]))) { bad++; if (bad < 5) out.notes.push(n + ' row ' + (i + 2) + ' differs'); }
    }
    out.tabs[n] = { rows: gr.length, cols: trim(g.headers).length, mismatches: bad };
    out.mismatches += bad;
  }
  const pk = new Set(Object.keys(google.props).concat(Object.keys(supa.props)));
  for (const k of pk) if (google.props[k] !== supa.props[k]) { out.mismatches++; out.notes.push('setting ' + k + ' differs'); }
  out.settings = Object.keys(google.props).length;
  return out;
}

(async () => {
  const mode = process.argv.includes('--apply') ? 'apply' : process.argv.includes('--verify') ? 'verify' : 'dry';
  const db = postgresAdapter({ url: process.env.DATABASE_URL, password: process.env.DATABASE_PASSWORD });
  const sql = db.sql;
  await db.migrate();
  console.log('Fetching every tab from Google…');
  const t0 = Date.now();
  const exp = await relay('relayExport');
  console.log('  got it in ' + ((Date.now() - t0) / 1000).toFixed(1) + 's (Google time ' + exp.at + '): ' +
    Object.keys(exp.tabs).map(n => n + ' ' + exp.tabs[n].rows.length).join(', ') + '; ' + Object.keys(exp.props).length + ' settings');
  fs.mkdirSync(path.join(ROOT, 'private'), { recursive: true });
  const file = path.join(ROOT, 'private', 'google-export-' + exp.at.replace(/[: ]/g, '-') + '.json');
  fs.writeFileSync(file, JSON.stringify(exp));
  console.log('  saved to ' + path.relative(ROOT, file) + ' (private, never committed)');

  if (mode === 'apply') {
    console.log('Replacing Supabase jl tabs + settings…');
    await sql.begin(async tx => {
      await tx`select pg_advisory_xact_lock(7342001)`;  // the app's own lock: no request writes while this runs
      await tx`delete from jl.rows`;
      await tx`delete from jl.tabs`;
      await tx`delete from jl.props where key !~ ${KEEP_PROPS.source}`;
      await tx`delete from jl.cache`;
      let order = 0;
      for (const [name, t] of Object.entries(exp.tabs)) {
        await tx`insert into jl.tabs (name, headers, max_rows, max_cols, created_at) values (${name}, ${tx.json(t.headers)}, ${t.max_rows}, ${t.max_cols}, now() + make_interval(secs => ${order++}))`;
        for (let i = 0; i < t.rows.length; i += 500) {  // in order: pos comes from a sequence
          await tx`insert into jl.rows (tab, vals) select ${name}, x from jsonb_array_elements(${tx.json(t.rows.slice(i, i + 500))}::jsonb) with ordinality as e(x, n) order by n`;
        }
      }
      for (const [k, v] of Object.entries(exp.props)) await tx`insert into jl.props (key, val) values (${k}, ${String(v)}) on conflict (key) do update set val = excluded.val`;
    });
    console.log('  done.');
  }

  const supa = await readSupabase(sql);
  const cmp = compare(exp, supa);
  console.log((mode === 'dry' ? 'Supabase now vs Google (nothing changed):' : 'Check, field by field:'));
  Object.entries(cmp.tabs).forEach(([n, t]) => console.log('  ' + n.padEnd(12) + String(t.rows).padStart(6) + ' rows  ' + String(t.cols).padStart(3) + ' columns  ' + t.mismatches + ' mismatches'));
  console.log('  settings: ' + cmp.settings);
  cmp.notes.slice(0, 20).forEach(x => console.log('  - ' + x));
  console.log(cmp.mismatches === 0 ? 'RESULT: 0 mismatches' : 'RESULT: ' + cmp.mismatches + ' mismatches');
  await db.end();
  process.exit(mode !== 'dry' && cmp.mismatches ? 1 : 0);
})().catch(e => { console.error('FAILED:', e.message || e); process.exit(1); });
