// Local dev server: serves the Apps Script HTML and routes google.script.run to the fake GAS.
// Usage: node dev/server.js [port]
// JL_BACKEND=pg: run Code.gs on the Supabase back end instead (server/runtime.js on PGlite, an in-memory Postgres),
// so every harness (e2e.js, speed.js, room.js…) proves the live back end behaves exactly like Google's.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { load } = require('./gas');

const PORT = Number(process.argv[2] || 8787);
const SRC = path.join(__dirname, '..', 'src');
const JOIN = path.join(__dirname, '..', '..', 'join');
let DELAY = 0;

/** The same calls on either back end (all async). */
function inMemory() {
  const g = load({ url: `http://localhost:${PORT}/exec` });
  return {
    api: async b => g.api(b), run: async (fn, args) => g.run(fn, ...args), eval: async js => g.eval(js),
    setOffsetMs: async ms => g.setOffsetMs(ms), pushes: async () => g.state.pushes, mail: async () => g.state.outbox,
    setProps: async o => { Object.assign(g.state.props, o); }, sheet: async n => { const sh = g.state.sheets[n]; return sh ? sh.data : null; },
  };
}
async function onPostgres() {
  const { Runtime } = require('../../server/runtime');
  const { pgliteAdapter } = require('../../server/db');
  const db = await pgliteAdapter();
  await db.migrate();
  // The one-login hub's tables and the playbooks' user tables (as in the shared Supabase), so hub sign-in and the
  // automatic playbook unlock run for real in the tests
  await db.db.exec(require('../../hub/lib/core.js').SCHEMA + `
    create table if not exists public.users (id varchar primary key default gen_random_uuid(), username text not null, password text not null,
      display_name text not null, role text not null default 'user', start_date timestamp not null default now(), last_login timestamp not null default now(),
      unlocks text[]);  -- the Link Org Playbook's unlocks ('cod-stage-3' = Stage 3 · Leader)
    create schema if not exists leaders;
    create table if not exists leaders.users (id varchar primary key default gen_random_uuid(), email text not null, password text not null, display_name text not null, role text not null default 'user');
    create schema if not exists hf;
    create table if not exists hf.users (id serial primary key, username text not null, password_hash text not null, full_name text not null,
      mentor_name text not null default '', start_date text not null default '', role text not null default 'rep', created_at timestamptz not null default now(),
      cod_stage smallint not null default 2, email text);  -- the JUSS Playbook's Cycle of Development stage (3 = Stage 3 · Leader) and Leader-pages email`);
  const rt = new Runtime({ db, testMode: true, env: { PUBLIC_URL: `http://localhost:${PORT}/exec` } });
  await rt.start();
  const plain = v => JSON.parse(JSON.stringify(v === undefined ? null : v));
  return {
    api: b => rt.call('api', b), run: (fn, args) => rt.call(fn, ...args), eval: js => rt.run({ type: 'eval', js }),
    setOffsetMs: ms => rt.run({ type: 'eval', js: '__offset = ' + Number(ms) }), pushes: () => rt.run({ type: 'pushes' }), mail: async () => plain(rt.testMail),
    setProps: o => rt.withDb(async q => { for (const k of Object.keys(o)) await q('insert into jl.props (key, val) values ($1, $2) on conflict (key) do update set val = excluded.val', [k, String(o[k])]); }),
    sql: (text, params) => rt.withDb(q => q(text, params || [])),
    sheet: n => rt.withDb(async q => {
      const t = (await q('select headers from jl.tabs where name = $1', [n]))[0];
      if (!t) return null;
      return [t.headers].concat((await q('select vals from jl.rows where tab = $1 order by pos', [n])).map(r => r.vals));
    }),
  };
}
const ready = process.env.JL_BACKEND === 'pg' ? onPostgres() : Promise.resolve(inMemory());

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SHIM = `<script>
(function(){
  function mk(s,f){return{withSuccessHandler:function(fn){return mk(fn,f)},withFailureHandler:function(fn){return mk(s,fn)},
    api:function(req){fetch('/api',{method:'POST',body:JSON.stringify(req)}).then(function(r){return r.json()}).then(function(d){s&&s(d)}).catch(function(e){f&&f(e)})}}}
  window.google={script:{run:mk(null,null)}};
})();
</script>`;

