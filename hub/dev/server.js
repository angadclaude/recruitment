// Local preview of the hub: public/ + the real API on PGlite with pretend users. Codes print here instead of being emailed.
// Usage: node hub/dev/server.js [port]   (default 5190)
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { PGlite } = require(path.join(__dirname, '..', 'node_modules', '@electric-sql', 'pglite'));
const bcrypt = require(path.join(__dirname, '..', 'node_modules', 'bcryptjs'));
const core = require('../lib/core');
const { handle } = require('../lib/server');

const PORT = Number(process.argv[2] || 5190);
const PUB = path.join(__dirname, '..', 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain' };

(async () => {
  const db = new PGlite();
  const q = async (t, p) => (await db.query(t, p || [])).rows, exec = t => db.exec(t);
  await exec(`
    create schema jl; create table jl.tabs (name text primary key, headers jsonb); create table jl.rows (rid bigserial primary key, tab text, pos bigserial, vals jsonb);
    insert into jl.tabs values ('Users', '["id","name","email","company","roles","active"]');
    insert into jl.rows (tab, vals) values ('Users', '["u1","Angad Oshan","angad@linkmarketing.org.uk","LINK","admin","TRUE"]'), ('Users', '["u3","Jo Doe","jo@jussmarketing.co.uk","JUSS","booker","TRUE"]');
    create table public.users (id varchar primary key default gen_random_uuid(), username text, password text, display_name text, role text);
    insert into public.users (username, password, display_name, role) values ('angad@linkmarketing.org.uk', 'x', 'Angad', 'manager'),
      ('bea@example.com', 'x', 'Bea Ambassador', 'user'), ('ollie@example.com', 'x', 'ollie field', 'user'), ('priya@example.com', 'x', 'Priya Shah', 'user');
    create schema leaders; create table leaders.users (id varchar primary key default gen_random_uuid(), email text, password text, display_name text, role text);
    insert into leaders.users (email, password, display_name, role) values ('angad@linkmarketing.org.uk', 'x', 'Angad', 'manager');
    create schema hf; create table hf.users (id serial primary key, username text not null, password_hash text not null, full_name text not null,
      mentor_name text not null default '', start_date text not null default '', role text not null default 'rep', created_at timestamptz not null default now());`);
  await q('insert into hf.users (username, password_hash, full_name, role) values ($1, $2, $3, $4)', ['jdoe', bcrypt.hashSync('old-pass', 4), 'Jo Doe', 'rep']);
  await q("insert into hf.users (username, password_hash, full_name, role) values ('sam@jussmarketing.co.uk', 'x', 'Sam Juss', 'rep'), ('kimrep', 'x', 'Kim Rep', 'rep')");
  await exec(core.SCHEMA);
  const sendMail = async (email, code) => console.log('CODE for ' + email + ': ' + code);
  http.createServer((req, res) => {
    if (req.url.startsWith('/api/')) {
      let b = ''; req.on('data', c => (b += c)); req.on('end', () => {
        req.body = b;
        // Local http: drop "Secure" from the cookie so the browser keeps it
        const sh = res.setHeader.bind(res); res.setHeader = (k, v) => sh(k, k.toLowerCase() === 'set-cookie' ? String(v).replace('; Secure', '') : v);
        handle(req, res, { q, exec, sendMail, bcrypt });
      });
      return;
    }
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const f = path.join(PUB, path.normalize(rel));
    if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); res.end(fs.readFileSync(f));
  }).listen(PORT, () => console.log('hub preview on http://localhost:' + PORT));
})();