function render(params) {
  const go = params.get('go');
  const vars = { mode: params.get('app') === 'staff' ? 'staff' : (['eval', 'welcome'].indexOf(go) >= 0 ? go : 'checkin'), k: params.get('t') || '', cid: params.get('c') || '' };
  let html = fs.readFileSync(path.join(SRC, 'Index.html'), 'utf8');
  html = html.replace(/<\?!= include\('(\w+)'\) \?>/g, (m, n) => (n === 'JS' ? SHIM : '') + fs.readFileSync(path.join(SRC, n + '.html'), 'utf8'));
  html = html.replace(/<\?= (\w+) \?>/g, (m, n) => esc(vars[n]));
  return html;
}

function body(req) {
  return new Promise(r => { let b = ''; req.on('data', c => (b += c)); req.on('end', () => r(b ? JSON.parse(b) : {})); });
}

ready.then(gas => http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (u.pathname === '/exec' || u.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(render(u.searchParams));
    }
    if (u.pathname === '/dev/delay' && req.method === 'POST') { DELAY = (await body(req)).ms || 0; res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{}'); }
    if (u.pathname === '/api' && req.method === 'POST') {
      const b = await body(req);
      if (DELAY) await new Promise(r => setTimeout(r, DELAY));  // simulate Google's real response time
      const r = await gas.api(b);
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(r));
    }
    if (u.pathname.startsWith('/join/')) {
      // The installable app (what GitHub Pages serves), wired to this dev API.
      const rel = u.pathname.slice(6) || 'index.html';
      if (rel === 'config.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end("window.APP_CONFIG={API_URL:'/api',ONESIGNAL_APP_ID:''};"); }
      const f = path.join(JOIN, path.normalize(rel).replace(/^(\.\.[\/])+/, ''));
      if (!f.startsWith(JOIN) || !fs.existsSync(f)) { res.writeHead(404); return res.end('not found'); }
      const type = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webmanifest': 'application/manifest+json' }[path.extname(f)] || 'application/octet-stream';
      res.writeHead(200, { 'content-type': type }); return res.end(fs.readFileSync(f));
    }
    if (u.pathname === '/dev/pushes') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await gas.pushes())); }
    if (u.pathname === '/dev/props' && req.method === 'POST') { await gas.setProps(await body(req)); res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{}'); }
    if (u.pathname === '/dev/mail') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(await gas.mail())); }
    if (u.pathname === '/dev/run' && req.method === 'POST') {
      const b = await body(req);
      const out = await gas.run(b.fn, b.args || []);
      res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ out: out === undefined ? null : out }));
    }
    if (u.pathname === '/dev/eval' && req.method === 'POST') {
      const b = await body(req);
      const out = await gas.eval(b.js);
      res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ out }));
    }
    if (u.pathname === '/dev/time' && req.method === 'POST') {
      const b = await body(req);
      await gas.setOffsetMs(b.iso ? new Date(b.iso).getTime() - Date.now() : 0);
      res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"ok":true}');
    }
    if (u.pathname === '/dev/sql' && req.method === 'POST') {  // Postgres back end only (tests of the hub tables)
      if (!gas.sql) { res.writeHead(404); return res.end('Postgres back end only'); }
      const b = await body(req);
      const rows = await gas.sql(b.sql, b.params);
      res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ rows }));
    }
    if (u.pathname === '/dev/bell' && req.method === 'POST') {  // Vercel's 5-minute bell-sheet step (server/bell.js), as api/cron.js runs it
      const b = await body(req);
      // The relay: this Code.gs's relayBell (Google back end, bell sheets in globalThis.__books), or b.fake = { [section]: { rows: [status, …], error } }
      const relay = async (action, extra) => {
        const f = b.fake && (b.fake[extra.section] || {});  // a section not named: all added
        if (f) return { title: 'Fake bell sheet', tab: f.error ? '' : 'WE fake', error: f.error || '', rows: f.error ? [] : extra.rows.map((x, i) => (f.rows || [])[i] || 'added') };
        const r = await gas.api(Object.assign({ action, secret: b.secret }, extra));
        if (!r.ok) throw new Error('relay ' + action + ': ' + r.error);
        return r.data;
      };
      const out = await require('../../server/bell').bellToSheets({ call: (fn, ...args) => gas.run(fn, args) }, relay);
      res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ out: out === undefined ? null : JSON.parse(JSON.stringify(out)) }));
    }
    if (u.pathname === '/dev/sheet') {
      const data = await gas.sheet(u.searchParams.get('name'));
      res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(data));
    }
    res.writeHead(404); res.end('not found');
  } catch (e) {
    console.error(e);
    res.writeHead(500); res.end(String(e.stack || e));
  }
}).listen(PORT, () => console.log('dev server on http://localhost:' + PORT + (process.env.JL_BACKEND === 'pg' ? ' (Postgres back end)' : ''))));
